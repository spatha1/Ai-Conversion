# ═══════════════════════════════════════════════════════════
# schemas.py — Pydantic request / response models
# ═══════════════════════════════════════════════════════════
from __future__ import annotations
from datetime import datetime, date
from typing import Any, Optional
from pydantic import BaseModel, Field, field_validator


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
    id:              int
    module:          str
    conn_id:         Optional[int]
    model:           str
    prompt_text:     Optional[str]
    response_text:   Optional[str]
    tokens_in:       Optional[int]
    tokens_out:      Optional[int]
    latency_ms:      Optional[int]
    schema_snapshot: Optional[str] = None
    created_at:      datetime

    model_config = {"from_attributes": True}


# ── Run Engine ───────────────────────────────────────────────

class RunLogOut(BaseModel):
    id:            int
    project_id:    int
    mapping_id:    Optional[int]
    triggered_by:  str
    status:        str
    source_rows:   Optional[str]
    output_xml:    Optional[str]
    target_url:    Optional[str]
    target_status: Optional[int]
    errors:        Optional[str]
    started_at:    datetime
    finished_at:   Optional[datetime]

    model_config = {"from_attributes": True}


class TriggerRunRequest(BaseModel):
    conn_id:      int
    triggered_by: str = "manual"
    target_url:   Optional[str] = None


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
    debug:       Optional[dict] = None   # DebugSession.to_response() when debug is on


class GenerateRequest(BaseModel):
    artifact_id:  int
    step_number:  int
    model:        str = "gpt-4o-mini"


class GenerateResponse(BaseModel):
    step_number: int
    sql:         str
    debug:       Optional[dict] = None   # DebugSession.to_response() when debug is on


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
    name:           str
    description:    Optional[str] = None
    category:       Optional[str] = None
    conn_id:        Optional[int] = None
    content:        str
    example_output: Optional[str] = None


class PromptTemplateUpdate(BaseModel):
    name:           Optional[str] = None
    description:    Optional[str] = None
    category:       Optional[str] = None
    conn_id:        Optional[int] = None
    content:        Optional[str] = None
    example_output: Optional[str] = None
    is_active:      Optional[bool] = None


class PromptTemplateOut(BaseModel):
    id:             int
    name:           str
    description:    Optional[str]
    category:       Optional[str]
    conn_id:        Optional[int] = None
    content:        str
    example_output: Optional[str] = None
    is_active:      bool
    created_at:     datetime
    updated_at:     datetime

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


# ── AI Agents ──────────────────────────────────────────────────

class AIAgentCreate(BaseModel):
    name:        str          = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    goal:        str          = Field(..., min_length=1)
    conn_id:     Optional[int] = None
    schedule:    Optional[str] = "manual"
    role_id:     Optional[int] = None
    category:    Optional[str] = None
    tools_json:  Optional[str] = None

class AIAgentUpdate(BaseModel):
    name:        Optional[str] = None
    description: Optional[str] = None
    goal:        Optional[str] = None
    conn_id:     Optional[int] = None
    schedule:    Optional[str] = None
    status:      Optional[str] = None  # active|paused|inactive
    role_id:     Optional[int] = None
    category:    Optional[str] = None
    tools_json:  Optional[str] = None

class AIAgentOut(BaseModel):
    id:          int
    name:        str
    description: Optional[str]
    goal:        str
    conn_id:     Optional[int]
    schedule:    Optional[str]
    status:      str
    role_id:     Optional[int] = None
    category:    Optional[str] = None
    tools_json:  Optional[str] = None
    created_at:  datetime
    updated_at:  datetime
    last_run_at: Optional[datetime]
    model_config = {"from_attributes": True}

class AIAgentLogOut(BaseModel):
    id:             int
    agent_id:       int
    status:         str
    generated_plan: Optional[str]
    steps_executed: Optional[int]
    result_summary: Optional[str]
    error:          Optional[str]
    execution_time: Optional[int]
    created_at:     datetime
    finished_at:    Optional[datetime]
    model_config = {"from_attributes": True}


