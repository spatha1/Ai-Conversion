# ═══════════════════════════════════════════════════════════
# routers/report_ai.py
#
# Schema-Driven AI Data Exploration & Insight Engine
#
# Endpoints:
#   POST /report/ask              — NL→SQL + execute + enriched result
#   POST /report/generate-sql     — SQL generation only (no execution)
#   GET  /report/catalog/{conn_id}— Schema explorer catalog (user-scoped)
#   POST /report/session          — Create conversation session
#   GET  /report/session/{id}     — Get session history
#   POST /report/ask-followup     — NL→SQL with session context
#   POST /report/session/{id}/upload — Upload doc for context merging
#   DELETE /report/session/{id}/docs/{doc_id} — Remove attached doc
#   POST /report/insights         — Generic insight detection
#   POST /report/export-ppt       — Download .pptx from query results
#   POST /report/resume/{req_id}  — Auto-resume after approval
#   GET  /reports/saved           — Saved reports list
#   POST /reports/saved           — Save a report
#   DELETE /reports/saved/{id}    — Delete a report
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

import hashlib
import json
import time as _time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import (
    SourceConnection, ColumnEmbedding, SavedReport, QueryContext,
    ReportSession, ReportSessionMessage, ReportSessionDocument,
    CatalogColumn, CatalogRelation, CatalogSample, SchemaMetadata,
    ApprovalRequest,
)
from api.services.embeddings import get_embedding, cosine_similarity, generate_sql
from api.services.connector import preview_data
from api.routers.connections import _to_cfg_from_model, _clean_error_str
from api.config import settings
from api.dependencies import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024   # 10 MB
ALLOWED_TYPES    = {"pdf", "docx", "xlsx", "csv", "txt"}
SESSION_COMPRESS_AFTER = 10            # compress history after this many message pairs


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fetch_context(conn_id: int, db: Session) -> str:
    parts = []
    g = db.query(QueryContext).filter(QueryContext.conn_id == None).first()
    if g and g.content and g.content.strip():
        parts.append(g.content.strip())
    c = db.query(QueryContext).filter(QueryContext.conn_id == conn_id).first()
    if c and c.content and c.content.strip():
        parts.append(c.content.strip())
    return "\n\n---\n\n".join(parts)


def _estimate_row_count(sql: str, cfg: dict, dialect: str) -> int:
    """Cheap row-count estimate. Returns -1 on failure (triggers approval by default)."""
    try:
        if dialect in ("mssql", "sql"):
            count_sql = f"SELECT COUNT(*) AS _cnt FROM (SELECT TOP 10000 1 AS _r FROM ({sql}) AS _inner) AS _outer"
        else:
            count_sql = f"SELECT COUNT(*) AS _cnt FROM (SELECT 1 AS _r FROM ({sql}) AS _inner LIMIT 10000) AS _outer"
        result = preview_data({**cfg, "query": count_sql}, limit=1)
        return int(result["rows"][0].get("_cnt", 0)) if result["rows"] else 0
    except Exception:
        return -1


