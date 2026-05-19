"""
services/embeddings.py
Embedding generation, cosine similarity, and SQL generation via OpenAI.
Uses the openai SDK (already in requirements.txt).
"""
from __future__ import annotations

import json
import math
from typing import Optional  # noqa: F401 — used in generate_sql signature

from api.services.pii_guard import mask_sample_values


# ── Embedding ────────────────────────────────────────────────────────────────

def get_embedding(text: str, api_key: str = "",
                  model: str = "text-embedding-3-small") -> list[float]:
    from api.services.ai_client import get_client_for_key, embedding_model
    client = get_client_for_key(api_key)
    resp = client.embeddings.create(input=text[:8000], model=embedding_model(model))
    return resp.data[0].embedding


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot   = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


# ── Column definition builder ────────────────────────────────────────────────

def build_column_definition(table_name: str, column_name: str,
                             data_type: str, is_pk: bool,
                             sample_values: list) -> str:
    pk_note    = " (primary key)" if is_pk else ""
    clean_vals = mask_sample_values(
        [v for v in sample_values if v is not None][:5],
        field_name=column_name,
    )
    sample_str = ", ".join(clean_vals)
    defn = (
        f"Column '{column_name}'{pk_note} in table '{table_name}'. "
        f"Data type: {data_type}."
    )
    if sample_str:
        defn += f" Sample values: {sample_str}."
    return defn


# ── SQL generation via OpenAI Chat ───────────────────────────────────────────

def generate_sql(question: str, matched_columns: list[dict],
                 dialect: str, api_key: str,
                 model: str = "gpt-4o-mini",
                 system_prompt: Optional[str] = None,
                 examples: Optional[list[dict]] = None) -> str:
    """
    Generate a SQL query from a natural language question + matched columns.
    matched_columns: list of dicts with table_schema, table_name, column_name,
                     data_type, column_definition, score.
    system_prompt: optional override — pass a query_skill prompt for richer context.
                   Falls back to a simple built-in prompt if not provided.
    examples: optional list of few-shot examples dicts with keys:
              name, tables_used, example_sql, description.
    """
    from openai import OpenAI

    # Build compact schema context grouped by table (appended to user message)
    tables: dict[str, list[str]] = {}
    for col in matched_columns:
        schema = col.get("table_schema") or "dbo"
        key    = f"{schema}.{col['table_name']}"
        tables.setdefault(key, []).append(
            f"  {col['column_name']} ({col.get('data_type') or 'unknown'})"
        )
    schema_block = "\n".join(
        f"Table {tbl}:\n" + "\n".join(cols)
        for tbl, cols in tables.items()
    )

    if not system_prompt:
        _DIALECT_HINTS = {
            "mssql":      "SQL Server (T-SQL)",
            "sql server": "SQL Server (T-SQL)",
            "postgresql": "PostgreSQL",
            "postgres":   "PostgreSQL",
            "mysql":      "MySQL",
            "sqlite":     "SQLite",
            "snowflake":  "Snowflake SQL",
        }
        db_hint = _DIALECT_HINTS.get(dialect.lower(), dialect.upper())

        _DIALECT_RULES = {
            "mssql": (
                " Follow these T-SQL rules strictly:"
                " (1) Never use ORDER BY inside a subquery or CTE unless you also include TOP or OFFSET…FETCH."
                " (2) For Nth-highest queries use: SELECT DISTINCT TOP 1 col FROM (SELECT DISTINCT TOP N col FROM tbl ORDER BY col DESC) sub ORDER BY col ASC."
                " (3) Never use ROWNUM or LIMIT — use TOP instead."
                " (4) Use GETDATE() not NOW(), ISNULL() not IFNULL()."
            ),
            "sql server": (
                " Follow these T-SQL rules strictly:"
                " (1) Never use ORDER BY inside a subquery or CTE unless you also include TOP or OFFSET…FETCH."
                " (2) For Nth-highest queries use: SELECT DISTINCT TOP 1 col FROM (SELECT DISTINCT TOP N col FROM tbl ORDER BY col DESC) sub ORDER BY col ASC."
                " (3) Never use ROWNUM or LIMIT — use TOP instead."
                " (4) Use GETDATE() not NOW(), ISNULL() not IFNULL()."
            ),
            "postgresql": (
                " Use PostgreSQL syntax: LIMIT/OFFSET for pagination, ILIKE for case-insensitive search,"
                " NOW() for current timestamp, COALESCE() for nulls."
            ),
            "mysql": (
                " Use MySQL syntax: LIMIT for pagination, IFNULL() not ISNULL(), NOW() for current timestamp."
            ),
            "snowflake": (
                " Use Snowflake SQL syntax: LIMIT/OFFSET for pagination, QUALIFY for window function filtering,"
                " IFF() for inline conditionals, CURRENT_TIMESTAMP() for current time."
                " Do not use T-SQL TOP or ROWNUM."
            ),
        }
        extra_rules = _DIALECT_RULES.get(dialect.lower(), "")

        system_prompt = (
            f"You are a {db_hint} SQL expert.{extra_rules} "
            "Write a single SQL query that answers the user's question using ONLY "
            "the tables and columns provided. "
            "Return ONLY the raw SQL statement — no explanation, no markdown fences."
        )

    # Build few-shot examples block if provided
    examples_block = ""
    if examples:
        lines = ["EXAMPLE QUERIES — use these as reference for correct table/column names and query style:"]
        for i, ex in enumerate(examples, 1):
            lines.append(f"\n[{i}] {ex.get('name', 'Example')}")
            if ex.get("description"):
                lines.append(f"    Purpose: {ex['description']}")
            if ex.get("tables_used"):
                lines.append(f"    Tables:  {ex['tables_used']}")
            lines.append(f"    SQL:     {ex['example_sql']}")
        examples_block = "\n".join(lines) + "\n\n"

    user_prompt = (
        f"{examples_block}"
        f"Top matched columns (by semantic similarity):\n{schema_block}\n\n"
        f"Question: {question}"
    )

    from api.services.ai_client import get_client_for_key, chat_model as _chat_model
    client   = get_client_for_key(api_key)
    response = client.chat.completions.create(
        model=_chat_model(model),
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        temperature=0,
        max_tokens=800,
    )
    return response.choices[0].message.content.strip()
