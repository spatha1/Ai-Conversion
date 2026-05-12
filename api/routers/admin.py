# ═══════════════════════════════════════════════════════════
# routers/admin.py
#
# Admin Panel — Schema Discovery with SSE streaming
#
# Endpoints:
#   POST   /api/admin/discover/{conn_id}   — stream schema discovery
#   GET    /api/admin/catalog/{conn_id}    — fetch stored catalog
#   DELETE /api/admin/catalog/{conn_id}    — clear stored catalog
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

import json
from datetime import date, datetime, time
from decimal import Decimal
from typing import Generator, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from pydantic import BaseModel

from api.database import get_db
from api.models import (
    SourceConnection,
    CatalogColumn, CatalogRelation, CatalogView, CatalogSample,
    ColumnEmbedding, SchemaMetadata,
    EnrichSession, EnrichMessage,
)
from api.routers.connections import _to_cfg_from_model
from api.config import settings

from api.dependencies import require_admin

router = APIRouter(dependencies=[Depends(require_admin)])


# ══════════════════════════════════════════════════════════════
# OpenAI key status  —  GET /api/admin/openai-key-status
# ══════════════════════════════════════════════════════════════

@router.get("/admin/openai-key-status")
def openai_key_status():
    key = settings.OPENAI_API_KEY.strip()
    if key:
        preview = key[:7] + "…" + key[-4:] if len(key) > 11 else "configured"
        return {"configured": True, "preview": preview}
    return {"configured": False, "preview": ""}


@router.get("/admin/openai-key")
def get_openai_key():
    """Return the OpenAI API key from .env so the UI can pre-fill it."""
    key = settings.OPENAI_API_KEY.strip()
    return {"api_key": key}


# ══════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════

def _sse(type_: str, msg: str, extra: dict | None = None) -> str:
    payload: dict = {"type": type_, "msg": msg}
    if extra:
        payload.update(extra)
    return f"data: {json.dumps(payload)}\n\n"


def _serialize(v):
    if isinstance(v, (datetime, date, time)):
        return str(v)
    if isinstance(v, Decimal):
        return float(v)
    if v is None:
        return None
    if not isinstance(v, (int, float, bool, str)):
        return str(v)
    return v


def _clear_catalog(conn_id: int, db: Session):
    db.query(CatalogColumn).filter(CatalogColumn.conn_id   == conn_id).delete()
    db.query(CatalogRelation).filter(CatalogRelation.conn_id == conn_id).delete()
    db.query(CatalogView).filter(CatalogView.conn_id        == conn_id).delete()
    db.query(CatalogSample).filter(CatalogSample.conn_id   == conn_id).delete()
    db.commit()


# ══════════════════════════════════════════════════════════════
# Filter helpers
# ══════════════════════════════════════════════════════════════

def _passes_filter(schema: str | None, name: str,
                   include_schemas: list[str],
                   include_pats: list[str],
                   exclude_pats: list[str]) -> bool:
    """Return True if the object should be collected given the active filters."""
    import fnmatch
    if include_schemas:
        if (schema or "").lower() not in {s.strip().lower() for s in include_schemas if s.strip()}:
            return False
    if include_pats:
        if not any(fnmatch.fnmatch(name.lower(), p.strip().lower())
                   for p in include_pats if p.strip()):
            return False
    if exclude_pats:
        if any(fnmatch.fnmatch(name.lower(), p.strip().lower())
               for p in exclude_pats if p.strip()):
            return False
    return True


# ══════════════════════════════════════════════════════════════
# Discovery generators  (one per dialect family)
# ══════════════════════════════════════════════════════════════

def _discover_mssql(conn_id: int, engine, db: Session,
                    existing_col_keys: set | None = None,
                    existing_sample_tables: set | None = None,
                    include_schemas: list[str] | None = None,
                    include_tables:  list[str] | None = None,
                    exclude_tables:  list[str] | None = None,
                    include_views:   bool = True) -> Generator[str, None, None]:
    delta = existing_col_keys is not None
    include_schemas = include_schemas or []
    include_tables  = include_tables  or []
    exclude_tables  = exclude_tables  or []
    col_count = skipped_col_count = rel_count = view_count = sample_count = 0

    with engine.connect() as src:
        from sqlalchemy import text as _text

        # ── 1. Tables ─────────────────────────────────────────
        if not delta:
            yield _sse("info", "📋 Collecting tables…")
        tables_rows = src.execute(__import__("sqlalchemy").text(
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE "
            "FROM INFORMATION_SCHEMA.TABLES "
            "ORDER BY TABLE_SCHEMA, TABLE_NAME"
        )).fetchall()
        base_tables   = [r for r in tables_rows if r.TABLE_TYPE == "BASE TABLE"]
        view_table_rows = [r for r in tables_rows if r.TABLE_TYPE == "VIEW"]
        # Apply table filters
        if include_schemas or include_tables or exclude_tables:
            base_tables = [r for r in base_tables
                           if _passes_filter(r.TABLE_SCHEMA, r.TABLE_NAME,
                                             include_schemas, include_tables, exclude_tables)]
        allowed_table_keys = {(r.TABLE_SCHEMA, r.TABLE_NAME) for r in base_tables}
        if not delta:
            filter_note = f" (filtered)" if (include_schemas or include_tables or exclude_tables) else ""
            yield _sse("success",
                f"✓ Found {len(base_tables)} tables + {len(view_table_rows)} views{filter_note}",
                {"tables": len(base_tables), "views": len(view_table_rows)})

        # ── 2. Columns + PKs ──────────────────────────────────
        if not delta:
            yield _sse("info", "🔍 Collecting columns and primary keys…")
        cols_rows = src.execute(_text("""
            SELECT
                c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME,
                c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH,
                c.IS_NULLABLE, c.ORDINAL_POSITION,
                CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN (
                SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                    AND tc.TABLE_SCHEMA   = kcu.TABLE_SCHEMA
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            ) pk ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA
                AND c.TABLE_NAME   = pk.TABLE_NAME
                AND c.COLUMN_NAME  = pk.COLUMN_NAME
            ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
        """)).fetchall()

        for row in cols_rows:
            # Skip columns outside the filtered table set
            if (row.TABLE_SCHEMA, row.TABLE_NAME) not in allowed_table_keys:
                continue
            col_key = (row.TABLE_SCHEMA, row.TABLE_NAME, row.COLUMN_NAME)
            if existing_col_keys is not None and col_key in existing_col_keys:
                skipped_col_count += 1
                col_count += 1
                continue
            db.add(CatalogColumn(
                conn_id          = conn_id,
                table_schema     = row.TABLE_SCHEMA,
                table_name       = row.TABLE_NAME,
                column_name      = row.COLUMN_NAME,
                data_type        = row.DATA_TYPE,
                max_length       = row.CHARACTER_MAXIMUM_LENGTH,
                is_nullable      = row.IS_NULLABLE,
                is_primary_key   = bool(row.IS_PK),
                ordinal_position = row.ORDINAL_POSITION,
            ))
            col_count += 1
        db.commit()
        new_cols = col_count - skipped_col_count
        if not delta:
            yield _sse("success", f"✓ Saved {col_count} columns", {"col_count": col_count})

        # ── 3. Foreign-key relations ───────────────────────────
        if not delta:
            yield _sse("info", "🔗 Collecting foreign key relationships…")
        existing_fk_names: set[str] = set()
        if delta:
            existing_fk_names = {
                r.fk_name for r in
                db.query(CatalogRelation.fk_name)
                  .filter(CatalogRelation.conn_id == conn_id,
                          CatalogRelation.fk_name.isnot(None))
                  .all()
                if r.fk_name
            }
        try:
            rels_rows = src.execute(_text("""
                SELECT
                    fk.name                                   AS fk_name,
                    OBJECT_NAME(fk.parent_object_id)         AS parent_table,
                    cp.name                                   AS parent_column,
                    OBJECT_NAME(fk.referenced_object_id)     AS referenced_table,
                    cr.name                                   AS referenced_column
                FROM sys.foreign_keys fk
                JOIN sys.foreign_key_columns fkc
                    ON fkc.constraint_object_id = fk.object_id
                JOIN sys.columns cp
                    ON fkc.parent_column_id   = cp.column_id
                    AND fkc.parent_object_id  = cp.object_id
                JOIN sys.columns cr
                    ON fkc.referenced_column_id  = cr.column_id
                    AND fkc.referenced_object_id = cr.object_id
                ORDER BY fk.name
            """)).fetchall()
            for row in rels_rows:
                if row.fk_name in existing_fk_names:
                    continue
                db.add(CatalogRelation(
                    conn_id           = conn_id,
                    fk_name           = row.fk_name,
                    parent_table      = row.parent_table,
                    parent_column     = row.parent_column,
                    referenced_table  = row.referenced_table,
                    referenced_column = row.referenced_column,
                ))
                rel_count += 1
            db.commit()
            if not delta:
                yield _sse("success", f"✓ Found {rel_count} FK relationships",
                           {"rel_count": rel_count})
        except Exception as exc:
            yield _sse("warn", f"⚠ Relations skipped: {str(exc)[:120]}")

        # ── 4. View definitions ────────────────────────────────
        if not include_views:
            if not delta:
                yield _sse("info", "👁 Views skipped (include_views=false)")
        else:
            if not delta:
                yield _sse("info", "👁 Collecting view definitions…")
            try:
                views_rows = src.execute(_text(
                    "SELECT TABLE_SCHEMA, TABLE_NAME AS view_name, VIEW_DEFINITION "
                    "FROM INFORMATION_SCHEMA.VIEWS ORDER BY TABLE_NAME"
                )).fetchall()
                for row in views_rows:
                    if include_schemas and (row.TABLE_SCHEMA or "").lower() not in \
                            {s.strip().lower() for s in include_schemas if s.strip()}:
                        continue
                    db.add(CatalogView(
                        conn_id         = conn_id,
                        view_schema     = row.TABLE_SCHEMA,
                        view_name       = row.view_name,
                        view_definition = row.VIEW_DEFINITION,
                    ))
                    allowed_table_keys.add((row.TABLE_SCHEMA, row.view_name))
                    view_count += 1
                db.commit()
                if not delta:
                    yield _sse("success", f"✓ Captured {view_count} view definitions (columns will be collected)",
                               {"view_count": view_count})
            except Exception as exc:
                yield _sse("warn", f"⚠ Views skipped: {str(exc)[:120]}")

        # ── 5. Sample rows (TOP 3 per table) ──────────────────
        tables_to_sample = [
            t for t in base_tables
            if existing_sample_tables is None or t.TABLE_NAME not in existing_sample_tables
        ]
        if not delta:
            yield _sse("info", f"📊 Sampling {len(tables_to_sample)} tables…")
        elif tables_to_sample:
            yield _sse("info", f"📊 Sampling {len(tables_to_sample)} new tables…")
        for i, tbl in enumerate(tables_to_sample):
            schema = tbl.TABLE_SCHEMA or "dbo"
            name   = tbl.TABLE_NAME
            yield _sse("progress",
                f"  [{i+1}/{len(tables_to_sample)}] [{schema}].[{name}]",
                {"step": i + 1, "total": len(tables_to_sample)})
            try:
                cnt = src.execute(_text(
                    f"SELECT COUNT(*) FROM [{schema}].[{name}]"
                )).scalar()
                sample_rows = src.execute(_text(
                    f"SELECT TOP 3 * FROM [{schema}].[{name}]"
                )).fetchall()
                cols_names = list(src.execute(_text(
                    f"SELECT TOP 0 * FROM [{schema}].[{name}]"
                )).keys())
                rows_json = [
                    {k: _serialize(v) for k, v in zip(cols_names, row)}
                    for row in sample_rows
                ]
                db.add(CatalogSample(
                    conn_id      = conn_id,
                    table_schema = schema,
                    table_name   = name,
                    row_count    = cnt,
                    sample_json  = json.dumps(rows_json),
                ))
                sample_count += 1
            except Exception as exc:
                yield _sse("warn", f"  ⚠ {name}: {str(exc)[:100]}")
        db.commit()
        if not delta:
            yield _sse("success", f"✓ Sampled {sample_count} tables",
                       {"sample_count": sample_count})

    # Invalidate context cache so next AI call gets fresh schema
    from api.services.context_cache import invalidate as _ctx_inv
    try:
        _ctx_inv(conn_id)
    except Exception:
        pass

    if delta:
        if new_cols == 0 and sample_count == 0 and rel_count == 0:
            yield _sse("done", "✓ Nothing new — catalog is already up to date.",
                       {"tables": len(base_tables), "col_count": col_count,
                        "rel_count": 0, "view_count": view_count, "sample_count": 0})
        else:
            parts = []
            if new_cols:     parts.append(f"{new_cols} new columns")
            if sample_count: parts.append(f"{sample_count} new tables sampled")
            if rel_count:    parts.append(f"{rel_count} FK relations refreshed")
            yield _sse("done", f"✓ Delta sync complete — {', '.join(parts)}",
                       {"tables": len(base_tables), "col_count": col_count,
                        "rel_count": rel_count, "view_count": view_count,
                        "sample_count": sample_count})
    else:
        yield _sse("done",
            f"🎉 Discovery complete — "
            f"{len(base_tables)} tables · {col_count} columns · "
            f"{rel_count} relations · {view_count} views",
            {"tables": len(base_tables), "col_count": col_count,
             "rel_count": rel_count, "view_count": view_count,
             "sample_count": sample_count})


