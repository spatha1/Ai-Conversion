# Data Conversion Studio — Claude Instructions

## Project Overview
**ONE project only:** `C:\Users\Admin-1\Desktop\Ai-Conversion`

- **React UI** (`frontend/`) — Vite dev server on port 3000. This is the ONLY UI.
- **FastAPI backend** (`api/`) — uvicorn on port 8000
- **Git remote:** `https://github.com/spatha1/Ai-Conversion.git` (branch: `dev`)

> The old HTML/JS UI (`index.html`, `js/`, `css/`) and `Downloads\Conversionproject` have been deleted.
> Never reference or recreate them. All UI work goes in `frontend/src/`.

## Startup
```bash
# Backend
cd C:\Users\Admin-1\Desktop\Ai-Conversion
.venv/Scripts/python.exe -m uvicorn api.main:app --reload --port 8000

# Frontend (separate terminal)
cd C:\Users\Admin-1\Desktop\Ai-Conversion\frontend
node_modules/.bin/vite --port 3000
```

If `--reload` doesn't pick up changes, kill and restart:
```powershell
powershell -Command "Get-Process python* | Stop-Process -Force"
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
│   │   └── admin.py            — schema discovery + embeddings + prompt templates
│   └── services/
│       ├── connector.py        — SQL/Snowflake dispatch + query exec
│       ├── query_builder.py    — JOIN-aware SQL builder (BFS FK graph)
│       ├── embeddings.py       — OpenAI embeddings + cosine similarity
│       ├── encryption.py       — Fernet credential encryption
│       └── multi_compare.py    — Multi-source AI comparison service
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
