# ═══════════════════════════════════════════════════════════
# api/routers/pipeline.py
#
# Full conversion pipeline runner + scheduler.
# Steps (in order):
#   1. Generate output  (generate-all-xml equivalent)
#   2. Validate         (XML only — skipped for other formats)
#   3. Dispatch         (send-all equivalent)
#
# Endpoints:
#   POST  /pipeline/{conn_id}/run            — run pipeline now
#   GET   /pipeline/{conn_id}/last-run       — last run result
#   GET   /pipeline/{conn_id}/schedule       — get schedule config
#   PUT   /pipeline/{conn_id}/schedule       — save schedule config
#   GET   /pipeline/{conn_id}/history        — last N runs
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

import json
import time as _time
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import (
    PipelineSchedule, PipelineRun,
    XmlTemplate, GeneratedQuery, SourceConnection, GeneratedXml,
    ApiDispatchConfig, ValidationRule, Mapping,
)
from api.dependencies import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])

# ── Pydantic schemas ─────────────────────────────────────────

class ScheduleIn(BaseModel):
    schedule_type:    str  = "manual"   # manual|interval|daily|weekly
    interval_minutes: Optional[int] = None
    run_at_time:      Optional[str] = None   # "HH:MM"
    run_on_day:       Optional[int] = None   # 0=Mon…6=Sun
    is_enabled:       bool = True


class ScheduleOut(BaseModel):
    id:               Optional[int] = None
    conn_id:          int
    schedule_type:    str = "manual"
    interval_minutes: Optional[int] = None
    run_at_time:      Optional[str] = None
    run_on_day:       Optional[int] = None
    is_enabled:       bool = True
    next_run_at:      Optional[str] = None
    last_run_at:      Optional[str] = None
    last_run_status:  Optional[str] = None


class StepResult(BaseModel):
    step:    str
    label:   str
    status:  str            # skipped|running|success|fail
    message: Optional[str] = None
    count:   Optional[int] = None
    elapsed_ms: Optional[int] = None


class RunOut(BaseModel):
    id:          int
    conn_id:     int
    triggered_by: str
    status:      str
    steps:       list[StepResult]
    started_at:  str
    finished_at: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────

