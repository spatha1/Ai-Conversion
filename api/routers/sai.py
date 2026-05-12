"""
sai.py — SAI Ops router.
Endpoints: POST /sai/run (SSE), POST /sai/event, GET /sai/runs,
           GET /sai/runs/{id}, POST /sai/runs/{id}/approve,
           GET /sai/config/{project_id}, PUT /sai/config/{project_id},
           GET /sai/memory/{project_id}, GET /sai/approval-queue
"""
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import (
    SaiRun, SaiStep, SaiFinding, SaiEvent,
    SaiConfig, SaiOperationalMemory, SaiApprovalQueue,
)
from api.services.sai import orchestrator

router = APIRouter(prefix="/sai", tags=["sai-ops"])


def _safe_json(text: str | None, default):
    if not text:
        return default
    try:
        return json.loads(text)
    except Exception:
        return default


# ── Request schemas ──────────────────────────────────────────────

class RunRequest(BaseModel):
    request_text: str
    project_id:   Optional[int] = None
    conn_ids:     Optional[list[int]] = None
    mode:         str = "manual"   # manual|assisted|autonomous


class EventRequest(BaseModel):
    event_type:    str
    source_system: Optional[str] = None
    payload_json:  Optional[str] = None
    project_id:    Optional[int] = None


class ConfigUpdate(BaseModel):
    mode:                 str
    allowed_actions_json: Optional[str] = None


class ApproveRequest(BaseModel):
    approval_id: int
    decision:    str   # approved|rejected
    approver:    Optional[str] = None


# ── POST /sai/run (SSE streaming) ────────────────────────────────

@router.post("/run")
async def sai_run(req: RunRequest, db: Session = Depends(get_db)):
    mode = req.mode if req.mode in ("manual", "assisted", "autonomous") else "manual"

    # Create SaiRun row
    run_row = SaiRun(
        project_id=req.project_id,
        request_text=req.request_text,
        event_type="manual",
        mode=mode,
        status="running",
        conn_ids_json=json.dumps(req.conn_ids) if req.conn_ids else None,
    )
    db.add(run_row)
    db.commit()
    db.refresh(run_row)
    run_id = run_row.id

    async def event_stream():
        async for event in orchestrator.run_pipeline(
            run_id=run_id,
            request_text=req.request_text,
            project_id=req.project_id,
            conn_ids=req.conn_ids,
            mode=mode,
            db=db,
        ):
            yield event

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── POST /sai/event (event-driven trigger) ────────────────────────

@router.post("/event")
def ingest_event(req: EventRequest, db: Session = Depends(get_db)):
    mode = "autonomous"  # event-driven runs are autonomous by default
    try:
        cfg = db.query(SaiConfig).filter(SaiConfig.project_id == req.project_id).first()
        if cfg:
            mode = cfg.mode
    except Exception:
        pass

    run_row = SaiRun(
        project_id=req.project_id,
        request_text=f"[Event] {req.event_type}: {req.source_system or 'Unknown source'}",
        event_type=req.event_type,
        mode=mode,
        status="queued",
    )
    db.add(run_row)
    db.flush()

    event_row = SaiEvent(
        project_id=req.project_id,
        event_type=req.event_type,
        source_system=req.source_system,
        payload_json=req.payload_json,
        triggered_run_id=run_row.id,
    )
    db.add(event_row)
    db.commit()

    return {"run_id": run_row.id, "mode": mode, "status": "queued"}


# ── GET /sai/runs ─────────────────────────────────────────────────

@router.get("/runs")
def list_runs(
    project_id: Optional[int] = None,
    status:     Optional[str] = None,
    limit:      int = 50,
    db: Session = Depends(get_db),
):
    q = db.query(SaiRun)
    if project_id:
        q = q.filter(SaiRun.project_id == project_id)
    if status:
        q = q.filter(SaiRun.status == status)
    runs = q.order_by(SaiRun.id.desc()).limit(limit).all()
    return [
        {
            "id":              r.id,
            "project_id":      r.project_id,
            "request_text":    r.request_text[:200],
            "mode":            r.mode,
            "status":          r.status,
            "event_type":      r.event_type,
            "started_at":      r.started_at.isoformat() if r.started_at else None,
            "completed_at":    r.completed_at.isoformat() if r.completed_at else None,
            "findings_count":  len(_safe_json(r.findings_json, [])),
        }
        for r in runs
    ]


