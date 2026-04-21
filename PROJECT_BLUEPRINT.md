# Project Blueprint — Clarity Studio Style & Architecture Guide

> Drop this file into any new project as `CLAUDE.md` (or reference it in one).  
> It defines the full stack, design system, coding conventions, and patterns used across this codebase.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite (port 3000) |
| UI Library | MUI v5 (Material-UI) — `@mui/material`, `@mui/icons-material` |
| State | Zustand (`useAppStore`) |
| Data fetching | TanStack React Query v5 (`useQuery`, `useMutation`) |
| HTTP client | Axios with Bearer-token interceptor |
| Charts | Recharts |
| Notifications | notistack (`useSnackbar`) |
| Backend | FastAPI + Python 3.11 + Uvicorn (port 8000) |
| ORM | SQLAlchemy 2.x (declarative, sync sessions) |
| DB | SQL Server (MSSQL) via `pyodbc` / `sqlalchemy` |
| Auth | JWT (python-jose) — access + refresh token pair |
| AI | OpenAI (`gpt-4o-mini` default, `text-embedding-3-small` for embeddings) |
| Migrations | Custom `migrate.py` — `add_column_if_missing` / `create_table_if_missing` |

---

## Project Structure

```
project-root/
├── frontend/                        # React app
│   └── src/
│       ├── api/
│       │   ├── client.ts            # axios instance + auth interceptor + refresh logic
│       │   └── index.ts             # all API methods grouped by domain
│       ├── components/
│       │   ├── layout/              # AppShell, Sidebar, TopBar
│       │   ├── common/              # shared small components
│       │   └── ai/                  # AI-specific components (debug panel, etc.)
│       ├── pages/
│       │   └── <PageName>/          # one folder per page, index = PageName.tsx
│       ├── store/
│       │   └── useAppStore.ts       # Zustand global state
│       ├── theme/
│       │   └── theme.ts             # MUI theme (light + dark), design tokens
│       ├── types/
│       │   └── index.ts             # shared TypeScript interfaces
│       ├── App.tsx                  # routes
│       └── main.tsx                 # entry, ThemeProvider, QueryClientProvider
├── api/
│   ├── main.py                      # FastAPI app, router registration
│   ├── models.py                    # SQLAlchemy ORM models (all with prefix)
│   ├── schemas.py                   # Pydantic request/response schemas
│   ├── config.py                    # pydantic-settings from .env
│   ├── database.py                  # engine, SessionLocal, get_db
│   ├── dependencies.py              # get_current_user, require_admin, require_developer
│   ├── auth_utils.py                # JWT encode/decode
│   ├── setup_db.py                  # one-time DB bootstrap (create_all)
│   ├── migrate.py                   # safe column/table additions to existing DB
│   └── routers/
│       ├── auth.py                  # /auth/login, /auth/refresh
│       ├── connections.py           # CRUD + test/preview for data sources
│       ├── admin.py                 # schema discovery, embeddings, metadata
│       ├── report_ai.py             # NL→SQL, sessions, insights, PPT export
│       └── <domain>.py              # one router file per domain
│   └── services/
│       ├── connector.py             # SQL/Snowflake dispatch + query exec
│       ├── embeddings.py            # OpenAI embeddings + cosine similarity
│       ├── sql_guard.py             # read-only SQL validation
│       ├── insight_engine.py        # pure-Python insight detection
│       ├── schema_agent.py          # semantic model builder
│       ├── result_cache.py          # TTLCache for SQL results
│       ├── approval_service.py      # approval workflow logic
│       └── ai_trace.py              # audit log for AI calls
├── prompts/                         # editable system prompt markdown files
├── .env                             # secrets (never commit)
└── CLAUDE.md                        # this file (or the project instructions)
```

---

## Design System & Theme

### Color Tokens

```
Primary (navy):   #01398c  (tokens.navy600)
Secondary (gray): #555555  (tokens.gray600)
Background light: #EEF2F8  (cool blue-gray wash)
Background dark:  #060E1A  (deep navy-black)
Text primary:     #0A1628  (very dark navy)
Success:          #059669  (emerald600)
Warning:          #D97706  (amber600)
Error:            #DC2626  (red600)
Info:             #0284C7  (sky600)
```

### Typography

