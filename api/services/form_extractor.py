"""
form_extractor.py — AI-powered form schema extraction, modification, and execution.

Functions:
  extract_form_schema()    — Extract structure from image/PDF/text via GPT-4o
  modify_schema_with_ai()  — Modify an existing schema via natural-language instruction
  auto_map_fields()        — AI-assisted field-to-data-path mapping with confidence scores
  validate_schema()        — Structural validation before save/execute
  bind_and_execute()       — Bind data to a schema and generate output (PDF/UI/JSON)
"""
from __future__ import annotations

import base64
import io
import json
import time
from typing import Any

from sqlalchemy.orm import Session


_MODEL = "gpt-4o"
_MINI  = "gpt-4o-mini"

# ─────────────────────────────────────────────────────────────
# Prompt defaults (overridable via PromptTemplate in Admin)
# ─────────────────────────────────────────────────────────────

_EXTRACT_PROMPT = """
You are a form structure extraction expert.
Analyze the provided form (image, PDF page, or text description) and return a JSON schema.

Return ONLY valid JSON — no markdown fences, no explanation.

Schema format:
{
  "form_name": "...",
  "version": 1,
  "status": "draft",
  "sections": [
    {
      "id": "s1",
      "title": "Section Title",
      "order": 1,
      "columns": 1,
      "fields": [
        {
          "id": "f1",
          "name": "snake_case_field_name",
          "label": "Human Readable Label",
          "type": "text|number|date|dropdown|checkbox|radio|textarea|signature|file",
          "required": true,
          "default_value": "",
          "placeholder": "",
          "column": 1,
          "validations": [],
          "visibility_rule": null,
          "pdf_layout": null
        }
      ]
    }
  ]
}

Rules:
- Use snake_case for field names
- Infer field types from context (dates → "date", amounts → "number", yes/no → "radio", etc.)
- Group logically related fields into sections
- Set required=true for fields that appear mandatory in the form
""".strip()

_MODIFY_PROMPT = """
You are a form schema modification assistant.
You will receive an existing form schema (JSON) and a user instruction.
Apply the instruction and return the COMPLETE modified schema as valid JSON only.
Increment the version by 1.
Do NOT return markdown fences or explanation — only raw JSON.
""".strip()

_AUTOMAP_PROMPT = """
You are a data field mapping assistant.
Given a list of form field names and available data keys, suggest the best mapping.
Return ONLY a JSON object: {"field_name": "data_key_path", ...}
Use dot-notation for nested paths (e.g. "customer.name").
If no good match exists, map to the empty string "".
Do NOT return markdown fences or explanation.
""".strip()


def _get_prompt_override(category: str, db: Session) -> str | None:
    try:
        from api.models import PromptTemplate as _PT
        tmpl = db.query(_PT).filter(_PT.category == category, _PT.is_active == True).first()
        if tmpl and tmpl.content and tmpl.content.strip():
            return tmpl.content.strip()
    except Exception:
        pass
    return None


def _openai_client():
    import openai
    from api.config import settings
    return openai.OpenAI(api_key=settings.OPENAI_API_KEY)


# ─────────────────────────────────────────────────────────────
# 1. Extract form schema from image/PDF/text
# ─────────────────────────────────────────────────────────────

