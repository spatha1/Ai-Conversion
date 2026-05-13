"""
agentic_orchestrator.py — A2A (Agent-to-Agent) workflow runner.

Key concepts:
  - Agent  = named employee (Sai, Chand) with a Role and tool grants
  - Role   = job template (Developer, Manager, PMO) — drives behaviour
  - Card   = workflow step — assigns a named Agent to a position in the pipeline
  - Tools  = IT access per agent: db, query_examples, business_rules, api, jira,
             test_cases, email, reports, development, dashboards, testing

Module tools allow agents to actually EXECUTE work inside Clarity Studio modules:
  - reports     → RUN_REPORT: run a natural-language SQL report
  - development → CREATE_DEV_PLAN: create a SQL development plan
  - dashboards  → (describe capability; agent outputs structured config)
  - testing     → GENERATE_TESTS: generate test cases from a description

After each LLM response, the orchestrator parses action tags, executes them,
and appends the real results back into the step output.

Execution loop:
  Cards run in execution_order. If a card outputs [DECISION: REJECT] or [DECISION: REVISE],
  the engine jumps back to on_reject_card_id and re-runs from there, injecting
  the feedback as additional context. Loops are capped at card.max_iterations.
"""
from __future__ import annotations

import json
import re
import time
from collections import defaultdict
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from api.config import settings


# ── Available tools ───────────────────────────────────────────────────────────

TOOL_LABELS = {
    # Context / knowledge tools
    "db":              "Database (schema, tables, columns, FK relations)",
    "query_examples":  "Query Examples library",
    "business_rules":  "Business Rules & Query Context",
    "api":             "REST API Collection",
    "jira":            "JIRA Integration (read/create tickets)",
    "test_cases":      "Test Cases & Validation Rules",
    "email":           "Email (send notifications)",
    # Module execution tools — agent actually runs work inside the platform
    "reports":         "Reports Module (run NL→SQL reports from requirements)",
    "development":     "Development Module (create SQL dev plans from requirements)",
    "dashboards":      "Dashboards Module (design analytics dashboards)",
    "testing":         "Testing Module (generate and run automated test cases)",
    "sql_exec":        "SQL Executor (run SELECT queries against the live database)",
}

# Tool categories for UI grouping
CONTEXT_TOOLS = ["db", "query_examples", "business_rules", "api", "jira", "test_cases", "email"]
MODULE_TOOLS  = ["reports", "development", "dashboards", "testing", "sql_exec"]

ALL_TOOLS = list(TOOL_LABELS.keys())

# Pricing per 1k tokens (input, output) — used for cost tracking
COST_PER_1K: dict[str, tuple[float, float]] = {
    "gpt-4o-mini": (0.00015, 0.0006),
    "gpt-4o":      (0.005,   0.015),
    "o1-mini":     (0.003,   0.012),
    "o1":          (0.015,   0.060),
}


# ── Capability helpers ────────────────────────────────────────────────────────

def _compute_effective_tools(agent, role) -> list[str]:
    """Merge role.tools_json ∪ agent.tools_json, subtract role.restricted_tools_json.
    Returns [] when both are null — backward-compatible with existing agents."""
    try:
        role_tools = json.loads(role.tools_json) if (role and getattr(role, "tools_json", None)) else []
    except Exception:
        role_tools = []
    try:
        agent_tools = json.loads(agent.tools_json) if (agent and getattr(agent, "tools_json", None)) else []
    except Exception:
        agent_tools = []
    try:
        restricted = json.loads(role.restricted_tools_json) if (role and getattr(role, "restricted_tools_json", None)) else []
    except Exception:
        restricted = []
    merged = list({*role_tools, *agent_tools})
    return [t for t in merged if t not in restricted]


def _build_kb_filter(role) -> dict:
    """Parse role.knowledge_access_json → {op_categories, systems, entry_types}."""
    if not role or not getattr(role, "knowledge_access_json", None):
        return {}
    try:
        return json.loads(role.knowledge_access_json) or {}
    except Exception:
        return {}


def _compute_sql_metrics(columns: list, rows: list) -> dict:
    """Compute null rates, numeric stats, and first-column duplicate count from query results."""
    if not rows:
        return {"row_count": 0, "null_rates": {}, "numeric_stats": {}, "duplicates": {}}
    row_count = len(rows)
    null_rates = {
        col: round(sum(1 for r in rows if r.get(col) is None) / row_count * 100, 1)
        for col in columns
    }
    numeric_stats: dict = {}
    for col in columns:
        vals = [r[col] for r in rows if isinstance(r.get(col), (int, float))]
        if vals:
            numeric_stats[col] = {"min": min(vals), "max": max(vals), "avg": round(sum(vals) / len(vals), 2)}
    duplicates: dict = {}
    if columns:
        id_col   = columns[0]
        all_vals = [str(r[id_col]) for r in rows if r.get(id_col) is not None]
        dup_cnt  = len(all_vals) - len(set(all_vals))
        if dup_cnt > 0:
            duplicates[id_col] = dup_cnt
    return {"row_count": row_count, "null_rates": null_rates, "numeric_stats": numeric_stats, "duplicates": duplicates}


# ── Self-healing execution helpers ────────────────────────────────────────────

_SQL_ERROR_PATTERNS: dict[str, list[str]] = {
    "OBJECT_NOT_FOUND":   ["invalid object name", "object not found", "does not exist", "no such table"],
    "COLUMN_NOT_FOUND":   ["invalid column name", "unknown column", "ambiguous column"],
    "SYNTAX_ERROR":       ["syntax error", "incorrect syntax", "parse error", "unexpected token"],
    "PERMISSION_DENIED":  ["permission denied", "access denied", "not authorized", "execute access"],
    "DATA_TYPE_ERROR":    ["cannot implicitly convert", "data type", "type mismatch", "overflow"],
    "TIMEOUT":            ["timeout", "timed out", "query execution time exceeded"],
    "CONNECTION_FAILURE": ["cannot connect", "connection refused", "server not found", "network"],
}


def _classify_sql_error(exc_str: str) -> str:
    s = exc_str.lower()
    for category, patterns in _SQL_ERROR_PATTERNS.items():
        if any(p in s for p in patterns):
            return category
    return "UNKNOWN"


_PLACEHOLDER_RE = re.compile(
    r'\[Result from \w[\w\s]*\]'
    r'|\[X\]|\[Y\]|\[N\]|\[TBD\]'
    r'|\bpending execution\b'
    r'|\bto be filled\b'
    r'|\[estimated\]'
    r'|\bhypothetical result\b'
    r'|\b\d+ rows expected\b',
    re.IGNORECASE,
)


def _detect_placeholders(text: str) -> list[str]:
    """Return a list of found placeholder patterns in text."""
    return [m.group() for m in _PLACEHOLDER_RE.finditer(text)]


def _has_execution_evidence(shared_memory: Optional[list]) -> bool:
    """True if any SQL execution result MEMO exists in shared_memory."""
    if not shared_memory:
        return False
    return any(m.get("system") == "SQLExec" for m in shared_memory)


def _parse_memos_from_output(output_text: str, role_name: str, step_number: int) -> list[dict]:
    """Extract [MEMO: {...}] tags from output_text and return enriched entries."""
    entries: list[dict] = []
    for m in re.finditer(r'\[MEMO:\s*(\{[^}]+\})\]', output_text, re.IGNORECASE):
        try:
            entry = json.loads(m.group(1))
            entry.setdefault("written_by", role_name)
            entry.setdefault("written_at_step", step_number)
            entries.append(entry)
        except Exception:
            pass
    return entries


def _suggest_object_fix(raw_sql: str, conn_id: int, db: Session) -> Optional[str]:
    """For OBJECT_NOT_FOUND errors: substitute table references with closest known schema names."""
    try:
        import re as _re
        from api.services.context_cache import get_or_build
        ctx = get_or_build(conn_id, db)
        if not ctx or not ctx.tables:
            return None
        # Build lowercase → canonical lookup
        known: dict[str, str] = {}
        for t in ctx.tables:
            tname = t.get("table") or t.get("table_name") or ""
            if tname:
                known[tname.lower()] = tname
        if not known:
            return None
        # Find table refs in FROM / JOIN clauses
        refs = _re.findall(r'(?:FROM|JOIN)\s+(\[?[\w\.]+\]?)', raw_sql, _re.IGNORECASE)
        fixed = raw_sql
        changed = False
        for ref in refs:
            base = ref.strip("[]\"'`").split(".")[-1].strip("[]\"'`")
            base_l = base.lower()
            if base_l in known:
                continue  # already valid
            # Prefer prefix/substring match; require at least 4-char overlap to avoid false positives
            candidates = [
                v for k, v in known.items()
                if len(base_l) >= 4 and (k.startswith(base_l[:4]) or base_l.startswith(k[:4])
                    or base_l in k or k in base_l)
            ]
            if len(candidates) == 1:
                fixed = _re.sub(r'\b' + _re.escape(ref) + r'\b', candidates[0], fixed, flags=_re.IGNORECASE)
                changed = True
        return fixed if changed else None
    except Exception:
        return None


# ── Context builders (per tool) ───────────────────────────────────────────────

def _tool_db(ctx) -> str:
    """Full schema: tables, columns (with data types), FK relations, metadata descriptions."""
    lines = ["### Database Schema"]
    for t in (ctx.tables or [])[:30]:
        tname = t.get("table", t.get("table_name", ""))
        cols  = t.get("columns", [])
        col_str = ", ".join(
            f"{c.get('column', c.get('column_name', ''))} ({c.get('data_type', '')})"
            for c in cols[:20]
        )
        lines.append(f"  {tname}: {col_str}")

    if ctx.relations:
        lines.append("\n### Foreign Key Relations")
        for r in ctx.relations[:20]:
            lines.append(
                f"  {r['parent_table']}.{r['parent_column']} → "
                f"{r['referenced_table']}.{r['referenced_column']}"
            )

    if ctx.metadata:
        lines.append("\n### Column Descriptions")
        for m in ctx.metadata[:30]:
            desc = m.get("description") or m.get("business_context")
            if desc:
                col  = f".{m['column_name']}" if m.get("column_name") else ""
                lines.append(f"  {m['table_name']}{col}: {desc}")

    return "\n".join(lines)


def _tool_query_examples(ctx) -> str:
    if not ctx.query_examples:
        return ""
    lines = ["### Query Examples (follow these patterns)"]
    for ex in ctx.query_examples[:10]:
        lines.append(f"\n-- {ex.get('name', '')} ({ex.get('tables_used', '')})")
        if ex.get("description"):
            lines.append(f"-- {ex['description']}")
        lines.append(ex.get("example_sql", ""))
    return "\n".join(lines)


def _tool_business_rules(ctx) -> str:
    if not ctx.query_context:
        return ""
    return f"### Business Rules & Context\n{ctx.query_context}"


def _tool_api(db: Session) -> str:
    try:
        from api.models import PsApiEntry
        entries = db.query(PsApiEntry).filter(PsApiEntry.is_active == True).limit(20).all()  # noqa: E712
        if not entries:
            return ""
        lines = ["### Available REST API Endpoints"]
        for e in entries:
            lines.append(f"  [{e.method}] {e.name} — {e.description or ''}")
            lines.append(f"    URL: {e.url}")
            if e.required_fields:
                lines.append(f"    Required fields: {e.required_fields}")
        return "\n".join(lines)
    except Exception:
        return ""


