"""
agentic.py — Agentic AI Platform router.

Endpoints:
  Roles     POST/GET/PUT/DELETE /agentic/roles
            POST /agentic/roles/ai-generate
  Cards     POST/GET/PUT/DELETE /agentic/cards
            POST /agentic/cards/reorder
  Execution POST /agentic/execute
            GET  /agentic/executions
            GET  /agentic/executions/{id}
  Resources GET  /agentic/resources
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List

import json as _json
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.config import settings

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class RoleIn(BaseModel):
    role_name:          str
    description:        Optional[str] = None
    responsibilities:   Optional[str] = None
    skills:             Optional[str] = None
    input_expectation:  Optional[str] = None
    output_expectation: Optional[str] = None
    decision_logic:     Optional[str] = None
    deliverables:       Optional[str] = None
    tone:               Optional[str] = None
    is_active:          bool = True


class RoleOut(RoleIn):
    id:         int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class CardIn(BaseModel):
    name:               str
    description:        Optional[str] = None
    role_id:            Optional[int] = None
    agent_id:           Optional[int] = None   # named employee assigned to this step
    execution_order:    int = 0
    input_mapping:      Optional[str] = None
    output_mapping:     Optional[str] = None
    is_mandatory:       bool = True
    is_active:          bool = True
    on_reject_card_id:  Optional[int] = None   # loop-back target on REJECT
    max_iterations:     int = 3                # max loops before escalating


class CardOut(CardIn):
    id:         int
    created_at: Optional[str] = None


class ReorderItem(BaseModel):
    id:              int
    execution_order: int


class ExecuteRequest(BaseModel):
    conn_id:    Optional[int] = None
    user_query: str
    model:      str = "gpt-4o-mini"


class AIGenerateRoleRequest(BaseModel):
    prompt: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _role_out(r) -> dict:
    return {
        "id": r.id,
        "role_name": r.role_name,
        "description": r.description,
        "responsibilities": r.responsibilities,
        "skills": r.skills,
        "input_expectation": r.input_expectation,
        "output_expectation": r.output_expectation,
        "decision_logic": r.decision_logic,
        "deliverables": r.deliverables,
        "tone": r.tone,
        "is_active": r.is_active,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _card_out(c) -> dict:
    return {
        "id":                c.id,
        "name":              c.name,
        "description":       c.description,
        "role_id":           c.role_id,
        "agent_id":          c.agent_id,
        "execution_order":   c.execution_order,
        "input_mapping":     c.input_mapping,
        "output_mapping":    c.output_mapping,
        "is_mandatory":      c.is_mandatory,
        "is_active":         c.is_active,
        "on_reject_card_id": getattr(c, "on_reject_card_id", None),
        "max_iterations":    getattr(c, "max_iterations", 3),
        "created_at":        c.created_at.isoformat() if c.created_at else None,
    }


# ── ROLES ─────────────────────────────────────────────────────────────────────

# IMPORTANT: ai-generate must be before /{id} to avoid FastAPI routing to int coercion
@router.post("/agentic/roles/ai-generate")
def ai_generate_role(req: AIGenerateRoleRequest):
    """
    Use OpenAI to generate a role card JSON from a plain-English description.
    Returns a dict of field values — not saved yet (user reviews first).
    """
    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured")

    from openai import OpenAI
    client = OpenAI(api_key=api_key)

    system = """You are an AI role card designer for a multi-agent data analytics platform.
Given a role description, generate a structured JSON role card with EXACTLY these keys:
role_name, description, responsibilities, skills, input_expectation, output_expectation, decision_logic, deliverables, tone.

tone must be one of: analytical, strict QA, business-friendly, collaborative, executive.

