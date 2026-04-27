# ═══════════════════════════════════════════════════════════
# main.py — FastAPI application entry point
#
# Run from the Conversionproject root:
#   pip install -r api/requirements.txt
#   uvicorn api.main:app --reload --port 8000
# ═══════════════════════════════════════════════════════════
import xml.etree.ElementTree as ET
import pyodbc
from collections import defaultdict
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.config import settings
from api.database import init_db, get_db
from api.routers.connections        import router as conn_router
from api.routers.admin              import router as admin_router, _public_debug_router
from api.routers.report_ai          import router as report_ai_router
from api.routers.mapping_ai         import router as mapping_ai_router
from api.routers.ps_ai              import router as ps_ai_router
from api.routers.ps_api_collection  import router as ps_collection_router
from api.routers.ps_workflows       import router as ps_workflows_router, start_scheduler
from api.routers.query_examples     import router as query_examples_router
from api.routers.query_context      import router as query_context_router
from api.routers.validation         import router as validation_router
from api.routers.target_formulas    import router as target_formulas_router
from api.routers.api_dispatch       import router as api_dispatch_router
from api.routers.projects           import router as projects_router
from api.routers.dashboard          import router as dashboard_router
from api.routers.dashboards         import router as dashboards_router
from api.routers.development        import router as development_router
from api.routers.agents             import router as agents_router
from api.routers.testing            import router as testing_router
from api.routers.feedback           import router as feedback_router
from api.routers.help_chat          import router as help_chat_router
from api.routers.agentic            import router as agentic_router
from api.routers.conversion_agent   import router as conversion_agent_router
from api.routers.reconciliation     import router as reconciliation_router
from api.routers.auth               import router as auth_router
from api.routers.users              import router as users_router
from api.routers.pipeline           import router as pipeline_router, start_pipeline_scheduler
from api.routers.project_members    import router as project_members_router, router2 as user_projects_router
from api.routers.approval_workflows import router as approval_workflows_router
from api.routers.approval_requests  import router as approval_requests_router
from api.routers.notifications      import router as notifications_router
from api.routers.ask_ai             import router as ask_ai_router
from api.routers.ui_validation      import router as ui_validation_router
from api.routers.stories            import router as stories_router
from api.routers.form_builder       import router as form_builder_router
from api.routers.knowledge          import router as knowledge_router

app = FastAPI(
    title="Data Conversion Studio API",
    version="1.0.0",
    description="Backend for mapping, source connectivity, and XML generation.",
)

# ── CORS — allow the browser UI (opened as file://) ─────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list + ["null"],  # "null" = file:// origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Startup — auto-create tables + seed default prompt templates ────────────
@app.on_event("startup")
def on_startup():
    print(">> Connecting to conversion DB:", settings.DB_SERVER, "/", settings.DB_NAME)
    init_db()
    print(">> Tables ready")
    start_scheduler()
    print(">> Workflow scheduler started")
    start_pipeline_scheduler()
    print(">> Pipeline scheduler started")
    # Auto-seed prompt templates if the table is empty
    try:
        from api.database import SessionLocal
        from api.models import PromptTemplate
        from api.seed_prompts import seed_default_prompts
        with SessionLocal() as _db:
            if _db.query(PromptTemplate).count() == 0:
                print(">> No prompt templates found — seeding defaults...")
                seed_default_prompts(_db)
            else:
                print(">> Prompt templates already seeded")
    except Exception as _e:
        print(f">> Prompt template auto-seed skipped: {_e}")
    # Auto-seed default admin user
    try:
        from api.database import SessionLocal
        from api.seed_users import seed_default_admin
        with SessionLocal() as _db:
            seed_default_admin(_db)
    except Exception as _e:
        print(f">> Admin user seed skipped: {_e}")


# ── Health check ────────────────────────────────────────────
@app.get("/api/health", tags=["health"])
def health():
    return {
        "status": "ok",
        "db_server": settings.DB_SERVER,
        "db_name":   settings.DB_NAME,
    }