- Font: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- All `textTransform` on buttons/tabs: `none` (never uppercase by default)
- Heading weights: h1=800, h2-h4=700, h5-h6=600
- Body1: 0.938rem / Body2: 0.875rem / Caption: 0.75rem

### Shape

- Global border radius: `12px`
- Cards: `16px`, Dialogs: `18px`, Chips: `8px`, Buttons: `10px`
- Small elements (menu items, icon buttons): `8-9px`

### Key Component Patterns

**Cards** — always use `Card` + `CardContent`, never bare `Paper` for page sections:
```tsx
<Card sx={{ mb: 2 }}>
  <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
    ...
  </CardContent>
</Card>
```

**Section headers inside cards** — use a `Box` row with border-bottom:
```tsx
<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5,
           borderBottom: '1px solid', borderColor: 'divider' }}>
  <SomeIcon sx={{ fontSize: 18, color: 'primary.main', mr: 1 }} />
  <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>Title</Typography>
  <IconButton size="small"><CloseOutlined fontSize="small" /></IconButton>
</Box>
```

**Page header** — always at the top of the page component:
```tsx
<Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
  <SomeIcon sx={{ fontSize: 28, color: 'primary.main', mr: 1 }} />
  <Box>
    <Typography variant="h5" fontWeight={700}>Page Title</Typography>
    <Typography variant="body2" color="text.secondary">Subtitle</Typography>
  </Box>
</Box>
```

**Status chips** — always `size="small"`, `variant="outlined"` for inline badges:
```tsx
<Chip label="Active" size="small" color="success" variant="outlined" />
<Chip label="Pending" size="small" color="warning" />
```

**Section label / category header** — use `Typography variant="caption"` in uppercase:
```tsx
<Typography variant="caption" fontWeight={700} color="primary.main"
  sx={{ letterSpacing: 0.5 }}>
  SECTION LABEL
</Typography>
```

**Alpha backgrounds** — use `alpha()` from MUI for tinted backgrounds:
```tsx
bgcolor: (t) => alpha(t.palette.primary.main, 0.04)
bgcolor: alpha('#2563eb', 0.04)
```

**Tinted info boxes** — `Paper variant="outlined"` with alpha border + bg:
```tsx
<Paper variant="outlined" sx={{
  p: 2, borderRadius: 2,
  borderColor: alpha(color, 0.3),
  bgcolor: alpha(color, 0.04),
}}>
```

**Tables** — always use `TableContainer` for sticky headers:
```tsx
<TableContainer sx={{ maxHeight: 480 }}>
  <Table size="small" stickyHeader>
    <TableHead>...</TableHead>
    <TableBody>...</TableBody>
  </Table>
</TableContainer>
```

**Collapsible sections** — use `Collapse` with a clickable header `Box`:
```tsx
const [open, setOpen] = useState(true)
<Box onClick={() => setOpen(v => !v)} sx={{ cursor: 'pointer', display: 'flex', ... }}>
  <Typography>Section</Typography>
  {open ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
</Box>
<Collapse in={open}>...</Collapse>
```

**Loading buttons** — always replace icon with `CircularProgress`:
```tsx
<Button startIcon={isPending ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />}
  disabled={isPending}>
  Run
</Button>
```

**Tabs** — always `textTransform: 'none'`, `iconPosition="start"`, `minHeight: 36` for compact:
```tsx
<Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36 }}>
  <Tab value="data" icon={<StorageOutlined fontSize="small" />}
    iconPosition="start" label="Data"
    sx={{ minHeight: 36, py: 0, textTransform: 'none' }} />
</Tabs>
```

**Snackbar notifications** — always use `useSnackbar` from notistack:
```tsx
const { enqueueSnackbar } = useSnackbar()
enqueueSnackbar('Saved successfully', { variant: 'success' })
enqueueSnackbar(e.message, { variant: 'error' })
```

---

## Frontend Code Patterns

### API Client (`src/api/client.ts`)

```typescript
import axios from 'axios'
import { useAppStore } from '@/store/useAppStore'

export const api = axios.create({ baseURL: '/api', timeout: 60_000 })

// Attach Bearer token on every request
api.interceptors.request.use((config) => {
  const token = useAppStore.getState().user?.token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Silent refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    // ... refresh logic, redirect to /login on failure
    const msg = err?.response?.data?.detail || err?.message || 'Unexpected error'
    return Promise.reject(new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)))
  }
)
```

