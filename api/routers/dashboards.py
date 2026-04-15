"""
routers/dashboards.py

AI Dashboard Template Generator + Debug Panel + CRUD.

POST /api/dashboards/generate           — AI generates dashboard JSON + debug metadata
POST /api/dashboards/widget/regenerate  — AI regenerates a single widget
GET  /api/dashboards                    — list saved configs
POST /api/dashboards                    — save a config (with optional debug_json)
GET  /api/dashboards/{id}/debug         — fetch stored AI debug metadata
DELETE /api/dashboards/{id}             — delete a saved config
"""
from __future__ import annotations

import json
import re
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import DashboardConfig, CatalogColumn, CatalogRelation, QueryContext
from api.config import settings

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    intent:      str
    conn_id:     int
    constraints: str = ""
    model:       str = "gpt-4o-mini"


class SaveRequest(BaseModel):
    name:        str
    description: Optional[str] = None
    config_json: str
    debug_json:  Optional[str] = None   # serialised DashboardDebugMeta
    conn_id:     Optional[int] = None
    project_id:  Optional[int] = None


class RegenerateWidgetRequest(BaseModel):
    widget_id:       str
    current_widget:  dict          # full widget JSON as-is
    refinement:      str           # "change to show median instead of avg"
    conn_id:         int
    original_intent: str = ""
    model:           str = "gpt-4o-mini"


class GenerateFromSqlRequest(BaseModel):
    sql:         str
    columns:     list[str]                      # column names from query result
    sample_rows: list[dict]                     # first ≤10 rows as dicts
    conn_id:     int
    intent:      str = ""                       # optional hint: "show trend over time"
    model:       str = "gpt-4o-mini"


# ── Internal helpers ──────────────────────────────────────────────────────────

def _fetch_context(conn_id: int, db: Session) -> str:
    """Return combined global + connection-specific query context for AI prompts."""
    parts = []
    g = db.query(QueryContext).filter(QueryContext.conn_id == None).first()
    if g and g.content and g.content.strip():
        parts.append(g.content.strip())
    c = db.query(QueryContext).filter(QueryContext.conn_id == conn_id).first()
    if c and c.content and c.content.strip():
        parts.append(c.content.strip())
    return "\n\n".join(parts)


def _get_schema_text(conn_id: int, db: Session) -> tuple[str, str]:
    """Return (data_schema_md, relationships_md) for the given connection."""
    cols = (
        db.query(CatalogColumn)
        .filter(CatalogColumn.conn_id == conn_id)
        .order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position)
        .all()
    )
    tables: dict[str, list[str]] = {}
    for c in cols:
        tbl = c.table_name or "unknown"
        tables.setdefault(tbl, []).append(f"  - {c.column_name} ({c.data_type or 'unknown'})")

    schema_lines: list[str] = []
    for tbl, col_lines in tables.items():
        schema_lines.append(f"Table: {tbl}")
        schema_lines.extend(col_lines)
    schema_text = "\n".join(schema_lines) if schema_lines else "No schema found."

    rels = db.query(CatalogRelation).filter(CatalogRelation.conn_id == conn_id).all()
    rel_lines = [
        f"  {r.parent_table}.{r.parent_column} → {r.referenced_table}.{r.referenced_column}"
        for r in rels
    ]
    rel_text = "\n".join(rel_lines) if rel_lines else "No relationships found."
    return schema_text, rel_text



