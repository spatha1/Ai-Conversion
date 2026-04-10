-- ============================================================
-- V3__sample_data.sql
-- ConversionAgent — Sample / Demo Data
--
-- Creates:
--   • Demo source tables  : DEPT, EMP  (classic Oracle schema)
--   • 1 Project           : "Demo"
--   • 2 Connections       : Dept_Conversion (MSSQL), HR_Snowflake (Snowflake)
--   • 1 XML Template      : Employee export template
--   • 1 Mapping + rows    : EMP → XML paths
--   • 2 Generated XML     : SMITH, JONES
--   • 2 Run Logs          : success + failed
--   • 1 PS Conversation   : Dept salary query
--   • 1 Workflow          : Nightly dept salary report
--   • 1 Dashboard config  : Employee Smith Information
--   • 1 Saved Report      : Salary by dept
--   • Query examples      : 3 examples
--   • PII policy          : mask salary column
--
-- Run as: clarityAgentuser (db_owner)
-- Target: ConversionAgent
-- Version: 3
-- Depends: V2__create_tables.sql
-- ============================================================

USE [ConversionAgent];
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION A  Demo Source Tables  (EMP / DEPT)
-- These simulate the customer's legacy Oracle database
-- migrated to SQL Server for demo purposes.
-- ─────────────────────────────────────────────────────────────

-- DEPT table
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'DEPT')
BEGIN
    CREATE TABLE DEPT (
        DEPTNO INT           NOT NULL PRIMARY KEY,
        DNAME  NVARCHAR(50)  NOT NULL,
        LOC    NVARCHAR(50)  NULL
    );
    PRINT '[OK] Source table DEPT created.';
END
ELSE PRINT '[SKIP] DEPT already exists.';
GO

-- Truncate + reload so script is idempotent
DELETE FROM DEPT;
INSERT INTO DEPT (DEPTNO, DNAME, LOC) VALUES
    (10, 'ACCOUNTING', 'NEW YORK'),
    (20, 'RESEARCH',   'DALLAS'),
    (30, 'SALES',      'CHICAGO'),
    (40, 'OPERATIONS', 'BOSTON');
GO

-- EMP table
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'EMP')
BEGIN
    CREATE TABLE EMP (
        EMPNO    INT            NOT NULL PRIMARY KEY,
        ENAME    NVARCHAR(50)   NOT NULL,
        JOB      NVARCHAR(50)   NULL,
        MGR      INT            NULL,
        HIREDATE DATE           NULL,
        SAL      DECIMAL(10,2)  NULL,
        COMM     DECIMAL(10,2)  NULL,
        DEPTNO   INT            NULL,
        CONSTRAINT FK_EMP_DEPT FOREIGN KEY (DEPTNO) REFERENCES DEPT(DEPTNO)
    );
    PRINT '[OK] Source table EMP created.';
END
ELSE PRINT '[SKIP] EMP already exists.';
GO

DELETE FROM EMP;
INSERT INTO EMP (EMPNO, ENAME, JOB,       MGR,  HIREDATE,     SAL,     COMM,   DEPTNO) VALUES
    (7369, 'SMITH',  'CLERK',    7902, '1980-12-17',  800.00,   NULL,   20),
    (7499, 'ALLEN',  'SALESMAN', 7698, '1981-02-20', 1600.00,  300.00,  30),
    (7521, 'WARD',   'SALESMAN', 7698, '1981-02-22', 1250.00,  500.00,  30),
    (7566, 'JONES',  'MANAGER',  7839, '1981-04-02', 2975.00,   NULL,   20),
    (7654, 'MARTIN', 'SALESMAN', 7698, '1981-09-28', 1250.00, 1400.00,  30),
    (7698, 'BLAKE',  'MANAGER',  7839, '1981-05-01', 2850.00,   NULL,   30),
    (7782, 'CLARK',  'MANAGER',  7839, '1981-06-09', 2450.00,   NULL,   10),
    (7788, 'SCOTT',  'ANALYST',  7566, '1982-12-09', 3000.00,   NULL,   20),
    (7839, 'KING',   'PRESIDENT',NULL, '1981-11-17', 5000.00,   NULL,   10),
    (7844, 'TURNER', 'SALESMAN', 7698, '1981-09-08', 1500.00,    0.00,  30),
    (7876, 'ADAMS',  'CLERK',    7788, '1983-01-12', 1100.00,   NULL,   20),
    (7900, 'JAMES',  'CLERK',    7698, '1981-12-03',  950.00,   NULL,   30),
    (7902, 'FORD',   'ANALYST',  7566, '1981-12-03', 3000.00,   NULL,   20),
    (7934, 'MILLER', 'CLERK',    7782, '1982-01-23', 1300.00,   NULL,   10);