# ── Testing / Reconciliation ──────────────────────────────────

_VTYPE_PATTERN = "^(count|sum|null_check|duplicate|custom|row_level|column_level)$"


class AITestCaseCreate(BaseModel):
    group_name:          Optional[str] = None
    name:                str  = Field(..., min_length=1, max_length=200)
    source_conn_id:      Optional[int] = None
    target_conn_id:      Optional[int] = None
    source_query:        str
    target_query:        str
    validation_type:     str  = Field("count", pattern=_VTYPE_PATTERN)
    threshold:           Optional[str] = "0"
    identifier_column:   Optional[str] = None   # comma-separated join key(s)
    reconciliation_type: Optional[str] = "aggregate"
    columns_to_compare:  Optional[str] = None   # comma-separated columns to diff; blank = all


class AITestCaseUpdate(BaseModel):
    group_name:          Optional[str] = None
    name:                Optional[str] = None
    source_conn_id:      Optional[int] = None
    target_conn_id:      Optional[int] = None
    source_query:        Optional[str] = None
    target_query:        Optional[str] = None
    validation_type:     Optional[str] = None
    threshold:           Optional[str] = None
    identifier_column:   Optional[str] = None
    reconciliation_type: Optional[str] = None
    columns_to_compare:  Optional[str] = None


class AITestCaseOut(BaseModel):
    id:                  int
    group_name:          Optional[str]
    name:                str
    source_conn_id:      Optional[int]
    target_conn_id:      Optional[int]
    source_query:        str
    target_query:        str
    validation_type:     str
    threshold:           Optional[str]
    schedule_cron:       Optional[str] = None
    identifier_column:   Optional[str] = None
    reconciliation_type: Optional[str] = "aggregate"
    columns_to_compare:  Optional[str] = None
    created_at:          datetime
    model_config = {"from_attributes": True}


class AITestResultOut(BaseModel):
    id:                   int
    test_case_id:         int
    execution_time:       Optional[int]
    result:               str
    source_value:         Optional[str]
    target_value:         Optional[str]
    difference:           Optional[str]
    remarks:              Optional[str]
    mismatch_count:        Optional[int] = None
    missing_source_count:  Optional[int] = None
    missing_target_count:  Optional[int] = None
    sample_mismatches:     Optional[str] = None   # JSON [{key, differences:{col:{source,target}}}]
    sample_missing_source: Optional[str] = None   # JSON [key, key, ...]
    sample_missing_target: Optional[str] = None   # JSON [key, key, ...]
    ran_at:                datetime
    model_config = {"from_attributes": True}


class AIGenerateTestsRequest(BaseModel):
    description:         str
    source_conn_id:      int
    target_conn_id:      Optional[int] = None
    model:               str = "gpt-4o-mini"
    api_key:             str = ""
    identifier_column:   Optional[str] = None   # user-supplied join key hint
    reconciliation_type: Optional[str] = "aggregate"  # aggregate | row_level


# ── Dev vs Base Reconciliation Engine ─────────────────────────

_VALID_REC_QTYPES = (
    "^(count|agg|distribution|set_diff|duplicate|join_explosion|filter_impact|sample_value|custom)$"
)


class TestQueryCreate(BaseModel):
    query_type:        str  = Field(..., pattern=_VALID_REC_QTYPES)
    name:              str  = Field(..., min_length=1, max_length=255)
    sql_text:          str
    table_name:        Optional[str] = None
    column_name:       Optional[str] = None
    priority:          int           = 0
    severity:          str           = "error"   # error | warning
    is_auto_generated: bool          = False
    dev_source_tag:    Optional[str] = None   # NULL=global; mapper|dashboard|report|ps_workflow|adhoc


class TestQueryUpdate(BaseModel):
    name:           Optional[str] = None
    sql_text:       Optional[str] = None
    priority:       Optional[int] = None
    severity:       Optional[str] = None
    dev_source_tag: Optional[str] = None


