from __future__ import annotations

import copy
import xml.etree.ElementTree as ET
from xml.dom.minidom import parseString as _parse
from typing import Optional


def _pretty(root: ET.Element) -> str:
    raw   = ET.tostring(root, encoding="unicode")
    dom   = _parse(raw)
    lines = [l for l in dom.toprettyxml(indent="  ").splitlines() if l.strip()]
    lines[0] = '<?xml version="1.0" encoding="UTF-8"?>'
    return "\n".join(lines)


def _strip_decl(xml_str: str) -> str:
    s = xml_str.strip()
    if s.startswith("<?xml"):
        end = s.index("?>")
        return s[end + 2:].strip()
    return s


def _grid_row_from_fm(
    fm: ET.Element, entity: str, target_table: str,
    inherit: Optional[str], include: list[str],
) -> dict:
    name   = fm.get("name", "")
    source = (
        fm.get("fieldRef") or fm.get("path") or
        fm.get("expression") or fm.get("value") or ""
    )
    return {
        "entity":       entity,
        "target_table": target_table,
        "target_field": name,
        "source":       source,
        "type":         "existing",
        "rule":         "existing",
        "include":      include,
        "inherit":      inherit,
    }


def _object_ref(template_name: str, entity: str) -> str:
    if template_name == "risk":
        return "Risk"
    if template_name == "dynamic":
        return "PrivateFields"
    return entity


def _extract_ref(mapping_model: dict) -> str:
    target = mapping_model.get("target")
    if target:
        return target
    entity = mapping_model["entity"]
    field  = mapping_model.get("field", "")
    return f"{entity}.{field}"


def merge_manuscript(
    existing_xml:   str,
    new_fm_elements: list[ET.Element],
    new_grid_rows:   list[dict],
    mapping_model:   dict,
) -> dict:
    """
    Merge new <fieldMap> elements into an existing manuscript XML.
    Returns {"xml": str, "grid": list[dict]}.

    Rules:
    - Preserves all existing <include> and <properties inherited>
    - Adds missing <include> nodes
    - Finds matching <extractMap> by objectRef + extractRef
    - Creates <extractMap> if not found
    - Skips fieldMap if name already exists (duplicate guard)
    - Grid = existing rows + only actually-added rows
    """
    try:
        root = ET.fromstring(_strip_decl(existing_xml))
    except ET.ParseError as exc:
        raise ValueError(f"Cannot parse existing XML: {exc}") from exc

    entity        = mapping_model["entity"]
    template_name = mapping_model["template_name"]
    obj_ref       = _object_ref(template_name, entity)
    ext_ref       = _extract_ref(mapping_model)

    # ── Ensure new <include> nodes are present ────────────────────────────────
    existing_refs = {el.get("manuscriptRef") for el in root.findall("include")}
    children      = list(root)
    props_idx     = next((i for i, ch in enumerate(children) if ch.tag == "properties"), len(children))
    insert_at     = props_idx
    for ref in mapping_model.get("include", []):
        if ref not in existing_refs:
            root.insert(insert_at, ET.Element("include", manuscriptRef=ref))
            insert_at      += 1
            existing_refs.add(ref)

    # ── Resolve inherit from existing <properties> ────────────────────────────
    props_el    = root.find("properties")
    inherit_val = (props_el.get("inherited") if props_el is not None else None)
    include_list = list(existing_refs)

    # ── Find or create <Extract> ──────────────────────────────────────────────
    extract_el = root.find("Extract")
    if extract_el is None:
        extract_el = ET.SubElement(root, "Extract")

    # ── Find or create matching <extractMap> ─────────────────────────────────
    target_em = None
    for em in extract_el.findall("extractMap"):
        if em.get("objectRef") == obj_ref and em.get("extractRef") == ext_ref:
            target_em = em
            break

    if target_em is None:
        em_attrs = {"objectRef": obj_ref, "extractRef": ext_ref}
        if template_name in ("extra_party", "extra_policy", "reference"):
            field = mapping_model.get("field", "")
            em_attrs["preFilter"] = f"{field} != ''"
        target_em = ET.SubElement(extract_el, "extractMap", em_attrs)

    # ── Existing fieldMap names (duplicate guard) ─────────────────────────────
    existing_names = {fm.get("name", "") for fm in target_em.findall("fieldMap")}

    # ── Grid from existing fieldMaps ──────────────────────────────────────────
    existing_grid = [
        _grid_row_from_fm(fm, entity, ext_ref, inherit_val, include_list)
        for fm in target_em.findall("fieldMap")
    ]

    # ── Inject new fieldMaps (skip duplicates) ────────────────────────────────
    added_grid: list[dict] = []
    for fm_el, grid_row in zip(new_fm_elements, new_grid_rows):
        field_name = fm_el.get("name", "")
        if field_name in existing_names:
            continue
        target_em.append(copy.deepcopy(fm_el))
        existing_names.add(field_name)
        added_grid.append({**grid_row, "inherit": inherit_val, "include": include_list})

    return {"xml": _pretty(root), "grid": existing_grid + added_grid}
