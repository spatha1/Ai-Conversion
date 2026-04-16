"""
feedback.py — User feedback CRUD
POST   /api/feedback          — submit feedback
GET    /api/feedback          — list all (admin)
PATCH  /api/feedback/{id}     — update status / admin notes
DELETE /api/feedback/{id}     — delete entry
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import FeedbackEntry

router = APIRouter()


class FeedbackSubmit(BaseModel):
    submitted_by: Optional[str] = None
    module:       Optional[str] = None
    area:         Optional[str] = None
    type:         str
    priority:     Optional[str] = "medium"
    title:        str
    description:  Optional[str] = None
    page_url:     Optional[str] = None


class FeedbackUpdate(BaseModel):
    status:      Optional[str] = None
    admin_notes: Optional[str] = None


def _row(r: FeedbackEntry) -> dict:
    return {
        "id":           r.id,
        "submitted_by": r.submitted_by,
        "module":       r.module,
        "area":         r.area,
        "type":         r.type,
        "priority":     r.priority,
        "title":        r.title,
        "description":  r.description,
        "page_url":     r.page_url,
        "status":       r.status,
        "admin_notes":  r.admin_notes,
        "created_at":   r.created_at.isoformat() if r.created_at else None,
        "updated_at":   r.updated_at.isoformat() if r.updated_at else None,
    }


@router.post("/feedback", status_code=201)
def submit_feedback(req: FeedbackSubmit, db: Session = Depends(get_db)):
    row = FeedbackEntry(
        submitted_by=req.submitted_by,
        module=req.module,
        area=req.area,
        type=req.type,
        priority=req.priority or "medium",
        title=req.title,
        description=req.description,
        page_url=req.page_url,
        status="open",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row(row)


@router.get("/feedback")
def list_feedback(
    status: Optional[str] = None,
    module: Optional[str] = None,
    type:   Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(FeedbackEntry)
    if status and status != "all":
        q = q.filter(FeedbackEntry.status == status)
    if module and module != "all":
        q = q.filter(FeedbackEntry.module == module)
    if type and type != "all":
        q = q.filter(FeedbackEntry.type == type)
    rows = q.order_by(FeedbackEntry.created_at.desc()).all()
    return [_row(r) for r in rows]


@router.patch("/feedback/{entry_id}")
def update_feedback(entry_id: int, req: FeedbackUpdate, db: Session = Depends(get_db)):
    row = db.query(FeedbackEntry).filter(FeedbackEntry.id == entry_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Feedback entry not found")
    if req.status is not None:
        row.status = req.status
    if req.admin_notes is not None:
        row.admin_notes = req.admin_notes
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _row(row)


@router.delete("/feedback/{entry_id}")
def delete_feedback(entry_id: int, db: Session = Depends(get_db)):
    row = db.query(FeedbackEntry).filter(FeedbackEntry.id == entry_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Feedback entry not found")
    db.delete(row)
    db.commit()
    return {"deleted": entry_id}
