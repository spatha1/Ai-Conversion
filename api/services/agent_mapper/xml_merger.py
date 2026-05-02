from __future__ import annotations

import copy
import xml.etree.ElementTree as ET
from xml.dom.minidom import parseString as _parse
from typing import Optional

# Local copy of entity→target-table map; avoids circular import with template_engine
_ENTITY_TARGET_MAP: dict[str, str] = {
    "Policy":   "Policy.Policy",
    "Risk":     "Policy.InsuredObject",
    "Coverage": "Coverage.Coverage",
    "Account":  "Policy.Account",
}

_SRC_ATTRS = ("fieldRef", "path", "expression", "value")


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


def _source_sig(el: ET.Element) -> str:
    return "|".join(el.get(a, "") for a in _SRC_ATTRS)


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


def _extract_ref(mapping_model: dict) -> tuple[str, str | None]:
    """Returns (extractRef, warning | None). Always resolves to a table-level path."""
    target = mapping_model.get("target")
    if target:
        # More than one dot suggests a field-level path (e.g. Policy.Policy.PolicyNumber)
        if target.count(".") > 1:
            warn = f"extractRef '{target}' appears field-level — expected table-level path."
            return target, warn
        return target, None
    entity = mapping_model["entity"]
    ref    = _ENTITY_TARGET_MAP.get(entity, f"{entity}.{entity}")
    return ref, None


def merge_manuscript(
    existing_xml:    str,
    new_fm_elements: list[ET.Element],
    new_grid_rows:   list[dict],
    mapping_model:   dict,
) -> dict:
    """
    Merge new <fieldMap> elements into an existing manuscript XML.
    Returns {"xml": str, "grid": list[dict], "warnings": list[str]}.

    Rules:
    - Preserves all existing <include> and <properties inherited>
    - Adds missing <include> nodes
    - Finds matching <extractMap> by objectRef + extractRef; creates if absent
    - Updates fieldMap in-place when source attrs differ (non-source attrs preserved)
    - Skips fieldMap when source attrs are identical (no-op)
    - Grid rows tagged with "operation": "added" | "updated"; existing rows are "existing"
    """
    extra_warnings: list[str] = []

    try:
        root = ET.fromstring(_strip_decl(existing_xml))
    except ET.ParseError as exc:
        raise ValueError(f"Cannot parse existing XML: {exc}") from exc

    entity        = mapping_model["entity"]
    template_name = mapping_model["template_name"]
    obj_ref       = _object_ref(template_name, entity)
    ext_ref, ref_warn = _extract_ref(mapping_model)
    if ref_warn:
        extra_warnings.append(ref_warn)

    # ── Ensure new <include> nodes are present ────────────────────────────────
    existing_refs = {el.get("manuscriptRef") for el in root.findall("include")}
    children      = list(root)
    props_idx     = next((i for i, ch in enumerate(children) if ch.tag == "properties"), len(children))
    insert_at     = props_idx
    for ref in mapping_model.get("include", []):
        if ref not in existing_refs:
            root.insert(insert_at, ET.Element("include", manuscriptRef=ref))
            insert_at     += 1
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

    # ── Build index and baseline grid from existing fieldMaps ─────────────────
    existing_fm_index: dict[str, ET.Element] = {
        fm.get("name", ""): fm for fm in target_em.findall("fieldMap")
    }
    existing_grid = [
        _grid_row_from_fm(fm, entity, ext_ref, inherit_val, include_list)
        for fm in target_em.findall("fieldMap")
    ]

    # ── Inject / update fieldMaps ─────────────────────────────────────────────
    updated_names: set[str] = set()
    added_grid: list[dict] = []
    for fm_el, grid_row in zip(new_fm_elements, new_grid_rows):
        field_name = fm_el.get("name", "")
        row_base   = {**grid_row, "inherit": inherit_val, "include": include_list}

        if field_name in existing_fm_index:
            existing_fm = existing_fm_index[field_name]
            if _source_sig(fm_el) != _source_sig(existing_fm):
                # Update only source attrs present on incoming element; never clear others
                for attr in _SRC_ATTRS:
                    val = fm_el.get(attr)
                    if val is not None:
                        existing_fm.set(attr, val)
                    else:
                        existing_fm.attrib.pop(attr, None)
                updated_names.add(field_name)
                added_grid.append({**row_base, "operation": "updated"})
            # else: identical → no-op
        else:
            target_em.append(copy.deepcopy(fm_el))
            existing_fm_index[field_name] = fm_el
            added_grid.append({**row_base, "operation": "added"})

    # Replace existing rows for updated fields so the grid reflects current state
    existing_grid_final = [
        r for r in existing_grid if r.get("target_field", "") not in updated_names
    ]

    # ── XML/grid consistency check (current extractMap only) ─────────────────
    xml_fields_em  = {fm.get("name","") for fm in target_em.findall("fieldMap")} - {""}
    grid_fields_em = {
        r.get("target_field","") for r in existing_grid_final + added_grid
    } - {""}
    extra_in_xml   = xml_fields_em  - grid_fields_em
    extra_in_grid  = grid_fields_em - xml_fields_em
    if extra_in_xml:
        extra_warnings.append(f"XML/grid mismatch — in XML only: {sorted(extra_in_xml)}")
    if extra_in_grid:
        extra_warnings.append(f"XML/grid mismatch — in grid only: {sorted(extra_in_grid)}")

    return {
        "xml":      _pretty(root),
        "grid":     existing_grid_final + added_grid,
        "warnings": extra_warnings,
    }
