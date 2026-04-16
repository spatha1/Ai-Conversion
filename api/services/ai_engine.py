"""
api/services/ai_engine.py

Centralized AI engine. All new Development-module code calls this instead of
making raw openai.chat.completions.create() calls inline.

Prompt template resolution:
  - Checks context.prompt_templates for a template matching the category
  - Falls back to built-in prompt text if none found

Every call auto-stores a trace via ai_trace.store().
"""
from __future__ import annotations

import json
import re
import time
from typing import Optional

from sqlalchemy.orm import Session

from api.config import settings
from api.services.context_cache import ContextPayload


# ── Helpers ────────────────────────────────────────────────────

def resolve_template_placeholders(content: str, context: ContextPayload) -> str:
    """
    Replace {{placeholder}} and legacy {placeholder} tokens in a template string
    with live values derived from the connection's context.

    Supported placeholders:
        {{schema}}          – full schema summary (tables + columns + FK relations + business context)
        {{table_list}}      – comma-separated table names
        {{query_examples}}  – formatted saved query examples for this connection
        {{query_context}}   – free-text query context for this connection
        {{metadata}}        – business metadata / column descriptions
        {{relations}}       – FK relationships only
    """
    if not content:
        return content

    # schema
    schema_text = _schema_summary(context)

    # table_list
    table_list = ", ".join(t["table"] for t in context.tables) if context.tables else "(no tables)"

    # query_examples
    if context.query_examples:
        ex_lines = ["\n## Query Examples\n"]
        for ex in context.query_examples:
            ex_lines.append(
                f"### {ex['name']}"
                + (f"\n{ex['description']}" if ex.get("description") else "")
            )
            if ex.get("tables_used"):
                ex_lines.append(f"Tables: {ex['tables_used']}")
            ex_lines.append(f"```sql\n{ex['example_sql'].strip()}\n```")
        query_examples_text = "\n".join(ex_lines)
    else:
        query_examples_text = "(no query examples saved)"

    # query_context
    query_context_text = context.query_context or "(no query context)"

    # metadata
    described = [
        m for m in context.metadata
        if m.get("description") and m.get("column_name") != "__table__"
    ][:20]
    if described:
        meta_lines = ["\n## Column Descriptions\n"]
        for m in described:
            name = f"{m['table_name']}.{m['column_name']}" if m.get("column_name") else m["table_name"]
            meta_lines.append(f"  {name}: {m['description']}")
        metadata_text = "\n".join(meta_lines)
    else:
        metadata_text = "(no metadata descriptions)"

    # relations
    if context.relations:
        rel_lines = ["\n## Relationships (FK)\n"]
        for r in context.relations[:30]:
            rel_lines.append(
                f"  {r['parent_table']}.{r['parent_column']} "
                f"→ {r['referenced_table']}.{r['referenced_column']}"
            )
        relations_text = "\n".join(rel_lines)
    else:
        relations_text = "(no FK relationships)"

    substitutions = {
        "schema":         schema_text,
        "table_list":     table_list,
        "query_examples": query_examples_text,
        "query_context":  query_context_text,
        "metadata":       metadata_text,
        "relations":      relations_text,
    }

    for key, value in substitutions.items():
        content = content.replace(f"{{{{{key}}}}}", value)   # {{key}}
        content = content.replace(f"{{{key}}}", value)       # {key} (legacy)

    return content


def _get_template(context: ContextPayload, category: str) -> Optional[str]:
    """Return custom prompt template content for a category, or None.
    Placeholders in the template are resolved against the current connection context."""
    for t in context.prompt_templates:
        if t.get("category") == category and t.get("content"):
            return resolve_template_placeholders(t["content"], context)
    return None


def _schema_summary(context: ContextPayload, max_tables: int = 40) -> str:
    """Build a concise schema string for inclusion in prompts."""
    lines = []
    for t in context.tables[:max_tables]:
        col_names = ", ".join(c["column"] for c in t["columns"][:20])
        lines.append(f"  {t['table']}({col_names})")

    if context.relations:
        lines.append("\nRelationships (FK):")
        for r in context.relations[:30]:
            lines.append(
                f"  {r['parent_table']}.{r['parent_column']} → "
                f"{r['referenced_table']}.{r['referenced_column']}"
            )

    if context.metadata:
        described = [m for m in context.metadata if m.get("description")][:10]
        if described:
            lines.append("\nBusiness Context:")
            for m in described:
                name = f"{m['table_name']}.{m['column_name']}" if m.get("column_name") else m["table_name"]
                lines.append(f"  {name}: {m['description']}")

    return "\n".join(lines)