def _clean_json(raw: str) -> Any:
    """Strip markdown fences + trailing commas, then parse."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        raw = raw.rsplit("```", 1)[0].strip()
    raw = re.sub(r',\s*([}\]])', r'\1', raw)
    return json.loads(raw)


def _call_openai(
    system: str, user: str, model: str, api_key: str,
    max_tokens: int = 3000,
    conn_id: int | None = None,
    db=None,
) -> str:
    import time as _time
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    _t0 = _time.monotonic()
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        temperature=0.3,
        max_tokens=max_tokens,
    )
    _lat = int((_time.monotonic() - _t0) * 1000)
    if db is not None:
        from api.services import ai_trace as _at
        _at.store(
            module="dashboard", conn_id=conn_id, model=model,
            prompt=user[:8000], response=(resp.choices[0].message.content or "")[:8000],
            tokens_in=getattr(getattr(resp, "usage", None), "prompt_tokens", 0),
            tokens_out=getattr(getattr(resp, "usage", None), "completion_tokens", 0),
            latency_ms=_lat, db=db,
        )
    return resp.choices[0].message.content or ""


def _apply_ctx_rules(config: Any, ctx_md: str) -> Any:
    """Post-process generated config. Context is already baked into the prompt;
    this is a hook for future rule enforcement. Currently a pass-through."""
    return config


def _serialize(item: DashboardConfig) -> dict:
    return {
        "id":          item.id,
        "name":        item.name,
        "description": item.description,
        "conn_id":     item.conn_id,
        "project_id":  item.project_id,
        "config_json": item.config_json,
        "debug_json":  item.debug_json,
        "created_at":  item.created_at.isoformat() if item.created_at else None,
    }


# ── Prompts ───────────────────────────────────────────────────────────────────

DASHBOARD_SYSTEM_PROMPT = """You are a data dashboard architect. Given a user's intent and database schema, generate a dashboard configuration as valid JSON.

Return ONLY a valid JSON object — no markdown fences, no explanation — matching this exact structure:
{
  "tabName": "string",
  "description": "string",
  "filters": [],
  "layout": { "cols": 12 },
  "widgets": [
    {
      "id": "w1",
      "type": "kpi",
      "title": "string",
      "layout": { "x": 0, "y": 0, "w": 3, "h": 2 },
      "props": {},
      "dataBinding": {
        "sql": "SELECT COUNT(*) AS total FROM ...",
        "valueField": "total"
      }
    }
  ]
}

Widget types and their dataBinding fields:
- "kpi":      sql returns ONE row, ONE numeric column. Use "valueField".
- "bar":      sql returns rows with a text column + numeric column. Use "xField" and "yField".
- "line":     same as bar but rendered as area/line chart.
- "pie":      sql returns rows with a text column + numeric column. Use "labelField" and "valueField".
- "doughnut": same as pie but with inner hole.
- "table":    sql returns any columns. No xField/yField needed.

Layout grid rules (12-column grid, NO overlaps allowed):
- w: 3=quarter-width, 4=third, 6=half, 12=full
- h: 2=kpi, 4=chart (bar/line/pie/doughnut), 6=table
- Use these fixed bands to guarantee no overlaps:
  Band 1 (KPIs):   y=0, h=2  — place all kpi widgets here, distribute x evenly
  Band 2 (Charts): y=2, h=4  — place all bar/line/pie/doughnut widgets here
  Band 3 (Table):  y=6, h=6  — place table widget here spanning full width (w=12)
- x positions within each band must not exceed 12 combined (e.g. three w=4 widgets: x=0,4,8)
- A widget at y=0 h=4 and another at y=2 WILL OVERLAP — never do this

Rules:
- Generate 4–6 varied widgets (mix of kpi, chart, and optionally a table)
- Use ONLY tables and columns from the provided schema
- Write simple, valid SQL — use TOP 20 for bar/pie/line widgets
- For SQL Server syntax: use TOP N not LIMIT N, use GETDATE() not NOW()
- Be creative but practical based on the user's intent"""


WIDGET_REGENERATE_SYSTEM_PROMPT = """You are a data dashboard widget specialist. Given an existing widget configuration and a user's refinement request, generate an updated widget JSON.

Return ONLY a valid JSON object for a SINGLE widget — no markdown fences, no explanation:
{
  "id": "same as input",
  "type": "kpi|bar|line|pie|doughnut|table",
  "title": "string",
  "layout": { "x": 0, "y": 0, "w": 4, "h": 4 },
  "props": {},
  "dataBinding": {
    "sql": "SELECT ...",
    "xField": "...",
    "yField": "...",
    "labelField": "...",
    "valueField": "..."
  }
}

Include only the dataBinding fields relevant to the widget type (xField/yField for bar/line, labelField/valueField for pie/doughnut, valueField for kpi, nothing extra for table).
For SQL Server syntax: use TOP N not LIMIT, use GETDATE() not NOW().
Keep the same widget id and layout position as the input unless the type change requires a different size."""


