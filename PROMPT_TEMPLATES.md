# Prompt Templates — Generic Placeholder System

## Overview
Prompt templates are **global** (not per-connection). All connections share the same template library.
On startup, if the `conversion_prompt_templates` table is empty, default templates are seeded automatically.

---

## Supported Placeholders

| Placeholder | What it injects at runtime |
|---|---|
| `{{schema}}` | Full schema: tables + columns + FK relations + business context |
| `{{table_list}}` | Comma-separated table names only |
| `{{query_examples}}` | Saved query examples for the active connection |
| `{{query_context}}` | Free-text query context set in Admin |
| `{{metadata}}` | Business metadata / column descriptions |
| `{{relations}}` | FK relationships only |

Both `{{var}}` (double-brace) and `{var}` (single-brace, legacy) are supported.

Placeholders are **automatically resolved** when a template is used in any AI call — no manual wiring needed.

---

## Template Categories

| Category | Used By |
|---|---|
| `mapping` | AI Mapping → Generate Mapping |
| `report` | Report AI → NL to SQL |
| `dev` | Development → SQL Plan generation |
| `dashboard` | Dashboards → Generate from intent |
| `dashboard_widget` | Dashboards → Regenerate single widget |
| `dashboard_sql` | Dashboards → Generate from SQL Query |
| `ps` | PS Support → AI chat |
| `testing` | Testing → AI Generate Test Cases |
| `admin_enrich` | Admin → Schema AI Enrichment chat (uses `{schema}`, `{gap_count}`, `{gaps}` — resolved by the router) |
| `dev_brd` | Development → BRD acceptance criteria (uses `{tables_summary}`, `{relations_summary}` — resolved by the router) |
| `agent` | AI Agents → Co-worker autonomous loop |

---

## How to Use

### Writing a generic template
```
You are a SQL expert for the following database:

{{schema}}

{{query_examples}}

Rules:
- Use ONLY the tables and columns listed in the schema above
- Use SQL Server (T-SQL) syntax
```

### Adding query examples
1. Go to **Admin → Query Examples** and add examples for the connection
2. Examples are automatically injected wherever `{{query_examples}}` appears in a template

---

## Adding a New Default Template

1. Edit `api/seed_prompts.py` — add an entry to `_DEFAULTS`
2. On next server startup, if the table is empty it will be seeded
3. To force re-seed on an existing install: `python -m api.seed_prompts`

---

## Architecture

- **Resolver**: `api/services/ai_engine.py` → `resolve_template_placeholders(content, context)`
- **Context**: `api/services/context_cache.py` → `ContextPayload` (built per connection, cached 5 min)
- **Auto-seed**: `api/main.py` → startup event checks count == 0 → seeds defaults
- **UI**: Admin → Prompt Templates tab → click placeholder chip to insert into template content
