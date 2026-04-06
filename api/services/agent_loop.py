"""
api/services/agent_loop.py

Autonomous AI Co-worker agent loop.

Implements a multi-step OpenAI tool-calling loop that:
  1. Receives a user request
  2. Plans and executes steps using the conversion pipeline tools
  3. Validates results and retries on failure
  4. Returns a structured AgentResult JSON

Usage:
    from api.services.agent_loop import run_coworker_agent
    result = run_coworker_agent(request="...", conn_id=7, db=db)
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

from sqlalchemy.orm import Session

from api.config import settings
from api.services.agent_prompts import COWORKER_SYSTEM_PROMPT, COWORKER_TOOLS
from api.services.agent_tools import dispatch_tool

log = logging.getLogger(__name__)

MAX_AGENT_ROUNDS = 8   # prevent infinite loops


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class StepRecord:
    step:    int
    tool:    str
    input:   dict
    output:  dict
    status:  str      # "ok" | "failed"
    summary: str
    elapsed_ms: int = 0


@dataclass
class AgentResult:
    problem:         str
    steps_executed:  list[StepRecord] = field(default_factory=list)
    findings:        str = ""
    root_cause:      str = "N/A"
    fix_applied:     str = "N/A"
    final_status:    str = "FAILED"   # "SUCCESS" or "FAILED"
    raw_llm_output:  str = ""

    def to_dict(self) -> dict:
        return {
            "problem":        self.problem,
            "steps_executed": [asdict(s) for s in self.steps_executed],
            "findings":       self.findings,
            "root_cause":     self.root_cause,
            "fix_applied":    self.fix_applied,
            "final_status":   self.final_status,
        }


# ── Agent loop ────────────────────────────────────────────────────────────────

def run_coworker_agent(
    request:    str,
    conn_id:    Optional[int],
    db:         Session,
    model:      str = "gpt-4o-mini",
    project_id: Optional[int] = None,
) -> AgentResult:
    """
    Run the autonomous Co-worker agent loop.

    Args:
        request:    The user's natural language request.
        conn_id:    Active source connection ID (may be None for generic requests).
        db:         SQLAlchemy session.
        model:      OpenAI model name.
        project_id: Optional project scope.

    Returns:
        AgentResult with all steps, findings, and final status.
    """
    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        return AgentResult(
            problem=request,
            findings="OpenAI API key not configured. Add OPENAI_API_KEY to .env",
            final_status="FAILED",
        )

    from openai import OpenAI
    client = OpenAI(api_key=api_key)

    result = AgentResult(problem=request)
    step_num = 0

    # ── Build initial messages ─────────────────────────────────────────────
    context_note = f"Active connection ID: {conn_id}" if conn_id else "No connection selected."
    if project_id:
        context_note += f"  Project ID: {project_id}."

    llm_messages: list[dict] = [
        {"role": "system",  "content": COWORKER_SYSTEM_PROMPT},
        {"role": "user",    "content": f"{request}\n\n[Context: {context_note}]"},
    ]

    log.info("[agent_loop] Starting agent. request=%r conn_id=%s", request[:80], conn_id)

    # ── Main loop ─────────────────────────────────────────────────────────
    for _round in range(MAX_AGENT_ROUNDS):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=llm_messages,
                tools=COWORKER_TOOLS,
                tool_choice="auto",
                temperature=0.1,
            )
        except Exception as exc:
            log.error("[agent_loop] OpenAI error: %s", exc)
            result.findings = f"OpenAI API error: {exc}"
            result.final_status = "FAILED"
            break

        choice = resp.choices[0]
        msg    = choice.message

        # ── No more tool calls → final answer ─────────────────────────────
        if not msg.tool_calls:
            final_text = msg.content or ""
            result.raw_llm_output = final_text
            _parse_structured_output(final_text, result)
            log.info("[agent_loop] Done after %d rounds, %d steps", _round + 1, len(result.steps_executed))
            break

        # ── Append assistant turn with tool calls ──────────────────────────
        llm_messages.append({
            "role":       "assistant",
            "content":    msg.content,
            "tool_calls": [
                {
                    "id":   tc.id,
                    "type": "function",
                    "function": {
                        "name":      tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in msg.tool_calls
            ],
        })

        # ── Execute each tool call ─────────────────────────────────────────
        for tc in msg.tool_calls:
            step_num += 1
            fn_name = tc.function.name
            try:
                fn_args = json.loads(tc.function.arguments)
            except Exception:
                fn_args = {}

            log.info("[agent_loop] Step %d: %s args=%s", step_num, fn_name, fn_args)

            t0 = time.monotonic()
            tool_result = dispatch_tool(fn_name, fn_args, db)
            elapsed_ms  = int((time.monotonic() - t0) * 1000)

            is_ok = tool_result.get("ok", False)
            summary = (
                tool_result.get("summary")
                or tool_result.get("error", "")
                or (f"{fn_name} ok" if is_ok else f"{fn_name} failed")
            )

            step = StepRecord(
                step=step_num,
                tool=fn_name,
                input=fn_args,
                output={k: v for k, v in tool_result.items() if k not in ("rows",)},  # skip large row dumps
                status="ok" if is_ok else "failed",
                summary=summary,
                elapsed_ms=elapsed_ms,
            )
            result.steps_executed.append(step)

            log.info("[agent_loop] Step %d result: status=%s summary=%r elapsed=%dms",
                     step_num, step.status, summary[:100], elapsed_ms)

            # Feed result back to LLM
            llm_messages.append({
                "role":         "tool",
                "tool_call_id": tc.id,
                "content":      json.dumps(tool_result)[:6000],
            })

    else:
        # Reached MAX_AGENT_ROUNDS without a final answer
        result.findings = (
            f"Agent reached maximum rounds ({MAX_AGENT_ROUNDS}) without completing. "
            "Try breaking the request into smaller tasks."
        )
        result.final_status = "FAILED"

    # ── Infer final_status from steps if LLM didn't produce structured output ─
    if result.final_status == "FAILED" and result.steps_executed:
        ok_steps     = [s for s in result.steps_executed if s.status == "ok"]
        failed_steps = [s for s in result.steps_executed if s.status == "failed"]
        if ok_steps and not failed_steps:
            result.final_status = "SUCCESS"
        if not result.findings:
            result.findings = (
                f"Completed {len(ok_steps)}/{len(result.steps_executed)} steps successfully."
                + (f" Failures: {[s.tool for s in failed_steps]}" if failed_steps else "")
            )

    return result


# ── Output parser ─────────────────────────────────────────────────────────────

def _parse_structured_output(text: str, result: AgentResult) -> None:
    """
    Extract the structured JSON block from the LLM's final response and
    populate the AgentResult fields.

    The LLM is instructed to emit:
    ```json
    { "problem": ..., "steps_executed": [...], "findings": ...,
      "root_cause": ..., "fix_applied": ..., "final_status": ... }
    ```
    We also accept a bare JSON block without fences.
    """
    import re

    # Try ```json ... ``` fence first
    m = re.search(r"```json\s*([\s\S]+?)```", text, re.IGNORECASE)
    if not m:
        # Try bare { ... } spanning multiple lines
        m = re.search(r"(\{[\s\S]*\"final_status\"[\s\S]*?\})", text)

    if m:
        raw = m.group(1).strip()
        # Strip trailing commas before } or ]  (common LLM mistake)
        raw = re.sub(r",\s*([}\]])", r"\1", raw)
        try:
            parsed = json.loads(raw)
            result.findings     = parsed.get("findings",     result.findings)
            result.root_cause   = parsed.get("root_cause",   result.root_cause)
            result.fix_applied  = parsed.get("fix_applied",  result.fix_applied)
            result.final_status = parsed.get("final_status", result.final_status)
            # Merge LLM-reported steps with already-executed steps
            llm_steps = parsed.get("steps_executed", [])
            if llm_steps and not result.steps_executed:
                result.steps_executed = [
                    StepRecord(
                        step=s.get("step", i + 1),
                        tool=s.get("tool", ""),
                        input={},
                        output={},
                        status=s.get("status", "ok"),
                        summary=s.get("summary", ""),
                    )
                    for i, s in enumerate(llm_steps)
                ]
            return
        except json.JSONDecodeError:
            pass

    # Fallback: extract fields with regex
    def _field(name: str) -> Optional[str]:
        m2 = re.search(rf'"{name}"\s*:\s*"([^"]*)"', text)
        return m2.group(1) if m2 else None

    if v := _field("findings"):
        result.findings = v
    if v := _field("root_cause"):
        result.root_cause = v
    if v := _field("fix_applied"):
        result.fix_applied = v
    if v := _field("final_status"):
        result.final_status = v

    # If none parsed, use the full text as findings
    if not result.findings:
        result.findings = text[:1000]
