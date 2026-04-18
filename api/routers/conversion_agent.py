"""
routers/conversion_agent.py — Agent-based conversion pipeline endpoints.

Endpoints (all prefixed with /api):
  POST   /conversion-agent/run                             — trigger Manager pipeline
  GET    /conversion-agent/{conn_id}/run-logs              — list ConversionAgentRunLog rows
  GET    /conversion-agent/{conn_id}/versions              — list ConversionQueryVersion rows
  GET    /conversion-agent/{conn_id}/versions/{vid}        — single version sql + snapshot
  GET    /conversion-agent/{conn_id}/validation            — list ConversionValidationResult rows
  GET    /conversion-agent/{conn_id}/profiles              — list ConversionColumnProfile rows
  POST   /conversion-agent/{conn_id}/profile               — trigger re-profiling
  GET    /conversion-agent/{conn_id}/value-mappings        — list ConversionValueMapping rows
  POST   /conversion-agent/{conn_id}/value-mappings/suggest — suggest mappings for all categorical cols
  PUT    /conversion-agent/{conn_id}/value-mappings/{mid}  — update a single mapping
  DELETE /conversion-agent/{conn_id}/value-mappings/{mid}  — delete a mapping
"""
from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import (
    ConversionAgentRunLog, ConversionQueryVersion, ConversionValidationResult,
    ConversionColumnProfile, ConversionValueMapping, SourceConnection,
    Mapping, MappingRow, GeneratedQuery,
)

router = APIRouter()


# ── Request / Response schemas ─────────────────────────────────────────────────

class RunRequest(BaseModel):
    conn_id: int
    max_attempts: int = 3
    user_hints: list[str] = []   # extra instructions injected as initial validator hints


class TransformRequest(BaseModel):
    instruction: str             # natural-language description of the transformation
    dialect: str = "mssql"


class ValueMappingUpdate(BaseModel):
    target_value: Optional[str] = None
    status: Optional[str] = None   # pending | approved | rejected


class QueryUpdateRequest(BaseModel):
    sql_text: str


# ── Endpoints — fixed paths BEFORE parameterized ──────────────────────────────

@router.post("/conversion-agent/run")
async def run_conversion_agent(req: RunRequest, db: Session = Depends(get_db)):
    """Trigger the full Manager → Mapper → Transformer → Validator pipeline."""
    from api.services.agents.manager_agent import ManagerAgent

    conn = db.query(SourceConnection).get(req.conn_id)
    if not conn:
        raise HTTPException(404, f"Connection {req.conn_id} not found.")

    # Run in thread pool to avoid blocking the event loop
    loop = asyncio.get_event_loop()
    manager = ManagerAgent(conn_id=req.conn_id, db=db)
    result = await loop.run_in_executor(
        None, lambda: manager.run(req.max_attempts, initial_hints=req.user_hints)
    )

    return {
        "status":             result.status,
        "attempts":           result.attempts,
        "version":            result.version,
        "run_log_id":         result.run_log_id,
        "sql_preview":        (result.sql or "")[:300],
        "xml_count":          len(result.xml_records),
        "xml_records":        result.xml_records[:20],
        "validation_summary": result.validation_summary,
        "errors":             result.errors,
    }


# ── Per-connection endpoints ───────────────────────────────────────────────────

@router.get("/conversion-agent/{conn_id}/run-logs")
def get_run_logs(conn_id: int, limit: int = 50, db: Session = Depends(get_db)):
    """List recent ConversionAgentRunLog rows for this connection."""
    rows = (
        db.query(ConversionAgentRunLog)
        .filter_by(conn_id=conn_id)
        .order_by(ConversionAgentRunLog.id.desc())
        .limit(limit)
        .all()
    )
    return [_log_to_dict(r) for r in rows]


@router.get("/conversion-agent/{conn_id}/versions")
def get_versions(conn_id: int, db: Session = Depends(get_db)):
    """List ConversionQueryVersion rows for this connection."""
    rows = (
        db.query(ConversionQueryVersion)
        .filter_by(conn_id=conn_id)
        .order_by(ConversionQueryVersion.version.desc())
        .all()
    )
    return [
        {
            "id":               r.id,
            "conn_id":          r.conn_id,
            "version":          r.version,
            "sql_text":         r.sql_text,
            "mapping_snapshot": r.mapping_snapshot,
            "agent_run_id":     r.agent_run_id,
            "created_at":       str(r.created_at),
        }
        for r in rows
    ]


