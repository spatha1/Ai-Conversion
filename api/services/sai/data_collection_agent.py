"""
data_collection_agent.py — Fetches datasets using LLM-generated queries.
The LLM reads the analysis approach and available tables from schema_agent,
then generates targeted SQL. Zero hardcoded queries or table assumptions.
"""
import json
import time
from typing import Optional
from sqlalchemy.orm import Session

from api.services.connector import fetch_all_data
from api.models import SourceConnection, AITraceLog, PromptTemplate
from api.services.encryption import decrypt
from api.config import settings

_SYSTEM_PROMPT = """You are an enterprise SQL analyst embedded in SAI — Swift Autonomous Intelligence.

Given:
- An operator's request and intended analysis approach
- Available tables with their columns
- Database dialect (mssql, postgresql, mysql, sqlite)

Generate the minimal set of SQL queries needed to collect the data for analysis.
For "reconciliation" / "missing" analysis: use LEFT JOIN anti-join patterns.
For "null_check": SELECT columns with null counts.
For "count_comparison": GROUP BY aggregations.
For SQL Server (mssql): use TOP N not LIMIT.
For other dialects: use LIMIT N.

Return ONLY valid JSON:
{
  "queries": [
    {
      "label": "Short descriptive name",
      "sql": "SELECT ...",
      "purpose": "What this query finds"
    }
  ]
}

Rules:
- Max 3 queries per connection
- Use only columns that exist in the available tables
- Limit each query to at most 2000 rows unless a count/aggregation
- Prefer specific targeted queries over SELECT *
- If tables have FK columns, use them for joins"""


def _load_prompt(db: Session) -> str:
    try:
        tmpl = db.query(PromptTemplate).filter(
            PromptTemplate.category == "sai_data_collection",
            PromptTemplate.is_active == True,
        ).first()
        if tmpl and tmpl.content and tmpl.content.strip():
            return tmpl.content.strip()
    except Exception:
        pass
    return _SYSTEM_PROMPT


def _build_cfg(conn: SourceConnection, query: str) -> dict:
    return {
        "source_type": conn.source_type,
        "dialect":     conn.dialect,
        "host":        conn.host,
        "port":        conn.port,
        "database":    conn.database_name,
        "schema":      conn.schema_name,
        "username":    conn.username,
        "password":    decrypt(conn.password_enc) if conn.password_enc else "",
        "query":       query,
    }


def _compute_stats(columns: list[str], rows: list[list]) -> dict:
    stats = {}
    total = len(rows)
    if total == 0:
        return {col: {"null_rate": 0.0} for col in columns}
    for i, col in enumerate(columns):
        vals = [r[i] for r in rows if i < len(r)]
        nulls = sum(1 for v in vals if v is None or v == "")
        null_rate = round(nulls / total, 4)
        numeric_vals = []
        for v in vals:
            try:
                numeric_vals.append(float(v))
            except (TypeError, ValueError):
                pass
        entry: dict = {"null_rate": null_rate, "total_rows": total}
        if numeric_vals:
            entry["min"] = min(numeric_vals)
            entry["max"] = max(numeric_vals)
            entry["mean"] = round(sum(numeric_vals) / len(numeric_vals), 4)
        stats[col] = entry
    return stats


def _generate_queries(
    request_text: str,
    analysis_approach: str,
    analysis_type: str,
    relevant_tables: list[dict],
    dialect: str,
    db: Session,
    sai_run_id: int = 0,
) -> list[dict]:
    """Ask LLM to generate targeted SQL queries based on analysis intent."""
    if not relevant_tables:
        return []

    system_prompt = _load_prompt(db)
    table_desc = "\n".join(
        f"- {t['full_name']}: [{', '.join(t['columns'][:15])}{'...' if len(t['columns']) > 15 else ''}]"
        for t in relevant_tables
    )

    user_prompt = (
        f"Operator Request: {request_text}\n"
        f"Analysis Type: {analysis_type}\n"
        f"Analysis Approach: {analysis_approach}\n"
        f"Database Dialect: {dialect}\n\n"
        f"Available Tables:\n{table_desc}\n\n"
        "Generate targeted SQL queries. Return JSON only."
    )

    try:
        from openai import OpenAI
        t0 = time.time()
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or '{"queries": []}'
        parsed = json.loads(raw)
        elapsed_ms = int((time.time() - t0) * 1000)

        try:
            db.add(AITraceLog(
                module="sai_data_collection",
                conn_id=None,
                model="gpt-4o-mini",
                prompt_text=user_prompt[:4000],
                response_text=raw[:4000],
                tokens_in=resp.usage.prompt_tokens,
                tokens_out=resp.usage.completion_tokens,
                latency_ms=elapsed_ms,
                sai_run_id=sai_run_id if sai_run_id else None,
            ))
            db.commit()
        except Exception:
            db.rollback()

        return parsed.get("queries", [])

    except Exception:
        return []


