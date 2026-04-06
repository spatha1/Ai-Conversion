"""
generate_api_docs.py
Run: .venv/Scripts/python.exe generate_api_docs.py
Outputs: API_Documentation.xlsx
"""
from openpyxl import Workbook
from openpyxl.styles import (
    PatternFill, Font, Alignment, Border, Side, GradientFill
)
from openpyxl.utils import get_column_letter

wb = Workbook()

# ── Colour palette ────────────────────────────────────────────────
HDR_FILL   = PatternFill("solid", fgColor="1F3864")   # dark navy
ALT_FILL   = PatternFill("solid", fgColor="EBF0FA")   # pale blue
WHITE_FILL = PatternFill("solid", fgColor="FFFFFF")
HDR_FONT   = Font(bold=True, color="FFFFFF", size=10, name="Calibri")
BODY_FONT  = Font(size=9, name="Calibri")
TITLE_FONT = Font(bold=True, size=13, name="Calibri", color="1F3864")

METHOD_COLORS = {
    "GET":    "27AE60",
    "POST":   "2980B9",
    "PUT":    "E67E22",
    "DELETE": "C0392B",
    "SSE":    "8E44AD",
}

TAB_COLORS = {
    "Source / Conversion":   "D5E8D4",
    "Target / Conversion":   "DAE8FC",
    "Mapping / Conversion":  "FFF2CC",
    "Output / Conversion":   "F8CECC",
    "Reports":               "E1D5E7",
    "Admin":                 "D5E8D4",
    "PS Support / Chat":     "FFE6CC",
    "PS Support / Workflows":"FFF2CC",
    "System / Utility":      "F5F5F5",
}

thin = Side(style="thin", color="BFBFBF")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)

def _hdr(ws, row, cols):
    for c, val in enumerate(cols, 1):
        cell = ws.cell(row=row, column=c, value=val)
        cell.fill  = HDR_FILL
        cell.font  = HDR_FONT
        cell.border = BORDER
        cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")

def _row(ws, row_num, vals, alt=False):
    fill = ALT_FILL if alt else WHITE_FILL
    for c, val in enumerate(vals, 1):
        cell = ws.cell(row=row_num, column=c, value=str(val) if val is not None else "")
        cell.fill  = fill
        cell.font  = BODY_FONT
        cell.border = BORDER
        cell.alignment = Alignment(wrap_text=True, vertical="top")

def _method_cell(ws, row_num, col, method):
    cell = ws.cell(row=row_num, column=col, value=method)
    color = METHOD_COLORS.get(method, "888888")
    cell.fill  = PatternFill("solid", fgColor=color)
    cell.font  = Font(bold=True, color="FFFFFF", size=9, name="Calibri")
    cell.border = BORDER
    cell.alignment = Alignment(horizontal="center", vertical="top")

def _tab_cell(ws, row_num, col, tab):
    color = TAB_COLORS.get(tab, "F5F5F5")
    cell = ws.cell(row=row_num, column=col, value=tab)
    cell.fill  = PatternFill("solid", fgColor=color)
    cell.font  = Font(size=9, name="Calibri")
    cell.border = BORDER
    cell.alignment = Alignment(wrap_text=True, vertical="top")

def _title_row(ws, row_num, text, ncols):
    ws.row_dimensions[row_num].height = 28
    cell = ws.cell(row=row_num, column=1, value=text)
    cell.font = TITLE_FONT
    cell.fill = PatternFill("solid", fgColor="DCE6F1")
    cell.alignment = Alignment(horizontal="left", vertical="center")
    ws.merge_cells(start_row=row_num, start_column=1,
                   end_row=row_num, end_column=ncols)

# ════════════════════════════════════════════════════════════════
# SHEET 1 — API Endpoints
# ════════════════════════════════════════════════════════════════
ws1 = wb.active
ws1.title = "API Endpoints"
ws1.freeze_panes = "A3"
ws1.sheet_view.showGridLines = False

COLS_API = ["#", "Tab / Flow", "Method", "Endpoint URL",
            "Request Body Fields", "SQL Tables Used", "What It Does"]

_title_row(ws1, 1, "Data Conversion Studio — API Endpoint Reference", len(COLS_API))
_hdr(ws1, 2, COLS_API)

