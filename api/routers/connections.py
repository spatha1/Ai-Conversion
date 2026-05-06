# ═══════════════════════════════════════════════════════════
# routers/connections.py
#
# Endpoints:
#   GET    /api/connections            — list saved connections
#   POST   /api/connections            — save new connection
#   GET    /api/connections/{id}       — get one (passwords masked)
#   PUT    /api/connections/{id}       — update
#   DELETE /api/connections/{id}       — delete
#   POST   /api/connections/{id}/test  — test using STORED credentials
#   POST   /api/connections/{id}/preview — preview using STORED credentials
#
#   POST   /api/sources/test           — ad-hoc test  (form, not saved)
#   POST   /api/sources/preview        — ad-hoc preview (form, not saved)
# ═══════════════════════════════════════════════════════════
import xml.etree.ElementTree as ET
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import SourceConnection
from api.schemas import (
    ConnectionCreate, ConnectionUpdate, ConnectionOut,
    AdHocConnectionRequest, TestResult, PreviewResult,
)
from api.services.encryption import encrypt, decrypt
from api.services.connector import test_connection, preview_data

from api.dependencies import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])


def _clean_error_str(raw: str) -> str:
    """Strip SQLAlchemy/pyodbc boilerplate, return only the human-readable message."""
    import re
    raw = raw.split("\n(Background on this error")[0].strip()
    segments = re.findall(r'\][^\[;(]{5,}', raw)
    if segments:
        for seg in reversed(segments):
            clean = seg.lstrip('] \t').strip().rstrip('.')
            if len(clean) > 15 and not re.fullmatch(r'[\d\s\-]+', clean):
                return clean
    match = re.match(r'\([\w.]+\)\s+(.*)', raw, re.DOTALL)
    if match:
        return match.group(1)[:300].strip()
    return raw[:300]


# ── Helpers ──────────────────────────────────────────────────

def _to_cfg_from_model(conn: SourceConnection) -> dict:
    """Build a connector config dict from a stored model, decrypting credentials."""
    return {
        "source_type":  conn.source_type,
        # SQL
        "dialect":      conn.dialect,
        "host":         conn.host,
        "port":         conn.port,
        "database":     conn.database_name,
        "schema":       conn.schema_name,
        "username":     conn.username,
        "password":     decrypt(conn.password_enc),
        # Snowflake
        "account":      conn.sf_account,
        "warehouse":    conn.sf_warehouse,
        "role":         conn.sf_role,
        "sf_database":  conn.sf_database,
        "sf_schema":    conn.sf_schema,
        "sf_username":  conn.sf_username,
        "sf_password":  decrypt(conn.sf_password_enc),
        "private_key":  decrypt(conn.sf_private_key_enc),
        "sf_private_key_passphrase": decrypt(conn.sf_private_key_passphrase_enc),
        # Shared
        "query":        conn.query_text,
        "sheet_alias":  conn.sheet_alias,
    }


def _apply_create(data: ConnectionCreate) -> dict:
    """Map schema → model kwargs, encrypting passwords."""
    return {
        "name":         data.name,
        "source_type":  data.source_type,
        "project_id":   data.project_id,
        "dialect":      data.dialect,
        "host":         data.host,
        "port":         data.port,
        "database_name": data.database_name,
        "schema_name":  data.schema_name,
        "username":     data.username,
        "password_enc": encrypt(data.password),
        "sf_account":   data.sf_account,
        "sf_warehouse": data.sf_warehouse,
        "sf_role":      data.sf_role,
        "sf_database":  data.sf_database,
        "sf_schema":    data.sf_schema,
        "sf_username":  data.sf_username,
        "sf_password_enc":              encrypt(data.sf_password),
        "sf_private_key_enc":           encrypt(data.sf_private_key),
        "sf_private_key_passphrase_enc": encrypt(data.sf_private_key_passphrase),
        "query_text":   data.query_text,
        "sheet_alias":  data.sheet_alias or "Sheet1",
    }


# ── CRUD ─────────────────────────────────────────────────────

@router.get("/connections", response_model=list[ConnectionOut])
def list_connections(
    source_type: str | None = Query(None, description="Filter by 'sql' or 'snowflake'"),
    project_id: int | None = Query(None, description="Filter by project"),
    global_only: bool = Query(False, description="Return only global (no-project) connections"),
    include_global: bool = Query(False, description="Include global connections alongside project ones"),
    db: Session = Depends(get_db),
):
    q = db.query(SourceConnection).filter(SourceConnection.is_active == True)
    if global_only:
        q = q.filter(SourceConnection.project_id == None)
    elif project_id is not None:
        if include_global:
            q = q.filter(
                (SourceConnection.project_id == project_id) | (SourceConnection.project_id == None)
            )
        else:
            q = q.filter(SourceConnection.project_id == project_id)
    if source_type:
        q = q.filter(SourceConnection.source_type == source_type)
    return [ConnectionOut.from_orm_with_key_flag(c) for c in q.order_by(SourceConnection.updated_at.desc()).all()]