@router.get("/conversion-agent/{conn_id}/versions/{vid}")
def get_version(conn_id: int, vid: int, db: Session = Depends(get_db)):
    """Get a single version by id."""
    row = db.query(ConversionQueryVersion).filter_by(id=vid, conn_id=conn_id).first()
    if not row:
        raise HTTPException(404, "Version not found.")
    return {
        "id":               row.id,
        "conn_id":          row.conn_id,
        "version":          row.version,
        "sql_text":         row.sql_text,
        "mapping_snapshot": row.mapping_snapshot,
        "agent_run_id":     row.agent_run_id,
        "created_at":       str(row.created_at),
    }


@router.get("/conversion-agent/{conn_id}/validation")
def get_validation_results(conn_id: int, limit: int = 200, db: Session = Depends(get_db)):
    """List ConversionValidationResult rows for this connection."""
    rows = (
        db.query(ConversionValidationResult)
        .filter_by(conn_id=conn_id)
        .order_by(ConversionValidationResult.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id":         r.id,
            "conn_id":    r.conn_id,
            "xml_id":     r.xml_id,
            "check_name": r.check_name,
            "passed":     bool(r.passed),
            "detail":     r.detail,
            "created_at": str(r.created_at),
        }
        for r in rows
    ]


@router.get("/conversion-agent/{conn_id}/mapping-rows")
def get_mapping_rows(conn_id: int, db: Session = Depends(get_db)):
    """Return the active Mapping record + all MappingRow entries for this connection."""
    mapping = (
        db.query(Mapping)
        .filter_by(conn_id=conn_id, is_active=True)
        .order_by(Mapping.id.desc())
        .first()
    )
    if not mapping:
        return {"identifier_column": None, "identifier_table": None, "rows": []}

    rows = (
        db.query(MappingRow)
        .filter_by(mapping_id=mapping.id)
        .order_by(MappingRow.sort_order)
        .all()
    )
    return {
        "identifier_column": mapping.identifier_column,
        "identifier_table":  mapping.identifier_table,
        "rows": [
            {
                "id":                   r.id,
                "source_table":         r.source_sheet,
                "source_column":        r.source_column,
                "target_path":          r.target_path,
                "formula":              r.formula,
                "confidence":           r.confidence,
                "transform_expression": r.transform_expression,
                "transform_sql":        r.transform_sql,
            }
            for r in rows
        ],
    }


@router.put("/conversion-agent/{conn_id}/mapping-rows/{row_id}")
def update_mapping_row(conn_id: int, row_id: int,
                       body: dict, db: Session = Depends(get_db)):
    """Manually override a single mapping row's source_column or formula."""
    mapping = (
        db.query(Mapping)
        .filter_by(conn_id=conn_id, is_active=True)
        .order_by(Mapping.id.desc())
        .first()
    )
    if not mapping:
        raise HTTPException(404, "No active mapping found for this connection.")
    row = db.query(MappingRow).filter_by(id=row_id, mapping_id=mapping.id).first()
    if not row:
        raise HTTPException(404, "Mapping row not found.")
    if "source_column" in body:
        row.source_column = body["source_column"]
        row.formula       = f"{{{body['source_column']}}}"
        row.confidence    = None   # null = manual override
    if "formula" in body:
        row.formula = body["formula"]
    db.commit()
    return {
        "id":            row.id,
        "source_table":  row.source_sheet,
        "source_column": row.source_column,
        "target_path":   row.target_path,
        "formula":       row.formula,
        "confidence":    row.confidence,
    }


