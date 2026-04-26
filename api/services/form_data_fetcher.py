"""
form_data_fetcher.py — Fetch data from DB / API / manual JSON and normalize
into a unified contract:
  {"data": {...}, "meta": {"source": str, "fetched_at": str, "row_count": int}}

Mapping paths always reference `data.*` keys regardless of source type.
"""
import json
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session


_MAX_API_BYTES = 1 * 1024 * 1024   # 1 MB guard for API responses


# ─────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────

def fetch_and_normalize(data_source: str, config_json: str | None, db: Session, runtime_headers: dict | None = None) -> dict:
    """
    data_source: "db" | "api" | "manual"
    config_json: JSON string describing the source config
    runtime_headers: optional headers passed at execute time (API auth — NOT persisted)
    Returns normalized dict: {data, meta}
    """
    cfg = json.loads(config_json) if config_json else {}

    if data_source == "db":
        raw = _fetch_db(cfg, db)
    elif data_source == "api":
        merged_headers = {**cfg.get("headers", {}), **(runtime_headers or {})}
        raw = _fetch_api(
            endpoint=cfg.get("endpoint", ""),
            method=cfg.get("method", "GET"),
            params=cfg.get("params", {}),
            headers=merged_headers,
        )
    elif data_source == "manual":
        raw = _fetch_manual(cfg.get("raw_json", "{}"))
    else:
        raise ValueError(f"Unknown data_source: {data_source!r}")

    return _normalize(raw, data_source)


# ─────────────────────────────────────────────────────────────
# Source-specific fetchers
# ─────────────────────────────────────────────────────────────

def _fetch_db(cfg: dict, db: Session) -> Any:
    """
    Fetch one row (or list) from the DB using connector.fetch_all_data.
    Returns a dict (single row) or list of dicts.
    """
    from api.models import SourceConnection
    from api.services.connector import fetch_all_data
    from api.services.encryption import decrypt

    conn_id = cfg.get("conn_id")
    query   = cfg.get("query", "")

    if not conn_id or not query:
        raise ValueError("DB binding requires conn_id and query in config_json")

    conn_row = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not conn_row:
        raise ValueError(f"Connection {conn_id} not found")

    conn_cfg = {
        "source_type": conn_row.source_type,
        "dialect":     conn_row.dialect,
        "host":        conn_row.host,
        "port":        conn_row.port,
        "database":    conn_row.database_name,
        "schema":      conn_row.schema_name,
        "username":    conn_row.username,
        "password":    decrypt(conn_row.password_enc) if conn_row.password_enc else "",
        "query":       query,
    }

    result = fetch_all_data(conn_cfg)
    rows   = result.get("rows", [])

    if not rows:
        return {}
    if len(rows) == 1:
        return rows[0]
    return rows


def _fetch_api(endpoint: str, method: str, params: dict, headers: dict) -> Any:
    """Call an external REST API and return parsed JSON response."""
    try:
        import httpx
    except ImportError:
        raise RuntimeError("httpx is required for API data sources — run: pip install httpx")

    if not endpoint:
        raise ValueError("API binding requires an endpoint URL")

    method = (method or "GET").upper()

    with httpx.Client(timeout=30) as client:
        if method == "GET":
            resp = client.get(endpoint, params=params, headers=headers)
        elif method == "POST":
            resp = client.post(endpoint, json=params, headers=headers)
        else:
            raise ValueError(f"Unsupported HTTP method: {method!r}")

        if len(resp.content) > _MAX_API_BYTES:
            raise ValueError(f"API response exceeds 1 MB size limit")

        resp.raise_for_status()
        return resp.json()


def _fetch_manual(raw_json_str: str) -> Any:
    """Parse a raw JSON string into a dict or list."""
    if not raw_json_str or not raw_json_str.strip():
        return {}
    try:
        parsed = json.loads(raw_json_str)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in manual input: {exc}")

    if isinstance(parsed, list):
        return parsed[0] if parsed else {}
    return parsed


# ─────────────────────────────────────────────────────────────
# Normalization
# ─────────────────────────────────────────────────────────────

def _normalize(raw: Any, source_type: str) -> dict:
    """Wrap raw data in the unified contract."""
    row_count = len(raw) if isinstance(raw, list) else (1 if raw else 0)
    data      = raw if isinstance(raw, dict) else (raw[0] if isinstance(raw, list) and raw else {})
    return {
        "data": data,
        "meta": {
            "source":     source_type,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "row_count":  row_count,
        },
    }


# ─────────────────────────────────────────────────────────────
# Field resolution helpers (used by form_extractor.bind_and_execute)
# ─────────────────────────────────────────────────────────────

def resolve_path(data: dict, path: str) -> Any:
    """
    Resolve a dot-path (with optional array index) into a nested dict.
    e.g. resolve_path(data, "customer.name") → data["customer"]["name"]
         resolve_path(data, "nominees[0].dob") → data["nominees"][0]["dob"]
    Returns None if any segment is missing.
    """
    if not path:
        return None

    segments = _split_path(path)
    current  = data

    for seg in segments:
        if current is None:
            return None
        if isinstance(seg, int):
            if isinstance(current, list) and 0 <= seg < len(current):
                current = current[seg]
            else:
                return None
        else:
            if isinstance(current, dict):
                current = current.get(seg)
            else:
                return None

    return current


def _split_path(path: str) -> list:
    """Split 'customer.name' or 'nominees[0].dob' into ['customer','name'] or ['nominees',0,'dob']."""
    parts  = []
    tokens = path.split(".")
    for token in tokens:
        m = re.match(r"^(\w+)\[(\d+)\]$", token)
        if m:
            parts.append(m.group(1))
            parts.append(int(m.group(2)))
        else:
            parts.append(token)
    return parts


def apply_mapping(template_fields: list[dict], data: dict, mapping: dict) -> dict[str, Any]:
    """
    Apply field-level mapping to a normalized data dict.
    Returns {field_name: resolved_value, ...}.
    Missing paths return "" (empty string, never fatal).
    """
    bound   = {}
    for field in template_fields:
        fname = field.get("name", "")
        path  = mapping.get(fname, fname)   # fall back to same-name lookup
        value = resolve_path(data, path)
        bound[fname] = "" if value is None else str(value)
    return bound