@router.post("/connections", response_model=ConnectionOut, status_code=201)
def create_connection(data: ConnectionCreate, db: Session = Depends(get_db)):
    dup_q = db.query(SourceConnection).filter(
        SourceConnection.name == data.name,
        SourceConnection.is_active == True,
    )
    if data.project_id is not None:
        dup_q = dup_q.filter(SourceConnection.project_id == data.project_id)
    existing = dup_q.first()
    if existing:
        raise HTTPException(status_code=409, detail=f"A connection named '{data.name}' already exists in this project. Please use a different name.")
    conn = SourceConnection(**_apply_create(data))
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return ConnectionOut.from_orm_with_key_flag(conn)


@router.get("/connections/{conn_id}", response_model=ConnectionOut)
def get_connection(conn_id: int, db: Session = Depends(get_db)):
    conn = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return ConnectionOut.from_orm_with_key_flag(conn)


@router.put("/connections/{conn_id}", response_model=ConnectionOut)
def update_connection(conn_id: int, data: ConnectionUpdate, db: Session = Depends(get_db)):
    conn = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    update_map = {
        "name":         data.name,
        "source_type":  data.source_type,
        "dialect":      data.dialect,
        "host":         data.host,
        "port":         data.port,
        "database_name": data.database_name,
        "schema_name":  data.schema_name,
        "username":     data.username,
        "sf_account":   data.sf_account,
        "sf_warehouse": data.sf_warehouse,
        "sf_role":      data.sf_role,
        "sf_database":  data.sf_database,
        "sf_schema":    data.sf_schema,
        "sf_username":  data.sf_username,
        "query_text":   data.query_text,
        "sheet_alias":  data.sheet_alias,
    }
    if data.password is not None:
        update_map["password_enc"] = encrypt(data.password)
    if data.sf_password is not None:
        update_map["sf_password_enc"] = encrypt(data.sf_password)
    if data.sf_private_key is not None:
        update_map["sf_private_key_enc"] = encrypt(data.sf_private_key)
    if data.sf_private_key_passphrase is not None:
        update_map["sf_private_key_passphrase_enc"] = encrypt(data.sf_private_key_passphrase)

    for k, v in update_map.items():
        if v is not None:
            setattr(conn, k, v)

    db.commit()
    db.refresh(conn)
    return ConnectionOut.from_orm_with_key_flag(conn)


@router.delete("/connections/{conn_id}", status_code=204)
def delete_connection(conn_id: int, db: Session = Depends(get_db)):
    conn = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    conn.is_active = False   # soft delete
    db.commit()


# ── Test / Preview using STORED credentials ──────────────────

@router.post("/connections/{conn_id}/test", response_model=TestResult)
def test_stored_connection(conn_id: int, db: Session = Depends(get_db)):
    conn = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    result = test_connection(_to_cfg_from_model(conn))
    if not result["success"]:
        raise HTTPException(status_code=400, detail=_clean_error_str(result["message"]))
    return result


@router.post("/connections/{conn_id}/preview", response_model=PreviewResult)
def preview_stored_connection(conn_id: int, db: Session = Depends(get_db)):
    conn = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    try:
        return preview_data(_to_cfg_from_model(conn))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=_clean_error_str(str(exc)))


class RunQueryRequest(BaseModel):
    query: str
    limit: Optional[int] = 1000


class ExecuteSqlRequest(BaseModel):
    sql:     str
    confirm: bool = False   # must be True for DML (DELETE/UPDATE/INSERT)


@router.post("/connections/{conn_id}/execute")
def execute_sql(conn_id: int, req: ExecuteSqlRequest, db: Session = Depends(get_db)):
    """
    Execute SQL against a stored connection.
    For SELECT → returns {type:'select', columns, rows, total}.
    For DML    → requires confirm=True, returns {type:'dml', rowcount, message}.
    Blocked patterns (DROP, TRUNCATE, no-WHERE DELETE, etc.) are always rejected.
    """
    conn = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    from api.services.validation_guard import validate_sql_safety
    safety = validate_sql_safety(req.sql)
    if not safety.passed:
        raise HTTPException(
            status_code=422,
            detail={"message": "SQL failed safety check", "errors": safety.errors},
        )

    sql_upper = req.sql.strip().upper()
    is_dml = any(sql_upper.startswith(kw) for kw in ("INSERT", "UPDATE", "DELETE", "MERGE", "EXEC"))

    if is_dml and not req.confirm:
        raise HTTPException(
            status_code=400,
            detail={"message": "DML statement requires explicit confirmation", "requires_confirm": True},
        )

    cfg = _to_cfg_from_model(conn)
    try:
        if is_dml:
            from api.services.connector import execute_write
            result = execute_write(cfg, req.sql)
            if not result.get("success"):
                raise HTTPException(status_code=400, detail=result.get("error", "Execution failed"))
            return {"type": "dml", "rowcount": result.get("rowcount", 0),
                    "message": f"{result.get('rowcount', 0)} row(s) affected"}
        else:
            cfg["query"] = req.sql
            data = preview_data(cfg, limit=500)
            return {"type": "select", **data}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=_clean_error_str(str(exc)))


