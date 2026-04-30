"""
reconciliation.py — REST endpoints for the Dev vs Base Reconciliation Engine.

Endpoints:
  POST   /reconciliation/{conn_id}/collect-queries  → auto-generate Q2 BASE queries
  GET    /reconciliation/{conn_id}/queries           → list TestQuery rows
  POST   /reconciliation/{conn_id}/queries           → manually add a TestQuery
  PUT    /reconciliation/{conn_id}/queries/{qid}     → update a TestQuery
  DELETE /reconciliation/{conn_id}/queries/{qid}     → delete a TestQuery
  POST   /reconciliation/{conn_id}/run               → run reconciliation
  GET    /reconciliation/{conn_id}/runs              → list run summaries
  GET    /reconciliation/{conn_id}/runs/{run_id}     → get all results for a run
  GET    /reconciliation/{conn_id}/email-preview     → HTML email report preview
  POST   /reconciliation/{conn_id}/send-email        → send report via SMTP
"""
from __future__ import annotations

import json
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import (
    SourceConnection,
    TestQuery,
    ReconciliationResult,
)
from api.schemas import (
    TestQueryCreate,
    TestQueryUpdate,
    TestQueryOut,
    ReconciliationResultOut,
    RunSummaryOut,
    ReconciliationRunRequest,
)
from api.services.encryption import decrypt

from api.dependencies import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])


# ── Helper: build connector cfg dict from ORM row ─────────────────────────────

def _to_cfg(conn: SourceConnection) -> dict:
    if conn.source_type == "snowflake":
        pw = decrypt(conn.sf_password_enc) if conn.sf_password_enc else ""
        pk = decrypt(conn.sf_private_key_enc) if conn.sf_private_key_enc else None
        pk_pass = decrypt(conn.sf_private_key_passphrase_enc) if conn.sf_private_key_passphrase_enc else None
        return {
            "source_type": "snowflake",
            "dialect": "snowflake",
            "account": conn.sf_account,
            "warehouse": conn.sf_warehouse,
            "role": conn.sf_role,
            "database": conn.sf_database,
            "schema": conn.sf_schema,
            "username": conn.sf_username,
            "password": pw,
            "private_key": pk,
            "private_key_passphrase": pk_pass,
        }
    else:
        pw = decrypt(conn.password_enc) if conn.password_enc else ""
        return {
            "source_type": conn.source_type,
            "dialect": conn.dialect or "mssql",
            "host": conn.host,
            "port": conn.port,
            "database": conn.database_name,
            "schema": conn.schema_name,
            "username": conn.username,
            "password": pw,
        }


def _get_conn_or_404(conn_id: int, db: Session) -> SourceConnection:
    conn = db.query(SourceConnection).filter_by(id=conn_id, is_active=True).first()
    if not conn:
        raise HTTPException(status_code=404, detail=f"Connection {conn_id} not found.")
    return conn


# ── Confidence + Coverage score helpers ───────────────────────────────────────

def _compute_confidence(results: list) -> float:
    non_skip = [r for r in results if r.status != "SKIP"]
    if not non_skip:
        return 0.0
    pass_rate = sum(1 for r in non_skip if r.status == "PASS") / len(non_skip)
    crit = [r for r in non_skip if _is_critical_result(r)]
    crit_rate = (
        sum(1 for r in crit if r.status == "PASS") / len(crit)
        if crit else 1.0
    )
    return round(0.4 * pass_rate + 0.6 * crit_rate, 2)


def _is_critical_result(r) -> bool:
    """A result is 'critical' if its query_type is count, duplicate, or set_diff."""
    return r.query_type in ("count", "duplicate", "set_diff", "join_explosion")


def _build_run_summary(
    run_id: str,
    conn_id: int,
    results: list,
    coverage_score: float = 0.0,
) -> RunSummaryOut:
    created_at = results[0].created_at.isoformat() if results else ""
    dev_source_type = results[0].dev_source_type if results else None
    dev_source_id = results[0].dev_source_id if results else None

    total = len(results)
    passed = sum(1 for r in results if r.status == "PASS")
    failed = sum(1 for r in results if r.status == "FAIL")
    warns = sum(1 for r in results if r.status == "WARN")
    errors = sum(1 for r in results if r.status == "ERROR")
    skipped = sum(1 for r in results if r.status == "SKIP")
    confidence = _compute_confidence(results)

    return RunSummaryOut(
        run_id=run_id,
        conn_id=conn_id,
        created_at=created_at,
        total=total,
        passed=passed,
        failed=failed,
        warns=warns,
        errors=errors,
        skipped=skipped,
        confidence_score=confidence,
        coverage_score=coverage_score,
        dev_source_type=dev_source_type,
        dev_source_id=dev_source_id,
    )