GO

PRINT '[OK] 4 DEPT rows, 14 EMP rows inserted.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION B  Project
-- ─────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM conversion_projects WHERE name = 'Demo')
BEGIN
    INSERT INTO conversion_projects (name, description)
    VALUES ('Demo', 'Demo project using the classic EMP/DEPT schema for testing and visualization.');
    PRINT '[OK] Project "Demo" inserted.';
END
ELSE PRINT '[SKIP] Project "Demo" already exists.';
GO

DECLARE @proj_id INT = (SELECT TOP 1 id FROM conversion_projects WHERE name = 'Demo');

-- ─────────────────────────────────────────────────────────────
-- SECTION C  Source Connections
-- ─────────────────────────────────────────────────────────────

-- Connection 1: Dept_Conversion (MSSQL — same server, demo DB)
IF NOT EXISTS (SELECT 1 FROM conversion_source_connections WHERE name = 'Dept_Conversion')
BEGIN
    INSERT INTO conversion_source_connections
        (project_id, name, source_type, dialect, host, port, database_name, schema_name,
         username, password_enc, is_active)
    VALUES
        (@proj_id, 'Dept_Conversion', 'sql', 'mssql',
         'DESKTOP-G01PH8C\SQLEXPRESS', NULL, 'ConversionAgent', 'dbo',
         'clarityAgentuser', '** ENCRYPTED **', 1);
    PRINT '[OK] Connection "Dept_Conversion" inserted.';
END
ELSE PRINT '[SKIP] Connection "Dept_Conversion" already exists.';

-- Connection 2: HR_Snowflake (Snowflake demo)
IF NOT EXISTS (SELECT 1 FROM conversion_source_connections WHERE name = 'HR_Snowflake')
BEGIN
    INSERT INTO conversion_source_connections
        (project_id, name, source_type,
         sf_account, sf_warehouse, sf_role, sf_database, sf_schema,
         sf_username, sf_password_enc, is_active)
    VALUES
        (@proj_id, 'HR_Snowflake', 'snowflake',
         'demo.snowflakecomputing.com', 'COMPUTE_WH', 'SYSADMIN',
         'HR_DB', 'PUBLIC',
         'demo_user', '** ENCRYPTED **', 1);
    PRINT '[OK] Connection "HR_Snowflake" inserted.';
END
ELSE PRINT '[SKIP] Connection "HR_Snowflake" already exists.';
GO

DECLARE @conn1_id INT = (SELECT TOP 1 id FROM conversion_source_connections WHERE name = 'Dept_Conversion');

-- ─────────────────────────────────────────────────────────────
-- SECTION D  XML Template
-- ─────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM conversion_xml_templates WHERE name = 'Employee Export Template')
BEGIN
    INSERT INTO conversion_xml_templates (project_id, conn_id, name, content)
    SELECT
        (SELECT TOP 1 id FROM conversion_projects WHERE name = 'Demo'),
        @conn1_id,
        'Employee Export Template',
        N'<?xml version="1.0" encoding="UTF-8"?>
<DataExport>
  <Employees each="EMP">
    <Employee>
      <EmployeeID>{EMPNO}</EmployeeID>
      <Name>{ENAME}</Name>
      <Job>{JOB}</Job>
      <HireDate>{HIREDATE}</HireDate>
      <Salary>{SAL}</Salary>
      <Commission>{COMM}</Commission>
      <Department>
        <DeptNo>{DEPTNO}</DeptNo>
        <DeptName>{DNAME}</DeptName>
        <Location>{LOC}</Location>
      </Department>
    </Employee>
  </Employees>
</DataExport>';
    PRINT '[OK] XML Template inserted.';
END
ELSE PRINT '[SKIP] XML Template already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION E  Mapping + Mapping Rows
-- ─────────────────────────────────────────────────────────────

DECLARE @conn1_id  INT = (SELECT TOP 1 id FROM conversion_source_connections WHERE name = 'Dept_Conversion');
DECLARE @tmpl_id   INT = (SELECT TOP 1 id FROM conversion_xml_templates WHERE name = 'Employee Export Template');
DECLARE @proj_id   INT = (SELECT TOP 1 id FROM conversion_projects WHERE name = 'Demo');