API_DATA = [
    # ── SYSTEM ──
    ("System / Utility", "GET",    "/api/health",
     "—",
     "—",
     "Health check — returns API status, DB server & database name"),

    ("System / Utility", "POST",   "/api/chat",
     "messages: list, api_key: str, model: str",
     "—",
     "OpenAI chat proxy with PII safety net (used by connection setup wizard)"),

    # ── SOURCE / CONNECTIONS ──
    ("Source / Conversion", "GET",    "/api/connections",
     "Query: source_type (optional)",
     "conversion_source_connections",
     "List all saved SQL / Snowflake connections (filter by type)"),

    ("Source / Conversion", "POST",   "/api/connections",
     "name, source_type, dialect, host, port, database_name, schema_name, username, password, sf_*, query_text, sheet_alias",
     "conversion_source_connections",
     "Create & save new connection — credentials Fernet-encrypted at rest"),

    ("Source / Conversion", "GET",    "/api/connections/{conn_id}",
     "Path: conn_id",
     "conversion_source_connections",
     "Fetch single connection by ID (passwords masked in response)"),

    ("Source / Conversion", "PUT",    "/api/connections/{conn_id}",
     "Partial update of any connection field",
     "conversion_source_connections",
     "Update existing connection"),

    ("Source / Conversion", "DELETE", "/api/connections/{conn_id}",
     "Path: conn_id",
     "conversion_source_connections",
     "Soft-delete connection (is_active = False)"),

    ("Source / Conversion", "POST",   "/api/connections/{conn_id}/test",
     "Path: conn_id",
     "conversion_source_connections",
     "Test stored connection using decrypted credentials"),

    ("Source / Conversion", "POST",   "/api/connections/{conn_id}/preview",
     "Path: conn_id",
     "conversion_source_connections",
     "Preview data from stored connection (first N rows, uses saved query)"),

    ("Source / Conversion", "POST",   "/api/connections/{conn_id}/run",
     "query: str, limit: int (optional)",
     "conversion_source_connections",
     "Run a custom SQL query against a stored connection"),

    ("Source / Conversion", "POST",   "/api/sources/test",
     "source_type, dialect, host, port, database_name, username, password, query_text (ad-hoc, not saved)",
     "—",
     "Test ad-hoc connection without saving credentials"),

    ("Source / Conversion", "POST",   "/api/sources/preview",
     "source_type, dialect, host, port, database_name, username, password, query_text (ad-hoc, not saved)",
     "—",
     "Preview data from ad-hoc connection without saving"),

    # ── TARGET ──
    ("Target / Conversion", "POST",   "/api/target-formulas/process",
     "xml_content: str, conn_id: int, name: str",
     "conversion_xml_templates, conversion_target_formula_rules",
     "Parse uploaded XML template, extract formula rules & leaf paths, save to DB"),

    ("Target / Conversion", "GET",    "/api/target-formulas",
     "Query: conn_id (optional)",
     "conversion_target_formula_rules",
     "List target formula rules optionally filtered by connection"),

    ("Target / Conversion", "GET",    "/api/target-formulas/{conn_id}/template",
     "Path: conn_id",
     "conversion_xml_templates",
     "Fetch raw XML template content for a connection"),

    ("Target / Conversion", "DELETE", "/api/target-formulas",
     "Query: conn_id (optional)",
     "conversion_target_formula_rules",
     "Clear formula rules (optionally scoped to one connection)"),

    # ── MAPPING ──
    ("Mapping / Conversion", "POST",   "/api/mapping/generate/query",
     "conn_id: int",
     "conversion_xml_templates, conversion_target_formula_rules, conversion_column_embeddings, conversion_source_connections, conversion_catalog_columns, conversion_catalog_relations",
     "Generate JOIN-aware SQL query from XML + schema using BFS FK graph + GPT refinement"),

    ("Mapping / Conversion", "POST",   "/api/mapping/generate/rows",
     "conn_id: int",
     "conversion_xml_templates, conversion_target_formula_rules, conversion_column_embeddings, conversion_source_connections, conversion_generated_queries, conversion_mappings",
     "Generate source→target mapping rows via embedding similarity + query execution"),

    ("Mapping / Conversion", "GET",    "/api/mapping/{conn_id}",
     "Path: conn_id",
     "conversion_mappings, conversion_mapping_rows",
     "Load latest active mapping rows for a connection"),

    ("Mapping / Conversion", "GET",    "/api/mapping/{conn_id}/query",
     "Path: conn_id",
     "conversion_generated_queries, conversion_mappings",
     "Load the latest AI-generated SQL query for a connection"),

    ("Mapping / Conversion", "POST",   "/api/mapping/save",
     "conn_id, rows: list, query_sql, identifier_column, identifier_table",
     "conversion_mappings, conversion_mapping_rows, conversion_generated_queries",
     "Save mapping rows + SQL query, incrementing mapping version"),

    ("Mapping / Conversion", "GET",    "/api/mapping/{conn_id}/preview",
     "Path: conn_id",
     "conversion_generated_queries, conversion_source_connections",
     "Preview generated query results (TOP 10 / LIMIT 10)"),

    ("Mapping / Conversion", "GET",    "/api/mapping/{conn_id}/identifier-values",
     "Path: conn_id",
     "conversion_generated_queries, conversion_mappings, conversion_source_connections",
     "Get distinct identifier values from query for XML generation selector"),

    ("Mapping / Conversion", "DELETE", "/api/mapping/{conn_id}",
     "Path: conn_id",
     "conversion_mappings, conversion_mapping_rows, conversion_generated_queries",
     "Delete all mappings, rows and generated query for a connection"),

    # ── OUTPUT ──
    ("Output / Conversion", "POST",   "/api/mapping/{conn_id}/generate-xml",
     "identifier_value: str",
     "conversion_xml_templates, conversion_generated_queries, conversion_source_connections, conversion_generated_xml, conversion_mappings",
     "Generate XML document for one identifier value using mapping + formula engine"),

    ("Output / Conversion", "POST",   "/api/mapping/{conn_id}/generate-all-xml",
     "Path: conn_id",
     "conversion_xml_templates, conversion_generated_queries, conversion_source_connections, conversion_generated_xml, conversion_mappings",
     "Batch-generate XML for all identifier groups in query result"),

    ("Output / Conversion", "GET",    "/api/mapping/{conn_id}/generated-xml",
     "Path: conn_id",
     "conversion_generated_xml",
     "List all generated XML records for a connection (id, identifier_value, timestamp)"),

    ("Output / Conversion", "GET",    "/api/mapping/{conn_id}/generated-xml/{record_id}",
     "Path: conn_id, record_id",
     "conversion_generated_xml",
     "Fetch full XML content of a single generated record"),

    # ── REPORTS ──
    ("Reports", "POST",   "/api/report/generate-sql",
     "conn_id, question: str, api_key, embed_model, chat_model, top_k, limit",
     "conversion_source_connections, conversion_column_embeddings",
     "NL → embeddings → cosine rank → GPT SQL generation (no execution). Returns SQL for review"),

    ("Reports", "POST",   "/api/report/ask",
     "conn_id, question: str, api_key, embed_model, chat_model, top_k, limit",
     "conversion_source_connections, conversion_column_embeddings",
     "Full NL→SQL pipeline: embed question → rank columns → generate SQL → execute → return rows"),

    ("Reports", "GET",    "/api/reports/saved",
     "Query: conn_id",
     "conversion_saved_reports",
     "List saved report queries for a connection"),

    ("Reports", "POST",   "/api/reports/saved",
     "conn_id, name: str, query_sql: str",
     "conversion_saved_reports",
     "Save a named report query"),

    ("Reports", "DELETE", "/api/reports/saved/{report_id}",
     "Path: report_id",
     "conversion_saved_reports",
     "Delete a saved report"),

    # ── ADMIN ──
    ("Admin", "GET",    "/api/admin/openai-key-status",
     "—",
     "—",
     "Check if OPENAI_API_KEY is configured (returns preview of first/last chars)"),

    ("Admin", "SSE",    "/api/admin/discover/{conn_id}",
     "Path: conn_id",
     "conversion_source_connections, conversion_catalog_columns, conversion_catalog_relations, conversion_catalog_views, conversion_catalog_samples",
     "Stream schema discovery (tables, columns, FKs, views, sample rows) for SQL/Snowflake/PostgreSQL"),

    ("Admin", "GET",    "/api/admin/catalog/{conn_id}",
     "Path: conn_id",
     "conversion_catalog_columns, conversion_catalog_relations, conversion_catalog_views, conversion_catalog_samples",
     "Fetch stored schema catalog summary + full column/relation data"),

    ("Admin", "DELETE", "/api/admin/catalog/{conn_id}",
     "Path: conn_id",
     "conversion_catalog_columns, conversion_catalog_relations, conversion_catalog_views, conversion_catalog_samples",
     "Clear all catalog data for a connection"),

    ("Admin", "SSE",    "/api/admin/embeddings/{conn_id}",
     "api_key: str, model: str, chat_model: str",
     "conversion_source_connections, conversion_catalog_columns, conversion_catalog_samples, conversion_column_embeddings",
     "Stream OpenAI embedding generation for all catalog columns + AI semantic descriptions"),

    ("Admin", "GET",    "/api/admin/embeddings/{conn_id}/count",
     "Path: conn_id",
     "conversion_column_embeddings",
     "Count stored embeddings for a connection"),

    ("Admin", "GET",    "/api/admin/embeddings/{conn_id}/definitions",
     "Path: conn_id",
     "conversion_column_embeddings",
     "Get AI-generated column definitions (used as defaults in Metadata editor)"),

    ("Admin", "GET",    "/api/admin/reports/{conn_id}",
     "Path: conn_id",
     "conversion_source_connections, conversion_catalog_columns, conversion_catalog_samples",
     "Generate sample runnable SQL reports from catalog schema"),

    ("Admin", "GET",    "/api/admin/metadata/{conn_id}",
     "Path: conn_id",
     "conversion_schema_metadata",
     "Get manually entered column aliases and descriptions"),

    ("Admin", "PUT",    "/api/admin/metadata/{conn_id}",
     "table_name, column_name, aliases: str, description: str",
     "conversion_schema_metadata",
     "Upsert alias/description for a single column"),

    ("Admin", "POST",   "/api/admin/metadata/{conn_id}/bulk",
     "rows: list[{table_name, column_name, aliases, description}]",
     "conversion_schema_metadata",
     "Bulk upsert metadata from imported JSON"),

    ("Admin", "DELETE", "/api/admin/metadata/{conn_id}/{meta_id}",
     "Path: conn_id, meta_id",
     "conversion_schema_metadata",
     "Delete a metadata row"),

    # ── PS SUPPORT — API COLLECTION ──
    ("PS Support / Chat", "GET",    "/api/ps/api-collection",
     "—",
     "conversion_ps_api_collection",
     "List all active external API endpoints registered for PS agent to call"),

    ("PS Support / Chat", "POST",   "/api/ps/api-collection",
     "name, description, url, method, headers_json, body_template, auth_type, auth_value",
     "conversion_ps_api_collection",
     "Register a new external API endpoint (auth value Fernet-encrypted)"),

    ("PS Support / Chat", "PUT",    "/api/ps/api-collection/{entry_id}",
     "Same fields as POST",
     "conversion_ps_api_collection",
     "Update an API collection entry"),

    ("PS Support / Chat", "DELETE", "/api/ps/api-collection/{entry_id}",
     "Path: entry_id",
     "conversion_ps_api_collection",
     "Soft-delete API collection entry"),

    ("PS Support / Chat", "POST",   "/api/ps/api-collection/seed-demo",
     "—",
     "conversion_ps_api_collection",
     "Seed demo API entries (Upsert / Terminate employee) — idempotent"),

    ("PS Support / Chat", "POST",   "/api/ps/demo/emp/upsert",
     "empno, ename, job, mgr, hiredate, sal, comm, deptno",
     "EMP (demo table)",
     "Demo endpoint — INSERT or UPDATE employee record in EMP table"),

    ("PS Support / Chat", "POST",   "/api/ps/demo/emp/terminate",
     "empno, reason",
     "EMP (demo table)",
     "Demo endpoint — Mark employee as TERMINATED"),

    # ── PS SUPPORT — CHAT ──
    ("PS Support / Chat", "POST",   "/api/ps/chat",
     "conn_id, messages: list, api_key, context",
     "conversion_ps_conversations, conversion_ps_messages, conversion_source_connections, conversion_column_embeddings, conversion_catalog_columns, conversion_catalog_relations, conversion_ps_api_collection",
     "Agentic chat loop with tools: lookup_schema, generate_sql, execute_sql, list_api_endpoints, execute_api, preview_email, generate_report"),

    ("PS Support / Chat", "POST",   "/api/ps/chat/{conv_id}/message",
     "Path: conv_id; message content",
     "conversion_ps_conversations, conversion_ps_messages",
     "Continue an existing PS conversation thread"),

    ("PS Support / Chat", "GET",    "/api/ps/conversations",
     "—",
     "conversion_ps_conversations",
     "List all PS support conversation threads"),

    ("PS Support / Chat", "GET",    "/api/ps/conversations/{conv_id}",
     "Path: conv_id",
     "conversion_ps_conversations, conversion_ps_messages",
     "Fetch full conversation with all messages and tool calls"),

    ("PS Support / Chat", "DELETE", "/api/ps/conversations/{conv_id}",
     "Path: conv_id",
     "conversion_ps_conversations, conversion_ps_messages",
     "Delete a conversation and all its messages"),

    # ── PS SUPPORT — WORKFLOWS ──
    ("PS Support / Workflows", "GET",    "/api/ps/workflows",
     "—",
     "conversion_ps_workflows, conversion_ps_workflow_steps, conversion_ps_workflow_schedules, conversion_ps_workflow_runs",
     "List all active PS workflows with step count and last run status"),

    ("PS Support / Workflows", "POST",   "/api/ps/workflows/from-conversation",
     "conversation_id, name, description, step_indices: list[int]",
     "conversion_ps_conversations, conversion_ps_messages, conversion_ps_workflows, conversion_ps_workflow_steps, conversion_ps_workflow_schedules",
     "Extract executable steps from a chat conversation and create a reusable workflow"),

    ("PS Support / Workflows", "GET",    "/api/ps/workflows/extract-steps",
     "Query: conversation_id",
     "conversion_ps_conversations, conversion_ps_messages",
     "Preview extractable workflow steps from a conversation without creating the workflow"),

    ("PS Support / Workflows", "GET",    "/api/ps/workflows/{wf_id}",
     "Path: wf_id",
     "conversion_ps_workflows, conversion_ps_workflow_steps, conversion_ps_workflow_schedules, conversion_ps_workflow_runs",
     "Get full workflow detail including steps, schedule and last run"),

    ("PS Support / Workflows", "PUT",    "/api/ps/workflows/{wf_id}",
     "name: str, description: str",
     "conversion_ps_workflows",
     "Update workflow name / description"),

    ("PS Support / Workflows", "DELETE", "/api/ps/workflows/{wf_id}",
     "Path: wf_id",
     "conversion_ps_workflows",
     "Soft-delete workflow (is_active = False)"),

    ("PS Support / Workflows", "POST",   "/api/ps/workflows/{wf_id}/clone",
     "Path: wf_id",
     "conversion_ps_workflows, conversion_ps_workflow_steps, conversion_ps_workflow_schedules",
     "Duplicate a workflow with all its steps"),

    ("PS Support / Workflows", "PUT",    "/api/ps/workflows/{wf_id}/steps/{step_id}",
     "label: str, config_json: dict",
     "conversion_ps_workflow_steps",
     "Update a single workflow step (label and config)"),

    ("PS Support / Workflows", "POST",   "/api/ps/workflows/{wf_id}/run",
     "Path: wf_id",
     "conversion_ps_workflows, conversion_ps_workflow_runs, conversion_ps_workflow_run_steps, conversion_source_connections, conversion_ps_api_collection, conversion_ps_email_settings",
     "Execute workflow immediately — runs each step (sql/api_call/email) in sequence"),

    ("PS Support / Workflows", "GET",    "/api/ps/workflows/{wf_id}/runs",
     "Path: wf_id, Query: limit",
     "conversion_ps_workflow_runs, conversion_ps_workflow_run_steps",
     "List execution history for a workflow"),

    ("PS Support / Workflows", "PUT",    "/api/ps/workflows/{wf_id}/schedule",
     "schedule_type, interval_minutes, run_at_time, run_on_day, is_enabled",
     "conversion_ps_workflow_schedules",
     "Set or update the recurring schedule for a workflow"),

    ("PS Support / Workflows", "GET",    "/api/ps/email-settings",
     "—",
     "conversion_ps_email_settings",
     "Get SMTP configuration (password flag only — never returned in plaintext)"),

    ("PS Support / Workflows", "PUT",    "/api/ps/email-settings",
     "smtp_host, smtp_port, smtp_user, smtp_pass, from_address, use_tls",
     "conversion_ps_email_settings",
     "Save SMTP settings (password Fernet-encrypted)"),

    ("PS Support / Workflows", "POST",   "/api/ps/email-settings/test",
     "to: str, subject: str, body: str",
     "conversion_ps_email_settings",
     "Send a test email using configured SMTP"),

    ("PS Support / Workflows", "POST",   "/api/ps/email/send",
     "to: str, subject: str, body: str",
     "conversion_ps_email_settings",
     "Send email directly from chat / workflow step"),
]