class TestQueryOut(BaseModel):
    id:                int
    conn_id:           int
    query_type:        str
    name:              str
    sql_text:          str
    table_name:        Optional[str]
    column_name:       Optional[str]
    priority:          int
    severity:          str
    is_auto_generated: bool
    dev_source_tag:    Optional[str]
    created_at:        datetime
    model_config = {"from_attributes": True}


class ReconciliationResultOut(BaseModel):
    id:                int
    conn_id:           int
    run_id:            str
    test_query_id:     Optional[int]
    dev_source_type:   Optional[str]
    dev_source_id:     Optional[int]
    test_name:         str
    query_type:        str
    q2_base_sql:       Optional[str]
    q1_dev_sql:        Optional[str]
    q1_sql_snapshot:   Optional[str]
    status:            str
    base_result:       Optional[str]
    dev_result:        Optional[str]
    issue:             Optional[str]
    ai_insight:        Optional[str]
    execution_time_ms: Optional[int]
    created_at:        datetime
    model_config = {"from_attributes": True}


class RunSummaryOut(BaseModel):
    run_id:            str
    conn_id:           int
    created_at:        str
    total:             int
    passed:            int
    failed:            int
    warns:             int
    errors:            int
    skipped:           int
    confidence_score:  float
    coverage_score:    float
    dev_source_type:   Optional[str]
    dev_source_id:     Optional[int]


class ReconciliationRunRequest(BaseModel):
    source_type:      str = Field(..., description="mapper|dashboard|report|ps_workflow|dev_artifact|adhoc")
    source_id:        Optional[int] = None
    source_sub_id:    Optional[int] = None
    adhoc_sql:        Optional[str] = None
    sampling_mode:    str           = "top_n"   # top_n | random | stratified
    sample_size:      int           = 100_000
    stratify_col:     Optional[str] = None
    base_query_scope: str           = "auto"    # auto | all | tagged_only


# ── Auth / login schemas ──────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1)


class TokenResponse(BaseModel):
    access_token:  str
    refresh_token: str
    token_type:    str = "bearer"
    username:      str
    role:          str   # admin | developer | viewer
    user_id:       int


class RefreshRequest(BaseModel):
    refresh_token: str


class MeResponse(BaseModel):
    id:         int
    username:   str
    email:      Optional[str]
    role:       str
    is_active:  bool
    last_login: Optional[datetime]


# ── User management schemas (admin only) ──────────────────────────────────────

class UserCreate(BaseModel):
    username: str          = Field(..., min_length=1, max_length=100)
    email:    Optional[str] = None
    password: str          = Field(..., min_length=6)
    role:     str          = Field("developer", pattern="^(admin|developer|viewer)$")


class UserUpdate(BaseModel):
    email:     Optional[str]  = None
    role:      Optional[str]  = Field(None, pattern="^(admin|developer|viewer)$")
    is_active: Optional[bool] = None


class UserOut(BaseModel):
    id:         int
    username:   str
    email:      Optional[str]
    role:       str       # resolved primary role
    is_active:  bool
    created_at: datetime
    last_login: Optional[datetime]
    model_config = {"from_attributes": True}


# ── Form Builder ─────────────────────────────────────────────

class FormTemplateCreate(BaseModel):
    name:             str              = Field(..., min_length=1, max_length=200)
    description:      Optional[str]   = None
    category:         Optional[str]   = None
    status:           str             = "configured"
    form_schema_json: Optional[str]   = None
    source_type:      Optional[str]   = None
    project_id:       Optional[int]   = None


class FormTemplateUpdate(BaseModel):
    name:             Optional[str]   = None
    description:      Optional[str]   = None
    category:         Optional[str]   = None
    status:           Optional[str]   = None
    form_schema_json: Optional[str]   = None


class FormTemplateOut(BaseModel):
    id:               int
    name:             str
    description:      Optional[str]
    category:         Optional[str]
    version:          int
    status:           str
    form_schema_json: Optional[str]
    source_type:      Optional[str]
    source_file_path: Optional[str]
    parent_id:        Optional[int]
    project_id:       Optional[int]
    created_at:       datetime
    updated_at:       datetime
    model_config = {"from_attributes": True}


