# ═══════════════════════════════════════════════════════════
# routers/projects.py — Project CRUD
# Endpoints:
#   GET    /api/projects
#   POST   /api/projects
#   GET    /api/projects/{project_id}
#   PUT    /api/projects/{project_id}
#   DELETE /api/projects/{project_id}
# ═══════════════════════════════════════════════════════════
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import Project, SourceConnection

from api.dependencies import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])


# ── Schemas ────────────────────────────────────────────────
class ProjectIn(BaseModel):
    name: str
    description: Optional[str] = None
    status: Optional[str] = "active"


class ProjectOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    connection_count: Optional[int] = 0
    mapping_count: Optional[int] = 0

    class Config:
        from_attributes = True


# ── List ───────────────────────────────────────────────────
@router.get("/projects", response_model=List[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.updated_at.desc()).all()
    result = []
    for p in projects:
        conn_count = db.query(SourceConnection).filter_by(
            project_id=p.id, is_active=True
        ).count()
        result.append(ProjectOut(
            id=p.id,
            name=p.name,
            description=p.description,
            status=getattr(p, "status", "active"),
            created_at=p.created_at,
            updated_at=p.updated_at,
            connection_count=conn_count,
            mapping_count=0,
        ))
    return result


# ── Create ─────────────────────────────────────────────────
@router.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    project = Project(
        name=body.name.strip(),
        description=body.description,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        status="active",
        created_at=project.created_at,
        updated_at=project.updated_at,
        connection_count=0,
        mapping_count=0,
    )


# ── Get one ────────────────────────────────────────────────
@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)):
    p = db.query(Project).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    conn_count = db.query(SourceConnection).filter_by(
        project_id=p.id, is_active=True
    ).count()
    return ProjectOut(
        id=p.id,
        name=p.name,
        description=p.description,
        status="active",
        created_at=p.created_at,
        updated_at=p.updated_at,
        connection_count=conn_count,
    )


# ── Update ─────────────────────────────────────────────────
@router.put("/projects/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, body: ProjectIn, db: Session = Depends(get_db)):
    p = db.query(Project).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    p.name = body.name.strip()
    p.description = body.description
    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    conn_count = db.query(SourceConnection).filter_by(
        project_id=p.id, is_active=True
    ).count()
    return ProjectOut(
        id=p.id,
        name=p.name,
        description=p.description,
        status="active",
        created_at=p.created_at,
        updated_at=p.updated_at,
        connection_count=conn_count,
    )


# ── Delete ─────────────────────────────────────────────────
@router.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    p = db.query(Project).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(p)
    db.commit()
    return {"deleted": True, "id": project_id}
