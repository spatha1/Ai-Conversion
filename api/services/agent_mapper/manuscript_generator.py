from __future__ import annotations

import json
from dataclasses import dataclass, field as dc_field
from typing import Optional

from sqlalchemy.orm import Session

from api.services.agent_mapper import intent_parser, intent_validator, rule_engine, template_engine
from api.services.agent_mapper.xml_merger import merge_manuscript


@dataclass
class ManuscriptResult:
    session_id:     int
    user_input:     str
    parsed_intents: list[dict]
    mapping_models: list[dict]
    generated_xml:  str
    grid:           list
    mode:           str
    warnings:       list[str]
    tokens_in:      int
    tokens_out:     int
    latency_ms:     int
    prompt_text:    str
    response_text:  str


def generate_manuscript(
    user_input:   str,
    db:           Session,
    project_id:   Optional[int] = None,
    existing_xml: Optional[str] = None,
    mode:         str = "create",
) -> ManuscriptResult:
    from api.models import AgentMapperSession

    # ── Stage 1: parse intent(s) ──────────────────────────────────────────────
    raw = intent_parser.extract_intent(user_input, db)
    tokens_in     = raw.get("_tokens_in",  0)
    tokens_out    = raw.get("_tokens_out", 0)
    latency_ms    = raw.get("_latency_ms", 0)
    prompt_text   = raw.get("_prompt",    "")
    response_text = raw.get("_response",  "")

    # ── Stage 2: validate all intents (returns warnings) ─────────────────────
    parsed_intents, warnings = intent_validator.validate_intents(raw["intents"], user_input)

    # ── Stage 3: rule engine for every intent ─────────────────────────────────
    mapping_models = [rule_engine.apply_rules(i) for i in parsed_intents]

    # ── Stage 4: XML generation ───────────────────────────────────────────────
    if mode == "extend" and existing_xml and existing_xml.strip():
        xml_output, grid = _extend(existing_xml, mapping_models)
    else:
        # Create mode: check if a custom/matching template exists in the library
        lib_xml = _lookup_library_template(mapping_models[0], db)
        if lib_xml:
            xml_output, grid = _extend(lib_xml, mapping_models)
        else:
            xml_output, grid = _create(mapping_models)

    # ── Stage 5: persist session ──────────────────────────────────────────────
    first = mapping_models[0]
    row = AgentMapperSession(
        project_id    = project_id,
        user_input    = user_input,
        parsed_intent = json.dumps(parsed_intents),
        mapping_model = json.dumps(mapping_models),
        generated_xml = xml_output,
        grid_json     = json.dumps(grid),
        mapping_type  = first.get("template_name"),
        entity        = first.get("entity"),
        field         = ", ".join(m.get("field", "") for m in mapping_models) or None,
        lob           = first.get("lob"),
        inherit       = first.get("inherit"),
        include_json  = json.dumps(first.get("include", [])),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return ManuscriptResult(
        session_id     = row.id,
        user_input     = user_input,
        parsed_intents = parsed_intents,
        mapping_models = mapping_models,
        generated_xml  = xml_output,
        grid           = grid,
        mode           = mode,
        warnings       = warnings,
        tokens_in      = tokens_in,
        tokens_out     = tokens_out,
        latency_ms     = latency_ms,
        prompt_text    = prompt_text,
        response_text  = response_text,
    )


def _lookup_library_template(first_model: dict, db: Session) -> str | None:
    """
    Check the template library for a custom (non-OOTB) template matching
    this lob+entity+mapping_type.  Only custom templates override the engine;
    OOTB templates are kept as reference only so stock behaviour is preserved.
    """
    try:
        from api.models import AgentMapperTemplate
        lob          = first_model.get("lob")
        entity       = first_model.get("entity")
        mapping_type = first_model.get("template_name")  # rule engine sets this

        row = (
            db.query(AgentMapperTemplate)
            .filter(
                AgentMapperTemplate.is_active  == True,
                AgentMapperTemplate.is_ootb    == False,    # only custom overrides engine
                AgentMapperTemplate.lob        == lob,
                AgentMapperTemplate.entity     == entity,
                AgentMapperTemplate.mapping_type == mapping_type,
            )
            .order_by(AgentMapperTemplate.updated_at.desc())
            .first()
        )
        return row.template_xml if row else None
    except Exception:
        return None


def _create(mapping_models: list[dict]) -> tuple[str, list]:
    """
    Create mode: render first mapping fully, then extend with each subsequent.
    """
    result     = template_engine.render(mapping_models[0])
    xml_output = result["xml"]
    grid       = result["grid"]

    for m in mapping_models[1:]:
        fm_els, new_rows = template_engine.render_field_nodes(m)
        merged     = merge_manuscript(xml_output, fm_els, new_rows, m)
        xml_output = merged["xml"]
        grid       = merged["grid"]

    return xml_output, grid


def _extend(existing_xml: str, mapping_models: list[dict]) -> tuple[str, list]:
    """
    Extend mode: inject new fieldMaps into existing XML for every mapping model.
    """
    xml_output = existing_xml
    grid: list = []

    for m in mapping_models:
        fm_els, new_rows = template_engine.render_field_nodes(m)
        merged     = merge_manuscript(xml_output, fm_els, new_rows, m)
        xml_output = merged["xml"]
        grid       = merged["grid"]   # last call has full grid (existing + all added)

    return xml_output, grid
