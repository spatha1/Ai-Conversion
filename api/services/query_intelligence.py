"""
api/services/query_intelligence.py

Three functions:
  analyze_query()       — quick analysis: intent, anti-patterns, cost issues, rewrite
  extract_knowledge()   — deep 11-section knowledge extraction (summary, source objects,
                          field mapping, joins, business rules, KPI detection, account
                          mappings, lineage, validation, troubleshooting, KB artifacts)
  enhance_query()       — apply a natural-language enhancement request to existing SQL

All functions support prompt template override and log to conversion_ai_trace_log.
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


# ══════════════════════════════════════════════════════════════════════════════
#  DEEP EXTRACTION
# ══════════════════════════════════════════════════════════════════════════════

_EXTRACT_SYSTEM_PROMPT = """\
You are an expert SQL Knowledge Extraction Engine for financial insurance and policy management systems.

Analyze the given SQL query and extract structured knowledge across all sections below.
Respond ONLY with a valid JSON object. No markdown fences, no text outside JSON.

{
  "session_name": "<short descriptive name derived from query purpose, e.g. 'Billing GL Processing', 'Unearned Premium Reserve', 'Policy Attach Mapping'>",
  "query_summary": {
    "purpose": "<one-sentence description of what this query does>",
    "business_objective": "<the business goal this query achieves>",
    "kpi": "<primary financial KPI, e.g. Unearned Premium | Earned Premium | Written Premium | Claims | Commission | Recoveries | Reserves. Use 'Not Applicable' if none.>",
    "process": "<business process supported, e.g. GL Processing | UPR Calculation | Policy Attach | Premium Booking>",
    "country": "<country if detectable from table/schema names or context, e.g. Australia | UK | US. Use 'Not Specified' if unknown.>",
    "domain": "<business domain, e.g. GL | Finance | Policy | Claims | Commission | Reinsurance>"
  },
  "source_objects": [
    {
      "name": "<table, view, or CTE name>",
      "type": "<base_table | view | cte | temp_table | stored_procedure>",
      "schema": "<schema prefix if present, else null>",
      "purpose": "<role of this object in the query>"
    }
  ],
  "field_mappings": [
    {
      "output_field": "<SELECT alias or column name>",
      "source_table": "<source table or CTE name>",
      "source_field": "<source column, or expression if computed>",
      "transformation_logic": "<Direct | UPPER() | CASE expression | lookup | concatenation | arithmetic | date function | etc.>"
    }
  ],
  "join_analysis": [
    {
      "join_type": "<INNER | LEFT | RIGHT | FULL | CROSS | SELF>",
      "left_table": "<left table or CTE>",
      "right_table": "<right table or CTE>",
      "join_keys": ["<left_col = right_col>"],
      "purpose": "<business reason for this join>"
    }
  ],
  "business_rules": [
    {
      "rule_type": "<CASE | DECODE | IFF | COALESCE | HARDCODED | FILTER | NULLIF | NVL>",
      "field": "<output field this rule affects, or null>",
      "condition": "<the condition or expression>",
      "result": "<what happens: output value or action>"
    }
  ],
  "kpi_detection": [
    {
      "kpi_name": "<Unearned Premium | Earned Premium | Written Premium | Claims | Commission | Recoveries | Reserves | Revenue | Loss Ratio | other>",
      "confidence": <0.0 to 1.0>,
      "evidence": "<what in the query suggests this KPI: column names, table names, filter conditions, account codes>"
    }
  ],
  "account_mappings": [
    {
      "account_number": "<GL account number, typically 4-7 digits>",
      "account_name": "<description of what this account represents>",
      "indicator": "<Debit | Credit | null if unknown>"
    }
  ],
  "data_lineage": {
    "description": "<2-4 sentence narrative: which tables are read, how joined/transformed, what output represents>",
    "mermaid_diagram": "<valid Mermaid flowchart LR. Max 12 nodes. Use \\\\n for newlines. Example: flowchart LR\\\\n  POLICY --> T1[JOIN POLICY_TXN]\\\\n  T1 --> OUTPUT[GL Entry]>"
  },
  "validation_guidance": [
    {
      "check_type": "<Row Count | Balance Check | Null Check | Debit-Credit Balance | Reconciliation | Range Check | Duplicate Check>",
      "description": "<what to validate and expected behavior>",
      "suggested_query": "<SQL snippet to perform this check, or null>"
    }
  ],
  "troubleshooting_guidance": [
    {
      "issue": "<common failure scenario or unexpected result>",
      "likely_cause": "<root cause: missing reference data, null join key, date filter issue, etc.>",
      "resolution_hint": "<how to investigate or fix>"
    }
  ],
  "kb_artifacts": [
    {
      "kb_type": "<Process | View | Configuration | Lineage | Troubleshooting>",
      "title": "<short descriptive title for this KB entry>",
      "content": "<complete KB article in plain English, structured and detailed, ready to be saved and searched>"
    }
  ]
}

