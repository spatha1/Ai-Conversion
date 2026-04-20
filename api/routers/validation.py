"""
routers/validation.py

GET  /api/validation/{conn_id}              — list validation rules
POST /api/validation/{conn_id}/save         — replace all rules
POST /api/validation/{conn_id}/generate-xsd — generate XSD from rules + template
POST /api/validation/{conn_id}/run          — validate all generated XMLs
POST /api/validation/{conn_id}/ai-suggest   — AI chat to suggest rules from text/doc
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import ValidationRule, GeneratedXml, XmlTemplate

from api.dependencies import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])


# ── Schemas ───────────────────────────────────────────────────────────────────

def _to_float_or_none(v) -> Optional[float]:
    """Coerce to float; return None if not parseable (handles 'today', '', None)."""
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


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

    from pydantic import field_validator

    @field_validator('min_value', 'max_value', mode='before')
    @classmethod
    def coerce_numeric(cls, v):
        return _to_float_or_none(v)

    @field_validator('min_length', 'max_length', mode='before')
    @classmethod
    def coerce_int(cls, v):
        if v is None or v == '':
            return None
        try:
            return int(float(str(v)))
        except (ValueError, TypeError):
            return None


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


class ValidationErrorOut(BaseModel):
    identifier: str
    path:       str
    message:    str
    actual:     str = ""
    expected:   str = ""

class ValidationResultOut(BaseModel):
    valid:   bool
    total:   int
    failed:  int
    errors:  list[ValidationErrorOut]


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

@router.get("/validation/{conn_id}/scan-paths")
def scan_xml_paths(conn_id: int, db: Session = Depends(get_db)):
    """
    Return exact dot-notation paths for this connection (XML only).
    Priority:
      1. Scan actual generated XML records (best — has real values + types).
      2. Fall back to TargetFormulaRule table (from XML template) if no XML generated yet.
    """
    import xml.etree.ElementTree as ET
    from api.models import TargetFormulaRule as TFR

    # Only meaningful for XML format — return empty for other formats
    _tpl = (db.query(XmlTemplate).filter(XmlTemplate.conn_id == conn_id)
              .order_by(XmlTemplate.id.desc()).first())
    if _tpl and (_tpl.format_type or "xml") != "xml":
        return {
            "paths": [],
            "message": f"Validation path scanning is only supported for XML templates (this connection uses {_tpl.format_type}).",
        }

    # ── Strategy 1: generated XML ──────────────────────────────
    xml_rows = (
        db.query(GeneratedXml)
        .filter(GeneratedXml.conn_id == conn_id)
        .order_by(GeneratedXml.id)
        .limit(10)
        .all()
    )

    def infer_type(samples: set) -> str:
        if not samples:
            return "string"
        vals = list(samples)
        try:
            [int(v) for v in vals]
            return "integer"
        except Exception:
            pass
        try:
            [float(v) for v in vals]
            return "decimal"
        except Exception:
            pass
        import re as _re
        date_pat = _re.compile(r"^\d{4}-\d{2}-\d{2}$|^\d{2}/\d{2}/\d{4}$")
        if all(date_pat.match(v) for v in vals):
            return "date"
        return "string"

    if xml_rows:
        path_types: dict[str, set] = {}

        def walk(node: ET.Element, prefix: str):
            tag = node.tag.split("}")[-1] if "}" in node.tag else node.tag
            current = f"{prefix}.{tag}" if prefix else tag
            children = list(node)
            if not children:
                text = (node.text or "").strip()
                path_types.setdefault(current, set())
                if text:
                    path_types[current].add(text)
            else:
                for child in children:
                    walk(child, current)

        for row in xml_rows:
            try:
                root = ET.fromstring(row.xml_content or "")
                walk(root, "")
            except Exception:
                continue

        result = [
            {
                "path": path,
                "sample": list(samples)[0] if samples else "",
                "inferred_type": infer_type(samples),
                "source": "generated_xml",
            }
            for path in sorted(path_types.keys())
        ]
        return {"paths": result, "xml_count": len(xml_rows), "source": "generated_xml"}

    # ── Strategy 2: TargetFormulaRule (XML template paths) ─────
    formula_rules = (
        db.query(TFR)
        .filter(TFR.conn_id == conn_id)
        .order_by(TFR.execution_order)
        .all()
    )
    if not formula_rules:
        return {
            "paths": [],
            "message": "No generated XML or template paths found. Run Output generation first, or upload an XML template in the Target tab.",
        }

    # Convert template paths like /Employee/EmpNo  →  dot path using the XmlTemplate
    # to build the full prefix (e.g. DepartmentConversion.Department.Employee.EmpNo)
    from api.models import XmlTemplate
    tpl = (
        db.query(XmlTemplate)
        .filter(XmlTemplate.conn_id == conn_id)
        .order_by(XmlTemplate.id.desc())
        .first()
    )

    # Build prefix from root element of template
    root_tag = ""
    if tpl and tpl.content:
        try:
            tpl_root = ET.fromstring(tpl.content)
            root_tag = tpl_root.tag.split("}")[-1] if "}" in tpl_root.tag else tpl_root.tag
        except Exception:
            pass

    result = []
    for r in formula_rules:
        raw = (r.target_path or "").strip().lstrip("/")
        if not raw or raw.startswith("__"):
            continue
        # raw is like "Employee/EmpNo" or "/Employee/EmpNo"
        parts = [p for p in raw.split("/") if p]
        dot_path = ".".join([root_tag] + parts) if root_tag else ".".join(parts)
        sample = r.default_value or ""
        result.append({
            "path": dot_path,
            "sample": sample,
            "inferred_type": infer_type({sample} if sample else set()),
            "source": "template",
        })

    return {"paths": result, "xml_count": 0, "source": "template"}


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
            errors.append(ValidationErrorOut(
                identifier=row.identifier_value or f"#{row.id}",
                path="",
                message="Empty XML content",
                actual="(empty)",
                expected="valid XML",
            ))
            continue

        ok, errs = validate_xml_rules(xml_str, rule_dicts)
        if ok:
            row.validation_status  = "pass"
            row.validation_comment = None
        else:
            row.validation_status  = "fail"
            row.validation_comment = "; ".join(e["message"] for e in errs)
            failed += 1
            for e in errs:
                errors.append(ValidationErrorOut(
                    identifier=row.identifier_value or f"#{row.id}",
                    path=e.get("path", ""),
                    message=e.get("message", ""),
                    actual=e.get("actual", ""),
                    expected=e.get("expected", ""),
                ))

    db.commit()

    return ValidationResultOut(
        valid=failed == 0,
        total=len(xml_rows),
        failed=failed,
        errors=errors,
    )


# ══════════════════════════════════════════════════════════════
# AI Rule Suggest  —  POST /api/validation/{conn_id}/ai-suggest
# ══════════════════════════════════════════════════════════════

_AI_VALIDATION_SYSTEM_BASE = """You are a data validation expert assistant.
Your job is to help the user define XML validation rules for a data conversion project.

