-- ═══════════════════════════════════════════════════════════════
-- 08_sai_agent.sql  — SAI Ops: Autonomous Operations Platform
-- Run after 07_sai_knowledge.sql
-- ═══════════════════════════════════════════════════════════════

-- SAI Run: one row per triggered autonomous run
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_sai_runs')
CREATE TABLE conversion_sai_runs (
    id                     INT IDENTITY(1,1) PRIMARY KEY,
    project_id             INT            NULL,
    request_text           NVARCHAR(MAX)  NOT NULL,
    event_type             NVARCHAR(100)  NULL,
    mode                   NVARCHAR(20)   NOT NULL DEFAULT 'manual',
    status                 NVARCHAR(20)   NOT NULL DEFAULT 'running',
    findings_json          NVARCHAR(MAX)  NULL,
    report_json            NVARCHAR(MAX)  NULL,
    actions_taken_json     NVARCHAR(MAX)  NULL,
    knowledge_sources_json NVARCHAR(MAX)  NULL,
    conn_ids_json          NVARCHAR(MAX)  NULL,
    started_at             DATETIME2      DEFAULT GETUTCDATE(),
    completed_at           DATETIME2      NULL
);
GO

-- SAI Step: per-agent step result within a run
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_sai_steps')
CREATE TABLE conversion_sai_steps (
    id                     INT IDENTITY(1,1) PRIMARY KEY,
    run_id                 INT            NOT NULL,
    step_number            INT            NOT NULL,
    agent_name             NVARCHAR(100)  NOT NULL,
    status                 NVARCHAR(20)   NOT NULL DEFAULT 'pending',
    output_json            NVARCHAR(MAX)  NULL,
    knowledge_sources_json NVARCHAR(MAX)  NULL,
    elapsed_ms             INT            NULL,
    created_at             DATETIME2      DEFAULT GETUTCDATE(),
    CONSTRAINT FK_sai_steps_run FOREIGN KEY (run_id)
        REFERENCES conversion_sai_runs(id) ON DELETE CASCADE
);
GO

-- SAI Finding: one classified issue per run
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_sai_findings')
CREATE TABLE conversion_sai_findings (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    run_id          INT            NOT NULL,
    issue_type      NVARCHAR(100)  NOT NULL,
    severity        NVARCHAR(20)   NOT NULL,
    system_impacted NVARCHAR(200)  NULL,
    description     NVARCHAR(MAX)  NULL,
    evidence_json   NVARCHAR(MAX)  NULL,
    owner_team      NVARCHAR(200)  NULL,
    action_taken    NVARCHAR(500)  NULL,
    action_status   NVARCHAR(50)   NULL,
    created_at      DATETIME2      DEFAULT GETUTCDATE(),
    CONSTRAINT FK_sai_findings_run FOREIGN KEY (run_id)
        REFERENCES conversion_sai_runs(id) ON DELETE CASCADE
);
GO

-- SAI Event: inbound event log (ETL failure, API spike, etc.)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_sai_events')
CREATE TABLE conversion_sai_events (
    id                INT IDENTITY(1,1) PRIMARY KEY,
    project_id        INT            NULL,
    event_type        NVARCHAR(100)  NOT NULL,
    source_system     NVARCHAR(200)  NULL,
    payload_json      NVARCHAR(MAX)  NULL,
    triggered_run_id  INT            NULL,
    created_at        DATETIME2      DEFAULT GETUTCDATE()
);
GO

-- SAI Config: per-project operational mode + action permissions
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_sai_config')
CREATE TABLE conversion_sai_config (
    id                   INT IDENTITY(1,1) PRIMARY KEY,
    project_id           INT            NOT NULL UNIQUE,
    mode                 NVARCHAR(20)   NOT NULL DEFAULT 'manual',
    allowed_actions_json NVARCHAR(MAX)  NULL,
    updated_at           DATETIME2      DEFAULT GETUTCDATE()
);
GO

-- SAI Operational Memory: learned patterns and successful remediations
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_sai_operational_memory')
CREATE TABLE conversion_sai_operational_memory (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    project_id          INT            NULL,
    fingerprint         NVARCHAR(64)   NOT NULL,
    issue_type          NVARCHAR(100)  NULL,
    system_impacted     NVARCHAR(200)  NULL,
    description_summary NVARCHAR(MAX)  NULL,
    frequency           INT            NOT NULL DEFAULT 1,
    last_seen_at        DATETIME2      NULL,
    successful_fix_json NVARCHAR(MAX)  NULL,
    pattern_json        NVARCHAR(MAX)  NULL,
    created_at          DATETIME2      DEFAULT GETUTCDATE(),
    updated_at          DATETIME2      DEFAULT GETUTCDATE()
);
GO

-- SAI Approval Queue: assisted-mode pending actions
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_sai_approval_queue')
CREATE TABLE conversion_sai_approval_queue (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    run_id              INT            NOT NULL,
    finding_id          INT            NULL,
    action_type         NVARCHAR(100)  NOT NULL,
    action_payload_json NVARCHAR(MAX)  NULL,
    status              NVARCHAR(20)   NOT NULL DEFAULT 'pending',
    approver            NVARCHAR(200)  NULL,
    decided_at          DATETIME2      NULL,
    created_at          DATETIME2      DEFAULT GETUTCDATE(),
    CONSTRAINT FK_sai_approval_run FOREIGN KEY (run_id)
        REFERENCES conversion_sai_runs(id) ON DELETE CASCADE
);
GO

PRINT 'SAI Ops tables created successfully.';
