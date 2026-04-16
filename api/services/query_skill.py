# ═══════════════════════════════════════════════════════════
# services/query_skill.py
# Shared query generation skill builder.
#
# Combines:
#   1. prompts/query_skill.md   — human-authored domain knowledge
#   2. Live catalog data from DB:
#        - Tables + columns (conversion_catalog_columns)
#        - FK relationships (conversion_catalog_relations)
#        - Sample values (conversion_catalog_samples)
#   3. Embedding-matched field aliases (optional):
#        - XML path → source column mapping with confidence scores
#        - Passed in for mapping context so LLM sees pre-computed aliases
#
# Used by:
#   - api/services/query_builder.py   (Mapping tab: JOIN SQL generation)
#   - api/routers/report_ai.py        (Report tab: NL→SQL generation)
#
# context parameter selects which section gets appended last:
#   "mapping" — adds Pre-matched Aliases + Mapping Query Rules
#   "report"  — adds Report Query Rules
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from api.services.pii_guard import mask_sample_row, audit_prompt

_SKILL_FILE = Path(__file__).parent.parent.parent / "prompts" / "query_skill.md"


def _load_prompt_template(db, category: str, conn_id: int | None = None) -> str:
    """Return the active prompt template content for a category, with placeholders resolved."""
    try:
        from api.models import PromptTemplate
        tmpl = (
            db.query(PromptTemplate)
            .filter(PromptTemplate.category == category, PromptTemplate.is_active == True)  # noqa: E712
            .first()
        )
        if not tmpl:
            return ""
        content = (tmpl.content or "").strip()
        if content and conn_id:
            try:
                from api.services.context_cache import get_or_build
                from api.services.ai_engine import resolve_template_placeholders
                ctx = get_or_build(conn_id, db)
                content = resolve_template_placeholders(content, ctx)
            except Exception:
                pass
        return content
    except Exception:
        return ""


def _load_query_examples(db, conn_id: int) -> str:
    """Return a formatted few-shot SQL examples block, or empty string."""
    try:
        from api.models import QueryExample
        rows = (
            db.query(QueryExample)
            .filter(
                QueryExample.is_active == True,  # noqa: E712
                (QueryExample.conn_id == conn_id) | (QueryExample.conn_id == None),  # noqa: E711
            )
            .order_by(QueryExample.id.asc())
            .limit(20)
            .all()
        )
        if not rows:
            return ""
        lines = ["\n---\n\n## SQL Query Examples\n"]
        for ex in rows:
            lines.append(f"\n### {ex.name}" + (f"\n{ex.description}" if ex.description else ""))
            if ex.tables_used:
                lines.append(f"Tables: {ex.tables_used}")
            lines.append(f"```sql\n{ex.example_sql.strip()}\n```")
        return "\n".join(lines)
    except Exception:
        return ""