# ── Routes ──────────────────────────────────────────────────
app.include_router(conn_router,        prefix="/api", tags=["connections"])
app.include_router(admin_router,       prefix="/api", tags=["admin"])
app.include_router(_public_debug_router, prefix="/api", tags=["admin"])
app.include_router(report_ai_router,   prefix="/api", tags=["report-ai"])
app.include_router(mapping_ai_router,  prefix="/api", tags=["mapping"])
app.include_router(ps_ai_router,       prefix="/api", tags=["ps-agent"])
app.include_router(ps_collection_router, prefix="/api", tags=["ps-api-collection"])
app.include_router(ps_workflows_router,  prefix="/api", tags=["ps-workflows"])
app.include_router(query_examples_router, prefix="/api", tags=["query-examples"])
app.include_router(query_context_router,  prefix="/api", tags=["query-context"])
app.include_router(validation_router,       prefix="/api", tags=["validation"])
app.include_router(target_formulas_router, prefix="/api", tags=["target-formulas"])
app.include_router(api_dispatch_router,    prefix="/api", tags=["api-dispatch"])
app.include_router(projects_router,        prefix="/api", tags=["projects"])
app.include_router(dashboard_router,      prefix="/api", tags=["dashboard"])
app.include_router(dashboards_router,     prefix="/api", tags=["my-dashboards"])
app.include_router(development_router,    prefix="/api", tags=["development"])
app.include_router(agents_router,         prefix="/api", tags=["ai-agents"])
app.include_router(testing_router,        prefix="/api", tags=["testing"])
app.include_router(feedback_router,       prefix="/api", tags=["feedback"])
app.include_router(help_chat_router,      prefix="/api", tags=["help"])
app.include_router(agentic_router,           prefix="/api", tags=["agentic"])
app.include_router(conversion_agent_router, prefix="/api", tags=["conversion-agent"])
app.include_router(reconciliation_router,  prefix="/api", tags=["reconciliation"])
app.include_router(auth_router,            prefix="/api", tags=["auth"])
app.include_router(users_router,           prefix="/api", tags=["users"])
app.include_router(pipeline_router,        prefix="/api", tags=["pipeline"])
app.include_router(project_members_router,   prefix="/api", tags=["project-members"])
app.include_router(user_projects_router,     prefix="/api", tags=["project-members"])
app.include_router(approval_workflows_router, prefix="/api", tags=["approval-workflows"])
app.include_router(approval_requests_router,  prefix="/api", tags=["approval-requests"])
app.include_router(notifications_router,      prefix="/api", tags=["notifications"])
app.include_router(ask_ai_router,             prefix="/api", tags=["ask-ai"])
app.include_router(ui_validation_router,      prefix="/api", tags=["ui-validation"])
app.include_router(stories_router,            prefix="/api", tags=["hub"])
app.include_router(form_builder_router,       prefix="/api", tags=["form-builder"])
app.include_router(knowledge_router,          prefix="/api", tags=["knowledge"])

@app.get("/", include_in_schema=False)
async def serve_index():
    from fastapi.responses import JSONResponse
    return JSONResponse({"service": "Clarity Studio API", "ui": "http://localhost:3000"})


# ══════════════════════════════════════════════════════════════
# Target Formula Rules
# POST /api/target-formulas/process
# GET  /api/target-formulas?conn_id=X
# ══════════════════════════════════════════════════════════════

class _XmlReq(BaseModel):
    xml_content: str
    conn_id:     Optional[int] = None   # link template + rules to a connection
    name:        str           = "template.xml"

class _RuleOut(BaseModel):
    id:              Optional[int] = None
    target_path:     Optional[str] = None
    group_path:      Optional[str] = None
    formula_type:    Optional[str] = None
    expression:      Optional[str] = None
    default_value:   Optional[str] = None
    execution_order: Optional[int] = None

class _ProcessResult(BaseModel):
    inserted:    int
    template_id: Optional[int] = None
    rules:       list[_RuleOut]