def _discover_snowflake(conn_id: int, cfg: dict, db: Session,
                        existing_col_keys: set | None = None,
                        existing_sample_tables: set | None = None,
                        include_schemas: list[str] | None = None,
                        include_tables:  list[str] | None = None,
                        exclude_tables:  list[str] | None = None,
                        include_views:   bool = True) -> Generator[str, None, None]:
    """Full schema discovery for Snowflake using the native connector + INFORMATION_SCHEMA."""
    from api.services.connector import _build_sf_connection
    delta = existing_col_keys is not None
    include_tables  = include_tables  or []
    exclude_tables  = exclude_tables  or []
    col_count = skipped_col_count = rel_count = view_count = sample_count = 0

    # Support "DATABASE.SCHEMA" format — e.g. "CML_CUSTOM_BRONZE.GL"
    # Parse into db_override + plain schema names, then query DB.INFORMATION_SCHEMA directly
    # (avoids USE DATABASE which requires session privileges and may not switch correctly)
    raw_schemas = include_schemas or []
    db_override: str | None = None
    plain_schemas: list[str] = []
    for s in raw_schemas:
        s = s.strip()
        if '.' in s:
            db_part, sc_part = s.split('.', 1)
            db_override = db_part.strip().upper()
            plain_schemas.append(sc_part.strip().upper())
        elif s:
            plain_schemas.append(s.upper())
    include_schemas = plain_schemas  # plain schema names for filtering

    # Determine which INFORMATION_SCHEMA prefix to use
    # When db_override is set, use DB.INFORMATION_SCHEMA so we don't depend on session database
    info_schema = f"{db_override}.INFORMATION_SCHEMA" if db_override else "INFORMATION_SCHEMA"

    # Build SQL-level schema filter clause to push filtering into the DB query
    schema_where = ""
    if plain_schemas:
        quoted = ", ".join(f"'{s}'" for s in plain_schemas)
        schema_where = f" AND TABLE_SCHEMA IN ({quoted})"

    conn = _build_sf_connection(cfg)
    cur  = conn.cursor()

    if db_override and not delta:
        yield _sse("info", f"🔀 Querying cross-database: {db_override} (schema filter: {', '.join(plain_schemas)})")

    try:
        # ── 1. Tables ─────────────────────────────────────────
        if not delta:
            yield _sse("info", "📋 Collecting tables…")
        cur.execute(f"""
            SELECT TABLE_SCHEMA, TABLE_NAME
            FROM {info_schema}.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'{schema_where}
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        """)
        base_tables = cur.fetchall()   # list of (schema, name)
        # Still apply table name filters (include/exclude patterns) in Python
        if include_tables or exclude_tables:
            base_tables = [(s, n) for s, n in base_tables
                           if _passes_filter(s, n, [], include_tables, exclude_tables)]
        allowed_table_keys = {(s, n) for s, n in base_tables}
        if not delta:
            filter_note = " (filtered)" if (plain_schemas or include_tables or exclude_tables) else ""
            yield _sse("success", f"✓ Found {len(base_tables)} tables{filter_note}",
                       {"tables": len(base_tables)})

        # ── 2. Views ──────────────────────────────────────────
        if not include_views:
            if not delta:
                yield _sse("info", "👁 Views skipped (include_views=false)")
        else:
            if not delta:
                yield _sse("info", "👁 Collecting views…")
            try:
                cur.execute(f"""
                    SELECT TABLE_SCHEMA, TABLE_NAME, VIEW_DEFINITION
                    FROM {info_schema}.VIEWS
                    WHERE 1=1{schema_where}
                    ORDER BY TABLE_NAME
                """)
                for row in cur.fetchall():
                    db.add(CatalogView(
                        conn_id         = conn_id,
                        view_schema     = row[0],
                        view_name       = row[1],
                        view_definition = row[2],
                    ))
                    # Include view in allowed_table_keys so its columns are collected
                    allowed_table_keys.add((row[0], row[1]))
                    view_count += 1
                db.commit()
            except Exception as exc:
                yield _sse("warn", f"⚠ Views skipped: {str(exc)[:120]}")
            if not delta:
                yield _sse("success", f"✓ Captured {view_count} view definitions (columns will be collected)",
                           {"view_count": view_count})

        # ── 3. Columns + PKs ──────────────────────────────────
        if not delta:
            yield _sse("info", "🔍 Collecting columns and primary keys…")
        cur.execute(f"""
            SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME,
                   DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
                   IS_NULLABLE, ORDINAL_POSITION
            FROM {info_schema}.COLUMNS
            WHERE 1=1{schema_where}
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """)
        all_cols = cur.fetchall()

        pk_set: set[tuple] = set()
        try:
            cur.execute(f"""
                SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
                FROM {info_schema}.TABLE_CONSTRAINTS tc
                JOIN {info_schema}.KEY_COLUMN_USAGE kcu
                    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                   AND tc.TABLE_SCHEMA    = kcu.TABLE_SCHEMA
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'{schema_where.replace('TABLE_SCHEMA', 'tc.TABLE_SCHEMA')}
            """)
            for row in cur.fetchall():
                pk_set.add((row[0], row[1], row[2]))
        except Exception:
            pass

        for row in all_cols:
            if (row[0], row[1]) not in allowed_table_keys:
                continue
            col_key = (row[0], row[1], row[2])
            if existing_col_keys is not None and col_key in existing_col_keys:
                skipped_col_count += 1
                col_count += 1
                continue
            is_pk = col_key in pk_set
            db.add(CatalogColumn(
                conn_id          = conn_id,
                table_schema     = row[0],
                table_name       = row[1],
                column_name      = row[2],
                data_type        = row[3],
                max_length       = row[4],
                is_nullable      = row[5],
                is_primary_key   = is_pk,
                ordinal_position = row[6],
            ))
            col_count += 1
        db.commit()
        new_cols = col_count - skipped_col_count
        if not delta:
            yield _sse("success", f"✓ Saved {col_count} columns", {"col_count": col_count})

        # ── 4. Foreign-key relations ───────────────────────────
        if not delta:
            yield _sse("info", "🔗 Collecting foreign key relationships…")
        existing_fk_names: set[str] = set()
        if delta:
            existing_fk_names = {
                r.fk_name for r in
                db.query(CatalogRelation.fk_name)
                  .filter(CatalogRelation.conn_id == conn_id,
                          CatalogRelation.fk_name.isnot(None))
                  .all()
                if r.fk_name
            }
        try:
            fk_schema_filter = schema_where.replace("TABLE_SCHEMA", "tc.TABLE_SCHEMA") if schema_where else ""
            cur.execute(f"""
                SELECT
                    tc.CONSTRAINT_NAME    AS fk_name,
                    kcu.TABLE_NAME        AS parent_table,
                    kcu.COLUMN_NAME       AS parent_column,
                    rcu.TABLE_NAME        AS referenced_table,
                    rcu.COLUMN_NAME       AS referenced_column
                FROM {info_schema}.TABLE_CONSTRAINTS tc
                JOIN {info_schema}.KEY_COLUMN_USAGE kcu
                    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                   AND tc.TABLE_SCHEMA    = kcu.TABLE_SCHEMA
                JOIN {info_schema}.REFERENTIAL_CONSTRAINTS rc
                    ON tc.CONSTRAINT_NAME  = rc.CONSTRAINT_NAME
                   AND tc.TABLE_SCHEMA     = rc.CONSTRAINT_SCHEMA
                JOIN {info_schema}.KEY_COLUMN_USAGE rcu
                    ON rc.UNIQUE_CONSTRAINT_NAME   = rcu.CONSTRAINT_NAME
                   AND rc.UNIQUE_CONSTRAINT_SCHEMA = rcu.TABLE_SCHEMA
                   AND kcu.ORDINAL_POSITION        = rcu.ORDINAL_POSITION
                WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY'{fk_schema_filter}
            """)
            for row in cur.fetchall():
                if row[0] in existing_fk_names:
                    continue
                db.add(CatalogRelation(
                    conn_id           = conn_id,
                    fk_name           = row[0],
                    parent_table      = row[1],
                    parent_column     = row[2],
                    referenced_table  = row[3],
                    referenced_column = row[4],
                ))
                rel_count += 1
            db.commit()
        except Exception as exc:
            yield _sse("warn", f"⚠ Relations skipped: {str(exc)[:120]}")
        if not delta:
            yield _sse("success", f"✓ Found {rel_count} FK relationships",
                       {"rel_count": rel_count})

        # ── 5. Sample rows (LIMIT 3 per table) ────────────────
        tables_to_sample = [
            t for t in base_tables
            if existing_sample_tables is None or t[1] not in existing_sample_tables
        ]
        if not delta:
            yield _sse("info", f"📊 Sampling {len(tables_to_sample)} tables…")
        elif tables_to_sample:
            yield _sse("info", f"📊 Sampling {len(tables_to_sample)} new tables…")
        for i, (tbl_schema, tbl_name) in enumerate(tables_to_sample):
            yield _sse("progress",
                f"  [{i+1}/{len(tables_to_sample)}] {tbl_schema}.{tbl_name}",
                {"step": i + 1, "total": len(tables_to_sample)})
            try:
                tbl_ref = f'"{db_override}"."{tbl_schema}"."{tbl_name}"' if db_override else f'"{tbl_schema}"."{tbl_name}"'
                cur.execute(f'SELECT COUNT(*) FROM {tbl_ref}')
                cnt = cur.fetchone()[0]
                cur.execute(f'SELECT * FROM {tbl_ref} LIMIT 3')
                rows = cur.fetchall()
                col_names = [desc[0] for desc in cur.description]
                rows_json = [
                    {k: _serialize(v) for k, v in zip(col_names, row)}
                    for row in rows
                ]
                db.add(CatalogSample(
                    conn_id      = conn_id,
                    table_schema = tbl_schema,
                    table_name   = tbl_name,
                    row_count    = cnt,
                    sample_json  = json.dumps(rows_json),
                ))
                sample_count += 1
            except Exception as exc:
                yield _sse("warn", f"  ⚠ {tbl_name}: {str(exc)[:100]}")
        db.commit()
        if not delta:
            yield _sse("success", f"✓ Sampled {sample_count} tables",
                       {"sample_count": sample_count})

    finally:
        cur.close()
        conn.close()

    if delta:
        if new_cols == 0 and sample_count == 0 and rel_count == 0:
            yield _sse("done", "✓ Nothing new — catalog is already up to date.",
                       {"tables": len(base_tables), "col_count": col_count,
                        "rel_count": 0, "view_count": view_count, "sample_count": 0})
        else:
            parts = []
            if new_cols:     parts.append(f"{new_cols} new columns")
            if sample_count: parts.append(f"{sample_count} new tables sampled")
            if rel_count:    parts.append(f"{rel_count} FK relations refreshed")
            yield _sse("done", f"✓ Delta sync complete — {', '.join(parts)}",
                       {"tables": len(base_tables), "col_count": col_count,
                        "rel_count": rel_count, "view_count": view_count,
                        "sample_count": sample_count})
    else:
        yield _sse("done",
            f"🎉 Discovery complete — "
            f"{len(base_tables)} tables · {col_count} columns · "
            f"{rel_count} relations · {view_count} views",
            {"tables": len(base_tables), "col_count": col_count,
             "rel_count": rel_count, "view_count": view_count,
             "sample_count": sample_count})


def _discover_generic_sql(conn_id: int, engine, db: Session,
                          existing_col_keys: set | None = None,
                          existing_sample_tables: set | None = None,
                          include_schemas: list[str] | None = None,
                          include_tables:  list[str] | None = None,
                          exclude_tables:  list[str] | None = None,
                          include_views:   bool = True) -> Generator[str, None, None]:
    """Fallback for PostgreSQL / MySQL using standard INFORMATION_SCHEMA."""
    from sqlalchemy import text as _text
    delta = existing_col_keys is not None
    include_schemas = include_schemas or []
    include_tables  = include_tables  or []
    exclude_tables  = exclude_tables  or []
    col_count = skipped_col_count = rel_count = view_count = 0

    with engine.connect() as src:
        if not delta:
            yield _sse("info", "📋 Collecting tables…")
        tables_rows = src.execute(_text(
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE "
            "FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_SCHEMA, TABLE_NAME"
        )).fetchall()
        base_tables = [r for r in tables_rows if "VIEW" not in str(r.TABLE_TYPE).upper()]
        if include_schemas or include_tables or exclude_tables:
            base_tables = [r for r in base_tables
                           if _passes_filter(getattr(r, "TABLE_SCHEMA", None), r.TABLE_NAME,
                                             include_schemas, include_tables, exclude_tables)]
        allowed_table_keys = {(getattr(r, "TABLE_SCHEMA", None), r.TABLE_NAME) for r in base_tables}
        if not delta:
            filter_note = " (filtered)" if (include_schemas or include_tables or exclude_tables) else ""
            yield _sse("success", f"✓ Found {len(base_tables)} tables{filter_note}")

        if not delta:
            yield _sse("info", "🔍 Collecting columns…")
        cols_rows = src.execute(_text(
            "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, "
            "CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, ORDINAL_POSITION "
            "FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_NAME, ORDINAL_POSITION"
        )).fetchall()
        for row in cols_rows:
            row_schema = getattr(row, "TABLE_SCHEMA", None)
            if (row_schema, row.TABLE_NAME) not in allowed_table_keys:
                continue
            col_key = (row_schema, row.TABLE_NAME, row.COLUMN_NAME)
            if existing_col_keys is not None and col_key in existing_col_keys:
                skipped_col_count += 1
                col_count += 1
                continue
            db.add(CatalogColumn(
                conn_id          = conn_id,
                table_schema     = col_key[0],
                table_name       = row.TABLE_NAME,
                column_name      = row.COLUMN_NAME,
                data_type        = row.DATA_TYPE,
                max_length       = getattr(row, "CHARACTER_MAXIMUM_LENGTH", None),
                is_nullable      = row.IS_NULLABLE,
                is_primary_key   = False,
                ordinal_position = row.ORDINAL_POSITION,
            ))
            col_count += 1
        db.commit()
        new_cols = col_count - skipped_col_count
        if not delta:
            yield _sse("success", f"✓ Saved {col_count} columns")

        if not include_views:
            if not delta:
                yield _sse("info", "👁 Views skipped (include_views=false)")
        else:
            if not delta:
                yield _sse("info", "👁 Collecting views…")
            try:
                view_rows = src.execute(_text(
                    "SELECT TABLE_SCHEMA, TABLE_NAME AS view_name, VIEW_DEFINITION "
                    "FROM INFORMATION_SCHEMA.VIEWS ORDER BY TABLE_NAME"
                )).fetchall()
                for row in view_rows:
                        if include_schemas and (getattr(row, "TABLE_SCHEMA", None) or "").lower() not in \
                                {s.strip().lower() for s in include_schemas if s.strip()}:
                            continue
                        db.add(CatalogView(
                            conn_id         = conn_id,
                            view_schema     = getattr(row, "TABLE_SCHEMA", None),
                            view_name       = row.view_name,
                            view_definition = row.VIEW_DEFINITION,
                        ))
                        allowed_table_keys.add((getattr(row, "TABLE_SCHEMA", None), row.view_name))
                        view_count += 1
                db.commit()
            except Exception:
                pass
            if not delta:
                yield _sse("success", f"✓ Captured {view_count} views")

    if delta:
        if new_cols == 0:
            yield _sse("done", "✓ Nothing new — catalog is already up to date.",
                       {"tables": len(base_tables), "col_count": col_count,
                        "rel_count": 0, "view_count": view_count, "sample_count": 0})
        else:
            yield _sse("done", f"✓ Delta sync complete — {new_cols} new columns",
                       {"tables": len(base_tables), "col_count": col_count,
                        "rel_count": 0, "view_count": view_count, "sample_count": 0})
    else:
        yield _sse("done",
            f"🎉 Discovery complete — {len(base_tables)} tables · {col_count} columns · {view_count} views",
            {"tables": len(base_tables), "col_count": col_count,
             "rel_count": 0, "view_count": view_count, "sample_count": 0})


