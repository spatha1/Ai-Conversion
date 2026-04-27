"""
form_builder.py — Form Configuration & Execution Engine router.

Endpoints (all fixed-path routes registered before /{id} to avoid FastAPI 422):
  POST /form-builder/draft
  GET  /form-builder/templates
  POST /form-builder/templates
  GET  /form-builder/templates/{id}
  PUT  /form-builder/templates/{id}
  DELETE /form-builder/templates/{id}
  POST /form-builder/templates/{id}/ask-ai
  POST /form-builder/templates/{id}/suggest-layout
  GET  /form-builder/mapping-presets
  POST /form-builder/mapping-presets
  DELETE /form-builder/mapping-presets/{pid}
  GET  /form-builder/templates/{id}/bindings
  POST /form-builder/templates/{id}/bindings
  PUT  /form-builder/templates/{id}/bindings/{bid}
  POST /form-builder/templates/{id}/bindings/{bid}/preview
  POST /form-builder/templates/{id}/bindings/auto-map
  POST /form-builder/templates/{id}/execute
  POST /form-builder/bulk-execute
  GET  /form-builder/templates/{id}/executions
  GET  /form-builder/bulk-runs/{run_id}
"""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import (
    FormTemplate, FormDataBinding, FormMappingPreset, FormExecution,
)
from api.schemas import (
    FormTemplateCreate, FormTemplateUpdate, FormTemplateOut,
    FormMappingPresetCreate, FormMappingPresetOut,
    FormDataBindingCreate, FormDataBindingUpdate, FormDataBindingOut,
    FormExecutionOut, FormExecutionCreate,
    FormBulkExecuteRequest, FormDraftRequest, FormAutoMapRequest, FormAskAIRequest,
)

router = APIRouter()

_OUTPUT_DIR = Path("form_outputs")
_OUTPUT_DIR.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _get_template_or_404(template_id: int, db: Session) -> FormTemplate:
    t = db.query(FormTemplate).filter(FormTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail=f"FormTemplate {template_id} not found")
    return t


def _get_binding_or_404(template_id: int, binding_id: int, db: Session) -> FormDataBinding:
    b = db.query(FormDataBinding).filter(
        FormDataBinding.id == binding_id,
        FormDataBinding.template_id == template_id,
    ).first()
    if not b:
        raise HTTPException(status_code=404, detail=f"FormDataBinding {binding_id} not found")
    return b


def _all_fields(schema: dict) -> list[dict]:
    return [f for sec in schema.get("sections", []) for f in sec.get("fields", [])]


# ─────────────────────────────────────────────────────────────
# AI Draft (no save)
# ─────────────────────────────────────────────────────────────

