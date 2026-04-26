"""
stories.py — Development Hub router.

POST /api/development-hub/analyze          — AI parse+consolidate+use-case extraction
POST /api/development-hub/fetch-external   — Batch fetch multiple JIRA / ADO items → structured stories
"""
from __future__ import annotations

import base64
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.routers.auth import get_current_user

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class StoryInput(BaseModel):
    title: str
    description: str
    acceptance_criteria: Optional[str] = None


class StoryAnalysisRequest(BaseModel):
    stories: list[StoryInput]
    model: str = "gpt-4o-mini"
    refinement_instructions: Optional[str] = None
    previous_result: Optional[dict] = None


# ── Batch fetch schemas ───────────────────────────────────────────────────────

class FetchExternalRequest(BaseModel):
    source_type: str              # 'jira' | 'ado'
    resource_ids: list[str]       # ["PROJ-123", "PROJ-124", ...] — max 20
    project_id: Optional[int] = None


class FetchedStory(BaseModel):
    resource_id: str
    title: str
    description: str
    acceptance_criteria: Optional[str] = None


class FetchExternalResult(BaseModel):
    stories: list[FetchedStory]
    failed: list[dict]            # [{"resource_id": "...", "error": "..."}]


class UseCaseOutputs(BaseModel):
    development_prompt: str
    report_prompt: str
    dashboard_prompt: str
    testing_prompt: str


class ExtractedUseCase(BaseModel):
    name: str
    description: str
    entities: list[str]
    metrics: list[str]
    dimensions: list[str]
    filters: list[str]
    time_granularity: list[str]
    type: str
    priority: str
    expected_outputs: list[str]
    outputs: UseCaseOutputs


class StoryAnalysisResult(BaseModel):
    parsed_stories: list[dict]
    unified_intent: dict
    conflicts: list[dict]
    use_cases: list[dict]
    ui_actions: dict
    models: list[dict] = []   # output of Call C — model grouping
    tokens_in: int
    tokens_out: int
    latency_ms: int


# ── Structured extraction helpers (reuse logic from development.py) ───────────

def _flatten_adf(node) -> str:
    if isinstance(node, str):
        return node
    if isinstance(node, dict):
        t = node.get("type", "")
        if t == "text":
            return node.get("text", "")
        children = node.get("content", [])
        sep = "\n" if t in ("paragraph", "bulletList", "orderedList", "listItem", "heading") else ""
        return sep.join(_flatten_adf(c) for c in children)
    if isinstance(node, list):
        return "\n".join(_flatten_adf(c) for c in node)
    return ""


def _strip_html(html: str) -> str:
    import re as _re
    text = _re.sub(r"<br\s*/?>", "\n", html, flags=_re.IGNORECASE)
    text = _re.sub(r"</p>|</li>|</div>", "\n", text, flags=_re.IGNORECASE)
    text = _re.sub(r"<[^>]+>", "", text)
    return text.strip()


def _extract_story_fields(source_type: str, data: dict, resource_id: str) -> dict:
    """Extract structured {title, description, acceptance_criteria} from JIRA/ADO JSON."""
    if source_type == "jira":
        fields = data.get("fields", {})
        title = fields.get("summary", resource_id)
        desc_obj = fields.get("description") or {}
        description = _flatten_adf(desc_obj) if isinstance(desc_obj, dict) else str(desc_obj or "")
        acceptance = ""
        for cf_key in ["customfield_10016", "customfield_10014", "customfield_10015", "customfield_10900"]:
            val = fields.get(cf_key)
            if val:
                acceptance = _flatten_adf(val) if isinstance(val, dict) else str(val)
                break
        # Enrich description with status/type for context
        issue_type = (fields.get("issuetype") or {}).get("name", "")
        status     = (fields.get("status")    or {}).get("name", "")
        prefix = f"[{issue_type} | {status}] " if issue_type else ""
        return {
            "title": f"{prefix}{title}",
            "description": description or "(no description)",
            "acceptance_criteria": acceptance or None,
        }

    elif source_type == "ado":
        fields = data.get("fields", {})
        title       = fields.get("System.Title", resource_id)
        description = _strip_html(fields.get("System.Description", "") or "")
        ac_raw      = fields.get("Microsoft.VSTS.Common.AcceptanceCriteria", "") or ""
        acceptance  = _strip_html(ac_raw)
        wi_type     = fields.get("System.WorkItemType", "")
        state       = fields.get("System.State", "")
        prefix = f"[{wi_type} | {state}] " if wi_type else ""
        return {
            "title": f"{prefix}{title}",
            "description": description or "(no description)",
            "acceptance_criteria": acceptance or None,
        }

    return {"title": resource_id, "description": str(data), "acceptance_criteria": None}


