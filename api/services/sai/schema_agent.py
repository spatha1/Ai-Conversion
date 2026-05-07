"""
schema_agent.py — Resolves operator intent into domain entities and analysis plan.
Uses the SAI Knowledge Engine (semantic_search) + LLM to identify relevant tables
and the right analysis approach. Zero hardcoded domain hints.
"""
import json
import time
from typing import Optional
from sqlalchemy.orm import Session

from api.services.knowledge_processor import semantic_search, get_operational_knowledge
from api.models import CatalogColumn, SourceConnection, AITraceLog, PromptTemplate
from api.config import settings

_SYSTEM_PROMPT = """You are an enterprise data analyst assistant embedded in SAI — Swift Autonomous Intelligence.

Given:
- An operator's natural language request
- Relevant context from the knowledge base
- A list of available database tables with their columns

Your job is to:
1. Identify which domains/systems are involved
2. Select which tables are relevant to answer the request
3. Determine the right type of analysis
4. Describe the analysis approach in plain terms

Return ONLY valid JSON matching this structure:
{
  "domains": ["domain1", "domain2"],
  "relevant_table_names": ["TABLE_A", "TABLE_B"],
  "analysis_type": "reconciliation|null_check|count_comparison|trend|general",
  "analysis_approach": "one sentence describing what queries and comparisons to run"
}

analysis_type values:
- reconciliation: find records in one table missing from another (LEFT JOIN anti-join)
- null_check: find missing/null values in key columns
- count_comparison: compare record counts across systems
- trend: time-series or rate-based analysis
- general: general data quality scan"""


def _load_prompt(db: Session) -> str:
    try:
        tmpl = db.query(PromptTemplate).filter(
            PromptTemplate.category == "sai_schema",
            PromptTemplate.is_active == True,
        ).first()
        if tmpl and tmpl.content and tmpl.content.strip():
            return tmpl.content.strip()
    except Exception:
        pass
    return _SYSTEM_PROMPT


async def run(
    request_text: str,
    project_id: Optional[int],
    conn_ids: Optional[list[int]],
    db: Session,
) -> dict:
    t0 = time.time()
    knowledge_sources = []

    # 1 — Query Knowledge Engine: general context + Lineage category for upstream dependencies
    try:
        kb_results = semantic_search(query=request_text, top_k=5, db=db)
        for score, chunk in kb_results:
            knowledge_sources.append({
                "entry_id":   chunk.entry_id if hasattr(chunk, "entry_id") else None,
                "title":      chunk.entry.title if hasattr(chunk, "entry") and chunk.entry else (chunk.topic or request_text),
                "confidence": round(float(score), 3),
            })
    except Exception:
        pass

    # Also pull system lineage and business process entries for richer context
    lineage_text = ""
    try:
        lineage_entries = get_operational_knowledge("Lineage", db, limit=5)
        if lineage_entries:
            lineage_text = "\nSystem Lineage Context:\n" + "\n".join(
                f"- {e['title']}: {e.get('summary', '')}"
                for e in lineage_entries
            )
            for e in lineage_entries:
                if not any(s.get("entry_id") == e["id"] for s in knowledge_sources):
                    knowledge_sources.append({
                        "entry_id":   e["id"],
                        "title":      e["title"],
                        "confidence": 0.8,
                    })
    except Exception:
        pass

    kb_context_text = "\n".join(
        f"- {ks['title']} (confidence: {ks['confidence']})"
        for ks in knowledge_sources
    ) or "No KB context found."
    kb_context_text += lineage_text

    # 2 — Resolve connections
    if conn_ids:
        connections = db.query(SourceConnection).filter(
            SourceConnection.id.in_(conn_ids),
            SourceConnection.is_active == True,
        ).all()
    elif project_id:
        connections = db.query(SourceConnection).filter(
            SourceConnection.project_id == project_id,
            SourceConnection.is_active == True,
        ).all()
    else:
        connections = db.query(SourceConnection).filter(
            SourceConnection.is_active == True,
        ).limit(4).all()

    resolved_conn_ids = [c.id for c in connections]

    # 3 — Collect catalog tables with columns
    table_map: dict[str, list[str]] = {}
    if resolved_conn_ids:
        cols = db.query(CatalogColumn).filter(
            CatalogColumn.conn_id.in_(resolved_conn_ids)
        ).all()
        for c in cols:
            key = f"{c.table_schema}.{c.table_name}" if c.table_schema else c.table_name
            table_map.setdefault(key, []).append(c.column_name)

    catalog_summary = "\n".join(
        f"- {tbl}: [{', '.join(cols[:10])}{'...' if len(cols) > 10 else ''}]"
        for tbl, cols in list(table_map.items())[:30]
    ) or "No catalog tables available."

    # 4 — Ask LLM to identify relevant tables + analysis approach
    domains: list[str] = []
    relevant_tables: list[dict] = []
    analysis_approach = "General data quality scan."
    analysis_type = "general"

    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        system_prompt = _load_prompt(db)

        user_prompt = (
            f"Operator Request: {request_text}\n\n"
            f"Knowledge Base Context:\n{kb_context_text}\n\n"
            f"Available Tables with Columns:\n{catalog_summary}\n\n"
            "Identify relevant tables and analysis approach. Return JSON only."
        )

        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        elapsed_ms = int((time.time() - t0) * 1000)

        domains           = parsed.get("domains", [])
        relevant_names    = [n.upper() for n in parsed.get("relevant_table_names", [])]
        analysis_approach = parsed.get("analysis_approach", analysis_approach)
        analysis_type     = parsed.get("analysis_type", analysis_type)

        # Match LLM-selected names against actual catalog (fuzzy: suffix match)
        for full_name, cols in table_map.items():
            short = full_name.split(".")[-1].upper()
            if short in relevant_names or full_name.upper() in relevant_names:
                relevant_tables.append({
                    "full_name": full_name,
                    "table":     full_name.split(".")[-1],
                    "columns":   cols,
                })

        # Log to AITraceLog
        try:
            db.add(AITraceLog(
                module="sai_schema",
                conn_id=None,
                model="gpt-4o-mini",
                prompt_text=user_prompt[:4000],
                response_text=raw[:4000],
                tokens_in=resp.usage.prompt_tokens,
                tokens_out=resp.usage.completion_tokens,
                latency_ms=elapsed_ms,
            ))
            db.commit()
        except Exception:
            db.rollback()

    except Exception:
        # Fallback: include ALL catalog tables so downstream agents have something to work with
        relevant_tables = [
            {"full_name": full_name, "table": full_name.split(".")[-1], "columns": cols}
            for full_name, cols in list(table_map.items())[:10]
        ]

    return {
        "request_text":      request_text,
        "domains":           domains,
        "analysis_type":     analysis_type,
        "analysis_approach": analysis_approach,
        "connections":       [{"id": c.id, "name": c.name, "dialect": c.dialect, "database": c.database_name} for c in connections],
        "conn_ids":          resolved_conn_ids,
        "relevant_tables":   relevant_tables,
        "table_map":         table_map,
        "kb_context_text":   kb_context_text,
        "knowledge_sources": knowledge_sources,
        "elapsed_ms":        int((time.time() - t0) * 1000),
    }
