"""
reconciliation_agent.py — Reconciliation Agent for the Dev vs Base Reconciliation Engine.

For each Q2 (BASE) test query:
  1. Derive a Q1 (DEV) wrapper that mirrors Q2's aggregation shape
  2. Execute Q2 (BASE) → base_result
  3. Execute derived Q1 (DEV) → dev_result
  4. Compare results → PASS / FAIL / WARN / ERROR / SKIP
  5. On FAIL: call GPT-4o-mini for a structured root-cause insight

Q1 (DEV) can come from any source:
  mapper         → conversion_generated_queries (latest for conn_id)
  dashboard      → conversion_dashboard_configs widget SQL
  report         → conversion_saved_reports
  ps_workflow    → conversion_ps_workflow_steps
  dev_artifact   → conversion_dev_artifacts step SQL
  adhoc          → raw SQL passed in request body
"""
from __future__ import annotations

import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.orm import Session

from api.models import (
    TestQuery, ReconciliationResult, AITraceLog,
    GeneratedQuery, SourceConnection,
)
from api.services.encryption import decrypt


@dataclass
class ReconciliationRunResult:
    run_id: str
    conn_id: int
    total: int
    passed: int
    failed: int
    warns: int
    errors: int
    skipped: int
    confidence_score: float
    suggested_fixes: list[dict]   # [{test_name, fix_sql}]
    results: list[dict]


# ── Q1 (DEV) source resolver ──────────────────────────────────────────────────

def resolve_dev_sql(
    source_type: str,
    source_id: Optional[int],
    source_sub_id: Optional[int],
    adhoc_sql: Optional[str],
    conn_id: int,
    db: Session,
) -> str:
    """Resolve the Q1 (DEV) SQL from the specified source."""
    if source_type == "mapper":
        q = db.query(GeneratedQuery).filter(GeneratedQuery.conn_id == conn_id)
        if source_id:
            q = q.filter(GeneratedQuery.id == source_id)
        row = q.order_by(GeneratedQuery.id.desc()).first()
        if not row:
            raise ValueError("No mapper query found for this connection. Run the Conversion Agent first.")
        return row.query_sql

    elif source_type == "dashboard":
        if not source_id:
            raise ValueError("source_id is required for source_type='dashboard'. Select a dashboard first.")
        from api.models import DashboardConfig
        dash = db.query(DashboardConfig).filter_by(id=source_id).first()
        if not dash:
            raise ValueError(f"Dashboard {source_id} not found.")
        raw = json.loads(dash.config_json or "{}")
        # config_json is DashboardConfigSchema: {tabName, widgets: [{id, dataBinding: {sql}}]}
        widgets = raw.get("widgets", [])
        # source_sub_id is widget index (0-based)
        if source_sub_id is not None and source_sub_id < len(widgets):
            widget = widgets[source_sub_id]
        else:
            # Fall back to first widget with SQL
            widget = next((w for w in widgets if w.get("dataBinding", {}).get("sql")), None)
        if not widget:
            raise ValueError(f"No widget with SQL found in dashboard {source_id}.")
        sql = widget.get("dataBinding", {}).get("sql", "")
        if not sql:
            raise ValueError(f"Widget in dashboard {source_id} has no SQL defined.")
        return sql

    elif source_type == "report":
        if not source_id:
            raise ValueError("source_id is required for source_type='report'. Select a saved report first.")
        from api.models import SavedReport
        row = db.query(SavedReport).filter_by(id=source_id).first()
        if not row:
            raise ValueError(f"Saved report {source_id} not found.")
        return row.query_sql

    elif source_type == "ps_workflow":
        if not source_id:
            raise ValueError("source_id is required for source_type='ps_workflow'. Select a PS Workflow step first.")
        from api.models import PsWorkflowStep
        row = db.query(PsWorkflowStep).filter_by(id=source_id).first()
        if not row:
            raise ValueError(f"PS Workflow step {source_id} not found.")
        # sql_text may be in config_json for ps steps
        sql = getattr(row, "sql_text", None)
        if not sql:
            cfg = json.loads(getattr(row, "config_json", None) or "{}")
            sql = cfg.get("sql") or cfg.get("query", "")
        return sql

    elif source_type == "dev_artifact":
        if not source_id:
            raise ValueError("source_id is required for source_type='dev_artifact'. Select a Dev Artifact first.")
        from api.models import DevArtifact
        row = db.query(DevArtifact).filter_by(id=source_id).first()
        if not row:
            raise ValueError(f"Dev artifact {source_id} not found.")
        steps = json.loads(row.artifacts_json or "[]")
        idx = source_sub_id or 0
        if idx < len(steps):
            step = steps[idx]
            return step.get("sql") or step.get("sql_text", "")
        raise ValueError(f"Dev artifact {source_id} has no step at index {idx}.")

    elif source_type == "adhoc":
        if not adhoc_sql:
            raise ValueError("adhoc_sql is required for source_type='adhoc'.")
        return adhoc_sql

    raise ValueError(f"Unknown source_type: '{source_type}'. Valid: mapper|dashboard|report|ps_workflow|dev_artifact|adhoc")