def _check_approval_gate(
    conn_model: SourceConnection,
    sql: str,
    current_user,
    db: Session,
    context_type: str = "report_query",
    extra_payload: dict = None,
) -> Optional[JSONResponse]:
    """
    Check if the query requires approval based on row count threshold.
    Returns a JSONResponse(202) if approval is pending/created, else None.
    Admins always bypass the gate.
    """
    if not conn_model.project_id:
        return None

    # Admins bypass approval
    user_roles = {ur.role for ur in getattr(current_user, "user_roles", [])}
    if "admin" in user_roles:
        return None

    from api.services.approval_service import needs_approval, find_existing_pending, create_approval_request
    if not needs_approval(db, conn_model.project_id):
        return None

    cfg = _to_cfg_from_model(conn_model)
    dialect = cfg.get("dialect") or ("snowflake" if conn_model.source_type == "snowflake" else "mssql")
    estimated = _estimate_row_count(sql, cfg, dialect)

    if estimated != -1 and estimated <= settings.REPORT_APPROVAL_THRESHOLD:
        return None

    sql_h = hashlib.sha256(sql.encode()).hexdigest()
    existing = find_existing_pending(db, conn_model.project_id, context_type, sql_h)
    if existing:
        return JSONResponse(status_code=202, content={
            "status": "pending_approval",
            "approval_request_id": existing.id,
            "message": "Approval already pending for this query.",
        })

    payload = json.dumps(extra_payload or {"sql": sql, "conn_id": conn_model.id})
    req_obj = create_approval_request(
        db, conn_model.project_id, current_user.id, context_type, sql_h,
    )
    if req_obj:
        # create_approval_request does its own db.commit() internally, so the row already
        # exists with context_payload=NULL. Use an explicit UPDATE to guarantee the payload
        # is written — ORM dirty-tracking can miss updates after a foreign commit.
        db.query(ApprovalRequest).filter(ApprovalRequest.id == req_obj.id).update(
            {"context_payload": payload, "sql_hash": sql_h}
        )
        db.commit()
        return JSONResponse(status_code=202, content={
            "status": "pending_approval",
            "approval_request_id": req_obj.id,
        })
    return None


def _build_top_cols(req_conn_id: int, question: str, api_key: str, embed_model: str,
                    top_k: int, db: Session) -> list[dict]:
    q_vec = get_embedding(question, api_key, embed_model)
    embeddings = db.query(ColumnEmbedding).filter(ColumnEmbedding.conn_id == req_conn_id).all()
    if not embeddings:
        raise HTTPException(status_code=400,
            detail="No embeddings found. Run 'Generate Embeddings' in Admin first.")
    scored = []
    for emb in embeddings:
        try:
            vec = json.loads(emb.embedding_json or "[]")
            score = cosine_similarity(q_vec, vec)
            scored.append({
                "table_schema": emb.table_schema or "dbo",
                "table_name": emb.table_name,
                "column_name": emb.column_name,
                "data_type": None,
                "column_definition": emb.column_definition,
                "score": round(score, 4),
            })
        except Exception:
            pass
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]


def _build_enriched_prompt(conn_id: int, dialect: str, db: Session,
                            conversation_context: str = "",
                            doc_context: str = "") -> Optional[str]:
    try:
        from api.services.query_skill import build_skill_prompt
        prompt = build_skill_prompt(conn_id, db, dialect, context="report")
    except Exception:
        prompt = None

    ctx_md = _fetch_context(conn_id, db)
    if ctx_md:
        prompt = (prompt or "") + "\n\n## Query Context\n" + ctx_md

    if conversation_context:
        prompt = (prompt or "") + "\n\n" + conversation_context

    if doc_context:
        prompt = (prompt or "") + "\n\n" + doc_context

    return prompt


# ── Request / Response schemas ────────────────────────────────────────────────

class AskRequest(BaseModel):
    conn_id:     int
    question:    str
    api_key:     str = ""
    embed_model: str = "text-embedding-3-small"
    chat_model:  str = "gpt-4o-mini"
    top_k:       int = 15
    limit:       int = 1000


class AskResult(BaseModel):
    sql:                    str
    matched_columns:        list[dict]
    columns:                list[str]
    rows:                   list[dict]
    total:                  int
    sheet_alias:            str = "Results"
    confidence:             float = 0.0
    query_explanation:      str = ""
    follow_up_suggestions:  list[str] = []
    ambiguities:            list[str] = []


class GenerateSqlResult(BaseModel):
    sql:             str
    matched_columns: list[dict]


# ── Generate SQL only ─────────────────────────────────────────────────────────

