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
from api.services.dialect_utils import get_dialect, dialect_label_rules


# ── Helpers ────────────────────────────────────────────────────

def resolve_template_placeholders(
    content: str,
    context: ContextPayload,
    db: Optional[Session] = None,
) -> str:
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
        {{dialect}}         – human-readable dialect label (e.g. "Microsoft SQL Server / T-SQL")
        {{dialect_rules}}   – dialect-specific SQL syntax rules block
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

    # dialect placeholders — require db to look up connection
    dialect_label, dialect_rules = ("", "")
    if db is not None and context.conn_id:
        try:
            dialect_label, dialect_rules = _dialect_instructions(context.conn_id, db)
        except Exception:
            pass

    substitutions = {
        "schema":         schema_text,
        "table_list":     table_list,
        "query_examples": query_examples_text,
        "query_context":  query_context_text,
        "metadata":       metadata_text,
        "relations":      relations_text,
        "dialect":        dialect_label,
        "dialect_rules":  dialect_rules,
    }

    for key, value in substitutions.items():
        content = content.replace(f"{{{{{key}}}}}", value)   # {{key}}
        content = content.replace(f"{{{key}}}", value)       # {key} (legacy)

    return content


def _get_template(context: ContextPayload, category: str, db: Optional[Session] = None) -> Optional[str]:
    """Return custom prompt template content for a category, or None.
    Placeholders in the template are resolved against the current connection context."""
    for t in context.prompt_templates:
        if t.get("category") == category and t.get("content"):
            return resolve_template_placeholders(t["content"], context, db=db)
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
    *,
    session=None,   # Optional[DebugSession] — avoids circular import at module level
) -> tuple[str, int, int, int]:
    """
    Make an OpenAI call and return (response_text, tokens_in, tokens_out, latency_ms).
    Stores trace automatically. When session is provided, appends an llm_call debug step.
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

    # Debug step — captures the full LLM exchange
    if session is not None:
        session.add_step(
            step="llm_call",
            label="LLM Call",
            input_data={
                "model": model,
                "temperature": 0.2,
                "tokens_in": tokens_in,
                "system_prompt": messages[0]["content"] if messages else "",
                "user_prompt": messages[1]["content"] if len(messages) > 1 else "",
            },
            output_data={
                "tokens_out": tokens_out,
                "response": response_text,
            },
            duration_ms=latency_ms,
        )

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
    *,
    session=None,   # Optional[DebugSession]
) -> list[dict]:
    """
    Break a data engineering task into structured plan steps.
    Returns list of PlanStep dicts: {step_number, title, description, sql_type, depends_on}
    """
    # ── debug step 1: context assembly ────────────────────────
    t_ctx = time.monotonic()
    schema_text = _schema_summary(context)
    if session is not None:
        session.add_step(
            step="context_assembly",
            label="Context Assembly",
            input_data={"conn_id": context.conn_id, "task_preview": task[:200]},
            output_data={
                "tables_loaded": len(context.tables),
                "relations_loaded": len(context.relations),
                "metadata_entries": len(context.metadata),
                "query_examples": len(context.query_examples),
                "has_query_context": bool(context.query_context),
                "prompt_templates_available": len(context.prompt_templates),
                "schema_preview": schema_text[:500],
            },
            duration_ms=int((time.monotonic() - t_ctx) * 1000),
        )

    _STEP_FORMAT = (
        '[\n'
        '  {"step_number": 1, "title": "Create DIM table", "description": "Create the dimension table with SCD columns.", '
        '"sql_type": "CREATE_TABLE", "depends_on": []},\n'
        '  {"step_number": 2, "title": "Create FACT table", "description": "Create fact table referencing DIM.", '
        '"sql_type": "CREATE_TABLE", "depends_on": [1]}\n'
        ']'
    )

    # Use "dev_plan" category specifically — avoids picking up documentation/requirements
    # templates that share the "dev" category but are not AI system prompts.
    custom = _get_template(context, "dev_plan", db=db)

    # ── debug step 2: prompt template lookup ──────────────────
    if session is not None:
        tmpl_meta = None
        if custom:
            for t in context.prompt_templates:
                if t.get("category") == "dev_plan":
                    tmpl_meta = {"category": "dev_plan", "name": t.get("name", "custom")}
                    break
            if not tmpl_meta:
                tmpl_meta = {"category": "dev_plan", "name": "custom (unnamed)"}
        session.add_step(
            step="prompt_template_lookup",
            label="Prompt Template Lookup",
            input_data={"category": "dev_plan"},
            output_data={"found": custom is not None},
            template_used=tmpl_meta,
        )

    if custom:
        system_prompt = (
            custom.rstrip()
            + f"\n\nIMPORTANT: Return ONLY a raw JSON array (no markdown, no prose) using this structure:\n{_STEP_FORMAT}"
        )
    else:
        system_prompt = (
            "You are an expert data engineer. Break the task into sequential implementation steps.\n\n"
            f"Return ONLY a raw JSON array — no markdown fences, no explanation — exactly like:\n{_STEP_FORMAT}\n\n"
            "sql_type must be one of: SELECT, INSERT, UPDATE, DELETE, CREATE_TABLE, STORED_PROCEDURE, DDL, SCRIPT\n\n"
            "SQL quality rules (enforce for every step that produces SQL):\n"
            "- Define the grain of the model explicitly\n"
            "- Do NOT mix row-level IDs with aggregated metrics\n"
            "- Aggregations must align with grouping level\n"
            "- Avoid grouping by primary key when calculating counts\n"
            "Step ordering rules for INSERT steps:\n"
            "- Parent/dimension tables must be populated in earlier steps than child/fact tables\n"
            "- Each INSERT step must declare depends_on the step that populates its parent table\n"
            "- INSERT into fact tables must come AFTER all dimension INSERT steps\n"
            "- Every INSERT step will use WHERE NOT EXISTS and INNER JOIN FK guards (do not plan a separate 'validate' step for this — it is built into the INSERT)"
        )

    dialect_label, dialect_rules = _dialect_instructions(context.conn_id, db)

    # Append dialect rules to system prompt so step descriptions use correct syntax hints
    system_prompt = system_prompt.rstrip() + f"\n\nTarget database: {dialect_label}\n{dialect_rules}"

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"Target database: {dialect_label}\n"
                f"Database schema:\n{schema_text}\n\n"
                f"Query context:\n{context.query_context}\n\n"
                f"Task: {task}"
            ),
        },
    ]

    # ── debug step 3: prompt construction ────────────────────
    if session is not None:
        session.add_step(
            step="prompt_construction",
            label="Prompt Construction",
            input_data={
                "dialect": dialect_label,
                "tables_count": len(context.tables),
                "task": task[:300],
            },
            output_data={
                "system_prompt": system_prompt,
                "user_prompt": messages[1]["content"],
            },
        )

    # ── LLM call (step 4 added inside _openai_call) ──────────
    response_text, _, _, _ = _openai_call(
        messages, model, db, module="development", conn_id=context.conn_id,
        session=session,
    )

    parsed = _extract_json(response_text)

    # ── debug step 5: response parsing ────────────────────────
    if session is not None:
        session.add_step(
            step="response_parsing",
            label="Response Parsing",
            input_data={"raw_response_length": len(response_text)},
            output_data={
                "parsed_type": type(parsed).__name__,
                "parse_error": parsed is None,
                "response_preview": response_text[:500],
            },
        )

    # Unwrap {"steps": [...]} or similar envelope
    if isinstance(parsed, dict):
        for key in ("steps", "plan", "items", "results", "criteria"):
            if isinstance(parsed.get(key), list):
                parsed = parsed[key]
                break
        else:
            if parsed.get("step_number") or parsed.get("title"):
                parsed = [parsed]

    if not isinstance(parsed, list) or not parsed:
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


def _dialect_instructions(conn_id: int, db: Session) -> tuple[str, str]:
    """Return (dialect_label, sql_rules) for the connection's database engine."""
    return dialect_label_rules(get_dialect(conn_id, db))


