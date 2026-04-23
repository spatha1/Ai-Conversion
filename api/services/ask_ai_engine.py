"""
api/services/ask_ai_engine.py

Orchestration layer for the Ask AI conversational engine.
Works for any entity (Policy, Claim, Employee, …) entirely driven by metadata.

Pipeline:
  1. Intent detection  (LLM or regex fast-path, returns confidence)
  2. Schema resolution (CatalogColumn + CatalogRelation, RBAC-filtered)
  3. SQL generation    (LLM, max 4 JOINs, TOP 500)
  4. Data fetch        (connector.py, PII masking)
  5. Narrative engine  (KPI extraction → health score → rule engine → LLM narrative)
  6. Follow-up suggestions
  7. Trace write       (ai_trace.store, module="ask_ai")

Prompt templates are loaded from conversion_prompt_templates (category="ask_ai").
If no custom template exists for a step the built-in default is used.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, date
from typing import Any, Optional

from sqlalchemy.orm import Session

from api.config import settings


# ── Prompt template loader ────────────────────────────────────────────────────

def _dialect_label_rules(dialect: str) -> tuple[str, str]:
    """Return (label, rules) for a dialect string — no DB access needed."""
    _d = (dialect or "mssql").lower()
    if _d in ("mssql", "sqlserver", "sql server"):
        return (
            "Microsoft SQL Server / T-SQL",
            "- Use TOP N not LIMIT N\n"
            "- Use GETDATE() not CURRENT_DATE or NOW()\n"
            "- Use 1/0 for booleans (not TRUE/FALSE)\n"
            "- Use DATEADD(day,-1,GETDATE()) for date arithmetic\n"
            "- Wrap reserved-word aliases: AS [Count], AS [RowCount], AS [Name]\n"
            "- Use MERGE for upserts (not ON CONFLICT)",
        )
    if _d == "postgresql":
        return (
            "PostgreSQL",
            "- Use LIMIT N (not TOP N)\n"
            "- Use CURRENT_DATE, NOW()\n"
            "- Use TRUE/FALSE for booleans\n"
            "- Use ON CONFLICT DO UPDATE for upserts",
        )
    if _d == "mysql":
        return (
            "MySQL",
            "- Use LIMIT N (not TOP N)\n"
            "- Use NOW(), CURDATE()\n"
            "- Use 1/0 for booleans\n"
            "- Use INSERT ... ON DUPLICATE KEY UPDATE for upserts",
        )
    return _d.upper(), f"Use {_d.upper()} SQL syntax."


def _get_prompt_template(db: Session, name: str, dialect: str = "mssql") -> Optional[str]:
    """Return content of an active PromptTemplate by name, or None.
    Replaces {{dialect}} and {{dialect_rules}} placeholders with connection-specific values."""
    try:
        from api.models import PromptTemplate
        row = (
            db.query(PromptTemplate)
            .filter(PromptTemplate.name == name, PromptTemplate.is_active == True)
            .first()
        )
        if not row:
            return None
        content = row.content or ""
        label, rules = _dialect_label_rules(dialect)
        content = content.replace("{{dialect}}", label).replace("{dialect}", label)
        content = content.replace("{{dialect_rules}}", rules).replace("{dialect_rules}", rules)
        return content
    except Exception:
        return None


# ── Default prompts (fallback when no DB template exists) ────────────────────

_DEFAULT_INTENT_PROMPT = """\
You are an enterprise AI assistant for a data platform. Analyze the user's message and extract the intent.

## Available Tables in this Connection
{{table_list}}

## Output Format
Return ONLY a valid JSON object with these keys:
- intent: one of "entity_lookup" | "aggregation" | "fix_action" | "general"
- entity: the name of the matching table from the list above (use the exact table name), or null
- entity_id: the specific record ID mentioned (as string, keep it exactly as the user typed), or null
- confidence: float 0.0-1.0
- clarification_needed: true only when confidence < 0.60

Rules:
- entity MUST be a table name from the list above — never invent domain terms like "Policy" or "Employee"
- If the user mentions an ID token (e.g. LEGACY_POL_1, EMP-001, 12345), capture it as entity_id verbatim
- Match user terms to the closest table name by meaning (e.g. "pol" → table containing "pol" in its name)

