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
import re
from datetime import datetime
from typing import Optional

import io
import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.dependencies import get_current_user, require_non_viewer, require_developer
from api.models import KnowledgeEntry, KnowledgeChunk, OpenQuestion, KnowledgeEntryVersion
from api.schemas import (
    KnowledgeEntryCreate, KnowledgeEntryOut,
    OpenQuestionOut,
    AskSAIRequest, FetchURLRequest,
    ResolveQuestionRequest, QuickAnswerRequest, DismissQuestionRequest,
)
import api.services.knowledge_processor as kp
from api.config import settings

router = APIRouter(dependencies=[Depends(get_current_user)])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _enrich_question(q: OpenQuestion) -> dict:
    """Add computed days_open / days_to_resolve fields."""
    data = OpenQuestionOut.model_validate(q).model_dump()
    now = datetime.utcnow()
    # quick_answered is still open — not fully resolved yet
    if q.status in ("open", "quick_answered", "flagged"):
        data["days_open"] = (now - q.created_at).days
        data["days_to_resolve"] = None
    else:
        data["days_open"] = None
        data["days_to_resolve"] = (q.updated_at - q.created_at).days
    return data


def _snapshot_entry(entry: KnowledgeEntry, db: Session, changed_by: Optional[str] = None) -> None:
    """Save the current state of an entry as a version record before modifying it."""
    snapshot = {
        "title":                entry.title,
        "type":                 entry.type,
        "system":               entry.system,
        "tags":                 entry.tags,
        "summary":              entry.summary,
        "detailed_explanation": entry.detailed_explanation,
        "key_points":           entry.key_points,
        "decision":             entry.decision,
        "reason":               entry.reason,
        "is_reusable":          entry.is_reusable,
        "source_type":          entry.source_type,
        "raw_content":          entry.raw_content,
        "quality_score":        entry.quality_score,
        "status":               entry.status,
        "version":              entry.version,
    }
    db.add(KnowledgeEntryVersion(
        entry_id=entry.id,
        version_num=entry.version,
        snapshot=json.dumps(snapshot),
        changed_by=changed_by,
    ))
    db.flush()


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
        # Operational Intelligence fields
        op_category=req.op_category,
        severity=req.severity,
        systems_involved_json=json.dumps(req.systems_involved) if req.systems_involved else None,
        remediation_json=json.dumps(req.remediation) if req.remediation else None,
        sql_template=req.sql_template,
        validation_query=req.validation_query,
        owner_team=req.owner_team,
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
    op_category:         Optional[str] = None,
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
    if op_category:
        q = q.filter(KnowledgeEntry.op_category == op_category)
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

    # Snapshot current state before overwriting
    _snapshot_entry(entry, db)

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


# ── Entry version history ─────────────────────────────────────────────────────

@router.get("/knowledge/entries/{entry_id}/versions")
def list_versions(entry_id: int, db: Session = Depends(get_db)):
    versions = (
        db.query(KnowledgeEntryVersion)
        .filter_by(entry_id=entry_id)
        .order_by(KnowledgeEntryVersion.version_num.desc())
        .all()
    )
    return [
        {
            "id":          v.id,
            "version_num": v.version_num,
            "changed_by":  v.changed_by,
            "changed_at":  v.changed_at.isoformat() if v.changed_at else None,
            "snapshot":    json.loads(v.snapshot) if v.snapshot else {},
        }
        for v in versions
    ]


@router.post("/knowledge/entries/{entry_id}/versions/{version_num}/restore",
             response_model=KnowledgeEntryOut,
             dependencies=[Depends(require_non_viewer)])