IF NOT EXISTS (SELECT 1 FROM conversion_mappings WHERE conn_id = @conn1_id AND version = 1)
BEGIN
    INSERT INTO conversion_mappings
        (project_id, conn_id, template_id, version, is_active, identifier_column, identifier_table)
    VALUES
        (@proj_id, @conn1_id, @tmpl_id, 1, 1, 'EMPNO', 'EMP');
    PRINT '[OK] Mapping inserted.';
END
ELSE PRINT '[SKIP] Mapping already exists.';

DECLARE @map_id INT = (SELECT TOP 1 id FROM conversion_mappings WHERE conn_id = @conn1_id AND version = 1);

IF NOT EXISTS (SELECT 1 FROM conversion_mapping_rows WHERE mapping_id = @map_id)
BEGIN
    INSERT INTO conversion_mapping_rows
        (mapping_id, source_sheet, source_column, formula, target_path, each_sheet, sort_order, confidence)
    VALUES
        (@map_id, 'EMP', 'EMPNO',  NULL,            '/DataExport/Employees/Employee/EmployeeID',                  'EMP', 1,  100),
        (@map_id, 'EMP', 'ENAME',  '{UPPER(ENAME)}', '/DataExport/Employees/Employee/Name',                       'EMP', 2,   95),
        (@map_id, 'EMP', 'JOB',    NULL,             '/DataExport/Employees/Employee/Job',                        'EMP', 3,   90),
        (@map_id, 'EMP', 'HIREDATE',NULL,            '/DataExport/Employees/Employee/HireDate',                   'EMP', 4,   90),
        (@map_id, 'EMP', 'SAL',    NULL,             '/DataExport/Employees/Employee/Salary',                     'EMP', 5,   85),
        (@map_id, 'EMP', 'COMM',   NULL,             '/DataExport/Employees/Employee/Commission',                 'EMP', 6,   80),
        (@map_id, 'DEPT','DEPTNO', NULL,             '/DataExport/Employees/Employee/Department/DeptNo',          'EMP', 7,   88),
        (@map_id, 'DEPT','DNAME',  NULL,             '/DataExport/Employees/Employee/Department/DeptName',        'EMP', 8,   88),
        (@map_id, 'DEPT','LOC',    NULL,             '/DataExport/Employees/Employee/Department/Location',        'EMP', 9,   85);
    PRINT '[OK] 9 mapping rows inserted.';
END
ELSE PRINT '[SKIP] Mapping rows already exist.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION F  Generated Query
-- ─────────────────────────────────────────────────────────────

DECLARE @conn1_id INT = (SELECT TOP 1 id FROM conversion_source_connections WHERE name = 'Dept_Conversion');
DECLARE @tmpl_id  INT = (SELECT TOP 1 id FROM conversion_xml_templates WHERE name = 'Employee Export Template');
DECLARE @map_id   INT = (SELECT TOP 1 id FROM conversion_mappings WHERE conn_id = @conn1_id AND version = 1);

IF NOT EXISTS (SELECT 1 FROM conversion_generated_queries WHERE conn_id = @conn1_id)
BEGIN
    INSERT INTO conversion_generated_queries (conn_id, template_id, mapping_id, query_sql, generated_by)
    VALUES (
        @conn1_id, @tmpl_id, @map_id,
        N'SELECT
    e.EMPNO,
    e.ENAME,
    e.JOB,
    e.HIREDATE,
    e.SAL,
    e.COMM,
    d.DEPTNO,
    d.DNAME,
    d.LOC
FROM EMP e
JOIN DEPT d ON e.DEPTNO = d.DEPTNO
ORDER BY e.EMPNO',
        'ai'
    );
    PRINT '[OK] Generated query inserted.';
END
ELSE PRINT '[SKIP] Generated query already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION G  Generated XML (2 employee records)
-- ─────────────────────────────────────────────────────────────

DECLARE @conn1_id INT = (SELECT TOP 1 id FROM conversion_source_connections WHERE name = 'Dept_Conversion');
DECLARE @map_id   INT = (SELECT TOP 1 id FROM conversion_mappings WHERE conn_id = @conn1_id AND version = 1);