def build_skill_prompt(
    conn_id: int,
    db,                                    # SQLAlchemy Session
    dialect: str = "mssql",
    context: str = "mapping",             # "mapping" | "report"
    matched_cols: list | None = None,     # [{table_name, column_name, ...}, ...]
    match_scores: list | None = None,     # [float, ...]  parallel to matched_cols
    paths: list | None = None,            # [xml_path_str, ...] parallel to matched_cols
) -> str:
    """
    Build a fully-enriched system prompt for SQL generation.

    Returns a string combining:
      - the editable query_skill.md domain knowledge
      - live schema: tables, columns, data types
      - FK relationships discovered from catalog
      - sample row values per table
    """
    # ── 1. Load human-authored skill file ────────────────────
    try:
        base = _SKILL_FILE.read_text(encoding="utf-8") if _SKILL_FILE.exists() else ""
    except Exception:
        base = ""

    # ── 2. Load catalog data ──────────────────────────────────
    from api.models import CatalogColumn, CatalogRelation, CatalogSample, SchemaMetadata

    columns   = db.query(CatalogColumn).filter_by(conn_id=conn_id).order_by(
        CatalogColumn.table_name, CatalogColumn.ordinal_position
    ).all()
    relations = db.query(CatalogRelation).filter_by(conn_id=conn_id).all()
    samples   = db.query(CatalogSample).filter_by(conn_id=conn_id).all()

    # Load schema metadata (user-edited descriptions, aliases, business context)
    meta_rows = db.query(SchemaMetadata).filter_by(conn_id=conn_id).all()
    # Index: (table_name, column_name_or_None) → SchemaMetadata
    _meta_idx: dict[tuple, SchemaMetadata] = {
        (m.table_name, m.column_name): m for m in meta_rows
    }

    # Auto-synonym rules (mirrors JS logic)
    def _auto_synonyms(col_name: str) -> list[str]:
        up  = col_name.upper()
        syn: list[str] = []
        if "DOB"  in up: syn += ["date of birth", "birthdate"]
        if "ID"   in up: syn += ["identifier"]
        if "NAME" in up: syn += ["name", "full name"]
        return syn

    # ── 3. Build schema block ─────────────────────────────────
    db_label = {
        "mssql":      "SQL Server (T-SQL)",
        "postgresql": "PostgreSQL",
        "mysql":      "MySQL",
        "sqlite":     "SQLite",
        "snowflake":  "Snowflake (SQL)",
    }.get(dialect.lower(), dialect.upper())

    schema_lines: list[str] = [
        f"\n---\n\n## Live Schema  ({db_label})\n",
        "<!-- Auto-generated at runtime from schema catalog + user metadata — do not edit -->\n",
    ]

    # Group columns by table
    tables: dict[str, list] = {}
    for col in columns:
        key = f"{col.table_schema or 'dbo'}.{col.table_name}"
        tables.setdefault(key, []).append(col)

    for tbl_key, cols in tables.items():
        # Table-level metadata
        tbl_name = cols[0].table_name
        tbl_meta = _meta_idx.get((tbl_name, None))
        tbl_desc = (tbl_meta.description if tbl_meta else None) or ""
        tbl_alias = (tbl_meta.aliases if tbl_meta else None) or ""

        header = f"\n### {tbl_key}"
        if tbl_desc:
            header += f"  — {tbl_desc}"
        if tbl_alias:
            header += f"  *(also known as: {tbl_alias})*"
        schema_lines.append(header)

        for col in cols:
            pk_flag  = " 🔑" if col.is_primary_key else ""
            nullable = " nullable" if col.is_nullable == "YES" else ""
            col_meta = _meta_idx.get((tbl_name, col.column_name))
            col_desc  = (col_meta.description if col_meta else None) or ""
            col_alias = (col_meta.aliases if col_meta else None) or ""
            # Build synonyms list: auto + user-defined aliases
            synonyms  = _auto_synonyms(col.column_name)
            for a in col_alias.split(","):
                a = a.strip()
                if a and a not in synonyms:
                    synonyms.append(a)
            extras: list[str] = []
            if col_desc:
                extras.append(f'desc="{col_desc}"')
            if synonyms:
                extras.append(f'synonyms=[{", ".join(synonyms)}]')
            extras_str = "  " + "; ".join(extras) if extras else ""
            schema_lines.append(
                f"- `{col.column_name}` ({col.data_type or 'unknown'}{nullable}){pk_flag}{extras_str}"
            )

    # ── 4. Build FK relationships block ──────────────────────
    if relations:
        schema_lines.append("\n---\n\n## Discovered FK Relationships\n")
        for r in relations:
            schema_lines.append(
                f"- `{r.parent_table}.{r.parent_column}` "
                f"→ `{r.referenced_table}.{r.referenced_column}`"
            )

    # ── 5. Build sample values block ─────────────────────────
    if samples:
        schema_lines.append("\n---\n\n## Sample Data\n")
        for s in samples:
            if not s.sample_json:
                continue
            try:
                rows = json.loads(s.sample_json)
                if not rows:
                    continue
                schema_lines.append(f"\n**{s.table_schema or 'dbo'}.{s.table_name}**")
                # Show first sample row as key: value pairs (PII masked)
                first = rows[0] if isinstance(rows, list) else {}
                if isinstance(first, dict):
                    safe_first = mask_sample_row(first)
                    preview = ", ".join(
                        f"`{k}` = `{safe_first[k]}`"
                        for k in list(safe_first)[:6]
                        if safe_first[k] not in (None, "None", "")
                    )
                    if preview:
                        schema_lines.append(f"Example row: {preview}")
                if len(rows) > 1 and isinstance(rows[1], dict):
                    safe_second = mask_sample_row(rows[1])
                    preview2 = ", ".join(
                        f"`{k}` = `{safe_second[k]}`"
                        for k in list(safe_second)[:6]
                        if safe_second[k] not in (None, "None", "")
                    )
                    if preview2:
                        schema_lines.append(f"Example row: {preview2}")
            except Exception:
                continue

    # ── 6. Embedding-matched field aliases (mapping context only) ─
    if context == "mapping" and matched_cols and paths:
        scores = match_scores or ([0.0] * len(matched_cols))
        alias_lines: list[str] = []
        for xml_path, col, score in zip(paths, matched_cols, scores):
            if col is None:
                continue
            pct = round((score or 0) * 100)
            alias_lines.append(
                f"- `{col['table_name']}.{col['column_name']}` "
                f"→ XML path `{xml_path}` (confidence {pct}%)"
            )
        if alias_lines:
            schema_lines.append(
                "\n---\n\n## Embedding-Matched Field Aliases\n\n"
                "These column → XML path mappings were pre-computed via semantic embedding similarity.\n"
                "Use them as the SELECT aliases in the generated SQL.\n"
            )
            schema_lines.extend(alias_lines)

    # ── 7. Append context-specific instruction ────────────────
    if context == "mapping":
        schema_lines.append(
            "\n---\n\n## Task: Mapping Query\n\n"
            "Generate a SQL SELECT that extracts ALL data needed to populate the XML template.\n"
            "- Use LEFT JOINs following the FK relationships above.\n"
            "- Alias every SELECT column to its XML target path (from the matched aliases above).\n"
            "- Include the __identifier__ column as the first SELECT item.\n"
            "- Keep all existing SELECT aliases exactly as-is.\n"
            "- Return ONLY the final SQL — no explanation, no markdown.\n"
        )
    else:  # report
        schema_lines.append(
            "\n---\n\n## Task: Report Query\n\n"
            f"You are a {db_label} SQL expert.\n"
            "Write a single SQL SELECT that answers the user's question.\n"
            "- Use ONLY the tables and columns listed in the schema above.\n"
            "- Apply any business rules from this document.\n"
            "- Return ONLY the raw SQL statement — no explanation, no markdown.\n"
        )

    schema_block = "\n".join(schema_lines)

    # ── 8. Append prompt template override (report or mapping category) ──────
    tmpl_category = "report" if context == "report" else "mapping"
    template_override = _load_prompt_template(db, tmpl_category, conn_id=conn_id)
    template_block = f"\n\n---\n\n## Admin Instructions\n\n{template_override}" if template_override else ""

    # ── 9. Append query examples ──────────────────────────────────────────────
    examples_block = _load_query_examples(db, conn_id)

    prompt = (base + "\n" + schema_block + template_block + examples_block).strip()
    return audit_prompt(prompt)
