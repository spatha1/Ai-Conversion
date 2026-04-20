from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from api.database import get_db
from api.models import ProjectMember, User, Project, Notification
from api.dependencies import get_current_user, require_admin

router2 = APIRouter(prefix="/users", tags=["project-members"])

router = APIRouter(prefix="/projects", tags=["project-members"])


class MemberAssign(BaseModel):
    user_id: int
    project_role: str  # manager | team_lead | developer


class MemberOut(BaseModel):
    id: int
    user_id: int
    username: str
    email: Optional[str]
    project_role: str

    class Config:
        from_attributes = True


@router.get("/{project_id}/members", response_model=list[MemberOut])
def list_members(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    rows = db.query(ProjectMember, User).join(User, ProjectMember.user_id == User.id).filter(
        ProjectMember.project_id == project_id
    ).all()

    return [
        MemberOut(
            id=pm.id,
            user_id=pm.user_id,
            username=u.username,
            email=u.email,
            project_role=pm.project_role,
        )
        for pm, u in rows
    ]


@router.post("/{project_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
def assign_member(
    project_id: int,
    body: MemberAssign,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if body.project_role not in ("manager", "team_lead", "developer"):
        raise HTTPException(status_code=400, detail="project_role must be manager, team_lead, or developer")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    user = db.query(User).filter(User.id == body.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == body.user_id,
    ).first()
    if existing:
        existing.project_role = body.project_role
        db.commit()
        db.refresh(existing)
        member = existing
    else:
        member = ProjectMember(project_id=project_id, user_id=body.user_id, project_role=body.project_role)
        db.add(member)
        db.flush()

        db.add(Notification(
            user_id=body.user_id,
            type="project_assigned",
            title=f"Assigned to project: {project.name}",
            body=f"You have been assigned to project '{project.name}' as {body.project_role.replace('_', ' ').title()}.",
            link_type="project",
            link_id=str(project_id),
        ))
        db.commit()
        db.refresh(member)

    return MemberOut(
        id=member.id,
        user_id=member.user_id,
        username=user.username,
        email=user.email,
        project_role=member.project_role,
    )


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    project_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    member = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id,
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(member)
    db.commit()


class UserProjectOut(BaseModel):
    project_id: int
    project_name: str
    project_role: str

    class Config:
        from_attributes = True


@router2.get("/{user_id}/projects", response_model=list[UserProjectOut])
def list_user_projects(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    rows = db.query(ProjectMember, Project).join(Project, ProjectMember.project_id == Project.id).filter(
        ProjectMember.user_id == user_id
    ).all()
    return [
        UserProjectOut(project_id=p.id, project_name=p.name, project_role=m.project_role)
        for m, p in rows
    ]
