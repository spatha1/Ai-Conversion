-- ============================================================
-- 01_core_tables.sql
-- ConversionAgent — Core application tables
-- Run against: [ConversionAgent] database
-- Safe to re-run: all CREATE TABLE statements are guarded with
--                 IF NOT EXISTS checks.
-- ============================================================

USE [ConversionAgent];
GO

-- ── 1. Projects ──────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_projects')
BEGIN
    CREATE TABLE conversion_projects (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(200)  NOT NULL,
        description NVARCHAR(MAX)  NULL,
        created_at  DATETIME2      DEFAULT GETUTCDATE(),
        updated_at  DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_projects';
END
ELSE PRINT '  conversion_projects already exists - skipped';
GO

-- ── 2. Source Connections ─────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_source_connections')
BEGIN
    CREATE TABLE conversion_source_connections (
        id                            INT IDENTITY(1,1) PRIMARY KEY,
        project_id                    INT            NULL,
        name                          NVARCHAR(200)  NOT NULL,
        source_type                   NVARCHAR(50)   NOT NULL,
        -- SQL fields
        dialect                       NVARCHAR(50)   NULL,
        host                          NVARCHAR(255)  NULL,
        port                          INT            NULL,
        database_name                 NVARCHAR(255)  NULL,
        schema_name                   NVARCHAR(255)  NULL,
        username                      NVARCHAR(255)  NULL,
        password_enc                  NVARCHAR(MAX)  NULL,
        -- Snowflake fields
        sf_account                    NVARCHAR(255)  NULL,
        sf_warehouse                  NVARCHAR(255)  NULL,
        sf_role                       NVARCHAR(255)  NULL,
        sf_database                   NVARCHAR(255)  NULL,
        sf_schema                     NVARCHAR(255)  NULL,
        sf_username                   NVARCHAR(255)  NULL,
        sf_password_enc               NVARCHAR(MAX)  NULL,
        sf_private_key_enc            NVARCHAR(MAX)  NULL,
        sf_private_key_passphrase_enc NVARCHAR(MAX)  NULL,
        -- Shared
        query_text                    NVARCHAR(MAX)  NULL,
        sheet_alias                   NVARCHAR(100)  NULL,
        is_active                     BIT            NOT NULL DEFAULT 1,
        created_at                    DATETIME2      DEFAULT GETUTCDATE(),
        updated_at                    DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_source_connections';
END
ELSE PRINT '  conversion_source_connections already exists - skipped';
GO

-- ── 3. XML Templates ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_xml_templates')
BEGIN
    CREATE TABLE conversion_xml_templates (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        project_id  INT            NULL,
        conn_id     INT            NULL,
        name        NVARCHAR(200)  NOT NULL,
        content     NVARCHAR(MAX)  NULL,
        format_type NVARCHAR(20)   NULL DEFAULT 'xml',
        created_at  DATETIME2      DEFAULT GETUTCDATE(),
        updated_at  DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_xml_templates';
END
ELSE PRINT '  conversion_xml_templates already exists - skipped';
GO

-- ── 4. Mappings (version header) ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_mappings')
BEGIN
    CREATE TABLE conversion_mappings (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        project_id        INT            NULL,
        conn_id           INT            NULL,
        template_id       INT            NULL,
        version           INT            NOT NULL DEFAULT 1,
        is_active         BIT            NOT NULL DEFAULT 0,
        identifier_column NVARCHAR(255)  NULL,
        identifier_table  NVARCHAR(255)  NULL,
        created_at        DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_mappings';
END
ELSE PRINT '  conversion_mappings already exists - skipped';
GO

-- ── 5. Mapping Rows ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_mapping_rows')
BEGIN
    CREATE TABLE conversion_mapping_rows (
        id                   INT IDENTITY(1,1) PRIMARY KEY,
        mapping_id           INT            NOT NULL,
        source_sheet         NVARCHAR(100)  NULL,
        source_column        NVARCHAR(200)  NULL,
        formula              NVARCHAR(MAX)  NULL,
        target_path          NVARCHAR(MAX)  NULL,
        each_sheet           NVARCHAR(100)  NULL,
        sort_order           INT            NOT NULL DEFAULT 0,
        confidence           INT            NULL,
        transform_expression NVARCHAR(MAX)  NULL,
        transform_sql        NVARCHAR(MAX)  NULL
    );
    PRINT '  Created conversion_mapping_rows';
END
ELSE PRINT '  conversion_mapping_rows already exists - skipped';
GO

-- ── 6. Run Logs ──────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_run_logs')
BEGIN
    CREATE TABLE conversion_run_logs (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        project_id    INT            NOT NULL,
        mapping_id    INT            NULL,
        triggered_by  NVARCHAR(50)   NOT NULL DEFAULT 'manual',
        status        NVARCHAR(20)   NOT NULL DEFAULT 'running',
        source_rows   NVARCHAR(MAX)  NULL,
        output_xml    NVARCHAR(MAX)  NULL,
        target_url    NVARCHAR(500)  NULL,
        target_status INT            NULL,
        errors        NVARCHAR(MAX)  NULL,
        started_at    DATETIME2      DEFAULT GETUTCDATE(),
        finished_at   DATETIME2      NULL
    );
    PRINT '  Created conversion_run_logs';
END
ELSE PRINT '  conversion_run_logs already exists - skipped';
GO

-- ── 7. PII Policies ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_pii_policies')
BEGIN
    CREATE TABLE conversion_pii_policies (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        project_id     INT            NOT NULL,
        source_id      INT            NULL,
        column_name    NVARCHAR(200)  NOT NULL,
        pii_type       NVARCHAR(50)   NOT NULL,
        detection_mode NVARCHAR(20)   NOT NULL DEFAULT 'auto',
        action         NVARCHAR(20)   NOT NULL DEFAULT 'mask',
        mask_pattern   NVARCHAR(100)  NULL,
        is_active      BIT            NOT NULL DEFAULT 1,
        created_at     DATETIME2      DEFAULT GETUTCDATE(),
        updated_at     DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_pii_policies';
END
ELSE PRINT '  conversion_pii_policies already exists - skipped';
GO

-- ── 8. PII Audit Logs ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_pii_audit_logs')
BEGIN
    CREATE TABLE conversion_pii_audit_logs (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        project_id     INT            NOT NULL,
        source_id      INT            NULL,
        run_id         INT            NULL,
        column_name    NVARCHAR(200)  NOT NULL,
        pii_type       NVARCHAR(100)  NULL,
        action_applied NVARCHAR(50)   NULL,
        row_count      INT            NOT NULL DEFAULT 0,
        accessed_at    DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_pii_audit_logs';
END
ELSE PRINT '  conversion_pii_audit_logs already exists - skipped';
GO

-- ── 9. Catalog Columns ───────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_catalog_columns')
BEGIN
    CREATE TABLE conversion_catalog_columns (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        conn_id          INT            NOT NULL,
        table_schema     NVARCHAR(255)  NULL,
        table_name       NVARCHAR(255)  NOT NULL,
        column_name      NVARCHAR(255)  NOT NULL,
        data_type        NVARCHAR(100)  NULL,
        max_length       INT            NULL,
        is_nullable      NVARCHAR(10)   NULL,
        is_primary_key   BIT            NOT NULL DEFAULT 0,
        ordinal_position INT            NULL,
        discovered_at    DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_catalog_columns';
END
ELSE PRINT '  conversion_catalog_columns already exists - skipped';
GO

-- ── 10. Catalog Relations ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_catalog_relations')
BEGIN
    CREATE TABLE conversion_catalog_relations (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        conn_id           INT            NOT NULL,
        fk_name           NVARCHAR(255)  NULL,
        parent_table      NVARCHAR(255)  NOT NULL,
        parent_column     NVARCHAR(255)  NOT NULL,
        referenced_table  NVARCHAR(255)  NOT NULL,
        referenced_column NVARCHAR(255)  NOT NULL,
        discovered_at     DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_catalog_relations';
END
ELSE PRINT '  conversion_catalog_relations already exists - skipped';
GO

-- ── 11. Catalog Views ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_catalog_views')
BEGIN
    CREATE TABLE conversion_catalog_views (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        conn_id         INT            NOT NULL,
        view_schema     NVARCHAR(255)  NULL,
        view_name       NVARCHAR(255)  NOT NULL,
        view_definition NVARCHAR(MAX)  NULL,
        discovered_at   DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_catalog_views';
END
ELSE PRINT '  conversion_catalog_views already exists - skipped';
GO

-- ── 12. Catalog Samples ──────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_catalog_samples')
BEGIN
    CREATE TABLE conversion_catalog_samples (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        conn_id       INT            NOT NULL,
        table_schema  NVARCHAR(255)  NULL,
        table_name    NVARCHAR(255)  NOT NULL,
        row_count     INT            NULL,
        sample_json   NVARCHAR(MAX)  NULL,
        discovered_at DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_catalog_samples';
END
ELSE PRINT '  conversion_catalog_samples already exists - skipped';
GO

-- ── 13. Column Embeddings ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_column_embeddings')
BEGIN
    CREATE TABLE conversion_column_embeddings (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        conn_id           INT            NOT NULL,
        table_schema      NVARCHAR(255)  NULL,
        table_name        NVARCHAR(255)  NOT NULL,
        column_name       NVARCHAR(255)  NOT NULL,
        column_definition NVARCHAR(MAX)  NULL,
        embedding_json    NVARCHAR(MAX)  NULL,
        embedding_model   NVARCHAR(100)  NULL,
        created_at        DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_column_embeddings';
END
ELSE PRINT '  conversion_column_embeddings already exists - skipped';
GO

-- ── 14. Target Formula Rules ─────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_target_formula_rules')
BEGIN
    CREATE TABLE conversion_target_formula_rules (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        conn_id         INT            NULL,
        template_id     INT            NULL,
        target_path     NVARCHAR(MAX)  NULL,
        group_path      NVARCHAR(MAX)  NULL,
        formula_type    NVARCHAR(50)   NULL,
        expression      NVARCHAR(MAX)  NULL,
        default_value   NVARCHAR(MAX)  NULL,
        execution_order INT            NOT NULL DEFAULT 0,
        created_at      DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_target_formula_rules';
END
ELSE PRINT '  conversion_target_formula_rules already exists - skipped';
GO

-- ── 15. Generated Queries ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_generated_queries')
BEGIN
    CREATE TABLE conversion_generated_queries (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        conn_id      INT            NOT NULL,
        template_id  INT            NULL,
        mapping_id   INT            NULL,
        query_sql    NVARCHAR(MAX)  NULL,
        generated_by NVARCHAR(20)   NOT NULL DEFAULT 'ai',
        created_at   DATETIME2      DEFAULT GETUTCDATE(),
        updated_at   DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_generated_queries';
END
ELSE PRINT '  conversion_generated_queries already exists - skipped';
GO

-- ── 16. Generated XML ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_generated_xml')
BEGIN
    CREATE TABLE conversion_generated_xml (
        id                 INT IDENTITY(1,1) PRIMARY KEY,
        conn_id            INT            NOT NULL,
        mapping_id         INT            NULL,
        identifier_value   NVARCHAR(500)  NULL,
        xml_content        NVARCHAR(MAX)  NULL,
        generated_at       DATETIME2      DEFAULT GETUTCDATE(),
        validation_status  NVARCHAR(20)   NULL,
        validation_comment NVARCHAR(MAX)  NULL
    );
    PRINT '  Created conversion_generated_xml';
END
ELSE PRINT '  conversion_generated_xml already exists - skipped';
GO

-- ── 17. Saved Reports ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_saved_reports')
BEGIN
    CREATE TABLE conversion_saved_reports (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        conn_id    INT            NOT NULL,
        name       NVARCHAR(200)  NOT NULL,
        query_sql  NVARCHAR(MAX)  NOT NULL,
        created_at DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_saved_reports';
END
ELSE PRINT '  conversion_saved_reports already exists - skipped';
GO

-- ── 17b. Schema Metadata ─────────────────────────────────────
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

-- ── 18. Validation Rules ─────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_validation_rules')
BEGIN
    CREATE TABLE conversion_validation_rules (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        conn_id     INT            NOT NULL,
        target_path NVARCHAR(500)  NOT NULL,
        is_required BIT            NOT NULL DEFAULT 0,
        data_type   NVARCHAR(50)   NULL,
        min_length  INT            NULL,
        max_length  INT            NULL,
        pattern     NVARCHAR(500)  NULL,
        enumeration NVARCHAR(MAX)  NULL,
        min_value   NVARCHAR(100)  NULL,
        max_value   NVARCHAR(100)  NULL
    );
    PRINT '  Created conversion_validation_rules';
END
ELSE PRINT '  conversion_validation_rules already exists - skipped';
GO

-- ── External Integrations (JIRA / ADO) ───────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_external_integrations')
BEGIN
    CREATE TABLE conversion_external_integrations (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        type       NVARCHAR(20)   NOT NULL,
        project_id INT            NULL,
        base_url   NVARCHAR(500)  NOT NULL,
        username   NVARCHAR(200)  NULL,
        token_enc  NVARCHAR(MAX)  NULL,
        is_active  BIT            NOT NULL DEFAULT 1,
        created_at DATETIME2      DEFAULT GETUTCDATE(),
        updated_at DATETIME2      DEFAULT GETUTCDATE(),
        CONSTRAINT uq_integration_type_project UNIQUE (type, project_id)
    );
    PRINT '  Created conversion_external_integrations';
END
ELSE PRINT '  conversion_external_integrations already exists - skipped';
GO

-- ── Query Examples ───────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_query_examples')
BEGIN
    CREATE TABLE conversion_query_examples (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        conn_id      INT            NULL,
        name         NVARCHAR(255)  NOT NULL,
        description  NVARCHAR(MAX)  NULL,
        tables_used  NVARCHAR(500)  NULL,
        example_sql  NVARCHAR(MAX)  NOT NULL,
        is_active    BIT            NOT NULL DEFAULT 1,
        created_at   DATETIME2      DEFAULT GETUTCDATE(),
        updated_at   DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_query_examples';
END
ELSE PRINT '  conversion_query_examples already exists - skipped';
GO

-- ── Query Context ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'conversion_query_context')
BEGIN
    CREATE TABLE conversion_query_context (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        conn_id    INT            NULL,
        content    NVARCHAR(MAX)  NULL,
        updated_at DATETIME2      DEFAULT GETUTCDATE()
    );
    PRINT '  Created conversion_query_context';
END
ELSE PRINT '  conversion_query_context already exists - skipped';
GO
