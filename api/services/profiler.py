"""
profiler.py — Data profiling service for the agent-based conversion pipeline.

Profiles source columns: null%, distinct count, min/max, and pattern detection.
Results are cached in conversion_column_profile (24h TTL).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from api.models import CatalogColumn, ConversionColumnProfile


# ─── Pattern detection regexes ────────────────────────────────────────────────
_RE_EMAIL   = re.compile(r'^[\w.+\-]+@[\w\-]+\.[a-z]{2,}$', re.IGNORECASE)
_RE_PHONE   = re.compile(r'^\+?[\d\s\-().]{7,15}$')
_RE_DATE    = re.compile(r'^\d{4}[-/]\d{2}[-/]\d{2}')
_RE_UUID    = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-', re.IGNORECASE)


def _detect_pattern(values: list) -> str:
    """Infer a semantic pattern from up to 20 non-null sample values."""
    sample = [str(v) for v in values if v is not None][:20]
    if not sample:
        return "unknown"

    checks = {
        "email":   lambda v: bool(_RE_EMAIL.match(v)),
        "phone":   lambda v: bool(_RE_PHONE.match(v)),
        "date":    lambda v: bool(_RE_DATE.match(v)),
        "uuid":    lambda v: bool(_RE_UUID.match(v)),
        "numeric": lambda v: _is_numeric(v),
    }
    for pattern_name, test in checks.items():
        if sum(1 for v in sample if test(v)) >= max(1, len(sample) * 0.8):
            return pattern_name

    avg_len = sum(len(v) for v in sample) / len(sample) if sample else 0
    if avg_len > 40:
        return "free_text"

    return "unknown"


def _is_numeric(v: str) -> bool:
    try:
        float(v)
        return True
    except (ValueError, TypeError):
        return False


def _build_sample_query(table_name: str, schema_name: Optional[str], dialect: str) -> str:
    """Build a TOP/LIMIT query appropriate for the dialect."""
    if schema_name:
        full_table = f"[{schema_name}].[{table_name}]"
    else:
        full_table = f"[{table_name}]"

    dialect_lower = (dialect or "").lower()
    if dialect_lower in ("mssql", "sql"):
        return f"SELECT TOP 200 * FROM {full_table} WITH (NOLOCK)"
    elif dialect_lower in ("postgresql", "mysql", "sqlite"):
        full_table_pg = f'"{table_name}"'
        if schema_name:
            full_table_pg = f'"{schema_name}"."{table_name}"'
        return f"SELECT * FROM {full_table_pg} LIMIT 200"
    else:
        # Snowflake
        full_table_sf = f"{table_name}"
        if schema_name:
            full_table_sf = f"{schema_name}.{table_name}"
        return f"SELECT * FROM {full_table_sf} LIMIT 200"


def profile_connection(
    conn_id: int,
    db: Session,
    cfg: dict,
    dialect: str,
    tables_to_profile: Optional[list[str]] = None,
) -> list[dict]:
    """
    Profile columns for the given connection.
    Only profiles tables in `tables_to_profile` (from matched_cols); if None, profiles all.
    Caps at 20 tables per run to avoid scanning large schemas.
    Upserts results into ConversionColumnProfile.
    """
    from api.services.connector import preview_data

    # Load catalog columns
    q = db.query(CatalogColumn).filter(CatalogColumn.conn_id == conn_id)
    if tables_to_profile:
        q = q.filter(CatalogColumn.table_name.in_(tables_to_profile))
    all_cols = q.all()

    # Group by table, cap at 20 tables
    tables: dict[str, list[CatalogColumn]] = {}
    for col in all_cols:
        if col.table_name not in tables:
            if len(tables) >= 20:
                break
            tables[col.table_name] = []
        tables[col.table_name].append(col)

    results: list[dict] = []

    for table_name, cols in tables.items():
        schema_name = cols[0].table_schema if cols else None
        sample_sql = _build_sample_query(table_name, schema_name, dialect)
        sample_cfg = {**cfg, "query": sample_sql}

        try:
            resp = preview_data(sample_cfg, limit=200)
            columns_out: list[str] = resp.get("columns", [])
            rows_out: list[list] = resp.get("rows", [])
        except Exception:
            continue  # skip tables that fail (permissions, etc.)

        col_set = set(columns_out)

        for cat_col in cols:
            cname = cat_col.column_name
            if cname not in col_set:
                continue
            raw_vals = [row.get(cname) for row in rows_out]
            non_null = [v for v in raw_vals if v is not None]

            total = len(raw_vals)
            null_count = total - len(non_null)
            null_pct = round((null_count / total * 100), 2) if total > 0 else 0.0
            distinct_count = len(set(str(v) for v in non_null))

            str_vals = [str(v) for v in non_null]
            min_val = min(str_vals, key=lambda x: x) if str_vals else None
            max_val = max(str_vals, key=lambda x: x) if str_vals else None
            pattern = _detect_pattern(non_null)

            # Categorical override: if low distinct count + not numeric/free_text
            if distinct_count < 10 and pattern not in ("numeric", "free_text"):
                pattern = "categorical"

            profile_dict = {
                "conn_id": conn_id,
                "table_name": table_name,
                "column_name": cname,
                "null_pct": str(null_pct),
                "distinct_count": distinct_count,
                "total_count": total,
                "min_val": min_val,
                "max_val": max_val,
                "pattern_hint": pattern,
            }
            results.append(profile_dict)

            # Upsert into DB
            existing = (
                db.query(ConversionColumnProfile)
                .filter(
                    ConversionColumnProfile.conn_id == conn_id,
                    ConversionColumnProfile.table_name == table_name,
                    ConversionColumnProfile.column_name == cname,
                )
                .first()
            )
            if existing:
                for k, v in profile_dict.items():
                    setattr(existing, k, v)
                existing.profiled_at = datetime.utcnow()
            else:
                db.add(ConversionColumnProfile(**profile_dict))

    db.commit()
    return results


def get_cached_profiles(conn_id: int, db: Session) -> dict[str, dict]:
    """
    Returns {"{table_name}.{column_name}": profile_dict} for fast O(1) lookup.
    """
    rows = db.query(ConversionColumnProfile).filter(
        ConversionColumnProfile.conn_id == conn_id
    ).all()
    result: dict[str, dict] = {}
    for r in rows:
        key = f"{r.table_name}.{r.column_name}"
        result[key] = {
            "conn_id": r.conn_id,
            "table_name": r.table_name,
            "column_name": r.column_name,
            "null_pct": float(r.null_pct) if r.null_pct else 0.0,
            "distinct_count": r.distinct_count,
            "total_count": r.total_count,
            "min_val": r.min_val,
            "max_val": r.max_val,
            "pattern_hint": r.pattern_hint or "unknown",
            "profiled_at": r.profiled_at,
        }
    return result


def profiles_are_stale(conn_id: int, db: Session, max_age_hours: int = 24) -> bool:
    """Returns True if profiles are missing or older than max_age_hours."""
    oldest = (
        db.query(ConversionColumnProfile)
        .filter(ConversionColumnProfile.conn_id == conn_id)
        .order_by(ConversionColumnProfile.profiled_at.asc())
        .first()
    )
    if oldest is None:
        return True
    cutoff = datetime.utcnow() - timedelta(hours=max_age_hours)
    return oldest.profiled_at < cutoff