def restore_version(entry_id: int, version_num: int, db: Session = Depends(get_db)):
    entry = db.query(KnowledgeEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Entry {entry_id} not found.")

    ver = db.query(KnowledgeEntryVersion).filter_by(
        entry_id=entry_id, version_num=version_num
    ).first()
    if not ver or not ver.snapshot:
        raise HTTPException(status_code=404, detail=f"Version {version_num} not found.")

    snap = json.loads(ver.snapshot)

    # Snapshot the current state before restoring
    _snapshot_entry(entry, db)

    # Restore snapshot fields
    entry.title                = snap.get("title", entry.title)
    entry.type                 = snap.get("type", entry.type)
    entry.system               = snap.get("system", entry.system)
    entry.tags                 = snap.get("tags", entry.tags)
    entry.summary              = snap.get("summary")
    entry.detailed_explanation = snap.get("detailed_explanation")
    entry.key_points           = snap.get("key_points")
    entry.decision             = snap.get("decision")
    entry.reason               = snap.get("reason")
    entry.is_reusable          = snap.get("is_reusable", True)
    entry.quality_score        = snap.get("quality_score")
    entry.status               = snap.get("status", entry.status)
    entry.version             += 1
    entry.updated_at           = datetime.utcnow()

    # Re-embed with restored content
    db.query(KnowledgeChunk).filter_by(entry_id=entry_id).delete()
    entry.embedding_status = "pending"
    db.commit()

    parts: list[str] = []
    for field in ["summary", "detailed_explanation"]:
        val = snap.get(field, "") or ""
        if val.strip():
            parts.append(val)
    try:
        for kp_item in json.loads(snap.get("key_points") or "[]"):
            if str(kp_item).strip():
                parts.append(str(kp_item))
    except Exception:
        pass
    for field in ["decision", "reason"]:
        val = snap.get(field, "") or ""
        if val.strip():
            parts.append(val)
    if not parts and snap.get("raw_content"):
        parts.append(snap["raw_content"][:8000])

    if parts:
        from api.services.knowledge_processor import _chunk_text
        chunks = _chunk_text("\n\n".join(parts), topic=entry.title)
        kp.embed_and_store_chunks(
            entry_id=entry.id,
            chunks=chunks,
            summary=snap.get("summary") or "",
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


# ── Generic SQL query / view import (no LLM, SQL-aware) ──────────────────────

def _col(row: dict, *keys: str) -> str:
    """Case-insensitive header lookup across a CSV row."""
    for k in keys:
        for rk, rv in row.items():
            if rk.strip().upper() == k.upper():
                return (rv or "").strip()
    return ""


def _detect_sql_type(sql: str) -> str:
    """Infer entry type from SQL content."""
    first = sql.lstrip().upper()[:40]
    if "CREATE" in first and "VIEW" in first:
        return "ViewDefinition"
    if "CREATE" in first and "TABLE" in first:
        return "SchemaDefinition"
    if "CREATE" in first and ("PROCEDURE" in first or "PROC " in first or "FUNCTION" in first):
        return "QueryLibrary"
    return "QueryLibrary"


def _extract_text_from_bytes(content_bytes: bytes, ext: str) -> str:
    """Extract plain text from file bytes for any supported format."""
    if ext in ("txt", "md", "sql"):
        return content_bytes.decode("utf-8", errors="replace")
    if ext == "json":
        try:
            data = json.loads(content_bytes.decode("utf-8", errors="replace"))
            return json.dumps(data, indent=2)
        except Exception:
            return content_bytes.decode("utf-8", errors="replace")
    if ext == "pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content_bytes))
            return "\n\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Failed to read PDF: {exc}")
    if ext == "docx":
        try:
            from docx import Document as DocxDocument
            doc = DocxDocument(io.BytesIO(content_bytes))
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Failed to read DOCX: {exc}")
    # fallback: try UTF-8
    return content_bytes.decode("utf-8", errors="replace")


def _ai_extract_entries(text: str, filename: str) -> list[dict]:
    """Call LLM to extract structured knowledge entries from unstructured text."""
    import openai
    client = openai.OpenAI(api_key=settings.openai_api_key)

    prompt = f"""You are a knowledge base curator. Analyze the content below and extract structured entries.

For EACH distinct SQL query, view, procedure, table definition, documentation section, or Q&A item, create one entry.

Return ONLY a valid JSON array (no markdown, no extra text):
[
  {{
    "title": "descriptive name (required, 3-100 chars)",
    "type": "ViewDefinition|QueryLibrary|SchemaDefinition|Process|UseCase|Question",
    "description": "what this entry does or explains (1-3 sentences)",
    "sql": "the SQL body if present, else null",
    "system": "system name e.g. Snowflake, SQL Server, General",
    "tags": ["tag1", "tag2"]
  }}
]

Rules:
- Extract EACH distinct SQL object (view, proc, function, table) as a separate entry
- For SQL: title = the object name, sql = the full statement, type = auto-detect
- For docs/runbooks: title = topic heading, sql = null, type = Process or UseCase
- For Q&A pairs: type = Question
- Max 50 entries
- If content has no recognisable entries, return []

File: {filename}

Content:
{text[:10000]}"""

    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=4000,
    )
    raw = resp.choices[0].message.content or "[]"
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            pass
    return []


