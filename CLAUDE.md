# Data Conversion Studio — Claude Instructions

## Project Overview
Single-page web app + FastAPI backend for legacy → XML data conversion.
Open `index.html` directly in any browser (no build step needed).
Backend: `http://localhost:8000`

## Startup
```bash
cd C:\Users\Admin-1\Desktop\Conversionproject
.venv/Scripts/python.exe -m uvicorn api.main:app --reload --port 8000
```

If `--reload` doesn't pick up changes, kill and restart:
```powershell
powershell -Command "Get-Process python* | Stop-Process -Force"
```

## Re-bootstrap Database
```bash
python -m api.setup_db
python -m api.migrate
```

---

## File Structure
```
Conversionproject/
├── index.html                  — main SPA (6 tabs)
├── css/styles.css              — full stylesheet
├── js/
│   ├── app.js                  — tab controller + boot
│   ├── excelHandler.js         — Excel/CSV parsing (SheetJS CDN)
│   ├── xmlHandler.js           — XML template parse + tree view
│   ├── mapper.js               — mapping table + AI generate buttons
│   ├── xmlGenerator.js         — XML generation + formula engine
│   ├── sourceConnector.js      — SQL/Snowflake connection forms
│   ├── reportHandler.js        — NL→SQL queries + dashboard (Tab 5)
│   ├── chatHandler.js          — AI connection setup wizard
│   └── adminHandler.js         — schema discovery (Tab 6)
├── api/
│   ├── main.py                 — FastAPI app entry point
│   ├── models.py               — 17 ORM models (conversion_ prefix)
│   ├── schemas.py              — Pydantic schemas
│   ├── config.py               — settings from .env
│   ├── database.py             — SQLAlchemy setup
│   ├── setup_db.py             — one-time DB bootstrap
│   ├── migrate.py              — add missing columns to existing tables
│   ├── routers/
│   │   ├── connections.py      — CRUD + test/preview endpoints
│   │   ├── mapping_ai.py       — AI mapping + XML generation
│   │   ├── report_ai.py        — NL→SQL (Report tab)
│   │   └── admin.py            — schema discovery + embeddings
│   └── services/
│       ├── connector.py        — SQL/Snowflake dispatch + query exec
│       ├── query_builder.py    — JOIN-aware SQL builder (BFS FK graph)
│       ├── embeddings.py       — OpenAI embeddings + cosine similarity
│       └── encryption.py       — Fernet credential encryption
├── prompts/mapping_prompt.md   — editable system prompt for AI mapping
└── samples/                    — sample XML templates
```

---

## Database
- **Server:** `DESKTOP-G01PH8C\SQLEXPRESS`
- **Database:** `ConversionAgent`
- **App user:** `clarityAgentuser` (db_owner), credentials in `.env`
- All 17 tables have `conversion_` prefix

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

---

## Known Bugs / Do Not Repeat
- `MappingRow` model has **no `confidence` column** — strip it before `db.add(MappingRow(...))`
- `SQLAlchemy create_all` never alters existing tables — use `api/migrate.py` for new columns
- `routers/connections.py` must NOT have duplicate target-formula routes (old ones wrote to wrong table)
- Named SQL Server instances (host contains `\`) must NOT have port appended in connection string

---

## Gap Analysis Status (as of session 5)
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
| 13 | Reconciliation | ❌ Not built |
| 14 | Audit & Reporting | ⚠️ Partial |

**Next priority:** Step 11 — `api/services/run_engine.py` + `POST /api/projects/{id}/run`

---

## Supported Formula Functions (XML Generator)
`UPPER`, `LOWER`, `TRIM`, `LEN`, `CONCAT`, `IF`, `FORMAT_DATE`, `TODAY()`, `NOW()`
Arithmetic: `{Price} * {Qty}` (auto-evaluated for numeric columns)

## Auto-mapping Algorithm (client-side fallback)
Jaccard bigram similarity, threshold 0.4. High ≥ 80%, Medium ≥ 55%.
