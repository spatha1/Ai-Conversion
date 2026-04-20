"""
api/seed_users.py
Seeds the initial admin user on first run.
Idempotent — skips if the admin username already exists.
"""
from __future__ import annotations

from api.models import User, UserRole
from api.auth_utils import hash_password
from api.config import settings


def seed_default_admin(db) -> None:
    existing = db.query(User).filter(User.username == settings.ADMIN_USERNAME).first()
    if existing:
        print(f"  [seed] Admin user '{settings.ADMIN_USERNAME}' already exists — skipped")
        return

    user = User(
        username=settings.ADMIN_USERNAME,
        hashed_password=hash_password(settings.ADMIN_PASSWORD),
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role="admin"))
    db.commit()
    print(f"  [seed] Admin user '{settings.ADMIN_USERNAME}' created successfully")