Return ONLY valid JSON — no markdown, no code fences, no explanation."""

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": req.prompt},
            ],
            temperature=0.5,
            max_tokens=800,
            timeout=30,
        )
        import json
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        return data
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/agentic/roles")
def create_role(req: RoleIn, db: Session = Depends(get_db)):
    from api.models import AgentRole
    role = AgentRole(**req.model_dump())
    db.add(role)
    db.commit()
    db.refresh(role)
    return _role_out(role)


@router.get("/agentic/roles")
def list_roles(db: Session = Depends(get_db)):
    from api.models import AgentRole
    roles = db.query(AgentRole).order_by(AgentRole.id).all()
    return [_role_out(r) for r in roles]


@router.put("/agentic/roles/{role_id}")
def update_role(role_id: int, req: RoleIn, db: Session = Depends(get_db)):
    from api.models import AgentRole
    role = db.query(AgentRole).filter(AgentRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    for k, v in req.model_dump().items():
        setattr(role, k, v)
    role.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(role)
    return _role_out(role)


@router.delete("/agentic/roles/{role_id}")
def delete_role(role_id: int, db: Session = Depends(get_db)):
    from api.models import AgentRole
    role = db.query(AgentRole).filter(AgentRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    db.delete(role)
    db.commit()
    return {"ok": True}


# ── CARDS ─────────────────────────────────────────────────────────────────────

@router.post("/agentic/cards/reorder")
def reorder_cards(items: List[ReorderItem], db: Session = Depends(get_db)):
    from api.models import AgentCard
    for item in items:
        card = db.query(AgentCard).filter(AgentCard.id == item.id).first()
        if card:
            card.execution_order = item.execution_order
    db.commit()
    return {"ok": True}


@router.post("/agentic/cards")
def create_card(req: CardIn, db: Session = Depends(get_db)):
    from api.models import AgentCard
    card = AgentCard(**req.model_dump())
    db.add(card)
    db.commit()
    db.refresh(card)
    return _card_out(card)


@router.get("/agentic/cards")
def list_cards(db: Session = Depends(get_db)):
    from api.models import AgentCard
    cards = db.query(AgentCard).order_by(AgentCard.execution_order, AgentCard.id).all()
    return [_card_out(c) for c in cards]


@router.put("/agentic/cards/{card_id}")
def update_card(card_id: int, req: CardIn, db: Session = Depends(get_db)):
    from api.models import AgentCard
    card = db.query(AgentCard).filter(AgentCard.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    for k, v in req.model_dump().items():
        setattr(card, k, v)
    card.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(card)
    return _card_out(card)


@router.delete("/agentic/cards/{card_id}")
def delete_card(card_id: int, db: Session = Depends(get_db)):
    from api.models import AgentCard
    card = db.query(AgentCard).filter(AgentCard.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    db.delete(card)
    db.commit()
    return {"ok": True}


# ── EXECUTION ─────────────────────────────────────────────────────────────────

@router.post("/agentic/execute")
def execute_workflow(req: ExecuteRequest, db: Session = Depends(get_db)):
    """Run the full A2A workflow and return execution + steps."""
    from api.services.agentic_orchestrator import run_workflow
    try:
        result = run_workflow(
            conn_id=req.conn_id,
            user_query=req.user_query,
            model=req.model,
            db=db,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/agentic/execute/stream")
def execute_workflow_stream(req: ExecuteRequest, db: Session = Depends(get_db)):
    """
    SSE endpoint — streams step events as the workflow runs.
    Events:
      data: {"type": "start",    "execution_id": N, "total_steps": N}
      data: {"type": "thinking", "step_number": N, "card_name": "...", "agent_name": "...", "role_name": "..."}
      data: {"type": "step",     "step": {...}}
      data: {"type": "done",     "execution": {...}, "steps": [...]}
      data: {"type": "error",    "message": "..."}
    """
    from api.services.agentic_orchestrator import stream_workflow

    def generate():
        try:
            for event in stream_workflow(req.conn_id, req.user_query, req.model, db):
                yield f"data: {_json.dumps(event)}\n\n"
        except Exception as exc:
            yield f"data: {_json.dumps({'type': 'error', 'message': str(exc)[:300]})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )


@router.get("/agentic/executions")
def list_executions(limit: int = 50, status: Optional[str] = None, db: Session = Depends(get_db)):
    from api.models import WorkflowExecution
    q = db.query(WorkflowExecution).order_by(WorkflowExecution.id.desc())
    if status:
        q = q.filter(WorkflowExecution.status == status)
    rows = q.limit(limit).all()
    return [
        {
            "id": r.id,
            "conn_id": r.conn_id,
            "user_query": r.user_query,
            "model": r.model,
            "status": r.status,
            "total_steps": r.total_steps,
            "completed_steps": r.completed_steps,
            "final_summary": r.final_summary,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        }
        for r in rows
    ]


@router.post("/agentic/executions/{execution_id}/cancel")
def cancel_execution(execution_id: int, db: Session = Depends(get_db)):
    from api.models import WorkflowExecution
    from datetime import datetime
    ex = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution_id).first()
    if not ex:
        raise HTTPException(status_code=404, detail="Execution not found")
    if ex.status not in ("running", "pending"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel execution with status '{ex.status}'")
    ex.status = "cancelled"
    ex.finished_at = datetime.utcnow()
    db.commit()
    return {"id": execution_id, "status": "cancelled"}


@router.get("/agentic/executions/{execution_id}")
def get_execution(execution_id: int, db: Session = Depends(get_db)):
    from api.models import WorkflowExecution, WorkflowExecutionStep
    ex = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution_id).first()
    if not ex:
        raise HTTPException(status_code=404, detail="Execution not found")
    steps = (
        db.query(WorkflowExecutionStep)
        .filter(WorkflowExecutionStep.execution_id == execution_id)
        .order_by(WorkflowExecutionStep.step_number)
        .all()
    )
    return {
        "execution": {
            "id": ex.id,
            "conn_id": ex.conn_id,
            "user_query": ex.user_query,
            "model": ex.model,
            "status": ex.status,
            "total_steps": ex.total_steps,
            "completed_steps": ex.completed_steps,
            "final_summary": ex.final_summary,
            "created_at": ex.created_at.isoformat() if ex.created_at else None,
            "finished_at": ex.finished_at.isoformat() if ex.finished_at else None,
        },
        "steps": [_step_out(s) for s in steps],
    }


def _step_out(s) -> dict:
    return {
        "id":                s.id,
        "execution_id":      s.execution_id,
        "step_number":       s.step_number,
        "card_id":           getattr(s, "card_id", None),
        "card_name":         s.card_name,
        "role_name":         s.role_name,
        "agent_name":        s.agent_name,
        "iteration":         getattr(s, "iteration", 1),
        "decision":          getattr(s, "decision", None),
        "decision_notes":    getattr(s, "decision_notes", None),
        "input_text":        s.input_text,
        "output_text":       s.output_text,
        "prompt_used":       s.prompt_used,
        "status":            s.status,
        "execution_time_ms": s.execution_time_ms,
        "created_at":        s.created_at.isoformat() if s.created_at else None,
    }


# ── RESOURCES ─────────────────────────────────────────────────────────────────

@router.get("/agentic/resources")
def get_resources(conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Return roles, agents, available tools, and context summary for the UI."""
    from api.models import AgentRole, AIAgent
    from api.services.agentic_orchestrator import TOOL_LABELS
    roles  = db.query(AgentRole).filter(AgentRole.is_active == True).order_by(AgentRole.id).all()  # noqa: E712
    agents = db.query(AIAgent).order_by(AIAgent.id).all()

    context_summary = ""
    if conn_id:
        try:
            from api.services.context_cache import get_or_build
            ctx = get_or_build(conn_id, db)
            table_count = len(ctx.tables or [])
            context_summary = f"{table_count} tables available in schema context."
        except Exception:
            pass

    return {
        "roles": [_role_out(r) for r in roles],
        "agents": [
            {
                "id":          a.id,
                "name":        a.name,
                "description": a.description,
                "status":      a.status,
                "role_id":     getattr(a, "role_id", None),
                "tools_json":  getattr(a, "tools_json", None),
                "category":    getattr(a, "category", None),
            }
            for a in agents
        ],
        "available_tools":  [{"key": k, "label": v} for k, v in TOOL_LABELS.items()],
        "context_summary":  context_summary,
    }


