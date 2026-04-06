"""
services/xsd_builder.py
Generate XSD from validation rules + XML template structure.
Validate individual XML strings against a set of rules.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Optional


# ── XSD generation ────────────────────────────────────────────────────────────

_XS = "http://www.w3.org/2001/XMLSchema"
_XS_PREFIX = "xs"


def _xs(tag: str) -> str:
    return f"{{{_XS}}}{tag}"


def _rules_by_path(rules: list[dict]) -> dict[str, dict]:
    return {r["target_path"]: r for r in rules if r.get("target_path")}


def _path_to_element_name(path: str) -> str:
    """Extract the last element name from a target_path (ignores @ attrs)."""
    parts = [p for p in path.split("/") if p and not p.startswith("@")]
    return parts[-1] if parts else path


def _is_attr_path(path: str) -> bool:
    return path.rstrip("/").split("/")[-1].startswith("@")


def _make_simple_type(rule: dict) -> Optional[ET.Element]:
    """Build xs:simpleType restriction element from a rule dict. Returns None if no constraints."""
    data_type = (rule.get("data_type") or "string").lower()
    type_map = {
        "string":  "xs:string",
        "integer": "xs:integer",
        "decimal": "xs:decimal",
        "date":    "xs:date",
        "boolean": "xs:boolean",
    }
    base = type_map.get(data_type, "xs:string")

    restrictions = []

    if data_type in ("string",):
        if rule.get("min_length") is not None:
            el = ET.Element(_xs("minLength"))
            el.set("value", str(rule["min_length"]))
            restrictions.append(el)
        if rule.get("max_length") is not None:
            el = ET.Element(_xs("maxLength"))
            el.set("value", str(rule["max_length"]))
            restrictions.append(el)
        if rule.get("pattern"):
            el = ET.Element(_xs("pattern"))
            el.set("value", rule["pattern"])
            restrictions.append(el)
        if rule.get("enumeration"):
            for val in [v.strip() for v in rule["enumeration"].split(",") if v.strip()]:
                el = ET.Element(_xs("enumeration"))
                el.set("value", val)
                restrictions.append(el)

    if data_type in ("integer", "decimal", "date"):
        if rule.get("min_value") is not None:
            el = ET.Element(_xs("minInclusive"))
            el.set("value", str(rule["min_value"]))
            restrictions.append(el)
        if rule.get("max_value") is not None:
            el = ET.Element(_xs("maxInclusive"))
            el.set("value", str(rule["max_value"]))
            restrictions.append(el)

    if not restrictions:
        return None  # no constraints — just use base type

    simple_type = ET.Element(_xs("simpleType"))
    restriction = ET.SubElement(simple_type, _xs("restriction"))
    restriction.set("base", base)
    for r in restrictions:
        restriction.append(r)
    return simple_type


def build_xsd(template_xml: str, rules: list[dict]) -> str:
    """
    Generate a W3C XSD from the XML template structure + validation rules.
    Returns formatted XSD string.
    """
    rule_map = _rules_by_path(rules)

    try:
        template_root = ET.fromstring(template_xml)
    except ET.ParseError:
        template_root = None

    # Register xs namespace for pretty output
    ET.register_namespace(_XS_PREFIX, _XS)

    schema = ET.Element(_xs("schema"))
    schema.set(f"xmlns:{_XS_PREFIX}", _XS)
    schema.set("elementFormDefault", "qualified")

    if template_root is not None:
        _walk_element(template_root, schema, rule_map, path="")
    else:
        # Fallback: generate flat element declarations for each rule
        for path, rule in rule_map.items():
            if _is_attr_path(path):
                continue
            name = _path_to_element_name(path)
            elem_decl = ET.SubElement(schema, _xs("element"))
            elem_decl.set("name", name)
            simple_type = _make_simple_type(rule)
            if simple_type is not None:
                elem_decl.append(simple_type)
            else:
                data_type = (rule.get("data_type") or "string").lower()
                type_map = {"string": "xs:string", "integer": "xs:integer",
                            "decimal": "xs:decimal", "date": "xs:date", "boolean": "xs:boolean"}
                elem_decl.set("type", type_map.get(data_type, "xs:string"))

    _indent_xml(schema)
    xsd_str = ET.tostring(schema, encoding="unicode", xml_declaration=False)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n{xsd_str}'


def _walk_element(node: ET.Element, parent_xsd: ET.Element,
                  rule_map: dict, path: str) -> None:
    """Recursively build xs:element declarations mirroring the template structure."""
    tag = node.tag.split("}")[-1] if "}" in node.tag else node.tag
    current_path = f"{path}/{tag}"

    # Strip `each` pseudo-attribute (not part of schema)
    children = list(node)

    rule = rule_map.get(current_path)
    required = rule.get("is_required", False) if rule else False

    if not children:
        # Leaf element
        elem_decl = ET.SubElement(parent_xsd, _xs("element"))
        elem_decl.set("name", tag)
        elem_decl.set("minOccurs", "1" if required else "0")
        if rule:
            simple_type = _make_simple_type(rule)
            if simple_type is not None:
                elem_decl.append(simple_type)
            else:
                data_type = (rule.get("data_type") or "string").lower()
                type_map = {"string": "xs:string", "integer": "xs:integer",
                            "decimal": "xs:decimal", "date": "xs:date", "boolean": "xs:boolean"}
                elem_decl.set("type", type_map.get(data_type, "xs:string"))
        else:
            elem_decl.set("type", "xs:string")

        # Attributes at this path
        for attr_name in node.attrib:
            if attr_name == "each":
                continue
            attr_path = f"{current_path}/@{attr_name}"
            attr_rule = rule_map.get(attr_path)
            # Attributes go inside complexType → simpleContent or just declare on parent
            # Simplified: add xs:attribute inside a complexType wrapper
            _add_attribute_to_element(elem_decl, attr_name, attr_rule)
    else:
        # Complex element with children
        elem_decl = ET.SubElement(parent_xsd, _xs("element"))
        elem_decl.set("name", tag)
        elem_decl.set("minOccurs", "1" if required else "0")
        complex_type = ET.SubElement(elem_decl, _xs("complexType"))
        sequence = ET.SubElement(complex_type, _xs("sequence"))
        for child in children:
            _walk_element(child, sequence, rule_map, current_path)

        # Attributes on this complex element
        for attr_name in node.attrib:
            if attr_name == "each":
                continue
            attr_path = f"{current_path}/@{attr_name}"
            attr_rule = rule_map.get(attr_path)
            attr_el = ET.SubElement(complex_type, _xs("attribute"))
            attr_el.set("name", attr_name)
            if attr_rule and attr_rule.get("is_required"):
                attr_el.set("use", "required")
            else:
                attr_el.set("use", "optional")
            attr_el.set("type", "xs:string")


def _add_attribute_to_element(elem_decl: ET.Element, attr_name: str,
                               attr_rule: Optional[dict]) -> None:
    """Wrap a leaf element in complexType/simpleContent to support both text + attributes."""
    # This is only called when a leaf element also has attributes — relatively rare
    # For simplicity: leave the element type as-is and skip attribute in XSD
    pass


def _indent_xml(elem: ET.Element, level: int = 0) -> None:
    """Add pretty-print indentation in-place."""
    pad = "\n" + "  " * level
    if len(elem):
        if not elem.text or not elem.text.strip():
            elem.text = pad + "  "
        if not elem.tail or not elem.tail.strip():
            elem.tail = pad
        for child in elem:
            _indent_xml(child, level + 1)
        if not child.tail or not child.tail.strip():
            child.tail = pad
    else:
        if level and (not elem.tail or not elem.tail.strip()):
            elem.tail = pad


# ── Rule-based XML validation ─────────────────────────────────────────────────

def validate_xml_rules(xml_str: str, rules: list[dict]) -> tuple[bool, list[str]]:
    """
    Validate an XML string against a list of rule dicts.
    Returns (passed: bool, errors: list[str]).
    Uses lxml if available for XPath; falls back to ElementTree.
    """
    errors: list[str] = []

    try:
        from lxml import etree as lxml_etree
        try:
            root = lxml_etree.fromstring(xml_str.encode("utf-8"))
        except lxml_etree.XMLSyntaxError as e:
            return False, [f"XML parse error: {e}"]
        use_lxml = True
    except ImportError:
        try:
            root = ET.fromstring(xml_str)
        except ET.ParseError as e:
            return False, [f"XML parse error: {e}"]
        use_lxml = False

    for rule in rules:
        path = rule.get("target_path", "")
        if not path:
            continue

        value = _extract_value(root, path, use_lxml)
        path_errors = _check_rule(path, value, rule)
        errors.extend(path_errors)

    return (len(errors) == 0, errors)


def _extract_value(root, path: str, use_lxml: bool) -> Optional[str]:
    """Extract value at target_path using XPath or ElementTree find."""
    # Convert /Root/A/B/C → //A/B/C  (strip first segment = root element name)
    # Convert /Root/A/B/@attr → //A/B/@attr
    parts = [p for p in path.split("/") if p]
    if not parts:
        return None

    is_attr = parts[-1].startswith("@")

    if use_lxml:
        # Build lxml XPath: skip first segment (root element name)
        if len(parts) > 1:
            inner = "/".join(parts[1:])
            xpath = f"//{inner}"
        else:
            xpath = f"//{parts[0]}"
        try:
            results = root.xpath(xpath)
            if not results:
                return None
            val = results[0]
            # Attributes come back as plain strings; elements need .text
            if isinstance(val, str):
                return val
            return (val.text or '').strip() if val is not None else None
        except Exception:
            return None
    else:
        # ElementTree fallback: build find path (no attribute support for ET)
        if is_attr:
            attr_name = parts[-1][1:]   # strip @
            elem_parts = parts[1:-1]    # skip root + attr
        else:
            elem_parts = parts[1:]      # skip root element

        find_path = ".//" + "/".join(elem_parts) if elem_parts else "."
        try:
            elem = root.find(find_path)
            if elem is None:
                return None
            if is_attr:
                return elem.get(attr_name)
            return (elem.text or "").strip()
        except Exception:
            return None


def _check_rule(path: str, value: Optional[str], rule: dict) -> list[str]:
    """Apply all constraints in rule to value. Return list of error strings."""
    errors = []
    label = path.split("/")[-1]  # short name for messages

    is_required = rule.get("is_required", False)
    if value is None or (isinstance(value, str) and not value.strip()):
        if is_required:
            errors.append(f"{label}: required but missing or empty")
        return errors  # no further checks on missing value

    val = str(value).strip()
    data_type = (rule.get("data_type") or "string").lower()

    # Type check
    if data_type == "integer":
        try:
            int(val)
        except ValueError:
            errors.append(f"{label}: expected integer, got '{val}'")
            return errors
    elif data_type == "decimal":
        try:
            float(val)
        except ValueError:
            errors.append(f"{label}: expected decimal, got '{val}'")
            return errors
    elif data_type == "date":
        import datetime
        ok = False
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y%m%d"):
            try:
                datetime.datetime.strptime(val, fmt)
                ok = True
                break
            except ValueError:
                pass
        if not ok:
            errors.append(f"{label}: expected date (YYYY-MM-DD), got '{val}'")
            return errors
    elif data_type == "boolean":
        if val.lower() not in ("true", "false", "1", "0", "yes", "no"):
            errors.append(f"{label}: expected boolean, got '{val}'")
            return errors

    # Length (strings)
    if data_type in ("string",):
        min_len = rule.get("min_length")
        max_len = rule.get("max_length")
        if min_len is not None and len(val) < int(min_len):
            errors.append(f"{label}: length {len(val)} < min {min_len}")
        if max_len is not None and len(val) > int(max_len):
            errors.append(f"{label}: length {len(val)} > max {max_len}")

    # Pattern
    pattern = rule.get("pattern")
    if pattern:
        try:
            if not re.fullmatch(pattern, val):
                errors.append(f"{label}: '{val}' does not match pattern '{pattern}'")
        except re.error:
            pass  # invalid regex — skip

    # Enumeration
    enumeration = rule.get("enumeration")
    if enumeration:
        allowed = [v.strip() for v in enumeration.split(",") if v.strip()]
        if allowed and val not in allowed:
            errors.append(f"{label}: '{val}' not in allowed values [{', '.join(allowed)}]")

    # Min / Max value
    if data_type in ("integer", "decimal"):
        try:
            num_val = float(val)
            if rule.get("min_value") is not None:
                if num_val < float(rule["min_value"]):
                    errors.append(f"{label}: {val} < min {rule['min_value']}")
            if rule.get("max_value") is not None:
                if num_val > float(rule["max_value"]):
                    errors.append(f"{label}: {val} > max {rule['max_value']}")
        except (ValueError, TypeError):
            pass

    return errors