SQL_VISUALIZE_SYSTEM_PROMPT = """You are a data visualization expert. Given a user-provided SQL query and a sample of its result data, generate the best possible dashboard widget configurations.

Return ONLY a valid JSON object — no markdown fences, no explanation:
{
  "tabName": "string",
  "description": "string",
  "filters": [],
  "layout": { "cols": 12 },
  "widgets": [ ... ]
}

Widget schema (same as always):
{
  "id": "w1",
  "type": "kpi|bar|line|pie|doughnut|table",
  "title": "string",
  "layout": { "x": 0, "y": 0, "w": 4, "h": 4 },
  "props": {},
  "dataBinding": {
    "sql": "...",
    "xField": "...",
    "yField": "...",
    "labelField": "...",
    "valueField": "..."
  }
}

Rules:
- For bar/line/pie/doughnut/table widgets: use the EXACT user SQL as the `sql` field (no changes)
- For KPI widgets: wrap the user SQL as a subquery to compute a single aggregate, e.g.
    SELECT COUNT(*) AS total FROM (<user_sql>) AS _sub
    or SELECT SUM(col) AS total FROM (<user_sql>) AS _sub
- xField / yField / labelField / valueField must be real column names from the provided column list
- Generate 3–5 widgets that best represent the data (mix types where appropriate)
- For SQL Server syntax: use TOP N not LIMIT N
- Layout: w 3=quarter, 4=third, 6=half, 12=full; h 2=kpi, 4=chart, 6=table; no overlaps"""


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/dashboards/generate", tags=["dashboards"])
def generate_dashboard(req: GenerateRequest, db: Session = Depends(get_db)):
    """Use OpenAI to generate a dashboard config JSON from user intent + schema.
    Returns both the config and debug metadata (prompts, schema) for the AI Debug Panel."""
    api_key = settings.OPENAI_API_KEY.strip() if settings.OPENAI_API_KEY else ""
    if not api_key:
        raise HTTPException(status_code=400, detail="No OpenAI API key configured.")

    schema_text, rel_text = _get_schema_text(req.conn_id, db)
    ctx_md = _fetch_context(req.conn_id, db)

    user_prompt = (
        f"User Intent: {req.intent}\n\n"
        f"Data Schema:\n{schema_text}\n\n"
        f"Relationships:\n{rel_text}\n\n"
        f"Constraints: {req.constraints or 'None'}\n\n"
        + (f"Additional Instructions (from Admin Query Context):\n{ctx_md}\n\n" if ctx_md else "")
        + "Generate a complete dashboard configuration JSON."
    )

    try:
        raw = _call_openai(DASHBOARD_SYSTEM_PROMPT, user_prompt, req.model, api_key, conn_id=req.conn_id, db=db)
        config = _apply_ctx_rules(_clean_json(raw), ctx_md)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"AI returned invalid JSON: {str(exc)[:200]}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Dashboard generation failed: {str(exc)[:300]}")

    debug = {
        "user_prompt":        req.intent,
        "constraints":        req.constraints or "",
        "system_prompt":      DASHBOARD_SYSTEM_PROMPT,
        "schema_text":        schema_text,
        "relationships_text": rel_text,
        "query_context":      ctx_md,
        "full_user_prompt":   user_prompt,
        "model":              req.model,
    }

    return {"config": config, "debug": debug}