class FormMappingPresetCreate(BaseModel):
    name:         str            = Field(..., min_length=1, max_length=200)
    description:  Optional[str] = None
    source_hint:  Optional[str] = None
    mapping_json: Optional[str] = None


class FormMappingPresetOut(BaseModel):
    id:           int
    name:         str
    description:  Optional[str]
    source_hint:  Optional[str]
    mapping_json: Optional[str]
    created_at:   datetime
    updated_at:   datetime
    model_config = {"from_attributes": True}


class FormDataBindingCreate(BaseModel):
    template_id:      int
    template_version: int
    name:             Optional[str]  = None
    data_source:      str            = Field(..., pattern="^(db|api|manual)$")
    config_json:      Optional[str]  = None
    mapping_json:     Optional[str]  = None
    preset_id:        Optional[int]  = None
    is_default:       bool           = False


class FormDataBindingUpdate(BaseModel):
    name:         Optional[str]  = None
    config_json:  Optional[str]  = None
    mapping_json: Optional[str]  = None
    preset_id:    Optional[int]  = None
    is_default:   Optional[bool] = None


class FormDataBindingOut(BaseModel):
    id:               int
    template_id:      int
    template_version: int
    name:             Optional[str]
    data_source:      str
    config_json:      Optional[str]
    mapping_json:     Optional[str]
    preset_id:        Optional[int]
    is_default:       bool
    created_at:       datetime
    updated_at:       datetime
    model_config = {"from_attributes": True}


class FormExecutionCreate(BaseModel):
    binding_id:    Optional[int]  = None
    output_format: str            = Field(..., pattern="^(pdf|fillable|ui|api)$")


class FormExecutionOut(BaseModel):
    id:               int
    template_id:      int
    template_version: int
    binding_id:       Optional[int]
    bulk_run_id:      Optional[str]
    output_format:    str
    status:           str
    output_json:      Optional[str]
    output_file_path: Optional[str]
    error_message:    Optional[str]
    triggered_by:     str
    created_at:       datetime
    updated_at:       datetime
    model_config = {"from_attributes": True}


class FormBulkExecuteItem(BaseModel):
    template_id:      int
    template_version: int
    output_format:    str = Field(..., pattern="^(pdf|fillable|ui|api)$")


class FormBulkExecuteRequest(BaseModel):
    binding_id:      int
    executions:      list[FormBulkExecuteItem]
    runtime_headers: Optional[dict[str, str]] = None


class FormDraftRequest(BaseModel):
    text_prompt:  Optional[str] = None
    form_name:    str           = Field(..., min_length=1)
    category:     Optional[str] = None


class FormAutoMapRequest(BaseModel):
    data_keys: list[str]


class FormAskAIRequest(BaseModel):
    instruction: str = Field(..., min_length=1)


# ── SAI Knowledge Processing Agent ───────────────────────────────────────────

KNOWLEDGE_ALLOWED_TAGS: frozenset[str] = frozenset({
    # Platform
    "DCT", "ADO", "Snowflake", "General",
    "Conversion", "Clarity", "Legacy", "Architecture", "DB",
    "API", "Auth", "Config", "Data", "ETL", "Fix", "Integration",
    "Mapping", "Migration", "Performance", "Pipeline", "Policy",
    "Process", "Query", "Schema", "Security", "SQL", "Testing",
    "Troubleshooting", "Validation", "XML",
    # Domain
    "GL", "policy", "billing", "claims",
    # Layer
    "bronze", "silver", "gold", "gl_layer",
    # Type
    "table", "view", "rule", "validation", "job",
    # Function
    "ingestion", "transformation", "reporting", "data_quality", "monitoring",
})