# ── Q1 (DEV) wrapper derivation ───────────────────────────────────────────────

import re as _re

def _strip_order_by(sql: str) -> str:
    """
    Remove trailing ORDER BY clause from SQL so it can be used as a subquery.
    SQL Server rejects ORDER BY inside a derived table unless TOP is also present.
    Handles multi-line ORDER BY at the end of the statement.
    """
    # Remove trailing ORDER BY ... (everything from the last top-level ORDER BY to end)
    # Uses a regex that matches ORDER BY not inside parentheses at the end
    cleaned = _re.sub(r'\bORDER\s+BY\b[^()]*$', '', sql, flags=_re.IGNORECASE | _re.DOTALL)
    return cleaned.strip().rstrip(";")


def derive_dev_wrapper(
    q2_type: str,
    q1_dev_sql: str,
    column_name: Optional[str],
    col_q: str = "[",
    col_c: str = "]",
) -> Optional[str]:
    """Wrap Q1 (DEV) SQL in a subquery mirroring Q2 (BASE) aggregation pattern."""
    inner = _strip_order_by(q1_dev_sql)
    if q2_type in ("count", "join_explosion", "filter_impact"):
        return f"SELECT COUNT(*) AS _cnt FROM ({inner}) AS _dev_wrap"
    elif q2_type == "agg" and column_name:
        return (
            f"SELECT SUM({col_q}{column_name}{col_c}) AS _agg "
            f"FROM ({inner}) AS _dev_wrap"
        )
    elif q2_type == "distribution" and column_name:
        return (
            f"SELECT {col_q}{column_name}{col_c}, COUNT(*) AS _cnt "
            f"FROM ({inner}) AS _dev_wrap "
            f"GROUP BY {col_q}{column_name}{col_c}"
        )
    elif q2_type == "duplicate" and column_name:
        return (
            f"SELECT {col_q}{column_name}{col_c}, COUNT(*) AS _dup_cnt "
            f"FROM ({inner}) AS _dev_wrap "
            f"GROUP BY {col_q}{column_name}{col_c} HAVING COUNT(*) > 1"
        )
    elif q2_type == "sample_value":
        if col_q == "[":
            return f"SELECT TOP 10 * FROM ({inner}) AS _dev_wrap ORDER BY 1"
        else:
            return f"SELECT * FROM ({inner}) AS _dev_wrap ORDER BY 1 LIMIT 10"
    # set_diff, custom: no Q1 equivalent → SKIP
    return None


# ── Comparison helpers ────────────────────────────────────────────────────────

def _extract_scalar(rows: list[dict]) -> Optional[float]:
    if not rows:
        return None
    first_row = rows[0] if isinstance(rows[0], dict) else {}
    for v in first_row.values():
        if v is not None and str(v).strip() != "":
            try:
                return float(str(v).replace(",", "").strip())
            except (ValueError, TypeError):
                continue
    return None


