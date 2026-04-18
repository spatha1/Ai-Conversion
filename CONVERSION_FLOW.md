# Conversion Pipeline — Technical Flow

## Overview

The conversion pipeline transforms legacy source database records into target XML files
using AI-powered schema matching, FK-aware SQL generation, and template filling.

```
Source DB  →  Schema Catalog  →  Embeddings  →  SQL Query  →  Mapping Rows  →  XML Output
```

---

## Prerequisites (Admin tab — run once per connection)

### 1. Collect Schema
**Endpoint:** `POST /api/admin/collect-schema?conn_id=N`  
**Router:** `api/routers/admin.py`

- Connects to source DB via `api/services/connector.py → preview_data()`
- Introspects `INFORMATION_SCHEMA` (MSSQL) or equivalent
- Writes to three tables:
  - `conversion_catalog_columns` — table name, column name, data type, is_primary_key
  - `conversion_catalog_relations` — FK edges: parent_table.parent_col → referenced_table.ref_col
  - `conversion_catalog_samples` — up to 3 sample values per column (for AI enrichment)

### 2. Generate Embeddings
**Endpoint:** `POST /api/admin/generate-embeddings?conn_id=N`  
**Service:** `api/services/embeddings.py`

- Reads all rows from `conversion_catalog_columns` for this connection
- Builds a text string per column: `"table_name.column_name (data_type): sample1, sample2"`
- Calls **OpenAI `text-embedding-3-small`** in batches
- Stores 1536-dim float vector (JSON-serialised) in `conversion_column_embeddings`

---

## Step 1 — Upload XML Template (Target tab)

**Endpoint:** `POST /api/connections/{conn_id}/template`  
**Router:** `api/routers/connections.py`

- Stores raw XML in `conversion_xml_templates`
- `_extract_paths(xml_content)` traverses the XML tree (via `xml.etree.ElementTree`):
  - Leaf text nodes → `/Root/Parent/Leaf`
  - Attributes → `/Root/Parent/Leaf/@attrName`
  - `each="TableName"` attribute marks repeating sections (skipped from paths)
- Extracted paths stored in `conversion_target_formula_rules` with any hardcoded default values

---

## Step 2 — Generate Query (Mapping tab → "Generate Query")

**Endpoint:** `POST /api/mapping/generate/query`  
**Router:** `api/routers/mapping_ai.py → generate_query_only()`

### 2a. `_run_matching()` — Embedding Similarity

1. Loads XML paths from `conversion_xml_templates` via `_extract_paths()`
2. Loads column embeddings from `conversion_column_embeddings`
3. For each XML path, constructs a text: `"XML field 'FieldName' at path: /Root/.../FieldName"`
4. Sends all path texts to **OpenAI `text-embedding-3-small`** → gets path vectors
5. **Cosine similarity pass**: for every (path_vector, column_vector) pair, computes dot product / (|a|×|b|). Threshold = 0.25. Best match wins.
6. **Name-based override pass**: normalises path leaf name and column name (strip `_-\s.@/`, lowercase). Exact match = 1.0, substring = 0.85. Overrides embedding score if higher.
7. **Auto-detect identifier (PK)**: counts how many paths matched each table → most-matched = `main_table`. Queries `conversion_catalog_columns.is_primary_key=True` for that table.
8. Loads FK edges from `conversion_catalog_relations` for the JOIN-aware builder.

Returns dict: `paths, matched_cols, match_scores, emb_data, dialect, main_table, identifier_column, relations, client, ...`

### 2b. `_build_sql()` — Query Construction

**Path A — JOIN-aware** (when `conversion_catalog_relations` has data):

`api/services/query_builder.py → build_join_query(m)`

1. **Build FK graph**: bidirectional adjacency list `{table: [(neighbor, my_col, their_col)]}` — both FK direction and reverse added so BFS can traverse either way.
2. **Identify needed tables**: set of all tables from matched columns + identifier table.
3. **BFS from root (main_table)**: finds shortest join path to every needed table.  
   Each path entry is `[(from_tbl, from_col, to_tbl, to_col), ...]` — one tuple per JOIN hop.