def _tool_jira(conn_id: Optional[int], db: Session) -> str:
    try:
        from api.models import ExternalIntegration
        jira = db.query(ExternalIntegration).filter(
            ExternalIntegration.type == "jira",
        ).first()
        if not jira:
            return ""
        lines = [
            "### JIRA Integration",
            f"  Base URL: {jira.base_url}",
            f"  Username: {jira.username}",
            "  You can reference JIRA ticket keys (e.g. PROJ-123) in your output.",
            "  To create a ticket, output a JSON block: ```jira-create { title, description, type, assignee }```",
        ]
        return "\n".join(lines)
    except Exception:
        return ""


def _tool_test_cases(db: Session) -> str:
    try:
        from api.models import AITestCase
        cases = db.query(AITestCase).limit(15).all()
        if not cases:
            return ""
        lines = ["### Test Cases & Validation Rules"]
        for tc in cases:
            lines.append(f"  [{tc.validation_type.upper()}] {tc.name}")
            if tc.source_query:
                lines.append(f"    Source SQL: {tc.source_query[:120]}...")
        return "\n".join(lines)
    except Exception:
        return ""


def _tool_reports_ctx(conn_id: Optional[int]) -> str:
    if not conn_id:
        return ""
    return (
        "### MANDATORY — Reports Module\n"
        "You MUST run at least one live SQL report as part of your work. Do NOT just describe what "
        "you would query — actually trigger it using this exact tag in your response:\n"
        "  [RUN_REPORT: <plain English question about the data>]\n"
        "The system will execute the SQL and return real results to you.\n"
        "Good examples:\n"
        "  [RUN_REPORT: Total premium by policy type for last quarter]\n"
        "  [RUN_REPORT: Count of claims rejected in the last 30 days]\n"
        "  [RUN_REPORT: Top 10 policies by premium amount]\n"
        "IMPORTANT: Use a database-relevant question, not a JIRA or API question. "
        "The Reports module queries your SQL database only."
    )


def _tool_development_ctx(conn_id: Optional[int]) -> str:
    if not conn_id:
        return ""
    return (
        "### MANDATORY — Development Module\n"
        "You MUST create a formal SQL development plan for any SQL/stored-procedure work. "
        "Do NOT just write SQL in your text — trigger the Development module using this exact tag:\n"
        "  [CREATE_DEV_PLAN: <description of the SQL task to build>]\n"
        "The system will generate and save a structured multi-step plan.\n"
        "Good examples:\n"
        "  [CREATE_DEV_PLAN: Create stored procedure to aggregate claims by region and month]\n"
        "  [CREATE_DEV_PLAN: Build ETL script to load premium data into summary table]\n"
        "  [CREATE_DEV_PLAN: Generate view joining policies and claims for reconciliation]"
    )


def _tool_dashboards_ctx(conn_id: Optional[int]) -> str:
    if not conn_id:
        return ""
    return (
        "### MANDATORY — Dashboards Module\n"
        "You MUST generate a live analytics dashboard as part of your deliverable. "
        "Do NOT describe a dashboard in words — trigger it using this exact tag:\n"
        "  [DESIGN_DASHBOARD: <what to visualise and analyse>]\n"
        "The system will generate and save a real dashboard with charts and KPIs.\n"
        "Good examples:\n"
        "  [DESIGN_DASHBOARD: Claims rejection rates by month and category]\n"
        "  [DESIGN_DASHBOARD: Premium mismatch between source and target by policy type]\n"
        "  [DESIGN_DASHBOARD: Executive summary of conversion run outcomes]"
    )


def _tool_testing_ctx(conn_id: Optional[int]) -> str:
    if not conn_id:
        return ""
    return (
        "### MANDATORY — Testing Module\n"
        "You MUST generate automated test cases to validate the data. "
        "Do NOT list checks in plain text — trigger the Testing module using this exact tag:\n"
        "  [GENERATE_TESTS: <description of what data quality to validate>]\n"
        "The system will create and save real executable test cases.\n"
        "Good examples:\n"
        "  [GENERATE_TESTS: Validate total premium matches between source and target tables]\n"
        "  [GENERATE_TESTS: Check for duplicate policy records in the converted output]\n"
        "  [GENERATE_TESTS: Verify no null values in mandatory fields after conversion]"
    )


def _tool_sql_exec_ctx(conn_id: Optional[int], db=None) -> str:
    if not conn_id:
        return ""

    # Pull known table names from schema catalog to prevent hallucinated names
    table_hint = ""
    if db:
        try:
            from api.models import CatalogColumn as _CC
            tbl_rows = (
                db.query(_CC.table_name)
                .filter(_CC.conn_id == conn_id)
                .distinct()
                .limit(25)
                .all()
            )
            if tbl_rows:
                tbl_list = ", ".join(f"`{r[0]}`" for r in tbl_rows)
                table_hint = (
                    f"\n**Known tables (use ONLY these names):** {tbl_list}\n"
                    "Do NOT guess or invent table names — if a table isn't listed, say so instead of writing a query for it.\n"
                )
        except Exception:
            pass

    return (
        "### MANDATORY — SQL Executor (LIVE DATABASE EXECUTION)\n"
        "You MUST execute SELECT queries to produce evidence. Zero placeholders allowed.\n"
        f"{table_hint}\n"
        "**EXACT FORMAT — write this directly in your response text:**\n\n"
        "[EXEC_SQL]\n"
        "SELECT COUNT(*) AS total_rows FROM Claims\n"
        "[/EXEC_SQL]\n\n"
        "**CRITICAL RULES — read carefully:**\n"
        "- The `[EXEC_SQL]` tag must appear DIRECTLY in your response, NOT inside a ```sql code block\n"
        "- Do NOT write `EXEC_SQL` without the square brackets `[` and `]`\n"
        "- Do NOT write `[Actual Count]`, `[Row Count]`, or any placeholder — execute the query instead\n"
        "- One SELECT statement per [EXEC_SQL]...[/EXEC_SQL] block\n"
        "- Only SELECT statements are permitted\n\n"
        "Required evidence queries:\n"
        "  [EXEC_SQL]\n  SELECT COUNT(*) AS total_rows FROM <table>\n  [/EXEC_SQL]\n\n"
        "  [EXEC_SQL]\n  SELECT <id_col>, COUNT(*) AS cnt FROM <table> "
        "GROUP BY <id_col> HAVING COUNT(*) > 1\n  [/EXEC_SQL]\n\n"
        "  [EXEC_SQL]\n  SELECT COUNT(*) AS null_cnt FROM <table> WHERE <key_col> IS NULL\n  [/EXEC_SQL]\n\n"
        "Results are returned to you immediately and shared as structured evidence with all downstream roles."
    )


def _build_agent_context(agent, role, conn_id: Optional[int], db: Session) -> str:
    """
    Build the full KT + access context for a named agent based on their effective tools.
    Merges role grants with agent grants and subtracts role restrictions.
    This is the 'onboarding package' injected into every prompt for this agent.
    """
    tools = _compute_effective_tools(agent, role)

    if not tools:
        return ""

    sections: list[str] = []

    # Load context payload once (cached)
    ctx = None
    if conn_id and any(t in tools for t in ("db", "query_examples", "business_rules")):
        try:
            from api.services.context_cache import get_or_build
            ctx = get_or_build(conn_id, db)
        except Exception:
            ctx = None

    if "db" in tools and ctx:
        s = _tool_db(ctx)
        if s:
            sections.append(s)

    if "query_examples" in tools and ctx:
        s = _tool_query_examples(ctx)
        if s:
            sections.append(s)

    if "business_rules" in tools and ctx:
        s = _tool_business_rules(ctx)
        if s:
            sections.append(s)

    if "api" in tools:
        s = _tool_api(db)
        if s:
            sections.append(s)

    if "jira" in tools:
        s = _tool_jira(conn_id, db)
        if s:
            sections.append(s)

    if "test_cases" in tools:
        s = _tool_test_cases(db)
        if s:
            sections.append(s)

    if "reports" in tools:
        s = _tool_reports_ctx(conn_id)
        if s:
            sections.append(s)

    if "development" in tools:
        s = _tool_development_ctx(conn_id)
        if s:
            sections.append(s)

    if "dashboards" in tools:
        s = _tool_dashboards_ctx(conn_id)
        if s:
            sections.append(s)

    if "testing" in tools:
        s = _tool_testing_ctx(conn_id)
        if s:
            sections.append(s)

    if "sql_exec" in tools:
        s = _tool_sql_exec_ctx(conn_id, db)
        if s:
            sections.append(s)

    if not sections:
        return ""

    return "\n\n".join(sections)


# ── Decision parser ───────────────────────────────────────────────────────────

_DECISION_RE = re.compile(
    r'\[DECISION:\s*(APPROVE|REJECT|REVISE)'
    r'(?:\s*\|\s*(?:Route\s+to|Target):\s*([^\|\]]+?))?'
    r'(?:\s*\|\s*(?:Reason|Notes?):\s*([^\]]+?))?'
    r'\]',
    re.IGNORECASE,
)


def parse_decision(output: str) -> dict:
    """
    Extract structured decision from agent output.
    Expected format (anywhere in the text):
      [DECISION: APPROVE]
      [DECISION: REJECT | Route to: Sai | Reason: SQL has wrong JOIN]
      [DECISION: REVISE | Target: PMO | Reason: BRD scope changed]
    Returns: {action, target_name, notes}
    """
    m = _DECISION_RE.search(output)
    if not m:
        return {"action": None, "target_name": None, "notes": None}
    return {
        "action":      m.group(1).upper(),
        "target_name": (m.group(2) or "").strip() or None,
        "notes":       (m.group(3) or "").strip() or None,
    }


# ── Module action executor ────────────────────────────────────────────────────

_ACTION_RE = {
    "RUN_REPORT":      re.compile(r'\[RUN_REPORT:\s*([^\]]+?)\s*\]',      re.IGNORECASE),
    "CREATE_DEV_PLAN": re.compile(r'\[CREATE_DEV_PLAN:\s*([^\]]+?)\s*\]', re.IGNORECASE),
    "DESIGN_DASHBOARD":re.compile(r'\[DESIGN_DASHBOARD:\s*([^\]]+?)\s*\]',re.IGNORECASE),
    "GENERATE_TESTS":  re.compile(r'\[GENERATE_TESTS:\s*([^\]]+?)\s*\]',  re.IGNORECASE),
    # Block tag — avoids regex conflicts with MSSQL [schema].[table] bracket syntax
    "EXEC_SQL":        re.compile(r'\[EXEC_SQL\]([\s\S]+?)\[/EXEC_SQL\]', re.IGNORECASE),
}


_BARE_EXEC_SQL_RE = re.compile(
    r'```(?:sql)?\s*\n((?:--[^\n]*\n)*EXEC_SQL\s*\n[\s\S]+?)```'
    r'|(?<!\[)EXEC_SQL\s*\n(SELECT\b[\s\S]+?)(?=\n\s*(?:EXEC_SQL\b|```|#|\*\*|--\s*Step)|\Z)',
    re.IGNORECASE,
)


