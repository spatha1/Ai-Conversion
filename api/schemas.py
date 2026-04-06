# ═══════════════════════════════════════════════════════════
# schemas.py — Pydantic request / response models
# ═══════════════════════════════════════════════════════════
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


# ── Connection save / update ─────────────────────────────────

class ConnectionBase(BaseModel):
    name:        str         = Field(..., min_length=1, max_length=200)
    source_type: str         = Field(..., pattern="^(sql|snowflake)$")
    project_id:  Optional[int] = None

    # SQL
    dialect:       Optional[str] = None
    host:          Optional[str] = None
    port:          Optional[int] = None
    database_name: Optional[str] = None
    schema_name:   Optional[str] = None
    username:      Optional[str] = None
    password:      Optional[str] = None   # plain-text in → encrypted for DB

    # Snowflake
    sf_account:    Optional[str] = None
    sf_warehouse:  Optional[str] = None
    sf_role:       Optional[str] = None
    sf_database:   Optional[str] = None
    sf_schema:     Optional[str] = None
    sf_username:   Optional[str] = None
    sf_password:   Optional[str] = None   # plain-text in → encrypted for DB
    sf_private_key: Optional[str] = None  # plain-text in → encrypted for DB
    sf_private_key_passphrase: Optional[str] = None  # plain-text in → encrypted for DB

    # Shared
    query_text:  Optional[str] = None
    sheet_alias: Optional[str] = "Sheet1"


class ConnectionCreate(ConnectionBase):
    pass


class ConnectionUpdate(ConnectionBase):
    name:        Optional[str] = None   # type: ignore[assignment]
    source_type: Optional[str] = None   # type: ignore[assignment]


class ConnectionOut(BaseModel):
    id:           int
    name:         str
    source_type:  str
    dialect:      Optional[str]
    host:         Optional[str]
    port:         Optional[int]
    database_name: Optional[str]
    schema_name:  Optional[str]
    username:     Optional[str]
    # passwords are NEVER returned
    sf_account:   Optional[str]
    sf_warehouse: Optional[str]
    sf_role:      Optional[str]
    sf_database:  Optional[str]
    sf_schema:    Optional[str]
    sf_username:  Optional[str]
    query_text:   Optional[str]
    sheet_alias:  Optional[str]
    is_active:    bool
    created_at:   datetime
    updated_at:   datetime

    model_config = {"from_attributes": True}


# ── Ad-hoc test / preview (form submitted directly, not saved) ──

class AdHocConnectionRequest(BaseModel):
    source_type: str = Field(..., pattern="^(sql|snowflake)$")

    # SQL
    dialect:      Optional[str] = None
    host:         Optional[str] = None
    port:         Optional[int] = None
    database:     Optional[str] = None
    schema:       Optional[str] = None
    username:     Optional[str] = None
    password:     Optional[str] = None

    # Snowflake
    account:      Optional[str] = None
    warehouse:    Optional[str] = None
    role:         Optional[str] = None
    sf_database:  Optional[str] = None
    sf_schema:    Optional[str] = None
    sf_username:  Optional[str] = None
    sf_password:  Optional[str] = None
    private_key:  Optional[str] = None
    private_key_passphrase: Optional[str] = None

    # Shared
    query:        Optional[str] = None
    sheet_alias:  Optional[str] = "Sheet1"


# ── Responses ────────────────────────────────────────────────

class TestResult(BaseModel):
    success: bool
    message: str


class PreviewResult(BaseModel):
    columns:     list[str]
    rows:        list[dict[str, Any]]
    total:       int
    sheet_alias: str
