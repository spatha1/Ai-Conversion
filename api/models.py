# ═══════════════════════════════════════════════════════════
# models.py — SQLAlchemy ORM models
# All tables live in the ConversionAgent SQL Server database.
# Table prefix: conversion_
# ═══════════════════════════════════════════════════════════
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, Float,
    ForeignKey, func, UniqueConstraint
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
    content     = Column(Text, nullable=True)   # raw template content (XML, JSON, text, SQL)
    format_type = Column(String(20), nullable=True, default="xml")  # "xml"|"json"|"text"|"sql"
    created_at  = Column(DateTime, default=datetime.utcnow, server_default=func.now())
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
    each_sheet           = Column(String(100), nullable=True)  # inherited each= scope
    sort_order           = Column(Integer,     default=0)
    confidence           = Column(Integer,     nullable=True)  # 0-100; null = manual
    transform_expression = Column(Text,        nullable=True)  # Python expr; value = raw col value
    transform_sql        = Column(Text,        nullable=True)  # SQL expr (display/audit only)

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

    id               = Column(Integer, primary_key=True, autoincrement=True)
    conn_id          = Column(Integer, nullable=False, index=True)
    table_name       = Column(String(255), nullable=False)
    column_name      = Column(String(255), nullable=True)    # NULL = table-level
    aliases          = Column(Text, nullable=True)            # comma-separated: "Policy,Premium"
    description      = Column(Text, nullable=True)            # free-text
    business_context = Column(Text, nullable=True)            # table-level business context
    synonyms         = Column(Text, nullable=True)            # JSON array string e.g. '["id","identifier"]'
    updated_at       = Column(DateTime, server_default=func.now())


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
# Agent Pending Approvals  →  conversion_pending_approvals
# Durable HITL gate storage — survives server restarts.
# ─────────────────────────────────────────────────────────────
class AgentPendingApproval(Base):
    __tablename__ = "conversion_pending_approvals"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    session_id    = Column(String(36),  nullable=False, index=True)
    conv_id       = Column(Integer,     nullable=True,  index=True)
    tool_name     = Column(String(50),  nullable=False)
    tool_call_id  = Column(String(100), nullable=False)
    tool_args     = Column(Text,        nullable=False)
    msg_snapshot  = Column(Text,        nullable=True)   # full message list at gate point
    status        = Column(String(10),  nullable=False, default="pending")
    # pending | approved | rejected | expired
    approved_by   = Column(String(100), nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    expires_at    = Column(DateTime, nullable=False)


# ─────────────────────────────────────────────────────────────
# Tool Execution Audit Log  →  conversion_tool_executions
# Immutable record of every tool call dispatched by the agent.
# ─────────────────────────────────────────────────────────────
class ToolExecution(Base):
    __tablename__ = "conversion_tool_executions"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    session_id     = Column(String(36),  nullable=False, index=True)
    conv_id        = Column(Integer,     nullable=True,  index=True)
    conn_id        = Column(Integer,     nullable=True)
    tool_name      = Column(String(50),  nullable=False)
    tool_args      = Column(Text,        nullable=True)   # JSON (PII-safe, truncated)
    result_summary = Column(Text,        nullable=True)   # JSON: row_count, error
    status         = Column(String(10),  nullable=False)  # success | error | rejected
    execution_ms   = Column(Integer,     nullable=True)
    iteration      = Column(Integer,     nullable=False, default=0)
    approved_by    = Column(String(100), nullable=True)   # null = auto
    created_at     = Column(DateTime, default=datetime.utcnow, server_default=func.now())


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


# ─────────────────────────────────────────────────────────────
# Schema Enrichment Sessions  →  conversion_enrich_sessions
# ─────────────────────────────────────────────────────────────
class EnrichSession(Base):
    __tablename__ = "conversion_enrich_sessions"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    conn_id     = Column(Integer, ForeignKey("conversion_source_connections.id"), nullable=False)
    title       = Column(String(500), nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, server_default=func.now())


class EnrichMessage(Base):
    __tablename__ = "conversion_enrich_messages"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("conversion_enrich_sessions.id"), nullable=False)
    role       = Column(String(20), nullable=False)   # "user" | "assistant"
    content    = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now())


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


