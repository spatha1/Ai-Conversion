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

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from pydantic import BaseModel

from api.database import get_db
from api.models import (
    SourceConnection,
    CatalogColumn, CatalogRelation, CatalogView, CatalogSample,
    ColumnEmbedding, SchemaMetadata,
)
from api.routers.connections import _to_cfg_from_model
from api.config import settings

router = APIRouter()


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
# Discovery generators  (one per dialect family)
# ══════════════════════════════════════════════════════════════

def _discover_mssql(conn_id: int, engine, db: Session) -> Generator[str, None, None]:
    col_count = rel_count = view_count = sample_count = 0

    with engine.connect() as src:

        # ── 1. Tables ─────────────────────────────────────────
        yield _sse("info", "📋 Collecting tables…")
        tables_rows = src.execute(__import__("sqlalchemy").text(
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE "
            "FROM INFORMATION_SCHEMA.TABLES "
            "ORDER BY TABLE_SCHEMA, TABLE_NAME"
        )).fetchall()
        base_tables   = [r for r in tables_rows if r.TABLE_TYPE == "BASE TABLE"]
        view_table_rows = [r for r in tables_rows if r.TABLE_TYPE == "VIEW"]
        yield _sse("success",
            f"✓ Found {len(base_tables)} tables + {len(view_table_rows)} views",
            {"tables": len(base_tables), "views": len(view_table_rows)})

        # ── 2. Columns + PKs ──────────────────────────────────
        yield _sse("info", "🔍 Collecting columns and primary keys…")
        from sqlalchemy import text as _text
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
        yield _sse("success", f"✓ Saved {col_count} columns", {"col_count": col_count})

        # ── 3. Foreign-key relations ───────────────────────────
        yield _sse("info", "🔗 Collecting foreign key relationships…")
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
            yield _sse("success", f"✓ Found {rel_count} FK relationships",
                       {"rel_count": rel_count})
        except Exception as exc:
            yield _sse("warn", f"⚠ Relations skipped: {str(exc)[:120]}")

        # ── 4. View definitions ────────────────────────────────
        yield _sse("info", "👁 Collecting view definitions…")
        try:
            views_rows = src.execute(_text(
                "SELECT TABLE_SCHEMA, TABLE_NAME AS view_name, VIEW_DEFINITION "
                "FROM INFORMATION_SCHEMA.VIEWS ORDER BY TABLE_NAME"
            )).fetchall()
            for row in views_rows:
                db.add(CatalogView(
                    conn_id         = conn_id,
                    view_schema     = row.TABLE_SCHEMA,
                    view_name       = row.view_name,
                    view_definition = row.VIEW_DEFINITION,
                ))
                view_count += 1
            db.commit()
            yield _sse("success", f"✓ Captured {view_count} view definitions",
                       {"view_count": view_count})
        except Exception as exc:
            yield _sse("warn", f"⚠ Views skipped: {str(exc)[:120]}")

        # ── 5. Sample rows (TOP 3 per table) ──────────────────
        yield _sse("info", f"📊 Sampling {len(base_tables)} tables (top 3 rows each)…")
        for i, tbl in enumerate(base_tables):
            schema = tbl.TABLE_SCHEMA or "dbo"
            name   = tbl.TABLE_NAME
            yield _sse("progress",
                f"  [{i+1}/{len(base_tables)}] [{schema}].[{name}]",
                {"step": i + 1, "total": len(base_tables)})
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
        yield _sse("success", f"✓ Sampled {sample_count} tables",
                   {"sample_count": sample_count})

    yield _sse("done",
        f"🎉 Discovery complete — "
        f"{len(base_tables)} tables · {col_count} columns · "
        f"{rel_count} relations · {view_count} views",
        {"tables": len(base_tables), "col_count": col_count,
         "rel_count": rel_count, "view_count": view_count,
         "sample_count": sample_count})


