"""
agent_engine.py — Runtime execution engine for AI Agents.

Flow:
  1. Receive agent goal + schema context
  2. Ask LLM to produce a JSON execution plan (steps with type + config)
  3. Validate every SQL step through validation_guard
  4. Execute approved steps against the connection
  5. Return structured results for logging
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from api.config import settings
from api.services.context_cache import get_or_build, ContextPayload
from api.services.validation_guard import validate_sql_safety
from api.services.connector import preview_data


# ── Step types the agent can decide to execute ─────────────────
ALLOWED_STEP_TYPES = {"sql", "email", "summary"}


def _llm(messages: list[dict], model: str = "gpt-4o-mini") -> str:
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    resp = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    return resp.choices[0].message.content or ""


def _build_plan_prompt(goal: str, schema_summary: str) -> list[dict]:
    return [
        {
            "role": "system",
            "content": (
                "You are an autonomous data agent. Given a goal and database schema, "
                "produce a JSON execution plan.\n\n"
                "Return ONLY valid JSON with this structure:\n"
                "{\n"
                '  "plan_title": "short title",\n'
                '  "steps": [\n'
                "    {\n"
                '      "step": 1,\n'
                '      "type": "sql",\n'
                '      "description": "what this step does",\n'
                '      "sql": "SELECT ...",\n'
                '      "on_error": "continue"\n'
                "    },\n"
                "    {\n"
                '      "step": 2,\n'
                '      "type": "summary",\n'
                '      "description": "summarize results"\n'
                "    }\n"
                "  ]\n"
                "}\n\n"
                "RULES:\n"
                "- Only use tables/columns that exist in the schema\n"
                "- Use SELECT for data retrieval, avoid DROP/TRUNCATE/DELETE unless the goal explicitly requires it\n"
                "- For email steps, add: {\"to\": \"...\", \"subject\": \"...\", \"body\": \"...\"}\n"
                "- Keep steps minimal and focused on the goal\n"
                "- SQL must be valid T-SQL (SQL Server syntax)"
            ),
        },
        {
            "role": "user",
            "content": (
                f"GOAL: {goal}\n\n"
                f"DATABASE SCHEMA:\n{schema_summary}\n\n"
                "Generate the execution plan as JSON."
            ),
        },
    ]


def _schema_summary(context: ContextPayload) -> str:
    """Convert context cache into a compact schema string for the prompt."""
    lines: list[str] = []
    for entry in (context.tables or []):
        table = entry.get("table", "?")
        cols = entry.get("columns", [])
        col_names = ", ".join(c["column"] for c in cols if "column" in c)
        lines.append(f"  {table}({col_names})")
    return "Tables:\n" + "\n".join(lines) if lines else "Schema not available."


def run_agent(
    agent_id: int,
    goal: str,
    conn_id: Optional[int],
    model: str,
    db: Session,
) -> dict:
    """
    Execute an agent run. Returns a result dict consumed by the router to
    create an AIAgentLog entry.
    """
    started = time.time()
    steps_executed = 0
    step_results: list[dict] = []
    plan: dict = {}

    try:
        # 1. Build schema context
        context: ContextPayload = ContextPayload(conn_id=conn_id or 0)
        if conn_id:
            try:
                context = get_or_build(conn_id, db)
            except Exception:
                pass  # keep empty ContextPayload

        schema_text = _schema_summary(context)

        # 2. Ask LLM for execution plan
        raw = _llm(_build_plan_prompt(goal, schema_text), model=model)
        plan = json.loads(raw)
        plan_steps: list[dict] = plan.get("steps", [])

        # 3. Execute each step
        for step in plan_steps:
            stype = step.get("type", "")
            sdesc = step.get("description", f"Step {step.get('step', '?')}")
            result_entry: dict = {"step": step.get("step"), "type": stype, "description": sdesc}

            if stype == "sql":
                sql = (step.get("sql") or "").strip()
                if not sql:
                    result_entry["status"] = "skipped"
                    result_entry["reason"] = "No SQL provided"
                    step_results.append(result_entry)
                    continue

                # Validate before execution
                safety = validate_sql_safety(sql)
                if not safety.passed:
                    result_entry["status"] = "blocked"
                    result_entry["reason"] = "; ".join(safety.errors)
                    step_results.append(result_entry)
                    if step.get("on_error") != "continue":
                        break
                    continue

                if not conn_id:
                    result_entry["status"] = "skipped"
                    result_entry["reason"] = "No connection configured for agent"
                    step_results.append(result_entry)
                    continue

                try:
                    from api.models import SourceConnection
                    from api.services.encryption import decrypt

                    conn_row = db.query(SourceConnection).filter_by(id=conn_id).first()
                    if not conn_row:
                        raise ValueError(f"Connection {conn_id} not found")

                    cfg = {
                        "source_type": conn_row.source_type,
                        "dialect":     conn_row.dialect,
                        "host":        conn_row.host,
                        "port":        conn_row.port,
                        "database":    conn_row.database_name,
                        "schema":      conn_row.schema_name,
                        "username":    conn_row.username,
                        "password":    decrypt(conn_row.password_enc) if conn_row.password_enc else "",
                        # Snowflake fields (ignored for SQL connections)
                        "account":     conn_row.sf_account,
                        "warehouse":   conn_row.sf_warehouse,
                        "sf_role":     conn_row.sf_role,
                        "query":       sql,
                    }
                    result = preview_data(cfg, limit=500)
                    result_entry["status"] = "success"
                    result_entry["rows_returned"] = result.get("total", 0)
                    result_entry["columns"] = result.get("columns", [])
                    result_entry["sample"] = result.get("rows", [])[:5]
                    steps_executed += 1
                except Exception as exc:
                    result_entry["status"] = "error"
                    result_entry["error"] = str(exc)[:300]
                    if step.get("on_error") != "continue":
                        step_results.append(result_entry)
                        break

            elif stype == "summary":
                # AI summarises what has happened so far
                result_entry["status"] = "success"
                result_entry["note"] = "Summary step — results logged above"
                steps_executed += 1

            elif stype == "email":
                # Email sending requires smtp settings — mark as pending
                result_entry["status"] = "pending"
                result_entry["note"] = "Email step queued (requires SMTP configuration)"
                steps_executed += 1

            else:
                result_entry["status"] = "skipped"
                result_entry["reason"] = f"Unknown step type: {stype!r}"

            step_results.append(result_entry)

        elapsed_ms = int((time.time() - started) * 1000)
        success_count = sum(1 for r in step_results if r.get("status") == "success")
        blocked_count = sum(1 for r in step_results if r.get("status") == "blocked")
        error_count   = sum(1 for r in step_results if r.get("status") == "error")

        overall = (
            "success" if error_count == 0 and blocked_count == 0
            else "partial" if success_count > 0
            else "failed"
        )

        summary = (
            f"Executed {steps_executed}/{len(plan_steps)} steps. "
            f"Success: {success_count}, Blocked: {blocked_count}, Errors: {error_count}."
        )

        return {
            "status": overall,
            "generated_plan": json.dumps({"plan": plan, "results": step_results}),
            "steps_executed": steps_executed,
            "result_summary": summary,
            "execution_time": elapsed_ms,
            "finished_at": datetime.utcnow(),
            "error": None,
        }

    except Exception as exc:
        elapsed_ms = int((time.time() - started) * 1000)
        return {
            "status": "failed",
            "generated_plan": json.dumps(plan) if plan else None,
            "steps_executed": steps_executed,
            "result_summary": None,
            "execution_time": elapsed_ms,
            "finished_at": datetime.utcnow(),
            "error": str(exc)[:2000],
        }