# ══════════════════════════════════════════════════════════════
# Endpoints
# ══════════════════════════════════════════════════════════════

class DiscoverRequest(BaseModel):
    delta:           bool       = False
    include_schemas: list[str]  = []   # empty = all schemas
    include_tables:  list[str]  = []   # fnmatch patterns, empty = all tables
    exclude_tables:  list[str]  = []   # fnmatch patterns to exclude
    include_views:   bool       = True # whether to collect view definitions


@router.post("/admin/discover/{conn_id}")
def discover_schema(conn_id: int, req: DiscoverRequest = DiscoverRequest(),
                    db: Session = Depends(get_db)):
    """
    Stream schema discovery for a stored connection via SSE.
    req.delta=false (default): clears previous catalog, then does full discovery.
    req.delta=true: keeps existing columns/samples, only adds new ones; only adds new FKs.
    """
    delta = req.delta
    conn_model = db.query(SourceConnection).filter(
        SourceConnection.id == conn_id
    ).first()
    if not conn_model:
        raise HTTPException(status_code=404, detail="Connection not found")

    cfg = _to_cfg_from_model(conn_model)

    import asyncio

    async def generate():
        existing_col_keys: set | None = None
        existing_sample_tables: set | None = None

        if delta:
            yield _sse("info", "🔄 Delta mode — loading existing catalog…")
            await asyncio.sleep(0)
            existing_col_keys = {
                (c.table_schema, c.table_name, c.column_name)
                for c in db.query(CatalogColumn).filter(CatalogColumn.conn_id == conn_id).all()
            }
            existing_sample_tables = {
                s.table_name
                for s in db.query(CatalogSample).filter(CatalogSample.conn_id == conn_id).all()
            }
            # Never touch relations in delta mode — generator will skip FK dupes by fk_name
            db.query(CatalogView).filter(CatalogView.conn_id == conn_id).delete()
            db.commit()
            yield _sse("info", f"  {len(existing_col_keys)} existing columns · "
                                f"{len(existing_sample_tables)} sampled tables — only new items will be added")
            await asyncio.sleep(0)
        else:
            # Full refresh — clear everything
            yield _sse("info", "🗑 Clearing previous catalog data for this connection…")
            await asyncio.sleep(0)
            _clear_catalog(conn_id, db)

        yield _sse("info", f"🔌 Connecting to [{cfg.get('database') or cfg.get('sf_database', '')}]…")
        await asyncio.sleep(0)

        # Active filter summary in log
        active_filters = []
        if req.include_schemas: active_filters.append(f"schemas: {', '.join(req.include_schemas)}")
        if req.include_tables:  active_filters.append(f"include: {', '.join(req.include_tables)}")
        if req.exclude_tables:  active_filters.append(f"exclude: {', '.join(req.exclude_tables)}")
        if not req.include_views: active_filters.append("no views")
        if active_filters:
            yield _sse("info", f"🔎 Filters active — {' · '.join(active_filters)}")
            await asyncio.sleep(0)

        try:
            f_kwargs = dict(
                include_schemas = req.include_schemas or None,
                include_tables  = req.include_tables  or None,
                exclude_tables  = req.exclude_tables  or None,
                include_views   = req.include_views,
            )
            if cfg.get("source_type") == "snowflake":
                gen = _discover_snowflake(conn_id, cfg, db,
                                          existing_col_keys, existing_sample_tables,
                                          **f_kwargs)
            else:
                from api.services.connector import _build_sql_engine
                engine = _build_sql_engine(cfg)
                dialect = (cfg.get("dialect") or "mssql").lower()
                if dialect == "mssql":
                    gen = _discover_mssql(conn_id, engine, db,
                                          existing_col_keys, existing_sample_tables,
                                          **f_kwargs)
                else:
                    gen = _discover_generic_sql(conn_id, engine, db,
                                                existing_col_keys, existing_sample_tables,
                                                **f_kwargs)

            for chunk in gen:
                yield chunk
                await asyncio.sleep(0)   # flush each SSE event immediately

        except Exception as exc:
            err_msg = str(exc)
            # Provide a clear hint for common Snowflake errors
            if "not allowed to access Snowflake" in err_msg or "IP/Token" in err_msg:
                yield _sse("error",
                    "✗ Snowflake IP not whitelisted — your server's IP is blocked by Snowflake's "
                    "network policy. Ask your Snowflake admin to whitelist this server's IP, or use "
                    f"a Snowflake PrivateLink / OAuth token.\n\nDetail: {err_msg[:200]}")
            elif "250001" in err_msg or "08001" in err_msg:
                yield _sse("error",
                    f"✗ Snowflake connection refused — check account identifier, warehouse, and "
                    f"network access.\n\nDetail: {err_msg[:200]}")
            else:
                yield _sse("error", f"✗ Fatal error: {err_msg[:300]}")

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":      "no-cache",
            "X-Accel-Buffering":  "no",
            "Connection":         "keep-alive",
        },
    )


@router.get("/admin/catalog/{conn_id}")
def get_catalog(conn_id: int, db: Session = Depends(get_db)):
    """Return the full stored catalog for a connection."""
    cols = db.query(CatalogColumn).filter(
        CatalogColumn.conn_id == conn_id
    ).order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position).all()

    rels = db.query(CatalogRelation).filter(
        CatalogRelation.conn_id == conn_id
    ).order_by(CatalogRelation.parent_table).all()

    views = db.query(CatalogView).filter(
        CatalogView.conn_id == conn_id
    ).order_by(CatalogView.view_name).all()

    samples = db.query(CatalogSample).filter(
        CatalogSample.conn_id == conn_id
    ).order_by(CatalogSample.table_name).all()

    # Unique table list from columns
    tables_seen: dict[str, dict] = {}
    for c in cols:
        key = f"{c.table_schema}.{c.table_name}"
        if key not in tables_seen:
            tables_seen[key] = {"schema": c.table_schema, "name": c.table_name, "cols": 0, "pks": 0}
        tables_seen[key]["cols"] += 1
        if c.is_primary_key:
            tables_seen[key]["pks"] += 1

    return {
        "summary": {
            "table_count":   len(tables_seen),
            "col_count":     len(cols),
            "rel_count":     len(rels),
            "view_count":    len(views),
            "sample_count":  len(samples),
        },
        "tables": list(tables_seen.values()),
        "columns": [
            {
                "table_schema":    c.table_schema,
                "table_name":      c.table_name,
                "column_name":     c.column_name,
                "data_type":       c.data_type,
                "max_length":      c.max_length,
                "is_nullable":     c.is_nullable,
                "is_primary_key":  c.is_primary_key,
                "ordinal_position": c.ordinal_position,
            }
            for c in cols
        ],
        "relations": [
            {
                "fk_name":          r.fk_name,
                "parent_table":     r.parent_table,
                "parent_column":    r.parent_column,
                "referenced_table": r.referenced_table,
                "referenced_column": r.referenced_column,
            }
            for r in rels
        ],
        "views": [
            {
                "view_schema":     v.view_schema,
                "view_name":       v.view_name,
                "view_definition": v.view_definition,
            }
            for v in views
        ],
        "samples": [
            {
                "table_schema": s.table_schema,
                "table_name":   s.table_name,
                "row_count":    s.row_count,
                "sample_json":  s.sample_json,
            }
            for s in samples
        ],
    }


@router.delete("/admin/catalog/{conn_id}", status_code=204)
def clear_catalog(conn_id: int, db: Session = Depends(get_db)):
    _clear_catalog(conn_id, db)


# ══════════════════════════════════════════════════════════════
# Generate Embeddings  —  POST /api/admin/embeddings/{conn_id}
# ══════════════════════════════════════════════════════════════

class EmbedRequest(BaseModel):
    api_key:     str = ""   # empty → fall back to OPENAI_API_KEY in .env
    model:       str = "text-embedding-3-small"
    chat_model:  str = "gpt-4o-mini"
    delta:       bool = False  # true = skip columns already embedded with same model


@router.post("/admin/embeddings/{conn_id}")
def generate_embeddings(conn_id: int, req: EmbedRequest,
                        db: Session = Depends(get_db)):
    """
    Stream embedding generation progress via SSE.
    For each column in the catalog: build a semantic description,
    call OpenAI embeddings API, store vector in conversion_column_embeddings.
    """
    conn_model = db.query(SourceConnection).filter(
        SourceConnection.id == conn_id
    ).first()
    if not conn_model:
        raise HTTPException(status_code=404, detail="Connection not found")

    import asyncio
    from api.services.embeddings import get_embedding, build_column_definition

    async def generate():
        # Resolve API key — prefer request key, fall back to .env
        api_key = req.api_key.strip() or settings.OPENAI_API_KEY.strip()
        if not api_key:
            yield _sse("error", "No OpenAI API key provided. Set OPENAI_API_KEY in .env or enter it in the Admin panel.")
            return

        # Load catalog columns
        cols = (db.query(CatalogColumn)
                  .filter(CatalogColumn.conn_id == conn_id)
                  .order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position)
                  .all())
        if not cols:
            yield _sse("error",
                       "No catalog columns found. Run 'Collect Schema' first.")
            return

        # Load sample rows keyed by table
        samples_rows = (db.query(CatalogSample)
                          .filter(CatalogSample.conn_id == conn_id).all())
        samples_by_table: dict = {}
        for sr in samples_rows:
            try:
                rows = json.loads(sr.sample_json or "[]")
                samples_by_table[sr.table_name] = rows
            except Exception:
                pass

        # Delta: skip columns already embedded with the same model
        if req.delta:
            existing_emb_keys = {
                (e.table_name, e.column_name)
                for e in db.query(ColumnEmbedding)
                             .filter(ColumnEmbedding.conn_id == conn_id,
                                     ColumnEmbedding.embedding_model == req.model)
                             .all()
            }
            cols_to_embed = [c for c in cols
                             if (c.table_name, c.column_name) not in existing_emb_keys]
            skipped_emb = len(cols) - len(cols_to_embed)
            if skipped_emb == len(cols):
                yield _sse("info",
                           f"🔄 Delta mode — all {skipped_emb} columns already embedded, nothing to do.")
                await asyncio.sleep(0)
            else:
                yield _sse("info",
                           f"🔄 Delta mode — {skipped_emb} already embedded · "
                           f"{len(cols_to_embed)} new to process")
                await asyncio.sleep(0)
        else:
            # Full refresh — clear old embeddings
            yield _sse("info", "🗑 Clearing previous embeddings…")
            await asyncio.sleep(0)
            db.query(ColumnEmbedding).filter(
                ColumnEmbedding.conn_id == conn_id
            ).delete()
            db.commit()
            cols_to_embed = cols

        total       = len(cols_to_embed)
        done_count  = 0
        error_count = 0
        if total > 0:
            yield _sse("info",
                       f"🔮 Generating embeddings for {total} columns "
                       f"using {req.model}…")
            await asyncio.sleep(0)

        for i, col in enumerate(cols_to_embed):
            table_rows  = samples_by_table.get(col.table_name, [])
            sample_vals = [
                row.get(col.column_name)
                for row in table_rows
                if row.get(col.column_name) is not None
            ]

            col_def = build_column_definition(
                col.table_name, col.column_name,
                col.data_type or "unknown",
                col.is_primary_key, sample_vals,
            )

            yield _sse("progress",
                       f"  [{i+1}/{total}] {col.table_name}.{col.column_name}")
            await asyncio.sleep(0)

            try:
                vector = get_embedding(col_def, api_key, req.model)
                db.add(ColumnEmbedding(
                    conn_id           = conn_id,
                    table_schema      = col.table_schema,
                    table_name        = col.table_name,
                    column_name       = col.column_name,
                    column_definition = col_def,
                    embedding_json    = json.dumps(vector),
                    embedding_model   = req.model,
                ))
                done_count += 1
            except Exception as exc:
                error_count += 1
                yield _sse("warn",
                           f"  ⚠ {col.table_name}.{col.column_name}: "
                           f"{str(exc)[:120]}")
                await asyncio.sleep(0)

            if (i + 1) % 25 == 0:
                db.commit()
                await asyncio.sleep(0)

        db.commit()
        if req.delta and done_count == 0 and error_count == 0:
            yield _sse("done", "✓ Nothing new — all columns already embedded.",
                       {"done_count": 0, "error_count": 0})
        else:
            yield _sse(
                "done",
                f"🎉 Embeddings complete — {done_count} stored, {error_count} errors",
                {"done_count": done_count, "error_count": error_count},
            )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )


@router.get("/admin/embeddings/{conn_id}/count")
def count_embeddings(conn_id: int, db: Session = Depends(get_db)):
    count = db.query(ColumnEmbedding).filter(
        ColumnEmbedding.conn_id == conn_id
    ).count()
    return {"conn_id": conn_id, "count": count}


@router.get("/admin/embeddings/{conn_id}/definitions")
def get_embedding_definitions(conn_id: int, db: Session = Depends(get_db)):
    """Return AI-generated column_definition for every embedded column."""
    embs = db.query(ColumnEmbedding).filter(
        ColumnEmbedding.conn_id == conn_id
    ).all()
    return [
        {
            "table_name":    e.table_name,
            "column_name":   e.column_name,
            "ai_definition": e.column_definition or "",
        }
        for e in embs
    ]


# ══════════════════════════════════════════════════════════════
# Sample Reports  —  GET /api/admin/reports/{conn_id}
# Generates runnable SQL reports from stored catalog data
# ══════════════════════════════════════════════════════════════