for i, (tab, method, url, body, tables, desc) in enumerate(API_DATA, 1):
    row_num = i + 2
    alt = (i % 2 == 0)
    _row(ws1, row_num, [i, "", "", url, body, tables, desc], alt=alt)
    _method_cell(ws1, row_num, 3, method)
    _tab_cell(ws1, row_num, 2, tab)

# Column widths
ws1.column_dimensions["A"].width = 4
ws1.column_dimensions["B"].width = 22
ws1.column_dimensions["C"].width = 8
ws1.column_dimensions["D"].width = 42
ws1.column_dimensions["E"].width = 42
ws1.column_dimensions["F"].width = 50
ws1.column_dimensions["G"].width = 55

for r in range(3, len(API_DATA) + 3):
    ws1.row_dimensions[r].height = 42


# ════════════════════════════════════════════════════════════════
# SHEET 2 — Python Files
# ════════════════════════════════════════════════════════════════
ws2 = wb.create_sheet("Python Files")
ws2.freeze_panes = "A3"
ws2.sheet_view.showGridLines = False

COLS_PY = ["#", "Category", "File Path", "Key Classes / Functions", "Purpose / Responsibilities"]

_title_row(ws2, 1, "Data Conversion Studio — Python File Reference", len(COLS_PY))
_hdr(ws2, 2, COLS_PY)