# ── Batch fetch endpoint ──────────────────────────────────────────────────────

@router.post("/development-hub/fetch-external", response_model=FetchExternalResult, tags=["development-hub"])
def fetch_stories_external(
    req: FetchExternalRequest,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """
    Batch-fetch multiple JIRA issues or ADO work items and return structured story objects.
    Credentials are loaded from the saved Admin integration config.
    """
    import httpx
    from api.models import ExternalIntegration
    from api.services.encryption import decrypt

    if not req.resource_ids:
        raise HTTPException(status_code=422, detail="At least one resource_id is required.")
    if len(req.resource_ids) > 20:
        raise HTTPException(status_code=422, detail="Maximum 20 resource IDs per request.")
    if req.source_type not in ("jira", "ado"):
        raise HTTPException(status_code=422, detail="source_type must be 'jira' or 'ado'.")

    # ── Resolve credentials from saved Admin integration ──────────────────────
    saved = None
    if req.project_id is not None:
        saved = db.query(ExternalIntegration).filter(
            ExternalIntegration.type == req.source_type,
            ExternalIntegration.project_id == req.project_id,
        ).first()
    if not saved:
        saved = db.query(ExternalIntegration).filter(
            ExternalIntegration.type == req.source_type,
        ).first()
    if not saved:
        raise HTTPException(
            status_code=400,
            detail=f"No {req.source_type.upper()} integration configured in Admin. "
                   "Please configure it under Admin → Integrations first.",
        )

    base_url = saved.base_url.rstrip("/")
    token    = decrypt(saved.token_enc)
    username = saved.username

    # Build auth headers once
    headers: dict = {"Accept": "application/json"}
    if req.source_type == "jira":
        if username:
            creds = base64.b64encode(f"{username}:{token}".encode()).decode()
            headers["Authorization"] = f"Basic {creds}"
        else:
            headers["Authorization"] = f"Bearer {token}"
    else:  # ado
        creds = base64.b64encode(f":{token}".encode()).decode()
        headers["Authorization"] = f"Basic {creds}"

    # ── Fetch each item ───────────────────────────────────────────────────────
    stories: list[dict] = []
    failed:  list[dict] = []

    with httpx.Client(timeout=15) as client:
        for rid in req.resource_ids:
            rid = rid.strip()
            if not rid:
                continue
            try:
                if req.source_type == "jira":
                    url = f"{base_url}/rest/api/3/issue/{rid}"
                    resp = client.get(url, headers=headers)
                    # Fall back from API v3 to v2 for JIRA Server/Data Center
                    if resp.status_code in (401, 404):
                        url2 = url.replace("/rest/api/3/", "/rest/api/2/")
                        resp2 = client.get(url2, headers=headers)
                        if resp2.status_code not in (401, 404):
                            resp = resp2
                else:
                    url = f"{base_url}/_apis/wit/workitems/{rid}?api-version=7.0&$expand=all"
                    resp = client.get(url, headers=headers)

                if resp.status_code == 401:
                    failed.append({"resource_id": rid, "error": "Authentication failed — check Admin → Integrations token."})
                    continue
                if resp.status_code == 404:
                    failed.append({"resource_id": rid, "error": f"Item '{rid}' not found."})
                    continue
                resp.raise_for_status()
                data = resp.json()
                fields = _extract_story_fields(req.source_type, data, rid)
                stories.append({"resource_id": rid, **fields})

            except httpx.HTTPStatusError as exc:
                failed.append({"resource_id": rid, "error": f"HTTP {exc.response.status_code}: {exc.response.text[:200]}"})
            except Exception as exc:
                failed.append({"resource_id": rid, "error": str(exc)})

    return {"stories": stories, "failed": failed}


# ── Analyze endpoint ──────────────────────────────────────────────────────────

@router.post("/development-hub/analyze", response_model=StoryAnalysisResult, tags=["development-hub"])
async def analyze_stories(
    req: StoryAnalysisRequest,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    if not req.stories:
        raise HTTPException(status_code=422, detail="At least one story is required.")
    if len(req.stories) > 20:
        raise HTTPException(status_code=422, detail="Maximum 20 stories per request.")

    from api.services.story_analyzer import analyze_stories as _analyze

    stories_dicts = [
        {
            "title":               s.title,
            "description":         s.description,
            "acceptance_criteria": s.acceptance_criteria or "",
        }
        for s in req.stories
    ]

    try:
        result = await _analyze(
            stories_dicts,
            db,
            req.model,
            refinement_instructions=req.refinement_instructions,
            previous_result=req.previous_result,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}")

    return result


# ── Save / History schemas ────────────────────────────────────────────────────

class SaveAnalysisRequest(BaseModel):
    title: str
    stories_json: str
    result_json:  str
    project_id:   Optional[int] = None
    model:        Optional[str] = None


class SavedAnalysisOut(BaseModel):
    id:         int
    title:      str
    project_id: Optional[int]
    model:      Optional[str]
    created_at: str
    use_case_count: int = 0
    model_config = {"from_attributes": True}


# ── Save & History endpoints ──────────────────────────────────────────────────

@router.post("/development-hub/saved", response_model=SavedAnalysisOut, tags=["development-hub"])
def save_analysis(
    req: SaveAnalysisRequest,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    from api.models import StoryAnalysis
    import json as _json

    row = StoryAnalysis(
        project_id   = req.project_id,
        title        = req.title.strip() or "Analysis",
        stories_json = req.stories_json,
        result_json  = req.result_json,
        model        = req.model,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    use_case_count = 0
    try:
        result = _json.loads(req.result_json)
        use_case_count = len(result.get("use_cases", []))
    except Exception:
        pass

    return SavedAnalysisOut(
        id=row.id,
        title=row.title,
        project_id=row.project_id,
        model=row.model,
        created_at=row.created_at.isoformat() if row.created_at else "",
        use_case_count=use_case_count,
    )


@router.get("/development-hub/saved", response_model=list[SavedAnalysisOut], tags=["development-hub"])
def list_analyses(
    project_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    from api.models import StoryAnalysis
    import json as _json

    q = db.query(StoryAnalysis)
    if project_id is not None:
        q = q.filter(StoryAnalysis.project_id == project_id)
    rows = q.order_by(StoryAnalysis.created_at.desc()).limit(100).all()

    result = []
    for row in rows:
        use_case_count = 0
        try:
            d = _json.loads(row.result_json)
            use_case_count = len(d.get("use_cases", []))
        except Exception:
            pass
        result.append(SavedAnalysisOut(
            id=row.id,
            title=row.title,
            project_id=row.project_id,
            model=row.model,
            created_at=row.created_at.isoformat() if row.created_at else "",
            use_case_count=use_case_count,
        ))
    return result


@router.get("/development-hub/saved/{analysis_id}", tags=["development-hub"])
def get_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    from api.models import StoryAnalysis
    import json as _json

    row = db.query(StoryAnalysis).filter(StoryAnalysis.id == analysis_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    return {
        "id":          row.id,
        "title":       row.title,
        "project_id":  row.project_id,
        "model":       row.model,
        "created_at":  row.created_at.isoformat() if row.created_at else "",
        "stories":     _json.loads(row.stories_json),
        "result":      _json.loads(row.result_json),
    }


@router.delete("/development-hub/saved/{analysis_id}", tags=["development-hub"])
def delete_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    from api.models import StoryAnalysis

    row = db.query(StoryAnalysis).filter(StoryAnalysis.id == analysis_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ── Export SQL endpoint ───────────────────────────────────────────────────────

class ExportSqlRequest(BaseModel):
    use_cases: list[dict]
    models: list[dict] = []


def _build_sql_file(uc: dict) -> str:
    outputs = uc.get("outputs", {})
    lines = [
        "-- " + "=" * 72,
        f"-- Use Case : {uc.get('name', 'Unnamed')}",
        f"-- Type     : {uc.get('type', '')} | Priority: {uc.get('priority', '')}",
        f"-- Entities : {', '.join(uc.get('entities', []))}",
        f"-- Metrics  : {', '.join(uc.get('metrics', []))}",
        "-- Generated by Clarity Studio — Development Hub",
        "-- " + "=" * 72,
        "",
        "-- DESCRIPTION",
        f"-- {uc.get('description', '')}",
        "",
        "-- " + "-" * 72,
        "-- DEVELOPMENT PROMPT",
        "-- " + "-" * 72,
    ]
    for ln in outputs.get("development_prompt", "").splitlines():
        lines.append(f"-- {ln}")
    lines += [
        "",
        "-- " + "-" * 72,
        "-- REPORT QUERY PROMPT",
        "-- " + "-" * 72,
    ]
    for ln in outputs.get("report_prompt", "").splitlines():
        lines.append(f"-- {ln}")
    lines += [
        "",
        "-- " + "-" * 72,
        "-- DASHBOARD PROMPT",
        "-- " + "-" * 72,
    ]
    for ln in outputs.get("dashboard_prompt", "").splitlines():
        lines.append(f"-- {ln}")
    lines += [
        "",
        "-- " + "-" * 72,
        "-- TESTING / VALIDATION PROMPT",
        "-- " + "-" * 72,
    ]
    for ln in outputs.get("testing_prompt", "").splitlines():
        lines.append(f"-- {ln}")
    lines.append("")
    return "\n".join(lines)


def _build_model_sql_file(model: dict) -> str:
    lines = [
        "-- " + "=" * 72,
        f"-- Model    : {model.get('name', 'Unnamed')}",
        f"-- Type     : {model.get('type', '')} | Grain: {model.get('grain', '')}",
        f"-- Entities : {', '.join(model.get('entities', []))}",
        f"-- Metrics  : {', '.join(model.get('metrics', []))}",
        f"-- Derived  : {', '.join(model.get('derived_metrics', []))}",
        "-- Generated by Clarity Studio — Development Hub (Model Grouping)",
        "-- " + "=" * 72,
        "",
        "-- " + "-" * 72,
        "-- DEVELOPMENT PROMPT",
        "-- " + "-" * 72,
    ]
    for ln in model.get("development_prompt", "").splitlines():
        lines.append(f"-- {ln}")

    for report in model.get("reports", []):
        lines += [
            "",
            "-- " + "-" * 72,
            f"-- REPORT: {report.get('name', '')}",
            f"-- {report.get('description', '')}",
            "-- " + "-" * 72,
        ]
        for ln in report.get("prompt", "").splitlines():
            lines.append(f"-- {ln}")

    lines += [
        "",
        "-- " + "-" * 72,
        "-- DASHBOARD PROMPT",
        "-- " + "-" * 72,
    ]
    for ln in model.get("dashboard_prompt", "").splitlines():
        lines.append(f"-- {ln}")

    lines += [
        "",
        "-- " + "-" * 72,
        "-- TESTING / VALIDATION PROMPT",
        "-- " + "-" * 72,
    ]
    for ln in model.get("testing_prompt", "").splitlines():
        lines.append(f"-- {ln}")
    lines.append("")
    return "\n".join(lines)


@router.post("/development-hub/export-sql", tags=["development-hub"])
def export_sql(
    req: ExportSqlRequest,
    _user=Depends(get_current_user),
):
    import io
    import zipfile
    from fastapi.responses import Response

    if not req.use_cases:
        raise HTTPException(status_code=422, detail="No use cases provided.")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Use-case level SQL files
        for uc in req.use_cases:
            safe_name = "".join(c if c.isalnum() or c in (" ", "-") else "_" for c in uc.get("name", "usecase"))
            filename  = safe_name.strip().replace(" ", "_").lower() + ".sql"
            content   = _build_sql_file(uc)
            zf.writestr(f"use_cases/{filename}", content)
        # Model level SQL files
        for model in req.models:
            safe_name = "".join(c if c.isalnum() or c in (" ", "-") else "_" for c in model.get("name", "model"))
            filename  = "model_" + safe_name.strip().replace(" ", "_").lower() + ".sql"
            content   = _build_model_sql_file(model)
            zf.writestr(f"models/{filename}", content)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="story_analysis_sql.zip"'},
    )


# ── Push to Clarity endpoint ──────────────────────────────────────────────────

class PushToClarityRequest(BaseModel):
    use_cases:  list[dict]
    models:     list[dict] = []
    conn_id:    Optional[int] = None
    project_id: Optional[int] = None


@router.post("/development-hub/push-to-clarity", tags=["development-hub"])
def push_to_clarity(
    req: PushToClarityRequest,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    from api.models import QueryContext, QueryExample
    import json as _json
    from datetime import datetime as _dt

    if not req.use_cases:
        raise HTTPException(status_code=422, detail="No use cases provided.")

    date_tag = f"[Development Hub — {_dt.utcnow().strftime('%Y-%m-%d')}]"
    contexts_added  = 0
    examples_added  = 0

    for uc in req.use_cases:
        name        = uc.get("name", "Unnamed")
        description = uc.get("description", "")
        entities    = uc.get("entities", [])
        metrics     = uc.get("metrics", [])
        dimensions  = uc.get("dimensions", [])
        outputs     = uc.get("outputs", {})
        report_prompt = outputs.get("report_prompt", "")

        # QueryContext entry
        ctx_content = (
            f"{date_tag}\n"
            f"## {name}\n"
            f"{description}\n\n"
            f"Entities: {', '.join(entities)}\n"
            f"Metrics: {', '.join(metrics)}\n"
            f"Dimensions: {', '.join(dimensions)}\n"
        )
        db.add(QueryContext(
            conn_id  = req.conn_id,
            content  = ctx_content,
        ))
        contexts_added += 1

        # QueryExample entry (from report_prompt)
        if report_prompt.strip():
            db.add(QueryExample(
                conn_id     = req.conn_id,
                name        = f"{date_tag} {name}",
                description = description,
                tables_used = ", ".join(entities[:5]),
                example_sql = report_prompt,
                is_active   = True,
            ))
            examples_added += 1

    # Model-level entries (Call C output)
    for model in req.models:
        name     = model.get("name", "Unnamed Model")
        grain    = model.get("grain", "")
        entities = model.get("entities", [])
        derived  = model.get("derived_metrics", [])
        metrics  = model.get("metrics", [])

        ctx_content = (
            f"{date_tag}\n"
            f"## Model: {name}\n"
            f"Grain: {grain}\n"
            f"Entities: {', '.join(entities)}\n"
            f"Metrics: {', '.join(metrics)}\n"
            f"Derived Metrics: {', '.join(derived)}\n"
        )
        db.add(QueryContext(
            conn_id = req.conn_id,
            content = ctx_content,
        ))
        contexts_added += 1

        for report in model.get("reports", []):
            prompt = report.get("prompt", "")
            if prompt.strip():
                db.add(QueryExample(
                    conn_id     = req.conn_id,
                    name        = f"{date_tag} {name} — {report.get('name', 'Report')}",
                    description = report.get("description", ""),
                    tables_used = ", ".join(entities[:5]),
                    example_sql = prompt,
                    is_active   = True,
                ))
                examples_added += 1

    db.commit()
    return {
        "query_contexts_added":  contexts_added,
        "query_examples_added":  examples_added,
    }