def _normalize_exec_sql_tags(text: str) -> str:
    """Convert misformatted EXEC_SQL patterns to proper [EXEC_SQL]...[/EXEC_SQL] blocks.
    Handles: EXEC_SQL inside ```sql code blocks, and bare EXEC_SQL\nSELECT... patterns."""
    def _repl(m: re.Match) -> str:
        body = (m.group(1) or m.group(2) or "").strip()
        # Strip a leading EXEC_SQL line if present (from code-block variant)
        lines = body.splitlines()
        if lines and lines[0].strip().upper() == "EXEC_SQL":
            body = "\n".join(lines[1:]).strip()
        return f"[EXEC_SQL]\n{body}\n[/EXEC_SQL]"

    # Only transform if no proper [EXEC_SQL] tags already exist
    if not re.search(r'\[EXEC_SQL\]', text, re.IGNORECASE):
        text = _BARE_EXEC_SQL_RE.sub(_repl, text)
    return text


def execute_module_actions(
    output_text: str,
    conn_id: Optional[int],
    db: Session,
    model: str = "gpt-4o-mini",
) -> str:
    """
    Parse action tags from LLM output and execute them against real platform services.
    Appends actual results (artifact IDs, row counts, test case names) back to output_text.
    Returns the enriched output string. Never raises — failures are recorded inline.
    """
    if not conn_id:
        return output_text

    # Normalise misformatted EXEC_SQL patterns before scanning
    output_text = _normalize_exec_sql_tags(output_text)

    appended: list[str] = []

    # ── RUN_REPORT ────────────────────────────────────────────────────────────
    for m in _ACTION_RE["RUN_REPORT"].finditer(output_text):
        question = m.group(1).strip()
        try:
            from api.routers.report_ai import ask_question, save_report
            from api.routers.report_ai import AskRequest, SaveReportRequest
            req    = AskRequest(conn_id=conn_id, question=question, chat_model=model)
            result = ask_question(req, db)
            # Save to Reports tab so user can see it there
            save_req = SaveReportRequest(conn_id=conn_id, name=question[:200], query_sql=result.sql)
            saved = save_report(save_req, db)
            sample = result.rows[:3] if result.rows else []
            appended.append(
                f"\n\n---\n**[Report Result]** `{question}`\n"
                f"Saved as report #{saved.id}\n"
                f"SQL: `{result.sql}`\n"
                f"Rows returned: {result.total}\n"
                f"Columns: {', '.join(result.columns)}\n"
                f"Sample: {json.dumps(sample, default=str)}"
            )
        except Exception as exc:
            appended.append(f"\n\n---\n**[Report Error]** {question}: {str(exc)[:200]}")

    # ── CREATE_DEV_PLAN ───────────────────────────────────────────────────────
    for m in _ACTION_RE["CREATE_DEV_PLAN"].finditer(output_text):
        task = m.group(1).strip()
        try:
            from api.routers.development import generate_plan
            from api.schemas import PlanRequest
            req    = PlanRequest(conn_id=conn_id, task_description=task, model=model)
            result = generate_plan(req, db)
            step_titles = [s.title for s in result.steps]
            appended.append(
                f"\n\n---\n**[Dev Plan Created]** artifact_id={result.artifact_id}\n"
                f"Task: {task}\n"
                f"Steps ({len(result.steps)}): {' \u2192 '.join(step_titles)}"
            )
        except Exception as exc:
            appended.append(f"\n\n---\n**[Dev Plan Error]** {task}: {str(exc)[:200]}")

    # ── DESIGN_DASHBOARD ──────────────────────────────────────────────────────
    for m in _ACTION_RE["DESIGN_DASHBOARD"].finditer(output_text):
        intent = m.group(1).strip()
        try:
            from api.routers.dashboards import generate_dashboard, save_dashboard
            from api.routers.dashboards import GenerateRequest, SaveRequest
            # Generate
            req    = GenerateRequest(intent=intent, conn_id=conn_id, model=model)
            result = generate_dashboard(req, db)
            config  = result.get("config", {})
            debug   = result.get("debug", {})
            title   = config.get("title") or config.get("name") or intent[:80]
            widgets = config.get("widgets", [])
            # Save to My Dashboards tab
            save_req = SaveRequest(
                name=title,
                description=f"AI-generated via workflow agent: {intent[:200]}",
                config_json=json.dumps(config),
                debug_json=json.dumps(debug),
                conn_id=conn_id,
            )
            saved = save_dashboard(save_req, db)
            appended.append(
                f"\n\n---\n**[Dashboard Generated]** {title}\n"
                f"Saved as dashboard #{saved['id']}\n"
                f"Intent: {intent}\n"
                f"Widgets: {len(widgets)}"
            )
        except Exception as exc:
            appended.append(f"\n\n---\n**[Dashboard Error]** {intent}: {str(exc)[:200]}")

    # ── GENERATE_TESTS ────────────────────────────────────────────────────────
    for m in _ACTION_RE["GENERATE_TESTS"].finditer(output_text):
        desc = m.group(1).strip()
        try:
            from api.routers.testing import generate_tests
            from api.schemas import AIGenerateTestsRequest
            req   = AIGenerateTestsRequest(
                description=desc,
                source_conn_id=conn_id,
                model=model,
            )
            cases = generate_tests(req, db)
            names = [c.name for c in cases[:5]]
            appended.append(
                f"\n\n---\n**[Test Cases Generated]** {len(cases)} cases\n"
                f"conn_id={conn_id}\n"
                f"Description: {desc}\n"
                f"Cases: {', '.join(names)}"
            )
        except Exception as exc:
            appended.append(f"\n\n---\n**[Test Error]** {desc}: {str(exc)[:200]}")

    # ── EXEC_SQL (with self-healing retry) ───────────────────────────────────────
    for m in _ACTION_RE["EXEC_SQL"].finditer(output_text):
        raw_sql = m.group(1).strip()
        try:
            from api.services.sql_guard import validate_readonly
            validate_readonly(raw_sql)
            from api.models import SourceConnection
            from api.services.encryption import decrypt
            from api.services.connector import preview_data as _preview_data
            conn_row = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
            if not conn_row:
                appended.append(f"\n\n---\n**[SQL Execution Error]** No connection found (conn_id={conn_id})")
                continue
            cfg_base = {
                "source_type": conn_row.source_type,
                "dialect":     conn_row.dialect,
                "host":        conn_row.host,
                "port":        conn_row.port,
                "database":    conn_row.database_name,
                "schema":      conn_row.schema_name,
                "username":    conn_row.username,
                "password":    decrypt(conn_row.password_enc) if conn_row.password_enc else "",
            }

            # ── Execution with 1 self-healing retry ──────────────────────────────
            exec_sql     = raw_sql
            result       = None
            last_exc     = None
            error_cat    = None
            fixed_sql    = None
            retry_used   = False

            t_exec = time.monotonic()
            for attempt in range(2):  # attempt 0 = original; attempt 1 = auto-fixed
                try:
                    result = _preview_data({**cfg_base, "query": exec_sql}, limit=5000)
                    break  # success
                except Exception as exc:
                    last_exc  = exc
                    error_cat = _classify_sql_error(str(exc))
                    if attempt == 0 and error_cat == "OBJECT_NOT_FOUND":
                        fixed_sql = _suggest_object_fix(raw_sql, conn_id, db)
                        if fixed_sql:
                            try:
                                validate_readonly(fixed_sql)   # safety re-check on corrected SQL
                                exec_sql   = fixed_sql
                                retry_used = True
                                continue   # retry with corrected SQL
                            except ValueError:
                                fixed_sql = None  # not safe — don't retry
                    break   # unrecoverable or no fix found

            if result is None:
                # ── Failure path — structured error MEMO ─────────────────────────
                err_msg    = str(last_exc)[:200]
                error_cat  = error_cat or "UNKNOWN"
                error_memo = {
                    "type": "sql_execution_error", "system": "SQLExec",
                    "severity": "HIGH",
                    "key": f"exec_err_{error_cat.lower()[:20]}",
                    "message": f"SQL failed [{error_cat}]: {err_msg[:120]}",
                }
                fail_text = (
                    f"\n\n---\n**[SQL Execution Failed]** `[{error_cat}]`\n"
                    f"```sql\n{raw_sql}\n```\n"
                    f"Error: {err_msg}\n"
                )
                if fixed_sql and retry_used:
                    fail_text += (
                        f"\nAuto-recovery attempted:\n```sql\n{fixed_sql}\n```\n"
                        "Recovery also failed — manual review required.\n"
                    )
                fail_text += f"\n[MEMO: {json.dumps(error_memo)}]"
                appended.append(fail_text)
                continue

            # ── Success path ──────────────────────────────────────────────────────
            runtime_ms = int((time.monotonic() - t_exec) * 1000)
            columns = result.get("columns", [])
            rows    = result.get("rows", [])
            total   = result.get("total", 0)
            metrics = _compute_sql_metrics(columns, rows)

            sample   = rows[:20]
            md_table = ""
            if columns and sample:
                hdr      = " | ".join(str(c) for c in columns)
                sep      = " | ".join(["---"] * len(columns))
                md_table = f"| {hdr} |\n| {sep} |\n"
                for row in sample:
                    md_table += "| " + " | ".join(str(row.get(c, "")) for c in columns) + " |\n"
                if total > 20:
                    md_table += f"_(showing 20 of {total} rows)_\n"

            null_summary = ", ".join(
                f"`{col}` {pct}% null" for col, pct in metrics["null_rates"].items() if pct > 0
            ) or "no nulls detected"
            dup_summary = ", ".join(
                f"`{col}`: {cnt} duplicates" for col, cnt in metrics["duplicates"].items()
            ) or "no duplicates detected"

            result_text = (
                f"\n\n---\n**[SQL Execution Result]**"
                + (f" _(auto-corrected: `{error_cat}`)_" if retry_used else "") + "\n"
                f"```sql\n{exec_sql}\n```\n"
                f"**Rows returned:** {total}  |  **Runtime:** {runtime_ms} ms  \n"
                f"**Null rates:** {null_summary}  \n"
                f"**Duplicates:** {dup_summary}  \n\n"
            )
            if md_table:
                result_text += f"**Sample data:**\n{md_table}\n"

            # Auto-generate [MEMO:] tags — picked up by existing MEMO parser downstream
            auto_memos: list[dict] = []
            # Row count telemetry entry (always emitted — confirms real execution happened)
            auto_memos.append({
                "type": "finding", "system": "SQLExec", "severity": "LOW",
                "key": f"exec_rows_{abs(hash(exec_sql)) % 10000}",
                "message": f"SQL executed: {total} rows returned in {runtime_ms} ms",
                "rows_returned": total, "runtime_ms": runtime_ms,
            })
            if retry_used:
                auto_memos.append({"type": "decision", "system": "SQLExec", "severity": "LOW",
                    "key": "auto_recovery_ok",
                    "message": f"Self-healed SQL ({error_cat}): corrected and executed successfully"})
            for col, pct in metrics["null_rates"].items():
                if pct > 30:
                    auto_memos.append({"type": "finding", "system": "SQLExec", "severity": "HIGH",
                        "key": f"null_{col[:20]}", "message": f"{pct}% null rate on {col} ({total} rows)",
                        "table": col.split("_")[0] if "_" in col else col, "metric": f"null_rate_{col[:20]}", "value": pct})
                elif pct > 10:
                    auto_memos.append({"type": "finding", "system": "SQLExec", "severity": "MEDIUM",
                        "key": f"null_{col[:20]}", "message": f"{pct}% null rate on {col} ({total} rows)",
                        "table": col.split("_")[0] if "_" in col else col, "metric": f"null_rate_{col[:20]}", "value": pct})
            for col, cnt in metrics["duplicates"].items():
                dup_pct = round(cnt / total * 100, 1) if total else 0
                sev = "HIGH" if dup_pct > 5 else "MEDIUM"
                auto_memos.append({"type": "finding", "system": "SQLExec", "severity": sev,
                    "key": f"dup_{col[:20]}", "message": f"{cnt} duplicate values in {col} ({dup_pct}% of {total} rows)",
                    "metric": f"duplicate_{col[:20]}", "value": cnt, "pct": dup_pct})
            if total == 0:
                auto_memos.append({"type": "finding", "system": "SQLExec", "severity": "LOW",
                    "key": "empty_result", "message": "SQL query returned 0 rows"})

            for memo in auto_memos:
                result_text += f"\n[MEMO: {json.dumps(memo)}]"

            appended.append(result_text)

        except ValueError as exc:
            appended.append(f"\n\n---\n**[SQL Execution Blocked]** {exc}")
        except Exception as exc:
            appended.append(f"\n\n---\n**[SQL Execution Error]** {str(exc)[:300]}")

    if appended:
        return output_text + "\n" + "\n".join(appended)
    return output_text


