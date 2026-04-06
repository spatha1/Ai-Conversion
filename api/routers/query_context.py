"""
routers/query_context.py
Free-form markdown context per connection — injected into AI prompts.

GET  /api/admin/query-context?conn_id=X   — load (null conn_id = global)
PUT  /api/admin/query-context             — upsert {conn_id, content}
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import QueryContext

router = APIRouter()

DEFAULT_TEMPLATE = """\
## Domain Rules
<!-- Business rules, naming conventions, and data quirks the AI must follow -->
-

## Key Tables
<!-- What each important table represents and when to use it -->
| Table | Purpose |
|-------|---------|
|  |  |

## Column Notes
<!-- Ambiguous columns, lookup codes, enum values, or join keys -->
-

## Example Queries
<!-- Paste working SQL queries as reference. Copy the block below for each one.

### [Query Name]
**Purpose**: [what it answers]
**Tables**: [table1, table2]
```sql
SELECT ...
```
-->

## Filters & Conventions
<!-- Common WHERE conditions, date formats, active-record flags, etc. -->
- \
"""


class ContextOut(BaseModel):
    conn_id:  Optional[int]
    content:  str
    template: str = DEFAULT_TEMPLATE


class ContextIn(BaseModel):
    conn_id:  Optional[int] = None   # None = global
    content:  str


@router.get("/admin/query-context", response_model=ContextOut)
def get_context(conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    row = (
        db.query(QueryContext)
        .filter(QueryContext.conn_id == conn_id)
        .first()
    )
    return ContextOut(
        conn_id=conn_id,
        content=row.content if (row and row.content) else "",
    )


@router.put("/admin/query-context", response_model=ContextOut)
def save_context(req: ContextIn, db: Session = Depends(get_db)):
    row = (
        db.query(QueryContext)
        .filter(QueryContext.conn_id == req.conn_id)
        .first()
    )
    if row:
        row.content = req.content
    else:
        row = QueryContext(conn_id=req.conn_id, content=req.content)
        db.add(row)
    db.commit()
    db.refresh(row)
    return ContextOut(conn_id=row.conn_id, content=row.content or "")
