"""
api/routers/development.py

Development module — AI-powered data engineering & pipeline orchestration.

Endpoints:
  POST   /api/dev/plan                    — AI generates step-by-step plan
  POST   /api/dev/generate                — AI generates SQL/SP for one plan step
  POST   /api/dev/validate                — Safety + schema validation (no execution)
  POST   /api/dev/execute                 — Validate then run SQL
  POST   /api/dev/explain                 — Plain-English explanation of SQL
  POST   /api/dev/suggest-fix             — AI-corrected SQL from error message
  POST   /api/dev/pipeline/{id}/run       — Execute all steps in dependency order
  GET    /api/dev/history/{conn_id}       — List artifacts for a connection
  GET    /api/dev/artifacts/{id}          — Get single artifact
  DELETE /api/dev/artifacts/{id}          — Delete artifact
"""
from __future__ import annotations

import json
from collections import defaultdict, deque
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import DevArtifact, SourceConnection
from api.schemas import (
    PlanRequest, PlanResponse, PlanStep,
    GenerateRequest, GenerateResponse,
    ValidateRequest, ExecuteRequest, ExplainRequest, SuggestFixRequest,
    DevArtifactOut, ValidationResultOut,
)
from api.services import ai_engine
from api.services.context_cache import get_or_build
from api.services.validation_guard import validate_sql_safety, validate_sql_schema
from api.services.connector import preview_data

router = APIRouter()


# ── Shared helpers ─────────────────────────────────────────────

def _get_conn(conn_id: int, db: Session) -> SourceConnection:
    conn = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail=f"Connection {conn_id} not found")
    return conn


def _to_cfg(conn: SourceConnection) -> dict:
    """Decrypt stored credentials into connector config dict."""
    from api.services.encryption import decrypt
    return {
        "source_type": conn.source_type,
        "dialect":     conn.dialect,
        "host":        conn.host,
        "port":        conn.port,
        "database":    conn.database_name,
        "schema":      conn.schema_name,
        "username":    conn.username,
        "password":    decrypt(conn.password_enc),
        "account":     conn.sf_account,
        "warehouse":   conn.sf_warehouse,
        "role":        conn.sf_role,
        "sf_database": conn.sf_database,
        "sf_schema":   conn.sf_schema,
        "sf_username": conn.sf_username,
        "sf_password": decrypt(conn.sf_password_enc),
        "private_key": decrypt(conn.sf_private_key_enc),
        "sf_private_key_passphrase": decrypt(conn.sf_private_key_passphrase_enc),
        "query":       conn.query_text,
        "sheet_alias": conn.sheet_alias,
    }


def _clean_err(raw: str) -> str:
    import re
    raw = raw.split("\n(Background on this error")[0].strip()
    segments = re.findall(r'\][^\[;(]{5,}', raw)
    if segments:
        for seg in reversed(segments):
            clean = seg.lstrip('] \t').strip().rstrip('.')
            if len(clean) > 15 and not re.fullmatch(r'[\d\s\-]+', clean):
                return clean
    return raw[:300]


