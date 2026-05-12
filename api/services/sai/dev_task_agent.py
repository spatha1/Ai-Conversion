"""
dev_task_agent.py — SAI Ops Step 2 replacement for the developer_ops domain.

Queries conversion_dev_tasks (synced from JIRA/ADO) and returns the same
`datasets` contract as data_collection_agent so all downstream agents work
without modification.
"""
import time
from sqlalchemy.orm import Session

from api.models import DevTask


async def run(schema_context: dict, db: Session, sai_run_id: int = 0) -> dict:
    t0         = time.time()
    project_id = schema_context.get("project_id")

    query = db.query(DevTask)
    if project_id is not None:
        query = query.filter(DevTask.project_id == project_id)
    tasks = query.order_by(DevTask.updated_dt.desc()).limit(500).all()

    if not tasks:
        return {
            "datasets": [{
                "conn_id":    None,
                "label":      "Developer Tasks",
                "error":      (
                    "No dev tasks synced. "
                    "Use the Sync button or POST /api/dev-ops/sync first."
                ),
                "query_used": "SELECT * FROM conversion_dev_tasks",
                "row_count":  0,
                "columns":    [],
                "sample_rows": [],
                "stats":      {},
            }],
            "knowledge_sources": [],
            "elapsed_ms": int((time.time() - t0) * 1000),
        }

    COLS = [
        "external_id", "source_type", "title", "issue_type", "status",
        "priority", "assignee", "team", "sprint_name", "sprint_end_dt",
        "story_points", "created_dt", "updated_dt", "due_dt", "labels",
    ]

    def _row(t: DevTask) -> list:
        return [
            t.external_id,
            t.source_type,
            t.title,
            t.issue_type,
            t.status,
            t.priority,
            t.assignee,
            t.team,
            t.sprint_name,
            t.sprint_end_dt.isoformat() if t.sprint_end_dt else None,
            t.story_points,
            t.created_dt.isoformat() if t.created_dt else None,
            t.updated_dt.isoformat() if t.updated_dt else None,
            t.due_dt.isoformat()     if t.due_dt     else None,
            t.labels,
        ]

    all_rows     = [_row(t) for t in tasks]
    blocked_rows = [r for r in all_rows if r[4] and "block" in str(r[4]).lower()]

    total = len(all_rows)
    done  = sum(1 for r in all_rows if r[4] and "done" in str(r[4]).lower())

    stats = {
        "status": {
            "completion_pct":   round(done / total * 100, 1) if total else 0.0,
            "blocked_count":    len(blocked_rows),
            "unassigned_count": sum(1 for r in all_rows if not r[6]),
            "total_rows":       total,
            "null_rate":        0.0,
        }
    }

    datasets = [{
        "conn_id":     None,
        "label":       f"Developer Tasks ({total} items)",
        "purpose":     "Sprint health, blocker, ownership analysis",
        "row_count":   total,
        "columns":     COLS,
        "sample_rows": all_rows[:15],
        "stats":       stats,
        "query_used":  f"conversion_dev_tasks WHERE project_id={project_id}",
    }]

    if blocked_rows:
        datasets.append({
            "conn_id":     None,
            "label":       f"Blocked Tasks ({len(blocked_rows)} items)",
            "purpose":     "Blocker cascade analysis",
            "row_count":   len(blocked_rows),
            "columns":     COLS,
            "sample_rows": blocked_rows[:15],
            "stats":       {"status": {"total_rows": len(blocked_rows), "null_rate": 0.0}},
            "query_used":  "conversion_dev_tasks WHERE status LIKE '%block%'",
        })

    return {
        "datasets":          datasets,
        "knowledge_sources": schema_context.get("knowledge_sources", []),
        "elapsed_ms":        int((time.time() - t0) * 1000),
    }