CAT_COLORS = {
    "Entry Point":   "D5E8D4",
    "Configuration": "DAE8FC",
    "Database":      "FFF2CC",
    "Models":        "F8CECC",
    "Schemas":       "E1D5E7",
    "Services":      "FFE6CC",
    "Routers":       "D5E8D4",
    "Utilities":     "F5F5F5",
}

PYTHON_DATA = [
    # ── Entry Point ──
    ("Entry Point", "api/main.py",
     "app (FastAPI), lifespan()",
     "FastAPI application entry. Mounts all routers, configures CORS, defines /api/health & /api/chat endpoints, runs DB create_all on startup"),

    # ── Configuration ──
    ("Configuration", "api/config.py",
     "Settings (BaseSettings)",
     "Loads all environment variables from .env: DB credentials, OpenAI key, Fernet secret. Exposes settings singleton"),

    ("Configuration", "api/setup_db.py",
     "main()",
     "One-time bootstrap: creates ConversionAgent database, SQL login, app user (db_owner), and all 17 ORM tables via create_all"),

    ("Configuration", "api/migrate.py",
     "run_migrations()",
     "Adds missing columns to existing tables (ALTER TABLE) — safe to re-run. Handles schema drift between sessions"),

    # ── Database ──
    ("Database", "api/database.py",
     "engine, SessionLocal, Base, get_db()",
     "SQLAlchemy setup with ODBC passthrough URL (handles backslash in server name, @ in password). Provides get_db() FastAPI dependency"),

    # ── Models ──
    ("Models", "api/models.py",
     "SourceConnection, XmlTemplate, TargetFormulaRule, Mapping, MappingRow, GeneratedQuery, GeneratedXml, ColumnEmbedding, CatalogColumn, CatalogRelation, CatalogView, CatalogSample, SavedReport, SchemaMetadata, PsApiCollection, PsConversation, PsMessage, PsWorkflow, PsWorkflowStep, PsWorkflowRun, PsWorkflowRunStep, PsWorkflowSchedule, PsEmailSettings",
     "All 23 SQLAlchemy ORM models (conversion_ table prefix). Defines columns, relationships, and defaults for every entity in the system"),

    # ── Schemas ──
    ("Schemas", "api/schemas.py",
     "ConnectionCreate, ConnectionOut, ConnectionUpdate, RuleOut, MappingRowIn, …",
     "Pydantic request/response schemas for validation and serialisation. Separate from ORM models"),

    # ── Services ──
    ("Services", "api/services/connector.py",
     "preview_data(), fetch_all_data(), test_connection(), _wrap_query()",
     "Dispatches DB calls by source_type: mssql/postgresql/mysql/sqlite → SQLAlchemy; snowflake → snowflake-connector-python. fetch_all_data() is internal-only (never exposed as HTTP endpoint)"),

    ("Services", "api/services/encryption.py",
     "encrypt(), decrypt()",
     "Fernet symmetric encryption/decryption for passwords and API keys stored at rest. Key loaded from FERNET_SECRET in .env"),

    ("Services", "api/services/embeddings.py",
     "get_embedding(), cosine_similarity(), generate_sql()",
     "OpenAI API calls: get_embedding() → text-embedding-3-small vectors; cosine_similarity() → column ranking; generate_sql() → GPT chat completion with dialect-specific T-SQL / Snowflake / PostgreSQL / MySQL rules"),

    ("Services", "api/services/query_builder.py",
     "build_join_query(), _bfs_join_path()",
     "JOIN-aware SQL builder using BFS over FK relation graph from catalog_relations. Automatically builds multi-table JOINs when schema has been collected. Falls back to flat query if no FK relations"),

    ("Services", "api/services/query_skill.py",
     "build_skill_prompt()",
     "Enriches LLM system prompt with schema context: table/column descriptions, FK relationships, sample data, and domain rules from SchemaMetadata. Used by both report_ai and ps_ai for better SQL generation"),

    # ── Routers ──
    ("Routers", "api/routers/connections.py",
     "_to_cfg_from_model(), _clean_error_str(), ConnectionCreate, ConnectionUpdate, ConnectionOut",
     "CRUD for SourceConnection + test/preview/run endpoints. Encrypts credentials on write, masks passwords on read. Provides _to_cfg_from_model() helper used by other routers"),

    ("Routers", "api/routers/mapping_ai.py",
     "generate_query(), generate_rows(), save_mapping(), generate_xml(), generate_all_xml()",
     "Full mapping pipeline: BFS JOIN query builder → AI SQL refinement → embedding-based column matching → mapping row generation → formula-engine XML output for one or all identifier values"),

    ("Routers", "api/routers/report_ai.py",
     "generate_sql_only(), ask_question(), save_report(), list_saved_reports()",
     "NL→SQL pipeline for Reports tab. generate_sql_only: embed question → cosine rank → generate SQL (no exec). ask_question: same + execute. Supports save/list/delete named reports"),

    ("Routers", "api/routers/admin.py",
     "discover_schema() [SSE], get_catalog(), generate_embeddings() [SSE], get_metadata(), upsert_metadata(), bulk_upsert_metadata(), get_embedding_definitions()",
     "Admin operations: streaming schema discovery (tables, columns, FKs, views, samples), streaming OpenAI embedding generation with AI descriptions, schema metadata CRUD (aliases + descriptions)"),

    ("Routers", "api/routers/ps_ai.py",
     "generate_direct() [SSE], _tool_lookup_schema(), _tool_generate_sql(), _tool_execute_sql(), _tool_execute_api(), _tool_preview_email(), _TOOLS, _CLAUDE_TOOLS",
     "Agentic PS Support chat. Streams Claude API with multi-tool loop: schema lookup, SQL generation, SQL execution, external API calls, email preview. Handles approval flow for destructive actions"),

    ("Routers", "api/routers/ps_api_collection.py",
     "list_api_collection(), create_entry(), update_entry(), delete_entry(), seed_demo(), demo_emp_upsert(), demo_emp_terminate()",
     "CRUD for external API endpoints registered for PS agent. Seed-demo creates realistic employee upsert/terminate entries. Real demo endpoints hit EMP table"),

    ("Routers", "api/routers/ps_workflows.py",
     "_run_workflow_db(), _extract_steps_from_conversation(), create_from_conversation(), run_workflow(), schedule_workflow(), send_email()",
     "Workflow engine: create workflows from chat conversations, execute step types (sql / api_call / email), schedule recurring runs, manage run history, SMTP send"),
]