@router.post("/dashboards/widget/regenerate", tags=["dashboards"])
def regenerate_widget(req: RegenerateWidgetRequest, db: Session = Depends(get_db)):
    """Use OpenAI to regenerate a single widget based on a refinement instruction."""
    api_key = settings.OPENAI_API_KEY.strip() if settings.OPENAI_API_KEY else ""
    if not api_key:
        raise HTTPException(status_code=400, detail="No OpenAI API key configured.")

    schema_text, rel_text = _get_schema_text(req.conn_id, db)
    ctx_md = _fetch_context(req.conn_id, db)

    user_prompt = (
        f"Original dashboard intent: {req.original_intent or 'Not specified'}\n\n"
        f"Current widget configuration:\n{json.dumps(req.current_widget, indent=2)}\n\n"
        f"User's refinement request: {req.refinement}\n\n"
        f"Data Schema:\n{schema_text}\n\n"
        f"Relationships:\n{rel_text}\n\n"
        + (f"Additional Instructions (from Admin Query Context):\n{ctx_md}\n\n" if ctx_md else "")
        + "Return the updated widget JSON only."
    )

    try:
        raw = _call_openai(WIDGET_REGENERATE_SYSTEM_PROMPT, user_prompt, req.model, api_key, max_tokens=1000)
        widget = _clean_json(raw)
        widget["id"] = req.widget_id
        # Apply context rules (e.g. strip ORDER BY if forbidden)
        if ctx_md and widget.get("dataBinding", {}).get("sql"):
            widget["dataBinding"]["sql"] = _strip_order_by(widget["dataBinding"]["sql"]) if re.search(r'no\s+order\s+by|do\s+not\s+use\s+order\s+by', ctx_md, re.IGNORECASE) else widget["dataBinding"]["sql"]
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"AI returned invalid JSON: {str(exc)[:200]}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Widget regeneration failed: {str(exc)[:300]}")

    return {"widget": widget}


