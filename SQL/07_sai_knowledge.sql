-- ============================================================
-- 07_sai_knowledge.sql
-- ConversionAgent — SAI Knowledge Processing Agent + Debug Engine
--
-- Tables:
--   conversion_knowledge_entries   — structured KB entries (LLM-processed)
--   conversion_knowledge_chunks    — overlapping text chunks + OpenAI embeddings
--   conversion_open_questions      — unanswered Ask SAI questions (admin review)
--   conversion_story_analyses      — Dev Hub story breakdown results
--   conversion_debug_settings      — per-module debug level config (ON/VERBOSE/OFF)
--   conversion_debug_traces        — full step-by-step debug output per request
--
-- Safe to re-run: all statements guarded with IF NOT EXISTS.
-- Run after: 06_form_builder.sql
-- ============================================================

USE [ConversionAgent];
GO

-- ── 1. SAI Knowledge Entries ──────────────────────────────────
-- Each row is one structured knowledge item: a process doc, use case,
-- decision record, or Q&A pair.  Raw content is stored alongside the
-- LLM-structured output so entries can be reprocessed without re-upload.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'conversion_knowledge_entries'
)
BEGIN
    CREATE TABLE conversion_knowledge_entries (
        id                   INT IDENTITY(1,1) PRIMARY KEY,
        title                NVARCHAR(500)   NOT NULL,
        type                 NVARCHAR(50)    NOT NULL,   -- UseCase | Question | Process | Issue
        system               NVARCHAR(100)   NOT NULL,   -- DCT | ADO | Snowflake | General
        tags                 NVARCHAR(MAX)   NULL,       -- JSON array of tag strings
        summary              NVARCHAR(MAX)   NULL,
        detailed_explanation NVARCHAR(MAX)   NULL,
        key_points           NVARCHAR(MAX)   NULL,       -- JSON array
        decision             NVARCHAR(MAX)   NULL,
        reason               NVARCHAR(MAX)   NULL,
        is_reusable          BIT             NOT NULL DEFAULT 1,
        source_type          NVARCHAR(50)    NOT NULL DEFAULT 'Text',  -- Text | Document | Link
        raw_content          NVARCHAR(MAX)   NULL,
        quality_score        NVARCHAR(20)    NULL,       -- HIGH | MEDIUM | LOW
        suggestions          NVARCHAR(MAX)   NULL,       -- JSON array from LLM
        status               NVARCHAR(50)    NOT NULL DEFAULT 'READY_FOR_EMBEDDING',
                             -- READY_FOR_EMBEDDING | LOW_QUALITY
        embedding_status     NVARCHAR(30)    NOT NULL DEFAULT 'pending',
                             -- pending | complete | partial | failed
        representative_emb   NVARCHAR(MAX)   NULL,      -- JSON float array (summary embedding)
        version              INT             NOT NULL DEFAULT 1,
        created_by           NVARCHAR(200)   NULL,
        created_at           DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
        updated_at           DATETIME2       NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_ke_status          ON conversion_knowledge_entries (status);
    CREATE INDEX IX_ke_embedding_status ON conversion_knowledge_entries (embedding_status);
    CREATE INDEX IX_ke_system          ON conversion_knowledge_entries (system);
    PRINT 'Created conversion_knowledge_entries';
END
GO

-- ── 2. SAI Knowledge Chunks ───────────────────────────────────
-- Each entry is split into overlapping ~400-word chunks.
-- Each chunk stores its own OpenAI text-embedding-3-small vector
-- so cosine similarity search can operate at chunk granularity.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'conversion_knowledge_chunks'
)
BEGIN
    CREATE TABLE conversion_knowledge_chunks (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        entry_id    INT             NOT NULL,
        chunk_index INT             NOT NULL DEFAULT 0,  -- position within parent entry
        content     NVARCHAR(MAX)   NULL,                -- raw chunk text
        topic       NVARCHAR(500)   NULL,                -- heading / section label
        embedding   NVARCHAR(MAX)   NULL,                -- JSON float array (1536-dim)
        created_at  DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_kchunk_entry FOREIGN KEY (entry_id)
            REFERENCES conversion_knowledge_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IX_kchunk_entry ON conversion_knowledge_chunks (entry_id);
    PRINT 'Created conversion_knowledge_chunks';
END
GO

-- ── 3. Open Questions ─────────────────────────────────────────
-- When Ask SAI cannot find a matching KB chunk above the confidence
-- threshold, the question is recorded here for admin review.
-- Admins can resolve via full KB entry or quick inline answer.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'conversion_open_questions'
)
BEGIN
    CREATE TABLE conversion_open_questions (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        question            NVARCHAR(MAX)   NOT NULL,
        detected_tags       NVARCHAR(MAX)   NULL,   -- JSON: {system, category, type}
        suggested_tags      NVARCHAR(MAX)   NULL,   -- JSON array
        reason              NVARCHAR(MAX)   NULL,   -- why it went unanswered
        frequency           INT             NOT NULL DEFAULT 1,  -- de-dupe counter
        resolution_text     NVARCHAR(MAX)   NULL,   -- quick-answer text
        status              NVARCHAR(30)    NOT NULL DEFAULT 'open',
                            -- open | resolved | dismissed
        resolved_by         NVARCHAR(200)   NULL,
        resolution_entry_id INT             NULL,   -- FK to knowledge_entries if resolved via full entry
        asked_by            NVARCHAR(200)   NULL,
        created_at          DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
        updated_at          DATETIME2       NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_oq_status ON conversion_open_questions (status);
    PRINT 'Created conversion_open_questions';
END
GO

-- ── 4. Story Analyses (Dev Hub) ───────────────────────────────
-- Stores GPT story breakdown + dev plan results from the Dev Hub page.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'conversion_story_analyses'
)
BEGIN
    CREATE TABLE conversion_story_analyses (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        project_id   INT             NULL,
        title        NVARCHAR(500)   NOT NULL,
        stories_json NVARCHAR(MAX)   NOT NULL,   -- raw story input
        result_json  NVARCHAR(MAX)   NOT NULL,   -- LLM structured output
        model        NVARCHAR(100)   NULL,
        created_at   DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
        updated_at   DATETIME2       NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT 'Created conversion_story_analyses';
END
GO

-- ── 5. Debug Settings ─────────────────────────────────────────
-- One row per backend module.  Controls verbosity of AI debug traces.
-- Valid levels: 'OFF' | 'ON' | 'VERBOSE'

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
    -- Seed known modules
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

-- ── 6. Debug Traces ───────────────────────────────────────────
-- Full step-by-step trace for each AI request when debug is ON/VERBOSE.
-- Linked by trace_id (UUID) to the originating request.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'conversion_debug_traces'
)
BEGIN
    CREATE TABLE conversion_debug_traces (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        trace_id    NVARCHAR(36)  NOT NULL,   -- UUID linking all steps of one request
        module      NVARCHAR(50)  NOT NULL,
        conn_id     INT           NULL,
        debug_level NVARCHAR(20)  NOT NULL,
        steps_json  NVARCHAR(MAX) NULL,        -- JSON array of step objects
        created_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_debug_traces_trace_id ON conversion_debug_traces (trace_id);
    CREATE INDEX IX_debug_traces_module   ON conversion_debug_traces (module);
    PRINT 'Created conversion_debug_traces';
END
GO

PRINT '=== 07_sai_knowledge.sql complete ===';
GO
