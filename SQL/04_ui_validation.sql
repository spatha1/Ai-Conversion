-- ============================================================
-- 04_ui_validation.sql
-- ConversionAgent — Playwright-based UI Validation tables
-- Safe to re-run: all statements are guarded with IF NOT EXISTS.
-- ============================================================

USE [ConversionAgent];
GO

-- ── UI Validation Templates ───────────────────────────────────
-- One row per connection — stores base URL, login flow,
-- entity path patterns, CSS selectors, and the JSON key
-- in the dispatch response that holds the target app entity ID.
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ui_validation_templates')
BEGIN
    CREATE TABLE conversion_ui_validation_templates (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        connection_id     INT            NOT NULL,
        app_name          NVARCHAR(200)  NOT NULL,
        base_url          NVARCHAR(2000) NOT NULL,
        entity_paths      NVARCHAR(MAX)  NOT NULL,   -- JSON: {"policy": "/policy/{id}"}
        login_config      NVARCHAR(MAX)  NULL,        -- JSON (Fernet-encrypted)
        selectors         NVARCHAR(MAX)  NOT NULL,   -- JSON: {"premium": "[data-testid='premium']"}
        response_id_field NVARCHAR(500)  NULL,        -- dot-path into dispatch response e.g. "policyId" or "data.id"
        created_at        DATETIME2      DEFAULT GETUTCDATE(),
        updated_at        DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT FK_uivt_conn FOREIGN KEY (connection_id)
            REFERENCES conversion_source_connections(id)
    );
    PRINT '  Created conversion_ui_validation_templates';
END
ELSE PRINT '  conversion_ui_validation_templates already exists - skipped';
GO

-- Add response_id_field if table was created before this column existed
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'conversion_ui_validation_templates'
      AND COLUMN_NAME = 'response_id_field'
)
BEGIN
    ALTER TABLE conversion_ui_validation_templates
        ADD response_id_field NVARCHAR(500) NULL;
    PRINT '  Added response_id_field to conversion_ui_validation_templates';
END
ELSE PRINT '  conversion_ui_validation_templates.response_id_field already exists - skipped';
GO

-- ── UI Validation Runs ────────────────────────────────────────
-- One row per entity validation execution.
-- status: PASS | FAIL | ERROR
-- summary: JSON {total, matched, mismatched, missing}
-- results: JSON [{field, ui_value, xml_value, status}]
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_ui_validation_runs')
BEGIN
    CREATE TABLE conversion_ui_validation_runs (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        template_id   INT            NOT NULL,
        entity        NVARCHAR(100)  NOT NULL,    -- "policy" | "claim" etc.
        entity_id     NVARCHAR(200)  NOT NULL,    -- the concrete ID value navigated to
        status        NVARCHAR(20)   NOT NULL,    -- PASS | FAIL | ERROR
        url           NVARCHAR(2000) NULL,
        screenshot    NVARCHAR(500)  NULL,        -- relative path under screenshots/
        summary       NVARCHAR(MAX)  NULL,        -- JSON: {total, matched, mismatched, missing}
        results       NVARCHAR(MAX)  NULL,        -- JSON: [{field, ui_value, xml_value, status}]
        error_message NVARCHAR(MAX)  NULL,
        created_at    DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT FK_uivr_template FOREIGN KEY (template_id)
            REFERENCES conversion_ui_validation_templates(id) ON DELETE CASCADE
    );
    PRINT '  Created conversion_ui_validation_runs';
END
ELSE PRINT '  conversion_ui_validation_runs already exists - skipped';
GO
