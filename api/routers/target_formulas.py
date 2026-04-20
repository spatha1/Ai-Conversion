# ═══════════════════════════════════════════════════════════
# routers/target_formulas.py
#
# Endpoints:
#   POST   /api/target-formulas/process            — upload template, parse & save template + formula rules
#   GET    /api/target-formulas?conn_id=N          — list formula rules for a connection
#   DELETE /api/target-formulas?conn_id=N          — clear formula rules for a connection
#   GET    /api/target-formulas/{conn_id}/template — return raw template content
#
# Supported formats: xml | json | text | sql
# ═══════════════════════════════════════════════════════════
import json
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import XmlTemplate, TargetFormulaRule

from api.dependencies import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])


# ── Pydantic schemas ─────────────────────────────────────────

class ProcessXmlRequest(BaseModel):
    xml_content: str
    conn_id:     Optional[int] = None
    name:        Optional[str] = "template.xml"
    format_type: Optional[str] = "xml"   # "xml" | "json" | "text" | "sql"


class FormulaRuleOut(BaseModel):
    id:              Optional[int]   = None
    conn_id:         Optional[int]   = None
    target_path:     Optional[str]   = None
    group_path:      Optional[str]   = None
    formula_type:    Optional[str]   = None
    expression:      Optional[str]   = None
    default_value:   Optional[str]   = None
    execution_order: Optional[int]   = None


class ProcessResult(BaseModel):
    inserted:    int
    template_id: Optional[int] = None
    format_type: Optional[str] = "xml"
    rules:       list[FormulaRuleOut]


# ── XML parsing helpers ───────────────────────────────────────

def _local_tag(tag: str) -> str:
    """Strip namespace URI from a tag string like '{http://...}localname'."""
    return tag.split("}")[-1] if "}" in tag else tag


def _extract_leaf_nodes(root) -> dict:
    """Walk an ElementTree root and collect all leaf text values by path."""
    leaf_values = defaultdict(list)

    def walk(node, current_path):
        tag  = _local_tag(node.tag)
        path = f"{current_path}/{tag}"
        children = list(node)
        if not children:
            leaf_values[path].append((node.text or "").strip())
        else:
            for child in children:
                walk(child, path)

    walk(root, "")
    return leaf_values


def _infer_group_path(full_path: str) -> Optional[str]:
    parts = full_path.strip("/").split("/")
    if len(parts) >= 2:
        return f"/{parts[-2]}"
    return None


def _build_formula_rules(xml_string: str) -> list[dict]:
    """Parse XML string and return a list of formula-rule dicts."""
    try:
        root = ET.fromstring(xml_string)
    except ET.ParseError as exc:
        raise ValueError(f"XML parse error: {exc}") from exc

    leaf_nodes = _extract_leaf_nodes(root)
    rules = []
    execution_order = 1

    for full_path, values in leaf_nodes.items():
        group_path  = _infer_group_path(full_path)
        field_name  = full_path.strip("/").split("/")[-1]
        target_path = f"{group_path}/{field_name}" if group_path else full_path

        unique_values = {v for v in values if v != ""}

        if len(unique_values) == 1:
            formula_type  = "DEFAULT"
            default_value = list(unique_values)[0]
            expression    = None
        else:
            formula_type  = "DIRECT"
            default_value = None
            expression    = None

        rules.append({
            "target_path":     target_path,
            "group_path":      group_path,
            "formula_type":    formula_type,
            "expression":      expression,
            "default_value":   default_value,
            "execution_order": execution_order,
        })
        execution_order += 1

    return rules


# ── JSON parsing helpers ──────────────────────────────────────