@router.post("/report/generate-sql", response_model=GenerateSqlResult)
def generate_sql_only(req: AskRequest, db: Session = Depends(get_db)):
    api_key = req.api_key.strip() or settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(400, detail="No OpenAI API key provided.")

    conn_model = db.query(SourceConnection).filter(SourceConnection.id == req.conn_id).first()
    if not conn_model:
        raise HTTPException(404, detail="Connection not found")

    try:
        top_cols = _build_top_cols(req.conn_id, req.question, api_key, req.embed_model, req.top_k, db)
    except Exception as exc:
        raise HTTPException(400, detail=f"Embedding failed: {str(exc)[:200]}")

    cfg = _to_cfg_from_model(conn_model)
    dialect = cfg.get("dialect") or ("snowflake" if conn_model.source_type == "snowflake" else "mssql")
    skill_prompt = _build_enriched_prompt(req.conn_id, dialect, db)

    _t0 = _time.time()
    try:
        sql = generate_sql(req.question, top_cols, dialect, api_key, req.chat_model, system_prompt=skill_prompt)
        sql = sql.strip()
        if sql.startswith("```"):
            sql = sql.split("\n", 1)[-1]
            sql = sql.rsplit("```", 1)[0].strip()
    except Exception as exc:
        raise HTTPException(400, detail=f"SQL generation failed: {str(exc)[:200]}")

    # Safety guard
    try:
        from api.services.sql_guard import validate_readonly
        validate_readonly(sql)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))

    try:
        from api.services import ai_trace as _at
        _at.store(module="report", conn_id=req.conn_id, model=req.chat_model,
                  prompt=f"NL→SQL (generate-only): {req.question}", response=sql,
                  latency_ms=int((_time.time() - _t0) * 1000), db=db,
                  sql_executed=sql)
    except Exception:
        pass

    return GenerateSqlResult(sql=sql, matched_columns=top_cols[:8])


# ── Main ask endpoint ─────────────────────────────────────────────────────────

@router.post("/report/ask", response_model=AskResult)
def ask_question(req: AskRequest, db: Session = Depends(get_db),
                 current_user=Depends(get_current_user)):
    api_key = req.api_key.strip() or settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(400, detail="No OpenAI API key provided.")

    conn_model = db.query(SourceConnection).filter(SourceConnection.id == req.conn_id).first()
    if not conn_model:
        raise HTTPException(404, detail="Connection not found")

    # Check result cache first
    from api.services import result_cache as _rc
    # (cache key built after SQL is generated below)

    try:
        top_cols = _build_top_cols(req.conn_id, req.question, api_key, req.embed_model, req.top_k, db)
    except Exception as exc:
        raise HTTPException(400, detail=f"Embedding failed: {str(exc)[:200]}")

    cfg = _to_cfg_from_model(conn_model)
    dialect = cfg.get("dialect") or ("snowflake" if conn_model.source_type == "snowflake" else "mssql")

    # Schema agent
    from api.services.schema_agent import build_semantic_model, build_query_explanation, build_follow_up_suggestions
    relations = db.query(CatalogRelation).filter(CatalogRelation.conn_id == req.conn_id).all()
    metadata  = db.query(SchemaMetadata).filter(SchemaMetadata.conn_id == req.conn_id).all()
    semantic_model = build_semantic_model(req.conn_id, req.question, top_cols, relations, metadata, db, api_key)

    skill_prompt = _build_enriched_prompt(req.conn_id, dialect, db)
    # Inject query intent from schema agent
    if semantic_model.get("query_intent"):
        skill_prompt = (skill_prompt or "") + f"\n\n## Query Intent\n{semantic_model['query_intent']}"

    _t0 = _time.time()
    try:
        sql = generate_sql(req.question, top_cols, dialect, api_key, req.chat_model, system_prompt=skill_prompt)
        sql = sql.strip()
        if sql.startswith("```"):
            sql = sql.split("\n", 1)[-1]
            sql = sql.rsplit("```", 1)[0].strip()
    except Exception as exc:
        raise HTTPException(400, detail=f"SQL generation failed: {str(exc)[:200]}")

    # SQL safety guard
    try:
        from api.services.sql_guard import validate_readonly
        validate_readonly(sql)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))

    # Check result cache
    cached = _rc.get_result(sql, req.conn_id)
    if cached:
        return cached

    # Approval gate
    gate = _check_approval_gate(
        conn_model, sql, current_user, db,
        context_type="report_query",
        extra_payload={"question": req.question, "conn_id": req.conn_id, "sql": sql, "limit": req.limit},
    )
    if gate is not None:
        return gate

    # Execute
    cfg["query"] = sql
    try:
        result = preview_data(cfg, limit=req.limit)
    except Exception as exc:
        raise HTTPException(400, detail=f"SQL execution failed: {_clean_error_str(str(exc))}")

    latency = int((_time.time() - _t0) * 1000)

    # Enhanced audit log
    schema_cols = [f"{c['table_name']}.{c['column_name']}" for c in top_cols]
    try:
        from api.services import ai_trace as _at
        _at.store(module="report", conn_id=req.conn_id, model=req.chat_model,
                  prompt=f"NL→SQL question: {req.question}", response=sql,
                  latency_ms=latency, db=db,
                  sql_executed=sql, row_count_returned=result["total"],
                  schema_snapshot=schema_cols)
    except Exception:
        pass

    follow_ups = build_follow_up_suggestions(result["columns"], result["rows"], has_prior_session=False)
    query_exp  = build_query_explanation(semantic_model)

    ask_result = AskResult(
        sql=sql,
        matched_columns=top_cols[:8],
        columns=result["columns"],
        rows=result["rows"],
        total=result["total"],
        confidence=semantic_model.get("confidence", 0.0),
        query_explanation=query_exp,
        follow_up_suggestions=follow_ups,
        ambiguities=semantic_model.get("ambiguities", []),
    )

    _rc.put_result(sql, req.conn_id, ask_result)
    return ask_result