def _compare(
    q2_type: str,
    base_rows: list[dict],
    dev_rows: list[dict],
    severity: str = "error",
    tolerance: float = 0.0,
) -> tuple[str, Optional[str]]:
    """Return (status, issue). Status: PASS|FAIL|WARN|ERROR|SKIP."""

    if q2_type in ("count", "join_explosion"):
        bv = _extract_scalar(base_rows)
        dv = _extract_scalar(dev_rows)
        if bv is None or dv is None:
            return "ERROR", "Could not extract scalar from result"
        diff = abs(bv - dv)
        if diff <= tolerance:
            return "PASS", None
        status = "WARN" if severity == "warning" else "FAIL"
        # join_explosion: flag when DEV is LARGER than base (row multiplication)
        direction = ""
        if q2_type == "join_explosion" and dv > bv:
            direction = f" — DEV ({dv:.0f}) > BASE ({bv:.0f}): possible join duplication"
        elif q2_type == "join_explosion" and dv < bv:
            direction = f" — DEV ({dv:.0f}) < BASE ({bv:.0f}): possible filter exclusion"
        return status, f"Row count mismatch: BASE={bv:.0f}, DEV={dv:.0f}{direction}"

    elif q2_type == "filter_impact":
        bv = _extract_scalar(base_rows)
        dv = _extract_scalar(dev_rows)
        if bv is None or dv is None:
            return "ERROR", "Could not extract scalar from result"
        if bv == 0:
            return "PASS", None
        drop_rate = (bv - (dv or 0)) / bv
        if drop_rate > 0.2:
            pct = round(drop_rate * 100, 1)
            return "WARN", f"Filter impact: {pct}% of BASE rows missing in DEV (BASE={bv:.0f}, DEV={dv:.0f})"
        return "PASS", None

    elif q2_type == "agg":
        bv = _extract_scalar(base_rows)
        dv = _extract_scalar(dev_rows)
        if bv is None or dv is None:
            return "ERROR", "Could not extract aggregate scalar"
        diff = abs((bv or 0) - (dv or 0))
        if diff <= tolerance:
            return "PASS", None
        return "WARN", f"Aggregation mismatch: BASE={bv}, DEV={dv}, diff={round(diff, 4)}"

    elif q2_type == "distribution":
        return _compare_distributions(base_rows, dev_rows)

    elif q2_type in ("duplicate",):
        # Any rows returned = FAIL (duplicates present in BASE table)
        if base_rows:
            sample = base_rows[:3]
            return "FAIL", f"Duplicate PKs in BASE table: {sample}"
        return "PASS", None

    elif q2_type == "set_diff":
        if base_rows:
            cnt = len(base_rows)
            sample = [list(r.values())[0] for r in base_rows[:5] if r]
            return "FAIL", f"{cnt} orphaned FK values found (sample: {sample})"
        return "PASS", None

    elif q2_type == "sample_value":
        return _compare_sample_values(base_rows, dev_rows)

    return "SKIP", "Unhandled query type"


def _compare_distributions(
    base_rows: list[dict],
    dev_rows: list[dict],
) -> tuple[str, Optional[str]]:
    def to_dict(rows: list[dict]) -> dict[str, int]:
        result: dict[str, int] = {}
        for row in rows:
            vals = list(row.values())
            if len(vals) >= 2:
                key = str(vals[0]) if vals[0] is not None else "NULL"
                try:
                    cnt = int(float(str(vals[1] or 0)))
                except (ValueError, TypeError):
                    cnt = 0
                result[key] = cnt
        return result

    d_base = to_dict(base_rows)
    d_dev = to_dict(dev_rows)
    base_total = sum(d_base.values())
    # Hybrid threshold: exact for small datasets, 5% tolerance otherwise
    threshold = 0.0 if base_total < 100 else 0.05

    all_keys = set(d_base) | set(d_dev)
    mismatches = []
    for key in all_keys:
        c_base = d_base.get(key, 0)
        c_dev = d_dev.get(key, 0)
        base_ref = max(c_base, c_dev, 1)
        if abs(c_base - c_dev) / base_ref > threshold:
            mismatches.append({"value": key, "base": c_base, "dev": c_dev})

    if mismatches:
        return "FAIL", f"{len(mismatches)} distribution mismatch(es): {mismatches[:5]}"
    return "PASS", None


def _compare_sample_values(
    base_rows: list[dict],
    dev_rows: list[dict],
) -> tuple[str, Optional[str]]:
    mismatches = []
    for i, (br, dr) in enumerate(zip(base_rows, dev_rows)):
        for col in list(br.keys()):
            bv = str(br.get(col, "")) if br.get(col) is not None else "NULL"
            dv = str(dr.get(col, "")) if dr.get(col) is not None else "NULL"
            if bv != dv:
                mismatches.append({"row": i, "col": col, "base": bv, "dev": dv})
    if mismatches:
        return "FAIL", f"{len(mismatches)} value-level mismatch(es): {mismatches[:5]}"
    return "PASS", None


# ── AI insight generation ─────────────────────────────────────────────────────

