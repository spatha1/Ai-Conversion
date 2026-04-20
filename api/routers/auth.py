"""
api/routers/auth.py
Authentication endpoints: login, token refresh, logout, current user info.
"""
from __future__ import annotations
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import User
from api.auth_utils import verify_password, create_access_token, create_refresh_token, decode_token
from api.dependencies import get_current_user, get_current_role
from api.schemas import LoginRequest, TokenResponse, RefreshRequest, MeResponse

router = APIRouter(prefix="/auth", tags=["auth"])


def _primary_role(user: User) -> str:
    """Resolve the user's effective role (admin > developer > viewer)."""
    roles = {ur.role for ur in user.user_roles}
    if "admin" in roles:
        return "admin"
    if "developer" in roles:
        return "developer"
    return "viewer"


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    """Validate credentials and return access + refresh tokens."""
    user = db.query(User).filter(
        User.username == req.username,
        User.is_active == True,
    ).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    role = _primary_role(user)
    user.last_login = datetime.utcnow()
    db.commit()
    return TokenResponse(
        access_token=create_access_token(user.id, user.username, role),
        refresh_token=create_refresh_token(user.id),
        username=user.username,
        role=role,
        user_id=user.id,
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(req: RefreshRequest, db: Session = Depends(get_db)):
    """Rotate both tokens using a valid refresh token."""
    try:
        payload = decode_token(req.refresh_token)
        if payload.get("type") != "refresh":
            raise JWTError("wrong token type")
        user_id = int(payload["sub"])
    except (JWTError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or deactivated",
        )
    role = _primary_role(user)
    return TokenResponse(
        access_token=create_access_token(user.id, user.username, role),
        refresh_token=create_refresh_token(user.id),
        username=user.username,
        role=role,
        user_id=user.id,
    )


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    """
    Stateless logout — no server-side invalidation needed.
    The frontend discards both tokens on receiving this response.
    """
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
def me(
    current_user: User = Depends(get_current_user),
    role: str = Depends(get_current_role),
):
    """Return current authenticated user's profile and role."""
    return MeResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        role=role,
        is_active=current_user.is_active,
        last_login=current_user.last_login,
    )
