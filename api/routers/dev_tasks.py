"""
dev_tasks.py — Developer Ops endpoints: JIRA/ADO task sync + query + sprint summary.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import DevTask
from api.schemas import AssigneeStats, DevSummaryOut, DevSyncRequest, DevTaskOut, SprintInfo
from api.services.dev_tasks_sync import sync_all

router = APIRouter(prefix="/dev-ops", tags=["dev-ops"])


@router.post("/sync")
async def sync_dev_tasks(req: DevSyncRequest, db: Session = Depends(get_db)):
    """Pull the latest sprint tasks from JIRA / Azure DevOps into the local DB."""
    result = await sync_all(req.project_id, db, source=req.source or "both")
    return result


@router.get("/tasks", response_model=list[DevTaskOut])
def list_dev_tasks(
    project_id:  Optional[int] = None,
    sprint_name: Optional[str] = None,
    status:      Optional[str] = None,
    assignee:    Optional[str] = None,
    limit:       int = 200,
    db:          Session = Depends(get_db),
):
    q = db.query(DevTask)
    if project_id is not None:
        q = q.filter(DevTask.project_id == project_id)
    if sprint_name:
        q = q.filter(DevTask.sprint_name == sprint_name)
    if status:
        q = q.filter(DevTask.status.ilike(f"%{status}%"))
    if assignee:
        q = q.filter(DevTask.assignee.ilike(f"%{assignee}%"))
    return q.order_by(DevTask.priority, DevTask.updated_dt.desc()).limit(limit).all()


@router.get("/summary", response_model=DevSummaryOut)
def dev_summary(
    project_id:  Optional[int] = None,
    sprint_name: Optional[str] = None,
    db:          Session = Depends(get_db),
):
    q = db.query(DevTask)
    if project_id is not None:
        q = q.filter(DevTask.project_id == project_id)
    if sprint_name:
        q = q.filter(DevTask.sprint_name == sprint_name)

    tasks = q.all()
    total = len(tasks)

    if total == 0:
        return DevSummaryOut(
            sprint_name=sprint_name,
            total_tasks=0, done_count=0, in_progress_count=0,
            blocked_count=0, completion_pct=0.0, overdue_count=0,
            active_sprints=[], by_assignee=[], last_synced_at=None,
        )

    now = datetime.now(timezone.utc)

    def _tz(dt: datetime | None) -> datetime | None:
        if dt is None:
            return None
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

    done    = sum(1 for t in tasks if t.status and "done"     in t.status.lower())
    in_prog = sum(1 for t in tasks if t.status and "progress" in t.status.lower())
    blocked = sum(1 for t in tasks if t.status and "block"    in t.status.lower())
    overdue = sum(
        1 for t in tasks
        if t.due_dt and _tz(t.due_dt) < now
        and t.status and "done" not in t.status.lower()
    )

    sprints_seen: dict[str, dict] = {}
    for t in tasks:
        if t.sprint_name and t.sprint_name not in sprints_seen:
            sprints_seen[t.sprint_name] = {
                "name":  t.sprint_name,
                "start": t.sprint_start_dt.isoformat() if t.sprint_start_dt else None,
                "end":   t.sprint_end_dt.isoformat()   if t.sprint_end_dt   else None,
            }

    assignee_map: dict[str, dict] = {}
    for t in tasks:
        key = t.assignee or "Unassigned"
        if key not in assignee_map:
            assignee_map[key] = {"assignee": key, "count": 0, "done": 0}
        assignee_map[key]["count"] += 1
        if t.status and "done" in t.status.lower():
            assignee_map[key]["done"] += 1

    last_synced = max((t.synced_at for t in tasks if t.synced_at), default=None)

    active_sprints = [SprintInfo(**s) for s in sprints_seen.values()]
    by_assignee    = [
        AssigneeStats(**a)
        for a in sorted(assignee_map.values(), key=lambda x: -x["count"])[:10]
    ]

    return DevSummaryOut(
        sprint_name=sprint_name or (list(sprints_seen.keys())[0] if sprints_seen else None),
        total_tasks=total,
        done_count=done,
        in_progress_count=in_prog,
        blocked_count=blocked,
        completion_pct=round(done / total * 100, 1),
        overdue_count=overdue,
        active_sprints=active_sprints,
        by_assignee=by_assignee,
        last_synced_at=last_synced.isoformat() if last_synced else None,
    )