**IMPORTANT**: Any `fetch()` calls (e.g. SSE/streaming) must also manually attach the token:
```typescript
const token = useAppStore.getState().user?.token
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
})
```

### API Methods (`src/api/index.ts`)

Group all methods by domain object. Each method is a one-liner returning the resolved data:
```typescript
export const widgetApi = {
  list: (projectId: number) =>
    api.get<Widget[]>('/widgets', { params: { project_id: projectId } }).then(r => r.data),
  create: (data: WidgetCreate) =>
    api.post<Widget>('/widgets', data).then(r => r.data),
  update: (id: number, data: Partial<Widget>) =>
    api.put<Widget>(`/widgets/${id}`, data).then(r => r.data),
  delete: (id: number) =>
    api.delete(`/widgets/${id}`).then(r => r.data),
}
```

### Mutations

```typescript
const saveMutation = useMutation({
  mutationFn: () => widgetApi.create(formData),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['widgets'] })
    enqueueSnackbar('Widget saved', { variant: 'success' })
  },
  onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
})
```

### Queries

```typescript
const { data: widgets = [], isLoading } = useQuery({
  queryKey: ['widgets', connId],
  queryFn: () => widgetApi.list(connId as number),
  enabled: !!connId,
  staleTime: 5 * 60 * 1000,
})
```

### Global State (`useAppStore`)

```typescript
// Reading
const { activeConnection, user } = useAppStore()
const connId = activeConnection?.id ?? ''

// Writing (outside React — use getState())
useAppStore.getState().user?.token
```

---

## Backend Code Patterns

### Router Structure

Every router file follows this pattern:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from api.database import get_db
from api.dependencies import get_current_user, require_admin
from api.models import MyModel
from api.schemas import MySchema

router = APIRouter()   # or APIRouter(dependencies=[Depends(get_current_user)])

@router.get("/things", response_model=list[ThingOut])
def list_things(db: Session = Depends(get_db),
                current_user = Depends(get_current_user)):
    return db.query(MyModel).all()

@router.post("/things", response_model=ThingOut)
def create_thing(req: ThingCreate, db: Session = Depends(get_db),
                 current_user = Depends(get_current_user)):
    obj = MyModel(**req.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj
```

**Route ordering rule**: fixed-path routes (e.g. `/things/summary`) MUST be registered **before** parameterised routes (e.g. `/things/{id}`) in the same router — FastAPI resolves top-down.

### ORM Models (`api/models.py`)

- All table names have a project prefix: `conversion_` (change per project)
- Always import `func` for server-side defaults, `Float` for decimal columns
- Use `Text` for long strings, `String(N)` for bounded ones

```python
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Float, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from api.database import Base
from datetime import datetime

class MyThing(Base):
    __tablename__ = "myapp_things"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    name       = Column(String(500), nullable=False)
    notes      = Column(Text, nullable=True)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now())
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
                        server_default=func.now())
    # FK example
    project_id = Column(Integer, ForeignKey("myapp_projects.id"), nullable=True, index=True)
    project    = relationship("Project", back_populates="things")
```

### Pydantic Schemas

```python
from pydantic import BaseModel
from typing import Optional

class ThingCreate(BaseModel):
    name:  str
    notes: Optional[str] = None

class ThingOut(BaseModel):
    id:         int
    name:       str
    notes:      Optional[str]
    created_at: str

    class Config:
        from_attributes = True
```

### Migrations (`api/migrate.py`)

**Never use `create_all` to alter existing tables.** Always use the safe helpers:

```python
def add_column_if_missing(cur, table: str, column: str, definition: str):
    cur.execute("""
        IF NOT EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME=? AND COLUMN_NAME=?
        ) EXEC('ALTER TABLE {} ADD {} {}')
    """.format(table, column, definition), (table, column))

def create_table_if_missing(cur, table: str, ddl: str):
    cur.execute(f"""
        IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='{table}' AND type='U')
        EXEC('{ddl}')
    """)
```

### Auth Dependencies

```python
# In any protected route:
current_user = Depends(get_current_user)   # any logged-in user
_            = Depends(require_admin)       # admin only (on router or route)
_            = Depends(require_developer)   # admin or developer

