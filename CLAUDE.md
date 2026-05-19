# Data Conversion Studio — Claude Instructions

## Project Overview
**ONE project only:** `C:\Users\Admin-1\Desktop\Ai-Conversion`

- **React UI** (`frontend/`) — Vite dev server on port 3000. This is the ONLY UI.
- **FastAPI backend** (`api/`) — uvicorn on port 8000, bound to `0.0.0.0`
- **Git remote:** `https://github.com/spatha1/Ai-Conversion.git` (branch: `dev`)

> The old HTML/JS UI (`index.html`, `js/`, `css/`) and `Downloads\Conversionproject` have been deleted.
> Never reference or recreate them. All UI work goes in `frontend/src/`.

---

## Two-Environment Architecture (MANDATORY)

Every change must land in **both** environments. They are not interchangeable.

| | **Local (dev)** | **Production (Azure Ubuntu VM)** |
|---|---|---|
| **Machine** | `C:\Users\Admin-1\Desktop\Ai-Conversion` (Windows) | `azureuser@104.211.112.63` (Ubuntu) |
| **Access** | This terminal / VS Code local | SSH via `azure-vm` profile |
| **Backend** | uvicorn on port 8000 (direct) | systemd `clarity-api` → nginx reverse proxy |
| **Frontend** | Vite dev server port 3000 OR static build | nginx serves `/home/azureuser/Ai-Conversion/static` |
| **DB** | SQL Server at `DESKTOP-G01PH8C\SQLEXPRESS` | Azure SQL / SQL Server on VM |
| **URL** | `http://localhost:8000` | `http://104.211.112.63` |
| **Restarts** | Kill python* + relaunch uvicorn | `sudo systemctl restart clarity-api nginx` |

### Full change workflow (every time)

**Step 1 — Edit & test locally:**
1. Edit files in `C:\Users\Admin-1\Desktop\Ai-Conversion`
2. Run `python -m api.migrate` if DB schema changed
3. Kill + restart uvicorn: `Get-Process python* | Stop-Process -Force`
4. Build frontend: `cd frontend && npm run build`
5. Verify at `http://localhost:8000`

**Step 2 — Commit & push:**
6. `git add` changed source files + `static/` build output
7. `git commit` + `git push origin dev`

**Step 3 — Deploy to production VM (SSH):**
8. Run `deploy_to_vm.sh` (or paste the commands below) — see deploy script section

### Deploy to VM (one command)
```bash
# From local terminal (runs over SSH):
ssh -i ~/.ssh/azure_vm_key.pem azureuser@104.211.112.63 "
  cd /home/azureuser/Ai-Conversion &&
  git pull origin dev &&
  cd frontend && npm run build && cd .. &&
  sudo systemctl restart clarity-api &&
  sudo systemctl restart nginx &&
  systemctl is-active clarity-api && systemctl is-active nginx
"
```

### Never do
- Deploy only locally without pushing + syncing the VM
- Deploy only to VM without committing source first
- Run `systemctl` commands in local PowerShell — they only work in the Ubuntu VM terminal
- Hardcode `localhost` in API URLs returned to the browser
- Hardcode `C:\Users\...` paths in config — use environment variables
- Skip migration before restarting when schema changes exist
- Commit log files (`uvicorn.log`, `api_server.log`, `frontend-dev.log`) — add to `.gitignore`

---

## Azure Resources (all-Azure going forward)

| Resource | Current | Target |
|---|---|---|
| **Compute** | This Azure VM (104.211.112.63) | Same VM |
| **Database** | SQL Server on VM (port 1433) | Azure SQL Database (`*.database.windows.net`) when ready |
| **AI / LLM** | OpenAI API (fallback) | **Azure OpenAI** (set `AZURE_OPENAI_*` in `.env`) |
| **Storage** | Per-connection Azure Blob (dispatch) | Global `AZURE_STORAGE_*` in `.env` |

