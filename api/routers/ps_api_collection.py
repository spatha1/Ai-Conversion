# ═══════════════════════════════════════════════════════════
# routers/ps_api_collection.py
# CRUD for the PS agent's predefined REST API collection.
# ═══════════════════════════════════════════════════════════
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import PsApiCollection, SourceConnection
from api.services.encryption import encrypt, decrypt

router = APIRouter()


# ── Schemas ─────────────────────────────────────────────────

class ApiCollectionIn(BaseModel):
    name:            str
    description:     Optional[str] = None
    url:             str
    method:          str = "POST"
    headers_json:    Optional[str] = None   # raw JSON string
    body_template:   Optional[str] = None
    required_fields: Optional[str] = None   # JSON array e.g. ["emp_id","deptno"]
    auth_type:       str = "none"           # none | bearer | basic
    auth_value:      Optional[str] = None   # plain-text; encrypted before save
    conn_id:         Optional[int] = None   # restrict entry to a specific connection


class ApiCollectionOut(BaseModel):
    id:              int
    name:            str
    description:     Optional[str]
    url:             str
    method:          str
    headers_json:    Optional[str]
    body_template:   Optional[str]
    required_fields: Optional[str]
    auth_type:       str
    has_auth:        bool                   # true if auth_value_enc is set; never return the value
    conn_id:         Optional[int] = None


def _to_out(row: PsApiCollection) -> ApiCollectionOut:
    return ApiCollectionOut(
        id=row.id,
        name=row.name,
        description=row.description,
        url=row.url,
        method=row.method,
        headers_json=row.headers_json,
        body_template=row.body_template,
        required_fields=row.required_fields,
        auth_type=row.auth_type,
        has_auth=bool(row.auth_value_enc),
        conn_id=row.conn_id,
    )


# ── Endpoints ────────────────────────────────────────────────