@router.post("/conversion-agent/{conn_id}/mapping-rows/{row_id}/ai-transform")
def ai_transform_mapping_row(conn_id: int, row_id: int, req: TransformRequest,
                              db: Session = Depends(get_db)):
    """
    Use AI to generate a Python expression + SQL expression for transforming
    a mapped field's value before XML generation.

    The python_expression is saved to MappingRow.transform_expression and applied
    at generate_all_xml time (value = raw column value from SQL result).
    The sql_expression is saved to transform_sql for display/audit.
    """
    from api.config import settings
    import time

    mapping = (
        db.query(Mapping)
        .filter_by(conn_id=conn_id, is_active=True)
        .order_by(Mapping.id.desc())
        .first()
    )
    if not mapping:
        raise HTTPException(404, "No active mapping found for this connection.")
    row = db.query(MappingRow).filter_by(id=row_id, mapping_id=mapping.id).first()
    if not row:
        raise HTTPException(404, "Mapping row not found.")

    # Build context for the AI prompt
    target_path    = row.target_path or ""
    source_column  = row.source_column or ""
    source_table   = row.source_sheet or ""
    dialect        = req.dialect or "mssql"
    instruction    = req.instruction.strip()

    system_prompt = (
        "You are a data transformation expert. Given a field's context and a transformation "
        "instruction, generate BOTH a SQL expression and a Python expression for the transform.\n\n"
        "Rules:\n"
        "1. SQL expression: valid for the specified SQL dialect. Use the column as a bare name "
        "(the query builder will prefix with the correct table alias). Do NOT wrap in SELECT.\n"
        "2. Python expression: a single Python expression (not a statement) where `value` is the "
        "raw string value of the field. It must evaluate to a string. "
        "Use only built-in functions — no imports.\n"
        "3. Return ONLY valid JSON with keys: sql_expression, python_expression, explanation.\n"
        "4. explanation: one concise sentence describing what the transform does.\n\n"
        "Example output:\n"
        '{"sql_expression": "CONVERT(VARCHAR(10), [BirthDate], 23)", '
        '"python_expression": "str(value)[:10] if value else \'\'", '
        '"explanation": "Formats BirthDate as YYYY-MM-DD."}'
    )

    user_prompt = (
        f"Field: {target_path}\n"
        f"Source column: {source_table}.{source_column}\n"
        f"Dialect: {dialect}\n"
        f"Transformation requested: {instruction}"
    )

    sql_expression    = ""
    python_expression = ""
    explanation       = ""
    error_msg         = None

    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY.strip())
        t0 = time.time()
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=400,
        )
        latency_ms = int((time.time() - t0) * 1000)
        import json as _json
        data = _json.loads(resp.choices[0].message.content or "{}")
        sql_expression    = data.get("sql_expression", "")
        python_expression = data.get("python_expression", "")
        explanation       = data.get("explanation", "")

        # Log AI call
        try:
            from api.models import AITraceLog
            db.add(AITraceLog(
                module="ai_transform",
                conn_id=conn_id,
                model="gpt-4o-mini",
                prompt_text=user_prompt[:2000],
                response_text=resp.choices[0].message.content[:2000],
                tokens_in=resp.usage.prompt_tokens if resp.usage else None,
                tokens_out=resp.usage.completion_tokens if resp.usage else None,
                latency_ms=latency_ms,
            ))
        except Exception:
            pass

    except Exception as exc:
        error_msg = str(exc)

    if error_msg:
        raise HTTPException(500, f"AI transform failed: {error_msg}")

    # Validate the Python expression is safe (no imports, no exec/eval)
    forbidden = ["import ", "__", "exec(", "eval(", "open(", "os.", "sys."]
    for bad in forbidden:
        if bad in python_expression:
            raise HTTPException(400, f"Generated expression contains unsafe token: {bad!r}")

    # Save to MappingRow
    row.transform_expression = python_expression
    row.transform_sql        = sql_expression
    db.commit()

    return {
        "id":                row.id,
        "target_path":       target_path,
        "source_column":     source_column,
        "sql_expression":    sql_expression,
        "python_expression": python_expression,
        "explanation":       explanation,
        "transform_expression": python_expression,
        "transform_sql":        sql_expression,
    }


@router.delete("/conversion-agent/{conn_id}/mapping-rows/{row_id}/transform")
def clear_transform(conn_id: int, row_id: int, db: Session = Depends(get_db)):
    """Remove the AI-generated transform from a mapping row."""
    mapping = (
        db.query(Mapping)
        .filter_by(conn_id=conn_id, is_active=True)
        .order_by(Mapping.id.desc())
        .first()
    )
    if not mapping:
        raise HTTPException(404, "No active mapping found.")
    row = db.query(MappingRow).filter_by(id=row_id, mapping_id=mapping.id).first()
    if not row:
        raise HTTPException(404, "Mapping row not found.")
    row.transform_expression = None
    row.transform_sql        = None
    db.commit()
    return {"cleared": True}


