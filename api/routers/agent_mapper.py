"""
api/routers/agent_mapper.py
DCT Extract Manuscript Generator endpoints.

POST /agent-mapper/generate           — generate manuscript from natural-language instruction
GET  /agent-mapper/sessions           — list recent sessions
GET  /agent-mapper/sessions/{id}      — get session detail (includes XML, grid, intent)
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.dependencies import require_developer
from api.database import get_db
from api.models import AgentMapperSession

router = APIRouter(dependencies=[Depends(require_developer)])


# ── Request / Response Models ──────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    user_input: str
    project_id: Optional[int] = None


class IntentOut(BaseModel):
    entity: str
    field:  str
    source: str
    type:   str
    lob:    str


class MappingModelOut(BaseModel):
    entity:        str
    field:         str
    source:        str
    type:          str
    lob:           str
    target:        Optional[str]
    template_name: str
    inherit:       Optional[str]
    include:       list[str]


class GridRowOut(BaseModel):
    entity:       str
    target_table: str
    target_field: str
    source:       str
    type:         str
    rule:         str
    include:      list[str]
    inherit:      Optional[str]


class ManuscriptOut(BaseModel):
    session_id:    int
    user_input:    str
    parsed_intent: IntentOut
    mapping_model: MappingModelOut
    generated_xml: str
    grid:          list[GridRowOut]
    tokens_in:     int
    tokens_out:    int
    latency_ms:    int


class SessionListOut(BaseModel):
    id:            int
    project_id:    Optional[int]
    user_input:    str
    mapping_type:  Optional[str]
    entity:        Optional[str]
    field:         Optional[str]
    lob:           Optional[str]
    inherit:       Optional[str]
    generated_xml: Optional[str]
    created_at:    datetime
    model_config = {"from_attributes": True}


class SessionDetailOut(BaseModel):
    id:            int
    project_id:    Optional[int]
    user_input:    str
    parsed_intent: IntentOut
    mapping_model: MappingModelOut
    generated_xml: str
    grid:          list[GridRowOut]
    mapping_type:  Optional[str]
    entity:        Optional[str]
    field:         Optional[str]
    lob:           Optional[str]
    inherit:       Optional[str]
    include:       list[str]
    created_at:    datetime


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/agent-mapper/generate", response_model=ManuscriptOut)
def generate(req: GenerateRequest, db: Session = Depends(get_db)):
    from api.services.agent_mapper.manuscript_generator import generate_manuscript
    try:
        result = generate_manuscript(req.user_input, db, req.project_id)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:300])

    return ManuscriptOut(
        session_id    = result.session_id,
        user_input    = result.user_input,
        parsed_intent = result.parsed_intent,
        mapping_model = result.mapping_model,
        generated_xml = result.generated_xml,
        grid          = result.grid,
        tokens_in     = result.tokens_in,
        tokens_out    = result.tokens_out,
        latency_ms    = result.latency_ms,
    )


@router.get("/agent-mapper/sessions", response_model=list[SessionListOut])
def list_sessions(limit: int = 20, db: Session = Depends(get_db)):
    return (
        db.query(AgentMapperSession)
        .order_by(AgentMapperSession.id.desc())
        .limit(limit)
        .all()
    )


@router.get("/agent-mapper/sessions/{session_id}", response_model=SessionDetailOut)
def get_session(session_id: int, db: Session = Depends(get_db)):
    row = db.query(AgentMapperSession).filter_by(id=session_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionDetailOut(
        id            = row.id,
        project_id    = row.project_id,
        user_input    = row.user_input,
        parsed_intent = json.loads(row.parsed_intent),
        mapping_model = json.loads(row.mapping_model),
        generated_xml = row.generated_xml,
        grid          = json.loads(row.grid_json or "[]"),
        mapping_type  = row.mapping_type,
        entity        = row.entity,
        field         = row.field,
        lob           = row.lob,
        inherit       = row.inherit,
        include       = json.loads(row.include_json or "[]"),
        created_at    = row.created_at,
    )
