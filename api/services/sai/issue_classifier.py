"""
issue_classifier.py — LLM-based issue classification.
Converts raw anomalies/checks into typed, severity-rated findings.
"""
import json
import time
from sqlalchemy.orm import Session

from api.config import settings
from api.models import AITraceLog, PromptTemplate

_SYSTEM_PROMPT = """You are SAI issue classifier. Classify each operational check into:
- issue_type: one of [Policy, Claims, Billing, API, ETL, DCT Mapping, Data Quality, General]
- severity: one of [CRITICAL, HIGH, MEDIUM, LOW]
- system_impacted: short system/table name
- description: one sentence root cause hypothesis

Return a JSON array of findings matching this structure:
[{"issue_type": "...", "severity": "...", "system_impacted": "...", "description": "..."}]

Base severity on:
- CRITICAL: data loss, service outage, regulatory risk
- HIGH: significant data quality degradation, reconciliation failure
- MEDIUM: anomalies within acceptable range, warnings
- LOW: informational, minor deviations"""


def _load_prompt(db: Session) -> str:
    try:
        tmpl = db.query(PromptTemplate).filter(
            PromptTemplate.category == "sai_classifier",
            PromptTemplate.is_active == True,
        ).first()
        if tmpl and tmpl.content and tmpl.content.strip():
            return tmpl.content.strip()
    except Exception:
        pass
    return _SYSTEM_PROMPT


async def run(checks: list[dict], request_text: str, db: Session, run_id: int = 0) -> list[dict]:
    t0 = time.time()
    system_prompt = _load_prompt(db)

    if not checks:
        return []

    user_prompt = f"Request: {request_text}\n\nChecks to classify:\n{json.dumps(checks, indent=2)[:3000]}"

    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or '{"findings": []}'
        parsed = json.loads(raw)
        findings = parsed if isinstance(parsed, list) else parsed.get("findings", parsed.get("items", []))
        elapsed_ms = int((time.time() - t0) * 1000)

        try:
            db.add(AITraceLog(
                module="sai_classifier",
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

        return findings if isinstance(findings, list) else []

    except Exception as exc:
        # Fallback: convert checks to findings directly
        fallback = []
        for c in checks:
            severity = "HIGH" if c.get("status") == "FAIL" else "MEDIUM" if c.get("status") == "WARN" else "LOW"
            fallback.append({
                "issue_type":      "Data Quality",
                "severity":        severity,
                "system_impacted": "Unknown",
                "description":     c.get("detail", c.get("check_name", ""))[:300],
            })
        return fallback
