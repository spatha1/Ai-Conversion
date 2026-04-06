"""
api/services/agent_tools.py

Tool wrapper functions for the AI Co-worker Agent.

Each function calls the corresponding internal API endpoint via httpx,
or calls the underlying Python service directly for lightweight operations.

All functions return a plain dict:
  { "ok": True/False, "data": {...}, "error": "..." }
"""
from __future__ import annotations

import json
import logging
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from api.models import SourceConnection
from api.services.connector import preview_data
from api.routers.connections import _to_cfg_from_model

log = logging.getLogger(__name__)

# Base URL for internal API calls.
# Must match the running uvicorn port.
_BASE = "http://localhost:8000/api"
_TIMEOUT = 120  # seconds — long timeout for AI-heavy endpoints


def _post(path: str, body: dict) -> dict:
    """POST to an internal API endpoint and return parsed JSON."""
    try:
        resp = httpx.post(f"{_BASE}{path}", json=body, timeout=_TIMEOUT)
        resp.raise_for_status()
        return {"ok": True, "data": resp.json()}
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail", exc.response.text[:300])
        except Exception:
            detail = exc.response.text[:300]
        return {"ok": False, "error": detail}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _get(path: str, params: Optional[dict] = None) -> dict:
    """GET an internal API endpoint and return parsed JSON."""
    try:
        resp = httpx.get(f"{_BASE}{path}", params=params or {}, timeout=_TIMEOUT)
        resp.raise_for_status()
        return {"ok": True, "data": resp.json()}
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail", exc.response.text[:300])
        except Exception:
            detail = exc.response.text[:300]
        return {"ok": False, "error": detail}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── Tool Implementations ──────────────────────────────────────────────────────

def tool_generate_mapping_sql(conn_id: int) -> dict:
    """
    Generate the JOIN-aware SQL query for a connection.
    Calls POST /api/mapping/generate-query.
    Returns: { ok, data: { query_sql, identifier_column, identifier_table } }
    """
    log.info("[agent_tools] generate_mapping_sql conn_id=%s", conn_id)
    result = _post("/mapping/generate-query", {"conn_id": conn_id})
    if result["ok"]:
        d = result["data"]
        return {
            "ok": True,
            "query_sql":         d.get("query_sql", ""),
            "identifier_column": d.get("identifier_column"),
            "identifier_table":  d.get("identifier_table"),
            "summary": f"Generated SQL ({len(d.get('query_sql',''))} chars), "
                       f"identifier={d.get('identifier_table','?')}.{d.get('identifier_column','?')}",
        }
    return result


