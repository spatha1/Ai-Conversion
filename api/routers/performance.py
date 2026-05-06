"""
performance.py — Performance Tuning Agent endpoints.
GET  /api/connections/{conn_id}/performance        → slow query stats
POST /api/connections/{conn_id}/performance/analyze → AI analysis
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.database import get_db
from api.services.query_performance import get_performance_stats, analyze_performance

router = APIRouter()


@router.get("/connections/{conn_id}/performance")
def performance_stats(conn_id: int, db: Session = Depends(get_db)):
    """Return slow query counts and list for the Performance tab."""
    try:
        return get_performance_stats(conn_id, db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/connections/{conn_id}/performance/analyze")
def performance_analyze(conn_id: int, db: Session = Depends(get_db)):
    """Run GPT-4o-mini analysis on slow queries for this connection."""
    try:
        return analyze_performance(conn_id, db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
