"""
query_collector_agent.py — Query Collector Agent for the Dev vs Base Reconciliation Engine.

Generates Q2 (BASE) queries automatically from schema metadata:
  - count         : SELECT COUNT(*) FROM [T]           (one per table, priority=1/critical)
  - agg           : SELECT SUM([C]) FROM [T]            (numeric cols, advisory/warning)
  - distribution  : SELECT [C], COUNT(*) GROUP BY [C]   (categorical cols)
  - set_diff      : bi-directional FK orphan checks      (priority=1/critical)
  - duplicate     : PK duplication checks                (priority=1/critical)
  - join_explosion: COUNT baseline for join ratio check  (priority=1/critical)
  - filter_impact : unfiltered COUNT baseline            (priority=0/normal)
  - sample_value  : SELECT TOP 10 * for value-level spot (priority=0/normal)
  - custom        : AI-generated extras via GPT-4o-mini  (priority=0/normal, capped at 10)

All auto-generated queries for a conn_id are replaced on each run.
Manually-added queries (is_auto_generated=False) are preserved.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.orm import Session

from api.models import (
    CatalogColumn, CatalogRelation, ConversionColumnProfile,
    TestQuery, AITraceLog,
)


@dataclass
class CoverageScore:
    tables_covered: int
    tables_total: int
    fk_coverage: float
    col_coverage: float
    overall: float


@dataclass
class QueryCollectorResult:
    total_generated: int
    by_type: dict[str, int]
    errors: list[str]
    coverage: CoverageScore


# Numeric column data types (SQL Server + cross-dialect)
_NUMERIC_TYPES = {
    "int", "bigint", "smallint", "tinyint", "decimal", "numeric",
    "float", "real", "money", "smallmoney", "double", "double precision",
    "number",
}

# Data types that can be categorical
_TEXT_TYPES = {"varchar", "nvarchar", "char", "nchar", "text", "ntext"}


class QueryCollectorAgent:
    def __init__(
        self,
        conn_id: int,
        db: Session,
        openai_client=None,   # openai.OpenAI instance — None skips AI custom tests
        dialect: str = "mssql",
    ):
        self.conn_id = conn_id
        self.db = db
        self.openai_client = openai_client
        # Column quoting
        if dialect.lower() in ("postgresql", "snowflake", "mysql"):
            self.q, self.c = '"', '"'
        else:
            self.q, self.c = "[", "]"

    # ── Main entry point ──────────────────────────────────────────────────────

    def run(self) -> QueryCollectorResult:
        errors: list[str] = []
        queries: list[dict] = []

        # Load schema
        catalog_cols = (
            self.db.query(CatalogColumn)
            .filter_by(conn_id=self.conn_id)
            .order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position)
            .all()
        )
        catalog_rels = (
            self.db.query(CatalogRelation)
            .filter_by(conn_id=self.conn_id)
            .all()
        )
        profiles: dict[str, ConversionColumnProfile] = {
            f"{p.table_name}.{p.column_name}": p
            for p in self.db.query(ConversionColumnProfile)
            .filter_by(conn_id=self.conn_id)
            .all()
        }

        if not catalog_cols:
            return QueryCollectorResult(
                total_generated=0,
                by_type={},
                errors=["No schema catalog found. Run Admin → Collect Schema first."],
                coverage=CoverageScore(0, 0, 0.0, 0.0, 0.0),
            )

        # Group columns by table
        tables: dict[str, list[CatalogColumn]] = {}
        for col in catalog_cols:
            tables.setdefault(col.table_name, []).append(col)

        try:
            queries.extend(self._generate_count_queries(tables))
        except Exception as exc:
            errors.append(f"count generation failed: {exc}")

        try:
            queries.extend(self._generate_agg_queries(catalog_cols))
        except Exception as exc:
            errors.append(f"agg generation failed: {exc}")

        try:
            queries.extend(self._generate_distribution_queries(catalog_cols, profiles))
        except Exception as exc:
            errors.append(f"distribution generation failed: {exc}")

        try:
            queries.extend(self._generate_set_diff_queries(catalog_rels))
        except Exception as exc:
            errors.append(f"set_diff generation failed: {exc}")

        try:
            queries.extend(self._generate_duplicate_queries(catalog_cols))
        except Exception as exc:
            errors.append(f"duplicate generation failed: {exc}")

        try:
            queries.extend(self._generate_join_explosion_queries(tables))
        except Exception as exc:
            errors.append(f"join_explosion generation failed: {exc}")

        try:
            queries.extend(self._generate_filter_impact_queries(tables))
        except Exception as exc:
            errors.append(f"filter_impact generation failed: {exc}")

        try:
            queries.extend(self._generate_sample_value_queries(tables))
        except Exception as exc:
            errors.append(f"sample_value generation failed: {exc}")

        if self.openai_client:
            try:
                schema_snippet = self._build_schema_snippet(catalog_cols)
                existing_names = [q["name"] for q in queries]
                ai_extras = self._ai_generate_extras(schema_snippet, existing_names)
                queries.extend(ai_extras)
            except Exception as exc:
                errors.append(f"AI custom generation failed: {exc}")

        # Persist
        self._persist(queries)

        # Compute coverage
        coverage = self._compute_coverage(tables, catalog_cols, catalog_rels, queries)

        by_type: dict[str, int] = {}
        for q in queries:
            by_type[q["query_type"]] = by_type.get(q["query_type"], 0) + 1

        return QueryCollectorResult(
            total_generated=len(queries),
            by_type=by_type,
            errors=errors,
            coverage=coverage,
        )

    # ── Query generators ─────────────────────────────────────────────────────

    def _qn(self, name: str) -> str:
        """Quote an identifier."""
        return f"{self.q}{name}{self.c}"

    # ── dev_source_tag assignment rules ──────────────────────────────────────
    # NULL  = Global — runs for ALL source types (mapper, dashboard, report, etc.)
    # "mapper"    — only meaningful for Conversion Mapper (multi-table JOIN queries)
    # Future: can extend to "dashboard" / "report" for source-specific checks
    #
    # count         → global  (row counts are universal)
    # duplicate     → global  (PK integrity is universal)
    # set_diff      → global  (FK orphan checks are universal)
    # agg           → global  (advisory aggregate — universal, but WARN severity)
    # distribution  → global  (value distribution is universal)
    # sample_value  → global  (value-level spot checks are universal)
    # custom        → global  (AI-generated, default to universal)
    # join_explosion→ mapper  (row multiplication only occurs in multi-JOIN conversion queries)
    # filter_impact → mapper  (data-loss from WHERE filters only relevant to conversion queries)

    def _generate_count_queries(self, tables: dict[str, list]) -> list[dict]:
        result = []
        for table_name in tables:
            result.append({
                "query_type": "count",
                "name": f"Row Count — {table_name}",
                "sql_text": f"SELECT COUNT(*) AS _cnt FROM {self._qn(table_name)}",
                "table_name": table_name,
                "column_name": None,
                "priority": 1,
                "severity": "error",
                "dev_source_tag": None,  # global
            })
        return result

    def _generate_agg_queries(self, cols: list) -> list[dict]:
        result = []
        for col in cols:
            dtype = (col.data_type or "").lower().strip()
            if dtype in _NUMERIC_TYPES:
                result.append({
                    "query_type": "agg",
                    "name": f"SUM({col.table_name}.{col.column_name})",
                    "sql_text": (
                        f"SELECT SUM({self._qn(col.column_name)}) AS _agg "
                        f"FROM {self._qn(col.table_name)}"
                    ),
                    "table_name": col.table_name,
                    "column_name": col.column_name,
                    "priority": 0,
                    "severity": "warning",  # advisory — joins may distort aggregates
                    "dev_source_tag": None,  # global
                })
        return result

    def _generate_distribution_queries(self, cols: list, profiles: dict) -> list[dict]:
        result = []
        seen = set()
        for col in cols:
            dtype = (col.data_type or "").lower().strip()
            key = f"{col.table_name}.{col.column_name}"
            if key in seen:
                continue
            profile = profiles.get(key)
            is_categorical = False
            if profile:
                is_categorical = (
                    profile.pattern_hint == "categorical"
                    or (profile.distinct_count is not None and profile.distinct_count <= 50)
                )
            elif dtype in _TEXT_TYPES:
                is_categorical = True  # assume categorical for short text cols without profile

            if is_categorical:
                seen.add(key)
                result.append({
                    "query_type": "distribution",
                    "name": f"Distribution — {col.table_name}.{col.column_name}",
                    "sql_text": (
                        f"SELECT {self._qn(col.column_name)}, COUNT(*) AS _cnt "
                        f"FROM {self._qn(col.table_name)} "
                        f"GROUP BY {self._qn(col.column_name)}"
                    ),
                    "table_name": col.table_name,
                    "column_name": col.column_name,
                    "priority": 0,
                    "severity": "error",
                    "dev_source_tag": None,  # global
                })
        return result

    def _generate_set_diff_queries(self, rels: list) -> list[dict]:
        result = []
        for rel in rels:
            pt = rel.parent_table
            pc = rel.parent_column
            rt = rel.referenced_table
            rc = rel.referenced_column
            result.append({
                "query_type": "set_diff",
                "name": f"Orphan Check — {pt}.{pc} → {rt}.{rc}",
                "sql_text": (
                    f"SELECT {self._qn(pc)} FROM {self._qn(pt)} "
                    f"WHERE {self._qn(pc)} IS NOT NULL "
                    f"AND {self._qn(pc)} NOT IN "
                    f"(SELECT {self._qn(rc)} FROM {self._qn(rt)})"
                ),
                "table_name": pt,
                "column_name": pc,
                "priority": 1,
                "severity": "error",
                "dev_source_tag": None,  # global
            })
            result.append({
                "query_type": "set_diff",
                "name": f"Reverse Orphan — {rt}.{rc} ← {pt}",
                "sql_text": (
                    f"SELECT {self._qn(rc)} FROM {self._qn(rt)} "
                    f"WHERE {self._qn(rc)} NOT IN "
                    f"(SELECT {self._qn(pc)} FROM {self._qn(pt)})"
                ),
                "table_name": rt,
                "column_name": rc,
                "priority": 0,
                "severity": "warning",
                "dev_source_tag": None,  # global
            })
        return result

    def _generate_duplicate_queries(self, cols: list) -> list[dict]:
        result = []
        seen = set()
        for col in cols:
            if col.is_primary_key and col.table_name not in seen:
                seen.add(col.table_name)
                result.append({
                    "query_type": "duplicate",
                    "name": f"Duplicate PK — {col.table_name}.{col.column_name}",
                    "sql_text": (
                        f"SELECT {self._qn(col.column_name)}, COUNT(*) AS _dup_cnt "
                        f"FROM {self._qn(col.table_name)} "
                        f"GROUP BY {self._qn(col.column_name)} "
                        f"HAVING COUNT(*) > 1"
                    ),
                    "table_name": col.table_name,
                    "column_name": col.column_name,
                    "priority": 1,
                    "severity": "error",
                    "dev_source_tag": None,  # global
                })
        return result

    def _generate_join_explosion_queries(self, tables: dict) -> list[dict]:
        """Baseline counts to detect JOIN-induced row multiplication in Q1 (DEV).
        Tagged as 'mapper' — only Conversion Mapper produces multi-table JOINs."""
        result = []
        for table_name in list(tables.keys())[:10]:
            result.append({
                "query_type": "join_explosion",
                "name": f"Join Explosion Baseline — {table_name}",
                "sql_text": f"SELECT COUNT(*) AS _cnt FROM {self._qn(table_name)}",
                "table_name": table_name,
                "column_name": None,
                "priority": 1,
                "severity": "error",
                "dev_source_tag": "mapper",  # mapper only — JOINs only in conversion queries
            })
        return result

    def _generate_filter_impact_queries(self, tables: dict) -> list[dict]:
        """Unfiltered counts — detects data loss from WHERE filters in Q1 (DEV).
        Tagged as 'mapper' — WHERE filter data loss is specific to conversion queries."""
        result = []
        for table_name in list(tables.keys())[:5]:
            result.append({
                "query_type": "filter_impact",
                "name": f"Filter Impact Baseline — {table_name}",
                "sql_text": f"SELECT COUNT(*) AS _cnt FROM {self._qn(table_name)}",
                "table_name": table_name,
                "column_name": None,
                "priority": 0,
                "severity": "warning",
                "dev_source_tag": "mapper",  # mapper only — filter loss specific to conversion
            })
        return result

    def _generate_sample_value_queries(self, tables: dict) -> list[dict]:
        """TOP 10 * samples for value-level spot checks."""
        result = []
        for table_name in list(tables.keys())[:5]:
            if self.q == "[":
                sql = f"SELECT TOP 10 * FROM {self._qn(table_name)} ORDER BY 1"
            else:
                sql = f'SELECT * FROM {self._qn(table_name)} ORDER BY 1 LIMIT 10'
            result.append({
                "query_type": "sample_value",
                "name": f"Sample Values — {table_name}",
                "sql_text": sql,
                "table_name": table_name,
                "column_name": None,
                "priority": 0,
                "severity": "error",
                "dev_source_tag": None,  # global
            })
        return result

    def _ai_generate_extras(self, schema_snippet: str, existing_names: list[str]) -> list[dict]:
        """Call GPT-4o-mini to generate up to 10 additional custom test queries."""
        system_prompt = (
            "You are a data quality engineer. Given this database schema, generate additional "
            "SQL-based test queries that would catch data integrity issues not already covered.\n\n"
            "Return a JSON array (no markdown). Each item must have:\n"
            '  {"query_type": "custom", "name": str, "sql_text": str, '
            '"table_name": str|null, "column_name": str|null, "priority": 0|1}\n\n'
            "priority=1 for critical checks (nullability of required fields, referential integrity).\n"
            "Use T-SQL syntax (SQL Server). Limit to 10 suggestions."
        )
        user_msg = (
            f"Schema:\n{schema_snippet}\n\n"
            f"Already covered by: {', '.join(existing_names[:20])}"
        )

        start_ms = int(time.time() * 1000)
        resp = self.openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.2,
            max_tokens=2000,
        )
        elapsed = int(time.time() * 1000) - start_ms
        raw = resp.choices[0].message.content.strip()

        # Log AI call
        try:
            self.db.add(AITraceLog(
                module="reconciliation",
                conn_id=self.conn_id,
                model="gpt-4o-mini",
                prompt_text=(system_prompt[:2000] + "\n---USER---\n" + user_msg)[:4000],
                response_text=raw[:4000],
                tokens_in=getattr(resp.usage, "prompt_tokens", None),
                tokens_out=getattr(resp.usage, "completion_tokens", None),
                latency_ms=elapsed,
            ))
            self.db.flush()
        except Exception:
            pass

        # Strip markdown fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        try:
            items = json.loads(raw)
        except Exception:
            return []

        result = []
        for item in items[:10]:
            result.append({
                "query_type": "custom",
                "name": item.get("name", "Custom Test"),
                "sql_text": item.get("sql_text", ""),
                "table_name": item.get("table_name"),
                "column_name": item.get("column_name"),
                "priority": int(item.get("priority", 0)),
                "severity": "warning" if int(item.get("priority", 0)) == 0 else "error",
            })
        return result

    # ── Persistence ──────────────────────────────────────────────────────────

    def _persist(self, queries: list[dict]) -> None:
        """Delete old auto-generated rows, insert new ones. Preserve manual rows."""
        try:
            self.db.query(TestQuery).filter(
                TestQuery.conn_id == self.conn_id,
                TestQuery.is_auto_generated == True,  # noqa: E712
            ).delete(synchronize_session=False)
            self.db.flush()
        except Exception:
            self.db.rollback()

        for q in queries:
            self.db.add(TestQuery(
                conn_id=self.conn_id,
                query_type=q["query_type"],
                name=q["name"],
                sql_text=q["sql_text"],
                table_name=q.get("table_name"),
                column_name=q.get("column_name"),
                priority=q.get("priority", 0),
                severity=q.get("severity", "error"),
                is_auto_generated=True,
                dev_source_tag=q.get("dev_source_tag"),  # None=global, "mapper"=mapper-only, etc.
            ))

        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    # ── Coverage scoring ─────────────────────────────────────────────────────

    def _compute_coverage(
        self,
        tables: dict,
        all_cols: list,
        all_rels: list,
        queries: list[dict],
    ) -> CoverageScore:
        covered_tables = {q["table_name"] for q in queries if q.get("table_name")}
        total_tables = len(tables)
        t_cov = len(covered_tables) / total_tables if total_tables > 0 else 1.0

        total_rels = len(all_rels)
        covered_rels = sum(1 for q in queries if q["query_type"] == "set_diff")
        fk_cov = min(covered_rels / (total_rels * 2), 1.0) if total_rels > 0 else 1.0  # bi-directional

        numeric_or_cat = [
            c for c in all_cols
            if (c.data_type or "").lower() in (_NUMERIC_TYPES | _TEXT_TYPES)
        ]
        total_typed_cols = len(numeric_or_cat)
        covered_cols = {q["column_name"] for q in queries if q.get("column_name")}
        col_cov = len(covered_cols) / total_typed_cols if total_typed_cols > 0 else 1.0

        overall = round(0.4 * t_cov + 0.3 * fk_cov + 0.3 * col_cov, 2)
        return CoverageScore(
            tables_covered=len(covered_tables),
            tables_total=total_tables,
            fk_coverage=round(fk_cov, 2),
            col_coverage=round(col_cov, 2),
            overall=overall,
        )

    # ── Schema snippet helper ─────────────────────────────────────────────────

    def _build_schema_snippet(self, cols: list) -> str:
        tables: dict[str, list[str]] = {}
        for c in cols:
            tables.setdefault(c.table_name, []).append(
                f"{c.column_name} {c.data_type or ''}{'  PK' if c.is_primary_key else ''}"
            )
        lines = [f"{t}({', '.join(cs)})" for t, cs in tables.items()]
        return "\n".join(lines[:30])  # cap at 30 tables to stay within token budget