async def run(schema_context: dict, db: Session, sai_run_id: int = 0) -> dict:
    t0 = time.time()
    datasets = []
    conn_ids          = schema_context.get("conn_ids", [])
    knowledge_sources = schema_context.get("knowledge_sources", [])
    request_text      = schema_context.get("request_text", "")
    analysis_approach = schema_context.get("analysis_approach", "general data quality scan")
    analysis_type     = schema_context.get("analysis_type", "general")
    relevant_tables   = schema_context.get("relevant_tables", [])

    connections = db.query(SourceConnection).filter(
        SourceConnection.id.in_(conn_ids),
        SourceConnection.is_active == True,
    ).all() if conn_ids else []

    for conn in connections:
        # Filter relevant tables to this connection
        conn_tables = [
            t for t in relevant_tables
            if any(c.id == conn.id for c in connections)
        ]
        if not conn_tables:
            # Fall back to all catalog tables for this connection
            from api.models import CatalogColumn
            cols = db.query(CatalogColumn).filter(CatalogColumn.conn_id == conn.id).all()
            seen: dict[str, list[str]] = {}
            for c in cols:
                key = f"{c.table_schema}.{c.table_name}" if c.table_schema else c.table_name
                seen.setdefault(key, []).append(c.column_name)
            conn_tables = [
                {"full_name": k, "table": k.split(".")[-1], "columns": v}
                for k, v in seen.items()
            ]

        if not conn_tables:
            datasets.append({
                "conn_id":    conn.id,
                "label":      conn.name,
                "error":      "No catalog tables found — run Admin > Collect Schema first",
                "query_used": "",
                "row_count":  0,
                "columns":    [],
                "sample_rows": [],
                "stats":      {},
            })
            continue

        # Ask LLM to generate queries for this connection
        queries = _generate_queries(
            request_text=request_text,
            analysis_approach=analysis_approach,
            analysis_type=analysis_type,
            relevant_tables=conn_tables,
            dialect=conn.dialect or "mssql",
            db=db,
            sai_run_id=sai_run_id,
        )

        # Fallback: if LLM generated nothing, do a basic fetch from first table
        if not queries and conn_tables:
            first = conn_tables[0]
            limit_clause = "TOP 500" if (conn.dialect or "mssql") in ("mssql", "sql") else ""
            sql = f"SELECT {limit_clause} * FROM {first['full_name']}".replace("SELECT  *", "SELECT *")
            if (conn.dialect or "mssql") not in ("mssql", "sql"):
                sql += " LIMIT 500"
            queries = [{"label": first["table"], "sql": sql, "purpose": "Basic data fetch (fallback)"}]

        for q in queries:
            sql     = q.get("sql", "").strip()
            qlabel  = f"{conn.name} — {q.get('label', 'query')}"
            purpose = q.get("purpose", "")
            if not sql:
                continue
            try:
                cfg    = _build_cfg(conn, sql)
                result = fetch_all_data(cfg)
                cols   = result.get("columns", [])
                rows   = result.get("rows", [])
                stats  = _compute_stats(cols, rows)
                datasets.append({
                    "conn_id":     conn.id,
                    "label":       qlabel,
                    "purpose":     purpose,
                    "row_count":   len(rows),
                    "columns":     cols,
                    "sample_rows": rows[:5],
                    "stats":       stats,
                    "query_used":  sql,
                })
            except Exception as exc:
                datasets.append({
                    "conn_id":    conn.id,
                    "label":      qlabel,
                    "purpose":    purpose,
                    "error":      str(exc)[:500],
                    "query_used": sql,
                    "row_count":  0,
                    "columns":    [],
                    "sample_rows": [],
                    "stats":      {},
                })

    return {
        "datasets":          datasets,
        "knowledge_sources": knowledge_sources,
        "elapsed_ms":        int((time.time() - t0) * 1000),
    }
