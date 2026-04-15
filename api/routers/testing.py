"""
api/routers/testing.py

Auto Testing & Data Reconciliation

Routes (all under /api prefix from main.py):
  POST  /api/tests/generate         — AI generates test cases from NL description
  POST  /api/tests/create           — manually create a single test case
  GET   /api/tests/list             — list all test cases
  GET   /api/tests/{id}             — get single test case with latest results
  PUT   /api/tests/{id}             — update test case
  DELETE /api/tests/{id}            — delete test case
  POST  /api/tests/run/{id}         — run a single test case now
  POST  /api/tests/run-all          — run every test case
  GET   /api/tests/results          — get all latest results (summary view)
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import AITestCase, AITestResult, SourceConnection, CatalogColumn
from api.schemas import (
    AITestCaseCreate, AITestCaseUpdate, AITestCaseOut,
    AITestResultOut, AIGenerateTestsRequest,
)
from api.config import settings

router = APIRouter()


# ── Schema fetcher ─────────────────────────────────────────────

def _fetch_schema(conn_id: int, conn: SourceConnection, db: Session) -> str:
    """
    Return a compact schema string for the given connection.

    Priority:
      1. CatalogColumn rows already collected via Admin → Collect Schema
      2. Live INFORMATION_SCHEMA query (SQL Server / PostgreSQL / MySQL)
      3. Empty string if neither works (caller handles gracefully)

    Output format (one line per table):
      TableName(col1 type PK, col2 type, ...)
    """
    # ── 1. Try catalog ────────────────────────────────────────
    catalog_rows = (
        db.query(CatalogColumn)
        .filter(CatalogColumn.conn_id == conn_id)
        .order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position)
        .all()
    )

    if catalog_rows:
        tables: dict[str, list[str]] = {}
        for r in catalog_rows:
            key = r.table_name
            if key not in tables:
                tables[key] = []
            pk_flag = " PK" if r.is_primary_key else ""
            tables[key].append(f"{r.column_name} {r.data_type or ''}{pk_flag}".strip())
        lines = [f"{t}({', '.join(cols)})" for t, cols in tables.items()]
        return "\n".join(lines)

    # ── 2. Live fallback via INFORMATION_SCHEMA ───────────────
    try:
        from api.services.connector import preview_data
        cfg = _to_cfg(conn)
        result = preview_data({
            **cfg,
            "query": (
                "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, "
                "ORDINAL_POSITION "
                "FROM INFORMATION_SCHEMA.COLUMNS "
                "ORDER BY TABLE_NAME, ORDINAL_POSITION"
            ),
        }, limit=2000)
        tables2: dict[str, list[str]] = {}
        for row in result.get("rows", []):
            tname = row.get("TABLE_NAME") or row.get("table_name", "")
            col   = row.get("COLUMN_NAME") or row.get("column_name", "")
            dtype = row.get("DATA_TYPE")   or row.get("data_type", "")
            if tname:
                tables2.setdefault(tname, []).append(f"{col} {dtype}".strip())
        if tables2:
            lines2 = [f"{t}({', '.join(cols)})" for t, cols in tables2.items()]
            return "\n".join(lines2)
    except Exception:
        pass

    return ""  # caller will note "schema not available"


# ── helpers ────────────────────────────────────────────────────

def _get_test(test_id: int, db: Session) -> AITestCase:
    tc = db.query(AITestCase).filter_by(id=test_id).first()
    if not tc:
        raise HTTPException(status_code=404, detail=f"Test case {test_id} not found")
    return tc


def _to_cfg(conn: SourceConnection) -> dict:
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
    }


def _wrap_scalar(sql: str) -> str:
    """
    Wrap any query in an outer SELECT so it always has a named column.
    Avoids SQL Server error 8155 ("No column name was specified for column N").
    If the query already ends with a column alias we leave it alone by
    wrapping anyway — the outer alias takes precedence.
    """
    inner = sql.strip().rstrip(";")
    return f"SELECT TOP 1 _val FROM ({inner}) AS _scalar(_val)"


def _run_scalar_query(cfg: dict, sql: str) -> Any:
    """Execute SQL and return the first cell of the first row."""
    from api.services.connector import preview_data
    wrapped = _wrap_scalar(sql)
    run_cfg = {**cfg, "query": wrapped}
    try:
        result = preview_data(run_cfg, limit=1)
        if result["rows"]:
            row = result["rows"][0]
            # The wrapped query always names the column _val;
            # fall back to first value if driver strips the alias.
            return row.get("_val", list(row.values())[0])
        return None
    except Exception:
        # If wrapping fails (e.g. Snowflake syntax), try the raw query
        run_cfg2 = {**cfg, "query": sql}
        result2 = preview_data(run_cfg2, limit=1)
        if result2["rows"]:
            row2 = result2["rows"][0]
            return list(row2.values())[0]
        return None


def _execute_test(tc: AITestCase, db: Session) -> AITestResult:
    """Run a single test case, persist the result, and return it."""
    start_ms = int(time.time() * 1000)
    source_val: Optional[str] = None
    target_val: Optional[str] = None
    difference: Optional[str] = None
    result_flag = "error"
    remarks = ""

    try:
        # Resolve connections
        src_conn_id = tc.source_conn_id
        tgt_conn_id = tc.target_conn_id or tc.source_conn_id

        src_conn = db.query(SourceConnection).filter_by(id=src_conn_id).first()
        tgt_conn = db.query(SourceConnection).filter_by(id=tgt_conn_id).first()
        if not src_conn:
            raise ValueError(f"Source connection {src_conn_id} not found")
        if not tgt_conn:
            raise ValueError(f"Target connection {tgt_conn_id} not found")

        src_cfg = _to_cfg(src_conn)
        tgt_cfg = _to_cfg(tgt_conn)

        vtype = tc.validation_type

        if vtype == "count":
            sv = _run_scalar_query(src_cfg, tc.source_query)
            tv = _run_scalar_query(tgt_cfg, tc.target_query)
            source_val = str(sv)
            target_val = str(tv)
            try:
                diff = float(sv or 0) - float(tv or 0)
                difference = str(diff)
                threshold = float(tc.threshold or "0")
                result_flag = "pass" if abs(diff) <= threshold else "fail"
                remarks = f"Count difference: {diff} (threshold ≤ {threshold})"
            except (ValueError, TypeError):
                result_flag = "fail"
                remarks = f"Could not compare values: source={sv}, target={tv}"

        elif vtype == "sum":
            sv = _run_scalar_query(src_cfg, tc.source_query)
            tv = _run_scalar_query(tgt_cfg, tc.target_query)
            source_val = str(sv)
            target_val = str(tv)
            try:
                diff = float(sv or 0) - float(tv or 0)
                difference = str(round(diff, 6))
                threshold = float(tc.threshold or "0")
                result_flag = "pass" if abs(diff) <= threshold else "fail"
                remarks = f"Sum difference: {round(diff, 6)} (threshold ≤ {threshold})"
            except (ValueError, TypeError):
                result_flag = "fail"
                remarks = f"Could not compare values: source={sv}, target={tv}"

        elif vtype == "null_check":
            sv = _run_scalar_query(src_cfg, tc.source_query)
            tv = _run_scalar_query(tgt_cfg, tc.target_query)
            source_val = str(sv)
            target_val = str(tv)
            src_nulls = int(sv or 0)
            tgt_nulls = int(tv or 0)
            threshold = int(tc.threshold or "0")
            result_flag = "pass" if (src_nulls <= threshold and tgt_nulls <= threshold) else "fail"
            difference = str(tgt_nulls - src_nulls)
            remarks = f"Source nulls: {src_nulls}, Target nulls: {tgt_nulls} (threshold ≤ {threshold})"

        elif vtype == "duplicate":
            sv = _run_scalar_query(src_cfg, tc.source_query)
            tv = _run_scalar_query(tgt_cfg, tc.target_query)
            source_val = str(sv)
            target_val = str(tv)
            src_dups = int(sv or 0)
            tgt_dups = int(tv or 0)
            threshold = int(tc.threshold or "0")
            result_flag = "pass" if (src_dups <= threshold and tgt_dups <= threshold) else "fail"
            difference = str(tgt_dups - src_dups)
            remarks = f"Source duplicates: {src_dups}, Target duplicates: {tgt_dups} (threshold ≤ {threshold})"

        elif vtype == "custom":
            # For custom, source_query is the assertion SQL that should return 1 row with 1 col = 1/true/pass
            sv = _run_scalar_query(src_cfg, tc.source_query)
            tv = _run_scalar_query(tgt_cfg, tc.target_query) if tc.target_query.strip() else sv
            source_val = str(sv)
            target_val = str(tv)
            result_flag = "pass" if str(sv).lower() in ("1", "true", "pass", "yes") else "fail"
            difference = None
            remarks = f"Custom assertion result: {sv}"

        else:
            remarks = f"Unknown validation type: {vtype}"
            result_flag = "error"

    except Exception as exc:
        # Extract the most readable part of SQL Server / pyodbc error messages
        raw_err = str(exc)
        # pyodbc wraps the ODBC error — grab the innermost message after the last newline
        clean = raw_err.split("\n")[-1].strip() or raw_err
        # Strip the ODBC state prefix like "[42S02] [Microsoft]..."
        import re as _re
        m = _re.search(r'\[Microsoft\]\[.*?\]\s*(.*)', clean)
        if m:
            clean = m.group(1).strip()
        remarks = clean[:500]
        result_flag = "error"

    elapsed = int(time.time() * 1000) - start_ms
    res = AITestResult(
        test_case_id=tc.id,
        execution_time=elapsed,
        result=result_flag,
        source_value=source_val,
        target_value=target_val,
        difference=difference,
        remarks=remarks,
        ran_at=datetime.utcnow(),
    )
    db.add(res)
    db.commit()
    db.refresh(res)
    return res


# ── AI generation ──────────────────────────────────────────────

_SYSTEM_PROMPT = """You are a data reconciliation expert. Given a natural-language description of what to validate,
generate a JSON array of test cases that cover the described validation.