def _get_artifact(artifact_id: int, db: Session) -> DevArtifact:
    row = db.query(DevArtifact).filter(DevArtifact.id == artifact_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found")
    return row


def _topo_sort(steps: list[dict]) -> list[dict]:
    """Topological sort of plan steps by depends_on."""
    graph: dict[int, list[int]] = defaultdict(list)
    in_degree: dict[int, int] = {}

    for s in steps:
        n = s["step_number"]
        in_degree.setdefault(n, 0)
        for dep in (s.get("depends_on") or []):
            graph[dep].append(n)
            in_degree[n] = in_degree.get(n, 0) + 1

    queue = deque(n for n in in_degree if in_degree[n] == 0)
    order = []
    while queue:
        n = queue.popleft()
        order.append(n)
        for nbr in graph[n]:
            in_degree[nbr] -= 1
            if in_degree[nbr] == 0:
                queue.append(nbr)

    step_map = {s["step_number"]: s for s in steps}
    return [step_map[n] for n in order if n in step_map]


# ── POST /api/dev/plan ─────────────────────────────────────────

@router.post("/dev/plan", response_model=PlanResponse)
def generate_plan(req: PlanRequest, db: Session = Depends(get_db)):
    conn = _get_conn(req.conn_id, db)  # noqa — validates existence
    context = get_or_build(req.conn_id, db)

    try:
        steps = ai_engine.plan(
            task=req.task_description,
            context=context,
            model=req.model,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI plan failed: {exc}")

    # Build pipeline_config adjacency list from depends_on
    pipeline: dict[str, list[int]] = {}
    for s in steps:
        pipeline[str(s["step_number"])] = s.get("depends_on") or []

    artifact = DevArtifact(
        conn_id=req.conn_id,
        task_description=req.task_description,
        plan_json=json.dumps(steps),
        pipeline_config=json.dumps(pipeline),
        status="draft",
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)

    return PlanResponse(
        artifact_id=artifact.id,
        steps=[PlanStep(**s) for s in steps],
    )


# ── POST /api/dev/generate ─────────────────────────────────────

@router.post("/dev/generate", response_model=GenerateResponse)
def generate_sql(req: GenerateRequest, db: Session = Depends(get_db)):
    artifact = _get_artifact(req.artifact_id, db)
    if not artifact.plan_json:
        raise HTTPException(status_code=400, detail="Artifact has no plan yet")

    steps = json.loads(artifact.plan_json)
    step = next((s for s in steps if s["step_number"] == req.step_number), None)
    if not step:
        raise HTTPException(status_code=404, detail=f"Step {req.step_number} not found in plan")

    context = get_or_build(artifact.conn_id, db)

    # Collect already-generated SQL for prior steps as context
    prior_sqls: list[str] = []
    if artifact.artifacts_json:
        items = json.loads(artifact.artifacts_json)
        for item in items:
            if item.get("sql") and item["step_number"] < req.step_number:
                prior_sqls.append(item["sql"])

    try:
        sql = ai_engine.generate_artifact(
            step=step,
            context=context,
            prior_sqls=prior_sqls,
            model=req.model,
            db=db,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    # Merge into artifacts_json
    items: list[dict] = json.loads(artifact.artifacts_json) if artifact.artifacts_json else []
    existing = next((i for i in items if i["step_number"] == req.step_number), None)
    if existing:
        existing["sql"] = sql
        existing["status"] = "generated"
        existing.pop("error", None)
    else:
        items.append({"step_number": req.step_number, "sql": sql, "status": "generated"})

    artifact.artifacts_json = json.dumps(items)
    artifact.updated_at = datetime.utcnow()
    db.commit()

    return GenerateResponse(step_number=req.step_number, sql=sql)


# ── POST /api/dev/validate ─────────────────────────────────────

@router.post("/dev/validate", response_model=ValidationResultOut)
def validate_sql(req: ValidateRequest, db: Session = Depends(get_db)):
    safety = validate_sql_safety(req.sql)
    if not safety.passed:
        return ValidationResultOut(
            passed=False,
            errors=safety.errors,
            warnings=safety.warnings,
        )

    context = get_or_build(req.conn_id, db)
    schema_check = validate_sql_schema(req.sql, context)

    return ValidationResultOut(
        passed=safety.passed and schema_check.passed,
        errors=safety.errors + schema_check.errors,
        warnings=safety.warnings + schema_check.warnings,
    )


# ── POST /api/dev/execute ──────────────────────────────────────

@router.post("/dev/execute")
def execute_sql(req: ExecuteRequest, db: Session = Depends(get_db)):
    # Validation gate (unless explicitly skipped)
    if not req.skip_validation:
        safety = validate_sql_safety(req.sql)
        if not safety.passed:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "SQL failed safety validation",
                    "errors": safety.errors,
                    "warnings": safety.warnings,
                },
            )

    conn = _get_conn(req.conn_id, db)
    cfg = _to_cfg(conn)
    cfg["query"] = req.sql

    try:
        result = preview_data(cfg, limit=req.limit)
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=_clean_err(str(exc)))


# ── POST /api/dev/explain ──────────────────────────────────────

@router.post("/dev/explain")
def explain_sql(req: ExplainRequest, db: Session = Depends(get_db)):
    context = get_or_build(req.conn_id, db)
    try:
        explanation = ai_engine.explain(
            sql=req.sql,
            context=context,
            model=req.model,
            db=db,
        )
        return {"explanation": explanation}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Explain failed: {exc}")


# ── POST /api/dev/suggest-fix ──────────────────────────────────

@router.post("/dev/suggest-fix")
def suggest_fix(req: SuggestFixRequest, db: Session = Depends(get_db)):
    context = get_or_build(req.conn_id, db)
    try:
        fixed_sql = ai_engine.suggest_fix(
            error=req.error,
            sql=req.sql,
            context=context,
            model=req.model,
            db=db,
        )
        return {"sql": fixed_sql}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Suggest fix failed: {exc}")