def tool_execute_sql(conn_id: int, sql: str, db: Session, limit: int = 100) -> dict:
    """
    Execute a SQL SELECT query directly via the connector service.
    Calls preview_data internally (no HTTP roundtrip).
    Returns: { ok, columns, rows, row_count, summary }
    """
    log.info("[agent_tools] execute_sql conn_id=%s sql_len=%s", conn_id, len(sql))
    conn = db.query(SourceConnection).filter_by(id=conn_id, is_active=True).first()
    if not conn:
        return {"ok": False, "error": f"Connection {conn_id} not found."}
    try:
        cfg = _to_cfg_from_model(conn)
        cfg["query"] = sql.strip()
        result = preview_data(cfg, limit=limit)
        rows    = result.get("rows", [])
        columns = result.get("columns", [])
        return {
            "ok":        True,
            "columns":   columns,
            "rows":      rows[:50],        # cap at 50 rows in context
            "row_count": result.get("total", len(rows)),
            "summary":   f"Returned {result.get('total', len(rows))} rows, {len(columns)} columns",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def tool_generate_mapping_rows(conn_id: int) -> dict:
    """
    Generate field-level mapping rows using embedding similarity.
    Calls POST /api/mapping/generate-rows.
    Returns: { ok, row_count, sample_rows, summary }
    """
    log.info("[agent_tools] generate_mapping_rows conn_id=%s", conn_id)
    result = _post("/mapping/generate-rows", {"conn_id": conn_id})
    if result["ok"]:
        data = result["data"]
        rows = data if isinstance(data, list) else data.get("rows", data.get("mapping", []))
        count = len(rows) if isinstance(rows, list) else 0
        return {
            "ok":         True,
            "row_count":  count,
            "sample_rows": rows[:5] if isinstance(rows, list) else [],
            "raw":        data,
            "summary":    f"Generated {count} mapping rows",
        }
    return result


def tool_generate_xml(conn_id: int, identifier_value: str) -> dict:
    """
    Generate XML for one identifier value using the saved mapping.
    Calls POST /api/mapping/{conn_id}/generate-xml.
    Returns: { ok, xml_length, identifier_value, summary }
    """
    log.info("[agent_tools] generate_xml conn_id=%s id=%s", conn_id, identifier_value)
    result = _post(f"/mapping/{conn_id}/generate-xml",
                   {"identifier_value": identifier_value})
    if result["ok"]:
        data = result["data"]
        xml_content = data.get("xml", data.get("xml_content", ""))
        return {
            "ok":              True,
            "xml_length":      len(xml_content),
            "identifier_value": identifier_value,
            "xml_preview":     xml_content[:400],
            "summary":         f"XML generated for '{identifier_value}' ({len(xml_content)} chars)",
        }
    return result


def tool_validate_xml(conn_id: int) -> dict:
    """
    Run XML validation for all generated records of a connection.
    Calls POST /api/validation/run?conn_id=X.
    Returns: { ok, total, passed, failed, failures_sample, summary }
    """
    log.info("[agent_tools] validate_xml conn_id=%s", conn_id)
    try:
        resp = httpx.post(
            f"{_BASE}/validation/run",
            params={"conn_id": conn_id},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        total   = data.get("total", 0)
        passed  = data.get("passed", 0)
        failed  = data.get("failed", 0)
        results = data.get("results", [])
        failures = [r for r in results if r.get("status") == "fail"][:5]
        return {
            "ok":             True,
            "total":          total,
            "passed":         passed,
            "failed":         failed,
            "failures_sample": failures,
            "summary":        f"Validation: {passed}/{total} passed, {failed} failed",
        }
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail", exc.response.text[:300])
        except Exception:
            detail = exc.response.text[:300]
        return {"ok": False, "error": detail}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def tool_run_workflow(workflow_id: int) -> dict:
    """
    Execute a PS workflow by ID.
    Calls POST /api/ps/workflows/{id}/run.
    Returns: { ok, run_id, status, steps_summary, summary }
    """
    log.info("[agent_tools] run_workflow workflow_id=%s", workflow_id)
    try:
        resp = httpx.post(f"{_BASE}/ps/workflows/{workflow_id}/run", timeout=_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        steps = data.get("steps", [])
        failed_steps = [s for s in steps if s.get("status") not in ("success", "ok")]
        return {
            "ok":           data.get("status") in ("success", "partial"),
            "run_id":       data.get("run_id"),
            "status":       data.get("status"),
            "steps_summary": steps,
            "failed_steps":  failed_steps,
            "summary":      f"Workflow run {data.get('run_id')}: {data.get('status')} "
                            f"({len(steps)} steps, {len(failed_steps)} failed)",
        }
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail", exc.response.text[:300])
        except Exception:
            detail = exc.response.text[:300]
        return {"ok": False, "error": detail}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── Dispatcher ────────────────────────────────────────────────────────────────

def dispatch_tool(
    tool_name: str,
    tool_args: dict,
    db: Session,
) -> dict:
    """
    Dispatch a tool call by name. Returns the tool result dict.
    Retries once on failure with the same arguments.
    """
    def _run():
        if tool_name == "generate_mapping_sql":
            return tool_generate_mapping_sql(
                conn_id=tool_args["conn_id"],
            )
        elif tool_name == "execute_sql":
            return tool_execute_sql(
                conn_id=tool_args["conn_id"],
                sql=tool_args["sql"],
                db=db,
                limit=tool_args.get("limit", 100),
            )
        elif tool_name == "generate_mapping_rows":
            return tool_generate_mapping_rows(
                conn_id=tool_args["conn_id"],
            )
        elif tool_name == "generate_xml":
            return tool_generate_xml(
                conn_id=tool_args["conn_id"],
                identifier_value=str(tool_args["identifier_value"]),
            )
        elif tool_name == "validate_xml":
            return tool_validate_xml(
                conn_id=tool_args["conn_id"],
            )
        elif tool_name == "run_workflow":
            return tool_run_workflow(
                workflow_id=tool_args["workflow_id"],
            )
        else:
            return {"ok": False, "error": f"Unknown tool: {tool_name}"}

    # First attempt
    result = _run()
    if not result.get("ok"):
        log.warning("[agent_tools] %s failed (attempt 1): %s — retrying", tool_name, result.get("error"))
        # Retry once
        result = _run()
        if not result.get("ok"):
            log.error("[agent_tools] %s failed (attempt 2): %s", tool_name, result.get("error"))

    return result
