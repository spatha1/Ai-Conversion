-- ============================================================
-- V8: SAI Knowledge Processing Agent + Debug Engine
--     New tables for the Ask SAI / Knowledge Base feature
--     and the per-module debug trace system.
-- Database:  ConversionAgent (DESKTOP-G01PH8C\SQLEXPRESS)
-- Safe to run multiple times (all guarded with IF NOT EXISTS)
-- ============================================================

USE ConversionAgent;
GO

-- ── 1. conversion_knowledge_entries ──────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'conversion_knowledge_entries'
)
BEGIN
    CREATE TABLE conversion_knowledge_entries (
        id                   INT IDENTITY(1,1) PRIMARY KEY,
        title                NVARCHAR(500)   NOT NULL,
        type                 NVARCHAR(50)    NOT NULL,
        system               NVARCHAR(100)   NOT NULL,
        tags                 NVARCHAR(MAX)   NULL,
        summary              NVARCHAR(MAX)   NULL,
        detailed_explanation NVARCHAR(MAX)   NULL,
        key_points           NVARCHAR(MAX)   NULL,
        decision             NVARCHAR(MAX)   NULL,
        reason               NVARCHAR(MAX)   NULL,
        is_reusable          BIT             NOT NULL DEFAULT 1,
        source_type          NVARCHAR(50)    NOT NULL DEFAULT 'Text',
        raw_content          NVARCHAR(MAX)   NULL,
        quality_score        NVARCHAR(20)    NULL,
        suggestions          NVARCHAR(MAX)   NULL,
        status               NVARCHAR(50)    NOT NULL DEFAULT 'READY_FOR_EMBEDDING',
        embedding_status     NVARCHAR(30)    NOT NULL DEFAULT 'pending',
        representative_emb   NVARCHAR(MAX)   NULL,
        version              INT             NOT NULL DEFAULT 1,
        created_by           NVARCHAR(200)   NULL,
        created_at           DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
        updated_at           DATETIME2       NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_ke_status           ON conversion_knowledge_entries (status);
    CREATE INDEX IX_ke_embedding_status ON conversion_knowledge_entries (embedding_status);
    CREATE INDEX IX_ke_system           ON conversion_knowledge_entries (system);
    PRINT 'Created conversion_knowledge_entries';
END
GO

-- ── 2. conversion_knowledge_chunks ───────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'conversion_knowledge_chunks'
)
BEGIN
    CREATE TABLE conversion_knowledge_chunks (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        entry_id    INT             NOT NULL,
        chunk_index INT             NOT NULL DEFAULT 0,
        content     NVARCHAR(MAX)   NULL,
        topic       NVARCHAR(500)   NULL,
        embedding   NVARCHAR(MAX)   NULL,
        created_at  DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_kchunk_entry FOREIGN KEY (entry_id)
            REFERENCES conversion_knowledge_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IX_kchunk_entry ON conversion_knowledge_chunks (entry_id);
    PRINT 'Created conversion_knowledge_chunks';
END
GO

-- ── 3. conversion_open_questions ─────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'conversion_open_questions'
)
BEGIN
    CREATE TABLE conversion_open_questions (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        question            NVARCHAR(MAX)   NOT NULL,
        detected_tags       NVARCHAR(MAX)   NULL,
        suggested_tags      NVARCHAR(MAX)   NULL,
        reason              NVARCHAR(MAX)   NULL,
        frequency           INT             NOT NULL DEFAULT 1,
        resolution_text     NVARCHAR(MAX)   NULL,
        status              NVARCHAR(30)    NOT NULL DEFAULT 'open',
        resolved_by         NVARCHAR(200)   NULL,
        resolution_entry_id INT             NULL,
        asked_by            NVARCHAR(200)   NULL,
        created_at          DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
        updated_at          DATETIME2       NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_oq_status ON conversion_open_questions (status);
    PRINT 'Created conversion_open_questions';
END
GO

-- ── 4. conversion_story_analyses ─────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'conversion_story_analyses'
)
BEGIN
    CREATE TABLE conversion_story_analyses (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        project_id   INT             NULL,
        title        NVARCHAR(500)   NOT NULL,
        stories_json NVARCHAR(MAX)   NOT NULL,
        result_json  NVARCHAR(MAX)   NOT NULL,
        model        NVARCHAR(100)   NULL,
        created_at   DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
        updated_at   DATETIME2       NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT 'Created conversion_story_analyses';
END
GO

-- ── 5. conversion_debug_settings ─────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'conversion_debug_settings'
)
BEGIN
    CREATE TABLE conversion_debug_settings (
        module      NVARCHAR(50)  NOT NULL,
        debug_level NVARCHAR(20)  NOT NULL DEFAULT 'OFF',
        updated_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT PK_debug_settings PRIMARY KEY (module)
    );
    INSERT INTO conversion_debug_settings (module, debug_level)
    VALUES
        ('development',   'OFF'),
        ('mapping',       'OFF'),
        ('report',        'OFF'),
        ('reconciliation','OFF'),
        ('multi_compare', 'OFF');
    PRINT 'Created and seeded conversion_debug_settings';
END
GO

-- ── 6. conversion_debug_traces ────────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'conversion_debug_traces'
)
BEGIN
    CREATE TABLE conversion_debug_traces (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        trace_id    NVARCHAR(36)  NOT NULL,
        module      NVARCHAR(50)  NOT NULL,
        conn_id     INT           NULL,
        debug_level NVARCHAR(20)  NOT NULL,
        steps_json  NVARCHAR(MAX) NULL,
        created_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_debug_traces_trace_id ON conversion_debug_traces (trace_id);
    CREATE INDEX IX_debug_traces_module   ON conversion_debug_traces (module);
    PRINT 'Created conversion_debug_traces';
END
GO

PRINT '=== V8 migration complete ===';
GO