@router.post("/form-builder/draft", tags=["form-builder"])
async def create_draft(
    form_name:    str           = Form(...),
    category:     Optional[str] = Form(default=None),
    source_type:  str           = Form(default="text"),
    text_prompt:  Optional[str] = Form(default=None),
    file:         Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
):
    """
    AI-extract a form schema from an uploaded image/PDF or text prompt.
    Returns draft schema JSON — does NOT save to DB.
    """
    from api.services.form_extractor import extract_form_schema

    content_bytes = None
    filename = None
    if file:
        content_bytes = await file.read()
        filename = file.filename
        if len(content_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File exceeds 10 MB limit")

    schema = extract_form_schema(
        source_type=source_type,
        content_bytes=content_bytes,
        filename=filename,
        text_prompt=text_prompt,
        form_name=form_name,
        db=db,
    )
    return {"schema": schema, "source_type": source_type}


# ─────────────────────────────────────────────────────────────
# Template CRUD
# ─────────────────────────────────────────────────────────────

@router.get("/form-builder/templates", response_model=list[FormTemplateOut], tags=["form-builder"])
def list_templates(project_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Return latest version per template name."""
    subq = (
        db.query(FormTemplate.name, func.max(FormTemplate.version).label("max_ver"))
        .group_by(FormTemplate.name)
        .subquery()
    )
    q = db.query(FormTemplate).join(
        subq,
        (FormTemplate.name == subq.c.name) & (FormTemplate.version == subq.c.max_ver),
    )
    if project_id is not None:
        q = q.filter(
            (FormTemplate.project_id == project_id) | (FormTemplate.project_id == None)
        )
    return q.order_by(FormTemplate.updated_at.desc()).all()


@router.post("/form-builder/templates", response_model=FormTemplateOut, tags=["form-builder"])
def save_template(payload: FormTemplateCreate, db: Session = Depends(get_db)):
    row = FormTemplate(
        name=payload.name,
        description=payload.description,
        category=payload.category,
        status=payload.status,
        form_schema_json=payload.form_schema_json,
        source_type=payload.source_type,
        project_id=payload.project_id,
        version=1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/form-builder/templates/{template_id}", response_model=FormTemplateOut, tags=["form-builder"])
def get_template(template_id: int, db: Session = Depends(get_db)):
    return _get_template_or_404(template_id, db)


@router.put("/form-builder/templates/{template_id}", response_model=FormTemplateOut, tags=["form-builder"])
def update_template(template_id: int, payload: FormTemplateUpdate, db: Session = Depends(get_db)):
    """Creates a new version record; old record is untouched."""
    old = _get_template_or_404(template_id, db)
    new_row = FormTemplate(
        name=payload.name if payload.name is not None else old.name,
        description=payload.description if payload.description is not None else old.description,
        category=payload.category if payload.category is not None else old.category,
        status=payload.status if payload.status is not None else old.status,
        form_schema_json=payload.form_schema_json if payload.form_schema_json is not None else old.form_schema_json,
        source_type=old.source_type,
        project_id=old.project_id,
        version=old.version + 1,
        parent_id=old.id,
    )
    db.add(new_row)
    db.commit()
    db.refresh(new_row)
    return new_row


@router.delete("/form-builder/templates/{template_id}", tags=["form-builder"])
def delete_template(template_id: int, db: Session = Depends(get_db)):
    row = _get_template_or_404(template_id, db)
    db.delete(row)
    db.commit()
    return {"deleted": template_id}


# ─────────────────────────────────────────────────────────────
# Ask AI — modify schema
# ─────────────────────────────────────────────────────────────

@router.post("/form-builder/templates/{template_id}/ask-ai", tags=["form-builder"])
def ask_ai_modify(template_id: int, payload: FormAskAIRequest, db: Session = Depends(get_db)):
    """Modify existing template schema via AI instruction. Returns draft schema (not saved)."""
    from api.services.form_extractor import modify_schema_with_ai

    tmpl = _get_template_or_404(template_id, db)
    existing = json.loads(tmpl.form_schema_json) if tmpl.form_schema_json else {}
    modified = modify_schema_with_ai(existing, payload.instruction, db)
    return {"schema": modified}


# ─────────────────────────────────────────────────────────────
# Connection schema browser (catalog tables for a connection)
# ─────────────────────────────────────────────────────────────

@router.get("/form-builder/connections/{conn_id}/schema-tables", tags=["form-builder"])
def get_schema_tables(conn_id: int, db: Session = Depends(get_db)):
    """Return table names (and column counts) from the catalog for a connection."""
    from api.models import CatalogColumn
    cols = db.query(CatalogColumn).filter(CatalogColumn.conn_id == conn_id).all()
    tables: dict[str, list[str]] = {}
    for c in cols:
        tables.setdefault(c.table_name, []).append(c.column_name)
    return [
        {"table": tbl, "column_count": len(tcols), "columns": tcols[:30]}
        for tbl, tcols in sorted(tables.items())
    ]


# ─────────────────────────────────────────────────────────────
# AI Query Suggestion — uses catalog schema + template fields
# ─────────────────────────────────────────────────────────────

@router.post("/form-builder/templates/{template_id}/suggest-query", tags=["form-builder"])
def suggest_query(template_id: int, payload: dict, db: Session = Depends(get_db)):
    """
    Generate a SQL query suggestion for a given connection using the template's
    field names and the catalogued schema (tables, columns, FK relations).
    Body: { "conn_id": int }
    """
    from api.models import CatalogColumn, CatalogRelation, CatalogSample, SourceConnection
    from api.services import ai_trace
    import openai, time
    from api.config import settings

    conn_id = payload.get("conn_id")
    if not conn_id:
        raise HTTPException(status_code=422, detail="conn_id is required")

    tmpl = _get_template_or_404(template_id, db)
    schema = json.loads(tmpl.form_schema_json) if tmpl.form_schema_json else {}
    fields = _all_fields(schema)
    if not fields:
        raise HTTPException(status_code=400, detail="Template has no fields to suggest a query for")

    field_summary = "\n".join(
        f"  - {f.get('name')} ({f.get('label', '')}){' [required]' if f.get('required') else ''}"
        for f in fields
    )

    # Build schema summary from catalog
    cols = db.query(CatalogColumn).filter(CatalogColumn.conn_id == conn_id).all()
    rels = db.query(CatalogRelation).filter(CatalogRelation.conn_id == conn_id).all()

    if not cols:
        raise HTTPException(
            status_code=400,
            detail="No schema catalog found for this connection. Run 'Collect Schema' in Admin first."
        )

    tables: dict[str, list[str]] = {}
    for c in cols:
        tables.setdefault(c.table_name, []).append(f"{c.column_name}({c.data_type or 'str'})")

    schema_lines = "\n".join(
        f"  {tbl}: {', '.join(tcols[:20])}" for tbl, tcols in list(tables.items())[:20]
    )
    fk_lines = "\n".join(
        f"  {r.parent_table}.{r.parent_column} → {r.referenced_table}.{r.referenced_column}"
        for r in rels[:15]
    ) or "  (none)"

    conn_row = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    dialect = (conn_row.dialect or "sql") if conn_row else "sql"

    system_prompt = (
        "You are an expert SQL query writer.\n"
        "Given a database schema and a list of form fields, write a single SQL SELECT query "
        "that retrieves the columns needed to populate those fields.\n"
        "Rules:\n"
        f"- Use {dialect.upper()} syntax\n"
        "- Use JOINs where FK relationships exist\n"
        "- Alias columns using the form field names (AS field_name)\n"
        "- Select ALL rows — do NOT add any WHERE clause (the user will add their own filter)\n"
        "- CRITICAL: Do NOT use parameterized placeholders like :param, @param, ?, or %(name)s — "
        "  these cause runtime errors. Write only literal SQL.\n"
        "- If a sample WHERE is helpful, put it as a SQL comment at the end: -- e.g. WHERE id = 1\n"
        "- Return ONLY the SQL query, no markdown fences, no explanation"
    )

    # Add sample rows from catalog so AI understands actual data shape
    from api.models import CatalogSample
    sample_lines = ""
    try:
        samples = db.query(CatalogSample).filter(CatalogSample.conn_id == conn_id).limit(6).all()
        if samples:
            sample_lines = "\n\nSample rows (to understand actual data):\n" + "\n".join(
                f"  {s.table_name}: {(s.sample_json or '')[:200]}" for s in samples
            )
    except Exception:
        pass

    user_content = (
        f"Form: {tmpl.name}\n\n"
        f"Fields to populate:\n{field_summary}\n\n"
        f"Database tables:\n{schema_lines}\n\n"
        f"Foreign key relationships:\n{fk_lines}"
        f"{sample_lines}"
    )

    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    t0 = time.monotonic()
    resp = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ],
        temperature=0,
    )
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    sql = (resp.choices[0].message.content or "").strip()
    # Strip markdown fences if present
    if sql.startswith("```"):
        sql = sql.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    try:
        ai_trace.store(
            module="form_builder",
            conn_id=conn_id,
            model="gpt-4o",
            prompt=f"[suggest-query] template={tmpl.name} fields={len(fields)}",
            response=sql[:4000],
            tokens_in=resp.usage.prompt_tokens if resp.usage else 0,
            tokens_out=resp.usage.completion_tokens if resp.usage else 0,
            latency_ms=elapsed_ms,
            db=db,
        )
    except Exception:
        pass

    return {"sql": sql, "field_count": len(fields), "table_count": len(tables)}


# ─────────────────────────────────────────────────────────────
# AI Layout Suggestion — auto-detects label_value vs grid
# ─────────────────────────────────────────────────────────────

_LAYOUT_PROMPT = """\
You are a professional form layout designer.

STEP 1 — DETECT LAYOUT TYPE:
- "label_value": Classic single-column. Label left, input right. One field per row. Use by default unless instructed otherwise.
- "grid": Multi-column. Fields side-by-side. Use only when the user requests compact/grid/multi-column, or form has 10+ fields and instruction says "compact".

STEP 2 — RETURN JSON ONLY (no markdown, no commentary):

label_value format:
{"layout_type":"label_value","sections":[{"section":"<title>","fields":[{"name":"<n>","row":1},...]}]}

grid format:
{"layout_type":"grid","sections":[{"section":"<title>","fields":[{"name":"<n>","row":1,"column":1,"col_span":1,"row_span":1,"height":"sm"},...]}]}

RULES:
1. Every field appears exactly once.
2. col_span 1=half-width, 2=full-width (place that field alone in its row).
3. height: sm=short fields (text/number/date/dropdown/checkbox/radio), md=normal, lg=textarea/signature.
4. Section titles in output MUST EXACTLY match input section titles.
5. Honor the user's instruction about ordering, grouping, and full-width placement.

FIELD LIST:
{{FIELDS_LIST}}

USER INSTRUCTION:
{{USER_INPUT}}
"""


class SuggestLayoutRequest(BaseModel):
    instruction: str


@router.post("/form-builder/templates/{template_id}/suggest-layout", tags=["form-builder"])
def suggest_layout(template_id: int, payload: SuggestLayoutRequest, db: Session = Depends(get_db)):
    """
    Generate a row/column layout for the template's fields based on a natural language instruction.
    Auto-detects layout_type ("label_value" or "grid").
    Returns: { "layout_type": "grid"|"label_value", "sections": [{section, fields: [{name, row, ...}]}] }
    """
    import time
    import re
    from api.services import ai_trace

    tmpl = _get_template_or_404(template_id, db)
    schema = json.loads(tmpl.form_schema_json) if tmpl.form_schema_json else {}
    sections = schema.get("sections", [])

    if not sections:
        raise HTTPException(status_code=400, detail="Template has no sections to layout.")

    # Build FIELDS_LIST text
    lines = []
    for sec in sections:
        lines.append(f"[Section: {sec.get('title', '')}]")
        for f in sec.get("fields", []):
            req = ", required" if f.get("required") else ""
            lines.append(
                f"  - name={f['name']!r}, label={f.get('label', f['name'])!r}, "
                f"type={f.get('type', 'text')!r}{req}"
            )
    fields_list_text = "\n".join(lines)

    # Build prompt from template
    system_prompt = (
        _LAYOUT_PROMPT
        .replace("{{FIELDS_LIST}}", fields_list_text)
        .replace("{{USER_INPUT}}", payload.instruction)
    )

    # DB prompt override — also apply placeholder substitution to DB template
    try:
        from api.models import PromptTemplate as _PT
        _pt = db.query(_PT).filter(_PT.category == "form_builder_layout", _PT.is_active == True).first()
        if _pt and _pt.content and _pt.content.strip():
            system_prompt = (
                _pt.content.strip()
                .replace("{{FIELDS_LIST}}", fields_list_text)
                .replace("{{USER_INPUT}}", payload.instruction)
                .replace("{{IMAGE_DESCRIPTION}}", "")
            )
    except Exception:
        pass

    user_msg = "Generate the layout JSON now. Return only the JSON object."

    from api.config import settings
    import openai
    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)

    t0 = time.monotonic()
    resp = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.2,
        max_tokens=3000,
    )
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw = resp.choices[0].message.content.strip()

    # Parse JSON — handle markdown-fenced or bare object
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r'\{.*\}', raw, re.DOTALL)
        if m:
            try:
                result = json.loads(m.group(0))
            except json.JSONDecodeError:
                raise HTTPException(status_code=500, detail="AI returned invalid JSON for layout.")
        else:
            raise HTTPException(status_code=500, detail="AI returned invalid JSON for layout.")

    if not isinstance(result, dict) or "sections" not in result or "layout_type" not in result:
        raise HTTPException(status_code=500, detail="AI layout response missing required keys (layout_type, sections).")

    layout_type = result.get("layout_type", "grid")
    resp_sections = result.get("sections", [])

    # Validate completeness — append any missing fields
    for sec in sections:
        sec_title = sec.get("title", "")
        expected_names = {f["name"] for f in sec.get("fields", [])}

        matched = next(
            (s for s in resp_sections if s.get("section", "").strip().lower() == sec_title.strip().lower()),
            None,
        )
        if matched is None:
            sec_idx = sections.index(sec)
            matched = resp_sections[sec_idx] if sec_idx < len(resp_sections) else None

        if matched is None:
            new_sec: dict = {"section": sec_title, "fields": []}
            for i, f in enumerate(sec.get("fields", []), 1):
                if layout_type == "label_value":
                    new_sec["fields"].append({"name": f["name"], "row": i})
                else:
                    new_sec["fields"].append({"name": f["name"], "row": i, "column": 1, "col_span": 1, "row_span": 1, "height": "sm"})
            resp_sections.append(new_sec)
        else:
            returned_names = {fp["name"] for fp in matched.get("fields", [])}
            missing = expected_names - returned_names
            if missing:
                next_row = max((fp.get("row", 0) for fp in matched.get("fields", [])), default=0) + 1
                for fn in sorted(missing):
                    if layout_type == "label_value":
                        matched["fields"].append({"name": fn, "row": next_row})
                    else:
                        matched["fields"].append({"name": fn, "row": next_row, "column": 1, "col_span": 1, "row_span": 1, "height": "sm"})
                    next_row += 1

    try:
        ai_trace.store(
            module="form_builder",
            conn_id=None,
            model="gpt-4o",
            prompt=f"[suggest-layout] template={tmpl.name} type={layout_type} instruction={payload.instruction[:80]}",
            response=raw[:4000],
            tokens_in=resp.usage.prompt_tokens if resp.usage else 0,
            tokens_out=resp.usage.completion_tokens if resp.usage else 0,
            latency_ms=elapsed_ms,
            db=db,
        )
    except Exception:
        pass

    return {"layout_type": layout_type, "sections": resp_sections}


# ─────────────────────────────────────────────────────────────
# Mapping Presets
# ─────────────────────────────────────────────────────────────

@router.get("/form-builder/mapping-presets", response_model=list[FormMappingPresetOut], tags=["form-builder"])
def list_presets(db: Session = Depends(get_db)):
    return db.query(FormMappingPreset).order_by(FormMappingPreset.name).all()


@router.post("/form-builder/mapping-presets", response_model=FormMappingPresetOut, tags=["form-builder"])
def create_preset(payload: FormMappingPresetCreate, db: Session = Depends(get_db)):
    row = FormMappingPreset(
        name=payload.name,
        description=payload.description,
        source_hint=payload.source_hint,
        mapping_json=payload.mapping_json,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/form-builder/mapping-presets/{preset_id}", tags=["form-builder"])
def delete_preset(preset_id: int, db: Session = Depends(get_db)):
    row = db.query(FormMappingPreset).filter(FormMappingPreset.id == preset_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Preset {preset_id} not found")
    db.delete(row)
    db.commit()
    return {"deleted": preset_id}


# ─────────────────────────────────────────────────────────────
# Data Bindings — fixed sub-paths BEFORE /{bid}
# ─────────────────────────────────────────────────────────────

@router.post("/form-builder/templates/{template_id}/bindings/auto-map", tags=["form-builder"])
def auto_map(template_id: int, payload: FormAutoMapRequest, db: Session = Depends(get_db)):
    """AI-suggest field → data-key mappings with confidence scores."""
    from api.services.form_extractor import auto_map_fields

    tmpl = _get_template_or_404(template_id, db)
    schema = json.loads(tmpl.form_schema_json) if tmpl.form_schema_json else {}
    fields = _all_fields(schema)
    result = auto_map_fields(fields, payload.data_keys, db)
    return result


@router.get("/form-builder/templates/{template_id}/bindings", response_model=list[FormDataBindingOut], tags=["form-builder"])
def list_bindings(template_id: int, db: Session = Depends(get_db)):
    _get_template_or_404(template_id, db)
    return (
        db.query(FormDataBinding)
        .filter(FormDataBinding.template_id == template_id)
        .order_by(FormDataBinding.id.desc())
        .all()
    )


@router.post("/form-builder/templates/{template_id}/bindings", response_model=FormDataBindingOut, tags=["form-builder"])
def create_binding(template_id: int, payload: FormDataBindingCreate, db: Session = Depends(get_db)):
    _get_template_or_404(template_id, db)
    row = FormDataBinding(
        template_id=template_id,
        template_version=payload.template_version,
        name=payload.name,
        data_source=payload.data_source,
        config_json=payload.config_json,
        mapping_json=payload.mapping_json,
        preset_id=payload.preset_id,
        is_default=payload.is_default,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/form-builder/templates/{template_id}/bindings/{binding_id}", response_model=FormDataBindingOut, tags=["form-builder"])
def update_binding(template_id: int, binding_id: int, payload: FormDataBindingUpdate, db: Session = Depends(get_db)):
    row = _get_binding_or_404(template_id, binding_id, db)
    if payload.name is not None:         row.name         = payload.name
    if payload.config_json is not None:  row.config_json  = payload.config_json
    if payload.mapping_json is not None: row.mapping_json = payload.mapping_json
    if payload.preset_id is not None:    row.preset_id    = payload.preset_id
    if payload.is_default is not None:   row.is_default   = payload.is_default
    db.commit()
    db.refresh(row)
    return row


@router.post("/form-builder/templates/{template_id}/bindings/{binding_id}/preview", tags=["form-builder"])
def preview_binding(
    template_id: int,
    binding_id: int,
    runtime_headers: Optional[dict] = None,
    db: Session = Depends(get_db),
):
    """Fetch sample data (up to 5 rows) using the binding config and show mapped values."""
    from api.services.form_data_fetcher import fetch_and_normalize, apply_mapping

    tmpl    = _get_template_or_404(template_id, db)
    binding = _get_binding_or_404(template_id, binding_id, db)
    schema  = json.loads(tmpl.form_schema_json) if tmpl.form_schema_json else {}
    mapping = json.loads(binding.mapping_json) if binding.mapping_json else {}
    fields  = _all_fields(schema)

    normalized = fetch_and_normalize(
        binding.data_source, binding.config_json, db, runtime_headers=runtime_headers
    )

    bound_values = apply_mapping(fields, normalized.get("data", {}), mapping)

    sample_rows = [bound_values]  # normalized is a single-row contract; list for UI consistency

    columns = [f.get("name", "") for f in fields]
    return {
        "columns":     columns,
        "sample_rows": sample_rows[:5],
        "normalized":  normalized,
    }


# ─────────────────────────────────────────────────────────────
# Bulk-execute (fixed path — must be before /{template_id}/execute)
# ─────────────────────────────────────────────────────────────

@router.post("/form-builder/bulk-execute", tags=["form-builder"])
def bulk_execute(payload: FormBulkExecuteRequest, db: Session = Depends(get_db)):
    """
    Fetch data once from binding, then run N template executions.
    All executions share a bulk_run_id UUID for grouping.
    """
    from api.services.form_data_fetcher import fetch_and_normalize, apply_mapping
    from api.services.form_extractor import bind_and_execute

    binding = db.query(FormDataBinding).filter(FormDataBinding.id == payload.binding_id).first()
    if not binding:
        raise HTTPException(status_code=404, detail=f"Binding {payload.binding_id} not found")

    # Fetch data ONCE
    try:
        normalized = fetch_and_normalize(
            binding.data_source,
            binding.config_json,
            db,
            runtime_headers=payload.runtime_headers,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Data fetch failed: {str(exc)[:300]}")

    bulk_run_id = str(uuid.uuid4())
    results = []

    for item in payload.executions:
        tmpl = db.query(FormTemplate).filter(FormTemplate.id == item.template_id).first()
        if not tmpl:
            exec_row = FormExecution(
                template_id=item.template_id,
                template_version=item.template_version,
                binding_id=binding.id,
                bulk_run_id=bulk_run_id,
                output_format=item.output_format,
                status="failed",
                error_message=f"Template {item.template_id} not found",
                triggered_by="bulk",
            )
            db.add(exec_row)
            db.commit()
            db.refresh(exec_row)
            results.append(exec_row)
            continue

        schema  = json.loads(tmpl.form_schema_json) if tmpl.form_schema_json else {}
        mapping = json.loads(binding.mapping_json) if binding.mapping_json else {}

        try:
            output  = bind_and_execute(schema, mapping, normalized, item.output_format)
            file_path = None
            out_json  = None

            if output.get("bytes"):
                ext = "pdf"
                fname = f"{bulk_run_id}_{tmpl.id}_{item.output_format}.{ext}"
                fpath = _OUTPUT_DIR / fname
                fpath.write_bytes(output["bytes"])
                file_path = str(fpath)
            if output.get("output_json") is not None:
                out_json = json.dumps(output["output_json"])

            exec_row = FormExecution(
                template_id=tmpl.id,
                template_version=item.template_version,
                binding_id=binding.id,
                bulk_run_id=bulk_run_id,
                output_format=item.output_format,
                status="completed",
                output_json=out_json,
                output_file_path=file_path,
                triggered_by="bulk",
            )
        except Exception as exc:
            exec_row = FormExecution(
                template_id=tmpl.id,
                template_version=item.template_version,
                binding_id=binding.id,
                bulk_run_id=bulk_run_id,
                output_format=item.output_format,
                status="failed",
                error_message=str(exc)[:500],
                triggered_by="bulk",
            )

        db.add(exec_row)
        db.commit()
        db.refresh(exec_row)
        results.append(exec_row)

    return {"bulk_run_id": bulk_run_id, "executions": [FormExecutionOut.model_validate(r) for r in results]}


@router.get("/form-builder/bulk-runs/{run_id}", response_model=list[FormExecutionOut], tags=["form-builder"])
def get_bulk_run(run_id: str, db: Session = Depends(get_db)):
    return (
        db.query(FormExecution)
        .filter(FormExecution.bulk_run_id == run_id)
        .order_by(FormExecution.id)
        .all()
    )


# ─────────────────────────────────────────────────────────────
# Single Execution
# ─────────────────────────────────────────────────────────────

@router.post("/form-builder/templates/{template_id}/execute", response_model=FormExecutionOut, tags=["form-builder"])
def execute_template(template_id: int, payload: FormExecutionCreate, db: Session = Depends(get_db)):
    from api.services.form_data_fetcher import fetch_and_normalize, apply_mapping
    from api.services.form_extractor import bind_and_execute

    tmpl = _get_template_or_404(template_id, db)

    if tmpl.status not in ("configured", "active"):
        raise HTTPException(status_code=400, detail="Template must be saved (status=configured) before execution")

    schema = json.loads(tmpl.form_schema_json) if tmpl.form_schema_json else {}
    mapping: dict = {}
    normalized: dict = {"data": {}, "meta": {"source": "none", "fetched_at": "", "row_count": 0}}

    if payload.binding_id:
        binding = _get_binding_or_404(template_id, payload.binding_id, db)
        mapping = json.loads(binding.mapping_json) if binding.mapping_json else {}

    try:
        if payload.binding_id:
            normalized = fetch_and_normalize(binding.data_source, binding.config_json, db)
        output     = bind_and_execute(schema, mapping, normalized, payload.output_format)
        file_path  = None
        out_json   = None

        if output.get("bytes"):
            ext   = "pdf"
            fname = f"exec_{template_id}_{uuid.uuid4().hex[:8]}.{ext}"
            fpath = _OUTPUT_DIR / fname
            fpath.write_bytes(output["bytes"])
            file_path = str(fpath)

        if output.get("output_json") is not None:
            out_json = json.dumps(output["output_json"])

        exec_row = FormExecution(
            template_id=template_id,
            template_version=tmpl.version,
            binding_id=payload.binding_id,
            output_format=payload.output_format,
            status="completed",
            output_json=out_json,
            output_file_path=file_path,
            triggered_by="manual",
        )
    except Exception as exc:
        exec_row = FormExecution(
            template_id=template_id,
            template_version=tmpl.version,
            binding_id=payload.binding_id,
            output_format=payload.output_format,
            status="failed",
            error_message=str(exc)[:500],
            triggered_by="manual",
        )

    db.add(exec_row)
    db.commit()
    db.refresh(exec_row)
    return exec_row


class FormExecuteRowsRequest(BaseModel):
    binding_id:    int
    output_format: str = Field("api", pattern="^(pdf|fillable|ui|api)$")


@router.post("/form-builder/templates/{template_id}/execute-rows", tags=["form-builder"])
def execute_template_rows(template_id: int, payload: FormExecuteRowsRequest, db: Session = Depends(get_db)):
    """
    Fetch all rows from the binding's data source and generate one execution per row.
    Returns {"bulk_run_id": str, "total_rows": int, "executions": [...]}.
    Useful when a DB query returns N records and you want N forms.
    """
    from api.services.form_data_fetcher import apply_mapping
    from api.services.form_extractor import bind_and_execute
    from api.models import SourceConnection
    from api.services.encryption import decrypt

    tmpl = _get_template_or_404(template_id, db)
    if tmpl.status not in ("configured", "active"):
        raise HTTPException(status_code=400, detail="Template must be saved before execution")

    binding = _get_binding_or_404(template_id, payload.binding_id, db)
    schema  = json.loads(tmpl.form_schema_json) if tmpl.form_schema_json else {}
    mapping = json.loads(binding.mapping_json) if binding.mapping_json else {}

    if binding.data_source != "db":
        raise HTTPException(status_code=400, detail="execute-rows only supported for DB data sources")

    cfg = json.loads(binding.config_json) if binding.config_json else {}
    conn_id = cfg.get("conn_id")
    query   = cfg.get("query", "")
    if not conn_id or not query:
        raise HTTPException(status_code=400, detail="Binding missing conn_id or query")

    conn_row = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn_row:
        raise HTTPException(status_code=404, detail=f"Connection {conn_id} not found")

    try:
        from api.services.connector import fetch_all_data
        conn_cfg = {
            "source_type": conn_row.source_type,
            "dialect":     conn_row.dialect,
            "host":        conn_row.host,
            "port":        conn_row.port,
            "database":    conn_row.database_name,
            "schema":      conn_row.schema_name,
            "username":    conn_row.username,
            "password":    decrypt(conn_row.password_enc) if conn_row.password_enc else "",
            "query":       query,
        }
        result = fetch_all_data(conn_cfg)
        rows   = result.get("rows", [])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Data fetch failed: {str(exc)[:300]}")

    if not rows:
        raise HTTPException(status_code=400, detail="Query returned no rows — nothing to execute")

    from datetime import datetime, timezone
    bulk_run_id = str(uuid.uuid4())
    executions  = []

    for row in rows:
        normalized = {
            "data": row,
            "meta": {"source": "db", "fetched_at": datetime.now(timezone.utc).isoformat(), "row_count": 1},
        }
        try:
            output   = bind_and_execute(schema, mapping, normalized, payload.output_format)
            file_path = None
            out_json  = None

            if output.get("bytes"):
                fname = f"{bulk_run_id}_{uuid.uuid4().hex[:6]}.pdf"
                fpath = _OUTPUT_DIR / fname
                fpath.write_bytes(output["bytes"])
                file_path = str(fpath)

            if output.get("output_json") is not None:
                out_json = json.dumps(output["output_json"])

            exec_row = FormExecution(
                template_id=template_id,
                template_version=tmpl.version,
                binding_id=binding.id,
                bulk_run_id=bulk_run_id,
                output_format=payload.output_format,
                status="completed",
                output_json=out_json,
                output_file_path=file_path,
                triggered_by="bulk",
            )
        except Exception as exc:
            exec_row = FormExecution(
                template_id=template_id,
                template_version=tmpl.version,
                binding_id=binding.id,
                bulk_run_id=bulk_run_id,
                output_format=payload.output_format,
                status="failed",
                error_message=str(exc)[:500],
                triggered_by="bulk",
            )

        db.add(exec_row)
        db.commit()
        db.refresh(exec_row)
        executions.append(exec_row)

    return {
        "bulk_run_id": bulk_run_id,
        "total_rows":  len(rows),
        "executions":  [FormExecutionOut.model_validate(e) for e in executions],
    }


@router.get("/form-builder/templates/{template_id}/executions", response_model=list[FormExecutionOut], tags=["form-builder"])
def list_executions(template_id: int, db: Session = Depends(get_db)):
    _get_template_or_404(template_id, db)
    return (
        db.query(FormExecution)
        .filter(FormExecution.template_id == template_id)
        .order_by(FormExecution.id.desc())
        .all()
    )


@router.get("/form-builder/outputs/{filename}", tags=["form-builder"])
def download_output(filename: str):
    """Serve a generated output file (PDF, etc.)."""
    path = _OUTPUT_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(path), filename=filename)