def _discover_snowflake(conn_id: int, cfg: dict, db: Session) -> Generator[str, None, None]:
    """Full schema discovery for Snowflake using the native connector + INFORMATION_SCHEMA."""
    from api.services.connector import _build_sf_connection
    col_count = rel_count = view_count = sample_count = 0

    conn = _build_sf_connection(cfg)
    cur  = conn.cursor()

    try:
        # ── 1. Tables ─────────────────────────────────────────
        yield _sse("info", "📋 Collecting tables…")
        cur.execute("""
            SELECT TABLE_SCHEMA, TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        """)
        base_tables = cur.fetchall()   # list of (schema, name)
        yield _sse("success", f"✓ Found {len(base_tables)} tables",
                   {"tables": len(base_tables)})

        # ── 2. Views ──────────────────────────────────────────
        yield _sse("info", "👁 Collecting views…")
        try:
            cur.execute("""
                SELECT TABLE_SCHEMA, TABLE_NAME, VIEW_DEFINITION
                FROM INFORMATION_SCHEMA.VIEWS
                ORDER BY TABLE_NAME
            """)
            for row in cur.fetchall():
                db.add(CatalogView(
                    conn_id         = conn_id,
                    view_schema     = row[0],
                    view_name       = row[1],
                    view_definition = row[2],
                ))
                view_count += 1
            db.commit()
        except Exception as exc:
            yield _sse("warn", f"⚠ Views skipped: {str(exc)[:120]}")
        yield _sse("success", f"✓ Captured {view_count} view definitions",
                   {"view_count": view_count})

        # ── 3. Columns + PKs ──────────────────────────────────
        yield _sse("info", "🔍 Collecting columns and primary keys…")
        cur.execute("""
            SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME,
                   DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
                   IS_NULLABLE, ORDINAL_POSITION
            FROM INFORMATION_SCHEMA.COLUMNS
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """)
        all_cols = cur.fetchall()

        # Build PK set from TABLE_CONSTRAINTS + KEY_COLUMN_USAGE
        pk_set: set[tuple] = set()
        try:
            cur.execute("""
                SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                   AND tc.TABLE_SCHEMA    = kcu.TABLE_SCHEMA
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            """)
            for row in cur.fetchall():
                pk_set.add((row[0], row[1], row[2]))
        except Exception:
            pass   # PKs won't be flagged but discovery still works

        for row in all_cols:
            is_pk = (row[0], row[1], row[2]) in pk_set
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
        yield _sse("success", f"✓ Saved {col_count} columns", {"col_count": col_count})

        # ── 4. Foreign-key relations ───────────────────────────
        yield _sse("info", "🔗 Collecting foreign key relationships…")
        try:
            cur.execute("""
                SELECT
                    tc.CONSTRAINT_NAME    AS fk_name,
                    kcu.TABLE_NAME        AS parent_table,
                    kcu.COLUMN_NAME       AS parent_column,
                    rcu.TABLE_NAME        AS referenced_table,
                    rcu.COLUMN_NAME       AS referenced_column
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                   AND tc.TABLE_SCHEMA    = kcu.TABLE_SCHEMA
                JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
                    ON tc.CONSTRAINT_NAME  = rc.CONSTRAINT_NAME
                   AND tc.TABLE_SCHEMA     = rc.CONSTRAINT_SCHEMA
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE rcu
                    ON rc.UNIQUE_CONSTRAINT_NAME   = rcu.CONSTRAINT_NAME
                   AND rc.UNIQUE_CONSTRAINT_SCHEMA = rcu.TABLE_SCHEMA
                   AND kcu.ORDINAL_POSITION        = rcu.ORDINAL_POSITION
                WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
            """)
            for row in cur.fetchall():
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
        yield _sse("success", f"✓ Found {rel_count} FK relationships",
                   {"rel_count": rel_count})

        # ── 5. Sample rows (LIMIT 3 per table) ────────────────
        yield _sse("info", f"📊 Sampling {len(base_tables)} tables (top 3 rows each)…")
        for i, (tbl_schema, tbl_name) in enumerate(base_tables):
            yield _sse("progress",
                f"  [{i+1}/{len(base_tables)}] {tbl_schema}.{tbl_name}",
                {"step": i + 1, "total": len(base_tables)})
            try:
                cur.execute(f'SELECT COUNT(*) FROM "{tbl_schema}"."{tbl_name}"')
                cnt = cur.fetchone()[0]
                cur.execute(f'SELECT * FROM "{tbl_schema}"."{tbl_name}" LIMIT 3')
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
        yield _sse("success", f"✓ Sampled {sample_count} tables",
                   {"sample_count": sample_count})

    finally:
        cur.close()
        conn.close()

    yield _sse("done",
        f"🎉 Discovery complete — "
        f"{len(base_tables)} tables · {col_count} columns · "
        f"{rel_count} relations · {view_count} views",
        {"tables": len(base_tables), "col_count": col_count,
         "rel_count": rel_count, "view_count": view_count,
         "sample_count": sample_count})