**Switch to Azure OpenAI:** Uncomment the `AZURE_OPENAI_*` block in `.env`.  
`api/services/ai_client.py` auto-detects: if `AZURE_OPENAI_ENDPOINT` is set → uses `AzureOpenAI`; else falls back to `OpenAI`.

---

## Startup
```powershell
# Backend (bound to all interfaces so VM IP works)
cd C:\Users\Admin-1\Desktop\Ai-Conversion
.venv\Scripts\python.exe -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (separate terminal)
cd C:\Users\Admin-1\Desktop\Ai-Conversion\frontend
node_modules\.bin\vite --port 3000 --host 0.0.0.0
```

Kill and restart backend:
```powershell
Get-Process python* | Stop-Process -Force
```

## Service Management Scripts
```powershell
# restart_backend.ps1
Get-Process python* -EA SilentlyContinue | Stop-Process -Force
Start-Process ".venv\Scripts\python.exe" "-m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload" -WindowStyle Hidden

# run_migrations.ps1
.venv\Scripts\python.exe -m api.migrate

# check_services.ps1
Invoke-RestMethod http://localhost:8000/health -TimeoutSec 3
netstat -ano | Select-String ":8000|:3000"
```

## Re-bootstrap Database
```bash
cd C:\Users\Admin-1\Desktop\Ai-Conversion
python -m api.setup_db
python -m api.migrate
```

---

## File Structure
```
Ai-Conversion/
├── frontend/                   — React 18 + MUI v5 + Vite (port 3000)
│   └── src/
│       ├── pages/              — Admin, Development, PowerBI, Reports, etc.
│       │   └── Testing/
│       │       └── TestingPage.tsx  — Tabs 0-5 (DEV vs BASE + Multi-Source Compare)
│       ├── api/index.ts        — all API client methods
│       ├── types/index.ts      — shared TypeScript types
│       ├── store/              — Zustand global state
│       └── components/         — shared components (AIDebugPanel, etc.)
├── api/
│   ├── main.py                 — FastAPI app entry point
│   ├── models.py               — ORM models (conversion_ prefix)
│   ├── schemas.py              — Pydantic schemas
│   ├── config.py               — settings from .env
│   ├── database.py             — SQLAlchemy setup
│   ├── setup_db.py             — one-time DB bootstrap
│   ├── migrate.py              — add missing columns to existing tables
│   ├── routers/
│   │   ├── connections.py      — CRUD + test/preview endpoints
│   │   ├── mapping_ai.py       — AI mapping + XML generation
│   │   ├── report_ai.py        — NL→SQL (Report tab)
│   │   ├── reconciliation.py   — DEV vs BASE reconciliation + multi-compare endpoint
│   │   ├── admin.py            — schema discovery + embeddings + prompt templates
│   │   └── knowledge.py        — SAI Knowledge Base + Ask SAI endpoints
│   └── services/
│       ├── connector.py        — SQL/Snowflake dispatch + query exec
│       ├── query_builder.py    — JOIN-aware SQL builder (BFS FK graph)
│       ├── embeddings.py       — OpenAI embeddings + cosine similarity
│       ├── encryption.py       — Fernet credential encryption
│       ├── multi_compare.py    — Multi-source AI comparison service
│       └── knowledge_processor.py — SAI KB: process, embed, ask, confidence search
├── SQL/                        — Versioned DDL scripts for fresh deployments
│   ├── 00_deploy_all.sql       — Master index (run 01→07 in order)
│   ├── 01_core_tables.sql      — Core tables (connections, mappings, catalog)
│   ├── 02_feature_tables.sql   — PS, Dashboard, Dispatch, Pipeline, AI
│   ├── 03_agentic_auth_tables.sql — Agents, Auth, Approvals, Reconciliation
│   ├── 04_ui_validation.sql    — Playwright UI validation
│   ├── 05_column_additions.sql — ALTER TABLE column additions
│   ├── 06_form_builder.sql     — Form Builder tables
│   └── 07_sai_knowledge.sql    — SAI Knowledge + Debug tables
├── docs/
│   ├── PROMPT_TEMPLATES.md     — All prompt template categories, modules, and fallbacks
│   ├── AI_AGENT_PIPELINE.md
│   └── PS_SUPPORT_AGENT.md
├── prompts/mapping_prompt.md   — editable system prompt for AI mapping
└── samples/                    — sample XML templates
```

