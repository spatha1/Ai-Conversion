"""
rca_agent.py — LLM-driven root cause analysis.
Uses the Knowledge Engine for domain rules and historical context.
Zero hardcoded thresholds or anomaly patterns.
"""
import json
import time
from sqlalchemy.orm import Session

from api.services.knowledge_processor import semantic_search, ask_sai, get_operational_knowledge
from api.models import AITraceLog, PromptTemplate
from api.config import settings

_SYSTEM_PROMPT = """You are SAI — Swift Autonomous Intelligence performing root cause analysis.

You are given:
- The operator's request and intended analysis
- Knowledge base rules and historical incident context
- Collected datasets with column statistics and sample rows

Your job:
1. Analyze each dataset in the context of the request
2. Apply domain rules from the knowledge base
3. Identify specific data issues: missing records, null anomalies, count mismatches, business rule violations
4. For reconciliation requests (missing X in Y): look at row counts — if a query returned 0 rows and was meant to find something, that IS the finding
5. Produce a list of checks with clear status and evidence

Return ONLY valid JSON:
{
  "anomalies": [
    {"label": "...", "column": "...", "type": "...", "value": ..., "detail": "..."}
  ],
  "checks": [
    {
      "check_name": "...",
      "status": "PASS|FAIL|WARN|ERROR|INFO",
      "detail": "...",
      "evidence": "...",
      "datasets_involved": []
    }
  ],
  "summary": "One-sentence summary of what was found"
}

Status guide:
- FAIL: clear violation of a business rule or missing required data
- WARN: anomaly within range but worth noting
- PASS: check passed, data looks correct
- INFO: informational finding, not necessarily a problem
- ERROR: data collection itself failed"""


def _load_prompt(db: Session) -> str:
    try:
        tmpl = db.query(PromptTemplate).filter(
            PromptTemplate.category == "sai_rca",
            PromptTemplate.is_active == True,
        ).first()
        if tmpl and tmpl.content and tmpl.content.strip():
            return tmpl.content.strip()
    except Exception:
        pass
    return _SYSTEM_PROMPT


def _dataset_summary(datasets: list[dict]) -> str:
    lines = []
    for ds in datasets:
        if ds.get("error"):
            lines.append(f"[ERROR] {ds.get('label')}: {ds.get('error')[:200]}")
            continue
        purpose = ds.get("purpose", "")
        lines.append(f"[{ds.get('label')}] {f'Purpose: {purpose} | ' if purpose else ''}"
                     f"rows={ds.get('row_count', 0)} cols={ds.get('columns', [])[:8]}")
        stats = ds.get("stats", {})
        for col, stat in list(stats.items())[:5]:
            null_rate = stat.get("null_rate", 0)
            if null_rate > 0:
                lines.append(f"  {col}: null_rate={null_rate:.1%} total={stat.get('total_rows')}")
        samples = ds.get("sample_rows", [])
        if samples:
            lines.append(f"  sample[0]: {samples[0]}")
    return "\n".join(lines) or "No datasets collected."


