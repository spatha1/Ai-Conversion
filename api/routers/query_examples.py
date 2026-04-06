# ═══════════════════════════════════════════════════════════
# routers/query_examples.py
#
# CRUD for few-shot SQL query examples used by AI agents.
# Examples are injected into generate_sql() prompts for both
# the Reports tab and the PS Support chat.
#
# GET    /api/admin/query-examples          — list (filter by conn_id)
# POST   /api/admin/query-examples          — create
# PUT    /api/admin/query-examples/{id}     — update
# DELETE /api/admin/query-examples/{id}     — delete
# ═══════════════════════════════════════════════════════════
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import QueryExample

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────

class ExampleIn(BaseModel):
    conn_id:     Optional[int] = None   # None = global
    name:        str
    description: Optional[str] = None
    tables_used: Optional[str] = None   # comma-separated
    example_sql: str


class ExampleOut(BaseModel):
    id:          int
    conn_id:     Optional[int]
    name:        str
    description: Optional[str]
    tables_used: Optional[str]
    example_sql: str
    is_active:   bool

    class Config:
        from_attributes = True


# ── Endpoints ────────────────────────────────────────────────

@router.get("/admin/query-examples", response_model=list[ExampleOut])
def list_examples(conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Return examples for this connection + all global examples (conn_id IS NULL)."""
    q = db.query(QueryExample).filter(QueryExample.is_active == True)
    if conn_id is not None:
        q = q.filter(
            (QueryExample.conn_id == conn_id) | (QueryExample.conn_id == None)
        )
    return q.order_by(QueryExample.conn_id.asc().nullslast(), QueryExample.id.asc()).all()


@router.post("/admin/query-examples", response_model=ExampleOut, status_code=201)
def create_example(data: ExampleIn, db: Session = Depends(get_db)):
    ex = QueryExample(
        conn_id=data.conn_id,
        name=data.name.strip(),
        description=data.description,
        tables_used=data.tables_used,
        example_sql=data.example_sql.strip(),
    )
    db.add(ex)
    db.commit()
    db.refresh(ex)
    return ex


@router.put("/admin/query-examples/{ex_id}", response_model=ExampleOut)
def update_example(ex_id: int, data: ExampleIn, db: Session = Depends(get_db)):
    ex = db.query(QueryExample).filter_by(id=ex_id).first()
    if not ex:
        raise HTTPException(status_code=404, detail="Example not found")
    ex.conn_id      = data.conn_id
    ex.name         = data.name.strip()
    ex.description  = data.description
    ex.tables_used  = data.tables_used
    ex.example_sql  = data.example_sql.strip()
    db.commit()
    db.refresh(ex)
    return ex


@router.delete("/admin/query-examples/{ex_id}", status_code=204)
def delete_example(ex_id: int, db: Session = Depends(get_db)):
    ex = db.query(QueryExample).filter_by(id=ex_id).first()
    if not ex:
        raise HTTPException(status_code=404, detail="Example not found")
    ex.is_active = False
    db.commit()