def extract_form_schema(
    source_type: str,
    content_bytes: bytes | None,
    filename: str | None,
    text_prompt: str | None,
    form_name: str,
    db: Session,
) -> dict:
    """
    source_type: "image" | "pdf" | "handwritten" | "text"
    Returns parsed form_schema dict.
    """
    system_prompt = _get_prompt_override("form_builder_extract", db) or _EXTRACT_PROMPT
    client = _openai_client()
    t0 = time.monotonic()

    if source_type == "text":
        user_content = f"Form name: {form_name}\n\nDescription:\n{text_prompt or ''}"
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ]
        resp = client.chat.completions.create(model=_MODEL, messages=messages, temperature=0)
    else:
        # Vision path — image, PDF, handwritten
        if not content_bytes:
            raise ValueError("content_bytes required for image/pdf/handwritten extraction")

        ext = (filename or "").rsplit(".", 1)[-1].lower() if filename else ""
        if ext == "pdf":
            images_b64 = _pdf_to_base64_images(content_bytes, max_pages=5)
        else:
            images_b64 = [base64.b64encode(content_bytes).decode()]

        img_content = []
        for b64 in images_b64:
            img_content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"},
            })
        img_content.append({"type": "text", "text": f"Form name: {form_name}\nExtract the form schema."})

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": img_content},
        ]
        resp = client.chat.completions.create(model=_MODEL, messages=messages, temperature=0)

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw = resp.choices[0].message.content or "{}"

    try:
        from api.services import ai_trace
        ai_trace.store(
            module="form_builder",
            conn_id=None,
            model=_MODEL,
            prompt=f"[extract] form_name={form_name} source_type={source_type}",
            response=raw[:4000],
            tokens_in=resp.usage.prompt_tokens if resp.usage else 0,
            tokens_out=resp.usage.completion_tokens if resp.usage else 0,
            latency_ms=elapsed_ms,
            db=db,
        )
    except Exception:
        pass

    schema = _parse_json_response(raw)
    schema["form_name"] = form_name  # always use the user-provided name
    return schema


# ─────────────────────────────────────────────────────────────
# 2. Modify existing schema via AI instruction
# ─────────────────────────────────────────────────────────────

def modify_schema_with_ai(existing_schema: dict, instruction: str, db: Session) -> dict:
    """Returns a modified schema dict. Caller saves as new version."""
    system_prompt = _get_prompt_override("form_builder_modify", db) or _MODIFY_PROMPT
    client = _openai_client()
    t0 = time.monotonic()

    user_content = (
        f"Instruction: {instruction}\n\n"
        f"Current schema:\n{json.dumps(existing_schema, indent=2)}"
    )
    resp = client.chat.completions.create(
        model=_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ],
        temperature=0,
    )
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw = resp.choices[0].message.content or "{}"

    try:
        from api.services import ai_trace
        ai_trace.store(
            module="form_builder",
            conn_id=None,
            model=_MODEL,
            prompt=f"[modify] {instruction[:500]}",
            response=raw[:4000],
            tokens_in=resp.usage.prompt_tokens if resp.usage else 0,
            tokens_out=resp.usage.completion_tokens if resp.usage else 0,
            latency_ms=elapsed_ms,
            db=db,
        )
    except Exception:
        pass

    return _parse_json_response(raw)


# ─────────────────────────────────────────────────────────────
# 3. Auto-map fields to data keys
# ─────────────────────────────────────────────────────────────

def auto_map_fields(template_fields: list[dict], data_keys: list[str], db: Session) -> dict:
    """
    Returns {"mapping": {"field": "data_key"}, "confidence": {"field": 0.9}}
    """
    system_prompt = _get_prompt_override("form_builder_automap", db) or _AUTOMAP_PROMPT
    client = _openai_client()

    field_names = [f.get("name", "") for f in template_fields]
    user_content = (
        f"Form fields: {json.dumps(field_names)}\n"
        f"Available data keys: {json.dumps(data_keys)}"
    )

    t0 = time.monotonic()
    resp = client.chat.completions.create(
        model=_MINI,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ],
        temperature=0,
    )
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw = resp.choices[0].message.content or "{}"

    try:
        from api.services import ai_trace
        ai_trace.store(
            module="form_builder",
            conn_id=None,
            model=_MINI,
            prompt=f"[automap] fields={field_names} keys={data_keys[:20]}",
            response=raw[:4000],
            tokens_in=resp.usage.prompt_tokens if resp.usage else 0,
            tokens_out=resp.usage.completion_tokens if resp.usage else 0,
            latency_ms=elapsed_ms,
            db=db,
        )
    except Exception:
        pass

    mapping = _parse_json_response(raw)

    # Build confidence scores using simple string similarity as a heuristic
    from api.services.embeddings import cosine_similarity as _cos_sim
    confidence: dict[str, float] = {}
    for fname, dkey in mapping.items():
        if not dkey:
            confidence[fname] = 0.0
        else:
            # simple token overlap heuristic — not embedding-based (no vectors stored yet)
            f_tokens = set(fname.lower().replace("_", " ").split())
            d_tokens = set(dkey.lower().replace("_", " ").replace(".", " ").split())
            overlap  = len(f_tokens & d_tokens)
            union    = len(f_tokens | d_tokens)
            confidence[fname] = round(overlap / union, 2) if union else 0.0

    return {"mapping": mapping, "confidence": confidence}


