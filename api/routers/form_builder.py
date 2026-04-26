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
        q = q.filter(FormTemplate.project_id == project_id)
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
    normalized = fetch_and_normalize(
        binding.data_source,
        binding.config_json,
        db,
        runtime_headers=payload.runtime_headers,
    )

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
        mapping    = json.loads(binding.mapping_json) if binding.mapping_json else {}
        normalized = fetch_and_normalize(binding.data_source, binding.config_json, db)

    try:
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