for i, (cat, fpath, funcs, purpose) in enumerate(PYTHON_DATA, 1):
    row_num = i + 2
    alt = (i % 2 == 0)
    color = CAT_COLORS.get(cat, "F5F5F5")
    # Row
    for c, val in enumerate([i, cat, fpath, funcs, purpose], 1):
        cell = ws2.cell(row=row_num, column=c, value=str(val))
        cell.fill  = ALT_FILL if alt else WHITE_FILL
        cell.font  = BODY_FONT
        cell.border = BORDER
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    # Category cell colour
    cat_cell = ws2.cell(row=row_num, column=2)
    cat_cell.fill = PatternFill("solid", fgColor=color)

ws2.column_dimensions["A"].width = 4
ws2.column_dimensions["B"].width = 16
ws2.column_dimensions["C"].width = 38
ws2.column_dimensions["D"].width = 52
ws2.column_dimensions["E"].width = 65

for r in range(3, len(PYTHON_DATA) + 3):
    ws2.row_dimensions[r].height = 52


# ════════════════════════════════════════════════════════════════
# SHEET 3 — DB Tables Quick Reference
# ════════════════════════════════════════════════════════════════
ws3 = wb.create_sheet("DB Tables")
ws3.freeze_panes = "A3"
ws3.sheet_view.showGridLines = False

