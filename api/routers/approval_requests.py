from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from api.database import get_db
from api.models import ApprovalRequest, ApprovalRequestDecision, ProjectMember, User, Project
from api.dependencies import get_current_user
from api.services.approval_service import advance_approval

router = APIRouter(prefix="/approval-requests", tags=["approval-requests"])


class DecideBody(BaseModel):
    decision: str   # approve | reject
    notes: Optional[str] = None


class DecisionOut(BaseModel):
    id: int
    step_order: int
    step_name: str
    required_role: str
    decided_by: Optional[int]
    decision: Optional[str]
    notes: Optional[str]
    decided_at: Optional[str]

    class Config:
        from_attributes = True


class RequestOut(BaseModel):
    id: int
    project_id: int
    project_name: Optional[str]
    workflow_id: Optional[int]
    triggered_by: int
    triggered_by_username: Optional[str]
    context_type: str
    context_id: Optional[str]
    current_step_order: int
    status: str
    created_at: Optional[str]
    decisions: list[DecisionOut] = []

    class Config:
        from_attributes = True


def _build_request_out(req: ApprovalRequest, db: Session) -> RequestOut:
    decisions = db.query(ApprovalRequestDecision).filter(
        ApprovalRequestDecision.request_id == req.id
    ).order_by(ApprovalRequestDecision.step_order).all()

    project = db.query(Project).filter(Project.id == req.project_id).first()
    triggered_user = db.query(User).filter(User.id == req.triggered_by).first()

    return RequestOut(
        id=req.id,
        project_id=req.project_id,
        project_name=project.name if project else None,
        workflow_id=req.workflow_id,
        triggered_by=req.triggered_by,
        triggered_by_username=triggered_user.username if triggered_user else None,
        context_type=req.context_type,
        context_id=req.context_id,
        current_step_order=req.current_step_order,
        status=req.status,
        created_at=req.created_at.isoformat() if req.created_at else None,
        decisions=[
            DecisionOut(
                id=d.id,
                step_order=d.step_order,
                step_name=d.step_name,
                required_role=d.required_role,
                decided_by=d.decided_by,
                decision=d.decision,
                notes=d.notes,
                decided_at=d.decided_at.isoformat() if d.decided_at else None,
            )
            for d in decisions
        ],
    )


@router.get("", response_model=list[RequestOut])
def list_for_me(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Requests where the current user must decide (based on their project role at the current step)."""
    memberships = db.query(ProjectMember).filter(ProjectMember.user_id == current_user.id).all()
    role_map: dict[int, str] = {m.project_id: m.project_role for m in memberships}

    pending_reqs = db.query(ApprovalRequest).filter(
        ApprovalRequest.status == "in_progress",
    ).all()

    result = []
    for req in pending_reqs:
        user_role = role_map.get(req.project_id)
        if not user_role:
            continue
        current_decision = db.query(ApprovalRequestDecision).filter(
            ApprovalRequestDecision.request_id == req.id,
            ApprovalRequestDecision.step_order == req.current_step_order,
        ).first()
        if current_decision and current_decision.required_role == user_role and current_decision.decision is None:
            result.append(_build_request_out(req, db))

    return result


@router.get("/all", response_model=list[RequestOut])
def list_all(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """All approval requests — for admin view."""
    reqs = db.query(ApprovalRequest).order_by(ApprovalRequest.created_at.desc()).limit(200).all()
    return [_build_request_out(r, db) for r in reqs]


@router.get("/my", response_model=list[RequestOut])
def list_my_requests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Requests triggered by the current user."""
    reqs = db.query(ApprovalRequest).filter(
        ApprovalRequest.triggered_by == current_user.id,
    ).order_by(ApprovalRequest.created_at.desc()).all()
    return [_build_request_out(r, db) for r in reqs]


@router.post("/{request_id}/decide", response_model=RequestOut)
def decide(
    request_id: int,
    body: DecideBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.decision not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="decision must be 'approve' or 'reject'")

    req = db.query(ApprovalRequest).filter(ApprovalRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    # Verify user has the required role for the current step
    member = db.query(ProjectMember).filter(
        ProjectMember.project_id == req.project_id,
        ProjectMember.user_id == current_user.id,
    ).first()

    current_decision = db.query(ApprovalRequestDecision).filter(
        ApprovalRequestDecision.request_id == request_id,
        ApprovalRequestDecision.step_order == req.current_step_order,
    ).first()

    if not current_decision:
        raise HTTPException(status_code=400, detail="No pending step found")

    user_roles = {ur.role for ur in current_user.user_roles}
    is_admin = "admin" in user_roles
    if not member or member.project_role != current_decision.required_role:
        if not is_admin:
            raise HTTPException(status_code=403, detail=f"This step requires role: {current_decision.required_role}")

    try:
        updated = advance_approval(db, request_id, current_user.id, body.decision, body.notes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return _build_request_out(updated, db)


@router.delete("/{request_id}")
def cancel_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cancel (delete) a pending approval request. Only the requester or admin can cancel."""
    req = db.query(ApprovalRequest).filter(ApprovalRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    user_roles = {ur.role for ur in current_user.user_roles}
    if req.requested_by != current_user.id and "admin" not in user_roles:
        raise HTTPException(status_code=403, detail="Not allowed to cancel this request")

    if req.status not in ("pending", "in_progress"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a request with status '{req.status}'")

    db.delete(req)
    db.commit()
    return {"ok": True}