def _openai_call(
    messages: list[dict],
    model: str,
    db: Session,
    module: str,
    conn_id: Optional[int],
    response_format: Optional[dict] = None,
) -> tuple[str, int, int, int]:
    """
    Make an OpenAI call and return (response_text, tokens_in, tokens_out, latency_ms).
    Stores trace automatically.
    """
    import openai

    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)

    kwargs: dict = {"model": model, "messages": messages, "temperature": 0.2}
    if response_format:
        kwargs["response_format"] = response_format

    t0 = time.monotonic()
    completion = client.chat.completions.create(**kwargs)
    latency_ms = int((time.monotonic() - t0) * 1000)

    response_text = completion.choices[0].message.content or ""
    tokens_in = completion.usage.prompt_tokens if completion.usage else 0
    tokens_out = completion.usage.completion_tokens if completion.usage else 0

    # Persist trace
    from api.services import ai_trace
    ai_trace.store(
        module=module,
        conn_id=conn_id,
        model=model,
        prompt=json.dumps(messages, ensure_ascii=False),
        response=response_text,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=latency_ms,
        db=db,
    )

    return response_text, tokens_in, tokens_out, latency_ms


def _extract_json(text: str) -> Optional[list | dict]:
    """Extract the first JSON array or object from a text that may contain markdown fences."""
    # Try fenced code block first
    fence = re.search(r"```(?:json)?\s*([\[{].*?)\s*```", text, re.DOTALL)
    if fence:
        try:
            return json.loads(fence.group(1))
        except json.JSONDecodeError:
            pass

    # Try bare JSON
    bare = re.search(r"([\[{].*[\]}])", text, re.DOTALL)
    if bare:
        try:
            return json.loads(bare.group(1))
        except json.JSONDecodeError:
            pass

    return None


def _extract_sql(text: str) -> str:
    """Extract SQL from a code fence or return the raw text."""
    fence = re.search(r"```(?:sql|tsql|mssql)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        return fence.group(1).strip()
    return text.strip()


# ── Public API ─────────────────────────────────────────────────

def plan(
    task: str,
    context: ContextPayload,
    model: str,
    db: Session,
) -> list[dict]:
    """
    Break a data engineering task into structured plan steps.
    Returns list of PlanStep dicts: {step_number, title, description, sql_type, depends_on}
    """
    schema_text = _schema_summary(context)

    # Allow prompt override from Admin templates
    custom = _get_template(context, "dev")
    if custom:
        system_prompt = custom
    else:
        system_prompt = (
            "You are an expert data engineer. Given a database schema and a task description, "
            "produce a JSON array of sequential steps needed to accomplish the task. "
            "Each step must have:\n"
            "  step_number (int, starting at 1)\n"
            "  title (string, ≤ 60 chars)\n"
            "  description (string, 1-2 sentences)\n"
            "  sql_type (one of: SELECT, INSERT, UPDATE, DELETE, CREATE_TABLE, "
            "STORED_PROCEDURE, DDL, SCRIPT)\n"
            "  depends_on (array of step_number integers this step requires first; "
            "[] if independent)\n\n"
            "Return ONLY the JSON array, no prose."
        )

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"Database schema:\n{schema_text}\n\n"
                f"Query context:\n{context.query_context}\n\n"
                f"Task: {task}"
            ),
        },
    ]

    response_text, _, _, _ = _openai_call(
        messages, model, db, module="development", conn_id=context.conn_id
    )

    parsed = _extract_json(response_text)
    if not isinstance(parsed, list):
        raise ValueError(f"AI returned unexpected plan format: {response_text[:300]}")

    # Normalise and validate each step
    steps = []
    for i, s in enumerate(parsed, start=1):
        steps.append({
            "step_number": s.get("step_number", i),
            "title": str(s.get("title", f"Step {i}"))[:100],
            "description": str(s.get("description", "")),
            "sql_type": str(s.get("sql_type", "SELECT")),
            "depends_on": s.get("depends_on") or [],
        })

    return steps


def generate_artifact(
    step: dict,
    context: ContextPayload,
    prior_sqls: list[str],
    model: str,
    db: Session,
) -> str:
    """
    Generate SQL or stored procedure code for a single plan step.
    Returns the raw SQL/DDL string.
    """
    schema_text = _schema_summary(context)
    prior_context = ""
    if prior_sqls:
        prior_context = "\n\nPreviously generated steps:\n" + "\n\n".join(
            f"-- Step {i+1}:\n{sql}" for i, sql in enumerate(prior_sqls)
        )

    sql_type = step.get("sql_type", "SELECT")
    description = step.get("description", "")
    title = step.get("title", "")

    system_prompt = (
        "You are an expert SQL developer. Generate clean, production-quality SQL for the "
        "given task. Use the database schema provided. Return ONLY the SQL code inside a "
        "```sql code fence. No explanations before or after."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"Database schema:\n{schema_text}"
                f"{prior_context}\n\n"
                f"Task step: {title}\n"
                f"Description: {description}\n"
                f"SQL type required: {sql_type}\n\n"
                f"Generate the {sql_type} statement."
            ),
        },
    ]

    response_text, _, _, _ = _openai_call(
        messages, model, db, module="development", conn_id=context.conn_id
    )

    return _extract_sql(response_text)