Extraction rules:
- session_name: 3-6 words, descriptive, based on main purpose.
- source_objects: Include ALL tables, views, CTEs, subqueries. Prefix V_ = view.
- field_mappings: Cover EVERY SELECT column. SELECT * → output_field="*".
- business_rules: Extract EVERY CASE/WHEN, IFF, DECODE, COALESCE, WHERE condition, hardcoded literal.
- account_mappings: Look for 4-7 digit numeric literals that appear to be GL account codes.
- data_lineage.mermaid_diagram: Valid Mermaid syntax with literal \\n between lines.
- kb_artifacts: Generate exactly 4-5 artifacts: Process Knowledge, View/Query Knowledge, Lineage, Troubleshooting, Validation.
- Empty sections → return [].
"""


def extract_knowledge(
    sql: str,
    dialect: Optional[str],
    extra_context: Optional[str],
    db: Session,
    conn_id: Optional[int] = None,
) -> dict:
    """
    Deep 11-section knowledge extraction from a SQL query.
    Returns session_name, query_summary, source_objects, field_mappings,
    join_analysis, business_rules, kpi_detection, account_mappings,
    data_lineage, validation_guidance, troubleshooting_guidance, kb_artifacts.
    """
    # Load schema context same as analyze_query
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

    # DB prompt override
    system_prompt = _EXTRACT_SYSTEM_PROMPT
    try:
        from api.models import PromptTemplate as _PT
        _tmpl = db.query(_PT).filter(
            _PT.category == "query_intelligence_extract", _PT.is_active == True
        ).first()
        if _tmpl and _tmpl.content and _tmpl.content.strip():
            system_prompt = _tmpl.content.strip()
    except Exception:
        pass

    parts = []
    if dialect:
        parts.append(f"Dialect: {dialect}")
    if auto_schema:
        parts.append(f"Schema Context:\n{auto_schema}")
    if extra_context and extra_context.strip():
        parts.append(f"Additional Context:\n{extra_context.strip()}")
    parts.append(f"SQL Query:\n```sql\n{sql.strip()}\n```")
    user_message = "\n\n".join(parts)

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
        max_tokens=6000,
    )

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw = resp.choices[0].message.content or ""

    try:
        clean = raw.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[-1]
            if clean.endswith("```"):
                clean = clean[: clean.rfind("```")]
        result = json.loads(clean)
    except Exception:
        result = {
            "session_name": "SQL Knowledge Extraction",
            "query_summary": {
                "purpose": "Analysis could not be parsed.",
                "business_objective": raw[:300],
                "kpi": "Not Applicable",
                "process": "Unknown",
                "country": "Not Specified",
                "domain": "Unknown",
            },
            "source_objects": [],
            "field_mappings": [],
            "join_analysis": [],
            "business_rules": [],
            "kpi_detection": [],
            "account_mappings": [],
            "data_lineage": {"description": "", "mermaid_diagram": ""},
            "validation_guidance": [],
            "troubleshooting_guidance": [],
            "kb_artifacts": [],
        }

    try:
        from api.models import AITraceLog
        db.add(AITraceLog(
            module="query_intelligence_extract",
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


# ══════════════════════════════════════════════════════════════════════════════
#  QUERY ENHANCEMENT
# ══════════════════════════════════════════════════════════════════════════════

_ENHANCE_SYSTEM_PROMPT = """\
You are an expert SQL developer specializing in financial insurance data systems.

