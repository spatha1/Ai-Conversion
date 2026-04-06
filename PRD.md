# Product Requirements Document
## Data Conversion Studio — Backend & Source Connectivity

**Version:** 1.2
**Date:** 2026-03-05
**Status:** Active

---

## 1. Overview

Extend the existing browser-based Data Conversion Studio with a **Python REST API backend** that:
- Persists mappings and formulas in a **SQL database**
- Accepts live data from **SQL databases** and **Snowflake** as source (in addition to Excel/CSV)
- Generates and delivers XML to target APIs
- Provides a project/version management layer for enterprise use
- Enforces **PII middleware guardrails** at the data ingestion layer to detect, classify, mask, and audit sensitive data before it reaches the mapping or output pipeline

---

## 2. Current State (Phase 1 — Complete)

| Component | Status |
|---|---|
| Browser UI — 4-tab layout (Source, Target, Mapping, Output) | ✅ Done |
| Excel / CSV file upload + grid view | ✅ Done |
| XML template upload + tree view | ✅ Done |
| Auto-mapping (Jaccard similarity) + manual mapping table | ✅ Done |
| Formula evaluator (UPPER, CONCAT, IF, FORMAT_DATE, etc.) | ✅ Done |
| XML generation with iterative nodes (`each="SheetName"`) | ✅ Done |
| Send to target API (POST/PUT with bearer auth) | ✅ Done |
| Save/Load mapping as JSON file | ✅ Done |

---

## 3. Phase 2 Goals

### 3.1 Python REST API
- Replace local file-based mapping save/load with persistent API-backed storage
- Execute source queries (SQL / Snowflake) server-side and stream data to the UI
- Run XML generation server-side (useful for large datasets)
- Schedule and log conversion runs

### 3.2 SQL Database (Mapping & Formula Store)
- Store projects, mappings, formulas, source configs, and run history
- Support SQLite (dev) and PostgreSQL (prod) via SQLAlchemy

### 3.3 Source Connectivity
- **SQL databases:** PostgreSQL, MySQL, MSSQL, SQLite via connection string
- **Snowflake:** account/warehouse/database/schema/role + key-pair or password auth
- Query builder: raw SQL or table/view selector with column preview
- Each query result becomes a named "sheet" (same model as Excel sheets)

### 3.4 PII Middleware Guardrails
- Automatically detect PII fields in source data at ingestion time
- Apply configurable masking, redaction, or tokenization per column
- Block or warn before PII reaches preview, mapping, or XML output
- Maintain a full audit trail of every PII field access and transformation

---

## 4. Architecture

```
┌─────────────────────────────────────────────────┐
│                  Browser UI                      │
│  (existing HTML/JS — tabs: Source, Target,       │
│   Mapping, Output)                               │
└────────────────┬────────────────────────────────┘
                 │ REST / JSON (fetch)
┌────────────────▼────────────────────────────────┐
│            Python FastAPI Backend                │
│                                                  │
│  /api/projects        – CRUD for projects        │
│  /api/mappings        – CRUD for mappings        │
│  /api/sources         – CRUD for source configs  │
│  /api/sources/preview – Run query, return rows   │
│  /api/run             – Generate XML, post to API│
│  /api/runs            – Run history & logs       │
│  /api/pii             – PII policy management    │
└──────┬───────────────────────────┬──────────────┘
       │ SQLAlchemy                 │ Connectors
┌──────▼──────┐          ┌─────────▼─────────────┐
│  SQL DB     │          │  Source Databases       │
│  SQLite/    │          │  ┌──────────────────┐   │
│  PostgreSQL │          │  │ PostgreSQL/MySQL  │   │
│             │          │  │ MSSQL / SQLite   │   │
│  Tables:    │          │  └────────┬─────────┘   │
│  projects   │          │           │              │
│  mappings   │          │  ┌────────▼─────────┐   │
│  formulas   │          │  │  PII Middleware   │   │
│  sources    │          │  │  ──────────────  │   │
│  xml_templates         │  │  1. Detect/Tag   │   │
│  run_logs   │          │  │  2. Mask/Redact  │   │
│  pii_policies          │  │  3. Audit Log    │   │
│  pii_audit_logs        │  └────────┬─────────┘   │
└─────────────┘          │  ┌────────▼─────────┐   │
                         │  │ Snowflake         │   │
                         │  │ (snowflake-       │   │
                         │  │  connector)       │   │
                         │  └──────────────────┘   │
                         └────────────────────────-─┘
```

