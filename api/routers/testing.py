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

from api.dependencies import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])


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


def _clean_err(exc: Exception) -> str:
    import re as _re
    raw = str(exc)
    clean = raw.split("\n")[-1].strip() or raw
    m = _re.search(r'\[Microsoft\]\[.*?\]\s*(.*)', clean)
    return (m.group(1).strip() if m else clean)[:500]


def _execute_aggregate(vtype: str, tc: AITestCase, src_cfg: dict, tgt_cfg: dict) -> dict:
    """Run an aggregate (scalar) test. Returns partial result dict."""
    sv = _run_scalar_query(src_cfg, tc.source_query)
    tv = _run_scalar_query(tgt_cfg, tc.target_query)
    source_val = str(sv)
    target_val = str(tv)
    try:
        threshold = float(tc.threshold or "0")
        if vtype in ("count", "sum"):
            diff = float(sv or 0) - float(tv or 0)
            result_flag = "pass" if abs(diff) <= threshold else "fail"
            remarks = f"{'Count' if vtype == 'count' else 'Sum'} difference: {round(diff, 6)} (threshold ≤ {threshold})"
            return dict(source_value=source_val, target_value=target_val,
                        difference=str(round(diff, 6)), result=result_flag, remarks=remarks)
        elif vtype == "null_check":
            src_n, tgt_n = int(sv or 0), int(tv or 0)
            thr = int(threshold)
            result_flag = "pass" if src_n <= thr and tgt_n <= thr else "fail"
            return dict(source_value=source_val, target_value=target_val,
                        difference=str(tgt_n - src_n), result=result_flag,
                        remarks=f"Source nulls: {src_n}, Target nulls: {tgt_n} (threshold ≤ {thr})")
        elif vtype == "duplicate":
            src_d, tgt_d = int(sv or 0), int(tv or 0)
            thr = int(threshold)
            result_flag = "pass" if src_d <= thr and tgt_d <= thr else "fail"
            return dict(source_value=source_val, target_value=target_val,
                        difference=str(tgt_d - src_d), result=result_flag,
                        remarks=f"Source dups: {src_d}, Target dups: {tgt_d} (threshold ≤ {thr})")
        elif vtype == "custom":
            tv2 = _run_scalar_query(tgt_cfg, tc.target_query) if tc.target_query.strip() else sv
            result_flag = "pass" if str(sv).lower() in ("1", "true", "pass", "yes") else "fail"
            return dict(source_value=str(sv), target_value=str(tv2),
                        difference=None, result=result_flag,
                        remarks=f"Custom assertion result: {sv}")
    except (ValueError, TypeError):
        return dict(source_value=source_val, target_value=target_val,
                    difference=None, result="fail",
                    remarks=f"Could not compare values: source={sv}, target={tv}")
    return dict(source_value=source_val, target_value=target_val,
                difference=None, result="error", remarks=f"Unknown type: {vtype}")