# ── Endpoint: multi-source AI comparison (fixed path — must precede /{conn_id}/) ──

@router.post("/reconciliation/multi-compare")
async def multi_compare(
    slots: str = Form(...),
    user_instructions: str = Form(default=""),
    project_id: Optional[int] = Form(default=None),
    file_0: Optional[UploadFile] = File(default=None),
    file_1: Optional[UploadFile] = File(default=None),
    file_2: Optional[UploadFile] = File(default=None),
    file_3: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
):
    try:
        slot_dicts = json.loads(slots)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid 'slots' JSON")

    file_map = {0: file_0, 1: file_1, 2: file_2, 3: file_3}

    import traceback as _tb
    from api.services.multi_compare import run_multi_compare
    from api.services.debug_collector import get_debug_session
    session = get_debug_session("multi_compare", db)
    try:
        result = await run_multi_compare(
            slot_dicts=slot_dicts,
            file_map=file_map,
            user_instructions=user_instructions.strip(),
            db=db,
            session=session,
        )
        # Backfill project_id on the saved run row
        if project_id:
            try:
                from api.models import CompareRun
                row = db.query(CompareRun).filter_by(run_id=result["run_id"]).first()
                if row:
                    row.project_id = project_id
                    db.commit()
            except Exception:
                pass
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        _tb.print_exc()
        raise HTTPException(status_code=500, detail=f"Multi-compare failed: {exc}\n\n{_tb.format_exc()}")


# ── Compare run history ───────────────────────────────────────────────────────

@router.get("/reconciliation/compare-history")
def compare_history(
    project_id: Optional[int] = None,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    from api.models import CompareRun
    q = db.query(CompareRun)
    if project_id:
        q = q.filter(CompareRun.project_id == project_id)
    runs = q.order_by(CompareRun.created_at.desc()).limit(limit).all()
    return [
        {
            "id":                r.id,
            "run_id":            r.run_id,
            "project_id":        r.project_id,
            "user_instructions": r.user_instructions,
            "overall_verdict":   r.overall_verdict,
            "verdict_summary":   r.verdict_summary,
            "datasets":          json.loads(r.datasets_json) if r.datasets_json else [],
            "created_at":        r.created_at.isoformat() if r.created_at else None,
        }
        for r in runs
    ]


@router.get("/reconciliation/compare-history/{run_id}/result")
def compare_run_result(run_id: str, db: Session = Depends(get_db)):
    from api.models import CompareRun
    row = db.query(CompareRun).filter_by(run_id=run_id).first()
    if not row or not row.result_json:
        raise HTTPException(status_code=404, detail="Run not found.")
    data = json.loads(row.result_json)
    if row.slots_json:
        data["_slots"] = json.loads(row.slots_json)
    return data


# ── Post-compare AI chat ──────────────────────────────────────────────────────

@router.post("/reconciliation/compare-chat")
def compare_chat(
    req: dict,
    db: Session = Depends(get_db),
):
    """
    Answer a user question about a previously stored compare run.
    Body: { run_id, question, history: [{role, content}] }
    """
    from api.models import CompareRun
    from api.config import settings
    import time as _time

    run_id   = req.get("run_id", "")
    question = req.get("question", "").strip()
    history  = req.get("history") or []

    if not run_id or not question:
        raise HTTPException(status_code=422, detail="run_id and question are required.")

    row = db.query(CompareRun).filter_by(run_id=run_id).first()
    if not row or not row.result_json:
        raise HTTPException(status_code=404, detail="Compare run not found.")

    stored = json.loads(row.result_json)

    # Build context from stored result
    datasets_block = "\n".join(
        f"- Dataset '{d['label']}': {d['row_count']} rows, {d['column_count']} columns, "
        f"source={d['source_type']}, columns={', '.join(d.get('columns', [])[:20])}"
        for d in stored.get("datasets", [])
    )
    checks_block = "\n".join(
        f"- [{c['status']}] {c['check_name']}: {c['detail']}"
        for c in stored.get("checks", [])
    )
    system_prompt = f"""\
You are a data comparison analyst. Answer questions about the following AI comparison run.

== DATASETS ==
{datasets_block}

== COMPARISON CHECKS ==
Verdict: {stored.get('overall_verdict', '?')} — {stored.get('verdict_summary', '')}
{checks_block}

== AI NARRATIVE ==
{stored.get('ai_narrative', '')}

== RULES ==
- Answer ONLY based on the comparison data shown above.
- If the question cannot be answered from this data, say so clearly.
- Be concise and precise. Reference dataset names and check names in your answers.
- If asked to suggest fixes, base suggestions on the checks and narrative above.
"""

    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for turn in history[-6:]:
        role = turn.get("role", "")
        content = str(turn.get("content", ""))[:2000]
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})

    t0 = _time.monotonic()
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=0.3,
    )
    elapsed_ms = int((_time.monotonic() - t0) * 1000)
    answer = resp.choices[0].message.content or ""

    return {
        "answer":     answer,
        "tokens_in":  resp.usage.prompt_tokens,
        "tokens_out": resp.usage.completion_tokens,
        "elapsed_ms": elapsed_ms,
    }


