from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.orm import Session

from api.services.agent_mapper import intent_parser, intent_validator, rule_engine, template_engine


@dataclass
class ManuscriptResult:
    session_id:    int
    user_input:    str
    parsed_intent: dict
    mapping_model: dict
    generated_xml: str
    grid:          list
    tokens_in:     int
    tokens_out:    int
    latency_ms:    int


def generate_manuscript(
    user_input: str,
    db: Session,
    project_id: Optional[int] = None,
) -> ManuscriptResult:
    from api.models import AgentMapperSession

    raw_intent    = intent_parser.extract_intent(user_input, db)
    tokens_in     = raw_intent.pop("_tokens_in",  0)
    tokens_out    = raw_intent.pop("_tokens_out", 0)
    latency_ms    = raw_intent.pop("_latency_ms", 0)

    clean_intent  = intent_validator.validate_intent(raw_intent)
    mapping_model = rule_engine.apply_rules(clean_intent)
    result        = template_engine.render(mapping_model)
    xml_output    = result["xml"]
    grid          = result["grid"]

    row = AgentMapperSession(
        project_id    = project_id,
        user_input    = user_input,
        parsed_intent = json.dumps(clean_intent),
        mapping_model = json.dumps(mapping_model),
        generated_xml = xml_output,
        grid_json     = json.dumps(grid),
        mapping_type  = mapping_model.get("template_name"),
        entity        = mapping_model.get("entity"),
        field         = mapping_model.get("field") or None,
        lob           = mapping_model.get("lob"),
        inherit       = mapping_model.get("inherit"),
        include_json  = json.dumps(mapping_model.get("include", [])),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return ManuscriptResult(
        session_id    = row.id,
        user_input    = user_input,
        parsed_intent = clean_intent,
        mapping_model = mapping_model,
        generated_xml = xml_output,
        grid          = grid,
        tokens_in     = tokens_in,
        tokens_out    = tokens_out,
        latency_ms    = latency_ms,
    )
