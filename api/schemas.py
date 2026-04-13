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
    # passwords/keys are NEVER returned — only metadata about which auth method is set
    sf_account:   Optional[str]
    sf_warehouse: Optional[str]
    sf_role:      Optional[str]
    sf_database:  Optional[str]
    sf_schema:    Optional[str]
    sf_username:  Optional[str]
    sf_has_private_key: bool = False   # True when a private key was saved (not the key itself)
    query_text:   Optional[str]
    sheet_alias:  Optional[str]
    is_active:    bool
    created_at:   datetime
    updated_at:   datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_with_key_flag(cls, conn: Any) -> "ConnectionOut":
        data = cls.model_validate(conn)
        data.sf_has_private_key = bool(getattr(conn, "sf_private_key_enc", None))
        return data


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

    # Snowflake — accept both canonical (account) and sf_* variants from the frontend form
    account:      Optional[str] = None
    sf_account:   Optional[str] = None   # alias from ConnectionCreate
    warehouse:    Optional[str] = None
    sf_warehouse: Optional[str] = None
    role:         Optional[str] = None
    sf_role:      Optional[str] = None
    sf_database:  Optional[str] = None
    sf_schema:    Optional[str] = None
    sf_username:  Optional[str] = None
    sf_password:  Optional[str] = None
    private_key:          Optional[str] = None
    sf_private_key:       Optional[str] = None   # alias from ConnectionCreate
    private_key_passphrase:       Optional[str] = None
    sf_private_key_passphrase:    Optional[str] = None   # alias from ConnectionCreate

    # Shared
    query:        Optional[str] = None
    query_text:   Optional[str] = None   # alias from ConnectionCreate
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


# ── AI Trace ─────────────────────────────────────────────────

class AITraceOut(BaseModel):
    id:            int
    module:        str
    conn_id:       Optional[int]
    model:         str
    prompt_text:   Optional[str]
    response_text: Optional[str]
    tokens_in:     Optional[int]
    tokens_out:    Optional[int]
    latency_ms:    Optional[int]
    created_at:    datetime

    model_config = {"from_attributes": True}


# ── Validation ────────────────────────────────────────────────

class ValidationResultOut(BaseModel):
    passed:   bool
    errors:   list[str]
    warnings: list[str]


# ── Development Module ────────────────────────────────────────

class PlanStep(BaseModel):
    step_number: int
    title:       str
    description: str
    sql_type:    str  # SELECT|INSERT|UPDATE|DELETE|CREATE_TABLE|STORED_PROCEDURE|DDL|SCRIPT
    depends_on:  list[int] = []


class PlanRequest(BaseModel):
    conn_id:          int
    task_description: str
    model:            str = "gpt-4o-mini"


class PlanResponse(BaseModel):
    artifact_id: int
    steps:       list[PlanStep]


class GenerateRequest(BaseModel):
    artifact_id:  int
    step_number:  int
    model:        str = "gpt-4o-mini"


class GenerateResponse(BaseModel):
    step_number: int
    sql:         str


class ValidateRequest(BaseModel):
    conn_id: int
    sql:     str


class ExecuteRequest(BaseModel):
    conn_id:         int
    sql:             str
    limit:           int  = 500
    skip_validation: bool = False


class ExplainRequest(BaseModel):
    conn_id: int
    sql:     str
    model:   str = "gpt-4o-mini"


class SuggestFixRequest(BaseModel):
    conn_id: int
    error:   str
    sql:     str
    model:   str = "gpt-4o-mini"


class DevArtifactOut(BaseModel):
    id:               int
    conn_id:          Optional[int]
    project_id:       Optional[int]
    task_description: str
    plan_json:        Optional[str]
    artifacts_json:   Optional[str]
    pipeline_config:  Optional[str]
    status:           str
    created_at:       datetime
    updated_at:       datetime

    model_config = {"from_attributes": True}


# ── Prompt Templates ──────────────────────────────────────────

class PromptTemplateCreate(BaseModel):
    name:        str
    description: Optional[str] = None
    category:    Optional[str] = None
    content:     str


class PromptTemplateUpdate(BaseModel):
    name:        Optional[str] = None
    description: Optional[str] = None
    category:    Optional[str] = None
    content:     Optional[str] = None
    is_active:   Optional[bool] = None


class PromptTemplateOut(BaseModel):
    id:          int
    name:        str
    description: Optional[str]
    category:    Optional[str]
    content:     str
    is_active:   bool
    created_at:  datetime
    updated_at:  datetime

    model_config = {"from_attributes": True}


# ── AI Readiness ──────────────────────────────────────────────

class AIReadinessOut(BaseModel):
    tables_total:              int
    tables_with_description:   int
    columns_with_embeddings:   int
    fk_relations:              int
    query_examples:            int
    active_prompt_templates:   int
    readiness_score:           float  # 0.0 – 1.0


# ── Power BI Export ───────────────────────────────────────────

class PowerBIExportOut(BaseModel):
    dax_measures:   list[dict[str, Any]]
    dataset_schema: dict[str, Any]
    report_json:    dict[str, Any]