# ── Endpoint: auto-generate Q2 BASE queries ────────────────────────────────────

@router.post("/reconciliation/{conn_id}/collect-queries")
def collect_queries(
    conn_id: int,
    db: Session = Depends(get_db),
):
    conn = _get_conn_or_404(conn_id, db)
    cfg = _to_cfg(conn)

    from api.services.agents.query_collector_agent import QueryCollectorAgent
    from api.config import settings
    openai_client = None
    try:
        from openai import OpenAI
        if settings.OPENAI_API_KEY:
            openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
    except Exception:
        pass
    agent = QueryCollectorAgent(
        conn_id=conn_id,
        db=db,
        openai_client=openai_client,
        dialect=conn.dialect or "mssql",
    )
    result = agent.run()

    return {
        "generated": result.total_generated,
        "by_type": result.by_type,
        "errors": result.errors,
        "coverage": {
            "tables_covered": result.coverage.tables_covered,
            "tables_total": result.coverage.tables_total,
            "fk_coverage": result.coverage.fk_coverage,
            "col_coverage": result.coverage.col_coverage,
            "overall": result.coverage.overall,
        } if result.coverage else None,
    }


# ── Endpoint: list Q2 queries ─────────────────────────────────────────────────

@router.get("/reconciliation/{conn_id}/queries", response_model=list[TestQueryOut])
def list_queries(
    conn_id: int,
    db: Session = Depends(get_db),
):
    _get_conn_or_404(conn_id, db)
    rows = (
        db.query(TestQuery)
        .filter_by(conn_id=conn_id)
        .order_by(TestQuery.id.desc())
        .all()
    )
    return rows


# ── Endpoint: manually add a Q2 query ─────────────────────────────────────────

@router.post("/reconciliation/{conn_id}/queries", response_model=TestQueryOut)
def add_query(
    conn_id: int,
    body: TestQueryCreate,
    db: Session = Depends(get_db),
):
    _get_conn_or_404(conn_id, db)
    tq = TestQuery(
        conn_id=conn_id,
        query_type=body.query_type,
        name=body.name,
        sql_text=body.sql_text,
        table_name=body.table_name,
        column_name=body.column_name,
        priority=body.priority,
        severity=body.severity,
        is_auto_generated=body.is_auto_generated,
    )
    db.add(tq)
    db.commit()
    db.refresh(tq)
    return tq


# ── Endpoint: update a Q2 query ───────────────────────────────────────────────

@router.put("/reconciliation/{conn_id}/queries/{qid}", response_model=TestQueryOut)
def update_query(
    conn_id: int,
    qid: int,
    body: TestQueryUpdate,
    db: Session = Depends(get_db),
):
    _get_conn_or_404(conn_id, db)
    tq = db.query(TestQuery).filter_by(id=qid, conn_id=conn_id).first()
    if not tq:
        raise HTTPException(status_code=404, detail=f"TestQuery {qid} not found.")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(tq, field, value)
    db.commit()
    db.refresh(tq)
    return tq


