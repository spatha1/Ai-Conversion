-- ============================================================
-- V7: Latest Migrations — Multi-Format Templates, Dispatch
--     Channels (SFTP / Azure Blob), Pipeline Scheduler, Auth
-- Database:  ConversionAgent (DESKTOP-G01PH8C\SQLEXPRESS)
-- Safe to run multiple times (all guarded with IF NOT EXISTS)
-- ============================================================

USE ConversionAgent;
GO

-- ── 1. conversion_xml_templates — add format_type ─────────────────────────────
--    Tracks whether the template is XML, JSON, text, or SQL.
--    Default 'xml' so existing rows continue to work without changes.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='conversion_xml_templates' AND COLUMN_NAME='format_type'
)
BEGIN
    ALTER TABLE conversion_xml_templates
        ADD format_type NVARCHAR(20) NULL DEFAULT 'xml';
    PRINT 'Added conversion_xml_templates.format_type';
END
GO

-- ── 2. conversion_api_dispatch_configs — SFTP & Azure Blob columns ────────────
--    dispatch_type: 'api' | 'sftp' | 'azure_blob'

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='conversion_api_dispatch_configs' AND COLUMN_NAME='dispatch_type'
)
BEGIN
    ALTER TABLE conversion_api_dispatch_configs
        ADD dispatch_type NVARCHAR(20) NULL DEFAULT 'api';
    PRINT 'Added conversion_api_dispatch_configs.dispatch_type';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='conversion_api_dispatch_configs' AND COLUMN_NAME='sftp_host'
)
BEGIN
    ALTER TABLE conversion_api_dispatch_configs
        ADD sftp_host NVARCHAR(500) NULL;
    PRINT 'Added conversion_api_dispatch_configs.sftp_host';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='conversion_api_dispatch_configs' AND COLUMN_NAME='sftp_port'
)
BEGIN
    ALTER TABLE conversion_api_dispatch_configs
        ADD sftp_port INT NULL DEFAULT 22;
    PRINT 'Added conversion_api_dispatch_configs.sftp_port';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='conversion_api_dispatch_configs' AND COLUMN_NAME='sftp_username'
)
BEGIN
    ALTER TABLE conversion_api_dispatch_configs
        ADD sftp_username NVARCHAR(200) NULL;
    PRINT 'Added conversion_api_dispatch_configs.sftp_username';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='conversion_api_dispatch_configs' AND COLUMN_NAME='sftp_password_enc'
)
BEGIN
    ALTER TABLE conversion_api_dispatch_configs
        ADD sftp_password_enc NVARCHAR(MAX) NULL;
    PRINT 'Added conversion_api_dispatch_configs.sftp_password_enc';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='conversion_api_dispatch_configs' AND COLUMN_NAME='sftp_remote_path'
)
BEGIN
    ALTER TABLE conversion_api_dispatch_configs
        ADD sftp_remote_path NVARCHAR(2000) NULL;
    PRINT 'Added conversion_api_dispatch_configs.sftp_remote_path';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='conversion_api_dispatch_configs' AND COLUMN_NAME='azure_conn_str_enc'
)
BEGIN
    ALTER TABLE conversion_api_dispatch_configs
        ADD azure_conn_str_enc NVARCHAR(MAX) NULL;
    PRINT 'Added conversion_api_dispatch_configs.azure_conn_str_enc';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='conversion_api_dispatch_configs' AND COLUMN_NAME='azure_container'
)
BEGIN
    ALTER TABLE conversion_api_dispatch_configs
        ADD azure_container NVARCHAR(500) NULL;
    PRINT 'Added conversion_api_dispatch_configs.azure_container';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='conversion_api_dispatch_configs' AND COLUMN_NAME='azure_blob_prefix'
)
BEGIN
    ALTER TABLE conversion_api_dispatch_configs
        ADD azure_blob_prefix NVARCHAR(1000) NULL;
    PRINT 'Added conversion_api_dispatch_configs.azure_blob_prefix';
END
GO

