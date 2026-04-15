# How to Run — Clarity Studio (AI Data Platform)

## Prerequisites
- Python `.venv` is set up inside `C:\Users\Admin-1\Desktop\Ai-Conversion`
- Node.js is installed (`node --version` should work)
- SQL Server `DESKTOP-G01PH8C\SQLEXPRESS` is running
- `.env` file exists with `OPENAI_API_KEY` and DB credentials

---

## Step 1 — Kill Any Old Processes (if already running)

```powershell
powershell -Command "Get-Process python* | Stop-Process -Force"
powershell -Command "Get-Process node* | Stop-Process -Force"
```

Skip this if nothing is running.

---

## Step 2 — Start the Backend (Terminal 1)

```
cd C:\Users\Admin-1\Desktop\Ai-Conversion
.venv\Scripts\python.exe -m uvicorn api.main:app --reload --port 8000
```

You should see:

```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
```

Leave this terminal open.

---

## Step 3 — Start the React UI (Terminal 2)

Open a **second** terminal:

```
cd C:\Users\Admin-1\Desktop\Ai-Conversion\frontend
node_modules\.bin\vite --port 3000
```

You should see:

```
  VITE  ready in ...ms
  ➜  Local:   http://localhost:3000/
```

Leave this terminal open.

---

## Step 4 — Open the App

```
http://localhost:3000
```

The React UI at port 3000 proxies all `/api` calls to the FastAPI backend at port 8000.

---

## Stopping

- Press `Ctrl + C` in each terminal to stop backend and frontend.

---

## Re-bootstrap Database (first-time or after schema changes)

```
cd C:\Users\Admin-1\Desktop\Ai-Conversion
.venv\Scripts\python.exe -m api.setup_db
.venv\Scripts\python.exe -m api.migrate
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `address already in use` on port 8000 | Run Step 1 to kill old Python process |
| `address already in use` on port 3000 | Run Step 1 to kill old Node process |
| API calls return 404 or fail | Check backend terminal for Python errors |
| UI shows blank / old version | Hard refresh: `Ctrl + Shift + R` |
| `ModuleNotFoundError` | Confirm you are in `C:\Users\Admin-1\Desktop\Ai-Conversion` before starting uvicorn |
| Database connection error | Confirm SQL Server is running and `.env` credentials are correct |
| Vite fails to start | Run `npm install` inside the `frontend/` folder first |

---

## Architecture

```
Browser → http://localhost:3000   (React UI — Vite dev server)
                │
                └── /api/*  →  proxied to  http://localhost:8000  (FastAPI)
```

Two separate processes, two terminals. The React app is the only UI — there is no `index.html` served directly.

---

## Pages

| Page | What it does |
|---|---|
| **Conversion** | Upload source data → map → generate XML output |
| **PS Support** | AI chat agent for production support queries |
| **Development** | BRD analysis, AC generation, SQL plan, Generate All / Validate All, Git check-in, JIRA/ADO export |
| **Reports** | NL→SQL queries, charts, Power BI export, Validate DAX |
| **Power BI** | DAX formula editor, AI DAX generator, schema browser, Validate DAX |
| **Admin** | Schema discovery, embeddings, prompt templates, integrations (JIRA/ADO), AI Traces |
| **Connections** | Manage database connections (SQL Server, Snowflake, etc.) |