def _walk_json(obj, prefix: str, results: list):
    """Recursively walk a JSON object, collecting leaf paths in $.Key.Nested notation."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            _walk_json(v, f"{prefix}.{k}", results)
    elif isinstance(obj, list):
        sample = obj[0] if obj else None
        _walk_json(sample, f"{prefix}[*]", results)
    else:
        results.append(prefix)


def _build_formula_rules_json(content: str) -> list[dict]:
    """Parse a JSON template and return formula-rule dicts (one per unique leaf path)."""
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON parse error: {exc}") from exc

    raw_paths: list[str] = []
    _walk_json(data, "$", raw_paths)

    seen: set[str] = set()
    rules: list[dict] = []
    order = 1
    for path in raw_paths:
        if path not in seen:
            seen.add(path)
            rules.append({
                "target_path":     path,
                "group_path":      None,
                "formula_type":    "DIRECT",
                "expression":      None,
                "default_value":   None,
                "execution_order": order,
            })
            order += 1
    return rules


# ── Text / SQL parsing helpers ────────────────────────────────

def _build_formula_rules_text(content: str) -> list[dict]:
    """
    Extract {PlaceholderName} tokens from a text or SQL template.
    Each unique placeholder becomes one DIRECT formula rule.
    """
    placeholders = re.findall(r'\{([^}]+)\}', content)
    seen: set[str] = set()
    rules: list[dict] = []
    order = 1
    for name in placeholders:
        if name not in seen:
            seen.add(name)
            rules.append({
                "target_path":     name,
                "group_path":      None,
                "formula_type":    "DIRECT",
                "expression":      None,
                "default_value":   None,
                "execution_order": order,
            })
            order += 1
    return rules


# ── Format dispatcher ─────────────────────────────────────────

def _dispatch_build_rules(content: str, format_type: str) -> list[dict]:
    if format_type == "json":
        return _build_formula_rules_json(content)
    if format_type in ("text", "sql"):
        return _build_formula_rules_text(content)
    return _build_formula_rules(content)   # default: xml


# ── Endpoints ─────────────────────────────────────────────────

@router.post("/target-formulas/process", response_model=ProcessResult)
def process_xml(req: ProcessXmlRequest, db: Session = Depends(get_db)):
    """
    Accept template content (XML / JSON / text / SQL), extract formula rules, and save:
      1. Raw content to conversion_xml_templates (linked to conn_id)
      2. Parsed rules to conversion_target_formula_rules (linked to conn_id)
    """
    fmt = (req.format_type or "xml").lower()

    try:
        rules = _dispatch_build_rules(req.xml_content, fmt)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # 1. Upsert XmlTemplate for this connection
    template_id = None
    if req.conn_id:
        tpl = (db.query(XmlTemplate)
                 .filter_by(conn_id=req.conn_id)
                 .order_by(XmlTemplate.id.desc())
                 .first())
        if tpl:
            tpl.content     = req.xml_content
            tpl.name        = req.name or tpl.name
            tpl.format_type = fmt
        else:
            tpl = XmlTemplate(
                conn_id=req.conn_id,
                name=req.name or f"template.{fmt}",
                content=req.xml_content,
                format_type=fmt,
            )
            db.add(tpl)
        db.flush()
        template_id = tpl.id

    # 2. Replace formula rules for this connection
    if req.conn_id:
        db.query(TargetFormulaRule).filter_by(conn_id=req.conn_id).delete()
    else:
        db.query(TargetFormulaRule).filter(TargetFormulaRule.conn_id.is_(None)).delete()

    rule_objs = []
    for i, r in enumerate(rules):
        obj = TargetFormulaRule(
            conn_id=req.conn_id,
            template_id=template_id,
            target_path=r["target_path"],
            group_path=r["group_path"],
            formula_type=r["formula_type"],
            expression=r["expression"],
            default_value=r["default_value"],
            execution_order=r["execution_order"],
        )
        db.add(obj)
        rule_objs.append(obj)

    db.commit()

    return ProcessResult(
        inserted=len(rules),
        template_id=template_id,
        format_type=fmt,
        rules=[FormulaRuleOut(
            id=obj.id,
            conn_id=obj.conn_id,
            target_path=obj.target_path,
            group_path=obj.group_path,
            formula_type=obj.formula_type,
            expression=obj.expression,
            default_value=obj.default_value,
            execution_order=obj.execution_order,
        ) for obj in rule_objs],
    )


@router.get("/target-formulas", response_model=list[FormulaRuleOut])
def list_formula_rules(conn_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    """Return formula rules, optionally filtered by conn_id."""
    q = db.query(TargetFormulaRule)
    if conn_id is not None:
        q = q.filter_by(conn_id=conn_id)
    rules = q.order_by(TargetFormulaRule.execution_order).all()
    return [FormulaRuleOut(
        id=r.id,
        conn_id=r.conn_id,
        target_path=r.target_path,
        group_path=r.group_path,
        formula_type=r.formula_type,
        expression=r.expression,
        default_value=r.default_value,
        execution_order=r.execution_order,
    ) for r in rules]


@router.get("/target-formulas/{conn_id}/template")
def get_template_content(conn_id: int, db: Session = Depends(get_db)):
    """Return the raw template content and format for a connection."""
    tpl = (db.query(XmlTemplate)
             .filter_by(conn_id=conn_id)
             .order_by(XmlTemplate.id.desc())
             .first())
    if not tpl or not tpl.content:
        raise HTTPException(404, "No template found for this connection.")
    return {
        "conn_id":     conn_id,
        "name":        tpl.name,
        "content":     tpl.content,
        "format_type": tpl.format_type or "xml",
    }


@router.delete("/target-formulas/{conn_id}/template", status_code=200)
def delete_template(conn_id: int, db: Session = Depends(get_db)):
    """Delete the template and all formula rules for a connection."""
    tpl_deleted = db.query(XmlTemplate).filter_by(conn_id=conn_id).delete()
    rules_deleted = db.query(TargetFormulaRule).filter_by(conn_id=conn_id).delete()
    db.commit()
    return {"deleted_templates": tpl_deleted, "deleted_rules": rules_deleted}


@router.delete("/target-formulas", status_code=204)
def clear_formula_rules(conn_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    """Delete formula rules, optionally scoped to a conn_id."""
    q = db.query(TargetFormulaRule)
    if conn_id is not None:
        q = q.filter_by(conn_id=conn_id)
    q.delete()
    db.commit()
