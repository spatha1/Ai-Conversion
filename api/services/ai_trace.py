"""
api/services/ai_trace.py

Persists every LLM call centrally for the AI debug panel.
Call store() after each OpenAI completion in any router.
"""
from __future__ import annotations

import time
from typing import Optional

from sqlalchemy.orm import Session


def store(
    *,
    module: str,
    conn_id: Optional[int],
    model: str,
    prompt: str,
    response: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    latency_ms: int = 0,
    db: Session,
    # Enhanced audit fields
    sql_executed: Optional[str] = None,
    row_count_returned: Optional[int] = None,
    schema_snapshot: Optional[list | dict] = None,
    export_action: Optional[str] = None,
) -> None:
    """
    Persist one LLM call trace.  Swallows errors silently so a trace failure
    never breaks the calling endpoint.
    """
    import json as _json
    try:
        from api.models import AITraceLog
        row = AITraceLog(
            module=module,
            conn_id=conn_id,
            model=model,
            prompt_text=prompt[:32000] if prompt else None,
            response_text=response[:32000] if response else None,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
            sql_executed=sql_executed[:32000] if sql_executed else None,
            row_count_returned=row_count_returned,
            schema_snapshot=_json.dumps(schema_snapshot)[:32000] if schema_snapshot else None,
            export_action=export_action,
        )
        db.add(row)
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def get_traces(
    db: Session,
    *,
    conn_id: Optional[int] = None,
    module: Optional[str] = None,
    limit: int = 100,
) -> list:
    """Query trace log with optional filters."""
    try:
        from api.models import AITraceLog
        q = db.query(AITraceLog)
        if conn_id is not None:
            q = q.filter(AITraceLog.conn_id == conn_id)
        if module:
            q = q.filter(AITraceLog.module == module)
        return q.order_by(AITraceLog.id.desc()).limit(limit).all()
    except Exception:
        return []


def delete_trace(db: Session, trace_id: int) -> bool:
    try:
        from api.models import AITraceLog
        row = db.query(AITraceLog).filter(AITraceLog.id == trace_id).first()
        if row:
            db.delete(row)
            db.commit()
            return True
        return False
    except Exception:
        db.rollback()
        return False


def purge_old(db: Session, older_than_days: int = 30) -> int:
    """Delete traces older than N days. Returns number deleted."""
    try:
        from api.models import AITraceLog
        from datetime import datetime, timedelta
        cutoff = datetime.utcnow() - timedelta(days=older_than_days)
        count = (
            db.query(AITraceLog)
            .filter(AITraceLog.created_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        return count
    except Exception:
        db.rollback()
        return 0