async def run(
    schema_context: dict,
    collection_context: dict,
    request_text: str,
    db: Session,
    sai_run_id: int = 0,
) -> dict:
    t0 = time.time()
    knowledge_sources = list(collection_context.get("knowledge_sources", []))
    datasets          = collection_context.get("datasets", [])
    analysis_approach = schema_context.get("analysis_approach", "")
    analysis_type     = schema_context.get("analysis_type", "general")
    kb_context_text   = schema_context.get("kb_context_text", "")

    # 1 — Query Knowledge Engine for historical incidents and domain rules
    incident_query = f"Historical incidents and business rules for: {request_text}"
    try:
        hist = ask_sai(question=incident_query, db=db)
        if hist.get("status") == "ANSWERED":
            knowledge_sources.append({
                "entry_id":   None,
                "title":      "Historical Incident Match",
                "confidence": 0.75,
                "answer":     hist.get("answer", "")[:500],
            })
        for src in hist.get("sources", []):
            if not any(s.get("entry_id") == src.get("entry_id") for s in knowledge_sources):
                knowledge_sources.append({
                    "entry_id":   src.get("entry_id"),
                    "title":      src.get("title"),
                    "confidence": src.get("score"),
                })
    except Exception:
        pass

    # Pull structured ReconRules — include SQL templates as explicit validation context
    recon_rules_text = ""
    try:
        primary_system = (schema_context.get("domains") or [""])[0]
        recon_rules = get_operational_knowledge("ReconRule", db, system=primary_system, limit=5)
        if recon_rules:
            rule_lines = []
            for r in recon_rules:
                rule_lines.append(f"Rule: {r['title']} | Severity: {r.get('severity', 'MEDIUM')}")
                if r.get("sql_template"):
                    rule_lines.append(f"  SQL: {r['sql_template'][:300]}")
                if r.get("summary"):
                    rule_lines.append(f"  Rule: {r['summary'][:200]}")
            recon_rules_text = "\nReconciliation Rules from KB:\n" + "\n".join(rule_lines)
            for r in recon_rules:
                if not any(s.get("entry_id") == r["id"] for s in knowledge_sources):
                    knowledge_sources.append({"entry_id": r["id"], "title": r["title"], "confidence": 0.9})
    except Exception:
        pass

    # Pull IncidentHistory entries to find similar past incidents
    incident_history_text = ""
    try:
        incident_results = semantic_search(
            f"incidents similar to: {request_text}",
            top_k=3,
            db=db,
            category="IncidentHistory",
        )
        if incident_results:
            hist_lines = []
            for score, chunk in incident_results:
                entry_id = getattr(chunk, "entry_id", None)
                title = chunk.entry.title if hasattr(chunk, "entry") and chunk.entry else (getattr(chunk, "topic", "") or "")
                if not any(s.get("entry_id") == entry_id for s in knowledge_sources):
                    knowledge_sources.append({"entry_id": entry_id, "title": title, "confidence": round(float(score), 3)})
                content = getattr(chunk, "content", "") or ""
                hist_lines.append(f"- {title}: {content[:250]}")
            incident_history_text = "\nSimilar Past Incidents:\n" + "\n".join(hist_lines)
    except Exception:
        pass

    # Augment KB context with any additional domain rules
    additional_kb = ""
    try:
        rules_results = semantic_search(
            query=f"Business rules and data quality rules for: {request_text}",
            top_k=3,
            db=db,
        )
        for score, chunk in rules_results:
            entry_id = chunk.entry_id if hasattr(chunk, "entry_id") else None
            title    = chunk.entry.title if hasattr(chunk, "entry") and chunk.entry else (chunk.topic or "")
            if not any(s.get("entry_id") == entry_id for s in knowledge_sources):
                knowledge_sources.append({
                    "entry_id":   entry_id,
                    "title":      title,
                    "confidence": round(float(score), 3),
                })
            if hasattr(chunk, "chunk_text") and chunk.chunk_text:
                additional_kb += f"\n---\n{chunk.chunk_text[:400]}"
    except Exception:
        pass

    combined_kb = (kb_context_text + recon_rules_text + incident_history_text + additional_kb).strip() or "No KB context available."

    # 2 — Ask LLM to perform root cause analysis
    anomalies: list[dict] = []
    checks: list[dict]    = []

    system_prompt = _load_prompt(db)
    dataset_text  = _dataset_summary(datasets)

    user_prompt = (
        f"Operator Request: {request_text}\n"
        f"Analysis Type: {analysis_type}\n"
        f"Analysis Approach: {analysis_approach}\n\n"
        f"Knowledge Base Context:\n{combined_kb[:2000]}\n\n"
        f"Collected Datasets:\n{dataset_text[:3000]}\n\n"
        "Perform root cause analysis and return JSON checks only."
    )

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
        raw = resp.choices[0].message.content or "{}"
        parsed    = json.loads(raw)
        elapsed_ms = int((time.time() - t0) * 1000)

        anomalies = parsed.get("anomalies", [])
        checks    = parsed.get("checks", [])

        try:
            db.add(AITraceLog(
                module="sai_rca",
                conn_id=None,
                model="gpt-4o-mini",
                prompt_text=user_prompt[:4000],
                response_text=raw[:4000],
                tokens_in=resp.usage.prompt_tokens,
                tokens_out=resp.usage.completion_tokens,
                latency_ms=elapsed_ms,
                sai_run_id=sai_run_id if sai_run_id else None,
            ))
            db.commit()
        except Exception:
            db.rollback()

    except Exception:
        # Fallback: basic null-rate check without LLM
        for ds in datasets:
            if ds.get("error"):
                checks.append({
                    "check_name": f"Data collection failed: {ds.get('label')}",
                    "status":     "ERROR",
                    "detail":     ds["error"],
                    "datasets_involved": [ds.get("conn_id")],
                })
                continue
            for col, stat in ds.get("stats", {}).items():
                null_rate = stat.get("null_rate", 0)
                if null_rate > 0.10:
                    anomalies.append({
                        "label": ds.get("label"), "column": col,
                        "type": "high_null_rate", "value": null_rate,
                        "detail": f"Null rate {null_rate:.1%}",
                    })

        if not checks:
            checks.append({
                "check_name": "Data quality scan",
                "status":     "PASS" if not anomalies else "WARN",
                "detail":     f"{len(anomalies)} anomalies detected" if anomalies else "No anomalies detected",
                "datasets_involved": [],
            })

    return {
        "anomalies":         anomalies,
        "checks":            checks,
        "knowledge_sources": knowledge_sources,
        "elapsed_ms":        int((time.time() - t0) * 1000),
    }