---

## 5. Database Schema

### 5.1 `projects`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | VARCHAR(200) | |
| description | TEXT | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### 5.2 `source_configs`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK → projects | |
| name | VARCHAR(200) | Display name, e.g. "Orders DB" |
| source_type | ENUM | `sql`, `snowflake`, `excel`, `csv` |
| connection_string | TEXT | Encrypted at rest (SQL types) |
| snowflake_config | JSONB | account, warehouse, db, schema, role |
| query | TEXT | SQL query or table name |
| sheet_alias | VARCHAR(100) | Maps to XML `each="…"` name |
| created_at | TIMESTAMP | |

### 5.3 `xml_templates`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK → projects | |
| name | VARCHAR(200) | |
| content | TEXT | Raw XML template string |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### 5.4 `mappings`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK → projects | |
| template_id | UUID FK → xml_templates | |
| version | INTEGER | Auto-increment per project |
| is_active | BOOLEAN | Only one active per project |
| created_at | TIMESTAMP | |

### 5.5 `mapping_rows`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| mapping_id | UUID FK → mappings | |
| source_sheet | VARCHAR(100) | Sheet/alias name |
| source_column | VARCHAR(200) | Column name |
| formula | TEXT | e.g. `{UPPER(Status)}` |
| target_path | TEXT | e.g. `/DataExport/Orders/Order/Status` |
| each_sheet | VARCHAR(100) | Inherited `each` scope |
| sort_order | INTEGER | Display order |

### 5.6 `run_logs`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK → projects | |
| mapping_id | UUID FK → mappings | |
| triggered_by | VARCHAR(100) | `manual`, `schedule`, `api` |
| status | ENUM | `running`, `success`, `failed` |
| source_rows | JSONB | `{sheet: row_count}` |
| output_xml | TEXT | Generated XML (or S3 path for large) |
| target_url | TEXT | API endpoint used |
| target_status | INTEGER | HTTP response code |
| errors | JSONB | List of formula/generation errors |
| started_at | TIMESTAMP | |
| finished_at | TIMESTAMP | |

### 5.7 `pii_policies` *(NEW)*
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK → projects | |
| source_id | UUID FK → source_configs (nullable) | NULL = project-wide default |
| column_name | VARCHAR(200) | Column name or `*` wildcard |
| pii_type | ENUM | `ssn`, `email`, `phone`, `credit_card`, `dob`, `name`, `address`, `ip_address`, `custom` |
| detection_mode | ENUM | `auto` (regex scan) or `manual` (explicit tag) |
| action | ENUM | `mask`, `redact`, `tokenize`, `block`, `allow` |
| mask_pattern | VARCHAR(100) | e.g. `***-**-{last4}`, `{first}***@{domain}` |
| is_active | BOOLEAN | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### 5.8 `pii_audit_logs` *(NEW)*
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK → projects | |
| source_id | UUID FK → source_configs | |
| run_id | UUID FK → run_logs (nullable) | NULL = preview-time access |
| column_name | VARCHAR(200) | |
| pii_type | VARCHAR(100) | Detected type |
| action_applied | VARCHAR(50) | What guardrail did |
| row_count | INTEGER | Rows where PII was found |
| accessed_at | TIMESTAMP | |

---

## 6. API Endpoints

### Projects
```
GET    /api/projects                    – list all projects
POST   /api/projects                    – create project
GET    /api/projects/{id}               – get project detail
PUT    /api/projects/{id}               – update project
DELETE /api/projects/{id}               – delete project
```

