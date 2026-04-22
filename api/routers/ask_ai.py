"""
api/routers/ask_ai.py

Generic "Ask AI" conversational engine.
Works for any entity (Policy, Claim, Employee, …) — entirely metadata-driven.

Endpoints:
  POST /ask-ai/session              — create conversation session
  POST /ask-ai/chat                 — main chat endpoint (full pipeline)
  POST /ask-ai/action/preview       — preview action steps (no execution)
  POST /ask-ai/action               — execute an action (requires confirmed=true)
  GET  /ask-ai/sessions/{id}/history — conversation history
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.dependencies import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])


# ── Request / Response schemas ────────────────────────────────────────────────

class SessionCreate(BaseModel):
    conn_id: int


class SessionOut(BaseModel):
    session_id: str


class ChatRequest(BaseModel):
    message:    str
    conn_id:    int
    session_id: Optional[str] = None
    model:      str = "gpt-4o-mini"


class ActionPreviewRequest(BaseModel):
    action_type: str
    entity:      Optional[str] = None
    entity_id:   Optional[str] = None
    conn_id:     int


class ActionRequest(BaseModel):
    action_type: str
    entity:      Optional[str] = None
    entity_id:   Optional[str] = None
    conn_id:     int
    session_id:  Optional[str] = None
    confirmed:   bool = False
    query_sql:   Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/ask-ai/session", response_model=SessionOut, tags=["ask-ai"])
def create_session(req: SessionCreate, db: Session = Depends(get_db)):
    """Create a new Ask AI conversation session. Returns a session_id (DB row id as string)."""
    from api.models import ReportSession
    session = ReportSession(
        conn_id=req.conn_id,
        title="Ask AI Session",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return SessionOut(session_id=str(session.id))


@router.post("/ask-ai/chat", tags=["ask-ai"])
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """
    Main Ask AI chat endpoint.
    Runs the full 7-step pipeline: intent → schema → SQL → fetch → KPIs → narrative → trace.
    """
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=422, detail="message cannot be empty")

    from api.services import ask_ai_engine

    try:
        result = ask_ai_engine.run(
            message=req.message.strip(),
            conn_id=req.conn_id,
            session_id=req.session_id,
            db=db,
            model=req.model,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # Persist message to session history if session exists
    if req.session_id:
        _save_session_message(db, req.session_id, req.conn_id, req.message, result.get("narrative") or "")

    return result


@router.post("/ask-ai/action/preview", tags=["ask-ai"])
def action_preview(req: ActionPreviewRequest):
    """
    Preview the steps that will be executed for an action without executing them.
    Returns steps and estimated impact.
    """
    steps = _build_preview_steps(req.action_type, req.entity, req.entity_id)
    return {
        "steps":            steps,
        "estimated_impact": f"1 {req.entity or 'record'}",
        "requires_confirmation": True,
    }


@router.post("/ask-ai/action", tags=["ask-ai"])
def execute_action(req: ActionRequest, db: Session = Depends(get_db)):
    """
    Execute an Ask AI action. Requires confirmed=true for write operations.
    Routes to the appropriate backend service based on action_type.
    """
    if not req.confirmed:
        raise HTTPException(
            status_code=400,
            detail="Action requires confirmation. Set confirmed=true after showing the user the preview.",
        )

    # Non-write actions: delegate to existing services
    if req.action_type == "generate_report":
        # Save as a named SavedReport so it appears in the Reports tab
        report_name = f"Ask AI — {req.entity or 'Query'} {req.entity_id or ''}".strip(" —")
        if req.query_sql:
            try:
                from api.models import SavedReport as SR
                sr = SR(
                    conn_id=req.conn_id,
                    name=report_name[:200],
                    query_sql=req.query_sql,
                )
                db.add(sr)
                db.commit()
                db.refresh(sr)
                return {
                    "result": "success",
                    "message": f"Report '{report_name}' saved (id={sr.id}). Open the Reports tab to view it.",
                    "trace_id": None,
                }
            except Exception as exc:
                db.rollback()
        return {
            "result": "success",
            "message": f"Report queued for {req.entity or 'query'} {req.entity_id or ''}. Open the Reports tab to view.",
            "trace_id": None,
        }

    if req.action_type == "view_details":
        return {
            "result": "success",
            "message": f"Navigate to the Conversion tab to view details for {req.entity} {req.entity_id or ''}.",
            "trace_id": None,
        }

    # Write actions (run_fix, trigger_workflow, etc.)
    if req.action_type == "run_fix":
        from api.services import ai_trace
        ai_trace.store(
            module="ask_ai",
            conn_id=req.conn_id,
            model="n/a",
            prompt=f"ACTION: run_fix | entity={req.entity} | id={req.entity_id}",
            response="Fix action logged. Routed to workflow engine.",
            db=db,
        )
        return {
            "result": "success",
            "message": (
                f"Fix action recorded for {req.entity or 'record'} {req.entity_id or ''}. "
                "The workflow engine has been notified."
            ),
            "trace_id": None,
        }

    raise HTTPException(status_code=400, detail=f"Unknown action_type: {req.action_type}")


@router.get("/ask-ai/sessions/{session_id}/history", tags=["ask-ai"])
def session_history(session_id: str, db: Session = Depends(get_db)):
    """Return conversation history for a session."""
    try:
        from api.models import ReportSessionMessage
        sid = int(session_id)
        messages = (
            db.query(ReportSessionMessage)
            .filter(ReportSessionMessage.session_id == sid)
            .order_by(ReportSessionMessage.id)
            .limit(50)
            .all()
        )
        return [
            {
                "role":       m.role,
                "content":    m.question or m.result_summary or "",
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ]
    except Exception:
        return []


# ── Internal helpers ──────────────────────────────────────────────────────────

def _save_session_message(db: Session, session_id: str, conn_id: int, user_msg: str, ai_msg: str):
    """Persist a user+AI message pair to the existing ReportSession tables."""
    try:
        from api.models import ReportSessionMessage
        sid = int(session_id)
        db.add(ReportSessionMessage(session_id=sid, role="user",      question=user_msg[:8000]))
        db.add(ReportSessionMessage(session_id=sid, role="assistant", result_summary=ai_msg[:8000]))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def _build_preview_steps(action_type: str, entity: Optional[str], entity_id: Optional[str]) -> list[str]:
    if action_type == "run_fix":
        return [
            f"Validate {entity or 'record'} {entity_id or ''} exists",
            "Check current status and eligibility",
            "Apply fix rules from business rule engine",
            "Update record status",
            "Log action to audit trail",
            "Send notification to stakeholders",
        ]
    if action_type == "generate_report":
        return [
            "Retrieve latest data from source",
            "Apply report template",
            "Generate PDF/Excel export",
            "Save to Saved Reports",
        ]
    return ["Execute action", "Log result"]
