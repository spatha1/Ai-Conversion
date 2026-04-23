# ═══════════════════════════════════════════════════════════
# routers/ui_validation.py — Template-Based UI Validation
#
# Endpoints:
#   POST   /ui-validation/setup              — create/upsert template
#   GET    /ui-validation/status/{conn_id}   — {configured, template_id}
#   POST   /ui-validation/run                — run Playwright validation
#   GET    /ui-validation/runs/{template_id} — recent run history
#   DELETE /ui-validation/template/{id}      — delete template + clear session
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.dependencies import get_current_user
from api.models import UiValidationTemplate, UiValidationRun, GeneratedXml, ApiDispatchLog
from api.services.encryption import encrypt, decrypt

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_current_user)])


# ── Inline schemas ────────────────────────────────────────────

class TemplateIn(BaseModel):
    connection_id:     int
    app_name:          str
    base_url:          str
    entity_paths:      dict[str, str]           # {"policy": "/policy/{id}"}
    login_config:      Optional[dict[str, str]] = None
    selectors:         dict[str, str]           # {"premium": "[data-testid='premium']"}
    response_id_field: Optional[str] = None     # dot-path into dispatch response JSON, e.g. "policyId" or "data.id"


class TemplateOut(BaseModel):
    id:                int
    connection_id:     int
    app_name:          str
    base_url:          str
    entity_paths:      dict
    login_config:      Optional[dict] = None
    selectors:         dict
    response_id_field: Optional[str] = None
    created_at:        datetime
    updated_at:        datetime

    model_config = {"from_attributes": True}


class StatusOut(BaseModel):
    configured:   bool
    template_id:  Optional[int] = None
    entity_paths: dict = {}   # {"policy": "/policy/{id}"} — empty when not configured


class RunIn(BaseModel):
    connection_id: int
    entity:        str   # "policy" | "claim" | ...
    entity_id:     str   # "12345" — must match identifier_value in conversion_generated_xml


class FieldResult(BaseModel):
    field:     str
    ui_value:  Optional[str] = None
    xml_value: Optional[str] = None
    status:    str                   # MATCH | MISMATCH | MISSING | NO_XML | ERROR


class RunSummary(BaseModel):
    total:      int
    matched:    int
    mismatched: int
    missing:    int = 0


class RunOut(BaseModel):
    id:            int
    entity:        str
    entity_id:     str
    status:        str               # PASS | FAIL | ERROR
    url:           Optional[str] = None
    screenshot:    Optional[str] = None
    summary:       Optional[RunSummary] = None
    results:       list[FieldResult] = []
    error_message: Optional[str] = None
    created_at:    datetime

    model_config = {"from_attributes": True}


# ── Helpers ───────────────────────────────────────────────────

def _template_to_dict(tmpl: UiValidationTemplate) -> dict[str, Any]:
    """Convert ORM row to plain dict consumable by playwright_runner."""
    login_cfg = None
    if tmpl.login_config:
        try:
            raw = decrypt(tmpl.login_config)
            login_cfg = json.loads(raw)
        except Exception:
            login_cfg = json.loads(tmpl.login_config)  # fallback: not encrypted

    return {
        "id":           tmpl.id,
        "base_url":     tmpl.base_url,
        "entity_paths": json.loads(tmpl.entity_paths),
        "login_config": login_cfg,
        "selectors":    json.loads(tmpl.selectors),
    }


def _template_out(tmpl: UiValidationTemplate) -> TemplateOut:
    login_cfg = None
    if tmpl.login_config:
        try:
            raw = decrypt(tmpl.login_config)
            login_cfg = json.loads(raw)
            # Never expose password in response
            login_cfg.pop("password", None)
        except Exception:
            try:
                login_cfg = json.loads(tmpl.login_config)
                login_cfg.pop("password", None)
            except Exception:
                login_cfg = None

    return TemplateOut(
        id=tmpl.id,
        connection_id=tmpl.connection_id,
        app_name=tmpl.app_name,
        base_url=tmpl.base_url,
        entity_paths=json.loads(tmpl.entity_paths),
        login_config=login_cfg,
        selectors=json.loads(tmpl.selectors),
        response_id_field=tmpl.response_id_field,
        created_at=tmpl.created_at,
        updated_at=tmpl.updated_at,
    )