def _generate_ai_insight(
    q2_type: str,
    q2_base_sql: str,
    q1_dev_wrapper: Optional[str],
    q1_original_sql: str,
    base_result_json: str,
    dev_result_json: str,
    issue: str,
    schema_snippet: str,
    openai_client,
    db: Session,
    conn_id: int,
) -> Optional[str]:
    """Return structured JSON insight string."""
    system_prompt = (
        "You are a data reconciliation expert. Analyze the given SQL queries and mismatch data, "
        "then explain the root cause.\n\n"
        "Return ONLY a JSON object with these exact keys (no markdown):\n"
        '  "root_cause_category": one of join_duplication|filter_exclusion|missing_records|'
        'aggregation_distortion|value_mapping_mismatch|schema_drift|unknown\n'
        '  "confidence": float 0-1\n'
        '  "explanation": 2-3 sentence root cause explanation\n'
        '  "suggestion": specific actionable fix\n'
        '  "ai_suggested_fix": a short rewritten SQL fragment that fixes the issue (max 200 tokens), or null'
    )
    user_msg = (
        f"Query type: {q2_type}\n"
        f"BASE SQL: {q2_base_sql[:400]}\n"
        f"DEV wrapper SQL: {(q1_dev_wrapper or 'N/A')[:400]}\n"
        f"Original DEV SQL: {q1_original_sql[:300]}\n"
        f"BASE result: {base_result_json[:300]}\n"
        f"DEV result: {dev_result_json[:300]}\n"
        f"Issue: {issue[:300]}\n"
        f"Schema context: {schema_snippet[:500]}"
    )

    start_ms = int(time.time() * 1000)
    try:
        resp = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.2,
            max_tokens=400,
        )
    except Exception:
        return None

    elapsed = int(time.time() * 1000) - start_ms
    raw = resp.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    # Log AI call
    try:
        db.add(AITraceLog(
            module="reconciliation",
            conn_id=conn_id,
            model="gpt-4o-mini",
            prompt_text=(system_prompt[:1500] + "\n---\n" + user_msg[:2000])[:4000],
            response_text=raw[:4000],
            tokens_in=getattr(resp.usage, "prompt_tokens", None),
            tokens_out=getattr(resp.usage, "completion_tokens", None),
            latency_ms=elapsed,
        ))
        db.flush()
    except Exception:
        pass

    # Validate JSON structure
    try:
        parsed = json.loads(raw)
        required = {"root_cause_category", "confidence", "explanation", "suggestion"}
        if required.issubset(parsed.keys()):
            return json.dumps(parsed)
    except Exception:
        pass
    return None


# ── Confidence score ──────────────────────────────────────────────────────────

def _compute_confidence(results: list[ReconciliationResult], test_queries: dict[int, TestQuery]) -> float:
    non_skip = [r for r in results if r.status != "SKIP"]
    if not non_skip:
        return 0.0
    passed = sum(1 for r in non_skip if r.status == "PASS")
    pass_rate = passed / len(non_skip)

    critical = [
        r for r in non_skip
        if r.test_query_id and test_queries.get(r.test_query_id)
        and test_queries[r.test_query_id].priority == 1
    ]
    if critical:
        crit_passed = sum(1 for r in critical if r.status == "PASS")
        crit_rate = crit_passed / len(critical)
    else:
        crit_rate = 1.0

    return round(0.4 * pass_rate + 0.6 * crit_rate, 2)


def _extract_q1_tables(q1_sql: str) -> set[str]:
    """
    Extract table names referenced in the Q1 DEV SQL's FROM / JOIN clauses.
    Returns a set of upper-cased bare table names (no schema prefix).

    Handles:
      FROM [dbo].[TableName] AS alias
      FROM TableName t
      JOIN [TableName] ON ...
      WITH cte AS (...) SELECT ... FROM cte  → skips CTE names
    """
    # Remove string literals to avoid false matches
    cleaned = _re.sub(r"'[^']*'", "''", q1_sql, flags=_re.DOTALL)

    # Find CTE names so we don't treat them as real tables
    cte_names: set[str] = set()
    for m in _re.finditer(r'\bWITH\b(.+?)\bSELECT\b', cleaned, flags=_re.IGNORECASE | _re.DOTALL):
        for cte_m in _re.finditer(r'\b(\w+)\s+AS\s*\(', m.group(1), flags=_re.IGNORECASE):
            cte_names.add(cte_m.group(1).upper())

    tables: set[str] = set()
    # Match FROM / JOIN followed by optional schema.table or [schema].[table]
    pattern = _re.compile(
        r'\b(?:FROM|JOIN)\s+'
        r'(?:\[?[\w]+\]?\s*\.\s*)?'      # optional schema.
        r'\[?([\w]+)\]?'                   # table name
        r'(?:\s+(?:AS\s+)?\w+)?',          # optional alias
        _re.IGNORECASE,
    )
    for m in pattern.finditer(cleaned):
        name = m.group(1).upper()
        # Skip keywords that follow FROM/JOIN in subqueries
        if name in ("SELECT", "WITH", "VALUES", "DUAL", "INFORMATION_SCHEMA"):
            continue
        if name not in cte_names:
            tables.add(name)
    return tables