Given an original SQL query and an enhancement request, produce a revised SQL query.
Respond ONLY with valid JSON (no markdown, no text outside JSON):

{
  "revised_sql": "<complete revised SQL query, preserving the formatting style of original>",
  "changes_summary": "<clear explanation of exactly what was changed and why>",
  "warnings": ["<potential side effects, performance implications, or things to verify>"]
}

Rules:
- Preserve ALL existing business logic unless the request explicitly changes it.
- Match the formatting style (indentation, CTE structure, alias conventions) of the original.
- If the request is ambiguous, make a reasonable interpretation and note it in changes_summary.
- warnings may be empty [] if there are no concerns.
"""


def enhance_query(
    sql: str,
    enhancement_request: str,
    dialect: Optional[str],
    db: Session,
    conn_id: Optional[int] = None,
) -> dict:
    """
    Apply a natural-language enhancement request to an existing SQL query.
    Returns revised_sql, changes_summary, warnings.
    """
    from api.config import settings
    from openai import OpenAI

    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured.")

    parts = []
    if dialect:
        parts.append(f"Dialect: {dialect}")
    parts.append(f"Original SQL:\n```sql\n{sql.strip()}\n```")
    parts.append(f"Enhancement Request:\n{enhancement_request.strip()}")
    user_message = "\n\n".join(parts)

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0 = time.monotonic()

    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": _ENHANCE_SYSTEM_PROMPT},
            {"role": "user",   "content": user_message},
        ],
        temperature=0.2,
        max_tokens=3000,
    )

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw = resp.choices[0].message.content or ""

    try:
        clean = raw.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[-1]
            if clean.endswith("```"):
                clean = clean[: clean.rfind("```")]
        result = json.loads(clean)
    except Exception:
        result = {
            "revised_sql": sql,
            "changes_summary": "Enhancement could not be parsed. Original query returned.",
            "warnings": [raw[:500]],
        }

    try:
        from api.models import AITraceLog
        db.add(AITraceLog(
            module="query_intelligence_enhance",
            conn_id=conn_id,
            model="gpt-4o-mini",
            prompt_text=user_message[:4000],
            response_text=raw[:4000],
            tokens_in=resp.usage.prompt_tokens,
            tokens_out=resp.usage.completion_tokens,
            latency_ms=elapsed_ms,
        ))
        db.commit()
    except Exception:
        pass

    result["tokens_in"]  = resp.usage.prompt_tokens
    result["tokens_out"] = resp.usage.completion_tokens
    result["latency_ms"] = elapsed_ms
    return result


# ══════════════════════════════════════════════════════════════════════════════
#  KB CHAT  (scoped to entry_ids saved from an extraction)
# ══════════════════════════════════════════════════════════════════════════════

_CHAT_SYSTEM_PROMPT = """\
You are an expert SQL analyst and business knowledge assistant.

You have been given:
1. The original SQL query that was analysed.
2. Knowledge articles extracted from that SQL query.

A user is asking a question about this SQL query and its business context.

You MUST respond with ONLY a valid JSON object (no markdown, no text outside JSON):
{
  "explanation": "<clear, detailed answer to the user question — use BOTH the SQL and the KB articles>",
  "sql_query":   "<a SQL query that demonstrates, answers, or is useful for the user question — or empty string if not applicable>"
}