### Source Configs
```
GET    /api/projects/{id}/sources       – list sources for project
POST   /api/projects/{id}/sources       – create source config
PUT    /api/sources/{id}                – update source config
DELETE /api/sources/{id}                – delete source config
POST   /api/sources/{id}/preview        – run query, return first 100 rows + columns
POST   /api/sources/{id}/test           – test connection only (no data)
GET    /api/sources/{id}/pii-scan       – run PII scan on column names + sample rows
```

### XML Templates
```
GET    /api/projects/{id}/templates     – list templates
POST   /api/projects/{id}/templates     – upload/save XML template
GET    /api/templates/{id}              – get template content
PUT    /api/templates/{id}              – update template
DELETE /api/templates/{id}              – delete template
```

### Mappings
```
GET    /api/projects/{id}/mappings      – list mapping versions
POST   /api/projects/{id}/mappings      – save new mapping version
GET    /api/mappings/{id}               – get mapping rows
PUT    /api/mappings/{id}/activate      – set as active mapping
```

### Run
```
POST   /api/projects/{id}/run           – execute: fetch source → PII check → generate XML → post to target
GET    /api/projects/{id}/runs          – run history
GET    /api/runs/{id}                   – run detail + generated XML + errors
```

### PII Policy Management *(NEW)*
```
GET    /api/projects/{id}/pii/policies         – list all PII policies for project
POST   /api/projects/{id}/pii/policies         – create or update policy for a column
PUT    /api/pii/policies/{id}                  – update a single policy
DELETE /api/pii/policies/{id}                  – delete policy
GET    /api/sources/{id}/pii/scan              – scan source schema + sample data, return detected PII columns
POST   /api/sources/{id}/pii/approve           – bulk-approve or override auto-detected policies
GET    /api/projects/{id}/pii/audit-log        – list audit log entries
```

---

## 7. Source Connectivity Requirements

### 7.1 SQL Sources
- Supported dialects: **PostgreSQL, MySQL, MSSQL, SQLite**
- Connection: standard SQLAlchemy connection string
- Credentials stored **encrypted** (Fernet / AES-256)
- Features:
  - Test connection endpoint
  - List tables/views in schema
  - Run arbitrary SELECT query
  - Return columns + up to 1000 preview rows
  - Named result sets map to sheet aliases

### 7.2 Snowflake Sources
- Auth: username/password **or** key-pair (private key PEM)
- Config fields: account, warehouse, database, schema, role, user
- Features (same as SQL above):
  - Test connection
  - List schemas/tables
  - Run query
  - Preview rows
- Driver: `snowflake-connector-python`

### 7.3 Source Query Model
Each source config has a `query` field:
```sql
-- Simple table reference
SELECT * FROM orders WHERE status = 'active'

-- Or just a table name (backend wraps in SELECT *)
orders
```
Result columns become the mappable fields. Multiple source configs in one project = multiple named sheets.

### 7.4 Data Minimization
- The backend MUST NOT `SELECT *` when individual target columns are known from the active mapping.
- At run-time, the connector generates a column-scoped query: only columns referenced in `mapping_rows` are fetched.
- Preview queries (first 100 rows) always go through the PII middleware before any data reaches the UI.

### 7.5 PII Middleware Guardrails *(NEW)*

#### 7.5.1 Overview
A middleware service (`services/pii_guard.py`) intercepts every result set returned by a source connector — both preview calls and full run-time fetches — before data is returned to the API layer or passed to the XML generator.