IF NOT EXISTS (SELECT 1 FROM conversion_generated_xml WHERE identifier_value = '7369')
BEGIN
    INSERT INTO conversion_generated_xml
        (conn_id, mapping_id, identifier_value, xml_content, validation_status, validation_comment)
    VALUES
        (@conn1_id, @map_id, '7369',
         N'<?xml version="1.0" encoding="UTF-8"?>
<DataExport>
  <Employees>
    <Employee>
      <EmployeeID>7369</EmployeeID>
      <Name>SMITH</Name>
      <Job>CLERK</Job>
      <HireDate>1980-12-17</HireDate>
      <Salary>800.00</Salary>
      <Commission></Commission>
      <Department>
        <DeptNo>20</DeptNo>
        <DeptName>RESEARCH</DeptName>
        <Location>DALLAS</Location>
      </Department>
    </Employee>
  </Employees>
</DataExport>',
         'pass', NULL),
        (@conn1_id, @map_id, '7566',
         N'<?xml version="1.0" encoding="UTF-8"?>
<DataExport>
  <Employees>
    <Employee>
      <EmployeeID>7566</EmployeeID>
      <Name>JONES</Name>
      <Job>MANAGER</Job>
      <HireDate>1981-04-02</HireDate>
      <Salary>2975.00</Salary>
      <Commission></Commission>
      <Department>
        <DeptNo>20</DeptNo>
        <DeptName>RESEARCH</DeptName>
        <Location>DALLAS</Location>
      </Department>
    </Employee>
  </Employees>
</DataExport>',
         'pass', NULL);
    PRINT '[OK] 2 generated XML records inserted.';
END
ELSE PRINT '[SKIP] Generated XML records already exist.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION H  Run Logs
-- ─────────────────────────────────────────────────────────────

DECLARE @proj_id INT = (SELECT TOP 1 id FROM conversion_projects WHERE name = 'Demo');
DECLARE @map_id  INT = (
    SELECT TOP 1 m.id
    FROM conversion_mappings m
    JOIN conversion_source_connections c ON c.id = m.conn_id
    WHERE c.name = 'Dept_Conversion' AND m.version = 1
);

IF NOT EXISTS (SELECT 1 FROM conversion_run_logs WHERE project_id = @proj_id)
BEGIN
    INSERT INTO conversion_run_logs
        (project_id, mapping_id, triggered_by, status, source_rows, target_url, target_status, errors, started_at, finished_at)
    VALUES
        (@proj_id, @map_id, 'manual', 'success',
         N'{"EMP": 14, "DEPT": 4}',
         'http://localhost:8000/api/xml/submit',
         200, NULL,
         DATEADD(MINUTE, -30, GETUTCDATE()),
         DATEADD(MINUTE, -29, GETUTCDATE())),
        (@proj_id, @map_id, 'schedule', 'failed',
         N'{"EMP": 0}',
         NULL, NULL,
         N'["Connection timed out after 30s"]',
         DATEADD(HOUR, -2, GETUTCDATE()),
         DATEADD(HOUR, -2, DATEADD(SECOND, 30, GETUTCDATE())));
    PRINT '[OK] 2 run log entries inserted.';
END
ELSE PRINT '[SKIP] Run log entries already exist.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION I  PS Conversation + Messages
-- ─────────────────────────────────────────────────────────────

DECLARE @conn1_id INT = (SELECT TOP 1 id FROM conversion_source_connections WHERE name = 'Dept_Conversion');

IF NOT EXISTS (SELECT 1 FROM conversion_ps_conversations WHERE title = 'Dept salary analysis')
BEGIN
    INSERT INTO conversion_ps_conversations (title, conn_id, provider, model)
    VALUES ('Dept salary analysis', @conn1_id, 'openai', 'gpt-4o-mini');
    PRINT '[OK] PS conversation inserted.';
END
ELSE PRINT '[SKIP] PS conversation already exists.';

DECLARE @conv_id INT = (SELECT TOP 1 id FROM conversion_ps_conversations WHERE title = 'Dept salary analysis');