def _run_out(run: UiValidationRun) -> RunOut:
    summary = None
    results: list[FieldResult] = []
    if run.summary:
        try:
            summary = RunSummary(**json.loads(run.summary))
        except Exception:
            pass
    if run.results:
        try:
            results = [FieldResult(**r) for r in json.loads(run.results)]
        except Exception:
            pass

    return RunOut(
        id=run.id,
        entity=run.entity,
        entity_id=run.entity_id,
        status=run.status,
        url=run.url,
        screenshot=run.screenshot,
        summary=summary,
        results=results,
        error_message=run.error_message,
        created_at=run.created_at,
    )


# ── Endpoints ─────────────────────────────────────────────────

@router.post("/ui-validation/setup", response_model=TemplateOut, status_code=201)
def setup_template(data: TemplateIn, db: Session = Depends(get_db)):
    """Create or update a validation template for a connection."""
    existing = (
        db.query(UiValidationTemplate)
        .filter_by(connection_id=data.connection_id)
        .first()
    )

    # Encrypt login_config if it contains a password
    login_enc: str | None = None
    if data.login_config:
        login_enc = encrypt(json.dumps(data.login_config))

    if existing:
        existing.app_name          = data.app_name
        existing.base_url          = data.base_url
        existing.entity_paths      = json.dumps(data.entity_paths)
        existing.login_config      = login_enc
        existing.selectors         = json.dumps(data.selectors)
        existing.response_id_field = data.response_id_field
        existing.updated_at        = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return _template_out(existing)

    tmpl = UiValidationTemplate(
        connection_id=data.connection_id,
        app_name=data.app_name,
        base_url=data.base_url,
        entity_paths=json.dumps(data.entity_paths),
        login_config=login_enc,
        selectors=json.dumps(data.selectors),
        response_id_field=data.response_id_field,
    )
    db.add(tmpl)
    db.commit()
    db.refresh(tmpl)
    return _template_out(tmpl)


@router.get("/ui-validation/status/{conn_id}", response_model=StatusOut)
def get_status(conn_id: int, db: Session = Depends(get_db)):
    """Check whether a validation template exists for the given connection."""
    tmpl = (
        db.query(UiValidationTemplate)
        .filter_by(connection_id=conn_id)
        .first()
    )
    return StatusOut(
        configured=tmpl is not None,
        template_id=tmpl.id if tmpl else None,
        entity_paths=(tmpl.entity_paths or {}) if tmpl else {},
    )