# ── Prompt builder ────────────────────────────────────────────────────────────

# Hardcoded defaults — used when no DB template exists or the DB template is blank/inactive.
_DEFAULT_BOUNDARY_BA = (
    "\nIMPORTANT — Role boundary: You are a Business Analyst. "
    "Your job is to gather requirements, analyse the request, and produce structured specs or a BRD. "
    "Do NOT write SQL queries, stored procedures, or code. "
    "If you have schema access, use it only to understand what data is available, not to write queries."
)
_DEFAULT_BOUNDARY_MANAGER = (
    "\nIMPORTANT — Role boundary: You are in a management/review role. "
    "Your ONLY job is to review the work produced in previous steps and make a DECISION.\n\n"
    "MANDATORY — Evidence-based reporting: Your executive summary MUST reference actual metrics "
    "from the '## Shared Workflow Context' section above (SQL execution results, QA findings). "
    "Write quantitative statements only — '1432 duplicate ClaimIDs (6.3% of rows), "
    "12.3% null ClaimStatus, severity: HIGH' NOT 'significant data quality issues found'. "
    "Include: total findings count, severity distribution (HIGH/MEDIUM/LOW), highest-risk items, "
    "and recommended next steps.\n"
    "You must NEVER write SQL queries or any code. "
    "Always end with the DECISION tag."
)
_DEFAULT_BOUNDARY_QA = (
    "\nIMPORTANT — Role boundary: You are a QA / Testing specialist. "
    "Your job is to validate data quality using ACTUAL execution evidence — not assumptions.\n\n"
    "MANDATORY — Evidence-first validation: Before stating any finding, check the "
    "'## Shared Workflow Context' section for SQL execution results from the Developer. "
    "For any validation not already covered, run your own query:\n"
    "[EXEC_SQL]\nSELECT <your validation query>\n[/EXEC_SQL]\n"
    "Every finding you raise MUST cite a measured value: "
    "'1432 duplicate ClaimIDs detected' NOT 'duplicates identified'. "
    "Never use 'should', 'may', 'identified', or 'assumed' — only report numbers you can prove. "
    "Do NOT write implementation SQL or business logic — only validation queries."
)
_DEFAULT_BOUNDARY_DEVELOPER = (
    "\nIMPORTANT — Role boundary: You are a Developer. "
    "Your job is to write SQL and IMMEDIATELY execute it to ground your analysis in real evidence.\n\n"
    "MANDATORY — Execute every query you write using this exact format:\n"
    "[EXEC_SQL]\nSELECT ...\n[/EXEC_SQL]\n"
    "The system will run the query and return real row counts, null rates, duplicates, "
    "and sample data. You MUST cite the actual numbers from those results. "
    "NEVER use placeholders like '[Result from X]', 'approximately', 'should be', "
    "'as expected', or 'assumed'. "
    "If a query fails, the system will attempt auto-correction — read the error and revise."
)
_DEFAULT_BOUNDARY_DEFAULT = (
    "\nStay within the boundaries of your role. Do not produce artefacts that belong to a "
    "different role (e.g. do not write SQL unless you are a Developer)."
)
# {next_names} is substituted at call time
_DEFAULT_DECISION_MAKER = (
    "\nYou MUST end your response with exactly one decision tag:\n"
    "  [DECISION: APPROVE]   — work is satisfactory, proceed\n"
    "  [DECISION: REJECT | Route to: <name> | Reason: <your specific feedback>]"
    "   — send back for revision (e.g. Route to: {next_names})\n"
    "  [DECISION: REVISE | Route to: <name> | Reason: <your specific feedback>]"
    "   — same as REJECT but signals a scope change"
)
_DEFAULT_DECISION_OPTIONAL = (
    "\nOptionally, if you need to flag a blocker or escalate, you may add:\n"
    "  [DECISION: REJECT | Route to: <name> | Reason: <blocker description>]"
)


def _get_prompt(name: str, default: str, db) -> str:
    """
    Look up a prompt template by name from conversion_prompt_templates.
    Returns the DB content if the row exists, is_active=True, and content is non-empty.
    Falls back to `default` otherwise — so a deleted or blanked-out template never
    breaks the pipeline.
    """
    try:
        from api.models import PromptTemplate
        row = db.query(PromptTemplate).filter(
            PromptTemplate.name == name,
            PromptTemplate.is_active == True,   # noqa: E712
        ).first()
        if row and row.content and row.content.strip():
            return row.content
    except Exception:
        pass
    return default


def build_role_prompt(
    role,
    agent,
    card,
    prev_output: Optional[str],
    user_query: str,
    agent_context: str,
    step_number: int,
    iteration: int,
    feedback: Optional[str],
    is_decision_maker: bool,
    cards_after: list,    # cards that come after this one (for decision routing info)
    db=None,              # SQLAlchemy Session — used to load prompt template overrides
    shared_memory: Optional[list] = None,
) -> str:
    lines: list[str] = []

    # ── Identity ──────────────────────────────────────────────
    agent_label = agent.name if agent else (role.role_name if role else f"Step {step_number}")
    role_label  = role.role_name if role else ""
    lines.append(f"# You are: {agent_label}")
    if role_label and role_label != agent_label:
        lines.append(f"# Your Role: {role_label}")
    if agent and agent.description:
        lines.append(f"Profile: {agent.description}")

    # ── Role behaviour ────────────────────────────────────────
    if role:
        if role.responsibilities:
            lines.append(f"\n## Responsibilities\n{role.responsibilities}")
        if role.skills:
            lines.append(f"\n## Skills\n{role.skills}")
        if role.decision_logic:
            lines.append(f"\n## Decision Logic\n{role.decision_logic}")
        if role.tone:
            lines.append(f"\nTone: {role.tone}")

    # ── Onboarding context (KT + access) ─────────────────────
    if agent_context:
        lines.append(f"\n## Your Access & Knowledge (Onboarding Package)\n{agent_context}")

    # ── Shared workflow memory from previous steps ─────────
    if shared_memory:
        priority = [m for m in shared_memory if m.get("severity") in ("CRITICAL", "HIGH")]
        other    = [m for m in shared_memory if m.get("severity") not in ("CRITICAL", "HIGH")]
        mem_lines = ["\n## Shared Workflow Context (from previous steps)"]
        for m in priority + other:
            mem_lines.append(
                f"  [{m.get('severity','?')}][{m.get('type','?')}] "
                f"{m.get('key','')} — {m.get('message','')} "
                f"(by {m.get('written_by','')} @ step {m.get('written_at_step','')})"
            )
        lines.append("\n".join(mem_lines))

    lines.append("\n---")

    # ── Work assignment ───────────────────────────────────────
    lines.append(f"\n## Work Assignment (Step {step_number}" + (f", Iteration {iteration}" if iteration > 1 else "") + ")")
    lines.append(f"**Original Request:** {user_query}")

    if feedback and iteration > 1:
        lines.append(f"\n**Feedback from previous review (iteration {iteration - 1}):**\n{feedback}")

    if prev_output:
        label = "Previous step output" if iteration == 1 else "Latest output to revise"
        lines.append(f"\n**{label}:**\n{prev_output}")
    elif step_number == 1 and iteration == 1:
        lines.append("\n(You are the first step — no previous output. Work directly from the request.)")

    # ── Expected output ───────────────────────────────────────
    if role:
        if role.input_expectation:
            lines.append(f"\n**Your Expected Input:** {role.input_expectation}")
        if role.output_expectation:
            lines.append(f"\n**Your Expected Output:** {role.output_expectation}")
        if role.deliverables:
            lines.append(f"\n**Deliverables:** {role.deliverables}")

    # ── Decision instruction (for review/approval roles) ──────
    lines.append("\n---")
    lines.append("## Instructions")
    lines.append("Produce your output. Be concise, structured, and actionable.")

    # ── Role-boundary guard ───────────────────────────────────
    # Prevent agents from doing work that belongs to a different role.
    role_name_lower = (role.role_name if role else "").lower()
    is_dev_role = any(k in role_name_lower for k in ("dev", "engineer", "developer", "programmer", "sql"))
    is_qa_role  = any(k in role_name_lower for k in ("qa", "test", "quality"))
    is_ba_role  = any(k in role_name_lower for k in ("ba", "analyst", "business", "product", "pmo"))
    is_mgr_role = any(k in role_name_lower for k in ("manager", "director", "lead", "head", "cto", "vp"))

    if is_ba_role:
        lines.append(_get_prompt("agentic_boundary_ba", _DEFAULT_BOUNDARY_BA, db))
    elif is_mgr_role:
        lines.append(_get_prompt("agentic_boundary_manager", _DEFAULT_BOUNDARY_MANAGER, db))
    elif is_qa_role:
        lines.append(_get_prompt("agentic_boundary_qa", _DEFAULT_BOUNDARY_QA, db))
    elif is_dev_role:
        lines.append(_get_prompt("agentic_boundary_developer", _DEFAULT_BOUNDARY_DEVELOPER, db))
    else:
        lines.append(_get_prompt("agentic_boundary_default", _DEFAULT_BOUNDARY_DEFAULT, db))

    # ── Evidence gate for Manager roles ──────────────────────
    # If no SQL execution has occurred, force REJECT to prevent fake summaries.
    if is_mgr_role and not _has_execution_evidence(shared_memory):
        lines.append(
            "\n\n**CRITICAL CONSTRAINT — EVIDENCE GATE:**\n"
            "The Shared Workflow Context contains NO SQL execution results (no SQLExec entries). "
            "This means the Data Developer did not actually execute any queries against the live database. "
            "You MUST output [DECISION: REJECT] and explain that execution evidence is missing. "
            "Do NOT produce a summary, findings, or approval based on narrative descriptions alone. "
            "A workflow summary without measured data is operationally unsafe and must not proceed."
        )

    # ── QA advisory when no execution evidence ────────────────
    if is_qa_role and not _has_execution_evidence(shared_memory):
        lines.append(
            "\n\n**ADVISORY — No SQL Execution Evidence Detected:**\n"
            "The shared context has no SQL execution results from the Developer step. "
            "You MUST run your own [EXEC_SQL] validation queries to establish evidence before reporting findings. "
            "Do not validate assumptions — validate data."
        )

    if is_decision_maker:
        next_names = " or ".join(c.name for c in cards_after[:2]) if cards_after else "the previous step"
        tpl = _get_prompt("agentic_decision_maker", _DEFAULT_DECISION_MAKER, db)
        lines.append(tpl.format(next_names=next_names))
    else:
        lines.append(_get_prompt("agentic_decision_optional", _DEFAULT_DECISION_OPTIONAL, db))

    # ── Governance metadata footer ───────────────────────────
    lines.append(
        "\n\nAfter your [DECISION] tag, always append:\n"
        "  [CONFIDENCE: 0.0–1.0]  (your certainty in the output)\n"
        "  [RISK: {\"risk_type\": \"DATA_QUALITY|DATA_LOSS|COMPLIANCE|PERFORMANCE|SECURITY|LOGIC_ERROR\", "
        "\"severity\": \"LOW|MEDIUM|HIGH|CRITICAL\", \"business_impact\": \"LOW|MEDIUM|HIGH\"}]\n"
        "  [REQUIRES_HUMAN_REVIEW: true|false]\n"
        "To share a finding with later steps: [MEMO: {\"type\": \"issue|decision|finding|context|risk\", "
        "\"system\": \"MAS|ADO|DCT|General\", \"severity\": \"LOW|MEDIUM|HIGH|CRITICAL\", "
        "\"key\": \"short_unique_key\", \"message\": \"brief description\"}]"
    )

    return "\n".join(lines)