def explain(
    sql: str,
    context: ContextPayload,
    model: str,
    db: Session,
) -> str:
    """Return a plain-English explanation of a SQL query."""
    schema_text = _schema_summary(context)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful data analyst. Explain what the following SQL query does "
                "in plain English. Be concise (3-5 sentences). Reference table/column names "
                "from the schema context where relevant."
            ),
        },
        {
            "role": "user",
            "content": f"Schema:\n{schema_text}\n\nSQL:\n{sql}",
        },
    ]

    response_text, _, _, _ = _openai_call(
        messages, model, db, module="development", conn_id=context.conn_id
    )

    return response_text.strip()


def suggest_fix(
    error: str,
    sql: str,
    context: ContextPayload,
    model: str,
    db: Session,
) -> str:
    """
    Given an error message and the failing SQL, suggest a corrected query.
    Returns the corrected SQL string.
    """
    schema_text = _schema_summary(context)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a SQL debugging expert. Given a failing SQL query and its error "
                "message, return the corrected SQL inside a ```sql code fence. "
                "No explanations — only the fixed SQL."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Schema:\n{schema_text}\n\n"
                f"Failing SQL:\n{sql}\n\n"
                f"Error: {error}"
            ),
        },
    ]

    response_text, _, _, _ = _openai_call(
        messages, model, db, module="development", conn_id=context.conn_id
    )

    return _extract_sql(response_text)


def generate_dax_measures(
    widgets: list[dict],
    context: ContextPayload,
    model: str,
    db: Session,
) -> dict:
    """
    Generate Power BI DAX measures and dataset schema from dashboard widget SQL bindings.
    Returns {dax_measures: [...], dataset_schema: {...}, report_json: {...}}
    """
    schema_text = _schema_summary(context)
    widget_summary = json.dumps(
        [{"title": w.get("title"), "sql": w.get("dataBinding", {}).get("sql")} for w in widgets],
        indent=2,
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are a certified Power BI / DAX expert. Given dashboard widget SQL queries, "
                "generate a JSON object with:\n"
                "  dax_measures: array of {name, expression, description}\n"
                "  dataset_schema: {tables: [{name, columns: [{name, dataType}]}]}\n"
                "  report_json: a simplified Power BI report layout with sections and visualizations\n\n"
                "CRITICAL DAX RULES — violations will break Power BI:\n"
                "• DAX expressions MUST NOT contain SQL syntax: no GROUP BY, FROM, WHERE, JOIN, SELECT\n"
                "• Never use SQL functions YEAR(), MONTH() as standalone — use DAX equivalents\n"
                "• Aggregations: SUM(Table[Column]), AVERAGE(Table[Column]), COUNTROWS(Table)\n"
                "• Time grouping: CALCULATE(SUM(Table[Amount]), YEAR(Table[Date]) = 2024)\n"
                "• By-year trend: SUMMARIZE(Table, YEAR(Table[Date]), \"Total\", SUM(Table[Amount]))\n"
                "• By-month trend: SUMMARIZE(Table, MONTH(Table[Date]), \"Total\", SUM(Table[Amount]))\n"
                "• Time intelligence: TOTALYTD(SUM(Table[Amount]), Table[Date])\n"
                "• Filtering: CALCULATE(SUM(Table[Amount]), FILTER(Table, Table[Status] = \"Active\"))\n"
                "• Column references: Table[Column] or [MeasureName]\n"
                "• Each measure is a standalone DAX expression — NOT a query\n\n"
                "Return ONLY the JSON object inside a ```json code fence."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Database schema:\n{schema_text}\n\n"
                f"Dashboard widgets:\n{widget_summary}"
            ),
        },
    ]

    response_text, _, _, _ = _openai_call(
        messages, model, db, module="dashboard", conn_id=context.conn_id
    )

    parsed = _extract_json(response_text)
    if not isinstance(parsed, dict):
        return {"dax_measures": [], "dataset_schema": {"tables": []}, "report_json": {}}

    return parsed