---

## Database
- **Server:** `DESKTOP-G01PH8C\SQLEXPRESS`
- **Database:** `ConversionAgent`
- **App user:** `clarityAgentuser` (db_owner), credentials in `.env`
- All tables have `conversion_` prefix

### Key Tables
| Table | Purpose |
|---|---|
| `conversion_source_connections` | Saved SQL/Snowflake connections (Fernet-encrypted creds) |
| `conversion_xml_templates` | Uploaded XML templates per connection |
| `conversion_target_formula_rules` | Extracted XML leaf paths + defaults |
| `conversion_mappings` | Versioned mapping headers |
| `conversion_mapping_rows` | Source column → target XML path rows |
| `conversion_generated_queries` | AI-generated SQL queries |
| `conversion_generated_xml` | Stored XML output per identifier |
| `conversion_catalog_columns` | Discovered schema: columns |
| `conversion_catalog_relations` | Discovered schema: FK relationships |
| `conversion_catalog_samples` | Sample rows (≤3 per table) |
| `conversion_column_embeddings` | OpenAI vectors for semantic matching |
| `conversion_run_logs` | Execution history |
| `conversion_pii_policies` | PII guardrail rules (schema ready, no service yet) |
| `conversion_prompt_templates` | Admin-managed LLM prompt overrides per module |
| `conversion_ai_trace_log` | Every LLM call across all modules (tokens, latency, prompt/response) |
| `conversion_knowledge_entries` | SAI KB: LLM-structured knowledge items (UseCase/Process/Issue/Q&A) |
| `conversion_knowledge_chunks` | SAI KB: overlapping ~400-word chunks with OpenAI embeddings for RAG |
| `conversion_open_questions` | SAI KB: unanswered Ask SAI questions queued for admin review |
| `conversion_form_templates` | Form Builder: versioned form schema (sections, fields, validation) |
| `conversion_form_mapping_presets` | Form Builder: reusable field→data-path mapping presets |
| `conversion_form_data_bindings` | Form Builder: data source config + field mapping per template |
| `conversion_form_executions` | Form Builder: execution history (single + bulk runs) |
| `conversion_debug_settings` | Per-module debug level config: OFF \| ON \| VERBOSE |
| `conversion_debug_traces` | Full step-by-step AI debug output, linked by trace_id UUID |
| `conversion_story_analyses` | Dev Hub: GPT story breakdown + dev plan results |

---

## Architecture Rules

### Connector Dispatch
`api/services/connector.py` routes by `source_type`:
- `"sql"` / `"mssql"` / `"postgresql"` / `"mysql"` / `"sqlite"` → SQLAlchemy
- `"snowflake"` → snowflake-connector-python
- `"file"` → NOT handled server-side (client-side SheetJS only)

### Data Security
- `fetch_all_data()` in `connector.py` is **internal only** — never expose as HTTP endpoint
- Full datasets must never be sent to the browser — only status/counts/errors
- Passwords/keys are always Fernet-encrypted at rest; never returned in API responses
- Multi-compare: full dataset rows stay server-side; only `sample_rows[:5]` + stats returned to browser

### SQL Generation
- `_wrap_query(query, limit=None)` → no TOP/LIMIT when limit is None (full fetch)
- `api/services/query_builder.py` → JOIN-aware builder using BFS over FK graph
  - Used automatically by `mapping_ai.py` when `conversion_catalog_relations` has data
  - Falls back to flat embedding-only approach if no FK relations found
- Prerequisite for JOIN builder: Admin tab "Collect Schema" must be run first

