"""
api/routers/query_intelligence.py

POST /query-intelligence/analyze
  Accepts a SQL query + optional connection/context, returns structured AI analysis.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.dependencies import require_developer

router = APIRouter(dependencies=[Depends(require_developer)])


# ── Request / Response models ─────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    sql:           str
    dialect:       Optional[str] = None   # mssql | postgresql | mysql | sqlite | snowflake
    conn_id:       Optional[int] = None   # auto-loads schema context from catalog
    extra_context: Optional[str] = None   # free-form notes from user


class IntentModel(BaseModel):
    business:  str
    technical: str


class AntiPattern(BaseModel):
    type:        str
    description: str
    severity:    str   # low | medium | high


class CostIssue(BaseModel):
    issue:    str
    impact:   str
    severity: str


class IndexRec(BaseModel):
    table:   str
    columns: list[str]
    reason:  str


class AnalyzeResponse(BaseModel):
    summary:              str
    intent:               IntentModel
    complexity:           str
    anti_patterns:        list[AntiPattern]
    cost_issues:          list[CostIssue]
    suggested_rewrite:    str
    index_recommendations: list[IndexRec]
    tokens_in:            int
    tokens_out:           int
    latency_ms:           int


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/query-intelligence/analyze", response_model=AnalyzeResponse)
def analyze_query(
    req: AnalyzeRequest,
    db: Session = Depends(get_db),
):
    if not req.sql or not req.sql.strip():
        raise HTTPException(status_code=400, detail="sql field is required and cannot be empty.")

    try:
        from api.services.query_intelligence import analyze_query as _analyze
        result = _analyze(
            sql=req.sql,
            dialect=req.dialect,
            schema_context=None,      # auto-loaded inside the service via conn_id
            extra_context=req.extra_context,
            db=db,
            conn_id=req.conn_id,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}")

    return result
