from __future__ import annotations

import json
import re
import time

from sqlalchemy.orm import Session

_SYSTEM_PROMPT = """\
You are an expert Duck Creek Technologies data architect.

Extract ALL field mapping intents from the instruction. Return a JSON ARRAY.

Each element must have:
- entity: "Account" | "Policy" | "Risk" | "Coverage"
- field: CamelCase field name (required unless type is "controller")
- source: source data path (defaults to field if not specified)
- type: "extra" | "base" | "dynamic" | "reference" | "risk" | "controller"
  - field starts with "_" → dynamic
  - field ends with Code / Type / Status → reference
  - instruction says "extra data" → extra
  - entity is Risk → risk
  - "controller" mentioned → controller
  - otherwise → base
- lob: "Auto" | "Property" | "GL"  (default "Auto" if not mentioned)

For reference-type fields, also include if the user specifies different source columns:
- key_source: source path for the key/ID lookup (omit if same as source)
- name_source: source path for display name (omit if same as source)
- desc_source: source path for description (omit if same as source)

If ONE field: return a single-element array.
If MULTIPLE fields: return one element per field (share entity/lob unless stated otherwise).

EXAMPLES
Input: "Add VehicleVIN to Risk for Auto"
Output: [{"entity":"Risk","field":"VehicleVIN","source":"VehicleVIN","type":"risk","lob":"Auto"}]

Input: "Add PolicyNumber and EffectiveDate to Policy"
Output: [
  {"entity":"Policy","field":"PolicyNumber","source":"PolicyNumber","type":"base","lob":"Auto"},
  {"entity":"Policy","field":"EffectiveDate","source":"EffectiveDate","type":"base","lob":"Auto"}
]

Input: "Add TypeCode to Policy using Description as name and LongDescription as desc"
Output: [{"entity":"Policy","field":"TypeCode","source":"TypeCode","type":"reference","lob":"Auto","name_source":"Description","desc_source":"LongDescription"}]

Return ONLY valid JSON array — no markdown, no explanation.
"""


def _kb_context(user_input: str, db: Session) -> str:
    """Optionally enrich the prompt with relevant SAI KB entries (Option A)."""
    try:
        from api.config import settings
        from api.models import KnowledgeChunk
        from api.services.embeddings import get_embedding, cosine_similarity

        count = db.query(KnowledgeChunk).filter(KnowledgeChunk.embedding.isnot(None)).count()
        if count == 0:
            return ""

        emb   = get_embedding(user_input, settings.OPENAI_API_KEY)
        rows  = db.query(KnowledgeChunk).filter(KnowledgeChunk.embedding.isnot(None)).limit(300).all()
        scored = []
        for row in rows:
            try:
                ch_emb = json.loads(row.embedding)
                score  = cosine_similarity(emb, ch_emb)
                if score >= 0.72:
                    scored.append((score, row))
            except Exception:
                pass

        if not scored:
            return ""

        scored.sort(key=lambda x: x[0], reverse=True)
        seen:  set[int] = set()
        lines = ["\n\n=== SAI Knowledge Base — relevant DCT patterns ==="]
        for _, chunk in scored[:3]:
            if chunk.entry_id in seen:
                continue
            seen.add(chunk.entry_id)
            lines.append(chunk.content[:300])

        return "\n".join(lines) if len(lines) > 1 else ""
    except Exception:
        return ""


def extract_intent(user_input: str, db: Session) -> dict:
    from api.config import settings
    from openai import OpenAI
    from api.services import ai_trace

    system_prompt = _SYSTEM_PROMPT
    try:
        from api.models import PromptTemplate as _PT
        tmpl = db.query(_PT).filter(_PT.category == "agent_mapper_intent", _PT.is_active.is_(True)).first()
        if tmpl and tmpl.content and tmpl.content.strip():
            system_prompt = tmpl.content.strip()
    except Exception:
        pass

    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured.")

    kb_ctx   = _kb_context(user_input, db)
    user_msg = user_input + kb_ctx if kb_ctx else user_input

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0     = time.monotonic()
    resp   = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_msg},
        ],
        temperature=0,
        max_tokens=600,
    )
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw        = resp.choices[0].message.content or ""
    tokens_in  = resp.usage.prompt_tokens     if resp.usage else 0
    tokens_out = resp.usage.completion_tokens if resp.usage else 0

    ai_trace.store(
        module="agent_mapper",
        conn_id=None,
        model="gpt-4o-mini",
        prompt=system_prompt[:500] + "\n---\n" + user_msg,
        response=raw[:4000],
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=elapsed_ms,
        db=db,
    )

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", raw.strip(), re.S)
        if not m:
            raise
        parsed = json.loads(m.group(1))

    intents = parsed if isinstance(parsed, list) else [parsed]

    return {
        "intents":      intents,
        "_tokens_in":   tokens_in,
        "_tokens_out":  tokens_out,
        "_latency_ms":  elapsed_ms,
        "_prompt":      system_prompt[:500] + "\n---\n" + user_msg,
        "_response":    raw,
    }
