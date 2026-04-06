"""
ps_workflows.py — Workflow CRUD, execution engine, scheduling, and email settings.

Endpoints:
  GET    /api/ps/workflows                          — list all workflows
  POST   /api/ps/workflows/from-conversation        — extract & create from PS chat
  POST   /api/ps/workflows                          — create manually
  GET    /api/ps/workflows/{wf_id}                  — get workflow + steps + last run
  PUT    /api/ps/workflows/{wf_id}                  — update name/description
  DELETE /api/ps/workflows/{wf_id}                  — soft delete (is_active=False)
  POST   /api/ps/workflows/{wf_id}/run              — run now (manual trigger)
  GET    /api/ps/workflows/{wf_id}/runs             — run history
  GET    /api/ps/workflows/{wf_id}/runs/{run_id}    — single run detail
  PUT    /api/ps/workflows/{wf_id}/schedule         — set/update schedule
  GET    /api/ps/email-settings                     — get SMTP settings
  PUT    /api/ps/email-settings                     — save SMTP settings
  POST   /api/ps/email-settings/test                — send test email
  POST   /api/ps/email/send                         — send email immediately (from chat)
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db, SessionLocal
from api.config import settings
from api.models import (
    PsConversation, PsMessage,
    PsWorkflow, PsWorkflowStep, PsWorkflowSchedule,
    PsWorkflowRun, PsWorkflowRunStep,
    PsEmailSettings, PsApiCollection, SourceConnection,
)

router = APIRouter()

# ── Pydantic schemas ──────────────────────────────────────────

class StepOut(BaseModel):
    id:          int
    step_order:  int
    step_type:   str
    label:       Optional[str] = None
    config_json: Optional[str] = None

class WorkflowOut(BaseModel):
    id:              int
    name:            str
    description:     Optional[str] = None
    conn_id:         Optional[int] = None
    conversation_id: Optional[int] = None
    is_active:       bool
    created_at:      Optional[str] = None
    steps:           list[StepOut] = []
    schedule:        Optional[dict] = None
    last_run:        Optional[dict] = None

class CreateFromConvReq(BaseModel):
    conversation_id: int
    name:            str
    description:     Optional[str] = None
    step_indices:    Optional[list[int]] = None   # which extracted steps to include (all if None)

class CreateWorkflowReq(BaseModel):
    name:            str
    description:     Optional[str] = None
    conn_id:         Optional[int] = None
    steps:           list[dict] = []              # [{step_type, label, config_json}]

class UpdateWorkflowReq(BaseModel):
    name:        Optional[str] = None
    description: Optional[str] = None

class UpdateStepReq(BaseModel):
    label:       Optional[str] = None
    config_json: Optional[str] = None

class ScheduleReq(BaseModel):
    schedule_type:    str = "manual"    # manual | interval | daily | weekly
    interval_minutes: Optional[int] = None
    run_at_time:      Optional[str]  = None   # HH:MM
    run_on_day:       Optional[int]  = None   # 0=Mon..6=Sun
    is_enabled:       bool = True

class EmailSettingsReq(BaseModel):
    smtp_host:    str
    smtp_port:    int  = 587
    smtp_user:    Optional[str] = None
    smtp_pass:    Optional[str] = None   # plaintext — encrypted before storing
    from_address: str
    use_tls:      bool = True

class SendEmailReq(BaseModel):
    to:      str
    subject: str
    body:    str

# ── Helpers ───────────────────────────────────────────────────

def _wf_out(wf: PsWorkflow) -> dict:
    sched = wf.schedules[0] if wf.schedules else None
    last_run = None
    if wf.runs:
        r = sorted(wf.runs, key=lambda x: x.started_at or datetime.min, reverse=True)[0]
        last_run = {
            "id": r.id,
            "status": r.status,
            "triggered_by": r.triggered_by,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        }
    return {
        "id": wf.id,
        "name": wf.name,
        "description": wf.description,
        "conn_id": wf.conn_id,
        "conversation_id": wf.conversation_id,
        "is_active": wf.is_active,
        "created_at": wf.created_at.isoformat() if wf.created_at else None,
        "steps": [{"id": s.id, "step_order": s.step_order, "step_type": s.step_type,
                   "label": s.label, "config_json": s.config_json} for s in wf.steps],
        "schedule": {
            "id": sched.id,
            "schedule_type": sched.schedule_type,
            "interval_minutes": sched.interval_minutes,
            "run_at_time": sched.run_at_time,
            "run_on_day": sched.run_on_day,
            "is_enabled": sched.is_enabled,
            "next_run_at": sched.next_run_at.isoformat() if sched.next_run_at else None,
            "last_run_at": sched.last_run_at.isoformat() if sched.last_run_at else None,
        } if sched else None,
        "last_run": last_run,
    }


def _extract_sql_from_text(text: str) -> str:
    """Extract SQL from a markdown code block or bare SELECT/INSERT/UPDATE/DELETE statement."""
    if not text:
        return ""
    # Try ```sql ... ``` or ``` ... ``` blocks
    m = re.search(r"```(?:sql)?\s*([\s\S]+?)```", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # Try bare SQL keyword at start of a line
    m = re.search(r"(?:^|\n)((?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|DROP|ALTER)\b[\s\S]+?)(?:\n\n|$)", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return ""


def _extract_steps_from_conversation(conv_id: int, db: Session) -> list[dict]:
    """Pull executable tool calls from a PS conversation."""
    EXECUTABLE = {"execute_sql", "execute_api", "execute_api_bulk", "preview_email"}
    # Load all messages ordered by id so we can look back at assistant messages
    all_msgs = (db.query(PsMessage)
                  .filter_by(conversation_id=conv_id)
                  .order_by(PsMessage.id)
                  .all())
    steps = []
    for idx, m in enumerate(all_msgs):
        if m.role != "tool" or m.tool_name not in EXECUTABLE:
            continue
        try:
            inp = json.loads(m.tool_input_json or "{}")
        except Exception:
            inp = {}

        # Fallback: if execute_sql has no sql in inp, scan preceding assistant message
        if m.tool_name == "execute_sql" and not inp.get("sql"):
            for prev in reversed(all_msgs[:idx]):
                if prev.role == "assistant" and prev.content:
                    sql = _extract_sql_from_text(prev.content)
                    if sql:
                        inp = {"sql": sql}
                        break

        if m.tool_name == "execute_sql":
            step_type = "sql"
        elif m.tool_name == "execute_api":
            step_type = "api"
        elif m.tool_name == "execute_api_bulk":
            step_type = "api_loop"
        else:
            step_type = "email"
        # Build a readable label
        if step_type == "sql":
            sql_preview = (inp.get("sql") or "")[:80].replace("\n", " ")
            label = f"SQL: {sql_preview}…" if len(inp.get("sql","")) > 80 else f"SQL: {inp.get('sql','')}"
        elif step_type == "api":
            label = f"API #{inp.get('api_id','?')}: {json.dumps(inp.get('payload',{}))[:60]}"
        elif step_type == "api_loop":
            sql_prev = (inp.get("sql") or "")[:60].replace("\n", " ")
            label = f"Bulk API #{inp.get('api_id','?')} loop: {sql_prev}"
        else:
            label = f"Email → {inp.get('to','?')}: {inp.get('subject','')}"

        steps.append({
            "step_type":   step_type,
            "label":       label,
            "config_json": json.dumps(inp),
        })
    return steps


def _compute_next_run(sched: PsWorkflowSchedule, now: datetime) -> datetime | None:
    if sched.schedule_type == "interval" and sched.interval_minutes:
        return now + timedelta(minutes=sched.interval_minutes)
    if sched.schedule_type in ("daily", "weekly"):
        t = sched.run_at_time or "09:00"
        h, m = (int(x) for x in t.split(":"))
        candidate = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if sched.schedule_type == "daily":
            if candidate <= now:
                candidate += timedelta(days=1)
            return candidate
        # weekly
        day = sched.run_on_day if sched.run_on_day is not None else 0
        days_ahead = (day - now.weekday()) % 7
        if days_ahead == 0 and candidate <= now:
            days_ahead = 7
        return candidate + timedelta(days=days_ahead)
    return None


def _run_workflow_db(workflow_id: int, db: Session, triggered_by: str = "manual") -> PsWorkflowRun:
    """Execute workflow steps and record results. Called from endpoint or scheduler."""
    from api.routers.connections import _to_cfg_from_model
    from api.services.connector import preview_data, _clean_error

    wf = db.query(PsWorkflow).filter_by(id=workflow_id, is_active=True).first()
    if not wf:
        raise ValueError(f"Workflow {workflow_id} not found.")

    run = PsWorkflowRun(workflow_id=workflow_id, triggered_by=triggered_by,
                        status="running", started_at=datetime.utcnow())
    db.add(run)
    db.flush()

    all_ok = True
    last_sql_result = None   # pass SQL output to subsequent email steps

    for step in wf.steps:
        sr = PsWorkflowRunStep(
            run_id=run.id, step_id=step.id,
            step_order=step.step_order,
            step_type=step.step_type,
            label=step.label,
            status="running",
        )
        db.add(sr)
        db.flush()

        try:
            cfg = json.loads(step.config_json or "{}")

            if step.step_type == "sql":
                conn_id = cfg.get("conn_id") or wf.conn_id
                if not conn_id:
                    raise ValueError("No conn_id for SQL step.")
                src = db.query(SourceConnection).filter_by(id=conn_id).first()
                if not src:
                    raise ValueError(f"Source connection {conn_id} not found.")
                c = _to_cfg_from_model(src)
                c["query"] = cfg.get("sql", "")
                result = preview_data(c, limit=500)
                last_sql_result = result
                sr.output_json = json.dumps({
                    "columns": result.get("columns", []),
                    "rows":    result.get("rows", [])[:50],
                    "total":   result.get("total", 0),
                })[:50000]
                sr.status = "success"

            elif step.step_type == "api":
                api_id = cfg.get("api_id")
                payload = cfg.get("payload", {})
                if not api_id:
                    raise ValueError("No api_id for API step.")
                api_entry = db.query(PsApiCollection).filter_by(id=api_id, is_active=True).first()
                if not api_entry:
                    raise ValueError(f"API #{api_id} not found in collection.")
                import httpx
                from api.services.encryption import decrypt
                headers = {}
                try:
                    headers = json.loads(api_entry.headers_json or "{}")
                except Exception:
                    pass
                if api_entry.auth_type == "bearer" and api_entry.auth_value_enc:
                    try:
                        token = decrypt(api_entry.auth_value_enc)
                        headers["Authorization"] = f"Bearer {token}"
                    except Exception:
                        pass
                elif api_entry.auth_type == "basic" and api_entry.auth_value_enc:
                    try:
                        creds = decrypt(api_entry.auth_value_enc)
                        import base64
                        headers["Authorization"] = "Basic " + base64.b64encode(creds.encode()).decode()
                    except Exception:
                        pass
                body_str = api_entry.body_template or ""
                for k, v in payload.items():
                    body_str = body_str.replace(f"{{{{{k}}}}}", str(v))
                resp = httpx.request(
                    method=api_entry.method,
                    url=api_entry.url,
                    headers=headers,
                    content=body_str.encode() if body_str else None,
                    timeout=30,
                )
                resp_body = resp.text[:5000]
                sr.output_json = json.dumps({"status_code": resp.status_code, "body": resp_body})[:50000]
                sr.status = "success" if resp.status_code < 400 else "failed"
                if sr.status == "failed":
                    raise ValueError(f"API returned HTTP {resp.status_code}")

            elif step.step_type == "api_loop":
                # Bulk API: run SQL to get rows, call API once per row
                api_id   = cfg.get("api_id")
                loop_sql = cfg.get("sql", "")
                tmpl     = cfg.get("payload_template", {})
                loop_conn_id = cfg.get("conn_id") or wf.conn_id
                if not api_id:
                    raise ValueError("No api_id for api_loop step.")
                if not loop_sql:
                    raise ValueError("No sql for api_loop step.")
                if not loop_conn_id:
                    raise ValueError("No conn_id for api_loop step.")
                src = db.query(SourceConnection).filter_by(id=loop_conn_id).first()
                if not src:
                    raise ValueError(f"Source connection {loop_conn_id} not found.")
                c = _to_cfg_from_model(src)
                c["query"] = loop_sql
                rows_result = preview_data(c, limit=500)
                rows    = rows_result.get("rows", [])
                columns = rows_result.get("columns", [])
                api_entry = db.query(PsApiCollection).filter_by(id=api_id, is_active=True).first()
                if not api_entry:
                    raise ValueError(f"API #{api_id} not found.")
                import httpx as _httpx
                from api.services.encryption import decrypt as _decrypt
                import base64 as _b64
                _headers: dict = {}
                try:
                    _headers = json.loads(api_entry.headers_json or "{}")
                except Exception:
                    pass
                if api_entry.auth_type == "bearer" and api_entry.auth_value_enc:
                    try:
                        _headers["Authorization"] = "Bearer " + _decrypt(api_entry.auth_value_enc)
                    except Exception:
                        pass
                elif api_entry.auth_type == "basic" and api_entry.auth_value_enc:
                    try:
                        _headers["Authorization"] = "Basic " + _b64.b64encode(_decrypt(api_entry.auth_value_enc).encode()).decode()
                    except Exception:
                        pass
                succeeded, failed, loop_results = 0, 0, []
                for row_data in rows:
                    row_payload = {}
                    for pf, sc_col in tmpl.items():
                        if isinstance(row_data, dict):
                            row_payload[pf] = row_data.get(sc_col, "")
                        elif isinstance(row_data, list) and sc_col in columns:
                            row_payload[pf] = row_data[columns.index(sc_col)]
                    body_str = api_entry.body_template or ""
                    for k, v in row_payload.items():
                        body_str = body_str.replace(f"{{{{{k}}}}}", str(v))
                    try:
                        body_payload = json.loads(body_str) if body_str and "{{" not in body_str else row_payload
                    except Exception:
                        body_payload = row_payload
                    try:
                        resp = _httpx.request(
                            method=api_entry.method, url=api_entry.url,
                            headers=_headers,
                            json=body_payload if isinstance(body_payload, dict) else None,
                            content=body_payload if isinstance(body_payload, str) else None,
                            timeout=30,
                        )
                        ok = resp.status_code < 400
                    except Exception as exc:
                        ok = False
                        loop_results.append({"payload": row_payload, "error": str(exc)})
                        failed += 1
                        continue
                    if ok: succeeded += 1
                    else:  failed += 1
                    loop_results.append({"payload": row_payload, "status_code": resp.status_code})
                sr.output_json = json.dumps({
                    "total": len(rows), "succeeded": succeeded, "failed": failed,
                    "results": loop_results[:20],
                })[:50000]
                sr.status = "success" if failed == 0 else ("partial" if succeeded > 0 else "failed")
                if failed > 0 and succeeded == 0:
                    raise ValueError(f"All {len(rows)} API calls failed.")
                last_sql_result = rows_result

            elif step.step_type == "email":
                em = db.query(PsEmailSettings).filter_by(is_active=True).order_by(PsEmailSettings.id.desc()).first()
                if not em:
                    raise ValueError("No email settings configured. Set up SMTP in the Workflows tab.")
                from api.services.encryption import decrypt
                smtp_pass = None
                if em.smtp_pass_enc:
                    try:
                        smtp_pass = decrypt(em.smtp_pass_enc)
                    except Exception:
                        pass
                body = cfg.get("body", "")
                # Inject last SQL result if placeholder present
                if "{{sql_results}}" in body and last_sql_result:
                    rows = last_sql_result.get("rows", [])
                    cols = last_sql_result.get("columns", [])
                    table_html = "<table border='1' cellpadding='4'><tr>" + "".join(f"<th>{c}</th>" for c in cols) + "</tr>"
                    for row in rows[:20]:
                        table_html += "<tr>" + "".join(f"<td>{row.get(c,'')}</td>" for c in cols) + "</tr>"
                    table_html += "</table>"
                    body = body.replace("{{sql_results}}", table_html)
                from api.services.ps_email import send_email
                send_email(
                    smtp_host=em.smtp_host, smtp_port=em.smtp_port,
                    smtp_user=em.smtp_user, smtp_pass=smtp_pass,
                    from_address=em.from_address,
                    to=cfg.get("to", ""), subject=cfg.get("subject", ""),
                    body=body, use_tls=em.use_tls,
                )
                sr.output_json = json.dumps({"sent_to": cfg.get("to"), "subject": cfg.get("subject")})
                sr.status = "success"

        except Exception as exc:
            sr.status = "failed"
            sr.error_message = str(exc)[:2000]
            all_ok = False

        sr.executed_at = datetime.utcnow()

    run.status = "success" if all_ok else ("failed" if not any(
        s.status == "success" for s in run.step_runs) else "partial")
    run.finished_at = datetime.utcnow()
    run.summary_json = json.dumps({
        "steps": [{"label": s.label, "status": s.status} for s in run.step_runs]
    })
    db.commit()
    return run


# ── Scheduler (background thread) ────────────────────────────

_scheduler_started = False

def _scheduler_loop():
    while True:
        try:
            _check_due_schedules()
        except Exception:
            pass
        time.sleep(60)


def _check_due_schedules():
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        due = (db.query(PsWorkflowSchedule)
                 .filter(
                     PsWorkflowSchedule.is_enabled == True,
                     PsWorkflowSchedule.schedule_type != "manual",
                     PsWorkflowSchedule.next_run_at != None,
                     PsWorkflowSchedule.next_run_at <= now,
                 )
                 .all())
        for sched in due:
            try:
                _run_workflow_db(sched.workflow_id, db, triggered_by="schedule")
            except Exception:
                pass
            sched.last_run_at = now
            sched.next_run_at = _compute_next_run(sched, now)
        if due:
            db.commit()
    finally:
        db.close()


def start_scheduler():
    global _scheduler_started
    if not _scheduler_started:
        _scheduler_started = True
        t = threading.Thread(target=_scheduler_loop, daemon=True)
        t.start()


# ── Endpoints ─────────────────────────────────────────────────

@router.get("/ps/workflows", tags=["ps-workflows"])
def list_workflows(conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    if conn_id is None:
        return []
    q = db.query(PsWorkflow).filter(PsWorkflow.is_active == True, PsWorkflow.conn_id == conn_id)
    wfs = q.order_by(PsWorkflow.id.desc()).all()
    return [_wf_out(w) for w in wfs]


@router.post("/ps/workflows/from-conversation", tags=["ps-workflows"])
def create_from_conversation(req: CreateFromConvReq, db: Session = Depends(get_db)):
    conv = db.query(PsConversation).filter_by(id=req.conversation_id).first()
    if not conv:
        raise HTTPException(404, "Conversation not found.")
    all_steps = _extract_steps_from_conversation(req.conversation_id, db)
    if not all_steps:
        raise HTTPException(422, "No executable actions (SQL / API / email) found in this conversation.")
    # Filter by selected indices if provided
    if req.step_indices is not None:
        steps = [all_steps[i] for i in req.step_indices if 0 <= i < len(all_steps)]
    else:
        steps = all_steps

    wf = PsWorkflow(
        name=req.name,
        description=req.description,
        conn_id=conv.conn_id,
        conversation_id=req.conversation_id,
        is_active=True,
    )
    db.add(wf)
    db.flush()
    for i, s in enumerate(steps):
        db.add(PsWorkflowStep(
            workflow_id=wf.id,
            step_order=i,
            step_type=s["step_type"],
            label=s["label"],
            config_json=s["config_json"],
        ))
    # Default manual schedule
    db.add(PsWorkflowSchedule(workflow_id=wf.id, schedule_type="manual", is_enabled=False))
    db.commit()
    db.refresh(wf)
    return _wf_out(wf)


@router.get("/ps/workflows/extract-steps", tags=["ps-workflows"])
def extract_steps(conversation_id: int, db: Session = Depends(get_db)):
    """Preview extractable steps without creating a workflow."""
    steps = _extract_steps_from_conversation(conversation_id, db)
    return {"steps": steps, "count": len(steps)}


@router.get("/ps/workflows/{wf_id}", tags=["ps-workflows"])
def get_workflow(wf_id: int, db: Session = Depends(get_db)):
    wf = db.query(PsWorkflow).filter_by(id=wf_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found.")
    return _wf_out(wf)


@router.put("/ps/workflows/{wf_id}", tags=["ps-workflows"])
def update_workflow(wf_id: int, req: UpdateWorkflowReq, db: Session = Depends(get_db)):
    wf = db.query(PsWorkflow).filter_by(id=wf_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found.")
    if req.name is not None:
        wf.name = req.name
    if req.description is not None:
        wf.description = req.description
    db.commit()
    return _wf_out(wf)


@router.delete("/ps/workflows/{wf_id}", tags=["ps-workflows"])
def delete_workflow(wf_id: int, db: Session = Depends(get_db)):
    wf = db.query(PsWorkflow).filter_by(id=wf_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found.")
    wf.is_active = False
    db.commit()
    return {"deleted": wf_id}


@router.post("/ps/workflows/{wf_id}/clone", tags=["ps-workflows"])
def clone_workflow(wf_id: int, db: Session = Depends(get_db)):
    """Duplicate a workflow with all its steps and a fresh manual schedule."""
    wf = db.query(PsWorkflow).filter_by(id=wf_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found.")
    new_wf = PsWorkflow(
        name=f"{wf.name} (copy)",
        description=wf.description,
        conn_id=wf.conn_id,
        conversation_id=wf.conversation_id,
        is_active=True,
    )
    db.add(new_wf)
    db.flush()
    for s in sorted(wf.steps, key=lambda x: x.step_order):
        db.add(PsWorkflowStep(
            workflow_id=new_wf.id,
            step_order=s.step_order,
            step_type=s.step_type,
            label=s.label,
            config_json=s.config_json,
        ))
    db.add(PsWorkflowSchedule(workflow_id=new_wf.id, schedule_type="manual", is_enabled=False))
    db.commit()
    db.refresh(new_wf)
    return _wf_out(new_wf)


@router.put("/ps/workflows/{wf_id}/steps/{step_id}", tags=["ps-workflows"])
def update_step(wf_id: int, step_id: int, req: UpdateStepReq, db: Session = Depends(get_db)):
    """Update a single workflow step's label and config."""
    step = db.query(PsWorkflowStep).filter_by(id=step_id, workflow_id=wf_id).first()
    if not step:
        raise HTTPException(404, "Step not found.")
    if req.label is not None:
        step.label = req.label
    if req.config_json is not None:
        step.config_json = req.config_json
    db.commit()
    return {"id": step.id, "step_order": step.step_order, "step_type": step.step_type,
            "label": step.label, "config_json": step.config_json}