4. **Emit SQL**: 
   ```sql
   SELECT
     t0.[EMPNO] AS [__identifier__],
     t0.[ENAME] AS [/DataExport/Employee/Name],
     t1.[DNAME] AS [/DataExport/Employee/Department],
     ...
   FROM [dbo].[EMP] t0
   LEFT JOIN [dbo].[DEPT] t1 ON t0.[DEPTNO] = t1.[DEPTNO]
   ORDER BY t0.[EMPNO]
   ```
   Column aliases are the **full XML paths** (e.g., `/DataExport/Employee/Name`).
5. **GPT refinement (FROM clause only)**: sends only the `FROM … [ORDER BY]` block to `gpt-4o-mini` with up to 80 schema columns. GPT fixes unresolved JOIN conditions. The SELECT list (which can have 80+ long XML-path aliases) is kept unchanged to avoid token overflow. Refined FROM is spliced back.

**Path B — Flat fallback** (no FK relations):

- Builds SELECT with `[MainTable].[Column] AS [/xml/path]`
- Adds stub comments: `-- JOIN [schema].[OtherTable] ON /* add join condition */`
- Same GPT refinement pass on the FROM clause

Result is persisted to `conversion_generated_queries`.

---

## Step 3 — Generate Mapping Rows (Mapping tab → "Generate Mapping")

**Endpoint:** `POST /api/mapping/generate/rows`  
**Router:** `api/routers/mapping_ai.py → generate_rows_only()`

1. Loads the saved SQL from `conversion_generated_queries`
2. Wraps it in `SELECT TOP 1 * FROM (...)` and executes via `connector.py`
3. Reads actual result column names from the live query response
4. Each column name is the XML path alias → creates a `MappingRowOut`:
   - `source_column` = the DB column name
   - `target_path` = the XML path (from alias)
   - `formula` = `{ColumnName}` placeholder
   - `confidence` = embedding score × 100
5. Returns rows for human review — **not saved yet**

User can edit rows in the UI, then clicks **Save Mapping**:

**Endpoint:** `POST /api/mapping/save`

- Creates/updates `conversion_mappings` header row (versioned per connection)
- Writes each row to `conversion_mapping_rows`
- Strips `confidence` column (not in the ORM model) before `db.add()`

---

## Step 4 — Generate XML (Output tab)

**Endpoint:** `GET /api/mapping/{conn_id}/identifier-values`  
Returns distinct values of the identifier column (e.g., all EMPNO values) so the user can pick which records to convert.

**Endpoint:** `POST /api/mapping/{conn_id}/generate-xml`  
Body: `{ "identifier_value": "7839" }`

1. Loads the saved SQL from `conversion_generated_queries`
2. Wraps query with `WHERE [IdentifierTable].[IdentifierColumn] = 'value'`
3. Executes via `connector.py → preview_data()` — returns `{columns, rows}`
4. For each result row, calls `_fill_xml_from_row(template, row)`:

### XML Filling — `_fill_xml_from_row()`

- Parses template with `xml.etree.ElementTree`
- Traverses every node, building the current XPath (`/Root/Parent/Node`)
- **Exact path match**: if current path is a key in `{path → value}` dict, sets `node.text = value`
- **Placeholder match**: if `node.text` contains `{ColumnName}`, substitutes using regex `r'\{([^}]+)\}'` — looks up by path suffix or direct key
- **Attribute fill**: same logic for XML attributes (path = `/…/@attrName`)
- `each="TableName"` attribute on a node means that node is a repeating section — the caller iterates over rows and clones the node once per row
- Result: pretty-printed XML with declaration, written via `StringIO`

5. Persists to `conversion_generated_xml` (conn_id, identifier_value, xml_content)

**Bulk generate** — `POST /api/mapping/{conn_id}/generate-xml/all`:

- Runs the full query (no WHERE) via `fetch_all_data()` (internal only, never HTTP-exposed)
- Groups rows by identifier column value
- Calls `_fill_xml_from_row()` for each group
- Writes one row to `conversion_generated_xml` per identifier

---

## Data Model (key tables)

