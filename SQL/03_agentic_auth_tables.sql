-- ============================================================
-- 03_agentic_auth_tables.sql
-- ConversionAgent — Agentic Workflow, Auth, Approval & Reconciliation tables
-- Safe to re-run: all CREATE TABLE statements are guarded.
-- ============================================================

USE [ConversionAgent];
GO

-- ── Agent Roles ──────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_agent_roles')
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
    PRINT '  Created conversion_agent_roles';
END
ELSE PRINT '  conversion_agent_roles already exists - skipped';
GO

-- ── Agent Cards ──────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_agent_cards')
BEGIN
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
        on_reject_card_id INT          NULL,
        max_iterations  INT            NOT NULL DEFAULT 3,
        created_at      DATETIME2      DEFAULT GETUTCDATE(),
        updated_at      DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_agent_cards';
END
ELSE PRINT '  conversion_agent_cards already exists - skipped';
GO

-- ── Workflow Executions ──────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_workflow_executions')
BEGIN
    CREATE TABLE conversion_workflow_executions (
        id                      INT IDENTITY(1,1) PRIMARY KEY,
        conn_id                 INT            NULL,
        user_query              NVARCHAR(MAX)  NOT NULL,
        model                   NVARCHAR(100)  NOT NULL DEFAULT 'gpt-4o-mini',
        status                  NVARCHAR(30)   NOT NULL DEFAULT 'running',
        total_steps             INT            NOT NULL DEFAULT 0,
        completed_steps         INT            NOT NULL DEFAULT 0,
        final_summary           NVARCHAR(MAX)  NULL,
        created_at              DATETIME2      DEFAULT GETUTCDATE(),
        finished_at             DATETIME2      NULL,
        hitl_required           BIT            NOT NULL DEFAULT 1,
        human_approved_at       DATETIME2      NULL,
        human_approved_by       NVARCHAR(200)  NULL,
        human_rejection_reason  NVARCHAR(MAX)  NULL,
        project_id              INT            NULL,
        paused_card_id          INT            NULL
    );
    PRINT '  Created conversion_workflow_executions';
END
ELSE PRINT '  conversion_workflow_executions already exists - skipped';
GO

-- ── Workflow Execution Steps ─────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_workflow_execution_steps')
BEGIN
    CREATE TABLE conversion_workflow_execution_steps (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        execution_id        INT            NOT NULL,
        step_number         INT            NOT NULL,
        card_id             INT            NULL,
        card_name           NVARCHAR(200)  NULL,
        role_name           NVARCHAR(200)  NULL,
        agent_name          NVARCHAR(200)  NULL,
        iteration           INT            NOT NULL DEFAULT 1,
        decision            NVARCHAR(20)   NULL,
        decision_notes      NVARCHAR(MAX)  NULL,
        input_text          NVARCHAR(MAX)  NULL,
        output_text         NVARCHAR(MAX)  NULL,
        prompt_used         NVARCHAR(MAX)  NULL,
        status              NVARCHAR(30)   NOT NULL DEFAULT 'pending',
        execution_time_ms   INT            NULL,
        approval_request_id INT            NULL,
        created_at          DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT FK_wf_exec_steps FOREIGN KEY (execution_id)
            REFERENCES conversion_workflow_executions(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_workflow_execution_steps';
END
ELSE PRINT '  conversion_workflow_execution_steps already exists - skipped';
GO

-- ── Saved Agentic Workflows ──────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_saved_agentic_workflows')
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
    PRINT '  Created conversion_saved_agentic_workflows';
END
ELSE PRINT '  conversion_saved_agentic_workflows already exists - skipped';
GO

-- ── Agent HITL Pending Approvals ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_pending_approvals')
BEGIN
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
    );
    PRINT '  Created conversion_pending_approvals';
END
ELSE PRINT '  conversion_pending_approvals already exists - skipped';
GO

-- ── Tool Execution Audit Log ─────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_tool_executions')
BEGIN
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
    );
    PRINT '  Created conversion_tool_executions';
