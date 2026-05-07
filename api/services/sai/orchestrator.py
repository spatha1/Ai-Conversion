"""
orchestrator.py — SAI Ops pipeline coordinator.
Receives a run request, coordinates all agents in sequence, yields SSE events.
"""
import json
import time
from datetime import datetime, timezone
from typing import Optional, AsyncGenerator
from sqlalchemy.orm import Session

from api.models import SaiRun, SaiStep, SaiFinding
from api.services.sai import (
    schema_agent,
    data_collection_agent,
    rca_agent,
    issue_classifier,
    ownership_agent,
    action_agent,
    validation_agent,
    reporting_agent,
    learning_agent,
)


def _sse(event_type: str, **payload) -> str:
    data = json.dumps({"type": event_type, **payload})
    return f"data: {data}\n\n"


def _reasoning(agent: str, text: str) -> str:
    return _sse("reasoning", agent=agent, text=text)


def _step_event(step_num: int, agent: str, status: str, elapsed_ms: int = 0) -> str:
    return _sse("step", step=step_num, agent=agent, status=status, elapsed_ms=elapsed_ms)


def _save_step(
    db: Session,
    run_id: int,
    step_number: int,
    agent_name: str,
    status: str,
    output: dict,
    elapsed_ms: int,
) -> None:
    try:
        # Strip large sample_rows to keep output_json serializable
        trimmed = {
            k: (
                [
                    {kk: vv for kk, vv in ds.items() if kk != "sample_rows"}
                    for ds in v
                ] if k == "datasets" else v
            )
            for k, v in output.items()
        }
        step = SaiStep(
            run_id=run_id,
            step_number=step_number,
            agent_name=agent_name,
            status=status,
            output_json=json.dumps(trimmed)[:16000],
            knowledge_sources_json=json.dumps(output.get("knowledge_sources", [])),
            elapsed_ms=elapsed_ms,
        )
        db.add(step)
        db.commit()
    except Exception:
        db.rollback()