COLS_DB = ["#", "Table Name", "ORM Model", "Used In Tab / Flow", "Purpose"]

_title_row(ws3, 1, "Data Conversion Studio — Database Table Reference", len(COLS_DB))
_hdr(ws3, 2, COLS_DB)

DB_DATA = [
    ("conversion_source_connections",   "SourceConnection",     "Source / All tabs",              "Saved SQL & Snowflake connections with Fernet-encrypted credentials"),
    ("conversion_xml_templates",        "XmlTemplate",          "Target / Mapping / Output",      "Uploaded XML template content, linked to a connection"),
    ("conversion_target_formula_rules", "TargetFormulaRule",    "Target / Mapping",               "Extracted XML leaf paths, defaults and formula rules from template"),
    ("conversion_mappings",             "Mapping",              "Mapping",                        "Versioned mapping header (conn_id, identifier column, status)"),
    ("conversion_mapping_rows",         "MappingRow",           "Mapping",                        "Source column → target XML path rows per mapping version"),
    ("conversion_generated_queries",    "GeneratedQuery",       "Mapping / Output",               "AI-generated SQL query per connection (JOIN-aware, BFS-built)"),
    ("conversion_generated_xml",        "GeneratedXml",         "Output",                         "Stored XML output keyed by identifier value"),
    ("conversion_catalog_columns",      "CatalogColumn",        "Admin / Mapping / PS Chat",      "Discovered schema: all columns with data types per connection"),
    ("conversion_catalog_relations",    "CatalogRelation",      "Admin / Mapping",                "Discovered FK relationships (used by BFS JOIN builder)"),
    ("conversion_catalog_views",        "CatalogView",          "Admin",                          "Discovered database views"),
    ("conversion_catalog_samples",      "CatalogSample",        "Admin / Embeddings",             "Sample rows (≤3 per table) for LLM context"),
    ("conversion_column_embeddings",    "ColumnEmbedding",      "Admin / Reports / PS Chat",      "OpenAI embedding vectors + AI-generated semantic column definitions"),
    ("conversion_saved_reports",        "SavedReport",          "Reports",                        "Saved NL→SQL named report queries per connection"),
    ("conversion_schema_metadata",      "SchemaMetadata",       "Admin",                          "Manually entered column aliases and descriptions (metadata editor)"),
    ("conversion_run_logs",             "RunLog",               "All tabs",                       "Execution history log entries"),
    ("conversion_pii_policies",         "PiiPolicy",            "— (schema only)",                "PII guardrail rules — model created, no active service yet"),
    ("conversion_ps_api_collection",    "PsApiCollection",      "PS Support / Chat",              "External REST API endpoints registered for PS agent to call"),
    ("conversion_ps_conversations",     "PsConversation",       "PS Support / Chat",              "PS support conversation threads"),
    ("conversion_ps_messages",          "PsMessage",            "PS Support / Chat",              "Individual messages and tool call records within conversations"),
    ("conversion_ps_workflows",         "PsWorkflow",           "PS Support / Workflows",         "Reusable workflow definitions extracted from conversations"),
    ("conversion_ps_workflow_steps",    "PsWorkflowStep",       "PS Support / Workflows",         "Ordered steps within a workflow (sql / api_call / email types)"),
    ("conversion_ps_workflow_runs",     "PsWorkflowRun",        "PS Support / Workflows",         "Workflow execution run records (status, timestamps)"),
    ("conversion_ps_workflow_run_steps","PsWorkflowRunStep",    "PS Support / Workflows",         "Per-step execution results within a workflow run"),
    ("conversion_ps_workflow_schedules","PsWorkflowSchedule",   "PS Support / Workflows",         "Recurring schedule configuration for workflows"),
    ("conversion_ps_email_settings",    "PsEmailSettings",      "PS Support / Workflows",         "SMTP email configuration (password encrypted)"),
]