def _parse_xml_rules(xml_string: str) -> list[dict]:
    try:
        root = ET.fromstring(xml_string)
    except ET.ParseError as exc:
        raise ValueError(str(exc)) from exc

    ordered_paths = {}

    def walk(node, path):
        tag  = node.tag.split("}")[-1] if "}" in node.tag else node.tag
        path = f"{path}/{tag}"
        kids = list(node)
        for attr_name, attr_val in node.attrib.items():
            if attr_name == "each":
                continue
            ordered_paths.setdefault(f"{path}/@{attr_name}", []).append(attr_val.strip())
        if not kids:
            ordered_paths.setdefault(path, []).append((node.text or "").strip())
        else:
            for child in kids:
                walk(child, path)

    walk(root, "")

    rules = []
    for order, (full_path, values) in enumerate(ordered_paths.items(), start=1):
        parts      = full_path.strip("/").split("/")
        group_path = f"/{parts[-2]}" if len(parts) >= 2 else None
        field      = parts[-1]
        target     = f"{group_path}/{field}" if group_path else full_path
        unique     = {v for v in values if v}
        rules.append({
            "target_path":     target,
            "group_path":      group_path,
            "formula_type":    "DEFAULT" if len(unique) == 1 else "DIRECT",
            "expression":      None,
            "default_value":   list(unique)[0] if len(unique) == 1 else None,
            "execution_order": order,
        })
    return rules


@app.post("/api/target-formulas/process", response_model=_ProcessResult, tags=["target-formulas"])
def process_target_formulas(req: _XmlReq, db: Session = Depends(get_db)):
    from api.models import XmlTemplate, TargetFormulaRule

    try:
        rules = _parse_xml_rules(req.xml_content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Upsert XML template (one per connection)
    template_id: Optional[int] = None
    if req.conn_id:
        tpl = db.query(XmlTemplate).filter_by(conn_id=req.conn_id).order_by(XmlTemplate.id.desc()).first()
        if tpl:
            tpl.content = req.xml_content
            tpl.name    = req.name
        else:
            tpl = XmlTemplate(conn_id=req.conn_id, name=req.name, content=req.xml_content)
            db.add(tpl)
        db.flush()
        template_id = tpl.id

        # Replace formula rules for this connection
        db.query(TargetFormulaRule).filter_by(conn_id=req.conn_id).delete()
        for r in rules:
            db.add(TargetFormulaRule(
                conn_id=req.conn_id, template_id=template_id, **r
            ))
    else:
        # No connection — legacy: just save rules without conn_id
        db.query(TargetFormulaRule).filter(TargetFormulaRule.conn_id.is_(None)).delete()
        for r in rules:
            db.add(TargetFormulaRule(**r))

    db.commit()

    return _ProcessResult(
        inserted=len(rules),
        template_id=template_id,
        rules=[_RuleOut(id=None, **r) for r in rules],
    )


@app.get("/api/target-formulas", response_model=list[_RuleOut], tags=["target-formulas"])
def list_target_formulas(conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    from api.models import TargetFormulaRule
    q = db.query(TargetFormulaRule)
    if conn_id is not None:
        q = q.filter_by(conn_id=conn_id)
    rows = q.order_by(TargetFormulaRule.execution_order).all()
    return [_RuleOut(
        id=r.id, target_path=r.target_path, group_path=r.group_path,
        formula_type=r.formula_type, expression=r.expression,
        default_value=r.default_value, execution_order=r.execution_order,
    ) for r in rows]


# ══════════════════════════════════════════════════════════════
# OpenAI Chat Proxy
# POST /api/chat
# ══════════════════════════════════════════════════════════════

class _ChatMessage(BaseModel):
    role: str
    content: str

class _ChatReq(BaseModel):
    messages: list[_ChatMessage]
    api_key: str = ""          # optional — falls back to OPENAI_API_KEY in .env
    model: str = "gpt-4o-mini"

class _ChatRes(BaseModel):
    message: str


@app.post("/api/chat", response_model=_ChatRes, tags=["chat"])
def chat_proxy(req: _ChatReq):
    api_key = req.api_key.strip() or settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="No OpenAI API key provided. Set OPENAI_API_KEY in .env or enter it in the UI.")
    try:
        from openai import OpenAI
        from api.services.pii_guard import audit_prompt

        # Server-side safety net: scan all user messages for residual PII
        safe_messages = []
        for m in req.messages:
            content = audit_prompt(m.content) if m.role == "user" else m.content
            safe_messages.append({"role": m.role, "content": content})

        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=req.model,
            messages=safe_messages,
            temperature=0.7,
        )
        return _ChatRes(message=response.choices[0].message.content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