#### 7.5.2 Detection Pipeline
1. **Schema scan** — column names are matched against a built-in PII name dictionary (e.g. `ssn`, `social_security`, `email`, `phone`, `dob`, `birth_date`, `cc_number`, `credit_card`, `ip_addr`, `full_name`, `address`, `zip`).
2. **Regex pattern scan** — sample values (up to 50 rows) are tested against PII-type patterns:

   | PII Type | Pattern Example |
   |---|---|
   | SSN | `\d{3}-\d{2}-\d{4}` |
   | Email | RFC 5322 regex |
   | Phone | `(\+1)?\s?[\(]?\d{3}[\)]?[-.\s]?\d{3}[-.\s]?\d{4}` |
   | Credit Card | Luhn-validated 13–19 digit sequences |
   | Date of Birth | ISO date + common formats, column name context required |
   | IP Address | IPv4/IPv6 |
   | US ZIP Code | `\d{5}(-\d{4})?` with column name context |

3. **Confidence scoring** — a column is flagged as PII if name-match confidence ≥ 0.7 OR regex hit-rate across sample rows ≥ 0.3.
4. **Policy lookup** — for each detected PII column, look up the project's active `pii_policies` row; fall back to project-wide default policy if no column-specific rule exists.

#### 7.5.3 Actions
| Action | Behaviour |
|---|---|
| `mask` | Replace characters according to `mask_pattern` (e.g. `***-**-1234` for SSN). Applied to every value in the column. |
| `redact` | Replace entire value with `[REDACTED]`. |
| `tokenize` | Replace value with a deterministic, reversible token (HMAC-SHA256 of value + project secret). Token is consistent across runs for the same raw value. |
| `block` | Raise a `PIIBlockedError`; abort the preview/run and return HTTP 422 with the list of blocked columns. |
| `allow` | Pass value through unchanged; still write an audit log entry. |

#### 7.5.4 Enforcement Points
- **Source preview** (`POST /api/sources/{id}/preview`) — PII middleware runs; masked/redacted data shown in UI grid. A banner lists detected PII columns and applied actions.
- **Run-time fetch** (`POST /api/projects/{id}/run`) — PII middleware runs before XML generation. If any column has `block` policy, the run is aborted before any data leaves the backend.
- **Auto-map** — PII-tagged columns are visually flagged in the mapping table with a shield icon and a policy badge.
- **XML output** — columns with `redact` or `block` policy are excluded from generated XML even if present in the mapping.

#### 7.5.5 Policy Precedence (highest → lowest)
1. Explicit column-level policy for this source
2. Explicit column-level policy at project level (source = NULL)
3. Auto-detected policy from PII scan
4. System default: `allow` (with audit log)

#### 7.5.6 Audit Logging
Every time the middleware processes a result set it writes one `pii_audit_logs` row per PII column detected, recording: project, source, run (if applicable), column name, detected type, action applied, and row count. Audit logs are append-only and are never deleted via the API.

#### 7.5.7 UI Feedback
- **Source tab:** after preview, a collapsible "PII Scan Results" panel appears listing each flagged column, its detected type, and the current action. Each row has a dropdown to override the action inline.
- **Mapping tab:** PII-flagged source columns show a 🛡 shield badge. Columns with `block` policy cannot be mapped.
- **Output tab:** run summary includes a PII section: columns processed, actions applied, rows affected.

---

## 8. UI Changes Required (Phase 2)

### 8.1 New: Project Selector (top bar)
- Dropdown to switch between projects
- "New Project" button
- Current project name shown in header

### 8.2 Source Tab — New Source Type Selector
```
[ File Upload ]  [ SQL Database ]  [ Snowflake ]
```
- **SQL Database** form: dialect, host, port, database, user, password, query
- **Snowflake** form: account, warehouse, database, schema, role, user, password/key, query
- **Test Connection** button → shows green ✓ or error
- **Preview** button → loads columns + first rows into grid (same as file upload result)
- Source configs saved to backend per project
- **PII Scan Results panel** (collapsible) → shown after every preview; lists flagged columns, type, action; inline action override dropdown

### 8.3 Mapping Tab
- Load / Save now hits API instead of local JSON download
- Version selector dropdown (restore previous mapping versions)
- PII shield badge on flagged source columns; blocked columns non-selectable

