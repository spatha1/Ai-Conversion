"""
session_processor.py — AI extraction pipeline for RequirementSession.

process_session(session_id, db, model, create_kb_entries)
  1. Load session + transcript_raw
  2. LLM structured extraction (JSON mode): requirements, decisions, action items,
     risks, technical metadata, open questions — each with confidence_score
  3. Persist as SessionArtifact rows with generated codes (GL-REQ-001, etc.)
  4. Auto-create ArtifactLink rows from cross-references in LLM output
  5. Optionally auto-promote high-confidence APPROVED artifacts to KB entries
  6. Log to AITraceLog
"""
from __future__ import annotations

import json
import time
from datetime import datetime, date
from typing import Optional

from sqlalchemy.orm import Session

from api.config import settings


# ── Artifact type → code prefix ───────────────────────────────────────────────

ARTIFACT_PREFIXES: dict[str, str] = {
    "Requirement":      "REQ",
    "Decision":         "DEC",
    "ActionItem":       "ACT",
    "Risk":             "RISK",
    "TechnicalMetadata": "TECH",
    "OpenQuestion":     "QUE",
}

_TYPE_COUNTERS: dict[str, int] = {}   # in-process counter per (session_id, type)


def _next_code(session_id: int, artifact_type: str, schema_prefix: str, db: Session) -> str:
    from api.models import SessionArtifact
    prefix = ARTIFACT_PREFIXES.get(artifact_type, "ART")
    count = db.query(SessionArtifact).filter_by(
        session_id=session_id, artifact_type=artifact_type).count()
    # Also count what we're about to insert in-process
    key = f"{session_id}:{artifact_type}"
    _TYPE_COUNTERS[key] = _TYPE_COUNTERS.get(key, count)
    _TYPE_COUNTERS[key] += 1
    seq = str(_TYPE_COUNTERS[key]).zfill(3)
    return f"{schema_prefix}-{prefix}-{seq}" if schema_prefix else f"{prefix}-{seq}"


# ── Extraction prompt ─────────────────────────────────────────────────────────

_EXTRACTION_SYSTEM_PROMPT = """You are an enterprise knowledge extraction AI.
Given meeting notes or session transcript text, extract ALL structured information.
Assign a confidence_score (0.0–1.0) to each item based on how explicitly it is stated.

Return ONLY valid JSON with exactly these keys:
{
  "summary": "<3-5 sentence meeting summary>",
  "requirements": [
    {"title": "", "description": "", "priority": "HIGH|MEDIUM|LOW",
     "systems_involved": [], "linked_decision_titles": [], "confidence_score": 0.9}
  ],
  "decisions": [
    {"title": "", "description": "", "status": "APPROVED|PENDING|REJECTED",
     "owner": "", "linked_requirement_titles": [], "confidence_score": 0.95}
  ],
  "action_items": [
    {"title": "", "description": "", "owner": "", "due_date": "YYYY-MM-DD or null",
     "priority": "HIGH|MEDIUM|LOW", "confidence_score": 0.85}
  ],
  "risks": [
    {"title": "", "description": "", "severity": "CRITICAL|HIGH|MEDIUM|LOW",
     "mitigation": "", "confidence_score": 0.8}
  ],
  "technical_metadata": [
    {"title": "", "description": "",
     "type": "Table|API|Procedure|Report|Field|System|Query",
     "systems_involved": [], "confidence_score": 0.9}
  ],
  "open_questions": [
    {"title": "", "description": "", "owner": "", "confidence_score": 0.7}
  ]
}
Rules:
- Extract only what is explicitly stated. Do not invent or infer beyond the text.
- Leave arrays empty [] if nothing of that type is present.
- linked_decision_titles / linked_requirement_titles must match exact titles you extracted.
- due_date must be null if no date is mentioned.
"""


# ── Main entry point ──────────────────────────────────────────────────────────