def _execute_row_level(tc: AITestCase, src_cfg: dict, tgt_cfg: dict) -> dict:
    """
    Fetch full result sets from both connections, compare row-by-row on identifier_column.
    Returns partial result dict including mismatch counts and sample differences.
    """
    import json as _json
    from api.services.connector import preview_data

    src_result = preview_data({**src_cfg, "query": tc.source_query}, limit=50_000)
    tgt_result = preview_data({**tgt_cfg, "query": tc.target_query}, limit=50_000)

    src_rows: list[dict] = src_result.get("rows", [])
    tgt_rows: list[dict] = tgt_result.get("rows", [])

    # Support composite keys: "CMLNUMBER,SOURCECOLUMN" → ['CMLNUMBER', 'SOURCECOLUMN']
    raw_id = (tc.identifier_column or "").strip()
    id_cols_raw = [c.strip() for c in raw_id.split(",") if c.strip()] if raw_id else []

    def _resolve_cols(row: dict, wanted: list[str]) -> list[str]:
        """Return actual row key names matching wanted list, case-insensitively."""
        lower_map = {k.lower(): k for k in row}
        resolved = []
        for w in wanted:
            actual = lower_map.get(w.lower())
            if actual:
                resolved.append(actual)
        return resolved

    def _make_key(row: dict, idx: int) -> str:
        if id_cols_raw:
            actual_cols = _resolve_cols(row, id_cols_raw)
            if actual_cols:
                return "|".join(str(row.get(c, "")) for c in actual_cols)
        return str(idx)   # positional fallback

    # ── Detect positional fallback (column name mismatch) ────
    _diag_src_cols = list(src_rows[0].keys()) if src_rows else []
    _diag_resolved = _resolve_cols(src_rows[0], id_cols_raw) if src_rows and id_cols_raw else []
    _using_positional = bool(id_cols_raw and not _diag_resolved)

    src_dict = {_make_key(r, i): r for i, r in enumerate(src_rows)}
    tgt_dict = {_make_key(r, i): r for i, r in enumerate(tgt_rows)}

    src_keys = set(src_dict)
    tgt_keys = set(tgt_dict)

    missing_in_tgt = src_keys - tgt_keys   # in source but not target
    missing_in_src = tgt_keys - src_keys   # in target but not source

    # Columns to compare — honour user-specified list; fall back to all non-key columns
    id_lower = {c.lower() for c in id_cols_raw}
    raw_compare = (tc.columns_to_compare or "").strip()
    if raw_compare:
        # User specified explicit columns — resolve them case-insensitively against src row keys
        wanted_compare = [c.strip() for c in raw_compare.split(",") if c.strip()]
        if src_rows:
            lower_map = {k.lower(): k for k in src_rows[0]}
            sample_cols = [lower_map[w.lower()] for w in wanted_compare if w.lower() in lower_map]
        else:
            sample_cols = wanted_compare
    else:
        # Default: all columns except identifier key columns
        sample_cols = [c for c in (src_rows[0].keys() if src_rows else []) if c.lower() not in id_lower]

    mismatches: list[dict] = []
    for key in sorted(src_keys & tgt_keys):
        sr, tr = src_dict[key], tgt_dict[key]
        diffs: dict[str, Any] = {}
        for col in sample_cols:
            sv = str(sr.get(col, "")) if sr.get(col) is not None else "NULL"
            tv = str(tr.get(col, "")) if tr.get(col) is not None else "NULL"
            if sv != tv:
                diffs[col] = {"source": sv, "target": tv}
        if diffs:
            mismatches.append({"key": key, "differences": diffs})

    mismatch_count       = len(mismatches)
    missing_source_count = len(missing_in_src)
    missing_target_count = len(missing_in_tgt)
    total_issues         = mismatch_count + missing_source_count + missing_target_count
    result_flag          = "pass" if total_issues == 0 else "fail"

    join_desc    = " + ".join(id_cols_raw) if id_cols_raw else "positional"
    compare_desc = ", ".join(sample_cols) if sample_cols else "all columns"

    if _using_positional:
        remarks = (
            f"[WARN: identifier not found in results - check column names] "
            f"Wanted: {id_cols_raw} | Got: {_diag_src_cols[:8]} | "
            f"Source: {len(src_rows)} rows | Target: {len(tgt_rows)} rows"
        )
    else:
        remarks = (
            f"JOIN ON: {join_desc} | Comparing: {compare_desc} | "
            f"Source: {len(src_rows)} rows | Target: {len(tgt_rows)} rows | "
            f"Missing in target: {missing_target_count} | "
            f"Missing in source: {missing_source_count} | "
            f"Value mismatches: {mismatch_count}"
        )

    # Sample the missing keys for the detail report (up to 50 each)
    sample_missing_src = _json.dumps(sorted(missing_in_src)[:50])
    sample_missing_tgt = _json.dumps(sorted(missing_in_tgt)[:50])

    return dict(
        source_value          = str(len(src_rows)),
        target_value          = str(len(tgt_rows)),
        difference            = str(total_issues),
        result                = result_flag,
        remarks               = remarks,
        mismatch_count        = mismatch_count,
        missing_source_count  = missing_source_count,
        missing_target_count  = missing_target_count,
        sample_mismatches     = _json.dumps(mismatches[:50]),
        sample_missing_source = sample_missing_src,
        sample_missing_target = sample_missing_tgt,
    )


