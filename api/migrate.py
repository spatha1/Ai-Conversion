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


def main():
    print(f"Connecting to {settings.DB_SERVER} / {settings.DB_NAME} ...")
    con = _conn()
    cur = con.cursor()

    # ── Add missing columns ────────────────────────────────────
    col_migrations = [
        # (table, column, SQL type definition)
        ("conversion_xml_templates",  "conn_id",           "INT NULL"),
        ("conversion_mappings",       "conn_id",           "INT NULL"),
        ("conversion_mappings",       "identifier_column", "NVARCHAR(255) NULL"),
        ("conversion_mappings",       "identifier_table",  "NVARCHAR(255) NULL"),
        ("conversion_mapping_rows",   "confidence",        "INT NULL"),
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
    add_column_if_missing(cur, "conversion_generated_xml", "validation_status",  "NVARCHAR(20) NULL")
    add_column_if_missing(cur, "conversion_generated_xml", "validation_comment", "NVARCHAR(MAX) NULL")

    add_column_if_missing(cur, "conversion_dashboard_configs", "debug_json", "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_ps_api_collection", "required_fields", "NVARCHAR(MAX) NULL")
    add_column_if_missing(cur, "conversion_ps_api_collection", "conn_id", "INT NULL")

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

    con.commit()
    con.close()
    print("\nMigration complete.")


if __name__ == "__main__":
    main()
