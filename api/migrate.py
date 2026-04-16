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
        ("conversion_mapping_rows",          "confidence",        "INT NULL"),
        ("conversion_external_integrations", "project_id",        "INT NULL"),
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


if __name__ == "__main__":
    main()
