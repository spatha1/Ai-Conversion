"""
agents.py — AI Agents CRUD + execution endpoints.

Routes (all under /api prefix from main.py):
  POST   /api/agents              — create agent
  GET    /api/agents              — list agents (optional ?conn_id=)
  GET    /api/agents/{id}         — get single agent
  PUT    /api/agents/{id}         — update agent
  DELETE /api/agents/{id}         — delete agent
  POST   /api/agents/{id}/run     — execute agent now
  POST   /api/agents/{id}/pause   — toggle active/paused
  GET    /api/agents/{id}/logs    — list execution logs
  POST   /api/agents/from-ps-chat — create agent from PS chat conversation
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import AIAgent, AIAgentLog
from api.schemas import AIAgentCreate, AIAgentUpdate, AIAgentOut, AIAgentLogOut

from api.dependencies import require_developer

router = APIRouter(dependencies=[Depends(require_developer)])


# ── helpers ────────────────────────────────────────────────────

def _get_agent(agent_id: int, db: Session) -> AIAgent:
    agent = db.query(AIAgent).filter_by(id=agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
    return agent


def _do_run(agent_id: int, model: str, db: Session) -> AIAgentLog:
    """Synchronously run the agent and persist a log entry."""
    from api.services.agent_engine import run_agent

    agent = _get_agent(agent_id, db)

    # Create a 'running' log entry first
    log = AIAgentLog(agent_id=agent_id, status="running")
    db.add(log)
    db.commit()
    db.refresh(log)

    result = run_agent(
        agent_id=agent_id,
        goal=agent.goal,
        conn_id=agent.conn_id,
        model=model,
        db=db,
    )

    # Update log with results
    log.status         = result["status"]
    log.generated_plan = result["generated_plan"]
    log.steps_executed = result["steps_executed"]
    log.result_summary = result["result_summary"]
    log.error          = result["error"]
    log.execution_time = result["execution_time"]
    log.finished_at    = result["finished_at"]

    # Update agent last_run_at
    agent.last_run_at = datetime.utcnow()
    db.commit()
    db.refresh(log)
    return log


# ── CRUD ───────────────────────────────────────────────────────

# ── Create from PS Chat (MUST be before /{agent_id} routes) ───

class FromChatRequest(BaseModel):
    conversation_id: int
    name:            str
    description:     Optional[str] = None
    conn_id:         Optional[int] = None
    schedule:        Optional[str] = "manual"


@router.post("/agents/from-ps-chat", response_model=AIAgentOut, tags=["ai-agents"])
def create_from_chat(body: FromChatRequest, db: Session = Depends(get_db)):
    """
    Create an agent using the last user message of a PS Support conversation as the goal.
    The agent stores only the goal — no SQL, no fixed steps.
    """
    from api.models import PsConversation, PsMessage

    conv = db.query(PsConversation).filter_by(id=body.conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    last_user_msg = (
        db.query(PsMessage)
        .filter_by(conversation_id=body.conversation_id, role="user")
        .order_by(PsMessage.id.desc())
        .first()
    )
    goal = (last_user_msg.content or "").strip() if last_user_msg else conv.title or "No goal specified"

    agent = AIAgent(
        name=body.name,
        description=body.description,
        goal=goal,
        conn_id=body.conn_id or conv.conn_id,
        schedule=body.schedule,
        status="active",
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


# ── CRUD ───────────────────────────────────────────────────────

@router.post("/agents", response_model=AIAgentOut, tags=["ai-agents"])
def create_agent(body: AIAgentCreate, db: Session = Depends(get_db)):
    agent = AIAgent(**body.model_dump())
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


@router.get("/agents", response_model=list[AIAgentOut], tags=["ai-agents"])
def list_agents(conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(AIAgent)
    if conn_id is not None:
        q = q.filter_by(conn_id=conn_id)
    return q.order_by(AIAgent.id.desc()).all()


@router.get("/agents/{agent_id}", response_model=AIAgentOut, tags=["ai-agents"])
def get_agent(agent_id: int, db: Session = Depends(get_db)):
    return _get_agent(agent_id, db)


@router.put("/agents/{agent_id}", response_model=AIAgentOut, tags=["ai-agents"])
def update_agent(agent_id: int, body: AIAgentUpdate, db: Session = Depends(get_db)):
    agent = _get_agent(agent_id, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(agent, field, value)
    agent.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(agent)
    return agent


@router.delete("/agents/{agent_id}", tags=["ai-agents"])
def delete_agent(agent_id: int, db: Session = Depends(get_db)):
    agent = _get_agent(agent_id, db)
    db.delete(agent)
    db.commit()
    return {"deleted": agent_id}


# ── Execution ──────────────────────────────────────────────────

@router.post("/agents/{agent_id}/run", response_model=AIAgentLogOut, tags=["ai-agents"])
def run_agent_now(
    agent_id: int,
    model: str = "gpt-4o-mini",
    db: Session = Depends(get_db),
):
    """Execute the agent synchronously and return the log entry."""
    agent = _get_agent(agent_id, db)
    if agent.status == "inactive":
        raise HTTPException(status_code=400, detail="Agent is inactive — activate it first")
    return _do_run(agent_id, model, db)


@router.post("/agents/{agent_id}/pause", response_model=AIAgentOut, tags=["ai-agents"])
def toggle_pause(agent_id: int, db: Session = Depends(get_db)):
    """Toggle between active and paused."""
    agent = _get_agent(agent_id, db)
    agent.status = "paused" if agent.status == "active" else "active"
    agent.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(agent)
    return agent


# ── Logs ───────────────────────────────────────────────────────

@router.get("/agents/{agent_id}/logs", response_model=list[AIAgentLogOut], tags=["ai-agents"])
def get_agent_logs(
    agent_id: int,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    _get_agent(agent_id, db)   # validate agent exists
    return (
        db.query(AIAgentLog)
        .filter_by(agent_id=agent_id)
        .order_by(AIAgentLog.id.desc())
        .limit(limit)
        .all()
    )


