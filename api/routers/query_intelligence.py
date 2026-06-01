"""
api/routers/query_intelligence.py

POST /query-intelligence/analyze  — quick analysis (anti-patterns, intent, rewrites)
POST /query-intelligence/extract   — deep 11-section knowledge extraction
POST /query-intelligence/enhance   — apply natural-language enhancement to SQL
POST /query-intelligence/save-kb   — persist extracted KB artifacts to knowledge base
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.dependencies import require_developer

router = APIRouter(dependencies=[Depends(require_developer)])


# ── Quick-Analyze request / response ─────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    sql:           str
    dialect:       Optional[str] = None
    conn_id:       Optional[int] = None
    extra_context: Optional[str] = None


class IntentModel(BaseModel):
    business:  str
    technical: str


class AntiPattern(BaseModel):
    type:        str
    description: str
    severity:    str


class CostIssue(BaseModel):
    issue:    str
    impact:   str
    severity: str


class IndexRec(BaseModel):
    table:   str
    columns: list[str]
    reason:  str


class AnalyzeResponse(BaseModel):
    summary:               str
    intent:                IntentModel
    complexity:            str
    anti_patterns:         list[AntiPattern]
    cost_issues:           list[CostIssue]
    suggested_rewrite:     str
    index_recommendations: list[IndexRec]
    tokens_in:             int
    tokens_out:            int
    latency_ms:            int


# ── Deep-Extract request / response ──────────────────────────────────────────

class ExtractRequest(BaseModel):
    sql:           str
    dialect:       Optional[str] = None
    conn_id:       Optional[int] = None
    extra_context: Optional[str] = None


class QuerySummaryModel(BaseModel):
    purpose:            str
    business_objective: str
    kpi:                str
    process:            str
    country:            str
    domain:             str


class SourceObject(BaseModel):
    name:    str
    type:    str
    schema_: Optional[str] = None
    purpose: str

    class Config:
        populate_by_name = True


class FieldMapping(BaseModel):
    output_field:         str
    source_table:         str
    source_field:         str
    transformation_logic: str


class JoinAnalysis(BaseModel):
    join_type:  str
    left_table: str
    right_table: str
    join_keys:  list[str]
    purpose:    str


class BusinessRule(BaseModel):
    rule_type: str
    field:     Optional[str] = None
    condition: str
    result:    str


class KpiDetection(BaseModel):
    kpi_name:   str
    confidence: float
    evidence:   str


class AccountMapping(BaseModel):
    account_number: str
    account_name:   str
    indicator:      Optional[str] = None


class DataLineage(BaseModel):
    description:     str
    mermaid_diagram: str


class ValidationCheck(BaseModel):
    check_type:       str
    description:      str
    suggested_query:  Optional[str] = None


class TroubleshootingItem(BaseModel):
    issue:            str
    likely_cause:     str
    resolution_hint:  str


class KbArtifact(BaseModel):
    kb_type: str
    title:   str
    content: str


class ExtractResponse(BaseModel):
    session_name:            str
    query_summary:           QuerySummaryModel
    source_objects:          list[dict]
    field_mappings:          list[dict]
    join_analysis:           list[dict]
    business_rules:          list[dict]
    kpi_detection:           list[dict]
    account_mappings:        list[dict]
    data_lineage:            dict
    validation_guidance:     list[dict]
    troubleshooting_guidance: list[dict]
    kb_artifacts:            list[dict]
    tokens_in:               int
    tokens_out:              int
    latency_ms:              int


# ── Enhance request / response ────────────────────────────────────────────────

class EnhanceRequest(BaseModel):
    sql:                 str
    enhancement_request: str
    dialect:             Optional[str] = None
    conn_id:             Optional[int] = None


class EnhanceResponse(BaseModel):
    revised_sql:      str
    changes_summary:  str
    warnings:         list[str]
    tokens_in:        int
    tokens_out:       int
    latency_ms:       int


# ── Save-to-KB request / response ─────────────────────────────────────────────

class SaveKbArtifact(BaseModel):
    kb_type: str
    title:   str
    content: str
    sql_ref: Optional[str] = None


class SaveKbRequest(BaseModel):
    artifacts:    list[SaveKbArtifact]
    kb_schema_id: Optional[int] = None
    session_id:   Optional[int] = None


class SaveKbResponse(BaseModel):
    saved:  int
    ids:    list[int]


# ── Chat request / response ────────────────────────────────────────────────────

class ChatHistoryItem(BaseModel):
    role:    str   # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    question:   str
    entry_ids:  list[int]
    history:    list[ChatHistoryItem] = []
    dialect:    Optional[str] = None
    conn_id:    Optional[int] = None


class ChatSource(BaseModel):
    entry_id: int
    title:    str
    score:    float


class ChatResponse(BaseModel):
    explanation: str
    sql_query:   str
    sources:     list[ChatSource]
    tokens_in:   int
    tokens_out:  int
    latency_ms:  int


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/query-intelligence/analyze", response_model=AnalyzeResponse)
def analyze_query(req: AnalyzeRequest, db: Session = Depends(get_db)):
    if not req.sql or not req.sql.strip():
        raise HTTPException(status_code=400, detail="sql field is required and cannot be empty.")
    try:
        from api.services.query_intelligence import analyze_query as _analyze
        result = _analyze(
            sql=req.sql,
            dialect=req.dialect,
            schema_context=None,
            extra_context=req.extra_context,
            db=db,
            conn_id=req.conn_id,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}")
    return result


@router.post("/query-intelligence/extract", response_model=ExtractResponse)
def extract_knowledge(req: ExtractRequest, db: Session = Depends(get_db)):
    if not req.sql or not req.sql.strip():
        raise HTTPException(status_code=400, detail="sql field is required and cannot be empty.")
    try:
        from api.services.query_intelligence import extract_knowledge as _extract
        result = _extract(
            sql=req.sql,
            dialect=req.dialect,
            extra_context=req.extra_context,
            db=db,
            conn_id=req.conn_id,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {exc}")
    return result


@router.post("/query-intelligence/enhance", response_model=EnhanceResponse)
def enhance_query(req: EnhanceRequest, db: Session = Depends(get_db)):
    if not req.sql or not req.sql.strip():
        raise HTTPException(status_code=400, detail="sql field is required.")
    if not req.enhancement_request or not req.enhancement_request.strip():
        raise HTTPException(status_code=400, detail="enhancement_request field is required.")
    try:
        from api.services.query_intelligence import enhance_query as _enhance
        result = _enhance(
            sql=req.sql,
            enhancement_request=req.enhancement_request,
            dialect=req.dialect,
            db=db,
            conn_id=req.conn_id,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Enhancement failed: {exc}")
    return result


@router.post("/query-intelligence/save-kb", response_model=SaveKbResponse)
def save_kb_artifacts(req: SaveKbRequest, db: Session = Depends(get_db)):
    """
    Persist extracted KB artifacts to conversion_knowledge_entries.
    Creates entries with status READY_FOR_EMBEDDING; admin can trigger
    embedding from the Admin page.
    """
    if not req.artifacts:
        raise HTTPException(status_code=400, detail="artifacts list cannot be empty.")

    _TYPE_MAP = {
        "Process":         "Process",
        "View":            "Process",
        "Configuration":   "UseCase",
        "Lineage":         "UseCase",
        "Troubleshooting": "Issue",
        "Q&A":             "Question",
    }

    try:
        from api.models import KnowledgeEntry
        saved_ids: list[int] = []

        for art in req.artifacts:
            entry = KnowledgeEntry(
                title=art.title[:500],
                type=_TYPE_MAP.get(art.kb_type, "Process"),
                system="DCT",
                tags=json.dumps(["Query Intelligence", art.kb_type]),
                summary=art.content[:500],
                detailed_explanation=art.content,
                raw_content=(
                    art.content if not art.sql_ref
                    else f"{art.content}\n\n---\nSQL Reference:\n{art.sql_ref}"
                ),
                source_type="Text",
                status="READY_FOR_EMBEDDING",
                kb_schema_id=req.kb_schema_id,
                session_id=req.session_id,
            )
            db.add(entry)
            db.flush()
            saved_ids.append(entry.id)

        db.commit()
        return {"saved": len(saved_ids), "ids": saved_ids}

    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Save failed: {exc}")


@router.post("/query-intelligence/chat", response_model=ChatResponse)
def kb_chat(req: ChatRequest, db: Session = Depends(get_db)):
    """
    Chat with the KB entries saved from a prior extraction.
    Returns explanation (text) + sql_query for every question.
    """
    if not req.question or not req.question.strip():
        raise HTTPException(status_code=400, detail="question is required.")
    if not req.entry_ids:
        raise HTTPException(status_code=400, detail="entry_ids must not be empty.")
    try:
        from api.services.query_intelligence import chat_with_kb as _chat
        result = _chat(
            question=req.question,
            entry_ids=req.entry_ids,
            history=[h.dict() for h in req.history],
            dialect=req.dialect,
            db=db,
            conn_id=req.conn_id,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Chat failed: {exc}")
    return result