def process_session(
    session_id: int,
    db: Session,
    model: str = "gpt-4o-mini",
    create_kb_entries: bool = True,
) -> dict:
    """
    Run full AI extraction pipeline on a RequirementSession.
    Returns a summary dict: {session_id, artifacts_created, kb_entries_created, status}.
    Called from the router via BackgroundTasks so the HTTP response returns immediately.
    """
    from api.models import (
        RequirementSession, KnowledgeSchema, SessionArtifact, ArtifactLink, AITraceLog
    )

    # Clear in-process counters for this session
    for key in list(_TYPE_COUNTERS.keys()):
        if key.startswith(f"{session_id}:"):
            del _TYPE_COUNTERS[key]

    session = db.query(RequirementSession).filter_by(id=session_id).first()
    if not session:
        raise ValueError(f"Session {session_id} not found")

    if not session.transcript_raw or not session.transcript_raw.strip():
        raise ValueError("transcript_raw is empty — cannot extract without content")

    # Determine schema prefix for artifact codes
    schema_prefix = ""
    if session.kb_schema_id:
        ks = db.query(KnowledgeSchema).filter_by(id=session.kb_schema_id).first()
        if ks:
            schema_prefix = ks.name.upper()

    # Mark as processing
    session.status = "EXTRACTING"
    session.processing_started_at = datetime.utcnow()
    session.retry_count = (session.retry_count or 0) + 1
    session.last_error = None
    db.commit()

    try:
        from api.services.ai_client import get_client, chat_model as _cm
        client = get_client()

        tech_ctx_block = ""
        if session.db_schema_name or session.source_system or session.technical_context_json:
            tech_ctx_block = "\n\nTECHNICAL CONTEXT:\n"
            if session.db_schema_name:
                tech_ctx_block += f"DB Schema: {session.db_schema_name}\n"
            if session.db_connection_name:
                tech_ctx_block += f"Connection: {session.db_connection_name}\n"
            if session.source_system:
                tech_ctx_block += f"Source System: {session.source_system}\n"
            if session.environment_name:
                tech_ctx_block += f"Environment: {session.environment_name}\n"
            if session.technical_context_json:
                tech_ctx_block += f"Technical Details: {session.technical_context_json}\n"

        user_msg = f"""SESSION TYPE: {session.session_type}
SESSION TITLE: {session.title}{tech_ctx_block}

TRANSCRIPT / NOTES:
{session.transcript_raw[:12000]}
"""

        t0 = time.time()
        resp = client.chat.completions.create(
            model=_cm(model),
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _EXTRACTION_SYSTEM_PROMPT},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0.2,
        )
        elapsed_ms = int((time.time() - t0) * 1000)

        raw = resp.choices[0].message.content or "{}"
        extracted = json.loads(raw)

        # Log to AI trace
        try:
            db.add(AITraceLog(
                module="session_processor",
                model=model,
                prompt_text=user_msg[:4000],
                response_text=raw[:4000],
                tokens_in=resp.usage.prompt_tokens if resp.usage else 0,
                tokens_out=resp.usage.completion_tokens if resp.usage else 0,
                latency_ms=elapsed_ms,
            ))
            db.commit()
        except Exception:
            pass

        # ── Persist artifacts ──────────────────────────────────────────────────
        session.status = "EMBEDDING"
        session.summary = extracted.get("summary", "")
        db.commit()

        # Maps title → artifact_id for cross-reference link creation
        title_to_artifact_id: dict[str, int] = {}
        artifacts_created = 0
        kb_entries_created = 0

        artifact_groups: list[tuple[str, list[dict]]] = [
            ("Requirement",      extracted.get("requirements", [])),
            ("Decision",         extracted.get("decisions", [])),
            ("ActionItem",       extracted.get("action_items", [])),
            ("Risk",             extracted.get("risks", [])),
            ("TechnicalMetadata", extracted.get("technical_metadata", [])),
            ("OpenQuestion",     extracted.get("open_questions", [])),
        ]

        # Collect pending links: (source_title, target_title list)
        pending_links: list[tuple[str, list[str], str]] = []

        for artifact_type, items in artifact_groups:
            for item in items:
                title = (item.get("title") or "").strip()
                if not title:
                    continue

                code = _next_code(session_id, artifact_type, schema_prefix, db)

                # Parse due_date
                due_date_val: Optional[date] = None
                raw_due = item.get("due_date")
                if raw_due and raw_due != "null":
                    try:
                        due_date_val = datetime.strptime(raw_due, "%Y-%m-%d").date()
                    except ValueError:
                        pass

                # Systems involved
                systems = item.get("systems_involved", [])
                systems_json = json.dumps(systems) if systems else None

                # Map description field (risk has "mitigation" as extra)
                description = item.get("description", "")
                if artifact_type == "Risk" and item.get("mitigation"):
                    description = f"{description}\n\nMitigation: {item['mitigation']}".strip()

                # Determine status from LLM for decisions
                artifact_status = "PENDING_REVIEW"
                if artifact_type == "Decision":
                    lm_status = item.get("status", "PENDING")
                    if lm_status == "APPROVED":
                        artifact_status = "APPROVED"
                    elif lm_status == "REJECTED":
                        artifact_status = "REJECTED"

                art = SessionArtifact(
                    session_id=session_id,
                    kb_schema_id=session.kb_schema_id,
                    artifact_type=artifact_type,
                    artifact_code=code,
                    title=title,
                    description=description or None,
                    owner=item.get("owner") or None,
                    due_date=due_date_val,
                    priority=item.get("priority") or item.get("severity") or None,
                    status=artifact_status,
                    systems_involved=systems_json,
                    confidence_score=item.get("confidence_score"),
                )
                db.add(art)
                db.flush()   # get art.id

                title_to_artifact_id[title] = art.id
                artifacts_created += 1

                # Collect cross-reference links
                linked_titles: list[str] = (
                    item.get("linked_decision_titles", []) +
                    item.get("linked_requirement_titles", [])
                )
                if linked_titles:
                    pending_links.append((title, linked_titles, "requires"))

        db.commit()

        # ── Create traceability links ──────────────────────────────────────────
        for source_title, target_titles, rel_type in pending_links:
            src_id = title_to_artifact_id.get(source_title)
            if not src_id:
                continue
            for tgt_title in target_titles:
                tgt_id = title_to_artifact_id.get(tgt_title)
                if tgt_id and tgt_id != src_id:
                    db.add(ArtifactLink(
                        source_artifact_id=src_id,
                        target_artifact_id=tgt_id,
                        relationship_type=rel_type,
                    ))
        db.commit()

        # ── Quick-view JSON fields on session ──────────────────────────────────
        raw_decisions = extracted.get("decisions", [])
        raw_actions = extracted.get("action_items", [])
        raw_questions = extracted.get("open_questions", [])
        raw_risks = extracted.get("risks", [])

        session.decisions_json = json.dumps(
            [d.get("title", "") for d in raw_decisions if d.get("title")]
        )
        session.action_items_json = json.dumps([
            {"task": a.get("title", ""), "owner": a.get("owner", ""),
             "due_date": a.get("due_date"), "priority": a.get("priority", "")}
            for a in raw_actions
        ])
        session.open_questions_json = json.dumps(
            [q.get("title", "") for q in raw_questions if q.get("title")]
        )
        session.risks_json = json.dumps([
            {"risk": r.get("title", ""), "severity": r.get("severity", ""),
             "mitigation": r.get("mitigation", "")}
            for r in raw_risks
        ])
        db.commit()

        # ── Auto-promote high-confidence approved artifacts to KB ──────────────
        if create_kb_entries:
            kb_entries_created = _auto_promote_to_kb(session, db)

        # Mark complete
        session.status = "READY"
        session.processing_completed_at = datetime.utcnow()
        db.commit()

        return {
            "session_id": session_id,
            "artifacts_created": artifacts_created,
            "kb_entries_created": kb_entries_created,
            "status": "READY",
        }

    except Exception as exc:
        session.status = "FAILED"
        session.last_error = str(exc)[:2000]
        db.commit()
        raise