# ── AI WORKFLOW DESIGNER ──────────────────────────────────────────────────────

class WorkflowDesignRequest(BaseModel):
    requirement: str                  # plain-English description or BRD text
    conn_id:     Optional[int] = None
    brd_text:    Optional[str] = None  # optional full BRD document to paste


class ApplyWorkflowRequest(BaseModel):
    cards: list[dict]   # the proposed cards array from design-workflow


@router.post("/agentic/apply-workflow")
def apply_workflow(req: ApplyWorkflowRequest, db: Session = Depends(get_db)):
    """
    Save a proposed workflow design to the database as real AgentCards,
    replacing all existing active cards.
    """
    from api.models import AgentCard as AgentCardModel

    # Deactivate existing cards
    db.query(AgentCardModel).update({"is_active": False})
    db.flush()

    created = []
    for c in req.cards:
        card = AgentCardModel(
            name=c.get("name", "Untitled Step"),
            description=c.get("description"),
            role_id=c.get("role_id"),
            agent_id=c.get("agent_id"),
            execution_order=c.get("execution_order", 1),
            is_mandatory=c.get("is_mandatory", True),
            is_active=True,
            on_reject_card_id=None,   # resolved after all cards created
            max_iterations=c.get("max_iterations", 3),
        )
        db.add(card)
        db.flush()
        created.append(card)

    db.commit()
    return {"created": len(created), "cards": [_card_out(c) for c in created]}