# ── GET /sai/runs/{id} ────────────────────────────────────────────

@router.get("/runs/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.query(SaiRun).filter(SaiRun.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")

    steps = db.query(SaiStep).filter(SaiStep.run_id == run_id).order_by(SaiStep.step_number).all()
    findings = db.query(SaiFinding).filter(SaiFinding.run_id == run_id).all()
    approvals = db.query(SaiApprovalQueue).filter(SaiApprovalQueue.run_id == run_id).all()

    return {
        "id":              run.id,
        "project_id":      run.project_id,
        "request_text":    run.request_text,
        "mode":            run.mode,
        "status":          run.status,
        "event_type":      run.event_type,
        "started_at":      run.started_at.isoformat() if run.started_at else None,
        "completed_at":    run.completed_at.isoformat() if run.completed_at else None,
        "report":          _safe_json(run.report_json, {}),
        "findings":        _safe_json(run.findings_json, []),
        "actions_taken":   _safe_json(run.actions_taken_json, []),
        "knowledge_sources": _safe_json(run.knowledge_sources_json, []),
        "steps": [
            {
                "step_number": s.step_number,
                "agent_name":  s.agent_name,
                "status":      s.status,
                "elapsed_ms":  s.elapsed_ms,
                "output":      _safe_json(s.output_json, {}),
                "knowledge_sources": _safe_json(s.knowledge_sources_json, []),
            }
            for s in steps
        ],
        "db_findings": [
            {
                "id":             f.id,
                "issue_type":     f.issue_type,
                "severity":       f.severity,
                "system_impacted": f.system_impacted,
                "description":    f.description,
                "owner_team":     f.owner_team,
                "action_status":  f.action_status,
            }
            for f in findings
        ],
        "approval_queue": [
            {
                "id":          a.id,
                "action_type": a.action_type,
                "status":      a.status,
                "payload":     _safe_json(a.action_payload_json, {}),
                "created_at":  a.created_at.isoformat() if a.created_at else None,
            }
            for a in approvals
        ],
    }


# ── POST /sai/runs/{id}/approve ───────────────────────────────────

@router.post("/runs/{run_id}/approve")
def approve_action(run_id: int, req: ApproveRequest, db: Session = Depends(get_db)):
    item = db.query(SaiApprovalQueue).filter(
        SaiApprovalQueue.id == req.approval_id,
        SaiApprovalQueue.run_id == run_id,
    ).first()
    if not item:
        raise HTTPException(404, "Approval item not found")
    if item.status != "pending":
        raise HTTPException(400, f"Already decided: {item.status}")

    item.status = req.decision
    item.approver = req.approver
    item.decided_at = datetime.now(timezone.utc)
    db.commit()

    dispatched_action = None
    if req.decision == "approved":
        dispatched_action = _execute_approved_action(item)
        if dispatched_action:
            item.status = "dispatched"
            db.commit()

    return {
        "id":                item.id,
        "status":            item.status,
        "approver":          item.approver,
        "dispatched_action": dispatched_action,
    }


def _execute_approved_action(item: "SaiApprovalQueue") -> dict | None:
    """Stub execution for approved actions. Returns action dict for green chip display."""
    try:
        payload = json.loads(item.action_payload_json or "{}")
    except Exception:
        payload = {}

    action_type = item.action_type or ""

    if action_type == "send_email":
        return {
            "type":   "email_sent",
            "detail": payload.get("to", "team"),
            "status": "dispatched",
        }
    if action_type == "create_ticket":
        return {
            "type":   "ticket_created",
            "detail": payload.get("title", "ticket"),
            "status": "dispatched",
        }
    if action_type == "remediation_workflow":
        return {
            "type":   "remediation_workflow",
            "detail": payload.get("ps_module") or payload.get("issue_type", "workflow"),
            "status": "dispatched",
        }
    return None


# ── GET /sai/runs/{id}/traces ─────────────────────────────────────

