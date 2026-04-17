-- ============================================================
-- V6: Agentic AI Platform
-- Database:  ConversionAgent (DESKTOP-G01PH8C\SQLEXPRESS)
-- Safe to run multiple times (all guarded with IF NOT EXISTS)
-- ============================================================

USE ConversionAgent;
GO

-- ── 1. Extend conversion_ai_agents ────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_ai_agents' AND COLUMN_NAME='category')
    ALTER TABLE conversion_ai_agents ADD category NVARCHAR(100) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_ai_agents' AND COLUMN_NAME='role_id')
    ALTER TABLE conversion_ai_agents ADD role_id INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_ai_agents' AND COLUMN_NAME='input_schema')
    ALTER TABLE conversion_ai_agents ADD input_schema NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_ai_agents' AND COLUMN_NAME='output_schema')
    ALTER TABLE conversion_ai_agents ADD output_schema NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_ai_agents' AND COLUMN_NAME='tools_json')
    ALTER TABLE conversion_ai_agents ADD tools_json NVARCHAR(MAX) NULL;
GO

-- ── 2. conversion_agent_roles ─────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='conversion_agent_roles')
BEGIN
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
    );
    PRINT 'Created conversion_agent_roles';
END
GO

-- ── 3. conversion_agent_cards ─────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='conversion_agent_cards')
BEGIN
    CREATE TABLE conversion_agent_cards (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        name              NVARCHAR(200)  NOT NULL,
        description       NVARCHAR(1000) NULL,
        role_id           INT            NULL,
        agent_id          INT            NULL,
        execution_order   INT            NOT NULL DEFAULT 0,
        input_mapping     NVARCHAR(MAX)  NULL,
        output_mapping    NVARCHAR(MAX)  NULL,
        on_reject_card_id INT            NULL,
        max_iterations    INT            NOT NULL DEFAULT 3,
        is_mandatory      BIT            NOT NULL DEFAULT 1,
        is_active         BIT            NOT NULL DEFAULT 1,
        created_at        DATETIME2      DEFAULT GETUTCDATE(),
        updated_at        DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT 'Created conversion_agent_cards';
END
GO

-- Add loop-back columns if the table already existed without them
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_agent_cards' AND COLUMN_NAME='on_reject_card_id')
    ALTER TABLE conversion_agent_cards ADD on_reject_card_id INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_agent_cards' AND COLUMN_NAME='max_iterations')
    ALTER TABLE conversion_agent_cards ADD max_iterations INT NOT NULL DEFAULT 3;
GO

-- ── 4. conversion_workflow_executions ─────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='conversion_workflow_executions')
BEGIN
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
    );
    PRINT 'Created conversion_workflow_executions';
END
GO

-- ── 5. conversion_workflow_execution_steps ────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='conversion_workflow_execution_steps')
BEGIN
    CREATE TABLE conversion_workflow_execution_steps (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        execution_id      INT            NOT NULL,
        step_number       INT            NOT NULL,
        card_id           INT            NULL,
        card_name         NVARCHAR(200)  NULL,
        role_name         NVARCHAR(200)  NULL,
        agent_name        NVARCHAR(200)  NULL,
        iteration         INT            NOT NULL DEFAULT 1,
        input_text        NVARCHAR(MAX)  NULL,
        output_text       NVARCHAR(MAX)  NULL,
        prompt_used       NVARCHAR(MAX)  NULL,
        status            NVARCHAR(30)   NOT NULL DEFAULT 'pending',
        decision          NVARCHAR(20)   NULL,
        decision_notes    NVARCHAR(MAX)  NULL,
        execution_time_ms INT            NULL,
        created_at        DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT FK_wf_exec_steps FOREIGN KEY (execution_id)
            REFERENCES conversion_workflow_executions(id)
    );
    PRINT 'Created conversion_workflow_execution_steps';
END
GO

-- Add columns if table already existed without them
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_workflow_execution_steps' AND COLUMN_NAME='card_id')
    ALTER TABLE conversion_workflow_execution_steps ADD card_id INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_workflow_execution_steps' AND COLUMN_NAME='iteration')
    ALTER TABLE conversion_workflow_execution_steps ADD iteration INT NOT NULL DEFAULT 1;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_workflow_execution_steps' AND COLUMN_NAME='decision')
    ALTER TABLE conversion_workflow_execution_steps ADD decision NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_workflow_execution_steps' AND COLUMN_NAME='decision_notes')
    ALTER TABLE conversion_workflow_execution_steps ADD decision_notes NVARCHAR(MAX) NULL;
GO

-- ── 6. conversion_saved_agentic_workflows ─────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='conversion_saved_agentic_workflows')
BEGIN
    CREATE TABLE conversion_saved_agentic_workflows (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        name              NVARCHAR(200)  NOT NULL,
        description       NVARCHAR(1000) NULL,
        user_query        NVARCHAR(MAX)  NOT NULL,
        conn_id           INT            NULL,
        model             NVARCHAR(100)  NOT NULL DEFAULT 'gpt-4o-mini',
        schedule_label    NVARCHAR(50)   NULL,
        last_run_at       DATETIME2      NULL,
        last_execution_id INT            NULL,
        is_active         BIT            NOT NULL DEFAULT 1,
        created_at        DATETIME2      DEFAULT GETUTCDATE(),
        updated_at        DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT 'Created conversion_saved_agentic_workflows';
END
GO

-- ── 7. conversion_dashboard_configs — add debug_json ─────────────────────────

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='conversion_dashboard_configs' AND COLUMN_NAME='debug_json')
    ALTER TABLE conversion_dashboard_configs ADD debug_json NVARCHAR(MAX) NULL;
GO

PRINT '=== V6 migration complete ===';
GO
