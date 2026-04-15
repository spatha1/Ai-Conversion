-- ============================================================
-- V5__migrations.sql
-- ConversionAgent — Incremental Schema Patches (Session 6+)
--
-- Safe to re-run: every statement is guarded by an existence
-- check.  New patches go at the BOTTOM of this file.
--
-- Run as: clarityAgentuser (db_owner)
-- Target: ConversionAgent
-- Depends: V2__create_tables.sql, V4__migrations.sql
--
-- What this covers (vs V4):
--   5.1  – 5.2   conversion_schema_metadata  — business_context, synonyms
--   5.3  – 5.4   conversion_enrich_sessions / _messages  (NEW tables)
--   5.5  – 5.6   conversion_api_dispatch_configs / _logs (NEW tables)
--   5.7          conversion_ai_trace_log                 (NEW table)
--   5.8          conversion_dev_artifacts                (NEW table)
--   5.9          conversion_prompt_templates             (NEW table)
--   5.10 – 5.11  conversion_ai_agents / _agent_logs      (NEW tables)
--   5.12 – 5.13  conversion_ai_test_cases / _results     (NEW tables)
--   5.14         conversion_prompt_templates.example_output (upgrade patch)
--   5.15 – 5.16  conversion_ai_test_cases.group_name / schedule_cron
-- ============================================================

USE [ConversionAgent];
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.1  conversion_schema_metadata — add business_context
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_schema_metadata' AND COLUMN_NAME = 'business_context'
)
BEGIN
    ALTER TABLE conversion_schema_metadata ADD business_context NVARCHAR(MAX) NULL;
    PRINT '[OK] conversion_schema_metadata.business_context added.';
END
ELSE PRINT '[SKIP] conversion_schema_metadata.business_context already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.2  conversion_schema_metadata — add synonyms
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_schema_metadata' AND COLUMN_NAME = 'synonyms'
)
BEGIN
    ALTER TABLE conversion_schema_metadata ADD synonyms NVARCHAR(MAX) NULL;
    PRINT '[OK] conversion_schema_metadata.synonyms added.';