def _insert_entry_from_dict(entry_dict: dict, db: Session) -> bool:
    """Insert a single knowledge entry from an AI-extracted dict. Returns True on success."""
    title       = (entry_dict.get("title") or "").strip()[:500]
    sql         = (entry_dict.get("sql") or "").strip()
    description = (entry_dict.get("description") or "").strip()
    system      = (entry_dict.get("system") or "General").strip()
    tags_raw    = entry_dict.get("tags") or []
    entry_type  = (entry_dict.get("type") or "").strip()

    if not title:
        return False

    if not entry_type:
        entry_type = _detect_sql_type(sql) if sql else "UseCase"

    tags = tags_raw if isinstance(tags_raw, list) else [t.strip() for t in str(tags_raw).split(",") if t.strip()]
    if sql and "sql" not in tags:
        tags.append("sql")
    if entry_type == "ViewDefinition" and "view_definition" not in tags:
        tags.append("view_definition")

    summary = description or (f"SQL {entry_type}: {title}" if sql else title)
    detailed = (
        f"{description}\n\n```sql\n{sql}\n```" if sql and description
        else (f"```sql\n{sql}\n```" if sql else description)
    )
    raw_content = "\n\n".join(filter(None, [title, description, sql])).strip()

    entry = KnowledgeEntry(
        title=title,
        type=entry_type,
        system=system,
        tags=json.dumps(tags),
        summary=summary,
        detailed_explanation=detailed,
        key_points=json.dumps([f"Type: {entry_type}", f"System: {system}"]),
        is_reusable=True,
        source_type="AI-Import",
        raw_content=raw_content,
        quality_score="HIGH",
        status="READY_FOR_EMBEDDING",
        embedding_status="pending",
        version=1,
        sql_template=sql or None,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    embed_text = f"{title}. {summary}" + (f"\n\n{sql}" if sql else "")
    chunks = kp._chunk_text(embed_text, topic=title)
    kp.embed_and_store_chunks(entry_id=entry.id, chunks=chunks, summary=summary, db=db)
    return True


@router.post("/knowledge/bulk-queries", dependencies=[Depends(require_non_viewer)])
async def bulk_import_queries(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Universal import — accepts ANY file type.

    For CSV / Excel with standard columns (title/name + sql/query): direct structured import, no LLM.
    For all other files (TXT, SQL, MD, JSON, PDF, DOCX) or CSV/Excel with non-standard columns:
      AI automatically detects content type, extracts entries, and structures them for the KB.

    Returns: { total, processed, skipped, failed, errors, ai_detected }
    """
    import csv, io as _io

    content_bytes = await file.read()
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    ai_detected = False
    rows: list[dict] = []

    # ── 1. Tabular files — try standard column detection ──────────────────────
    if ext in ("csv", "xlsx", "xls"):
        try:
            if ext == "csv":
                text = content_bytes.decode("utf-8", errors="replace").lstrip("﻿")
                rows = list(csv.DictReader(_io.StringIO(text)))
            else:
                import openpyxl
                wb = openpyxl.load_workbook(_io.BytesIO(content_bytes), read_only=True, data_only=True)
                ws = wb.active
                headers = [str(c.value or "").strip() for c in next(ws.iter_rows(min_row=1, max_row=1))]
                for row in ws.iter_rows(min_row=2, values_only=True):
                    rows.append({headers[i]: (str(v).strip() if v is not None else "") for i, v in enumerate(row)})
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Failed to parse file: {exc}")

        # Check column HEADERS (not values) for standard column names
        if rows:
            col_names = {k.strip().upper() for k in rows[0].keys()}
            title_cols = {"TITLE", "NAME", "TABLE_NAME", "VIEW_NAME"}
            sql_cols   = {"SQL", "QUERY", "VIEW_DEFINITION", "DEFINITION"}
            has_title  = bool(col_names & title_cols)
            has_sql    = bool(col_names & sql_cols)
            if has_title and has_sql:
                # Standard path — no LLM
                return _import_from_standard_rows(rows, db)

        # Non-standard columns — convert to text for AI extraction
        if rows:
            lines = [", ".join(f"{k}: {v}" for k, v in row.items() if v) for row in rows[:100]]
            text_for_ai = "\n".join(lines)
        else:
            text_for_ai = content_bytes.decode("utf-8", errors="replace")
        ai_detected = True

    # ── 2. All other file types — extract text ────────────────────────────────
    else:
        text_for_ai = _extract_text_from_bytes(content_bytes, ext)
        ai_detected = True

    # ── 3. AI-powered extraction ──────────────────────────────────────────────
    if not text_for_ai.strip():
        raise HTTPException(status_code=422, detail="No text content could be extracted from this file.")

    try:
        extracted = _ai_extract_entries(text_for_ai, filename)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {exc}")

    if not extracted:
        raise HTTPException(status_code=422, detail="AI could not find any knowledge entries in this file. Try a CSV with title + sql columns.")

    processed = failed = 0
    errors: list[dict] = []

    for i, entry_dict in enumerate(extracted, start=1):
        try:
            ok = _insert_entry_from_dict(entry_dict, db)
            if ok:
                processed += 1
            else:
                failed += 1
                errors.append({"row": i, "reason": "Entry missing required title field"})
        except Exception as exc:
            db.rollback()
            failed += 1
            errors.append({"row": i, "reason": str(exc)[:300]})

    return {
        "total":        len(extracted),
        "processed":    processed,
        "skipped":      0,
        "failed":       failed,
        "errors":       errors,
        "ai_detected":  ai_detected,
    }


def _import_from_standard_rows(rows: list[dict], db: Session) -> dict:
    """Standard tabular import (CSV/Excel with known column names). No LLM calls."""
    processed = failed = skipped = 0
    errors: list[dict] = []

    for i, row in enumerate(rows, start=2):
        title = _col(row, "title", "name", "table_name", "view_name")
        sql   = _col(row, "sql", "query", "view_definition", "definition")

        if not title or not sql:
            failed += 1
            errors.append({"row": i, "reason": "Required columns missing: title (or name/table_name) and sql (or query/view_definition)"})
            continue

        description = _col(row, "description", "summary", "desc")
        system      = _col(row, "system") or "Snowflake"
        tags_raw    = _col(row, "tags", "tag")
        entry_type  = _col(row, "type") or _detect_sql_type(sql)

        try:
            tags = (
                json.loads(tags_raw) if tags_raw.startswith("[")
                else [t.strip() for t in tags_raw.split(",") if t.strip()]
            )
        except Exception:
            tags = []
        if "sql" not in tags:
            tags.append("sql")
        if entry_type == "ViewDefinition" and "view_definition" not in tags:
            tags.append("view_definition")

        summary = description or f"SQL {entry_type}: {title}"
        detailed = (
            f"{description}\n\n```sql\n{sql}\n```" if description
            else f"```sql\n{sql}\n```"
        )

        try:
            entry = KnowledgeEntry(
                title=title,
                type=entry_type,
                system=system,
                tags=json.dumps(tags),
                summary=summary,
                detailed_explanation=detailed,
                key_points=json.dumps([f"SQL type: {entry_type}", f"System: {system}"]),
                is_reusable=True,
                source_type="SQL",
                raw_content=f"{title}\n\n{description}\n\n{sql}".strip(),
                quality_score="HIGH",
                status="READY_FOR_EMBEDDING",
                embedding_status="pending",
                version=1,
                sql_template=sql,
            )
            db.add(entry)
            db.commit()
            db.refresh(entry)

            embed_text = f"{title}. {summary}\n\n{sql}"
            chunks = kp._chunk_text(embed_text, topic=title)
            kp.embed_and_store_chunks(entry_id=entry.id, chunks=chunks, summary=summary, db=db)
            processed += 1
        except Exception as exc:
            db.rollback()
            failed += 1
            errors.append({"row": i, "reason": str(exc)[:300]})

    return {
        "total":       len(rows),
        "processed":   processed,
        "skipped":     skipped,
        "failed":      failed,
        "errors":      errors,
        "ai_detected": False,
    }


# kept for backward compatibility — redirects to bulk-queries
@router.post("/knowledge/bulk-views", dependencies=[Depends(require_non_viewer)])
async def bulk_import_views(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Deprecated alias for /knowledge/bulk-queries. Accepts TABLE_NAME / VIEW_DEFINITION columns."""
    return await bulk_import_queries(file=file, db=db)


# ── Bulk import ──────────────────────────────────────────────────────────────

@router.post("/knowledge/bulk-import", dependencies=[Depends(require_non_viewer)])
async def bulk_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Import multiple KB entries from a CSV or Excel file.
    Expected columns: title, raw_content, type (opt), system (opt), tags (opt)
    Returns: { total, processed, failed, errors: [{row, reason}] }
    """
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_bytes = await file.read()

    # ── Parse rows from file ──────────────────────────────────────────────────
    try:
        if ext == "csv":
            import csv, io as _io
            reader = csv.DictReader(_io.StringIO(content_bytes.decode("utf-8", errors="replace")))
            rows = list(reader)
        elif ext in ("xlsx", "xls"):
            import openpyxl, io as _io
            wb = openpyxl.load_workbook(_io.BytesIO(content_bytes), read_only=True, data_only=True)
            ws = wb.active
            headers = [str(c.value or "").strip().lower() for c in next(ws.iter_rows(min_row=1, max_row=1))]
            rows = []
            for row in ws.iter_rows(min_row=2, values_only=True):
                rows.append({headers[i]: (str(v).strip() if v is not None else "") for i, v in enumerate(row)})
        else:
            raise HTTPException(status_code=415, detail="Supported formats: .csv, .xlsx, .xls")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {exc}")

    if not rows:
        raise HTTPException(status_code=422, detail="File has no data rows.")

    # ── Process each row ──────────────────────────────────────────────────────
    processed = 0
    failed = 0
    errors: list[dict] = []

    for i, row in enumerate(rows, start=2):  # row 1 = header
        title       = (row.get("title") or "").strip()
        raw_content = (row.get("raw_content") or row.get("content") or "").strip()
        if not title or not raw_content:
            failed += 1
            errors.append({"row": i, "reason": "Missing required columns: title, raw_content"})
            continue

        entry_type   = (row.get("type") or "UseCase").strip()
        system       = (row.get("system") or "General").strip()
        tags_raw     = (row.get("tags") or "").strip()
        try:
            tags = json.loads(tags_raw) if tags_raw.startswith("[") else [t.strip() for t in tags_raw.split(",") if t.strip()]
        except Exception:
            tags = []

        try:
            result = kp.process_entry(
                title=title, type=entry_type, system=system,
                tags=tags, source_type="Text",
                raw_content=raw_content, db=db,
            )
            from api.schemas import KnowledgeEntryCreate as _KEC
            req_obj = _KEC(
                title=title, type=entry_type, system=system,  # type: ignore[arg-type]
                tags=tags, source_type="Text", raw_content=raw_content,
            )
            entry = _persist_entry(result, req_obj, db)
            summary = result["knowledge_entry"].get("summary") or ""
            kp.embed_and_store_chunks(
                entry_id=entry.id,
                chunks=result.get("chunks", []),
                summary=summary,
                db=db,
            )
            processed += 1
        except Exception as exc:
            failed += 1
            errors.append({"row": i, "reason": str(exc)[:200]})

    return {
        "total":     len(rows),
        "processed": processed,
        "failed":    failed,
        "errors":    errors,
    }


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
        history=req.history,
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


# ── Flag a SAI response as unsatisfactory ────────────────────────────────────

FEEDBACK_LABELS = {
    "not_answered_well": "Not answered well",
    "not_satisfied":     "Not satisfied with response",
    "incorrect":         "Response seems incorrect",
    "incomplete":        "Answer is incomplete",
}

@router.post("/knowledge/flag-response", status_code=201)
def flag_response(
    req: dict,
    db: Session = Depends(get_db),
):
    """
    Flag an AI response as unsatisfactory → queued as an open question for admin review.
    Body: { question, ai_answer, feedback_type, asked_by? }
    """
    question      = (req.get("question") or "").strip()
    ai_answer     = (req.get("ai_answer") or "").strip()
    feedback_type = (req.get("feedback_type") or "not_satisfied").strip()
    asked_by      = req.get("asked_by")

    if not question:
        raise HTTPException(status_code=422, detail="question is required.")

    # Merge with existing flagged question for the same text (bump frequency)
    existing = db.query(OpenQuestion).filter(
        OpenQuestion.question == question,
        OpenQuestion.status.in_(["open", "flagged"]),
    ).first()

    if existing:
        existing.frequency += 1
        existing.feedback_type = feedback_type
        existing.ai_answer = ai_answer[:4000] if ai_answer else existing.ai_answer
        existing.updated_at = datetime.utcnow()
        db.commit()
        return {"id": existing.id, "merged": True}

    label = FEEDBACK_LABELS.get(feedback_type, feedback_type)
    oq = OpenQuestion(
        question      = question,
        reason        = f"User feedback: {label}",
        status        = "flagged",
        asked_by      = asked_by,
        feedback_type = feedback_type,
        ai_answer     = ai_answer[:4000] if ai_answer else None,
    )
    db.add(oq)
    db.commit()
    db.refresh(oq)
    return {"id": oq.id, "merged": False}


# ── Operational Intelligence endpoints ───────────────────────────────────────

_OP_CATEGORIES = {"BusinessProcess", "ReconRule", "Lineage", "DCTMapping", "IncidentHistory", "Remediation", "Ownership"}


@router.get("/knowledge/operational/{category}")
def get_operational(
    category: str,
    system:   Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Return all KB entries for a specific operational category, optionally filtered by system."""
    if category not in _OP_CATEGORIES:
        raise HTTPException(400, f"Unknown category '{category}'. Valid: {sorted(_OP_CATEGORIES)}")
    return kp.get_operational_knowledge(category, db, system=system)


@router.get("/knowledge/ownership-map")
def get_ownership_map(db: Session = Depends(get_db)):
    """Return all Ownership entries as a flat map: [{system, issue_type, owner_team, entry_id}]."""
    entries = kp.get_operational_knowledge("Ownership", db, limit=100)
    return [
        {
            "entry_id":   e["id"],
            "title":      e["title"],
            "systems":    e["systems_involved"],
            "owner_team": e["owner_team"],
            "summary":    e["summary"],
        }
        for e in entries
    ]


@router.get("/knowledge/reconciliation-rules")
def get_reconciliation_rules(db: Session = Depends(get_db)):
    """Return all ReconRule entries with sql_template and severity for admin validation."""
    entries = kp.get_operational_knowledge("ReconRule", db, limit=100)
    return [
        {
            "entry_id":         e["id"],
            "title":            e["title"],
            "systems":          e["systems_involved"],
            "severity":         e["severity"],
            "sql_template":     e["sql_template"],
            "validation_query": e["validation_query"],
            "summary":          e["summary"],
            "updated_at":       e["updated_at"],
        }
        for e in entries
    ]


@router.get("/knowledge/remediation/{issue_type}")
def get_remediation(issue_type: str, system: str = "", db: Session = Depends(get_db)):
    """Find the best Remediation KB entry for a given issue_type + system."""
    result = kp.get_remediation_for_issue(issue_type, system, db)
    if not result:
        raise HTTPException(404, f"No remediation workflow found for '{issue_type}' in '{system}'")
    return result


# ── Document decomposition into atomic rules ──────────────────────────────────

class _DecomposeRequest(BaseModel):
    raw_content: str
    model: str = "gpt-4o-mini"


@router.post("/knowledge/decompose", dependencies=[Depends(require_non_viewer)])
def decompose_knowledge(req: _DecomposeRequest, db: Session = Depends(get_db)):
    """
    Extract N atomic operational rules from a document for preview before save.
    Returns list of rule dicts — does NOT save to DB.
    Body: { raw_content: str, model?: str }
    """
    if not req.raw_content.strip():
        raise HTTPException(422, "raw_content is required.")
    entries = kp.decompose_document(raw_content=req.raw_content, model=req.model, db=db)
    return {"entries": entries, "count": len(entries)}
