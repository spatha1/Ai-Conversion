"""
api/services/query_intelligence.py

Analyzes a SQL query using GPT-4o-mini and returns structured intelligence:
  - Business & technical intent
  - Complexity rating
  - Anti-patterns with severity
  - Cost / performance issues
  - Optimized rewrite suggestion
  - Index recommendations

Supports prompt template override via category "query_intelligence".
Logs every LLM call to conversion_ai_trace_log.
"""
from __future__ import annotations

import json
import time
from typing import Optional

from sqlalchemy.orm import Session


_SYSTEM_PROMPT = """\
You are an expert SQL performance and code quality analyst.

When given a SQL query, respond ONLY with a valid JSON object (no markdown, no explanation outside JSON).

Use this exact structure:
{
  "summary": "<one-sentence description of what the query does>",
  "intent": {
    "business": "<business purpose — what data does this retrieve and why>",
    "technical": "<technical description — joins, aggregations, filters, CTEs used>"
  },
  "complexity": "<Simple | Moderate | Complex>",
  "anti_patterns": [
    {
      "type": "<short name, e.g. SELECT *, Implicit JOIN, Missing WHERE>",
      "description": "<why this is a problem>",
      "severity": "<low | medium | high>"
    }
  ],
  "cost_issues": [
    {
      "issue": "<description of the performance problem>",
      "impact": "<likely execution impact, e.g. full table scan, memory spill>",
      "severity": "<low | medium | high>"
    }
  ],
  "suggested_rewrite": "<optimized SQL rewrite as a plain string, or empty string if no improvement needed>",
  "index_recommendations": [
    {
      "table": "<table name>",
      "columns": ["<col1>", "<col2>"],
      "reason": "<why this index helps>"
    }
  ]
}

Anti-pattern examples to detect (non-exhaustive):
- SELECT * (avoid fetching all columns)
- Implicit cartesian joins (missing ON clause)
- WHERE 1=1 or always-true filter
- Functions on indexed columns in WHERE (e.g. UPPER(col) = ...)
- Non-SARGable predicates
- Unnecessary DISTINCT
- Subqueries that could be CTEs or JOINs
- ORDER BY without TOP/LIMIT (full sort with no bound)
- Missing WHERE on UPDATE/DELETE

Cost issue examples:
- No index on filter/join column
- Full table scan likely
- Large intermediate result sets
- N+1 pattern in correlated subqueries
- Excessive CROSS JOINs

If no anti-patterns or cost issues exist, return empty arrays [].
If no rewrite is needed, return "" for suggested_rewrite.
"""


def analyze_query(
    sql: str,
    dialect: Optional[str],
    schema_context: Optional[str],
    extra_context: Optional[str],
    db: Session,
    conn_id: Optional[int] = None,
) -> dict:
    """
    Run LLM analysis on a SQL query and return structured results.
    Auto-loads schema context from catalog if conn_id is provided.
    """
    # ── Load schema context from catalog if conn_id given ────────────────────
    auto_schema: Optional[str] = None
    if conn_id:
        try:
            from api.models import CatalogColumn
            cols = (
                db.query(CatalogColumn)
                .filter(CatalogColumn.conn_id == conn_id)
                .order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position)
                .limit(300)
                .all()
            )
            if cols:
                by_table: dict[str, list[str]] = {}
                for c in cols:
                    by_table.setdefault(c.table_name, []).append(
                        f"{c.column_name} ({c.data_type}{'  PK' if c.is_primary_key else ''})"
                    )
                lines = []
                for tbl, col_list in by_table.items():
                    lines.append(f"Table: {tbl}")
                    lines.append("  Columns: " + ", ".join(col_list))
                auto_schema = "\n".join(lines)
        except Exception:
            pass

    # ── Build prompt override from DB if available ────────────────────────────
    system_prompt = _SYSTEM_PROMPT
    try:
        from api.models import PromptTemplate as _PT
        _tmpl = db.query(_PT).filter(
            _PT.category == "query_intelligence", _PT.is_active == True
        ).first()
        if _tmpl and _tmpl.content and _tmpl.content.strip():
            system_prompt = _tmpl.content.strip()
    except Exception:
        pass

    # ── Build user message ────────────────────────────────────────────────────
    parts = []
    if dialect:
        parts.append(f"Dialect: {dialect}")
    if auto_schema:
        parts.append(f"Schema Context:\n{auto_schema}")
    if extra_context and extra_context.strip():
        parts.append(f"Additional Context:\n{extra_context.strip()}")
    parts.append(f"SQL Query:\n```sql\n{sql.strip()}\n```")

    user_message = "\n\n".join(parts)

    # ── Call GPT-4o-mini ──────────────────────────────────────────────────────
    from api.config import settings
    from openai import OpenAI

    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured.")

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0 = time.monotonic()

    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_message},
        ],
        temperature=0.2,
        max_tokens=1500,
    )

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw = resp.choices[0].message.content or ""

    # ── Parse JSON ────────────────────────────────────────────────────────────
    try:
        # Strip markdown fences if model adds them
        clean = raw.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[-1]
            if clean.endswith("```"):
                clean = clean[: clean.rfind("```")]
        result = json.loads(clean)
    except Exception:
        result = {
            "summary": "Analysis could not be parsed.",
            "intent": {"business": raw[:500], "technical": ""},
            "complexity": "Unknown",
            "anti_patterns": [],
            "cost_issues": [],
            "suggested_rewrite": "",
            "index_recommendations": [],
        }

    # ── Log to AI trace ───────────────────────────────────────────────────────
    try:
        from api.models import AITraceLog
        db.add(AITraceLog(
            module="query_intelligence",
            conn_id=conn_id,
            model="gpt-4o-mini",
            prompt_text=user_message[:4000],
            response_text=raw[:4000],
            tokens_in=resp.usage.prompt_tokens,
            tokens_out=resp.usage.completion_tokens,
            latency_ms=elapsed_ms,
            schema_snapshot=json.dumps({"dialect": dialect, "has_schema": bool(auto_schema)}),
        ))
        db.commit()
    except Exception:
        pass

    result["tokens_in"]  = resp.usage.prompt_tokens
    result["tokens_out"] = resp.usage.completion_tokens
    result["latency_ms"] = elapsed_ms
    return result