# ── POST /api/dev/pipeline/{id}/run ───────────────────────────

@router.post("/dev/pipeline/{artifact_id}/run")
def run_pipeline(artifact_id: int, db: Session = Depends(get_db)):
    """
    Execute all generated SQL steps in topological order.
    Steps that fail mark themselves as 'error' and their dependents are skipped.
    """
    artifact = _get_artifact(artifact_id, db)
    if not artifact.plan_json:
        raise HTTPException(status_code=400, detail="Artifact has no plan")

    if not artifact.conn_id:
        raise HTTPException(status_code=400, detail="Artifact has no connection")

    steps = json.loads(artifact.plan_json)
    items: list[dict] = json.loads(artifact.artifacts_json) if artifact.artifacts_json else []
    items_map = {i["step_number"]: i for i in items}

    conn = _get_conn(artifact.conn_id, db)
    cfg = _to_cfg(conn)

    sorted_steps = _topo_sort(steps)
    failed_steps: set[int] = set()
    results: list[dict] = []

    artifact.status = "running"
    db.commit()

    for step in sorted_steps:
        sn = step["step_number"]
        item = items_map.get(sn, {"step_number": sn, "status": "pending"})

        if not item.get("sql"):
            item["status"] = "skipped"
            item["error"] = "No SQL generated for this step"
            results.append(item)
            continue

        # Skip if any dependency failed
        deps = step.get("depends_on") or []
        blocked = [d for d in deps if d in failed_steps]
        if blocked:
            item["status"] = "skipped"
            item["error"] = f"Skipped: dependency step(s) {blocked} failed"
            results.append(item)
            failed_steps.add(sn)
            continue

        # Safety check
        safety = validate_sql_safety(item["sql"])
        if not safety.passed:
            item["status"] = "error"
            item["error"] = "; ".join(safety.errors)
            results.append(item)
            failed_steps.add(sn)
            continue

        # Execute
        try:
            cfg["query"] = item["sql"]
            result = preview_data(cfg, limit=500)
            item["status"] = "executed"
            item["result"] = {
                "columns": result.get("columns", []),
                "rows": result.get("rows", [])[:50],  # cap for storage
                "total": result.get("total", 0),
            }
            item.pop("error", None)
        except Exception as exc:
            item["status"] = "error"
            item["error"] = _clean_err(str(exc))
            failed_steps.add(sn)

        results.append(item)

    # Persist results
    artifact.artifacts_json = json.dumps(results)
    artifact.status = "error" if failed_steps else "complete"
    artifact.updated_at = datetime.utcnow()
    db.commit()

    return {
        "artifact_id": artifact_id,
        "status": artifact.status,
        "steps": results,
    }


# ── GET /api/dev/history/{conn_id} ────────────────────────────

@router.get("/dev/history/{conn_id}", response_model=list[DevArtifactOut])
def get_history(conn_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(DevArtifact)
        .filter(DevArtifact.conn_id == conn_id)
        .order_by(DevArtifact.created_at.desc())
        .limit(50)
        .all()
    )
    return rows


# ── GET /api/dev/artifacts/{id} ───────────────────────────────

@router.get("/dev/artifacts/{artifact_id}", response_model=DevArtifactOut)
def get_artifact(artifact_id: int, db: Session = Depends(get_db)):
    return _get_artifact(artifact_id, db)


# ── DELETE /api/dev/artifacts/{id} ────────────────────────────

@router.delete("/dev/artifacts/{artifact_id}")
def delete_artifact(artifact_id: int, db: Session = Depends(get_db)):
    row = _get_artifact(artifact_id, db)
    db.delete(row)
    db.commit()
    return {"deleted": artifact_id}


# ── POST /api/dev/brd-analyze ─────────────────────────────────
#  Accepts a BRD (Business Requirements Document) text and returns
#  a structured list of acceptance criteria with SQL validation queries.

class BRDRequest(BaseModel):
    conn_id: int
    brd_text: str
    model: str = "gpt-4o-mini"