@router.post("/ps/workflows/{wf_id}/run", tags=["ps-workflows"])
def run_workflow(wf_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    wf = db.query(PsWorkflow).filter_by(id=wf_id, is_active=True).first()
    if not wf:
        raise HTTPException(404, "Workflow not found.")
    # Run synchronously (small workflows) — for larger ones could use background
    run = _run_workflow_db(wf_id, db, triggered_by="manual")
    return {
        "run_id": run.id,
        "status": run.status,
        "steps": [{"label": s.label, "status": s.status, "error": s.error_message}
                  for s in sorted(run.step_runs, key=lambda x: x.step_order)],
    }


@router.get("/ps/workflows/{wf_id}/runs", tags=["ps-workflows"])
def get_runs(wf_id: int, limit: int = 20, db: Session = Depends(get_db)):
    runs = (db.query(PsWorkflowRun)
              .filter_by(workflow_id=wf_id)
              .order_by(PsWorkflowRun.id.desc())
              .limit(limit)
              .all())
    return [{
        "id": r.id,
        "status": r.status,
        "triggered_by": r.triggered_by,
        "started_at":  r.started_at.isoformat()  if r.started_at  else None,
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        "steps": [{"label": s.label, "status": s.status,
                   "output_json": s.output_json, "error": s.error_message}
                  for s in sorted(r.step_runs, key=lambda x: x.step_order)],
    } for r in runs]


@router.put("/ps/workflows/{wf_id}/schedule", tags=["ps-workflows"])
def set_schedule(wf_id: int, req: ScheduleReq, db: Session = Depends(get_db)):
    wf = db.query(PsWorkflow).filter_by(id=wf_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found.")
    sched = db.query(PsWorkflowSchedule).filter_by(workflow_id=wf_id).first()
    if not sched:
        sched = PsWorkflowSchedule(workflow_id=wf_id)
        db.add(sched)
    sched.schedule_type    = req.schedule_type
    sched.interval_minutes = req.interval_minutes
    sched.run_at_time      = req.run_at_time
    sched.run_on_day       = req.run_on_day
    sched.is_enabled       = req.is_enabled
    now = datetime.utcnow()
    sched.next_run_at = _compute_next_run(sched, now) if req.is_enabled and req.schedule_type != "manual" else None
    db.commit()
    return {"ok": True, "next_run_at": sched.next_run_at.isoformat() if sched.next_run_at else None}


# ── Email Settings ─────────────────────────────────────────────

@router.get("/ps/email-settings", tags=["ps-workflows"])
def get_email_settings(db: Session = Depends(get_db)):
    em = db.query(PsEmailSettings).filter_by(is_active=True).order_by(PsEmailSettings.id.desc()).first()
    if not em:
        return {}
    return {
        "id":           em.id,
        "smtp_host":    em.smtp_host,
        "smtp_port":    em.smtp_port,
        "smtp_user":    em.smtp_user,
        "from_address": em.from_address,
        "use_tls":      em.use_tls,
        "has_password": bool(em.smtp_pass_enc),
    }


@router.put("/ps/email-settings", tags=["ps-workflows"])
def save_email_settings(req: EmailSettingsReq, db: Session = Depends(get_db)):
    from api.services.encryption import encrypt
    em = db.query(PsEmailSettings).filter_by(is_active=True).order_by(PsEmailSettings.id.desc()).first()
    if not em:
        em = PsEmailSettings()
        db.add(em)
    em.smtp_host    = req.smtp_host
    em.smtp_port    = req.smtp_port
    em.smtp_user    = req.smtp_user
    em.from_address = req.from_address
    em.use_tls      = req.use_tls
    if req.smtp_pass:
        em.smtp_pass_enc = encrypt(req.smtp_pass)
    db.commit()
    return {"ok": True}


@router.post("/ps/email-settings/test", tags=["ps-workflows"])
def test_email(req: SendEmailReq, db: Session = Depends(get_db)):
    em = db.query(PsEmailSettings).filter_by(is_active=True).order_by(PsEmailSettings.id.desc()).first()
    if not em:
        raise HTTPException(400, "No email settings saved yet.")
    from api.services.encryption import decrypt
    from api.services.ps_email import send_email
    smtp_pass = None
    if em.smtp_pass_enc:
        try:
            smtp_pass = decrypt(em.smtp_pass_enc)
        except Exception:
            pass
    try:
        send_email(em.smtp_host, em.smtp_port, em.smtp_user, smtp_pass,
                   em.from_address, req.to, req.subject, req.body, em.use_tls)
    except Exception as exc:
        raise HTTPException(400, detail=f"Email failed: {exc}")
    return {"ok": True, "to": req.to}


@router.post("/ps/email/send", tags=["ps-workflows"])
def send_email_from_chat(req: SendEmailReq, db: Session = Depends(get_db)):
    """Send an email directly from the PS chat panel (when user clicks Send on preview card)."""
    em = db.query(PsEmailSettings).filter_by(is_active=True).order_by(PsEmailSettings.id.desc()).first()
    if not em:
        raise HTTPException(400, "No email settings configured. Set up SMTP in the Workflows tab first.")
    from api.services.encryption import decrypt
    from api.services.ps_email import send_email
    smtp_pass = None
    if em.smtp_pass_enc:
        try:
            smtp_pass = decrypt(em.smtp_pass_enc)
        except Exception:
            pass
    try:
        send_email(em.smtp_host, em.smtp_port, em.smtp_user, smtp_pass,
                   em.from_address, req.to, req.subject, req.body, em.use_tls)
    except Exception as exc:
        raise HTTPException(400, detail=f"Email send failed: {exc}")
    return {"ok": True, "to": req.to, "subject": req.subject}
