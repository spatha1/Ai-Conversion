"""
dashboard.py — Project flow dashboard API
GET /api/dashboard/summary   — KPI counts for every pipeline stage
GET /api/dashboard/activity  — Daily activity for the last N days
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import (
    SourceConnection, CatalogColumn, CatalogRelation, ColumnEmbedding,
    Mapping, MappingRow, GeneratedXml, XmlTemplate, TargetFormulaRule,
    ValidationRule, RunLog,
    PsConversation, PsWorkflow, PsWorkflowRun,
)

router = APIRouter()


@router.get("/dashboard/summary", tags=["dashboard"])
def get_dashboard_summary(project_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Return KPI counts for every stage of the conversion pipeline."""

    # ── Connections ──────────────────────────────────────────
    if not project_id:
        # No project selected — return all-zero summary
        return {
            "connections": {"total": 0, "by_type": []},
            "schema": {"tables": 0, "columns": 0, "relations": 0, "embeddings": 0},
            "templates": {"total": 0, "formulas": 0},
            "mappings": {"total": 0, "rows": 0},
            "xml": {"generated": 0, "passed": 0, "failed": 0},
            "validation": {"rules": 0},
            "run_logs": {"total": 0, "success": 0, "failed": 0, "recent": []},
            "ps_support": {"conversations": 0, "workflows": 0, "workflow_runs": 0, "wf_success": 0},
        }

    conn_list = db.query(SourceConnection).filter(
        SourceConnection.project_id == project_id, SourceConnection.is_active == True
    ).all()
    conn_ids = [c.id for c in conn_list]

    type_counts: dict[str, int] = {}
    for c in conn_list:
        t = c.source_type or "unknown"
        type_counts[t] = type_counts.get(t, 0) + 1

    def _q(model, *filters):
        return db.query(func.count(model.id)).filter(*filters).scalar() or 0

    # ── Schema ───────────────────────────────────────────────
    tables_discovered = (
        db.query(func.count(func.distinct(CatalogColumn.table_name)))
        .filter(CatalogColumn.conn_id.in_(conn_ids))
        .scalar() or 0
    ) if conn_ids else 0
    columns_count  = _q(CatalogColumn,  CatalogColumn.conn_id.in_(conn_ids))  if conn_ids else 0
    relations_count= _q(CatalogRelation,CatalogRelation.conn_id.in_(conn_ids)) if conn_ids else 0
    embeddings_count=_q(ColumnEmbedding,ColumnEmbedding.conn_id.in_(conn_ids)) if conn_ids else 0

    # ── Templates & Formulas ────────────────────────────────
    templates_count = _q(XmlTemplate, XmlTemplate.conn_id.in_(conn_ids)) if conn_ids else 0
    formulas_count  = _q(TargetFormulaRule, TargetFormulaRule.conn_id.in_(conn_ids)) if conn_ids else 0

    # ── Mappings ─────────────────────────────────────────────
    mappings_count = _q(Mapping, Mapping.conn_id.in_(conn_ids)) if conn_ids else 0
    mapping_rows_count = (
        db.query(func.count(MappingRow.id))
        .join(Mapping, Mapping.id == MappingRow.mapping_id)
        .filter(Mapping.conn_id.in_(conn_ids))
        .scalar() or 0
    ) if conn_ids else 0

    # ── Generated XML ────────────────────────────────────────
    xml_generated = _q(GeneratedXml, GeneratedXml.conn_id.in_(conn_ids)) if conn_ids else 0
    xml_passed = (
        db.query(func.count(GeneratedXml.id))
        .filter(GeneratedXml.conn_id.in_(conn_ids), GeneratedXml.validation_status == "passed")
        .scalar() or 0
    ) if conn_ids else 0

    # ── Validation ───────────────────────────────────────────
    validation_rules_count = _q(ValidationRule, ValidationRule.conn_id.in_(conn_ids)) if conn_ids else 0

    # ── Run Logs ─────────────────────────────────────────────
    run_q = db.query(RunLog)
    if project_id:
        run_q = run_q.filter(RunLog.project_id == project_id)
    recent_runs = run_q.order_by(RunLog.started_at.desc()).limit(10).all()
    run_success = sum(1 for r in recent_runs if r.status == "success")
    run_failed  = sum(1 for r in recent_runs if r.status in ("failed", "error"))

    # ── PS Support ───────────────────────────────────────────
    conversations_count = (
        _q(PsConversation, PsConversation.conn_id.in_(conn_ids)) if conn_ids else 0
    )
    workflows_count = (
        _q(PsWorkflow, PsWorkflow.conn_id.in_(conn_ids)) if conn_ids else 0
    )
    workflow_runs_count = (
        db.query(func.count(PsWorkflowRun.id))
        .join(PsWorkflow, PsWorkflow.id == PsWorkflowRun.workflow_id)
        .filter(PsWorkflow.conn_id.in_(conn_ids))
        .scalar() or 0
    ) if conn_ids else 0
    wf_success = (
        db.query(func.count(PsWorkflowRun.id))
        .join(PsWorkflow, PsWorkflow.id == PsWorkflowRun.workflow_id)
        .filter(PsWorkflow.conn_id.in_(conn_ids), PsWorkflowRun.status == "success")
        .scalar() or 0
    ) if conn_ids else 0

    return {
        "connections": {
            "total": len(conn_list),
            "by_type": [{"type": k, "count": v} for k, v in type_counts.items()],
        },
        "schema": {
            "tables":     tables_discovered,
            "columns":    columns_count,
            "relations":  relations_count,
            "embeddings": embeddings_count,
        },
        "templates": {
            "total":   templates_count,
            "formulas": formulas_count,
        },
        "mappings": {
            "total": mappings_count,
            "rows":  mapping_rows_count,
        },
        "xml": {
            "generated": xml_generated,
            "passed":    xml_passed,
            "failed":    xml_generated - xml_passed,
        },
        "validation": {
            "rules": validation_rules_count,
        },
        "run_logs": {
            "total":   len(recent_runs),
            "success": run_success,
            "failed":  run_failed,
            "recent": [
                {
                    "id":          r.id,
                    "status":      r.status,
                    "source_rows": r.source_rows,
                    "started_at":  r.started_at.isoformat() if r.started_at else None,
                    "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                    "errors":      r.errors,
                }
                for r in recent_runs
            ],
        },
        "ps_support": {
            "conversations":   conversations_count,
            "workflows":       workflows_count,
            "workflow_runs":   workflow_runs_count,
            "workflow_success": wf_success,
        },
    }


