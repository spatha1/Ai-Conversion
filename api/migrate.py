"""
migrate.py — add missing columns / tables to existing schema.
Run from the Conversionproject root:
    python -m api.migrate
"""
import pyodbc
from api.config import settings


def _conn():
    odbc = (
        f"DRIVER={{{settings.DB_DRIVER}}};"
        f"SERVER={settings.DB_SERVER};"
        f"DATABASE={settings.DB_NAME};"
        f"UID={settings.DB_USER};"
        f"PWD={settings.DB_PASSWORD};"
        f"TrustServerCertificate=yes;"
        f"Encrypt=no"
    )
    return pyodbc.connect(odbc)


def column_exists(cursor, table, column):
    cursor.execute("""
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = ? AND COLUMN_NAME = ?
    """, table, column)
    return cursor.fetchone() is not None


def table_exists(cursor, table):
    cursor.execute("""
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = ?
    """, table)
    return cursor.fetchone() is not None


def add_column_if_missing(cursor, table, column, definition):
    if not column_exists(cursor, table, column):
        print(f"  Adding {table}.{column} ...")
        cursor.execute(f"ALTER TABLE {table} ADD {column} {definition}")
        print(f"  Done")
    else:
        print(f"  {table}.{column} already exists - skipped")


def create_table_if_missing(cursor, table, ddl):
    if not table_exists(cursor, table):
        print(f"  Creating table {table} ...")
        cursor.execute(ddl)
        print(f"  Done")
    else:
        print(f"  {table} already exists - skipped")


def drop_unique_constraint_on_column(cursor, table: str, column: str):
    """
    Drop any UNIQUE constraint on `table` that covers *only* `column`.
    Safe to call multiple times — skips if already gone.
    """
    # Find constraints whose sole column is `column`
    cursor.execute("""
        SELECT tc.CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
             ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
            AND tc.TABLE_NAME      = kcu.TABLE_NAME
        WHERE tc.TABLE_NAME      = ?
          AND tc.CONSTRAINT_TYPE = 'UNIQUE'
          AND kcu.COLUMN_NAME    = ?
          AND (
              SELECT COUNT(*)
              FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k2
              WHERE k2.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
          ) = 1
    """, table, column)
    rows = cursor.fetchall()
    for row in rows:
        constraint_name = row[0]
        print(f"  Dropping unique constraint {constraint_name} on {table}.{column} ...")
        cursor.execute(f"ALTER TABLE {table} DROP CONSTRAINT [{constraint_name}]")
        print(f"  Done")
    if not rows:
        print(f"  No single-column unique constraint on {table}.{column} — skipped")


