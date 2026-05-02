"""
api/routers/agent_mapper.py
DCT Extract Manuscript Generator endpoints.

POST /agent-mapper/generate           — generate/extend manuscript
GET  /agent-mapper/sessions           — list recent sessions
GET  /agent-mapper/sessions/{id}      — session detail
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
    user_input:       str
    project_id:       Optional[int]       = None
    existing_xml:     Optional[str]       = None
    mode:             str                 = "create"   # "create" | "extend"
    includes:         Optional[list[str]] = None       # admin: extra manuscript refs
    inherit_override: Optional[str]       = None       # admin: override inherited manuscript


class IntentOut(BaseModel):
    entity: str
    field:  str
    source: str
    type:   str
    lob:    str


class MappingModelOut(BaseModel):
    entity:         str
    field:          str
    source:         str
    type:           str
    lob:            str
    target:         Optional[str]
    template_name:  str
    inherit:        Optional[str]
    include:        list[str]
    low_confidence: bool = False
    key_source:     Optional[str] = None
    name_source:    Optional[str] = None
    desc_source:    Optional[str] = None


class GridRowOut(BaseModel):
    entity:       str
    target_table: str
    target_field: str
    source:       str
    type:         str
    rule:         str
    include:      list[str]
    inherit:      Optional[str]
    operation:    Optional[str] = None   # "added" | "updated" | None (existing)


class SuggestionOut(BaseModel):
    field:            str
    current_entity:   str
    suggested_entity: str
    message:          str


class ManuscriptOut(BaseModel):
    session_id:     int
    user_input:     str
    parsed_intents: list[IntentOut]
    mapping_models: list[MappingModelOut]
    generated_xml:  str
    grid:           list[GridRowOut]
    mode:           str
    warnings:       list[str]
    suggestions:    list[SuggestionOut] = []
    tokens_in:      int
    tokens_out:     int
    latency_ms:     int
    prompt_text:    str
    response_text:  str
    metadata:       dict = {}


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
    id:             int
    project_id:     Optional[int]
    user_input:     str
    parsed_intents: list[IntentOut]
    mapping_models: list[MappingModelOut]
    generated_xml:  str
    grid:           list[GridRowOut]
    mapping_type:   Optional[str]
    entity:         Optional[str]
    field:          Optional[str]
    lob:            Optional[str]
    inherit:        Optional[str]
    include:        list[str]
    created_at:     datetime


def _to_list(raw: str | None) -> list:
    """Handles both old (single dict) and new (list) stored JSON."""
    if not raw:
        return []
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, list) else [parsed]


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/agent-mapper/generate", response_model=ManuscriptOut)
def generate(req: GenerateRequest, db: Session = Depends(get_db)):
    from api.services.agent_mapper.manuscript_generator import generate_manuscript
    try:
        result = generate_manuscript(
            req.user_input, db, req.project_id,
            existing_xml=req.existing_xml,
            mode=req.mode,
            user_includes=req.includes,
            inherit_override=req.inherit_override,
        )
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:300])

    return ManuscriptOut(
        session_id     = result.session_id,
        user_input     = result.user_input,
        parsed_intents = result.parsed_intents,
        mapping_models = result.mapping_models,
        generated_xml  = result.generated_xml,
        grid           = result.grid,
        mode           = result.mode,
        warnings       = result.warnings,
        tokens_in      = result.tokens_in,
        tokens_out     = result.tokens_out,
        latency_ms     = result.latency_ms,
        prompt_text    = result.prompt_text,
        response_text  = result.response_text,
        metadata       = result.metadata,
        suggestions    = result.suggestions,
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

    parsed_intents = _to_list(row.parsed_intent)
    mapping_models = _to_list(row.mapping_model)

    return SessionDetailOut(
        id             = row.id,
        project_id     = row.project_id,
        user_input     = row.user_input,
        parsed_intents = parsed_intents,
        mapping_models = mapping_models,
        generated_xml  = row.generated_xml or "",
        grid           = json.loads(row.grid_json or "[]"),
        mapping_type   = row.mapping_type,
        entity         = row.entity,
        field          = row.field,
        lob            = row.lob,
        inherit        = row.inherit,
        include        = json.loads(row.include_json or "[]"),
        created_at     = row.created_at,
    )