class KnowledgeEntryCreate(BaseModel):
    title:       str
    type:        str          # UseCase|Question|Process|Issue
    system:      str          # DCT|ADO|Snowflake|General
    tags:        Optional[list[str]] = None
    source_type: str = "Text"
    raw_content: str
    created_by:  Optional[str] = None
    # Operational Intelligence fields (optional — null for legacy entries)
    op_category:      Optional[str]       = None   # BusinessProcess|ReconRule|Lineage|DCTMapping|IncidentHistory|Remediation|Ownership
    severity:         Optional[str]       = None   # CRITICAL|HIGH|MEDIUM|LOW
    systems_involved: Optional[list[str]] = None   # ["Billing","Claims","Policy"]
    remediation:      Optional[dict]      = None   # {steps:[], api_endpoints:[], ps_module:""}
    sql_template:     Optional[str]       = None
    validation_query: Optional[str]       = None
    owner_team:       Optional[str]       = None
    # Atomic rule fields
    trigger_condition: Optional[str]       = None
    action_steps:      Optional[list[str]] = None   # serialized as JSON
    stop_condition:    Optional[str]       = None
    recovery_steps:    Optional[list[str]] = None   # serialized as JSON
    # Phase 3: operational classification + dependency fields
    decision_type:     Optional[str]       = None   # CONTINUE|PARTIAL_CONTINUE|STOP|ESCALATE|RETRY|WAIT or custom
    execution_scope:   Optional[str]       = None   # policy|batch|monthly_cycle|system or custom
    depends_on:        Optional[list[str]] = None   # titles of rules this rule depends on
    # KB v2: schema scoping + session traceability
    kb_schema_id:       Optional[int]       = None
    session_id:         Optional[int]       = None
    meeting_date:       Optional[str]       = None  # "YYYY-MM-DD"
    attendees:          Optional[list[str]] = None
    supersedes_entry_id: Optional[int]      = None

    @field_validator("raw_content")
    @classmethod
    def content_min_length(cls, v: str) -> str:
        if len(v.strip()) < 50:
            raise ValueError("raw_content must be at least 50 characters")
        return v

    @field_validator("tags", mode="before")
    @classmethod
    def validate_tags(cls, v: Optional[list]) -> Optional[list]:
        return v  # accept any tags — no allowlist restriction


class KnowledgeEntryOut(BaseModel):
    id:                   int
    title:                str
    type:                 str
    system:               str
    tags:                 Optional[str] = None
    summary:              Optional[str] = None
    detailed_explanation: Optional[str] = None
    key_points:           Optional[str] = None
    decision:             Optional[str] = None
    reason:               Optional[str] = None
    is_reusable:          bool
    source_type:          str
    quality_score:        Optional[str] = None
    suggestions:          Optional[str] = None
    status:               str
    embedding_status:     str
    version:              int
    created_by:           Optional[str] = None
    created_at:           datetime
    updated_at:           datetime
    # Operational Intelligence fields
    op_category:           Optional[str] = None
    severity:              Optional[str] = None
    systems_involved_json: Optional[str] = None
    remediation_json:      Optional[str] = None
    sql_template:          Optional[str] = None
    validation_query:      Optional[str] = None
    owner_team:            Optional[str] = None
    # Atomic rule fields
    trigger_condition:     Optional[str] = None
    action_steps:          Optional[str] = None
    stop_condition:        Optional[str] = None
    recovery_steps:        Optional[str] = None
    # Phase 3: operational classification + dependency fields
    decision_type:         Optional[str] = None
    execution_scope:       Optional[str] = None
    depends_on:            Optional[str] = None   # raw JSON array string from DB
    # KB v2: schema scoping + session traceability
    kb_schema_id:          Optional[int] = None
    session_id:            Optional[int] = None
    meeting_date:          Optional[date] = None
    attendees_json:        Optional[str] = None
    approved_at:           Optional[datetime] = None
    approved_by:           Optional[str] = None
    supersedes_entry_id:   Optional[int] = None
    model_config = {"from_attributes": True}