@router.post("/agentic/design-workflow")
def design_workflow(req: WorkflowDesignRequest, db: Session = Depends(get_db)):
    """
    AI-generate a complete workflow design from a plain-English requirement.
    Returns a proposed set of cards (with roles + agents) that the user can
    review and apply with one click.
    Does NOT save anything — the user confirms first.
    """
    from api.models import AgentRole, AIAgent
    from api.services.agentic_orchestrator import TOOL_LABELS

    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured")

    # Gather available roles and agents to give the AI context
    roles  = db.query(AgentRole).filter(AgentRole.is_active == True).all()  # noqa: E712
    agents = db.query(AIAgent).filter(AIAgent.status == "active").all()

    roles_summary  = "\n".join(f"  - Role #{r.id}: {r.role_name} ({r.description or ''})" for r in roles)
    agents_summary = "\n".join(f"  - Agent #{a.id}: {a.name} (role_id={getattr(a,'role_id',None)}, tools={getattr(a,'tools_json','[]')})" for a in agents)
    tools_summary  = "\n".join(f"  - {k}: {v}" for k, v in TOOL_LABELS.items())

    system = f"""You are a workflow architect for an AI-powered multi-agent organisation platform.

Available Roles:
{roles_summary or '  (none yet)'}

Available Agents (named employees):
{agents_summary or '  (none yet)'}

Available Tools:
{tools_summary}

Given a business requirement, design a workflow as a JSON array of card objects.
Each card represents one step in the pipeline. Output ONLY valid JSON — no markdown, no explanation.

JSON schema for each card:
{{
  "name": "string — descriptive step name",
  "description": "string — what this step does",
  "role_id": number | null,
  "agent_id": number | null,
  "execution_order": number (1, 2, 3...),
  "is_mandatory": true,
  "is_active": true,
  "on_reject_card_id": null,
  "max_iterations": 3,
  "suggested_tools": ["db", "jira", "api", ...],
  "rationale": "string — why this step/agent was chosen"
}}

Rules:
- Use real role_id and agent_id values from the lists above when possible.
- If no agent fits, set agent_id to null and explain in rationale.
- Include a review/approval step near the end (Team Lead or Manager).
- on_reject_card_id should reference the execution_order of the step to loop back to (as a hint — will be resolved by the UI).
- Keep the workflow between 3 and 7 steps.
- Output ONLY the JSON array."""

    from openai import OpenAI
    import json as _json

    client = OpenAI(api_key=api_key)
    try:
        user_content = req.requirement
        if req.brd_text:
            user_content = f"Business Requirement:\n{req.requirement}\n\n--- BRD Document ---\n{req.brd_text[:8000]}"

        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user_content},
            ],
            temperature=0.4,
            max_tokens=1500,
            timeout=45,
        )
        raw = resp.choices[0].message.content or "[]"
        # Strip any accidental markdown fences
        raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        cards = _json.loads(raw)
        return {"cards": cards, "requirement": req.requirement}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── SAVED AGENTIC WORKFLOWS ───────────────────────────────────────────────────

