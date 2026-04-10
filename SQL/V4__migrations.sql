-- ============================================================
-- V4__migrations.sql
-- ConversionAgent — Incremental Schema Patches
--
-- Safe to re-run: every ALTER is guarded by a column-exists
-- check.  Add new patches at the BOTTOM of each section.
--
-- Run as: clarityAgentuser (db_owner)
-- Target: ConversionAgent
-- Version: 4
-- Depends: V2__create_tables.sql
-- ============================================================

USE [ConversionAgent];
GO

-- ── Helper: avoid repeating IF NOT EXISTS boilerplate ────────
-- We use INFORMATION_SCHEMA.COLUMNS inline for each patch.

-- ─────────────────────────────────────────────────────────────
-- PATCH 4.1  conversion_xml_templates — add conn_id
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_xml_templates' AND COLUMN_NAME = 'conn_id'
)
BEGIN
    ALTER TABLE conversion_xml_templates ADD conn_id INT NULL;
    PRINT '[OK] conversion_xml_templates.conn_id added.';
END
ELSE PRINT '[SKIP] conversion_xml_templates.conn_id already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 4.2  conversion_mappings — add conn_id
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_mappings' AND COLUMN_NAME = 'conn_id'
)
BEGIN
    ALTER TABLE conversion_mappings ADD conn_id INT NULL;
    PRINT '[OK] conversion_mappings.conn_id added.';
END
ELSE PRINT '[SKIP] conversion_mappings.conn_id already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 4.3  conversion_mappings — add identifier_column
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_mappings' AND COLUMN_NAME = 'identifier_column'
)
BEGIN
    ALTER TABLE conversion_mappings ADD identifier_column NVARCHAR(255) NULL;
    PRINT '[OK] conversion_mappings.identifier_column added.';
END
ELSE PRINT '[SKIP] conversion_mappings.identifier_column already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 4.4  conversion_mappings — add identifier_table
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_mappings' AND COLUMN_NAME = 'identifier_table'
)
BEGIN
    ALTER TABLE conversion_mappings ADD identifier_table NVARCHAR(255) NULL;
    PRINT '[OK] conversion_mappings.identifier_table added.';
END
ELSE PRINT '[SKIP] conversion_mappings.identifier_table already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 4.5  conversion_mapping_rows — add confidence
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_mapping_rows' AND COLUMN_NAME = 'confidence'
)
BEGIN
    ALTER TABLE conversion_mapping_rows ADD confidence INT NULL;
    PRINT '[OK] conversion_mapping_rows.confidence added.';
END
ELSE PRINT '[SKIP] conversion_mapping_rows.confidence already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 4.6  conversion_generated_xml — add validation columns
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_generated_xml' AND COLUMN_NAME = 'validation_status'
)
BEGIN
    ALTER TABLE conversion_generated_xml ADD validation_status NVARCHAR(20) NULL;
    PRINT '[OK] conversion_generated_xml.validation_status added.';
END
ELSE PRINT '[SKIP] conversion_generated_xml.validation_status already exists.';
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_generated_xml' AND COLUMN_NAME = 'validation_comment'
)
BEGIN
    ALTER TABLE conversion_generated_xml ADD validation_comment NVARCHAR(MAX) NULL;
    PRINT '[OK] conversion_generated_xml.validation_comment added.';
END
ELSE PRINT '[SKIP] conversion_generated_xml.validation_comment already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 4.7  conversion_dashboard_configs — add debug_json
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_dashboard_configs' AND COLUMN_NAME = 'debug_json'
)
BEGIN
    ALTER TABLE conversion_dashboard_configs ADD debug_json NVARCHAR(MAX) NULL;
    PRINT '[OK] conversion_dashboard_configs.debug_json added.';
END
ELSE PRINT '[SKIP] conversion_dashboard_configs.debug_json already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 4.8  conversion_ps_api_collection — add required_fields
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_ps_api_collection' AND COLUMN_NAME = 'required_fields'
)
BEGIN
    ALTER TABLE conversion_ps_api_collection ADD required_fields NVARCHAR(MAX) NULL;
    PRINT '[OK] conversion_ps_api_collection.required_fields added.';
END
ELSE PRINT '[SKIP] conversion_ps_api_collection.required_fields already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 4.9  conversion_ps_api_collection — add conn_id
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_ps_api_collection' AND COLUMN_NAME = 'conn_id'
)
BEGIN
    ALTER TABLE conversion_ps_api_collection ADD conn_id INT NULL;
    PRINT '[OK] conversion_ps_api_collection.conn_id added.';
END
ELSE PRINT '[SKIP] conversion_ps_api_collection.conn_id already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 4.10  conversion_run_logs — add source_rows as TEXT
--             (was added in early versions as TEXT; ensure type)
-- ─────────────────────────────────────────────────────────────
-- No change needed — column exists from V2. Placeholder for docs.
PRINT '[SKIP] conversion_run_logs.source_rows — defined in V2.';
GO

-- ─────────────────────────────────────────────────────────────
-- PATCH 4.11  Ensure indexes exist on high-traffic FK columns
-- ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_mapping_rows_mapping' AND object_id = OBJECT_ID('conversion_mapping_rows')
)
BEGIN
    CREATE INDEX IX_mapping_rows_mapping ON conversion_mapping_rows (mapping_id);
    PRINT '[OK] IX_mapping_rows_mapping created.';
END
ELSE PRINT '[SKIP] IX_mapping_rows_mapping already exists.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_run_logs_project' AND object_id = OBJECT_ID('conversion_run_logs')
)
BEGIN
    CREATE INDEX IX_run_logs_project ON conversion_run_logs (project_id);
    PRINT '[OK] IX_run_logs_project created.';
END
ELSE PRINT '[SKIP] IX_run_logs_project already exists.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_target_formula_conn' AND object_id = OBJECT_ID('conversion_target_formula_rules')
)
BEGIN
    CREATE INDEX IX_target_formula_conn ON conversion_target_formula_rules (conn_id);
    PRINT '[OK] IX_target_formula_conn created.';
END
ELSE PRINT '[SKIP] IX_target_formula_conn already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- ▼▼▼  FUTURE PATCHES — add below this line  ▼▼▼
-- Template:
--
-- PATCH 4.N  <table> — <reason>
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
PRINT ' V4 complete — all migration patches applied.';
PRINT '============================================================';
GO