IF NOT EXISTS (SELECT 1 FROM conversion_ps_messages WHERE conversation_id = @conv_id)
BEGIN
    INSERT INTO conversion_ps_messages (conversation_id, role, content)
    VALUES
        (@conv_id, 'user',      'Show me average salary by department'),
        (@conv_id, 'assistant', 'I''ll query the EMP and DEPT tables for average salaries by department.'),
        (@conv_id, 'tool',      NULL),
        (@conv_id, 'assistant',
         'Here are the average salaries by department:

| Department | Avg Salary |
|------------|-----------|
| ACCOUNTING | $2,916.67 |
| RESEARCH   | $2,175.00 |
| SALES      | $1,566.67 |
');
    PRINT '[OK] 4 PS messages inserted.';
END
ELSE PRINT '[SKIP] PS messages already exist.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION J  PS Workflow — Nightly Dept Salary Report
-- ─────────────────────────────────────────────────────────────

DECLARE @conn1_id INT = (SELECT TOP 1 id FROM conversion_source_connections WHERE name = 'Dept_Conversion');

IF NOT EXISTS (SELECT 1 FROM conversion_ps_workflows WHERE name = 'Nightly Dept Salary Report')
BEGIN
    INSERT INTO conversion_ps_workflows (name, description, conn_id, is_active)
    VALUES ('Nightly Dept Salary Report',
            'Runs avg salary query every night and emails the result to management.',
            @conn1_id, 1);
    PRINT '[OK] Workflow inserted.';
END
ELSE PRINT '[SKIP] Workflow already exists.';

DECLARE @wf_id INT = (SELECT TOP 1 id FROM conversion_ps_workflows WHERE name = 'Nightly Dept Salary Report');

-- Steps
IF NOT EXISTS (SELECT 1 FROM conversion_ps_workflow_steps WHERE workflow_id = @wf_id)
BEGIN
    INSERT INTO conversion_ps_workflow_steps (workflow_id, step_order, step_type, label, config_json)
    VALUES
        (@wf_id, 1, 'sql', 'Fetch dept salaries',
         N'{"sql":"SELECT d.DNAME, AVG(e.SAL) AS AvgSal FROM EMP e JOIN DEPT d ON e.DEPTNO=d.DEPTNO GROUP BY d.DNAME","conn_id":' + CAST(@conn1_id AS NVARCHAR) + N'}'),
        (@wf_id, 2, 'email', 'Email management',
         N'{"to":"management@company.com","subject":"Nightly Salary Report","body":"Please find the attached department salary summary."}');
    PRINT '[OK] 2 workflow steps inserted.';
END
ELSE PRINT '[SKIP] Workflow steps already exist.';

-- Schedule — daily at 06:00
IF NOT EXISTS (SELECT 1 FROM conversion_ps_workflow_schedules WHERE workflow_id = @wf_id)
BEGIN
    INSERT INTO conversion_ps_workflow_schedules
        (workflow_id, schedule_type, run_at_time, is_enabled)
    VALUES (@wf_id, 'daily', '06:00', 1);
    PRINT '[OK] Workflow schedule inserted.';
END
ELSE PRINT '[SKIP] Workflow schedule already exists.';

-- One completed run
IF NOT EXISTS (SELECT 1 FROM conversion_ps_workflow_runs WHERE workflow_id = @wf_id)
BEGIN
    INSERT INTO conversion_ps_workflow_runs
        (workflow_id, triggered_by, status, started_at, finished_at, summary_json)
    VALUES
        (@wf_id, 'schedule', 'success',
         DATEADD(HOUR, -18, GETUTCDATE()),
         DATEADD(HOUR, -18, DATEADD(SECOND, 8, GETUTCDATE())),
         N'{"rows_fetched":14,"email_sent":true}');
    PRINT '[OK] Workflow run inserted.';
END
ELSE PRINT '[SKIP] Workflow run already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION K  Dashboard Config
-- ─────────────────────────────────────────────────────────────

DECLARE @proj_id  INT = (SELECT TOP 1 id FROM conversion_projects WHERE name = 'Demo');
DECLARE @conn1_id INT = (SELECT TOP 1 id FROM conversion_source_connections WHERE name = 'Dept_Conversion');

IF NOT EXISTS (SELECT 1 FROM conversion_dashboard_configs WHERE name = 'Employee Smith Information')
BEGIN
    INSERT INTO conversion_dashboard_configs
        (project_id, conn_id, name, description, config_json)
    VALUES (
        @proj_id, @conn1_id,
        'Employee Smith Information',
        'Dashboard displaying various metrics and information related to employee Smith.',
        N'{
  "tabName": "Employee Smith Information",
  "description": "Dashboard displaying various metrics and information related to employee Smith.",
  "widgets": [
    {
      "id": "kpi-total-emp",
      "type": "kpi",
      "title": "Total Employees",
      "layout": {"x":0,"y":0,"w":4,"h":2},
      "dataBinding": {
        "sql": "SELECT COUNT(*) AS value FROM EMP WHERE ENAME = ''SMITH''",
        "valueField": "value"
      }
    },
    {
      "id": "kpi-total-sal",
      "type": "kpi",
      "title": "Total Salary of Smith",
      "layout": {"x":4,"y":0,"w":4,"h":2},
      "dataBinding": {
        "sql": "SELECT SUM(SAL) AS value FROM EMP WHERE ENAME = ''SMITH''",
        "valueField": "value"
      }
    },
    {
      "id": "bar-dept-salary",
      "type": "bar",
      "title": "Employee Salaries by Department",
      "layout": {"x":8,"y":0,"w":4,"h":4},
      "dataBinding": {
        "sql": "SELECT d.DNAME AS name, AVG(e.SAL) AS value FROM EMP e JOIN DEPT d ON e.DEPTNO=d.DEPTNO GROUP BY d.DNAME",
        "xField": "name",
        "yField": "value"
      }
    },
    {
      "id": "table-emp-detail",
      "type": "table",
      "title": "Employee Detail",
      "layout": {"x":0,"y":2,"w":8,"h":4},
      "dataBinding": {
        "sql": "SELECT e.EMPNO, e.ENAME, e.JOB, e.SAL, d.DNAME FROM EMP e JOIN DEPT d ON e.DEPTNO=d.DEPTNO WHERE e.ENAME = ''SMITH''"
      }
    }
  ]
}'
    );
    PRINT '[OK] Dashboard "Employee Smith Information" inserted.';