def _execute_test(tc: AITestCase, db: Session) -> AITestResult:
    """Run a single test case, persist the result, and return it."""
    start_ms = int(time.time() * 1000)
    result_dict: dict = {}

    try:
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
        vtype   = tc.validation_type

        if vtype in ("row_level", "column_level"):
            result_dict = _execute_row_level(tc, src_cfg, tgt_cfg)
        else:
            result_dict = _execute_aggregate(vtype, tc, src_cfg, tgt_cfg)

    except Exception as exc:
        result_dict = dict(
            source_value=None, target_value=None, difference=None,
            result="error", remarks=_clean_err(exc),
        )

    elapsed = int(time.time() * 1000) - start_ms
    res = AITestResult(
        test_case_id          = tc.id,
        execution_time        = elapsed,
        result                = result_dict.get("result", "error"),
        source_value          = result_dict.get("source_value"),
        target_value          = result_dict.get("target_value"),
        difference            = result_dict.get("difference"),
        remarks               = result_dict.get("remarks", ""),
        mismatch_count        = result_dict.get("mismatch_count"),
        missing_source_count  = result_dict.get("missing_source_count"),
        missing_target_count  = result_dict.get("missing_target_count"),
        sample_mismatches     = result_dict.get("sample_mismatches"),
        sample_missing_source = result_dict.get("sample_missing_source"),
        sample_missing_target = result_dict.get("sample_missing_target"),
        ran_at                = datetime.utcnow(),
    )
    db.add(res)
    db.commit()
    db.refresh(res)
    return res


# ── AI generation ──────────────────────────────────────────────

_SYSTEM_PROMPT = """You are a data reconciliation expert. Given a description of what to validate,
generate a JSON array of test cases covering the described validation.

## Test case fields

| Field | Required | Notes |
|---|---|---|
| group_name | yes | Short label grouping related tests, e.g. "Employee Checks" |
| name | yes | Short descriptive name for this specific test |
| validation_type | yes | One of: count, sum, null_check, duplicate, custom, row_level, column_level |
| source_query | yes | SQL for SOURCE system |
| target_query | yes | SQL for TARGET system |
| threshold | yes | "0" for exact match, numeric string for tolerance |
| identifier_column | conditional | REQUIRED for row_level and column_level — the join key column name |
| reconciliation_type | yes | "aggregate" for count/sum/null_check/duplicate/custom; "row_level" for row_level/column_level |

## Validation type guide

**Aggregate types** (reconciliation_type = "aggregate") — queries must return ONE scalar value:
- count:      SELECT COUNT(*) AS cnt FROM <table>
- sum:        SELECT ISNULL(SUM(<col>), 0) AS total FROM <table>
- null_check: SELECT COUNT(*) AS null_cnt FROM <table> WHERE <col> IS NULL
- duplicate:  SELECT COUNT(*) - COUNT(DISTINCT <col>) AS dup_cnt FROM <table>
- custom:     Any assertion returning 1/true/pass = success

**Row-level types** (reconciliation_type = "row_level") — queries must return MULTIPLE columns:
- row_level:    Both queries return all columns including the identifier.
  source_query: SELECT <id_col>, col1, col2, ... FROM source_table
  target_query: SELECT <id_col>, col1, col2, ... FROM target_table
  The system JOINs on identifier_column and detects missing records + value mismatches.

- column_level: Like row_level but focused on comparing one or a few specific columns.
  source_query: SELECT <id_col>, <col_to_check> FROM source_table
  target_query: SELECT <id_col>, <col_to_check> FROM target_table

## T-SQL rules (always apply)
1. For aggregate queries: return exactly ONE row and ONE column.
2. ALWAYS alias aggregate columns (SELECT COUNT(*) AS cnt — never bare COUNT(*)).
3. NEVER use derived tables / subqueries for aggregate tests.
4. For row_level/column_level queries: SELECT the identifier + the columns you want to compare.
5. Use exact table/column names from the schema provided. Never invent 'tgt_' prefixes.
6. Return ONLY a raw JSON array — no markdown, no explanation.

## Example output (mixed types, same connection — note DIFFERENT source vs target tables)
[
  {
    "group_name": "Employee Checks",
    "name": "Employee Row Count Match",
    "validation_type": "count",
    "reconciliation_type": "aggregate",
    "source_query": "SELECT COUNT(*) AS cnt FROM EMP",
    "target_query": "SELECT COUNT(*) AS cnt FROM EMP_OUTPUT",
    "threshold": "0",
    "identifier_column": null
  },
  {
    "group_name": "Employee Checks",
    "name": "Employee Record-Level Comparison",
    "validation_type": "row_level",
    "reconciliation_type": "row_level",
    "source_query": "SELECT EMPNO, ENAME, SAL, DEPTNO FROM EMP",
    "target_query": "SELECT EMPNO, ENAME, SAL, DEPTNO FROM EMP_OUTPUT",
    "threshold": "0",
    "identifier_column": "EMPNO"
  },
  {
    "group_name": "Employee Checks",
    "name": "Salary Column Comparison",
    "validation_type": "column_level",
    "reconciliation_type": "row_level",
    "source_query": "SELECT EMPNO, SAL FROM EMP",
    "target_query": "SELECT EMPNO, SAL FROM EMP_OUTPUT",
    "threshold": "0",
    "identifier_column": "EMPNO"
  }
]
"""