@router.get("/admin/reports/{conn_id}")
def get_sample_reports(conn_id: int, db: Session = Depends(get_db)):
    conn_model = db.query(SourceConnection).filter(
        SourceConnection.id == conn_id
    ).first()
    if not conn_model:
        raise HTTPException(status_code=404, detail="Connection not found")

    cols = (db.query(CatalogColumn)
              .filter(CatalogColumn.conn_id == conn_id)
              .order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position)
              .all())
    if not cols:
        raise HTTPException(
            status_code=400,
            detail="No catalog data found. Run 'Collect Schema' first."
        )

    samples = db.query(CatalogSample).filter(CatalogSample.conn_id == conn_id).all()
    sample_counts = {s.table_name: (s.row_count or 0) for s in samples}

    cfg     = _to_cfg_from_model(conn_model)
    dialect = (cfg.get("dialect") or "mssql").lower()
    is_mssql = dialect in ("mssql", "sql server")

    def top(n):  return f"TOP {n} " if is_mssql else ""
    def lim(n):  return "" if is_mssql else f" LIMIT {n}"
    def qt(s):   return f"[{s}]" if is_mssql else f'"{s}"'  # quote identifier

    # Group columns by (schema, table)
    tables: dict[tuple, list] = {}
    for col in cols:
        key = (col.table_schema or "dbo", col.table_name)
        tables.setdefault(key, []).append(col)

    numeric_types = {"int", "bigint", "smallint", "tinyint", "decimal",
                     "numeric", "float", "real", "money", "double"}
    reports = []

    # ── 1. Row Count Summary ────────────────────────────────
    if tables:
        parts = [
            f"  SELECT '{tbl}' AS table_name, COUNT(*) AS row_count"
            f" FROM {qt(sch)}.{qt(tbl)}"
            for sch, tbl in list(tables.keys())[:30]
        ]
        reports.append({
            "id": "row-counts",
            "title": "Row Count — All Tables",
            "description": f"Live COUNT(*) across all {len(tables)} tables",
            "category": "schema", "icon": "📊",
            "sql": "\nUNION ALL\n".join(parts) + "\nORDER BY row_count DESC",
        })

    # ── 2. Schema Overview (INFORMATION_SCHEMA) ─────────────
    reports.append({
        "id": "schema-overview",
        "title": "Schema Overview",
        "description": "Tables with column counts and nullable breakdown",
        "category": "schema", "icon": "🗂",
        "sql": (
            "SELECT t.TABLE_SCHEMA, t.TABLE_NAME,\n"
            "  COUNT(c.COLUMN_NAME) AS total_cols,\n"
            "  SUM(CASE WHEN c.IS_NULLABLE='YES' THEN 1 ELSE 0 END) AS nullable_cols,\n"
            "  SUM(CASE WHEN c.IS_NULLABLE='NO'  THEN 1 ELSE 0 END) AS required_cols\n"
            "FROM INFORMATION_SCHEMA.TABLES t\n"
            "JOIN INFORMATION_SCHEMA.COLUMNS c\n"
            "  ON c.TABLE_SCHEMA=t.TABLE_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME\n"
            "WHERE t.TABLE_TYPE='BASE TABLE'\n"
            "GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME\n"
            "ORDER BY total_cols DESC"
        ),
    })

    # ── 3. Foreign Key / Relationship Map ───────────────────
    if is_mssql:
        reports.append({
            "id": "fk-map",
            "title": "Foreign Key Map",
            "description": "All FK constraints in the database",
            "category": "schema", "icon": "🔗",
            "sql": (
                "SELECT\n"
                "  fk.name AS fk_name,\n"
                "  OBJECT_NAME(fk.parent_object_id)      AS parent_table,\n"
                "  COL_NAME(fkc.parent_object_id,  fkc.parent_column_id)  AS parent_col,\n"
                "  OBJECT_NAME(fk.referenced_object_id)  AS ref_table,\n"
                "  COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ref_col\n"
                "FROM sys.foreign_keys fk\n"
                "JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id\n"
                "ORDER BY parent_table, fk_name"
            ),
        })

    # ── 4. Tables Without Primary Keys ──────────────────────
    no_pk = [(sch, tbl) for (sch, tbl), tcols in tables.items()
             if not any(c.is_primary_key for c in tcols)]
    if no_pk:
        rows_vals = ",\n".join(f"  ('{sch}', '{tbl}')" for sch, tbl in no_pk[:30])
        reports.append({
            "id": "no-pk",
            "title": "Tables Without Primary Keys",
            "description": f"{len(no_pk)} of {len(tables)} tables lack a PK",
            "category": "quality", "icon": "⚠",
            "sql": (
                "SELECT table_schema, table_name FROM (\n  VALUES\n"
                + rows_vals
                + "\n) AS t(table_schema, table_name)"
            ),
        })

    # ── 5. Preview: first 8 tables ──────────────────────────
    for sch, tbl in list(tables.keys())[:8]:
        tcols     = tables[(sch, tbl)]
        col_list  = ", ".join(qt(c.column_name) for c in tcols[:15])
        row_cnt   = sample_counts.get(tbl, "?")
        reports.append({
            "id": f"preview-{tbl}",
            "title": f"Preview: {tbl}",
            "description": f"{len(tcols)} cols · {row_cnt:,} rows" if isinstance(row_cnt, int) else f"{len(tcols)} cols",
            "category": "sample", "icon": "👁",
            "sql": f"SELECT {top(10)}{col_list}\nFROM {qt(sch)}.{qt(tbl)}{lim(10)}",
        })

    # ── 6. Numeric Stats for first matching table ────────────
    for sch, tbl in list(tables.keys()):
        num_cols = [c for c in tables[(sch, tbl)]
                    if (c.data_type or "").lower() in numeric_types]
        if len(num_cols) >= 2:
            agg = ",\n".join(
                f"  MIN({qt(c.column_name)}) AS {qt(c.column_name+'_min')},\n"
                f"  MAX({qt(c.column_name)}) AS {qt(c.column_name+'_max')},\n"
                f"  AVG(CAST({qt(c.column_name)} AS FLOAT)) AS {qt(c.column_name+'_avg')}"
                for c in num_cols[:4]
            )
            reports.append({
                "id": f"numeric-{tbl}",
                "title": f"Numeric Stats: {tbl}",
                "description": f"MIN / MAX / AVG across {len(num_cols)} numeric columns",
                "category": "analysis", "icon": "📈",
                "sql": f"SELECT\n{agg}\nFROM {qt(sch)}.{qt(tbl)}",
            })
            break

    # ── 7. Duplicate detection for first PK-less table ───────
    pk_less = [(sch, tbl) for sch, tbl in no_pk[:3]]
    for sch, tbl in pk_less[:1]:
        tcols    = tables[(sch, tbl)]
        grp_cols = ", ".join(qt(c.column_name) for c in tcols[:5])
        reports.append({
            "id": f"dupes-{tbl}",
            "title": f"Duplicate Check: {tbl}",
            "description": "Rows sharing the same values across first 5 columns",
            "category": "quality", "icon": "🔍",
            "sql": (
                f"SELECT {grp_cols}, COUNT(*) AS occurrences\n"
                f"FROM {qt(sch)}.{qt(tbl)}\n"
                f"GROUP BY {grp_cols}\n"
                f"HAVING COUNT(*) > 1\n"
                f"ORDER BY occurrences DESC"
            ),
        })

    return {"reports": reports, "conn_id": conn_id, "dialect": dialect}


# ══════════════════════════════════════════════════════════════
# Schema Metadata CRUD
# GET    /api/admin/metadata/{conn_id}
# PUT    /api/admin/metadata/{conn_id}
# DELETE /api/admin/metadata/{conn_id}/{meta_id}
# ══════════════════════════════════════════════════════════════

from pydantic import BaseModel as _BaseModel  # noqa: E402

class MetadataUpsertReq(_BaseModel):
    table_name:       str
    column_name:      Optional[str] = None
    aliases:          Optional[str] = None
    description:      Optional[str] = None
    business_context: Optional[str] = None
    synonyms:         Optional[str] = None   # JSON array string


@router.get("/admin/metadata/{conn_id}", tags=["admin"])
def get_metadata(conn_id: int, db: Session = Depends(get_db)):
    """
    Return every discovered column (from catalog) merged with any user metadata.
    Falls back to SchemaMetadata-only rows if no catalog exists yet.
    """
    # Build a lookup of existing metadata keyed by (table_name, column_name)
    meta_rows = db.query(SchemaMetadata).filter_by(conn_id=conn_id).all()
    meta_index: dict = {
        (m.table_name, m.column_name or ""): m for m in meta_rows
    }

    # Primary: use catalog columns so all discovered columns appear
    catalog_cols = (
        db.query(CatalogColumn)
        .filter(CatalogColumn.conn_id == conn_id)
        .order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position)
        .all()
    )

    if catalog_cols:
        result = []
        for col in catalog_cols:
            key = (col.table_name, col.column_name or "")
            m = meta_index.get(key)
            result.append({
                "id":               m.id if m else None,
                "table_name":       col.table_name,
                "column_name":      col.column_name,
                "data_type":        col.data_type or "",
                "is_primary_key":   col.is_primary_key or False,
                "aliases":          (m.aliases          if m else "") or "",
                "description":      (m.description      if m else "") or "",
                "business_context": (m.business_context if m else "") or "",
                "synonyms":         (m.synonyms         if m else "") or "[]",
            })
        # __table__ rows in SchemaMetadata have no matching CatalogColumn entry —
        # append them separately so the frontend receives saved table descriptions.
        for (tbl, col_name), m in meta_index.items():
            if col_name == "__table__":
                result.append({
                    "id":               m.id,
                    "table_name":       tbl,
                    "column_name":      "__table__",
                    "data_type":        "",
                    "is_primary_key":   False,
                    "aliases":          m.aliases          or "",
                    "description":      m.description      or "",
                    "business_context": m.business_context or "",
                    "synonyms":         m.synonyms         or "[]",
                })
        return result

    # Fallback: no catalog yet — return whatever is in SchemaMetadata
    return [{
        "id":               r.id,
        "table_name":       r.table_name,
        "column_name":      r.column_name,
        "data_type":        "",
        "is_primary_key":   False,
        "aliases":          r.aliases          or "",
        "description":      r.description      or "",
        "business_context": r.business_context or "",
        "synonyms":         r.synonyms         or "[]",
    } for r in meta_rows]


@router.put("/admin/metadata/{conn_id}", tags=["admin"])
def upsert_metadata(conn_id: int, req: MetadataUpsertReq, db: Session = Depends(get_db)):
    row = db.query(SchemaMetadata).filter_by(
        conn_id=conn_id,
        table_name=req.table_name,
        column_name=req.column_name,
    ).first()
    if row:
        row.aliases          = req.aliases
        row.description      = req.description
        row.business_context = req.business_context
        row.synonyms         = req.synonyms
    else:
        db.add(SchemaMetadata(
            conn_id=conn_id,
            table_name=req.table_name,
            column_name=req.column_name,
            aliases=req.aliases,
            description=req.description,
            business_context=req.business_context,
            synonyms=req.synonyms,
        ))
    db.commit()
    return {"ok": True}


class MetadataBulkReq(_BaseModel):
    rows: list[MetadataUpsertReq]


@router.post("/admin/metadata/{conn_id}/bulk", tags=["admin"])
def bulk_upsert_metadata(conn_id: int, req: MetadataBulkReq, db: Session = Depends(get_db)):
    for r in req.rows:
        row = db.query(SchemaMetadata).filter_by(
            conn_id=conn_id, table_name=r.table_name, column_name=r.column_name,
        ).first()
        if row:
            row.aliases          = r.aliases
            row.description      = r.description
            row.business_context = r.business_context
            row.synonyms         = r.synonyms
        else:
            db.add(SchemaMetadata(
                conn_id=conn_id, table_name=r.table_name, column_name=r.column_name,
                aliases=r.aliases, description=r.description,
                business_context=r.business_context, synonyms=r.synonyms,
            ))
    db.commit()
    return {"saved": len(req.rows)}


@router.delete("/admin/metadata/{conn_id}/{meta_id}", tags=["admin"])
def delete_metadata(conn_id: int, meta_id: int, db: Session = Depends(get_db)):
    db.query(SchemaMetadata).filter_by(id=meta_id, conn_id=conn_id).delete()
    db.commit()
    return {"deleted": meta_id}


# ══════════════════════════════════════════════════════════════
# Schema JSON tree — Export / Import / SQL Generation
# ══════════════════════════════════════════════════════════════

_SYNONYM_RULES = [
    (["DOB"],  ["date of birth", "birthdate"]),
    (["ID"],   ["identifier"]),
    (["NAME"], ["name", "full name"]),
]


def _auto_synonyms(col_name: str) -> list[str]:
    up  = col_name.upper()
    syn: list[str] = []
    for tokens, words in _SYNONYM_RULES:
        if any(t in up for t in tokens):
            syn.extend(w for w in words if w not in syn)
    return syn


def _build_tree(conn_id: int, db: Session) -> dict:
    conn_model = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn_model:
        raise HTTPException(status_code=404, detail="Connection not found")

    cols  = db.query(CatalogColumn).filter_by(conn_id=conn_id).order_by(
        CatalogColumn.table_name, CatalogColumn.ordinal_position).all()
    rels  = db.query(CatalogRelation).filter_by(conn_id=conn_id).all()
    metas = db.query(SchemaMetadata).filter_by(conn_id=conn_id).all()

    # Index metadata  key = (table, col_or_None)
    meta_idx: dict[tuple, SchemaMetadata] = {}
    for m in metas:
        meta_idx[(m.table_name, m.column_name)] = m

    # Group columns by table
    tables_cols: dict[str, list] = {}
    for c in cols:
        tables_cols.setdefault(c.table_name, []).append(c)

    # Group relations by parent table
    rels_by_tbl: dict[str, list] = {}
    for r in rels:
        rels_by_tbl.setdefault(r.parent_table, []).append({
            "column":            r.parent_column,
            "references_table":  r.referenced_table,
            "references_column": r.referenced_column,
        })

    tables_out: dict[str, dict] = {}
    for tbl_name, tbl_cols in tables_cols.items():
        tbl_meta = meta_idx.get((tbl_name, None), None)
        columns_out: dict[str, dict] = {}
        for c in tbl_cols:
            col_meta = meta_idx.get((tbl_name, c.column_name), None)
            desc             = (col_meta.description      if col_meta else None) or ""
            biz_ctx          = (col_meta.business_context if col_meta else None) or ""
            aliases          = (col_meta.aliases          if col_meta else None) or ""
            # Stored synonyms (JSON array) take precedence; fall back to auto-generated
            stored_syn_raw   = (col_meta.synonyms if col_meta else None) or ""
            if stored_syn_raw:
                try:
                    synonyms = json.loads(stored_syn_raw)
                except Exception:
                    synonyms = [s.strip() for s in stored_syn_raw.split(",") if s.strip()]
            else:
                synonyms = _auto_synonyms(c.column_name)
                for a in aliases.split(","):
                    a = a.strip()
                    if a and a not in synonyms:
                        synonyms.append(a)
            columns_out[c.column_name] = {
                "data_type":        c.data_type or "",
                "description":      desc,
                "business_context": biz_ctx or (tbl_meta.business_context if tbl_meta else None) or "",
                "synonyms":         synonyms,
            }
        tables_out[tbl_name] = {
            "description":   (tbl_meta.description      if tbl_meta else None) or "",
            "business_context": (tbl_meta.business_context if tbl_meta else None) or "",
            "aliases":       (tbl_meta.aliases           if tbl_meta else None) or "",
            "columns":       columns_out,
            "relationships": rels_by_tbl.get(tbl_name, []),
        }

    return {"database": conn_model.name, "tables": tables_out}


