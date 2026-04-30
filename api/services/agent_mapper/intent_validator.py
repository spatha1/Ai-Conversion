from __future__ import annotations

ALLOWED_ENTITIES = {"Account", "Policy", "Risk", "Coverage"}
ALLOWED_TYPES    = {"extra", "base", "dynamic", "reference", "risk", "controller"}
ALLOWED_LOBS     = {"Auto", "Property", "GL"}
DEFAULT_LOB      = "Auto"


def validate_intent(intent: dict) -> dict:
    if not isinstance(intent, dict):
        raise ValueError("Intent must be a JSON object")
    if intent.get("multiple_mappings"):
        raise ValueError("V1 supports only one mapping per request. Submit one field at a time.")

    entity = (intent.get("entity") or "").strip()
    field  = (intent.get("field")  or "").strip()
    mtype  = (intent.get("type")   or "base").strip()
    source = (intent.get("source") or field).strip()
    lob    = (intent.get("lob")    or DEFAULT_LOB).strip() or DEFAULT_LOB

    if entity not in ALLOWED_ENTITIES:
        raise ValueError(f"Unsupported entity: '{entity}'. Must be one of {sorted(ALLOWED_ENTITIES)}.")
    if mtype not in ALLOWED_TYPES:
        raise ValueError(f"Unsupported type: '{mtype}'. Must be one of {sorted(ALLOWED_TYPES)}.")
    if lob not in ALLOWED_LOBS:
        lob = DEFAULT_LOB
    if mtype != "controller" and not field:
        raise ValueError("field is required for non-controller mappings")
    if mtype != "controller" and not source:
        raise ValueError("source is required for non-controller mappings")

    return {"entity": entity, "field": field, "source": source, "type": mtype, "lob": lob}