| Table | Purpose |
|---|---|
| `conversion_source_connections` | DB credentials (Fernet-encrypted password), dialect, host |
| `conversion_xml_templates` | Raw XML template content per connection |
| `conversion_target_formula_rules` | Extracted XML paths + hardcoded default values |
| `conversion_catalog_columns` | Discovered schema: table, column, type, is_primary_key |
| `conversion_catalog_relations` | FK graph edges: parent_table.col → ref_table.col |
| `conversion_column_embeddings` | OpenAI 1536-dim vectors per column |
| `conversion_generated_queries` | The live SQL query (one per connection, overwritten on re-generate) |
| `conversion_mappings` | Mapping header (versioned, one active per connection) |
| `conversion_mapping_rows` | Source column → target XML path rows |
| `conversion_generated_xml` | Output XML per identifier value |

---

## Key Service Files

| File | Role |
|---|---|
| `api/routers/mapping_ai.py` | All mapping/XML endpoints + `_run_matching()`, `_build_sql()`, `_fill_xml_from_row()` |
| `api/services/query_builder.py` | FK graph builder + BFS join-path resolver + `build_join_query()` |
| `api/services/embeddings.py` | OpenAI embedding calls + `cosine_similarity()` |
| `api/services/connector.py` | DB connection dispatch (SQL/Snowflake), `preview_data()`, `fetch_all_data()` |
| `api/routers/admin.py` | Schema collection, embedding trigger, AI enrichment |
| `prompts/mapping_prompt.md` | Editable system prompt sent to GPT for FROM/JOIN refinement |

---

## Sequence Diagram (text)

```
User (Admin tab)
  │
  ├─ Collect Schema ──────────────────► catalog_columns, catalog_relations, catalog_samples
  └─ Generate Embeddings ─────────────► column_embeddings (OpenAI text-embedding-3-small)

User (Target tab)
  └─ Upload XML template ─────────────► xml_templates, target_formula_rules

User (Mapping tab)
  ├─ Generate Query
  │    ├─ _run_matching()
  │    │    ├─ Embed XML paths (OpenAI)
  │    │    ├─ Cosine similarity vs column_embeddings
  │    │    ├─ Name-based override pass
  │    │    └─ Auto-detect PK (identifier)
  │    ├─ _build_sql()
  │    │    ├─ [FK path] build_join_query()
  │    │    │    ├─ Build bidirectional FK graph
  │    │    │    ├─ BFS → shortest join paths
  │    │    │    └─ Emit LEFT JOINs with t0/t1/t2 aliases
  │    │    ├─ [Flat fallback] SELECT + stub JOINs
  │    │    └─ GPT refines FROM clause only (gpt-4o-mini, max_tokens=1024)
  │    └─ Persist to generated_queries
  │
  ├─ Generate Mapping Rows
  │    ├─ Execute saved SQL TOP 1 → get column names
  │    └─ Return rows (not saved yet)
  │
  └─ Save Mapping ────────────────────► mappings + mapping_rows

User (Output tab)
  ├─ Pick identifier value
  └─ Generate XML
       ├─ Execute query WHERE id = value (connector.py)
       └─ _fill_xml_from_row()
            ├─ Walk XML tree
            ├─ Match node path → query result value
            ├─ Fill {Placeholder} patterns
            └─ Persist to generated_xml
```

---

## Formula Engine (supported in XML templates)

Formulas can be embedded in template text/attribute values:

| Formula | Example |
|---|---|
| Field placeholder | `{EmployeeName}` |
| Explicit table ref | `{EMP.ENAME}` |
| UPPER / LOWER / TRIM / LEN | `UPPER({ENAME})` |
| CONCAT | `CONCAT({FNAME}, ' ', {LNAME})` |
| IF | `IF({SAL} > 5000, 'Senior', 'Junior')` |
| FORMAT_DATE | `FORMAT_DATE({HIREDATE}, 'YYYY-MM-DD')` |
| Arithmetic | `{PRICE} * {QTY}` (auto-evaluated for numerics) |

---

## Error / Fallback Strategy

| Failure point | Fallback |
|---|---|
| No embeddings in DB | `HTTPException 422` — "Go to Admin → Generate Embeddings" |
| No FK relations | Flat single-table SELECT with stub JOIN comments |
| GPT FROM refinement fails | Original programmatic SQL is used (try/except silently ignored) |
| No PK found for main table | Falls back to any PK in the catalog; if none, identifier column is null |
| XML parse error on template | `HTTPException 422` with parse error detail |
| Cosine score < 0.25 | Column unmatched → `NULL AS [/xml/path]` in SELECT |