@router.post("/conversion-agent/{conn_id}/mapping-rows/{row_id}/rematch")
def rematch_mapping_row(conn_id: int, row_id: int, db: Session = Depends(get_db)):
    """
    Re-run embedding similarity for a single XML path and update its source column
    to the best match found. Returns the updated row.
    """
    mapping = (
        db.query(Mapping)
        .filter_by(conn_id=conn_id, is_active=True)
        .order_by(Mapping.id.desc())
        .first()
    )
    if not mapping:
        raise HTTPException(404, "No active mapping found.")
    row = db.query(MappingRow).filter_by(id=row_id, mapping_id=mapping.id).first()
    if not row:
        raise HTTPException(404, "Mapping row not found.")
    if not row.target_path:
        raise HTTPException(400, "Row has no target_path to match against.")

    try:
        from api.services.matching import run_matching
        m = run_matching(conn_id, db)
        paths        = m.get("paths", [])
        matched_cols = m.get("matched_cols", [])
        match_scores = m.get("match_scores", [])

        # Find the best match for this specific path
        best_col   = None
        best_score = 0.0
        for path, col, score in zip(paths, matched_cols, match_scores):
            if path == row.target_path and col and score > best_score:
                best_col   = col
                best_score = score

        if best_col:
            row.source_sheet  = best_col["table_name"]
            row.source_column = best_col["column_name"]
            row.formula       = f"{{{best_col['column_name']}}}"
            row.confidence    = int(best_score * 100)
            db.commit()
    except Exception as exc:
        raise HTTPException(500, f"Re-match failed: {exc}")

    return {
        "id":            row.id,
        "source_table":  row.source_sheet,
        "source_column": row.source_column,
        "target_path":   row.target_path,
        "formula":       row.formula,
        "confidence":    row.confidence,
    }


@router.get("/conversion-agent/{conn_id}/profiles")
def get_profiles(conn_id: int, db: Session = Depends(get_db)):
    """List ConversionColumnProfile rows for this connection."""
    rows = (
        db.query(ConversionColumnProfile)
        .filter_by(conn_id=conn_id)
        .order_by(ConversionColumnProfile.table_name, ConversionColumnProfile.column_name)
        .all()
    )
    return [
        {
            "id":             r.id,
            "conn_id":        r.conn_id,
            "table_name":     r.table_name,
            "column_name":    r.column_name,
            "null_pct":       r.null_pct,
            "distinct_count": r.distinct_count,
            "total_count":    r.total_count,
            "min_val":        r.min_val,
            "max_val":        r.max_val,
            "pattern_hint":   r.pattern_hint,
            "profiled_at":    str(r.profiled_at),
        }
        for r in rows
    ]


@router.post("/conversion-agent/{conn_id}/profile")
def trigger_profile(conn_id: int, db: Session = Depends(get_db)):
    """Manually trigger column profiling for this connection."""
    from api.services.profiler import profile_connection
    conn = db.query(SourceConnection).get(conn_id)
    if not conn:
        raise HTTPException(404, f"Connection {conn_id} not found.")

    from api.services.encryption import decrypt
    cfg = {
        "source_type": conn.source_type,
        "dialect":     conn.dialect,
        "host":        conn.host,
        "port":        conn.port,
        "database":    conn.database_name,
        "schema":      conn.schema_name,
        "username":    conn.username,
        "password":    decrypt(conn.password_enc) if conn.password_enc else "",
    }
    try:
        results = profile_connection(conn_id, db, cfg, conn.dialect or "mssql")
        return {"profiled_columns": len(results)}
    except Exception as exc:
        raise HTTPException(500, f"Profiling failed: {exc}")


@router.get("/conversion-agent/{conn_id}/value-mappings")
def get_value_mappings(conn_id: int, table_name: Optional[str] = None,
                       db: Session = Depends(get_db)):
    """List ConversionValueMapping rows for this connection."""
    q = db.query(ConversionValueMapping).filter_by(conn_id=conn_id)
    if table_name:
        q = q.filter_by(table_name=table_name)
    rows = q.order_by(
        ConversionValueMapping.table_name,
        ConversionValueMapping.column_name,
        ConversionValueMapping.source_value,
    ).all()
    return [_mapping_to_dict(r) for r in rows]