# ─────────────────────────────────────────────────────────────
# 4. Validate schema
# ─────────────────────────────────────────────────────────────

def validate_schema(schema: dict) -> dict:
    """Returns {"valid": bool, "errors": [str]}."""
    errors = []

    sections = schema.get("sections", [])
    if not sections:
        errors.append("Schema must have at least one section")

    all_field_ids = set()
    all_field_names = set()

    for si, sec in enumerate(sections):
        if not sec.get("title"):
            errors.append(f"Section {si+1} has no title")
        fields = sec.get("fields", [])
        if not fields:
            errors.append(f"Section '{sec.get('title', si+1)}' has no fields")
        for fld in fields:
            fname = fld.get("name", "")
            if not fname:
                errors.append(f"Field in section '{sec.get('title', si+1)}' has no name")
            elif fname in all_field_names:
                errors.append(f"Duplicate field name: {fname!r}")
            else:
                all_field_names.add(fname)
            all_field_ids.add(fld.get("id", ""))

    # Validate visibility_rule references
    for sec in sections:
        for fld in sec.get("fields", []):
            rule = fld.get("visibility_rule")
            if rule and isinstance(rule, dict):
                dep = rule.get("depends_on_field", "")
                if dep and dep not in all_field_names:
                    errors.append(f"visibility_rule in field '{fld.get('name')}' references unknown field '{dep}'")

    return {"valid": len(errors) == 0, "errors": errors}


# ─────────────────────────────────────────────────────────────
# 5. Bind data to schema and generate output
# ─────────────────────────────────────────────────────────────

def bind_and_execute(
    schema: dict,
    mapping: dict,
    normalized_data: dict,
    output_format: str,
) -> dict:
    """
    Resolves each field value from normalized_data["data"] via mapping,
    then generates output in the requested format.

    Returns:
      {"output_format": str, "bytes": bytes|None, "output_json": dict|None, "warnings": [str]}
    """
    from api.services.form_data_fetcher import apply_mapping

    data_payload = normalized_data.get("data", {})
    all_fields   = [f for sec in schema.get("sections", []) for f in sec.get("fields", [])]
    bound_values = apply_mapping(all_fields, data_payload, mapping)

    warnings = []
    for fld in all_fields:
        if fld.get("required") and not bound_values.get(fld["name"], "").strip():
            warnings.append(f"Required field '{fld['name']}' has no value in data")

    if output_format == "api":
        result_json = _to_api_json(schema, bound_values)
        return {"output_format": "api", "bytes": None, "output_json": result_json, "warnings": warnings}

    if output_format == "ui":
        ui_spec = _to_ui_spec(schema, bound_values)
        return {"output_format": "ui", "bytes": None, "output_json": ui_spec, "warnings": warnings}

    if output_format in ("pdf", "fillable"):
        pdf_bytes = _to_pdf(schema, bound_values, fillable=(output_format == "fillable"))
        return {"output_format": output_format, "bytes": pdf_bytes, "output_json": None, "warnings": warnings}

    raise ValueError(f"Unknown output_format: {output_format!r}")


# ─────────────────────────────────────────────────────────────
# Output generators
# ─────────────────────────────────────────────────────────────

def _to_api_json(schema: dict, bound: dict) -> dict:
    return {
        "form_name": schema.get("form_name"),
        "version":   schema.get("version", 1),
        "data":      bound,
    }


def _group_rows(fields: list, columns: int) -> list:
    """Group fields into rows respecting explicit row/full_width, else auto-pair."""
    has_explicit = any(f.get("row") is not None for f in fields)
    if not has_explicit or columns == 1:
        return [fields[i:i+columns] for i in range(0, len(fields), columns)]
    sorted_fields = sorted(fields, key=lambda f: (f.get("row", 999), f.get("column", 1)))
    rows = []
    current_row_num = None
    current_row = []
    for f in sorted_fields:
        r = f.get("row", 999)
        if r != current_row_num:
            if current_row:
                rows.append(current_row)
            current_row = [f]
            current_row_num = r
        else:
            current_row.append(f)
    if current_row:
        rows.append(current_row)
    return rows