@router.get("/dashboards", tags=["dashboards"])
def list_dashboards(
    project_id: Optional[int] = None,
    conn_id:    Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(DashboardConfig)
    if project_id:
        q = q.filter(DashboardConfig.project_id == project_id)
    if conn_id:
        q = q.filter(DashboardConfig.conn_id == conn_id)
    return [_serialize(d) for d in q.order_by(DashboardConfig.created_at.desc()).all()]


@router.post("/dashboards", tags=["dashboards"])
def save_dashboard(req: SaveRequest, db: Session = Depends(get_db)):
    """Save a dashboard config (and optional debug metadata) to the database."""
    try:
        json.loads(req.config_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="config_json must be valid JSON")

    item = DashboardConfig(
        name=req.name,
        description=req.description,
        config_json=req.config_json,
        debug_json=req.debug_json,
        conn_id=req.conn_id,
        project_id=req.project_id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.put("/dashboards/{dashboard_id}", tags=["dashboards"])
def update_dashboard(dashboard_id: int, req: SaveRequest, db: Session = Depends(get_db)):
    """Update an existing saved dashboard config."""
    item = db.query(DashboardConfig).filter(DashboardConfig.id == dashboard_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    try:
        json.loads(req.config_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="config_json must be valid JSON")
    item.name        = req.name
    item.description = req.description
    item.config_json = req.config_json
    if req.debug_json is not None:
        item.debug_json = req.debug_json
    if req.conn_id is not None:
        item.conn_id = req.conn_id
    if req.project_id is not None:
        item.project_id = req.project_id
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.get("/dashboards/{dashboard_id}/debug", tags=["dashboards"])
def get_dashboard_debug(dashboard_id: int, db: Session = Depends(get_db)):
    """Return the stored AI debug metadata for a saved dashboard."""
    item = db.query(DashboardConfig).filter(DashboardConfig.id == dashboard_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    if not item.debug_json:
        raise HTTPException(status_code=404, detail="No debug metadata stored for this dashboard")
    try:
        return json.loads(item.debug_json)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse stored debug metadata")


@router.post("/dashboards/generate-from-sql", tags=["dashboards"])
def generate_from_sql(req: GenerateFromSqlRequest, db: Session = Depends(get_db)):
    """Generate dashboard widget configs from a user-provided SQL query + its result data."""
    api_key = settings.OPENAI_API_KEY.strip() if settings.OPENAI_API_KEY else ""
    if not api_key:
        raise HTTPException(status_code=400, detail="No OpenAI API key configured.")

    ctx_md = _fetch_context(req.conn_id, db)
    sample_str = json.dumps(req.sample_rows[:10], default=str, indent=2)

    user_prompt = (
        f"SQL Query provided by user:\n{req.sql}\n\n"
        f"Column names: {req.columns}\n\n"
        f"Sample data (first {len(req.sample_rows[:10])} rows):\n{sample_str}\n\n"
        f"User intent: {req.intent or 'Visualize this data effectively'}\n\n"
        + (f"Additional Instructions (from Admin Query Context):\n{ctx_md}\n\n" if ctx_md else "")
        + "Generate a complete dashboard configuration JSON."
    )

    try:
        raw = _call_openai(SQL_VISUALIZE_SYSTEM_PROMPT, user_prompt, req.model, api_key)
        config = _apply_ctx_rules(_clean_json(raw), ctx_md)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"AI returned invalid JSON: {str(exc)[:200]}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Visualization generation failed: {str(exc)[:300]}")

    debug = {
        "user_prompt":        req.intent or "SQL-based generation",
        "constraints":        "",
        "system_prompt":      SQL_VISUALIZE_SYSTEM_PROMPT,
        "schema_text":        f"Columns: {', '.join(req.columns)}",
        "relationships_text": "Derived from user SQL",
        "query_context":      ctx_md,
        "full_user_prompt":   user_prompt,
        "model":              req.model,
    }
    return {"config": config, "debug": debug}


@router.delete("/dashboards/{dashboard_id}", tags=["dashboards"])
def delete_dashboard(dashboard_id: int, db: Session = Depends(get_db)):
    item = db.query(DashboardConfig).filter(DashboardConfig.id == dashboard_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    db.delete(item)
    db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# Power BI Export
# POST /api/dashboards/{id}/powerbi-export
# ══════════════════════════════════════════════════════════════

@router.post("/dashboards/{dashboard_id}/powerbi-export", tags=["dashboards"])
def powerbi_export(
    dashboard_id: int,
    model: str = "gpt-4o-mini",
    db: Session = Depends(get_db),
):
    """
    Generate Power BI compatible export from a saved dashboard:
      - DAX measures for each widget SQL binding
      - Dataset schema (table + column definitions)
      - Basic report layout JSON
    """
    from api.config import settings
    item = db.query(DashboardConfig).filter(DashboardConfig.id == dashboard_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    api_key = settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="No OpenAI API key configured.")

    try:
        config = json.loads(item.config_json)
    except Exception:
        raise HTTPException(status_code=422, detail="Dashboard config is not valid JSON")

    widgets = config.get("widgets", [])
    if not widgets:
        raise HTTPException(status_code=400, detail="Dashboard has no widgets to export")

    conn_id = item.conn_id
    schema_text, _ = _get_schema_text(conn_id, db) if conn_id else ("", "")

    widget_summary = json.dumps(
        [{"title": w.get("title"), "sql": w.get("dataBinding", {}).get("sql", "")} for w in widgets],
        indent=2,
    )

    system_prompt = (
        "You are a certified Power BI / DAX expert. Given dashboard widget SQL queries, "
        "generate a JSON object with these exact keys:\n"
        "  dax_measures: array of {name, expression, description}\n"
        "  dataset_schema: {tables: [{name, columns: [{name, dataType}]}]}\n"
        "  report_json: a simplified Power BI report layout object with sections and visualizations\n\n"
        "CRITICAL DAX RULES — violations will break Power BI:\n"
        "• DAX expressions MUST NOT contain SQL syntax: no GROUP BY, FROM, WHERE, JOIN, SELECT\n"
        "• Never use SQL functions YEAR(), MONTH() as standalone aggregation operators\n"
        "• Aggregations: SUM(Table[Column]), AVERAGE(Table[Column]), COUNTROWS(Table)\n"
        "• By-year grouping: SUMMARIZE(Table, YEAR(Table[Date]), \"Total\", SUM(Table[Amount]))\n"
        "• By-month grouping: SUMMARIZE(Table, MONTH(Table[Date]), \"Total\", SUM(Table[Amount]))\n"
        "• Time intelligence: TOTALYTD(SUM(Table[Amount]), Table[Date])\n"
        "• Filtering: CALCULATE(SUM(Table[Amount]), FILTER(Table, Table[Status] = \"Active\"))\n"
        "• Column references: Table[Column] — always qualify with table name\n"
        "• Each measure is a standalone DAX expression — NOT a query\n\n"
        "Return ONLY the JSON object, no prose, no fences."
    )
    user_msg = (
        f"Database schema context:\n{schema_text[:2000]}\n\n"
        f"Dashboard widgets:\n{widget_summary}"
    )

    raw = _call_openai(system_prompt, user_msg, model, api_key, max_tokens=2000, conn_id=conn_id, db=db)
    try:
        result = _clean_json(raw)
    except Exception:
        result = {"dax_measures": [], "dataset_schema": {"tables": []}, "report_json": {}}

    return result


# ══════════════════════════════════════════════════════════════
# POST /api/dashboards/validate-dax
# Client-uploadable list of {name, expression} → syntax validation
# ══════════════════════════════════════════════════════════════

class ValidateDaxRequest(BaseModel):
    measures: list[dict]    # [{name, expression}]
    dataset_schema: Optional[dict] = None   # optional — for table/column ref checks


@router.post("/dashboards/validate-dax", tags=["dashboards"])
def validate_dax(req: ValidateDaxRequest):
    """
    Validate Power BI DAX measure expressions for:
      1. SQL-like syntax that is invalid in DAX (GROUP BY, SELECT, FROM, etc.)
      2. Missing table qualifiers on column references
      3. Unbalanced parentheses
    Returns per-measure validation results plus an all_valid flag.
    """
    import re

    SQL_ANTI_PATTERNS = [
        (r"\bGROUP\s+BY\b",    "SQL GROUP BY is invalid in DAX — use SUMMARIZE() or CALCULATE()"),
        (r"\bSELECT\b",        "SQL SELECT is invalid in DAX"),
        (r"\bFROM\b",          "SQL FROM is invalid in DAX — column references use Table[Column]"),
        (r"\bWHERE\b",         "SQL WHERE is invalid in DAX — use FILTER() inside CALCULATE()"),
        (r"\bJOIN\b",          "SQL JOIN is invalid in DAX — use RELATED() or LOOKUPVALUE()"),
        (r"\bHAVING\b",        "SQL HAVING is invalid in DAX"),
        (r"\bORDER\s+BY\b",    "SQL ORDER BY is invalid in a DAX measure expression"),
        (r"SUM\s*\(\s*[A-Z_]+\s*\)",
         "SUM() must reference a column: SUM(Table[Column]) — missing table qualifier"),
        (r"AVERAGE\s*\(\s*[A-Z_]+\s*\)",
         "AVERAGE() must reference a column: AVERAGE(Table[Column])"),
        (r"COUNT\s*\(\s*[A-Z_]+\s*\)",
         "COUNT() must reference a column — consider COUNTROWS(Table) instead"),
    ]

    results = []
    for m in req.measures:
        name = m.get("name", "?")
        expr = (m.get("expression") or "").strip()
        errors: list[str] = []
        warnings: list[str] = []

        if not expr:
            errors.append("Expression is empty")
            results.append({"name": name, "expression": expr, "errors": errors, "warnings": warnings, "valid": False})
            continue

        for pattern, msg in SQL_ANTI_PATTERNS:
            if re.search(pattern, expr, re.IGNORECASE):
                errors.append(msg)

        # Check parenthesis balance
        depth = 0
        for ch in expr:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            if depth < 0:
                errors.append("Unbalanced parentheses — extra closing ')'")
                break
        if depth > 0:
            errors.append(f"Unbalanced parentheses — {depth} unclosed '('")

        # Warn if table qualifier seems missing (bare [Column] without TableName before it)
        bare_cols = re.findall(r'(?<![A-Za-z0-9_])\[([^\]]+)\]', expr)
        if bare_cols:
            warnings.append(
                f"Column reference(s) without table qualifier: {', '.join('[' + c + ']' for c in bare_cols[:3])}. "
                "Prefer Table[Column] syntax."
            )

        results.append({
            "name": name,
            "expression": expr,
            "errors": errors,
            "warnings": warnings,
            "valid": len(errors) == 0,
        })

    return {
        "results": results,
        "all_valid": all(r["valid"] for r in results),
        "error_count": sum(1 for r in results if not r["valid"]),
    }