def _column_accessible_in_q1(column_name: Optional[str], q1_sql: str) -> bool:
    """
    Return True if column_name appears as a direct (non-path) alias in Q1's SELECT list.
    Q1 queries that alias all columns as XML paths like [/Policy/Status] won't expose
    the raw column name; those return False so the test is SKIP'd instead of ERROR'd.
    """
    if not column_name:
        return False
    # Check for patterns: "AS [column_name]" or 'AS "column_name"' or "AS column_name"
    # A "path alias" contains / or \ — skip those
    pattern = _re.compile(
        r'\bAS\s*[\[\"]?' + _re.escape(column_name) + r'[\]\"]?\b',
        _re.IGNORECASE,
    )
    for m in pattern.finditer(q1_sql):
        # Check the alias text immediately after AS
        alias = m.group(0).split(None, 1)[1].strip().strip('[]"')
        if '/' not in alias and '\\' not in alias:
            return True
    # Also check if the column appears bare in the SELECT list (no alias)
    bare = _re.compile(r'\b' + _re.escape(column_name) + r'\b\s*(?:,|$|\n)', _re.IGNORECASE)
    if bare.search(q1_sql):
        return True
    return False


# ── Main agent class ──────────────────────────────────────────────────────────

class ReconciliationAgent:
    def __init__(
        self,
        conn_id: int,
        db: Session,
        openai_client=None,
        source_type: str = "mapper",
        source_id: Optional[int] = None,
        source_sub_id: Optional[int] = None,
        adhoc_sql: Optional[str] = None,
        sampling_mode: str = "top_n",
        sample_size: int = 100_000,
        stratify_col: Optional[str] = None,
        base_query_scope: str = "auto",   # auto | all | tagged_only
    ):
        self.conn_id = conn_id
        self.db = db
        self.openai_client = openai_client
        self.source_type = source_type
        self.source_id = source_id
        self.source_sub_id = source_sub_id
        self.adhoc_sql = adhoc_sql
        self.sampling_mode = sampling_mode
        self.sample_size = sample_size
        self.stratify_col = stratify_col
        self.base_query_scope = base_query_scope

        # Load connection config
        self._conn = db.query(SourceConnection).filter_by(id=conn_id).first()
        if not self._conn:
            raise ValueError(f"Connection {conn_id} not found.")

        dialect = (self._conn.dialect or "mssql").lower()
        if dialect in ("postgresql", "snowflake", "mysql"):
            self.col_q, self.col_c = '"', '"'
        else:
            self.col_q, self.col_c = "[", "]"

        self._cfg = self._build_cfg()

    def _build_cfg(self) -> dict:
        conn = self._conn
        return {
            "source_type": conn.source_type,
            "dialect":     conn.dialect,
            "host":        conn.host,
            "port":        conn.port,
            "database":    conn.database_name,
            "schema":      conn.schema_name,
            "username":    conn.username,
            "password":    decrypt(conn.password_enc) if conn.password_enc else "",
            "account":     conn.sf_account,
            "warehouse":   conn.sf_warehouse,
            "role":        conn.sf_role,
            "sf_database": conn.sf_database,
            "sf_schema":   conn.sf_schema,
            "sf_username": conn.sf_username,
            "sf_password": decrypt(conn.sf_password_enc) if conn.sf_password_enc else "",
            "private_key": decrypt(conn.sf_private_key_enc) if conn.sf_private_key_enc else "",
        }

    def _run_query(self, sql: str, limit: int = 200) -> list[dict]:
        from api.services.connector import preview_data
        try:
            result = preview_data({**self._cfg, "query": sql}, limit=limit)
            return result.get("rows", [])
        except Exception as exc:
            err = str(exc)
            # SQL Server: "No column name was specified" — query has unnamed expressions
            # (e.g. SELECT COUNT(*) without AS alias). Execute directly and auto-name cols.
            if "no column name" in err.lower():
                from api.services.connector import _build_sql_engine
                from sqlalchemy import text as sa_text
                engine = _build_sql_engine(self._cfg)
                with engine.connect() as con:
                    cursor_result = con.execute(sa_text(sql.strip().rstrip(";")))
                    keys = list(cursor_result.keys())
                    # Auto-name unnamed columns col0, col1, …
                    named_keys = [k if k and not k.startswith("(") else f"col{i}"
                                  for i, k in enumerate(keys)]
                    rows_raw = cursor_result.fetchmany(limit)
                    return [dict(zip(named_keys, row)) for row in rows_raw]
            raise

    def _build_schema_snippet(self) -> str:
        from api.models import CatalogColumn
        cols = (
            self.db.query(CatalogColumn)
            .filter_by(conn_id=self.conn_id)
            .order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position)
            .limit(200)
            .all()
        )
        tables: dict[str, list[str]] = {}
        for c in cols:
            tables.setdefault(c.table_name, []).append(c.column_name)
        return "\n".join(f"{t}({', '.join(cs)})" for t, cs in list(tables.items())[:20])

    # ── Main run ──────────────────────────────────────────────────────────────

    def run(self) -> ReconciliationRunResult:
        run_id = str(uuid.uuid4())

        # Resolve Q1 (DEV) SQL
        q1_dev_sql = resolve_dev_sql(
            self.source_type, self.source_id, self.source_sub_id,
            self.adhoc_sql, self.conn_id, self.db,
        )

        # Load Q2 (BASE) test queries — scoped by dev_source_tag if applicable
        # Scope modes:
        #   auto        → run tagged queries for this source_type + all untagged (global)
        #   all         → run everything regardless of tag
        #   tagged_only → run only queries explicitly tagged for this source_type
        base_q = self.db.query(TestQuery).filter_by(conn_id=self.conn_id)

        if self.base_query_scope == "tagged_only":
            # Only queries explicitly tagged for this source type (exact or comma-list contains)
            from sqlalchemy import or_
            base_q = base_q.filter(
                or_(
                    TestQuery.dev_source_tag == self.source_type,
                    TestQuery.dev_source_tag.like(f"{self.source_type},%"),
                    TestQuery.dev_source_tag.like(f"%,{self.source_type}"),
                    TestQuery.dev_source_tag.like(f"%,{self.source_type},%"),
                )
            )
        elif self.base_query_scope == "auto":
            # Tagged for this source (including in comma list) OR untagged (global)
            from sqlalchemy import or_
            st = self.source_type
            base_q = base_q.filter(
                or_(
                    TestQuery.dev_source_tag.is_(None),
                    TestQuery.dev_source_tag == st,
                    TestQuery.dev_source_tag.like(f"{st},%"),
                    TestQuery.dev_source_tag.like(f"%,{st}"),
                    TestQuery.dev_source_tag.like(f"%,{st},%"),
                )
            )
        # "all" → no extra filter

        all_test_queries = base_q.order_by(TestQuery.priority.desc(), TestQuery.id).all()

        if not all_test_queries:
            raise ValueError("No BASE queries found for this source. Run 'Auto-Generate from Schema' first, or check the scope setting.")

        # ── Table scoping: only run BASE tests for tables actually in Q1 ──────
        # BASE queries cover every table in the schema.  If a BASE test targets
        # a table not referenced by Q1 (e.g. SALARY_HISTORY when Q1 only joins
        # EMP+DEPT), the derived Q1 wrapper measures the wrong data.  Pre-SKIP
        # those tests so only relevant comparisons run.
        q1_tables = _extract_q1_tables(q1_dev_sql)   # set of upper-cased names

        scoped_queries: list[TestQuery] = []
        pre_skipped: list[ReconciliationResult] = []

        for tq in all_test_queries:
            tbl_upper = (tq.table_name or "").upper()
            # Tests with no table_name (custom, set_diff cross-table) always run
            if not tq.table_name or tbl_upper in q1_tables:
                scoped_queries.append(tq)
            else:
                # Pre-create a SKIP result without hitting the DB engines
                skip_res = ReconciliationResult(
                    conn_id=self.conn_id,
                    run_id=run_id,
                    dev_source_type=self.source_type,
                    dev_source_id=self.source_id,
                    test_query_id=tq.id,
                    test_name=tq.name,
                    query_type=tq.query_type,
                    q2_base_sql=tq.sql_text,
                    q1_dev_sql=None,
                    q1_sql_snapshot=q1_dev_sql[:4000] if q1_dev_sql else None,
                    status="SKIP",
                    base_result=None,
                    dev_result=None,
                    issue=f"Table '{tq.table_name}' not referenced in Q1 DEV query (Q1 tables: {', '.join(sorted(q1_tables)[:10])})",
                    ai_insight=None,
                    execution_time_ms=0,
                )
                self.db.add(skip_res)
                pre_skipped.append(skip_res)

        # Flush the pre-skipped rows in one shot
        if pre_skipped:
            try:
                self.db.commit()
                for r in pre_skipped:
                    self.db.refresh(r)
            except Exception:
                self.db.rollback()

        test_queries_map = {tq.id: tq for tq in all_test_queries}

        schema_snippet = self._build_schema_snippet()

        # Run sequential for ≤ 10 tests, parallel for more
        test_queries_list = scoped_queries
        if len(test_queries_list) <= 10:
            results_list = [
                self._run_single(tq, q1_dev_sql, run_id, schema_snippet)
                for tq in test_queries_list
            ]
        else:
            results_list = self._run_parallel(test_queries_list, q1_dev_sql, run_id, schema_snippet)

        results_list = pre_skipped + results_list

        # Collect AI insights for FAIL results (first 10 only)
        suggested_fixes: list[dict] = []
        fail_count = 0
        for res in results_list:
            if res.status == "FAIL" and fail_count < 10 and self.openai_client and not res.ai_insight:
                fail_count += 1
                tq = test_queries_map.get(res.test_query_id) if res.test_query_id else None
                insight_json = _generate_ai_insight(
                    q2_type=res.query_type,
                    q2_base_sql=res.q2_base_sql or "",
                    q1_dev_wrapper=res.q1_dev_sql,
                    q1_original_sql=q1_dev_sql,
                    base_result_json=res.base_result or "[]",
                    dev_result_json=res.dev_result or "[]",
                    issue=res.issue or "",
                    schema_snippet=schema_snippet,
                    openai_client=self.openai_client,
                    db=self.db,
                    conn_id=self.conn_id,
                )
                if insight_json:
                    res.ai_insight = insight_json
                    try:
                        parsed = json.loads(insight_json)
                        fix = parsed.get("ai_suggested_fix")
                        if fix:
                            suggested_fixes.append({"test_name": res.test_name, "fix_sql": fix})
                    except Exception:
                        pass
                    try:
                        self.db.commit()
                    except Exception:
                        self.db.rollback()

        # Compute summary
        passed = sum(1 for r in results_list if r.status == "PASS")
        failed = sum(1 for r in results_list if r.status == "FAIL")
        warns = sum(1 for r in results_list if r.status == "WARN")
        errors = sum(1 for r in results_list if r.status == "ERROR")
        skipped = sum(1 for r in results_list if r.status == "SKIP")
        confidence = _compute_confidence(results_list, test_queries_map)

        return ReconciliationRunResult(
            run_id=run_id,
            conn_id=self.conn_id,
            total=len(results_list),
            passed=passed,
            failed=failed,
            warns=warns,
            errors=errors,
            skipped=skipped,
            confidence_score=confidence,
            suggested_fixes=suggested_fixes,
            results=[self._serialize_result(r) for r in results_list],
        )

    def _run_single(
        self,
        tq: TestQuery,
        q1_dev_sql: str,
        run_id: str,
        schema_snippet: str,
    ) -> ReconciliationResult:
        start_ms = int(time.time() * 1000)
        status = "SKIP"
        issue = None
        base_rows: list[dict] = []
        dev_rows: list[dict] = []
        q1_wrapper: Optional[str] = None

        try:
            # Derive Q1 (DEV) wrapper
            q1_wrapper = derive_dev_wrapper(
                tq.query_type, q1_dev_sql, tq.column_name, self.col_q, self.col_c
            )

            # Execute Q2 (BASE)
            try:
                base_rows = self._run_query(tq.sql_text, limit=200)
            except Exception as exc:
                status = "ERROR"
                issue = f"BASE query failed: {str(exc)[:400]}"
                base_rows = []

            # Execute derived Q1 (DEV) if we have a wrapper and BASE succeeded
            if q1_wrapper and status != "ERROR":
                # Pre-screen: for column-specific wrappers (distribution, agg, duplicate),
                # the column must appear as a direct (non-path) alias in Q1's output.
                # Q1 queries that alias columns as XML paths (e.g. [/Policy/Status]) won't
                # expose the raw column name to the outer GROUP BY.
                col_accessible = _column_accessible_in_q1(tq.column_name, q1_dev_sql)
                if tq.query_type in ("distribution", "agg", "duplicate") and tq.column_name and not col_accessible:
                    status = "SKIP"
                    issue = f"Column '{tq.column_name}' not accessible in Q1 DEV output (XML-path aliased)"
                else:
                    try:
                        dev_rows = self._run_query(q1_wrapper, limit=200)
                    except Exception as exc:
                        err_str = str(exc)
                        # _clean_error may return a SQL fragment instead of the actual error.
                        # Treat any column-specific wrapper failure as SKIP when column_name
                        # contains path separators or the error looks like a SQL fragment.
                        col_err = (
                            "invalid column name" in err_str.lower()
                            or "no column name" in err_str.lower()
                            or (tq.column_name and tq.query_type in ("distribution", "agg", "duplicate"))
                        )
                        if col_err:
                            status = "SKIP"
                            issue = f"Column '{tq.column_name}' not accessible in Q1 DEV output"
                        else:
                            status = "ERROR"
                            issue = f"DEV wrapper query failed: {err_str[:400]}"
                        dev_rows = []

            # Compare (only if not already resolved by BASE error or pre-screen SKIP)
            if status == "SKIP" and not issue:
                # initial sentinel — needs compare
                if q1_wrapper is None and tq.query_type not in ("set_diff",):
                    issue = f"No Q1 wrapper derivable for type '{tq.query_type}'"
                elif tq.query_type in ("set_diff",):
                    status, issue = _compare(tq.query_type, base_rows, [], tq.severity)
                else:
                    status, issue = _compare(tq.query_type, base_rows, dev_rows, tq.severity)

        except Exception as exc:
            status = "ERROR"
            issue = str(exc)[:400]

        elapsed = int(time.time() * 1000) - start_ms

        res = ReconciliationResult(
            conn_id=self.conn_id,
            run_id=run_id,
            dev_source_type=self.source_type,
            dev_source_id=self.source_id,
            test_query_id=tq.id,
            test_name=tq.name,
            query_type=tq.query_type,
            q2_base_sql=tq.sql_text,
            q1_dev_sql=q1_wrapper,
            q1_sql_snapshot=q1_dev_sql[:4000] if q1_dev_sql else None,
            status=status,
            base_result=json.dumps(base_rows[:50]) if base_rows else None,
            dev_result=json.dumps(dev_rows[:50]) if dev_rows else None,
            issue=issue,
            ai_insight=None,
            execution_time_ms=elapsed,
        )
        self.db.add(res)
        try:
            self.db.commit()
            self.db.refresh(res)
        except Exception:
            self.db.rollback()
        return res

    def _run_parallel(
        self,
        test_queries: list[TestQuery],
        q1_dev_sql: str,
        run_id: str,
        schema_snippet: str,
    ) -> list[ReconciliationResult]:
        from api.database import SessionLocal

        def run_one(tq: TestQuery) -> ReconciliationResult:
            db2 = SessionLocal()
            try:
                agent = ReconciliationAgent(
                    conn_id=self.conn_id,
                    db=db2,
                    openai_client=None,  # AI insights done in main thread after
                    source_type=self.source_type,
                    source_id=self.source_id,
                    source_sub_id=self.source_sub_id,
                    adhoc_sql=q1_dev_sql if self.source_type == "adhoc" else None,
                )
                return agent._run_single(tq, q1_dev_sql, run_id, schema_snippet)
            finally:
                db2.close()

        results_list: list[ReconciliationResult] = []
        with ThreadPoolExecutor(max_workers=4) as ex:
            futures = {ex.submit(run_one, tq): tq for tq in test_queries}
            for f in as_completed(futures):
                try:
                    results_list.append(f.result())
                except Exception as exc:
                    # Create an ERROR result for failed futures
                    tq = futures[f]
                    err_res = ReconciliationResult(
                        conn_id=self.conn_id,
                        run_id=run_id,
                        dev_source_type=self.source_type,
                        dev_source_id=self.source_id,
                        test_query_id=tq.id,
                        test_name=tq.name,
                        query_type=tq.query_type,
                        q2_base_sql=tq.sql_text,
                        status="ERROR",
                        issue=str(exc)[:400],
                    )
                    self.db.add(err_res)
                    try:
                        self.db.commit()
                        self.db.refresh(err_res)
                    except Exception:
                        self.db.rollback()
                    results_list.append(err_res)
        return results_list

    @staticmethod
    def _serialize_result(r: ReconciliationResult) -> dict:
        return {
            "id": r.id,
            "test_name": r.test_name,
            "query_type": r.query_type,
            "status": r.status,
            "issue": r.issue,
            "ai_insight": r.ai_insight,
            "execution_time_ms": r.execution_time_ms,
            "table_name": None,  # tq.table_name not loaded here — router will return full detail
        }
