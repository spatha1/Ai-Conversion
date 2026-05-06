"""
payload_analyzer.py — JSON/API Payload Intelligence Agent service.
Decomposes large JSON payloads, maps fields to a target schema,
detects issues, and persists sessions.
"""
import json
import time
from typing import Optional


def _summarize_json(payload: dict | list, max_keys: int = 200) -> dict:
    """
    Walk the JSON structure and build a schema-like summary.
    Returns {path: {type, sample, count?}} dict — no raw data rows included.
    """
    summary: dict = {}
    count = [0]

    def walk(node, path: str):
        if count[0] >= max_keys:
            return
        if isinstance(node, dict):
            for k, v in node.items():
                child_path = f"{path}.{k}" if path else k
                walk(v, child_path)
        elif isinstance(node, list):
            summary[path] = {"type": "array", "count": len(node)}
            count[0] += 1
            if node:
                walk(node[0], f"{path}[]")
        else:
            val_type = type(node).__name__
            sample = str(node)[:40] if node is not None else "null"
            summary[path] = {"type": val_type, "sample": sample}
            count[0] += 1

    walk(payload, "")
    return summary


def _extract_components(payload: dict | list) -> list[dict]:
    """Identify top-level logical sections of the JSON."""
    components = []
    if isinstance(payload, dict):
        for key, val in payload.items():
            comp_type = "array" if isinstance(val, list) else ("object" if isinstance(val, dict) else "field")
            row_count = len(val) if isinstance(val, list) else None
            components.append({
                "name": key,
                "path": key,
                "type": comp_type,
                "row_count": row_count,
            })
    elif isinstance(payload, list):
        components.append({
            "name": "root",
            "path": "",
            "type": "array",
            "row_count": len(payload),
        })
    return components


def analyze_payload(
    payload_json_str: str,
    target_schema_str: Optional[str],
    instructions: Optional[str],
    name: Optional[str],
    db,
) -> dict:
    """
    Main entry point: parse JSON, summarize, call AI, persist session.
    Returns full analysis dict with session_id.
    """
    from api.models import PayloadSession, AITraceLog, PromptTemplate
    from api.config import settings

    # ── Parse ──────────────────────────────────────────────────────────────────
    try:
        payload = json.loads(payload_json_str)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}")

    components = _extract_components(payload)
    structure_summary = _summarize_json(payload)

    # ── Build prompt ───────────────────────────────────────────────────────────
    _SYSTEM_PROMPT = """You are a JSON/API payload intelligence expert. Analyze the provided JSON structure and return ONLY valid JSON with this exact structure:
{
  "components": [
    {"name": "string", "path": "string", "type": "object|array|field", "row_count": null_or_int, "description": "string"}
  ],
  "field_mappings": [
    {"source_path": "string", "target_field": "string", "confidence": 0_to_100, "note": "string"}
  ],
  "issues": [
    {"field_path": "string", "issue_type": "missing_required|null_value|type_mismatch|unexpected_field|format_error", "detail": "string", "suggestion": "string"}
  ],
  "narrative": "2-4 sentence plain English summary"
}
Rules:
- field_mappings confidence: 90+ = obvious match, 60-89 = likely match with some interpretation, below 60 = uncertain
- If no target schema is provided, identify likely data model fields and flag structural issues only
- Return raw JSON only, no markdown fences"""

    system_prompt = _SYSTEM_PROMPT
    try:
        tmpl = db.query(PromptTemplate).filter(
            PromptTemplate.category == "payload_intelligence",
            PromptTemplate.is_active == True,
        ).first()
        if tmpl and tmpl.content and tmpl.content.strip():
            system_prompt = tmpl.content.strip()
    except Exception:
        pass

    user_parts = []
    if instructions:
        user_parts.append(
            "=== USER INSTRUCTIONS (MUST BE ADDRESSED) ===\n"
            + instructions
            + "\n=== END INSTRUCTIONS ==="
        )
    user_parts.append(
        "=== JSON STRUCTURE SUMMARY ===\n"
        + json.dumps(structure_summary, indent=2)[:6000]
    )
    user_parts.append(
        "=== TOP-LEVEL COMPONENTS ===\n"
        + json.dumps(components, indent=2)
    )
    if target_schema_str:
        user_parts.append(
            "=== TARGET SCHEMA ===\n"
            + target_schema_str[:3000]
        )

    user_msg = "\n\n".join(user_parts)

    # ── Call AI ────────────────────────────────────────────────────────────────
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0 = time.time()
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_msg},
        ],
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    elapsed_ms = int((time.time() - t0) * 1000)
    raw = resp.choices[0].message.content or "{}"

    try:
        ai_result = json.loads(raw)
    except Exception:
        ai_result = {
            "components": components,
            "field_mappings": [],
            "issues": [],
            "narrative": raw[:500],
        }

    # Merge pre-computed components (AI can enrich them, but we always have the structural ones)
    if not ai_result.get("components"):
        ai_result["components"] = components

    tokens_in  = resp.usage.prompt_tokens
    tokens_out = resp.usage.completion_tokens

    # ── Persist ────────────────────────────────────────────────────────────────
    session = PayloadSession(
        name=name,
        source_payload=payload_json_str[:50000],
        target_schema=target_schema_str,
        instructions=instructions,
        components=json.dumps(ai_result.get("components", [])),
        field_mappings=json.dumps(ai_result.get("field_mappings", [])),
        issues=json.dumps(ai_result.get("issues", [])),
        narrative=ai_result.get("narrative", ""),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=elapsed_ms,
    )
    db.add(session)
    db.flush()
    session_id = session.id

    try:
        db.add(AITraceLog(
            module="payload_intelligence",
            conn_id=None,
            model="gpt-4o-mini",
            prompt_text=user_msg[:4000],
            response_text=raw[:4000],
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=elapsed_ms,
        ))
    except Exception:
        pass

    db.commit()

    return {
        "session_id":    session_id,
        "components":    ai_result.get("components", []),
        "field_mappings": ai_result.get("field_mappings", []),
        "issues":        ai_result.get("issues", []),
        "narrative":     ai_result.get("narrative", ""),
        "tokens_in":     tokens_in,
        "tokens_out":    tokens_out,
        "latency_ms":    elapsed_ms,
    }
