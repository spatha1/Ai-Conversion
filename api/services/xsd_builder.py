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

def _normalize_path(path: str) -> str:
    """
    Normalize a user-entered path to slash-separated format.
    Handles:
      - Dot notation:   Root.Employee.Salary  →  Root/Employee/Salary
      - Slash notation: /Root/Employee/Salary  →  Root/Employee/Salary (strip leading /)
      - Mixed:          Root/Employee.Salary   →  treated as-is
    """
    p = path.strip()
    # If no slashes at all, treat dots as path separators
    if "/" not in p:
        p = p.replace(".", "/")
    # Strip leading slash
    p = p.lstrip("/")
    return p


def validate_xml_rules(xml_str: str, rules: list[dict]) -> tuple[bool, list[dict]]:
    """
    Validate an XML string against a list of rule dicts.
    Returns (passed: bool, errors: list[dict]).
    Each error dict: { path, message, actual, expected }
    """
    errors: list[dict] = []

    try:
        from lxml import etree as lxml_etree
        try:
            root = lxml_etree.fromstring(xml_str.encode("utf-8"))
        except lxml_etree.XMLSyntaxError as e:
            return False, [{"path": "", "message": f"XML parse error: {e}", "actual": "", "expected": ""}]
        use_lxml = True
    except ImportError:
        try:
            root = ET.fromstring(xml_str)
        except ET.ParseError as e:
            return False, [{"path": "", "message": f"XML parse error: {e}", "actual": "", "expected": ""}]
        use_lxml = False

    for rule in rules:
        raw_path = rule.get("target_path", "")
        if not raw_path:
            continue

        found, value = _extract_value(root, raw_path, use_lxml)
        rule_errors = _check_rule(raw_path, value, rule, element_found=found)
        errors.extend(rule_errors)

    return (len(errors) == 0, errors)


def _extract_value(root, path: str, use_lxml: bool) -> tuple[bool, Optional[str]]:
    """
    Extract value at target_path.
    Returns (found: bool, value: str | None).
      found=False  → element does not exist in the XML at all
      found=True   → element exists (value may be empty string)

    Search strategies (in order):
      1. Skip root element name, strict sub-path:  //Employee/Salary
      2. Leaf-only depth-agnostic:                 //Salary
      3. Case-insensitive leaf match:               //*[lower-case(local-name())='salary']
    This handles wrapper elements, root name mismatches, and minor case differences.
    """
    normalized = _normalize_path(path)
    parts = [p for p in normalized.split("/") if p]
    if not parts:
        return False, None

    is_attr = parts[-1].startswith("@")

    if use_lxml:
        if is_attr:
            attr_name = parts[-1][1:]
            elem_parts = parts[:-1]
        else:
            elem_parts = parts
            attr_name = None

        def try_xpath(xp: str):
            try:
                return root.xpath(xp)
            except Exception:
                return []

        leaf = elem_parts[-1]

        # Strategy 1: strict inner path (skip root name)
        if len(elem_parts) > 1:
            inner = "/".join(elem_parts[1:])
            results = try_xpath(f"//{inner}" + (f"/@{attr_name}" if is_attr else ""))
            if results:
                val = results[0]
                text = val if isinstance(val, str) else (val.text or '' if hasattr(val, 'text') else str(val))
                return True, text.strip()

        # Strategy 2: leaf-only
        if is_attr:
            results = try_xpath(f"//{leaf}/@{attr_name}")
        else:
            results = try_xpath(f"//{leaf}")
        if results:
            val = results[0]
            text = val if isinstance(val, str) else (val.text or '' if hasattr(val, 'text') else str(val))
            return True, text.strip()

        # Strategy 3: case-insensitive leaf match (XPath 2.0 lower-case — may not be supported)
        leaf_lower = leaf.lower()
        try:
            results = try_xpath(
                f"//*[translate(local-name(),"
                f"'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='{leaf_lower}']"
            )
            if results:
                val = results[0]
                text = (val.text or '').strip() if hasattr(val, 'text') else str(val).strip()
                return True, text
        except Exception:
            pass

        return False, None

    else:
        # ElementTree fallback
        if is_attr:
            attr_name = parts[-1][1:]
            elem_parts = parts[:-1]
        else:
            elem_parts = parts
            attr_name = None

        leaf = elem_parts[-1]

        def _get(elem):
            if elem is None:
                return None
            if is_attr:
                return elem.get(attr_name)
            return (elem.text or "").strip()

        # Strategy 1: skip root name, strict sub-path
        if len(elem_parts) > 1:
            inner = "/".join(elem_parts[1:])
            try:
                elem = root.find(f".//{inner}")
                if elem is not None:
                    return True, _get(elem)
            except Exception:
                pass

        # Strategy 2: leaf-only
        try:
            elem = root.find(f".//{leaf}")
            if elem is not None:
                return True, _get(elem)
        except Exception:
            pass

        # Strategy 3: case-insensitive scan of all elements
        leaf_lower = leaf.lower()
        for elem in root.iter():
            tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
            if tag.lower() == leaf_lower:
                return True, _get(elem)

        return False, None