END
ELSE PRINT '[SKIP] conversion_schema_metadata.synonyms already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.3  NEW TABLE: conversion_enrich_sessions
--            Schema enrichment AI chat sessions
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_enrich_sessions')
BEGIN
    CREATE TABLE conversion_enrich_sessions (
        id         INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id    INT           NOT NULL,
        title      NVARCHAR(500) NULL,
        created_at DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_enrich_sessions created.';
END
ELSE PRINT '[SKIP] conversion_enrich_sessions already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.4  NEW TABLE: conversion_enrich_messages
--            Messages within a schema enrichment session
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_enrich_messages')
BEGIN
    CREATE TABLE conversion_enrich_messages (
        id         INT           IDENTITY(1,1) PRIMARY KEY,
        session_id INT           NOT NULL,
        role       NVARCHAR(20)  NOT NULL,
        content    NVARCHAR(MAX) NOT NULL,
        created_at DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_enrich_messages_session ON conversion_enrich_messages (session_id);
    PRINT '[OK] conversion_enrich_messages created.';
END
ELSE PRINT '[SKIP] conversion_enrich_messages already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.5  NEW TABLE: conversion_api_dispatch_configs
--            Per-connection API dispatch configuration
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_api_dispatch_configs')
BEGIN
    CREATE TABLE conversion_api_dispatch_configs (
        id               INT            IDENTITY(1,1) PRIMARY KEY,
        conn_id          INT            NOT NULL UNIQUE,
        endpoint_url     NVARCHAR(2000) NULL,
        method           NVARCHAR(10)   NOT NULL DEFAULT 'POST',
        content_type     NVARCHAR(100)  NULL     DEFAULT 'application/xml',
        auth_type        NVARCHAR(20)   NULL     DEFAULT 'none',
        auth_value_enc   NVARCHAR(MAX)  NULL,
        auth_header_name NVARCHAR(200)  NULL,
        extra_headers    NVARCHAR(MAX)  NULL,
        updated_at       DATETIME2      NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT '[OK] conversion_api_dispatch_configs created.';
END
ELSE PRINT '[SKIP] conversion_api_dispatch_configs already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.6  NEW TABLE: conversion_api_dispatch_logs
--            Log of every XML dispatch HTTP call
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_api_dispatch_logs')
BEGIN
    CREATE TABLE conversion_api_dispatch_logs (
        id               INT            IDENTITY(1,1) PRIMARY KEY,
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
        sent_at          DATETIME2      NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_dispatch_logs_conn   ON conversion_api_dispatch_logs (conn_id);
    CREATE INDEX IX_dispatch_logs_xml_id ON conversion_api_dispatch_logs (xml_id);
    PRINT '[OK] conversion_api_dispatch_logs created.';
END
ELSE PRINT '[SKIP] conversion_api_dispatch_logs already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.7  NEW TABLE: conversion_ai_trace_log
--            AI call audit trail (module, tokens, latency)
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ai_trace_log')
BEGIN
    CREATE TABLE conversion_ai_trace_log (
        id            INT            IDENTITY(1,1) PRIMARY KEY,
        module        NVARCHAR(50)   NOT NULL,
        conn_id       INT            NULL,
        model         NVARCHAR(100)  NOT NULL,
        prompt_text   NVARCHAR(MAX)  NULL,
        response_text NVARCHAR(MAX)  NULL,
        tokens_in     INT            NULL,
        tokens_out    INT            NULL,
        latency_ms    INT            NULL,
        created_at    DATETIME2      NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_ai_trace_module ON conversion_ai_trace_log (module);
    CREATE INDEX IX_ai_trace_conn   ON conversion_ai_trace_log (conn_id);
    PRINT '[OK] conversion_ai_trace_log created.';
END
ELSE PRINT '[SKIP] conversion_ai_trace_log already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.8  NEW TABLE: conversion_dev_artifacts
--            AI-generated SQL plan + artifacts per task
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_dev_artifacts')
BEGIN
    CREATE TABLE conversion_dev_artifacts (
        id               INT           IDENTITY(1,1) PRIMARY KEY,
        conn_id          INT           NULL,
        project_id       INT           NULL,
        task_description NVARCHAR(MAX) NOT NULL,
        plan_json        NVARCHAR(MAX) NULL,
        artifacts_json   NVARCHAR(MAX) NULL,
        pipeline_config  NVARCHAR(MAX) NULL,
        status           NVARCHAR(20)  NOT NULL DEFAULT 'draft',
        created_at       DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at       DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_dev_artifacts_conn ON conversion_dev_artifacts (conn_id);
    PRINT '[OK] conversion_dev_artifacts created.';
END
ELSE PRINT '[SKIP] conversion_dev_artifacts already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.9  NEW TABLE: conversion_prompt_templates
--            Admin-editable AI system prompts per module
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_prompt_templates')
BEGIN
    CREATE TABLE conversion_prompt_templates (
        id             INT            IDENTITY(1,1) PRIMARY KEY,
        name           NVARCHAR(200)  NOT NULL UNIQUE,
        description    NVARCHAR(500)  NULL,
        category       NVARCHAR(100)  NULL,
        content        NVARCHAR(MAX)  NOT NULL,
        example_output NVARCHAR(MAX)  NULL,
        is_active      BIT            NOT NULL DEFAULT 1,
        created_at     DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
        updated_at     DATETIME2      NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_prompt_templates_category ON conversion_prompt_templates (category);
    PRINT '[OK] conversion_prompt_templates created.';
END
ELSE PRINT '[SKIP] conversion_prompt_templates already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.10  NEW TABLE: conversion_ai_agents
--             Autonomous AI co-worker agent definitions
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ai_agents')
BEGIN
    CREATE TABLE conversion_ai_agents (
        id          INT            IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(200)  NOT NULL,
        description NVARCHAR(1000) NULL,
        goal        NVARCHAR(MAX)  NOT NULL,
        conn_id     INT            NULL,
        schedule    NVARCHAR(100)  NULL DEFAULT 'manual',
        status      NVARCHAR(20)   NOT NULL DEFAULT 'active',
        created_at  DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
        updated_at  DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
        last_run_at DATETIME2      NULL
    );
    PRINT '[OK] conversion_ai_agents created.';
END
ELSE PRINT '[SKIP] conversion_ai_agents already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.11  NEW TABLE: conversion_ai_agent_logs
--             Execution log per agent run
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ai_agent_logs')
BEGIN
    CREATE TABLE conversion_ai_agent_logs (
        id             INT            IDENTITY(1,1) PRIMARY KEY,
        agent_id       INT            NOT NULL,
        status         NVARCHAR(20)   NOT NULL DEFAULT 'running',
        generated_plan NVARCHAR(MAX)  NULL,
        steps_executed INT            NULL DEFAULT 0,
        result_summary NVARCHAR(MAX)  NULL,
        error          NVARCHAR(2000) NULL,
        execution_time INT            NULL,
        created_at     DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
        finished_at    DATETIME2      NULL,
        CONSTRAINT FK_agent_logs_agent
            FOREIGN KEY (agent_id) REFERENCES conversion_ai_agents(id)
    );
    CREATE INDEX IX_agent_logs_agent ON conversion_ai_agent_logs (agent_id);
    PRINT '[OK] conversion_ai_agent_logs created.';
END
ELSE PRINT '[SKIP] conversion_ai_agent_logs already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.12  NEW TABLE: conversion_ai_test_cases
--             Data reconciliation test case definitions
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ai_test_cases')
BEGIN
    CREATE TABLE conversion_ai_test_cases (
        id              INT            IDENTITY(1,1) PRIMARY KEY,
        group_name      NVARCHAR(200)  NULL,
        name            NVARCHAR(200)  NOT NULL,
        source_conn_id  INT            NULL,
        target_conn_id  INT            NULL,
        source_query    NVARCHAR(MAX)  NOT NULL,
        target_query    NVARCHAR(MAX)  NOT NULL,
        validation_type NVARCHAR(50)   NOT NULL DEFAULT 'count',
        threshold       NVARCHAR(100)  NULL     DEFAULT '0',
        schedule_cron   NVARCHAR(100)  NULL,
        created_at      DATETIME2      NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_test_cases_group ON conversion_ai_test_cases (group_name);
    PRINT '[OK] conversion_ai_test_cases created.';
END
ELSE PRINT '[SKIP] conversion_ai_test_cases already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 5.13  NEW TABLE: conversion_ai_test_results
--             Execution results per test case run
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ai_test_results')
BEGIN
    CREATE TABLE conversion_ai_test_results (
        id             INT            IDENTITY(1,1) PRIMARY KEY,
        test_case_id   INT            NOT NULL,
        execution_time INT            NULL,
        result         NVARCHAR(10)   NOT NULL DEFAULT 'pending',
        source_value   NVARCHAR(500)  NULL,
        target_value   NVARCHAR(500)  NULL,
        difference     NVARCHAR(500)  NULL,
        remarks        NVARCHAR(MAX)  NULL,
        ran_at         DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_test_results_case
            FOREIGN KEY (test_case_id) REFERENCES conversion_ai_test_cases(id)
    );
    CREATE INDEX IX_test_results_case ON conversion_ai_test_results (test_case_id);
    PRINT '[OK] conversion_ai_test_results created.';
END
ELSE PRINT '[SKIP] conversion_ai_test_results already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- Upgrade patches for tables that may already exist without
-- the newer columns
-- ─────────────────────────────────────────────────────────────

-- PATCH 5.14  conversion_prompt_templates — add example_output
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_prompt_templates' AND COLUMN_NAME = 'example_output'
)
BEGIN
    ALTER TABLE conversion_prompt_templates ADD example_output NVARCHAR(MAX) NULL;
    PRINT '[OK] conversion_prompt_templates.example_output added.';
END
ELSE PRINT '[SKIP] conversion_prompt_templates.example_output already exists.';
GO

-- PATCH 5.15  conversion_ai_test_cases — add group_name
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_ai_test_cases' AND COLUMN_NAME = 'group_name'
)
BEGIN
    ALTER TABLE conversion_ai_test_cases ADD group_name NVARCHAR(200) NULL;
    PRINT '[OK] conversion_ai_test_cases.group_name added.';
END
ELSE PRINT '[SKIP] conversion_ai_test_cases.group_name already exists.';
GO

-- PATCH 5.16  conversion_ai_test_cases — add schedule_cron
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_ai_test_cases' AND COLUMN_NAME = 'schedule_cron'
)
BEGIN
    ALTER TABLE conversion_ai_test_cases ADD schedule_cron NVARCHAR(100) NULL;
    PRINT '[OK] conversion_ai_test_cases.schedule_cron added.';
END
ELSE PRINT '[SKIP] conversion_ai_test_cases.schedule_cron already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- ▼▼▼  FUTURE PATCHES — add below this line  ▼▼▼
-- Template:
--
-- PATCH 5.N  <table> — <reason>
-- IF NOT EXISTS (
--     SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
--     WHERE TABLE_NAME = '<table>' AND COLUMN_NAME = '<column>'
-- )
-- BEGIN
--     ALTER TABLE <table> ADD <column> <type> <constraint>;
--     PRINT '[OK] <table>.<column> added.';
-- END
-- ELSE PRINT '[SKIP] <table>.<column> already exists.';
-- GO
-- ─────────────────────────────────────────────────────────────

PRINT '';
PRINT '============================================================';
PRINT ' V5 complete — all migration patches applied.';
PRINT ' NOTE: Run "python -m api.migrate" to also seed default';
PRINT '       prompt templates into conversion_prompt_templates.';
PRINT '============================================================';
GO
