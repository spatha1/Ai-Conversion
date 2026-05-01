"""
api/routers/mapping_assistant.py
Mapping Assistant chat endpoint — DCT Extract Mapper expert powered by
SAI KB + OOTB sample XMLs + optional session context.

POST /mapping-assistant/ask
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.dependencies import require_developer
from api.database import get_db

router = APIRouter(dependencies=[Depends(require_developer)])

SAMPLES_DIR = Path(__file__).parent.parent.parent / "samples" / "agent_mapper"

_SYSTEM_PROMPT = """\
You are an expert Duck Creek Technologies (DCT) Extract Mapper assistant.
Answer questions about DCT manuscript XML, mapping patterns, field types, entities,
LOB configuration, and best practices.

Keep answers concise and practical. Include XML snippets when relevant.
"""

ENTITY_KEYWORDS = ["risk", "policy", "account", "coverage"]
TYPE_KEYWORDS   = ["extra", "reference", "base", "risk", "dynamic", "controller"]


# ── Request / Response models ────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role:    str
    content: str


class SessionContext(BaseModel):
    entity:       Optional[str] = None
    field:        Optional[str] = None
    template_name: Optional[str] = None
    generated_xml: Optional[str] = None
    grid:          Optional[list] = None


class AskRequest(BaseModel):
    question:        str
    history:         list[ChatMessage] = []
    session_context: Optional[SessionContext] = None


class AskResponse(BaseModel):
    answer:     str
    sources:    list[str]
    tokens_in:  int
    tokens_out: int
    latency_ms: int


# ── Helpers ──────────────────────────────────────────────────────────────────

def _load_ootb_samples(question: str) -> tuple[str, list[str]]:
    """Load ≤3 OOTB sample XMLs that are relevant to the question."""
    if not SAMPLES_DIR.exists():
        return "", []

    q_lower  = question.lower()
    files    = sorted(SAMPLES_DIR.glob("*.xml"))
    selected: list[Path] = []

    # Priority 1: files matching entity + type keywords from question
    for f in files:
        fname = f.stem.lower()
        matches = (
            any(e in q_lower for e in ENTITY_KEYWORDS if e in fname) or
            any(t in q_lower for t in TYPE_KEYWORDS   if t in fname)
        )
        if matches:
            selected.append(f)
        if len(selected) >= 3:
            break

    # Fallback: take first 2 generic samples
    if not selected:
        selected = files[:2]

    chunks: list[str] = []
    source_names: list[str] = []
    for f in selected[:3]:
        try:
            chunks.append(f"--- {f.name} ---\n" + f.read_text(encoding="utf-8")[:1500])
            source_names.append(f.name)
        except Exception:
            pass

    return "\n\n".join(chunks), source_names


def _kb_context(question: str, db: Session) -> tuple[str, list[str]]:
    """Retrieve relevant SAI KB chunks."""
    sources: list[str] = []
    try:
        from api.config import settings
        from api.models import KnowledgeChunk
        from api.services.embeddings import get_embedding, cosine_similarity

        count = db.query(KnowledgeChunk).filter(KnowledgeChunk.embedding.isnot(None)).count()
        if count == 0:
            return "", []

        emb  = get_embedding(question, settings.OPENAI_API_KEY)
        rows = db.query(KnowledgeChunk).filter(KnowledgeChunk.embedding.isnot(None)).limit(300).all()
        scored = []
        for row in rows:
            try:
                score = __import__('api.services.embeddings', fromlist=['cosine_similarity']).cosine_similarity(
                    emb, json.loads(row.embedding)
                )
                if score >= 0.72:
                    scored.append((score, row))
            except Exception:
                pass

        if not scored:
            return "", []

        scored.sort(key=lambda x: x[0], reverse=True)
        lines: list[str] = []
        seen: set[int] = set()
        for _, chunk in scored[:3]:
            if chunk.entry_id in seen:
                continue
            seen.add(chunk.entry_id)
            lines.append(chunk.content[:400])
            sources.append(f"KB: {chunk.content[:60].strip()}...")

        if lines:
            return "\n=== SAI Knowledge Base ===\n" + "\n---\n".join(lines), sources
    except Exception:
        pass
    return "", []


def _build_system_prompt(
    question: str,
    db: Session,
    session_context: Optional[SessionContext],
) -> tuple[str, list[str]]:
    parts    = [_SYSTEM_PROMPT]
    sources: list[str] = []

    ootb_xml, ootb_sources = _load_ootb_samples(question)
    if ootb_xml:
        parts.append("\n=== OOTB MANUSCRIPT PATTERNS ===\n" + ootb_xml)
        sources.extend(ootb_sources)

    # v1: OOTB samples only — KB embeddings disabled
    # kb_text, kb_sources = _kb_context(question, db)

    if session_context:
        ctx_parts = ["=== CURRENT SESSION CONTEXT ==="]
        if session_context.entity:
            ctx_parts.append(f"Entity: {session_context.entity}")
        if session_context.field:
            ctx_parts.append(f"Field: {session_context.field}")
        if session_context.template_name:
            ctx_parts.append(f"Template: {session_context.template_name}")
        if session_context.generated_xml:
            ctx_parts.append("Generated XML (excerpt):\n" + session_context.generated_xml[:2000])
        parts.append("\n".join(ctx_parts))

    return "\n\n".join(parts), sources


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/mapping-assistant/ask", response_model=AskResponse)
def ask(req: AskRequest, db: Session = Depends(get_db)):
    from api.config import settings
    from openai import OpenAI
    from api.services import ai_trace

    if not req.question.strip():
        raise HTTPException(status_code=422, detail="question is required")

    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    system_prompt, sources = _build_system_prompt(req.question, db, req.session_context)

    # DB prompt override
    try:
        from api.models import PromptTemplate as _PT
        tmpl = db.query(_PT).filter(
            _PT.category == "mapping_assistant", _PT.is_active.is_(True)
        ).first()
        if tmpl and tmpl.content and tmpl.content.strip():
            system_prompt = tmpl.content.strip()
    except Exception:
        pass

    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for m in req.history[-6:]:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": req.question})

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0     = time.monotonic()
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.3,
            max_tokens=1000,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:300])

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    answer     = resp.choices[0].message.content or ""
    tokens_in  = resp.usage.prompt_tokens     if resp.usage else 0
    tokens_out = resp.usage.completion_tokens if resp.usage else 0

    try:
        ai_trace.store(
            module="mapping_assistant",
            conn_id=None,
            model="gpt-4o-mini",
            prompt=system_prompt[:4000],
            response=answer[:4000],
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=elapsed_ms,
            db=db,
        )
    except Exception:
        pass

    return AskResponse(
        answer=answer,
        sources=sources,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=elapsed_ms,
    )