def _check_rule(path: str, value: Optional[str], rule: dict, element_found: bool = True) -> list[dict]:
    """
    Apply all constraints in rule to value.
    Returns list of error dicts: { path, message, actual, expected }.
    element_found=False means the XML element/path doesn't exist at all.
    """
    errors: list[dict] = []
    label = _normalize_path(path).split("/")[-1]  # short field name for messages

    def err(message: str, actual: str = "", expected: str = "") -> dict:
        return {"path": path, "message": message, "actual": actual, "expected": expected}

    is_required = rule.get("is_required", False)

    # Element not found in XML at all — path mismatch
    if not element_found:
        errors.append(err(
            f"{label}: XML element not found — check path",
            actual="(path not found in XML)",
            expected=f"element matching '{path}'",
        ))
        return errors

    if value is None or (isinstance(value, str) and not value.strip()):
        if is_required:
            errors.append(err(
                f"{label}: required but empty",
                actual="(empty)",
                expected="non-empty value",
            ))
        return errors  # no further checks on empty value

    val = str(value).strip()
    data_type = (rule.get("data_type") or "string").lower()

    # ── Type check ────────────────────────────────────────────
    if data_type == "integer":
        try:
            int(val)
        except ValueError:
            errors.append(err(f"{label}: expected integer", actual=val, expected="integer number"))
            return errors

    elif data_type == "decimal":
        try:
            float(val)
        except ValueError:
            errors.append(err(f"{label}: expected decimal", actual=val, expected="decimal number"))
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
            errors.append(err(f"{label}: invalid date format", actual=val, expected="YYYY-MM-DD"))
            return errors

    elif data_type == "boolean":
        if val.lower() not in ("true", "false", "1", "0", "yes", "no"):
            errors.append(err(f"{label}: expected boolean", actual=val, expected="true / false / 1 / 0"))
            return errors

    # ── String length ─────────────────────────────────────────
    if data_type == "string":
        min_len = rule.get("min_length")
        max_len = rule.get("max_length")
        if min_len is not None and len(val) < int(min_len):
            errors.append(err(
                f"{label}: too short (length {len(val)})",
                actual=f'"{val}" (len={len(val)})',
                expected=f"min length {min_len}",
            ))
        if max_len is not None and len(val) > int(max_len):
            errors.append(err(
                f"{label}: too long (length {len(val)})",
                actual=f'"{val}" (len={len(val)})',
                expected=f"max length {max_len}",
            ))

    # ── Pattern ───────────────────────────────────────────────
    pattern = rule.get("pattern")
    if pattern:
        try:
            if not re.fullmatch(pattern, val):
                errors.append(err(
                    f"{label}: pattern mismatch",
                    actual=val,
                    expected=f"matches /{pattern}/",
                ))
        except re.error:
            pass

    # ── Enumeration ───────────────────────────────────────────
    enumeration = rule.get("enumeration")
    if enumeration:
        allowed = [v.strip() for v in enumeration.split(",") if v.strip()]
        if allowed and val not in allowed:
            errors.append(err(
                f"{label}: not an allowed value",
                actual=val,
                expected=f"one of: {', '.join(allowed)}",
            ))

    # ── Min / Max value ───────────────────────────────────────
    if data_type in ("integer", "decimal"):
        try:
            num_val = float(val)
            if rule.get("min_value") is not None:
                min_v = float(rule["min_value"])
                if num_val < min_v:
                    errors.append(err(
                        f"{label}: value below minimum",
                        actual=str(val),
                        expected=f">= {rule['min_value']}",
                    ))
            if rule.get("max_value") is not None:
                max_v = float(rule["max_value"])
                if num_val > max_v:
                    errors.append(err(
                        f"{label}: value exceeds maximum",
                        actual=str(val),
                        expected=f"<= {rule['max_value']}",
                    ))
        except (ValueError, TypeError):
            pass

    return errors