@router.get("/admin/schema/export/{conn_id}", tags=["admin"])
def export_schema(conn_id: int, db: Session = Depends(get_db)):
    """Return full schema metadata tree as JSON."""
    return _build_tree(conn_id, db)


class SchemaImportReq(_BaseModel):
    data: dict


@router.post("/admin/schema/import/{conn_id}", tags=["admin"])
def import_schema(conn_id: int, req: SchemaImportReq, db: Session = Depends(get_db)):
    """
    Accept a schema tree JSON, validate it, and upsert all metadata rows.
    """
    data = req.data
    if not isinstance(data, dict) or "tables" not in data:
        raise HTTPException(status_code=422, detail='Missing "tables" key')
    if not isinstance(data["tables"], dict):
        raise HTTPException(status_code=422, detail='"tables" must be an object')

    saved = 0
    for tbl_name, tbl_data in data["tables"].items():
        if not isinstance(tbl_data, dict):
            continue
        if "columns" not in tbl_data or not isinstance(tbl_data["columns"], dict):
            raise HTTPException(
                status_code=422,
                detail=f'Table "{tbl_name}" missing "columns" object'
            )
        # Upsert table-level metadata
        _upsert_meta(conn_id, tbl_name, None,
                     aliases=tbl_data.get("aliases", ""),
                     description=tbl_data.get("description", ""),
                     business_context=tbl_data.get("business_context", ""),
                     synonyms=None, db=db)
        saved += 1
        # Upsert column-level metadata
        for col_name, col_data in tbl_data["columns"].items():
            if not isinstance(col_data, dict):
                continue
            synonyms_list = col_data.get("synonyms") or []
            _upsert_meta(conn_id, tbl_name, col_name,
                         aliases="",
                         description=col_data.get("description", ""),
                         business_context=col_data.get("business_context", ""),
                         synonyms=json.dumps(synonyms_list) if synonyms_list else None,
                         db=db)
            saved += 1

    db.commit()
    return {"saved": saved}


def _upsert_meta(conn_id, tbl, col, aliases, description, db,
                 business_context=None, synonyms=None):
    row = db.query(SchemaMetadata).filter_by(
        conn_id=conn_id, table_name=tbl, column_name=col
    ).first()
    if row:
        row.aliases          = aliases          or None
        row.description      = description      or None
        row.business_context = business_context or None
        row.synonyms         = synonyms         or None
    else:
        db.add(SchemaMetadata(
            conn_id=conn_id, table_name=tbl, column_name=col,
            aliases=aliases or None, description=description or None,
            business_context=business_context or None, synonyms=synonyms or None,
        ))


# ── SQL Generation ─────────────────────────────────────────────────────────

class GenerateSQLReq(_BaseModel):
    user_query: str
    conn_id:    int | None = None   # optional: fetch tree from DB
    tree:       dict | None = None  # optional: use provided tree directly


@router.post("/admin/generate-sql", tags=["admin"])
def generate_sql(req: GenerateSQLReq, db: Session = Depends(get_db)):
    """
    Structure-based SQL generation (no embeddings).
    Matches user_query tokens against column names, synonyms, and descriptions.
    """
    if req.tree:
        tree = req.tree
    elif req.conn_id:
        tree = _build_tree(req.conn_id, db)
    else:
        raise HTTPException(status_code=422, detail="Provide conn_id or tree")

    sql = _generate_sql_from_tree(req.user_query, tree)
    return {"sql": sql, "user_query": req.user_query}


def _generate_sql_from_tree(user_query: str, tree: dict) -> str:
    """
    Step 1 — tokenise query
    Step 2 — match tokens → columns (name / synonyms / description)
    Step 3 — identify tables that own matched columns
    Step 4 — resolve JOINs from relationships or shared column names
    Step 5 — emit SELECT … FROM … JOIN …
    """
    import re
    tables = tree.get("tables", {})
    tokens = set(re.sub(r"[^\w\s]", " ", user_query.lower()).split())

    # ── Step 1+2: match tokens to columns ──────────────────
    # matched_cols: { table -> [col, ...] }
    matched_cols: dict[str, list[str]] = {}

    for tbl_name, tbl_data in tables.items():
        for col_name, col_data in tbl_data.get("columns", {}).items():
            col_up = col_name.lower()
            desc   = (col_data.get("description") or "").lower()
            syns   = [s.lower() for s in (col_data.get("synonyms") or [])]
            # Match if any token appears in column name, any synonym, or description
            hit = (
                any(t in col_up for t in tokens)
                or any(t in s for t in tokens for s in syns)
                or any(t in desc for t in tokens)
            )
            if hit:
                matched_cols.setdefault(tbl_name, []).append(col_name)

    if not matched_cols:
        return f"-- No columns matched for query: {user_query}"

    # ── Step 3: identify tables ─────────────────────────────
    tbl_names = list(matched_cols.keys())

    # ── Step 4: resolve JOINs ───────────────────────────────
    # Build alias map: first letter of table name (deduplicated)
    alias_map: dict[str, str] = {}
    used: set[str] = set()
    for t in tbl_names:
        base = t[0].lower()
        alias = base
        i = 1
        while alias in used:
            alias = base + str(i); i += 1
        alias_map[t] = alias
        used.add(alias)

    # Collect join conditions from explicit relationships
    joins: list[tuple[str, str, str, str]] = []   # (parent, parent_col, ref_tbl, ref_col)
    for tbl in tbl_names:
        for rel in tables[tbl].get("relationships", []):
            ref = rel.get("references_table", "")
            if ref in matched_cols or ref in tbl_names:
                joins.append((tbl, rel["column"], ref, rel["references_column"]))
                if ref not in tbl_names:
                    tbl_names.append(ref)
                    alias_map[ref] = ref[0].lower() + str(len(alias_map))

    # Infer joins from shared column names when no explicit FK found
    if len(tbl_names) > 1 and not joins:
        col_to_tables: dict[str, list[str]] = {}
        for t in tbl_names:
            for c in tables.get(t, {}).get("columns", {}):
                col_to_tables.setdefault(c, []).append(t)
        for col, tbls in col_to_tables.items():
            if len(tbls) >= 2:
                for i in range(1, len(tbls)):
                    joins.append((tbls[0], col, tbls[i], col))

    # ── Step 5: emit SQL ────────────────────────────────────
    select_parts: list[str] = []
    for tbl in tbl_names:
        alias = alias_map[tbl]
        for col in matched_cols.get(tbl, []):
            select_parts.append(f"{alias}.{col}")

    if not select_parts:
        return f"-- No columns to select for query: {user_query}"

    primary_tbl   = tbl_names[0]
    primary_alias = alias_map[primary_tbl]
    sql = f"SELECT {', '.join(select_parts)}\nFROM {primary_tbl} {primary_alias}"

    joined: set[str] = {primary_tbl}
    for parent, p_col, ref_tbl, r_col in joins:
        if ref_tbl not in joined:
            ref_alias = alias_map.get(ref_tbl, ref_tbl[0].lower())
            sql += f"\nJOIN {ref_tbl} {ref_alias} ON {alias_map[parent]}.{p_col} = {ref_alias}.{r_col}"
            joined.add(ref_tbl)

    return sql + ";"


# ══════════════════════════════════════════════════════════════
# AI Schema Enrichment Chat
# POST /api/admin/schema/ai-enrich/{conn_id}
# ══════════════════════════════════════════════════════════════

class EnrichChatReq(_BaseModel):
    message: str
    history: list[dict] = []   # used only when session_id is None
    session_id: Optional[int] = None


def _confidence_score(col_data: dict) -> int:
    """0 = no metadata, 1 = description only, 2 = desc+aliases, 3 = full."""
    score = 0
    if col_data.get("description"):      score += 1
    if col_data.get("synonyms"):         score += 1
    if col_data.get("business_context"): score += 1
    return score


def _build_gap_summary(tree: dict) -> tuple[str, int]:
    """Return (human-readable gap summary ordered by priority, count of gaps)."""
    # Group by table: collect confidence info
    table_gaps: list[tuple[int, str, list[str]]] = []   # (gap_count, table_name, gap_lines)
    total_gaps = 0

    for tbl_name, tbl_data in tree.get("tables", {}).items():
        lines: list[str] = []
        if not tbl_data.get("description") and not tbl_data.get("business_context"):
            lines.append(f"    • Table has no description or business context")

        zero_conf   = []
        partial_conf = []
        for col_name, col_data in tbl_data.get("columns", {}).items():
            score = _confidence_score(col_data)
            if score == 0:
                zero_conf.append(f"{col_name}({col_data.get('data_type','')})")
            elif score < 3:
                missing_fields = []
                if not col_data.get("description"):      missing_fields.append("description")
                if not col_data.get("synonyms"):         missing_fields.append("synonyms")
                if not col_data.get("business_context"): missing_fields.append("business_context")
                partial_conf.append(f"{col_name}: missing {', '.join(missing_fields)}")

        if zero_conf:
            lines.append(f"    • NO metadata at all: {', '.join(zero_conf[:10])}"
                         + (f" (+{len(zero_conf)-10} more)" if len(zero_conf) > 10 else ""))
        if partial_conf:
            lines.append(f"    • Partial metadata: " + "; ".join(partial_conf[:5])
                         + (f" (+{len(partial_conf)-5} more)" if len(partial_conf) > 5 else ""))

        gap_count = len(zero_conf) + len(partial_conf) + (1 if not tbl_data.get("description") else 0)
        if gap_count > 0:
            table_gaps.append((gap_count, tbl_name, lines))
        total_gaps += gap_count

    # Sort by worst first (most gaps)
    table_gaps.sort(key=lambda x: -x[0])

    output_lines: list[str] = []
    for gap_count, tbl_name, lines in table_gaps[:20]:  # cap at 20 tables
        output_lines.append(f"  [{gap_count} gaps] {tbl_name}:")
        output_lines.extend(lines)

    if len(table_gaps) > 20:
        output_lines.append(f"  … and {len(table_gaps)-20} more tables with gaps")

    return "\n".join(output_lines), total_gaps


def _tree_to_compact_text(tree: dict) -> str:
    """Render the schema tree as compact text for the system prompt."""
    lines: list[str] = [f"Database: {tree.get('database', 'unknown')}\n"]
    for tbl_name, tbl_data in tree.get("tables", {}).items():
        desc = tbl_data.get("description") or ""
        biz  = tbl_data.get("business_context") or ""
        lines.append(f"TABLE {tbl_name}")
        if desc:
            lines.append(f"  description: {desc}")
        if biz:
            lines.append(f"  business_context: {biz}")
        for col_name, col_data in tbl_data.get("columns", {}).items():
            cdesc = col_data.get("description") or ""
            syns  = col_data.get("synonyms") or []
            line  = f"  {col_name} ({col_data.get('data_type','')})"
            if cdesc:
                line += f" — {cdesc}"
            if syns:
                line += f" [synonyms: {', '.join(syns)}]"
            lines.append(line)
        rels = tbl_data.get("relationships") or []
        for r in rels:
            lines.append(f"  FK: {r.get('column')} → {r.get('references_table')}.{r.get('references_column')}")
        lines.append("")
    return "\n".join(lines)


_ENRICH_SYSTEM_PROMPT = """\
You are a Schema Enrichment AI assistant helping Subject Matter Experts (SMEs) and \
Business Analysts (BAs) document their database schema for natural-language querying (RAG).

Your job: identify low-confidence columns (missing descriptions, synonyms, or business context), \
ask targeted business questions to the SME/BA, and write the enriched metadata back.

## Confidence levels you must address (in priority order)
1. **Zero confidence** — column has NO description, NO synonyms, NO business context at all
2. **Low confidence** — column has a description but no synonyms or business context
3. **Medium confidence** — column has description + one other field missing

## Your conversation rules
1. Start by summarising: how many tables and columns need attention, ranked worst-first.
2. Ask ONE business question at a time (about a table or a logical group of 2–4 columns).
3. Frame questions as a BA would: focus on BUSINESS meaning, not technical details.
   - Bad: "What is the data type of STATUS_CODE?"
   - Good: "What does a STATUS_CODE of 'A' vs 'I' mean in business terms? \
     What would a user call this field when asking questions?"
4. After the user answers, immediately output a SCHEMA_UPDATES block with:
   - description: plain English, 1–2 sentences
   - business_context: why this field matters, how it's used in reporting
   - aliases: alternative column names used by business users (comma-separated)
   - synonyms: natural-language phrases a user might say when querying this field \
     (e.g. "date of birth" → ["birthday", "dob", "birth date", "age"])
5. After the SCHEMA_UPDATES block, continue to the NEXT gap immediately.
6. When all priority gaps are addressed, suggest 3–5 example natural-language queries \
   the user can now ask that would be answered correctly thanks to the enrichment.

## SCHEMA_UPDATES format (strict JSON, valid only)
[SCHEMA_UPDATES]
{{
  "updates": [
    {{
      "table_name": "TableName",
      "column_name": "ColumnName",
      "description": "Plain English description of what this column stores.",
      "business_context": "How this field is used in business processes or reports.",
      "aliases": "business alias 1, alias 2",
      "synonyms": ["natural language phrase 1", "phrase 2", "phrase 3"]
    }}
  ]
}}
[/SCHEMA_UPDATES]

For TABLE-level metadata: set `"column_name": null` and populate description + business_context.
Only include rows with actual new content — skip fields you don't have info for.

## Current Schema
{schema}

## Gap Analysis — {gap_count} items need attention (worst tables first)
{gaps}
"""


