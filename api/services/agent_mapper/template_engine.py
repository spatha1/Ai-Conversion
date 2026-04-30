from __future__ import annotations
import xml.etree.ElementTree as ET
from xml.dom.minidom import parseString as _parse


def _pretty(root: ET.Element) -> str:
    raw   = ET.tostring(root, encoding="unicode")
    dom   = _parse(raw)
    lines = [l for l in dom.toprettyxml(indent="  ").splitlines() if l.strip()]
    lines[0] = '<?xml version="1.0" encoding="UTF-8"?>'
    return "\n".join(lines)


def _root(m: dict) -> ET.Element:
    ms = ET.Element("ManuScript")
    for ref in m.get("include", []):
        ET.SubElement(ms, "include", manuscriptRef=str(ref))
    props_attrs = {
        "manuscriptID":     f'{m["lob"]}_{m["entity"]}_{m["template_name"]}',
        "versionID":        "ExtractMap",
        "versionDate":      "2026-01-01",
        "version":          "1",
        "boolean":          "1",
        "fieldCache":       "1",
        "shortCircuitCond": "1",
        "caption":          f'{m["lob"]} {m["entity"]} {m["template_name"]}',
    }
    if m.get("inherit"):
        props_attrs["inherited"] = str(m["inherit"])
    ET.SubElement(ms, "properties", props_attrs)
    return ms


def _extract(ms: ET.Element) -> ET.Element:
    return ET.SubElement(ms, "Extract")


def _fm(parent: ET.Element, grid: list, base_row: dict,
        target_field: str, source: str, ftype: str, rule: str, **attrs) -> None:
    ET.SubElement(parent, "fieldMap", attrib=attrs)
    grid.append({**base_row, "target_field": target_field, "source": source, "type": ftype, "rule": rule})


# ── Renderers ──────────────────────────────────────────────────────────────────

def render_extra_party(m: dict) -> dict:
    ms, grid = _root(m), []
    ext = _extract(ms)
    em  = ET.SubElement(ext, "extractMap", {
        "objectRef":  m["entity"], "extractRef": "Party.PartyExtraData",
        "preFilter":  f"{m['field']} != ''",
    })
    base = {"entity": m["entity"], "target_table": "Party.PartyExtraData",
            "inherit": m.get("inherit"), "include": m.get("include", [])}
    _fm(em, grid, base, "PartyKey",          "data.ClientID",   "base",  "OOTB",  name="PartyKey",          fieldRef="data.ClientID")
    _fm(em, grid, base, "ColumnName",        m["field"],        "extra", "extra", name="ColumnName",        value=m["field"])
    _fm(em, grid, base, "ColumnValue",       m["source"],       "extra", "extra", name="ColumnValue",       path=m["source"])
    _fm(em, grid, base, "EntityVariableKey", m["entity"],       "base",  "OOTB",  name="EntityVariableKey", value=m["entity"])
    return {"xml": _pretty(ms), "grid": grid}


def render_extra_policy(m: dict) -> dict:
    ms, grid = _root(m), []
    ext = _extract(ms)
    em  = ET.SubElement(ext, "extractMap", {
        "objectRef": m["entity"], "extractRef": "Policy.PolicyExtraData",
        "preFilter": f"{m['field']} != ''",
    })
    base = {"entity": m["entity"], "target_table": "Policy.PolicyExtraData",
            "inherit": m.get("inherit"), "include": m.get("include", [])}
    _fm(em, grid, base, "ColumnName",  m["field"],  "extra", "extra", name="ColumnName",  value=m["field"])
    _fm(em, grid, base, "ColumnValue", m["source"], "extra", "extra", name="ColumnValue", path=m["source"])
    return {"xml": _pretty(ms), "grid": grid}


