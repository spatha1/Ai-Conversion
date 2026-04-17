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
}

# Tool categories for UI grouping
CONTEXT_TOOLS = ["db", "query_examples", "business_rules", "api", "jira", "test_cases", "email"]
MODULE_TOOLS  = ["reports", "development", "dashboards", "testing"]

ALL_TOOLS = list(TOOL_LABELS.keys())


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


def _build_agent_context(agent, conn_id: Optional[int], db: Session) -> str:
    """
    Build the full KT + access context for a named agent based on their tools.
    This is the 'onboarding package' injected into every prompt for this agent.
    """
    tools: list[str] = []
    try:
        if agent and agent.tools_json:
            tools = json.loads(agent.tools_json)
    except Exception:
        tools = []

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
}


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

    if appended:
        return output_text + "\n" + "\n".join(appended)
    return output_text


# ── Prompt builder ────────────────────────────────────────────────────────────

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
        lines.append(
            "\nIMPORTANT — Role boundary: You are a Business Analyst. "
            "Your job is to gather requirements, analyse the request, and produce structured specs or a BRD. "
            "Do NOT write SQL queries, stored procedures, or code. "
            "If you have schema access, use it only to understand what data is available, not to write queries."
        )
    elif is_mgr_role:
        lines.append(
            "\nIMPORTANT — Role boundary: You are in a management/review role. "
            "Your ONLY job is to review the work produced in the previous step, "
            "provide clear feedback, and make a decision (APPROVE / REJECT). "
            "You must NEVER write SQL queries, stored procedures, or any code — even if you have schema access. "
            "Even if the task description asks for queries, YOUR job is to review and approve what the Developer writes — not to write it yourself. "
            "Write a brief review summary and always end with the DECISION tag."
        )
    elif is_qa_role:
        lines.append(
            "\nIMPORTANT — Role boundary: You are a QA / Testing specialist. "
            "Your job is to define test scenarios, validation criteria, and raise defects. "
            "Do NOT write implementation SQL or business logic. "
            "Focus on what needs to be tested and how to verify the result."
        )
    elif is_dev_role:
        lines.append(
            "\nIMPORTANT — Role boundary: You are a Developer. "
            "Your job is to write concrete SQL, stored procedures, or technical implementation based "
            "on the requirements handed to you from the previous step. "
            "Use the schema context to write accurate, runnable SQL."
        )
    else:
        lines.append(
            "\nStay within the boundaries of your role. Do not produce artefacts that belong to a "
            "different role (e.g. do not write SQL unless you are a Developer)."
        )

    if is_decision_maker:
        next_names = " or ".join(c.name for c in cards_after[:2]) if cards_after else "the previous step"
        lines.append(
            f"\nYou MUST end your response with exactly one decision tag:\n"
            f"  [DECISION: APPROVE]   — work is satisfactory, proceed\n"
            f"  [DECISION: REJECT | Route to: <name> | Reason: <your specific feedback>]"
            f"   — send back for revision (e.g. Route to: {next_names})\n"
            f"  [DECISION: REVISE | Route to: <name> | Reason: <your specific feedback>]"
            f"   — same as REJECT but signals a scope change"
        )
    else:
        lines.append(
            "\nOptionally, if you need to flag a blocker or escalate, you may add:\n"
            "  [DECISION: REJECT | Route to: <name> | Reason: <blocker description>]"
        )

    return "\n".join(lines)


# ── Main workflow runner ──────────────────────────────────────────────────────

def run_workflow(
    conn_id: Optional[int],
    user_query: str,
    model: str,
    db: Session,
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

    def _get_agent_context(agent) -> str:
        if agent is None:
            return ""
        if agent.id not in agent_contexts:
            agent_contexts[agent.id] = _build_agent_context(agent, conn_id, db)
        return agent_contexts[agent.id]

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
    card_iterations: dict[int, int] = defaultdict(int)
    step_number  = 0
    card_idx     = 0
    steps_out: list[dict] = []

    while card_idx < len(cards):
        card  = cards[card_idx]

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
        agent_context = _get_agent_context(agent)
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
        agent_tools: list[str] = []
        try:
            if agent and agent.tools_json:
                agent_tools = json.loads(agent.tools_json)
        except Exception:
            agent_tools = []
        active_module_tools = [t for t in agent_tools if t in MODULE_TOOLS]

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
        "created_at":       s.created_at.isoformat() if s.created_at else None,
    }


# ── Streaming workflow generator ──────────────────────────────────────────────

def stream_workflow(
    conn_id: Optional[int],
    user_query: str,
    model: str,
    db,
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
        agent_contexts: dict[int, str] = {}

        def _get_agent_context(agent) -> str:
            if agent is None:
                return ""
            if agent.id not in agent_contexts:
                agent_contexts[agent.id] = _build_agent_context(agent, conn_id, db)
            return agent_contexts[agent.id]

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

            agent_context = _get_agent_context(agent)
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
            agent_tools: list[str] = []
            try:
                if agent and agent.tools_json:
                    agent_tools = json.loads(agent.tools_json)
            except Exception:
                pass
            active_module_tools = [t for t in agent_tools if t in MODULE_TOOLS]

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
                }
                required_tags = ", ".join(tag_map[t] for t in active_module_tools if t in tag_map)
                system_content += (
                    f"\n\nCRITICAL INSTRUCTION: You MUST use these action tags: {required_tags}."
                )

            t_start = time.monotonic()
            step_status   = "success"
            output_text   = ""
            decision_data = {"action": None, "target_name": None, "notes": None}

            try:
                resp = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_content},
                        {"role": "user",   "content": prompt_text},
                    ],
                    temperature=0.35,
                    max_tokens=1400,
                    timeout=55,
                )
                output_text = resp.choices[0].message.content or ""
                try:
                    output_text = execute_module_actions(output_text, conn_id, db, model)
                except Exception:
                    pass
                decision_data = parse_decision(output_text)
            except Exception as exc:
                output_text  = f"[Error: {str(exc)[:300]}]"
                step_status  = "failed"

            elapsed_ms = int((time.monotonic() - t_start) * 1000)

            step.output_text       = output_text
            step.status            = step_status
            step.execution_time_ms = elapsed_ms
            step.decision          = decision_data["action"]
            step.decision_notes    = decision_data["notes"]
            db.flush()
            steps_out.append(_step_dict(step))

            # Emit completed step
            yield {"type": "step", "step": _step_dict(step)}

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

        yield {
            "type":      "done",
            "execution": _exec_dict(execution),
            "steps":     steps_out,
        }

    except Exception as exc:
        yield {"type": "error", "message": str(exc)[:400]}
