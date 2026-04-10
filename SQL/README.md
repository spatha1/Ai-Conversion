# ConversionAgent — SQL Deployment Scripts

Versioned, idempotent SQL Server scripts for deploying and seeding the
ConversionAgent application database from scratch.

---

## Folder Structure

```
SQL/
├── README.md                ← you are here
├── run_all.sql              ← master script (runs V1 → V4 in order)
├── V1__database_setup.sql   ← creates DB, SQL login, db_owner user
├── V2__create_tables.sql    ← all 25 application tables (IF NOT EXISTS)
├── V3__sample_data.sql      ← demo EMP/DEPT source tables + full app seed
└── V4__migrations.sql       ← ALTER TABLE patches (add columns, indexes)
```

### Version Map

| File | Purpose | Depends On |
|------|---------|------------|
| V1 | DB `ConversionAgent`, login `clarityAgentuser`, role `db_owner` | none (run as sysadmin) |
| V2 | 25 `conversion_*` tables with PKs, FKs, indexes | V1 |
| V3 | Demo `DEPT`/`EMP` tables + seed rows for every app table | V2 |
| V4 | Idempotent `ALTER TABLE` patches mirroring `api/migrate.py` | V2 |

---

## Quick Start

### Option A — SSMS (recommended for first run)

1. Open **SQL Server Management Studio**
2. Connect as **sysadmin** (Windows auth or `sa`)
3. Open `run_all.sql` → press **F5**

> `run_all.sql` uses `:r` includes, which requires **SSMS** or **sqlcmd** mode.
> In SSMS: Query menu → **SQLCMD Mode** → then Execute.

### Option B — sqlcmd (Windows auth)

```bat
cd C:\Users\Admin-1\Desktop\Conversionproject\SQL

sqlcmd -S "DESKTOP-G01PH8C\SQLEXPRESS" -E -i run_all.sql
```

### Option C — sqlcmd (SQL auth)

```bat
sqlcmd -S "DESKTOP-G01PH8C\SQLEXPRESS" -U sa -P YourSAPassword -i run_all.sql
```

### Option D — Run scripts individually

Run in this exact order:

```bat
sqlcmd -S "DESKTOP-G01PH8C\SQLEXPRESS" -E -i V1__database_setup.sql
sqlcmd -S "DESKTOP-G01PH8C\SQLEXPRESS" -E -i V2__create_tables.sql
sqlcmd -S "DESKTOP-G01PH8C\SQLEXPRESS" -E -i V3__sample_data.sql
sqlcmd -S "DESKTOP-G01PH8C\SQLEXPRESS" -E -i V4__migrations.sql
```

---

## What V3 Seeds

### Source Tables (demo legacy data)

| Table | Rows | Notes |
|-------|------|-------|
| `DEPT` | 4 | ACCOUNTING, RESEARCH, SALES, OPERATIONS |
| `EMP` | 14 | Classic Oracle SCOTT schema employees |

### Application Seed Data

| Table | Rows | Description |
|-------|------|-------------|
| `conversion_projects` | 1 | "Demo" project |
| `conversion_source_connections` | 2 | Dept_Conversion (MSSQL), HR_Snowflake |
| `conversion_xml_templates` | 1 | Employee Export Template |
| `conversion_mappings` | 1 | EMP → XML, version 1, active |
| `conversion_mapping_rows` | 9 | Full EMP+DEPT field mappings with confidence |
| `conversion_generated_queries` | 1 | AI-generated JOIN query |
| `conversion_generated_xml` | 2 | SMITH (7369) and JONES (7566) XML output |
| `conversion_run_logs` | 2 | 1 success + 1 failed run |
| `conversion_ps_conversations` | 1 | "Dept salary analysis" |
| `conversion_ps_messages` | 4 | Full user/assistant/tool turn |
| `conversion_ps_workflows` | 1 | "Nightly Dept Salary Report" |
| `conversion_ps_workflow_steps` | 2 | SQL step + email step |
| `conversion_ps_workflow_schedules` | 1 | Daily at 06:00 |
| `conversion_ps_workflow_runs` | 1 | Completed schedule run |
| `conversion_dashboard_configs` | 2 | Smith dashboard + Performance dashboard |
| `conversion_saved_reports` | 3 | Avg salary, Smith details, Top earners |
| `conversion_query_examples` | 3 | Few-shot AI examples |
| `conversion_pii_policies` | 3 | SAL mask, COMM redact, email mask |
| `conversion_schema_metadata` | 7 | Table/column aliases for AI |

---

## Re-running / Resetting

All scripts are **idempotent** — safe to run multiple times.

To **reset sample data** only (wipe and reload V3 rows):

```sql
-- In SSMS against ConversionAgent
DELETE FROM conversion_schema_metadata;
DELETE FROM conversion_pii_policies;
DELETE FROM conversion_saved_reports;
DELETE FROM conversion_dashboard_configs;
DELETE FROM conversion_ps_workflow_runs;
DELETE FROM conversion_ps_workflow_schedules;
DELETE FROM conversion_ps_workflow_steps;
DELETE FROM conversion_ps_workflows;
DELETE FROM conversion_ps_messages;
DELETE FROM conversion_ps_conversations;
DELETE FROM conversion_run_logs;
DELETE FROM conversion_generated_xml;
DELETE FROM conversion_generated_queries;
DELETE FROM conversion_mapping_rows;
DELETE FROM conversion_mappings;
DELETE FROM conversion_xml_templates;
DELETE FROM conversion_source_connections;
DELETE FROM conversion_query_examples;
DELETE FROM conversion_projects;
DELETE FROM EMP;
DELETE FROM DEPT;
```

Then re-run `V3__sample_data.sql`.

---

## Adding Future Migrations

1. Open `V4__migrations.sql`
2. Scroll to the `▼▼▼ FUTURE PATCHES` comment at the bottom
3. Add your patch using the template provided
4. Increment the patch number (e.g. `PATCH 4.12`)

---

## Connection Details (default)

| Setting | Value |
|---------|-------|
| Server | `DESKTOP-G01PH8C\SQLEXPRESS` |
| Database | `ConversionAgent` |
| App Login | `clarityAgentuser` |
| App Password | Set in V1 — change before production |
| Role | `db_owner` |