### 8.4 Output Tab
- Run button posts to `/api/projects/{id}/run` instead of running in browser
- Run History section: table of past runs with status, timestamp, row counts
- PII summary section in each run detail: columns processed, actions, rows affected

---

## 9. Tech Stack

| Layer | Choice |
|---|---|
| API framework | **FastAPI** (Python 3.11+) |
| ORM | **SQLAlchemy 2.x** + **Alembic** migrations |
| Application DB | **SQL Server Express** (`DESKTOP-G01PH8C\SQLEXPRESS` / `ConversionAgent`) |
| App DB user | `clarityAgentuser` (db_owner, credentials in `.env`) |
| DB URL format | SQLAlchemy ODBC passthrough (`mssql+pyodbc:///?odbc_connect=...`) |
| SQL sources | **SQLAlchemy** (psycopg2, pymysql, pyodbc) |
| Snowflake | **snowflake-connector-python** |
| Encryption | **cryptography** (Fernet) |
| XML generation | Python **lxml** (mirrors JS logic) |
| PII detection | **presidio-analyzer** (Microsoft) + custom regex fallback |
| PII tokenization | **HMAC-SHA256** (stdlib `hmac`) keyed on `SECRET_KEY` |
| CORS | fastapi.middleware.cors |
| Config | **pydantic-settings** (.env file) |
| Dev server | **uvicorn** |

---

## 10. File Structure (Phase 2)

```
Conversionproject/
├── index.html                  – existing UI (updated for API calls)
├── css/styles.css
├── js/
│   ├── app.js                  – updated: API calls replace local logic
│   ├── excelHandler.js
│   ├── xmlHandler.js
│   ├── mapper.js
│   ├── xmlGenerator.js
│   └── apiClient.js            – NEW: wrapper for all backend API calls
│
├── api/                        – NEW: Python backend
│   ├── main.py                 – FastAPI app entry point
│   ├── config.py               – settings (DB URL, secret key, etc.)
│   ├── database.py             – SQLAlchemy engine + session
│   ├── models.py               – all ORM models (flat, 8 tables)
│   ├── schemas.py              – Pydantic request/response models
│   ├── setup_db.py             – one-time DB + table bootstrap script
│   ├── routers/
│   │   ├── connections.py      – source connection CRUD + test/preview
│   │   ├── projects.py         – FUTURE
│   │   ├── mappings.py         – FUTURE
│   │   ├── runs.py             – FUTURE
│   │   └── pii.py              – FUTURE: PII policy + audit endpoints
│   ├── services/
│   │   ├── connector.py        – SQL + Snowflake connection logic
│   │   ├── encryption.py       – Fernet credential encrypt/decrypt
│   │   └── pii_guard.py        – FUTURE: detect → apply policy → audit log
│   └── requirements.txt
│
├── samples/                    – existing sample files
├── PRD.md                      – this file
└── .env.example                – environment variable template
```

---

## 11. Implementation Phases

### Phase 2a — API Foundation + DB  *(complete)*
1. ✅ Set up FastAPI project + SQLAlchemy (`api/main.py`, `api/database.py`, `api/config.py`)
2. ✅ Created all DB models in `api/models.py` (8 tables)
3. ✅ Bootstrapped `ConversionAgent` database on `DESKTOP-G01PH8C\SQLEXPRESS` via `api/setup_db.py`
4. ✅ Source connection CRUD + Fernet encryption (`api/routers/connections.py`, `api/services/encryption.py`)
5. ✅ SQL + Snowflake test/preview endpoints (`api/services/connector.py`)
6. ✅ Source tab UI updated with SQL/Snowflake forms (`js/sourceConnector.js`)
7. Projects CRUD — pending
8. XML Templates CRUD — pending
9. Mappings CRUD (save/load/version) — pending
10. Add `apiClient.js` to UI — pending

