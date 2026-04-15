# ═══════════════════════════════════════════════════════════
# routers/report_ai.py
#
# AI-Powered Natural Language → SQL → Results
#
# POST /api/report/ask        — embed question, match columns, gen SQL, run
# POST /api/report/sql        — run raw SQL (existing; moved here for clarity)
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import SourceConnection, ColumnEmbedding, SavedReport, QueryContext
from api.services.embeddings import get_embedding, cosine_similarity, generate_sql
from api.services.connector import preview_data
from api.routers.connections import _to_cfg_from_model, _clean_error_str
from api.config import settings

router = APIRouter()


def _fetch_context(conn_id: int, db) -> str:
    """Return combined global + connection-specific markdown context for AI prompts."""
    parts = []
    # Global context (conn_id IS NULL)
    g = db.query(QueryContext).filter(QueryContext.conn_id == None).first()
    if g and g.content and g.content.strip():
        parts.append(g.content.strip())
    # Connection-specific context
    c = db.query(QueryContext).filter(QueryContext.conn_id == conn_id).first()
    if c and c.content and c.content.strip():
        parts.append(c.content.strip())
    return "\n\n---\n\n".join(parts)


# ── Request / Response schemas ───────────────────────────────────────────────

class AskRequest(BaseModel):
    conn_id:      int
    question:     str
    api_key:      str = ""   # empty → fall back to OPENAI_API_KEY in .env
    embed_model:  str = "text-embedding-3-small"
    chat_model:   str = "gpt-4o-mini"
    top_k:        int = 15    # number of columns to retrieve
    limit:        int = 1000  # max result rows


class AskResult(BaseModel):
    sql:             str
    matched_columns: list[dict]
    columns:         list[str]
    rows:            list[dict]
    total:           int
    sheet_alias:     str = "Results"


# ── Endpoint ─────────────────────────────────────────────────────────────────

class GenerateSqlResult(BaseModel):
    sql:             str
    matched_columns: list[dict]


@router.post("/report/generate-sql", response_model=GenerateSqlResult)
def generate_sql_only(req: AskRequest, db: Session = Depends(get_db)):
    """Generate SQL from a natural-language question without executing it."""

    api_key = req.api_key.strip() or settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400,
            detail="No OpenAI API key provided.")

    conn_model = db.query(SourceConnection).filter(
        SourceConnection.id == req.conn_id).first()
    if not conn_model:
        raise HTTPException(status_code=404, detail="Connection not found")

    try:
        q_vec = get_embedding(req.question, api_key, req.embed_model)
    except Exception as exc:
        raise HTTPException(status_code=400,
            detail=f"Embedding failed: {str(exc)[:200]}")

    embeddings = db.query(ColumnEmbedding).filter(
        ColumnEmbedding.conn_id == req.conn_id).all()
    if not embeddings:
        raise HTTPException(status_code=400,
            detail="No embeddings found. Run 'Generate Embeddings' in Admin first.")

    scored: list[dict] = []
    for emb in embeddings:
        try:
            vec   = json.loads(emb.embedding_json or "[]")
            score = cosine_similarity(q_vec, vec)
            scored.append({
                "table_schema":      emb.table_schema or "dbo",
                "table_name":        emb.table_name,
                "column_name":       emb.column_name,
                "data_type":         None,
                "column_definition": emb.column_definition,
                "score":             round(score, 4),
            })
        except Exception:
            pass

    scored.sort(key=lambda x: x["score"], reverse=True)
    top_cols = scored[: req.top_k]

    cfg     = _to_cfg_from_model(conn_model)
    dialect = (
        conn_model.dialect.lower()          if conn_model.dialect else
        "snowflake"                         if conn_model.source_type == "snowflake" else
        "mssql"
    )

    try:
        from api.services.query_skill import build_skill_prompt
        skill_prompt = build_skill_prompt(req.conn_id, db, dialect, context="report")
    except Exception:
        skill_prompt = None

    # Append query context markdown (global + connection-specific)
    ctx_md = _fetch_context(req.conn_id, db)
    if ctx_md:
        skill_prompt = (skill_prompt or "") + "\n\n## Query Context\n" + ctx_md

    import time as _time
    _t0 = _time.time()
    try:
        sql = generate_sql(req.question, top_cols, dialect, api_key,
                           req.chat_model, system_prompt=skill_prompt)
        sql = sql.strip()
        if sql.startswith("```"):
            sql = sql.split("\n", 1)[-1]
            sql = sql.rsplit("```", 1)[0].strip()
    except Exception as exc:
        raise HTTPException(status_code=400,
            detail=f"SQL generation failed: {str(exc)[:200]}")

    try:
        from api.services import ai_trace as _at
        _at.store(
            module="report",
            conn_id=req.conn_id,
            model=req.chat_model,
            prompt=f"NL→SQL (generate-only): {req.question}",
            response=sql,
            latency_ms=int((_time.time() - _t0) * 1000),
            db=db,
        )
    except Exception:
        pass

    return GenerateSqlResult(sql=sql, matched_columns=top_cols[:8])


