"""
api/routers/users.py
Admin-only user management: CRUD for users and their role assignments.
"""
from __future__ import annotations
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import User, UserRole
from api.auth_utils import hash_password
from api.dependencies import get_current_user, require_admin
from api.schemas import UserCreate, UserUpdate, UserOut

router = APIRouter(
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(require_admin)],  # all endpoints require admin
)


def _resolve_role(user: User) -> str:
    roles = {ur.role for ur in user.user_roles}
    if "admin" in roles:
        return "admin"
    if "developer" in roles:
        return "developer"
    return "viewer"


def _user_to_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        email=user.email,
        role=_resolve_role(user),
        is_active=user.is_active,
        created_at=user.created_at,
        last_login=user.last_login,
    )


@router.get("", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db)):
    """Return all users (both active and inactive)."""
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [_user_to_out(u) for u in users]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(req: UserCreate, db: Session = Depends(get_db)):
    """Create a new user and assign a role."""
    # Check for duplicate username / email
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    if req.email and db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email already in use")

    user = User(
        username=req.username,
        email=req.email,
        hashed_password=hash_password(req.password),
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role=req.role))
    db.commit()
    db.refresh(user)
    return _user_to_out(user)


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    """Return a single user by ID."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_to_out(user)


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, req: UserUpdate, db: Session = Depends(get_db)):
    """Update a user's email, role, or active status."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if req.email is not None:
        # Check email uniqueness (ignore this user's own email)
        conflict = db.query(User).filter(
            User.email == req.email, User.id != user_id
        ).first()
        if conflict:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = req.email

    if req.role is not None:
        # Replace all existing roles with the new one
        db.query(UserRole).filter(UserRole.user_id == user_id).delete()
        db.add(UserRole(user_id=user_id, role=req.role))

    if req.is_active is not None:
        # Prevent deactivating the last active admin
        if not req.is_active and _resolve_role(user) == "admin":
            admin_count = (
                db.query(UserRole)
                .filter(UserRole.role == "admin")
                .join(User, User.id == UserRole.user_id)
                .filter(User.is_active == True, User.id != user_id)
                .count()
            )
            if admin_count == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot deactivate the last active admin",
                )
        user.is_active = req.is_active

    db.commit()
    db.refresh(user)
    return _user_to_out(user)


@router.delete("/{user_id}")
def deactivate_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Soft-deactivate a user (sets is_active=False). Never hard-deletes."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent deactivating last admin
    if _resolve_role(user) == "admin":
        admin_count = (
            db.query(UserRole)
            .filter(UserRole.role == "admin")
            .join(User, User.id == UserRole.user_id)
            .filter(User.is_active == True, User.id != user_id)
            .count()
        )
        if admin_count == 0:
            raise HTTPException(
                status_code=400,
                detail="Cannot deactivate the last active admin",
            )

    user.is_active = False
    db.commit()
    return {"ok": True, "user_id": user_id}