class OperationalPayload(BaseModel):
    """Deterministic operational intelligence payload built from DB rule fields."""
    decision_type:   str
    severity:        str
    scope:           str
    actions:         list[str]
    owners:          list[str]
    recovery_steps:  list[str]
    stop_conditions: list[str]
    depends_on:      list[str]
    rules_matched:   list[str]
    rule_count:      int


class OpenQuestionOut(BaseModel):
    id:                  int
    question:            str
    detected_tags:       Optional[str] = None
    suggested_tags:      Optional[str] = None
    reason:              Optional[str] = None
    frequency:           int
    resolution_text:     Optional[str] = None
    status:              str
    resolved_by:         Optional[str] = None
    resolution_entry_id: Optional[int] = None
    asked_by:            Optional[str] = None
    feedback_type:       Optional[str] = None
    ai_answer:           Optional[str] = None
    days_open:           Optional[int] = None
    days_to_resolve:     Optional[int] = None
    created_at:          datetime
    updated_at:          datetime
    model_config = {"from_attributes": True}


class AskSAIRequest(BaseModel):
    question:   str
    asked_by:   Optional[str] = None
    top_k:      int = 5
    model:      str = "gpt-4o-mini"
    project_id: Optional[int] = None
    history:    list[dict] = []   # [{role: "user"|"assistant", content: str}]
    schema_id:  Optional[int] = None   # scope semantic search to a KB schema


class FetchURLRequest(BaseModel):
    url: str


class ResolveQuestionRequest(BaseModel):
    knowledge_entry: KnowledgeEntryCreate
    resolved_by:     Optional[str] = None


class QuickAnswerRequest(BaseModel):
    resolution_text: str
    resolved_by:     Optional[str] = None


class DismissQuestionRequest(BaseModel):
    resolved_by: Optional[str] = None


# ─── Developer Ops ────────────────────────────────────────────────────────────

class DevSyncRequest(BaseModel):
    project_id: Optional[int] = None
    source:     Optional[str] = "both"    # 'jira' | 'ado' | 'both'


class DevTaskOut(BaseModel):
    id:           int
    project_id:   Optional[int]
    source_type:  str
    external_id:  str
    sprint_name:  Optional[str]
    title:        str
    issue_type:   Optional[str]
    status:       Optional[str]
    priority:     Optional[str]
    assignee:     Optional[str]
    team:         Optional[str]
    due_dt:       Optional[datetime]
    story_points: Optional[float]
    labels:       Optional[str]
    synced_at:    datetime

    model_config = {"from_attributes": True}


class SprintInfo(BaseModel):
    name:  str
    start: Optional[str]
    end:   Optional[str]


class AssigneeStats(BaseModel):
    assignee: str
    count:    int
    done:     int


class DevSummaryOut(BaseModel):
    sprint_name:       Optional[str]
    total_tasks:       int
    done_count:        int
    in_progress_count: int
    blocked_count:     int
    completion_pct:    float
    overdue_count:     int
    active_sprints:    list[SprintInfo]
    by_assignee:       list[AssigneeStats]
    last_synced_at:    Optional[str]


# ─── Enterprise Knowledge Operating System — KB v2 ───────────────────────────

class KnowledgeSchemaCreate(BaseModel):
    name:        str = Field(..., min_length=1, max_length=50)
    description: Optional[str] = None
    color_hex:   str = "#6366f1"


class KnowledgeSchemaOut(BaseModel):
    id:          int
    name:        str
    description: Optional[str] = None
    color_hex:   str
    created_by:  Optional[str] = None
    created_at:  datetime
    model_config = {"from_attributes": True}


class SessionCreate(BaseModel):
    kb_schema_id:            Optional[int]       = None
    title:                   str
    session_type:            str   # RequirementGathering|ArchitectureReview|MappingWorkshop|DefectReview|BusinessDiscussion|ProductionIssue|ClientFeedback|MeetingNotes
    meeting_datetime:        Optional[str]       = None   # ISO datetime string
    duration_minutes:        Optional[int]       = None
    attendees:               Optional[list[str]] = None
    recording_url:           Optional[str]       = None
    transcript_raw:          Optional[str]       = None
    created_by:              Optional[str]       = None
    db_schema_name:          Optional[str]       = None
    db_connection_name:      Optional[str]       = None
    source_system:           Optional[str]       = None
    environment_name:        Optional[str]       = None
    technical_context_json:  Optional[str]       = None