# ── Project-level approval helpers ───────────────────────────────────────────

def _normalize_role(role_name: str) -> str:
    """'Team Lead' → 'team_lead'  (matches ProjectMember.project_role values)"""
    return role_name.lower().replace(" ", "_")


def _step_needs_human_approval(db: Session, project_id: int, role_key: str) -> bool:
    """True if the project has an active workflow with a step for this role_key."""
    from api.models import ApprovalWorkflow, ApprovalWorkflowStep
    wf = db.query(ApprovalWorkflow).filter(
        ApprovalWorkflow.project_id == project_id,
        ApprovalWorkflow.is_active == True,  # noqa: E712
    ).first()
    if not wf:
        return False
    return (
        db.query(ApprovalWorkflowStep)
        .filter(
            ApprovalWorkflowStep.workflow_id == wf.id,
            ApprovalWorkflowStep.required_role == role_key,
        )
        .count() > 0
    )


# ── Main workflow runner ──────────────────────────────────────────────────────

def run_workflow(
    conn_id: Optional[int],
    user_query: str,
    model: str,
    db: Session,
    project_id: Optional[int] = None,
) -> dict:
    """
    Execute the full A2A workflow with loop-back support.

    Algorithm:
      1. Load all active cards in execution_order
      2. Create WorkflowExecution record
      3. Maintain a pointer (card_idx) through the card list
      4. Per card:
         a. Resolve agent + role → build onboarding context from agent.tools_json
         b. Build prompt: role behaviour + KT context + previous output + feedback
         c. Call OpenAI
         d. Parse [DECISION: ...] from output
         e. If APPROVE or no on_reject_card_id → advance to next card
            If REJECT/REVISE → jump back to on_reject_card_id, inject feedback
            If max_iterations exceeded → mark escalated, advance anyway
      5. Finalise and return
    """
    from openai import OpenAI
    from api.models import (
        AgentCard, AgentRole, AIAgent,
        WorkflowExecution, WorkflowExecutionStep,
    )

    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        raise ValueError("OpenAI API key not configured")

    client = OpenAI(api_key=api_key)

    # ── Load ordered active cards ─────────────────────────────
    from sqlalchemy import or_ as _or
    cards_q = db.query(AgentCard).filter(AgentCard.is_active == True)  # noqa: E712
    if project_id:
        cards_q = cards_q.filter(_or(AgentCard.project_id == project_id, AgentCard.project_id.is_(None)))
    cards = cards_q.order_by(AgentCard.execution_order).all()
    # Fall back to all active cards (ignore project scope) when none found for this project.
    # The agent pipeline (BA→Dev→QA→Manager) is reusable across projects.
    if not cards and project_id:
        cards = (
            db.query(AgentCard)
            .filter(AgentCard.is_active == True)  # noqa: E712
            .order_by(AgentCard.execution_order)
            .all()
        )
    if not cards:
        raise ValueError(
            "No active workflow cards found. "
            "Go to the Cards tab and create at least one card first."
        )

    # Build lookup: card_id → index in `cards` list
    card_index: dict[int, int] = {c.id: i for i, c in enumerate(cards)}

    # Pre-build agent contexts (cached per agent_id to avoid repeated DB queries)
    agent_contexts: dict[int, str] = {}

    def _get_agent_context(agent, role) -> str:
        if agent is None:
            return ""
        cache_key = (agent.id if agent else None, role.id if role else None)
        if cache_key not in agent_contexts:
            agent_contexts[cache_key] = _build_agent_context(agent, role, conn_id, db)
        return agent_contexts[cache_key]

    # ── Create execution record ───────────────────────────────
    execution = WorkflowExecution(
        conn_id=conn_id,
        user_query=user_query,
        model=model,
        status="running",
        total_steps=len(cards),
        completed_steps=0,
    )
    db.add(execution)
    db.flush()

    # ── Loop engine state ─────────────────────────────────────
    prev_output: Optional[str] = None
    feedback:    Optional[str] = None           # last REJECT/REVISE notes
    shared_mem:  list = []                       # cross-step evidence memory
    card_iterations: dict[int, int] = defaultdict(int)
    step_number  = 0
    card_idx     = 0
    steps_out: list[dict] = []

    while card_idx < len(cards):
        card  = cards[card_idx]

        # Check for external cancellation before each step
        db.refresh(execution)
        if execution.status == "cancelled":
            yield {"type": "error", "message": "Execution cancelled by user."}
            return

        # Track iterations for this card
        card_iterations[card.id] += 1
        iteration = card_iterations[card.id]

        # Escalate if max exceeded
        if iteration > card.max_iterations:
            step_number += 1
            step = WorkflowExecutionStep(
                execution_id=execution.id,
                step_number=step_number,
                card_id=card.id,
                card_name=card.name,
                iteration=iteration,
                input_text=prev_output or user_query,
                output_text=f"[ESCALATED] Max iterations ({card.max_iterations}) reached for this card.",
                status="escalated",
                decision="ESCALATED",
            )
            db.add(step)
            db.flush()
            steps_out.append(_step_dict(step))
            # Force advance to next card
            prev_output = step.output_text
            feedback    = None
            card_idx   += 1
            execution.completed_steps = card_idx
            db.flush()
            continue

        # ── Resolve agent + role ──────────────────────────────
        agent = db.query(AIAgent).filter(AIAgent.id == card.agent_id).first() if card.agent_id else None
        # Role from card directly, or from agent's assigned role
        role_id = card.role_id or (agent.role_id if agent and hasattr(agent, 'role_id') else None)
        role = db.query(AgentRole).filter(AgentRole.id == role_id).first() if role_id else None

        # Decide if this card is a decision-maker (has on_reject_card_id set or is last)
        is_decision_maker = bool(card.on_reject_card_id) or card_idx == len(cards) - 1

        # Cards that come before this one (targets for rejection routing)
        cards_before = [c for c in cards[:card_idx] if c.id == card.on_reject_card_id]
        cards_after  = cards[card_idx + 1:] if card_idx + 1 < len(cards) else []

        # Build prompt
        agent_context = _get_agent_context(agent, role)
        prompt_text = build_role_prompt(
            role=role,
            agent=agent,
            card=card,
            prev_output=prev_output,
            user_query=user_query,
            agent_context=agent_context,
            step_number=step_number + 1,
            iteration=iteration,
            feedback=feedback,
            is_decision_maker=is_decision_maker,
            cards_after=cards_before if card.on_reject_card_id else cards_after,
            db=db,
            shared_memory=shared_mem,
        )

        # ── Save step record ──────────────────────────────────
        step_number += 1
        step = WorkflowExecutionStep(
            execution_id=execution.id,
            step_number=step_number,
            card_id=card.id,
            card_name=card.name,
            role_name=role.role_name if role else None,
            agent_name=agent.name if agent else None,
            iteration=iteration,
            input_text=feedback or prev_output or user_query,
            prompt_used=prompt_text,
            status="running",
        )
        db.add(step)
        db.flush()

        # ── Call OpenAI ───────────────────────────────────────
        t_start = time.monotonic()
        step_status  = "success"
        output_text  = ""
        decision_data = {"action": None, "target_name": None, "notes": None}

        # Detect if this agent has any module execution tools
        active_module_tools = [t for t in _compute_effective_tools(agent, role) if t in MODULE_TOOLS]

        system_content = (
            "You are a named AI agent in a multi-agent organisation. "
            "Follow your role instructions precisely. "
            "Always end with a [DECISION: ...] tag when instructed."
        )
        if active_module_tools:
            tag_map = {
                "reports":     "[RUN_REPORT: ...]",
                "development": "[CREATE_DEV_PLAN: ...]",
                "dashboards":  "[DESIGN_DASHBOARD: ...]",
                "testing":     "[GENERATE_TESTS: ...]",
                "sql_exec":    "[EXEC_SQL]\nSELECT ...\n[/EXEC_SQL]",
            }
            required_tags = ", ".join(tag_map[t] for t in active_module_tools if t in tag_map)
            system_content += (
                f"\n\nCRITICAL INSTRUCTION: You have access to platform execution tools. "
                f"You MUST use the following action tags in your response to produce real deliverables: "
                f"{required_tags}. "
                f"Simply describing or recommending is NOT acceptable — you must output the exact tag "
                f"syntax so the system can execute the work. Your response is incomplete without them."
            )

        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_content},
                    {"role": "user", "content": prompt_text},
                ],
                temperature=0.35,
                max_tokens=1400,
                timeout=55,
            )
            output_text   = resp.choices[0].message.content or ""
            # Execute any module action tags the agent emitted
            try:
                output_text = execute_module_actions(output_text, conn_id, db, model)
            except Exception:
                pass  # never let module execution kill the step
            decision_data = parse_decision(output_text)
        except Exception as exc:
            output_text  = f"[Error: {str(exc)[:300]}]"
            step_status  = "failed"

        elapsed_ms = int((time.monotonic() - t_start) * 1000)

        # ── Parse MEMOs + placeholder scan ───────────────────
        new_memos = _parse_memos_from_output(
            output_text,
            role.role_name if role else (agent.name if agent else ""),
            step_number,
        )
        for memo in new_memos:
            existing_keys = [m.get("key") for m in shared_mem]
            if memo.get("key") and memo["key"] in existing_keys:
                shared_mem = [m for m in shared_mem if m.get("key") != memo["key"]]
            shared_mem.append(memo)
        # Trim to 50 entries (drop LOW severity first)
        if len(shared_mem) > 50:
            low = [m for m in shared_mem if m.get("severity") == "LOW"]
            rest = [m for m in shared_mem if m.get("severity") != "LOW"]
            shared_mem = (rest + low)[-50:]

        # Scan for unresolved placeholders
        placeholders = _detect_placeholders(output_text)
        if placeholders:
            shared_mem.append({
                "type": "risk", "system": "Orchestrator", "severity": "HIGH",
                "key": f"placeholder_step{step_number}",
                "message": f"Step {step_number} output contains unresolved placeholders: {placeholders[:5]}",
                "written_by": role.role_name if role else "Unknown",
                "written_at_step": step_number,
            })

        # Persist updated shared memory to execution record
        try:
            execution.shared_memory_json = json.dumps(shared_mem)
            db.flush()
        except Exception:
            pass

        # ── Update step ───────────────────────────────────────
        step.output_text      = output_text
        step.status           = step_status
        step.execution_time_ms = elapsed_ms
        step.decision         = decision_data["action"]
        step.decision_notes   = decision_data["notes"]
        db.flush()
        steps_out.append(_step_dict(step))

        # ── Routing decision ──────────────────────────────────
        action = decision_data["action"]

        if step_status == "failed":
            # On hard failure, advance (don't loop)
            prev_output = output_text
            feedback    = None
            card_idx   += 1

        elif action in ("REJECT", "REVISE") and card.on_reject_card_id:
            target_idx = card_index.get(card.on_reject_card_id)
            if target_idx is not None:
                # Loop back — inject feedback into next iteration
                feedback    = decision_data["notes"] or f"{agent.name if agent else card.name} requested revision."
                prev_output = output_text
                card_idx    = target_idx
            else:
                # on_reject_card_id no longer valid — advance
                prev_output = output_text
                feedback    = None
                card_idx   += 1

        else:
            # APPROVE, or no decision tag, or no reject route — advance
            prev_output = output_text
            feedback    = None
            card_idx   += 1

        execution.completed_steps = step_number
        db.flush()

    # ── Finalise ──────────────────────────────────────────────
    any_failed    = any(s["status"] in ("failed", "escalated") for s in steps_out)
    any_escalated = any(s["status"] == "escalated"              for s in steps_out)
    execution.status        = "escalated" if any_escalated else ("partial" if any_failed else "success")
    execution.final_summary = prev_output
    execution.finished_at   = datetime.utcnow()

    # Persist structured execution findings from SQLExec MEMOs
    try:
        sql_findings = [
            m for m in shared_mem
            if m.get("system") == "SQLExec" and m.get("severity") in ("HIGH", "MEDIUM", "CRITICAL")
        ]
        if sql_findings:
            execution.execution_findings_json = json.dumps(sql_findings)
        execution.shared_memory_json = json.dumps(shared_mem)
    except Exception:
        pass

    db.commit()

    return {
        "execution": _exec_dict(execution),
        "steps":     steps_out,
    }


