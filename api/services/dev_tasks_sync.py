"""
dev_tasks_sync.py — Pull JIRA / Azure DevOps tasks into conversion_dev_tasks.
Reuses the auth header pattern from api/routers/stories.py.
"""
import base64
import json
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from api.models import DevTask, ExternalIntegration
from api.services.encryption import decrypt


async def sync_all(
    project_id: int | None,
    db: Session,
    source: str = "both",
) -> dict:
    """Find active integrations for the project and sync each."""
    q = db.query(ExternalIntegration).filter(
        ExternalIntegration.is_active == True  # noqa: E712
    )
    if project_id is not None:
        q = q.filter(ExternalIntegration.project_id == project_id)
    integrations = q.all()

    results = []
    for intg in integrations:
        if source != "both" and intg.type != source:
            continue
        try:
            if intg.type == "jira":
                r = await _sync_jira(intg, project_id, db)
            elif intg.type == "ado":
                r = await _sync_ado(intg, project_id, db)
            else:
                continue
            results.append(r)
        except Exception as exc:
            results.append({"source": intg.type, "synced": 0, "failed": 0,
                            "error": str(exc)[:200]})

    return {
        "synced":  sum(r.get("synced", 0) for r in results),
        "failed":  sum(r.get("failed", 0) for r in results),
        "sources": [r.get("source") for r in results],
    }


async def _sync_jira(
    intg: ExternalIntegration,
    project_id: int | None,
    db: Session,
) -> dict:
    import httpx

    base_url = intg.base_url.rstrip("/")
    token    = decrypt(intg.token_enc)
    username = intg.username
    headers  = {"Accept": "application/json"}
    if username:
        creds = base64.b64encode(f"{username}:{token}".encode()).decode()
        headers["Authorization"] = f"Basic {creds}"
    else:
        headers["Authorization"] = f"Bearer {token}"

    jql    = "sprint in openSprints() ORDER BY priority ASC"
    params = {
        "jql":        jql,
        "maxResults": 100,
        "fields": (
            "summary,description,status,priority,issuetype,assignee,"
            "customfield_10020,customfield_10016,"
            "created,updated,duedate,labels"
        ),
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{base_url}/rest/api/3/search",
            headers=headers,
            params=params,
        )
        resp.raise_for_status()
        issues = resp.json().get("issues", [])

    synced = failed = 0
    for issue in issues:
        try:
            row = _map_jira(issue, project_id)
            _upsert_task(row, db)
            synced += 1
        except Exception:
            failed += 1
    db.commit()
    return {"source": "jira", "synced": synced, "failed": failed}


async def _sync_ado(
    intg: ExternalIntegration,
    project_id: int | None,
    db: Session,
) -> dict:
    import httpx

    base_url = intg.base_url.rstrip("/")
    token    = decrypt(intg.token_enc)
    creds    = base64.b64encode(f":{token}".encode()).decode()
    headers  = {
        "Authorization": f"Basic {creds}",
        "Content-Type":  "application/json",
    }

    wiql = {
        "query": (
            "SELECT [System.Id] FROM WorkItems "
            "WHERE [System.IterationPath] UNDER @CurrentIteration "
            "ORDER BY [System.ChangedDate] DESC"
        )
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base_url}/_apis/wit/wiql?api-version=7.0",
            headers=headers,
            json=wiql,
        )
        resp.raise_for_status()
        ids = [str(w["id"]) for w in resp.json().get("workItems", [])][:100]

        if not ids:
            return {"source": "ado", "synced": 0, "failed": 0}

        fields = (
            "System.Id,System.Title,System.Description,System.State,"
            "System.AssignedTo,Microsoft.VSTS.Common.Priority,"
            "System.WorkItemType,System.IterationPath,"
            "System.CreatedDate,System.ChangedDate,"
            "Microsoft.VSTS.Scheduling.TargetDate,"
            "Microsoft.VSTS.Scheduling.StoryPoints"
        )
        batch = await client.get(
            f"{base_url}/_apis/wit/workitems",
            headers=headers,
            params={"ids": ",".join(ids), "fields": fields, "api-version": "7.0"},
        )
        batch.raise_for_status()
        items = batch.json().get("value", [])

    synced = failed = 0
    for item in items:
        try:
            row = _map_ado(item, project_id)
            _upsert_task(row, db)
            synced += 1
        except Exception:
            failed += 1
    db.commit()
    return {"source": "ado", "synced": synced, "failed": failed}