A validation rule has these fields:
- xml_path (string): dot-notation XML path — MUST be an exact path from the AVAILABLE PATHS list below
- is_required (boolean): whether the field must be present and non-empty
- data_type (string): one of string | integer | decimal | date | boolean
- min_length (int|null): minimum string length (string type only)
- max_length (int|null): maximum string length (string type only)
- pattern (string|null): regex pattern the value must match
- min_value (number|null): minimum numeric value (integer/decimal only)
- max_value (number|null): maximum numeric value (integer/decimal only)
- enumeration (string|null): comma-separated list of allowed values

CRITICAL RULE: The xml_path you use in every rule MUST be copied EXACTLY from the AVAILABLE PATHS list.
Do NOT invent or shorten paths. Do NOT use generic examples like "Root.Employee.Name".
Only use paths from the list provided in the user message.

When the user describes their data requirements or uploads a document:
1. Reply conversationally explaining what rules you identified.
2. Return a JSON block at the end of your reply in this exact format (do not skip it even if rules=0):

RULES_JSON:
{
  "rules": [
    {
      "xml_path": "<copy exact path from AVAILABLE PATHS>",
      "is_required": true,
      "data_type": "integer",
      "min_length": null,
      "max_length": null,
      "pattern": null,
      "min_value": 1,
      "max_value": null,
      "enumeration": null
    }
  ]
}