### Phase 2b — Source Connectivity  *(partial — see 2a above)*
11. ✅ SQL source connector (MSSQL implemented; PostgreSQL/MySQL/SQLite stubs ready)
12. ✅ Snowflake connector
13. ✅ `/connections/{id}/test` and `/connections/{id}/preview` endpoints
14. ✅ Source tab UI with SQL/Snowflake forms

### Phase 2c — PII Middleware *(NEW)*
11. Create `pii_policies` and `pii_audit_logs` DB models + Alembic migration
12. Implement `services/pii_guard.py`:
    - Column name dictionary match
    - Regex pattern scan on sample rows
    - Confidence scorer
    - Policy lookup (column → source → project → default)
    - Action appliers: mask, redact, tokenize, block, allow
    - Audit log writer
13. Wire PII guard into `/sources/preview` response pipeline
14. Implement PII policy CRUD endpoints (`/api/pii/policies/*`)
15. Implement PII audit log read endpoint
16. Add PII scan results panel to Source tab UI
17. Add shield badges to Mapping tab for flagged columns
18. Add PII summary to run detail in Output tab

### Phase 2d — Server-side Run Engine
19. Port XML generator to Python (`lxml`)
20. Port formula evaluator to Python
21. Implement `/run` endpoint — fetch sources → **PII guard** → generate XML → post to target
22. Add run history UI in Output tab

### Phase 2e — Security & Config
23. Encrypt credentials at rest (Fernet)
24. Add `.env` config (DB URL, secret key, allowed origins)
25. Input validation on all endpoints
26. Rate limiting on source preview (prevent large unintended queries)

---

## 12. Environment Variables (.env)

```env
# Application Database (SQL Server)
DB_SERVER=DESKTOP-G01PH8C\SQLEXPRESS
DB_NAME=ConversionAgent
DB_USER=clarityAgentuser
DB_PASSWORD=<see .env>
DB_DRIVER=ODBC Driver 17 for SQL Server
# SQLAlchemy uses ODBC passthrough URL -- no DATABASE_URL needed

# Security
SECRET_KEY=change-me-in-production
ENCRYPTION_KEY=                      # Fernet key for credential encryption

# PII
PII_TOKENIZATION_KEY=                # HMAC key for tokenization (defaults to SECRET_KEY if blank)
PII_SCAN_SAMPLE_ROWS=50              # How many rows to sample for regex detection
PII_DEFAULT_ACTION=allow             # Fallback action when no policy matches: allow|mask|block
PII_AUTO_DETECT=true                 # Enable automatic PII detection on every preview

# API
ALLOWED_ORIGINS=http://localhost,http://127.0.0.1
PORT=8000

# Optional: default target API
DEFAULT_TARGET_URL=
```

---

## 13. Out of Scope (Phase 2)

- User authentication / multi-tenancy (future Phase 3)
- Scheduled/cron runs (future Phase 3)
- S3/blob storage for large XML outputs (future Phase 3)
- XSD schema validation of generated XML
- Non-XML output formats (JSON, flat file)
- PII re-identification / de-tokenization API (future Phase 3)
- GDPR right-to-erasure workflows (future Phase 3)

---

## 14. Success Criteria

| Criteria | Measure |
|---|---|
| Mappings persist across browser sessions | Reload page → mapping still loaded from DB |
| SQL source preview works | 100 rows returned in < 3s on local network |
| Snowflake source preview works | 100 rows returned in < 10s |
| Run endpoint generates correct XML | Matches browser-side output for same inputs |
| Credentials never returned in API responses | Masked/omitted in all GET responses |
| All existing browser-only features still work | File upload path remains functional |
| PII auto-detection fires on preview | SSN, email, phone columns flagged with ≥ 90% precision on test dataset |
| PII mask/redact applied in preview response | No raw PII values returned in `/sources/preview` for masked/redacted columns |
| PII block halts run | Run with a `block`-policy column returns HTTP 422 before any XML is generated |
| Audit log written for every PII column access | `pii_audit_logs` row created per flagged column per preview/run |
| Policy override via UI takes effect immediately | Saving a policy change applies to the next preview without backend restart |
