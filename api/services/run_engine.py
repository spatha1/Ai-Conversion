"""
api/services/run_engine.py

Conversion Run Engine — orchestrates the full pipeline:
  1. Create RunLog (status=running)
  2. Load template + query + mapping for the connection
  3. Execute query via connector
  4. Group rows by identifier, apply transforms, fill template
  5. Upsert all GeneratedXml records
  6. Optionally POST each XML to a target URL
  7. Finalize RunLog (status=success|failed)
"""
from __future__ import annotations

import json
import time
from collections import defaultdict
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from api.models import (
    RunLog, SourceConnection, XmlTemplate, GeneratedQuery,
    Mapping, MappingRow, GeneratedXml,
)


def execute(
    *,
    conn_id: int,
    triggered_by: str = "manual",
    target_url: Optional[str] = None,
    db: Session,
) -> RunLog:
    """
    Run the full conversion pipeline for a connection.
    Returns the completed RunLog record.
    """
    src = db.query(SourceConnection).filter_by(id=conn_id).first()
    if not src:
        raise ValueError(f"Connection {conn_id} not found.")

    project_id = src.project_id or 0

    # ── 1. Create RunLog ─────────────────────────────────────
    run = RunLog(
        project_id=project_id,
        triggered_by=triggered_by,
        status="running",
        target_url=target_url,
        started_at=datetime.utcnow(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    errors: list[str] = []

    try:
        result = _run_pipeline(conn_id=conn_id, run=run, target_url=target_url,
                                errors=errors, db=db)
        run.status      = "success" if not errors else "partial"
        run.source_rows = json.dumps({"total": result["total_rows"]})
        run.output_xml  = json.dumps({
            "generated": result["generated"],
            "groups":    result["groups"],
        })
        run.mapping_id = result.get("mapping_id")
    except Exception as exc:
        errors.append(str(exc))
        run.status = "failed"

    run.errors      = json.dumps(errors) if errors else None
    run.finished_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return run


def _run_pipeline(
    *,
    conn_id: int,
    run: RunLog,
    target_url: Optional[str],
    errors: list[str],
    db: Session,
) -> dict:
    from api.routers.mapping_ai import (
        _fill_template_from_row,
        normalize_dialect,
        _clean_sql_for_exec,
    )
    from api.routers.connections import _to_cfg_from_model
    from api.services.connector import _build_sql_engine, _serialize_row, _clean_error, _build_sf_connection
    import re as _re

    # ── Load template ────────────────────────────────────────
    tpl = (db.query(XmlTemplate)
             .filter_by(conn_id=conn_id)
             .order_by(XmlTemplate.id.desc())
             .first())
    if not tpl or not tpl.content:
        raise RuntimeError("No template found. Upload one in the Target tab first.")
    fmt = tpl.format_type or "xml"

    # ── Load query ───────────────────────────────────────────
    gq = (db.query(GeneratedQuery)
            .filter_by(conn_id=conn_id)
            .order_by(GeneratedQuery.id.desc())
            .first())
    if not gq or not gq.query_sql:
        raise RuntimeError("No generated query found. Run Generate Query in the Mapping tab first.")

    src = db.query(SourceConnection).filter_by(id=conn_id).first()
    cfg = _to_cfg_from_model(src)
    dialect = normalize_dialect(src.dialect, src.source_type)
    sql = _clean_sql_for_exec(gq.query_sql, dialect)

    # Unwrap SELECT * FROM (SELECT ...) AS alias pattern
    _inner = _re.match(
        r'^\s*SELECT\s+\*\s+FROM\s*\(\s*(SELECT[\s\S]+)\)\s+AS\s+\w+\s*$',
        sql, _re.IGNORECASE,
    )
    if _inner:
        sql = _inner.group(1).strip()

    # ── Execute query ────────────────────────────────────────
    try:
        if dialect == "snowflake":
            conn = _build_sf_connection(cfg)
            cur  = conn.cursor()
            cur.execute(sql)
            columns  = [d[0] for d in cur.description]
            raw_rows = [dict(zip(columns, r)) for r in cur.fetchall()]
            cur.close(); conn.close()
        else:
            from sqlalchemy import text as _sa_text
            engine = _build_sql_engine(cfg)
            with engine.connect() as _conn:
                result   = _conn.execute(_sa_text(sql))
                columns  = list(result.keys())
                raw_rows = [dict(zip(columns, r)) for r in result.fetchall()]
        rows = [_serialize_row(r) for r in raw_rows]
    except Exception as exc:
        raise RuntimeError(f"Query execution failed: {_clean_error(exc)}")

    if not rows:
        raise RuntimeError("Query returned no rows.")

    # ── Group by identifier ──────────────────────────────────
    mapping = (db.query(Mapping)
                 .filter_by(conn_id=conn_id, is_active=True)
                 .order_by(Mapping.id.desc())
                 .first())
    mid    = mapping.id if mapping else None
    id_col = mapping.identifier_column if mapping else None

    if rows and "__identifier__" in rows[0]:
        id_col = "__identifier__"
    elif not id_col and rows:
        id_col = list(rows[0].keys())[0]

    groups: dict[str, list] = defaultdict(list)
    for row in rows:
        id_val = str(row.get(id_col, "") or "") if id_col else ""
        groups[id_val].append(row)

    # ── Load transforms ──────────────────────────────────────
    transforms: dict[str, str] = {}
    if mid:
        for mr in db.query(MappingRow).filter(
            MappingRow.mapping_id == mid,
            MappingRow.transform_expression.isnot(None),
        ).all():
            if mr.target_path and mr.transform_expression:
                transforms[mr.target_path] = mr.transform_expression

    def _apply(row: dict) -> dict:
        if not transforms:
            return row
        out = dict(row)
        for path, expr in transforms.items():
            if path in out:
                try:
                    v = str(out[path]) if out[path] is not None else ""
                    out[path] = str(eval(expr, {"__builtins__": {}}, {"value": v}))  # noqa: S307
                except Exception:
                    pass
        return out

    # ── Generate + upsert ────────────────────────────────────
    saved: list[dict] = []
    for id_val, group_rows in groups.items():
        try:
            xml_out = _fill_template_from_row(tpl.content, _apply(group_rows[0]), fmt)
        except Exception as exc:
            errors.append(f"Template fill '{id_val}': {exc}")
            continue

        try:
            existing = (db.query(GeneratedXml)
                          .filter_by(conn_id=conn_id, identifier_value=id_val)
                          .first())
            if existing:
                existing.xml_content = xml_out
                existing.mapping_id  = mid
                rec = existing
            else:
                rec = GeneratedXml(conn_id=conn_id, mapping_id=mid,
                                   identifier_value=id_val, xml_content=xml_out)
                db.add(rec)
            db.flush()
            saved.append({"id": rec.id, "identifier_value": id_val})
        except Exception as exc:
            db.rollback()
            errors.append(f"DB save '{id_val}': {exc}")
            continue

        # ── Optional: POST to target URL ─────────────────────
        if target_url:
            _post_to_target(target_url=target_url, xml=xml_out,
                            identifier=id_val, run=run, errors=errors)

    if saved:
        db.commit()

    return {
        "generated":  len(saved),
        "total_rows": len(rows),
        "groups":     len(groups),
        "mapping_id": mid,
        "records":    saved,
    }


def _post_to_target(
    *,
    target_url: str,
    xml: str,
    identifier: str,
    run: RunLog,
    errors: list[str],
) -> None:
    try:
        import requests as _req
        headers = {"Content-Type": "application/xml", "X-Identifier": identifier}
        resp = _req.post(target_url, data=xml.encode("utf-8"), headers=headers, timeout=30)
        run.target_status = resp.status_code
        if not resp.ok:
            errors.append(f"Target POST '{identifier}' → HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as exc:
        errors.append(f"Target POST '{identifier}' failed: {exc}")
