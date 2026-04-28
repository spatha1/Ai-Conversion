"""
api/routers/run_engine.py

POST /api/runs          — trigger a conversion run
GET  /api/runs          — list runs (filterable by project_id / conn_id)
GET  /api/runs/{run_id} — get single run detail
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from api.database import get_db
from api.dependencies import get_current_user, require_non_viewer
from api.models import RunLog, SourceConnection
from api.schemas import RunLogOut, TriggerRunRequest

router = APIRouter(dependencies=[Depends(get_current_user)])


# ── Trigger run ───────────────────────────────────────────────

@router.post("/runs", response_model=RunLogOut,
             dependencies=[Depends(require_non_viewer)])
def trigger_run(req: TriggerRunRequest, db: Session = Depends(get_db)):
    """
    Start a conversion run synchronously and return the completed RunLog.
    For large datasets this may take a few seconds; the UI shows a spinner.
    """
    from api.services import run_engine
    try:
        run = run_engine.execute(
            conn_id=req.conn_id,
            triggered_by=req.triggered_by,
            target_url=req.target_url,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return run


# ── List runs ─────────────────────────────────────────────────

@router.get("/runs", response_model=list[RunLogOut])
def list_runs(
    project_id: Optional[int] = None,
    conn_id:    Optional[int] = None,
    limit:      int = 50,
    db: Session = Depends(get_db),
):
    q = db.query(RunLog)
    if project_id is not None:
        q = q.filter(RunLog.project_id == project_id)
    if conn_id is not None:
        # Look up project_id for this connection and filter by it
        src = db.query(SourceConnection).filter_by(id=conn_id).first()
        if src and src.project_id:
            q = q.filter(RunLog.project_id == src.project_id)
    return q.order_by(RunLog.id.desc()).limit(limit).all()


# ── Get single run ────────────────────────────────────────────

@router.get("/runs/{run_id}", response_model=RunLogOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    run = db.query(RunLog).filter_by(id=run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    return run