def _discover_generic_sql(conn_id: int, engine, db: Session) -> Generator[str, None, None]:
    """Fallback for PostgreSQL / MySQL using standard INFORMATION_SCHEMA."""
    from sqlalchemy import text as _text
    col_count = rel_count = view_count = 0

    with engine.connect() as src:
        yield _sse("info", "📋 Collecting tables…")
        tables_rows = src.execute(_text(
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE "
            "FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_SCHEMA, TABLE_NAME"
        )).fetchall()
        base_tables = [r for r in tables_rows if "VIEW" not in str(r.TABLE_TYPE).upper()]
        yield _sse("success", f"✓ Found {len(base_tables)} tables")

        yield _sse("info", "🔍 Collecting columns…")
        cols_rows = src.execute(_text(
            "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, "
            "CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, ORDINAL_POSITION "
            "FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_NAME, ORDINAL_POSITION"
        )).fetchall()
        for row in cols_rows:
            db.add(CatalogColumn(
                conn_id          = conn_id,
                table_schema     = getattr(row, "TABLE_SCHEMA", None),
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
        yield _sse("success", f"✓ Saved {col_count} columns")

        yield _sse("info", "👁 Collecting views…")
        try:
            view_rows = src.execute(_text(
                "SELECT TABLE_SCHEMA, TABLE_NAME AS view_name, VIEW_DEFINITION "
                "FROM INFORMATION_SCHEMA.VIEWS ORDER BY TABLE_NAME"
            )).fetchall()
            for row in view_rows:
                db.add(CatalogView(
                    conn_id         = conn_id,
                    view_schema     = getattr(row, "TABLE_SCHEMA", None),
                    view_name       = row.view_name,
                    view_definition = row.VIEW_DEFINITION,
                ))
                view_count += 1
            db.commit()
        except Exception:
            pass
        yield _sse("success", f"✓ Captured {view_count} views")

        yield _sse("done",
            f"🎉 Discovery complete — {len(base_tables)} tables · {col_count} columns · {view_count} views",
            {"tables": len(base_tables), "col_count": col_count,
             "rel_count": 0, "view_count": view_count, "sample_count": 0})


# ══════════════════════════════════════════════════════════════
# Endpoints
# ══════════════════════════════════════════════════════════════

@router.post("/admin/discover/{conn_id}")
def discover_schema(conn_id: int, db: Session = Depends(get_db)):
    """
    Stream schema discovery for a stored connection via SSE.
    Clears previous catalog for this connection, then discovers:
    tables, columns (with PK flags), FK relations, view definitions,
    and sample rows (top 3 per table).
    """
    conn_model = db.query(SourceConnection).filter(
        SourceConnection.id == conn_id
    ).first()
    if not conn_model:
        raise HTTPException(status_code=404, detail="Connection not found")

    cfg = _to_cfg_from_model(conn_model)

    import asyncio

    async def generate():
        # Clear existing catalog
        yield _sse("info", "🗑 Clearing previous catalog data for this connection…")
        await asyncio.sleep(0)
        _clear_catalog(conn_id, db)
        yield _sse("info", f"🔌 Connecting to [{cfg.get('database') or cfg.get('sf_database', '')}]…")
        await asyncio.sleep(0)

        try:
            if cfg.get("source_type") == "snowflake":
                gen = _discover_snowflake(conn_id, cfg, db)
            else:
                from api.services.connector import _build_sql_engine
                engine = _build_sql_engine(cfg)
                dialect = (cfg.get("dialect") or "mssql").lower()
                if dialect == "mssql":
                    gen = _discover_mssql(conn_id, engine, db)
                else:
                    gen = _discover_generic_sql(conn_id, engine, db)

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

        # Clear old embeddings for this connection
        yield _sse("info", "🗑 Clearing previous embeddings…")
        await asyncio.sleep(0)
        db.query(ColumnEmbedding).filter(
            ColumnEmbedding.conn_id == conn_id
        ).delete()
        db.commit()

        total       = len(cols)
        done_count  = 0
        error_count = 0
        yield _sse("info",
                   f"🔮 Generating embeddings for {total} columns "
                   f"using {req.model}…")
        await asyncio.sleep(0)

        for i, col in enumerate(cols):
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