@router.post("/admin/schema/ai-enrich/{conn_id}", tags=["admin"])
def ai_enrich_chat(conn_id: int, req: EnrichChatReq, db: Session = Depends(get_db)):
    """
    Conversational AI assistant that analyses schema gaps and enriches metadata.
    If session_id is provided, history is loaded from DB and messages are persisted.
    Does NOT auto-apply updates — the client calls /bulk to apply after confirmation.
    """
    api_key = settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured")

    tree        = _build_tree(conn_id, db)
    schema_text = _tree_to_compact_text(tree)
    gaps_text, gap_count = _build_gap_summary(tree)

    # Resolve prompt: DB override first, hardcoded constant as fallback
    _enrich_template = _ENRICH_SYSTEM_PROMPT
    try:
        from api.models import PromptTemplate as _PT
        _tmpl = (
            db.query(_PT)
            .filter(_PT.category == "admin_enrich", _PT.is_active == True)  # noqa: E712
            .first()
        )
        if _tmpl and _tmpl.content and _tmpl.content.strip():
            _enrich_template = _tmpl.content.strip()
    except Exception:
        pass
    try:
        system_prompt = _enrich_template.format(
            schema=schema_text,
            gaps=gaps_text or "None — all tables and columns have descriptions!",
            gap_count=gap_count,
        )
    except KeyError:
        # Admin edited away a required placeholder — fall back to hardcoded
        system_prompt = _ENRICH_SYSTEM_PROMPT.format(
            schema=schema_text,
            gaps=gaps_text or "None — all tables and columns have descriptions!",
            gap_count=gap_count,
        )

    # ── Resolve session & history ───────────────────────────────
    session: EnrichSession | None = None
    if req.session_id:
        session = db.query(EnrichSession).filter(EnrichSession.id == req.session_id).first()

    if session:
        # Load history from DB
        db_msgs = (db.query(EnrichMessage)
                     .filter(EnrichMessage.session_id == session.id)
                     .order_by(EnrichMessage.created_at)
                     .all())
        history_msgs = [{"role": m.role, "content": m.content} for m in db_msgs]
    else:
        history_msgs = [
            {"role": h.get("role", "user"), "content": h.get("content", "")}
            for h in req.history
            if h.get("role") in ("user", "assistant")
        ]

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history_msgs)
    messages.append({"role": "user", "content": req.message})

    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=0.4,
        max_tokens=1500,
    )
    raw_response: str = completion.choices[0].message.content or ""

    # ── Parse SCHEMA_UPDATES block ──────────────────────────────
    updates: list[dict] | None = None
    display_response = raw_response
    import re as _re
    match = _re.search(
        r"\[SCHEMA_UPDATES\]\s*(.*?)\s*\[/SCHEMA_UPDATES\]",
        raw_response,
        _re.DOTALL,
    )
    if match:
        try:
            parsed = json.loads(match.group(1))
            updates = parsed.get("updates") or []
            display_response = _re.sub(
                r"\[SCHEMA_UPDATES\].*?\[/SCHEMA_UPDATES\]",
                "",
                raw_response,
                flags=_re.DOTALL,
            ).strip()
        except Exception:
            updates = None

    # ── Persist to session ──────────────────────────────────────
    if session:
        # Set title from first user message if not yet set
        if not session.title:
            session.title = req.message[:80]
            db.add(session)
        db.add(EnrichMessage(session_id=session.id, role="user",      content=req.message))
        db.add(EnrichMessage(session_id=session.id, role="assistant", content=display_response))
        session.updated_at = datetime.utcnow()
        db.commit()

    return {
        "response":       display_response,
        "updates":        updates,
        "gaps_remaining": gap_count,
        "session_id":     session.id if session else None,
    }


# ══════════════════════════════════════════════════════════════
# Document Upload → Metadata Extraction
# POST /api/admin/enrich-doc/{conn_id}
# ══════════════════════════════════════════════════════════════

@router.post("/admin/enrich-doc/{conn_id}")
async def enrich_from_document(
    conn_id: int,
    file: UploadFile = File(...),
    session_id: int = Form(None),
    db: Session = Depends(get_db),
):
    """
    Upload any document (PDF, DOCX, TXT, CSV, XLSX, etc.).
    Extract text, pass to GPT with the current schema, and return
    structured metadata updates for user preview before applying.
    """
    import io, csv, re as _re

    api_key = settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured")

    raw_bytes = await file.read()
    filename  = (file.filename or "document").lower()
    text = ""

    try:
        # ── Text extraction by file type ──────────────────────
        if filename.endswith(".pdf"):
            try:
                import pdfplumber
                with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
                    text = "\n".join(p.extract_text() or "" for p in pdf.pages)
            except ImportError:
                # Fallback: raw bytes decode
                text = raw_bytes.decode("utf-8", errors="replace")

        elif filename.endswith((".docx",)):
            try:
                import docx as _docx
                doc = _docx.Document(io.BytesIO(raw_bytes))
                text = "\n".join(p.text for p in doc.paragraphs)
            except ImportError:
                text = raw_bytes.decode("utf-8", errors="replace")

        elif filename.endswith((".xlsx", ".xls")):
            try:
                import openpyxl
                wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
                lines = []
                for ws in wb.worksheets:
                    lines.append(f"[Sheet: {ws.title}]")
                    for row in ws.iter_rows(max_row=200, values_only=True):
                        if any(c is not None for c in row):
                            lines.append("\t".join(str(c) if c is not None else "" for c in row))
                text = "\n".join(lines)
            except ImportError:
                text = raw_bytes.decode("utf-8", errors="replace")

        elif filename.endswith(".csv"):
            decoded = raw_bytes.decode("utf-8", errors="replace")
            reader  = csv.reader(decoded.splitlines())
            lines   = ["\t".join(row) for row in reader][:200]
            text    = "\n".join(lines)

        else:
            # TXT, MD, JSON, XML, or any other text format
            text = raw_bytes.decode("utf-8", errors="replace")

    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read file: {exc}")

    if not text.strip():
        raise HTTPException(status_code=422, detail="No readable text found in the uploaded file.")

    # Truncate to ~6000 chars to stay within token limits
    text = text[:6000] + ("…[truncated]" if len(text) > 6000 else "")

    # ── Build schema summary ───────────────────────────────────
    tree        = _build_tree(conn_id, db)
    schema_text = _tree_to_compact_text(tree)

    doc_prompt = f"""\
You are a Schema Enrichment AI. The user has uploaded a business document.
Your job: extract ONLY metadata that can be applied to the schema columns listed below.

Return a JSON object in this exact format:
{{
  "summary": "1-2 sentence summary of what the document is and what metadata was found",
  "updates": [
    {{
      "table_name": "TableName",
      "column_name": "ColumnName",
      "description": "...",
      "business_context": "...",
      "aliases": "alias1, alias2",
      "synonyms": ["phrase1", "phrase2"]
    }}
  ]
}}

Rules:
- Only include columns that exist in the schema below.
- Leave any field blank ("") if you don't have info for it.
- Set column_name to null for table-level metadata.
- Return valid JSON only, no other text.

## Schema
{schema_text[:3000]}

## Document Content
{text}
"""

    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": doc_prompt}],
        temperature=0.2,
        max_tokens=2000,
        response_format={"type": "json_object"},
    )
    raw_json = completion.choices[0].message.content or "{}"

    try:
        parsed   = json.loads(raw_json)
        updates  = parsed.get("updates") or []
        summary  = parsed.get("summary", "Document processed.")
    except Exception:
        raise HTTPException(status_code=500, detail="AI returned invalid JSON. Try again.")

    # ── Optionally save summary message to session ─────────────
    if session_id:
        session = db.query(EnrichSession).filter(EnrichSession.id == session_id).first()
        if session:
            msg_text = f"📄 Uploaded document: **{file.filename}**\n\n{summary}\n\n{len(updates)} metadata updates extracted."
            if not session.title:
                session.title = f"Doc: {file.filename}"[:80]
                db.add(session)
            db.add(EnrichMessage(session_id=session_id, role="user",      content=f"[Uploaded document: {file.filename}]"))
            db.add(EnrichMessage(session_id=session_id, role="assistant", content=msg_text))
            session.updated_at = datetime.utcnow()
            db.commit()

    return {
        "filename":  file.filename,
        "summary":   summary,
        "updates":   updates,
        "char_read": len(text),
    }


# ══════════════════════════════════════════════════════════════
# Enrich Session CRUD
# ══════════════════════════════════════════════════════════════

@router.post("/admin/enrich-sessions/{conn_id}")
def create_enrich_session(conn_id: int, db: Session = Depends(get_db)):
    """Create a new blank enrichment session for a connection."""
    session = EnrichSession(conn_id=conn_id, title=None)
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"id": session.id, "conn_id": session.conn_id, "title": session.title,
            "created_at": session.created_at, "message_count": 0}


@router.get("/admin/enrich-sessions/{conn_id}")
def list_enrich_sessions(conn_id: int, db: Session = Depends(get_db)):
    """List all enrichment sessions for a connection, newest first."""
    sessions = (db.query(EnrichSession)
                  .filter(EnrichSession.conn_id == conn_id)
                  .order_by(EnrichSession.updated_at.desc())
                  .all())
    result = []
    for s in sessions:
        msg_count = db.query(EnrichMessage).filter(EnrichMessage.session_id == s.id).count()
        result.append({
            "id":            s.id,
            "conn_id":       s.conn_id,
            "title":         s.title or "New Chat",
            "created_at":    s.created_at,
            "updated_at":    s.updated_at,
            "message_count": msg_count,
        })
    return result