# ── Endpoint: delete a Q2 query ───────────────────────────────────────────────

@router.delete("/reconciliation/{conn_id}/queries/{qid}")
def delete_query(
    conn_id: int,
    qid: int,
    db: Session = Depends(get_db),
):
    _get_conn_or_404(conn_id, db)
    tq = db.query(TestQuery).filter_by(id=qid, conn_id=conn_id).first()
    if not tq:
        raise HTTPException(status_code=404, detail=f"TestQuery {qid} not found.")
    db.delete(tq)
    db.commit()
    return {"deleted": True, "id": qid}


# ── Endpoint: preview resolved Q1 DEV SQL ────────────────────────────────────

@router.post("/reconciliation/{conn_id}/preview-q1")
def preview_q1(
    conn_id: int,
    body: ReconciliationRunRequest,
    db: Session = Depends(get_db),
):
    """
    Resolve and return the Q1 (DEV) SQL without executing anything.
    Used by the Run tab so QA can review the query before launching reconciliation.
    """
    _get_conn_or_404(conn_id, db)
    from api.services.agents.reconciliation_agent import resolve_dev_sql
    try:
        sql = resolve_dev_sql(
            source_type=body.source_type,
            source_id=body.source_id,
            source_sub_id=body.source_sub_id,
            adhoc_sql=body.adhoc_sql,
            conn_id=conn_id,
            db=db,
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not resolve Q1 SQL: {exc}")
    return {"sql": sql, "source_type": body.source_type, "source_id": body.source_id}


# ── Endpoint: run reconciliation ──────────────────────────────────────────────

@router.post("/reconciliation/{conn_id}/run")
def run_reconciliation(
    conn_id: int,
    body: ReconciliationRunRequest,
    db: Session = Depends(get_db),
):
    _get_conn_or_404(conn_id, db)   # validates connection exists and is active

    from api.services.agents.reconciliation_agent import ReconciliationAgent
    from api.config import settings
    openai_client = None
    try:
        from openai import OpenAI
        if settings.OPENAI_API_KEY:
            openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
    except Exception:
        pass

    try:
        agent = ReconciliationAgent(
            conn_id=conn_id,
            db=db,
            openai_client=openai_client,
            source_type=body.source_type,
            source_id=body.source_id,
            source_sub_id=body.source_sub_id,
            adhoc_sql=body.adhoc_sql,
            sampling_mode=body.sampling_mode,
            sample_size=body.sample_size,
            stratify_col=body.stratify_col,
            base_query_scope=body.base_query_scope,
        )
        run_result = agent.run()
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        # Surface unexpected errors (e.g. missing model, import failures) as 500 with detail
        raise HTTPException(status_code=500, detail=f"Reconciliation failed: {str(exc)}")

    # Build summary from DB results
    results = (
        db.query(ReconciliationResult)
        .filter_by(conn_id=conn_id, run_id=run_result.run_id)
        .all()
    )
    summary = _build_run_summary(run_result.run_id, conn_id, results)

    return {
        "run_id": run_result.run_id,
        "summary": summary.model_dump(),
    }


# ── Endpoint: list run summaries ──────────────────────────────────────────────

@router.get("/reconciliation/{conn_id}/runs", response_model=list[RunSummaryOut])
def list_runs(
    conn_id: int,
    db: Session = Depends(get_db),
):
    _get_conn_or_404(conn_id, db)

    # Fetch all results ordered by created_at desc, group by run_id
    all_results = (
        db.query(ReconciliationResult)
        .filter_by(conn_id=conn_id)
        .order_by(ReconciliationResult.created_at.desc())
        .all()
    )

    # Group by run_id preserving order of first appearance
    grouped: dict[str, list] = {}
    for r in all_results:
        grouped.setdefault(r.run_id, []).append(r)

    summaries = []
    for run_id, results in grouped.items():
        summaries.append(_build_run_summary(run_id, conn_id, results))

    return summaries


# ── Endpoint: source-level summary (group by dev_source_type + source_id) ────

@router.get("/reconciliation/{conn_id}/source-summary")
def source_summary(conn_id: int, db: Session = Depends(get_db)):
    """
    Return reconciliation health grouped by dev_source_type, then by source_id.
    Each entry includes the latest run stats per source and a list of recent runs.
    """
    _get_conn_or_404(conn_id, db)

    all_results = (
        db.query(ReconciliationResult)
        .filter_by(conn_id=conn_id)
        .order_by(ReconciliationResult.created_at.desc())
        .all()
    )

    # Group: source_type → source_id → run_id → [results]
    from collections import defaultdict
    tree: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for r in all_results:
        src_type = r.dev_source_type or "unknown"
        src_id   = r.dev_source_id    # may be None for adhoc/mapper
        tree[src_type][src_id][r.run_id].append(r)

    # Resolve human-readable name for each source_id
    def _source_name(src_type: str, src_id) -> str:
        if src_id is None:
            return "(latest)"
        try:
            if src_type == "report":
                from api.models import SavedReport
                row = db.query(SavedReport).filter_by(id=src_id).first()
                return row.name if row else f"Report #{src_id}"
            if src_type == "dashboard":
                from api.models import DashboardConfig
                row = db.query(DashboardConfig).filter_by(id=src_id).first()
                return row.name if row else f"Dashboard #{src_id}"
            if src_type == "ps_workflow":
                from api.models import PsWorkflowStep
                row = db.query(PsWorkflowStep).filter_by(id=src_id).first()
                return getattr(row, "name", None) or f"Workflow #{src_id}" if row else f"Workflow #{src_id}"
            if src_type == "dev_artifact":
                from api.models import DevArtifact
                row = db.query(DevArtifact).filter_by(id=src_id).first()
                desc = getattr(row, "task_description", "") or ""
                return (desc[:60] + "…") if len(desc) > 60 else desc or f"Artifact #{src_id}"
        except Exception:
            pass
        return f"#{src_id}"

    output = []
    for src_type, by_id in sorted(tree.items()):
        sources = []
        type_total = type_pass = type_fail = type_skip = 0

        for src_id, by_run in by_id.items():
            # Build list of runs (most recent first)
            runs_out = []
            for run_id, results in list(by_run.items())[:10]:
                total = len(results)
                passed = sum(1 for r in results if r.status == "PASS")
                failed = sum(1 for r in results if r.status == "FAIL")
                warns  = sum(1 for r in results if r.status == "WARN")
                errors = sum(1 for r in results if r.status == "ERROR")
                skipped= sum(1 for r in results if r.status == "SKIP")
                conf   = _compute_confidence(results)
                runs_out.append({
                    "run_id":           run_id,
                    "created_at":       results[0].created_at.isoformat(),
                    "total":            total,
                    "passed":           passed,
                    "failed":           failed,
                    "warns":            warns,
                    "errors":           errors,
                    "skipped":          skipped,
                    "confidence_score": conf,
                })

            # Latest run stats for this source
            latest = runs_out[0] if runs_out else {}
            type_total += latest.get("total", 0)
            type_pass  += latest.get("passed", 0)
            type_fail  += latest.get("failed", 0)
            type_skip  += latest.get("skipped", 0)

            sources.append({
                "source_id":   src_id,
                "source_name": _source_name(src_type, src_id),
                "latest":      latest,
                "runs":        runs_out,
            })

        output.append({
            "source_type":  src_type,
            "label":        _SOURCE_LABELS.get(src_type, src_type.capitalize()),
            "total":        type_total,
            "passed":       type_pass,
            "failed":       type_fail,
            "skipped":      type_skip,
            "sources":      sources,
        })

    return output


# ── Endpoint: get all results for a specific run ──────────────────────────────

@router.get(
    "/reconciliation/{conn_id}/runs/{run_id}",
    response_model=list[ReconciliationResultOut],
)
def get_run(
    conn_id: int,
    run_id: str,
    db: Session = Depends(get_db),
):
    _get_conn_or_404(conn_id, db)
    results = (
        db.query(ReconciliationResult)
        .filter_by(conn_id=conn_id, run_id=run_id)
        .order_by(ReconciliationResult.id.asc())
        .all()
    )
    if not results:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found.")
    return results


# ── Email report helpers ──────────────────────────────────────────────────────

_SOURCE_LABELS = {
    "mapper":       "Conversion Mapper",
    "dashboard":    "Dashboard Widget",
    "report":       "Saved Report",
    "ps_workflow":  "PS Workflow Step",
    "dev_artifact": "Dev Artifact",
    "adhoc":        "Ad-hoc SQL",
}

_STATUS_BADGE = {
    "PASS":  ('<span style="background:#22c55e;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">PASS</span>'),
    "FAIL":  ('<span style="background:#ef4444;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">FAIL</span>'),
    "WARN":  ('<span style="background:#f59e0b;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">WARN</span>'),
    "ERROR": ('<span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">ERROR</span>'),
    "SKIP":  ('<span style="background:#94a3b8;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">SKIP</span>'),
}


def _build_email_html(conn: SourceConnection, all_results: list, run_id_filter: Optional[str] = None) -> str:
    """Build an HTML email summarising reconciliation results grouped by source type."""
    if run_id_filter:
        results = [r for r in all_results if r.run_id == run_id_filter]
    else:
        results = all_results

    # Group by source type
    by_source: dict[str, list] = {}
    for r in results:
        key = r.dev_source_type or "unknown"
        by_source.setdefault(key, []).append(r)

    # Build overall stats
    total = len(results)
    passed = sum(1 for r in results if r.status == "PASS")
    failed = sum(1 for r in results if r.status == "FAIL")
    errors = sum(1 for r in results if r.status == "ERROR")
    skipped = sum(1 for r in results if r.status == "SKIP")
    pass_pct = round(passed / total * 100) if total else 0

    source_sections = ""
    for src_type, src_results in sorted(by_source.items()):
        label = _SOURCE_LABELS.get(src_type, src_type.capitalize())
        s_total = len(src_results)
        s_pass = sum(1 for r in src_results if r.status == "PASS")
        s_fail = sum(1 for r in src_results if r.status == "FAIL")

        # List non-PASS, non-SKIP results for detail
        notable = [r for r in src_results if r.status in ("FAIL", "ERROR", "WARN")]
        rows_html = ""
        for r in notable[:20]:
            badge = _STATUS_BADGE.get(r.status, r.status)
            issue_cell = f'<td style="color:#dc2626;font-size:12px">{r.issue or "—"}</td>' if r.issue else '<td>—</td>'
            rows_html += (
                f"<tr>"
                f'<td style="padding:4px 8px">{badge}</td>'
                f'<td style="padding:4px 8px;font-size:12px">{r.test_name}</td>'
                f'<td style="padding:4px 8px;font-size:12px">{r.query_type}</td>'
                f'{issue_cell}'
                f"</tr>"
            )

        detail_table = ""
        if rows_html:
            detail_table = f"""
            <table style="width:100%;border-collapse:collapse;margin-top:8px;font-family:monospace">
              <thead><tr style="background:#f1f5f9">
                <th style="padding:4px 8px;text-align:left">Status</th>
                <th style="padding:4px 8px;text-align:left">Test Name</th>
                <th style="padding:4px 8px;text-align:left">Type</th>
                <th style="padding:4px 8px;text-align:left">Issue</th>
              </tr></thead>
              <tbody>{rows_html}</tbody>
            </table>"""

        bar_color = "#22c55e" if s_fail == 0 else "#ef4444"
        source_sections += f"""
        <div style="margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
          <div style="background:#f8fafc;padding:12px 16px;border-bottom:1px solid #e2e8f0">
            <span style="font-weight:700;font-size:15px">{label}</span>
            <span style="margin-left:12px;color:{bar_color};font-weight:600">{s_pass}/{s_total} passed</span>
            {'<span style="margin-left:8px;color:#ef4444;font-weight:600">· ' + str(s_fail) + ' failed</span>' if s_fail else ''}
          </div>
          <div style="padding:12px 16px">{detail_table or '<p style="color:#64748b;margin:0">All tests passed or skipped.</p>'}</div>
        </div>"""

    conn_name = getattr(conn, "name", None) or f"Connection #{conn.id}"
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#1e293b">
  <h2 style="margin-bottom:4px">DEV vs BASE Reconciliation Report</h2>
  <p style="color:#64748b;margin-bottom:20px">Connection: <strong>{conn_name}</strong></p>

  <!-- Summary bar -->
  <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
    <div style="background:#dcfce7;border-radius:8px;padding:12px 20px;min-width:100px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:#16a34a">{passed}</div>
      <div style="font-size:12px;color:#166534">PASSED</div>
    </div>
    <div style="background:#fee2e2;border-radius:8px;padding:12px 20px;min-width:100px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:#dc2626">{failed}</div>
      <div style="font-size:12px;color:#991b1b">FAILED</div>
    </div>
    <div style="background:#fef9c3;border-radius:8px;padding:12px 20px;min-width:100px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:#ca8a04">{errors}</div>
      <div style="font-size:12px;color:#92400e">ERRORS</div>
    </div>
    <div style="background:#f1f5f9;border-radius:8px;padding:12px 20px;min-width:100px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:#64748b">{skipped}</div>
      <div style="font-size:12px;color:#475569">SKIPPED</div>
    </div>
    <div style="background:#eff6ff;border-radius:8px;padding:12px 20px;min-width:100px;text-align:center">
      <div style="font-size:28px;font-weight:700;color:#2563eb">{pass_pct}%</div>
      <div style="font-size:12px;color:#1e40af">PASS RATE</div>
    </div>
  </div>

  <!-- Results by source -->
  {source_sections}

  <p style="color:#94a3b8;font-size:12px;margin-top:24px">
    Generated by Data Conversion Studio · {total} total checks
  </p>
</body></html>"""
    return html


# ── Endpoint: email report preview ───────────────────────────────────────────

@router.get("/reconciliation/{conn_id}/email-preview")
def email_preview(
    conn_id: int,
    run_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    conn = _get_conn_or_404(conn_id, db)
    all_results = (
        db.query(ReconciliationResult)
        .filter_by(conn_id=conn_id)
        .order_by(ReconciliationResult.created_at.desc())
        .all()
    )
    if not all_results:
        raise HTTPException(status_code=404, detail="No reconciliation results found for this connection.")
    html = _build_email_html(conn, all_results, run_id_filter=run_id)
    return {"html": html}


# ── Endpoint: send email report ───────────────────────────────────────────────

@router.post("/reconciliation/{conn_id}/send-email")
def send_email_report(
    conn_id: int,
    body: dict = Body(...),
    db: Session = Depends(get_db),
):
    """
    body: { to: str, subject?: str, run_id?: str }
    Uses PsEmailSettings (first active row) for SMTP config.
    """
    conn = _get_conn_or_404(conn_id, db)
    to_addr = body.get("to", "").strip()
    if not to_addr:
        raise HTTPException(status_code=400, detail="'to' email address is required.")

    from api.models import PsEmailSettings
    from api.services.encryption import decrypt as _decrypt
    settings_row = db.query(PsEmailSettings).filter_by(is_active=True).first()
    if not settings_row:
        raise HTTPException(
            status_code=400,
            detail="No active SMTP settings found. Configure email in PS Workflow Settings first.",
        )

    all_results = (
        db.query(ReconciliationResult)
        .filter_by(conn_id=conn_id)
        .order_by(ReconciliationResult.created_at.desc())
        .all()
    )
    if not all_results:
        raise HTTPException(status_code=404, detail="No reconciliation results found.")

    run_id_filter = body.get("run_id")
    html = _build_email_html(conn, all_results, run_id_filter=run_id_filter)

    conn_name = getattr(conn, "name", None) or f"Connection #{conn.id}"
    subject = body.get("subject") or f"Reconciliation Report — {conn_name}"
    smtp_pass = _decrypt(settings_row.smtp_pass_enc) if settings_row.smtp_pass_enc else None

    from api.services.ps_email import send_email
    try:
        send_email(
            smtp_host=settings_row.smtp_host,
            smtp_port=settings_row.smtp_port,
            smtp_user=settings_row.smtp_user,
            smtp_pass=smtp_pass,
            from_address=settings_row.from_address,
            to=to_addr,
            subject=subject,
            body=html,
            use_tls=settings_row.use_tls,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Email send failed: {exc}")

    return {"ok": True, "to": to_addr, "subject": subject}