@router.post("/report/ask", response_model=AskResult)
def ask_question(req: AskRequest, db: Session = Depends(get_db)):
    """
    1. Embed the user's question with OpenAI.
    2. Cosine-search stored column embeddings for this connection.
    3. Pass top-K columns to LLM → generate SQL.
    4. Execute SQL against the stored connection (credentials decrypted server-side).
    5. Return SQL + column metadata + result rows.
    """

    # ── 0. Resolve API key ──────────────────────────────────
    api_key = req.api_key.strip() or settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No OpenAI API key provided. Set OPENAI_API_KEY in .env or enter it in the Report tab."
        )

    # ── 1. Load connection ──────────────────────────────────
    conn_model = db.query(SourceConnection).filter(
        SourceConnection.id == req.conn_id
    ).first()
    if not conn_model:
        raise HTTPException(status_code=404, detail="Connection not found")

    # ── 2. Embed the question ───────────────────────────────
    try:
        q_vec = get_embedding(req.question, api_key, req.embed_model)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Embedding failed: {str(exc)[:200]}"
        )

    # ── 3. Load stored column embeddings ────────────────────
    embeddings = (
        db.query(ColumnEmbedding)
        .filter(ColumnEmbedding.conn_id == req.conn_id)
        .all()
    )
    if not embeddings:
        raise HTTPException(
            status_code=400,
            detail=(
                "No embeddings found for this connection. "
                "Go to the Admin tab → select this connection → click 'Generate Embeddings'."
            ),
        )

    # ── 4. Rank columns by cosine similarity ────────────────
    scored: list[dict] = []
    for emb in embeddings:
        try:
            vec   = json.loads(emb.embedding_json or "[]")
            score = cosine_similarity(q_vec, vec)
            scored.append({
                "table_schema":      emb.table_schema or "dbo",
                "table_name":        emb.table_name,
                "column_name":       emb.column_name,
                "data_type":         None,
                "column_definition": emb.column_definition,
                "score":             round(score, 4),
            })
        except Exception:
            pass

    scored.sort(key=lambda x: x["score"], reverse=True)
    top_cols = scored[: req.top_k]

    # ── 5. Generate SQL ─────────────────────────────────────
    cfg     = _to_cfg_from_model(conn_model)
    dialect = cfg.get("dialect") or (
        "snowflake" if conn_model.source_type == "snowflake" else "mssql"
    )

    # Build enriched skill prompt (schema + FK + samples + domain rules)
    try:
        from api.services.query_skill import build_skill_prompt
        skill_prompt = build_skill_prompt(req.conn_id, db, dialect, context="report")
    except Exception:
        skill_prompt = None   # fall back to built-in prompt in generate_sql

    # Append query context markdown (global + connection-specific)
    ctx_md = _fetch_context(req.conn_id, db)
    if ctx_md:
        skill_prompt = (skill_prompt or "") + "\n\n## Query Context\n" + ctx_md

    import time as _time
    _t0 = _time.time()
    try:
        sql = generate_sql(req.question, top_cols, dialect, api_key, req.chat_model,
                           system_prompt=skill_prompt)
        # Strip markdown code fences if model wrapped the SQL anyway
        sql = sql.strip()
        if sql.startswith("```"):
            sql = sql.split("\n", 1)[-1]          # drop first ```sql line
            sql = sql.rsplit("```", 1)[0].strip()  # drop trailing ```
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"SQL generation failed: {str(exc)[:200]}"
        )

    # Store AI trace
    try:
        from api.services import ai_trace as _at
        _at.store(
            module="report",
            conn_id=req.conn_id,
            model=req.chat_model,
            prompt=f"NL→SQL question: {req.question}",
            response=sql,
            latency_ms=int((_time.time() - _t0) * 1000),
            db=db,
        )
    except Exception:
        pass

    # ── 6. Execute SQL ──────────────────────────────────────
    cfg["query"] = sql
    try:
        result = preview_data(cfg, limit=req.limit)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"SQL execution failed: {_clean_error_str(str(exc))}"
        )

    return AskResult(
        sql             = sql,
        matched_columns = top_cols[:8],   # top 8 shown in UI
        columns         = result["columns"],
        rows            = result["rows"],
        total           = result["total"],
    )


# ── Saved Reports ─────────────────────────────────────────────────────────────

class SaveReportRequest(BaseModel):
    conn_id:   int
    name:      str
    query_sql: str


class SavedReportOut(BaseModel):
    id:         int
    conn_id:    int
    name:       str
    query_sql:  str
    created_at: str

    class Config:
        from_attributes = True


@router.get("/reports/saved", response_model=list[SavedReportOut])
def list_saved_reports(conn_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(SavedReport)
        .filter(SavedReport.conn_id == conn_id)
        .order_by(SavedReport.created_at.desc())
        .all()
    )
    return [
        SavedReportOut(
            id=r.id, conn_id=r.conn_id, name=r.name,
            query_sql=r.query_sql,
            created_at=r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else ""
        )
        for r in rows
    ]


@router.post("/reports/saved", response_model=SavedReportOut)
def save_report(req: SaveReportRequest, db: Session = Depends(get_db)):
    if not req.name.strip():
        raise HTTPException(400, detail="Report name is required")
    if not req.query_sql.strip():
        raise HTTPException(400, detail="SQL query is required")
    rec = SavedReport(conn_id=req.conn_id, name=req.name.strip(), query_sql=req.query_sql.strip())
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return SavedReportOut(
        id=rec.id, conn_id=rec.conn_id, name=rec.name,
        query_sql=rec.query_sql,
        created_at=rec.created_at.strftime("%Y-%m-%d %H:%M") if rec.created_at else ""
    )


@router.delete("/reports/saved/{report_id}", status_code=204)
def delete_report(report_id: int, db: Session = Depends(get_db)):
    rec = db.query(SavedReport).filter(SavedReport.id == report_id).first()
    if not rec:
        raise HTTPException(404, detail="Report not found")
    db.delete(rec)
    db.commit()