END
ELSE PRINT '[SKIP] Dashboard already exists.';

-- Second dashboard: Employee Performance
IF NOT EXISTS (SELECT 1 FROM conversion_dashboard_configs WHERE name = 'Employee Performance Dashboard')
BEGIN
    INSERT INTO conversion_dashboard_configs
        (project_id, conn_id, name, description, config_json)
    VALUES (
        @proj_id, @conn1_id,
        'Employee Performance Dashboard',
        'Overview of all employee salaries, jobs, and department distribution.',
        N'{
  "tabName": "Employee Performance Dashboard",
  "description": "Overview of all employee salaries, jobs, and department distribution.",
  "widgets": [
    {
      "id": "kpi-headcount",
      "type": "kpi",
      "title": "Total Headcount",
      "layout": {"x":0,"y":0,"w":3,"h":2},
      "dataBinding": {
        "sql": "SELECT COUNT(*) AS value FROM EMP",
        "valueField": "value"
      }
    },
    {
      "id": "kpi-avg-sal",
      "type": "kpi",
      "title": "Avg Salary",
      "layout": {"x":3,"y":0,"w":3,"h":2},
      "dataBinding": {
        "sql": "SELECT CAST(AVG(SAL) AS INT) AS value FROM EMP",
        "valueField": "value"
      }
    },
    {
      "id": "kpi-max-sal",
      "type": "kpi",
      "title": "Max Salary",
      "layout": {"x":6,"y":0,"w":3,"h":2},
      "dataBinding": {
        "sql": "SELECT MAX(SAL) AS value FROM EMP",
        "valueField": "value"
      }
    },
    {
      "id": "kpi-depts",
      "type": "kpi",
      "title": "Departments",
      "layout": {"x":9,"y":0,"w":3,"h":2},
      "dataBinding": {
        "sql": "SELECT COUNT(DISTINCT DEPTNO) AS value FROM DEPT",
        "valueField": "value"
      }
    },
    {
      "id": "bar-sal-by-dept",
      "type": "bar",
      "title": "Total Salary by Department",
      "layout": {"x":0,"y":2,"w":6,"h":4},
      "dataBinding": {
        "sql": "SELECT d.DNAME AS name, SUM(e.SAL) AS value FROM EMP e JOIN DEPT d ON e.DEPTNO=d.DEPTNO GROUP BY d.DNAME ORDER BY value DESC",
        "xField": "name",
        "yField": "value"
      }
    },
    {
      "id": "pie-job-dist",
      "type": "pie",
      "title": "Job Distribution",
      "layout": {"x":6,"y":2,"w":6,"h":4},
      "dataBinding": {
        "sql": "SELECT JOB AS name, COUNT(*) AS value FROM EMP GROUP BY JOB",
        "labelField": "name",
        "valueField": "value"
      }
    },
    {
      "id": "table-all-emp",
      "type": "table",
      "title": "All Employees",
      "layout": {"x":0,"y":6,"w":12,"h":5},
      "dataBinding": {
        "sql": "SELECT e.EMPNO, e.ENAME, e.JOB, e.HIREDATE, e.SAL, e.COMM, d.DNAME, d.LOC FROM EMP e JOIN DEPT d ON e.DEPTNO=d.DEPTNO ORDER BY e.SAL DESC"
      }
    }
  ]
}'
    );
    PRINT '[OK] Dashboard "Employee Performance Dashboard" inserted.';
