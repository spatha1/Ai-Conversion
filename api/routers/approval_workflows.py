from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from api.database import get_db
from api.models import ApprovalWorkflow, ApprovalWorkflowStep, Project, User
from api.dependencies import get_current_user, require_admin

router = APIRouter(prefix="/projects", tags=["approval-workflows"])


class StepIn(BaseModel):
    step_order: int
    step_name: str
    required_role: str  # manager | team_lead | developer


class WorkflowIn(BaseModel):
    name: str
    description: Optional[str] = None
    is_active: bool = True
    steps: list[StepIn] = []


class StepOut(BaseModel):
    id: int
    step_order: int
    step_name: str
    required_role: str

    class Config:
        from_attributes = True


class WorkflowOut(BaseModel):
    id: int
    project_id: int
    name: str
    description: Optional[str]
    is_active: bool
    steps: list[StepOut] = []

    class Config:
        from_attributes = True


def _build_out(wf: ApprovalWorkflow, steps: list[ApprovalWorkflowStep]) -> WorkflowOut:
    return WorkflowOut(
        id=wf.id,
        project_id=wf.project_id,
        name=wf.name,
        description=wf.description,
        is_active=wf.is_active,
        steps=[StepOut(id=s.id, step_order=s.step_order, step_name=s.step_name, required_role=s.required_role) for s in steps],
    )


@router.get("/{project_id}/workflows", response_model=list[WorkflowOut])
def list_workflows(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    workflows = db.query(ApprovalWorkflow).filter(ApprovalWorkflow.project_id == project_id).all()
    result = []
    for wf in workflows:
        steps = db.query(ApprovalWorkflowStep).filter(
            ApprovalWorkflowStep.workflow_id == wf.id
        ).order_by(ApprovalWorkflowStep.step_order).all()
        result.append(_build_out(wf, steps))
    return result


@router.post("/{project_id}/workflows", response_model=WorkflowOut, status_code=status.HTTP_201_CREATED)
def create_workflow(
    project_id: int,
    body: WorkflowIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    wf = ApprovalWorkflow(
        project_id=project_id,
        name=body.name,
        description=body.description,
        is_active=body.is_active,
    )
    db.add(wf)
    db.flush()

    steps = []
    for s in body.steps:
        step = ApprovalWorkflowStep(
            workflow_id=wf.id,
            step_order=s.step_order,
            step_name=s.step_name,
            required_role=s.required_role,
        )
        db.add(step)
        steps.append(step)

    db.commit()
    db.refresh(wf)
    for step in steps:
        db.refresh(step)

    return _build_out(wf, steps)


@router.put("/{project_id}/workflows/{workflow_id}", response_model=WorkflowOut)
def update_workflow(
    project_id: int,
    workflow_id: int,
    body: WorkflowIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    wf = db.query(ApprovalWorkflow).filter(
        ApprovalWorkflow.id == workflow_id,
        ApprovalWorkflow.project_id == project_id,
    ).first()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    wf.name = body.name
    wf.description = body.description
    wf.is_active = body.is_active

    # Rebuild steps
    db.query(ApprovalWorkflowStep).filter(ApprovalWorkflowStep.workflow_id == wf.id).delete()
    steps = []
    for s in body.steps:
        step = ApprovalWorkflowStep(
            workflow_id=wf.id,
            step_order=s.step_order,
            step_name=s.step_name,
            required_role=s.required_role,
        )
        db.add(step)
        steps.append(step)

    db.commit()
    db.refresh(wf)
    for step in steps:
        db.refresh(step)

    return _build_out(wf, steps)


@router.delete("/{project_id}/workflows/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(
    project_id: int,
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    wf = db.query(ApprovalWorkflow).filter(
        ApprovalWorkflow.id == workflow_id,
        ApprovalWorkflow.project_id == project_id,
    ).first()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    db.delete(wf)
    db.commit()