Each test case must have these fields:
- group_name: a short category label that groups related tests (e.g. "Employee Checks", "Department Checks", "Premium Validation"). All tests for the same entity/table should share the same group_name.
- name: short descriptive name for this specific test
- validation_type: one of "count", "sum", "null_check", "duplicate", "custom"
- source_query: SQL for the SOURCE system — must return exactly ONE scalar value
- target_query: SQL for the TARGET system — same structure as source_query
- threshold: acceptable tolerance ("0" for exact match, numeric string for tolerance)

CRITICAL SQL RULES (Microsoft SQL Server / T-SQL dialect):
1. Every query MUST return exactly ONE row and ONE column.
2. ALWAYS alias the aggregate column: e.g. SELECT COUNT(*) AS cnt FROM ...
   Never write bare SELECT COUNT(*) FROM ... — SQL Server raises error 8155 without an alias.
3. NEVER use subqueries or derived tables. Use direct aggregations only:
   GOOD: SELECT COUNT(*) AS cnt FROM EMP WHERE EMPNO IS NULL
   BAD:  SELECT COUNT(*) AS cnt FROM (SELECT EMPNO FROM EMP WHERE EMPNO IS NULL)
4. For count tests:   SELECT COUNT(*) AS cnt FROM <table>
5. For sum tests:     SELECT ISNULL(SUM(<col>), 0) AS total FROM <table>
6. For null checks:   SELECT COUNT(*) AS null_cnt FROM <table> WHERE <col> IS NULL
7. For duplicates:    SELECT COUNT(*) AS dup_cnt FROM <table> GROUP BY <col> HAVING COUNT(*) > 1
   If the user doesn't specify a key column use the primary key or first column.
   Wrap in: SELECT COUNT(*) AS dup_cnt FROM (SELECT <col> FROM <table> GROUP BY <col> HAVING COUNT(*) > 1) AS t
   — wait, no derived tables. Use: SELECT SUM(cnt) AS dup_cnt FROM (SELECT COUNT(*) AS cnt FROM <table> GROUP BY <col> HAVING COUNT(*) > 1) AS g
   — Actually for duplicates use this pattern safely:
     SELECT COUNT(*) AS dup_cnt FROM <table> t1 INNER JOIN (SELECT <col>, COUNT(*) AS c FROM <table> GROUP BY <col> HAVING COUNT(*) > 1) t2 ON t1.<col> = t2.<col>
     No — keep it simple: SELECT COUNT(*) - COUNT(DISTINCT <col>) AS dup_cnt FROM <table>