Example (if tables include "LegacyPolicies"):
{"intent": "entity_lookup", "entity": "LegacyPolicies", "entity_id": "LEGACY_POL_1", "confidence": 0.92, "clarification_needed": false}
"""

def _build_sql_prompt(dialect: str) -> str:
    """Build a dialect-aware SQL generation prompt."""
    _d = (dialect or "mssql").lower()
    if _d in ("mssql", "sqlserver", "sql server"):
        dialect_line = "Use Microsoft SQL Server / T-SQL syntax."
        row_limit    = "Use TOP 500 for row-capped lookups (not LIMIT)."
        extra_rules  = (
            "- Use GETDATE() (not CURRENT_DATE or NOW())\n"
            "- Use 1/0 for booleans (not TRUE/FALSE)\n"
            "- Use DATEADD(day,-1,GETDATE()) for date arithmetic (not INTERVAL)\n"
            "- Wrap reserved-word aliases in brackets: AS [Count], AS [RowCount], AS [Name]\n"
        )
    elif _d == "postgresql":
        dialect_line = "Use PostgreSQL syntax."
        row_limit    = "Use LIMIT 500 for row-capped lookups."
        extra_rules  = (
            "- Use CURRENT_DATE, NOW()\n"
            "- Use TRUE/FALSE for booleans\n"
            "- Use ON CONFLICT DO UPDATE for upserts\n"
        )
    elif _d == "mysql":
        dialect_line = "Use MySQL syntax."
        row_limit    = "Use LIMIT 500 for row-capped lookups."
        extra_rules  = (
            "- Use NOW(), CURDATE()\n"
            "- Use 1/0 for booleans\n"
            "- Use INSERT ... ON DUPLICATE KEY UPDATE for upserts\n"
        )
    else:
        dialect_line = f"Use {_d.upper()} SQL syntax."
        row_limit    = "Limit result sets to 500 rows."
        extra_rules  = ""

    return (
        f"You are an expert SQL developer. Generate a SQL query to answer the user's question.\n"
        f"{dialect_line} Maximum 4 JOINs. {row_limit}\n\n"
        "## Database Schema\n{{schema}}\n\n"
        "Rules:\n"
        "- JOIN tables using ONLY the FK relationships listed in the schema above.\n"
        "- Select columns from all relevant joined tables to give a complete picture.\n"
        "- Use LEFT JOIN so the primary entity row is always returned even when related rows are missing.\n"
        "- For aggregations, use COUNT/SUM/AVG — no row cap needed.\n"
        "- Never use subqueries when a JOIN will suffice.\n"
        + extra_rules +
        "\nReturn ONLY the SQL inside a ```sql code fence.\n"
    )

_DEFAULT_NARRATIVE_PROMPT = """\
You are a business analyst writing clear, executive-friendly summaries.
Write 2-4 sentences summarizing the data. Be specific — use IDs, amounts, dates.
Return ONLY JSON with keys: narrative, key_finding, recommendation
"""


# ── Regex fast-path for obvious queries ──────────────────────────────────────

# Matches:  "explain policy 12345"   → entity=policy,   id=12345
#           "explain LEGACY_POL_1"   → entity=LEGACY,   id=POL_1  (whole token after verb)
#           "show claim EMP-001"     → entity=claim,    id=EMP-001
#           "describe POL_2024_007"  → entity=POL,      id=2024_007
# Strategy: verb + optional entity word + alphanumeric token (may contain _ or -)
_ENTITY_PATTERN = re.compile(
    r"\b(?:explain|show|describe|lookup|get|find|view)\s+"
    r"(?:(?P<entity>[a-zA-Z]+)\s+)?"           # optional plain-word entity label
    r"(?P<id>[A-Za-z0-9][A-Za-z0-9_\-]*\d[A-Za-z0-9_\-]*)",  # ID must contain a digit
    re.IGNORECASE,
)

# Also catch bare alphanumeric IDs without a verb when they look like record keys
_BARE_ID_PATTERN = re.compile(
    r"^[A-Za-z]+[_\-]?[A-Za-z0-9]+[_\-]\d+$",  # e.g. LEGACY_POL_1, EMP-001, POL_2024
)


def _regex_intent(message: str) -> Optional[dict]:
    msg = message.strip()
    m = _ENTITY_PATTERN.search(msg)
    if m:
        entity_word = m.group("entity")
        raw_id      = m.group("id")

        # If entity_word is missing, infer from the alphabetic prefix of the ID token
        # e.g. "LEGACY_POL_1" → prefix="LEGACY"
        if not entity_word:
            entity_word = re.split(r"[_\-\d]", raw_id)[0]

        # Clean: capitalise entity, keep ID as-is
        entity = entity_word.capitalize() if entity_word else None
        if not entity:
            return None

        return {
            "intent":              "entity_lookup",
            "entity":              entity,
            "entity_id":           raw_id,
            "confidence":          1.0,
            "clarification_needed": False,
        }

    # Bare ID with no verb: "LEGACY_POL_1"
    if _BARE_ID_PATTERN.match(msg):
        prefix = re.split(r"[_\-\d]", msg)[0]
        return {
            "intent":              "entity_lookup",
            "entity":              prefix.capitalize(),
            "entity_id":           msg,
            "confidence":          0.85,
            "clarification_needed": False,
        }

    return None


# ── BFS entity fetch ─────────────────────────────────────────────────────────

def _build_fk_graph(relations: list) -> dict:
    """Bidirectional FK adjacency list: {table: [(neighbour, my_col, their_col)]}"""
    from collections import defaultdict
    graph: dict = defaultdict(list)
    for r in relations:
        graph[r.parent_table].append((r.referenced_table, r.parent_column, r.referenced_column))
        graph[r.referenced_table].append((r.parent_table, r.referenced_column, r.parent_column))
    return dict(graph)


def _build_entity_full_sql(
    entity_table: str,
    id_column: str,
    entity_id: str,
    tables: list[dict],
    relations: list,
    max_joins: int = 4,
) -> tuple[str, list[str]]:
    """
    BFS-traverse the FK graph from entity_table and build a multi-table
    LEFT JOIN SELECT that returns every related column aliased as table__column.
    Returns (sql, [ordered table names included]).
    """
    from collections import deque

    graph = _build_fk_graph(relations)
    table_map = {t["table_name"]: t for t in tables}

    # BFS — collect at most max_joins hop edges
    visited: set = {entity_table}
    queue: deque = deque([(entity_table, [])])
    join_edges: list[tuple] = []  # (from_table, from_col, to_table, to_col)

    while queue and len(join_edges) < max_joins:
        node, _path = queue.popleft()
        for nbr, my_col, their_col in graph.get(node, []):
            if nbr not in visited and nbr in table_map:
                visited.add(nbr)
                join_edges.append((node, my_col, nbr, their_col))
                if len(join_edges) >= max_joins:
                    break
                queue.append((nbr, _path + [(node, my_col, nbr, their_col)]))

    joined_tables = [entity_table] + [e[2] for e in join_edges]

    # Build aliases: t0 = anchor, t1..tN = joined
    aliases: dict[str, str] = {}
    for i, tbl in enumerate(joined_tables):
        aliases[tbl] = f"t{i}"

    # SELECT columns — alias as table__column so we can parse them back
    select_parts: list[str] = []
    for tbl in joined_tables:
        alias = aliases[tbl]
        cols = table_map.get(tbl, {}).get("columns", [])
        for col_info in cols[:40]:
            col = col_info["column_name"]
            select_parts.append(f"{alias}.[{col}] AS [{tbl}__{col}]")

    # FROM + LEFT JOINs
    from_clause = f"[{entity_table}] AS t0"
    join_clauses: list[str] = []
    for from_t, from_c, to_t, to_c in join_edges:
        fa = aliases[from_t]
        ta = aliases[to_t]
        join_clauses.append(f"LEFT JOIN [{to_t}] AS {ta} ON {fa}.[{from_c}] = {ta}.[{to_c}]")

    if id_column and entity_id:
        # Quote only non-numeric IDs
        quoted_id = entity_id if re.match(r"^\d+$", str(entity_id)) else f"'{entity_id}'"
        where = f"WHERE t0.[{id_column}] = {quoted_id}"
    else:
        where = ""

    cols_sql = ",\n  ".join(select_parts) if select_parts else "*"
    join_sql = "\n".join(join_clauses)
    sql = f"SELECT TOP 1\n  {cols_sql}\nFROM {from_clause}"
    if join_sql:
        sql += f"\n{join_sql}"
    if where:
        sql += f"\n{where}"

    return sql, joined_tables


def _parse_sections(row: dict, joined_tables: list[str], table_map: dict) -> list[dict]:
    """
    Parse a flat aliased result row (keys = table__column) into a list of sections,
    one per table, containing only non-null field values.
    """
    sections: list[dict] = []
    for tbl in joined_tables:
        cols = table_map.get(tbl, {}).get("columns", [])
        fields: list[dict] = []
        for col_info in cols:
            col = col_info["column_name"]
            key = f"{tbl}__{col}"
            val = row.get(key)
            if val is None or str(val).strip() == "":
                continue
            fields.append({
                "label":  col.replace("_", " ").title(),
                "column": col,
                "value":  str(val),
                "type":   _infer_kpi_type(col),
            })
        if fields:
            sections.append({
                "table":  tbl,
                "title":  tbl.replace("_", " ").title(),
                "fields": fields,
            })
    return sections


# ── Schema helpers ────────────────────────────────────────────────────────────

def _build_schema_text(tables: list[dict]) -> str:
    lines = []
    for t in tables[:40]:
        cols = ", ".join(c["column_name"] for c in t["columns"][:20])
        lines.append(f"  {t['table_name']}({cols})")
    return "\n".join(lines) if lines else "(no schema available)"


def _build_schema_text_with_relations(tables: list[dict], relations: list) -> str:
    """Build a rich schema text that includes column definitions AND FK JOIN hints for SQL generation."""
    lines = ["## Tables and Columns"]
    for t in tables[:40]:
        col_defs = ", ".join(
            f"{c['column_name']} ({c.get('data_type','varchar')})"
            for c in t["columns"][:25]
        )
        lines.append(f"  {t['table_name']}: {col_defs}")

    if relations:
        lines.append("\n## Foreign Key Relationships (use these for JOINs)")
        seen = set()
        for r in relations[:60]:
            key = (r.parent_table, r.parent_column, r.referenced_table, r.referenced_column)
            if key in seen:
                continue
            seen.add(key)
            lines.append(
                f"  {r.parent_table}.{r.parent_column} → {r.referenced_table}.{r.referenced_column}"
            )
        lines.append("\nWhen joining tables, use ONLY the FK relationships listed above.")

    return "\n".join(lines)


def _load_schema(conn_id: int, db: Session) -> tuple[list[dict], list]:
    """
    Returns (tables_list, relations_list).
    tables_list = [{"table_name": str, "columns": [{"column_name": str, "data_type": str}]}]
    relations_list = CatalogRelation ORM objects
    """
    from api.models import CatalogColumn, CatalogRelation

    col_rows = (
        db.query(CatalogColumn)
        .filter(CatalogColumn.conn_id == conn_id)
        .order_by(CatalogColumn.table_name, CatalogColumn.column_name)
        .limit(2000)
        .all()
    )

    table_map: dict[str, list] = {}
    for c in col_rows:
        if c.table_name not in table_map:
            table_map[c.table_name] = []
        table_map[c.table_name].append({
            "column_name": c.column_name,
            "data_type":   c.data_type or "varchar",
        })

    tables = [{"table_name": t, "columns": cols} for t, cols in table_map.items()]

    relations = (
        db.query(CatalogRelation)
        .filter(CatalogRelation.conn_id == conn_id)
        .limit(200)
        .all()
    )

    return tables, list(relations)


def _tokenize(name: str) -> list[str]:
    """Split a table/column name into lowercase tokens on _, -, spaces, and camelCase."""
    # insert underscore before uppercase runs for camelCase
    s = re.sub(r"([a-z])([A-Z])", r"\1_\2", name)
    return [t.lower() for t in re.split(r"[_\-\s]+", s) if t]


def _find_entity_table(entity: str, tables: list[dict]) -> Optional[str]:
    """
    Find the most likely table for a given entity term.
    Scoring (higher = better match):
      3 — exact table name match
      2 — entity is a substring of table name (or vice-versa)
      1 — any token of entity matches any token of table name
    """
    entity_lower = entity.lower().strip()
    entity_tokens = set(_tokenize(entity))
    candidates: list[tuple[str, int]] = []

    for t in tables:
        name = t["table_name"]
        name_lower = name.lower()
        name_tokens = set(_tokenize(name))

        if name_lower == entity_lower:
            score = 3
        elif entity_lower in name_lower or name_lower in entity_lower:
            score = 2
        elif entity_tokens & name_tokens:
            score = 1
        else:
            # Shared 4-char prefix handles singular/plural and abbreviations:
            # "policy"[:4]="poli"  matches "policies"[:4]="poli"
            # "pol"[:4]="pol"      matches "policies"[:3]="pol" (min length used)
            def _prefix_match(a: str, b: str, n: int = 4) -> bool:
                k = min(len(a), len(b), n)
                return k >= 3 and a[:k] == b[:k]

            if any(_prefix_match(et, nt)
                   for et in entity_tokens for nt in name_tokens):
                score = 1
            else:
                continue
        candidates.append((name, score))

    if not candidates:
        return None
    candidates.sort(key=lambda x: x[1], reverse=True)
    return candidates[0][0]


_INT_TYPES = {"int", "integer", "bigint", "smallint", "tinyint", "numeric", "decimal", "number"}
_STR_TYPES = {"varchar", "nvarchar", "char", "nchar", "text", "ntext", "string"}


def _col_is_numeric(col_info: dict) -> bool:
    return (col_info.get("data_type") or "").lower().split("(")[0].strip() in _INT_TYPES


def _col_is_string(col_info: dict) -> bool:
    return (col_info.get("data_type") or "").lower().split("(")[0].strip() in _STR_TYPES


def _find_id_column(table_name: str, tables: list[dict], entity_id: str = "") -> Optional[str]:
    """
    Find the best column to use as the WHERE filter for entity_id.

    If entity_id is non-numeric (e.g. 'LEG_ACC_1'), skip integer PK columns and
    prefer varchar columns whose names suggest a natural key (number, code, no, key).
    If entity_id is numeric, prefer the integer PK.
    """
    tbl_lower  = table_name.lower()
    tbl_tokens = _tokenize(table_name)
    tbl_stem   = tbl_tokens[-1] if tbl_tokens else tbl_lower

    id_is_numeric = bool(re.match(r"^\d+$", str(entity_id).strip()))

    for t in tables:
        if t["table_name"].lower() != tbl_lower:
            continue
        cols = t["columns"]

        # ── Numeric entity_id: prefer integer PK ─────────────────────────────
        if id_is_numeric:
            for c in cols:
                if c.get("is_primary_key") and _col_is_numeric(c):
                    return c["column_name"]
            for c in cols:
                if c["column_name"].lower() == "id":
                    return c["column_name"]
            for c in cols:
                col_l = c["column_name"].lower()
                for suf in ("id", "no", "key", "num", "number", "code"):
                    if col_l.endswith(suf):
                        return c["column_name"]

        # ── Non-numeric entity_id: prefer varchar natural-key columns ─────────
        else:
            # 1. Varchar column ending in "number", "no", "code", "key" (natural keys)
            for suffix in ("number", "no", "code", "key", "name", "ref", "num"):
                for c in cols:
                    col_l = c["column_name"].lower()
                    if col_l.endswith(suffix) and not _col_is_numeric(c):
                        return c["column_name"]

            # 2. Any non-numeric column whose name contains an id-like suffix
            for c in cols:
                col_l = c["column_name"].lower()
                if not _col_is_numeric(c) and any(
                    col_l.endswith(s) for s in ("id", "identifier", "pk")
                ):
                    return c["column_name"]

            # 3. PK even if numeric (will type-mismatch, but best we can do)
            for c in cols:
                if c.get("is_primary_key"):
                    return c["column_name"]

        # Absolute fallback: first column
        if cols:
            return cols[0]["column_name"]

    return None


# ── LLM helpers ──────────────────────────────────────────────────────────────

def _openai_json(system: str, user: str, model: str = "gpt-4o-mini") -> dict:
    import openai
    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    resp = client.chat.completions.create(
        model=model,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
    )
    raw = resp.choices[0].message.content or "{}"
    try:
        return json.loads(raw), resp.usage.prompt_tokens, resp.usage.completion_tokens
    except json.JSONDecodeError:
        return {}, 0, 0


def _openai_text(system: str, user: str, model: str = "gpt-4o-mini") -> tuple[str, int, int]:
    import openai
    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    resp = client.chat.completions.create(
        model=model,
        temperature=0.2,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
    )
    return resp.choices[0].message.content or "", resp.usage.prompt_tokens, resp.usage.completion_tokens


def _extract_sql(text: str) -> str:
    fence = re.search(r"```(?:sql|tsql|mssql)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        return fence.group(1).strip()
    return text.strip()


# ── KPI + Health score ────────────────────────────────────────────────────────

_CURRENCY_HINTS = ("amount", "premium", "price", "cost", "salary", "payment", "fee", "balance", "total")
_DATE_HINTS     = ("date", "time", "created", "updated", "due", "expiry", "period", "at")
_STATUS_HINTS   = ("status", "state", "flag", "active", "enabled", "type")
_COUNT_HINTS    = ("count", "number", "qty", "quantity", "num", "total")


def _infer_kpi_type(col: str) -> str:
    col_l = col.lower()
    if any(h in col_l for h in _CURRENCY_HINTS):
        return "currency"
    if any(h in col_l for h in _DATE_HINTS):
        return "date"
    if any(h in col_l for h in _STATUS_HINTS):
        return "status"
    if any(h in col_l for h in _COUNT_HINTS):
        return "count"
    return "count"


def _format_kpi_value(value: Any, kpi_type: str) -> Any:
    if value is None:
        return None
    if kpi_type == "currency":
        try:
            return round(float(str(value).replace(",", "")), 2)
        except (ValueError, TypeError):
            return value
    if kpi_type == "date":
        if isinstance(value, (datetime, date)):
            return value.strftime("%b %d, %Y")
        return str(value)[:10] if value else None
    return value


def _extract_kpis(rows: list[dict], columns: list[str]) -> list[dict]:
    """Extract top KPIs from the first row of results."""
    if not rows:
        return []
    row = rows[0]
    kpis = []
    for col in columns[:10]:
        val = row.get(col)
        if val is None:
            continue
        kpi_type = _infer_kpi_type(col)
        formatted = _format_kpi_value(val, kpi_type)
        if formatted is None:
            continue

        # Determine status
        status = "neutral"
        col_l = col.lower()
        if kpi_type == "status":
            sv = str(val).lower()
            if sv in ("active", "open", "approved", "paid", "good"):
                status = "good"
            elif sv in ("inactive", "cancelled", "rejected", "failed"):
                status = "critical"
            elif sv in ("pending", "overdue", "review"):
                status = "warning"

        kpis.append({
            "label":  col.replace("_", " ").title(),
            "value":  formatted,
            "type":   kpi_type,
            "status": status,
            "unit":   "USD" if kpi_type == "currency" else None,
            "trend":  None,
        })

    return kpis[:6]


def _compute_health_score(kpis: list[dict], alerts: list[dict]) -> dict:
    """Compute a 0-100 health score from KPIs and alerts."""
    score = 100

    # Deduct per alert severity
    for a in alerts:
        if a.get("level") == "error":
            score -= 20
        elif a.get("level") == "warning":
            score -= 10
        elif a.get("level") == "info":
            score -= 2

    # Deduct for critical KPI statuses
    for k in kpis:
        if k.get("status") == "critical":
            score -= 15
        elif k.get("status") == "warning":
            score -= 5

    score = max(0, min(100, score))

    if score >= 90:
        band, status = "Excellent", "good"
    elif score >= 70:
        band, status = "Good", "good"
    elif score >= 50:
        band, status = "Fair", "warning"
    else:
        band, status = "Critical", "critical"

    return {
        "label":  "Health Score",
        "value":  score,
        "type":   "score",
        "status": status,
        "unit":   None,
        "trend":  None,
        "_band":  band,
    }


# ── Business rule engine ──────────────────────────────────────────────────────

_OVERDUE_COLS   = ("overdue", "age_days", "days_open", "days_old")
_MISSING_COLS   = ("assignee", "adjuster", "handler", "owner")
_STATUS_BAD     = ("overdue", "cancelled", "rejected", "failed", "inactive")


def _run_business_rules(rows: list[dict], columns: list[str]) -> tuple[list[dict], list[dict]]:
    """
    Returns (alerts, rules_triggered).
    Simple rule engine: checks for overdue items, missing assignments, bad statuses.
    """
    alerts: list[dict] = []
    rules: list[dict]  = []
    if not rows:
        return alerts, rules

    row = rows[0]  # check first/primary row

    for col in columns:
        val = row.get(col)
        col_l = col.lower()

        # Overdue check
        if any(h in col_l for h in _OVERDUE_COLS):
            try:
                days = float(str(val).replace(",", ""))
                if days > 30:
                    alerts.append({"level": "error", "message": f"{col.replace('_',' ').title()} is {int(days)} days (SLA breach)"})
                    rules.append({"rule_name": "overdue_item", "outcome": "triggered", "alert_level": "critical"})
                elif days > 14:
                    alerts.append({"level": "warning", "message": f"{col.replace('_',' ').title()} is {int(days)} days"})
                    rules.append({"rule_name": "overdue_item", "outcome": "triggered", "alert_level": "warning"})
            except (TypeError, ValueError):
                pass

        # Missing assignment check
        if any(h in col_l for h in _MISSING_COLS) and (val is None or str(val).strip() == ""):
            alerts.append({"level": "warning", "message": f"No {col.replace('_',' ')} assigned"})
            rules.append({"rule_name": "missing_assignment", "outcome": "triggered", "alert_level": "warning"})

        # Bad status check
        if "status" in col_l and val is not None:
            if str(val).lower() in _STATUS_BAD:
                alerts.append({"level": "error", "message": f"Status is {val}"})
                rules.append({"rule_name": "bad_status", "outcome": "triggered", "alert_level": "critical"})

    return alerts, rules


# ── PII masking ───────────────────────────────────────────────────────────────

_PII_PATTERNS = {
    "salary":  lambda v: "$**,***",
    "ssn":     lambda v: "***-**-" + str(v)[-4:] if v and len(str(v)) >= 4 else "***",
    "email":   lambda v: str(v)[0] + "***@***.***" if v and "@" in str(v) else "***",
    "phone":   lambda v: "***-***-" + str(v)[-4:] if v and len(str(v)) >= 4 else "***",
    "password": lambda v: "***",
    "secret":  lambda v: "***",
    "token":   lambda v: "***",
}


def _apply_pii_mask(rows: list[dict], columns: list[str]) -> tuple[list[dict], list[str]]:
    """Mask PII columns in result rows. Returns (masked_rows, masked_column_names)."""
    masked_cols: list[str] = []
    for col in columns:
        col_l = col.lower()
        for pii_key in _PII_PATTERNS:
            if pii_key in col_l:
                masked_cols.append(col)
                break

    if not masked_cols:
        return rows, []

    masked_rows = []
    for row in rows:
        new_row = dict(row)
        for col in masked_cols:
            if col in new_row and new_row[col] is not None:
                col_l = col.lower()
                for pii_key, mask_fn in _PII_PATTERNS.items():
                    if pii_key in col_l:
                        new_row[col] = mask_fn(new_row[col])
                        break
        masked_rows.append(new_row)

    return masked_rows, masked_cols


# ── Follow-up suggestions ─────────────────────────────────────────────────────

def _build_follow_ups(entity: Optional[str], entity_id: Optional[str], columns: list[str]) -> list[dict]:
    """
    Generate follow-up suggestions entirely from the columns returned — no hardcoded domain terms.
    Groups columns by apparent topic (payments, status, dates) and offers contextual queries.
    """
    if not entity:
        return []

    base  = f" for {entity} {entity_id}" if entity_id else f" in {entity}"
    cols  = [c.lower() for c in columns]
    suggestions: list[dict] = []

    # Detect related data topics from actual column names
    related_tables = set()
    for col in cols:
        parts = col.split("__")  # BFS aliased as table__col
        if len(parts) == 2 and parts[0].lower() != (entity or "").lower():
            related_tables.add(parts[0])

    for tbl in list(related_tables)[:3]:
        label = tbl.replace("_", " ").title()
        suggestions.append({
            "label": f"Show {label}",
            "query": f"Show {label}{base}",
        })

    # Generic always-useful follow-ups
    suggestions.append({"label": f"Show issues{base}",          "query": f"Show issues{base}"})
    suggestions.append({"label": f"Run reconciliation{base}",   "query": f"Run reconciliation check{base}"})

    return suggestions[:4]


# ── Error response helper ─────────────────────────────────────────────────────

def _error_response(session_id: Optional[str], message: str, trace_steps: Optional[list] = None) -> dict:
    """Return a full-shape AskAIResult with an error alert and no data."""
    return {
        "session_id":           session_id,
        "intent":               {"type": "general", "entity": None, "entity_id": None, "confidence": 0.0, "clarification_needed": False},
        "clarification_prompt": None,
        "narrative":            message,
        "data_sources":         None,
        "kpis":                 [],
        "alerts":               [{"level": "error", "message": message}],
        "rules_triggered":      [],
        "pii_masked":           [],
        "sections":             [],
        "raw_data":             {"columns": [], "rows": []},
        "actions":              [],
        "follow_ups":           [],
        "trace_steps":          trace_steps or [],
        "trace_id":             None,
    }


# ── Main engine ───────────────────────────────────────────────────────────────

def run(
    *,
    message: str,
    conn_id: int,
    session_id: Optional[str],
    db: Session,
    model: str = "gpt-4o-mini",
) -> dict:
    """
    Run the full Ask AI pipeline for one user message.

    Returns a dict matching the AskAIResult API contract:
    {
      session_id, intent, clarification_prompt, narrative,
      data_sources, kpis, alerts, rules_triggered, pii_masked,
      raw_data, actions, follow_ups, trace_id, trace_steps
    }
    """
    from api.services import ai_trace
    from api.routers.connections import _to_cfg_from_model
    from api.models import SourceConnection
    from api.services.connector import preview_data

    # ── Early guards ──────────────────────────────────────────────────────────
    if not settings.OPENAI_API_KEY:
        return _error_response(session_id, "OpenAI API key is not configured. Add OPENAI_API_KEY to your .env file.")

    if not conn_id or conn_id <= 0:
        return _error_response(session_id, "Please select a connection before asking a question.")

    t_total = time.monotonic()
    trace_steps: list[dict] = []
    total_tokens_in = 0
    total_tokens_out = 0

    # ── helpers ──────────────────────────────────────────────────────────────

    def _step(number: int, name: str, duration_ms: int, summary: str,
               status: str = "success", confidence: Optional[float] = None,
               guardrail: bool = False, **extra):
        step = {
            "step_number":        number,
            "step_name":          name,
            "status":             status,
            "duration_ms":        duration_ms,
            "summary":            summary,
            "guardrail_triggered": guardrail,
        }
        if confidence is not None:
            step["confidence"] = confidence
        step.update(extra)
        trace_steps.append(step)

    # ── Step 1: Intent Detection ──────────────────────────────────────────────
    t0 = time.monotonic()

    # Load schema first so we can inject real table names into the intent prompt
    tables_pre, _ = _load_schema(conn_id, db)
    if not tables_pre:
        return _error_response(session_id, "No schema found for this connection. Run 'Collect Schema' in the Admin tab first.")
    table_list_text = "\n".join(f"  - {t['table_name']}" for t in tables_pre[:60])

    # Detect dialect once — used throughout all LLM calls
    try:
        _conn_for_dialect = db.query(SourceConnection).filter_by(id=conn_id).first()
        _dialect = (_conn_for_dialect.dialect or "mssql").lower() if _conn_for_dialect else "mssql"
    except Exception:
        _dialect = "mssql"

    intent_result = _regex_intent(message)
    if intent_result:
        tok_in = tok_out = 0
        # Resolve the entity name against actual tables if regex gave a generic prefix
        if intent_result.get("entity") and tables_pre:
            resolved = _find_entity_table(intent_result["entity"], tables_pre)
            if resolved:
                intent_result["entity"] = resolved
    else:
        intent_prompt = _get_prompt_template(db, "ask_ai_intent", _dialect) or _DEFAULT_INTENT_PROMPT
        intent_prompt = intent_prompt.replace("{{table_list}}", table_list_text)
        intent_prompt = intent_prompt.replace("{{schema}}", table_list_text)  # legacy placeholder

        intent_result, tok_in, tok_out = _openai_json(
            intent_prompt,
            f"User message: {message}",
            model,
        )
        total_tokens_in  += tok_in
        total_tokens_out += tok_out

    intent_type     = intent_result.get("intent", "general")
    entity          = intent_result.get("entity")
    entity_id       = intent_result.get("entity_id")
    confidence      = float(intent_result.get("confidence", 0.5))
    needs_clarify   = bool(intent_result.get("clarification_needed", confidence < 0.60))

    step1_ms = int((time.monotonic() - t0) * 1000)
    _step(1, "Intent Detection", step1_ms,
          f"intent={intent_type}, entity={entity}, id={entity_id}, confidence={confidence:.2f}",
          confidence=confidence, guardrail=needs_clarify)

    # ── Confidence gate ───────────────────────────────────────────────────────
    if needs_clarify:
        ai_trace.store(
            module="ask_ai", conn_id=conn_id, model=model,
            prompt=message,
            response=f"[CLARIFICATION NEEDED] confidence={confidence:.2f}",
            tokens_in=total_tokens_in, tokens_out=total_tokens_out,
            latency_ms=int((time.monotonic() - t_total) * 1000),
            db=db,
        )
        return {
            "session_id":           session_id,
            "intent":               {**intent_result, "confidence": confidence},
            "clarification_prompt": (
                f"I'm not fully sure what you're looking for (confidence: {int(confidence*100)}%). "
                f"Could you clarify? For example: 'Explain policy 12345' or 'Show claims for customer 999'."
            ),
            "narrative":    None,
            "data_sources": None,
            "kpis":         [],
            "alerts":       [],
            "rules_triggered": [],
            "pii_masked":   [],
            "sections":     [],
            "raw_data":     {"columns": [], "rows": []},
            "actions":      [],
            "follow_ups":   [],
            "trace_steps":  trace_steps,
            "trace_id":     None,
        }

    # ── Step 2: Schema Resolution ─────────────────────────────────────────────
    t0 = time.monotonic()

    # Reuse the schema already loaded for intent detection; load relations now
    tables, relations = _load_schema(conn_id, db)  # fast — catalog rows are small
    schema_text       = _build_schema_text(tables)
    table_names       = [t["table_name"] for t in tables]
    all_columns       = [c["column_name"] for t in tables for c in t["columns"]]

    # Find anchor table for entity
    entity_table = _find_entity_table(entity, tables) if entity else None
    id_column    = _find_id_column(entity_table, tables) if entity_table else None

    # Build FK summary for trace
    rel_summary = f"{len(relations)} FK relationships" if relations else "no FK relationships"

    step2_ms = int((time.monotonic() - t0) * 1000)
    _step(2, "Schema Resolution", step2_ms,
          f"tables={len(tables)}, {rel_summary}, entity_table={entity_table}, id_col={id_column}")

    # ── Step 3: SQL Generation ────────────────────────────────────────────────
    t0 = time.monotonic()

    joined_tables: list[str] = []
    sql_source = "llm"

    # _dialect already detected early in Step 1 block above

    if intent_type == "entity_lookup" and entity_table and id_column and entity_id:
        # Use deterministic BFS JOIN builder — covers all FK-reachable tables
        generated_sql, joined_tables = _build_entity_full_sql(
            entity_table, id_column, entity_id, tables, relations, max_joins=4
        )
        sql_source = "bfs"
    else:
        # General / aggregation / fix queries: reuse PS AI's proven schema-lookup + SQL-gen tools
        try:
            from api.routers.ps_ai import _tool_lookup_schema, _tool_generate_sql
            matched    = _tool_lookup_schema(message, conn_id, db)
            sql_result = _tool_generate_sql(message, matched.get("matched_columns", []), _dialect, db, conn_id)
            generated_sql = sql_result.get("sql", "")
            sql_source = "ps_lookup"
        except Exception:
            # Fallback: standard LLM SQL generation
            rich_schema_text = _build_schema_text_with_relations(tables, relations)
            sql_prompt = _get_prompt_template(db, "ask_ai_sql", _dialect) or _build_sql_prompt(_dialect)
            sql_prompt = sql_prompt.replace("{{schema}}", rich_schema_text)
            _row_limit_hint = "TOP 500" if _dialect in ("mssql", "sqlserver") else "LIMIT 500"
            user_sql_msg = (
                f"User question: {message}\n"
                "Generate the SQL query. Use JOINs based on the FK relationships. "
                f"Pull in all related tables for a complete picture. "
                f"Limit to {_row_limit_hint} rows. Maximum 4 JOINs."
            )
            sql_text, tok_in, tok_out = _openai_text(sql_prompt, user_sql_msg, model)
            total_tokens_in  += tok_in
            total_tokens_out += tok_out
            generated_sql = _extract_sql(sql_text)
            sql_source = "llm"

    # Post-process: for MSSQL, quote reserved words used as unquoted aliases to prevent syntax errors.
    # e.g. "AS RowCount" → "AS [RowCount]"  (only needed for SQL Server / T-SQL)
    if _dialect in ("mssql", "sqlserver", "sql server"):
        _TSQL_RESERVED_ALIASES = re.compile(
            r'\bAS\s+(' + '|'.join([
                'RowCount', 'Count', 'Rows', 'Row', 'Key', 'Type', 'Name', 'Order', 'Group',
                'User', 'Value', 'Index', 'Set', 'Table', 'Column', 'Schema', 'Identity',
                'Rank', 'Level', 'Zone', 'State', 'Status', 'Size', 'Number', 'Data',
            ]) + r')\b',
            re.IGNORECASE,
        )
        generated_sql = _TSQL_RESERVED_ALIASES.sub(lambda m: f'AS [{m.group(1)}]', generated_sql)

    step3_ms = int((time.monotonic() - t0) * 1000)
    _step(3, "SQL Generation", step3_ms,
          f"SQL generated via {sql_source} ({len(generated_sql)} chars), tables={joined_tables or 'llm-resolved'}",
          sql=generated_sql[:500])

    # ── Step 4: Data Fetch ────────────────────────────────────────────────────
    t0 = time.monotonic()

    rows: list[dict]    = []
    columns: list[str]  = []
    pii_masked: list[str] = []
    fetch_error: str    = ""

    try:
        conn_row = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
        if conn_row:
            cfg = _to_cfg_from_model(conn_row)
            cfg["query"] = generated_sql
            result = preview_data(cfg, limit=500)
            columns = result.get("columns", [])
            rows    = result.get("rows", [])
            # Apply PII masking
            rows, pii_masked = _apply_pii_mask(rows, columns)
        else:
            fetch_error = "Connection not found"
    except Exception as exc:
        raw_error = str(exc)
        # Classify the error into a clean user-facing message
        err_lower = raw_error.lower()
        if any(k in err_lower for k in ("invalid column", "invalid object", "no such column", "no such table", "does not exist")):
            fetch_error = "Schema mismatch — a column or table in the query was not found. Try re-running Collect Schema in the Admin tab."
        elif any(k in err_lower for k in ("login failed", "authentication", "access denied", "password")):
            fetch_error = "Authentication failed. Please verify the connection credentials."
        elif any(k in err_lower for k in ("timeout", "timed out", "connection reset")):
            fetch_error = "The query timed out. The database may be unavailable or the query is too complex."
        elif any(k in err_lower for k in ("network", "could not connect", "cannot open", "unreachable")):
            fetch_error = "Cannot reach the database. Please check that the connection host is reachable."
        else:
            fetch_error = "An error occurred while fetching data. Check the AI Trace for technical details."
        # Store raw error in the trace summary only (not surfaced to the user)
        _step(4, "Data Fetch (error)", 0,
              f"RAW ERROR: {raw_error[:400]}",
              status="error")
        rows = []

    step4_ms = int((time.monotonic() - t0) * 1000)
    if not fetch_error:
        _step(4, "Data Fetch", step4_ms,
              f"rows={len(rows)}, cols={len(columns)}, pii_masked={pii_masked}",
              pii_masked=pii_masked)

    # Handle empty result
    if not rows and not fetch_error:
        narrative_text = (
            f"No information available for {entity} {entity_id}."
            if entity and entity_id
            else "No records found for your query."
        )
        ai_trace.store(
            module="ask_ai", conn_id=conn_id, model=model,
            prompt=message, response=narrative_text,
            tokens_in=total_tokens_in, tokens_out=total_tokens_out,
            latency_ms=int((time.monotonic() - t_total) * 1000),
            sql_executed=generated_sql, row_count_returned=0,
            db=db,
        )
        return {
            "session_id":           session_id,
            "intent":               {**intent_result, "confidence": confidence},
            "clarification_prompt": None,
            "narrative":            narrative_text,
            "data_sources":         {"tables": table_names, "row_count": 0, "summary": "No records found."},
            "kpis":                 [],
            "alerts":               [{"level": "info", "message": "No records found for this query."}],
            "rules_triggered":      [],
            "pii_masked":           pii_masked,
            "sections":             [],
            "raw_data":             {"columns": [], "rows": []},
            "actions":              _build_actions(intent_type, entity, entity_id, ""),
            "follow_ups":           _build_follow_ups(entity, entity_id, []),
            "trace_steps":          trace_steps,
            "trace_id":             None,
        }

    # Handle fetch error
    if fetch_error:
        return {
            "session_id":           session_id,
            "intent":               {**intent_result, "confidence": confidence},
            "clarification_prompt": None,
            "narrative":            fetch_error,
            "data_sources":         None,
            "kpis":                 [],
            "alerts":               [{"level": "error", "message": fetch_error}],
            "rules_triggered":      [],
            "pii_masked":           [],
            "sections":             [],
            "raw_data":             {"columns": [], "rows": []},
            "actions":              [],
            "follow_ups":           [],
            "trace_steps":          trace_steps,
            "trace_id":             None,
        }

    # ── Parse sections from BFS result ───────────────────────────────────────
    table_map_dict = {t["table_name"]: t for t in tables}
    sections: list[dict] = []
    if joined_tables and rows:
        sections = _parse_sections(rows[0], joined_tables, table_map_dict)

    # Flatten all non-aliased column names for KPI/rule extraction
    # For BFS results columns are "table__col", extract just col names for KPI hints
    kpi_columns = columns
    if joined_tables and rows:
        # Use un-aliased column names for KPI type inference
        kpi_columns = [c.split("__", 1)[-1] if "__" in c else c for c in columns]

    # ── Step 5: Narrative Engine Pipeline ─────────────────────────────────────
    t0 = time.monotonic()

    # a) KPI extraction
    kpis = _extract_kpis(rows, kpi_columns)

    # b) Business rules (use un-aliased column names)
    alerts, rules_triggered = _run_business_rules(rows, kpi_columns)

    # c) Health score
    health_kpi = _compute_health_score(kpis, alerts)
    kpis.append(health_kpi)

    # d) Narrative (LLM — skip for tiny results)
    narrative_text   = ""
    narrative_tokens = (0, 0)

    if len(rows) < 2 and not any(r.get("level") == "error" for r in alerts):
        # Use templated response for very small results
        entity_label = f"{entity} {entity_id}" if entity and entity_id else "this query"
        val_summary  = ", ".join(f"{k['label']}: {k['value']}" for k in kpis[:3] if k["value"] is not None)
        narrative_text = (
            f"{entity_label} data: {val_summary}. "
            if val_summary else
            f"Data retrieved for {entity_label}."
        )
    else:
        narr_prompt = _get_prompt_template(db, "ask_ai_narrative", _dialect) or _DEFAULT_NARRATIVE_PROMPT
        kpi_summary = ", ".join(f"{k['label']}: {k['value']}" for k in kpis[:5] if k["value"] is not None)
        alert_summary = "; ".join(a["message"] for a in alerts[:3])

        # Build a concise field dump from sections for richer narrative context
        section_summary_lines = []
        for sec in sections[:6]:
            field_str = ", ".join(f"{f['label']}: {f['value']}" for f in sec["fields"][:8])
            section_summary_lines.append(f"  [{sec['title']}] {field_str}")
        section_dump = "\n".join(section_summary_lines) or "(no structured data)"

        user_narr = (
            f"Entity: {entity} {entity_id or ''}\n"
            f"Tables fetched: {', '.join(joined_tables) if joined_tables else 'unknown'}\n"
            f"Structured data:\n{section_dump}\n"
            f"KPIs: {kpi_summary}\n"
            f"Alerts: {alert_summary or 'none'}\n"
            f"Row count: {len(rows)}\n"
            f"User asked: {message}"
        )
        try:
            narr_result, tok_in, tok_out = _openai_json(narr_prompt, user_narr, model)
            total_tokens_in  += tok_in
            total_tokens_out += tok_out
            narrative_tokens  = (tok_in, tok_out)
            narrative_text    = narr_result.get("narrative", "")
        except Exception:
            narrative_text = f"Data retrieved for {entity or 'your query'}."

    step5_ms = int((time.monotonic() - t0) * 1000)
    _step(5, "Narrative Engine", step5_ms,
          f"kpis={len(kpis)}, alerts={len(alerts)}, rules={len(rules_triggered)}, "
          f"health={health_kpi['value']}, narr_tokens={narrative_tokens[0]}+{narrative_tokens[1]}",
          health_score=health_kpi["value"],
          rules_checked=5, rules_triggered_count=len(rules_triggered))

    # ── Step 6: Follow-ups ────────────────────────────────────────────────────
    follow_ups = _build_follow_ups(entity, entity_id, columns)

    # ── Step 7: Trace Write ───────────────────────────────────────────────────
    t0 = time.monotonic()

    schema_snapshot = [f"{t['table_name']}.{c['column_name']}" for t in tables[:5] for c in t["columns"][:4]]
    ai_trace.store(
        module="ask_ai", conn_id=conn_id, model=model,
        prompt=message,
        response=narrative_text[:2000],
        tokens_in=total_tokens_in, tokens_out=total_tokens_out,
        latency_ms=int((time.monotonic() - t_total) * 1000),
        sql_executed=generated_sql,
        row_count_returned=len(rows),
        schema_snapshot=schema_snapshot,
        db=db,
    )

    step7_ms = int((time.monotonic() - t0) * 1000)
    _step(7, "Trace Stored", step7_ms, f"module=ask_ai, rows={len(rows)}, tokens={total_tokens_in}+{total_tokens_out}")

    # ── Assemble response ─────────────────────────────────────────────────────
    used_tables = list({t["table_name"] for t in tables if
                        any(t["table_name"].lower() in generated_sql.lower() for t in tables)})[:5] or table_names[:3]

    return {
        "session_id":           session_id,
        "intent": {
            "type":                 intent_type,
            "entity":               entity,
            "entity_id":            entity_id,
            "confidence":           confidence,
            "clarification_needed": False,
        },
        "clarification_prompt": None,
        "narrative":            narrative_text,
        "data_sources": {
            "tables":    used_tables,
            "row_count": len(rows),
            "summary":   (
                f"This insight is based on: {', '.join(used_tables)} "
                f"({len(used_tables)} table{'s' if len(used_tables) != 1 else ''} · "
                f"{len(rows)} record{'s' if len(rows) != 1 else ''} found)"
            ),
        },
        "kpis":            kpis,
        "alerts":          alerts,
        "rules_triggered": rules_triggered,
        "pii_masked":      pii_masked,
        "sections":        sections,
        "raw_data":        {"columns": columns, "rows": rows},
        "actions":         _build_actions(intent_type, entity, entity_id, generated_sql),
        "follow_ups":      follow_ups,
        "trace_steps":     trace_steps,
        "trace_id":        None,
    }


# ── Action builder ────────────────────────────────────────────────────────────

def _build_actions(intent_type: str, entity: Optional[str], entity_id: Optional[str], query_sql: str = "") -> list[dict]:
    actions = [
        {
            "label":                "View Details",
            "action_type":          "view_details",
            "entity":               entity,
            "entity_id":            entity_id,
            "requires_confirmation": False,
            "preview_steps":        [],
        },
        {
            "label":                "Generate Report",
            "action_type":          "generate_report",
            "entity":               entity,
            "entity_id":            entity_id,
            "requires_confirmation": False,
            "preview_steps":        [],
            "query_sql":            query_sql,
        },
    ]
    if intent_type in ("fix_action", "entity_lookup"):
        actions.insert(1, {
            "label":                "Run Fix",
            "action_type":          "run_fix",
            "entity":               entity,
            "entity_id":            entity_id,
            "requires_confirmation": True,
            "preview_steps": [
                f"Validate {entity} {entity_id or ''} exists",
                "Check current status",
                "Apply fix via workflow engine",
                "Update record status",
                "Log action to audit trail",
            ],
        })
    return actions
