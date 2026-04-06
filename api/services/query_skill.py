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
    from api.models import CatalogColumn, CatalogRelation, CatalogSample

    columns   = db.query(CatalogColumn).filter_by(conn_id=conn_id).order_by(
        CatalogColumn.table_name, CatalogColumn.ordinal_position
    ).all()
    relations = db.query(CatalogRelation).filter_by(conn_id=conn_id).all()
    samples   = db.query(CatalogSample).filter_by(conn_id=conn_id).all()

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
        "<!-- Auto-generated at runtime from schema catalog — do not edit -->\n",
    ]

    # Group columns by table
    tables: dict[str, list] = {}
    for col in columns:
        key = f"{col.table_schema or 'dbo'}.{col.table_name}"
        tables.setdefault(key, []).append(col)

    for tbl_key, cols in tables.items():
        schema_lines.append(f"\n### {tbl_key}")
        for col in cols:
            pk_flag  = " 🔑" if col.is_primary_key else ""
            nullable = " nullable" if col.is_nullable == "YES" else ""
            schema_lines.append(
                f"- `{col.column_name}` ({col.data_type or 'unknown'}{nullable}){pk_flag}"
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
    prompt = (base + "\n" + schema_block).strip()
    return audit_prompt(prompt)