@router.get("/runs/{run_id}/traces")
def get_run_traces(run_id: int, db: Session = Depends(get_db)):
    from api.models import AITraceLog
    run = db.query(SaiRun).filter(SaiRun.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")

    # Primary: sai_run_id column (runs after the column was added)
    traces = db.query(AITraceLog).filter(
        AITraceLog.sai_run_id == run_id,
    ).order_by(AITraceLog.id).all()

    # Fallback: time-range match for older runs without sai_run_id
    if not traces and run.started_at and run.completed_at:
        traces = db.query(AITraceLog).filter(
            AITraceLog.module.in_([
                "sai_schema", "sai_data_collection", "sai_rca",
                "sai_classifier", "sai_ownership", "sai_report",
            ]),
            AITraceLog.created_at >= run.started_at,
            AITraceLog.created_at <= run.completed_at,
        ).order_by(AITraceLog.id).all()
    return [
        {
            "id":            t.id,
            "module":        t.module,
            "model":         t.model,
            "prompt_text":   t.prompt_text,
            "response_text": t.response_text,
            "tokens_in":     t.tokens_in,
            "tokens_out":    t.tokens_out,
            "latency_ms":    t.latency_ms,
            "created_at":    t.created_at.isoformat() if t.created_at else None,
        }
        for t in traces
    ]


# ── GET /sai/approval-queue ───────────────────────────────────────

@router.get("/approval-queue")
def list_approvals(
    project_id: Optional[int] = None,
    status:     str = "pending",
    db: Session = Depends(get_db),
):
    q = db.query(SaiApprovalQueue).filter(SaiApprovalQueue.status == status)
    if project_id:
        q = q.join(SaiRun).filter(SaiRun.project_id == project_id)
    items = q.order_by(SaiApprovalQueue.created_at.desc()).limit(100).all()
    return [
        {
            "id":          a.id,
            "run_id":      a.run_id,
            "action_type": a.action_type,
            "status":      a.status,
            "payload":     json.loads(a.action_payload_json or "{}"),
            "created_at":  a.created_at.isoformat() if a.created_at else None,
        }
        for a in items
    ]


# ── GET/PUT /sai/config/{project_id} ─────────────────────────────

@router.get("/config/{project_id}")
def get_config(project_id: int, db: Session = Depends(get_db)):
    cfg = db.query(SaiConfig).filter(SaiConfig.project_id == project_id).first()
    if not cfg:
        return {"project_id": project_id, "mode": "manual", "allowed_actions": {"email": True, "ticket": True, "etl_retry": False}}
    return {
        "project_id":      cfg.project_id,
        "mode":            cfg.mode,
        "allowed_actions": json.loads(cfg.allowed_actions_json or "{}"),
        "updated_at":      cfg.updated_at.isoformat() if cfg.updated_at else None,
    }


@router.put("/config/{project_id}")
def update_config(project_id: int, req: ConfigUpdate, db: Session = Depends(get_db)):
    cfg = db.query(SaiConfig).filter(SaiConfig.project_id == project_id).first()
    if cfg:
        cfg.mode = req.mode
        if req.allowed_actions_json:
            cfg.allowed_actions_json = req.allowed_actions_json
    else:
        cfg = SaiConfig(
            project_id=project_id,
            mode=req.mode,
            allowed_actions_json=req.allowed_actions_json,
        )
        db.add(cfg)
    db.commit()
    return {"project_id": project_id, "mode": cfg.mode}


# ── GET /sai/memory/{project_id} ─────────────────────────────────

@router.get("/memory/{project_id}")
def get_memory(project_id: int, limit: int = 50, db: Session = Depends(get_db)):
    memories = db.query(SaiOperationalMemory).filter(
        SaiOperationalMemory.project_id == project_id
    ).order_by(SaiOperationalMemory.frequency.desc()).limit(limit).all()
    return [
        {
            "id":                  m.id,
            "issue_type":          m.issue_type,
            "system_impacted":     m.system_impacted,
            "description_summary": m.description_summary,
            "frequency":           m.frequency,
            "last_seen_at":        m.last_seen_at.isoformat() if m.last_seen_at else None,
            "has_fix":             bool(m.successful_fix_json),
        }
        for m in memories
    ]
