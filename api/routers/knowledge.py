"""
api/routers/knowledge.py
SAI Knowledge Processing Agent endpoints.

POST   /knowledge/process                          — process + embed a new entry
GET    /knowledge/entries                          — list entries (filterable, paginated)
POST   /knowledge/entries/{id}/reprocess           — reprocess + re-embed existing entry
DELETE /knowledge/entries/{id}                     — delete entry + cascade chunks
POST   /knowledge/ask                              — Ask SAI Q&A
GET    /knowledge/open-questions                   — list unanswered questions (admin)
PUT    /knowledge/open-questions/{id}/resolve      — resolve by creating a full KB entry
PUT    /knowledge/open-questions/{id}/quick-answer — resolve with a short inline answer
PUT    /knowledge/open-questions/{id}/dismiss      — dismiss question
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

import io
import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session

from api.database import get_db
from api.dependencies import get_current_user, require_non_viewer, require_developer
from api.models import KnowledgeEntry, KnowledgeChunk, OpenQuestion
from api.schemas import (
    KnowledgeEntryCreate, KnowledgeEntryOut,
    OpenQuestionOut,
    AskSAIRequest, FetchURLRequest,
    ResolveQuestionRequest, QuickAnswerRequest, DismissQuestionRequest,
)
import api.services.knowledge_processor as kp

router = APIRouter(dependencies=[Depends(get_current_user)])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _enrich_question(q: OpenQuestion) -> dict:
    """Add computed days_open / days_to_resolve fields."""
    data = OpenQuestionOut.model_validate(q).model_dump()
    now = datetime.utcnow()
    # quick_answered is still open — not fully resolved yet
    if q.status in ("open", "quick_answered"):
        data["days_open"] = (now - q.created_at).days
        data["days_to_resolve"] = None
    else:
        data["days_open"] = None
        data["days_to_resolve"] = (q.updated_at - q.created_at).days
    return data


def _persist_entry(result: dict, req: KnowledgeEntryCreate, db: Session) -> KnowledgeEntry:
    """Persist a KnowledgeEntry from a process_entry result dict."""
    ke = result["knowledge_entry"]
    tags_json = json.dumps(req.tags or [])
    quality = result.get("quality_score", "MEDIUM")
    status = "LOW_QUALITY" if quality == "LOW" else result.get("status", "READY_FOR_EMBEDDING")

    entry = KnowledgeEntry(
        title=ke.get("title") or req.title,
        type=ke.get("type") or req.type,
        system=ke.get("system") or req.system,
        tags=tags_json,
        summary=ke.get("summary"),
        detailed_explanation=ke.get("detailed_explanation"),
        key_points=json.dumps(ke.get("key_points") or []),
        decision=ke.get("decision"),
        reason=ke.get("reason"),
        is_reusable=bool(ke.get("is_reusable", True)),
        source_type=req.source_type,
        raw_content=req.raw_content,
        quality_score=quality,
        suggestions=json.dumps(result.get("suggestions") or []),
        status=status,
        embedding_status="pending",
        version=1,
        created_by=req.created_by,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


# ── Parse uploaded file → extract text ───────────────────────────────────────

@router.post("/knowledge/parse-file", dependencies=[Depends(require_non_viewer)])
async def parse_file_endpoint(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Extract plain text from an uploaded document (PDF, DOCX, TXT, MD, CSV)."""
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_bytes = await file.read()

    t0 = time.monotonic()
    try:
        if ext in ("txt", "md", "csv"):
            text = content_bytes.decode("utf-8", errors="replace")
        elif ext == "pdf":
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content_bytes))
            text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
        elif ext == "docx":
            from docx import Document as DocxDocument
            doc = DocxDocument(io.BytesIO(content_bytes))
            text = "\n".join(p.text for p in doc.paragraphs)
        else:
            raise HTTPException(status_code=415, detail=f"Unsupported file type: .{ext}. Supported: pdf, docx, txt, md, csv")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {exc}")

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    text = text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="No text could be extracted from this file.")

    try:
        from api.services.ai_trace import store
        store(
            module="knowledge_parse",
            conn_id=None,
            model="file-parser",
            prompt=f"File: {filename} ({len(content_bytes)} bytes)",
            response=text[:500],
            tokens_in=0,
            tokens_out=0,
            latency_ms=elapsed_ms,
            db=db,
            schema_snapshot={"filename": filename, "ext": ext, "chars": len(text)},
        )
    except Exception:
        pass

    return {"text": text, "filename": filename, "chars": len(text)}


