-- ============================================================
-- Reconciliation Engine v2 — SQL Deployment Script
-- Run against: ConversionAgent database (DESKTOP-G01PH8C\SQLEXPRESS)
-- Date: 2026-04-18
-- ============================================================

-- ── 1. Create conversion_test_queries (if not exists) ────────────────────────
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
        dev_source_tag    NVARCHAR(200)  NULL,
        created_at        DATETIME2      DEFAULT GETUTCDATE()
    )
    PRINT 'Created conversion_test_queries'
END
ELSE
    PRINT 'conversion_test_queries already exists — skipped'
GO

-- ── 2. Create conversion_reconciliation_results (if not exists) ──────────────
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
    )
    PRINT 'Created conversion_reconciliation_results'
END
ELSE
    PRINT 'conversion_reconciliation_results already exists — skipped'
GO

-- ── 3. Add dev_source_tag column (if missing) ────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_test_queries' AND COLUMN_NAME = 'dev_source_tag'
)
BEGIN
    ALTER TABLE conversion_test_queries
        ADD dev_source_tag NVARCHAR(200) NULL
    PRINT 'Added dev_source_tag to conversion_test_queries'
END
ELSE
BEGIN
    -- Widen from NVARCHAR(30) to NVARCHAR(200) to support comma-separated multi-tags
    DECLARE @col_len INT
    SELECT @col_len = CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_test_queries' AND COLUMN_NAME = 'dev_source_tag'

    IF @col_len < 200
    BEGIN
        ALTER TABLE conversion_test_queries
            ALTER COLUMN dev_source_tag NVARCHAR(200) NULL
        PRINT 'Widened dev_source_tag to NVARCHAR(200)'
    END
    ELSE
        PRINT 'dev_source_tag already NVARCHAR(200) — skipped'
END
GO

-- ── 4. Indexes for common query patterns ─────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_test_queries_conn_id' AND object_id = OBJECT_ID('conversion_test_queries'))
BEGIN
    CREATE INDEX IX_test_queries_conn_id ON conversion_test_queries (conn_id)
    PRINT 'Created index IX_test_queries_conn_id'
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_recon_results_conn_run' AND object_id = OBJECT_ID('conversion_reconciliation_results'))
BEGIN
    CREATE INDEX IX_recon_results_conn_run ON conversion_reconciliation_results (conn_id, run_id)
    PRINT 'Created index IX_recon_results_conn_run'
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_recon_results_created' AND object_id = OBJECT_ID('conversion_reconciliation_results'))
BEGIN
    CREATE INDEX IX_recon_results_created ON conversion_reconciliation_results (conn_id, created_at DESC)
    PRINT 'Created index IX_recon_results_created'
END
GO

-- ── 5. Verify ─────────────────────────────────────────────────────────────────
SELECT
    TABLE_NAME,
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('conversion_test_queries', 'conversion_reconciliation_results')
ORDER BY TABLE_NAME, ORDINAL_POSITION
GO

PRINT '=== Deployment complete ==='
