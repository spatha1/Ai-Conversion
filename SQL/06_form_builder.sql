-- ============================================================
-- 06_form_builder.sql
-- ConversionAgent — Form Configuration & Execution Engine
--
-- Tables:
--   conversion_form_templates         — versioned form schema definitions
--   conversion_form_mapping_presets   — reusable field→data-path mapping presets
--   conversion_form_data_bindings     — data source config + field mapping per template
--   conversion_form_executions        — execution history (single + bulk runs)
--
-- Safe to re-run: all CREATE TABLE statements are guarded with IF NOT EXISTS.
-- Run after: 05_column_additions.sql
-- ============================================================

USE [ConversionAgent];
GO

-- ── 1. Form Templates ─────────────────────────────────────────
-- Stores versioned form schema (sections, fields, validations, layout).
-- Each update creates a new version row; old rows are immutable.
-- parent_id links a new version to the record it was derived from.

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_form_templates')
BEGIN
    CREATE TABLE conversion_form_templates (
        id               INT IDENTITY(1,1)  PRIMARY KEY,
        project_id       INT                NULL,
        name             NVARCHAR(200)      NOT NULL,
        description      NVARCHAR(MAX)      NULL,
        category         NVARCHAR(100)      NULL,
        version          INT                NOT NULL DEFAULT 1,
        status           NVARCHAR(50)       NOT NULL DEFAULT 'draft',
            -- draft | configured | active
        form_schema_json NVARCHAR(MAX)      NULL,
            -- JSON: { form_name, version, status, sections:[{id,title,order,columns,fields:[...]}] }
        source_type      NVARCHAR(50)       NULL,
            -- image | pdf | text | handwritten
        source_file_path NVARCHAR(500)      NULL,
        parent_id        INT                NULL,
            -- FK to previous version of the same template
        created_by       INT                NULL,
            -- FK to conversion_users.id
        created_at       DATETIME2          NOT NULL DEFAULT GETUTCDATE(),
        updated_at       DATETIME2          NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT FK_cft_parent  FOREIGN KEY (parent_id)
            REFERENCES conversion_form_templates(id),
        CONSTRAINT FK_cft_project FOREIGN KEY (project_id)
            REFERENCES conversion_projects(id)
    );

    CREATE INDEX IX_cft_project ON conversion_form_templates (project_id);
    CREATE INDEX IX_cft_name    ON conversion_form_templates (name);
    CREATE INDEX IX_cft_status  ON conversion_form_templates (status);

    PRINT '  Created conversion_form_templates';
END
ELSE
    PRINT '  conversion_form_templates already exists — skipped';
GO

-- ── 2. Mapping Presets ────────────────────────────────────────
-- Reusable field→data-path mapping dictionaries.
-- A binding can reference a preset for quick setup; the actual
-- mapping_json on the binding always takes precedence at runtime.

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_form_mapping_presets')
BEGIN
    CREATE TABLE conversion_form_mapping_presets (
        id           INT IDENTITY(1,1)  PRIMARY KEY,
        name         NVARCHAR(200)      NOT NULL,
        description  NVARCHAR(MAX)      NULL,
        source_hint  NVARCHAR(50)       NULL,
            -- db | api | manual  (informational only — not enforced)
        mapping_json NVARCHAR(MAX)      NULL,
            -- JSON: { "field_name": "data.path.key", ... }
        created_at   DATETIME2          NOT NULL DEFAULT GETUTCDATE(),
        updated_at   DATETIME2          NOT NULL DEFAULT GETUTCDATE()
    );

    PRINT '  Created conversion_form_mapping_presets';
END
ELSE
    PRINT '  conversion_form_mapping_presets already exists — skipped';
GO

