-- ============================================================
-- 02_feature_tables.sql
-- ConversionAgent — Feature tables
-- Covers: PS, Email, Dashboard, Dispatch, Pipeline,
--         AI Platform, Agentic Workflow, Reconciliation
-- Safe to re-run: all CREATE TABLE statements are guarded.
-- ============================================================

USE [ConversionAgent];
GO

-- ── PS Conversations ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_conversations')
BEGIN
    CREATE TABLE conversion_ps_conversations (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        title      NVARCHAR(500)  NULL,
        conn_id    INT            NULL,
        provider   NVARCHAR(50)   NOT NULL DEFAULT 'openai',
        model      NVARCHAR(100)  NOT NULL DEFAULT 'gpt-4o-mini',
        created_at DATETIME2      DEFAULT GETUTCDATE(),
        updated_at DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_ps_conversations';
END
ELSE PRINT '  conversion_ps_conversations already exists - skipped';
GO

-- ── PS Messages ──────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_messages')
BEGIN
    CREATE TABLE conversion_ps_messages (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        conversation_id  INT            NOT NULL,
        role             NVARCHAR(20)   NOT NULL,
        content          NVARCHAR(MAX)  NULL,
        tool_name        NVARCHAR(100)  NULL,
        tool_input_json  NVARCHAR(MAX)  NULL,
        tool_output_json NVARCHAR(MAX)  NULL,
        created_at       DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT FK_ps_messages_conv FOREIGN KEY (conversation_id)
            REFERENCES conversion_ps_conversations(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_ps_messages';
END
ELSE PRINT '  conversion_ps_messages already exists - skipped';
GO

-- ── PS API Collection ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_api_collection')
BEGIN
    CREATE TABLE conversion_ps_api_collection (
        id              INT IDENTITY(1,1) PRIMARY KEY,
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
        created_at      DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_ps_api_collection';
END
ELSE PRINT '  conversion_ps_api_collection already exists - skipped';
GO

-- ── PS Workflows ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_workflows')
BEGIN
    CREATE TABLE conversion_ps_workflows (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        name            NVARCHAR(255)  NOT NULL,
        description     NVARCHAR(1000) NULL,
        conn_id         INT            NULL,
        conversation_id INT            NULL,
        is_active       BIT            NOT NULL DEFAULT 1,
        created_at      DATETIME2      DEFAULT GETUTCDATE(),
        updated_at      DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_ps_workflows';
END
ELSE PRINT '  conversion_ps_workflows already exists - skipped';
GO

-- ── PS Workflow Steps ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_workflow_steps')
BEGIN
    CREATE TABLE conversion_ps_workflow_steps (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        workflow_id INT            NOT NULL,
        step_order  INT            NOT NULL DEFAULT 0,
        step_type   NVARCHAR(50)   NOT NULL,
        label       NVARCHAR(255)  NULL,
        config_json NVARCHAR(MAX)  NULL,
        created_at  DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT FK_ps_steps_workflow FOREIGN KEY (workflow_id)
            REFERENCES conversion_ps_workflows(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_ps_workflow_steps';
END
ELSE PRINT '  conversion_ps_workflow_steps already exists - skipped';
GO

-- ── PS Workflow Schedules ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_workflow_schedules')
BEGIN
    CREATE TABLE conversion_ps_workflow_schedules (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        workflow_id      INT            NOT NULL,
        schedule_type    NVARCHAR(20)   NOT NULL DEFAULT 'manual',
        interval_minutes INT            NULL,
        run_at_time      NVARCHAR(10)   NULL,
        run_on_day       INT            NULL,
        is_enabled       BIT            NOT NULL DEFAULT 1,
        next_run_at      DATETIME2      NULL,
        last_run_at      DATETIME2      NULL,
        created_at       DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT FK_ps_schedules_workflow FOREIGN KEY (workflow_id)
            REFERENCES conversion_ps_workflows(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_ps_workflow_schedules';
END
ELSE PRINT '  conversion_ps_workflow_schedules already exists - skipped';
GO

-- ── PS Workflow Runs ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_workflow_runs')
BEGIN
    CREATE TABLE conversion_ps_workflow_runs (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        workflow_id  INT            NOT NULL,
        triggered_by NVARCHAR(20)   NOT NULL DEFAULT 'manual',
        status       NVARCHAR(20)   NOT NULL DEFAULT 'running',
        started_at   DATETIME2      DEFAULT GETUTCDATE(),
        finished_at  DATETIME2      NULL,
        summary_json NVARCHAR(MAX)  NULL,
        CONSTRAINT FK_ps_runs_workflow FOREIGN KEY (workflow_id)
            REFERENCES conversion_ps_workflows(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_ps_workflow_runs';
END
ELSE PRINT '  conversion_ps_workflow_runs already exists - skipped';
GO

-- ── PS Workflow Run Steps ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_workflow_run_steps')
BEGIN
    CREATE TABLE conversion_ps_workflow_run_steps (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        run_id        INT            NOT NULL,
        step_id       INT            NULL,
        step_order    INT            NOT NULL DEFAULT 0,
        step_type     NVARCHAR(50)   NOT NULL,
        label         NVARCHAR(255)  NULL,
        status        NVARCHAR(20)   NOT NULL DEFAULT 'pending',
        output_json   NVARCHAR(MAX)  NULL,
        error_message NVARCHAR(2000) NULL,
        executed_at   DATETIME2      NULL,
        CONSTRAINT FK_ps_run_steps_run FOREIGN KEY (run_id)
            REFERENCES conversion_ps_workflow_runs(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_ps_workflow_run_steps';
END
ELSE PRINT '  conversion_ps_workflow_run_steps already exists - skipped';
GO

-- ── PS Email Settings ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ps_email_settings')
BEGIN
    CREATE TABLE conversion_ps_email_settings (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        smtp_host     NVARCHAR(255)  NOT NULL,
        smtp_port     INT            NOT NULL DEFAULT 587,
        smtp_user     NVARCHAR(255)  NULL,
        smtp_pass_enc NVARCHAR(MAX)  NULL,
        from_address  NVARCHAR(255)  NOT NULL,
        use_tls       BIT            NOT NULL DEFAULT 1,
        is_active     BIT            NOT NULL DEFAULT 1,
        created_at    DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_ps_email_settings';
END
ELSE PRINT '  conversion_ps_email_settings already exists - skipped';
GO

-- ── Dashboard Configs ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_dashboard_configs')
BEGIN
    CREATE TABLE conversion_dashboard_configs (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        project_id  INT            NULL,
        conn_id     INT            NULL,
        name        NVARCHAR(200)  NOT NULL,
        description NVARCHAR(500)  NULL,
        config_json NVARCHAR(MAX)  NOT NULL,
        debug_json  NVARCHAR(MAX)  NULL,
        created_at  DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_dashboard_configs';
END
ELSE PRINT '  conversion_dashboard_configs already exists - skipped';
GO

-- ── Schema Enrichment Sessions ───────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_enrich_sessions')
BEGIN
    CREATE TABLE conversion_enrich_sessions (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        conn_id    INT            NOT NULL,
        title      NVARCHAR(500)  NULL,
        created_at DATETIME2      DEFAULT GETUTCDATE(),
        updated_at DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_enrich_sessions';
END
ELSE PRINT '  conversion_enrich_sessions already exists - skipped';
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_enrich_messages')
BEGIN
    CREATE TABLE conversion_enrich_messages (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        session_id INT            NOT NULL,
        role       NVARCHAR(20)   NOT NULL,
        content    NVARCHAR(MAX)  NOT NULL,
        created_at DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT FK_enrich_msg_session FOREIGN KEY (session_id)
            REFERENCES conversion_enrich_sessions(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_enrich_messages';
END
ELSE PRINT '  conversion_enrich_messages already exists - skipped';
GO

-- ── API Dispatch Config ──────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_api_dispatch_configs')
BEGIN
    CREATE TABLE conversion_api_dispatch_configs (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        conn_id          INT            NOT NULL UNIQUE,
        dispatch_type    NVARCHAR(20)   NULL     DEFAULT 'api',
        endpoint_url     NVARCHAR(2000) NULL,
        method           NVARCHAR(10)   NOT NULL DEFAULT 'POST',
        content_type     NVARCHAR(100)  NULL     DEFAULT 'application/xml',
        auth_type        NVARCHAR(20)   NULL     DEFAULT 'none',
        auth_value_enc   NVARCHAR(MAX)  NULL,
        auth_header_name NVARCHAR(200)  NULL,
        extra_headers    NVARCHAR(MAX)  NULL,
        sftp_host        NVARCHAR(500)  NULL,
        sftp_port        INT            NULL     DEFAULT 22,
        sftp_username    NVARCHAR(200)  NULL,
        sftp_password_enc NVARCHAR(MAX) NULL,
        sftp_remote_path NVARCHAR(2000) NULL,
        azure_conn_str_enc NVARCHAR(MAX) NULL,
        azure_container  NVARCHAR(500)  NULL,
        azure_blob_prefix NVARCHAR(1000) NULL,
        updated_at       DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_api_dispatch_configs';
END
ELSE PRINT '  conversion_api_dispatch_configs already exists - skipped';
GO

-- ── API Dispatch Logs ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_api_dispatch_logs')
BEGIN
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
    );
    PRINT '  Created conversion_api_dispatch_logs';
END
ELSE PRINT '  conversion_api_dispatch_logs already exists - skipped';
GO

-- ── Pipeline Schedules ───────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_pipeline_schedules')
BEGIN
    CREATE TABLE conversion_pipeline_schedules (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        conn_id          INT            NOT NULL UNIQUE,
        schedule_type    NVARCHAR(20)   NOT NULL DEFAULT 'manual',
        interval_minutes INT            NULL,
        run_at_time      NVARCHAR(10)   NULL,
        run_on_day       INT            NULL,
        is_enabled       BIT            NOT NULL DEFAULT 1,
        skip_mapping     BIT            NOT NULL DEFAULT 0,
        next_run_at      DATETIME2      NULL,
        last_run_at      DATETIME2      NULL,
        last_run_status  NVARCHAR(20)   NULL,
        created_at       DATETIME2      DEFAULT GETUTCDATE(),
        updated_at       DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_pipeline_schedules';
END
ELSE PRINT '  conversion_pipeline_schedules already exists - skipped';
GO

-- ── Pipeline Runs ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_pipeline_runs')
BEGIN
    CREATE TABLE conversion_pipeline_runs (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        conn_id      INT            NOT NULL,
        triggered_by NVARCHAR(20)   NOT NULL DEFAULT 'manual',
        status       NVARCHAR(20)   NOT NULL DEFAULT 'running',
        steps_json   NVARCHAR(MAX)  NULL,
        started_at   DATETIME2      DEFAULT GETUTCDATE(),
        finished_at  DATETIME2      NULL
    );
    PRINT '  Created conversion_pipeline_runs';
END
ELSE PRINT '  conversion_pipeline_runs already exists - skipped';
GO

-- ── AI Trace Log ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ai_trace_log')
BEGIN
    CREATE TABLE conversion_ai_trace_log (
        id                 INT IDENTITY(1,1) PRIMARY KEY,
        module             NVARCHAR(50)   NOT NULL,
        conn_id            INT            NULL,
        model              NVARCHAR(100)  NOT NULL,
        prompt_text        NVARCHAR(MAX)  NULL,
        response_text      NVARCHAR(MAX)  NULL,
        tokens_in          INT            NULL,
        tokens_out         INT            NULL,
        latency_ms         INT            NULL,
        sql_executed       NVARCHAR(MAX)  NULL,
        row_count_returned INT            NULL,
        schema_snapshot    NVARCHAR(MAX)  NULL,
        export_action      NVARCHAR(50)   NULL,
        created_at         DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_ai_trace_log';
END
ELSE PRINT '  conversion_ai_trace_log already exists - skipped';
GO

-- ── Dev Artifacts ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_dev_artifacts')
BEGIN
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
    );
    PRINT '  Created conversion_dev_artifacts';
END
ELSE PRINT '  conversion_dev_artifacts already exists - skipped';
GO

-- ── Prompt Templates ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_prompt_templates')
BEGIN
    CREATE TABLE conversion_prompt_templates (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        name           NVARCHAR(200)  NOT NULL UNIQUE,
        description    NVARCHAR(500)  NULL,
        category       NVARCHAR(100)  NULL,
        content        NVARCHAR(MAX)  NOT NULL,
        example_output NVARCHAR(MAX)  NULL,
        is_active      BIT            NOT NULL DEFAULT 1,
        created_at     DATETIME2      DEFAULT GETUTCDATE(),
        updated_at     DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_prompt_templates';
END
ELSE PRINT '  conversion_prompt_templates already exists - skipped';
GO

-- ── AI Agents ────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ai_agents')
BEGIN
    CREATE TABLE conversion_ai_agents (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(200)  NOT NULL,
        description NVARCHAR(1000) NULL,
        goal        NVARCHAR(MAX)  NOT NULL,
        conn_id     INT            NULL,
        schedule    NVARCHAR(100)  NULL     DEFAULT 'manual',
        status      NVARCHAR(20)   NOT NULL DEFAULT 'active',
        role_id     INT            NULL,
        category    NVARCHAR(100)  NULL,
        tools_json  NVARCHAR(MAX)  NULL,
        created_at  DATETIME2      DEFAULT GETUTCDATE(),
        updated_at  DATETIME2      DEFAULT GETUTCDATE(),
        last_run_at DATETIME2      NULL
    );
    PRINT '  Created conversion_ai_agents';
END
ELSE PRINT '  conversion_ai_agents already exists - skipped';
GO

-- ── AI Agent Logs ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ai_agent_logs')
BEGIN
    CREATE TABLE conversion_ai_agent_logs (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        agent_id       INT            NOT NULL,
        status         NVARCHAR(20)   NOT NULL DEFAULT 'running',
        generated_plan NVARCHAR(MAX)  NULL,
        steps_executed INT            NULL     DEFAULT 0,
        result_summary NVARCHAR(MAX)  NULL,
        error          NVARCHAR(2000) NULL,
        execution_time INT            NULL,
        created_at     DATETIME2      DEFAULT GETUTCDATE(),
        finished_at    DATETIME2      NULL,
        CONSTRAINT FK_agent_logs_agent FOREIGN KEY (agent_id)
            REFERENCES conversion_ai_agents(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_ai_agent_logs';
END
ELSE PRINT '  conversion_ai_agent_logs already exists - skipped';
GO

-- ── AI Test Cases ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ai_test_cases')
BEGIN
    CREATE TABLE conversion_ai_test_cases (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        group_name          NVARCHAR(200)  NULL,
        name                NVARCHAR(200)  NOT NULL,
        source_conn_id      INT            NULL,
        target_conn_id      INT            NULL,
        source_query        NVARCHAR(MAX)  NOT NULL,
        target_query        NVARCHAR(MAX)  NOT NULL,
        validation_type     NVARCHAR(50)   NOT NULL DEFAULT 'count',
        threshold           NVARCHAR(100)  NULL     DEFAULT '0',
        schedule_cron       NVARCHAR(100)  NULL,
        identifier_column   NVARCHAR(500)  NULL,
        reconciliation_type NVARCHAR(50)   NULL,
        columns_to_compare  NVARCHAR(2000) NULL,
        created_at          DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_ai_test_cases';
END
ELSE PRINT '  conversion_ai_test_cases already exists - skipped';
GO

-- ── AI Test Results ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ai_test_results')
BEGIN
    CREATE TABLE conversion_ai_test_results (
        id                   INT IDENTITY(1,1) PRIMARY KEY,
        test_case_id         INT            NOT NULL,
        execution_time       INT            NULL,
        result               NVARCHAR(10)   NOT NULL DEFAULT 'pending',
        source_value         NVARCHAR(500)  NULL,
        target_value         NVARCHAR(500)  NULL,
        difference           NVARCHAR(500)  NULL,
        remarks              NVARCHAR(MAX)  NULL,
        mismatch_count        INT            NULL,
        missing_source_count  INT            NULL,
        missing_target_count  INT            NULL,
        sample_mismatches     NVARCHAR(MAX)  NULL,
        sample_missing_source NVARCHAR(MAX)  NULL,
        sample_missing_target NVARCHAR(MAX)  NULL,
        ran_at               DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT FK_test_results_case FOREIGN KEY (test_case_id)
            REFERENCES conversion_ai_test_cases(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_ai_test_results';
END
ELSE PRINT '  conversion_ai_test_results already exists - skipped';
GO

-- ── Feedback ─────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_feedback')
BEGIN
    CREATE TABLE conversion_feedback (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        submitted_by NVARCHAR(100)  NULL,
        module       NVARCHAR(100)  NULL,
        area         NVARCHAR(200)  NULL,
        type         NVARCHAR(50)   NOT NULL,
        priority     NVARCHAR(20)   NULL,
        title        NVARCHAR(500)  NOT NULL,
        description  NVARCHAR(MAX)  NULL,
        page_url     NVARCHAR(500)  NULL,
        status       NVARCHAR(30)   NOT NULL DEFAULT 'open',
        admin_notes  NVARCHAR(MAX)  NULL,
        created_at   DATETIME2      DEFAULT GETUTCDATE(),
        updated_at   DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_feedback';
END
ELSE PRINT '  conversion_feedback already exists - skipped';
GO

-- ── Schema Metadata extra tables ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_schema_metadata')
BEGIN
    CREATE TABLE conversion_schema_metadata (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        conn_id          INT            NOT NULL,
        table_name       NVARCHAR(255)  NOT NULL,
        column_name      NVARCHAR(255)  NULL,
        aliases          NVARCHAR(MAX)  NULL,
        description      NVARCHAR(MAX)  NULL,
        business_context NVARCHAR(MAX)  NULL,
        synonyms         NVARCHAR(MAX)  NULL,
        updated_at       DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_schema_metadata';
END
ELSE PRINT '  conversion_schema_metadata already exists - skipped';
GO

-- ── Report Sessions ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_report_sessions')
BEGIN
    CREATE TABLE conversion_report_sessions (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        conn_id         INT            NOT NULL,
        user_id         INT            NULL,
        title           NVARCHAR(500)  NULL,
        session_summary NVARCHAR(MAX)  NULL,
        created_at      DATETIME2      DEFAULT GETUTCDATE(),
        updated_at      DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_report_sessions';
END
ELSE PRINT '  conversion_report_sessions already exists - skipped';
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_report_session_messages')
BEGIN
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
    );
    PRINT '  Created conversion_report_session_messages';
END
ELSE PRINT '  conversion_report_session_messages already exists - skipped';
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_report_session_documents')
BEGIN
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
    );
    PRINT '  Created conversion_report_session_documents';
END
ELSE PRINT '  conversion_report_session_documents already exists - skipped';
GO