def _map_jira(issue: dict, project_id: int | None) -> dict:
    f = issue.get("fields", {})
    sprint_info = f.get("customfield_10020") or {}
    if isinstance(sprint_info, list):
        sprint_info = sprint_info[-1] if sprint_info else {}
    return {
        "project_id":      project_id,
        "source_type":     "jira",
        "external_id":     issue.get("key") or str(issue.get("id", "")),
        "sprint_name":     sprint_info.get("name") if isinstance(sprint_info, dict) else None,
        "sprint_start_dt": _parse_dt(sprint_info.get("startDate") if isinstance(sprint_info, dict) else None),
        "sprint_end_dt":   _parse_dt(sprint_info.get("endDate")   if isinstance(sprint_info, dict) else None),
        "title":           (f.get("summary") or "")[:500],
        "description":     _flatten_adf(f.get("description")),
        "issue_type":      (f.get("issuetype") or {}).get("name"),
        "status":          (f.get("status") or {}).get("name"),
        "priority":        (f.get("priority") or {}).get("name"),
        "assignee":        (
            (f.get("assignee") or {}).get("displayName") or
            (f.get("assignee") or {}).get("emailAddress")
        ),
        "created_dt":      _parse_dt(f.get("created")),
        "updated_dt":      _parse_dt(f.get("updated")),
        "due_dt":          _parse_dt(f.get("duedate")),
        "story_points":    f.get("customfield_10016"),
        "labels":          ",".join(f.get("labels") or []),
        "raw_json":        json.dumps(issue)[:8000],
    }


def _map_ado(item: dict, project_id: int | None) -> dict:
    f           = item.get("fields", {})
    iteration   = f.get("System.IterationPath", "")
    sprint_name = iteration.split("\\")[-1] if "\\" in iteration else (iteration or None)
    assignee_raw = f.get("System.AssignedTo") or {}
    assignee = (
        assignee_raw.get("displayName")
        if isinstance(assignee_raw, dict)
        else str(assignee_raw)
    ) or None
    return {
        "project_id":  project_id,
        "source_type": "ado",
        "external_id": str(item.get("id") or f.get("System.Id", "")),
        "sprint_name": sprint_name,
        "title":       (f.get("System.Title") or "")[:500],
        "description": f.get("System.Description"),
        "issue_type":  f.get("System.WorkItemType"),
        "status":      f.get("System.State"),
        "priority":    str(f.get("Microsoft.VSTS.Common.Priority", "") or ""),
        "assignee":    assignee,
        "created_dt":  _parse_dt(f.get("System.CreatedDate")),
        "updated_dt":  _parse_dt(f.get("System.ChangedDate")),
        "due_dt":      _parse_dt(f.get("Microsoft.VSTS.Scheduling.TargetDate")),
        "story_points": f.get("Microsoft.VSTS.Scheduling.StoryPoints"),
        "raw_json":    json.dumps(item)[:8000],
    }


def _upsert_task(row: dict, db: Session) -> None:
    existing = (
        db.query(DevTask)
          .filter_by(
              source_type=row["source_type"],
              external_id=row["external_id"],
              project_id=row.get("project_id"),
          )
          .first()
    )
    if existing:
        for k, v in row.items():
            setattr(existing, k, v)
        existing.synced_at = datetime.now(timezone.utc)
    else:
        db.add(DevTask(**row))


def _parse_dt(s) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def _flatten_adf(adf) -> str | None:
    """Convert Atlassian Document Format nodes to plain text."""
    if not adf:
        return None
    if isinstance(adf, str):
        return adf[:4000]
    parts: list[str] = []

    def _walk(node: dict) -> None:
        if isinstance(node, dict):
            if node.get("type") == "text":
                parts.append(node.get("text", ""))
            for child in node.get("content", []):
                _walk(child)

    _walk(adf)
    return (" ".join(parts))[:4000] or None