# ── Schema Explorer catalog endpoint ─────────────────────────────────────────

@router.get("/report/catalog/{conn_id}")
def get_report_catalog(conn_id: int, db: Session = Depends(get_db),
                        current_user=Depends(get_current_user)):
    """Catalog data for the Schema Explorer sidebar — no admin role required."""
    conn_model = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn_model:
        raise HTTPException(404, detail="Connection not found")

    cols = db.query(CatalogColumn).filter(CatalogColumn.conn_id == conn_id).order_by(
        CatalogColumn.table_name, CatalogColumn.ordinal_position
    ).all()
    rels = db.query(CatalogRelation).filter(CatalogRelation.conn_id == conn_id).all()
    samples_rows = db.query(CatalogSample).filter(CatalogSample.conn_id == conn_id).all()

    # Build table summary
    table_map: dict[str, list] = {}
    for c in cols:
        t = c.table_name
        if t not in table_map:
            table_map[t] = []
        table_map[t].append({
            "name": c.column_name,
            "data_type": c.data_type or "",
            "is_primary_key": bool(c.is_primary_key),
            "is_nullable": getattr(c, "is_nullable", True),
        })

    tables = [{"name": t, "column_count": len(c_list)} for t, c_list in table_map.items()]

    relations = [{
        "parent_table": r.parent_table,
        "parent_column": r.parent_column,
        "referenced_table": r.referenced_table,
        "referenced_column": r.referenced_column,
    } for r in rels]

    samples: dict[str, list] = {}
    for s in samples_rows:
        try:
            samples[s.table_name] = json.loads(s.sample_json or "[]")
        except Exception:
            pass

    return {
        "tables": tables,
        "columns": table_map,
        "relations": relations,
        "samples": samples,
    }


# ── Session management ────────────────────────────────────────────────────────

class SessionCreateRequest(BaseModel):
    conn_id: int


@router.post("/report/session")
def create_session(req: SessionCreateRequest, db: Session = Depends(get_db),
                   current_user=Depends(get_current_user)):
    session = ReportSession(conn_id=req.conn_id, user_id=current_user.id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"session_id": session.id, "created_at": session.created_at.isoformat()}


