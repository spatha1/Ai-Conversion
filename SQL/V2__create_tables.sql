-- ============================================================
-- V2__create_tables.sql
-- ConversionAgent — Full Schema (all 25 tables)
--
-- Run as:  clarityAgentuser  (or any db_owner member)
-- Target:  ConversionAgent
-- Version: 2
-- Depends: V1__database_setup.sql
-- ============================================================

USE [ConversionAgent];
GO

-- ── 1. conversion_projects ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_projects')
BEGIN
    CREATE TABLE conversion_projects (
        id          INT           IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(200) NOT NULL,
        description NVARCHAR(MAX) NULL,
        created_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_projects';
END
ELSE PRINT '[SKIP] conversion_projects';
GO

-- ── 2. conversion_source_connections ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_source_connections')
BEGIN
    CREATE TABLE conversion_source_connections (
        id                            INT           IDENTITY(1,1) PRIMARY KEY,
        project_id                    INT           NULL,
        name                          NVARCHAR(200) NOT NULL,
        source_type                   NVARCHAR(50)  NOT NULL,   -- sql | snowflake | file
        -- SQL fields
        dialect                       NVARCHAR(50)  NULL,       -- mssql | postgresql | mysql | sqlite
        host                          NVARCHAR(255) NULL,
        port                          INT           NULL,
        database_name                 NVARCHAR(255) NULL,
        schema_name                   NVARCHAR(255) NULL,
        username                      NVARCHAR(255) NULL,
        password_enc                  NVARCHAR(MAX) NULL,       -- Fernet-encrypted
        -- Snowflake fields
        sf_account                    NVARCHAR(255) NULL,
        sf_warehouse                  NVARCHAR(255) NULL,
        sf_role                       NVARCHAR(255) NULL,
        sf_database                   NVARCHAR(255) NULL,
        sf_schema                     NVARCHAR(255) NULL,
        sf_username                   NVARCHAR(255) NULL,
        sf_password_enc               NVARCHAR(MAX) NULL,
        sf_private_key_enc            NVARCHAR(MAX) NULL,
        sf_private_key_passphrase_enc NVARCHAR(MAX) NULL,
        -- Shared
        query_text                    NVARCHAR(MAX) NULL,
        sheet_alias                   NVARCHAR(100) NULL,
        is_active                     BIT           NOT NULL DEFAULT 1,
        created_at                    DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at                    DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_source_connections';
END
ELSE PRINT '[SKIP] conversion_source_connections';
GO

-- ── 3. conversion_xml_templates ───────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_xml_templates')
BEGIN
    CREATE TABLE conversion_xml_templates (
        id         INT           IDENTITY(1,1) PRIMARY KEY,
        project_id INT           NULL,
        conn_id    INT           NULL,
        name       NVARCHAR(200) NOT NULL,
        content    NVARCHAR(MAX) NULL,
        created_at DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_xml_templates';
END
ELSE PRINT '[SKIP] conversion_xml_templates';
GO

-- ── 4. conversion_mappings ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_mappings')
BEGIN
    CREATE TABLE conversion_mappings (
        id                INT           IDENTITY(1,1) PRIMARY KEY,
        project_id        INT           NULL,
        conn_id           INT           NULL,
        template_id       INT           NULL,
        version           INT           NOT NULL DEFAULT 1,
        is_active         BIT           NOT NULL DEFAULT 0,
        identifier_column NVARCHAR(255) NULL,
        identifier_table  NVARCHAR(255) NULL,
        created_at        DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_mappings';
END
ELSE PRINT '[SKIP] conversion_mappings';
GO

-- ── 5. conversion_mapping_rows ────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_mapping_rows')
BEGIN
    CREATE TABLE conversion_mapping_rows (
        id            INT           IDENTITY(1,1) PRIMARY KEY,
        mapping_id    INT           NOT NULL,
        source_sheet  NVARCHAR(100) NULL,
        source_column NVARCHAR(200) NULL,
        formula       NVARCHAR(MAX) NULL,
        target_path   NVARCHAR(MAX) NULL,
        each_sheet    NVARCHAR(100) NULL,
        sort_order    INT           NOT NULL DEFAULT 0,
        confidence    INT           NULL
    );
    PRINT '[OK] conversion_mapping_rows';
END
ELSE PRINT '[SKIP] conversion_mapping_rows';
GO

-- ── 6. conversion_run_logs ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_run_logs')
BEGIN
    CREATE TABLE conversion_run_logs (
        id            INT           IDENTITY(1,1) PRIMARY KEY,
        project_id    INT           NOT NULL,
        mapping_id    INT           NULL,
        triggered_by  NVARCHAR(50)  NOT NULL DEFAULT 'manual',
        status        NVARCHAR(20)  NOT NULL DEFAULT 'running',
        source_rows   NVARCHAR(MAX) NULL,
        output_xml    NVARCHAR(MAX) NULL,
        target_url    NVARCHAR(500) NULL,
        target_status INT           NULL,
        errors        NVARCHAR(MAX) NULL,
        started_at    DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        finished_at   DATETIME2     NULL
    );
    PRINT '[OK] conversion_run_logs';
END
ELSE PRINT '[SKIP] conversion_run_logs';
GO

-- ── 7. conversion_pii_policies ────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_pii_policies')
BEGIN
    CREATE TABLE conversion_pii_policies (
        id             INT           IDENTITY(1,1) PRIMARY KEY,
        project_id     INT           NOT NULL,
        source_id      INT           NULL,
        column_name    NVARCHAR(200) NOT NULL,
        pii_type       NVARCHAR(50)  NOT NULL,
        detection_mode NVARCHAR(20)  NOT NULL DEFAULT 'auto',
        action         NVARCHAR(20)  NOT NULL DEFAULT 'mask',
        mask_pattern   NVARCHAR(100) NULL,
        is_active      BIT           NOT NULL DEFAULT 1,
        created_at     DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at     DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_pii_policies';
END
ELSE PRINT '[SKIP] conversion_pii_policies';
GO

-- ── 8. conversion_pii_audit_logs ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_pii_audit_logs')
BEGIN
    CREATE TABLE conversion_pii_audit_logs (
        id             INT           IDENTITY(1,1) PRIMARY KEY,
        project_id     INT           NOT NULL,
        source_id      INT           NULL,
        run_id         INT           NULL,
        column_name    NVARCHAR(200) NOT NULL,
        pii_type       NVARCHAR(100) NULL,
        action_applied NVARCHAR(50)  NULL,
        row_count      INT           NOT NULL DEFAULT 0,
        accessed_at    DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_pii_audit_logs';
END
ELSE PRINT '[SKIP] conversion_pii_audit_logs';
GO

-- ── 9. conversion_catalog_columns ────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_catalog_columns')
BEGIN
    CREATE TABLE conversion_catalog_columns (
        id               INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id          INT           NOT NULL,
        table_schema     NVARCHAR(255) NULL,
        table_name       NVARCHAR(255) NOT NULL,
        column_name      NVARCHAR(255) NOT NULL,
        data_type        NVARCHAR(100) NULL,
        max_length       INT           NULL,
        is_nullable      NVARCHAR(10)  NULL,
        is_primary_key   BIT           NOT NULL DEFAULT 0,
        ordinal_position INT           NULL,
        discovered_at    DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_catalog_columns_conn ON conversion_catalog_columns (conn_id);
    PRINT '[OK] conversion_catalog_columns';
END
ELSE PRINT '[SKIP] conversion_catalog_columns';
GO

-- ── 10. conversion_catalog_relations ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_catalog_relations')
BEGIN
    CREATE TABLE conversion_catalog_relations (
        id                INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id           INT           NOT NULL,
        fk_name           NVARCHAR(255) NULL,
        parent_table      NVARCHAR(255) NOT NULL,
        parent_column     NVARCHAR(255) NOT NULL,
        referenced_table  NVARCHAR(255) NOT NULL,
        referenced_column NVARCHAR(255) NOT NULL,
        discovered_at     DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_catalog_relations_conn ON conversion_catalog_relations (conn_id);
    PRINT '[OK] conversion_catalog_relations';
END
ELSE PRINT '[SKIP] conversion_catalog_relations';
GO

-- ── 11. conversion_catalog_views ──────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_catalog_views')
BEGIN
    CREATE TABLE conversion_catalog_views (
        id              INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id         INT           NOT NULL,
        view_schema     NVARCHAR(255) NULL,
        view_name       NVARCHAR(255) NOT NULL,
        view_definition NVARCHAR(MAX) NULL,
        discovered_at   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_catalog_views_conn ON conversion_catalog_views (conn_id);
    PRINT '[OK] conversion_catalog_views';
END
ELSE PRINT '[SKIP] conversion_catalog_views';
GO

-- ── 12. conversion_catalog_samples ────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_catalog_samples')
BEGIN
    CREATE TABLE conversion_catalog_samples (
        id            INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id       INT           NOT NULL,
        table_schema  NVARCHAR(255) NULL,
        table_name    NVARCHAR(255) NOT NULL,
        row_count     INT           NULL,
        sample_json   NVARCHAR(MAX) NULL,
        discovered_at DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_catalog_samples_conn ON conversion_catalog_samples (conn_id);
    PRINT '[OK] conversion_catalog_samples';
END
ELSE PRINT '[SKIP] conversion_catalog_samples';
GO

-- ── 13. conversion_column_embeddings ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_column_embeddings')
BEGIN
    CREATE TABLE conversion_column_embeddings (
        id                INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id           INT           NOT NULL,
        table_schema      NVARCHAR(255) NULL,
        table_name        NVARCHAR(255) NOT NULL,
        column_name       NVARCHAR(255) NOT NULL,
        column_definition NVARCHAR(MAX) NULL,
        embedding_json    NVARCHAR(MAX) NULL,
        embedding_model   NVARCHAR(100) NULL,
        created_at        DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_column_embeddings_conn ON conversion_column_embeddings (conn_id);
    PRINT '[OK] conversion_column_embeddings';
END
ELSE PRINT '[SKIP] conversion_column_embeddings';
GO

-- ── 13b. conversion_query_examples ───────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_query_examples')
BEGIN
    CREATE TABLE conversion_query_examples (
        id          INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id     INT           NULL,
        name        NVARCHAR(255) NOT NULL,
        description NVARCHAR(MAX) NULL,
        tables_used NVARCHAR(500) NULL,
        example_sql NVARCHAR(MAX) NOT NULL,
        is_active   BIT           NOT NULL DEFAULT 1,
        created_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_query_examples_conn ON conversion_query_examples (conn_id);
    PRINT '[OK] conversion_query_examples';
END
ELSE PRINT '[SKIP] conversion_query_examples';
GO

-- ── 13c. conversion_query_context ────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_query_context')
BEGIN
    CREATE TABLE conversion_query_context (
        id         INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id    INT           NULL,
        content    NVARCHAR(MAX) NULL,
        updated_at DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_query_context_conn ON conversion_query_context (conn_id);
    PRINT '[OK] conversion_query_context';
END
ELSE PRINT '[SKIP] conversion_query_context';
GO

-- ── 14. conversion_target_formula_rules ──────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_target_formula_rules')
BEGIN
    CREATE TABLE conversion_target_formula_rules (
        id              INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id         INT           NULL,
        template_id     INT           NULL,
        target_path     NVARCHAR(MAX) NULL,
        group_path      NVARCHAR(MAX) NULL,
        formula_type    NVARCHAR(50)  NULL,
        expression      NVARCHAR(MAX) NULL,
        default_value   NVARCHAR(MAX) NULL,
        execution_order INT           NOT NULL DEFAULT 0,
        created_at      DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_target_formula_rules_conn ON conversion_target_formula_rules (conn_id);
    PRINT '[OK] conversion_target_formula_rules';
END
ELSE PRINT '[SKIP] conversion_target_formula_rules';
GO

-- ── 15. conversion_generated_queries ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_generated_queries')
BEGIN
    CREATE TABLE conversion_generated_queries (
        id           INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id      INT           NOT NULL,
        template_id  INT           NULL,
        mapping_id   INT           NULL,
        query_sql    NVARCHAR(MAX) NULL,
        generated_by NVARCHAR(20)  NOT NULL DEFAULT 'ai',
        created_at   DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_generated_queries_conn ON conversion_generated_queries (conn_id);
    PRINT '[OK] conversion_generated_queries';
END
ELSE PRINT '[SKIP] conversion_generated_queries';
GO

-- ── 16. conversion_generated_xml ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_generated_xml')
BEGIN
    CREATE TABLE conversion_generated_xml (
        id                 INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id            INT           NOT NULL,
        mapping_id         INT           NULL,
        identifier_value   NVARCHAR(500) NULL,
        xml_content        NVARCHAR(MAX) NULL,
        generated_at       DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        validation_status  NVARCHAR(20)  NULL,
        validation_comment NVARCHAR(MAX) NULL
    );
    CREATE INDEX IX_generated_xml_conn       ON conversion_generated_xml (conn_id);
    CREATE INDEX IX_generated_xml_identifier ON conversion_generated_xml (identifier_value);
    PRINT '[OK] conversion_generated_xml';
END
ELSE PRINT '[SKIP] conversion_generated_xml';
GO

-- ── 17. conversion_saved_reports ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_saved_reports')
BEGIN
    CREATE TABLE conversion_saved_reports (
        id         INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id    INT           NOT NULL,
        name       NVARCHAR(200) NOT NULL,
        query_sql  NVARCHAR(MAX) NOT NULL,
        created_at DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_saved_reports_conn ON conversion_saved_reports (conn_id);
    PRINT '[OK] conversion_saved_reports';
END
ELSE PRINT '[SKIP] conversion_saved_reports';
GO

-- ── 17b. conversion_schema_metadata ──────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_schema_metadata')
BEGIN
    CREATE TABLE conversion_schema_metadata (
        id          INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id     INT           NOT NULL,
        table_name  NVARCHAR(255) NOT NULL,
        column_name NVARCHAR(255) NULL,
        aliases     NVARCHAR(MAX) NULL,
        description NVARCHAR(MAX) NULL,
        updated_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_schema_metadata_conn ON conversion_schema_metadata (conn_id);
    PRINT '[OK] conversion_schema_metadata';
END
ELSE PRINT '[SKIP] conversion_schema_metadata';
GO

-- ── 18. conversion_validation_rules ──────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_validation_rules')
BEGIN
    CREATE TABLE conversion_validation_rules (
        id          INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id     INT           NOT NULL,
        target_path NVARCHAR(500) NOT NULL,
        is_required BIT           NOT NULL DEFAULT 0,
        data_type   NVARCHAR(50)  NULL,
        min_length  INT           NULL,
        max_length  INT           NULL,
        pattern     NVARCHAR(500) NULL,
        enumeration NVARCHAR(MAX) NULL,
        min_value   NVARCHAR(100) NULL,
        max_value   NVARCHAR(100) NULL
    );
    CREATE INDEX IX_validation_rules_conn ON conversion_validation_rules (conn_id);
    PRINT '[OK] conversion_validation_rules';
END
ELSE PRINT '[SKIP] conversion_validation_rules';
GO

-- ── 19. conversion_ps_conversations ──────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_conversations')
BEGIN
    CREATE TABLE conversion_ps_conversations (
        id         INT           IDENTITY(1,1) PRIMARY KEY,
        title      NVARCHAR(500) NULL,
        conn_id    INT           NULL,
        provider   NVARCHAR(50)  NOT NULL DEFAULT 'openai',
        model      NVARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
        created_at DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_ps_conversations';
END
ELSE PRINT '[SKIP] conversion_ps_conversations';
GO

-- ── 20. conversion_ps_messages ────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_messages')
BEGIN
    CREATE TABLE conversion_ps_messages (
        id               INT           IDENTITY(1,1) PRIMARY KEY,
        conversation_id  INT           NOT NULL,
        role             NVARCHAR(20)  NOT NULL,
        content          NVARCHAR(MAX) NULL,
        tool_name        NVARCHAR(100) NULL,
        tool_input_json  NVARCHAR(MAX) NULL,
        tool_output_json NVARCHAR(MAX) NULL,
        created_at       DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_ps_messages_conversation
            FOREIGN KEY (conversation_id) REFERENCES conversion_ps_conversations(id)
    );
    CREATE INDEX IX_ps_messages_conv ON conversion_ps_messages (conversation_id);
    PRINT '[OK] conversion_ps_messages';
END
ELSE PRINT '[SKIP] conversion_ps_messages';
GO

-- ── 21. conversion_ps_api_collection ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_api_collection')
BEGIN
    CREATE TABLE conversion_ps_api_collection (
        id              INT            IDENTITY(1,1) PRIMARY KEY,
        name            NVARCHAR(255)  NOT NULL,
        description     NVARCHAR(1000) NULL,
        url             NVARCHAR(2000) NOT NULL,
        method          NVARCHAR(10)   NOT NULL DEFAULT 'POST',
        headers_json    NVARCHAR(MAX)  NULL,
        body_template   NVARCHAR(MAX)  NULL,
        required_fields NVARCHAR(MAX)  NULL,
        auth_type       NVARCHAR(20)   NOT NULL DEFAULT 'none',
        auth_value_enc  NVARCHAR(MAX)  NULL,
        conn_id         INT            NULL,
        is_active       BIT            NOT NULL DEFAULT 1,
        created_at      DATETIME2      NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_ps_api_collection';
END
ELSE PRINT '[SKIP] conversion_ps_api_collection';
GO

-- ── 22. conversion_ps_workflows ───────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_workflows')
BEGIN
    CREATE TABLE conversion_ps_workflows (
        id              INT            IDENTITY(1,1) PRIMARY KEY,
        name            NVARCHAR(255)  NOT NULL,
        description     NVARCHAR(1000) NULL,
        conn_id         INT            NULL,
        conversation_id INT            NULL,
        is_active       BIT            NOT NULL DEFAULT 1,
        created_at      DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
        updated_at      DATETIME2      NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_ps_workflows';
END
ELSE PRINT '[SKIP] conversion_ps_workflows';
GO

-- ── 22b. conversion_ps_workflow_steps ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_workflow_steps')
BEGIN
    CREATE TABLE conversion_ps_workflow_steps (
        id          INT           IDENTITY(1,1) PRIMARY KEY,
        workflow_id INT           NOT NULL,
        step_order  INT           NOT NULL DEFAULT 0,
        step_type   NVARCHAR(50)  NOT NULL,
        label       NVARCHAR(255) NULL,
        config_json NVARCHAR(MAX) NULL,
        created_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_workflow_steps_workflow
            FOREIGN KEY (workflow_id) REFERENCES conversion_ps_workflows(id)
    );
    PRINT '[OK] conversion_ps_workflow_steps';
END
ELSE PRINT '[SKIP] conversion_ps_workflow_steps';
GO

-- ── 22c. conversion_ps_workflow_schedules ─────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_workflow_schedules')
BEGIN
    CREATE TABLE conversion_ps_workflow_schedules (
        id               INT          IDENTITY(1,1) PRIMARY KEY,
        workflow_id      INT          NOT NULL,
        schedule_type    NVARCHAR(20) NOT NULL DEFAULT 'manual',
        interval_minutes INT          NULL,
        run_at_time      NVARCHAR(10) NULL,
        run_on_day       INT          NULL,
        is_enabled       BIT          NOT NULL DEFAULT 1,
        next_run_at      DATETIME2    NULL,
        last_run_at      DATETIME2    NULL,
        created_at       DATETIME2    NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_workflow_schedules_workflow
            FOREIGN KEY (workflow_id) REFERENCES conversion_ps_workflows(id)
    );
    PRINT '[OK] conversion_ps_workflow_schedules';
END
ELSE PRINT '[SKIP] conversion_ps_workflow_schedules';
GO

-- ── 22d. conversion_ps_workflow_runs ──────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_workflow_runs')
BEGIN
    CREATE TABLE conversion_ps_workflow_runs (
        id           INT           IDENTITY(1,1) PRIMARY KEY,
        workflow_id  INT           NOT NULL,
        triggered_by NVARCHAR(20)  NOT NULL DEFAULT 'manual',
        status       NVARCHAR(20)  NOT NULL DEFAULT 'running',
        started_at   DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        finished_at  DATETIME2     NULL,
        summary_json NVARCHAR(MAX) NULL,
        CONSTRAINT FK_workflow_runs_workflow
            FOREIGN KEY (workflow_id) REFERENCES conversion_ps_workflows(id)
    );
    PRINT '[OK] conversion_ps_workflow_runs';
END
ELSE PRINT '[SKIP] conversion_ps_workflow_runs';
GO

-- ── 22e. conversion_ps_workflow_run_steps ─────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_workflow_run_steps')
BEGIN
    CREATE TABLE conversion_ps_workflow_run_steps (
        id            INT            IDENTITY(1,1) PRIMARY KEY,
        run_id        INT            NOT NULL,
        step_id       INT            NULL,
        step_order    INT            NOT NULL DEFAULT 0,
        step_type     NVARCHAR(50)   NOT NULL,
        label         NVARCHAR(255)  NULL,
        status        NVARCHAR(20)   NOT NULL DEFAULT 'pending',
        output_json   NVARCHAR(MAX)  NULL,
        error_message NVARCHAR(2000) NULL,
        executed_at   DATETIME2      NULL,
        CONSTRAINT FK_workflow_run_steps_run
            FOREIGN KEY (run_id) REFERENCES conversion_ps_workflow_runs(id)
    );
    PRINT '[OK] conversion_ps_workflow_run_steps';
END
ELSE PRINT '[SKIP] conversion_ps_workflow_run_steps';
GO

-- ── 23. conversion_ps_email_settings ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_email_settings')
BEGIN
    CREATE TABLE conversion_ps_email_settings (
        id            INT           IDENTITY(1,1) PRIMARY KEY,
        smtp_host     NVARCHAR(255) NOT NULL,
        smtp_port     INT           NOT NULL DEFAULT 587,
        smtp_user     NVARCHAR(255) NULL,
        smtp_pass_enc NVARCHAR(MAX) NULL,
        from_address  NVARCHAR(255) NOT NULL,
        use_tls       BIT           NOT NULL DEFAULT 1,
        is_active     BIT           NOT NULL DEFAULT 1,
        created_at    DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_ps_email_settings';
END
ELSE PRINT '[SKIP] conversion_ps_email_settings';
GO

-- ── 24. conversion_dashboard_configs ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_dashboard_configs')
BEGIN
    CREATE TABLE conversion_dashboard_configs (
        id          INT           IDENTITY(1,1) PRIMARY KEY,
        project_id  INT           NULL,
        conn_id     INT           NULL,
        name        NVARCHAR(200) NOT NULL,
        description NVARCHAR(500) NULL,
        config_json NVARCHAR(MAX) NOT NULL,
        debug_json  NVARCHAR(MAX) NULL,
        created_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_dashboard_configs';
END
ELSE PRINT '[SKIP] conversion_dashboard_configs';
GO

PRINT '';
PRINT '============================================================';
PRINT ' V2 complete — all tables created / verified.';
PRINT '============================================================';
GO