8. Use the exact table/column names from the user's description. If none given, use placeholder names.
9. Return ONLY a raw JSON array — no markdown fences, no explanation text.

Example output:
[
  {
    "group_name": "Employee Checks",
    "name": "Employee Row Count Match",
    "validation_type": "count",
    "source_query": "SELECT COUNT(*) AS cnt FROM EMP",
    "target_query": "SELECT COUNT(*) AS cnt FROM tgt_EMP",
    "threshold": "0"
  },
  {
    "group_name": "Employee Checks",
    "name": "Total Salary Sum Match",
    "validation_type": "sum",
    "source_query": "SELECT ISNULL(SUM(SAL), 0) AS total FROM EMP",
    "target_query": "SELECT ISNULL(SUM(SAL), 0) AS total FROM tgt_EMP",
    "threshold": "0"
  },
  {
    "group_name": "Employee Checks",
    "name": "Employee ID Null Check",
    "validation_type": "null_check",
    "source_query": "SELECT COUNT(*) AS null_cnt FROM EMP WHERE EMPNO IS NULL",
    "target_query": "SELECT COUNT(*) AS null_cnt FROM tgt_EMP WHERE EMPNO IS NULL",
    "threshold": "0"
  },
  {
    "group_name": "Department Checks",
    "name": "Department Row Count Match",
    "validation_type": "count",
    "source_query": "SELECT COUNT(*) AS cnt FROM DEPT",
    "target_query": "SELECT COUNT(*) AS cnt FROM tgt_DEPT",
    "threshold": "0"
  }
]
"""


def _resolve_prompt(db: Session) -> str:
    """
    Return the active prompt template for category='testing' from the DB.
    Falls back to the built-in _SYSTEM_PROMPT if none is configured.
    Admin can override via Admin → Prompt Templates (category = testing).
    """
    try:
        from api.models import PromptTemplate
        tmpl = (
            db.query(PromptTemplate)
            .filter(
                PromptTemplate.category == "testing",
                PromptTemplate.is_active == True,  # noqa: E712
            )
            .first()
        )
        if tmpl and tmpl.content and tmpl.content.strip():
            return tmpl.content.strip()
    except Exception:
        pass
    return _SYSTEM_PROMPT


def _ai_generate_test_cases(
    description: str,
    api_key: str,
    model: str,
    db: Session,
    same_connection: bool = False,
    source_conn_id: Optional[int] = None,
    source_schema: str = "",
    target_schema: str = "",
    source_conn_name: str = "source",
    target_conn_name: str = "target",
) -> list[dict]:
    import openai as _openai

    system_prompt = _resolve_prompt(db)

    # ── Schema context block ──────────────────────────────────
    schema_block = ""
    if source_schema:
        schema_block += f"\n\nSOURCE database ({source_conn_name}) schema:\n{source_schema}"
    if target_schema and not same_connection:
        schema_block += f"\n\nTARGET database ({target_conn_name}) schema:\n{target_schema}"
    elif same_connection and source_schema:
        schema_block += f"\n\n(Source and target use the same database — schema above applies to both.)"

    if schema_block:
        schema_block += (
            "\n\nIMPORTANT schema rules:"
            "\n- Use ONLY table and column names that exist in the schemas above."
            "\n- For source_query use table/column names from the SOURCE schema."
            "\n- For target_query use the MATCHING table/column names from the TARGET schema."
            "\n- Match tables by purpose/similarity when names differ (e.g. EMP ↔ EMPLOYEE, SAL ↔ SALARY)."
            "\n- Do NOT invent table names or add prefixes like 'tgt_'."
        )
    else:
        # No schema available — fall back to safe default
        schema_block = (
            "\n\nNo schema was available for these connections. "
            "Use descriptive placeholder table/column names from the user's description. "
            "Do NOT add 'tgt_' prefixes. Use the same table name in both queries as a safe default."
        )

    if same_connection:
        conn_hint = (
            "\n\nBoth source_query and target_query run on THE SAME database connection."
        )
    else:
        conn_hint = (
            "\n\nsource_query runs on the SOURCE database; "
            "target_query runs on the TARGET database (different connection)."
        )

    full_system = system_prompt + schema_block + conn_hint
    user_msg    = description

    client = _openai.OpenAI(api_key=api_key)

    start_ms = int(time.time() * 1000)
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": full_system},
            {"role": "user",   "content": user_msg},
        ],
        temperature=0.2,
    )
    elapsed_ms = int(time.time() * 1000) - start_ms

    raw = resp.choices[0].message.content.strip()

    # ── Store AI trace ────────────────────────────────────────
    try:
        from api.models import AITraceLog
        db.add(AITraceLog(
            module       = "testing",
            conn_id      = source_conn_id,
            model        = model,
            prompt_text  = (full_system[:2000] + "\n---USER---\n" + user_msg)[:4000],
            response_text= raw[:4000],
            tokens_in    = getattr(resp.usage, "prompt_tokens",     None),
            tokens_out   = getattr(resp.usage, "completion_tokens", None),
            latency_ms   = elapsed_ms,
        ))
        db.flush()
    except Exception:
        pass  # trace failure must never break the main flow

    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw)


# ── Endpoints ──────────────────────────────────────────────────

# NOTE: fixed paths before parameterised /{id}

@router.post("/tests/generate", response_model=list[AITestCaseOut], tags=["testing"])
def generate_tests(body: AIGenerateTestsRequest, db: Session = Depends(get_db)):
    """AI generates test cases from a natural-language description and saves them."""
    api_key = body.api_key.strip() or settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="No OpenAI API key — set OPENAI_API_KEY in .env")

    same_conn     = (body.target_conn_id is None) or (body.target_conn_id == body.source_conn_id)
    eff_tgt_id    = body.source_conn_id if same_conn else (body.target_conn_id or body.source_conn_id)

    # ── Fetch real schemas for both connections ───────────────
    src_conn = db.query(SourceConnection).filter_by(id=body.source_conn_id).first()
    tgt_conn = db.query(SourceConnection).filter_by(id=eff_tgt_id).first() if not same_conn else src_conn

    src_schema = _fetch_schema(body.source_conn_id, src_conn, db) if src_conn else ""
    tgt_schema = _fetch_schema(eff_tgt_id, tgt_conn, db)          if tgt_conn and not same_conn else src_schema

    try:
        raw_cases = _ai_generate_test_cases(
            body.description, api_key, body.model, db,
            same_connection   = same_conn,
            source_conn_id    = body.source_conn_id,
            source_schema     = src_schema,
            target_schema     = tgt_schema,
            source_conn_name  = src_conn.name if src_conn else "source",
            target_conn_name  = (tgt_conn.name if tgt_conn else "target") if not same_conn else "",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    created = []
    for c in raw_cases:
        tc = AITestCase(
            group_name=c.get("group_name") or None,
            name=c.get("name", "Unnamed test"),
            source_conn_id=body.source_conn_id,
            target_conn_id=body.target_conn_id or body.source_conn_id,
            source_query=c.get("source_query", ""),
            target_query=c.get("target_query", ""),
            validation_type=c.get("validation_type", "count"),
            threshold=str(c.get("threshold", "0")),
        )
        db.add(tc)
        db.flush()
        created.append(tc)
    db.commit()
    for tc in created:
        db.refresh(tc)
    return created


@router.post("/tests/create", response_model=AITestCaseOut, tags=["testing"])
def create_test(body: AITestCaseCreate, db: Session = Depends(get_db)):
    tc = AITestCase(**body.model_dump())
    db.add(tc)
    db.commit()
    db.refresh(tc)
    return tc


@router.get("/tests/list", response_model=list[AITestCaseOut], tags=["testing"])
def list_tests(db: Session = Depends(get_db)):
    return db.query(AITestCase).order_by(AITestCase.id.desc()).all()


@router.get("/tests/results", tags=["testing"])
def all_results(db: Session = Depends(get_db)):
    """Return the latest result for every test case — used by the summary dashboard."""
    test_cases = db.query(AITestCase).order_by(AITestCase.id).all()
    out = []
    for tc in test_cases:
        latest = (
            db.query(AITestResult)
            .filter_by(test_case_id=tc.id)
            .order_by(AITestResult.id.desc())
            .first()
        )
        out.append({
            "test_case": AITestCaseOut.model_validate(tc).model_dump(),
            "latest_result": AITestResultOut.model_validate(latest).model_dump() if latest else None,
        })
    return out


def _run_cases(test_cases: list[AITestCase], db: Session) -> dict:
    """Shared execution logic for run-all and run-group."""
    results = []
    for tc in test_cases:
        res = _execute_test(tc, db)
        results.append({
            "test_case_id":   tc.id,
            "test_case_name": tc.name,
            "group_name":     tc.group_name,
            "result":         res.result,
            "source_value":   res.source_value,
            "target_value":   res.target_value,
            "difference":     res.difference,
            "remarks":        res.remarks,
            "execution_time": res.execution_time,
        })
    total  = len(results)
    passed = sum(1 for r in results if r["result"] == "pass")
    failed = sum(1 for r in results if r["result"] == "fail")
    errors = sum(1 for r in results if r["result"] == "error")
    return {
        "summary": {"total": total, "passed": passed, "failed": failed, "errors": errors},
        "results": results,
    }


@router.post("/tests/run-all", tags=["testing"])
def run_all_tests(db: Session = Depends(get_db)):
    """Execute every test case and return aggregated results."""
    test_cases = db.query(AITestCase).order_by(AITestCase.id).all()
    return _run_cases(test_cases, db)


@router.post("/tests/run-group", tags=["testing"])
def run_group_tests(group_name: str, db: Session = Depends(get_db)):
    """Execute all test cases that belong to the given group_name."""
    test_cases = (
        db.query(AITestCase)
        .filter(AITestCase.group_name == group_name)
        .order_by(AITestCase.id)
        .all()
    )
    if not test_cases:
        raise HTTPException(status_code=404, detail=f"No test cases found for group '{group_name}'")
    return _run_cases(test_cases, db)


@router.post("/tests/group-schedule", tags=["testing"])
def set_group_schedule(group_name: str, schedule_cron: str = "", db: Session = Depends(get_db)):
    """Set (or clear) a cron schedule on every test case in a group."""
    test_cases = (
        db.query(AITestCase)
        .filter(AITestCase.group_name == group_name)
        .all()
    )
    if not test_cases:
        raise HTTPException(status_code=404, detail=f"No test cases found for group '{group_name}'")
    cron_val = schedule_cron.strip() or None
    for tc in test_cases:
        tc.schedule_cron = cron_val
    db.commit()
    return {"group_name": group_name, "schedule_cron": cron_val, "updated": len(test_cases)}


@router.get("/tests/{test_id}", tags=["testing"])
def get_test(test_id: int, db: Session = Depends(get_db)):
    tc = _get_test(test_id, db)
    history = (
        db.query(AITestResult)
        .filter_by(test_case_id=test_id)
        .order_by(AITestResult.id.desc())
        .limit(20)
        .all()
    )
    return {
        "test_case": AITestCaseOut.model_validate(tc).model_dump(),
        "history": [AITestResultOut.model_validate(r).model_dump() for r in history],
    }


@router.put("/tests/{test_id}", response_model=AITestCaseOut, tags=["testing"])
def update_test(test_id: int, body: AITestCaseUpdate, db: Session = Depends(get_db)):
    tc = _get_test(test_id, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(tc, field, value)
    db.commit()
    db.refresh(tc)
    return tc


@router.delete("/tests/{test_id}", tags=["testing"])
def delete_test(test_id: int, db: Session = Depends(get_db)):
    tc = _get_test(test_id, db)
    db.delete(tc)
    db.commit()
    return {"deleted": test_id}


@router.post("/tests/run/{test_id}", response_model=AITestResultOut, tags=["testing"])
def run_test(test_id: int, db: Session = Depends(get_db)):
    """Execute a single test case immediately and return its result."""
    tc = _get_test(test_id, db)
    return _execute_test(tc, db)


@router.get("/tests/{test_id}/results", response_model=list[AITestResultOut], tags=["testing"])
def get_test_results(test_id: int, limit: int = 20, db: Session = Depends(get_db)):
    _get_test(test_id, db)
    return (
        db.query(AITestResult)
        .filter_by(test_case_id=test_id)
        .order_by(AITestResult.id.desc())
        .limit(limit)
        .all()
    )