def render_dynamic(m: dict) -> dict:
    ms, grid = _root(m), []
    ext = _extract(ms)
    em  = ET.SubElement(ext, "extractMap", {
        "objectRef": "PrivateFields", "extractRef": "Policy.PolicyRating",
    })
    base = {"entity": m["entity"], "target_table": "Policy.PolicyRating",
            "inherit": m.get("inherit"), "include": m.get("include", [])}
    _fm(em, grid, base, "PolicyRatingName",  "PrivateFields.Name",  "base",    "OOTB", name="PolicyRatingName",  fieldRef="PrivateFields.Name")
    _fm(em, grid, base, "PolicyRatingValue", "substring(.,1,100)",  "derived", "OOTB", name="PolicyRatingValue", expression="substring(.,1,100)")
    return {"xml": _pretty(ms), "grid": grid}


def render_risk(m: dict) -> dict:
    ms, grid = _root(m), []
    ext = _extract(ms)
    em  = ET.SubElement(ext, "extractMap", {
        "objectRef": "Risk", "extractRef": "Policy.InsuredObject",
    })
    base = {"entity": m["entity"], "target_table": "Policy.InsuredObject",
            "inherit": m.get("inherit"), "include": m.get("include", [])}
    _fm(em, grid, base, "InsuredObjectKey",    "Risk.Id",                          "base",     "OOTB",        name="InsuredObjectKey",    fieldRef="Risk.Id")
    _fm(em, grid, base, "RiskState",           "(Risk/StateCode[. != ''])[1]",     "derived",  "conditional", name="RiskState",           expression="(Risk/StateCode[. != ''])[1]")
    _fm(em, grid, base, "AddressKey",          "Risk.RiskAddressKey",              "base",     "OOTB",        name="AddressKey",          fieldRef="Risk.RiskAddressKey")
    _fm(em, grid, base, "InsuredObjectNumber", "position()",                       "iterator", "OOTB",        name="InsuredObjectNumber", expression="position()")
    _fm(em, grid, base, m["field"],            f"Risk.{m['source']}",              "user",     "direct",      name=m["field"],            fieldRef=f"Risk.{m['source']}")
    return {"xml": _pretty(ms), "grid": grid}


def render_reference(m: dict) -> dict:
    ms, grid = _root(m), []
    f, src, entity = m["field"], m["source"], m["entity"]
    ext = _extract(ms)
    em  = ET.SubElement(ext, "extractMap", {
        "objectRef": entity, "extractRef": f"{entity}.{f}",
        "preFilter": f"{src} != ''",
    })
    base = {"entity": entity, "target_table": f"{entity}.{f}",
            "inherit": m.get("inherit"), "include": m.get("include", [])}
    _fm(em, grid, base, f"{f}Key",  f"substring({src}, 1, 50)", "reference", "reference", name=f"{f}Key",  expression=f"substring({src}, 1, 50)")
    _fm(em, grid, base, f,          f"substring({src}, 1, 50)", "reference", "reference", name=f,          expression=f"substring({src}, 1, 50)")
    _fm(em, grid, base, f"{f}Name", src,                        "reference", "reference", name=f"{f}Name", path=src)
    _fm(em, grid, base, f"{f}Desc", src,                        "reference", "reference", name=f"{f}Desc", path=src)
    return {"xml": _pretty(ms), "grid": grid}


def render_base(m: dict) -> dict:
    ms, grid = _root(m), []
    ext = _extract(ms)
    em  = ET.SubElement(ext, "extractMap", {
        "objectRef": m["entity"], "extractRef": f"{m['entity']}.{m['field']}",
    })
    base = {"entity": m["entity"], "target_table": f"{m['entity']}.{m['field']}",
            "inherit": m.get("inherit"), "include": m.get("include", [])}
    _fm(em, grid, base, m["field"], m["source"], "user", "direct", name=m["field"], fieldRef=m["source"])
    return {"xml": _pretty(ms), "grid": grid}


def render_controller(m: dict) -> dict:
    ms   = _root(m)
    grid = []
    return {"xml": _pretty(ms), "grid": grid}


_RENDERERS = {
    "extra_party":  render_extra_party,
    "extra_policy": render_extra_policy,
    "dynamic":      render_dynamic,
    "risk":         render_risk,
    "reference":    render_reference,
    "base":         render_base,
    "controller":   render_controller,
}


def render(mapping_model: dict) -> dict:
    """Returns {"xml": str, "grid": list[dict]}"""
    fn = _RENDERERS[mapping_model["template_name"]]
    return fn(mapping_model)