@router.post("/ui-validation/run", response_model=RunOut)
def run_validation(data: RunIn, db: Session = Depends(get_db)):
    """
    Execute a Playwright validation run for a specific entity.

    Loads the template for the connection, runs Playwright headlessly,
    compares UI values against the XML file (if provided), and persists
    the result.
    """
    tmpl = (
        db.query(UiValidationTemplate)
        .filter_by(connection_id=data.connection_id)
        .first()
    )
    if not tmpl:
        raise HTTPException(
            status_code=404,
            detail=f"No validation template configured for connection {data.connection_id}. "
                   "Call POST /api/ui-validation/setup first.",
        )

    template_dict = _template_to_dict(tmpl)
    selectors: dict = json.loads(tmpl.selectors)

    # Resolve DCT entity ID from dispatch response if response_id_field is configured
    dct_entity_id = data.entity_id
    if tmpl.response_id_field:
        dispatch_log = (
            db.query(ApiDispatchLog)
            .filter(
                ApiDispatchLog.conn_id == data.connection_id,
                ApiDispatchLog.identifier_value == data.entity_id,
                ApiDispatchLog.status == "success",
            )
            .order_by(ApiDispatchLog.id.desc())
            .first()
        )
        if dispatch_log and dispatch_log.response_body:
            try:
                resp_json = json.loads(dispatch_log.response_body)
                # Support dot-notation path: "data.policyId"
                val = resp_json
                for key in tmpl.response_id_field.split("."):
                    if isinstance(val, dict):
                        val = val.get(key)
                    else:
                        val = None
                        break
                if val is not None:
                    dct_entity_id = str(val)
                    logger.info(
                        "Resolved DCT entity ID %r from response field %r (source: %r)",
                        dct_entity_id, tmpl.response_id_field, data.entity_id,
                    )
            except Exception as exc:
                logger.warning("Could not extract response_id_field %r: %s", tmpl.response_id_field, exc)

    try:
        from api.services.playwright_runner import run_validation as pw_run
        from api.services.xml_comparator import parse_xml_fields, compare_fields

        # pw_run is synchronous (uses asyncio.run() internally).
        # FastAPI dispatches sync handlers in a thread pool so this is safe.
        pw_result = pw_run(template_dict, data.entity, dct_entity_id, None)

        ui_values: dict = pw_result["ui_values"]
        screenshot: str = pw_result.get("screenshot_path", "")
        url: str = pw_result["url"]

        # Fetch generated XML from DB by conn_id + entity_id
        xml_values: dict = {}
        xml_record = (
            db.query(GeneratedXml)
            .filter(
                GeneratedXml.conn_id == data.connection_id,
                GeneratedXml.identifier_value == data.entity_id,
            )
            .order_by(GeneratedXml.id.desc())
            .first()
        )
        if xml_record and xml_record.xml_content:
            try:
                xml_values = parse_xml_fields(
                    xml_record.xml_content,
                    list(selectors.keys()),
                    is_content=True,
                )
            except Exception as exc:
                logger.warning("XML parse failed for entity %r: %s", data.entity_id, exc)
        else:
            logger.info(
                "No generated XML found for conn_id=%s entity_id=%r — skipping comparison",
                data.connection_id, data.entity_id,
            )

        comparison = compare_fields(ui_values, xml_values)
        results_list: list = comparison["results"]
        summary_dict: dict = comparison["summary"]

        overall = "PASS" if summary_dict["mismatched"] == 0 else "FAIL"

        run = UiValidationRun(
            template_id=tmpl.id,
            entity=data.entity,
            entity_id=data.entity_id,
            status=overall,
            url=url,
            screenshot=screenshot,
            summary=json.dumps(summary_dict),
            results=json.dumps(results_list),
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        return _run_out(run)

    except Exception as exc:
        logger.exception("UI validation run failed: %s", exc)
        run = UiValidationRun(
            template_id=tmpl.id,
            entity=data.entity,
            entity_id=data.entity_id,
            status="ERROR",
            error_message=str(exc)[:2000],
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        return _run_out(run)




@router.get("/ui-validation/runs/{template_id}", response_model=list[RunOut])
def list_runs(
    template_id: int,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """Return the most recent validation runs for a template."""
    runs = (
        db.query(UiValidationRun)
        .filter_by(template_id=template_id)
        .order_by(UiValidationRun.id.desc())
        .limit(limit)
        .all()
    )
    return [_run_out(r) for r in runs]


@router.delete("/ui-validation/template/{template_id}", status_code=204)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    """Delete a validation template and its saved browser session."""
    tmpl = db.query(UiValidationTemplate).filter_by(id=template_id).first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")

    # Clear saved browser session so next login starts fresh
    try:
        from api.services.playwright_runner import clear_session
        clear_session(template_id)
    except Exception as exc:
        logger.warning("Could not clear session for template %s: %s", template_id, exc)

    db.delete(tmpl)
    db.commit()