# ── Auto-promote to KB ────────────────────────────────────────────────────────

def _auto_promote_to_kb(session, db: Session) -> int:
    """
    Promote APPROVED artifacts with confidence_score > 0.8 to KnowledgeEntry rows.
    Returns count of entries created.
    """
    from api.models import SessionArtifact
    import api.services.knowledge_processor as kp

    promotable_types = {"Decision", "Requirement", "TechnicalMetadata"}
    candidates = (
        db.query(SessionArtifact)
        .filter(
            SessionArtifact.session_id == session.id,
            SessionArtifact.artifact_type.in_(promotable_types),
            SessionArtifact.kb_entry_id.is_(None),
        )
        .all()
    )

    count = 0
    for art in candidates:
        score = art.confidence_score or 0.0
        is_approved = art.status in ("APPROVED", "PENDING_REVIEW")
        if score < 0.80 and art.status != "APPROVED":
            continue
        if not is_approved:
            continue

        try:
            entry_id = _promote_artifact(art, session, db, kp)
            if entry_id:
                art.kb_entry_id = entry_id
                count += 1
        except Exception as exc:
            print(f"[session_processor] promote artifact {art.id} failed: {exc}")

    db.commit()
    return count


def _promote_artifact(art, session, db: Session, kp) -> Optional[int]:
    """Create a KnowledgeEntry from a SessionArtifact."""
    from api.models import KnowledgeEntry

    # Map artifact type → KB entry type
    type_map = {
        "Requirement":      "UseCase",
        "Decision":         "Process",
        "TechnicalMetadata": "SchemaDefinition",
    }
    kb_type = type_map.get(art.artifact_type, "UseCase")

    # Build raw_content from artifact fields
    raw_parts = [art.title]
    if art.description:
        raw_parts.append(art.description)
    if art.systems_involved:
        try:
            systems = json.loads(art.systems_involved)
            if systems:
                raw_parts.append("Systems involved: " + ", ".join(systems))
        except Exception:
            pass
    raw_content = "\n\n".join(raw_parts)

    if len(raw_content.strip()) < 50:
        raw_content = raw_content + " " * (50 - len(raw_content.strip()))

    entry = KnowledgeEntry(
        title=f"[{art.artifact_code}] {art.title}",
        type=kb_type,
        system="General",
        source_type="MeetingNotes",
        raw_content=raw_content,
        kb_schema_id=session.kb_schema_id,
        session_id=session.id,
        approved_at=art.approved_at,
        approved_by=art.approved_by,
        created_by=session.created_by,
        embedding_status="pending",
        status="READY_FOR_EMBEDDING",
    )
    db.add(entry)
    db.flush()

    # Chunk and embed
    try:
        chunks = kp._chunk_text(raw_content)
        kp.embed_and_store_chunks(
            entry_id=entry.id,
            chunks=chunks,
            summary=art.title,
            db=db,
            kb_schema_id=session.kb_schema_id,
        )
    except Exception as exc:
        print(f"[session_processor] embed failed for promoted entry {entry.id}: {exc}")

    return entry.id