# ── Fetch URL → extract text ──────────────────────────────────────────────────

@router.post("/knowledge/fetch-url", dependencies=[Depends(require_non_viewer)])
def fetch_url_endpoint(req: FetchURLRequest, db: Session = Depends(get_db)):
    """Fetch text content from a URL (HTML page, PDF, or plain text)."""
    import requests as http_req
    from bs4 import BeautifulSoup

    try:
        t0 = time.monotonic()
        resp = http_req.get(
            req.url, timeout=15,
            headers={"User-Agent": "Mozilla/5.0 (SAI Knowledge Fetch)"},
            allow_redirects=True,
        )
        resp.raise_for_status()
        elapsed_ms = int((time.monotonic() - t0) * 1000)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to fetch URL: {exc}")

    content_type = resp.headers.get("content-type", "").lower()
    if "pdf" in content_type:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(resp.content))
        text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
    elif "html" in content_type or content_type == "":
        soup = BeautifulSoup(resp.text, "lxml")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
    else:
        text = resp.text

    text = "\n".join(line for line in text.splitlines() if line.strip())
    text = text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="No text content found at this URL.")

    text = text[:60000]

    try:
        from api.services.ai_trace import store
        store(
            module="knowledge_fetch",
            conn_id=None,
            model="url-fetch",
            prompt=f"URL: {req.url}",
            response=text[:500],
            tokens_in=0,
            tokens_out=0,
            latency_ms=elapsed_ms,
            db=db,
            schema_snapshot={"url": req.url, "content_type": content_type, "chars": len(text)},
        )
    except Exception:
        pass

    return {"text": text, "url": req.url, "chars": len(text)}


# ── Process new entry ─────────────────────────────────────────────────────────

@router.post("/knowledge/process", response_model=KnowledgeEntryOut, status_code=201,
             dependencies=[Depends(require_non_viewer)])