@router.get("/report/session/{session_id}")
def get_session(session_id: int, db: Session = Depends(get_db),
                current_user=Depends(get_current_user)):
    session = db.query(ReportSession).filter(ReportSession.id == session_id).first()
    if not session:
        raise HTTPException(404, detail="Session not found")
    msgs = db.query(ReportSessionMessage).filter(
        ReportSessionMessage.session_id == session_id
    ).order_by(ReportSessionMessage.id).all()
    return {
        "session_id": session.id,
        "conn_id": session.conn_id,
        "title": session.title,
        "session_summary": session.session_summary,
        "messages": [{
            "role": m.role, "question": m.question, "sql_generated": m.sql_generated,
            "result_summary": m.result_summary, "sql_confidence": m.sql_confidence,
            "created_at": m.created_at.isoformat(),
        } for m in msgs],
    }


# ── Follow-up ask ─────────────────────────────────────────────────────────────

class FollowUpRequest(BaseModel):
    session_id:  int
    question:    str
    conn_id:     int
    api_key:     str = ""
    embed_model: str = "text-embedding-3-small"
    chat_model:  str = "gpt-4o-mini"
    top_k:       int = 15
    limit:       int = 1000


@router.post("/report/ask-followup", response_model=AskResult)
def ask_followup(req: FollowUpRequest, db: Session = Depends(get_db),
                 current_user=Depends(get_current_user)):
    api_key = req.api_key.strip() or settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(400, detail="No OpenAI API key provided.")

    session = db.query(ReportSession).filter(ReportSession.id == req.session_id).first()
    if not session:
        raise HTTPException(404, detail="Session not found")

    conn_model = db.query(SourceConnection).filter(SourceConnection.id == req.conn_id).first()
    if not conn_model:
        raise HTTPException(404, detail="Connection not found")

    # Build conversation context from prior messages
    prior_msgs = db.query(ReportSessionMessage).filter(
        ReportSessionMessage.session_id == req.session_id,
        ReportSessionMessage.role == "user",
    ).order_by(ReportSessionMessage.id.desc()).limit(5).all()
    prior_msgs.reverse()

    conv_lines = []
    if session.session_summary:
        conv_lines.append(session.session_summary)
    if prior_msgs:
        conv_lines.append("## Prior Questions in This Session")
        for i, m in enumerate(prior_msgs, 1):
            summary = ""
            if m.result_summary:
                try:
                    s = json.loads(m.result_summary)
                    summary = f" Result: {s.get('row_count', '?')} rows."
                except Exception:
                    pass
            conv_lines.append(f"[{i}] Q: {m.question}\n    SQL: {(m.sql_generated or '')[:200]}{summary}")
    conversation_context = "\n".join(conv_lines)

    # Build doc context from uploaded documents
    docs = db.query(ReportSessionDocument).filter(
        ReportSessionDocument.session_id == req.session_id
    ).all()
    doc_context = ""
    if docs:
        doc_lines = ["\n## Uploaded Documents"]
        for doc in docs:
            doc_lines.append(f"\n### {doc.filename}\n{(doc.extracted_text or '')[:8000]}")
        doc_context = "\n".join(doc_lines)

    try:
        top_cols = _build_top_cols(req.conn_id, req.question, api_key, req.embed_model, req.top_k, db)
    except Exception as exc:
        raise HTTPException(400, detail=f"Embedding failed: {str(exc)[:200]}")

    cfg = _to_cfg_from_model(conn_model)
    dialect = cfg.get("dialect") or ("snowflake" if conn_model.source_type == "snowflake" else "mssql")

    from api.services.schema_agent import build_semantic_model, build_query_explanation, build_follow_up_suggestions
    relations = db.query(CatalogRelation).filter(CatalogRelation.conn_id == req.conn_id).all()
    metadata  = db.query(SchemaMetadata).filter(SchemaMetadata.conn_id == req.conn_id).all()
    semantic_model = build_semantic_model(req.conn_id, req.question, top_cols, relations, metadata, db, api_key)

    skill_prompt = _build_enriched_prompt(req.conn_id, dialect, db, conversation_context, doc_context)
    if semantic_model.get("query_intent"):
        skill_prompt = (skill_prompt or "") + f"\n\n## Query Intent\n{semantic_model['query_intent']}"

    _t0 = _time.time()
    try:
        sql = generate_sql(req.question, top_cols, dialect, api_key, req.chat_model, system_prompt=skill_prompt)
        sql = sql.strip()
        if sql.startswith("```"):
            sql = sql.split("\n", 1)[-1]
            sql = sql.rsplit("```", 1)[0].strip()
    except Exception as exc:
        raise HTTPException(400, detail=f"SQL generation failed: {str(exc)[:200]}")

    try:
        from api.services.sql_guard import validate_readonly
        validate_readonly(sql)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))

    # Approval gate
    gate = _check_approval_gate(conn_model, sql, current_user, db,
        context_type="report_query",
        extra_payload={"question": req.question, "conn_id": req.conn_id, "sql": sql, "limit": req.limit})
    if gate is not None:
        return gate

    cfg["query"] = sql
    try:
        result = preview_data(cfg, limit=req.limit)
    except Exception as exc:
        raise HTTPException(400, detail=f"SQL execution failed: {_clean_error_str(str(exc))}")

    latency = int((_time.time() - _t0) * 1000)

    # Persist session messages
    result_summary = json.dumps({
        "row_count": result["total"],
        "col_names": result["columns"][:10],
        "sample_rows": result["rows"][:5],
    })
    db.add(ReportSessionMessage(
        session_id=req.session_id, role="user", question=req.question,
        sql_generated=sql, result_summary=result_summary,
        sql_confidence=semantic_model.get("confidence"),
        schema_used=json.dumps([f"{c['table_name']}.{c['column_name']}" for c in top_cols]),
    ))

    # Update session title if first message
    if not session.title and req.question:
        session.title = req.question[:200]

    # Session summarization: compress after SESSION_COMPRESS_AFTER turns
    total_msgs = db.query(ReportSessionMessage).filter(
        ReportSessionMessage.session_id == req.session_id
    ).count()
    if total_msgs > SESSION_COMPRESS_AFTER * 2:
        _compress_session(session, db, api_key, req.chat_model)

    db.commit()

    try:
        from api.services import ai_trace as _at
        _at.store(module="report", conn_id=req.conn_id, model=req.chat_model,
                  prompt=f"Follow-up Q: {req.question}", response=sql,
                  latency_ms=latency, db=db,
                  sql_executed=sql, row_count_returned=result["total"],
                  schema_snapshot=[f"{c['table_name']}.{c['column_name']}" for c in top_cols])
    except Exception:
        pass

    follow_ups = build_follow_up_suggestions(result["columns"], result["rows"], has_prior_session=True)
    query_exp  = build_query_explanation(semantic_model)

    return AskResult(
        sql=sql, matched_columns=top_cols[:8],
        columns=result["columns"], rows=result["rows"], total=result["total"],
        confidence=semantic_model.get("confidence", 0.0),
        query_explanation=query_exp, follow_up_suggestions=follow_ups,
        ambiguities=semantic_model.get("ambiguities", []),
    )


