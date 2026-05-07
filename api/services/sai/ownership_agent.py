"""
ownership_agent.py — Maps findings to responsible teams using the Knowledge Engine.
Zero hardcoded ownership maps. Uses semantic_search + LLM to determine ownership.
"""
import json
import time
from sqlalchemy.orm import Session

from api.services.knowledge_processor import semantic_search
from api.models import AITraceLog, PromptTemplate
from api.config import settings

_SYSTEM_PROMPT = """You are an enterprise operations coordinator embedded in SAI.

Given a list of operational findings and knowledge base context about team ownership,
assign each finding to the most responsible team.

Return ONLY valid JSON:
{
  "assignments": [
    {
      "issue_type": "...",
      "system_impacted": "...",
      "owner_team": "...",
      "reason": "one sentence why this team owns it"
    }
  ]
}

If the knowledge base has no explicit ownership information, use the system_impacted
field to make a reasonable inference. Never leave owner_team blank."""


def _load_prompt(db: Session) -> str:
    try:
        tmpl = db.query(PromptTemplate).filter(
            PromptTemplate.category == "sai_ownership",
            PromptTemplate.is_active == True,
        ).first()
        if tmpl and tmpl.content and tmpl.content.strip():
            return tmpl.content.strip()
    except Exception:
        pass
    return _SYSTEM_PROMPT


async def run(findings: list[dict], schema_context: dict, db: Session, sai_run_id: int = 0) -> dict:
    t0 = time.time()

    if not findings:
        return {"findings": [], "elapsed_ms": 0}

    # 1 — Query KB for ownership / team info related to each finding
    ownership_kb = ""
    try:
        systems = list({f.get("system_impacted", "") for f in findings if f.get("system_impacted")})
        query   = f"Team ownership and responsibility for: {', '.join(systems)}"
        results = semantic_search(query=query, top_k=3, db=db)
        for _, chunk in results:
            if hasattr(chunk, "chunk_text") and chunk.chunk_text:
                ownership_kb += f"\n{chunk.chunk_text[:300]}"
    except Exception:
        pass

    system_prompt = _load_prompt(db)
    findings_text = json.dumps(
        [{"issue_type": f.get("issue_type"), "system_impacted": f.get("system_impacted"), "description": f.get("description", "")[:150]}
         for f in findings],
        indent=2,
    )[:3000]

    user_prompt = (
        f"Findings to assign:\n{findings_text}\n\n"
        f"Knowledge Base Ownership Context:\n{ownership_kb.strip() or 'No explicit ownership info in KB.'}\n\n"
        "Assign each finding to the responsible team. Return JSON only."
    )

    # 2 — LLM assigns ownership
    assignments: list[dict] = []
    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw  = resp.choices[0].message.content or '{"assignments": []}'
        parsed = json.loads(raw)
        elapsed_ms = int((time.time() - t0) * 1000)
        assignments = parsed.get("assignments", [])

        try:
            db.add(AITraceLog(
                module="sai_ownership",
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
        assignments = []

    # 3 — Merge ownership back into findings
    enriched = []
    for finding in findings:
        match = next(
            (a for a in assignments if
             (a.get("issue_type", "").lower() in (finding.get("issue_type") or "").lower() or
              (finding.get("system_impacted") or "").lower() in (a.get("system_impacted") or "").lower())),
            None,
        )
        owner = match.get("owner_team", "Operations Team") if match else "Operations Team"
        enriched.append({**finding, "owner_team": owner})

    return {
        "findings":  enriched,
        "elapsed_ms": int((time.time() - t0) * 1000),
    }