def _dt_str(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _run_to_out(run: PipelineRun) -> RunOut:
    steps: list[dict] = []
    if run.steps_json:
        try:
            steps = json.loads(run.steps_json)
        except Exception:
            steps = []
    return RunOut(
        id=run.id,
        conn_id=run.conn_id,
        triggered_by=run.triggered_by or "manual",
        status=run.status,
        steps=[StepResult(**s) for s in steps],
        started_at=_dt_str(run.started_at) or "",
        finished_at=_dt_str(run.finished_at),
    )


def _sched_to_out(s: PipelineSchedule) -> ScheduleOut:
    return ScheduleOut(
        id=s.id,
        conn_id=s.conn_id,
        schedule_type=s.schedule_type or "manual",
        interval_minutes=s.interval_minutes,
        run_at_time=s.run_at_time,
        run_on_day=s.run_on_day,
        is_enabled=bool(s.is_enabled),
        next_run_at=_dt_str(s.next_run_at),
        last_run_at=_dt_str(s.last_run_at),
        last_run_status=s.last_run_status,
    )


def _compute_next_run(sched: PipelineSchedule) -> Optional[datetime]:
    """Compute next_run_at from schedule settings."""
    now = datetime.utcnow()
    st = sched.schedule_type or "manual"

    if st == "interval" and sched.interval_minutes and sched.interval_minutes > 0:
        return now + timedelta(minutes=sched.interval_minutes)

    if st in ("daily", "weekly") and sched.run_at_time:
        try:
            hh, mm = map(int, sched.run_at_time.split(":"))
        except Exception:
            return None
        candidate = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if st == "daily":
            if candidate <= now:
                candidate += timedelta(days=1)
            return candidate
        if st == "weekly" and sched.run_on_day is not None:
            # run_on_day: 0=Mon … 6=Sun
            days_ahead = (sched.run_on_day - now.weekday()) % 7
            if days_ahead == 0 and candidate <= now:
                days_ahead = 7
            return candidate + timedelta(days=days_ahead)

    return None


# ── Pipeline runner (called from both /run and scheduler) ─────

def execute_pipeline(conn_id: int, triggered_by: str, db: Session) -> PipelineRun:
    """
    Run the full pipeline for conn_id:
      Step 1 — generate output
      Step 2 — validate (XML only)
      Step 3 — dispatch
    Records every step result in PipelineRun.steps_json.
    """
    steps: list[dict] = []
    overall = "success"

    run = PipelineRun(
        conn_id=conn_id,
        triggered_by=triggered_by,
        status="running",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    def add_step(step: str, label: str, status: str,
                 message: str | None = None, count: int | None = None,
                 elapsed_ms: int | None = None):
        steps.append({
            "step": step, "label": label, "status": status,
            "message": message, "count": count, "elapsed_ms": elapsed_ms,
        })

    # ── Determine format ─────────────────────────────────────
    tpl = (db.query(XmlTemplate).filter_by(conn_id=conn_id)
             .order_by(XmlTemplate.id.desc()).first())
    fmt = (tpl.format_type or "xml") if tpl else "xml"
    is_xml = (fmt == "xml")

    # ── Step 1: Generate output ───────────────────────────────
    t0 = _time.time()
    try:
        gq = (db.query(GeneratedQuery).filter_by(conn_id=conn_id)
                .order_by(GeneratedQuery.id.desc()).first())
        if not tpl or not tpl.content:
            raise ValueError("No template found — upload one in the Target tab first.")
        if not gq or not gq.query_sql:
            raise ValueError("No generated query — run Generate Query in the Mapping tab first.")

        src = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
        if not src:
            raise ValueError("Source connection not found.")

        from api.routers.connections import _to_cfg_from_model
        from api.services.connector import _build_sql_engine, _serialize_row, _clean_error, _build_sf_connection
        from api.routers.mapping_ai import _fill_template_from_row, _clean_sql_for_exec
        from api.models import Mapping, MappingRow
        import re as _re

        cfg_dict = _to_cfg_from_model(src)
        dialect  = "snowflake" if src.source_type == "snowflake" else (src.dialect or "mssql").lower()
        sql      = _clean_sql_for_exec(gq.query_sql, dialect)

        # Run query
        if dialect == "snowflake":
            conn = _build_sf_connection(cfg_dict)
            cur  = conn.cursor()
            cur.execute(sql)
            cols    = [d[0] for d in cur.description]
            raw_rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            cur.close(); conn.close()
        else:
            from sqlalchemy import text as _sa_text
            engine = _build_sql_engine(cfg_dict)
            with engine.connect() as _c:
                result   = _c.execute(_sa_text(sql))
                cols     = list(result.keys())
                raw_rows = [dict(zip(cols, r)) for r in result.fetchall()]

        rows = [_serialize_row(r) for r in raw_rows]
        if not rows:
            raise ValueError("Query returned no data.")

        # Group by identifier
        from collections import defaultdict as _dd
        mapping = (db.query(Mapping).filter_by(conn_id=conn_id, is_active=True)
                     .order_by(Mapping.id.desc()).first())
        id_col = mapping.identifier_column if mapping else None
        if rows and "__identifier__" in rows[0]:
            id_col = "__identifier__"
        elif not id_col and rows:
            id_col = list(rows[0].keys())[0]

        groups: dict = _dd(list)
        for row in rows:
            id_val = str(row.get(id_col, "") or "") if id_col else ""
            groups[id_val].append(row)

        mid = mapping.id if mapping else None
        saved = 0
        for id_val, group_rows in groups.items():
            try:
                xml_out = _fill_template_from_row(tpl.content, group_rows[0], fmt)
                existing = db.query(GeneratedXml).filter_by(conn_id=conn_id, identifier_value=id_val).first()
                if existing:
                    existing.xml_content    = xml_out
                    existing.mapping_id     = mid
                    existing.validation_status = None
                    existing.validation_comment = None
                else:
                    db.add(GeneratedXml(conn_id=conn_id, mapping_id=mid,
                                        identifier_value=id_val, xml_content=xml_out))
                db.flush()
                saved += 1
            except Exception:
                pass
        db.commit()
        elapsed = int((_time.time() - t0) * 1000)
        add_step("generate", f"Generate {fmt.upper()} Output", "success",
                 count=saved, elapsed_ms=elapsed)
    except Exception as exc:
        elapsed = int((_time.time() - t0) * 1000)
        add_step("generate", "Generate Output", "fail", message=str(exc), elapsed_ms=elapsed)
        overall = "fail"
        # Abort — cannot validate/dispatch without generated output
        run.status      = overall
        run.steps_json  = json.dumps(steps)
        run.finished_at = datetime.utcnow()
        db.commit()
        return run

    # ── Step 2: Validate (XML only) ───────────────────────────
    t0 = _time.time()
    if not is_xml:
        add_step("validate", "Validate", "skipped",
                 message="Validation only available for XML — skipped.")
    else:
        try:
            rules = db.query(ValidationRule).filter_by(conn_id=conn_id).all()
            if not rules:
                add_step("validate", "Validate XML", "skipped",
                         message="No validation rules defined — skipped.")
            else:
                from api.services.xsd_builder import validate_xml_rules
                xml_rows = (db.query(GeneratedXml).filter_by(conn_id=conn_id)
                              .order_by(GeneratedXml.id).all())
                rule_dicts = [{
                    "target_path": r.target_path, "is_required": bool(r.is_required),
                    "data_type": r.data_type, "min_length": r.min_length,
                    "max_length": r.max_length, "pattern": r.pattern,
                    "enumeration": r.enumeration, "min_value": r.min_value,
                    "max_value": r.max_value,
                } for r in rules]
                passed = failed = 0
                for row in xml_rows:
                    xml_str = row.xml_content or ""
                    if not xml_str.strip():
                        row.validation_status = "fail"
                        failed += 1
                        continue
                    ok, _ = validate_xml_rules(xml_str, rule_dicts)
                    row.validation_status = "pass" if ok else "fail"
                    if ok:
                        passed += 1
                    else:
                        failed += 1
                db.commit()
                elapsed = int((_time.time() - t0) * 1000)
                vstatus = "success" if failed == 0 else ("fail" if passed == 0 else "success")
                if failed > 0 and passed == 0:
                    overall = "fail"
                elif failed > 0:
                    if overall != "fail":
                        overall = "partial"
                add_step("validate", "Validate XML", vstatus,
                         message=f"{passed} passed, {failed} failed",
                         count=passed, elapsed_ms=elapsed)
        except Exception as exc:
            elapsed = int((_time.time() - t0) * 1000)
            add_step("validate", "Validate XML", "fail", message=str(exc), elapsed_ms=elapsed)
            if overall != "fail":
                overall = "partial"

    # ── Step 3: Dispatch ──────────────────────────────────────
    t0 = _time.time()
    try:
        cfg = db.query(ApiDispatchConfig).filter(ApiDispatchConfig.conn_id == conn_id).first()
        if not cfg or not (cfg.endpoint_url or cfg.sftp_host or cfg.azure_conn_str_enc):
            add_step("dispatch", "Dispatch", "skipped",
                     message="No dispatch configuration saved — skipped.")
        else:
            from api.routers.api_dispatch import _dispatch_one
            q = db.query(GeneratedXml).filter(GeneratedXml.conn_id == conn_id)
            if is_xml:
                q = q.filter(GeneratedXml.validation_status == "pass")
            disp_rows = q.order_by(GeneratedXml.id).all()

            if not disp_rows:
                add_step("dispatch", "Dispatch", "skipped",
                         message="No records ready for dispatch (none passed validation)." if is_xml
                                 else "No generated records found.")
            else:
                from api.models import ApiDispatchLog
                sent = failed_d = 0
                for x in disp_rows:
                    status, http_code, resp_body, elapsed_ms, retries, err = _dispatch_one(cfg, x, fmt)
                    db.add(ApiDispatchLog(
                        conn_id=conn_id, xml_id=x.id,
                        identifier_value=x.identifier_value, status=status,
                        request_body=(x.xml_content or "")[:65536],
                        response_status=http_code or None,
                        response_body=resp_body[:131072] if resp_body else None,
                        response_time_ms=elapsed_ms or None, retry_count=retries,
                        error_message=err,
                    ))
                    if status == "success":
                        sent += 1
                    else:
                        failed_d += 1
                db.commit()
                elapsed = int((_time.time() - t0) * 1000)
                dstatus = "success" if failed_d == 0 else ("fail" if sent == 0 else "success")
                if failed_d > 0 and sent == 0:
                    if overall != "fail":
                        overall = "fail"
                elif failed_d > 0 and overall != "fail":
                    overall = "partial"
                add_step("dispatch", "Dispatch", dstatus,
                         message=f"{sent} sent, {failed_d} failed",
                         count=sent, elapsed_ms=elapsed)
    except Exception as exc:
        elapsed = int((_time.time() - t0) * 1000)
        add_step("dispatch", "Dispatch", "fail", message=str(exc), elapsed_ms=elapsed)
        if overall != "fail":
            overall = "partial"

    run.status      = overall
    run.steps_json  = json.dumps(steps)
    run.finished_at = datetime.utcnow()
    db.commit()

    # Update schedule last-run info
    sched = db.query(PipelineSchedule).filter_by(conn_id=conn_id).first()
    if sched:
        sched.last_run_at     = datetime.utcnow()
        sched.last_run_status = overall
        sched.next_run_at     = _compute_next_run(sched)
        db.commit()

    return run


# ── Endpoints ─────────────────────────────────────────────────

@router.post("/pipeline/{conn_id}/run", response_model=RunOut)
def run_pipeline(conn_id: int, db: Session = Depends(get_db)):
    """Execute the full pipeline now (generate → validate → dispatch)."""
    run = execute_pipeline(conn_id, triggered_by="manual", db=db)
    return _run_to_out(run)


@router.get("/pipeline/{conn_id}/last-run", response_model=Optional[RunOut])
def get_last_run(conn_id: int, db: Session = Depends(get_db)):
    """Return the most recent pipeline run for this connection."""
    run = (db.query(PipelineRun)
             .filter(PipelineRun.conn_id == conn_id)
             .order_by(PipelineRun.id.desc())
             .first())
    if not run:
        return None
    return _run_to_out(run)


@router.get("/pipeline/{conn_id}/history", response_model=list[RunOut])
def get_history(conn_id: int, limit: int = 10, db: Session = Depends(get_db)):
    """Return the last N pipeline runs."""
    runs = (db.query(PipelineRun)
              .filter(PipelineRun.conn_id == conn_id)
              .order_by(PipelineRun.id.desc())
              .limit(limit)
              .all())
    return [_run_to_out(r) for r in runs]


@router.get("/pipeline/{conn_id}/schedule", response_model=ScheduleOut)
def get_schedule(conn_id: int, db: Session = Depends(get_db)):
    """Return schedule config for this connection."""
    s = db.query(PipelineSchedule).filter_by(conn_id=conn_id).first()
    if not s:
        return ScheduleOut(conn_id=conn_id)
    return _sched_to_out(s)


@router.get("/pipeline/{conn_id}/status")
def get_pipeline_status(conn_id: int, db: Session = Depends(get_db)):
    """Return current data counts for this connection (generated, validated, dispatched)."""
    tpl = (db.query(XmlTemplate).filter_by(conn_id=conn_id)
             .order_by(XmlTemplate.id.desc()).first())
    gq  = (db.query(GeneratedQuery).filter_by(conn_id=conn_id)
             .order_by(GeneratedQuery.id.desc()).first())
    mp  = (db.query(Mapping).filter_by(conn_id=conn_id, is_active=True)
             .order_by(Mapping.id.desc()).first())

    all_xml = db.query(GeneratedXml).filter_by(conn_id=conn_id).all()
    generated  = len(all_xml)
    val_pass   = sum(1 for x in all_xml if x.validation_status == "pass")
    val_fail   = sum(1 for x in all_xml if x.validation_status == "fail")

    dispatch_cfg = db.query(ApiDispatchConfig).filter_by(conn_id=conn_id).first()

    return {
        "has_template":     bool(tpl),
        "has_query":        bool(gq and gq.query_sql),
        "has_mapping":      bool(mp),
        "format_type":      (tpl.format_type or "xml") if tpl else None,
        "generated_count":  generated,
        "validated_pass":   val_pass,
        "validated_fail":   val_fail,
        "has_dispatch_cfg": bool(dispatch_cfg and (
            dispatch_cfg.endpoint_url or dispatch_cfg.sftp_host or dispatch_cfg.azure_conn_str_enc
        )),
    }


@router.put("/pipeline/{conn_id}/schedule", response_model=ScheduleOut)
def save_schedule(conn_id: int, body: ScheduleIn, db: Session = Depends(get_db)):
    """Save (upsert) schedule config."""
    s = db.query(PipelineSchedule).filter_by(conn_id=conn_id).first()
    if not s:
        s = PipelineSchedule(conn_id=conn_id)
        db.add(s)

    s.schedule_type    = body.schedule_type or "manual"
    s.interval_minutes = body.interval_minutes
    s.run_at_time      = body.run_at_time
    s.run_on_day       = body.run_on_day
    s.is_enabled       = body.is_enabled
    s.next_run_at      = _compute_next_run(s) if body.is_enabled and s.schedule_type != "manual" else None
    s.updated_at       = datetime.utcnow()
    db.commit()
    db.refresh(s)
    return _sched_to_out(s)