class SessionUpdate(BaseModel):
    title:                   Optional[str]       = None
    transcript_raw:          Optional[str]       = None
    attendees:               Optional[list[str]] = None
    meeting_datetime:        Optional[str]       = None
    recording_url:           Optional[str]       = None
    duration_minutes:        Optional[int]       = None
    db_schema_name:          Optional[str]       = None
    db_connection_name:      Optional[str]       = None
    source_system:           Optional[str]       = None
    environment_name:        Optional[str]       = None
    technical_context_json:  Optional[str]       = None


class SessionOut(BaseModel):
    id:                      int
    kb_schema_id:            Optional[int]      = None
    title:                   str
    session_type:            str
    meeting_datetime:        Optional[datetime]  = None
    duration_minutes:        Optional[int]       = None
    attendees_json:          Optional[str]       = None
    recording_url:           Optional[str]       = None
    transcript_raw:          Optional[str]       = None
    summary:                 Optional[str]       = None
    status:                  str
    decisions_json:          Optional[str]       = None
    action_items_json:       Optional[str]       = None
    open_questions_json:     Optional[str]       = None
    risks_json:              Optional[str]       = None
    retry_count:             int                 = 0
    last_error:              Optional[str]       = None
    processing_started_at:   Optional[datetime]  = None
    processing_completed_at: Optional[datetime]  = None
    created_by:              Optional[str]       = None
    created_at:              datetime
    db_schema_name:          Optional[str]       = None
    db_connection_name:      Optional[str]       = None
    source_system:           Optional[str]       = None
    environment_name:        Optional[str]       = None
    technical_context_json:  Optional[str]       = None
    model_config = {"from_attributes": True}


class SessionAttachmentOut(BaseModel):
    id:               int
    session_id:       int
    kb_schema_id:     Optional[int]      = None
    file_name:        str
    mime_type:        str
    file_size_bytes:  Optional[int]      = None
    processing_status: str
    embedding_status: str
    last_error:       Optional[str]      = None
    uploaded_by:      Optional[str]      = None
    created_at:       datetime
    model_config = {"from_attributes": True}


class SessionProcessRequest(BaseModel):
    model:              str  = "gpt-4o-mini"
    create_kb_entries:  bool = True


class ArtifactOut(BaseModel):
    id:               int
    session_id:       int
    kb_schema_id:     Optional[int]      = None
    artifact_type:    str
    artifact_code:    str
    title:            str
    description:      Optional[str]      = None
    owner:            Optional[str]      = None
    due_date:         Optional[date]     = None
    priority:         Optional[str]      = None
    status:           Optional[str]      = None
    systems_involved: Optional[str]      = None
    confidence_score: Optional[float]    = None
    kb_entry_id:      Optional[int]      = None
    approved_by:      Optional[str]      = None
    approved_at:      Optional[datetime] = None
    created_at:       datetime
    model_config = {"from_attributes": True}


class ArtifactUpdate(BaseModel):
    title:            Optional[str]       = None
    description:      Optional[str]       = None
    owner:            Optional[str]       = None
    due_date:         Optional[str]       = None   # "YYYY-MM-DD"
    priority:         Optional[str]       = None
    status:           Optional[str]       = None
    systems_involved: Optional[list[str]] = None


class ArtifactLinkCreate(BaseModel):
    target_artifact_id: int
    relationship_type:  str   # requires|supports|contradicts|supersedes|implements|validates|resolves|blocks


class ArtifactLinkOut(BaseModel):
    id:                 int
    source_artifact_id: int
    target_artifact_id: int
    relationship_type:  str
    created_by:         Optional[str] = None
    created_at:         datetime
    model_config = {"from_attributes": True}
