from __future__ import annotations
from api.services.agent_mapper.lob_registry import resolve_lob_entity_config
from api.services.agent_mapper.template_engine import ENTITY_TARGET_MAP


def apply_rules(intent: dict) -> dict:
    m      = dict(intent)
    field  = m["field"]
    entity = m["entity"]
    mtype  = m["type"]

    lob_meta     = resolve_lob_entity_config(m.get("lob"), entity)
    m["lob"]     = lob_meta["lob"]
    m["inherit"] = lob_meta["inherit"]
    m["include"] = lob_meta["include"]

    # Priority 1: underscore prefix → dynamic
    if field.startswith("_"):
        return {**m, "type": "dynamic", "target": "Policy.PolicyRating", "template_name": "dynamic"}

    # Priority 2: controller
    if mtype == "controller":
        return {**m, "template_name": "controller", "target": None}

    # Priority 3: Risk entity → fixed InsuredObject structure
    if entity == "Risk":
        return {**m, "type": "risk", "target": "Policy.InsuredObject", "template_name": "risk"}

    # Priority 4: extra data
    if mtype == "extra":
        if entity == "Account":
            return {**m, "target": "Party.PartyExtraData",   "template_name": "extra_party"}
        return     {**m, "target": "Policy.PolicyExtraData", "template_name": "extra_policy"}

    entity_target = ENTITY_TARGET_MAP.get(entity, f"{entity}.{entity}")

    # Priority 5: reference
    if mtype == "reference" or any(field.endswith(s) for s in ("Code", "Type", "Status")):
        return {**m, "type": "reference", "target": entity_target, "template_name": "reference"}

    # Priority 6: base (default)
    return {**m, "type": "base", "target": entity_target, "template_name": "base"}