async def run_pipeline(
    run_id: int,
    request_text: str,
    project_id: Optional[int],
    conn_ids: Optional[list[int]],
    mode: str,
    db: Session,
) -> AsyncGenerator[str, None]:

    all_knowledge_sources: list[dict] = []

    # ── STEP 1: Schema Agent ─────────────────────────────────────
    yield _step_event(1, "schema_agent", "running")
    yield _reasoning("schema_agent", f"Resolving domain entities for: {request_text}")
    try:
        schema_ctx = await schema_agent.run(request_text, project_id, conn_ids, db)
        all_knowledge_sources.extend(schema_ctx.get("knowledge_sources", []))
        yield _reasoning("schema_agent", f"Domains identified: {', '.join(schema_ctx.get('domains', []))}. Connections: {len(schema_ctx.get('connections', []))}")
        yield _sse("knowledge", sources=schema_ctx.get("knowledge_sources", []))
        _save_step(db, run_id, 1, "schema_agent", "done", schema_ctx, schema_ctx.get("elapsed_ms", 0))
        yield _step_event(1, "schema_agent", "done", schema_ctx.get("elapsed_ms", 0))
    except Exception as exc:
        yield _reasoning("schema_agent", f"Error: {str(exc)[:200]}")
        yield _step_event(1, "schema_agent", "error")
        schema_ctx = {"domains": [], "connections": [], "conn_ids": [], "relevant_tables": [], "knowledge_sources": []}

    # ── STEP 2: Data Collection Agent ─────────────────────────────
    yield _step_event(2, "data_collection_agent", "running")
    yield _reasoning("data_collection_agent", "Fetching datasets from connected sources...")
    try:
        collection_ctx = await data_collection_agent.run(schema_ctx, db, sai_run_id=run_id)
        datasets = collection_ctx.get("datasets", [])
        for ds in datasets:
            if ds.get("error"):
                yield _reasoning("data_collection_agent", f"⚠ {ds.get('label')}: {ds.get('error')[:100]}")
                yield _sse("query_used", conn_id=ds.get("conn_id"), label=ds.get("label"),
                           query=ds.get("query_used", ""), status="error", error=ds.get("error", ""))
            else:
                yield _reasoning("data_collection_agent",
                    f"✓ {ds.get('label')}: {ds.get('row_count')} rows, {len(ds.get('columns', []))} columns")
                yield _sse("query_used", conn_id=ds.get("conn_id"), label=ds.get("label"),
                           query=ds.get("query_used", ""), status="ok",
                           row_count=ds.get("row_count", 0), columns=ds.get("columns", []))
        _save_step(db, run_id, 2, "data_collection_agent", "done", collection_ctx, collection_ctx.get("elapsed_ms", 0))
        yield _step_event(2, "data_collection_agent", "done", collection_ctx.get("elapsed_ms", 0))
    except Exception as exc:
        yield _reasoning("data_collection_agent", f"Error: {str(exc)[:200]}")
        yield _step_event(2, "data_collection_agent", "error")
        collection_ctx = {"datasets": [], "knowledge_sources": []}

    # ── STEP 3: RCA Agent ─────────────────────────────────────────
    yield _step_event(3, "rca_agent", "running")
    yield _reasoning("rca_agent", "Analyzing datasets for anomalies and cross-system patterns...")
    try:
        rca_ctx = await rca_agent.run(schema_ctx, collection_ctx, request_text, db, sai_run_id=run_id)
        all_knowledge_sources.extend(rca_ctx.get("knowledge_sources", []))
        anomalies = rca_ctx.get("anomalies", [])
        if anomalies:
            for a in anomalies[:3]:
                yield _reasoning("rca_agent", f"⚠ Anomaly: {a.get('label')}.{a.get('column')} — {a.get('detail')}")
        else:
            yield _reasoning("rca_agent", "No anomalies detected in current datasets")
        yield _sse("knowledge", sources=rca_ctx.get("knowledge_sources", []))
        _save_step(db, run_id, 3, "rca_agent", "done", rca_ctx, rca_ctx.get("elapsed_ms", 0))
        yield _step_event(3, "rca_agent", "done", rca_ctx.get("elapsed_ms", 0))
    except Exception as exc:
        yield _reasoning("rca_agent", f"Error: {str(exc)[:200]}")
        yield _step_event(3, "rca_agent", "error")
        rca_ctx = {"anomalies": [], "checks": [], "knowledge_sources": []}

    # ── STEP 4: Issue Classifier ──────────────────────────────────
    yield _step_event(4, "issue_classifier", "running")
    yield _reasoning("issue_classifier", "Classifying issues by type and severity...")
    try:
        raw_findings = await issue_classifier.run(rca_ctx.get("checks", []), request_text, db, run_id=run_id)
        yield _reasoning("issue_classifier", f"Classified {len(raw_findings)} finding(s)")
        for f in raw_findings[:3]:
            yield _sse("finding",
                       issue_type=f.get("issue_type"),
                       severity=f.get("severity"),
                       system=f.get("system_impacted"),
                       description=f.get("description", "")[:200])
        _save_step(db, run_id, 4, "issue_classifier", "done", {"findings": raw_findings}, 0)
        yield _step_event(4, "issue_classifier", "done")
    except Exception as exc:
        raw_findings = []
        yield _reasoning("issue_classifier", f"Error: {str(exc)[:200]}")
        yield _step_event(4, "issue_classifier", "error")

    # ── STEP 5: Ownership Agent ───────────────────────────────────
    yield _step_event(5, "ownership_agent", "running")
    yield _reasoning("ownership_agent", "Mapping findings to responsible teams...")
    try:
        ownership_ctx = await ownership_agent.run(raw_findings, schema_ctx, db, sai_run_id=run_id)
        findings = ownership_ctx.get("findings", [])
        for f in findings[:3]:
            yield _reasoning("ownership_agent", f"→ {f.get('issue_type')} assigned to {f.get('owner_team')}")
        _save_step(db, run_id, 5, "ownership_agent", "done", ownership_ctx, ownership_ctx.get("elapsed_ms", 0))
        yield _step_event(5, "ownership_agent", "done", ownership_ctx.get("elapsed_ms", 0))
    except Exception as exc:
        findings = raw_findings
        yield _reasoning("ownership_agent", f"Error: {str(exc)[:200]}")
        yield _step_event(5, "ownership_agent", "error")

    # Persist findings to DB
    try:
        for f in findings:
            db.add(SaiFinding(
                run_id=run_id,
                issue_type=f.get("issue_type", ""),
                severity=f.get("severity", "LOW"),
                system_impacted=f.get("system_impacted"),
                description=f.get("description"),
                owner_team=f.get("owner_team"),
                action_status="pending",
            ))
        db.commit()
        # Reload with IDs
        findings_with_ids = [
            {
                **f,
                "id": db.query(SaiFinding).filter_by(run_id=run_id, issue_type=f.get("issue_type", "")).order_by(SaiFinding.id.desc()).first().id
                if db.query(SaiFinding).filter_by(run_id=run_id, issue_type=f.get("issue_type", "")).first() else None
            }
            for f in findings
        ]
    except Exception:
        findings_with_ids = findings
        db.rollback()

    # ── STEP 6: Action Agent ──────────────────────────────────────
    yield _step_event(6, "action_agent", "running")
    yield _reasoning("action_agent", f"Dispatching actions (mode: {mode})...")
    try:
        action_ctx = await action_agent.run(findings_with_ids, mode, run_id, None, db)
        for a in action_ctx.get("actions_taken", []):
            yield _sse("action", action=a.get("type"), detail=a.get("to") or a.get("title"), status=a.get("status"))
            yield _reasoning("action_agent", f"✓ {a.get('type')}: {a.get('to') or a.get('title', '')}")
        for a in action_ctx.get("approval_items", []):
            yield _sse("approval_queued", action_type=a.get("action_type"))
            yield _reasoning("action_agent", f"⏳ Queued for approval: {a.get('action_type')}")
        _save_step(db, run_id, 6, "action_agent", "done", action_ctx, action_ctx.get("elapsed_ms", 0))
        yield _step_event(6, "action_agent", "done", action_ctx.get("elapsed_ms", 0))
    except Exception as exc:
        action_ctx = {"actions_taken": [], "approval_items": []}
        yield _reasoning("action_agent", f"Error: {str(exc)[:200]}")
        yield _step_event(6, "action_agent", "error")

    # ── STEP 7: Validation Agent ──────────────────────────────────
    yield _step_event(7, "validation_agent", "running")
    yield _reasoning("validation_agent", "Validating recovery and confirming issue status...")
    try:
        validation_result = await validation_agent.run(
            rca_ctx.get("checks", []),
            collection_ctx.get("datasets", []),
            action_ctx.get("actions_taken", []),
        )
        yield _reasoning("validation_agent", f"Status: {validation_result.get('validation_status')} — {validation_result.get('message')}")
        _save_step(db, run_id, 7, "validation_agent", "done", validation_result, validation_result.get("elapsed_ms", 0))
        yield _step_event(7, "validation_agent", "done", validation_result.get("elapsed_ms", 0))
    except Exception as exc:
        validation_result = {"validation_status": "PENDING", "message": "Validation unavailable"}
        yield _reasoning("validation_agent", f"Error: {str(exc)[:200]}")
        yield _step_event(7, "validation_agent", "error")

    # ── STEP 8: Reporting Agent ────────────────────────────────────
    yield _step_event(8, "reporting_agent", "running")
    yield _reasoning("reporting_agent", "Generating 10-section executive operational report...")
    try:
        report_ctx = await reporting_agent.run(
            request_text=request_text,
            schema_context=schema_ctx,
            collection_context=collection_ctx,
            rca_context=rca_ctx,
            findings=findings_with_ids,
            validation_result=validation_result,
            actions_taken=action_ctx.get("actions_taken", []),
            approval_items=action_ctx.get("approval_items", []),
            knowledge_sources=all_knowledge_sources,
            db=db,
            run_id=run_id,
        )
        report = report_ctx.get("report", {})
        yield _reasoning("reporting_agent", "Executive report generated successfully")
        _save_step(db, run_id, 8, "reporting_agent", "done", report_ctx, report_ctx.get("elapsed_ms", 0))
        yield _step_event(8, "reporting_agent", "done", report_ctx.get("elapsed_ms", 0))
    except Exception as exc:
        report = {}
        yield _reasoning("reporting_agent", f"Error: {str(exc)[:200]}")
        yield _step_event(8, "reporting_agent", "error")

    # ── STEP 9: Learning Agent ─────────────────────────────────────
    yield _step_event(9, "learning_agent", "running")
    yield _reasoning("learning_agent", "Persisting operational patterns to memory...")
    try:
        learn_ctx = await learning_agent.run(
            findings=findings_with_ids,
            actions_taken=action_ctx.get("actions_taken", []),
            validation_result=validation_result,
            project_id=project_id,
            db=db,
            sai_run_id=run_id,
        )
        yield _reasoning("learning_agent", f"Learned {len(learn_ctx.get('learned', []))} pattern(s)")
        _save_step(db, run_id, 9, "learning_agent", "done", learn_ctx, learn_ctx.get("elapsed_ms", 0))
        yield _step_event(9, "learning_agent", "done", learn_ctx.get("elapsed_ms", 0))
    except Exception as exc:
        yield _reasoning("learning_agent", f"Error: {str(exc)[:200]}")
        yield _step_event(9, "learning_agent", "error")

    # ── Finalize SaiRun ────────────────────────────────────────────
    try:
        run_row = db.query(SaiRun).filter(SaiRun.id == run_id).first()
        if run_row:
            run_row.status = "complete"
            run_row.completed_at = datetime.now(timezone.utc)
            run_row.findings_json = json.dumps(findings_with_ids)
            run_row.report_json = json.dumps(report)
            run_row.actions_taken_json = json.dumps(action_ctx.get("actions_taken", []))
            run_row.knowledge_sources_json = json.dumps(all_knowledge_sources[:20])
            db.commit()
    except Exception:
        db.rollback()

    yield _sse("complete",
               run_id=run_id,
               report=report,
               findings_count=len(findings_with_ids),
               actions_count=len(action_ctx.get("actions_taken", [])),
               pending_approvals=len(action_ctx.get("approval_items", [])),
               validation_status=validation_result.get("validation_status"),
               knowledge_sources=all_knowledge_sources[:20])
