"""
routers/validation.py

GET  /api/validation/{conn_id}              — list validation rules
POST /api/validation/{conn_id}/save         — replace all rules
POST /api/validation/{conn_id}/generate-xsd — generate XSD from rules + template
POST /api/validation/{conn_id}/run          — validate all generated XMLs
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import ValidationRule, GeneratedXml, XmlTemplate

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class RuleIn(BaseModel):
    xml_path:    str
    is_required: bool          = False
    data_type:   Optional[str] = None    # string|integer|decimal|date|boolean
    min_length:  Optional[int] = None
    max_length:  Optional[int] = None
    pattern:     Optional[str] = None
    enumeration: Optional[str] = None   # comma-separated
    min_value:   Optional[float] = None
    max_value:   Optional[float] = None


class RuleOut(BaseModel):
    id:          Optional[int] = None
    conn_id:     int
    xml_path:    str
    is_required: bool          = False
    data_type:   Optional[str] = None
    min_length:  Optional[int] = None
    max_length:  Optional[int] = None
    pattern:     Optional[str] = None
    enumeration: Optional[str] = None
    min_value:   Optional[float] = None
    max_value:   Optional[float] = None

    class Config:
        from_attributes = True


class RulesBulkIn(BaseModel):
    rules: list[RuleIn]


class ValidationResultOut(BaseModel):
    valid:   bool
    total:   int
    failed:  int
    errors:  list[dict]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_out(r: ValidationRule) -> RuleOut:
    return RuleOut(
        id=r.id,
        conn_id=r.conn_id,
        xml_path=r.target_path,
        is_required=bool(r.is_required),
        data_type=r.data_type,
        min_length=r.min_length,
        max_length=r.max_length,
        pattern=r.pattern,
        enumeration=r.enumeration,
        min_value=float(r.min_value) if r.min_value is not None else None,
        max_value=float(r.max_value) if r.max_value is not None else None,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/validation/{conn_id}", response_model=list[RuleOut])
def list_rules(conn_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(ValidationRule)
        .filter(ValidationRule.conn_id == conn_id)
        .order_by(ValidationRule.id)
        .all()
    )
    return [_row_to_out(r) for r in rows]


@router.post("/validation/{conn_id}/save", response_model=list[RuleOut])
def save_rules(conn_id: int, req: RulesBulkIn, db: Session = Depends(get_db)):
    """Replace all rules for a connection with the submitted list."""
    db.query(ValidationRule).filter(ValidationRule.conn_id == conn_id).delete()
    saved = []
    for r in req.rules:
        row = ValidationRule(
            conn_id=conn_id,
            target_path=r.xml_path.strip(),
            is_required=r.is_required,
            data_type=r.data_type or None,
            min_length=r.min_length,
            max_length=r.max_length,
            pattern=r.pattern or None,
            enumeration=r.enumeration or None,
            min_value=str(r.min_value) if r.min_value is not None else None,
            max_value=str(r.max_value) if r.max_value is not None else None,
        )
        db.add(row)
        saved.append(row)
    db.commit()
    for row in saved:
        db.refresh(row)
    return [_row_to_out(r) for r in saved]


@router.post("/validation/{conn_id}/generate-xsd")
def generate_xsd(conn_id: int, db: Session = Depends(get_db)):
    """Generate XSD from saved rules + XML template structure."""
    rules = (
        db.query(ValidationRule)
        .filter(ValidationRule.conn_id == conn_id)
        .order_by(ValidationRule.id)
        .all()
    )
    rule_dicts = [
        {
            "target_path": r.target_path,
            "is_required": bool(r.is_required),
            "data_type":   r.data_type,
            "min_length":  r.min_length,
            "max_length":  r.max_length,
            "pattern":     r.pattern,
            "enumeration": r.enumeration,
            "min_value":   r.min_value,
            "max_value":   r.max_value,
        }
        for r in rules
    ]

    template = (
        db.query(XmlTemplate)
        .filter(XmlTemplate.conn_id == conn_id)
        .order_by(XmlTemplate.id.desc())
        .first()
    )
    template_xml = template.content if template else ""

    from api.services.xsd_builder import build_xsd
    xsd = build_xsd(template_xml or "<Root/>", rule_dicts)
    return {"xsd": xsd, "rule_count": len(rule_dicts)}


@router.post("/validation/{conn_id}/run", response_model=ValidationResultOut)
def run_validation(conn_id: int, db: Session = Depends(get_db)):
    """
    Validate every GeneratedXml row for this connection against saved rules.
    """
    rules = (
        db.query(ValidationRule)
        .filter(ValidationRule.conn_id == conn_id)
        .order_by(ValidationRule.id)
        .all()
    )
    if not rules:
        raise HTTPException(
            status_code=400,
            detail="No validation rules defined for this connection. Add rules first."
        )

    rule_dicts = [
        {
            "target_path": r.target_path,
            "is_required": bool(r.is_required),
            "data_type":   r.data_type,
            "min_length":  r.min_length,
            "max_length":  r.max_length,
            "pattern":     r.pattern,
            "enumeration": r.enumeration,
            "min_value":   r.min_value,
            "max_value":   r.max_value,
        }
        for r in rules
    ]

    xml_rows = (
        db.query(GeneratedXml)
        .filter(GeneratedXml.conn_id == conn_id)
        .order_by(GeneratedXml.id)
        .all()
    )
    if not xml_rows:
        raise HTTPException(
            status_code=400,
            detail="No generated XML records found. Run 'Generate All XML' in the Output tab first."
        )

    from api.services.xsd_builder import validate_xml_rules

    errors = []
    failed = 0

    for row in xml_rows:
        xml_str = row.xml_content or ""
        if not xml_str.strip():
            row.validation_status  = "fail"
            row.validation_comment = "Empty XML content"
            failed += 1
            errors.append({
                "identifier": row.identifier_value or f"#{row.id}",
                "path": "",
                "message": "Empty XML content",
            })
            continue

        ok, errs = validate_xml_rules(xml_str, rule_dicts)
        if ok:
            row.validation_status  = "pass"
            row.validation_comment = None
        else:
            row.validation_status  = "fail"
            row.validation_comment = "; ".join(errs)
            failed += 1
            for e in errs:
                errors.append({
                    "identifier": row.identifier_value or f"#{row.id}",
                    "path": "",
                    "message": e,
                })

    db.commit()

    return ValidationResultOut(
        valid=failed == 0,
        total=len(xml_rows),
        failed=failed,
        errors=errors,
    )