@router.get("/admin/enrich-sessions/session/{session_id}")
def get_enrich_session(session_id: int, db: Session = Depends(get_db)):
    """Get a session with all its messages."""
    session = db.query(EnrichSession).filter(EnrichSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = (db.query(EnrichMessage)
                  .filter(EnrichMessage.session_id == session_id)
                  .order_by(EnrichMessage.created_at)
                  .all())
    return {
        "id":         session.id,
        "conn_id":    session.conn_id,
        "title":      session.title or "New Chat",
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "messages":   [{"role": m.role, "content": m.content, "created_at": m.created_at}
                       for m in messages],
    }


@router.delete("/admin/enrich-sessions/session/{session_id}")
def delete_enrich_session(session_id: int, db: Session = Depends(get_db)):
    """Delete a session and all its messages."""
    db.query(EnrichMessage).filter(EnrichMessage.session_id == session_id).delete()
    db.query(EnrichSession).filter(EnrichSession.id == session_id).delete()
    db.commit()
    return {"deleted": session_id}


# ══════════════════════════════════════════════════════════════
# Prompt Templates — AI backbone prompt management
# GET    /api/admin/prompt-templates
# POST   /api/admin/prompt-templates
# GET    /api/admin/prompt-templates/{id}
# PUT    /api/admin/prompt-templates/{id}
# DELETE /api/admin/prompt-templates/{id}
# ══════════════════════════════════════════════════════════════

from api.schemas import PromptTemplateCreate, PromptTemplateUpdate, PromptTemplateOut  # noqa: E402


@router.get("/admin/prompt-templates", response_model=list[PromptTemplateOut])
def list_prompt_templates(
    category: Optional[str] = None,
    conn_id:  Optional[int] = None,
    db: Session = Depends(get_db),
):
    from api.models import PromptTemplate
    from sqlalchemy import or_
    q = db.query(PromptTemplate)
    if category:
        q = q.filter(PromptTemplate.category == category)
    if conn_id is not None:
        # Show global templates (conn_id IS NULL) + templates for this connection
        q = q.filter(or_(PromptTemplate.conn_id == None, PromptTemplate.conn_id == conn_id))  # noqa: E711
    return q.order_by(PromptTemplate.name).all()


@router.post("/admin/prompt-templates", response_model=PromptTemplateOut)
def create_prompt_template(req: PromptTemplateCreate, db: Session = Depends(get_db)):
    from api.models import PromptTemplate
    row = PromptTemplate(**req.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/admin/prompt-templates/{template_id}", response_model=PromptTemplateOut)
def get_prompt_template(template_id: int, db: Session = Depends(get_db)):
    from api.models import PromptTemplate
    row = db.query(PromptTemplate).filter(PromptTemplate.id == template_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Prompt template not found")
    return row


@router.put("/admin/prompt-templates/{template_id}", response_model=PromptTemplateOut)
def update_prompt_template(template_id: int, req: PromptTemplateUpdate, db: Session = Depends(get_db)):
    from api.models import PromptTemplate
    row = db.query(PromptTemplate).filter(PromptTemplate.id == template_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Prompt template not found")
    for field, value in req.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


@router.delete("/admin/prompt-templates/{template_id}")
def delete_prompt_template(template_id: int, db: Session = Depends(get_db)):
    from api.models import PromptTemplate
    row = db.query(PromptTemplate).filter(PromptTemplate.id == template_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Prompt template not found")
    db.delete(row)
    db.commit()
    return {"deleted": template_id}


# ══════════════════════════════════════════════════════════════
# AI Context Preview + Cache Invalidation
# GET   /api/admin/ai-context/{conn_id}
# POST  /api/admin/ai-context/{conn_id}/invalidate
# ══════════════════════════════════════════════════════════════

@router.get("/admin/ai-context/{conn_id}")
def get_ai_context(conn_id: int, db: Session = Depends(get_db)):
    """Return a summary of the AI context for a connection (what all AI modules see)."""
    from api.services.context_cache import get_summary
    return get_summary(conn_id, db)


@router.post("/admin/ai-context/{conn_id}/invalidate")
def invalidate_ai_context(conn_id: int):
    """Force the context cache to refresh on next AI call for this connection."""
    from api.services.context_cache import invalidate
    invalidate(conn_id)
    return {"invalidated": conn_id}


# ══════════════════════════════════════════════════════════════
# AI Readiness Score
# GET /api/admin/ai-readiness/{conn_id}
# ══════════════════════════════════════════════════════════════

from api.schemas import AIReadinessOut  # noqa: E402


@router.get("/admin/ai-readiness/{conn_id}", response_model=AIReadinessOut)
def get_ai_readiness(conn_id: int, db: Session = Depends(get_db)):
    """
    Return an AI readiness score for a connection based on schema completeness.
    Score = weighted average of: table descriptions, embeddings, FK relations,
            query examples, prompt templates.
    """
    from api.models import (
        CatalogColumn, ColumnEmbedding, CatalogRelation,
        QueryExample, SchemaMetadata,
    )

    # Count distinct tables in catalog
    tables_total = (
        db.query(CatalogColumn.table_name)
        .filter(CatalogColumn.conn_id == conn_id)
        .distinct()
        .count()
    )

    # Tables with any description or business_context (table- OR column-level)
    described_tables = (
        db.query(SchemaMetadata.table_name)
        .filter(
            SchemaMetadata.conn_id == conn_id,
            (SchemaMetadata.description != None) | (SchemaMetadata.business_context != None),  # noqa: E711
        )
        .distinct()
        .count()
    )

    # Columns with embeddings
    cols_with_embeddings = (
        db.query(ColumnEmbedding)
        .filter(ColumnEmbedding.conn_id == conn_id)
        .count()
    )

    fk_relations = (
        db.query(CatalogRelation)
        .filter(CatalogRelation.conn_id == conn_id)
        .count()
    )

    query_examples = (
        db.query(QueryExample)
        .filter(
            QueryExample.is_active == True,  # noqa: E712
            (QueryExample.conn_id == conn_id) | (QueryExample.conn_id == None),  # noqa: E711
        )
        .count()
    )

    try:
        from api.models import PromptTemplate
        active_templates = (
            db.query(PromptTemplate)
            .filter(PromptTemplate.is_active == True)  # noqa: E712
            .count()
        )
    except Exception:
        active_templates = 0

    # Weighted score (0.0 – 1.0)
    score_parts = []
    if tables_total > 0:
        score_parts.append(min(1.0, described_tables / tables_total))  # 25%
        total_cols = db.query(CatalogColumn).filter(CatalogColumn.conn_id == conn_id).count()
        score_parts.append(min(1.0, cols_with_embeddings / max(total_cols, 1)))  # 25%
    else:
        score_parts.extend([0.0, 0.0])

    score_parts.append(min(1.0, fk_relations / 5))       # 20% — 5 relations = full score
    score_parts.append(min(1.0, query_examples / 5))      # 15% — 5 examples = full score
    score_parts.append(min(1.0, active_templates / 3))    # 15% — 3 templates = full score

    weights = [0.25, 0.25, 0.20, 0.15, 0.15]
    readiness = sum(p * w for p, w in zip(score_parts, weights))

    return AIReadinessOut(
        tables_total=tables_total,
        tables_with_description=described_tables,
        columns_with_embeddings=cols_with_embeddings,
        fk_relations=fk_relations,
        query_examples=query_examples,
        active_prompt_templates=active_templates,
        readiness_score=round(readiness, 3),
    )


# ══════════════════════════════════════════════════════════════
# AI Trace Log — centralized LLM call history
# GET    /api/admin/ai-traces
# DELETE /api/admin/ai-traces/{id}
# DELETE /api/admin/ai-traces  (bulk purge by age)
# ══════════════════════════════════════════════════════════════

from api.schemas import AITraceOut  # noqa: E402


@router.get("/admin/ai-traces", response_model=list[AITraceOut])
def list_ai_traces(
    conn_id: Optional[int] = None,
    module: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    from api.services import ai_trace
    return ai_trace.get_traces(db, conn_id=conn_id, module=module, limit=limit)


@router.delete("/admin/ai-traces/{trace_id}")
def delete_ai_trace(trace_id: int, db: Session = Depends(get_db)):
    from api.services import ai_trace
    deleted = ai_trace.delete_trace(db, trace_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Trace not found")
    return {"deleted": trace_id}


@router.delete("/admin/ai-traces")
def purge_ai_traces(older_than_days: int = 30, db: Session = Depends(get_db)):
    from api.services import ai_trace
    count = ai_trace.purge_old(db, older_than_days=older_than_days)
    return {"purged": count, "older_than_days": older_than_days}


# ══════════════════════════════════════════════════════════════
# External Integrations (JIRA / Azure DevOps)
# GET    /api/admin/integrations
# POST   /api/admin/integrations
# DELETE /api/admin/integrations/{type}
# ══════════════════════════════════════════════════════════════

class IntegrationSave(BaseModel):
    type:       str            # 'jira' | 'ado'
    base_url:   str
    username:   Optional[str] = None
    token:      str            # plain-text — will be encrypted at rest
    project_id: Optional[int] = None


@router.get("/admin/integrations")
def list_integrations(project_id: Optional[int] = None, db: Session = Depends(get_db)):
    from api.models import ExternalIntegration
    q = db.query(ExternalIntegration)
    if project_id is not None:
        q = q.filter(ExternalIntegration.project_id == project_id)
    rows = q.all()
    # Never return the encrypted token — just metadata
    return [
        {
            "id": r.id,
            "type": r.type,
            "project_id": r.project_id,
            "base_url": r.base_url,
            "username": r.username,
            "is_active": r.is_active,
            "has_token": bool(r.token_enc),
            "updated_at": r.updated_at,
        }
        for r in rows
    ]


@router.post("/admin/integrations")
def save_integration(req: IntegrationSave, db: Session = Depends(get_db)):
    from api.models import ExternalIntegration
    from api.services.encryption import encrypt
    from sqlalchemy.exc import IntegrityError

    encrypted = encrypt(req.token) if req.token else None

    # ── Look up by (type, project_id) ────────────────────────
    q = db.query(ExternalIntegration).filter(ExternalIntegration.type == req.type)
    if req.project_id is not None:
        q = q.filter(ExternalIntegration.project_id == req.project_id)
    else:
        q = q.filter(ExternalIntegration.project_id.is_(None))
    row = q.first()

    if row:
        # UPDATE existing
        row.base_url   = req.base_url
        row.username   = req.username
        row.token_enc  = encrypted if req.token else row.token_enc
        row.project_id = req.project_id
        db.commit()
    else:
        # Try INSERT; fall back to UPDATE-any-row-of-same-type if the old
        # single-column UNIQUE constraint on `type` is still present in the DB
        row = ExternalIntegration(
            type       = req.type,
            project_id = req.project_id,
            base_url   = req.base_url,
            username   = req.username,
            token_enc  = encrypted,
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            # Constraint on `type` alone — update whichever row exists for this type
            fallback = db.query(ExternalIntegration).filter(
                ExternalIntegration.type == req.type
            ).first()
            if fallback:
                fallback.base_url   = req.base_url
                fallback.username   = req.username
                fallback.token_enc  = encrypted if req.token else fallback.token_enc
                fallback.project_id = req.project_id
                db.commit()
                row = fallback
            else:
                raise HTTPException(status_code=500, detail="Failed to save integration — unique constraint conflict")

    db.refresh(row)
    return {"id": row.id, "type": row.type, "project_id": row.project_id, "base_url": row.base_url, "username": row.username}


@router.delete("/admin/integrations/{int_type}")
def delete_integration(int_type: str, project_id: Optional[int] = None, db: Session = Depends(get_db)):
    from api.models import ExternalIntegration
    q = db.query(ExternalIntegration).filter(ExternalIntegration.type == int_type)
    if project_id is not None:
        q = q.filter(ExternalIntegration.project_id == project_id)
    else:
        q = q.filter(ExternalIntegration.project_id.is_(None))
    row = q.first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Integration '{int_type}' not found")
    db.delete(row)
    db.commit()
    return {"deleted": int_type}


# ══════════════════════════════════════════════════════════════
# Query Examples  —  few-shot SQL examples injected into AI prompts
# GET    /api/admin/query-examples/{conn_id}
# POST   /api/admin/query-examples/{conn_id}
# PUT    /api/admin/query-examples/{conn_id}/{example_id}
# DELETE /api/admin/query-examples/{conn_id}/{example_id}
# ══════════════════════════════════════════════════════════════

class QueryExampleSave(BaseModel):
    name:        str
    description: Optional[str] = None
    tables_used: Optional[str] = None   # comma-separated
    example_sql: str
    is_active:   bool = True


@router.get("/admin/query-examples/{conn_id}")
def list_query_examples(conn_id: int, db: Session = Depends(get_db)):
    from api.models import QueryExample
    rows = (
        db.query(QueryExample)
        .filter((QueryExample.conn_id == conn_id) | (QueryExample.conn_id == None))  # noqa: E711
        .order_by(QueryExample.created_at.desc())
        .all()
    )
    return [
        {
            "id":          r.id,
            "conn_id":     r.conn_id,
            "name":        r.name,
            "description": r.description,
            "tables_used": r.tables_used,
            "example_sql": r.example_sql,
            "is_active":   r.is_active,
            "created_at":  r.created_at,
            "updated_at":  r.updated_at,
        }
        for r in rows
    ]


@router.post("/admin/query-examples/{conn_id}", status_code=201)
def create_query_example(conn_id: int, req: QueryExampleSave, db: Session = Depends(get_db)):
    from api.models import QueryExample
    row = QueryExample(
        conn_id     = conn_id,
        name        = req.name,
        description = req.description,
        tables_used = req.tables_used,
        example_sql = req.example_sql,
        is_active   = req.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}


@router.put("/admin/query-examples/{conn_id}/{example_id}")
def update_query_example(conn_id: int, example_id: int, req: QueryExampleSave, db: Session = Depends(get_db)):
    from api.models import QueryExample
    row = db.query(QueryExample).filter(QueryExample.id == example_id, QueryExample.conn_id == conn_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Query example not found")
    row.name        = req.name
    row.description = req.description
    row.tables_used = req.tables_used
    row.example_sql = req.example_sql
    row.is_active   = req.is_active
    row.updated_at  = datetime.utcnow()
    db.commit()
    return {"id": row.id, "name": row.name}


@router.delete("/admin/query-examples/{conn_id}/{example_id}")
def delete_query_example(conn_id: int, example_id: int, db: Session = Depends(get_db)):
    from api.models import QueryExample
    row = db.query(QueryExample).filter(QueryExample.id == example_id, QueryExample.conn_id == conn_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Query example not found")
    db.delete(row)
    db.commit()
    return {"deleted": example_id}


# ══════════════════════════════════════════════════════════════
# Query Examples — AI helpers
# POST /api/admin/query-examples/{conn_id}/ai-generate-sql   — fill SQL for one intent
# POST /api/admin/query-examples/{conn_id}/ai-generate-batch — suggest multiple examples
# POST /api/admin/query-examples/{conn_id}/ai-extract        — extract from file or text
# ══════════════════════════════════════════════════════════════

class AIGenerateSqlReq(BaseModel):
    intent:    str              # user's description / natural-language request
    api_key:   Optional[str] = None
    model:     str           = "gpt-4o-mini"


class AIGenerateBatchReq(BaseModel):
    api_key:   Optional[str] = None
    model:     str           = "gpt-4o-mini"


def _build_schema_text_for_conn(conn_id: int, db: Session) -> str:
    """Build a compact schema string: table → columns."""
    from collections import defaultdict
    cols = (
        db.query(CatalogColumn)
        .filter(CatalogColumn.conn_id == conn_id)
        .order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position)
        .all()
    )
    tables: dict[str, list[str]] = defaultdict(list)
    for c in cols:
        suffix = " [PK]" if c.is_primary_key else ""
        tables[c.table_name].append(f"  - {c.column_name} ({c.data_type or 'unknown'}){suffix}")
    return "\n".join(
        f"Table: {tbl}\n" + "\n".join(col_lines)
        for tbl, col_lines in sorted(tables.items())
    )


@router.post("/admin/query-examples/{conn_id}/ai-generate-sql")
def ai_generate_example_sql(conn_id: int, req: AIGenerateSqlReq, db: Session = Depends(get_db)):
    """
    Generate a single SQL query + auto-detect tables_used for a given intent/description.
    """
    from api.config import settings
    from openai import OpenAI

    api_key = (req.api_key or "").strip() or settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="No OpenAI API key configured")

    schema_text = _build_schema_text_for_conn(conn_id, db)
    if not schema_text:
        raise HTTPException(status_code=404, detail="No schema found — run Collect Schema first")

    # Also fetch query_context if any
    from api.models import QueryContext
    ctx_row = db.query(QueryContext).filter(QueryContext.conn_id == conn_id).first()
    context_hint = f"\n\nAdditional context:\n{ctx_row.content}" if ctx_row and ctx_row.content else ""

    prompt = f"""You are a SQL expert. Given the database schema below, write a SQL query that fulfils the user's intent.

Schema:
{schema_text}{context_hint}

User intent: {req.intent}

Respond with ONLY a JSON object (no markdown):
{{
  "example_sql": "the complete SQL query",
  "tables_used": "comma-separated list of tables actually referenced in the query"
}}"""

    client = OpenAI(api_key=api_key)
    try:
        resp = client.chat.completions.create(
            model=req.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        raw = (resp.choices[0].message.content or "{}").strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
            if raw.endswith("```"):
                raw = raw[:-3]
        result = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    return {
        "example_sql": result.get("example_sql", ""),
        "tables_used": result.get("tables_used", ""),
    }


@router.post("/admin/query-examples/{conn_id}/ai-generate-batch")
def ai_generate_example_batch(conn_id: int, req: AIGenerateBatchReq, db: Session = Depends(get_db)):
    """
    Generate 5 diverse, useful query examples from the schema automatically.
    Returns suggestions the user can review and selectively save.
    """
    from api.config import settings
    from openai import OpenAI

    api_key = (req.api_key or "").strip() or settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="No OpenAI API key configured")

    schema_text = _build_schema_text_for_conn(conn_id, db)
    if not schema_text:
        raise HTTPException(status_code=404, detail="No schema found — run Collect Schema first")

    # Fetch existing example names to avoid duplicates
    from api.models import QueryExample
    existing_names = {
        r.name.lower()
        for r in db.query(QueryExample.name).filter(QueryExample.conn_id == conn_id).all()
    }

    prompt = f"""You are a SQL expert. Given the database schema below, generate 5 diverse and useful query examples that would help a developer understand this database.
Cover different use cases: aggregations, joins, filtering, date ranges, ranking — whatever makes sense for these tables.

Schema:
{schema_text}

Respond with ONLY a JSON array (no markdown). Each element:
{{
  "name":        "short descriptive title (max 60 chars)",
  "description": "one sentence explaining what the query does",
  "tables_used": "comma-separated table names used in the query",
  "example_sql": "the complete SQL query"
}}

Rules:
- Use correct table/column names from the schema above
- Write realistic, runnable SQL
- Each example should serve a different business purpose
- Return exactly 5 examples"""

    client = OpenAI(api_key=api_key)
    try:
        resp = client.chat.completions.create(
            model=req.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
        )
        raw = (resp.choices[0].message.content or "[]").strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
            if raw.endswith("```"):
                raw = raw[:-3]
        suggestions = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    # Filter out ones with the same name as existing examples
    filtered = [
        s for s in suggestions
        if s.get("name", "").lower() not in existing_names
    ]

    return {"suggestions": filtered}


@router.post("/admin/query-examples/{conn_id}/ai-extract")
async def ai_extract_examples(
    conn_id: int,
    file: Optional[UploadFile] = File(None),
    text: str = Form(""),
    model: str = Form("gpt-4o-mini"),
    db: Session = Depends(get_db),
):
    """
    Extract named query examples from user-supplied content (file upload and/or pasted text).
    Supported file types: .sql, .txt, .md, .csv (treated as plain text).
    Returns AI-parsed suggestions: name, description, tables_used, example_sql.
    """
    from api.config import settings
    from openai import OpenAI

    api_key = settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="No OpenAI API key configured")

    # ── Collect raw content ─────────────────────────────────
    parts: list[str] = []

    if file and file.filename:
        raw_bytes = await file.read()
        try:
            file_text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            file_text = raw_bytes.decode("latin-1", errors="replace")
        parts.append(f"--- File: {file.filename} ---\n{file_text}")

    if text.strip():
        parts.append(f"--- Pasted text ---\n{text.strip()}")

    if not parts:
        raise HTTPException(status_code=400, detail="Provide a file or pasted text")

    content = "\n\n".join(parts)
    if len(content) > 60_000:
        content = content[:60_000] + "\n... (truncated)"

    # ── Schema hint (optional — helps AI infer table names) ─
    schema_hint = ""
    try:
        schema_hint = _build_schema_text_for_conn(conn_id, db)
        if schema_hint:
            schema_hint = f"\n\nDatabase schema (for reference when identifying table names):\n{schema_hint[:8000]}"
    except Exception:
        pass

    # ── Existing example names (avoid duplicates) ───────────
    from api.models import QueryExample
    existing_names = {
        r.name.lower()
        for r in db.query(QueryExample.name).filter(QueryExample.conn_id == conn_id).all()
    }

    prompt = f"""You are a SQL expert. The user has provided the following content which may contain SQL queries, query descriptions, or both.
Your job is to extract every distinct SQL query (or intent that can become one) and return structured examples.{schema_hint}

User content:
{content}

Return ONLY a JSON array (no markdown fences). Each element:
{{
  "name":        "short descriptive title for this query (max 60 chars)",
  "description": "one sentence describing what it does",
  "tables_used": "comma-separated list of SQL tables/views referenced",
  "example_sql": "the complete, clean SQL query"
}}

Rules:
- If the content already contains SQL, preserve it exactly (fix obvious syntax errors only)
- If the content describes a query in plain English, write the SQL that fulfils the description
- Deduplicate — if the same query appears more than once, include it only once
- Skip queries that are trivially simple (e.g. SELECT 1) unless they serve a clear purpose
- Return an empty array [] if no meaningful queries can be extracted
- Return raw JSON only"""

    client = OpenAI(api_key=api_key)
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
        )
        raw = (resp.choices[0].message.content or "[]").strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
            if raw.endswith("```"):
                raw = raw[:-3]
        suggestions = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {exc}")

    filtered = [
        s for s in suggestions
        if s.get("name", "").lower() not in existing_names
    ]

    return {"suggestions": filtered, "total_found": len(suggestions)}


# ══════════════════════════════════════════════════════════════
# Table Relations — manual CRUD + AI-suggest
# GET    /api/admin/relations/{conn_id}
# POST   /api/admin/relations/{conn_id}
# DELETE /api/admin/relations/{conn_id}/{relation_id}
# POST   /api/admin/relations/{conn_id}/ai-suggest
# ══════════════════════════════════════════════════════════════

class RelationIn(BaseModel):
    parent_table:      str
    parent_column:     str
    referenced_table:  str
    referenced_column: str
    fk_name:           Optional[str] = None


@router.get("/admin/relations/{conn_id}")
def list_relations(conn_id: int, db: Session = Depends(get_db)):
    rows = db.query(CatalogRelation).filter(CatalogRelation.conn_id == conn_id)\
             .order_by(CatalogRelation.parent_table).all()
    return [
        {
            "id":               r.id,
            "fk_name":          r.fk_name,
            "parent_table":     r.parent_table,
            "parent_column":    r.parent_column,
            "referenced_table": r.referenced_table,
            "referenced_column":r.referenced_column,
            "source":           (
                "ai"     if (r.fk_name and r.fk_name.startswith("ai_")) else
                "manual" if (r.fk_name and r.fk_name.startswith("manual_")) else
                "fk"
            ),
        }
        for r in rows
    ]


@router.post("/admin/relations/{conn_id}", status_code=201)
def add_relation(conn_id: int, req: RelationIn, db: Session = Depends(get_db)):
    # Prevent exact duplicates
    exists = db.query(CatalogRelation).filter(
        CatalogRelation.conn_id           == conn_id,
        CatalogRelation.parent_table      == req.parent_table,
        CatalogRelation.parent_column     == req.parent_column,
        CatalogRelation.referenced_table  == req.referenced_table,
        CatalogRelation.referenced_column == req.referenced_column,
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail="Relation already exists")

    fk_name = req.fk_name or f"manual_{req.parent_table}_{req.parent_column}"
    source  = "ai" if fk_name.startswith("ai_") else "manual"

    row = CatalogRelation(
        conn_id           = conn_id,
        fk_name           = fk_name,
        parent_table      = req.parent_table,
        parent_column     = req.parent_column,
        referenced_table  = req.referenced_table,
        referenced_column = req.referenced_column,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id, "fk_name": row.fk_name,
        "parent_table": row.parent_table, "parent_column": row.parent_column,
        "referenced_table": row.referenced_table, "referenced_column": row.referenced_column,
        "source": source,
    }


@router.delete("/admin/relations/{conn_id}/{relation_id}")
def delete_relation(conn_id: int, relation_id: int, db: Session = Depends(get_db)):
    row = db.query(CatalogRelation).filter(
        CatalogRelation.id == relation_id,
        CatalogRelation.conn_id == conn_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Relation not found")
    db.delete(row)
    db.commit()
    return {"deleted": relation_id}


class AISuggestRelationsReq(BaseModel):
    api_key:    Optional[str] = None
    model:      str           = "gpt-4o-mini"


@router.post("/admin/relations/{conn_id}/ai-suggest")
def ai_suggest_relations(conn_id: int, req: AISuggestRelationsReq, db: Session = Depends(get_db)):
    """
    Ask the LLM to suggest likely FK relations based on column names, data types,
    and naming conventions (e.g. customer_id → customers.id).
    Returns a list of suggested relations with confidence and reasoning.
    """
    from api.config import settings
    from openai import OpenAI

    api_key = (req.api_key or "").strip() or settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="No OpenAI API key provided")

    # Build a compact schema summary for the prompt
    cols = db.query(CatalogColumn).filter(CatalogColumn.conn_id == conn_id)\
             .order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position).all()
    if not cols:
        raise HTTPException(status_code=404, detail="No schema found — run Collect Schema first")

    # Group columns by table
    from collections import defaultdict
    tables: dict[str, list[str]] = defaultdict(list)
    pk_cols: set[str] = set()
    for c in cols:
        suffix = " [PK]" if c.is_primary_key else ""
        tables[c.table_name].append(f"  - {c.column_name} ({c.data_type or 'unknown'}){suffix}")
        if c.is_primary_key:
            pk_cols.add(f"{c.table_name}.{c.column_name}")

    schema_text = "\n".join(
        f"Table: {tbl}\n" + "\n".join(col_lines)
        for tbl, col_lines in sorted(tables.items())
    )

    # Load existing relations to avoid re-suggesting them
    existing = db.query(CatalogRelation).filter(CatalogRelation.conn_id == conn_id).all()
    existing_set = {
        (r.parent_table, r.parent_column, r.referenced_table, r.referenced_column)
        for r in existing
    }

    prompt = f"""You are a database architect. Given this schema, identify likely foreign key relationships
that are NOT yet defined as formal FK constraints. Focus on columns that follow common naming conventions:
- A column named `<table>_id` or `<table>id` likely references `<table>.id` or `<table>.<pk_col>`
- A column named `customer_id` likely references the `customers` or `customer` table
- Look for shared column names across tables (e.g., dept_code, status_code)

Schema:
{schema_text}

Known primary keys: {', '.join(sorted(pk_cols)) or 'none'}

Return ONLY a JSON array of suggested relations. Each element:
{{
  "parent_table":      "table that has the FK column",
  "parent_column":     "the FK column",
  "referenced_table":  "table being referenced",
  "referenced_column": "the PK/unique column referenced",
  "confidence":        0.0-1.0,
  "reason":            "one sentence explaining why"
}}

Rules:
- Only suggest relations where you are at least 60% confident
- Only include relations not already obvious from the FK constraints above
- Maximum 15 suggestions
- Return raw JSON array, no markdown"""

    client = OpenAI(api_key=api_key)
    try:
        resp = client.chat.completions.create(
            model=req.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        raw = resp.choices[0].message.content or "[]"
        # Strip markdown fences if present
        raw = raw.strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
            if raw.endswith("```"):
                raw = raw[:-3]
        suggestions = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {exc}")

    # Filter out already-existing relations
    filtered = [
        s for s in suggestions
        if (s.get("parent_table"), s.get("parent_column"),
            s.get("referenced_table"), s.get("referenced_column")) not in existing_set
    ]

    return {"suggestions": filtered}


# ══════════════════════════════════════════════════════════════
# Debug Settings
# GET  /admin/debug-settings  — any authenticated user (read-only)
# PUT  /admin/debug-settings  — admin only (write)
# GET  /admin/debug-traces    — admin only (audit log)
# DELETE /admin/debug-traces  — admin only (purge)
# ══════════════════════════════════════════════════════════════

_SUPPORTED_DEBUG_MODULES = [
    "development", "mapping", "report", "reconciliation", "multi_compare"
]


class DebugSettingOut(BaseModel):
    module:      str
    debug_level: str
    updated_at:  Optional[str] = None


class DebugSettingsResponse(BaseModel):
    settings: list[DebugSettingOut]


class DebugSettingUpdate(BaseModel):
    module:      str
    debug_level: str


def _get_all_debug_settings(db: Session) -> DebugSettingsResponse:
    """Shared implementation for GET — used by both public and admin handlers."""
    from api.models import DebugSetting as _DS
    rows = db.query(_DS).filter(_DS.module.in_(_SUPPORTED_DEBUG_MODULES)).all()
    existing = {r.module: r for r in rows}
    result = []
    for mod in _SUPPORTED_DEBUG_MODULES:
        if mod in existing:
            r = existing[mod]
            result.append(DebugSettingOut(
                module=r.module,
                debug_level=r.debug_level or "OFF",
                updated_at=r.updated_at.isoformat() if r.updated_at else None,
            ))
        else:
            result.append(DebugSettingOut(module=mod, debug_level="OFF"))
    return DebugSettingsResponse(settings=result)


# Public GET — any authenticated user can check if debug is on
from api.dependencies import get_current_user as _get_current_user  # noqa: E402
_public_debug_router = APIRouter(dependencies=[Depends(_get_current_user)])


@_public_debug_router.get("/admin/debug-settings", response_model=DebugSettingsResponse)
def get_debug_settings_public(db: Session = Depends(get_db)):
    return _get_all_debug_settings(db)


# Admin-only write endpoints stay on the admin router
@router.put("/admin/debug-settings", response_model=DebugSettingsResponse)
def update_debug_settings(
    updates: list[DebugSettingUpdate],
    db: Session = Depends(get_db),
):
    from api.models import DebugSetting as _DS
    from datetime import datetime as _dt
    for u in updates:
        if u.module not in _SUPPORTED_DEBUG_MODULES:
            continue
        if u.debug_level not in ("OFF", "BASIC", "ADVANCED"):
            continue
        row = db.query(_DS).filter(_DS.module == u.module).first()
        if row:
            row.debug_level = u.debug_level
            row.updated_at = _dt.utcnow()
        else:
            db.add(_DS(module=u.module, debug_level=u.debug_level))
    db.commit()
    return _get_all_debug_settings(db)


class DebugTraceOut(BaseModel):
    id:          int
    trace_id:    str
    module:      str
    conn_id:     Optional[int] = None
    debug_level: str
    steps_json:  Optional[str] = None
    created_at:  str


@router.get("/admin/debug-traces", response_model=list[DebugTraceOut])
def list_debug_traces(
    module:   Optional[str] = None,
    trace_id: Optional[str] = None,
    limit:    int = 50,
    db: Session = Depends(get_db),
):
    from api.models import DebugTrace as _DT
    q = db.query(_DT)
    if module:
        q = q.filter(_DT.module == module)
    if trace_id:
        q = q.filter(_DT.trace_id == trace_id)
    rows = q.order_by(_DT.id.desc()).limit(limit).all()
    return [
        DebugTraceOut(
            id=r.id,
            trace_id=r.trace_id,
            module=r.module,
            conn_id=r.conn_id,
            debug_level=r.debug_level,
            steps_json=r.steps_json,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in rows
    ]


@router.delete("/admin/debug-traces")
def purge_debug_traces(older_than_days: int = 7, db: Session = Depends(get_db)):
    from api.models import DebugTrace as _DT
    from datetime import datetime as _dt, timedelta as _td
    cutoff = _dt.utcnow() - _td(days=older_than_days)
    count = db.query(_DT).filter(_DT.created_at < cutoff).delete()
    db.commit()
    return {"purged": count, "older_than_days": older_than_days}
