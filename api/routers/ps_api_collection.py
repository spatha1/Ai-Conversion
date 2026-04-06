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