def _compress_session(session: ReportSession, db: Session, api_key: str, model: str):
    """Compress older messages into session_summary, then delete them."""
    old_msgs = db.query(ReportSessionMessage).filter(
        ReportSessionMessage.session_id == session.id
    ).order_by(ReportSessionMessage.id).limit(SESSION_COMPRESS_AFTER).all()

    if not old_msgs:
        return

    history = "\n".join(
        f"Q: {m.question}\nSQL: {(m.sql_generated or '')[:200]}" for m in old_msgs if m.question
    )

    summary_text = f"## Session Summary (compressed)\n{history}"
    if api_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            resp = client.chat.completions.create(
                model=model, temperature=0, max_tokens=300,
                messages=[
                    {"role": "system", "content": "Summarize this SQL query conversation history in 3-5 sentences for context. Focus on tables and columns used."},
                    {"role": "user", "content": history[:4000]},
                ]
            )
            summary_text = f"## Session Summary (compressed)\n{resp.choices[0].message.content}"
        except Exception:
            pass

    session.session_summary = (session.session_summary or "") + "\n" + summary_text
    for msg in old_msgs:
        db.delete(msg)


# ── Document upload ───────────────────────────────────────────────────────────

ALLOWED_MIME_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/csv": "csv",
    "text/plain": "txt",
}


