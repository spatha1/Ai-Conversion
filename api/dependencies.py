"""
api/dependencies.py
FastAPI authentication and role-checking dependencies.
"""
from __future__ import annotations
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import User
from api.auth_utils import decode_token

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """
    Extracts Bearer token from Authorization header, decodes it,
    and returns the matching active User ORM object.
    Raises 401 if the token is missing, invalid, or expired.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access":
            raise JWTError("wrong token type")
        user_id: int = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or deactivated",
        )
    return user


def get_current_role(current_user: User = Depends(get_current_user)) -> str:
    """
    Resolves the user's effective role using admin > developer > viewer priority.
    A user can hold multiple roles; the highest-ranked one wins.
    """
    roles = {ur.role for ur in current_user.user_roles}
    if "admin" in roles:
        return "admin"
    if "developer" in roles:
        return "developer"
    return "viewer"


def require_admin(role: str = Depends(get_current_role)) -> str:
    """Dependency: allows only admin users."""
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return role


def require_developer(role: str = Depends(get_current_role)) -> str:
    """Dependency: allows admin and developer users."""
    if role not in ("admin", "developer"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Developer or admin access required",
        )
    return role


def require_non_viewer(role: str = Depends(get_current_role)) -> str:
    """Dependency: blocks viewer-only accounts from write operations."""
    if role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Write access not permitted for viewer role",
        )
    return role