@router.post("/connections/{conn_id}/run", response_model=PreviewResult)
def run_custom_query(conn_id: int, req: RunQueryRequest, db: Session = Depends(get_db)):
    """
    Run a custom SQL query against a stored connection using its decrypted credentials.
    Used by the Report tab so passwords are never sent to the browser.
    """
    import time
    from api.models import QueryHistory

    conn = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Safety validation before executing any user-supplied SQL
    from api.services.validation_guard import validate_sql_safety
    safety = validate_sql_safety(req.query)
    if not safety.passed:
        raise HTTPException(
            status_code=422,
            detail={"message": "SQL failed safety validation", "errors": safety.errors},
        )

    from api.services.query_performance import classify_slow

    cfg = _to_cfg_from_model(conn)
    cfg["query"] = req.query
    start = time.time()
    try:
        result = preview_data(cfg, limit=req.limit)
        elapsed_ms = int((time.time() - start) * 1000)
        row_count = result.get("total") if isinstance(result, dict) else getattr(result, "row_count", None)
        is_slow, slowness_reason, rows_per_second = classify_slow(elapsed_ms, row_count, req.query)
        try:
            db.add(QueryHistory(
                conn_id=conn_id,
                query_text=req.query,
                row_count=row_count,
                duration_ms=elapsed_ms,
                status="success",
                is_slow=is_slow,
                slowness_reason=slowness_reason,
                rows_per_second=rows_per_second,
            ))
            db.commit()
        except Exception:
            db.rollback()
        return result
    except Exception as exc:
        elapsed_ms = int((time.time() - start) * 1000)
        try:
            db.add(QueryHistory(
                conn_id=conn_id,
                query_text=req.query,
                duration_ms=elapsed_ms,
                status="error",
                error_msg=str(exc)[:2000],
            ))
            db.commit()
        except Exception:
            db.rollback()
        raise HTTPException(status_code=400, detail=_clean_error_str(str(exc)))


@router.get("/connections/{conn_id}/history")
def get_query_history(conn_id: int, limit: int = 20, db: Session = Depends(get_db)):
    from api.models import QueryHistory
    rows = (
        db.query(QueryHistory)
        .filter(QueryHistory.conn_id == conn_id)
        .order_by(QueryHistory.executed_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "conn_id": r.conn_id,
            "query_text": r.query_text,
            "row_count": r.row_count,
            "duration_ms": r.duration_ms,
            "status": r.status,
            "error_msg": r.error_msg,
            "executed_at": r.executed_at.isoformat() if r.executed_at else None,
        }
        for r in rows
    ]


@router.delete("/connections/{conn_id}/history", status_code=204)
def clear_query_history(conn_id: int, db: Session = Depends(get_db)):
    from api.models import QueryHistory
    db.query(QueryHistory).filter(QueryHistory.conn_id == conn_id).delete()
    db.commit()


# ── Ad-hoc: test / preview directly from form (not saved) ────

def _normalize_adhoc_cfg(req: AdHocConnectionRequest) -> dict:
    """Merge sf_* aliases so the connector always sees canonical field names."""
    cfg = req.model_dump()
    cfg["account"]      = cfg.get("account")      or cfg.get("sf_account")
    cfg["warehouse"]    = cfg.get("warehouse")     or cfg.get("sf_warehouse")
    cfg["role"]         = cfg.get("role")          or cfg.get("sf_role")
    cfg["database"]     = cfg.get("database")      or cfg.get("sf_database")
    cfg["schema"]       = cfg.get("schema")        or cfg.get("sf_schema")
    cfg["username"]     = cfg.get("username")      or cfg.get("sf_username")
    cfg["password"]     = cfg.get("password")      or cfg.get("sf_password")
    cfg["private_key"]  = cfg.get("private_key")   or cfg.get("sf_private_key")
    cfg["private_key_passphrase"] = (
        cfg.get("private_key_passphrase") or cfg.get("sf_private_key_passphrase")
    )
    cfg["query"] = cfg.get("query") or cfg.get("query_text")
    return cfg


@router.post("/sources/test", response_model=TestResult)
def adhoc_test(req: AdHocConnectionRequest):
    cfg = _normalize_adhoc_cfg(req)
    result = test_connection(cfg)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=_clean_error_str(result["message"]))
    return result


@router.post("/sources/preview", response_model=PreviewResult)
def adhoc_preview(req: AdHocConnectionRequest):
    cfg = _normalize_adhoc_cfg(req)
    try:
        return preview_data(cfg)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=_clean_error_str(str(exc)))


# Target formula routes removed — handled by main.py with conn_id support