-- ── 3. conversion_api_dispatch_logs — add request_body ────────────────────────
--    Stores the raw payload sent on each dispatch attempt for audit.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='conversion_api_dispatch_logs' AND COLUMN_NAME='request_body'
)
BEGIN
    ALTER TABLE conversion_api_dispatch_logs
        ADD request_body NVARCHAR(MAX) NULL;
    PRINT 'Added conversion_api_dispatch_logs.request_body';
END
GO

-- ── 4. conversion_pipeline_schedules ──────────────────────────────────────────
--    One row per connection.  Controls when the full pipeline runs.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME='conversion_pipeline_schedules'
)
BEGIN
    CREATE TABLE conversion_pipeline_schedules (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        conn_id          INT          NOT NULL,
        schedule_type    NVARCHAR(20) NOT NULL DEFAULT 'manual',
                         -- 'manual' | 'interval' | 'daily' | 'weekly'
        interval_minutes INT          NULL,
        run_at_time      NVARCHAR(10) NULL,   -- 'HH:MM'
        run_on_day       INT          NULL,   -- 0=Mon … 6=Sun
        is_enabled       BIT          NOT NULL DEFAULT 1,
        next_run_at      DATETIME2    NULL,
        last_run_at      DATETIME2    NULL,
        last_run_status  NVARCHAR(20) NULL,   -- success | fail | partial
        created_at       DATETIME2    NOT NULL DEFAULT GETUTCDATE(),
        updated_at       DATETIME2    NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT UQ_pipeline_schedules_conn UNIQUE (conn_id)
    );
    PRINT 'Created conversion_pipeline_schedules';
END
GO

-- ── 5. conversion_pipeline_runs ───────────────────────────────────────────────
--    History of every full-pipeline execution.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME='conversion_pipeline_runs'
)
BEGIN
    CREATE TABLE conversion_pipeline_runs (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        conn_id      INT          NOT NULL,
        triggered_by NVARCHAR(20) NOT NULL DEFAULT 'manual',  -- manual | schedule
        status       NVARCHAR(20) NOT NULL DEFAULT 'running', -- running | success | fail | partial
        steps_json   NVARCHAR(MAX) NULL,   -- JSON list of step result dicts
        started_at   DATETIME2    NOT NULL DEFAULT GETUTCDATE(),
        finished_at  DATETIME2    NULL
    );
    CREATE INDEX IX_pipeline_runs_conn ON conversion_pipeline_runs (conn_id);
    PRINT 'Created conversion_pipeline_runs';
END
GO

-- ── 6. conversion_users ───────────────────────────────────────────────────────
--    Application users with hashed passwords (bcrypt via passlib).

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME='conversion_users'
)
BEGIN
    CREATE TABLE conversion_users (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        username        NVARCHAR(100) NOT NULL,
        email           NVARCHAR(255) NULL,
        hashed_password NVARCHAR(255) NOT NULL,
        is_active       BIT           NOT NULL DEFAULT 1,
        created_at      DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        last_login      DATETIME2     NULL,
        CONSTRAINT UQ_users_username UNIQUE (username),
        CONSTRAINT UQ_users_email    UNIQUE (email)
    );
    CREATE INDEX IX_users_username ON conversion_users (username);
    CREATE INDEX IX_users_email    ON conversion_users (email);
    PRINT 'Created conversion_users';
END
GO

-- ── 7. conversion_user_roles ──────────────────────────────────────────────────
--    Junction table: user ↔ roles.  Valid roles: admin | developer | viewer.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME='conversion_user_roles'
)
BEGIN
    CREATE TABLE conversion_user_roles (
        id      INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT          NOT NULL,
        role    NVARCHAR(50) NOT NULL,   -- admin | developer | viewer
        CONSTRAINT FK_user_roles_user
            FOREIGN KEY (user_id) REFERENCES conversion_users (id) ON DELETE CASCADE,
        CONSTRAINT UQ_user_role UNIQUE (user_id, role)
    );
    CREATE INDEX IX_user_roles_user ON conversion_user_roles (user_id);
    PRINT 'Created conversion_user_roles';
END
GO

PRINT '=== V7 migration complete ===';
GO