def _resolve_prompt(db: Session, conn_id: Optional[int] = None) -> str:
    """
    Return the active prompt template for category='testing' from the DB,
    with connection-specific placeholders resolved.
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
            content = tmpl.content.strip()
            if conn_id:
                try:
                    from api.services.context_cache import get_or_build
                    from api.services.ai_engine import resolve_template_placeholders
                    ctx = get_or_build(conn_id, db)
                    content = resolve_template_placeholders(content, ctx)
                except Exception:
                    pass
            return content
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
    identifier_column: Optional[str] = None,
    reconciliation_type: str = "aggregate",
) -> list[dict]:
    import openai as _openai

    system_prompt = _resolve_prompt(db, conn_id=source_conn_id)

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
            "\n\nBoth source_query and target_query run on THE SAME database connection. "
            "IMPORTANT: even though it is the same connection, the source and target data live "
            "in DIFFERENT tables (e.g. source tables vs developer-output/transformed tables). "
            "Do NOT copy the same query into both fields — write a distinct source_query that "
            "reads from the original/source tables, and a distinct target_query that reads from "
            "the transformed/target/output tables. Use table names from the schema where available; "
            "if unsure, use a descriptive name like '<table>_output' or '<table>_target' for "
            "the target query so it is clearly different."
        )
    else:
        conn_hint = (
            "\n\nsource_query runs on the SOURCE database; "
            "target_query runs on the TARGET database (different connection)."
        )

    # Reconciliation mode instruction
    if reconciliation_type == "row_level":
        recon_hint = (
            "\n\nThe user wants ROW-LEVEL reconciliation. "
            "Generate a mix of aggregate checks (count/sum) PLUS at least one row_level test "
            "that fetches all relevant columns for record-by-record comparison."
        )
    else:
        recon_hint = (
            "\n\nThe user wants AGGREGATE reconciliation only. "
            "Use count, sum, null_check, or duplicate types. Do NOT generate row_level tests."
        )

    if identifier_column:
        id_hint = (
            f"\n\nThe identifier (join key) column is: {identifier_column!r}. "
            "Use this column as identifier_column for any row_level or column_level tests."
        )
    else:
        id_hint = (
            "\n\nNo identifier column was specified. "
            "Infer the primary/business key from the schema (look for columns named ID, _ID, _KEY, _NO, CODE). "
            "Set identifier_column to your best guess. If truly unknown, use null."
        )

    full_system = system_prompt + schema_block + conn_hint + recon_hint + id_hint
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
            same_connection     = same_conn,
            source_conn_id      = body.source_conn_id,
            source_schema       = src_schema,
            target_schema       = tgt_schema,
            source_conn_name    = src_conn.name if src_conn else "source",
            target_conn_name    = (tgt_conn.name if tgt_conn else "target") if not same_conn else "",
            identifier_column   = body.identifier_column,
            reconciliation_type = body.reconciliation_type or "aggregate",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    _VALID_VTYPES = {"count", "sum", "null_check", "duplicate", "custom", "row_level", "column_level"}
    created = []
    for c in raw_cases:
        vtype = c.get("validation_type", "count")
        if vtype not in _VALID_VTYPES:
            vtype = "count"
        tc = AITestCase(
            group_name          = c.get("group_name") or None,
            name                = c.get("name", "Unnamed test"),
            source_conn_id      = body.source_conn_id,
            target_conn_id      = body.target_conn_id or body.source_conn_id,
            source_query        = c.get("source_query", ""),
            target_query        = c.get("target_query", ""),
            validation_type     = vtype,
            threshold           = str(c.get("threshold", "0")),
            identifier_column   = c.get("identifier_column") or body.identifier_column or None,
            reconciliation_type = c.get("reconciliation_type") or "aggregate",
            columns_to_compare  = c.get("columns_to_compare") or None,
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
def list_tests(conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(AITestCase)
    if conn_id is not None:
        q = q.filter(AITestCase.source_conn_id == conn_id)
    return q.order_by(AITestCase.id.desc()).all()


@router.get("/tests/results", tags=["testing"])
def all_results(conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Return the latest result for every test case — used by the summary dashboard."""
    q = db.query(AITestCase)
    if conn_id is not None:
        q = q.filter(AITestCase.source_conn_id == conn_id)
    test_cases = q.order_by(AITestCase.id).all()
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
            "test_case_id":        tc.id,
            "test_case_name":      tc.name,
            "group_name":          tc.group_name,
            "result":              res.result,
            "source_value":        res.source_value,
            "target_value":        res.target_value,
            "difference":          res.difference,
            "remarks":             res.remarks,
            "execution_time":      res.execution_time,
            "mismatch_count":      res.mismatch_count,
            "missing_source_count": res.missing_source_count,
            "missing_target_count": res.missing_target_count,
            "sample_mismatches":   res.sample_mismatches,
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
def run_all_tests(conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Execute every test case and return aggregated results."""
    q = db.query(AITestCase)
    if conn_id is not None:
        q = q.filter(AITestCase.source_conn_id == conn_id)
    test_cases = q.order_by(AITestCase.id).all()
    return _run_cases(test_cases, db)


@router.post("/tests/run-group", tags=["testing"])
def run_group_tests(group_name: str, conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Execute all test cases that belong to the given group_name."""
    q = db.query(AITestCase).filter(AITestCase.group_name == group_name)
    if conn_id is not None:
        q = q.filter(AITestCase.source_conn_id == conn_id)
    test_cases = q.order_by(AITestCase.id).all()
    if not test_cases:
        raise HTTPException(status_code=404, detail=f"No test cases found for group '{group_name}'")
    return _run_cases(test_cases, db)


@router.post("/tests/group-schedule", tags=["testing"])
def set_group_schedule(group_name: str, schedule_cron: str = "", conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Set (or clear) a cron schedule on every test case in a group."""
    q = db.query(AITestCase).filter(AITestCase.group_name == group_name)
    if conn_id is not None:
        q = q.filter(AITestCase.source_conn_id == conn_id)
    test_cases = q.all()
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