# ─────────────────────────────────────────────────────────────
# API Dispatch Config  →  conversion_api_dispatch_configs
#  One row per connection — stores how to send XMLs to the target API
# ─────────────────────────────────────────────────────────────
class ApiDispatchConfig(Base):
    __tablename__ = "conversion_api_dispatch_configs"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    conn_id          = Column(Integer, nullable=False, index=True, unique=True)
    dispatch_type    = Column(String(20),   nullable=True,  default="api")    # api|sftp|azure_blob
    # ── API fields ───────────────────────────────────────────
    endpoint_url     = Column(String(2000), nullable=True)
    method           = Column(String(10),   nullable=False, default="POST")
    content_type     = Column(String(100),  nullable=True,  default="application/xml")
    auth_type        = Column(String(20),   nullable=True,  default="none")   # none|bearer|apikey|basic|oauth2
    auth_value_enc   = Column(Text,         nullable=True)   # Fernet-encrypted token/password
    auth_header_name = Column(String(200),  nullable=True)   # used for auth_type=apikey
    extra_headers    = Column(Text,         nullable=True)   # JSON string
    # ── SFTP fields ──────────────────────────────────────────
    sftp_host        = Column(String(500),  nullable=True)
    sftp_port        = Column(Integer,      nullable=True,  default=22)
    sftp_username    = Column(String(200),  nullable=True)
    sftp_password_enc= Column(Text,         nullable=True)   # Fernet-encrypted
    sftp_remote_path = Column(String(2000), nullable=True)   # e.g. /uploads/converted/
    # ── Azure Blob fields ────────────────────────────────────
    azure_conn_str_enc = Column(Text,       nullable=True)   # Fernet-encrypted connection string
    azure_container    = Column(String(500),nullable=True)
    azure_blob_prefix  = Column(String(1000),nullable=True)  # e.g. output/2024/
    updated_at       = Column(DateTime, default=datetime.utcnow,
                              onupdate=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# API Dispatch Logs  →  conversion_api_dispatch_logs
#  One row per XML send attempt (including retries)
# ─────────────────────────────────────────────────────────────
class ApiDispatchLog(Base):
    __tablename__ = "conversion_api_dispatch_logs"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    conn_id          = Column(Integer, nullable=False, index=True)
    xml_id           = Column(Integer, nullable=True,  index=True)
    identifier_value = Column(String(500), nullable=True)
    status           = Column(String(20),  nullable=False, default="pending")  # pending|running|success|fail
    request_body     = Column(Text, nullable=True)
    response_status  = Column(Integer, nullable=True)
    response_body    = Column(Text,    nullable=True)
    response_time_ms = Column(Integer, nullable=True)
    retry_count      = Column(Integer, nullable=False, default=0)
    error_message    = Column(Text, nullable=True)
    sent_at          = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# Pipeline Schedule  →  conversion_pipeline_schedules
#  One row per connection — controls how/when the full pipeline runs
# ─────────────────────────────────────────────────────────────
class PipelineSchedule(Base):
    __tablename__ = "conversion_pipeline_schedules"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    conn_id          = Column(Integer, nullable=False, unique=True, index=True)
    schedule_type    = Column(String(20), nullable=False, default="manual")
    # "manual" | "interval" | "daily" | "weekly"
    interval_minutes = Column(Integer, nullable=True)
    run_at_time      = Column(String(10), nullable=True)   # "HH:MM"
    run_on_day       = Column(Integer, nullable=True)      # 0=Mon … 6=Sun
    is_enabled       = Column(Boolean, nullable=False, default=True)
    skip_mapping     = Column(Boolean, nullable=False, default=False)
    next_run_at      = Column(DateTime, nullable=True)
    last_run_at      = Column(DateTime, nullable=True)
    last_run_status  = Column(String(20), nullable=True)   # success|fail|partial
    created_at       = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at       = Column(DateTime, default=datetime.utcnow,
                              onupdate=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# Pipeline Run  →  conversion_pipeline_runs
#  History of every pipeline execution
# ─────────────────────────────────────────────────────────────
class PipelineRun(Base):
    __tablename__ = "conversion_pipeline_runs"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    conn_id      = Column(Integer, nullable=False, index=True)
    triggered_by = Column(String(20), nullable=False, default="manual")  # manual|schedule
    status       = Column(String(20), nullable=False, default="running")  # running|success|fail|partial
    steps_json   = Column(Text, nullable=True)   # JSON list of step result dicts
    started_at   = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    finished_at  = Column(DateTime, nullable=True)


# ─────────────────────────────────────────────────────────────
# AI Trace Log  →  conversion_ai_trace_log
#  Every LLM call across all modules — powers the AI debug panel
# ─────────────────────────────────────────────────────────────
class AITraceLog(Base):
    __tablename__ = "conversion_ai_trace_log"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    module             = Column(String(50),  nullable=False, index=True)  # development|mapping|report|ps|dashboard|admin
    conn_id            = Column(Integer,     nullable=True,  index=True)
    model              = Column(String(100), nullable=False)
    prompt_text        = Column(Text,        nullable=True)
    response_text      = Column(Text,        nullable=True)
    tokens_in          = Column(Integer,     nullable=True)
    tokens_out         = Column(Integer,     nullable=True)
    latency_ms         = Column(Integer,     nullable=True)
    sql_executed       = Column(Text,        nullable=True)
    row_count_returned = Column(Integer,     nullable=True)
    schema_snapshot    = Column(Text,        nullable=True)   # JSON list of "table.col"
    export_action      = Column(String(50),  nullable=True)   # "ppt" | None
    sai_run_id         = Column(Integer,     nullable=True,  index=True)  # FK to conversion_sai_runs
    created_at         = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<AITraceLog id={self.id} module={self.module!r} model={self.model!r}>"


# ─────────────────────────────────────────────────────────────
# Debug Settings  →  conversion_debug_settings
#  Per-module toggle (OFF/BASIC/ADVANCED) for inline step tracing.
#  Admin-only write; all authenticated users can read.
# ─────────────────────────────────────────────────────────────
class DebugSetting(Base):
    __tablename__ = "conversion_debug_settings"

    module      = Column(String(50), primary_key=True)   # "development"|"mapping"|"report"|"reconciliation"|"multi_compare"
    debug_level = Column(String(20), nullable=False, default="OFF", server_default="'OFF'")
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<DebugSetting module={self.module!r} level={self.debug_level!r}>"


# ─────────────────────────────────────────────────────────────
# Debug Traces  →  conversion_debug_traces
#  Persisted debug step payloads (ADVANCED level only).
#  Supports post-failure audit and replay.
# ─────────────────────────────────────────────────────────────
class DebugTrace(Base):
    __tablename__ = "conversion_debug_traces"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    trace_id    = Column(String(36), nullable=False, index=True)   # UUID v4
    module      = Column(String(50), nullable=False, index=True)
    conn_id     = Column(Integer, nullable=True)
    debug_level = Column(String(20), nullable=False)
    steps_json  = Column(Text, nullable=True)    # JSON array of step dicts
    created_at  = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<DebugTrace id={self.id} module={self.module!r} trace={self.trace_id!r}>"


# ─────────────────────────────────────────────────────────────
# Dev Artifacts  →  conversion_dev_artifacts
#  AI-generated data engineering plans + SQL artifacts
# ─────────────────────────────────────────────────────────────
class DevArtifact(Base):
    __tablename__ = "conversion_dev_artifacts"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    conn_id          = Column(Integer, ForeignKey("conversion_source_connections.id"), nullable=True, index=True)
    project_id       = Column(Integer, nullable=True)
    task_description = Column(Text,        nullable=False)
    plan_json        = Column(Text,        nullable=True)   # JSON: list[PlanStep]
    artifacts_json   = Column(Text,        nullable=True)   # JSON: list[DevArtifactItem]
    pipeline_config  = Column(Text,        nullable=True)   # JSON: dependency adjacency list
    status           = Column(String(20),  default="draft") # draft|running|complete|error
    created_at       = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at       = Column(DateTime, default=datetime.utcnow,
                              onupdate=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<DevArtifact id={self.id} conn={self.conn_id} status={self.status!r}>"


# ─────────────────────────────────────────────────────────────
# Prompt Templates  →  conversion_prompt_templates
#  Admin-managed prompt overrides that drive all AI modules
# ─────────────────────────────────────────────────────────────
class PromptTemplate(Base):
    __tablename__ = "conversion_prompt_templates"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(String(200), nullable=False, unique=True)
    description = Column(String(500), nullable=True)
    category    = Column(String(100), nullable=True)  # mapping|report|dev|admin|dashboard|ps
    content         = Column(Text,    nullable=False)
    example_output  = Column(Text,    nullable=True)   # reference/expected AI output (for admin reference)
    is_active   = Column(Boolean,     default=True)
    created_at  = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at  = Column(DateTime, default=datetime.utcnow,
                         onupdate=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<PromptTemplate id={self.id} name={self.name!r} category={self.category!r}>"


class ExternalIntegration(Base):
    """Stores JIRA / Azure DevOps connection config — one row per (type, project)."""
    __tablename__ = "conversion_external_integrations"
    __table_args__ = (
        UniqueConstraint("type", "project_id", name="uq_integration_type_project"),
    )

    id           = Column(Integer, primary_key=True, autoincrement=True)
    type         = Column(String(20),  nullable=False)                 # 'jira' | 'ado'
    project_id   = Column(Integer, ForeignKey("conversion_projects.id"), nullable=True, index=True)
    base_url     = Column(String(500), nullable=False)
    username     = Column(String(200), nullable=True)   # JIRA: email; ADO: leave blank
    token_enc    = Column(Text,        nullable=True)   # Fernet-encrypted token/PAT
    is_active    = Column(Boolean,     default=True)
    created_at   = Column(DateTime,    default=datetime.utcnow, server_default=func.now())
    updated_at   = Column(DateTime,    default=datetime.utcnow,
                          onupdate=datetime.utcnow, server_default=func.now())


# ── AI Agents ──────────────────────────────────────────────────────────────────

class AIAgent(Base):
    """Autonomous AI agent — stores goal + metadata only, no fixed SQL steps."""
    __tablename__ = "conversion_ai_agents"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(String(200), nullable=False)
    description = Column(String(1000), nullable=True)
    goal        = Column(Text, nullable=False)          # natural-language objective
    conn_id     = Column(Integer, nullable=True)        # data source to run against
    schedule    = Column(String(100), nullable=True)    # cron expression or 'manual'
    status      = Column(String(20),  nullable=False, default="active")  # active|paused|inactive
    # Agentic organisation fields
    role_id     = Column(Integer, nullable=True)        # assigned Role Card (position)
    category    = Column(String(100), nullable=True)    # department e.g. Engineering, PMO
    tools_json  = Column(Text, nullable=True)           # JSON array of granted tools
    created_at  = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at  = Column(DateTime, default=datetime.utcnow,
                         onupdate=datetime.utcnow, server_default=func.now())
    last_run_at = Column(DateTime, nullable=True)

    logs = relationship("AIAgentLog", back_populates="agent",
                        cascade="all, delete-orphan",
                        order_by="AIAgentLog.id.desc()")

    def __repr__(self):
        return f"<AIAgent id={self.id} name={self.name!r} status={self.status!r}>"


class AIAgentLog(Base):
    """Execution log for one agent run."""
    __tablename__ = "conversion_ai_agent_logs"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    agent_id       = Column(Integer, ForeignKey("conversion_ai_agents.id"), nullable=False)
    status         = Column(String(20), nullable=False, default="running")  # running|success|failed|partial
    generated_plan = Column(Text, nullable=True)    # JSON — steps AI decided to execute
    steps_executed = Column(Integer, nullable=True, default=0)
    result_summary = Column(Text, nullable=True)
    error          = Column(String(2000), nullable=True)
    execution_time = Column(Integer, nullable=True)  # milliseconds
    created_at     = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    finished_at    = Column(DateTime, nullable=True)

    agent = relationship("AIAgent", back_populates="logs")


# ─────────────────────────────────────────────────────────────
# AI Test Cases  →  conversion_ai_test_cases
#  Reusable test definitions for data reconciliation
# ─────────────────────────────────────────────────────────────
class AITestCase(Base):
    __tablename__ = "conversion_ai_test_cases"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    group_name          = Column(String(200), nullable=True)
    name                = Column(String(200), nullable=False)
    source_conn_id      = Column(Integer, nullable=True)
    target_conn_id      = Column(Integer, nullable=True)
    source_query        = Column(Text, nullable=False)
    target_query        = Column(Text, nullable=False)
    validation_type     = Column(String(50), nullable=False, default="count")
    # count|sum|null_check|duplicate|custom|row_level|column_level
    threshold           = Column(String(100), nullable=True)
    schedule_cron       = Column(String(100), nullable=True)
    identifier_column   = Column(String(500), nullable=True)   # join key(s) for row_level — comma-separated
    reconciliation_type = Column(String(50),  nullable=True, default="aggregate")
    columns_to_compare  = Column(String(2000), nullable=True)  # which columns to diff — comma-separated, blank = all
    # aggregate | row_level
    created_at          = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    results = relationship("AITestResult", back_populates="test_case",
                           cascade="all, delete-orphan",
                           order_by="AITestResult.id.desc()")


# ─────────────────────────────────────────────────────────────
# AI Test Results  →  conversion_ai_test_results
#  Execution log for each test case run
# ─────────────────────────────────────────────────────────────
class AITestResult(Base):
    __tablename__ = "conversion_ai_test_results"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    test_case_id         = Column(Integer, ForeignKey("conversion_ai_test_cases.id"), nullable=False, index=True)
    execution_time       = Column(Integer, nullable=True)
    result               = Column(String(10), nullable=False, default="pending")  # pass|fail|error
    source_value         = Column(String(500), nullable=True)
    target_value         = Column(String(500), nullable=True)
    difference           = Column(String(500), nullable=True)
    remarks              = Column(Text, nullable=True)
    # Row-level reconciliation extras
    mismatch_count        = Column(Integer, nullable=True)   # rows with value differences
    missing_source_count  = Column(Integer, nullable=True)   # in target but not source
    missing_target_count  = Column(Integer, nullable=True)   # in source but not target
    sample_mismatches     = Column(Text,    nullable=True)   # JSON: [{key, differences:{col:{source,target}}}]
    sample_missing_source = Column(Text,    nullable=True)   # JSON: [key, key, ...] rows in target not in source
    sample_missing_target = Column(Text,    nullable=True)   # JSON: [key, key, ...] rows in source not in target
    ran_at                = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    test_case = relationship("AITestCase", back_populates="results")

    def __repr__(self):
        return f"<AIAgentLog id={self.id} agent_id={self.agent_id} status={self.status!r}>"


# ─────────────────────────────────────────────────────────────
# FeedbackEntry  →  conversion_feedback
#  User-submitted feedback by module/area/type, reviewed by admins
# ─────────────────────────────────────────────────────────────
class FeedbackEntry(Base):
    __tablename__ = "conversion_feedback"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    submitted_by = Column(String(100), nullable=True)   # username from auth
    module       = Column(String(100), nullable=True)   # Conversion|Reporting|PS Support|Development|Admin|Testing|Dashboards|AI Agents|General
    area         = Column(String(200), nullable=True)   # free-text sub-area
    type         = Column(String(50),  nullable=False)  # bug|feature|improvement|question|praise
    priority     = Column(String(20),  nullable=True)   # low|medium|high
    title        = Column(String(500), nullable=False)
    description  = Column(Text,        nullable=True)
    page_url     = Column(String(500), nullable=True)   # auto-captured from browser
    status       = Column(String(30),  nullable=False, default="open")  # open|in_progress|resolved|closed
    admin_notes  = Column(Text,        nullable=True)   # reviewer notes
    created_at   = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# AgentRole  →  conversion_agent_roles
#  Describes behaviour / persona for an agent (like a job role card)
# ─────────────────────────────────────────────────────────────
class AgentRole(Base):
    __tablename__ = "conversion_agent_roles"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    role_name          = Column(String(200), nullable=False)
    description        = Column(String(1000), nullable=True)
    responsibilities   = Column(Text, nullable=True)
    skills             = Column(Text, nullable=True)
    input_expectation  = Column(Text, nullable=True)
    output_expectation = Column(Text, nullable=True)
    decision_logic     = Column(Text, nullable=True)
    deliverables       = Column(Text, nullable=True)
    tone               = Column(String(200), nullable=True)
    is_active          = Column(Boolean, default=True, nullable=False)
    created_at         = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at         = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<AgentRole id={self.id} role_name={self.role_name!r}>"


# ─────────────────────────────────────────────────────────────
# AgentCard  →  conversion_agent_cards
#  A workflow step card that links a role + optional agent
# ─────────────────────────────────────────────────────────────
class AgentCard(Base):
    __tablename__ = "conversion_agent_cards"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    name                = Column(String(200), nullable=False)
    description         = Column(String(1000), nullable=True)
    role_id             = Column(Integer, nullable=True)
    agent_id            = Column(Integer, nullable=True)   # named person assigned to this step
    execution_order     = Column(Integer, nullable=False, default=0)
    input_mapping       = Column(Text, nullable=True)
    output_mapping      = Column(Text, nullable=True)
    is_mandatory        = Column(Boolean, default=True, nullable=False)
    is_active           = Column(Boolean, default=True, nullable=False)
    # Loop-back routing — if output is REJECT, re-run from this card
    on_reject_card_id   = Column(Integer, nullable=True)   # FK to another AgentCard.id
    max_iterations      = Column(Integer, nullable=False, default=3)
    created_at          = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<AgentCard id={self.id} name={self.name!r} order={self.execution_order}>"


# ─────────────────────────────────────────────────────────────
# WorkflowExecution  →  conversion_workflow_executions
#  One full A2A pipeline run
# ─────────────────────────────────────────────────────────────
class WorkflowExecution(Base):
    __tablename__ = "conversion_workflow_executions"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    conn_id         = Column(Integer, nullable=True)
    user_query      = Column(Text, nullable=False)
    model           = Column(String(100), nullable=False, default="gpt-4o-mini")
    status          = Column(String(30), nullable=False, default="running")
    # status values: running | pending_approval | approved | rejected | success | partial | failed | escalated
    total_steps     = Column(Integer, nullable=False, default=0)
    completed_steps = Column(Integer, nullable=False, default=0)
    final_summary   = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    finished_at     = Column(DateTime, nullable=True)
    # Human-in-the-Loop gate
    hitl_required        = Column(Boolean, default=True, nullable=False)   # always True for now
    human_approved_at    = Column(DateTime, nullable=True)
    human_approved_by    = Column(String(200), nullable=True)
    human_rejection_reason = Column(Text, nullable=True)
    # Phase 2: project-level approval integration
    project_id      = Column(Integer, nullable=True)
    paused_card_id  = Column(Integer, nullable=True)

    steps = relationship("WorkflowExecutionStep", back_populates="execution",
                         cascade="all, delete-orphan",
                         order_by="WorkflowExecutionStep.step_number")

    def __repr__(self):
        return f"<WorkflowExecution id={self.id} status={self.status!r}>"


# ─────────────────────────────────────────────────────────────
# WorkflowExecutionStep  →  conversion_workflow_execution_steps
#  One card's execution within a WorkflowExecution
# ─────────────────────────────────────────────────────────────
class WorkflowExecutionStep(Base):
    __tablename__ = "conversion_workflow_execution_steps"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    execution_id     = Column(Integer, ForeignKey("conversion_workflow_executions.id"), nullable=False, index=True)
    step_number      = Column(Integer, nullable=False)
    card_id          = Column(Integer, nullable=True)      # which card was run
    card_name        = Column(String(200), nullable=True)
    role_name        = Column(String(200), nullable=True)
    agent_name       = Column(String(200), nullable=True)  # named person (Sai, Chand)
    iteration        = Column(Integer, nullable=False, default=1)  # loop counter per card
    decision         = Column(String(20), nullable=True)   # APPROVE | REJECT | REVISE | None
    decision_notes   = Column(Text, nullable=True)         # manager/TL feedback text
    input_text       = Column(Text, nullable=True)
    output_text      = Column(Text, nullable=True)
    prompt_used      = Column(Text, nullable=True)
    status           = Column(String(30), nullable=False, default="pending")  # pending|running|success|failed|escalated
    execution_time_ms = Column(Integer, nullable=True)
    approval_request_id = Column(Integer, nullable=True)  # FK to ApprovalRequest if this step required human approval
    created_at       = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    execution = relationship("WorkflowExecution", back_populates="steps")

    def __repr__(self):
        return f"<WorkflowExecutionStep id={self.id} step={self.step_number} status={self.status!r}>"


# ── Saved Agentic Workflows ────────────────────────────────────────────────────
class SavedAgenticWorkflow(Base):
    __tablename__ = "conversion_saved_agentic_workflows"

    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String(200), nullable=False)
    description      = Column(String(1000), nullable=True)
    user_query       = Column(Text, nullable=False)
    conn_id          = Column(Integer, nullable=True)
    model            = Column(String(100), nullable=False, default="gpt-4o-mini")
    schedule_label   = Column(String(50), nullable=True)   # "none" | "daily" | "weekly" | "monthly"
    last_run_at      = Column(DateTime, nullable=True)
    last_execution_id= Column(Integer, nullable=True)
    is_active        = Column(Boolean, nullable=False, default=True)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────────────────────────────────────────
# Agent-Based Conversion Pipeline — new tables
# ─────────────────────────────────────────────────────────────

class ConversionColumnProfile(Base):
    """Per-column statistical profile for the agent-based conversion pipeline."""
    __tablename__ = "conversion_column_profile"
    __table_args__ = (
        UniqueConstraint("conn_id", "table_name", "column_name",
                         name="uq_col_profile_conn_table_col"),
    )

    id            = Column(Integer, primary_key=True, autoincrement=True)
    conn_id       = Column(Integer, nullable=False, index=True)
    table_name    = Column(String(255), nullable=False)
    column_name   = Column(String(255), nullable=False)
    null_pct      = Column(String(20), nullable=True)   # stored as string e.g. "12.5"
    distinct_count= Column(Integer, nullable=True)
    total_count   = Column(Integer, nullable=True)
    min_val       = Column(String(500), nullable=True)
    max_val       = Column(String(500), nullable=True)
    # email|date|phone|uuid|numeric|free_text|categorical|unknown
    pattern_hint  = Column(String(100), nullable=True)
    profiled_at   = Column(DateTime, default=datetime.utcnow, server_default=func.now())


class ConversionQueryVersion(Base):
    """Versioned SQL + mapping snapshots produced by the Mapper agent."""
    __tablename__ = "conversion_query_versions"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    conn_id          = Column(Integer, nullable=False, index=True)
    version          = Column(Integer, nullable=False, default=1)
    sql_text         = Column(Text, nullable=False)
    mapping_snapshot = Column(Text, nullable=True)   # JSON array of row dicts
    agent_run_id     = Column(Integer, nullable=True) # FK to conversion_agent_run_logs.id (no FK constraint)
    created_at       = Column(DateTime, default=datetime.utcnow, server_default=func.now())


class ConversionAgentRunLog(Base):
    """Audit log for each agent invocation in the conversion pipeline."""
    __tablename__ = "conversion_agent_run_logs"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    conn_id        = Column(Integer, nullable=False, index=True)
    agent_name     = Column(String(100), nullable=False)  # manager|mapper|validator|transformer
    attempt        = Column(Integer, nullable=False, default=1)
    status         = Column(String(20), nullable=False, default="running")  # running|success|failed
    input_summary  = Column(Text, nullable=True)
    output_summary = Column(Text, nullable=True)
    duration_ms    = Column(Integer, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow, server_default=func.now())


class ConversionValidationResult(Base):
    """Individual validation check result written by the Validator agent."""
    __tablename__ = "conversion_validation_results"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    conn_id    = Column(Integer, nullable=False, index=True)
    xml_id     = Column(Integer, nullable=True)   # FK to conversion_generated_xml.id (nullable)
    check_name = Column(String(200), nullable=False)
    passed     = Column(Boolean, nullable=False, default=True)
    detail     = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now())


class ConversionValueMapping(Base):
    """Legacy source value → target dropdown value mapping with governance."""
    __tablename__ = "conversion_value_mappings"
    __table_args__ = (
        UniqueConstraint("conn_id", "table_name", "column_name", "source_value",
                         name="uq_value_mapping_key"),
    )

    id           = Column(Integer, primary_key=True, autoincrement=True)
    conn_id      = Column(Integer, nullable=False, index=True)
    table_name   = Column(String(255), nullable=False)
    column_name  = Column(String(255), nullable=False)
    source_value = Column(String(500), nullable=False)
    target_value = Column(String(500), nullable=True)
    confidence   = Column(String(20), nullable=True)   # stored as string e.g. "0.95"
    # manual | ai | rule | pending_review
    mapping_type = Column(String(30), nullable=False, default="manual")
    # pending | approved | rejected
    status       = Column(String(20), nullable=False, default="pending")
    expires_at   = Column(DateTime, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow, server_default=func.now())


class ConversionBusinessRule(Base):
    """Business rule definitions for the TransformerAgent (Phase 2). Pre-created empty."""
    __tablename__ = "conversion_business_rules"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    conn_id              = Column(Integer, nullable=True, index=True)  # NULL = global
    rule_name            = Column(String(255), nullable=False)
    priority             = Column(Integer, nullable=False, default=0)
    condition_json       = Column(Text, nullable=True)       # JSON: condition expression
    transformation_json  = Column(Text, nullable=True)       # JSON: transformation spec
    is_active            = Column(Boolean, nullable=False, default=True)
    created_at           = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# Dev vs Base Reconciliation Engine
# ─────────────────────────────────────────────────────────────

class TestQuery(Base):
    """Q2 (BASE) — auto-generated or manually-added baseline queries per connection."""
    __tablename__ = "conversion_test_queries"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    conn_id           = Column(Integer, nullable=False, index=True)
    query_type        = Column(String(30), nullable=False)
    # count | agg | distribution | set_diff | duplicate | join_explosion | filter_impact | sample_value | custom
    name              = Column(String(255), nullable=False)
    sql_text          = Column(Text, nullable=False)
    table_name        = Column(String(255), nullable=True)
    column_name       = Column(String(255), nullable=True)
    priority          = Column(Integer, nullable=False, default=0)   # 0=normal, 1=critical
    severity          = Column(String(10), nullable=False, default="error")  # error | warning
    is_auto_generated = Column(Boolean, nullable=False, default=True)
    dev_source_tag    = Column(String(200), nullable=True)  # NULL=global; comma-separated: "mapper,dashboard" or single "mapper"
    created_at        = Column(DateTime, default=datetime.utcnow, server_default=func.now())


class ReconciliationResult(Base):
    """One row per Q2 (BASE) test per reconciliation run — DEV vs BASE comparison."""
    __tablename__ = "conversion_reconciliation_results"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    conn_id           = Column(Integer, nullable=False, index=True)
    run_id            = Column(String(36), nullable=False, index=True)  # UUID
    dev_source_type   = Column(String(30), nullable=True)   # mapper|dashboard|report|ps_workflow|dev_artifact|adhoc
    dev_source_id     = Column(Integer, nullable=True)
    test_query_id     = Column(Integer, nullable=True)       # FK → conversion_test_queries.id (no FK constraint)
    test_name         = Column(String(255), nullable=False)
    query_type        = Column(String(30), nullable=False)
    q2_base_sql       = Column(Text, nullable=True)          # original Q2 (BASE) SQL
    q1_dev_sql        = Column(Text, nullable=True)          # derived Q1 (DEV) wrapper SQL
    q1_sql_snapshot   = Column(Text, nullable=True)          # snapshot of full Q1 at run time
    status            = Column(String(10), nullable=False, default="SKIP")
    # PASS | FAIL | WARN | ERROR | SKIP
    base_result       = Column(Text, nullable=True)          # JSON — Q2 execution output
    dev_result        = Column(Text, nullable=True)          # JSON — derived Q1 execution output
    issue             = Column(Text, nullable=True)
    ai_insight        = Column(Text, nullable=True)          # structured JSON: {root_cause_category, confidence, explanation, suggestion, ai_suggested_fix}
    execution_time_ms = Column(Integer, nullable=True)
    created_at        = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# Auth — conversion_users
# ─────────────────────────────────────────────────────────────
class User(Base):
    """Application users with hashed passwords."""
    __tablename__ = "conversion_users"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    username        = Column(String(100), nullable=False, unique=True, index=True)
    email           = Column(String(255), nullable=True,  unique=True, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active       = Column(Boolean, default=True, nullable=False)
    created_at      = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    last_login      = Column(DateTime, nullable=True)

    user_roles = relationship("UserRole", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User id={self.id} username={self.username!r}>"


# ─────────────────────────────────────────────────────────────
# Auth — conversion_user_roles (junction table)
# ─────────────────────────────────────────────────────────────
class UserRole(Base):
    """Many-to-many: user ↔ roles. Valid roles: admin | developer | viewer."""
    __tablename__ = "conversion_user_roles"
    __table_args__ = (
        UniqueConstraint("user_id", "role", name="uq_user_role"),
    )

    id      = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("conversion_users.id"), nullable=False, index=True)
    role    = Column(String(50), nullable=False)   # admin | developer | viewer

    user = relationship("User", back_populates="user_roles")


# ─────────────────────────────────────────────────────────────
# AgentMapperSession  →  conversion_agent_mapper_sessions
#  Persists every DCT Manuscript generation run
# ─────────────────────────────────────────────────────────────
class AgentMapperSession(Base):
    __tablename__ = "conversion_agent_mapper_sessions"

    id            = Column(Integer,     primary_key=True, autoincrement=True)
    project_id    = Column(Integer,     nullable=True)
    user_input    = Column(Text,        nullable=False)
    parsed_intent = Column(Text,        nullable=True)   # JSON
    mapping_model = Column(Text,        nullable=True)   # JSON
    generated_xml = Column(Text,        nullable=True)
    grid_json     = Column(Text,        nullable=True)   # JSON array of grid rows
    mapping_type  = Column(String(50),  nullable=True)   # template_name
    entity        = Column(String(100), nullable=True)
    field         = Column(String(200), nullable=True)
    lob           = Column(String(50),  nullable=True)
    inherit       = Column(String(200), nullable=True)
    include_json  = Column(Text,        nullable=True)   # JSON array of strings
    created_at    = Column(DateTime,    default=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<AgentMapperSession id={self.id}>"


# ─────────────────────────────────────────────────────────────
# AgentMapperTemplate  →  conversion_agent_mapper_templates
#  Stores OOTB + custom DCT manuscript templates
# ─────────────────────────────────────────────────────────────
class AgentMapperTemplate(Base):
    __tablename__ = "conversion_agent_mapper_templates"

    id           = Column(Integer,     primary_key=True, autoincrement=True)
    name         = Column(String(200), nullable=False)
    template_key = Column(String(100), nullable=False, unique=True)
    mapping_type = Column(String(50),  nullable=True)   # risk / base / reference / etc.
    entity       = Column(String(100), nullable=True)
    lob          = Column(String(50),  nullable=True)
    template_xml = Column(Text,        nullable=False)
    notes        = Column(Text,        nullable=True)
    is_ootb      = Column(Boolean,     default=True)
    is_active    = Column(Boolean,     default=True)
    kb_entry_id  = Column(Integer,     nullable=True)   # FK to conversion_knowledge_entries
    created_at   = Column(DateTime,    default=datetime.utcnow, server_default=func.now())
    updated_at   = Column(DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<AgentMapperTemplate key={self.template_key!r}>"


# ─────────────────────────────────────────────────────────────
# Project Members  →  conversion_project_members
# ─────────────────────────────────────────────────────────────
class ProjectMember(Base):
    """Maps users to projects with a project-level role."""
    __tablename__ = "conversion_project_members"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_member"),
    )

    id           = Column(Integer, primary_key=True, autoincrement=True)
    project_id   = Column(Integer, ForeignKey("conversion_projects.id"), nullable=False, index=True)
    user_id      = Column(Integer, ForeignKey("conversion_users.id"),    nullable=False, index=True)
    project_role = Column(String(50), nullable=False)  # manager | team_lead | developer
    joined_at    = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# Approval Workflows  →  conversion_approval_workflows
# ─────────────────────────────────────────────────────────────
class ApprovalWorkflow(Base):
    """Per-project configurable approval workflow definition."""
    __tablename__ = "conversion_approval_workflows"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    project_id  = Column(Integer, ForeignKey("conversion_projects.id"), nullable=False, index=True)
    name        = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    is_active   = Column(Boolean, default=True)
    quorum_type = Column(String(20), default="any_one")   # "any_one" | "all_required"
    created_at  = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# Approval Workflow Steps  →  conversion_approval_workflow_steps
# ─────────────────────────────────────────────────────────────
class ApprovalWorkflowStep(Base):
    """Ordered steps within an approval workflow."""
    __tablename__ = "conversion_approval_workflow_steps"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    workflow_id   = Column(Integer, ForeignKey("conversion_approval_workflows.id"), nullable=False, index=True)
    step_order    = Column(Integer, nullable=False)
    step_name     = Column(String(200), nullable=False)
    required_role = Column(String(50), nullable=False)  # manager | team_lead | developer


# ─────────────────────────────────────────────────────────────
# Approval Requests  →  conversion_approval_requests
# ─────────────────────────────────────────────────────────────
class ApprovalRequest(Base):
    """A single approval run for a specific action."""
    __tablename__ = "conversion_approval_requests"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    project_id         = Column(Integer, ForeignKey("conversion_projects.id"), nullable=False, index=True)
    workflow_id        = Column(Integer, ForeignKey("conversion_approval_workflows.id"), nullable=True)
    triggered_by       = Column(Integer, ForeignKey("conversion_users.id"), nullable=False)
    context_type       = Column(String(50), nullable=False)   # agent_pipeline | agentic_workflow | xml_dispatch | report_query | report_export
    context_id         = Column(String(200), nullable=True)   # stringified job identifier
    current_step_order = Column(Integer, default=1)
    status             = Column(String(50), default="pending")  # pending | in_progress | approved | rejected | cancelled
    context_payload    = Column(Text,       nullable=True)   # JSON payload for auto-resume
    sql_hash           = Column(String(64), nullable=True)   # SHA-256 for dedup
    created_at         = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# Approval Request Decisions  →  conversion_approval_request_decisions
# ─────────────────────────────────────────────────────────────
class ApprovalRequestDecision(Base):
    """Per-step decision record for an approval request."""
    __tablename__ = "conversion_approval_request_decisions"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    request_id    = Column(Integer, ForeignKey("conversion_approval_requests.id"), nullable=False, index=True)
    step_order    = Column(Integer, nullable=False)
    step_name     = Column(String(200), nullable=False)
    required_role = Column(String(50), nullable=False)
    decided_by    = Column(Integer, ForeignKey("conversion_users.id"), nullable=True)
    decision      = Column(String(20), nullable=True)  # approve | reject
    notes         = Column(Text, nullable=True)
    decided_at    = Column(DateTime, nullable=True)


# ─────────────────────────────────────────────────────────────
# Notifications  →  conversion_notifications
# ─────────────────────────────────────────────────────────────
class Notification(Base):
    """In-app notifications for users."""
    __tablename__ = "conversion_notifications"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    user_id   = Column(Integer, ForeignKey("conversion_users.id"), nullable=False, index=True)
    type      = Column(String(50), nullable=False)   # project_assigned | approval_needed | approval_decided
    title     = Column(String(300), nullable=False)
    body      = Column(Text, nullable=True)
    is_read   = Column(Boolean, default=False)
    link_type = Column(String(50), nullable=True)
    link_id   = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# Report Sessions  →  conversion_report_sessions
# ─────────────────────────────────────────────────────────────
class ReportSession(Base):
    """Conversation session for NL→SQL follow-up queries."""
    __tablename__ = "conversion_report_sessions"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    conn_id         = Column(Integer, nullable=False, index=True)
    user_id         = Column(Integer, nullable=True)
    title           = Column(String(500), nullable=True)
    session_summary = Column(Text, nullable=True)   # compressed history after N turns
    created_at      = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at      = Column(DateTime, default=datetime.utcnow,
                             onupdate=datetime.utcnow, server_default=func.now())

    messages  = relationship("ReportSessionMessage",  back_populates="session",
                             cascade="all, delete-orphan")
    documents = relationship("ReportSessionDocument", back_populates="session",
                             cascade="all, delete-orphan")


# ─────────────────────────────────────────────────────────────
# Report Session Messages  →  conversion_report_session_messages
# ─────────────────────────────────────────────────────────────
class ReportSessionMessage(Base):
    """One turn (user question + assistant SQL/result) in a report session."""
    __tablename__ = "conversion_report_session_messages"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    session_id     = Column(Integer, ForeignKey("conversion_report_sessions.id"),
                            nullable=False, index=True)
    role           = Column(String(20), nullable=False)    # "user" | "assistant"
    question       = Column(Text, nullable=True)
    sql_generated  = Column(Text, nullable=True)
    result_summary = Column(Text, nullable=True)           # JSON: {row_count, col_names, sample_rows(5)}
    sql_confidence = Column(Float, nullable=True)          # 0.0–1.0 from schema agent
    schema_used    = Column(Text, nullable=True)           # JSON list of "table.col"
    created_at     = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    session = relationship("ReportSession", back_populates="messages")


# ─────────────────────────────────────────────────────────────
# Report Session Documents  →  conversion_report_session_documents
# ─────────────────────────────────────────────────────────────
class ReportSessionDocument(Base):
    """Uploaded document attached to a report session for context merging."""
    __tablename__ = "conversion_report_session_documents"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    session_id     = Column(Integer, ForeignKey("conversion_report_sessions.id"),
                            nullable=False, index=True)
    filename       = Column(String(500), nullable=False)
    file_type      = Column(String(20), nullable=False)   # "pdf" | "docx" | "xlsx" | "csv" | "txt"
    extracted_text = Column(Text, nullable=True)          # up to 32k chars
    row_count      = Column(Integer, nullable=True)       # for tabular files
    uploaded_at    = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    session = relationship("ReportSession", back_populates="documents")


# ─────────────────────────────────────────────────────────────
# UI Validation Templates  →  conversion_ui_validation_templates
#  Template-based Playwright validation: record once, reuse for all entities
# ─────────────────────────────────────────────────────────────
class UiValidationTemplate(Base):
    """One template per connection — stores URL patterns, login flow, and CSS selectors."""
    __tablename__ = "conversion_ui_validation_templates"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    connection_id = Column(Integer, ForeignKey("conversion_source_connections.id"),
                           nullable=False, index=True)
    app_name      = Column(String(200), nullable=False)
    base_url      = Column(String(2000), nullable=False)
    entity_paths      = Column(Text, nullable=False)   # JSON: {"policy": "/policy/{id}"}
    login_config      = Column(Text, nullable=True)    # JSON (Fernet-encrypted blob)
    selectors         = Column(Text, nullable=False)   # JSON: {"premium": "[data-testid='premium']"}
    response_id_field = Column(String(500), nullable=True)  # JSON key in dispatch response that holds the target entity ID e.g. "policyId" or "data.id"
    created_at    = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at    = Column(DateTime, default=datetime.utcnow,
                           onupdate=datetime.utcnow, server_default=func.now())

    runs = relationship("UiValidationRun", back_populates="template",
                        cascade="all, delete-orphan",
                        order_by="UiValidationRun.id.desc()")

    def __repr__(self):
        return f"<UiValidationTemplate id={self.id} app={self.app_name!r} conn={self.connection_id}>"


# ─────────────────────────────────────────────────────────────
# UI Validation Runs  →  conversion_ui_validation_runs
#  Per-entity validation execution result
# ─────────────────────────────────────────────────────────────
class UiValidationRun(Base):
    """Result of one Playwright validation run for a specific entity."""
    __tablename__ = "conversion_ui_validation_runs"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    template_id   = Column(Integer, ForeignKey("conversion_ui_validation_templates.id"),
                           nullable=False, index=True)
    entity        = Column(String(100), nullable=False)    # "policy" | "claim" etc.
    entity_id     = Column(String(200), nullable=False)    # the concrete ID value
    xml_path      = Column(String(2000), nullable=True)    # local path to XML file for comparison
    status        = Column(String(20), nullable=False)     # PASS | FAIL | ERROR
    url           = Column(String(2000), nullable=True)
    screenshot    = Column(String(500), nullable=True)     # relative path under screenshots/
    summary       = Column(Text, nullable=True)            # JSON: {total, matched, mismatched}
    results       = Column(Text, nullable=True)            # JSON: [{field, ui_value, xml_value, status}]
    error_message = Column(Text, nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    template = relationship("UiValidationTemplate", back_populates="runs")

    def __repr__(self):
        return f"<UiValidationRun id={self.id} entity={self.entity!r}:{self.entity_id!r} status={self.status!r}>"


# ─────────────────────────────────────────────────────────────
# Story Analysis  →  conversion_story_analyses
# ─────────────────────────────────────────────────────────────
class StoryAnalysis(Base):
    """Saved user story analysis result (stories + AI result JSON)."""
    __tablename__ = "conversion_story_analyses"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    project_id   = Column(Integer, ForeignKey("conversion_projects.id"), nullable=True, index=True)
    title        = Column(String(500), nullable=False)
    stories_json = Column(Text, nullable=False)   # JSON: list[StoryInput]
    result_json  = Column(Text, nullable=False)   # JSON: StoryAnalysisResult
    model        = Column(String(100), nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at   = Column(DateTime, default=datetime.utcnow,
                          onupdate=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<StoryAnalysis id={self.id} title={self.title!r}>"


# ─────────────────────────────────────────────────────────────
# Form Builder  →  conversion_form_templates
#                  conversion_form_mapping_presets
#                  conversion_form_data_bindings
#                  conversion_form_executions
# ─────────────────────────────────────────────────────────────

class FormTemplate(Base):
    """Versioned form schema definition (sections + fields)."""
    __tablename__ = "conversion_form_templates"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    project_id       = Column(Integer, ForeignKey("conversion_projects.id"), nullable=True, index=True)
    name             = Column(String(200), nullable=False)
    description      = Column(Text, nullable=True)
    category         = Column(String(100), nullable=True)
    version          = Column(Integer, default=1, nullable=False)
    status           = Column(String(50), default="draft", nullable=False)  # draft | configured | active
    form_schema_json = Column(Text, nullable=True)   # JSON: {sections, fields, layout}
    source_type      = Column(String(50), nullable=True)  # image | pdf | text | handwritten
    source_file_path = Column(String(500), nullable=True)
    parent_id        = Column(Integer, ForeignKey("conversion_form_templates.id"), nullable=True)
    created_by       = Column(Integer, ForeignKey("conversion_users.id"), nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at       = Column(DateTime, default=datetime.utcnow,
                              onupdate=datetime.utcnow, server_default=func.now())

    bindings   = relationship("FormDataBinding",  back_populates="template", cascade="all, delete-orphan")
    executions = relationship("FormExecution",    back_populates="template", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<FormTemplate id={self.id} name={self.name!r} v{self.version}>"


class FormMappingPreset(Base):
    """Reusable field-mapping presets shared across templates."""
    __tablename__ = "conversion_form_mapping_presets"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    source_hint = Column(String(50), nullable=True)   # db | api | manual (informational)
    mapping_json = Column(Text, nullable=True)         # JSON: {"field_name": "data.path", ...}
    created_at  = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at  = Column(DateTime, default=datetime.utcnow,
                         onupdate=datetime.utcnow, server_default=func.now())

    def __repr__(self):
        return f"<FormMappingPreset id={self.id} name={self.name!r}>"


class FormDataBinding(Base):
    """Data source configuration + field mapping for a form template."""
    __tablename__ = "conversion_form_data_bindings"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    template_id      = Column(Integer, ForeignKey("conversion_form_templates.id"), nullable=False, index=True)
    template_version = Column(Integer, nullable=False)
    name             = Column(String(200), nullable=True)
    data_source      = Column(String(50), nullable=False)  # db | api | manual
    config_json      = Column(Text, nullable=True)          # source config (query, endpoint, etc.)
    mapping_json     = Column(Text, nullable=True)          # {"field_name": "data.path.key"}
    preset_id        = Column(Integer, ForeignKey("conversion_form_mapping_presets.id"), nullable=True)
    is_default       = Column(Boolean, default=False)
    created_at       = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at       = Column(DateTime, default=datetime.utcnow,
                              onupdate=datetime.utcnow, server_default=func.now())

    template = relationship("FormTemplate", back_populates="bindings")
    preset   = relationship("FormMappingPreset")

    def __repr__(self):
        return f"<FormDataBinding id={self.id} template_id={self.template_id} source={self.data_source!r}>"


class FormExecution(Base):
    """Record of a single form execution run (single or bulk)."""
    __tablename__ = "conversion_form_executions"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    template_id      = Column(Integer, ForeignKey("conversion_form_templates.id"), nullable=False, index=True)
    template_version = Column(Integer, nullable=False)
    binding_id       = Column(Integer, ForeignKey("conversion_form_data_bindings.id"), nullable=True)
    bulk_run_id      = Column(String(36), nullable=True, index=True)  # UUID for bulk run grouping
    output_format    = Column(String(50), nullable=False)   # pdf | fillable | ui | api
    status           = Column(String(50), default="pending", nullable=False)
    output_json      = Column(Text, nullable=True)
    output_file_path = Column(String(500), nullable=True)
    error_message    = Column(Text, nullable=True)
    triggered_by     = Column(String(50), default="manual")  # manual | bulk | api
    created_at       = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at       = Column(DateTime, default=datetime.utcnow,
                              onupdate=datetime.utcnow, server_default=func.now())

    template = relationship("FormTemplate", back_populates="executions")
    binding  = relationship("FormDataBinding")

    def __repr__(self):
        return f"<FormExecution id={self.id} template_id={self.template_id} format={self.output_format!r} status={self.status!r}>"


# ─────────────────────────────────────────────────────────────
# SAI Knowledge Processing Agent
# ─────────────────────────────────────────────────────────────

class KnowledgeEntry(Base):
    __tablename__ = "conversion_knowledge_entries"
    id                   = Column(Integer, primary_key=True, autoincrement=True)
    title                = Column(String(500), nullable=False)
    type                 = Column(String(50),  nullable=False)   # UseCase|Question|Process|Issue
    system               = Column(String(100), nullable=False)   # DCT|ADO|Snowflake|General
    tags                 = Column(Text, nullable=True)           # JSON array string
    summary              = Column(Text, nullable=True)
    detailed_explanation = Column(Text, nullable=True)
    key_points           = Column(Text, nullable=True)           # JSON array string
    decision             = Column(Text, nullable=True)
    reason               = Column(Text, nullable=True)
    is_reusable          = Column(Boolean, nullable=False, default=True)
    source_type          = Column(String(50), nullable=False, default="Text")
    raw_content          = Column(Text, nullable=True)
    # ── Operational Intelligence fields (B&C operational categories) ─────────
    op_category           = Column(String(50),  nullable=True)   # BusinessProcess|ReconRule|Lineage|DCTMapping|IncidentHistory|Remediation|Ownership
    severity              = Column(String(20),  nullable=True)   # CRITICAL|HIGH|MEDIUM|LOW
    systems_involved_json = Column(Text,        nullable=True)   # JSON: ["Billing","Claims","Policy"]
    remediation_json      = Column(Text,        nullable=True)   # JSON: {steps:[], api_endpoints:[], ps_module:""}
    sql_template          = Column(Text,        nullable=True)   # SQL for validation/rule checking
    validation_query      = Column(Text,        nullable=True)   # SQL to verify knowledge is still accurate
    owner_team            = Column(String(200), nullable=True)
    quality_score        = Column(String(20), nullable=True)     # HIGH|MEDIUM|LOW
    suggestions          = Column(Text, nullable=True)           # JSON array string
    status               = Column(String(50), nullable=False, default="READY_FOR_EMBEDDING")
    embedding_status     = Column(String(30), nullable=False, default="pending")
    # "pending" | "partial" | "complete" | "failed"
    representative_emb   = Column(Text, nullable=True)           # JSON float[] of summary embedding
    version              = Column(Integer, nullable=False, default=1)
    created_by           = Column(String(200), nullable=True)
    created_at           = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at           = Column(DateTime, default=datetime.utcnow,
                                  onupdate=datetime.utcnow, server_default=func.now())
    chunks               = relationship("KnowledgeChunk", back_populates="entry",
                                        cascade="all, delete-orphan",
                                        order_by="KnowledgeChunk.chunk_index")


class KnowledgeChunk(Base):
    __tablename__ = "conversion_knowledge_chunks"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    entry_id    = Column(Integer, ForeignKey("conversion_knowledge_entries.id"), nullable=False)
    chunk_index = Column(Integer, nullable=False, default=0)
    content     = Column(Text, nullable=True)
    topic       = Column(String(500), nullable=True)
    embedding   = Column(Text, nullable=True)   # JSON float[]
    created_at  = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    entry       = relationship("KnowledgeEntry", back_populates="chunks")


class KnowledgeEntryVersion(Base):
    __tablename__ = "conversion_knowledge_entry_versions"
    id           = Column(Integer, primary_key=True, autoincrement=True)
    entry_id     = Column(Integer, ForeignKey("conversion_knowledge_entries.id", ondelete="CASCADE"), nullable=False)
    version_num  = Column(Integer, nullable=False)
    snapshot     = Column(Text, nullable=True)    # JSON of all entry fields at this version
    changed_by   = Column(String(200), nullable=True)
    changed_at   = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    entry        = relationship("KnowledgeEntry")


class CompareRun(Base):
    __tablename__ = "conversion_compare_runs"
    id               = Column(Integer, primary_key=True, autoincrement=True)
    project_id       = Column(Integer, nullable=True)
    run_id           = Column(String(100), nullable=False, unique=True)   # UUID
    user_instructions = Column(Text, nullable=True)
    overall_verdict  = Column(String(20), nullable=True)    # PASS | WARN | FAIL
    verdict_summary  = Column(Text, nullable=True)
    datasets_json    = Column(Text, nullable=True)           # JSON: [{label, row_count, source_type}]
    slots_json       = Column(Text, nullable=True)           # JSON: [{slot_index, source_type, conn_id, sql, label, file_name}]
    result_json      = Column(Text, nullable=True)           # full MultiCompareResult
    created_at       = Column(DateTime, default=datetime.utcnow, server_default=func.now())


class OpenQuestion(Base):
    __tablename__ = "conversion_open_questions"
    id                  = Column(Integer, primary_key=True, autoincrement=True)
    question            = Column(Text, nullable=False)
    detected_tags       = Column(Text, nullable=True)   # JSON {system, category, type}
    suggested_tags      = Column(Text, nullable=True)   # JSON array
    reason              = Column(Text, nullable=True)
    frequency           = Column(Integer, nullable=False, default=1)
    resolution_text     = Column(Text, nullable=True)   # "quick answer" without a full KB entry
    status              = Column(String(30), nullable=False, default="open")
    resolved_by         = Column(String(200), nullable=True)
    resolution_entry_id = Column(Integer, nullable=True)
    asked_by            = Column(String(200), nullable=True)
    feedback_type       = Column(String(50), nullable=True)   # not_answered_well|not_satisfied|incorrect|incomplete
    ai_answer           = Column(Text, nullable=True)         # the AI response that was flagged
    created_at          = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at          = Column(DateTime, default=datetime.utcnow,
                                 onupdate=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# Query History  →  conversion_query_history
# ─────────────────────────────────────────────────────────────
class QueryHistory(Base):
    __tablename__ = "conversion_query_history"

    id              = Column(Integer, primary_key=True, autoincrement=True, index=True)
    conn_id         = Column(Integer, ForeignKey("conversion_source_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    query_text      = Column(Text,        nullable=False)
    row_count       = Column(Integer,     nullable=True)
    duration_ms     = Column(Integer,     nullable=True)
    status          = Column(String(20),  nullable=False, default="success")  # success | error
    error_msg       = Column(Text,        nullable=True)
    executed_at     = Column(DateTime,    default=datetime.utcnow, server_default=func.now())
    is_slow         = Column(Boolean,     nullable=False, default=False)
    slowness_reason = Column(String(500), nullable=True)
    rows_per_second = Column(Float,       nullable=True)


class PayloadSession(Base):
    __tablename__ = "conversion_payload_sessions"

    id             = Column(Integer, primary_key=True, autoincrement=True, index=True)
    name           = Column(String(200), nullable=True)
    source_payload = Column(Text,        nullable=False)
    target_schema  = Column(Text,        nullable=True)
    instructions   = Column(Text,        nullable=True)
    components     = Column(Text,        nullable=True)
    field_mappings = Column(Text,        nullable=True)
    issues         = Column(Text,        nullable=True)
    narrative      = Column(Text,        nullable=True)
    tokens_in      = Column(Integer,     nullable=True)
    tokens_out     = Column(Integer,     nullable=True)
    latency_ms     = Column(Integer,     nullable=True)
    created_at     = Column(DateTime,    default=datetime.utcnow, server_default=func.now())


# ═══════════════════════════════════════════════════════════════
# SAI OPS — Swift Autonomous Intelligence Operational Platform
# ═══════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────
# SAI Run  →  conversion_sai_runs
#  One row per triggered SAI run (manual or event-driven)
# ─────────────────────────────────────────────────────────────
class SaiRun(Base):
    __tablename__ = "conversion_sai_runs"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    project_id       = Column(Integer, ForeignKey("conversion_projects.id"), nullable=True, index=True)
    request_text     = Column(Text, nullable=False)
    event_type       = Column(String(100), nullable=True)   # manual|etl_failure|recon_mismatch|api_latency|queue_lag
    mode             = Column(String(20),  nullable=False, default="manual")  # manual|assisted|autonomous
    status           = Column(String(20),  nullable=False, default="running")  # running|complete|error
    findings_json    = Column(Text, nullable=True)           # JSON: [SaiFinding]
    report_json      = Column(Text, nullable=True)           # JSON: 10-section report
    actions_taken_json = Column(Text, nullable=True)         # JSON: [action records]
    knowledge_sources_json = Column(Text, nullable=True)     # JSON: [{entry_id, title, confidence}]
    conn_ids_json    = Column(Text, nullable=True)           # JSON: [int] — scoped connections
    started_at       = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    completed_at     = Column(DateTime, nullable=True)

    steps    = relationship("SaiStep",    back_populates="run", cascade="all, delete-orphan",
                            order_by="SaiStep.step_number")
    findings = relationship("SaiFinding", back_populates="run", cascade="all, delete-orphan")


# ─────────────────────────────────────────────────────────────
# SAI Step  →  conversion_sai_steps
#  Per-agent step result within a SAI run
# ─────────────────────────────────────────────────────────────
class SaiStep(Base):
    __tablename__ = "conversion_sai_steps"

    id                    = Column(Integer, primary_key=True, autoincrement=True)
    run_id                = Column(Integer, ForeignKey("conversion_sai_runs.id"), nullable=False, index=True)
    step_number           = Column(Integer, nullable=False)
    agent_name            = Column(String(100), nullable=False)  # schema_agent|rca_agent|action_agent|…
    status                = Column(String(20), nullable=False, default="pending")  # pending|running|done|error
    output_json           = Column(Text, nullable=True)
    knowledge_sources_json = Column(Text, nullable=True)  # JSON: [{entry_id, title, confidence}]
    elapsed_ms            = Column(Integer, nullable=True)
    created_at            = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    run = relationship("SaiRun", back_populates="steps")


# ─────────────────────────────────────────────────────────────
# SAI Finding  →  conversion_sai_findings
#  One classified issue detected per SAI run
# ─────────────────────────────────────────────────────────────
class SaiFinding(Base):
    __tablename__ = "conversion_sai_findings"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    run_id          = Column(Integer, ForeignKey("conversion_sai_runs.id"), nullable=False, index=True)
    issue_type      = Column(String(100), nullable=False)  # Policy|Claims|Billing|API|ETL|DCT Mapping|Data Quality
    severity        = Column(String(20),  nullable=False)  # CRITICAL|HIGH|MEDIUM|LOW
    system_impacted = Column(String(200), nullable=True)
    description     = Column(Text, nullable=True)
    evidence_json   = Column(Text, nullable=True)    # JSON: stats, sample rows, anomaly details
    owner_team      = Column(String(200), nullable=True)
    action_taken    = Column(String(500), nullable=True)
    action_status   = Column(String(50),  nullable=True)   # pending|dispatched|resolved|failed
    created_at      = Column(DateTime, default=datetime.utcnow, server_default=func.now())

    run = relationship("SaiRun", back_populates="findings")


# ─────────────────────────────────────────────────────────────
# SAI Event  →  conversion_sai_events
#  Inbound event log (ETL failure, API spike, queue lag, etc.)
# ─────────────────────────────────────────────────────────────
class SaiEvent(Base):
    __tablename__ = "conversion_sai_events"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    project_id      = Column(Integer, ForeignKey("conversion_projects.id"), nullable=True, index=True)
    event_type      = Column(String(100), nullable=False)   # etl_failure|api_latency|recon_mismatch|queue_lag|manual
    source_system   = Column(String(200), nullable=True)
    payload_json    = Column(Text, nullable=True)            # JSON: raw event payload
    triggered_run_id = Column(Integer, ForeignKey("conversion_sai_runs.id"), nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# SAI Config  →  conversion_sai_config
#  Per-project operational mode + action category permissions
# ─────────────────────────────────────────────────────────────
class SaiConfig(Base):
    __tablename__ = "conversion_sai_config"

    id                    = Column(Integer, primary_key=True, autoincrement=True)
    project_id            = Column(Integer, ForeignKey("conversion_projects.id"), nullable=False, unique=True)
    mode                  = Column(String(20), nullable=False, default="manual")  # manual|assisted|autonomous
    allowed_actions_json  = Column(Text, nullable=True)  # JSON: {email: bool, ticket: bool, etl_retry: bool}
    updated_at            = Column(DateTime, default=datetime.utcnow,
                                   onupdate=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# SAI Operational Memory  →  conversion_sai_operational_memory
#  Learned patterns: recurring incidents, stable fixes, trends
# ─────────────────────────────────────────────────────────────
class SaiOperationalMemory(Base):
    __tablename__ = "conversion_sai_operational_memory"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    project_id          = Column(Integer, ForeignKey("conversion_projects.id"), nullable=True, index=True)
    fingerprint         = Column(String(64), nullable=False, index=True)  # SHA-256 of issue signature
    issue_type          = Column(String(100), nullable=True)
    system_impacted     = Column(String(200), nullable=True)
    description_summary = Column(Text, nullable=True)
    frequency           = Column(Integer, nullable=False, default=1)
    last_seen_at        = Column(DateTime, nullable=True)
    successful_fix_json = Column(Text, nullable=True)  # JSON: last successful remediation action
    pattern_json        = Column(Text, nullable=True)  # JSON: seasonal/deployment correlation hints
    created_at          = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at          = Column(DateTime, default=datetime.utcnow,
                                 onupdate=datetime.utcnow, server_default=func.now())


# ─────────────────────────────────────────────────────────────
# SAI Approval Queue  →  conversion_sai_approval_queue
#  Assisted-mode: actions awaiting human approval before dispatch
# ─────────────────────────────────────────────────────────────
class SaiApprovalQueue(Base):
    __tablename__ = "conversion_sai_approval_queue"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    run_id       = Column(Integer, ForeignKey("conversion_sai_runs.id"), nullable=False, index=True)
    finding_id   = Column(Integer, ForeignKey("conversion_sai_findings.id"), nullable=True)
    action_type  = Column(String(100), nullable=False)   # send_email|create_ticket|etl_retry|rerun_recon
    action_payload_json = Column(Text, nullable=True)    # JSON: full action parameters
    status       = Column(String(20), nullable=False, default="pending")  # pending|approved|rejected
    approver     = Column(String(200), nullable=True)
    decided_at   = Column(DateTime, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow, server_default=func.now())