-- ── 3. Data Bindings ─────────────────────────────────────────
-- Links a template version to a specific data source and mapping.
-- One template can have many bindings (DB, API, manual JSON, etc.).
-- config_json shape varies by data_source:
--   db:     { "conn_id": 5, "query": "SELECT ..." }
--   api:    { "endpoint": "https://...", "method": "GET", "params": {...} }
--   manual: { "raw_json": "{...}" }
-- API auth headers are NOT stored here — passed at execute time.

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_form_data_bindings')
BEGIN
    CREATE TABLE conversion_form_data_bindings (
        id               INT IDENTITY(1,1)  PRIMARY KEY,
        template_id      INT                NOT NULL,
        template_version INT                NOT NULL,
        name             NVARCHAR(200)      NULL,
        data_source      NVARCHAR(50)       NOT NULL,
            -- db | api | manual
        config_json      NVARCHAR(MAX)      NULL,
            -- source-specific config (see comment above)
        mapping_json     NVARCHAR(MAX)      NULL,
            -- JSON: { "field_name": "data.path", ... }
        preset_id        INT                NULL,
            -- optional FK to conversion_form_mapping_presets
        is_default       BIT                NOT NULL DEFAULT 0,
        created_at       DATETIME2          NOT NULL DEFAULT GETUTCDATE(),
        updated_at       DATETIME2          NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT FK_cfdb_template FOREIGN KEY (template_id)
            REFERENCES conversion_form_templates(id)
                ON DELETE CASCADE,
        CONSTRAINT FK_cfdb_preset   FOREIGN KEY (preset_id)
            REFERENCES conversion_form_mapping_presets(id)
    );

    CREATE INDEX IX_cfdb_template ON conversion_form_data_bindings (template_id);

    PRINT '  Created conversion_form_data_bindings';
END
ELSE
    PRINT '  conversion_form_data_bindings already exists — skipped';
GO

-- ── 4. Executions ─────────────────────────────────────────────
-- Records every form execution run (single or bulk).
-- Bulk runs share a bulk_run_id UUID for grouping.
-- output_file_path: relative path to the generated PDF / HTML file.
-- output_json: stores API/UI output inline (for api|ui formats).

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_form_executions')
BEGIN
    CREATE TABLE conversion_form_executions (
        id               INT IDENTITY(1,1)  PRIMARY KEY,
        template_id      INT                NOT NULL,
        template_version INT                NOT NULL,
        binding_id       INT                NULL,
        bulk_run_id      NVARCHAR(36)       NULL,
            -- UUID shared across all executions in one bulk run
        output_format    NVARCHAR(50)       NOT NULL,
            -- pdf | fillable | ui | api
        status           NVARCHAR(50)       NOT NULL DEFAULT 'pending',
            -- pending | running | completed | failed
        output_json      NVARCHAR(MAX)      NULL,
            -- for api / ui output formats
        output_file_path NVARCHAR(500)      NULL,
            -- relative path to PDF/HTML file on disk
        error_message    NVARCHAR(MAX)      NULL,
        triggered_by     NVARCHAR(50)       NOT NULL DEFAULT 'manual',
            -- manual | bulk | api
        created_at       DATETIME2          NOT NULL DEFAULT GETUTCDATE(),
        updated_at       DATETIME2          NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT FK_cfe_template FOREIGN KEY (template_id)
            REFERENCES conversion_form_templates(id)
                ON DELETE CASCADE,
        CONSTRAINT FK_cfe_binding  FOREIGN KEY (binding_id)
            REFERENCES conversion_form_data_bindings(id)
    );

    CREATE INDEX IX_cfe_template     ON conversion_form_executions (template_id);
    CREATE INDEX IX_cfe_bulk_run_id  ON conversion_form_executions (bulk_run_id);
    CREATE INDEX IX_cfe_status       ON conversion_form_executions (status);

    PRINT '  Created conversion_form_executions';
END
ELSE
    PRINT '  conversion_form_executions already exists — skipped';
GO

-- ── Verification query ────────────────────────────────────────
-- Uncomment and run to confirm all 4 tables were created:
--
-- SELECT TABLE_NAME, CREATE_DATE
-- FROM INFORMATION_SCHEMA.TABLES t
-- JOIN sys.tables s ON s.name = t.TABLE_NAME
-- WHERE TABLE_NAME LIKE 'conversion_form_%'
-- ORDER BY s.create_date;

PRINT '';
PRINT '06_form_builder.sql complete — 4 Form Builder tables ready.';
GO
