from __future__ import annotations

import json
import re
import time
from typing import Optional

from sqlalchemy.orm import Session

_SYSTEM_PROMPT = """\
You are an expert Duck Creek Technologies data architect.

Your job is to extract a structured mapping intent from a natural-language instruction.

Extract the following fields:
- entity: one of "Account", "Policy", "Risk", "Coverage"
- field: the target field name in CamelCase (required unless type is "controller")
- source: the source data path (defaults to field if not specified)
- type: one of "extra", "base", "dynamic", "reference", "risk", "controller"
  - extra: extra data (ExtraData tables)
  - base: standard field mapping
  - dynamic: dynamic/private field (field starts with _)
  - reference: reference/lookup table field (commonly ends with Code, Type, Status)
  - risk: risk entity field
  - controller: manuscript controller (no field required)
- lob: line of business — one of "Auto", "Property", "GL"
  (if not mentioned, default to "Auto")
- multiple_mappings: true if the instruction mentions more than one field

Return ONLY valid JSON (no markdown, no explanation):
{"entity": "...", "field": "...", "source": "...", "type": "...", "lob": "..."}

If the instruction asks to map multiple fields at once, return:
{"multiple_mappings": true}
"""


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

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0 = time.monotonic()
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_input},
        ],
        temperature=0,
        max_tokens=300,
    )
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw = resp.choices[0].message.content or ""
    tokens_in  = resp.usage.prompt_tokens     if resp.usage else 0
    tokens_out = resp.usage.completion_tokens if resp.usage else 0

    ai_trace.store(
        module="agent_mapper",
        conn_id=None,
        model="gpt-4o-mini",
        prompt=system_prompt[:500] + "\n---\n" + user_input,
        response=raw[:4000],
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=elapsed_ms,
        db=db,
    )

    try:
        intent = json.loads(raw)
    except json.JSONDecodeError:
        m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", raw.strip(), re.S)
        if not m:
            raise
        intent = json.loads(m.group(1))

    intent["_tokens_in"]  = tokens_in
    intent["_tokens_out"] = tokens_out
    intent["_latency_ms"] = elapsed_ms
    return intent