# ── Serialisation helpers ─────────────────────────────────────────────────────

def _exec_dict(e) -> dict:
    return {
        "id":              e.id,
        "conn_id":         e.conn_id,
        "user_query":      e.user_query,
        "model":           e.model,
        "status":          e.status,
        "total_steps":     e.total_steps,
        "completed_steps": e.completed_steps,
        "final_summary":   e.final_summary,
        "created_at":      e.created_at.isoformat() if e.created_at else None,
        "finished_at":     e.finished_at.isoformat() if e.finished_at else None,
    }


def _step_dict(s) -> dict:
    return {
        "id":               s.id,
        "execution_id":     s.execution_id,
        "step_number":      s.step_number,
        "card_id":          s.card_id,
        "card_name":        s.card_name,
        "role_name":        s.role_name,
        "agent_name":       s.agent_name,
        "iteration":        s.iteration,
        "decision":         s.decision,
        "decision_notes":   s.decision_notes,
        "input_text":       s.input_text,
        "output_text":      s.output_text,
        "prompt_used":      s.prompt_used,
        "status":           s.status,
        "execution_time_ms": s.execution_time_ms,
        "confidence_score": getattr(s, "confidence_score", None),
        "risk_json":        getattr(s, "risk_json", None),
        "auto_hitl":        getattr(s, "auto_hitl", False),
        "created_at":       s.created_at.isoformat() if s.created_at else None,
    }


# ── Streaming workflow generator ──────────────────────────────────────────────

def stream_workflow(
    conn_id: Optional[int],
    user_query: str,
    model: str,
    db,
    project_id: Optional[int] = None,
    triggered_by_id: Optional[int] = None,
):
    """
    Generator version of run_workflow.
    Yields SSE-style event dicts as each step progresses:
      {"type": "thinking", "step_number": N, "card_name": ..., "agent_name": ..., "role_name": ...}
      {"type": "step",     "step": <step_dict>}
      {"type": "done",     "execution": <exec_dict>, "steps": [...]}
      {"type": "error",    "message": "..."}
    """
    from openai import OpenAI
    from api.models import (
        AgentCard, AgentRole, AIAgent,
        WorkflowExecution, WorkflowExecutionStep,
    )

    try:
        api_key = (settings.OPENAI_API_KEY or "").strip()
        if not api_key:
            yield {"type": "error", "message": "OpenAI API key not configured"}
            return

        client = OpenAI(api_key=api_key)

        from sqlalchemy import or_ as _or
        cards_q = db.query(AgentCard).filter(AgentCard.is_active == True)  # noqa: E712
        if project_id:
            cards_q = cards_q.filter(_or(AgentCard.project_id == project_id, AgentCard.project_id.is_(None)))
        cards = cards_q.order_by(AgentCard.execution_order).all()
        # Fall back to all active cards when none match the project scope
        if not cards and project_id:
            cards = (
                db.query(AgentCard)
                .filter(AgentCard.is_active == True)  # noqa: E712
                .order_by(AgentCard.execution_order)
                .all()
            )
        if not cards:
            yield {"type": "error", "message": "No active workflow cards found. Go to the Cards tab and add at least one card."}
            return

        card_index: dict[int, int] = {c.id: i for i, c in enumerate(cards)}
        agent_contexts: dict = {}

        def _get_agent_context(agent, role) -> str:
            if agent is None:
                return ""
            cache_key = (agent.id, role.id if role else None)
            if cache_key not in agent_contexts:
                agent_contexts[cache_key] = _build_agent_context(agent, role, conn_id, db)
            return agent_contexts[cache_key]

        execution = WorkflowExecution(
            conn_id=conn_id,
            user_query=user_query,
            model=model,
            status="running",
            total_steps=len(cards),
            completed_steps=0,
            project_id=project_id,
        )
        db.add(execution)
        db.flush()

        # Emit start event so frontend knows execution_id
        yield {
            "type": "start",
            "execution_id": execution.id,
            "total_steps": len(cards),
        }

        prev_output: Optional[str] = None
        feedback:    Optional[str] = None
        card_iterations: dict[int, int] = defaultdict(int)
        step_number = 0
        card_idx    = 0
        steps_out: list[dict] = []
        shared_mem: list[dict] = []

        while card_idx < len(cards):
            card = cards[card_idx]
            card_iterations[card.id] += 1
            iteration = card_iterations[card.id]

            # Resolve agent + role
            agent = db.query(AIAgent).filter(AIAgent.id == card.agent_id).first() if card.agent_id else None
            role_id = card.role_id or (agent.role_id if agent and hasattr(agent, "role_id") else None)
            role = db.query(AgentRole).filter(AgentRole.id == role_id).first() if role_id else None

            if iteration > card.max_iterations:
                step_number += 1
                step = WorkflowExecutionStep(
                    execution_id=execution.id,
                    step_number=step_number,
                    card_id=card.id,
                    card_name=card.name,
                    iteration=iteration,
                    input_text=prev_output or user_query,
                    output_text=f"[ESCALATED] Max iterations ({card.max_iterations}) reached.",
                    status="escalated",
                    decision="ESCALATED",
                )
                db.add(step)
                db.flush()
                steps_out.append(_step_dict(step))
                yield {"type": "step", "step": _step_dict(step)}
                prev_output = step.output_text
                feedback    = None
                card_idx   += 1
                execution.completed_steps = card_idx
                db.flush()
                continue

            # Emit thinking event before calling OpenAI
            yield {
                "type": "thinking",
                "step_number": step_number + 1,
                "card_name":   card.name,
                "agent_name":  agent.name if agent else None,
                "role_name":   role.role_name if role else None,
                "iteration":   iteration,
            }

            is_decision_maker = bool(card.on_reject_card_id) or card_idx == len(cards) - 1
            cards_before = [c for c in cards[:card_idx] if c.id == card.on_reject_card_id]
            cards_after  = cards[card_idx + 1:] if card_idx + 1 < len(cards) else []

            agent_context = _get_agent_context(agent, role)
            prompt_text = build_role_prompt(
                role=role,
                agent=agent,
                card=card,
                prev_output=prev_output,
                user_query=user_query,
                agent_context=agent_context,
                step_number=step_number + 1,
                iteration=iteration,
                feedback=feedback,
                is_decision_maker=is_decision_maker,
                cards_after=cards_before if card.on_reject_card_id else cards_after,
                db=db,
                shared_memory=shared_mem or None,
            )

            step_number += 1
            step = WorkflowExecutionStep(
                execution_id=execution.id,
                step_number=step_number,
                card_id=card.id,
                card_name=card.name,
                role_name=role.role_name if role else None,
                agent_name=agent.name if agent else None,
                iteration=iteration,
                input_text=feedback or prev_output or user_query,
                prompt_used=prompt_text,
                status="running",
            )
            db.add(step)
            db.flush()

            # Build module tool system content
            active_module_tools = [t for t in _compute_effective_tools(agent, role) if t in MODULE_TOOLS]

            system_content = (
                "You are a named AI agent in a multi-agent organisation. "
                "Follow your role instructions precisely. "
                "Always end with a [DECISION: ...] tag when instructed."
            )
            if active_module_tools:
                tag_map = {
                    "reports":     "[RUN_REPORT: ...]",
                    "development": "[CREATE_DEV_PLAN: ...]",
                    "dashboards":  "[DESIGN_DASHBOARD: ...]",
                    "testing":     "[GENERATE_TESTS: ...]",
                    "sql_exec":    "[EXEC_SQL]\nSELECT ...\n[/EXEC_SQL]",
                }
                required_tags = ", ".join(tag_map[t] for t in active_module_tools if t in tag_map)
                system_content += (
                    f"\n\nCRITICAL INSTRUCTION: You MUST use these action tags: {required_tags}."
                )

            # Model routing: role override → execution model
            step_model      = (getattr(role, "model_override", None) or model) if role else model
            step_max_tokens = getattr(role, "max_tokens_per_call", None) or 1400

            t_start = time.monotonic()
            step_status   = "success"
            output_text   = ""
            decision_data = {"action": None, "target_name": None, "notes": None}

            try:
                resp = client.chat.completions.create(
                    model=step_model,
                    messages=[
                        {"role": "system", "content": system_content},
                        {"role": "user",   "content": prompt_text},
                    ],
                    temperature=0.35,
                    max_tokens=step_max_tokens,
                    timeout=55,
                )
                output_text = resp.choices[0].message.content or ""
                # Cost tracking
                if hasattr(resp, "usage") and resp.usage:
                    cin, cout = COST_PER_1K.get(step_model, (0.001, 0.002))
                    execution.total_tokens_in  = (execution.total_tokens_in or 0) + (resp.usage.prompt_tokens or 0)
                    execution.total_tokens_out = (execution.total_tokens_out or 0) + (resp.usage.completion_tokens or 0)
                    step_cost = (resp.usage.prompt_tokens / 1000) * cin + (resp.usage.completion_tokens / 1000) * cout
                    execution.estimated_cost_usd = (execution.estimated_cost_usd or 0.0) + step_cost
                try:
                    output_text = execute_module_actions(output_text, conn_id, db, step_model)
                except Exception:
                    pass
                decision_data = parse_decision(output_text)
            except Exception as exc:
                output_text  = f"[Error: {str(exc)[:300]}]"
                step_status  = "failed"

            elapsed_ms = int((time.monotonic() - t_start) * 1000)

            # Parse confidence/risk/MEMO tags
            confidence_score = None
            conf_m = re.search(r'\[CONFIDENCE:\s*([\d.]+)\]', output_text, re.IGNORECASE)
            if conf_m:
                try:
                    confidence_score = float(conf_m.group(1))
                except Exception:
                    pass

            risk_data = None
            risk_m = re.search(r'\[RISK:\s*(\{[^}]+\})\]', output_text, re.IGNORECASE)
            if risk_m:
                try:
                    risk_data = json.loads(risk_m.group(1))
                except Exception:
                    pass

            for memo_m in re.finditer(r'\[MEMO:\s*(\{[^}]+\})\]', output_text, re.IGNORECASE):
                try:
                    entry = json.loads(memo_m.group(1))
                    entry["written_by"]      = role.role_name if role else (agent.name if agent else "unknown")
                    entry["written_at_step"] = step_number
                    key = entry.get("key")
                    if key:
                        shared_mem = [m for m in shared_mem if m.get("key") != key]
                    shared_mem.append(entry)
                except Exception:
                    pass

            # Cap memory at 50 — drop LOW severity first
            while len(shared_mem) > 50:
                low_idx = next((i for i, m in enumerate(shared_mem) if m.get("severity") == "LOW"), None)
                shared_mem.pop(low_idx if low_idx is not None else 0)

            if shared_mem:
                execution.shared_memory_json = json.dumps(shared_mem)
                execution.memory_version = (execution.memory_version or 0) + 1

            # Update avg_confidence on execution
            if confidence_score is not None:
                existing_conf = getattr(execution, "avg_confidence", None)
                execution.avg_confidence = (
                    round((existing_conf + confidence_score) / 2, 3)
                    if existing_conf is not None else confidence_score
                )
                if risk_data and risk_data.get("severity") in ("HIGH", "CRITICAL"):
                    current_max = getattr(execution, "max_risk_level", None)
                    sev_order = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
                    if not current_max or sev_order.get(risk_data["severity"], 0) > sev_order.get(current_max, 0):
                        execution.max_risk_level = risk_data["severity"]

            auto_hitl = bool(
                risk_data and risk_data.get("severity") in ("HIGH", "CRITICAL")
            )

            step.output_text       = output_text
            step.status            = step_status
            step.execution_time_ms = elapsed_ms
            step.decision          = decision_data["action"]
            step.decision_notes    = decision_data["notes"]
            step.confidence_score  = confidence_score
            step.risk_json         = json.dumps(risk_data) if risk_data else None
            step.auto_hitl         = auto_hitl
            db.flush()
            steps_out.append(_step_dict(step))

            # Emit completed step
            yield {"type": "step", "step": _step_dict(step)}

            # ── Project-level human approval gate ─────────────────────────────
            if project_id and role and step_status != "failed":
                role_key = _normalize_role(role.role_name)
                if _step_needs_human_approval(db, project_id, role_key):
                    from api.services.approval_service import create_approval_request as _create_req
                    approval_req = _create_req(
                        db, project_id, triggered_by_id,
                        context_type="agentic_step",
                        context_id=f"{execution.id}:{card.id}:{step_number}",
                    )
                    if approval_req:
                        step.approval_request_id = approval_req.id
                        execution.status = "pending_approval"
                        execution.paused_card_id = card.id
                        db.flush()
                        yield {
                            "type": "approval_required",
                            "execution_id": execution.id,
                            "step_id": step.id,
                            "approval_request_id": approval_req.id,
                            "required_role": role_key,
                            "card_name": card.name,
                        }
                        return  # end SSE stream; resume via /executions/{id}/stream-resume

            # Routing
            action = decision_data["action"]
            if step_status == "failed":
                prev_output = output_text
                feedback    = None
                card_idx   += 1
            elif action in ("REJECT", "REVISE") and card.on_reject_card_id:
                target_idx = card_index.get(card.on_reject_card_id)
                if target_idx is not None:
                    feedback    = decision_data["notes"] or f"{agent.name if agent else card.name} requested revision."
                    prev_output = output_text
                    card_idx    = target_idx
                else:
                    prev_output = output_text
                    feedback    = None
                    card_idx   += 1
            else:
                prev_output = output_text
                feedback    = None
                card_idx   += 1

            execution.completed_steps = step_number
            db.flush()

        # Finalise
        any_failed    = any(s["status"] in ("failed", "escalated") for s in steps_out)
        any_escalated = any(s["status"] == "escalated"              for s in steps_out)
        execution.status        = "escalated" if any_escalated else ("partial" if any_failed else "success")
        execution.final_summary = prev_output
        execution.finished_at   = datetime.utcnow()
        db.commit()

        # Post-execution hooks (best-effort — never block the response)
        try:
            _extract_and_store_learnings(execution.id, db)
        except Exception:
            pass
        try:
            _evaluate_ops_alerts(execution.id, db)
        except Exception:
            pass

        yield {
            "type":      "done",
            "execution": _exec_dict(execution),
            "steps":     steps_out,
        }

    except Exception as exc:
        yield {"type": "error", "message": str(exc)[:400]}