END
ELSE PRINT '[SKIP] Employee Performance Dashboard already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION L  Saved Reports
-- ─────────────────────────────────────────────────────────────

DECLARE @conn1_id INT = (SELECT TOP 1 id FROM conversion_source_connections WHERE name = 'Dept_Conversion');

IF NOT EXISTS (SELECT 1 FROM conversion_saved_reports WHERE conn_id = @conn1_id AND name = 'Avg Salary by Department')
BEGIN
    INSERT INTO conversion_saved_reports (conn_id, name, query_sql)
    VALUES
        (@conn1_id, 'Avg Salary by Department',
         N'SELECT d.DNAME, CAST(AVG(e.SAL) AS DECIMAL(10,2)) AS AvgSalary, COUNT(e.EMPNO) AS HeadCount
FROM EMP e
JOIN DEPT d ON e.DEPTNO = d.DEPTNO
GROUP BY d.DNAME
ORDER BY AvgSalary DESC'),
        (@conn1_id, 'Smith Employee Details',
         N'SELECT * FROM EMP WHERE ENAME = ''SMITH'''),
        (@conn1_id, 'Top Earners',
         N'SELECT TOP 5 e.ENAME, e.JOB, e.SAL, d.DNAME
FROM EMP e JOIN DEPT d ON e.DEPTNO=d.DEPTNO
ORDER BY e.SAL DESC');
    PRINT '[OK] 3 saved reports inserted.';
END
ELSE PRINT '[SKIP] Saved reports already exist.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION M  Query Examples (few-shot AI hints)
-- ─────────────────────────────────────────────────────────────

DECLARE @conn1_id INT = (SELECT TOP 1 id FROM conversion_source_connections WHERE name = 'Dept_Conversion');

IF NOT EXISTS (SELECT 1 FROM conversion_query_examples WHERE conn_id = @conn1_id)
BEGIN
    INSERT INTO conversion_query_examples (conn_id, name, description, tables_used, example_sql, is_active)
    VALUES
        (@conn1_id, 'Headcount by Department',
         'Count employees in each department',
         'EMP,DEPT',
         N'SELECT d.DNAME, COUNT(e.EMPNO) AS HeadCount
FROM EMP e JOIN DEPT d ON e.DEPTNO = d.DEPTNO
GROUP BY d.DNAME
ORDER BY HeadCount DESC',
         1),
        (@conn1_id, 'Employees With Manager Names',
         'List employees alongside their manager name',
         'EMP',
         N'SELECT e.ENAME AS Employee, m.ENAME AS Manager, e.JOB
FROM EMP e
LEFT JOIN EMP m ON e.MGR = m.EMPNO
ORDER BY e.ENAME',
         1),
        (@conn1_id, 'Salary Grade Buckets',
         'Classify employee salaries into bands',
         'EMP',
         N'SELECT ENAME, SAL,
    CASE
        WHEN SAL < 1000  THEN ''Low''
        WHEN SAL < 2500  THEN ''Mid''
        ELSE                  ''High''
    END AS SalaryBand
FROM EMP
ORDER BY SAL DESC',
         1);
    PRINT '[OK] 3 query examples inserted.';
END
ELSE PRINT '[SKIP] Query examples already exist.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION N  PII Policy — mask SAL column
-- ─────────────────────────────────────────────────────────────

DECLARE @proj_id  INT = (SELECT TOP 1 id FROM conversion_projects WHERE name = 'Demo');
DECLARE @conn1_id INT = (SELECT TOP 1 id FROM conversion_source_connections WHERE name = 'Dept_Conversion');

IF NOT EXISTS (SELECT 1 FROM conversion_pii_policies WHERE project_id = @proj_id AND column_name = 'SAL')
BEGIN
    INSERT INTO conversion_pii_policies
        (project_id, source_id, column_name, pii_type, detection_mode, action, mask_pattern, is_active)
    VALUES
        (@proj_id, @conn1_id, 'SAL',   'custom', 'manual', 'mask',   '***.**',     1),
        (@proj_id, @conn1_id, 'COMM',  'custom', 'manual', 'redact', NULL,          1),
        (@proj_id, NULL,      'email', 'email',  'auto',   'mask',   '***@***.com', 1);
    PRINT '[OK] 3 PII policies inserted.';
END
ELSE PRINT '[SKIP] PII policies already exist.';
GO

-- ─────────────────────────────────────────────────────────────
-- SECTION O  Schema Metadata (aliases for AI)
-- ─────────────────────────────────────────────────────────────

DECLARE @conn1_id INT = (SELECT TOP 1 id FROM conversion_source_connections WHERE name = 'Dept_Conversion');

IF NOT EXISTS (SELECT 1 FROM conversion_schema_metadata WHERE conn_id = @conn1_id)
BEGIN
    INSERT INTO conversion_schema_metadata (conn_id, table_name, column_name, aliases, description)
    VALUES
        (@conn1_id, 'EMP',  NULL,     'Employee,Employees,Staff',         'Main employee master table'),
        (@conn1_id, 'DEPT', NULL,     'Department,Departments,Divisions',  'Department reference table'),
        (@conn1_id, 'EMP',  'EMPNO',  'EmployeeID,EmpID,ID',              'Unique employee identifier'),
        (@conn1_id, 'EMP',  'ENAME',  'EmployeeName,Name,FullName',       'Employee full name'),
        (@conn1_id, 'EMP',  'SAL',    'Salary,Pay,Compensation',          'Monthly base salary'),
        (@conn1_id, 'EMP',  'COMM',   'Commission,Bonus',                 'Sales commission amount'),
        (@conn1_id, 'DEPT', 'DNAME',  'DepartmentName,DeptName',          'Name of the department');
    PRINT '[OK] 7 schema metadata entries inserted.';
END
ELSE PRINT '[SKIP] Schema metadata already exists.';
GO

-- ─────────────────────────────────────────────────────────────
-- Summary
-- ─────────────────────────────────────────────────────────────

SELECT 'DEPT'                        AS [Table], COUNT(*) AS [Rows] FROM DEPT
UNION ALL
SELECT 'EMP',                                    COUNT(*) FROM EMP
UNION ALL
SELECT 'conversion_projects',                    COUNT(*) FROM conversion_projects
UNION ALL
SELECT 'conversion_source_connections',          COUNT(*) FROM conversion_source_connections
UNION ALL
SELECT 'conversion_xml_templates',               COUNT(*) FROM conversion_xml_templates
UNION ALL
SELECT 'conversion_mappings',                    COUNT(*) FROM conversion_mappings
UNION ALL
SELECT 'conversion_mapping_rows',                COUNT(*) FROM conversion_mapping_rows
UNION ALL
SELECT 'conversion_generated_queries',           COUNT(*) FROM conversion_generated_queries
UNION ALL
SELECT 'conversion_generated_xml',               COUNT(*) FROM conversion_generated_xml
UNION ALL
SELECT 'conversion_run_logs',                    COUNT(*) FROM conversion_run_logs
UNION ALL
SELECT 'conversion_ps_conversations',            COUNT(*) FROM conversion_ps_conversations
UNION ALL
SELECT 'conversion_ps_messages',                 COUNT(*) FROM conversion_ps_messages
UNION ALL
SELECT 'conversion_ps_workflows',                COUNT(*) FROM conversion_ps_workflows
UNION ALL
SELECT 'conversion_ps_workflow_steps',           COUNT(*) FROM conversion_ps_workflow_steps
UNION ALL
SELECT 'conversion_ps_workflow_schedules',       COUNT(*) FROM conversion_ps_workflow_schedules
UNION ALL
SELECT 'conversion_ps_workflow_runs',            COUNT(*) FROM conversion_ps_workflow_runs
UNION ALL
SELECT 'conversion_dashboard_configs',           COUNT(*) FROM conversion_dashboard_configs
UNION ALL
SELECT 'conversion_saved_reports',               COUNT(*) FROM conversion_saved_reports
UNION ALL
SELECT 'conversion_query_examples',              COUNT(*) FROM conversion_query_examples
UNION ALL
SELECT 'conversion_pii_policies',                COUNT(*) FROM conversion_pii_policies
UNION ALL
SELECT 'conversion_schema_metadata',             COUNT(*) FROM conversion_schema_metadata
ORDER BY 1;
GO

PRINT '';
PRINT '============================================================';
PRINT ' V3 complete — sample data loaded.';
PRINT '============================================================';
GO