class SavedWorkflowIn(BaseModel):
    name:           str
    description:    Optional[str] = None
    user_query:     str
    conn_id:        Optional[int] = None
    model:          str = "gpt-4o-mini"
    schedule_label: Optional[str] = None  # "none" | "daily" | "weekly" | "monthly"


def _swf_out(w) -> dict:
    return {
        "id":                w.id,
        "name":              w.name,
        "description":       w.description,
        "user_query":        w.user_query,
        "conn_id":           w.conn_id,
        "model":             w.model,
        "schedule_label":    w.schedule_label,
        "last_run_at":       w.last_run_at.isoformat() if w.last_run_at else None,
        "last_execution_id": w.last_execution_id,
        "is_active":         w.is_active,
        "created_at":        w.created_at.isoformat() if w.created_at else None,
    }


@router.get("/agentic/saved-workflows")
def list_saved_workflows(db: Session = Depends(get_db)):
    from api.models import SavedAgenticWorkflow
    rows = db.query(SavedAgenticWorkflow).filter(
        SavedAgenticWorkflow.is_active == True  # noqa: E712
    ).order_by(SavedAgenticWorkflow.id.desc()).all()
    return [_swf_out(r) for r in rows]


@router.post("/agentic/saved-workflows")
def create_saved_workflow(req: SavedWorkflowIn, db: Session = Depends(get_db)):
    from api.models import SavedAgenticWorkflow
    w = SavedAgenticWorkflow(
        name=req.name,
        description=req.description,
        user_query=req.user_query,
        conn_id=req.conn_id,
        model=req.model,
        schedule_label=req.schedule_label,
    )
    db.add(w)
    db.commit()
    db.refresh(w)
    return _swf_out(w)


@router.put("/agentic/saved-workflows/{wf_id}")
def update_saved_workflow(wf_id: int, req: SavedWorkflowIn, db: Session = Depends(get_db)):
    from api.models import SavedAgenticWorkflow
    from datetime import datetime as _dt
    w = db.query(SavedAgenticWorkflow).filter(SavedAgenticWorkflow.id == wf_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Workflow not found")
    w.name           = req.name
    w.description    = req.description
    w.user_query     = req.user_query
    w.conn_id        = req.conn_id
    w.model          = req.model
    w.schedule_label = req.schedule_label
    w.updated_at     = _dt.utcnow()
    db.commit()
    db.refresh(w)
    return _swf_out(w)


@router.delete("/agentic/saved-workflows/{wf_id}")
def delete_saved_workflow(wf_id: int, db: Session = Depends(get_db)):
    from api.models import SavedAgenticWorkflow
    w = db.query(SavedAgenticWorkflow).filter(SavedAgenticWorkflow.id == wf_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Workflow not found")
    w.is_active = False
    db.commit()
    return {"ok": True}


@router.post("/agentic/saved-workflows/{wf_id}/run")
def run_saved_workflow(wf_id: int, db: Session = Depends(get_db)):
    from api.models import SavedAgenticWorkflow
    from api.services.agentic_orchestrator import run_workflow
    from datetime import datetime as _dt
    w = db.query(SavedAgenticWorkflow).filter(SavedAgenticWorkflow.id == wf_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Workflow not found")
    try:
        result = run_workflow(
            conn_id=w.conn_id,
            user_query=w.user_query,
            model=w.model,
            db=db,
        )
        w.last_run_at       = _dt.utcnow()
        w.last_execution_id = result["execution"]["id"]
        w.updated_at        = _dt.utcnow()
        db.commit()
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
