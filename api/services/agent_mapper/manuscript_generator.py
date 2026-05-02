from __future__ import annotations

import json
import xml.etree.ElementTree as ET
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
    metadata:       dict       = dc_field(default_factory=dict)
    suggestions:    list[dict] = dc_field(default_factory=list)


def _grid_key(row: dict) -> tuple:
    return (
        row.get("entity", ""),
        row.get("target_table", ""),
        row.get("target_field", ""),
        row.get("source", ""),
    )


def _dedup_warnings(warnings: list[str]) -> list[str]:
    seen: set[str] = set()
    out:  list[str] = []
    for w in warnings:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out


def generate_manuscript(
    user_input:       str,
    db:               Session,
    project_id:       Optional[int]       = None,
    existing_xml:     Optional[str]       = None,
    mode:             str                 = "create",
    user_includes:    Optional[list[str]] = None,
    inherit_override: Optional[str]       = None,
) -> ManuscriptResult:
    from api.models import AgentMapperSession

    # ── Stage 1: parse intent(s) ──────────────────────────────────────────────
    raw = intent_parser.extract_intent(user_input, db)
    tokens_in     = raw.get("_tokens_in",  0)
    tokens_out    = raw.get("_tokens_out", 0)
    latency_ms    = raw.get("_latency_ms", 0)
    prompt_text   = raw.get("_prompt",    "")
    response_text = raw.get("_response",  "")

    # ── Stage 2: validate all intents (returns warnings + suggestions) ──────
    parsed_intents, warnings, suggestions = intent_validator.validate_intents(raw["intents"], user_input)

    # ── Stage 2b: validate override params ───────────────────────────────────
    if user_includes is not None:
        if not isinstance(user_includes, list) or not all(
            isinstance(x, str) and x.strip() for x in user_includes
        ):
            raise ValueError("includes must be a list of non-empty strings.")
    if inherit_override is not None and not (isinstance(inherit_override, str) and inherit_override.strip()):
        raise ValueError("inherit_override must be a non-empty string.")

    # ── Stage 3: rule engine for every intent ─────────────────────────────────
    mapping_models = [rule_engine.apply_rules(i) for i in parsed_intents]

    # ── Stage 3b: apply OOTB reference overrides (admin-supplied) ────────────
    if user_includes or (inherit_override and inherit_override.strip()):
        updated_models = []
        for m in mapping_models:
            updated_m, ow = rule_engine.apply_reference_overrides(m, user_includes, inherit_override)
            updated_models.append(updated_m)
            warnings.extend(ow)
        mapping_models = updated_models

    # ── Stage 4: XML generation ───────────────────────────────────────────────
    template_id:     int | None = None
    template_source: str        = "engine"

    if mode == "extend" and existing_xml and existing_xml.strip():
        xml_output, grid, ext_w = _extend(existing_xml, mapping_models)
        warnings.extend(ext_w)
    else:
        lib_xml, lib_warnings, lib_id = _lookup_library_template(mapping_models[0], db)
        warnings.extend(lib_warnings)
        if lib_xml:
            template_id     = lib_id
            template_source = "custom"
            xml_output, grid, ext_w = _extend(lib_xml, mapping_models)
            warnings.extend(ext_w)
        else:
            xml_output, grid, create_w = _create(mapping_models)
            warnings.extend(create_w)

    # ── Stage 4b: extract_refs from final XML ────────────────────────────────
    try:
        _tree = ET.fromstring(xml_output)
        extract_refs = sorted({
            em.get("extractRef", "")
            for em in _tree.findall(".//extractMap")
        } - {""})
    except Exception:
        extract_refs = []

    metadata = {
        "template_id":     template_id,
        "template_source": template_source,
        "extract_refs":    extract_refs,
    }

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
        warnings       = _dedup_warnings(warnings),
        tokens_in      = tokens_in,
        tokens_out     = tokens_out,
        latency_ms     = latency_ms,
        prompt_text    = prompt_text,
        response_text  = response_text,
        metadata       = metadata,
        suggestions    = suggestions,
    )


def _lookup_library_template(
    first_model: dict, db: Session,
) -> tuple[str | None, list[str], int | None]:
    """
    Check the template library for a custom (non-OOTB) template matching
    lob+entity+mapping_type. Returns (xml|None, warnings, template_id|None).
    Multiple matches → warning; always uses most recently updated.
    """
    extra_warnings: list[str] = []
    try:
        from api.models import AgentMapperTemplate
        lob          = first_model.get("lob")
        entity       = first_model.get("entity")
        mapping_type = first_model.get("template_name")

        rows = (
            db.query(AgentMapperTemplate)
            .filter(
                AgentMapperTemplate.is_active    == True,
                AgentMapperTemplate.is_ootb      == False,
                AgentMapperTemplate.lob          == lob,
                AgentMapperTemplate.entity       == entity,
                AgentMapperTemplate.mapping_type == mapping_type,
            )
            .order_by(AgentMapperTemplate.updated_at.desc())
            .all()
        )
        if len(rows) > 1:
            extra_warnings.append(
                f"Multiple custom templates found for {lob}/{entity}/{mapping_type} "
                f"— using most recently updated (id={rows[0].id})."
            )
        if rows:
            return rows[0].template_xml, extra_warnings, rows[0].id
        return None, extra_warnings, None
    except Exception:
        return None, [], None


def _create(mapping_models: list[dict]) -> tuple[str, list, list[str]]:
    """
    Create mode: render first mapping fully, then extend with each subsequent.
    Returns (xml, grid, warnings).
    """
    result       = template_engine.render(mapping_models[0])
    xml_output   = result["xml"]
    all_grid     = list(result["grid"])
    all_warnings: list[str] = []
    seen_grid    = {_grid_key(r) for r in all_grid}

    for m in mapping_models[1:]:
        fm_els, new_rows = template_engine.render_field_nodes(m)
        if not fm_els:
            continue
        merged     = merge_manuscript(xml_output, fm_els, new_rows, m)
        xml_output = merged["xml"]
        all_warnings.extend(merged.get("warnings", []))
        for row in merged["grid"]:
            key = _grid_key(row)
            if key not in seen_grid:
                all_grid.append(row)
                seen_grid.add(key)

    return xml_output, all_grid, all_warnings


def _extend(
    existing_xml: str,
    mapping_models: list[dict],
) -> tuple[str, list, list[str]]:
    """
    Extend mode: inject new fieldMaps into existing XML for every mapping model.
    Returns (xml, grid, warnings).
    Controller templates (and any that produce no fieldMaps) are skipped with a warning.
    """
    xml_output      = existing_xml
    all_grid: list  = []
    ext_warnings: list[str] = []
    seen_grid: set  = set()

    for m in mapping_models:
        fm_els, new_rows = template_engine.render_field_nodes(m)
        if not fm_els:
            if m.get("template_name") == "controller":
                ext_warnings.append(
                    f"Controller template for {m.get('entity')} produces no fieldMaps "
                    f"— skipped in extend mode."
                )
            continue
        merged     = merge_manuscript(xml_output, fm_els, new_rows, m)
        xml_output = merged["xml"]
        ext_warnings.extend(merged.get("warnings", []))
        for row in merged["grid"]:
            key = _grid_key(row)
            if key not in seen_grid:
                all_grid.append(row)
                seen_grid.add(key)

    return xml_output, all_grid, ext_warnings