def _fk_summary(context: ContextPayload) -> str:
    """Return FK relationships as concrete table.col → table.col lines."""
    if not context.relations:
        return ""
    lines = ["Known foreign key relationships (use these for INNER JOIN guards):"]
    for r in context.relations[:40]:
        lines.append(
            f"  {r['parent_table']}.{r['parent_column']} → {r['referenced_table']}.{r['referenced_column']}"
        )
    return "\n".join(lines)


def _add_fk_guards(sql: str, context: ContextPayload, model: str, db: Session,
                   dialect_label: str, sql_type: str) -> str:
    """
    Post-generation pass: if the SQL contains an INSERT without a WHERE NOT EXISTS
    guard, ask the AI to add the missing guards rather than re-generating from scratch.
    """
    import re
    sql_upper = sql.upper()
    has_insert = "INSERT" in sql_upper
    has_guard  = "NOT EXISTS" in sql_upper or ("INNER JOIN" in sql_upper and "INSERT" in sql_upper)

    if not has_insert or has_guard:
        return sql   # already correct, or no INSERT at all

    fk_text = _fk_summary(context)
    messages = [
        {
            "role": "system",
            "content": (
                f"You are an expert {dialect_label} developer.\n"
                "Your ONLY job is to add missing safety guards to the given SQL.\n"
                "Do NOT change the logic or table/column names.\n"
                "Return ONLY the corrected SQL inside a ```sql code fence.\n\n"
                "Guards required:\n"
                "1. Add WHERE NOT EXISTS (...) to every INSERT that is missing it.\n"
                "   Use the primary key or natural key columns for the NOT EXISTS check.\n"
                "2. Add INNER JOIN for every FK column that is not already joined.\n"
                "   Use the FK relationships listed below.\n"
                "3. NEVER use LEFT JOIN for FK enforcement — always INNER JOIN.\n\n"
                + fk_text
            ),
        },
        {
            "role": "user",
            "content": (
                f"Add WHERE NOT EXISTS and INNER JOIN FK guards to this SQL:\n\n"
                f"```sql\n{sql}\n```"
            ),
        },
    ]

    fixed_text, _, _, _ = _openai_call(
        messages, model, db, module="development", conn_id=context.conn_id
    )
    fixed = _extract_sql(fixed_text)
    return fixed if fixed.strip() else sql


