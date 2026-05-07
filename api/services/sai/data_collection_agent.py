"""
data_collection_agent.py — Fetches datasets from identified connections.
Uses connector.fetch_all_data() and query_builder.py (BFS FK graph).
"""
import json
import time
from typing import Optional
from sqlalchemy.orm import Session

from api.services.connector import fetch_all_data
from api.models import SourceConnection, CatalogColumn
from api.services.encryption import decrypt


def _build_cfg(conn: SourceConnection, query: Optional[str] = None) -> dict:
    return {
        "source_type": conn.source_type,
        "dialect":     conn.dialect,
        "host":        conn.host,
        "port":        conn.port,
        "database":    conn.database_name,
        "schema":      conn.schema_name,
        "username":    conn.username,
        "password":    decrypt(conn.password_enc) if conn.password_enc else "",
        "query":       query or conn.query_text or "",
    }


def _compute_stats(columns: list[str], rows: list[list]) -> dict:
    """Compute per-column null rates and basic numeric stats."""
    stats = {}
    total = len(rows)
    if total == 0:
        return {col: {"null_rate": 0.0} for col in columns}
    for i, col in enumerate(columns):
        vals = [r[i] for r in rows if i < len(r)]
        nulls = sum(1 for v in vals if v is None or v == "")
        null_rate = round(nulls / total, 4)
        numeric_vals = []
        for v in vals:
            try:
                numeric_vals.append(float(v))
            except (TypeError, ValueError):
                pass
        entry: dict = {"null_rate": null_rate, "total_rows": total}
        if numeric_vals:
            entry["min"] = min(numeric_vals)
            entry["max"] = max(numeric_vals)
            entry["mean"] = round(sum(numeric_vals) / len(numeric_vals), 4)
        stats[col] = entry
    return stats


async def run(schema_context: dict, db: Session) -> dict:
    t0 = time.time()
    datasets = []
    conn_ids = schema_context.get("conn_ids", [])
    knowledge_sources = schema_context.get("knowledge_sources", [])

    connections = db.query(SourceConnection).filter(
        SourceConnection.id.in_(conn_ids),
        SourceConnection.is_active == True,
    ).all() if conn_ids else []

    for conn in connections:
        # Use stored query_text or a simple SELECT from the first relevant table
        query = conn.query_text
        if not query:
            # Find first table in catalog for this connection
            col = db.query(CatalogColumn).filter(
                CatalogColumn.conn_id == conn.id
            ).first()
            if col:
                schema_prefix = f"{col.table_schema}." if hasattr(col, "table_schema") and col.table_schema else ""
                query = f"SELECT TOP 1000 * FROM {schema_prefix}{col.table_name}"
            else:
                datasets.append({
                    "conn_id":    conn.id,
                    "label":      conn.name,
                    "error":      "No query or catalog tables found — run Admin > Collect Schema first",
                    "query_used": "",
                    "row_count":  0,
                    "columns":    [],
                    "sample_rows": [],
                    "stats":      {},
                })
                continue

        try:
            cfg = _build_cfg(conn, query)
            result = fetch_all_data(cfg)
            cols = result.get("columns", [])
            rows = result.get("rows", [])
            stats = _compute_stats(cols, rows)
            datasets.append({
                "conn_id":     conn.id,
                "label":       conn.name,
                "row_count":   len(rows),
                "columns":     cols,
                "sample_rows": rows[:5],
                "stats":       stats,
                "query_used":  query,
            })
        except Exception as exc:
            datasets.append({
                "conn_id":    conn.id,
                "label":      conn.name,
                "error":      str(exc)[:500],
                "row_count":  0,
                "columns":    [],
                "sample_rows": [],
                "stats":      {},
                "query_used": query,   # include attempted query even on failure
            })

    return {
        "datasets":         datasets,
        "knowledge_sources": knowledge_sources,
        "elapsed_ms":       int((time.time() - t0) * 1000),
    }
