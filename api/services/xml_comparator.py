# ═══════════════════════════════════════════════════════════
# xml_comparator.py — XML field extraction + UI comparison
#
# Parses an XML file using lxml (already installed) and
# compares extracted field values against UI values captured
# by playwright_runner.
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


def parse_xml_fields(
    xml_source: str,
    field_names: list[str],
    *,
    is_content: bool = False,
) -> dict[str, str | None]:
    """
    Extract named fields from XML.

    Args:
        xml_source:  Either a file path (default) or raw XML string when is_content=True.
        field_names: Field names to search for (case-insensitive tag/attribute match).
        is_content:  When True, xml_source is treated as XML text, not a file path.

    Returns a dict {field_name: value_or_None}.
    """
    try:
        from lxml import etree
    except ImportError:
        raise RuntimeError("lxml is not installed. Run: pip install lxml")

    result: dict[str, str | None] = {name: None for name in field_names}

    try:
        if is_content:
            root = etree.fromstring(xml_source.encode("utf-8"))
        else:
            tree = etree.parse(xml_source)
            root = tree.getroot()
    except Exception as exc:
        logger.error("Failed to parse XML: %s", exc)
        return result

    lower_map = {name.lower(): name for name in field_names}

    def _search(node: Any) -> None:
        # Check element tag (strip namespace)
        local_tag = etree.QName(node.tag).localname if node.tag else ""
        canonical = lower_map.get(local_tag.lower())
        if canonical and result[canonical] is None:
            text = (node.text or "").strip()
            if text:
                result[canonical] = text

        # Check element attributes
        for attr_key, attr_val in node.attrib.items():
            canonical = lower_map.get(attr_key.lower())
            if canonical and result[canonical] is None:
                result[canonical] = attr_val.strip()

        for child in node:
            _search(child)

    _search(root)
    return result


def _normalise(value: str | None) -> str:
    """Strip whitespace and collapse internal spaces for comparison."""
    if value is None:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def compare_fields(
    ui_values: dict[str, str | None],
    xml_values: dict[str, str | None],
) -> dict[str, Any]:
    """
    Compare UI-extracted values against XML-parsed values field by field.

    Returns:
        {
            results: [{field, ui_value, xml_value, status}],
            summary: {total, matched, mismatched, missing}
        }

    Status values:
        MATCH     — both present and equal (normalised)
        MISMATCH  — both present but differ
        MISSING   — present in UI but not found in XML
        NO_XML    — xml_values is empty / xml_path was None
    """
    all_fields = sorted(set(ui_values) | set(xml_values))

    # If no XML values at all, every field gets NO_XML
    has_xml = any(v is not None for v in xml_values.values()) if xml_values else False

    results: list[dict[str, Any]] = []
    matched = 0
    mismatched = 0
    missing = 0

    for field in all_fields:
        ui_val  = ui_values.get(field)
        xml_val = xml_values.get(field)

        if not has_xml:
            status = "NO_XML"
        elif xml_val is None:
            status = "MISSING"
            missing += 1
        elif _normalise(ui_val) == _normalise(xml_val):
            status = "MATCH"
            matched += 1
        else:
            status = "MISMATCH"
            mismatched += 1

        results.append({
            "field":     field,
            "ui_value":  ui_val,
            "xml_value": xml_val,
            "status":    status,
        })

    total = len(results)
    return {
        "results": results,
        "summary": {
            "total":      total,
            "matched":    matched,
            "mismatched": mismatched,
            "missing":    missing,
        },
    }
