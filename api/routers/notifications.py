from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime

from api.database import get_db
from api.models import Notification, User
from api.dependencies import get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    body: Optional[str]
    is_read: bool
    link_type: Optional[str]
    link_id: Optional[str]
    created_at: Optional[str]

    class Config:
        from_attributes = True


class UnreadCount(BaseModel):
    count: int


@router.get("", response_model=list[NotificationOut])
def list_notifications(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.is_read.asc(), Notification.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        NotificationOut(
            id=n.id,
            type=n.type,
            title=n.title,
            body=n.body,
            is_read=n.is_read,
            link_type=n.link_type,
            link_id=n.link_id,
            created_at=n.created_at.isoformat() if n.created_at else None,
        )
        for n in rows
    ]


@router.get("/unread-count", response_model=UnreadCount)
def unread_count(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    count = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,
    ).count()
    return UnreadCount(count=count)


@router.patch("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id,
    ).first()
    if notif:
        notif.is_read = True
        db.commit()
        db.refresh(notif)
    return NotificationOut(
        id=notif.id,
        type=notif.type,
        title=notif.title,
        body=notif.body,
        is_read=notif.is_read,
        link_type=notif.link_type,
        link_id=notif.link_id,
        created_at=notif.created_at.isoformat() if notif.created_at else None,
    )


@router.patch("/read-all", status_code=204)
def mark_all_read(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,
    ).update({"is_read": True})
    db.commit()