END
ELSE PRINT '  conversion_tool_executions already exists - skipped';
GO

-- ── Auth: Users ──────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_users')
BEGIN
    CREATE TABLE conversion_users (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        username        NVARCHAR(100)  NOT NULL,
        email           NVARCHAR(255)  NULL,
        hashed_password NVARCHAR(255)  NOT NULL,
        is_active       BIT            NOT NULL DEFAULT 1,
        created_at      DATETIME2      DEFAULT GETUTCDATE(),
        last_login      DATETIME2      NULL,
        CONSTRAINT uq_users_username UNIQUE (username)
    );
    PRINT '  Created conversion_users';
END
ELSE PRINT '  conversion_users already exists - skipped';
GO

-- ── Auth: User Roles ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_user_roles')
BEGIN
    CREATE TABLE conversion_user_roles (
        id      INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT            NOT NULL,
        role    NVARCHAR(50)   NOT NULL,
        CONSTRAINT uq_user_role UNIQUE (user_id, role),
        CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id)
            REFERENCES conversion_users(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_user_roles';
END
ELSE PRINT '  conversion_user_roles already exists - skipped';
GO

-- ── Project Members ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_project_members')
BEGIN
    CREATE TABLE conversion_project_members (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        project_id   INT            NOT NULL,
        user_id      INT            NOT NULL,
        project_role NVARCHAR(50)   NOT NULL,
        joined_at    DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT uq_project_member UNIQUE (project_id, user_id),
        CONSTRAINT fk_pm_project FOREIGN KEY (project_id)
            REFERENCES conversion_projects(id) ON DELETE CASCADE,
        CONSTRAINT fk_pm_user FOREIGN KEY (user_id)
            REFERENCES conversion_users(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_project_members';
END
ELSE PRINT '  conversion_project_members already exists - skipped';
GO

-- ── Approval Workflows ───────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_approval_workflows')
BEGIN
    CREATE TABLE conversion_approval_workflows (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        project_id  INT            NOT NULL,
        name        NVARCHAR(200)  NOT NULL,
        description NVARCHAR(MAX)  NULL,
        is_active   BIT            NOT NULL DEFAULT 1,
        quorum_type NVARCHAR(20)   NULL     DEFAULT 'any_one',
        created_at  DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT fk_aw_project FOREIGN KEY (project_id)
            REFERENCES conversion_projects(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_approval_workflows';
END
ELSE PRINT '  conversion_approval_workflows already exists - skipped';
GO

-- ── Approval Workflow Steps ──────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_approval_workflow_steps')
BEGIN
    CREATE TABLE conversion_approval_workflow_steps (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        workflow_id   INT            NOT NULL,
        step_order    INT            NOT NULL,
        step_name     NVARCHAR(200)  NOT NULL,
        required_role NVARCHAR(50)   NOT NULL,
        CONSTRAINT fk_aws_workflow FOREIGN KEY (workflow_id)
            REFERENCES conversion_approval_workflows(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_approval_workflow_steps';
END
ELSE PRINT '  conversion_approval_workflow_steps already exists - skipped';
GO

-- ── Approval Requests ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_approval_requests')
BEGIN
    CREATE TABLE conversion_approval_requests (
        id                 INT IDENTITY(1,1) PRIMARY KEY,
        project_id         INT            NOT NULL,
        workflow_id        INT            NULL,
        triggered_by       INT            NOT NULL,
        context_type       NVARCHAR(50)   NOT NULL,
        context_id         NVARCHAR(200)  NULL,
        current_step_order INT            NOT NULL DEFAULT 1,
        status             NVARCHAR(50)   NOT NULL DEFAULT 'pending',
        context_payload    NVARCHAR(MAX)  NULL,
        sql_hash           NVARCHAR(64)   NULL,
        created_at         DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT fk_ar_project FOREIGN KEY (project_id)
            REFERENCES conversion_projects(id),
        CONSTRAINT fk_ar_triggered_by FOREIGN KEY (triggered_by)
            REFERENCES conversion_users(id)
    );
    PRINT '  Created conversion_approval_requests';
END
ELSE PRINT '  conversion_approval_requests already exists - skipped';
GO

-- ── Approval Request Decisions ───────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_approval_request_decisions')
BEGIN
    CREATE TABLE conversion_approval_request_decisions (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        request_id    INT            NOT NULL,
        step_order    INT            NOT NULL,
        step_name     NVARCHAR(200)  NOT NULL,
        required_role NVARCHAR(50)   NOT NULL,
        decided_by    INT            NULL,
        decision      NVARCHAR(20)   NULL,
        notes         NVARCHAR(MAX)  NULL,
        decided_at    DATETIME2      NULL,
        CONSTRAINT fk_ard_request FOREIGN KEY (request_id)
            REFERENCES conversion_approval_requests(id) ON DELETE CASCADE,
        CONSTRAINT fk_ard_user FOREIGN KEY (decided_by)
            REFERENCES conversion_users(id)
    );
    PRINT '  Created conversion_approval_request_decisions';
END
ELSE PRINT '  conversion_approval_request_decisions already exists - skipped';
GO

-- ── Notifications ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_notifications')
BEGIN
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
    );
    PRINT '  Created conversion_notifications';
END
ELSE PRINT '  conversion_notifications already exists - skipped';
GO

-- ── Agent-Based Pipeline Tables ──────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_column_profile')
BEGIN
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
    );
    PRINT '  Created conversion_column_profile';
END
ELSE PRINT '  conversion_column_profile already exists - skipped';
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_query_versions')
BEGIN
    CREATE TABLE conversion_query_versions (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        conn_id          INT            NOT NULL,
        version          INT            NOT NULL DEFAULT 1,
        sql_text         NVARCHAR(MAX)  NOT NULL,
        mapping_snapshot NVARCHAR(MAX)  NULL,
        agent_run_id     INT            NULL,
        created_at       DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_query_versions';
END
ELSE PRINT '  conversion_query_versions already exists - skipped';
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_agent_run_logs')
BEGIN
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
    );
    PRINT '  Created conversion_agent_run_logs';
END
ELSE PRINT '  conversion_agent_run_logs already exists - skipped';
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_validation_results')
BEGIN
    CREATE TABLE conversion_validation_results (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        conn_id    INT            NOT NULL,
        xml_id     INT            NULL,
        check_name NVARCHAR(200)  NOT NULL,
        passed     BIT            NOT NULL DEFAULT 1,
        detail     NVARCHAR(MAX)  NULL,
        created_at DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_validation_results';
END
ELSE PRINT '  conversion_validation_results already exists - skipped';
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_value_mappings')
BEGIN
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
    );
    PRINT '  Created conversion_value_mappings';
END
ELSE PRINT '  conversion_value_mappings already exists - skipped';
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_business_rules')
BEGIN
    CREATE TABLE conversion_business_rules (
        id                   INT IDENTITY(1,1) PRIMARY KEY,
        conn_id              INT            NULL,
        rule_name            NVARCHAR(255)  NOT NULL,
        priority             INT            NOT NULL DEFAULT 0,
        condition_json       NVARCHAR(MAX)  NULL,
        transformation_json  NVARCHAR(MAX)  NULL,
        is_active            BIT            NOT NULL DEFAULT 1,
        created_at           DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_business_rules';
END
ELSE PRINT '  conversion_business_rules already exists - skipped';
GO

-- ── Dev vs Base Reconciliation ───────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_test_queries')
BEGIN
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
    );
    PRINT '  Created conversion_test_queries';
END
ELSE PRINT '  conversion_test_queries already exists - skipped';
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_reconciliation_results')
BEGIN
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
    );
    PRINT '  Created conversion_reconciliation_results';
END
ELSE PRINT '  conversion_reconciliation_results already exists - skipped';
GO