# ── Post-execution hooks ──────────────────────────────────────────────────────

def _extract_and_store_learnings(execution_id: int, db: Session) -> list:
    """Extract KB learnings from approved steps of a completed execution."""
    from api.models import WorkflowExecution, WorkflowExecutionStep, KnowledgeEntry
    execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution_id).first()
    if not execution:
        return []
    steps = (
        db.query(WorkflowExecutionStep)
        .filter(
            WorkflowExecutionStep.execution_id == execution_id,
            WorkflowExecutionStep.decision == "APPROVE",
            WorkflowExecutionStep.status == "success",
        )
        .all()
    )
    if not steps:
        return []
    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        return []
    combined = "\n\n---\n\n".join(
        f"[Step {s.step_number} / {s.role_name}]\n{s.output_text or ''}" for s in steps
    )[:8000]
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    system = (
        "You are a knowledge extraction agent. From workflow execution outputs, identify valuable operational "
        "learnings: decisions, issues resolved, remediation patterns, QA findings.\n"
        "Return a JSON array (max 10 items), each: "
        "{\"title\":str,\"type\":\"Issue|Process|UseCase|Question\",\"system\":str,"
        "\"op_category\":\"BusinessProcess|ReconRule|Lineage|DCTMapping|IncidentHistory|Remediation|Ownership\","
        "\"summary\":str,\"detailed_explanation\":str,\"severity\":\"LOW|MEDIUM|HIGH|CRITICAL\",\"confidence\":0.0-1.0}\n"
        "Return [] if no learnings. Return ONLY valid JSON array."
    )
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": system}, {"role": "user", "content": combined}],
            temperature=0.2, max_tokens=1200, timeout=30,
        )
        candidates = json.loads(resp.choices[0].message.content or "[]")
    except Exception:
        return []
    ALLOWED_CATS = {
        "BusinessProcess", "ReconRule", "Lineage", "DCTMapping",
        "IncidentHistory", "Remediation", "Ownership",
    }
    inserted: list[dict] = []
    for c in candidates[:10]:
        if not isinstance(c, dict) or c.get("op_category") not in ALLOWED_CATS:
            continue
        conf = c.get("confidence") or 0
        if conf < 0.6:
            kb_status = "LOW_QUALITY"
        elif c.get("severity") == "CRITICAL":
            kb_status = "PENDING_APPROVAL"
        else:
            kb_status = "READY_FOR_EMBEDDING"
        entry = KnowledgeEntry(
            title=c.get("title", "Extracted Learning")[:500],
            type=c.get("type", "Process"),
            system=c.get("system", "General"),
            op_category=c.get("op_category"),
            severity=c.get("severity"),
            summary=c.get("summary"),
            detailed_explanation=c.get("detailed_explanation"),
            source_type="AI-Workflow",
            status=kb_status,
            embedding_status="pending",
        )
        db.add(entry)
        db.flush()
        inserted.append({"entry_id": entry.id, "title": entry.title, "status": kb_status})
    if inserted:
        execution.learnings_extracted_json = json.dumps(inserted)
        db.commit()
    return inserted


def _evaluate_ops_alerts(execution_id: int, db: Session) -> None:
    """Evaluate post-execution alert rules. Never raises externally."""
    try:
        from datetime import timedelta
        from api.models import WorkflowExecution, OpsAlert
        execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution_id).first()
        if not execution:
            return
        project_id = execution.project_id
        avg_conf = getattr(execution, "avg_confidence", None)
        if avg_conf is not None and avg_conf < 0.60:
            recent = (
                db.query(WorkflowExecution)
                .filter(
                    WorkflowExecution.project_id == project_id,
                    WorkflowExecution.avg_confidence.isnot(None),
                    WorkflowExecution.id != execution_id,
                )
                .order_by(WorkflowExecution.id.desc()).limit(2).all()
            )
            if len(recent) >= 2 and all((r.avg_confidence or 1.0) < 0.60 for r in recent):
                db.add(OpsAlert(
                    alert_type="LOW_CONFIDENCE", severity="MEDIUM", project_id=project_id,
                    message=f"3 consecutive executions have avg_confidence < 0.60 (latest: #{execution_id})",
                    context_json=json.dumps({"execution_id": execution_id, "avg_confidence": avg_conf}),
                ))
                db.flush()
        stale_cutoff = datetime.utcnow() - timedelta(hours=24)
        for stale in (
            db.query(WorkflowExecution)
            .filter(WorkflowExecution.status == "pending_approval", WorkflowExecution.created_at < stale_cutoff)
            .all()
        ):
            if not db.query(OpsAlert).filter(
                OpsAlert.alert_type == "HITL_LOOP",
                OpsAlert.is_resolved == False,  # noqa: E712
                OpsAlert.context_json.like(f'%"execution_id": {stale.id}%'),
            ).first():
                db.add(OpsAlert(
                    alert_type="HITL_LOOP", severity="HIGH", project_id=stale.project_id,
                    message=f"Execution #{stale.id} has been pending_approval for >24 hours",
                    context_json=json.dumps({"execution_id": stale.id}),
                ))
                db.flush()
        db.commit()
    except Exception:
        pass


# ── Resume a paused workflow ──────────────────────────────────────────────────

