"""
mapper_agent.py — Mapper Agent for the agent-based conversion pipeline.

Responsibilities:
  1. Run embedding + name-based column matching (via matching.run_matching)
  2. Inject data profiles into the match context
  3. Detect categorical columns and inject value mapping CASE expressions
  4. Build JOIN-aware SQL via query_builder.build_join_query
  5. Build MappingContext (sql_case_expressions, python_lookups, column_lineage,
     join_paths, field_confidence)
  6. Persist SQL to GeneratedQuery (keeps existing Mapping tab working)
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from api.services.matching import run_matching
from api.services.profiler import get_cached_profiles
from api.services.value_mapper import (
    MappingContext,
    suggest_mappings,
    save_mappings,
    get_approved_mappings,
    build_sql_expression,
    build_python_lookup,
)
from api.services.query_builder import build_join_query
from api.models import GeneratedQuery, SourceConnection, Mapping, MappingRow


@dataclass
class MapperResult:
    status: str                    # "success" | "failed"
    sql: Optional[str]
    row_data: list[dict]
    identifier_column: Optional[str]
    identifier_table: Optional[str]
    main_table: Optional[str]
    confidence_summary: dict       # avg_confidence, low_confidence_paths, unmatched_count, categorical_columns_mapped
    mapping_context: Optional[MappingContext]
    errors: list[str] = field(default_factory=list)


class MapperAgent:
    def __init__(
        self,
        conn_id: int,
        db: Session,
        hints: Optional[list[str]] = None,
    ):
        self.conn_id = conn_id
        self.db = db
        self.hints = hints or []

    def run(self) -> MapperResult:
        errors: list[str] = []

        # ── 1. Run embedding + name matching ─────────────────────
        try:
            m = run_matching(self.conn_id, self.db, hints=self.hints)
        except Exception as exc:
            return MapperResult(
                status="failed", sql=None, row_data=[], identifier_column=None,
                identifier_table=None, main_table=None,
                confidence_summary={}, mapping_context=None, errors=[str(exc)],
            )

        paths        = m["paths"]
        matched_cols = m["matched_cols"]
        match_scores = m["match_scores"]
        emb_data     = m["emb_data"]
        dialect      = m["dialect"]

        # ── 2. Inject profile data ────────────────────────────────
        profiles = get_cached_profiles(self.conn_id, self.db)
        m["profiles"] = profiles

        # ── 3. Value mapping injection for categorical columns ────
        mapping_context = MappingContext()

        # Build column_lineage and field_confidence from matching results
        for path, col, score in zip(paths, matched_cols, match_scores):
            if col:
                mapping_context.column_lineage[path] = f"{col['table_name']}.{col['column_name']}"
            mapping_context.field_confidence[path] = score

        # Get connection config for distinct value queries
        src: Optional[SourceConnection] = m.get("src")
        cfg = self._build_cfg(src) if src else None
        client = m.get("client")

        categorical_columns_mapped = 0
        categorical_select_replacements: dict[str, str] = {}
        # {original_col_ref → new_case_expression}

        if cfg:
            seen_cols: set[tuple] = set()
            for path, col, score in zip(paths, matched_cols, match_scores):
                if not col:
                    continue
                tbl = col["table_name"]
                cname = col["column_name"]
                key = (tbl, cname)
                if key in seen_cols:
                    continue
                seen_cols.add(key)

                profile_key = f"{tbl}.{cname}"
                profile = profiles.get(profile_key, {})
                if profile.get("pattern_hint") != "categorical":
                    continue

                # Fetch distinct values
                try:
                    distinct_vals = self._fetch_distinct_values(tbl, cname, cfg, dialect)
                except Exception:
                    continue

                if not distinct_vals:
                    continue

                # Suggest + save mappings
                try:
                    suggestions = suggest_mappings(
                        self.conn_id, tbl, cname, distinct_vals, self.db, client
                    )
                    if suggestions:
                        save_mappings(self.conn_id, tbl, cname, suggestions, self.db)
                except Exception:
                    continue

                # Build SQL expression for approved mappings
                approved = get_approved_mappings(self.conn_id, tbl, cname, self.db)
                if not approved:
                    continue

                if len(approved) < 10:
                    case_expr = build_sql_expression(
                        col_alias=f"t0",  # placeholder alias; query_builder uses proper aliases
                        table_name=tbl,
                        column_name=cname,
                        mappings=approved,
                        dialect=dialect,
                    )
                    if case_expr:
                        mapping_context.sql_case_expressions[path] = case_expr
                        categorical_columns_mapped += 1
                else:
                    # Use Python post-processing for large mapping sets
                    lookup = build_python_lookup(approved)
                    if lookup:
                        mapping_context.python_lookups[(tbl, cname)] = lookup
                        categorical_columns_mapped += 1

        # ── 4. Build JOIN-aware SQL ───────────────────────────────
        hint_block = ""
        if self.hints:
            hint_block = "\n\nAdditional user instructions:\n" + \
                         "\n".join(f"- {h}" for h in self.hints)

        try:
            sql, row_data, join_tuples = build_join_query(m, extra_instructions=hint_block)
            if not sql:
                # Fall back to flat SQL builder
                sql, row_data = self._build_flat_sql(m)
                join_tuples = []
                # Apply LLM review with hints on flat SQL when user provided instructions
                if sql and hint_block:
                    try:
                        reviewed = self._apply_hints_to_sql(sql, hint_block, m.get("client"))
                        if reviewed:
                            sql = reviewed
                    except Exception:
                        pass
        except Exception as exc:
            errors.append(f"SQL build failed: {exc}")
            return MapperResult(
                status="failed", sql=None, row_data=[], identifier_column=None,
                identifier_table=None, main_table=None,
                confidence_summary={}, mapping_context=mapping_context, errors=errors,
            )

        mapping_context.join_paths = join_tuples

        # ── 5. Compute confidence summary ─────────────────────────
        non_null_scores = [s for s, c in zip(match_scores, matched_cols) if c is not None]
        avg_conf = (sum(non_null_scores) / len(non_null_scores) * 100) if non_null_scores else 0.0
        low_conf = [
            (path, round(score * 100))
            for path, col, score in zip(paths, matched_cols, match_scores)
            if col and score < 0.4
        ]
        confidence_summary = {
            "avg_confidence": round(avg_conf, 1),
            "low_confidence_paths": low_conf,
            "unmatched_count": sum(1 for c in matched_cols if c is None),
            "categorical_columns_mapped": categorical_columns_mapped,
        }

        # ── 6. Persist SQL to GeneratedQuery + Mapping ───────────
        if sql:
            self._persist_sql(sql, m, mapping_context)

        return MapperResult(
            status="success",
            sql=sql,
            row_data=row_data,
            identifier_column=m.get("identifier_column"),
            identifier_table=m.get("identifier_table"),
            main_table=m.get("main_table"),
            confidence_summary=confidence_summary,
            mapping_context=mapping_context,
            errors=errors,
        )

    # ── Helpers ───────────────────────────────────────────────────

    def _build_cfg(self, src: SourceConnection) -> dict:
        from api.services.encryption import decrypt
        return {
            "source_type": src.source_type,
            "dialect":     src.dialect,
            "host":        src.host,
            "port":        src.port,
            "database":    src.database_name,
            "schema":      src.schema_name,
            "username":    src.username,
            "password":    decrypt(src.password_enc) if src.password_enc else "",
        }

    def _fetch_distinct_values(
        self, table_name: str, column_name: str, cfg: dict, dialect: str
    ) -> list[str]:
        from api.services.connector import preview_data
        if dialect in ("snowflake", "postgresql", "mysql"):
            q = f'SELECT DISTINCT "{column_name}" FROM "{table_name}" LIMIT 50'
        else:
            q = f"SELECT DISTINCT TOP 50 [{column_name}] FROM [{table_name}] WITH (NOLOCK)"
        result = preview_data({**cfg, "query": q}, limit=50)
        vals = [str(row[0]) for row in result.get("rows", []) if row and row[0] is not None]
        return vals

    def _build_flat_sql(self, m: dict) -> tuple[str, list[dict]]:
        """Minimal flat SQL builder used when query_builder returns nothing."""
        from api.routers.mapping_ai import _build_sql
        return _build_sql(m)

    def _apply_hints_to_sql(self, sql: str, hint_block: str, client) -> Optional[str]:
        """Run a lightweight LLM pass to apply user hints to a flat SQL query."""
        if client is None:
            return None
        import re as _re
        user_msg = (
            "You are refining a SQL query for a data conversion pipeline.\n\n"
            "Rules:\n"
            "1. Keep every SELECT column alias exactly as-is.\n"
            "2. Do NOT add or remove SELECT columns.\n"
            "3. Return ONLY the final SQL — no explanation, no markdown fences.\n"
            + hint_block
            + "\n\nSQL to refine:\n" + sql
        )
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": user_msg}],
            temperature=0,
            max_tokens=2048,
        )
        raw = resp.choices[0].message.content.strip()
        cleaned = _re.sub(r"^```(?:sql)?\n?", "", raw, flags=_re.IGNORECASE)
        cleaned = _re.sub(r"\n?```$", "", cleaned).strip()
        return cleaned if cleaned else None

    def _persist_sql(self, sql: str, m: dict, mapping_context=None) -> None:
        """
        Upsert the generated SQL into GeneratedQuery AND upsert the active Mapping
        record (with identifier_column / identifier_table + MappingRow entries).
        This ensures generate_all_xml can find the identifier and the UI can show mappings.
        """
        tpl = m.get("tpl")
        identifier_column = m.get("identifier_column")
        identifier_table  = m.get("identifier_table")

        # ── 1. Upsert GeneratedQuery ──────────────────────────────
        existing_gq = (
            self.db.query(GeneratedQuery)
            .filter_by(conn_id=self.conn_id)
            .order_by(GeneratedQuery.id.desc())
            .first()
        )
        if existing_gq:
            existing_gq.query_sql    = sql
            existing_gq.generated_by = "ai_agent"
            existing_gq.updated_at   = datetime.utcnow()
        else:
            existing_gq = GeneratedQuery(
                conn_id=self.conn_id,
                template_id=tpl.id if tpl else None,
                query_sql=sql,
                generated_by="ai_agent",
            )
            self.db.add(existing_gq)
        self.db.flush()

        # ── 2. Upsert active Mapping (identifier + version info) ──
        existing_mapping = (
            self.db.query(Mapping)
            .filter_by(conn_id=self.conn_id, is_active=True)
            .order_by(Mapping.id.desc())
            .first()
        )
        if existing_mapping:
            existing_mapping.identifier_column = identifier_column
            existing_mapping.identifier_table  = identifier_table
            mapping_id = existing_mapping.id
        else:
            new_mapping = Mapping(
                conn_id=self.conn_id,
                template_id=tpl.id if tpl else None,
                identifier_column=identifier_column,
                identifier_table=identifier_table,
                is_active=True,
            )
            self.db.add(new_mapping)
            self.db.flush()
            mapping_id = new_mapping.id

        # ── 3. Replace MappingRow entries from column_lineage ─────
        if mapping_context and mapping_context.column_lineage:
            self.db.query(MappingRow).filter_by(mapping_id=mapping_id).delete()
            for order, (xml_path, source_ref) in enumerate(mapping_context.column_lineage.items()):
                # source_ref is "table_name.column_name"
                parts = source_ref.split(".", 1)
                src_table = parts[0] if len(parts) == 2 else ""
                src_col   = parts[1] if len(parts) == 2 else source_ref
                confidence_pct = int(
                    (mapping_context.field_confidence.get(xml_path, 0.0)) * 100
                )
                self.db.add(MappingRow(
                    mapping_id=mapping_id,
                    source_sheet=src_table,
                    source_column=src_col,
                    target_path=xml_path,
                    formula=f"{{{src_col}}}",
                    confidence=confidence_pct,
                    sort_order=order,
                ))

        self.db.commit()