# Check admin in route logic:
user_roles = {ur.role for ur in getattr(current_user, "user_roles", [])}
is_admin = "admin" in user_roles
```

### Error Handling

```python
# Not found
raise HTTPException(404, detail="Widget not found")

# Validation failure
raise HTTPException(422, detail=f"Invalid SQL: {msg}")

# Server error — let it bubble naturally (FastAPI returns 500)
# Never silence exceptions with bare `except: pass` in business logic
```

### Connector dispatch (`connector.py`)

Always build the `cfg` dict this way:
```python
cfg = {
    "source_type": conn.source_type,    # "sql" | "snowflake"
    "dialect":     conn.dialect,         # "mssql" | "postgresql" | "mysql" | "sqlite"
    "host":        conn.host,
    "port":        conn.port,
    "database":    conn.database_name,   # ORM col is database_name, cfg key is database
    "schema":      conn.schema_name,
    "username":    conn.username,
    "password":    decrypt(conn.password_enc) if conn.password_enc else "",
    "query":       sql,
}
result = preview_data(cfg, limit=1000)
# result = { "columns": [...], "rows": [...], "total": N }
```

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| DB tables | `{prefix}_{snake_case}` | `myapp_user_sessions` |
| ORM models | `PascalCase` | `UserSession` |
| API routes | `/kebab-case/{id}` | `/user-sessions/42` |
| React components | `PascalCase.tsx` | `UserSessionCard.tsx` |
| React hooks | `use` prefix | `useSessionData` |
| API methods | `camelCase` grouped by domain | `sessionApi.list()` |
| Zustand store | `useAppStore` (singular) | — |
| Python services | `snake_case.py` | `session_service.py` |
| Python functions | `snake_case` | `build_session_context` |
| Environment vars | `UPPER_SNAKE_CASE` | `OPENAI_API_KEY` |

---

## Critical Rules

### Never do these

1. **Never expose `fetch_all_data()` as an HTTP endpoint** — full datasets stay server-side only
2. **Never return passwords/keys in API responses** — always strip before serializing
3. **Never use `db.create_all()` to alter existing tables** — use `migrate.py`
4. **Never call `.get()` on SQLAlchemy ORM objects** — use `getattr(obj, "field", default)`
5. **Never use `--no-verify` on git or skip auth guards**
6. **Never add `port` to named SQL Server instances** — `host\INSTANCE` must not have `:port` appended
7. **Never put fixed routes after parameterised routes** in the same router

### Always do these

1. **Always use `TableContainer` (not `Box`) as the scroll wrapper for MUI `stickyHeader` tables**
2. **Always attach Bearer token in `fetch()` calls** — `fetch()` bypasses the axios interceptor
3. **Always use `db.query(Model).filter(...).update({...})` for updates after a foreign `db.commit()`** — ORM dirty-tracking can miss changes after another commit
4. **Always pass `extra_payload` to approval gate functions** so auto-resume has the SQL to re-execute
5. **Always use `alpha()` from MUI for color-tinted backgrounds** — never hardcode rgba values
6. **Always `db.refresh(obj)` after `db.add()` + `db.commit()` if you need the returned object's ID**

---

## Auth Flow

```
Login → POST /auth/login → { access_token, refresh_token }
  → store access_token in Zustand (memory only)
  → store refresh_token in localStorage (key: clarity_refresh_token)

Every request → axios interceptor → Authorization: Bearer {access_token}

On 401 → interceptor tries POST /auth/refresh with refresh_token
  → on success: update Zustand + localStorage, retry original request
  → on failure: logout() + redirect /login
```

---

## AI Integration Pattern

### NL → SQL flow

```
1. User types question
2. POST /report/ask-followup { session_id, question, conn_id }
3. Backend:
   a. Get top-K similar columns via OpenAI embeddings (cosine similarity)
   b. Build semantic model (schema_agent.py) → query_intent, confidence, join_paths
   c. Generate SQL via gpt-4o-mini with schema context
   d. Validate SQL is read-only (sql_guard.py)
   e. Check approval gate if row count > threshold
   f. Execute SQL via connector.py
   g. Build follow-up suggestions (rule-based)
   h. Return AskResult { sql, columns, rows, total, confidence, query_explanation,
                         follow_up_suggestions, ambiguities }
