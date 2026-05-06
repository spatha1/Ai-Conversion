"""
payload_intelligence.py — JSON/API Payload Intelligence Agent endpoints.
POST /api/payload/analyze            → analyze a JSON payload
GET  /api/payload/sessions           → list saved sessions
GET  /api/payload/sessions/{id}      → full session detail
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db

router = APIRouter()


class AnalyzeRequest(BaseModel):
    payload:       str
    target_schema: Optional[str] = None
    instructions:  Optional[str] = None
    name:          Optional[str] = None


@router.post("/payload/analyze")
def analyze_payload(req: AnalyzeRequest, db: Session = Depends(get_db)):
    from api.services.payload_analyzer import analyze_payload as _analyze
    try:
        return _analyze(req.payload, req.target_schema, req.instructions, req.name, db)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/payload/sessions")
def list_sessions(limit: int = 20, db: Session = Depends(get_db)):
    from api.models import PayloadSession
    rows = (
        db.query(PayloadSession)
        .order_by(PayloadSession.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id":         r.id,
            "name":       r.name,
            "narrative":  r.narrative,
            "tokens_in":  r.tokens_in,
            "tokens_out": r.tokens_out,
            "latency_ms": r.latency_ms,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.get("/payload/sessions/{session_id}")
def get_session(session_id: int, db: Session = Depends(get_db)):
    from api.models import PayloadSession
    r = db.query(PayloadSession).filter(PayloadSession.id == session_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Session not found")

    def _load(text):
        if not text:
            return []
        try:
            return json.loads(text)
        except Exception:
            return []

    return {
        "session_id":    r.id,
        "name":          r.name,
        "source_payload": r.source_payload,
        "target_schema": r.target_schema,
        "instructions":  r.instructions,
        "components":    _load(r.components),
        "field_mappings": _load(r.field_mappings),
        "issues":        _load(r.issues),
        "narrative":     r.narrative,
        "tokens_in":     r.tokens_in,
        "tokens_out":    r.tokens_out,
        "latency_ms":    r.latency_ms,
        "created_at":    r.created_at.isoformat() if r.created_at else None,
    }