def process_knowledge_entry(
    req: KnowledgeEntryCreate,
    skip_duplicate_check: bool = Query(False),
    db: Session = Depends(get_db),
):
    # Duplicate detection
    dup_id = kp.check_near_duplicate(req.raw_content, db, skip=skip_duplicate_check)
    if dup_id is not None:
        raise HTTPException(
            status_code=409,
            detail={"message": "Near-duplicate entry detected.", "existing_id": dup_id},
        )

    try:
        result = kp.process_entry(
            title=req.title, type=req.type, system=req.system,
            tags=req.tags, source_type=req.source_type,
            raw_content=req.raw_content, db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    entry = _persist_entry(result, req, db)
    summary = result["knowledge_entry"].get("summary") or ""
    kp.embed_and_store_chunks(
        entry_id=entry.id,
        chunks=result.get("chunks", []),
        summary=summary,
        db=db,
    )
    db.refresh(entry)
    return entry


# ── List entries ──────────────────────────────────────────────────────────────

@router.get("/knowledge/entries", response_model=list[KnowledgeEntryOut])
def list_entries(
    type:                Optional[str] = None,
    system:              Optional[str] = None,
    search:              Optional[str] = None,
    include_low_quality: bool = False,
    limit:               int = Query(50, ge=1, le=500),
    offset:              int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(KnowledgeEntry)
    if type:
        q = q.filter(KnowledgeEntry.type == type)
    if system:
        q = q.filter(KnowledgeEntry.system == system)
    if search:
        q = q.filter(
            KnowledgeEntry.title.contains(search) | KnowledgeEntry.summary.contains(search)
        )
    if not include_low_quality:
        q = q.filter(KnowledgeEntry.status != "LOW_QUALITY")
    return q.order_by(KnowledgeEntry.created_at.desc()).offset(offset).limit(limit).all()


# ── Reprocess entry ───────────────────────────────────────────────────────────

@router.post("/knowledge/entries/{entry_id}/reprocess", response_model=KnowledgeEntryOut,
             dependencies=[Depends(require_non_viewer)])
def reprocess_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(KnowledgeEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Entry {entry_id} not found.")

    # Delete existing chunks
    db.query(KnowledgeChunk).filter_by(entry_id=entry_id).delete()
    entry.embedding_status = "pending"
    entry.version += 1
    db.commit()

    try:
        result = kp.process_entry(
            title=entry.title, type=entry.type, system=entry.system,
            tags=json.loads(entry.tags or "[]"),
            source_type=entry.source_type,
            raw_content=entry.raw_content or "",
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Update structured fields
    ke = result["knowledge_entry"]
    entry.summary              = ke.get("summary")
    entry.detailed_explanation = ke.get("detailed_explanation")
    entry.key_points           = json.dumps(ke.get("key_points") or [])
    entry.decision             = ke.get("decision")
    entry.reason               = ke.get("reason")
    entry.is_reusable          = bool(ke.get("is_reusable", True))
    quality                    = result.get("quality_score", "MEDIUM")
    entry.quality_score        = quality
    entry.suggestions          = json.dumps(result.get("suggestions") or [])
    entry.status               = "LOW_QUALITY" if quality == "LOW" else result.get("status", "READY_FOR_EMBEDDING")
    entry.updated_at           = datetime.utcnow()
    db.commit()

    summary = ke.get("summary") or ""
    kp.embed_and_store_chunks(
        entry_id=entry.id,
        chunks=result.get("chunks", []),
        summary=summary,
        db=db,
    )
    db.refresh(entry)
    return entry


# ── Rebuild embeddings for all entries with no chunks ─────────────────────────

@router.post("/knowledge/rebuild-embeddings", dependencies=[Depends(require_non_viewer)])
def rebuild_embeddings(db: Session = Depends(get_db)):
    """
    Re-chunk and re-embed every entry that currently has zero chunks.
    Uses stored content (summary + detailed_explanation + key_points + etc.)
    without calling the LLM again. Safe to run multiple times.
    """
    entries_with_no_chunks = (
        db.query(KnowledgeEntry)
        .filter(
            ~KnowledgeEntry.id.in_(
                db.query(KnowledgeChunk.entry_id).distinct()
            )
        )
        .all()
    )

    rebuilt = 0
    failed = 0
    for entry in entries_with_no_chunks:
        try:
            parts: list[str] = []
            if entry.summary and entry.summary.strip():
                parts.append(entry.summary)
            if entry.detailed_explanation and entry.detailed_explanation.strip():
                parts.append(entry.detailed_explanation)
            try:
                for kp_item in json.loads(entry.key_points or "[]"):
                    if str(kp_item).strip():
                        parts.append(str(kp_item))
            except Exception:
                pass
            if entry.decision and entry.decision.strip():
                parts.append(entry.decision)
            if entry.reason and entry.reason.strip():
                parts.append(entry.reason)
            if not parts and entry.raw_content:
                parts.append(entry.raw_content[:8000])

            if not parts:
                continue

            combined = "\n\n".join(parts)
            from api.services.knowledge_processor import _chunk_text
            chunks = _chunk_text(combined, topic=entry.title)

            summary = entry.summary or ""
            count = kp.embed_and_store_chunks(
                entry_id=entry.id,
                chunks=chunks,
                summary=summary,
                db=db,
            )
            if count > 0:
                rebuilt += 1
            else:
                failed += 1
        except Exception as exc:
            print(f"[rebuild-embeddings] entry {entry.id} failed: {exc}")
            failed += 1

    return {"rebuilt": rebuilt, "failed": failed, "total_processed": len(entries_with_no_chunks)}


# ── Delete entry ──────────────────────────────────────────────────────────────

@router.delete("/knowledge/entries/{entry_id}", status_code=204,
               dependencies=[Depends(require_developer)])
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(KnowledgeEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Entry {entry_id} not found.")
    db.delete(entry)
    db.commit()


# ── Ask SAI ───────────────────────────────────────────────────────────────────

@router.post("/knowledge/ask")
def ask_sai(req: AskSAIRequest, db: Session = Depends(get_db)):
    return kp.ask_sai(
        question=req.question,
        asked_by=req.asked_by,
        top_k=req.top_k,
        model=req.model,
        project_id=req.project_id,
        db=db,
    )


# ── Open questions — list ─────────────────────────────────────────────────────

@router.get("/knowledge/open-questions", response_model=list[dict])
def list_open_questions(
    status: str = Query("open"),
    limit:  int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(OpenQuestion)
    if status != "all":
        q = q.filter(OpenQuestion.status == status)
    questions = q.order_by(OpenQuestion.created_at.desc()).offset(offset).limit(limit).all()
    return [_enrich_question(oq) for oq in questions]


# ── Resolve question (full KB entry) ──────────────────────────────────────────

@router.put("/knowledge/open-questions/{question_id}/resolve",
            response_model=KnowledgeEntryOut,
            dependencies=[Depends(require_non_viewer)])
def resolve_question(
    question_id: int,
    req: ResolveQuestionRequest,
    skip_duplicate_check: bool = Query(False),
    db: Session = Depends(get_db),
):
    oq = db.query(OpenQuestion).filter_by(id=question_id).first()
    if not oq:
        raise HTTPException(status_code=404, detail=f"Question {question_id} not found.")

    dup_id = kp.check_near_duplicate(
        req.knowledge_entry.raw_content, db, skip=skip_duplicate_check
    )
    if dup_id is not None:
        raise HTTPException(
            status_code=409,
            detail={"message": "Near-duplicate entry detected.", "existing_id": dup_id},
        )

    try:
        result = kp.process_entry(
            title=req.knowledge_entry.title,
            type=req.knowledge_entry.type,
            system=req.knowledge_entry.system,
            tags=req.knowledge_entry.tags,
            source_type=req.knowledge_entry.source_type,
            raw_content=req.knowledge_entry.raw_content,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    entry = _persist_entry(result, req.knowledge_entry, db)
    summary = result["knowledge_entry"].get("summary") or ""
    kp.embed_and_store_chunks(
        entry_id=entry.id,
        chunks=result.get("chunks", []),
        summary=summary,
        db=db,
    )

    oq.status = "resolved"
    oq.resolution_entry_id = entry.id
    oq.resolved_by = req.resolved_by
    oq.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(entry)
    return entry


# ── Quick answer ──────────────────────────────────────────────────────────────

@router.put("/knowledge/open-questions/{question_id}/quick-answer",
            dependencies=[Depends(require_non_viewer)])
def quick_answer_question(
    question_id: int,
    req: QuickAnswerRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    oq = db.query(OpenQuestion).filter_by(id=question_id).first()
    if not oq:
        raise HTTPException(status_code=404, detail=f"Question {question_id} not found.")

    oq.resolution_text = req.resolution_text
    oq.status = "quick_answered"   # partial — Full Answer still required to fully close
    oq.resolved_by = req.resolved_by
    oq.updated_at = datetime.utcnow()
    db.commit()

    # Embed in background so response returns immediately
    background_tasks.add_task(
        kp.embed_quick_answer,
        question=oq.question,
        resolution_text=req.resolution_text,
        db=db,
    )

    return _enrich_question(oq)


# ── Dismiss question ──────────────────────────────────────────────────────────

@router.put("/knowledge/open-questions/{question_id}/dismiss", status_code=204,
            dependencies=[Depends(require_non_viewer)])
def dismiss_question(
    question_id: int,
    req: DismissQuestionRequest,
    db: Session = Depends(get_db),
):
    oq = db.query(OpenQuestion).filter_by(id=question_id).first()
    if not oq:
        raise HTTPException(status_code=404, detail=f"Question {question_id} not found.")
    oq.status = "dismissed"
    oq.resolved_by = req.resolved_by
    oq.updated_at = datetime.utcnow()
    db.commit()
