"""
schema_agent.py — Semantic schema interpretation layer.

Sits between raw embedding results and SQL generation.
Produces a semantic model: which tables are relevant, why, query intent, confidence, and ambiguities.
"""
from __future__ import annotations

import json
from typing import Optional
from sqlalchemy.orm import Session


def build_semantic_model(
    conn_id: int,
    question: str,
    top_cols: list[dict],
    relations: list,
    metadata: list,
    db: Session,
    api_key: str = "",
    model: str = "gpt-4o-mini",
) -> dict:
    """
    Returns:
    {
      "relevant_tables": [{"name", "why_chosen", "columns": [{"name", "inferred_role"}]}],
      "join_paths": [...],
      "query_intent": str,
      "confidence": float,       # 0.0–1.0
      "ambiguities": [str],
    }

    Falls back gracefully to a rule-based result if LLM fails or api_key is missing.
    """
    # Build rule-based semantic model first (always works)
    table_map: dict[str, list] = {}
    for col in top_cols:
        t = col.get("table_name", "")
        if t not in table_map:
            table_map[t] = []
        table_map[t].append(col)

    relevant_tables = []
    total_score = 0.0
    for tname, cols in table_map.items():
        avg_score = sum(c.get("score", 0) for c in cols) / len(cols)
        total_score += avg_score
        relevant_tables.append({
            "name": tname,
            "why_chosen": f"Matched {len(cols)} column(s) with average similarity {avg_score:.2f}",
            "columns": [{"name": c["column_name"], "inferred_role": c.get("column_definition", "")} for c in cols],
        })

    confidence = min(1.0, total_score / max(len(table_map), 1))

    # Build join_paths from relations for referenced tables
    table_names = set(table_map.keys())
    join_paths = []
    for rel in (relations or []):
        if hasattr(rel, "parent_table"):
            if rel.parent_table in table_names or rel.referenced_table in table_names:
                join_paths.append(f"{rel.parent_table}.{rel.parent_column} → {rel.referenced_table}.{rel.referenced_column}")
        elif isinstance(rel, dict):
            pt = rel.get("parent_table", "")
            if pt in table_names or rel.get("referenced_table", "") in table_names:
                join_paths.append(f"{pt}.{rel.get('parent_column','')} → {rel.get('referenced_table','')}.{rel.get('referenced_column','')}")

    # Apply metadata enrichment (aliases / synonyms)
    ambiguities = []
    for meta in (metadata or []):
        if isinstance(meta, dict):
            col_name = meta.get("column_name", "")
            aliases  = meta.get("aliases", "")
        else:
            col_name = getattr(meta, "column_name", "") or ""
            aliases  = getattr(meta, "aliases", "") or ""
        if aliases and col_name and col_name in [c["name"] for t in relevant_tables for c in t["columns"]]:
            ambiguities.append(f"Column '{col_name}' has aliases: {aliases}")

    rule_based = {
        "relevant_tables": relevant_tables,
        "join_paths": join_paths,
        "query_intent": f"User wants to query data related to: {question}",
        "confidence": round(confidence, 3),
        "ambiguities": ambiguities,
    }

    if not api_key:
        return rule_based

    # Optional LLM enhancement for query_intent and ambiguities
    try:
        schema_block = "\n".join(
            f"Table: {t['name']} | Columns: {', '.join(c['name'] for c in t['columns'])}"
            for t in relevant_tables
        )
        relations_block = "\n".join(join_paths[:10]) if join_paths else "None"

        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model,
            temperature=0,
            max_tokens=300,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": (
                    "You are a schema interpreter. Given a question and relevant tables/columns, "
                    "identify the query intent and any ambiguities. "
                    "Return JSON with: query_intent (one sentence), ambiguities (list of strings)."
                )},
                {"role": "user", "content": (
                    f"Question: {question}\n\nRelevant schema:\n{schema_block}\n\n"
                    f"Relationships:\n{relations_block}"
                )},
            ],
        )
        llm_result = json.loads(resp.choices[0].message.content)
        rule_based["query_intent"] = llm_result.get("query_intent", rule_based["query_intent"])
        rule_based["ambiguities"] = llm_result.get("ambiguities", ambiguities)
    except Exception:
        pass  # fall back to rule-based

    return rule_based


def build_query_explanation(semantic_model: dict) -> str:
    """Human-readable explanation of why tables/joins were chosen."""
    parts = []
    for t in semantic_model.get("relevant_tables", []):
        cols = ", ".join(c["name"] for c in t.get("columns", []))
        parts.append(f"Used '{t['name']}' ({t.get('why_chosen', '')}; columns: {cols})")
    joins = semantic_model.get("join_paths", [])
    if joins:
        parts.append("Joined via: " + "; ".join(joins[:3]))
    return ". ".join(parts) if parts else "Schema matched automatically."


def build_follow_up_suggestions(
    columns: list[str],
    rows: list[dict],
    has_prior_session: bool,
) -> list[str]:
    """Rule-based follow-up suggestion chips."""
    suggestions = []
    col_lower = [c.lower() for c in columns]

    # Show trends suggestion whenever there are numeric-looking columns
    numeric_hints = ("count", "total", "sum", "amount", "revenue", "sales", "qty", "quantity",
                     "value", "score", "rate", "price", "cost", "salary", "age", "number")
    time_hints = ("date", "time", "year", "month", "week", "day", "period", "quarter")
    has_time_col = any(any(h in c for h in time_hints) for c in col_lower)
    has_numeric_col = any(any(h in c for h in numeric_hints) for c in col_lower)

    if has_time_col or has_numeric_col or len(rows) >= 5:
        suggestions.append("Show trends over time")

    if len(rows) >= 20:
        suggestions.append("Detect anomalies")

    if has_prior_session:
        suggestions.append("Compare with previous results")

    if len(rows) >= 5:
        suggestions.append("Export as PPT")

    if "Summarize this dataset" not in suggestions:
        suggestions.append("Summarize this dataset")

    return suggestions[:5]