### XML Template Conventions
- `each="TableName"` on an element → iterates over rows
- `{ColumnName}` in text/attributes → field placeholder
- `{Sheet.Column}` → explicit table reference

### Mapping AI Flow
1. Admin tab → "Collect Schema" → populates `conversion_catalog_*` tables
2. Admin tab → "Generate Embeddings" → populates `conversion_column_embeddings`
3. Target tab → upload XML → "Save Template" (requires connection selected)
4. Mapping tab → "Generate Query" → BFS JOIN builder + LLM refine
5. Mapping tab → "Generate Mapping" → embedding similarity → mapping rows

### Prompt Template Override Pattern
Every LLM call should support a DB prompt override. The standard pattern (see `multi_compare.py`):
```python
system_prompt = _SYSTEM_PROMPT  # hardcoded fallback
try:
    from api.models import PromptTemplate as _PT
    _tmpl = db.query(_PT).filter(_PT.category == "my_category", _PT.is_active == True).first()
    if _tmpl and _tmpl.content and _tmpl.content.strip():
        system_prompt = _tmpl.content.strip()
except Exception:
    pass
```
See `docs/PROMPT_TEMPLATES.md` for all registered categories.

### AI Trace Logging Pattern
Every LLM call must write to `conversion_ai_trace_log` via the `AITraceLog` ORM model:
```python
db.add(AITraceLog(
    module="my_module",        # matches Admin → AI Traces filter
    conn_id=None,              # or the relevant connection id
    model="gpt-4o-mini",
    prompt_text=prompt[:4000],
    response_text=raw[:4000],
    tokens_in=resp.usage.prompt_tokens,
    tokens_out=resp.usage.completion_tokens,
    latency_ms=elapsed_ms,
    schema_snapshot=json.dumps(...),  # optional context summary
))
db.commit()
```
Wrap in `try/except` so a logging failure never breaks the response.

---

## Multi-Source Compare Feature

**Tab 5** of `frontend/src/pages/Testing/TestingPage.tsx`.

### What it does
Allows up to 4 data sources (DB connections + SQL, or uploaded files) to be compared side-by-side by AI. AI analyzes all datasets and produces structured comparison checks + narrative. If the user provides no instructions, AI decides what to compare.

### Frontend components (`TestingPage.tsx`)
- `AITracePanel` — collapsible panel showing prompt text, token counts, latency after each run
- `MultiSourceCompareTab` — main tab component; manages 4 slot cards, file uploads, run button, results

### Backend
- **Endpoint:** `POST /api/reconciliation/multi-compare` (in `api/routers/reconciliation.py`)
  - Fixed path — registered **before** all `/{conn_id}/` routes in the same router
  - Accepts `multipart/form-data`: `slots` (JSON string), `user_instructions`, `file_0`…`file_3`
- **Service:** `api/services/multi_compare.py` → `run_multi_compare()`
  - Fetches DB data via `fetch_all_data()` from `connector.py`
  - Parses uploaded files (xlsx, xls, csv, json, xml) server-side
  - Computes per-column null rates + numeric stats server-side
  - Calls `gpt-4o-mini` with structured prompt; user instructions placed FIRST
  - Supports prompt override via `PromptTemplate` category `"multi_compare"`
  - Logs every call to `AITraceLog` with `module="multi_compare"`
  - Returns `tokens_in`, `tokens_out`, `prompt_text` in response for in-tab trace display

### API client
`multiCompareApi.run(slots, files, userInstructions)` in `frontend/src/api/index.ts`

### TypeScript types (in `frontend/src/types/index.ts`)
`MultiSourceSlotConfig`, `MultiSourceDatasetSummary`, `MultiCompareCheck`, `MultiCompareResult`

### Key rules
- `slot_index` must be the **original** array index (0–3), not the filtered index — use `.map((s,i) => ({...s, slot_index: i})).filter(...)` pattern
- Connection dropdown is scoped to the active project: `connectionsApi.list(activeProject?.id)`
- File size guard: reject files > 10 MB before parsing
- User instructions go at the TOP of the prompt with `=== USER COMPARISON INSTRUCTIONS (MUST BE ADDRESSED) ===` header

