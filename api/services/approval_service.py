"""
approval_service.py — helpers for creating and advancing approval requests.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from api.models import (
    ApprovalWorkflow, ApprovalWorkflowStep,
    ApprovalRequest, ApprovalRequestDecision,
    ProjectMember, Notification, User,
)


def _notify_users(db: Session, user_ids: list[int], notif_type: str, title: str, body: str,
                  link_type: str = None, link_id: str = None):
    for uid in user_ids:
        db.add(Notification(
            user_id=uid,
            type=notif_type,
            title=title,
            body=body,
            link_type=link_type,
            link_id=link_id,
        ))


def _members_with_role(db: Session, project_id: int, role: str) -> list[int]:
    rows = db.query(ProjectMember.user_id).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.project_role == role,
    ).all()
    return [r[0] for r in rows]


def create_approval_request(
    db: Session,
    project_id: int,
    triggered_by_id: int,
    context_type: str,
    context_id: str,
) -> Optional[ApprovalRequest]:
    """
    Look up the active workflow for the project. If found, create an
    ApprovalRequest + decision rows and notify step-1 approvers.
    Returns the request if approval is needed, None if free to proceed.
    """
    workflow = db.query(ApprovalWorkflow).filter(
        ApprovalWorkflow.project_id == project_id,
        ApprovalWorkflow.is_active == True,
    ).first()

    if not workflow:
        return None

    steps = (
        db.query(ApprovalWorkflowStep)
        .filter(ApprovalWorkflowStep.workflow_id == workflow.id)
        .order_by(ApprovalWorkflowStep.step_order)
        .all()
    )
    if not steps:
        return None

    request = ApprovalRequest(
        project_id=project_id,
        workflow_id=workflow.id,
        triggered_by=triggered_by_id,
        context_type=context_type,
        context_id=str(context_id),
        current_step_order=steps[0].step_order,
        status="in_progress",
    )
    db.add(request)
    db.flush()

    for step in steps:
        db.add(ApprovalRequestDecision(
            request_id=request.id,
            step_order=step.step_order,
            step_name=step.step_name,
            required_role=step.required_role,
        ))

    # Notify step-1 approvers
    first_step = steps[0]
    approver_ids = _members_with_role(db, project_id, first_step.required_role)
    triggered_user = db.query(User).filter(User.id == triggered_by_id).first()
    requester_name = triggered_user.username if triggered_user else "Someone"
    _notify_users(
        db, approver_ids,
        notif_type="approval_needed",
        title=f"Approval needed: {context_type.replace('_', ' ').title()}",
        body=f"{requester_name} requested approval for {context_type} (step: {first_step.step_name}).",
        link_type="approval_request",
        link_id=str(request.id),
    )

    db.commit()
    db.refresh(request)
    return request


def advance_approval(db: Session, request_id: int, decided_by_id: int, decision: str, notes: str = None):
    """
    Record a decision on the current step and advance the workflow.
    decision must be 'approve' or 'reject'.
    Returns updated ApprovalRequest.
    """
    request = db.query(ApprovalRequest).filter(ApprovalRequest.id == request_id).first()
    if not request or request.status not in ("in_progress", "pending"):
        raise ValueError("Request not found or not actionable")

    current_decision = (
        db.query(ApprovalRequestDecision)
        .filter(
            ApprovalRequestDecision.request_id == request_id,
            ApprovalRequestDecision.step_order == request.current_step_order,
        )
        .first()
    )
    if not current_decision:
        raise ValueError("Current step decision record not found")

    current_decision.decided_by = decided_by_id
    current_decision.decision = decision
    current_decision.notes = notes
    current_decision.decided_at = datetime.utcnow()

    triggered_user = db.query(User).filter(User.id == request.triggered_by).first()
    requester_name = triggered_user.username if triggered_user else "requester"

    if decision == "reject":
        request.status = "rejected"
        # Notify requester
        _notify_users(
            db, [request.triggered_by],
            notif_type="approval_decided",
            title="Approval rejected",
            body=f"Your request ({request.context_type}) was rejected at step '{current_decision.step_name}'."
                 + (f" Notes: {notes}" if notes else ""),
            link_type="approval_request",
            link_id=str(request.id),
        )
    else:
        # Find next pending step
        next_step = (
            db.query(ApprovalRequestDecision)
            .filter(
                ApprovalRequestDecision.request_id == request_id,
                ApprovalRequestDecision.step_order > request.current_step_order,
                ApprovalRequestDecision.decision == None,
            )
            .order_by(ApprovalRequestDecision.step_order)
            .first()
        )

        if next_step:
            request.current_step_order = next_step.step_order
            approver_ids = _members_with_role(db, request.project_id, next_step.required_role)
            _notify_users(
                db, approver_ids,
                notif_type="approval_needed",
                title=f"Approval needed: {request.context_type.replace('_', ' ').title()}",
                body=f"Step '{next_step.step_name}' requires your approval (requested by {requester_name}).",
                link_type="approval_request",
                link_id=str(request.id),
            )
        else:
            request.status = "approved"
            if request.context_type == "agentic_step" and request.triggered_by:
                # Parse execution_id from context_id: "{exec_id}:{card_id}:{step_number}"
                try:
                    exec_id = int(request.context_id.split(":")[0])
                except (ValueError, IndexError, AttributeError):
                    exec_id = None
                decided_user = db.query(User).filter(User.id == decided_by_id).first()
                approver_name = decided_user.username if decided_user else "An approver"
                _notify_users(
                    db, [request.triggered_by],
                    notif_type="approval_decided",
                    title="Pipeline step approved — ready to resume",
                    body=f"Step approved by {approver_name}. Open the pipeline to continue execution.",
                    link_type="agentic_execution",
                    link_id=str(exec_id) if exec_id else str(request.id),
                )
            else:
                _notify_users(
                    db, [request.triggered_by],
                    notif_type="approval_decided",
                    title="Approval granted",
                    body=f"Your request ({request.context_type.replace('_', ' ')}) has been fully approved.",
                    link_type="approval_request",
                    link_id=str(request.id),
                )

    db.commit()
    db.refresh(request)
    return request


def check_approved(db: Session, project_id: int, context_type: str, context_id: str) -> bool:
    """Return True if there is an approved request for this context."""
    req = db.query(ApprovalRequest).filter(
        ApprovalRequest.project_id == project_id,
        ApprovalRequest.context_type == context_type,
        ApprovalRequest.context_id == str(context_id),
        ApprovalRequest.status == "approved",
    ).first()
    return req is not None


def needs_approval(db: Session, project_id: int) -> bool:
    """Return True if an active approval workflow exists for this project."""
    return db.query(ApprovalWorkflow).filter(
        ApprovalWorkflow.project_id == project_id,
        ApprovalWorkflow.is_active == True,
    ).first() is not None