def resume_stream_workflow(execution_id: int, db):
    """
    Resume a workflow execution that was paused at 'pending_approval'.
    Picks up from the card AFTER execution.paused_card_id.
    Yields the same SSE event types as stream_workflow.
    """
    from openai import OpenAI
    from api.models import (
        AgentCard, AgentRole, AIAgent,
        WorkflowExecution, WorkflowExecutionStep,
    )

    try:
        execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution_id).first()
        if not execution:
            yield {"type": "error", "message": "Execution not found"}
            return
        if execution.status != "pending_approval":
            yield {"type": "error", "message": f"Execution cannot be resumed (status: {execution.status})"}
            return

        api_key = (settings.OPENAI_API_KEY or "").strip()
        if not api_key:
            yield {"type": "error", "message": "OpenAI API key not configured"}
            return

        client = OpenAI(api_key=api_key)

        from sqlalchemy import or_ as _or
        resume_project_id = execution.project_id
        cards_q = db.query(AgentCard).filter(AgentCard.is_active == True)  # noqa: E712
        if resume_project_id:
            cards_q = cards_q.filter(_or(AgentCard.project_id == resume_project_id, AgentCard.project_id.is_(None)))
        cards = cards_q.order_by(AgentCard.execution_order).all()
        if not cards:
            yield {"type": "error", "message": "No active workflow cards found"}
            return

        card_index: dict[int, int] = {c.id: i for i, c in enumerate(cards)}
        paused_idx = card_index.get(execution.paused_card_id, -1) if execution.paused_card_id else -1
        card_idx = paused_idx + 1  # start from the next card

        # Reconstruct state from saved steps
        last_step = (
            db.query(WorkflowExecutionStep)
            .filter(
                WorkflowExecutionStep.execution_id == execution_id,
                WorkflowExecutionStep.status.in_(["success", "failed", "escalated"]),
            )
            .order_by(WorkflowExecutionStep.step_number.desc())
            .first()
        )
        prev_output: Optional[str] = last_step.output_text if last_step else execution.user_query
        step_number: int = last_step.step_number if last_step else 0

        execution.status = "running"
        db.flush()

        yield {
            "type": "start",
            "execution_id": execution.id,
            "total_steps": len(cards),
            "resumed": True,
        }

        agent_contexts: dict = {}

        def _get_agent_context(agent, role) -> str:
            if agent is None:
                return ""
            cache_key = (agent.id, role.id if role else None)
            if cache_key not in agent_contexts:
                agent_contexts[cache_key] = _build_agent_context(agent, role, execution.conn_id, db)
            return agent_contexts[cache_key]

        feedback: Optional[str] = None
        card_iterations: dict[int, int] = defaultdict(int)
        steps_out: list[dict] = []
        project_id = execution.project_id
        # Restore shared memory from paused execution
        shared_mem: list[dict] = []
        try:
            if execution.shared_memory_json:
                shared_mem = json.loads(execution.shared_memory_json) or []
        except Exception:
            pass

        while card_idx < len(cards):
            card = cards[card_idx]
            card_iterations[card.id] += 1
            iteration = card_iterations[card.id]

            agent = db.query(AIAgent).filter(AIAgent.id == card.agent_id).first() if card.agent_id else None
            role_id = card.role_id or (agent.role_id if agent and hasattr(agent, "role_id") else None)
            role = db.query(AgentRole).filter(AgentRole.id == role_id).first() if role_id else None

            if iteration > card.max_iterations:
                step_number += 1
                step = WorkflowExecutionStep(
                    execution_id=execution.id,
                    step_number=step_number,
                    card_id=card.id,
                    card_name=card.name,
                    iteration=iteration,
                    input_text=prev_output or execution.user_query,
                    output_text=f"[ESCALATED] Max iterations ({card.max_iterations}) reached.",
                    status="escalated",
                    decision="ESCALATED",
                )
                db.add(step)
                db.flush()
                steps_out.append(_step_dict(step))
                yield {"type": "step", "step": _step_dict(step)}
                prev_output = step.output_text
                feedback = None
                card_idx += 1
                execution.completed_steps = step_number
                db.flush()
                continue

            yield {
                "type": "thinking",
                "step_number": step_number + 1,
                "card_name":   card.name,
                "agent_name":  agent.name if agent else None,
                "role_name":   role.role_name if role else None,
                "iteration":   iteration,
            }

            is_decision_maker = bool(card.on_reject_card_id) or card_idx == len(cards) - 1
            cards_before = [c for c in cards[:card_idx] if c.id == card.on_reject_card_id]
            cards_after  = cards[card_idx + 1:] if card_idx + 1 < len(cards) else []

            agent_context = _get_agent_context(agent, role)
            prompt_text = build_role_prompt(
                role=role,
                agent=agent,
                card=card,
                prev_output=prev_output,
                user_query=execution.user_query,
                agent_context=agent_context,
                step_number=step_number + 1,
                iteration=iteration,
                feedback=feedback,
                is_decision_maker=is_decision_maker,
                cards_after=cards_before if card.on_reject_card_id else cards_after,
                db=db,
                shared_memory=shared_mem or None,
            )

            step_number += 1
            step = WorkflowExecutionStep(
                execution_id=execution.id,
                step_number=step_number,
                card_id=card.id,
                card_name=card.name,
                role_name=role.role_name if role else None,
                agent_name=agent.name if agent else None,
                iteration=iteration,
                input_text=feedback or prev_output or execution.user_query,
                prompt_used=prompt_text,
                status="running",
            )
            db.add(step)
            db.flush()

            active_module_tools = [t for t in _compute_effective_tools(agent, role) if t in MODULE_TOOLS]

            system_content = (
                "You are a named AI agent in a multi-agent organisation. "
                "Follow your role instructions precisely. "
                "Always end with a [DECISION: ...] tag when instructed."
            )
            if active_module_tools:
                tag_map = {
                    "reports":     "[RUN_REPORT: ...]",
                    "development": "[CREATE_DEV_PLAN: ...]",
                    "dashboards":  "[DESIGN_DASHBOARD: ...]",
                    "testing":     "[GENERATE_TESTS: ...]",
                    "sql_exec":    "[EXEC_SQL]\nSELECT ...\n[/EXEC_SQL]",
                }
                required_tags = ", ".join(tag_map[t] for t in active_module_tools if t in tag_map)
                system_content += f"\n\nCRITICAL INSTRUCTION: You MUST use these action tags: {required_tags}."

            step_model      = (getattr(role, "model_override", None) or execution.model) if role else execution.model
            step_max_tokens = getattr(role, "max_tokens_per_call", None) or 1400

            t_start = time.monotonic()
            step_status   = "success"
            output_text   = ""
            decision_data = {"action": None, "target_name": None, "notes": None}

            try:
                resp = client.chat.completions.create(
                    model=step_model,
                    messages=[
                        {"role": "system", "content": system_content},
                        {"role": "user",   "content": prompt_text},
                    ],
                    temperature=0.35,
                    max_tokens=step_max_tokens,
                    timeout=55,
                )
                output_text = resp.choices[0].message.content or ""
                if hasattr(resp, "usage") and resp.usage:
                    cin, cout = COST_PER_1K.get(step_model, (0.001, 0.002))
                    execution.total_tokens_in  = (execution.total_tokens_in or 0) + (resp.usage.prompt_tokens or 0)
                    execution.total_tokens_out = (execution.total_tokens_out or 0) + (resp.usage.completion_tokens or 0)
                    execution.estimated_cost_usd = (execution.estimated_cost_usd or 0.0) + (
                        (resp.usage.prompt_tokens / 1000) * cin + (resp.usage.completion_tokens / 1000) * cout
                    )
                try:
                    output_text = execute_module_actions(output_text, execution.conn_id, db, step_model)
                except Exception:
                    pass
                decision_data = parse_decision(output_text)
            except Exception as exc:
                output_text  = f"[Error: {str(exc)[:300]}]"
                step_status  = "failed"

            elapsed_ms = int((time.monotonic() - t_start) * 1000)

            confidence_score = None
            conf_m = re.search(r'\[CONFIDENCE:\s*([\d.]+)\]', output_text, re.IGNORECASE)
            if conf_m:
                try:
                    confidence_score = float(conf_m.group(1))
                except Exception:
                    pass

            risk_data = None
            risk_m = re.search(r'\[RISK:\s*(\{[^}]+\})\]', output_text, re.IGNORECASE)
            if risk_m:
                try:
                    risk_data = json.loads(risk_m.group(1))
                except Exception:
                    pass

            for memo_m in re.finditer(r'\[MEMO:\s*(\{[^}]+\})\]', output_text, re.IGNORECASE):
                try:
                    entry = json.loads(memo_m.group(1))
                    entry["written_by"]      = role.role_name if role else (agent.name if agent else "unknown")
                    entry["written_at_step"] = step_number
                    key = entry.get("key")
                    if key:
                        shared_mem = [m for m in shared_mem if m.get("key") != key]
                    shared_mem.append(entry)
                except Exception:
                    pass
            while len(shared_mem) > 50:
                low_idx = next((i for i, m in enumerate(shared_mem) if m.get("severity") == "LOW"), None)
                shared_mem.pop(low_idx if low_idx is not None else 0)
            if shared_mem:
                execution.shared_memory_json = json.dumps(shared_mem)
                execution.memory_version = (execution.memory_version or 0) + 1

            if confidence_score is not None:
                existing_conf = getattr(execution, "avg_confidence", None)
                execution.avg_confidence = (
                    round((existing_conf + confidence_score) / 2, 3)
                    if existing_conf is not None else confidence_score
                )
            if risk_data and risk_data.get("severity") in ("HIGH", "CRITICAL"):
                sev_order = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
                current_max = getattr(execution, "max_risk_level", None)
                if not current_max or sev_order.get(risk_data["severity"], 0) > sev_order.get(current_max, 0):
                    execution.max_risk_level = risk_data["severity"]

            auto_hitl = bool(risk_data and risk_data.get("severity") in ("HIGH", "CRITICAL"))

            step.output_text       = output_text
            step.status            = step_status
            step.execution_time_ms = elapsed_ms
            step.decision          = decision_data["action"]
            step.decision_notes    = decision_data["notes"]
            step.confidence_score  = confidence_score
            step.risk_json         = json.dumps(risk_data) if risk_data else None
            step.auto_hitl         = auto_hitl
            db.flush()
            steps_out.append(_step_dict(step))

            yield {"type": "step", "step": _step_dict(step)}

            # ── Project-level human approval gate ─────────────────────────────
            if project_id and role and step_status != "failed":
                role_key = _normalize_role(role.role_name)
                if _step_needs_human_approval(db, project_id, role_key):
                    from api.services.approval_service import create_approval_request as _create_req
                    approval_req = _create_req(
                        db, project_id, None,
                        context_type="agentic_step",
                        context_id=f"{execution.id}:{card.id}:{step_number}",
                    )
                    if approval_req:
                        step.approval_request_id = approval_req.id
                        execution.status = "pending_approval"
                        execution.paused_card_id = card.id
                        db.flush()
                        yield {
                            "type": "approval_required",
                            "execution_id": execution.id,
                            "step_id": step.id,
                            "approval_request_id": approval_req.id,
                            "required_role": role_key,
                            "card_name": card.name,
                        }
                        return

            action = decision_data["action"]
            if step_status == "failed":
                prev_output = output_text
                feedback    = None
                card_idx   += 1
            elif action in ("REJECT", "REVISE") and card.on_reject_card_id:
                target_idx = card_index.get(card.on_reject_card_id)
                if target_idx is not None:
                    feedback    = decision_data["notes"] or f"{agent.name if agent else card.name} requested revision."
                    prev_output = output_text
                    card_idx    = target_idx
                else:
                    prev_output = output_text
                    feedback    = None
                    card_idx   += 1
            else:
                prev_output = output_text
                feedback    = None
                card_idx   += 1

            execution.completed_steps = step_number
            db.flush()

        any_failed    = any(s["status"] in ("failed", "escalated") for s in steps_out)
        any_escalated = any(s["status"] == "escalated"              for s in steps_out)
        execution.status        = "escalated" if any_escalated else ("partial" if any_failed else "success")
        execution.final_summary = prev_output
        execution.finished_at   = datetime.utcnow()
        db.commit()

        try:
            _extract_and_store_learnings(execution.id, db)
        except Exception:
            pass
        try:
            _evaluate_ops_alerts(execution.id, db)
        except Exception:
            pass

        yield {
            "type":      "done",
            "execution": _exec_dict(execution),
            "steps":     steps_out,
        }

    except Exception as exc:
        yield {"type": "error", "message": str(exc)[:400]}
