-- ============================================================
-- run_all.sql
-- ConversionAgent — Master Deployment Script
--
-- Runs all versioned scripts in order.
-- Safe to re-run: every script is idempotent.
--
-- Usage (SSMS):    Open this file → Execute (F5)
-- Usage (sqlcmd):
--   sqlcmd -S "DESKTOP-G01PH8C\SQLEXPRESS" -E -i run_all.sql
--   sqlcmd -S "DESKTOP-G01PH8C\SQLEXPRESS" -U sa -P <pass> -i run_all.sql
--
-- Order:
--   V1  Database, login, user
--   V2  All application tables
--   V3  Sample / demo data  (EMP, DEPT + full app seed)
--   V4  Incremental migration patches
-- ============================================================

PRINT '============================================================';
PRINT ' ConversionAgent — Full Deployment';
PRINT ' Started: ' + CONVERT(NVARCHAR, GETDATE(), 120);
PRINT '============================================================';
PRINT '';

-- ── V1: Database & User Setup ─────────────────────────────────
PRINT '>>> Running V1__database_setup.sql ...';
PRINT '';
:r V1__database_setup.sql

-- ── V2: Create All Tables ─────────────────────────────────────
PRINT '';
PRINT '>>> Running V2__create_tables.sql ...';
PRINT '';
:r V2__create_tables.sql

-- ── V3: Sample Data ───────────────────────────────────────────
PRINT '';
PRINT '>>> Running V3__sample_data.sql ...';
PRINT '';
:r V3__sample_data.sql

-- ── V4: Migration Patches ─────────────────────────────────────
PRINT '';
PRINT '>>> Running V4__migrations.sql ...';
PRINT '';
:r V4__migrations.sql

-- ── Final Status ──────────────────────────────────────────────
PRINT '';
PRINT '============================================================';
PRINT ' Deployment complete: ' + CONVERT(NVARCHAR, GETDATE(), 120);
PRINT '============================================================';
PRINT '';
PRINT ' Next steps:';
PRINT '   1. Update .env with DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD';
PRINT '   2. Set a real FERNET_KEY in .env';
PRINT '   3. Start the API:';
PRINT '        uvicorn api.main:app --reload --port 8000';
PRINT '   4. Open http://localhost:5173 (or index.html)';
PRINT '   5. Select "Dept_Conversion" connection and explore dashboards';
PRINT '============================================================';
GO