If no specific rules can be extracted, return RULES_JSON: {"rules": []}.
Always include the RULES_JSON block even when answering general questions.
Be concise in your explanation — focus on what rules were found and why.
"""


def _extract_text_from_upload(raw_bytes: bytes, filename: str) -> str:
    """Extract readable text from any uploaded file type."""
    import io, csv
    name = filename.lower()
    try:
        if name.endswith(".pdf"):
            try:
                import pdfplumber
                with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
                    return "\n".join(p.extract_text() or "" for p in pdf.pages)
            except ImportError:
                pass
        elif name.endswith(".docx"):
            try:
                import docx as _docx
                doc = _docx.Document(io.BytesIO(raw_bytes))
                return "\n".join(p.text for p in doc.paragraphs)
            except ImportError:
                pass
        elif name.endswith((".xlsx", ".xls")):
            try:
                import openpyxl
                wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
                lines = []
                for ws in wb.worksheets:
                    lines.append(f"[Sheet: {ws.title}]")
                    for row in ws.iter_rows(max_row=300, values_only=True):
                        if any(c is not None for c in row):
                            lines.append("\t".join(str(c) if c is not None else "" for c in row))
                return "\n".join(lines)
            except ImportError:
                pass
        elif name.endswith(".csv"):
            decoded = raw_bytes.decode("utf-8", errors="replace")
            reader = csv.reader(decoded.splitlines())
            return "\n".join("\t".join(row) for row in reader)
    except Exception:
        pass
    return raw_bytes.decode("utf-8", errors="replace")


def _fetch_api_response(url: str, method: str = "GET",
                        headers: dict | None = None,
                        body: str | None = None,
                        timeout: int = 15) -> dict:
    """
    Call an external API and return { status, body_text, content_type, error }.
    Used by the AI suggest endpoint to read live API responses.
    """
    import urllib.request, urllib.error, ssl
    method = (method or "GET").upper()
    hdrs = {"Accept": "application/json", "User-Agent": "ClarityStudio/1.0"}
    if headers:
        hdrs.update(headers)

    data = body.encode("utf-8") if body else None
    if data and "Content-Type" not in hdrs:
        hdrs["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            body_bytes = resp.read(65536)  # 64 KB max
            content_type = resp.headers.get("Content-Type", "")
            return {
                "status": resp.status,
                "body_text": body_bytes.decode("utf-8", errors="replace"),
                "content_type": content_type,
                "error": None,
            }
    except urllib.error.HTTPError as e:
        body_bytes = e.read(8192)
        return {
            "status": e.code,
            "body_text": body_bytes.decode("utf-8", errors="replace"),
            "content_type": "",
            "error": f"HTTP {e.code}: {e.reason}",
        }
    except Exception as exc:
        return {
            "status": 0,
            "body_text": "",
            "content_type": "",
            "error": str(exc),
        }


@router.post("/validation/{conn_id}/api-fetch")
def validation_api_fetch(
    conn_id: int,
    body: dict,
    db: Session = Depends(get_db),
):
    """
    Fetch a live API response and return status + body for preview.
    Body: { url, method?, headers?, request_body? }
    """
    url = (body.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=422, detail="url is required")
    result = _fetch_api_response(
        url=url,
        method=body.get("method", "GET"),
        headers=body.get("headers"),
        body=body.get("request_body"),
    )
    return result


@router.post("/validation/{conn_id}/ai-suggest")
async def ai_suggest_rules(
    conn_id: int,
    message: Optional[str] = Form(None),
    history: Optional[str] = Form("[]"),
    file: Optional[UploadFile] = File(None),
    api_url: Optional[str] = Form(None),
    api_method: Optional[str] = Form("GET"),
    api_headers: Optional[str] = Form(None),    # JSON string
    api_body: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """
    Chat with AI to get validation rule suggestions.
    Accepts: free text + optional file attachment + optional live API URL.
    Returns { reply: str, rules: [...] }.
    """
    from api.config import settings
    api_key = settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured")

    # Build user message content
    parts: list[str] = []
    if file and file.filename:
        raw = await file.read()
        extracted = _extract_text_from_upload(raw, file.filename)
        parts.append(f"[Attached file: {file.filename}]\n{extracted[:8000]}")

    # Fetch live API response if URL provided
    if api_url and api_url.strip():
        try:
            hdrs: dict | None = json.loads(api_headers) if api_headers else None
        except Exception:
            hdrs = None
        api_result = _fetch_api_response(
            url=api_url.strip(),
            method=api_method or "GET",
            headers=hdrs,
            body=api_body or None,
        )
        if api_result["error"]:
            parts.append(f"[API call to {api_url} failed: {api_result['error']}]")
        else:
            preview = api_result["body_text"][:6000]
            parts.append(
                f"[Live API response from {api_url}]\n"
                f"Status: {api_result['status']}\n"
                f"Content-Type: {api_result['content_type']}\n"
                f"Body:\n{preview}"
            )

    if message and message.strip():
        parts.append(message.strip())

    if not parts:
        raise HTTPException(status_code=422, detail="Provide a message or file.")

    user_content = "\n\n".join(parts)

    # Parse conversation history
    try:
        hist = json.loads(history or "[]")
    except Exception:
        hist = []

    # ── Load real scanned XML paths to inject into system prompt ──
    import xml.etree.ElementTree as ET

    def _get_real_paths(conn_id: int, db) -> list[str]:
        """Return dot-notation leaf paths from generated XML (best) or template rules (fallback)."""
        xml_rows = (
            db.query(GeneratedXml)
            .filter(GeneratedXml.conn_id == conn_id)
            .order_by(GeneratedXml.id)
            .limit(5)
            .all()
        )
        path_set: set[str] = set()

        def walk(node: ET.Element, prefix: str):
            tag = node.tag.split("}")[-1] if "}" in node.tag else node.tag
            current = f"{prefix}.{tag}" if prefix else tag
            children = list(node)
            if not children:
                path_set.add(current)
            else:
                for child in children:
                    walk(child, current)

        for row in xml_rows:
            try:
                root = ET.fromstring(row.xml_content or "")
                walk(root, "")
            except Exception:
                continue

        if path_set:
            return sorted(path_set)

        # Fallback: TargetFormulaRule paths
        from api.models import TargetFormulaRule as TFR, XmlTemplate
        tfrs = (
            db.query(TFR)
            .filter(TFR.conn_id == conn_id)
            .order_by(TFR.execution_order)
            .limit(50)
            .all()
        )
        return [r.target_path for r in tfrs if r.target_path]

    real_paths = _get_real_paths(conn_id, db)
    if real_paths:
        paths_list = "\n".join(f"  - {p}" for p in real_paths)
        paths_context = f"\n\nAVAILABLE PATHS (use ONLY these exact paths for xml_path):\n{paths_list}"
    else:
        paths_context = "\n\n[No generated XML paths found yet — use descriptive path names based on user context.]"

    system_prompt = _AI_VALIDATION_SYSTEM_BASE + paths_context

    # Get existing rules for context
    existing_rules = (
        db.query(ValidationRule)
        .filter(ValidationRule.conn_id == conn_id)
        .order_by(ValidationRule.id)
        .all()
    )
    context_note = ""
    if existing_rules:
        already = [r.target_path for r in existing_rules[:20]]
        context_note = f"\n\n[Already-defined rules ({len(existing_rules)} total): {', '.join(already)}]"

    messages = [{"role": "system", "content": system_prompt}]
    for h in hist[-10:]:  # keep last 10 turns
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": user_content + context_note})

    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=0.2,
        max_tokens=3000,
    )
    full_reply = (completion.choices[0].message.content or "").strip()

    # Parse RULES_JSON block out of reply
    rules: list[dict] = []
    reply_text = full_reply
    marker = "RULES_JSON:"
    if marker in full_reply:
        idx = full_reply.index(marker)
        reply_text = full_reply[:idx].strip()
        json_part = full_reply[idx + len(marker):].strip()
        try:
            parsed = json.loads(json_part)
            raw_rules = parsed.get("rules") or []
            for r in raw_rules:
                if r.get("xml_path"):
                    rules.append({
                        "xml_path":   str(r.get("xml_path", "")),
                        "is_required": bool(r.get("is_required", False)),
                        "data_type":  r.get("data_type") or "string",
                        "min_length": r.get("min_length"),
                        "max_length": r.get("max_length"),
                        "pattern":    r.get("pattern"),
                        "min_value":  r.get("min_value"),
                        "max_value":  r.get("max_value"),
                    })
        except Exception:
            pass

    return {"reply": reply_text, "rules": rules}