```

### Approval Gate Pattern

```python
def _check_approval_gate(conn_model, sql, current_user, db, context_type, extra_payload):
    # 1. Skip if no project
    if not conn_model.project_id: return None
    # 2. Skip if admin
    if "admin" in {ur.role for ur in current_user.user_roles}: return None
    # 3. Skip if no active workflow
    if not needs_approval(db, conn_model.project_id): return None
    # 4. Skip if row count under threshold
    estimated = _estimate_row_count(sql, cfg, dialect)
    if estimated != -1 and estimated <= THRESHOLD: return None
    # 5. Deduplicate by sql_hash
    sql_h = hashlib.sha256(sql.encode()).hexdigest()
    existing = find_existing_pending(db, project_id, context_type, sql_h)
    if existing: return JSONResponse(202, {"status": "pending_approval", ...})
    # 6. Create approval request and store payload for auto-resume
    req_obj = create_approval_request(...)
    db.query(ApprovalRequest).filter(...id==req_obj.id...).update(
        {"context_payload": json.dumps(extra_payload), "sql_hash": sql_h}
    )
    db.commit()
    return JSONResponse(202, {"status": "pending_approval", ...})
```

---

## Startup Commands

```bash
# Backend
cd <project-root>
.venv/Scripts/python.exe -m uvicorn api.main:app --reload --port 8000

# Frontend
cd <project-root>/frontend
node_modules/.bin/vite --port 3000

# Bootstrap DB (first time only)
python -m api.setup_db
python -m api.migrate

# Kill stuck Python process
powershell -Command "Get-Process python* | Stop-Process -Force"
```

---

## Environment Variables (`.env`)

```env
DATABASE_URL=mssql+pyodbc://user:pass@SERVER\INSTANCE/DBName?driver=ODBC+Driver+17+for+SQL+Server
OPENAI_API_KEY=sk-...
JWT_SECRET=<random-256-bit>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7
REPORT_APPROVAL_THRESHOLD=10000
```

---

## Page Component Template

```tsx
import { useState } from 'react'
import { Box, Card, CardContent, Typography, Button, CircularProgress } from '@mui/material'
import { SomeIcon } from '@mui/icons-material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { myApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'

export default function MyPage() {
  const { enqueueSnackbar } = useSnackbar()
  const { activeConnection } = useAppStore()
  const connId = activeConnection?.id ?? ''

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['my-items', connId],
    queryFn: () => myApi.list(connId as number),
    enabled: !!connId,
  })

  const createMutation = useMutation({
    mutationFn: (data: unknown) => myApi.create(data),
    onSuccess: () => enqueueSnackbar('Created', { variant: 'success' }),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  return (
    <Box sx={{ p: 3 }}>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <SomeIcon sx={{ fontSize: 28, color: 'primary.main', mr: 1 }} />
        <Box>
          <Typography variant="h5" fontWeight={700}>My Page</Typography>
          <Typography variant="body2" color="text.secondary">Description</Typography>
        </Box>
      </Box>

      {/* Content */}
      <Card>
        <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
          <Button
            variant="contained"
            startIcon={createMutation.isPending
              ? <CircularProgress size={16} color="inherit" />
              : <SomeIcon />}
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate({})}
          >
            Create
          </Button>
        </CardContent>
      </Card>
    </Box>
  )
}
```

---

## Backend Router Template

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from api.database import get_db
from api.dependencies import get_current_user
from api.models import MyModel

router = APIRouter()

@router.get("/my-things")
def list_my_things(
    project_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    q = db.query(MyModel)
    if project_id:
        q = q.filter(MyModel.project_id == project_id)
    return q.order_by(MyModel.created_at.desc()).all()

@router.post("/my-things")
def create_my_thing(req: dict, db: Session = Depends(get_db),
                    current_user = Depends(get_current_user)):
    obj = MyModel(**req)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

@router.delete("/my-things/{thing_id}")
def delete_my_thing(thing_id: int, db: Session = Depends(get_db),
                    current_user = Depends(get_current_user)):
    obj = db.query(MyModel).filter(MyModel.id == thing_id).first()
    if not obj:
        raise HTTPException(404, detail="Not found")
    db.delete(obj)
    db.commit()
    return {"ok": True}
```