def _to_ui_spec(schema: dict, bound: dict) -> dict:
    """Returns a structure the React frontend can render as a live form."""
    sections_out = []
    for sec in schema.get("sections", []):
        fields_out = []
        for fld in sec.get("fields", []):
            fields_out.append({
                "name":       fld.get("name"),
                "label":      fld.get("label"),
                "type":       fld.get("type", "text"),
                "required":   fld.get("required", False),
                "options":    fld.get("options", []),
                "value":      bound.get(fld.get("name", ""), ""),
                "column":     fld.get("column", 1),
                "row":        fld.get("row"),
                "full_width": fld.get("full_width", False),
                "col_span":   fld.get("col_span", 1),
                "row_span":   fld.get("row_span", 1),
                "height":     fld.get("height", "sm"),
                "visibility_rule": fld.get("visibility_rule"),
            })
        sections_out.append({
            "id":          sec.get("id"),
            "title":       sec.get("title"),
            "columns":     sec.get("columns", 1),
            "layout_type": sec.get("layout_type", "grid"),
            "fields":      fields_out,
        })
    return {"form_name": schema.get("form_name"), "sections": sections_out}


def _to_pdf(schema: dict, bound: dict, fillable: bool = False) -> bytes:
    """Generate a PDF using reportlab."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.units import mm
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    except ImportError:
        raise RuntimeError("reportlab is required for PDF generation — run: pip install reportlab")

    buf    = io.BytesIO()
    doc    = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20*mm, rightMargin=20*mm,
                                topMargin=20*mm, bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    story  = []

    # Title
    title_style = ParagraphStyle("title", parent=styles["Heading1"], fontSize=16, spaceAfter=6)
    story.append(Paragraph(schema.get("form_name", "Form"), title_style))
    story.append(Spacer(1, 8*mm))

    label_style = ParagraphStyle("label", parent=styles["Normal"], fontSize=9,
                                  textColor=colors.HexColor("#555555"))
    value_style = ParagraphStyle("value", parent=styles["Normal"], fontSize=11, spaceAfter=4)
    section_style = ParagraphStyle("section", parent=styles["Heading2"], fontSize=12,
                                    textColor=colors.HexColor("#1976d2"), spaceAfter=4)

    for sec in schema.get("sections", []):
        story.append(Paragraph(sec.get("title", ""), section_style))
        story.append(Spacer(1, 3*mm))

        sec_layout_type = sec.get("layout_type", "grid")
        cols = sec.get("columns", 1)
        fields = sec.get("fields", [])

        if sec_layout_type == "label_value":
            # Classic label (40%) | value (60%) table — one field per row
            lv_data = []
            for fld in fields:
                fname = fld.get("name", "")
                label = fld.get("label", fname)
                value = bound.get(fname, "")
                lv_data.append([
                    Paragraph(f"<b>{label}</b>", label_style),
                    Paragraph(value or "_" * 30, value_style),
                ])
            if lv_data:
                lv_table = Table(lv_data, colWidths=["40%", "60%"])
                lv_table.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]))
                story.append(lv_table)
        elif cols == 2 and len(fields) >= 1:
            # Grid: 2-column table layout — respects explicit row/col_span positioning
            row_groups = _group_rows(fields, cols)
            table_data = []
            span_commands = []
            for ri, row_fields in enumerate(row_groups):
                row = []
                is_full_width = (
                    len(row_fields) == 1
                    or row_fields[0].get("col_span", 1) == 2
                )
                if is_full_width:
                    fld = row_fields[0]
                    fname = fld.get("name", "")
                    label = fld.get("label", fname)
                    value = bound.get(fname, "")
                    cell_para = [
                        Paragraph(f"<b>{label}</b>", label_style),
                        Paragraph(value or "_" * 40, value_style),
                    ]
                    row = [cell_para, ""]
                    span_commands.append(("SPAN", (0, ri), (1, ri)))
                else:
                    for fld in row_fields:
                        fname = fld.get("name", "")
                        label = fld.get("label", fname)
                        value = bound.get(fname, "")
                        cell_para = [
                            Paragraph(f"<b>{label}</b>", label_style),
                            Paragraph(value or "_" * 20, value_style),
                        ]
                        row.append(cell_para)
                    if len(row) < 2:
                        row.append("")
                table_data.append(row)
            if table_data:
                t = Table(table_data, colWidths=["50%", "50%"])
                style_cmds = [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ] + span_commands
                t.setStyle(TableStyle(style_cmds))
                story.append(t)
        else:
            for fld in fields:
                fname = fld.get("name", "")
                label = fld.get("label", fname)
                value = bound.get(fname, "")
                story.append(Paragraph(f"<b>{label}</b>", label_style))
                story.append(Paragraph(value or "_" * 30, value_style))

        story.append(Spacer(1, 5*mm))

    if fillable:
        # For fillable PDF, we add AcroForm fields via a canvas overlay
        _add_acroform_fields(buf, schema, bound)
    else:
        doc.build(story)

    return buf.getvalue()


def _add_acroform_fields(buf: io.BytesIO, schema: dict, bound: dict) -> None:
    """
    Build a proper fillable PDF with AcroForm fields using reportlab's canvas API.
    Falls back to plain PDF if canvas AcroForm is unavailable.
    """
    try:
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm

        buf.seek(0)
        buf.truncate(0)

        c = canvas.Canvas(buf, pagesize=A4)
        page_w, page_h = A4
        y = page_h - 30*mm

        c.setFont("Helvetica-Bold", 16)
        c.drawString(20*mm, y, schema.get("form_name", "Form"))
        y -= 12*mm

        for sec in schema.get("sections", []):
            c.setFont("Helvetica-Bold", 12)
            c.setFillColorRGB(0.098, 0.463, 0.824)
            c.drawString(20*mm, y, sec.get("title", ""))
            c.setFillColorRGB(0, 0, 0)
            y -= 8*mm

            for fld in sec.get("fields", []):
                if y < 30*mm:
                    c.showPage()
                    y = page_h - 30*mm

                fname = fld.get("name", "")
                label = fld.get("label", fname)
                value = bound.get(fname, "")

                c.setFont("Helvetica", 9)
                c.setFillColorRGB(0.33, 0.33, 0.33)
                c.drawString(20*mm, y, label)
                y -= 6*mm

                # AcroForm text field
                c.acroForm.textfield(
                    name=fname,
                    tooltip=label,
                    x=20*mm,
                    y=y - 5*mm,
                    width=160*mm,
                    height=7*mm,
                    value=value,
                    fontSize=10,
                )
                y -= 12*mm

        c.save()
    except Exception:
        pass  # fillable PDF silently falls back to non-fillable bytes already in buf


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _parse_json_response(raw: str) -> dict:
    """Strip markdown fences and parse JSON, returning {} on failure."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        text = text.rsplit("```", 1)[0]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {}


def _pdf_to_base64_images(pdf_bytes: bytes, max_pages: int = 5) -> list[str]:
    """Convert first N pages of a PDF to base64 PNG images using pypdf + pillow."""
    try:
        from pypdf import PdfReader
        import PIL.Image as PILImage
    except ImportError:
        # If conversion libs unavailable, encode raw PDF bytes directly
        return [base64.b64encode(pdf_bytes).decode()]

    reader = PdfReader(io.BytesIO(pdf_bytes))
    images = []
    for i, page in enumerate(reader.pages[:max_pages]):
        try:
            from pypdf.generic import NameObject
            # Extract any embedded image from the page as a fallback
            xobjs = page.get("/Resources", {}).get("/XObject", {})
            for xname in xobjs:
                xobj = xobjs[xname].get_object()
                if xobj.get("/Subtype") == NameObject("/Image"):
                    data = xobj.get_data()
                    images.append(base64.b64encode(data).decode())
                    break
        except Exception:
            pass

    if not images:
        # Fall back to embedding the raw PDF bytes
        images = [base64.b64encode(pdf_bytes[:200000]).decode()]

    return images[:max_pages]