@router.get("/ps/api-collection", tags=["ps-api-collection"])
def list_api_collection(
    conn_id: Optional[int] = None,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(PsApiCollection).filter(PsApiCollection.is_active == True)  # noqa: E712

    if conn_id is not None:
        # Filter by specific connection only
        q = q.filter(PsApiCollection.conn_id == conn_id)
    elif project_id is not None:
        # Filter to connections belonging to this project only
        project_conn_ids = [
            c.id for c in db.query(SourceConnection)
            .filter(SourceConnection.project_id == project_id, SourceConnection.is_active == True)
            .all()
        ]
        if not project_conn_ids:
            return []
        q = q.filter(PsApiCollection.conn_id.in_(project_conn_ids))

    rows = q.order_by(PsApiCollection.id).all()
    return [_to_out(r) for r in rows]


@router.post("/ps/api-collection", tags=["ps-api-collection"])
def create_api_entry(body: ApiCollectionIn, db: Session = Depends(get_db)):
    # Validate headers_json if provided
    if body.headers_json:
        try:
            json.loads(body.headers_json)
        except json.JSONDecodeError:
            raise HTTPException(status_code=422, detail="headers_json must be valid JSON")

    row = PsApiCollection(
        name=body.name,
        description=body.description,
        url=body.url,
        method=body.method.upper(),
        headers_json=body.headers_json,
        body_template=body.body_template,
        required_fields=body.required_fields,
        auth_type=body.auth_type,
        auth_value_enc=encrypt(body.auth_value),
        conn_id=body.conn_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.put("/ps/api-collection/{entry_id}", tags=["ps-api-collection"])
def update_api_entry(entry_id: int, body: ApiCollectionIn, db: Session = Depends(get_db)):
    row = db.query(PsApiCollection).filter_by(id=entry_id, is_active=True).first()
    if not row:
        raise HTTPException(status_code=404, detail="API entry not found")

    if body.headers_json:
        try:
            json.loads(body.headers_json)
        except json.JSONDecodeError:
            raise HTTPException(status_code=422, detail="headers_json must be valid JSON")

    row.name            = body.name
    row.description     = body.description
    row.url             = body.url
    row.method          = body.method.upper()
    row.headers_json    = body.headers_json
    row.body_template   = body.body_template
    row.required_fields = body.required_fields
    row.auth_type       = body.auth_type
    row.conn_id         = body.conn_id
    if body.auth_value is not None:          # only update if explicitly provided
        row.auth_value_enc = encrypt(body.auth_value)

    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/ps/api-collection/{entry_id}", tags=["ps-api-collection"])
def delete_api_entry(entry_id: int, db: Session = Depends(get_db)):
    row = db.query(PsApiCollection).filter_by(id=entry_id, is_active=True).first()
    if not row:
        raise HTTPException(status_code=404, detail="API entry not found")
    row.is_active = False
    db.commit()
    return {"deleted": entry_id}


# ── Import Collection (Postman v2 / v2.1 / simple array) ─────


class ImportCollectionIn(BaseModel):
    collection:  dict                   # raw Postman collection JSON
    conn_id:     Optional[int] = None   # associate all imported entries with this connection
    overwrite:   bool          = False  # if True, soft-delete existing entries first


def _extract_postman_items(items: list, results: list, base_headers: Optional[str] = None):
    """Recursively walk Postman collection items and extract request entries."""
    for item in items:
        # Folder — recurse
        if "item" in item:
            _extract_postman_items(item["item"], results, base_headers)
            continue
        req = item.get("request")
        if not req:
            continue
        if isinstance(req, str):
            # inline URL string — skip
            continue
        # Extract URL
        raw_url = req.get("url", "")
        if isinstance(raw_url, dict):
            raw_url = raw_url.get("raw", "")
        if not raw_url:
            continue
        # Method
        method = (req.get("method") or "POST").upper()
        # Description / name
        name = item.get("name") or raw_url
        desc_obj = req.get("description", "")
        description = desc_obj if isinstance(desc_obj, str) else (desc_obj.get("content", "") if isinstance(desc_obj, dict) else "")
        # Headers
        headers_list = req.get("header") or []
        headers_dict = {}
        for h in headers_list:
            if isinstance(h, dict) and h.get("key") and not h.get("disabled"):
                headers_dict[h["key"]] = h.get("value", "")
        headers_json = json.dumps(headers_dict) if headers_dict else None
        # Body
        body_obj = req.get("body") or {}
        body_template = None
        if isinstance(body_obj, dict):
            mode = body_obj.get("mode", "")
            if mode == "raw":
                body_template = body_obj.get("raw", None)
            elif mode == "urlencoded":
                fields = {f["key"]: "{{" + f["key"] + "}}" for f in (body_obj.get("urlencoded") or []) if f.get("key")}
                body_template = json.dumps(fields) if fields else None
            elif mode == "formdata":
                fields = {f["key"]: "{{" + f["key"] + "}}" for f in (body_obj.get("formdata") or []) if f.get("key")}
                body_template = json.dumps(fields) if fields else None
        results.append({
            "name": name[:120],
            "description": description[:300] if description else None,
            "url": raw_url,
            "method": method,
            "headers_json": headers_json,
            "body_template": body_template,
        })


@router.post("/ps/api-collection/import", tags=["ps-api-collection"])
def import_collection(body: ImportCollectionIn, db: Session = Depends(get_db)):
    """
    Import a Postman v2/v2.1 collection JSON (or a simple list of API objects).
    Accepts { collection: <postman_json>, conn_id: <opt>, overwrite: <bool> }.
    Returns { imported: N, skipped: 0, entries: [...] }.
    """
    col = body.collection
    entries: list[dict] = []

    # ── Format detection ─────────────────────────────────────
    if isinstance(col.get("item"), list):
        # Postman v2 / v2.1
        _extract_postman_items(col["item"], entries)
    elif isinstance(col.get("requests"), list):
        # Postman v1 legacy
        for req in col["requests"]:
            url = req.get("url") or ""
            if not url:
                continue
            entries.append({
                "name":        req.get("name") or url,
                "description": req.get("description") or None,
                "url":         url,
                "method":      (req.get("method") or "POST").upper(),
                "headers_json": None,
                "body_template": req.get("rawModeData") or None,
            })
    elif isinstance(col, list):
        # Simple array format: [{ name, url, method, body_template, description }, ...]
        for item in col:
            if not item.get("url"):
                continue
            entries.append({
                "name":         item.get("name") or item["url"],
                "description":  item.get("description"),
                "url":          item["url"],
                "method":       (item.get("method") or "POST").upper(),
                "headers_json": item.get("headers_json"),
                "body_template": item.get("body_template"),
            })
    else:
        raise HTTPException(status_code=422, detail="Unrecognised collection format. Provide a Postman v2 collection or a simple JSON array.")

    if not entries:
        return {"imported": 0, "skipped": 0, "entries": []}

    if body.overwrite and body.conn_id is not None:
        db.query(PsApiCollection).filter(
            PsApiCollection.conn_id == body.conn_id,
            PsApiCollection.is_active == True,   # noqa: E712
        ).update({"is_active": False})

    created = []
    for e in entries:
        row = PsApiCollection(
            name=e["name"],
            description=e.get("description"),
            url=e["url"],
            method=e["method"],
            headers_json=e.get("headers_json"),
            body_template=e.get("body_template"),
            required_fields=None,
            auth_type="none",
            auth_value_enc=None,
            conn_id=body.conn_id,
        )
        db.add(row)
        db.flush()
        created.append(_to_out(row))

    db.commit()
    return {"imported": len(created), "skipped": 0, "entries": [c.dict() for c in created]}


# ── Demo / seed ───────────────────────────────────────────────

@router.post("/ps/demo/emp/upsert", tags=["ps-api-collection"])
def demo_emp_upsert(payload: dict, db: Session = Depends(get_db)):
    """
    Real demo — INSERT or UPDATE a row in the EMP table.
    Accepted fields: empno (required), ename, job, mgr, hiredate, sal, comm, deptno
    """
    from sqlalchemy import text

    empno = payload.get("empno") or payload.get("emp_id") or payload.get("EMPNO")
    if not empno:
        return {"success": False, "error": "empno is required"}
    try:
        empno = int(empno)
    except (ValueError, TypeError):
        return {"success": False, "error": "empno must be an integer"}

    allowed = {"ename", "job", "mgr", "hiredate", "sal", "comm", "deptno"}
    updates = {k.lower(): v for k, v in payload.items()
               if k.lower() in allowed and v is not None}

    try:
        exists = db.execute(text("SELECT COUNT(1) FROM EMP WHERE EMPNO = :e"), {"e": empno}).scalar()
        if exists:
            if not updates:
                return {"success": True, "empno": empno, "action": "no_change",
                        "message": f"Employee {empno} exists but no fields to update."}
            set_clause = ", ".join(f"{k.upper()} = :{k}" for k in updates)
            params = dict(updates); params["e"] = empno
            db.execute(text(f"UPDATE EMP SET {set_clause} WHERE EMPNO = :e"), params)
            db.commit()
            return {"success": True, "empno": empno, "action": "updated",
                    "updated_fields": updates,
                    "message": f"Employee {empno} updated: {updates}"}
        else:
            # INSERT — ename and deptno are required for a new row
            cols = {"EMPNO": empno}
            cols.update({k.upper(): v for k, v in updates.items()})
            col_list = ", ".join(cols.keys())
            val_list = ", ".join(f":{k}" for k in cols.keys())
            db.execute(text(f"INSERT INTO EMP ({col_list}) VALUES ({val_list})"), cols)
            db.commit()
            return {"success": True, "empno": empno, "action": "inserted",
                    "fields": cols,
                    "message": f"Employee {empno} inserted into EMP."}
    except Exception as exc:
        db.rollback()
        return {"success": False, "error": str(exc)}


@router.post("/ps/demo/emp/terminate", tags=["ps-api-collection"])
def demo_emp_terminate(payload: dict, db: Session = Depends(get_db)):
    """
    Real demo — sets JOB = 'TERMINATED' on the EMP row.
    Payload: { empno: <int>, reason: <string> }
    """
    from sqlalchemy import text

    empno = payload.get("empno") or payload.get("emp_id") or payload.get("EMPNO")
    if not empno:
        return {"success": False, "error": "empno is required"}
    try:
        empno = int(empno)
    except (ValueError, TypeError):
        return {"success": False, "error": "empno must be an integer"}

    try:
        result = db.execute(
            text("UPDATE EMP SET JOB = 'TERMINATED', COMM = NULL WHERE EMPNO = :e"),
            {"e": empno}
        )
        db.commit()
        if result.rowcount == 0:
            return {"success": False, "error": f"Employee {empno} not found in EMP."}
        return {"success": True, "empno": empno, "status": "TERMINATED",
                "reason": payload.get("reason", "not specified"),
                "message": f"Employee {empno} marked as TERMINATED in EMP."}
    except Exception as exc:
        db.rollback()
        return {"success": False, "error": str(exc)}