def main():
    print(f"Connecting to {settings.DB_SERVER} / {settings.DB_NAME} ...")
    con = _conn()
    cur = con.cursor()

    # ── Drop stale single-column unique constraints ────────────
    # conversion_external_integrations originally had UNIQUE on type alone.
    # After adding project_id scoping, that constraint must be removed so that
    # multiple projects can each have their own jira/ado integration row.
    drop_unique_constraint_on_column(cur, "conversion_external_integrations", "type")

    # ── Add missing columns ────────────────────────────────────
    col_migrations = [
        # (table, column, SQL type definition)
        ("conversion_xml_templates",         "conn_id",           "INT NULL"),
        ("conversion_mappings",              "conn_id",           "INT NULL"),
        ("conversion_mappings",              "identifier_column", "NVARCHAR(255) NULL"),
        ("conversion_mappings",              "identifier_table",  "NVARCHAR(255) NULL"),
        ("conversion_mapping_rows",          "confidence",            "INT NULL"),
        ("conversion_mapping_rows",          "transform_expression",  "NVARCHAR(MAX) NULL"),
        ("conversion_mapping_rows",          "transform_sql",         "NVARCHAR(MAX) NULL"),
        ("conversion_external_integrations", "project_id",        "INT NULL"),
        ("conversion_xml_templates",         "format_type",       "NVARCHAR(20) NULL DEFAULT 'xml'"),
        # Dispatch config — multi-channel support
        ("conversion_api_dispatch_configs",  "dispatch_type",     "NVARCHAR(20) NULL DEFAULT 'api'"),
        ("conversion_api_dispatch_configs",  "sftp_host",         "NVARCHAR(500) NULL"),
        ("conversion_api_dispatch_configs",  "sftp_port",         "INT NULL DEFAULT 22"),
        ("conversion_api_dispatch_configs",  "sftp_username",     "NVARCHAR(200) NULL"),
        ("conversion_api_dispatch_configs",  "sftp_password_enc", "NVARCHAR(MAX) NULL"),
        ("conversion_api_dispatch_configs",  "sftp_remote_path",  "NVARCHAR(2000) NULL"),
        ("conversion_api_dispatch_configs",  "azure_conn_str_enc","NVARCHAR(MAX) NULL"),
        ("conversion_api_dispatch_configs",  "azure_container",   "NVARCHAR(500) NULL"),
        ("conversion_api_dispatch_configs",  "azure_blob_prefix", "NVARCHAR(1000) NULL"),
    ]
    for table, column, defn in col_migrations:
        add_column_if_missing(cur, table, column, defn)

    # ── Create new tables ──────────────────────────────────────
    create_table_if_missing(cur, "conversion_generated_xml", """
        CREATE TABLE conversion_generated_xml (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            conn_id          INT NOT NULL,
            mapping_id       INT NULL,
            identifier_value NVARCHAR(500) NULL,
            xml_content      NVARCHAR(MAX) NULL,
            generated_at     DATETIME2 DEFAULT GETUTCDATE()
        )
    """)

    # ── PS (Production Support) tables ────────────────────────
    create_table_if_missing(cur, "conversion_ps_conversations", """
        CREATE TABLE conversion_ps_conversations (
            id         INT IDENTITY(1,1) PRIMARY KEY,
            title      NVARCHAR(500)  NULL,
            conn_id    INT            NULL,
            provider   NVARCHAR(50)   NOT NULL DEFAULT 'openai',
            model      NVARCHAR(100)  NOT NULL DEFAULT 'gpt-4o-mini',
            created_at DATETIME2      DEFAULT GETUTCDATE(),
            updated_at DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_ps_messages", """
        CREATE TABLE conversion_ps_messages (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            conversation_id  INT           NOT NULL,
            role             NVARCHAR(20)  NOT NULL,
            content          NVARCHAR(MAX) NULL,
            tool_name        NVARCHAR(100) NULL,
            tool_input_json  NVARCHAR(MAX) NULL,
            tool_output_json NVARCHAR(MAX) NULL,
            created_at       DATETIME2     DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_ps_api_collection", """
        CREATE TABLE conversion_ps_api_collection (
            id             INT IDENTITY(1,1) PRIMARY KEY,
            name           NVARCHAR(255)  NOT NULL,
            description    NVARCHAR(1000) NULL,
            url            NVARCHAR(2000) NOT NULL,
            method         NVARCHAR(10)   NOT NULL DEFAULT 'POST',
            headers_json   NVARCHAR(MAX)  NULL,
            body_template  NVARCHAR(MAX)  NULL,
            auth_type      NVARCHAR(20)   NOT NULL DEFAULT 'none',
            auth_value_enc NVARCHAR(MAX)  NULL,
            is_active      BIT            NOT NULL DEFAULT 1,
            created_at     DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_ps_workflows", """
        CREATE TABLE conversion_ps_workflows (
            id              INT IDENTITY(1,1) PRIMARY KEY,
            name            NVARCHAR(255)  NOT NULL,
            description     NVARCHAR(1000) NULL,
            conn_id         INT            NULL,
            conversation_id INT            NULL,
            is_active       BIT            NOT NULL DEFAULT 1,
            created_at      DATETIME2      DEFAULT GETUTCDATE(),
            updated_at      DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_ps_workflow_steps", """
        CREATE TABLE conversion_ps_workflow_steps (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            workflow_id INT           NOT NULL,
            step_order  INT           NOT NULL DEFAULT 0,
            step_type   NVARCHAR(50)  NOT NULL,
            label       NVARCHAR(255) NULL,
            config_json NVARCHAR(MAX) NULL,
            created_at  DATETIME2     DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_ps_workflow_schedules", """
        CREATE TABLE conversion_ps_workflow_schedules (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            workflow_id      INT          NOT NULL,
            schedule_type    NVARCHAR(20) NOT NULL DEFAULT 'manual',
            interval_minutes INT          NULL,
            run_at_time      NVARCHAR(10) NULL,
            run_on_day       INT          NULL,
            is_enabled       BIT          NOT NULL DEFAULT 1,
            next_run_at      DATETIME2    NULL,
            last_run_at      DATETIME2    NULL,
            created_at       DATETIME2    DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_ps_workflow_runs", """
        CREATE TABLE conversion_ps_workflow_runs (
            id           INT IDENTITY(1,1) PRIMARY KEY,
            workflow_id  INT          NOT NULL,
            triggered_by NVARCHAR(20) NOT NULL DEFAULT 'manual',
            status       NVARCHAR(20) NOT NULL DEFAULT 'running',
            started_at   DATETIME2    DEFAULT GETUTCDATE(),
            finished_at  DATETIME2    NULL,
            summary_json NVARCHAR(MAX) NULL
        )
    """)

    create_table_if_missing(cur, "conversion_ps_workflow_run_steps", """
        CREATE TABLE conversion_ps_workflow_run_steps (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            run_id        INT           NOT NULL,
            step_id       INT           NULL,
            step_order    INT           NOT NULL DEFAULT 0,
            step_type     NVARCHAR(50)  NOT NULL,
            label         NVARCHAR(255) NULL,
            status        NVARCHAR(20)  NOT NULL DEFAULT 'pending',
            output_json   NVARCHAR(MAX) NULL,
            error_message NVARCHAR(2000) NULL,
            executed_at   DATETIME2     NULL
        )
    """)

    create_table_if_missing(cur, "conversion_ps_email_settings", """
        CREATE TABLE conversion_ps_email_settings (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            smtp_host     NVARCHAR(255) NOT NULL,
            smtp_port     INT           NOT NULL DEFAULT 587,
            smtp_user     NVARCHAR(255) NULL,
            smtp_pass_enc NVARCHAR(MAX) NULL,
            from_address  NVARCHAR(255) NOT NULL,
            use_tls       BIT           NOT NULL DEFAULT 1,
            is_active     BIT           NOT NULL DEFAULT 1,
            created_at    DATETIME2     DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_schema_metadata", """
        CREATE TABLE conversion_schema_metadata (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            conn_id     INT            NOT NULL,
            table_name  NVARCHAR(255)  NOT NULL,
            column_name NVARCHAR(255)  NULL,
            aliases     NVARCHAR(MAX)  NULL,
            description NVARCHAR(MAX)  NULL,
            updated_at  DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_query_examples", """
        CREATE TABLE conversion_query_examples (
            id           INT IDENTITY(1,1) PRIMARY KEY,
            conn_id      INT            NULL,
            name         NVARCHAR(255)  NOT NULL,
            description  NVARCHAR(MAX)  NULL,
            tables_used  NVARCHAR(500)  NULL,
            example_sql  NVARCHAR(MAX)  NOT NULL,
            is_active    BIT            NOT NULL DEFAULT 1,
            created_at   DATETIME2      DEFAULT GETUTCDATE(),
            updated_at   DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_query_context", """
        CREATE TABLE conversion_query_context (
            id         INT IDENTITY(1,1) PRIMARY KEY,
            conn_id    INT            NULL,
            content    NVARCHAR(MAX)  NULL,
            updated_at DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_validation_rules", """
        CREATE TABLE conversion_validation_rules (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            conn_id     INT            NOT NULL,
            target_path NVARCHAR(500)  NOT NULL,
            is_required BIT            NOT NULL DEFAULT 0,
            data_type   NVARCHAR(50)   NULL,
            min_length  INT            NULL,
            max_length  INT            NULL,
            pattern     NVARCHAR(500)  NULL,
            enumeration NVARCHAR(MAX)  NULL,
            min_value   NVARCHAR(100)  NULL,
            max_value   NVARCHAR(100)  NULL
        )
    """)

    # Add validation columns to conversion_generated_xml
    add_column_if_missing(cur, "conversion_generated_xml",   "validation_status",   "NVARCHAR(20) NULL")
    add_column_if_missing(cur, "conversion_generated_xml",   "validation_comment",  "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_schema_metadata", "business_context",    "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_schema_metadata", "synonyms",            "NVARCHAR(MAX) NULL")

    create_table_if_missing(cur, "conversion_enrich_sessions", """
        CREATE TABLE conversion_enrich_sessions (
            id         INT IDENTITY(1,1) PRIMARY KEY,
            conn_id    INT            NOT NULL,
            title      NVARCHAR(500)  NULL,
            created_at DATETIME2      DEFAULT GETUTCDATE(),
            updated_at DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_enrich_messages", """
        CREATE TABLE conversion_enrich_messages (
            id         INT IDENTITY(1,1) PRIMARY KEY,
            session_id INT            NOT NULL,
            role       NVARCHAR(20)   NOT NULL,
            content    NVARCHAR(MAX)  NOT NULL,
            created_at DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    add_column_if_missing(cur, "conversion_dashboard_configs", "debug_json", "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_ps_api_collection", "required_fields", "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_ps_api_collection", "conn_id", "INT NULL")

    create_table_if_missing(cur, "conversion_api_dispatch_configs", """
        CREATE TABLE conversion_api_dispatch_configs (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            conn_id          INT            NOT NULL UNIQUE,
            endpoint_url     NVARCHAR(2000) NULL,
            method           NVARCHAR(10)   NOT NULL DEFAULT 'POST',
            content_type     NVARCHAR(100)  NULL     DEFAULT 'application/xml',
            auth_type        NVARCHAR(20)   NULL     DEFAULT 'none',
            auth_value_enc   NVARCHAR(MAX)  NULL,
            auth_header_name NVARCHAR(200)  NULL,
            extra_headers    NVARCHAR(MAX)  NULL,
            updated_at       DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_api_dispatch_logs", """
        CREATE TABLE conversion_api_dispatch_logs (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            conn_id          INT            NOT NULL,
            xml_id           INT            NULL,
            identifier_value NVARCHAR(500)  NULL,
            status           NVARCHAR(20)   NOT NULL DEFAULT 'pending',
            request_body     NVARCHAR(MAX)  NULL,
            response_status  INT            NULL,
            response_body    NVARCHAR(MAX)  NULL,
            response_time_ms INT            NULL,
            retry_count      INT            NOT NULL DEFAULT 0,
            error_message    NVARCHAR(MAX)  NULL,
            sent_at          DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_dashboard_configs", """
        CREATE TABLE conversion_dashboard_configs (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            project_id  INT            NULL,
            conn_id     INT            NULL,
            name        NVARCHAR(200)  NOT NULL,
            description NVARCHAR(500)  NULL,
            config_json NVARCHAR(MAX)  NOT NULL,
            created_at  DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    # ── AI Platform tables ─────────────────────────────────────
    create_table_if_missing(cur, "conversion_ai_trace_log", """
        CREATE TABLE conversion_ai_trace_log (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            module        NVARCHAR(50)   NOT NULL,
            conn_id       INT            NULL,
            model         NVARCHAR(100)  NOT NULL,
            prompt_text   NVARCHAR(MAX)  NULL,
            response_text NVARCHAR(MAX)  NULL,
            tokens_in     INT            NULL,
            tokens_out    INT            NULL,
            latency_ms    INT            NULL,
            created_at    DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_dev_artifacts", """
        CREATE TABLE conversion_dev_artifacts (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            conn_id          INT            NULL,
            project_id       INT            NULL,
            task_description NVARCHAR(MAX)  NOT NULL,
            plan_json        NVARCHAR(MAX)  NULL,
            artifacts_json   NVARCHAR(MAX)  NULL,
            pipeline_config  NVARCHAR(MAX)  NULL,
            status           NVARCHAR(20)   NOT NULL DEFAULT 'draft',
            created_at       DATETIME2      DEFAULT GETUTCDATE(),
            updated_at       DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_prompt_templates", """
        CREATE TABLE conversion_prompt_templates (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            name        NVARCHAR(200)  NOT NULL UNIQUE,
            description NVARCHAR(500)  NULL,
            category    NVARCHAR(100)  NULL,
            content     NVARCHAR(MAX)  NOT NULL,
            is_active   BIT            NOT NULL DEFAULT 1,
            created_at  DATETIME2      DEFAULT GETUTCDATE(),
            updated_at  DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    # ── AI Agents ──────────────────────────────────────────────
    create_table_if_missing(cur, "conversion_ai_agents", """
        CREATE TABLE conversion_ai_agents (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            name        NVARCHAR(200)  NOT NULL,
            description NVARCHAR(1000) NULL,
            goal        NVARCHAR(MAX)  NOT NULL,
            conn_id     INT            NULL,
            schedule    NVARCHAR(100)  NULL     DEFAULT 'manual',
            status      NVARCHAR(20)   NOT NULL DEFAULT 'active',
            created_at  DATETIME2      DEFAULT GETUTCDATE(),
            updated_at  DATETIME2      DEFAULT GETUTCDATE(),
            last_run_at DATETIME2      NULL
        )
    """)

    create_table_if_missing(cur, "conversion_ai_agent_logs", """
        CREATE TABLE conversion_ai_agent_logs (
            id             INT IDENTITY(1,1) PRIMARY KEY,
            agent_id       INT           NOT NULL,
            status         NVARCHAR(20)  NOT NULL DEFAULT 'running',
            generated_plan NVARCHAR(MAX) NULL,
            steps_executed INT           NULL     DEFAULT 0,
            result_summary NVARCHAR(MAX) NULL,
            error          NVARCHAR(2000) NULL,
            execution_time INT           NULL,
            created_at     DATETIME2     DEFAULT GETUTCDATE(),
            finished_at    DATETIME2     NULL
        )
    """)

    # ── Testing / Reconciliation tables ───────────────────────
    add_column_if_missing(cur, "conversion_prompt_templates", "example_output", "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_ai_test_cases", "group_name",           "NVARCHAR(200) NULL")
    add_column_if_missing(cur, "conversion_ai_test_cases", "schedule_cron",        "NVARCHAR(100) NULL")
    add_column_if_missing(cur, "conversion_ai_test_cases", "identifier_column",    "NVARCHAR(500)  NULL")
    add_column_if_missing(cur, "conversion_ai_test_cases", "reconciliation_type",  "NVARCHAR(50)   NULL")
    add_column_if_missing(cur, "conversion_ai_test_cases", "columns_to_compare",   "NVARCHAR(2000) NULL")
    add_column_if_missing(cur, "conversion_ai_test_results", "mismatch_count",        "INT NULL")
    add_column_if_missing(cur, "conversion_ai_test_results", "missing_source_count",  "INT NULL")
    add_column_if_missing(cur, "conversion_ai_test_results", "missing_target_count",  "INT NULL")
    add_column_if_missing(cur, "conversion_ai_test_results", "sample_mismatches",     "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_ai_test_results", "sample_missing_source", "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_ai_test_results", "sample_missing_target", "NVARCHAR(MAX) NULL")

    create_table_if_missing(cur, "conversion_ai_test_cases", """
        CREATE TABLE conversion_ai_test_cases (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            name             NVARCHAR(200)  NOT NULL,
            source_conn_id   INT            NULL,
            target_conn_id   INT            NULL,
            source_query     NVARCHAR(MAX)  NOT NULL,
            target_query     NVARCHAR(MAX)  NOT NULL,
            validation_type  NVARCHAR(50)   NOT NULL DEFAULT 'count',
            threshold        NVARCHAR(100)  NULL     DEFAULT '0',
            created_at       DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_ai_test_results", """
        CREATE TABLE conversion_ai_test_results (
            id             INT IDENTITY(1,1) PRIMARY KEY,
            test_case_id   INT            NOT NULL,
            execution_time INT            NULL,
            result         NVARCHAR(10)   NOT NULL DEFAULT 'pending',
            source_value   NVARCHAR(500)  NULL,
            target_value   NVARCHAR(500)  NULL,
            difference     NVARCHAR(500)  NULL,
            remarks        NVARCHAR(MAX)  NULL,
            ran_at         DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT FK_test_results_case FOREIGN KEY (test_case_id)
                REFERENCES conversion_ai_test_cases(id)
        )
    """)

    create_table_if_missing(cur, "conversion_feedback", """
        CREATE TABLE conversion_feedback (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            submitted_by  NVARCHAR(100)  NULL,
            module        NVARCHAR(100)  NULL,
            area          NVARCHAR(200)  NULL,
            type          NVARCHAR(50)   NOT NULL,
            priority      NVARCHAR(20)   NULL,
            title         NVARCHAR(500)  NOT NULL,
            description   NVARCHAR(MAX)  NULL,
            page_url      NVARCHAR(500)  NULL,
            status        NVARCHAR(30)   NOT NULL DEFAULT 'open',
            admin_notes   NVARCHAR(MAX)  NULL,
            created_at    DATETIME2      DEFAULT GETUTCDATE(),
            updated_at    DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    # ── Agentic AI Platform ────────────────────────────────────
    # Extend conversion_ai_agents with 5 new columns
    add_column_if_missing(cur, "conversion_ai_agents", "category",      "NVARCHAR(100) NULL")
    add_column_if_missing(cur, "conversion_ai_agents", "role_id",       "INT NULL")
    add_column_if_missing(cur, "conversion_ai_agents", "input_schema",  "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_ai_agents", "output_schema", "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_ai_agents", "tools_json",    "NVARCHAR(MAX) NULL")

    # Extend conversion_agent_cards with loop-back routing
    add_column_if_missing(cur, "conversion_agent_cards", "on_reject_card_id", "INT NULL")
    add_column_if_missing(cur, "conversion_agent_cards", "max_iterations",    "INT NOT NULL DEFAULT 3")

    # Extend conversion_workflow_execution_steps with iteration + decision tracking
    add_column_if_missing(cur, "conversion_workflow_execution_steps", "card_id",        "INT NULL")
    add_column_if_missing(cur, "conversion_workflow_execution_steps", "iteration",       "INT NOT NULL DEFAULT 1")
    add_column_if_missing(cur, "conversion_workflow_execution_steps", "decision",        "NVARCHAR(20) NULL")
    add_column_if_missing(cur, "conversion_workflow_execution_steps", "decision_notes",  "NVARCHAR(MAX) NULL")

    # Human-in-the-Loop gate on workflow executions
    add_column_if_missing(cur, "conversion_workflow_executions", "hitl_required",          "BIT NOT NULL DEFAULT 1")
    add_column_if_missing(cur, "conversion_workflow_executions", "human_approved_at",      "DATETIME2 NULL")
    add_column_if_missing(cur, "conversion_workflow_executions", "human_approved_by",      "NVARCHAR(200) NULL")
    add_column_if_missing(cur, "conversion_workflow_executions", "human_rejection_reason", "NVARCHAR(MAX) NULL")
    # Phase 2: project-level approval integration
    add_column_if_missing(cur, "conversion_workflow_executions",       "project_id",          "INT NULL")
    add_column_if_missing(cur, "conversion_workflow_executions",       "paused_card_id",      "INT NULL")
    add_column_if_missing(cur, "conversion_workflow_execution_steps",  "approval_request_id", "INT NULL")

    create_table_if_missing(cur, "conversion_agent_roles", """
        CREATE TABLE conversion_agent_roles (
            id                 INT IDENTITY(1,1) PRIMARY KEY,
            role_name          NVARCHAR(200)  NOT NULL,
            description        NVARCHAR(1000) NULL,
            responsibilities   NVARCHAR(MAX)  NULL,
            skills             NVARCHAR(MAX)  NULL,
            input_expectation  NVARCHAR(MAX)  NULL,
            output_expectation NVARCHAR(MAX)  NULL,
            decision_logic     NVARCHAR(MAX)  NULL,
            deliverables       NVARCHAR(MAX)  NULL,
            tone               NVARCHAR(200)  NULL,
            is_active          BIT            NOT NULL DEFAULT 1,
            created_at         DATETIME2      DEFAULT GETUTCDATE(),
            updated_at         DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_agent_cards", """
        CREATE TABLE conversion_agent_cards (
            id              INT IDENTITY(1,1) PRIMARY KEY,
            name            NVARCHAR(200)  NOT NULL,
            description     NVARCHAR(1000) NULL,
            role_id         INT            NULL,
            agent_id        INT            NULL,
            execution_order INT            NOT NULL DEFAULT 0,
            input_mapping   NVARCHAR(MAX)  NULL,
            output_mapping  NVARCHAR(MAX)  NULL,
            is_mandatory    BIT            NOT NULL DEFAULT 1,
            is_active       BIT            NOT NULL DEFAULT 1,
            created_at      DATETIME2      DEFAULT GETUTCDATE(),
            updated_at      DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_workflow_executions", """
        CREATE TABLE conversion_workflow_executions (
            id              INT IDENTITY(1,1) PRIMARY KEY,
            conn_id         INT            NULL,
            user_query      NVARCHAR(MAX)  NOT NULL,
            model           NVARCHAR(100)  NOT NULL DEFAULT 'gpt-4o-mini',
            status          NVARCHAR(30)   NOT NULL DEFAULT 'running',
            total_steps     INT            NOT NULL DEFAULT 0,
            completed_steps INT            NOT NULL DEFAULT 0,
            final_summary   NVARCHAR(MAX)  NULL,
            created_at      DATETIME2      DEFAULT GETUTCDATE(),
            finished_at     DATETIME2      NULL
        )
    """)

    create_table_if_missing(cur, "conversion_workflow_execution_steps", """
        CREATE TABLE conversion_workflow_execution_steps (
            id                INT IDENTITY(1,1) PRIMARY KEY,
            execution_id      INT            NOT NULL,
            step_number       INT            NOT NULL,
            card_name         NVARCHAR(200)  NULL,
            role_name         NVARCHAR(200)  NULL,
            agent_name        NVARCHAR(200)  NULL,
            input_text        NVARCHAR(MAX)  NULL,
            output_text       NVARCHAR(MAX)  NULL,
            prompt_used       NVARCHAR(MAX)  NULL,
            status            NVARCHAR(30)   NOT NULL DEFAULT 'pending',
            execution_time_ms INT            NULL,
            created_at        DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT FK_wf_exec_steps FOREIGN KEY (execution_id)
                REFERENCES conversion_workflow_executions(id)
        )
    """)

    create_table_if_missing(cur, "conversion_saved_agentic_workflows", """
        CREATE TABLE conversion_saved_agentic_workflows (
            id                  INT IDENTITY(1,1) PRIMARY KEY,
            name                NVARCHAR(200)  NOT NULL,
            description         NVARCHAR(1000) NULL,
            user_query          NVARCHAR(MAX)  NOT NULL,
            conn_id             INT            NULL,
            model               NVARCHAR(100)  NOT NULL DEFAULT 'gpt-4o-mini',
            schedule_label      NVARCHAR(50)   NULL,
            last_run_at         DATETIME2      NULL,
            last_execution_id   INT            NULL,
            is_active           BIT            NOT NULL DEFAULT 1,
            created_at          DATETIME2      DEFAULT GETUTCDATE(),
            updated_at          DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    # Add schedule_label to saved workflows (column added after table creation in some installs)
    add_column_if_missing(cur, "conversion_saved_agentic_workflows", "schedule_label", "NVARCHAR(50) NULL")

    # ── Agent-Based Conversion Pipeline tables ────────────────
    create_table_if_missing(cur, "conversion_column_profile", """
        CREATE TABLE conversion_column_profile (
            id             INT IDENTITY(1,1) PRIMARY KEY,
            conn_id        INT            NOT NULL,
            table_name     NVARCHAR(255)  NOT NULL,
            column_name    NVARCHAR(255)  NOT NULL,
            null_pct       NVARCHAR(20)   NULL,
            distinct_count INT            NULL,
            total_count    INT            NULL,
            min_val        NVARCHAR(500)  NULL,
            max_val        NVARCHAR(500)  NULL,
            pattern_hint   NVARCHAR(100)  NULL,
            profiled_at    DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT uq_col_profile_conn_table_col
                UNIQUE (conn_id, table_name, column_name)
        )
    """)

    create_table_if_missing(cur, "conversion_query_versions", """
        CREATE TABLE conversion_query_versions (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            conn_id          INT            NOT NULL,
            version          INT            NOT NULL DEFAULT 1,
            sql_text         NVARCHAR(MAX)  NOT NULL,
            mapping_snapshot NVARCHAR(MAX)  NULL,
            agent_run_id     INT            NULL,
            created_at       DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_agent_run_logs", """
        CREATE TABLE conversion_agent_run_logs (
            id             INT IDENTITY(1,1) PRIMARY KEY,
            conn_id        INT            NOT NULL,
            agent_name     NVARCHAR(100)  NOT NULL,
            attempt        INT            NOT NULL DEFAULT 1,
            status         NVARCHAR(20)   NOT NULL DEFAULT 'running',
            input_summary  NVARCHAR(MAX)  NULL,
            output_summary NVARCHAR(MAX)  NULL,
            duration_ms    INT            NULL,
            created_at     DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_validation_results", """
        CREATE TABLE conversion_validation_results (
            id         INT IDENTITY(1,1) PRIMARY KEY,
            conn_id    INT            NOT NULL,
            xml_id     INT            NULL,
            check_name NVARCHAR(200)  NOT NULL,
            passed     BIT            NOT NULL DEFAULT 1,
            detail     NVARCHAR(MAX)  NULL,
            created_at DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_value_mappings", """
        CREATE TABLE conversion_value_mappings (
            id           INT IDENTITY(1,1) PRIMARY KEY,
            conn_id      INT            NOT NULL,
            table_name   NVARCHAR(255)  NOT NULL,
            column_name  NVARCHAR(255)  NOT NULL,
            source_value NVARCHAR(500)  NOT NULL,
            target_value NVARCHAR(500)  NULL,
            confidence   NVARCHAR(20)   NULL,
            mapping_type NVARCHAR(30)   NOT NULL DEFAULT 'manual',
            status       NVARCHAR(20)   NOT NULL DEFAULT 'pending',
            expires_at   DATETIME2      NULL,
            created_at   DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT uq_value_mapping_key
                UNIQUE (conn_id, table_name, column_name, source_value)
        )
    """)

    create_table_if_missing(cur, "conversion_business_rules", """
        CREATE TABLE conversion_business_rules (
            id                  INT IDENTITY(1,1) PRIMARY KEY,
            conn_id             INT            NULL,
            rule_name           NVARCHAR(255)  NOT NULL,
            priority            INT            NOT NULL DEFAULT 0,
            condition_json      NVARCHAR(MAX)  NULL,
            transformation_json NVARCHAR(MAX)  NULL,
            is_active           BIT            NOT NULL DEFAULT 1,
            created_at          DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    # ── Dev vs Base Reconciliation Engine ─────────────────────
    create_table_if_missing(cur, "conversion_test_queries", """
        CREATE TABLE conversion_test_queries (
            id                INT IDENTITY(1,1) PRIMARY KEY,
            conn_id           INT            NOT NULL,
            query_type        NVARCHAR(30)   NOT NULL,
            name              NVARCHAR(255)  NOT NULL,
            sql_text          NVARCHAR(MAX)  NOT NULL,
            table_name        NVARCHAR(255)  NULL,
            column_name       NVARCHAR(255)  NULL,
            priority          INT            NOT NULL DEFAULT 0,
            severity          NVARCHAR(10)   NOT NULL DEFAULT 'error',
            is_auto_generated BIT            NOT NULL DEFAULT 1,
            dev_source_tag    NVARCHAR(30)   NULL,
            created_at        DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_reconciliation_results", """
        CREATE TABLE conversion_reconciliation_results (
            id                INT IDENTITY(1,1) PRIMARY KEY,
            conn_id           INT            NOT NULL,
            run_id            NVARCHAR(36)   NOT NULL,
            dev_source_type   NVARCHAR(30)   NULL,
            dev_source_id     INT            NULL,
            test_query_id     INT            NULL,
            test_name         NVARCHAR(255)  NOT NULL,
            query_type        NVARCHAR(30)   NOT NULL,
            q2_base_sql       NVARCHAR(MAX)  NULL,
            q1_dev_sql        NVARCHAR(MAX)  NULL,
            q1_sql_snapshot   NVARCHAR(MAX)  NULL,
            status            NVARCHAR(10)   NOT NULL DEFAULT 'SKIP',
            base_result       NVARCHAR(MAX)  NULL,
            dev_result        NVARCHAR(MAX)  NULL,
            issue             NVARCHAR(MAX)  NULL,
            ai_insight        NVARCHAR(MAX)  NULL,
            execution_time_ms INT            NULL,
            created_at        DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    # ── Add dev_source_tag to existing conversion_test_queries rows ──────────
    add_column_if_missing(cur, "conversion_test_queries", "dev_source_tag", "NVARCHAR(30) NULL")

    # ── Agent HITL & Audit tables ──────────────────────────────
    create_table_if_missing(cur, "conversion_pending_approvals", """
        CREATE TABLE conversion_pending_approvals (
            id           INT IDENTITY(1,1) PRIMARY KEY,
            session_id   NVARCHAR(36)   NOT NULL,
            conv_id      INT            NULL,
            tool_name    NVARCHAR(50)   NOT NULL,
            tool_call_id NVARCHAR(100)  NOT NULL,
            tool_args    NVARCHAR(MAX)  NOT NULL,
            msg_snapshot NVARCHAR(MAX)  NULL,
            status       NVARCHAR(10)   NOT NULL DEFAULT 'pending',
            approved_by  NVARCHAR(100)  NULL,
            created_at   DATETIME2      DEFAULT GETUTCDATE(),
            expires_at   DATETIME2      NOT NULL
        )
    """)

    create_table_if_missing(cur, "conversion_tool_executions", """
        CREATE TABLE conversion_tool_executions (
            id             INT IDENTITY(1,1) PRIMARY KEY,
            session_id     NVARCHAR(36)   NOT NULL,
            conv_id        INT            NULL,
            conn_id        INT            NULL,
            tool_name      NVARCHAR(50)   NOT NULL,
            tool_args      NVARCHAR(MAX)  NULL,
            result_summary NVARCHAR(MAX)  NULL,
            status         NVARCHAR(10)   NOT NULL,
            execution_ms   INT            NULL,
            iteration      INT            NOT NULL DEFAULT 0,
            approved_by    NVARCHAR(100)  NULL,
            created_at     DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    # ── Auth tables ────────────────────────────────────────────
    create_table_if_missing(cur, "conversion_users", """
        CREATE TABLE conversion_users (
            id              INT IDENTITY(1,1) PRIMARY KEY,
            username        NVARCHAR(100)  NOT NULL,
            email           NVARCHAR(255)  NULL,
            hashed_password NVARCHAR(255)  NOT NULL,
            is_active       BIT            NOT NULL DEFAULT 1,
            created_at      DATETIME2      DEFAULT GETUTCDATE(),
            last_login      DATETIME2      NULL,
            CONSTRAINT uq_users_username UNIQUE (username)
        )
    """)

    create_table_if_missing(cur, "conversion_user_roles", """
        CREATE TABLE conversion_user_roles (
            id      INT IDENTITY(1,1) PRIMARY KEY,
            user_id INT          NOT NULL,
            role    NVARCHAR(50) NOT NULL,
            CONSTRAINT uq_user_role UNIQUE (user_id, role),
            CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id)
                REFERENCES conversion_users(id) ON DELETE CASCADE
        )
    """)

    # ── Pipeline schedule — skip_mapping flag ─────────────────
    add_column_if_missing(cur, "conversion_pipeline_schedules", "skip_mapping", "BIT NOT NULL DEFAULT 0")

    # ── Pipeline tables ────────────────────────────────────────
    create_table_if_missing(cur, "conversion_pipeline_schedules", """
        CREATE TABLE conversion_pipeline_schedules (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            conn_id          INT          NOT NULL UNIQUE,
            schedule_type    NVARCHAR(20) NOT NULL DEFAULT 'manual',
            interval_minutes INT          NULL,
            run_at_time      NVARCHAR(10) NULL,
            run_on_day       INT          NULL,
            is_enabled       BIT          NOT NULL DEFAULT 1,
            next_run_at      DATETIME2    NULL,
            last_run_at      DATETIME2    NULL,
            last_run_status  NVARCHAR(20) NULL,
            created_at       DATETIME2    DEFAULT GETUTCDATE(),
            updated_at       DATETIME2    DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_pipeline_runs", """
        CREATE TABLE conversion_pipeline_runs (
            id           INT IDENTITY(1,1) PRIMARY KEY,
            conn_id      INT          NOT NULL,
            triggered_by NVARCHAR(20) NOT NULL DEFAULT 'manual',
            status       NVARCHAR(20) NOT NULL DEFAULT 'running',
            steps_json   NVARCHAR(MAX) NULL,
            started_at   DATETIME2    DEFAULT GETUTCDATE(),
            finished_at  DATETIME2    NULL
        )
    """)

    # ── User Onboarding, Access Control & Approval Workflow tables ──────────
    create_table_if_missing(cur, "conversion_project_members", """
        CREATE TABLE conversion_project_members (
            id           INT IDENTITY(1,1) PRIMARY KEY,
            project_id   INT          NOT NULL,
            user_id      INT          NOT NULL,
            project_role NVARCHAR(50) NOT NULL,
            joined_at    DATETIME2    DEFAULT GETUTCDATE(),
            CONSTRAINT uq_project_member UNIQUE (project_id, user_id),
            CONSTRAINT fk_pm_project FOREIGN KEY (project_id)
                REFERENCES conversion_projects(id) ON DELETE CASCADE,
            CONSTRAINT fk_pm_user FOREIGN KEY (user_id)
                REFERENCES conversion_users(id) ON DELETE CASCADE
        )
    """)

    create_table_if_missing(cur, "conversion_approval_workflows", """
        CREATE TABLE conversion_approval_workflows (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            project_id  INT            NOT NULL,
            name        NVARCHAR(200)  NOT NULL,
            description NVARCHAR(MAX)  NULL,
            is_active   BIT            NOT NULL DEFAULT 1,
            created_at  DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT fk_aw_project FOREIGN KEY (project_id)
                REFERENCES conversion_projects(id) ON DELETE CASCADE
        )
    """)

    create_table_if_missing(cur, "conversion_approval_workflow_steps", """
        CREATE TABLE conversion_approval_workflow_steps (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            workflow_id   INT           NOT NULL,
            step_order    INT           NOT NULL,
            step_name     NVARCHAR(200) NOT NULL,
            required_role NVARCHAR(50)  NOT NULL,
            CONSTRAINT fk_aws_workflow FOREIGN KEY (workflow_id)
                REFERENCES conversion_approval_workflows(id) ON DELETE CASCADE
        )
    """)

    create_table_if_missing(cur, "conversion_approval_requests", """
        CREATE TABLE conversion_approval_requests (
            id                 INT IDENTITY(1,1) PRIMARY KEY,
            project_id         INT           NOT NULL,
            workflow_id        INT           NULL,
            triggered_by       INT           NOT NULL,
            context_type       NVARCHAR(50)  NOT NULL,
            context_id         NVARCHAR(200) NULL,
            current_step_order INT           NOT NULL DEFAULT 1,
            status             NVARCHAR(50)  NOT NULL DEFAULT 'pending',
            created_at         DATETIME2     DEFAULT GETUTCDATE(),
            CONSTRAINT fk_ar_project FOREIGN KEY (project_id)
                REFERENCES conversion_projects(id),
            CONSTRAINT fk_ar_triggered_by FOREIGN KEY (triggered_by)
                REFERENCES conversion_users(id)
        )
    """)

    create_table_if_missing(cur, "conversion_approval_request_decisions", """
        CREATE TABLE conversion_approval_request_decisions (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            request_id    INT           NOT NULL,
            step_order    INT           NOT NULL,
            step_name     NVARCHAR(200) NOT NULL,
            required_role NVARCHAR(50)  NOT NULL,
            decided_by    INT           NULL,
            decision      NVARCHAR(20)  NULL,
            notes         NVARCHAR(MAX) NULL,
            decided_at    DATETIME2     NULL,
            CONSTRAINT fk_ard_request FOREIGN KEY (request_id)
                REFERENCES conversion_approval_requests(id) ON DELETE CASCADE,
            CONSTRAINT fk_ard_user FOREIGN KEY (decided_by)
                REFERENCES conversion_users(id)
        )
    """)

    create_table_if_missing(cur, "conversion_notifications", """
        CREATE TABLE conversion_notifications (
            id         INT IDENTITY(1,1) PRIMARY KEY,
            user_id    INT            NOT NULL,
            type       NVARCHAR(50)   NOT NULL,
            title      NVARCHAR(300)  NOT NULL,
            body       NVARCHAR(MAX)  NULL,
            is_read    BIT            NOT NULL DEFAULT 0,
            link_type  NVARCHAR(50)   NULL,
            link_id    NVARCHAR(200)  NULL,
            created_at DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT fk_notif_user FOREIGN KEY (user_id)
                REFERENCES conversion_users(id) ON DELETE CASCADE
        )
    """)

    # ── Schema-Driven AI Insight Engine ───────────────────────
    # Extend AITraceLog with execution metadata
    add_column_if_missing(cur, "conversion_ai_trace_log", "sql_executed",        "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_ai_trace_log", "row_count_returned",  "INT NULL")
    add_column_if_missing(cur, "conversion_ai_trace_log", "schema_snapshot",     "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_ai_trace_log", "export_action",       "NVARCHAR(50) NULL")

    # Extend ApprovalRequest for auto-resume and dedup
    add_column_if_missing(cur, "conversion_approval_requests", "context_payload", "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_approval_requests", "sql_hash",        "NVARCHAR(64) NULL")

    # Extend ApprovalWorkflow with quorum type
    add_column_if_missing(cur, "conversion_approval_workflows", "quorum_type", "NVARCHAR(20) NULL DEFAULT 'any_one'")

    # Report Session tables
    create_table_if_missing(cur, "conversion_report_sessions", """
        CREATE TABLE conversion_report_sessions (
            id              INT IDENTITY(1,1) PRIMARY KEY,
            conn_id         INT            NOT NULL,
            user_id         INT            NULL,
            title           NVARCHAR(500)  NULL,
            session_summary NVARCHAR(MAX)  NULL,
            created_at      DATETIME2      DEFAULT GETUTCDATE(),
            updated_at      DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_report_session_messages", """
        CREATE TABLE conversion_report_session_messages (
            id             INT IDENTITY(1,1) PRIMARY KEY,
            session_id     INT            NOT NULL,
            role           NVARCHAR(20)   NOT NULL,
            question       NVARCHAR(MAX)  NULL,
            sql_generated  NVARCHAR(MAX)  NULL,
            result_summary NVARCHAR(MAX)  NULL,
            sql_confidence FLOAT          NULL,
            schema_used    NVARCHAR(MAX)  NULL,
            created_at     DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT FK_rsmsg_session FOREIGN KEY (session_id)
                REFERENCES conversion_report_sessions(id) ON DELETE CASCADE
        )
    """)

    create_table_if_missing(cur, "conversion_report_session_documents", """
        CREATE TABLE conversion_report_session_documents (
            id             INT IDENTITY(1,1) PRIMARY KEY,
            session_id     INT            NOT NULL,
            filename       NVARCHAR(500)  NOT NULL,
            file_type      NVARCHAR(20)   NOT NULL,
            extracted_text NVARCHAR(MAX)  NULL,
            row_count      INT            NULL,
            uploaded_at    DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT FK_rsdoc_session FOREIGN KEY (session_id)
                REFERENCES conversion_report_sessions(id) ON DELETE CASCADE
        )
    """)

    # ── UI Validation (Playwright template-based) ──────────────
    add_column_if_missing(cur, "conversion_ui_validation_templates", "response_id_field", "NVARCHAR(500) NULL")

    create_table_if_missing(cur, "conversion_ui_validation_templates", """
        CREATE TABLE conversion_ui_validation_templates (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            connection_id INT            NOT NULL,
            app_name      NVARCHAR(200)  NOT NULL,
            base_url      NVARCHAR(2000) NOT NULL,
            entity_paths  NVARCHAR(MAX)  NOT NULL,
            login_config  NVARCHAR(MAX)  NULL,
            selectors     NVARCHAR(MAX)  NOT NULL,
            created_at    DATETIME2      DEFAULT GETUTCDATE(),
            updated_at    DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT FK_uivt_conn FOREIGN KEY (connection_id)
                REFERENCES conversion_source_connections(id)
        )
    """)

    create_table_if_missing(cur, "conversion_story_analyses", """
        CREATE TABLE conversion_story_analyses (
            id           INT IDENTITY(1,1) PRIMARY KEY,
            project_id   INT            NULL,
            title        NVARCHAR(500)  NOT NULL,
            stories_json NVARCHAR(MAX)  NOT NULL,
            result_json  NVARCHAR(MAX)  NOT NULL,
            model        NVARCHAR(100)  NULL,
            created_at   DATETIME2      DEFAULT GETUTCDATE(),
            updated_at   DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_ui_validation_runs", """
        CREATE TABLE conversion_ui_validation_runs (
            id            INT IDENTITY(1,1) PRIMARY KEY,
            template_id   INT            NOT NULL,
            entity        NVARCHAR(100)  NOT NULL,
            entity_id     NVARCHAR(200)  NOT NULL,
            xml_path      NVARCHAR(2000) NULL,
            status        NVARCHAR(20)   NOT NULL,
            url           NVARCHAR(2000) NULL,
            screenshot    NVARCHAR(500)  NULL,
            summary       NVARCHAR(MAX)  NULL,
            results       NVARCHAR(MAX)  NULL,
            error_message NVARCHAR(MAX)  NULL,
            created_at    DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT FK_uivr_template FOREIGN KEY (template_id)
                REFERENCES conversion_ui_validation_templates(id)
        )
    """)

    # ── Debug Settings & Traces ────────────────────────────────
    create_table_if_missing(cur, "conversion_debug_settings", """
        CREATE TABLE conversion_debug_settings (
            module       NVARCHAR(50)  NOT NULL,
            debug_level  NVARCHAR(20)  NOT NULL DEFAULT 'OFF',
            updated_at   DATETIME2     DEFAULT GETUTCDATE(),
            CONSTRAINT PK_debug_settings PRIMARY KEY (module)
        )
    """)

    create_table_if_missing(cur, "conversion_debug_traces", """
        CREATE TABLE conversion_debug_traces (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            trace_id    NVARCHAR(36)  NOT NULL,
            module      NVARCHAR(50)  NOT NULL,
            conn_id     INT           NULL,
            debug_level NVARCHAR(20)  NOT NULL,
            steps_json  NVARCHAR(MAX) NULL,
            created_at  DATETIME2     DEFAULT GETUTCDATE()
        )
    """)

    # Indexes for debug_traces (created separately since CREATE TABLE IF NOT EXISTS handles the table)
    if table_exists(cur, "conversion_debug_traces"):
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = 'IX_debug_traces_trace_id'
                  AND object_id = OBJECT_ID('conversion_debug_traces')
            )
            CREATE INDEX IX_debug_traces_trace_id ON conversion_debug_traces (trace_id)
        """)
        cur.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = 'IX_debug_traces_module'
                  AND object_id = OBJECT_ID('conversion_debug_traces')
            )
            CREATE INDEX IX_debug_traces_module ON conversion_debug_traces (module)
        """)

    # Seed the 5 known module rows so upserts always UPDATE (never race on INSERT)
    _DEBUG_MODULES = ["development", "mapping", "report", "reconciliation", "multi_compare"]
    for _mod in _DEBUG_MODULES:
        cur.execute("""
            IF NOT EXISTS (SELECT 1 FROM conversion_debug_settings WHERE module = ?)
                INSERT INTO conversion_debug_settings (module, debug_level) VALUES (?, 'OFF')
        """, _mod, _mod)

    # ── Form Builder tables ────────────────────────────────────
    create_table_if_missing(cur, "conversion_form_templates", """
        CREATE TABLE conversion_form_templates (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            project_id       INT             NULL,
            name             NVARCHAR(200)   NOT NULL,
            description      NVARCHAR(MAX)   NULL,
            category         NVARCHAR(100)   NULL,
            version          INT             NOT NULL DEFAULT 1,
            status           NVARCHAR(50)    NOT NULL DEFAULT 'draft',
            form_schema_json NVARCHAR(MAX)   NULL,
            source_type      NVARCHAR(50)    NULL,
            source_file_path NVARCHAR(500)   NULL,
            parent_id        INT             NULL,
            created_by       INT             NULL,
            created_at       DATETIME2       DEFAULT GETUTCDATE(),
            updated_at       DATETIME2       DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_form_mapping_presets", """
        CREATE TABLE conversion_form_mapping_presets (
            id           INT IDENTITY(1,1) PRIMARY KEY,
            name         NVARCHAR(200)  NOT NULL,
            description  NVARCHAR(MAX)  NULL,
            source_hint  NVARCHAR(50)   NULL,
            mapping_json NVARCHAR(MAX)  NULL,
            created_at   DATETIME2      DEFAULT GETUTCDATE(),
            updated_at   DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_form_data_bindings", """
        CREATE TABLE conversion_form_data_bindings (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            template_id      INT            NOT NULL,
            template_version INT            NOT NULL,
            name             NVARCHAR(200)  NULL,
            data_source      NVARCHAR(50)   NOT NULL,
            config_json      NVARCHAR(MAX)  NULL,
            mapping_json     NVARCHAR(MAX)  NULL,
            preset_id        INT            NULL,
            is_default       BIT            NOT NULL DEFAULT 0,
            created_at       DATETIME2      DEFAULT GETUTCDATE(),
            updated_at       DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT FK_fdb_template FOREIGN KEY (template_id)
                REFERENCES conversion_form_templates(id)
        )
    """)

    create_table_if_missing(cur, "conversion_form_executions", """
        CREATE TABLE conversion_form_executions (
            id               INT IDENTITY(1,1) PRIMARY KEY,
            template_id      INT            NOT NULL,
            template_version INT            NOT NULL,
            binding_id       INT            NULL,
            bulk_run_id      NVARCHAR(36)   NULL,
            output_format    NVARCHAR(50)   NOT NULL,
            status           NVARCHAR(50)   NOT NULL DEFAULT 'pending',
            output_json      NVARCHAR(MAX)  NULL,
            output_file_path NVARCHAR(500)  NULL,
            error_message    NVARCHAR(MAX)  NULL,
            triggered_by     NVARCHAR(50)   NOT NULL DEFAULT 'manual',
            created_at       DATETIME2      DEFAULT GETUTCDATE(),
            updated_at       DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT FK_fe_template FOREIGN KEY (template_id)
                REFERENCES conversion_form_templates(id)
        )
    """)

    # ── SAI Knowledge Processing Agent ──────────────────────────────────────
    create_table_if_missing(cur, "conversion_knowledge_entries", """
        CREATE TABLE conversion_knowledge_entries (
            id                   INT IDENTITY(1,1) PRIMARY KEY,
            title                NVARCHAR(500)   NOT NULL,
            type                 NVARCHAR(50)    NOT NULL,
            system               NVARCHAR(100)   NOT NULL,
            tags                 NVARCHAR(MAX)   NULL,
            summary              NVARCHAR(MAX)   NULL,
            detailed_explanation NVARCHAR(MAX)   NULL,
            key_points           NVARCHAR(MAX)   NULL,
            decision             NVARCHAR(MAX)   NULL,
            reason               NVARCHAR(MAX)   NULL,
            is_reusable          BIT             NOT NULL DEFAULT 1,
            source_type          NVARCHAR(50)    NOT NULL DEFAULT 'Text',
            raw_content          NVARCHAR(MAX)   NULL,
            quality_score        NVARCHAR(20)    NULL,
            suggestions          NVARCHAR(MAX)   NULL,
            status               NVARCHAR(50)    NOT NULL DEFAULT 'READY_FOR_EMBEDDING',
            embedding_status     NVARCHAR(30)    NOT NULL DEFAULT 'pending',
            representative_emb   NVARCHAR(MAX)   NULL,
            version              INT             NOT NULL DEFAULT 1,
            created_by           NVARCHAR(200)   NULL,
            created_at           DATETIME2       DEFAULT GETUTCDATE(),
            updated_at           DATETIME2       DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_knowledge_chunks", """
        CREATE TABLE conversion_knowledge_chunks (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            entry_id    INT             NOT NULL,
            chunk_index INT             NOT NULL DEFAULT 0,
            content     NVARCHAR(MAX)   NULL,
            topic       NVARCHAR(500)   NULL,
            embedding   NVARCHAR(MAX)   NULL,
            created_at  DATETIME2       DEFAULT GETUTCDATE(),
            CONSTRAINT FK_kchunk_entry FOREIGN KEY (entry_id)
                REFERENCES conversion_knowledge_entries(id) ON DELETE CASCADE
        )
    """)

    create_table_if_missing(cur, "conversion_compare_runs", """
        CREATE TABLE conversion_compare_runs (
            id                INT IDENTITY(1,1) PRIMARY KEY,
            project_id        INT           NULL,
            run_id            NVARCHAR(100) NOT NULL UNIQUE,
            user_instructions NVARCHAR(MAX) NULL,
            overall_verdict   NVARCHAR(20)  NULL,
            verdict_summary   NVARCHAR(MAX) NULL,
            datasets_json     NVARCHAR(MAX) NULL,
            slots_json        NVARCHAR(MAX) NULL,
            result_json       NVARCHAR(MAX) NULL,
            created_at        DATETIME2     DEFAULT GETUTCDATE()
        )
    """)
    add_column_if_missing(cur, "conversion_compare_runs", "slots_json", "NVARCHAR(MAX) NULL")

    create_table_if_missing(cur, "conversion_knowledge_entry_versions", """
        CREATE TABLE conversion_knowledge_entry_versions (
            id          INT IDENTITY(1,1) PRIMARY KEY,
            entry_id    INT             NOT NULL,
            version_num INT             NOT NULL,
            snapshot    NVARCHAR(MAX)   NULL,
            changed_by  NVARCHAR(200)   NULL,
            changed_at  DATETIME2       DEFAULT GETUTCDATE(),
            CONSTRAINT FK_kev_entry FOREIGN KEY (entry_id)
                REFERENCES conversion_knowledge_entries(id) ON DELETE CASCADE
        )
    """)

    create_table_if_missing(cur, "conversion_open_questions", """
        CREATE TABLE conversion_open_questions (
            id                  INT IDENTITY(1,1) PRIMARY KEY,
            question            NVARCHAR(MAX)   NOT NULL,
            detected_tags       NVARCHAR(MAX)   NULL,
            suggested_tags      NVARCHAR(MAX)   NULL,
            reason              NVARCHAR(MAX)   NULL,
            frequency           INT             NOT NULL DEFAULT 1,
            resolution_text     NVARCHAR(MAX)   NULL,
            status              NVARCHAR(30)    NOT NULL DEFAULT 'open',
            resolved_by         NVARCHAR(200)   NULL,
            resolution_entry_id INT             NULL,
            asked_by            NVARCHAR(200)   NULL,
            feedback_type       NVARCHAR(50)    NULL,
            ai_answer           NVARCHAR(MAX)   NULL,
            created_at          DATETIME2       DEFAULT GETUTCDATE(),
            updated_at          DATETIME2       DEFAULT GETUTCDATE()
        )
    """)
    add_column_if_missing(cur, "conversion_open_questions", "feedback_type", "NVARCHAR(50) NULL")
    add_column_if_missing(cur, "conversion_open_questions", "ai_answer",     "NVARCHAR(MAX) NULL")

    # ── Agent Mapper ───────────────────────────────────────────
    create_table_if_missing(cur, "conversion_agent_mapper_templates", """
        CREATE TABLE conversion_agent_mapper_templates (
            id           INT IDENTITY(1,1) PRIMARY KEY,
            name         NVARCHAR(200)  NOT NULL,
            template_key NVARCHAR(100)  NOT NULL,
            mapping_type NVARCHAR(50)   NULL,
            entity       NVARCHAR(100)  NULL,
            lob          NVARCHAR(50)   NULL,
            template_xml NVARCHAR(MAX)  NOT NULL,
            notes        NVARCHAR(MAX)  NULL,
            is_ootb      BIT            NOT NULL DEFAULT 1,
            is_active    BIT            NOT NULL DEFAULT 1,
            created_at   DATETIME2      DEFAULT GETUTCDATE(),
            updated_at   DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT uq_agent_mapper_template_key UNIQUE (template_key)
        )
    """)

    add_column_if_missing(cur, "conversion_agent_mapper_templates", "kb_entry_id", "INT NULL")

    create_table_if_missing(cur, "conversion_agent_mapper_sessions", """
        CREATE TABLE conversion_agent_mapper_sessions (
            id             INT IDENTITY(1,1) PRIMARY KEY,
            project_id     INT            NULL,
            user_input     NVARCHAR(MAX)  NOT NULL,
            parsed_intent  NVARCHAR(MAX)  NULL,
            mapping_model  NVARCHAR(MAX)  NULL,
            generated_xml  NVARCHAR(MAX)  NULL,
            grid_json      NVARCHAR(MAX)  NULL,
            mapping_type   NVARCHAR(50)   NULL,
            entity         NVARCHAR(100)  NULL,
            field          NVARCHAR(200)  NULL,
            lob            NVARCHAR(50)   NULL,
            inherit        NVARCHAR(200)  NULL,
            include_json   NVARCHAR(MAX)  NULL,
            created_at     DATETIME2      DEFAULT GETUTCDATE()
        )
    """)

    create_table_if_missing(cur, "conversion_query_history", """
        CREATE TABLE conversion_query_history (
            id           INT IDENTITY(1,1) PRIMARY KEY,
            conn_id      INT            NOT NULL,
            query_text   NVARCHAR(MAX)  NOT NULL,
            row_count    INT            NULL,
            duration_ms  INT            NULL,
            status       NVARCHAR(20)   NOT NULL DEFAULT 'success',
            error_msg    NVARCHAR(MAX)  NULL,
            executed_at  DATETIME2      DEFAULT GETUTCDATE(),
            CONSTRAINT FK_qh_conn FOREIGN KEY (conn_id)
                REFERENCES conversion_source_connections(id) ON DELETE CASCADE
        )
    """)

    con.commit()
    con.close()
    print("\nMigration complete.")

    # ── Seed default prompt templates ──────────────────────────────────────
    print("\nSeeding default prompt templates...")
    try:
        from api.database import SessionLocal
        from api.seed_prompts import seed_default_prompts
        with SessionLocal() as db:
            seed_default_prompts(db)
    except Exception as exc:
        print(f"  Warning: seed failed ({exc}) — prompts can be added manually via Admin UI.")

    # ── Seed default Agent Roles ────────────────────────────────────────────
    print("\nSeeding default agent roles...")
    try:
        from api.database import SessionLocal
        from api.models import AgentRole
        DEFAULT_ROLES = [
            {
                "role_name": "Business Analyst",
                "description": "Translates business requirements into structured data queries and acceptance criteria.",
                "responsibilities": "Gather requirements, interpret business intent, define scope and success criteria, identify relevant data domains.",
                "skills": "Requirements gathering, data analysis, SQL, stakeholder communication, domain modelling.",
                "input_expectation": "A plain-English business question or analytical request.",
                "output_expectation": "A structured analytical plan: what data is needed, which tables/columns, what logic to apply, and what the final output should look like.",
                "decision_logic": "Break the user query into discrete data needs. Identify tables, columns, filters, and aggregations. Flag ambiguities. Define what 'success' means for this query.",
                "deliverables": "Analytical plan, data requirements specification, acceptance criteria.",
                "tone": "business-friendly",
            },
            {
                "role_name": "Data Developer",
                "description": "Converts analytical plans into executable SQL and data transformation logic.",
                "responsibilities": "Write SQL queries, handle JOINs and aggregations, apply transformations, optimise for performance.",
                "skills": "SQL, T-SQL, data modelling, query optimisation, ETL patterns.",
                "input_expectation": "An analytical plan or data requirements specification from the BA role.",
                "output_expectation": "One or more SQL queries with explanations, expected row counts, and any assumptions made.",
                "decision_logic": "Translate each requirement into SQL. Choose appropriate JOIN strategy. Apply filters and aggregations. Document assumptions. Highlight any data quality risks.",
                "deliverables": "SQL query or queries, execution notes, assumptions log.",
                "tone": "analytical",
            },
            {
                "role_name": "QA Engineer",
                "description": "Validates data quality, detects mismatches, and ensures results meet acceptance criteria.",
                "responsibilities": "Design validation checks, compare source vs target, identify nulls, duplicates, and value mismatches.",
                "skills": "Data reconciliation, SQL, statistical validation, test case design, anomaly detection.",
                "input_expectation": "SQL results or a data summary from the Developer role, plus acceptance criteria from the BA.",
                "output_expectation": "A pass/fail validation report with specific issues listed, counts of mismatches, and recommendations.",
                "decision_logic": "Check row counts, null rates, duplicate keys, value distributions. Compare against expected thresholds. Raise issues with severity (critical/warning/info).",
                "deliverables": "Validation report, issue list with severity, pass/fail verdict.",
                "tone": "strict QA",
            },
            {
                "role_name": "Manager",
                "description": "Synthesises outputs from all roles into an executive summary with actionable insights.",
                "responsibilities": "Review BA plan, Developer SQL, and QA findings. Produce a consolidated business-ready summary.",
                "skills": "Executive communication, risk assessment, decision-making, data storytelling.",
                "input_expectation": "Outputs from BA, Developer, and QA steps.",
                "output_expectation": "A concise executive summary: what was analysed, what was found, key risks or issues, recommended actions.",
                "decision_logic": "Synthesise across all steps. Highlight the most important findings. Frame in business terms. Recommend clear next steps.",
                "deliverables": "Executive summary, key findings, recommended actions.",
                "tone": "executive",
            },
        ]
        with SessionLocal() as db:
            existing = db.query(AgentRole).count()
            if existing == 0:
                print("  No agent roles found — seeding 4 defaults...")
                for role_data in DEFAULT_ROLES:
                    db.add(AgentRole(**role_data))
                db.commit()
                print("  Done")
            else:
                print(f"  {existing} agent role(s) already exist — skipped")
    except Exception as exc:
        print(f"  Warning: agent role seed failed ({exc})")

    # ── Seed default admin user ────────────────────────────────────────────────
    print("\nSeeding default admin user...")
    try:
        from api.database import SessionLocal
        from api.seed_users import seed_default_admin
        with SessionLocal() as db:
            seed_default_admin(db)
    except Exception as exc:
        print(f"  Warning: admin user seed failed ({exc})")

    # ── Seed default Agent Cards (one per default role) ────────────────────────
    print("\nSeeding default agent cards...")
    try:
        from api.database import SessionLocal
        from api.models import AgentRole, AgentCard
        with SessionLocal() as db:
            existing_cards = db.query(AgentCard).count()
            if existing_cards == 0:
                roles = db.query(AgentRole).order_by(AgentRole.id).all()
                if roles:
                    print(f"  No cards found — seeding {len(roles)} default cards...")
                    card_descriptions = [
                        "Interprets the user query and produces a structured analytical plan.",
                        "Converts the analytical plan into SQL queries and transformation logic.",
                        "Validates data quality and checks results against acceptance criteria.",
                        "Synthesises all outputs into a concise executive summary.",
                    ]
                    for i, role in enumerate(roles):
                        desc = card_descriptions[i] if i < len(card_descriptions) else None
                        db.add(AgentCard(
                            name=role.role_name,
                            description=desc,
                            role_id=role.id,
                            execution_order=i + 1,
                            is_mandatory=True,
                            is_active=True,
                        ))
                    db.commit()
                    print("  Done")
                else:
                    print("  No roles found — skipping card seed")
            else:
                print(f"  {existing_cards} card(s) already exist — skipped")
    except Exception as exc:
        print(f"  Warning: agent card seed failed ({exc})")


if __name__ == "__main__":
    main()