for i, (tname, model, tab, purpose) in enumerate(DB_DATA, 1):
    row_num = i + 2
    alt = (i % 2 == 0)
    for c, val in enumerate([i, tname, model, tab, purpose], 1):
        cell = ws3.cell(row=row_num, column=c, value=str(val))
        cell.fill  = ALT_FILL if alt else WHITE_FILL
        cell.font  = BODY_FONT
        cell.border = BORDER
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    ws3.row_dimensions[row_num].height = 32

ws3.column_dimensions["A"].width = 4
ws3.column_dimensions["B"].width = 38
ws3.column_dimensions["C"].width = 26
ws3.column_dimensions["D"].width = 28
ws3.column_dimensions["E"].width = 60

# ── Legend tab ────────────────────────────────────────────────────
ws4 = wb.create_sheet("Legend")
ws4.sheet_view.showGridLines = False
_title_row(ws4, 1, "Legend — Method & Tab Colour Coding", 3)

legend_rows = [
    ("GET",    "Read / fetch data — no side effects"),
    ("POST",   "Create / execute — creates new record or triggers action"),
    ("PUT",    "Update — modifies existing record"),
    ("DELETE", "Remove — soft-delete or hard-delete"),
    ("SSE",    "Server-Sent Events — real-time streaming response (EventSource)"),
]
ws4.cell(row=2, column=1, value="Method").font = Font(bold=True, name="Calibri")
ws4.cell(row=2, column=2, value="Meaning").font = Font(bold=True, name="Calibri")
for i, (method, meaning) in enumerate(legend_rows, 3):
    color = METHOD_COLORS.get(method, "888888")
    mc = ws4.cell(row=i, column=1, value=method)
    mc.fill = PatternFill("solid", fgColor=color)
    mc.font = Font(bold=True, color="FFFFFF", name="Calibri")
    mc.alignment = Alignment(horizontal="center")
    ws4.cell(row=i, column=2, value=meaning).font = Font(name="Calibri", size=10)

ws4.cell(row=9, column=1, value="Tab / Flow Colours").font = Font(bold=True, name="Calibri")
for i, (tab, color) in enumerate(TAB_COLORS.items(), 10):
    tc = ws4.cell(row=i, column=1, value=tab)
    tc.fill = PatternFill("solid", fgColor=color)
    tc.font = Font(name="Calibri", size=9)

ws4.column_dimensions["A"].width = 30
ws4.column_dimensions["B"].width = 55

# ── Save ──────────────────────────────────────────────────────────
out = "API_Documentation.xlsx"
wb.save(out)
print(f"Saved: {out}")