@router.post("/conversion-agent/{conn_id}/value-mappings/suggest")
def suggest_value_mappings(conn_id: int, db: Session = Depends(get_db)):
    """
    Run value mapping suggestions for all categorical columns in this connection.
    Returns count of new mappings created.
    """
    from api.services.profiler import get_cached_profiles
    from api.services.value_mapper import suggest_mappings, save_mappings
    from api.config import settings

    conn = db.query(SourceConnection).get(conn_id)
    if not conn:
        raise HTTPException(404, f"Connection {conn_id} not found.")

    profiles = get_cached_profiles(conn_id, db)
    categorical = {k: v for k, v in profiles.items() if v.get("pattern_hint") == "categorical"}
    if not categorical:
        return {"message": "No categorical columns found. Run profiling first.", "new_mappings": 0}

    from api.services.encryption import decrypt
    cfg = {
        "source_type": conn.source_type,
        "dialect":     conn.dialect,
        "host":        conn.host,
        "port":        conn.port,
        "database":    conn.database_name,
        "schema":      conn.schema_name,
        "username":    conn.username,
        "password":    decrypt(conn.password_enc) if conn.password_enc else "",
    }
    dialect = conn.dialect or "mssql"

    client = None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY.strip())
    except Exception:
        pass

    from api.services.connector import preview_data
    total_new = 0
    for col_key, profile in categorical.items():
        tbl, col = profile["table_name"], profile["column_name"]
        try:
            if dialect in ("snowflake", "postgresql", "mysql"):
                q = f'SELECT DISTINCT "{col}" FROM "{tbl}" LIMIT 50'
            else:
                q = f"SELECT DISTINCT TOP 50 [{col}] FROM [{tbl}] WITH (NOLOCK)"
            result = preview_data({**cfg, "query": q}, limit=50)
            distinct_vals = [str(r[0]) for r in result.get("rows", []) if r and r[0] is not None]
        except Exception:
            continue

        suggestions = suggest_mappings(conn_id, tbl, col, distinct_vals, db, client)
        if suggestions:
            save_mappings(conn_id, tbl, col, suggestions, db)
            total_new += len(suggestions)

    return {"new_mappings": total_new, "categorical_columns_checked": len(categorical)}


@router.put("/conversion-agent/{conn_id}/value-mappings/{mid}")
def update_value_mapping(conn_id: int, mid: int, body: ValueMappingUpdate,
                          db: Session = Depends(get_db)):
    """Update a single value mapping (user override sets type to 'manual')."""
    row = db.query(ConversionValueMapping).filter_by(id=mid, conn_id=conn_id).first()
    if not row:
        raise HTTPException(404, "Mapping not found.")

    if body.target_value is not None:
        row.target_value = body.target_value
        row.mapping_type = "manual"   # user edit always becomes manual
        row.status = "approved"       # manual = auto-approved

    if body.status is not None:
        if body.status not in ("pending", "approved", "rejected"):
            raise HTTPException(400, "status must be pending | approved | rejected")
        row.status = body.status
        if body.status == "approved" and row.mapping_type == "ai":
            row.mapping_type = "ai"  # keep type but approve

    db.commit()
    return _mapping_to_dict(row)


@router.put("/conversion-agent/{conn_id}/query")
def update_query(conn_id: int, req: QueryUpdateRequest, db: Session = Depends(get_db)):
    """
    Save a manually edited SQL query for this connection.
    Upserts into conversion_generated_queries (most recent row for this conn_id)
    and marks generated_by='manual'.
    """
    if not req.sql_text.strip():
        raise HTTPException(400, "sql_text must not be empty.")

    gq = (
        db.query(GeneratedQuery)
        .filter_by(conn_id=conn_id)
        .order_by(GeneratedQuery.id.desc())
        .first()
    )
    if gq:
        gq.query_sql    = req.sql_text
        gq.generated_by = "manual"
    else:
        gq = GeneratedQuery(conn_id=conn_id, query_sql=req.sql_text, generated_by="manual")
        db.add(gq)
    db.commit()
    db.refresh(gq)
    return {"id": gq.id, "conn_id": gq.conn_id, "query_sql": gq.query_sql, "generated_by": gq.generated_by}


@router.delete("/conversion-agent/{conn_id}/value-mappings/{mid}")
def delete_value_mapping(conn_id: int, mid: int, db: Session = Depends(get_db)):
    """Delete a single value mapping."""
    row = db.query(ConversionValueMapping).filter_by(id=mid, conn_id=conn_id).first()
    if not row:
        raise HTTPException(404, "Mapping not found.")
    db.delete(row)
    db.commit()
    return {"deleted": True}


# ── Serializers ───────────────────────────────────────────────────────────────

def _log_to_dict(r: ConversionAgentRunLog) -> dict:
    return {
        "id":             r.id,
        "conn_id":        r.conn_id,
        "agent_name":     r.agent_name,
        "attempt":        r.attempt,
        "status":         r.status,
        "input_summary":  r.input_summary,
        "output_summary": r.output_summary,
        "duration_ms":    r.duration_ms,
        "created_at":     str(r.created_at),
    }


def _mapping_to_dict(r: ConversionValueMapping) -> dict:
    return {
        "id":           r.id,
        "conn_id":      r.conn_id,
        "table_name":   r.table_name,
        "column_name":  r.column_name,
        "source_value": r.source_value,
        "target_value": r.target_value,
        "confidence":   r.confidence,
        "mapping_type": r.mapping_type,
        "status":       r.status,
        "expires_at":   str(r.expires_at) if r.expires_at else None,
        "created_at":   str(r.created_at),
    }