@router.post("/dev/brd-analyze")
def brd_analyze(req: BRDRequest, db: Session = Depends(get_db)):
    """
    Analyzes a BRD using schema-aware RAG and returns:
    - Structured acceptance criteria (Given/When/Then)
    - SQL validation queries for each criterion
    - Priority and complexity indicators
    """
    import time
    import json as _json
    from openai import OpenAI
    from api.config import settings
    from api.services.context_cache import get_or_build
    from api.services import ai_trace as _at

    _get_conn(req.conn_id, db)  # validate connection exists
    ctx = get_or_build(req.conn_id, db)

    # Build schema summary for prompt
    # ctx.tables structure: [{"table": "TableName", "columns": [{"column":..., "data_type":...}]}]
    tables_summary = "\n".join(
        f"- {t.get('table', t.get('table_name', '?'))}: "
        f"{', '.join(c.get('column', c.get('column_name', '?')) for c in t.get('columns', []))}"
        for t in (ctx.tables or [])[:30]
    )
    # ctx.relations structure: [{"parent_table":..., "parent_column":..., "referenced_table":..., "referenced_column":...}]
    relations_summary = "\n".join(
        f"- {r.get('parent_table', r.get('from_table', '?'))}.{r.get('parent_column', r.get('from_column', '?'))}"
        f" → {r.get('referenced_table', r.get('to_table', '?'))}.{r.get('referenced_column', r.get('to_column', '?'))}"
        for r in (ctx.relations or [])[:20]
    )

    system_prompt = f"""You are a senior business analyst and data engineer.
You analyze Business Requirements Documents (BRDs) and produce structured acceptance criteria
that can be validated against a database schema.

Available schema:
{tables_summary or 'No schema available — write generic SQL.'}

Relationships:
{relations_summary or 'None discovered.'}

For each requirement in the BRD, output a JSON array of acceptance criteria objects:
{{
  "id": <int>,
  "feature": "<short feature name>",
  "given": "<precondition / data state>",
  "when": "<action or trigger>",
  "then": "<expected outcome>",
  "sql_validation": "<SQL SELECT query that validates this criterion (must return rows when passing)>",
  "priority": "high|medium|low",
  "complexity": "simple|moderate|complex",
  "notes": "<any implementation notes or caveats>"
}}

Output ONLY the JSON array — no prose, no markdown fences."""

    user_prompt = f"BRD:\n\n{req.brd_text}"

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0 = time.time()
    try:
        response = client.chat.completions.create(
            model=req.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=4096,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {exc}")

    latency = int((time.time() - t0) * 1000)
    raw = response.choices[0].message.content or "[]"

    # Store trace
    _at.store(
        module="brd",
        conn_id=req.conn_id,
        model=req.model,
        prompt=system_prompt + "\n---\n" + user_prompt,
        response=raw,
        tokens_in=response.usage.prompt_tokens if response.usage else 0,
        tokens_out=response.usage.completion_tokens if response.usage else 0,
        latency_ms=latency,
        db=db,
    )

    # Parse JSON — strip markdown fences if the model added them
    clean = raw.strip()
    if clean.startswith("```"):
        clean = "\n".join(clean.split("\n")[1:])
        if clean.endswith("```"):
            clean = clean[:-3].strip()
    try:
        criteria = _json.loads(clean)
        if not isinstance(criteria, list):
            criteria = [criteria]
    except Exception:
        raise HTTPException(status_code=500, detail=f"Could not parse AI response as JSON: {raw[:500]}")

    return {
        "criteria": criteria,
        "summary": f"{len(criteria)} acceptance criteria generated from BRD",
        "conn_id": req.conn_id,
        "model": req.model,
    }


# ── POST /api/dev/fetch-external ──────────────────────────────
#  Proxy endpoint to fetch JIRA / Azure DevOps work items server-side
#  (avoids CORS and keeps credentials out of browser).

class FetchExternalRequest(BaseModel):
    source_type: str           # 'jira' | 'ado'
    resource_id: str           # Issue key (PROJ-123) or work item ID (456)
    url: Optional[str] = None  # omit → loaded from saved integration config
    token: Optional[str] = None
    extra: Optional[dict] = None  # e.g. {"username": "..."} for JIRA basic auth


@router.post("/dev/fetch-external")
def fetch_external(req: FetchExternalRequest, db: Session = Depends(get_db)):
    """
    Fetch a JIRA issue or Azure DevOps work item and return extracted text.
    Credentials are loaded from the saved Admin integration config when not provided.
    """
    import base64
    import httpx
    from api.models import ExternalIntegration
    from api.services.encryption import decrypt

    # Resolve credentials — prefer request fields, fall back to saved config
    url = req.url
    token = req.token
    username = (req.extra or {}).get("username")

    if not url or not token:
        saved = db.query(ExternalIntegration).filter(ExternalIntegration.type == req.source_type).first()
        if not saved:
            raise HTTPException(
                status_code=400,
                detail=f"No {req.source_type.upper()} integration configured in Admin. "
                       "Please configure it under Admin → Integrations first.",
            )
        url = url or saved.base_url
        token = token or decrypt(saved.token_enc)
        username = username or saved.username

    headers: dict = {"Accept": "application/json"}
    fetch_url: str = ""

    try:
        if req.source_type == "jira":
            if username:
                creds = base64.b64encode(f"{username}:{token}".encode()).decode()
                headers["Authorization"] = f"Basic {creds}"
            else:
                headers["Authorization"] = f"Bearer {token}"
            base = url.rstrip("/")
            fetch_url = f"{base}/rest/api/3/issue/{req.resource_id}"

        elif req.source_type == "ado":
            creds = base64.b64encode(f":{token}".encode()).decode()
            headers["Authorization"] = f"Basic {creds}"
            base = url.rstrip("/")
            fetch_url = f"{base}/_apis/wit/workitems/{req.resource_id}?api-version=7.0&$expand=all"

        else:
            raise HTTPException(status_code=400, detail=f"Unknown source_type: {req.source_type}")

        with httpx.Client(timeout=15) as client:
            resp = client.get(fetch_url, headers=headers)
            resp.raise_for_status()
            data = resp.json()

    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"External API error: {exc.response.text[:500]}",
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch from {req.source_type}: {exc}")

    # Extract readable text from the response
    extracted = _extract_text(req.source_type, data, req.resource_id)
    return {"source_type": req.source_type, "resource_id": req.resource_id, "text": extracted, "raw": data}


def _extract_text(source_type: str, data: dict, resource_id: str) -> str:
    """Convert JIRA / ADO JSON into human-readable requirement text."""
    if source_type == "jira":
        fields = data.get("fields", {})
        summary = fields.get("summary", "")
        desc_obj = fields.get("description") or {}
        # JIRA description can be Atlassian Document Format (ADF) or plain text
        description = _flatten_adf(desc_obj) if isinstance(desc_obj, dict) else str(desc_obj or "")
        acceptance = ""
        for cf_key in [
            "customfield_10016", "customfield_10014", "customfield_10015",
            "customfield_10900",  # common AC custom fields
        ]:
            val = fields.get(cf_key)
            if val:
                acceptance = _flatten_adf(val) if isinstance(val, dict) else str(val)
                break
        issue_type = (fields.get("issuetype") or {}).get("name", "Issue")
        status = (fields.get("status") or {}).get("name", "")
        priority = (fields.get("priority") or {}).get("name", "")
        parts = [
            f"JIRA {issue_type}: {resource_id}",
            f"Status: {status}  Priority: {priority}",
            f"Summary: {summary}",
            "",
            "Description:",
            description or "(no description)",
        ]
        if acceptance:
            parts += ["", "Acceptance Criteria:", acceptance]
        return "\n".join(parts)

    elif source_type == "ado":
        fields = data.get("fields", {})
        title       = fields.get("System.Title", "")
        description = _strip_html(fields.get("System.Description", "") or "")
        ac_raw      = fields.get("Microsoft.VSTS.Common.AcceptanceCriteria", "") or ""
        acceptance  = _strip_html(ac_raw)
        wi_type     = fields.get("System.WorkItemType", "Work Item")
        state       = fields.get("System.State", "")
        priority    = fields.get("Microsoft.VSTS.Common.Priority", "")
        parts = [
            f"ADO {wi_type}: #{resource_id}",
            f"State: {state}  Priority: {priority}",
            f"Title: {title}",
            "",
            "Description:",
            description or "(no description)",
        ]
        if acceptance:
            parts += ["", "Acceptance Criteria:", acceptance]
        return "\n".join(parts)

    return str(data)


def _flatten_adf(node) -> str:
    """Recursively extract plain text from Atlassian Document Format JSON."""
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
    """Very lightweight HTML stripper for ADO descriptions."""
    import re as _re
    text = _re.sub(r"<br\s*/?>", "\n", html, flags=_re.IGNORECASE)
    text = _re.sub(r"</p>|</li>|</div>", "\n", text, flags=_re.IGNORECASE)
    text = _re.sub(r"<[^>]+>", "", text)
    return text.strip()
