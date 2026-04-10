-- ============================================================
-- V1__database_setup.sql
-- ConversionAgent — Database, Login & User Bootstrap
--
-- Run as:  sysadmin (Windows auth) or sa
-- Target:  master → then ConversionAgent
-- Version: 1
-- ============================================================

USE [master];
GO

-- ── 1. Create Database ────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.databases WHERE name = N'ConversionAgent'
)
BEGIN
    CREATE DATABASE [ConversionAgent]
        COLLATE SQL_Latin1_General_CP1_CI_AS;
    PRINT '[OK] Database [ConversionAgent] created.';
END
ELSE
    PRINT '[SKIP] Database [ConversionAgent] already exists.';
GO

-- ── 2. Create SQL Server Login ────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.server_principals WHERE name = N'clarityAgentuser'
)
BEGIN
    CREATE LOGIN [clarityAgentuser]
        WITH PASSWORD    = N'YourStrongPassword123!',
             CHECK_POLICY = OFF,
             CHECK_EXPIRATION = OFF;
    PRINT '[OK] Login [clarityAgentuser] created.';
END
ELSE
    PRINT '[SKIP] Login [clarityAgentuser] already exists.';
GO

-- ── 3. Create DB User & Grant db_owner ───────────────────────
USE [ConversionAgent];
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.database_principals WHERE name = N'clarityAgentuser'
)
BEGIN
    CREATE USER [clarityAgentuser] FOR LOGIN [clarityAgentuser];
    PRINT '[OK] User [clarityAgentuser] created.';
END
ELSE
    PRINT '[SKIP] User [clarityAgentuser] already exists.';
GO

ALTER ROLE [db_owner] ADD MEMBER [clarityAgentuser];
PRINT '[OK] [clarityAgentuser] added to db_owner.';
GO