---

## Known Bugs / Do Not Repeat
- `MappingRow` model has **no `confidence` column** — strip it before `db.add(MappingRow(...))`
- `SQLAlchemy create_all` never alters existing tables — use `api/migrate.py` for new columns
- `routers/connections.py` must NOT have duplicate target-formula routes (old ones wrote to wrong table)
- Named SQL Server instances (host contains `\`) must NOT have port appended in connection string
- `SourceConnection` model field is `database_name` (NOT `database`) and `dialect` (NOT embedded in `source_type`) — always use these exact names when building a `cfg` dict for `connector.py`
- `get_or_build()` returns a **`ContextPayload` dataclass**, not a plain dict — use attribute access (`context.tables`, `context.relations`) never `.get()`; fallback must be `ContextPayload(conn_id=0)` not `{}`
- FastAPI route ordering: fixed-path routes (e.g. `/agents/from-ps-chat`) MUST be registered **before** parameterized routes (e.g. `/agents/{agent_id}`) in the same router — otherwise FastAPI tries to coerce the literal string to int and raises 422/404
- Multi-compare `slot_index`: always map BEFORE filter to preserve original indices — `if "resp" in dir()` is invalid Python for checking local scope; use `"resp" in locals()` or initialize before the try block

### `connector.py` cfg dict keys (for `preview_data` / `test_connection`)
```python
cfg = {
    "source_type": conn_row.source_type,   # "sql" | "snowflake"
    "dialect":     conn_row.dialect,        # "mssql" | "postgresql" | "mysql" | "sqlite"
    "host":        conn_row.host,
    "port":        conn_row.port,
    "database":    conn_row.database_name,  # ORM col = database_name, cfg key = database
    "schema":      conn_row.schema_name,
    "username":    conn_row.username,
    "password":    decrypt(conn_row.password_enc) if conn_row.password_enc else "",
    "query":       sql,                     # for preview_data / fetch_all_data
}
```

---

## Gap Analysis Status (as of session 6)
| # | Step | Status |
|---|---|---|
| 1 | XML Structure Definition | ✅ Complete |
| 2 | Schema Collection | ✅ Complete (MSSQL) |
| 3 | Schema Knowledge Creation | ⚠️ Partial |
| 4 | Legacy Data Discovery Agent | ✅ Complete (query_builder.py BFS) |
| 5 | Legacy Data Query Agent | ✅ Complete (query_builder.py JOINs) |
| 6 | Data Collection (bulk) | ✅ Complete (fetch_all_data, no limit) |
| 7 | Canonical Data Preparation | ❌ Not built |
| 8 | Business Rule Validation / PII | ❌ Models only, no service |
| 9 | XML Payload Generation | ✅ Complete |
| 10 | XML Validation (XSD) | ❌ Not built |
| 11 | Conversion Execution (run engine) | ❌ Not built (run_engine.py needed) |
| 12 | Error Handling & Reprocessing | ❌ Table exists, no UI |
| 13 | Reconciliation (DEV vs BASE) | ✅ Complete (5 tabs) |
| 14 | Multi-Source AI Comparison | ✅ Complete (Tab 5, up to 4 sources) |
| 15 | Audit & Reporting | ⚠️ Partial |

**Next priority:** Step 11 — `api/services/run_engine.py` + `POST /api/projects/{id}/run`

---

## Supported Formula Functions (XML Generator)
`UPPER`, `LOWER`, `TRIM`, `LEN`, `CONCAT`, `IF`, `FORMAT_DATE`, `TODAY()`, `NOW()`
Arithmetic: `{Price} * {Qty}` (auto-evaluated for numeric columns)

## Auto-mapping Algorithm (client-side fallback)
Jaccard bigram similarity, threshold 0.4. High ≥ 80%, Medium ≥ 55%.
