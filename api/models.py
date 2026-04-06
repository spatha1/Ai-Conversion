# ═══════════════════════════════════════════════════════════
# models.py — SQLAlchemy ORM models
# All tables live in the ConversionAgent SQL Server database.
# Table prefix: conversion_
# ═══════════════════════════════════════════════════════════
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime,
    ForeignKey, func
)
from api.database import Base


# ─────────────────────────────────────────────────────────────
# 1. Projects  →  conversion_projects
# ─────────────────────────────────────────────────────────────
class Project(Base):
    """Top-level container: one project = one mapping pipeline."""
    __tablename__ = "conversion_projects"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(String(200), nullable=False)
    description = Column(Text,        nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at  = Column(DateTime, default=datetime.utcnow,
                         onupdate=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<Project id={self.id} name={self.name!r}>"


# ─────────────────────────────────────────────────────────────
# 2. Source Connections  →  conversion_source_connections
#    (SQL / Snowflake / Excel / CSV)
# ─────────────────────────────────────────────────────────────
class SourceConnection(Base):
    """
    Saved source connection configurations.
    Passwords / private keys stored Fernet-encrypted.
    """
    __tablename__ = "conversion_source_connections"

    id          = Column(Integer, primary_key=True, autoincrement=True, index=True)
    project_id  = Column(Integer, ForeignKey("conversion_projects.id"), nullable=True)
    name        = Column(String(200), nullable=False)
    source_type = Column(String(50),  nullable=False)   # sql | snowflake | excel | csv

    # ── SQL fields ───────────────────────────────────────────
    dialect       = Column(String(50),  nullable=True)  # postgresql|mysql|mssql|sqlite
    host          = Column(String(255), nullable=True)
    port          = Column(Integer,     nullable=True)
    database_name = Column(String(255), nullable=True)
    schema_name   = Column(String(255), nullable=True)
    username      = Column(String(255), nullable=True)
    password_enc  = Column(Text,        nullable=True)  # Fernet-encrypted

    # ── Snowflake fields ─────────────────────────────────────
    sf_account         = Column(String(255), nullable=True)
    sf_warehouse       = Column(String(255), nullable=True)
    sf_role            = Column(String(255), nullable=True)
    sf_database        = Column(String(255), nullable=True)
    sf_schema          = Column(String(255), nullable=True)
    sf_username        = Column(String(255), nullable=True)
    sf_password_enc    = Column(Text,        nullable=True)  # Fernet-encrypted
    sf_private_key_enc            = Column(Text, nullable=True)  # Fernet-encrypted
    sf_private_key_passphrase_enc = Column(Text, nullable=True)  # Fernet-encrypted

    # ── Shared ───────────────────────────────────────────────
    query_text  = Column(Text,        nullable=True)
    sheet_alias = Column(String(100), nullable=True)
    is_active   = Column(Boolean,     default=True)

    # ── Audit ────────────────────────────────────────────────
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at = Column(DateTime, default=datetime.utcnow,
                        onupdate=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<SourceConnection id={self.id} name={self.name!r} type={self.source_type}>"


# ─────────────────────────────────────────────────────────────
# 3. XML Templates  →  conversion_xml_templates
# ─────────────────────────────────────────────────────────────
class XmlTemplate(Base):
    """Stores uploaded XML template content per project or connection."""
    __tablename__ = "conversion_xml_templates"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("conversion_projects.id"), nullable=True)
    conn_id    = Column(Integer, ForeignKey("conversion_source_connections.id"), nullable=True, index=True)
    name       = Column(String(200), nullable=False)
    content    = Column(Text, nullable=True)   # raw XML string
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at = Column(DateTime, default=datetime.utcnow,
                        onupdate=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<XmlTemplate id={self.id} name={self.name!r}>"


# ─────────────────────────────────────────────────────────────
# 4. Mappings (version header)  →  conversion_mappings
# ─────────────────────────────────────────────────────────────
class Mapping(Base):
    """
    Versioned mapping header.
    Can be linked to a project and/or a connection.
    """
    __tablename__ = "conversion_mappings"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    project_id  = Column(Integer, ForeignKey("conversion_projects.id"), nullable=True)
    conn_id           = Column(Integer, ForeignKey("conversion_source_connections.id"), nullable=True, index=True)
    template_id       = Column(Integer, ForeignKey("conversion_xml_templates.id"), nullable=True)
    version           = Column(Integer, default=1)
    is_active         = Column(Boolean, default=False)
    identifier_column = Column(String(255), nullable=True)   # PK / grouping column name
    identifier_table  = Column(String(255), nullable=True)   # table that owns the identifier
    created_at        = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<Mapping id={self.id} conn={self.conn_id} v={self.version}>"


# ─────────────────────────────────────────────────────────────
# 5. Mapping Rows  →  conversion_mapping_rows
# ─────────────────────────────────────────────────────────────
class MappingRow(Base):
    """One row = one source column → target XML path mapping."""
    __tablename__ = "conversion_mapping_rows"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    mapping_id    = Column(Integer, ForeignKey("conversion_mappings.id"), nullable=False)
    source_sheet  = Column(String(100), nullable=True)
    source_column = Column(String(200), nullable=True)
    formula       = Column(Text,        nullable=True)  # e.g. {UPPER(Status)}
    target_path   = Column(Text,        nullable=True)  # e.g. /DataExport/Orders/Order/Status
    each_sheet    = Column(String(100), nullable=True)  # inherited each= scope
    sort_order    = Column(Integer,     default=0)
    confidence    = Column(Integer,     nullable=True)  # 0-100; null = manual

    def __repr__(self):
        return f"<MappingRow id={self.id} col={self.source_column!r}>"


# ─────────────────────────────────────────────────────────────
# 6. Run Logs  →  conversion_run_logs
# ─────────────────────────────────────────────────────────────
class RunLog(Base):
    """Records every execution: source fetch → XML generation → API post."""
    __tablename__ = "conversion_run_logs"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    project_id    = Column(Integer, ForeignKey("conversion_projects.id"), nullable=False)
    mapping_id    = Column(Integer, ForeignKey("conversion_mappings.id"),  nullable=True)
    triggered_by  = Column(String(50),  default="manual")   # manual | schedule | api
    status        = Column(String(20),  default="running")  # running | success | failed
    source_rows   = Column(Text,        nullable=True)       # JSON: {"SheetA": 120}
    output_xml    = Column(Text,        nullable=True)
    target_url    = Column(String(500), nullable=True)
    target_status = Column(Integer,     nullable=True)       # HTTP response code
    errors        = Column(Text,        nullable=True)       # JSON list of error strings
    started_at    = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    finished_at   = Column(DateTime, nullable=True)

    def __repr__(self):
        return f"<RunLog id={self.id} status={self.status!r}>"


# ─────────────────────────────────────────────────────────────
# 7. PII Policies  →  conversion_pii_policies
# ─────────────────────────────────────────────────────────────
class PiiPolicy(Base):
    """
    Per-column PII guardrail rules.
    Scope: column-level (source_id set) or project-wide (source_id NULL).
    """
    __tablename__ = "conversion_pii_policies"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    project_id     = Column(Integer, ForeignKey("conversion_projects.id"),          nullable=False)
    source_id      = Column(Integer, ForeignKey("conversion_source_connections.id"), nullable=True)
    column_name    = Column(String(200), nullable=False)   # exact name or '*' wildcard
    pii_type       = Column(String(50),  nullable=False)
    # pii_type values: ssn | email | phone | credit_card | dob | name | address | ip_address | custom
    detection_mode = Column(String(20),  default="auto")   # auto | manual
    action         = Column(String(20),  default="mask")   # mask | redact | tokenize | block | allow
    mask_pattern   = Column(String(100), nullable=True)    # e.g. ***-**-{last4}
    is_active      = Column(Boolean,     default=True)
    created_at     = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at     = Column(DateTime, default=datetime.utcnow,
                            onupdate=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<PiiPolicy id={self.id} col={self.column_name!r} action={self.action!r}>"


# ─────────────────────────────────────────────────────────────
# 8. PII Audit Logs  →  conversion_pii_audit_logs
#    Append-only — never deleted via API.
# ─────────────────────────────────────────────────────────────
class PiiAuditLog(Base):
    """
    Immutable record of every PII field access and transformation.
    Written by pii_guard middleware on every preview and run.
    """
    __tablename__ = "conversion_pii_audit_logs"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    project_id     = Column(Integer, ForeignKey("conversion_projects.id"),          nullable=False)
    source_id      = Column(Integer, ForeignKey("conversion_source_connections.id"), nullable=True)
    run_id         = Column(Integer, ForeignKey("conversion_run_logs.id"),           nullable=True)
    column_name    = Column(String(200), nullable=False)
    pii_type       = Column(String(100), nullable=True)
    action_applied = Column(String(50),  nullable=True)
    row_count      = Column(Integer,     default=0)
    accessed_at    = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<PiiAuditLog id={self.id} col={self.column_name!r} action={self.action_applied!r}>"


# ─────────────────────────────────────────────────────────────
# 9. Schema Catalog — conversion_catalog_columns
#    Discovered table/column metadata per connection
# ─────────────────────────────────────────────────────────────
class CatalogColumn(Base):
    __tablename__ = "conversion_catalog_columns"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    conn_id          = Column(Integer, nullable=False, index=True)
    table_schema     = Column(String(255), nullable=True)
    table_name       = Column(String(255), nullable=False)
    column_name      = Column(String(255), nullable=False)
    data_type        = Column(String(100), nullable=True)
    max_length       = Column(Integer,     nullable=True)   # -1 = MAX
    is_nullable      = Column(String(10),  nullable=True)   # YES / NO
    is_primary_key   = Column(Boolean,     default=False)
    ordinal_position = Column(Integer,     nullable=True)
    discovered_at    = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 10. Schema Catalog — conversion_catalog_relations
#     Foreign-key relationships between tables
# ─────────────────────────────────────────────────────────────
class CatalogRelation(Base):
    __tablename__ = "conversion_catalog_relations"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    conn_id           = Column(Integer, nullable=False, index=True)
    fk_name           = Column(String(255), nullable=True)
    parent_table      = Column(String(255), nullable=False)
    parent_column     = Column(String(255), nullable=False)
    referenced_table  = Column(String(255), nullable=False)
    referenced_column = Column(String(255), nullable=False)
    discovered_at     = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 11. Schema Catalog — conversion_catalog_views
#     View definitions
# ─────────────────────────────────────────────────────────────
class CatalogView(Base):
    __tablename__ = "conversion_catalog_views"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    conn_id         = Column(Integer, nullable=False, index=True)
    view_schema     = Column(String(255), nullable=True)
    view_name       = Column(String(255), nullable=False)
    view_definition = Column(Text,        nullable=True)
    discovered_at   = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 12. Schema Catalog — conversion_catalog_samples
#     Sample rows (top 3) per table stored as JSON
# ─────────────────────────────────────────────────────────────
class CatalogSample(Base):
    __tablename__ = "conversion_catalog_samples"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    conn_id       = Column(Integer, nullable=False, index=True)
    table_schema  = Column(String(255), nullable=True)
    table_name    = Column(String(255), nullable=False)
    row_count     = Column(Integer,     nullable=True)   # total rows in table
    sample_json   = Column(Text,        nullable=True)   # JSON array of ≤3 rows
    discovered_at = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 13. Column Embeddings — conversion_column_embeddings
#     Semantic vector per column for NL→SQL retrieval
# ─────────────────────────────────────────────────────────────
class ColumnEmbedding(Base):
    __tablename__ = "conversion_column_embeddings"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    conn_id            = Column(Integer,  nullable=False, index=True)
    table_schema       = Column(String(255), nullable=True)
    table_name         = Column(String(255), nullable=False)
    column_name        = Column(String(255), nullable=False)
    column_definition  = Column(Text,        nullable=True)   # human-readable description
    embedding_json     = Column(Text,        nullable=True)   # JSON float array
    embedding_model    = Column(String(100), nullable=True)
    created_at         = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 13b. Query Examples — conversion_query_examples
#      Few-shot SQL examples for improving AI query generation
# ─────────────────────────────────────────────────────────────
class QueryExample(Base):
    __tablename__ = "conversion_query_examples"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    conn_id      = Column(Integer, nullable=True, index=True)   # NULL = global (all connections)
    name         = Column(String(255), nullable=False)
    description  = Column(Text,        nullable=True)
    tables_used  = Column(String(500), nullable=True)           # comma-separated table names
    example_sql  = Column(Text,        nullable=False)
    is_active    = Column(Boolean, default=True, nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at   = Column(DateTime, default=datetime.utcnow,
                          onupdate=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 13c. Query Context — conversion_query_context
#      Free-form markdown context injected into AI prompts
#      conn_id NULL = global (applies to all connections)
# ─────────────────────────────────────────────────────────────
class QueryContext(Base):
    __tablename__ = "conversion_query_context"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    conn_id    = Column(Integer, nullable=True, index=True)  # NULL = global
    content    = Column(Text, nullable=True)                 # free-form markdown
    updated_at = Column(DateTime, default=datetime.utcnow,
                        onupdate=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 14. Target Formula Rules — conversion_target_formula_rules
#     Extracted leaf paths + defaults per XML template upload
# ─────────────────────────────────────────────────────────────
class TargetFormulaRule(Base):
    __tablename__ = "conversion_target_formula_rules"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    conn_id         = Column(Integer, ForeignKey("conversion_source_connections.id"), nullable=True, index=True)
    template_id     = Column(Integer, ForeignKey("conversion_xml_templates.id"),      nullable=True)
    target_path     = Column(Text,        nullable=True)
    group_path      = Column(Text,        nullable=True)
    formula_type    = Column(String(50),  nullable=True)  # DEFAULT | DIRECT
    expression      = Column(Text,        nullable=True)
    default_value   = Column(Text,        nullable=True)
    execution_order = Column(Integer,     default=0)
    created_at      = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 15. Generated Queries — conversion_generated_queries
#     AI-generated SQL SELECT per connection (aliases = XML paths)
# ─────────────────────────────────────────────────────────────
class GeneratedQuery(Base):
    __tablename__ = "conversion_generated_queries"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    conn_id      = Column(Integer, ForeignKey("conversion_source_connections.id"), nullable=False, index=True)
    template_id  = Column(Integer, ForeignKey("conversion_xml_templates.id"),      nullable=True)
    mapping_id   = Column(Integer, ForeignKey("conversion_mappings.id"),           nullable=True)
    query_sql    = Column(Text,        nullable=True)
    generated_by = Column(String(20),  default="ai")   # ai | manual
    created_at   = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at   = Column(DateTime, default=datetime.utcnow,
                          onupdate=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 16. Generated XML — conversion_generated_xml
#     Stores XML output produced per identifier value
# ─────────────────────────────────────────────────────────────
class GeneratedXml(Base):
    __tablename__ = "conversion_generated_xml"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    conn_id            = Column(Integer, ForeignKey("conversion_source_connections.id"), nullable=False, index=True)
    mapping_id         = Column(Integer, ForeignKey("conversion_mappings.id"),           nullable=True)
    identifier_value   = Column(String(500), nullable=True, index=True)
    xml_content        = Column(Text,        nullable=True)
    generated_at       = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    validation_status  = Column(String(20),  nullable=True)   # "pass" | "fail" | None = not run
    validation_comment = Column(Text,        nullable=True)   # joined error messages


# ─────────────────────────────────────────────────────────────
# 17. Saved Reports  →  conversion_saved_reports
#     Named SQL queries saved per connection for re-use
# ─────────────────────────────────────────────────────────────
class SavedReport(Base):
    __tablename__ = "conversion_saved_reports"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    conn_id    = Column(Integer, ForeignKey("conversion_source_connections.id"), nullable=False, index=True)
    name       = Column(String(200), nullable=False)
    query_sql  = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 17b. Schema Metadata — conversion_schema_metadata
#      User-defined aliases/keywords for vectorless RAG boost
# ─────────────────────────────────────────────────────────────
class SchemaMetadata(Base):
    __tablename__ = "conversion_schema_metadata"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    conn_id     = Column(Integer, nullable=False, index=True)
    table_name  = Column(String(255), nullable=False)
    column_name = Column(String(255), nullable=True)    # NULL = table-level
    aliases     = Column(Text, nullable=True)            # comma-separated: "Policy,Premium"
    description = Column(Text, nullable=True)            # free-text
    updated_at  = Column(DateTime, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 18. Validation Rules — conversion_validation_rules
#     Per-path XSD constraints for generated XML validation
# ─────────────────────────────────────────────────────────────
class ValidationRule(Base):
    __tablename__ = "conversion_validation_rules"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    conn_id     = Column(Integer, nullable=False, index=True)
    target_path = Column(String(500), nullable=False)   # e.g. /Root/Policy/Status
    is_required = Column(Boolean, default=False, nullable=False)
    data_type   = Column(String(50),  nullable=True)    # string|integer|decimal|date|boolean
    min_length  = Column(Integer,     nullable=True)
    max_length  = Column(Integer,     nullable=True)
    pattern     = Column(String(500), nullable=True)    # regex
    enumeration = Column(Text,        nullable=True)    # comma-separated allowed values
    min_value   = Column(String(100), nullable=True)
    max_value   = Column(String(100), nullable=True)


# ─────────────────────────────────────────────────────────────
# 18. PS Conversations  →  conversion_ps_conversations
#     Production Support chat session headers
# ─────────────────────────────────────────────────────────────
from sqlalchemy.orm import relationship  # noqa: E402 (already imported above in practice)

class PsConversation(Base):
    __tablename__ = "conversion_ps_conversations"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    title      = Column(String(500), nullable=True)
    conn_id    = Column(Integer, nullable=True)
    provider   = Column(String(50),  default="openai")      # openai | anthropic
    model      = Column(String(100), default="gpt-4o-mini")
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at = Column(DateTime, default=datetime.utcnow,
                        onupdate=datetime.utcnow, server_default=func.now())
    messages   = relationship("PsMessage", back_populates="conversation",
                              cascade="all, delete-orphan")


# ─────────────────────────────────────────────────────────────
# 19. PS Messages  →  conversion_ps_messages
#     Individual chat turns including tool call records
# ─────────────────────────────────────────────────────────────
class PsMessage(Base):
    __tablename__ = "conversion_ps_messages"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id  = Column(Integer, ForeignKey("conversion_ps_conversations.id"), nullable=False, index=True)
    role             = Column(String(20),  nullable=False)   # user | assistant | tool
    content          = Column(Text,        nullable=True)
    tool_name        = Column(String(100), nullable=True)
    tool_input_json  = Column(Text,        nullable=True)    # truncated at 50k chars
    tool_output_json = Column(Text,        nullable=True)    # truncated at 50k chars
    created_at       = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    conversation     = relationship("PsConversation", back_populates="messages")


# ─────────────────────────────────────────────────────────────
# 20. PS API Collection  →  conversion_ps_api_collection
#     Predefined REST endpoints the PS agent can call
# ─────────────────────────────────────────────────────────────
class PsApiCollection(Base):
    __tablename__ = "conversion_ps_api_collection"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    name           = Column(String(255), nullable=False)
    description    = Column(String(1000), nullable=True)
    url            = Column(String(2000), nullable=False)
    method         = Column(String(10),   default="POST")    # GET|POST|PUT|DELETE
    headers_json   = Column(Text,         nullable=True)     # JSON dict of headers
    body_template   = Column(Text,         nullable=True)     # {{field}} placeholders
    required_fields = Column(Text,        nullable=True)     # JSON array e.g. ["emp_id","deptno"]
    auth_type      = Column(String(20),   default="none")    # none|bearer|basic
    auth_value_enc = Column(Text,         nullable=True)     # Fernet-encrypted token
    conn_id        = Column(Integer,      nullable=True)     # optional: restrict to a connection
    is_active      = Column(Boolean,      default=True)
    created_at     = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# 22. PS Workflows  →  conversion_ps_workflows
# ─────────────────────────────────────────────────────────────
class PsWorkflow(Base):
    __tablename__ = "conversion_ps_workflows"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    name            = Column(String(255), nullable=False)
    description     = Column(String(1000), nullable=True)
    conn_id         = Column(Integer, nullable=True)
    conversation_id = Column(Integer, ForeignKey("conversion_ps_conversations.id"), nullable=True)
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())
    steps     = relationship("PsWorkflowStep",    back_populates="workflow", cascade="all, delete-orphan", order_by="PsWorkflowStep.step_order")
    schedules = relationship("PsWorkflowSchedule",back_populates="workflow", cascade="all, delete-orphan")
    runs      = relationship("PsWorkflowRun",     back_populates="workflow", cascade="all, delete-orphan")


class PsWorkflowStep(Base):
    __tablename__ = "conversion_ps_workflow_steps"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    workflow_id = Column(Integer, ForeignKey("conversion_ps_workflows.id"))
    step_order  = Column(Integer, default=0)
    step_type   = Column(String(50))   # sql | api | email
    label       = Column(String(255), nullable=True)
    config_json = Column(Text, nullable=True)   # JSON: {sql,conn_id} | {api_id,payload} | {to,subject,body}
    created_at  = Column(DateTime, server_default=func.now())
    workflow    = relationship("PsWorkflow", back_populates="steps")


class PsWorkflowSchedule(Base):
    __tablename__ = "conversion_ps_workflow_schedules"
    id               = Column(Integer, primary_key=True, autoincrement=True)
    workflow_id      = Column(Integer, ForeignKey("conversion_ps_workflows.id"))
    schedule_type    = Column(String(20), default="manual")  # manual | interval | daily | weekly
    interval_minutes = Column(Integer, nullable=True)
    run_at_time      = Column(String(10), nullable=True)    # HH:MM
    run_on_day       = Column(Integer, nullable=True)       # 0=Mon..6=Sun
    is_enabled       = Column(Boolean, default=True)
    next_run_at      = Column(DateTime, nullable=True)
    last_run_at      = Column(DateTime, nullable=True)
    created_at       = Column(DateTime, server_default=func.now())
    workflow         = relationship("PsWorkflow", back_populates="schedules")


class PsWorkflowRun(Base):
    __tablename__ = "conversion_ps_workflow_runs"
    id           = Column(Integer, primary_key=True, autoincrement=True)
    workflow_id  = Column(Integer, ForeignKey("conversion_ps_workflows.id"))
    triggered_by = Column(String(20), default="manual")   # manual | schedule
    status       = Column(String(20), default="running")  # running | success | failed | partial
    started_at   = Column(DateTime, server_default=func.now())
    finished_at  = Column(DateTime, nullable=True)
    summary_json = Column(Text, nullable=True)
    workflow     = relationship("PsWorkflow", back_populates="runs")
    step_runs    = relationship("PsWorkflowRunStep", back_populates="run", cascade="all, delete-orphan", order_by="PsWorkflowRunStep.step_order")


class PsWorkflowRunStep(Base):
    __tablename__ = "conversion_ps_workflow_run_steps"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    run_id        = Column(Integer, ForeignKey("conversion_ps_workflow_runs.id"))
    step_id       = Column(Integer, ForeignKey("conversion_ps_workflow_steps.id"), nullable=True)
    step_order    = Column(Integer, default=0)
    step_type     = Column(String(50))
    label         = Column(String(255), nullable=True)
    status        = Column(String(20), default="pending")  # pending | running | success | failed | skipped
    output_json   = Column(Text, nullable=True)
    error_message = Column(String(2000), nullable=True)
    executed_at   = Column(DateTime, nullable=True)
    run           = relationship("PsWorkflowRun", back_populates="step_runs")


# ─────────────────────────────────────────────────────────────
# 24. Dashboard Configs — conversion_dashboard_configs
#     AI-generated dynamic dashboard configurations
# ─────────────────────────────────────────────────────────────
class DashboardConfig(Base):
    __tablename__ = "conversion_dashboard_configs"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    project_id  = Column(Integer, ForeignKey("conversion_projects.id"), nullable=True)
    conn_id     = Column(Integer, ForeignKey("conversion_source_connections.id"), nullable=True)
    name        = Column(String(200), nullable=False)
    description = Column(String(500), nullable=True)
    config_json = Column(Text, nullable=False)   # JSON string of dashboard widget config
    debug_json  = Column(Text, nullable=True)    # JSON string of AI debug metadata
    created_at  = Column(DateTime, default=datetime.utcnow, server_default=func.now())


class PsEmailSettings(Base):
    __tablename__ = "conversion_ps_email_settings"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    smtp_host     = Column(String(255), nullable=False)
    smtp_port     = Column(Integer, default=587)
    smtp_user     = Column(String(255), nullable=True)
    smtp_pass_enc = Column(Text, nullable=True)    # Fernet-encrypted
    from_address  = Column(String(255), nullable=False)
    use_tls       = Column(Boolean, default=True)
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime, server_default=func.now())
