-- ============================================================
-- LegacyInsurance Database Setup
-- Target SQL Server: 104.211.112.63,1433 (Azure VM)
-- Creates database, schema, and grants app user access
-- ============================================================

USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'LegacyInsurance')
BEGIN
    CREATE DATABASE LegacyInsurance
        COLLATE SQL_Latin1_General_CP1_CI_AS;
    PRINT 'Created database LegacyInsurance';
END
ELSE
    PRINT 'Database LegacyInsurance already exists — skipped';
GO

USE LegacyInsurance;
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'legacy')
BEGIN
    EXEC('CREATE SCHEMA legacy');
    PRINT 'Created schema legacy';
END
ELSE
    PRINT 'Schema legacy already exists — skipped';
GO

-- Grant sa full access (already owner, this is a no-op but safe)
-- If a separate app user is needed, uncomment and adjust:
-- IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'clarityAgentuser')
--     CREATE USER clarityAgentuser FOR LOGIN clarityAgentuser;
-- ALTER ROLE db_owner ADD MEMBER clarityAgentuser;
GO
