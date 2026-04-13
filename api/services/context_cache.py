"""
api/services/context_cache.py

Global in-memory schema context cache (TTL = 5 minutes).
Prevents every AI call from re-querying the same schema tables.

Usage:
    from api.services.context_cache import get_or_build, invalidate
    ctx = get_or_build(conn_id, db)
    invalidate(conn_id)   # call after schema/embeddings/metadata changes
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.orm import Session

# ── TTL (seconds) ─────────────────────────────────────────────
_TTL = 300  # 5 minutes


# ── ContextPayload ─────────────────────────────────────────────
@dataclass
class ContextPayload:
    conn_id: int
    tables: list[dict] = field(default_factory=list)          # CatalogColumn rows grouped by table
    relations: list[dict] = field(default_factory=list)       # CatalogRelation rows
    metadata: list[dict] = field(default_factory=list)        # SchemaMetadata rows
    query_examples: list[dict] = field(default_factory=list)  # QueryExample rows (active only)
    query_context: str = ""                                   # QueryContext.content
    prompt_templates: list[dict] = field(default_factory=list)  # PromptTemplate rows (active only)


# ── Internal cache store ───────────────────────────────────────
_cache: dict[int, tuple[ContextPayload, float]] = {}


def _is_fresh(ts: float) -> bool:
    return (time.monotonic() - ts) < _TTL


def invalidate(conn_id: int) -> None:
    """Remove cached context for a connection so the next call rebuilds it."""
    _cache.pop(conn_id, None)


def get_or_build(conn_id: int, db: Session) -> ContextPayload:
    """
    Return cached ContextPayload or build a fresh one from DB.
    Thread-safety: single-process Uvicorn; GIL protects dict ops.
    """
    entry = _cache.get(conn_id)
    if entry and _is_fresh(entry[1]):
        return entry[0]

    payload = _build(conn_id, db)
    _cache[conn_id] = (payload, time.monotonic())
    return payload


# ── Builder ────────────────────────────────────────────────────

def _build(conn_id: int, db: Session) -> ContextPayload:
    from api.models import (
        CatalogColumn, CatalogRelation, SchemaMetadata,
        QueryExample, QueryContext,
    )

    # Try to import PromptTemplate — may not exist yet if migration hasn't run
    try:
        from api.models import PromptTemplate
        _has_templates = True
    except ImportError:
        _has_templates = False

    # ── Catalog columns (grouped by table) ────────────────────
    cols = (
        db.query(CatalogColumn)
        .filter(CatalogColumn.conn_id == conn_id)
        .order_by(CatalogColumn.table_name, CatalogColumn.column_name)
        .all()
    )
    table_map: dict[str, list[dict]] = {}
    for c in cols:
        tbl = c.table_name
        if tbl not in table_map:
            table_map[tbl] = []
        table_map[tbl].append({
            "column": c.column_name,
            "data_type": c.data_type,
            "is_nullable": c.is_nullable,
        })
    tables = [{"table": t, "columns": cols_} for t, cols_ in table_map.items()]

    # ── Relations (FK graph) ───────────────────────────────────
    rels = (
        db.query(CatalogRelation)
        .filter(CatalogRelation.conn_id == conn_id)
        .all()
    )
    relations = [
        {
            "parent_table": r.parent_table,
            "parent_column": r.parent_column,
            "referenced_table": r.referenced_table,
            "referenced_column": r.referenced_column,
        }
        for r in rels
    ]

    # ── Schema metadata ────────────────────────────────────────
    meta_rows = (
        db.query(SchemaMetadata)
        .filter(SchemaMetadata.conn_id == conn_id)
        .all()
    )
    metadata = [
        {
            "table_name": m.table_name,
            "column_name": m.column_name,
            "aliases": m.aliases,
            "description": m.description,
            "business_context": getattr(m, "business_context", None),
        }
        for m in meta_rows
    ]

    # ── Query examples (active) ───────────────────────────────
    examples = (
        db.query(QueryExample)
        .filter(
            QueryExample.is_active == True,  # noqa: E712
            (QueryExample.conn_id == conn_id) | (QueryExample.conn_id == None),  # noqa: E711
        )
        .limit(20)
        .all()
    )
    query_examples = [
        {
            "name": e.name,
            "description": e.description,
            "tables_used": e.tables_used,
            "example_sql": e.example_sql,
        }
        for e in examples
    ]

    # ── Query context (free text) ─────────────────────────────
    qc = (
        db.query(QueryContext)
        .filter(
            (QueryContext.conn_id == conn_id) | (QueryContext.conn_id == None)  # noqa: E711
        )
        .order_by(QueryContext.id.desc())
        .first()
    )
    query_context = qc.content if qc and qc.content else ""

    # ── Prompt templates (active) ─────────────────────────────
    prompt_templates: list[dict] = []
    if _has_templates:
        try:
            tmpl_rows = (
                db.query(PromptTemplate)
                .filter(PromptTemplate.is_active == True)  # noqa: E712
                .all()
            )
            prompt_templates = [
                {
                    "name": t.name,
                    "category": t.category,
                    "content": t.content,
                }
                for t in tmpl_rows
            ]
        except Exception:
            pass  # table may not exist yet

    return ContextPayload(
        conn_id=conn_id,
        tables=tables,
        relations=relations,
        metadata=metadata,
        query_examples=query_examples,
        query_context=query_context,
        prompt_templates=prompt_templates,
    )


def get_summary(conn_id: int, db: Session) -> dict:
    """Return lightweight summary suitable for API responses (no full content)."""
    ctx = get_or_build(conn_id, db)
    return {
        "conn_id": conn_id,
        "table_count": len(ctx.tables),
        "column_count": sum(len(t["columns"]) for t in ctx.tables),
        "relation_count": len(ctx.relations),
        "metadata_count": len(ctx.metadata),
        "example_count": len(ctx.query_examples),
        "has_query_context": bool(ctx.query_context),
        "active_template_count": len(ctx.prompt_templates),
    }