Rules:
- For structural questions (e.g. 'what tables?', 'what columns?', 'what joins?') answer directly from the SQL.
- For business questions (e.g. 'what is the KPI?', 'explain the rules') answer from the KB articles.
- sql_query should use the exact table/column names from the original SQL when possible.
- Never invent facts. If something is not in the SQL or KB, say so.
"""


def chat_with_kb(
    question: str,
    entry_ids: list[int],
    history: list[dict],
    dialect: Optional[str],
    db: Session,
    conn_id: Optional[int] = None,
    original_sql: Optional[str] = None,
) -> dict:
    """
    Answer a question scoped to specific KnowledgeEntry IDs from a prior extraction.
    Returns explanation + sql_query + sources + token/latency metadata.
    """
    from api.config import settings

    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured.")

    from api.models import KnowledgeChunk
    all_chunks = (
        db.query(KnowledgeChunk)
        .filter(
            KnowledgeChunk.entry_id.in_(entry_ids),
            KnowledgeChunk.embedding.isnot(None),
        )
        .all()
    )

    sources: list[dict] = []
    context_text = ""

    if all_chunks:
        try:
            from api.services.embeddings import get_embedding, cosine_similarity
            q_vec = get_embedding(question, api_key=settings.OPENAI_API_KEY)

            scored: list[tuple[float, object]] = []
            for ch in all_chunks:
                try:
                    vec = json.loads(ch.embedding)
                    score = cosine_similarity(q_vec, vec)
                    scored.append((score, ch))
                except Exception:
                    continue

            scored.sort(key=lambda x: x[0], reverse=True)
            top = scored[:5]

            ctx_parts: list[str] = []
            seen_titles: dict[int, str] = {}
            for score, ch in top:
                ctx_parts.append(f"[Source: {ch.topic or 'KB Entry'}]\n{ch.content}")
                if ch.entry_id not in seen_titles:
                    try:
                        from api.models import KnowledgeEntry as _KE
                        ent = db.query(_KE).filter_by(id=ch.entry_id).first()
                        seen_titles[ch.entry_id] = ent.title if ent else f"Entry {ch.entry_id}"
                    except Exception:
                        seen_titles[ch.entry_id] = f"Entry {ch.entry_id}"
                sources.append({"entry_id": ch.entry_id, "title": seen_titles[ch.entry_id], "score": round(score, 3)})
            context_text = "\n\n---\n\n".join(ctx_parts)
        except Exception:
            pass

    from openai import OpenAI

    user_parts: list[str] = []
    if dialect:
        user_parts.append(f"Dialect: {dialect}")
    if original_sql and original_sql.strip():
        user_parts.append(f"Original SQL Query:\n```sql\n{original_sql.strip()[:8000]}\n```")
    if context_text:
        user_parts.append(f"KB Knowledge Articles:\n{context_text}")
    user_parts.append(f"Question: {question}")

    messages: list[dict] = [{"role": "system", "content": _CHAT_SYSTEM_PROMPT}]
    for h in (history or []):
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": "\n\n".join(user_parts)})

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0 = time.monotonic()

    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=0.2,
        max_tokens=2000,
    )

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw = resp.choices[0].message.content or ""

    try:
        clean = raw.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[-1]
            if clean.endswith("```"):
                clean = clean[: clean.rfind("```")]
        result = json.loads(clean)
    except Exception:
        result = {"explanation": raw, "sql_query": ""}

    try:
        from api.models import AITraceLog
        db.add(AITraceLog(
            module="query_intelligence_chat",
            conn_id=conn_id,
            model="gpt-4o-mini",
            prompt_text="\n\n".join(user_parts)[:4000],
            response_text=raw[:4000],
            tokens_in=resp.usage.prompt_tokens,
            tokens_out=resp.usage.completion_tokens,
            latency_ms=elapsed_ms,
        ))
        db.commit()
    except Exception:
        pass

    result["sources"]    = sources
    result["tokens_in"]  = resp.usage.prompt_tokens
    result["tokens_out"] = resp.usage.completion_tokens
    result["latency_ms"] = elapsed_ms
    return result