def generate_artifact(
    step: dict,
    context: ContextPayload,
    prior_sqls: list[str],
    model: str,
    db: Session,
    *,
    session=None,   # Optional[DebugSession]
) -> str:
    """
    Generate SQL or stored procedure code for a single plan step.
    Returns the raw SQL/DDL string.
    """
    # ── debug step 1: context assembly ────────────────────────
    t_ctx = time.monotonic()
    schema_text = _schema_summary(context)
    fk_text     = _fk_summary(context)
    if session is not None:
        session.add_step(
            step="context_assembly",
            label="Context Assembly",
            input_data={
                "conn_id": context.conn_id,
                "step_title": step.get("title", ""),
                "sql_type": step.get("sql_type", ""),
                "prior_sqls_count": len(prior_sqls),
            },
            output_data={
                "tables_loaded": len(context.tables),
                "relations_loaded": len(context.relations),
                "fk_relations_found": len(context.relations),
                "schema_preview": schema_text[:300],
            },
            duration_ms=int((time.monotonic() - t_ctx) * 1000),
        )

    prior_context = ""
    if prior_sqls:
        prior_context = "\n\nPreviously generated steps:\n" + "\n\n".join(
            f"-- Step {i+1}:\n{sql}" for i, sql in enumerate(prior_sqls)
        )

    sql_type    = step.get("sql_type", "SELECT")
    description = step.get("description", "")
    title       = step.get("title", "")

    dialect_label, dialect_rules = _dialect_instructions(context.conn_id, db)

    is_write_step = sql_type in ("INSERT", "UPDATE", "SCRIPT", "STORED_PROCEDURE", "DDL")

    insert_rules = ""
    if is_write_step:
        insert_rules = (
            f"\n\n"
            f"=== MANDATORY RULES FOR THIS {sql_type} — DO NOT SKIP ===\n\n"
            f"RULE 1 — WHERE NOT EXISTS on every INSERT\n"
            f"Every INSERT...SELECT must end with:\n"
            f"  WHERE NOT EXISTS (\n"
            f"      SELECT 1 FROM <target_table> t\n"
            f"      WHERE t.<pk_col> = s.<pk_col>\n"
            f"  )\n\n"
            f"RULE 2 — INNER JOIN for every FK column\n"
            f"For every FK column being inserted, INNER JOIN the parent table so\n"
            f"rows that violate the FK are automatically excluded.\n"
            f"Use the FK relationships below to identify which joins are needed.\n\n"
            f"RULE 3 — For fact table inserts, join ALL dimension tables\n"
            f"Do not insert a fact row if any dimension FK cannot be resolved.\n\n"
            f"These are the actual FK relationships in this database:\n"
            f"{fk_text}\n\n"
            f"Example of a correct INSERT using these rules:\n"
            f"  INSERT INTO child_table (parent_id, col_a)\n"
            f"  SELECT s.parent_id, s.col_a\n"
            f"  FROM source_table s\n"
            f"  INNER JOIN parent_table p ON p.id = s.parent_id   -- FK guard\n"
            f"  WHERE NOT EXISTS (\n"
            f"      SELECT 1 FROM child_table t\n"
            f"      WHERE t.parent_id = s.parent_id AND t.col_a = s.col_a\n"
            f"  )\n"
        )

    # ── debug step 2: prompt template lookup ──────────────────
    custom_dev = _get_template(context, "dev", db=db)
    if session is not None:
        tmpl_meta = None
        if custom_dev:
            for t in context.prompt_templates:
                if t.get("category") == "dev":
                    tmpl_meta = {"category": "dev", "name": t.get("name", "custom")}
                    break
            if not tmpl_meta:
                tmpl_meta = {"category": "dev", "name": "custom (unnamed)"}
        session.add_step(
            step="prompt_template_lookup",
            label="Prompt Template Lookup",
            input_data={"category": "dev"},
            output_data={"found": custom_dev is not None},
            template_used=tmpl_meta,
        )

    system_prompt = (
        f"You are an expert {dialect_label} developer. "
        "Generate clean, production-quality SQL for the given task. "
        "Use the database schema and FK relationships provided. "
        "Return ONLY the SQL code inside a ```sql code fence. No explanations before or after.\n\n"
        + dialect_rules
        + "\n\nSQL quality rules:\n"
        "- Define the grain of the model explicitly\n"
        "- Do NOT mix row-level IDs with aggregated metrics\n"
        "- Aggregations must align with grouping level\n"
        "- Avoid grouping by primary key when calculating counts"
        + insert_rules
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"Target database: {dialect_label}\n"
                f"Database schema:\n{schema_text}\n\n"
                + (f"{fk_text}\n\n" if fk_text else "")
                + f"{prior_context}\n\n"
                f"Task step: {title}\n"
                f"Description: {description}\n"
                f"SQL type required: {sql_type}\n\n"
                f"Generate the {sql_type} statement using {dialect_label} syntax only."
            ),
        },
    ]

    # ── debug step 3: prompt construction ────────────────────
    if session is not None:
        session.add_step(
            step="prompt_construction",
            label="Prompt Construction",
            input_data={
                "dialect": dialect_label,
                "step_title": title,
                "sql_type": sql_type,
                "is_write_step": is_write_step,
            },
            output_data={
                "system_prompt": system_prompt,
                "user_prompt": messages[1]["content"],
            },
        )

    # ── LLM call (step 4 added inside _openai_call) ──────────
    response_text, _, _, _ = _openai_call(
        messages, model, db, module="development", conn_id=context.conn_id,
        session=session,
    )

    sql = _extract_sql(response_text)

    # ── debug step 5: response parsing ────────────────────────
    if session is not None:
        session.add_step(
            step="response_parsing",
            label="Response Parsing",
            input_data={"raw_response_length": len(response_text)},
            output_data={
                "extracted_sql_preview": sql[:500],
                "sql_length": len(sql),
                "is_write_step": is_write_step,
            },
        )

    # Post-generation safety pass: add missing NOT EXISTS / FK INNER JOIN guards
    if is_write_step:
        sql = _add_fk_guards(sql, context, model, db, dialect_label, sql_type)

    return sql


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