@router.post("/report/session/{session_id}/upload")
async def upload_session_doc(session_id: int, file: UploadFile = File(...),
                              db: Session = Depends(get_db),
                              current_user=Depends(get_current_user)):
    session = db.query(ReportSession).filter(ReportSession.id == session_id).first()
    if not session:
        raise HTTPException(404, detail="Session not found")

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, detail=f"File exceeds 10 MB limit.")

    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_TYPES:
        raise HTTPException(415, detail=f"File type '{ext}' not supported. Allowed: {', '.join(ALLOWED_TYPES)}")

    from api.services.doc_extractor import extract as _extract
    try:
        extracted = _extract(filename, content, ext)
    except Exception as exc:
        raise HTTPException(400, detail=f"Failed to extract document: {str(exc)[:200]}")

    doc = ReportSessionDocument(
        session_id=session_id,
        filename=filename,
        file_type=ext,
        extracted_text=extracted["text"],
        row_count=extracted.get("row_count"),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    return {
        "doc_id": doc.id,
        "filename": doc.filename,
        "file_type": doc.file_type,
        "row_count": doc.row_count,
        "preview": extracted.get("summary", "")[:500],
    }


@router.delete("/report/session/{session_id}/docs/{doc_id}", status_code=204)
def delete_session_doc(session_id: int, doc_id: int, db: Session = Depends(get_db),
                        current_user=Depends(get_current_user)):
    doc = db.query(ReportSessionDocument).filter(
        ReportSessionDocument.id == doc_id,
        ReportSessionDocument.session_id == session_id,
    ).first()
    if not doc:
        raise HTTPException(404, detail="Document not found")
    db.delete(doc)
    db.commit()


# ── Insight Engine ────────────────────────────────────────────────────────────

class InsightRequest(BaseModel):
    columns:  list[str]
    rows:     list[dict]
    use_llm:  bool = False
    question: str = ""
    api_key:  str = ""


@router.post("/report/insights")
def get_insights(req: InsightRequest):
    from api.services.insight_engine import analyze, analyze_with_narrative
    if req.use_llm and req.question:
        api_key = req.api_key.strip() or settings.OPENAI_API_KEY.strip()
        return analyze_with_narrative(req.columns, req.rows[:1000], req.question, api_key)
    return analyze(req.columns, req.rows[:1000])


# ── PPT Export ────────────────────────────────────────────────────────────────

class PptExportRequest(BaseModel):
    conn_id:      int
    question:     str = "Report"
    columns:      list[str]
    rows:         list[dict]
    chart_data:   Optional[list[dict]] = None
    use_insights: bool = True
    api_key:      str = ""


@router.post("/report/export-ppt")
def export_ppt(req: PptExportRequest, db: Session = Depends(get_db),
               current_user=Depends(get_current_user)):
    conn_model = db.query(SourceConnection).filter(SourceConnection.id == req.conn_id).first()
    conn_name = conn_model.name if conn_model else "Unknown"

    # No approval gate here — rows are already in the browser from a previously approved/run query.
    # Gating the export would be redundant and confusing.

    from api.services.insight_engine import analyze
    from api.services.ppt_generator import build_ppt
    insights = analyze(req.columns, req.rows[:1000]) if req.use_insights else {}

    try:
        ppt_bytes = build_ppt(req.question, conn_name, insights, req.columns, req.rows[:500], req.chart_data)
    except RuntimeError as exc:
        raise HTTPException(500, detail=str(exc))

    try:
        from api.services import ai_trace as _at
        _at.store(module="report", conn_id=req.conn_id, model="n/a",
                  prompt=f"PPT export: {req.question}", response="",
                  latency_ms=0, db=db,
                  row_count_returned=len(req.rows), export_action="ppt")
    except Exception:
        pass

    return Response(
        content=ppt_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="report.pptx"'},
    )


# ── Pending approval lookup ──────────────────────────────────────────────────

@router.get("/report/pending-approvals")
def get_pending_approvals(conn_id: int, db: Session = Depends(get_db),
                          current_user=Depends(get_current_user)):
    """Return any pending/approved report_query requests the user triggered for this connection."""
    from api.models import ApprovalRequest as AR
    reqs = db.query(AR).filter(
        AR.triggered_by == current_user.id,
        AR.context_type == "report_query",
        AR.status.in_(["pending", "in_progress", "approved"]),
    ).order_by(AR.created_at.desc()).limit(5).all()
    return [{"id": r.id, "status": r.status, "created_at": str(r.created_at)} for r in reqs]


# ── Approval auto-resume ──────────────────────────────────────────────────────

@router.post("/report/resume/{approval_request_id}", response_model=AskResult)
def resume_after_approval(approval_request_id: int, db: Session = Depends(get_db),
                           current_user=Depends(get_current_user)):
    req_obj = db.query(ApprovalRequest).filter(ApprovalRequest.id == approval_request_id).first()
    if not req_obj:
        raise HTTPException(404, detail="Approval request not found")
    if req_obj.status != "approved":
        raise HTTPException(400, detail=f"Request is not yet approved (status: {req_obj.status})")

    if not req_obj.context_payload:
        # Fallback: look for a sibling request with the same sql_hash that has a payload
        if req_obj.sql_hash:
            sibling = db.query(ApprovalRequest).filter(
                ApprovalRequest.sql_hash == req_obj.sql_hash,
                ApprovalRequest.context_payload != None,  # noqa: E711
            ).first()
            if sibling:
                req_obj.context_payload = sibling.context_payload
                db.commit()
        if not req_obj.context_payload:
            raise HTTPException(400, detail=(
                "No payload stored for this approval request. "
                "Please re-submit the query — the original SQL could not be recovered."
            ))

    payload = json.loads(req_obj.context_payload)
    sql = payload.get("sql", "")
    conn_id = payload.get("conn_id")
    limit = payload.get("limit", 1000)

    if not sql or not conn_id:
        raise HTTPException(400, detail="Incomplete payload in approval request")

    conn_model = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn_model:
        raise HTTPException(404, detail="Connection not found")

    cfg = _to_cfg_from_model(conn_model)
    cfg["query"] = sql
    try:
        result = preview_data(cfg, limit=limit)
    except Exception as exc:
        raise HTTPException(400, detail=f"SQL execution failed: {_clean_error_str(str(exc))}")

    # Clear payload after use
    req_obj.context_payload = None
    db.commit()

    return AskResult(
        sql=sql, matched_columns=[], columns=result["columns"],
        rows=result["rows"], total=result["total"],
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
            id=r.id, conn_id=r.conn_id, name=r.name, query_sql=r.query_sql,
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
        id=rec.id, conn_id=rec.conn_id, name=rec.name, query_sql=rec.query_sql,
        created_at=rec.created_at.strftime("%Y-%m-%d %H:%M") if rec.created_at else ""
    )


@router.delete("/reports/saved/{report_id}", status_code=204)
def delete_report(report_id: int, db: Session = Depends(get_db)):
    rec = db.query(SavedReport).filter(SavedReport.id == report_id).first()
    if not rec:
        raise HTTPException(404, detail="Report not found")
    db.delete(rec)
    db.commit()
