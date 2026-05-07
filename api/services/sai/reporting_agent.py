"""
reporting_agent.py — Generates the 10-section executive operational report.
Uses GPT-4o-mini with prompt override support. Logs to AITraceLog.
"""
import json
import time
from datetime import datetime
from typing import Optional, AsyncGenerator
from sqlalchemy.orm import Session

from api.config import settings
from api.models import AITraceLog, PromptTemplate

_SYSTEM_PROMPT = """You are SAI — Swift Autonomous Intelligence, an Enterprise Physical AI Operations Platform.

Generate a structured 10-section operational report based on the analysis provided.
Return a valid JSON object with exactly these keys:
{
  "incident_summary": "string",
  "systems_impacted": ["list of system names"],
  "root_cause_analysis": "string",
  "evidence_findings": ["list of evidence items"],
  "autonomous_actions_taken": ["list of actions"],
  "pending_actions": ["list of pending items"],
  "recommended_fixes": ["list of recommendations"],
  "ownership_mapping": {"team": "responsible_for"},
  "business_impact": "string",
  "prevention_recommendations": ["list of preventions"]
}

Be specific, factual, and evidence-based. Reference actual data from the analysis."""


def _load_prompt(db: Session) -> str:
    try:
        tmpl = db.query(PromptTemplate).filter(
            PromptTemplate.category == "sai_summary",
            PromptTemplate.is_active == True,
        ).first()
        if tmpl and tmpl.content and tmpl.content.strip():
            return tmpl.content.strip()
    except Exception:
        pass
    return _SYSTEM_PROMPT


async def run(
    request_text: str,
    schema_context: dict,
    collection_context: dict,
    rca_context: dict,
    findings: list[dict],
    validation_result: dict,
    actions_taken: list[dict],
    approval_items: list[dict],
    knowledge_sources: list[dict],
    db: Session,
    run_id: int = 0,
) -> dict:
    t0 = time.time()

    system_prompt = _load_prompt(db)

    # Build analysis payload for LLM
    datasets_summary = [
        {
            "label":     ds.get("label"),
            "row_count": ds.get("row_count"),
            "columns":   ds.get("columns", [])[:10],
            "error":     ds.get("error"),
        }
        for ds in collection_context.get("datasets", [])
    ]

    user_prompt = f"""OPERATIONAL REQUEST: {request_text}

DOMAINS IDENTIFIED: {', '.join(schema_context.get('domains', []))}
CONNECTIONS ANALYZED: {len(schema_context.get('connections', []))}

DATASETS COLLECTED:
{json.dumps(datasets_summary, indent=2)[:2000]}

ANOMALIES DETECTED:
{json.dumps(rca_context.get('anomalies', []), indent=2)[:1500]}

CHECKS RESULTS:
{json.dumps(rca_context.get('checks', []), indent=2)[:1500]}

FINDINGS CLASSIFIED:
{json.dumps(findings, indent=2)[:2000]}

ACTIONS TAKEN: {len(actions_taken)}
PENDING APPROVALS: {len(approval_items)}

VALIDATION STATUS: {validation_result.get('validation_status')}
VALIDATION MESSAGE: {validation_result.get('message')}

KNOWLEDGE SOURCES USED: {len(knowledge_sources)} KB entries referenced

Generate the 10-section operational report as JSON."""

    report = {}
    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.3,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        report = json.loads(raw)
        elapsed_ms = int((time.time() - t0) * 1000)

        # Log to AITraceLog
        try:
            db.add(AITraceLog(
                module="sai_report",
                conn_id=None,
                model="gpt-4o-mini",
                prompt_text=user_prompt[:4000],
                response_text=raw[:4000],
                tokens_in=resp.usage.prompt_tokens,
                tokens_out=resp.usage.completion_tokens,
                latency_ms=elapsed_ms,
                sai_run_id=run_id if run_id else None,
            ))
            db.commit()
        except Exception:
            db.rollback()

    except Exception as exc:
        elapsed_ms = int((time.time() - t0) * 1000)
        report = {
            "incident_summary":            f"SAI run for: {request_text}",
            "systems_impacted":            [c.get("label", "") for c in collection_context.get("datasets", [])],
            "root_cause_analysis":         "LLM report generation failed — manual review required.",
            "evidence_findings":           [c.get("detail", "") for c in rca_context.get("checks", [])[:5]],
            "autonomous_actions_taken":    [a.get("type", "") for a in actions_taken],
            "pending_actions":             [a.get("action_type", "") for a in approval_items],
            "recommended_fixes":           ["Review anomalies in collected datasets"],
            "ownership_mapping":           {f.get("owner_team", "Unknown"): f.get("issue_type", "") for f in findings[:5]},
            "business_impact":             "Impact assessment pending manual review.",
            "prevention_recommendations":  ["Implement automated monitoring", "Schedule regular reconciliation runs"],
            "_error":                      str(exc)[:300],
        }

    return {
        "report":           report,
        "knowledge_sources": knowledge_sources,
        "elapsed_ms":       elapsed_ms,
    }