@router.get("/dashboard/activity", tags=["dashboard"])
def get_dashboard_activity(days: int = 30, project_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Return daily counts for the last N days."""
    since = datetime.utcnow() - timedelta(days=days)

    # Resolve conn_ids for this project — return empty if no project scoping
    if not project_id:
        return {"xml_generated": [], "conversations": []}

    conn_ids = [
        c.id for c in db.query(SourceConnection)
        .filter(SourceConnection.project_id == project_id, SourceConnection.is_active == True)
        .all()
    ]

    if not conn_ids:
        return {"xml_generated": [], "conversations": []}

    # Cross-DB approach: fetch all timestamps and bucket in Python
    xml_q = db.query(GeneratedXml.generated_at).filter(
        GeneratedXml.generated_at >= since, GeneratedXml.conn_id.in_(conn_ids)
    )
    xml_rows = xml_q.all()

    conv_q = db.query(PsConversation.created_at).filter(
        PsConversation.created_at >= since, PsConversation.conn_id.in_(conn_ids)
    )
    conv_rows = conv_q.all()

    def bucket(rows, field_idx=0):
        counts: dict[str, int] = {}
        for row in rows:
            dt = row[field_idx]
            if dt:
                day = dt.strftime("%Y-%m-%d")
                counts[day] = counts.get(day, 0) + 1
        return [{"date": k, "count": v} for k, v in sorted(counts.items())]

    return {
        "xml_generated":  bucket(xml_rows),
        "conversations":  bucket(conv_rows),
    }
