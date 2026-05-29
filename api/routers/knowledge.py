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
import os
from pathlib import Path

from api.models import (
    KnowledgeEntry, KnowledgeChunk, OpenQuestion, KnowledgeEntryVersion,
    KnowledgeSchema, RequirementSession, SessionArtifact, ArtifactLink,
    SessionAttachment, KnowledgeEntryBlock,
)
from api.schemas import (
    KnowledgeEntryCreate, KnowledgeEntryOut,
    OpenQuestionOut,
    AskSAIRequest, FetchURLRequest,
    ResolveQuestionRequest, QuickAnswerRequest, DismissQuestionRequest,
    KnowledgeSchemaCreate, KnowledgeSchemaOut,
    SessionCreate, SessionUpdate, SessionOut, SessionProcessRequest,
    ArtifactOut, ArtifactUpdate, ArtifactLinkCreate, ArtifactLinkOut,
    SessionAttachmentOut,
)
import api.services.knowledge_processor as kp
import api.services.session_processor as sp
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
        # Operational Intelligence fields — LLM result takes priority, req is fallback
        op_category=ke.get("op_category") or req.op_category,
        severity=ke.get("severity") or req.severity,
        owner_team=ke.get("owner_team") or req.owner_team,
        systems_involved_json=(
            json.dumps(ke["systems_involved_json"]) if isinstance(ke.get("systems_involved_json"), list)
            else (json.dumps(req.systems_involved) if req.systems_involved else None)
        ),
        remediation_json=json.dumps(req.remediation) if req.remediation else None,
        sql_template=ke.get("sql_template") or req.sql_template,
        validation_query=req.validation_query,
        # Atomic rule fields
        trigger_condition=ke.get("trigger_condition") or req.trigger_condition,
        action_steps=(
            json.dumps(ke["action_steps"]) if isinstance(ke.get("action_steps"), list)
            else (json.dumps(req.action_steps) if req.action_steps else None)
        ),
        stop_condition=ke.get("stop_condition") or req.stop_condition,
        recovery_steps=(
            json.dumps(ke["recovery_steps"]) if isinstance(ke.get("recovery_steps"), list)
            else (json.dumps(req.recovery_steps) if req.recovery_steps else None)
        ),
        # Phase 3 orchestration fields
        decision_type=ke.get("decision_type") or req.decision_type,
        execution_scope=ke.get("execution_scope") or req.execution_scope,
        depends_on=(
            json.dumps(ke["depends_on"]) if isinstance(ke.get("depends_on"), list)
            else (json.dumps(req.depends_on) if req.depends_on else None)
        ),
        # KB v2: schema scoping + session traceability
        kb_schema_id=req.kb_schema_id,
        session_id=req.session_id,
        meeting_date=(
            datetime.strptime(req.meeting_date, "%Y-%m-%d").date()
            if req.meeting_date else None
        ),
        attendees_json=json.dumps(req.attendees) if req.attendees else None,
        supersedes_entry_id=req.supersedes_entry_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    # Resolve dependency edges after save
    try:
        from api.services.dependency_graph import resolve_edges
        resolve_edges(entry.id, db)
    except Exception as _e:
        print(f"[knowledge] resolve_edges failed for entry {entry.id}: {_e}")

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


# ── KB Schemas ───────────────────────────────────────────────────────────────

@router.get("/knowledge/schemas", response_model=list[KnowledgeSchemaOut])
def list_schemas(db: Session = Depends(get_db)):
    return db.query(KnowledgeSchema).order_by(KnowledgeSchema.name).all()


@router.post("/knowledge/schemas", response_model=KnowledgeSchemaOut, status_code=201,
             dependencies=[Depends(require_non_viewer)])
def create_schema(req: KnowledgeSchemaCreate, db: Session = Depends(get_db)):
    if db.query(KnowledgeSchema).filter_by(name=req.name).first():
        raise HTTPException(status_code=409, detail=f"Schema '{req.name}' already exists.")
    s = KnowledgeSchema(
        name=req.name,
        description=req.description,
        color_hex=req.color_hex or "#6366f1",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.delete("/knowledge/schemas/{schema_id}", status_code=204,
               dependencies=[Depends(require_non_viewer)])
def delete_schema(schema_id: int, db: Session = Depends(get_db)):
    s = db.query(KnowledgeSchema).filter_by(id=schema_id).first()
    if not s:
        raise HTTPException(status_code=404, detail=f"Schema {schema_id} not found.")
    attached = db.query(KnowledgeEntry).filter_by(kb_schema_id=schema_id).count()
    if attached > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete schema '{s.name}' — {attached} entries attached. Reassign them first.",
        )
    db.delete(s)
    db.commit()


# ── Manual Schema Import ─────────────────────────────────────────────────────
# Allows importing a DB schema from DDL text, CSV/Excel data dictionary, PDF,
# or ER diagram image — without needing a live database connection.
# Creates a virtual SourceConnection (source_type="manual") and populates
# catalog + column_embeddings so Ask SAI can use schema-aware search.


def _build_sample_queries(tables: list[dict]) -> dict:
    """Generate sample T-SQL and Snowflake queries from parsed tables."""
    sql_parts: list[str] = []
    snow_parts: list[str] = []

    for tbl in tables[:8]:
        tbl_name = tbl.get("name", "TableName")
        cols = tbl.get("columns", [])
        pk_cols   = [c["name"] for c in cols if c.get("is_pk")]
        data_cols = [c["name"] for c in cols if not c.get("is_pk")][:6]
        col_list  = ", ".join(pk_cols + data_cols) if (pk_cols or data_cols) else "*"
        desc = tbl.get("description", "")
        desc_comment = f"  -- {desc}" if desc else ""

        sql_parts.append(
            f"-- ── {tbl_name}{desc_comment}\n"
            f"SELECT TOP 10\n    {col_list}\nFROM {tbl_name};"
        )
        snow_parts.append(
            f"-- ── {tbl_name}{desc_comment}\n"
            f"SELECT\n    {col_list}\nFROM {tbl_name}\nLIMIT 10;"
        )

        # FK join samples
        for fk in tbl.get("foreign_keys", [])[:1]:
            fk_col  = fk.get("column", "")
            ref_tbl = fk.get("references_table", "")
            ref_col = fk.get("references_column", "")
            if fk_col and ref_tbl and ref_col:
                sql_parts.append(
                    f"-- ── {tbl_name} ⟶ {ref_tbl} (FK join)\n"
                    f"SELECT\n    t.*,\n    r.*\n"
                    f"FROM {tbl_name} t\n"
                    f"JOIN {ref_tbl} r ON t.{fk_col} = r.{ref_col}\n"
                    f"-- WHERE t.{fk_col} = <value>  -- filter by FK\n;"
                )
                snow_parts.append(
                    f"-- ── {tbl_name} ⟶ {ref_tbl} (FK join)\n"
                    f"SELECT\n    t.*,\n    r.*\n"
                    f"FROM {tbl_name} t\n"
                    f"JOIN {ref_tbl} r ON t.{fk_col} = r.{ref_col}\n"
                    f"LIMIT 10;"
                )

    return {
        "sql_server": "\n\n".join(sql_parts),
        "snowflake":  "\n\n".join(snow_parts),
    }


async def _extract_schema_text(content: str, file: Optional[UploadFile], client) -> tuple[str, str]:
    """
    Extract raw schema text from content + optional file.
    Returns (raw_text, file_description).
    """
    import base64
    from api.services.ai_client import chat_model as _cm

    file_text = ""
    image_b64 = ""
    file_description = ""

    if file and file.filename:
        data = await file.read()
        fname = (file.filename or "").lower()
        mime  = file.content_type or ""

        if "image" in mime or any(fname.endswith(x) for x in [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]):
            image_b64 = base64.b64encode(data).decode()
            file_description = f"ER diagram image: {file.filename}"
        elif fname.endswith(".pdf"):
            try:
                from PyPDF2 import PdfReader
                reader = PdfReader(io.BytesIO(data))
                file_text = "\n".join(p.extract_text() or "" for p in reader.pages)
                file_description = f"PDF document ({len(reader.pages)} pages): {file.filename}"
            except Exception:
                file_text = data.decode("utf-8", errors="ignore")
        elif any(fname.endswith(x) for x in [".xlsx", ".xls"]):
            try:
                import openpyxl
                wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
                rows = []
                for ws in wb.worksheets:
                    rows.append(f"=== Sheet: {ws.title} ===")
                    for row in ws.iter_rows(values_only=True):
                        rows.append("\t".join(str(c) if c is not None else "" for c in row))
                file_text = "\n".join(rows)
                file_description = f"Excel workbook ({len(wb.worksheets)} sheet(s)): {file.filename}"
            except Exception:
                file_text = data.decode("utf-8", errors="ignore")
                file_description = f"File: {file.filename}"
        elif fname.endswith(".csv"):
            file_text = data.decode("utf-8", errors="ignore")
            row_count = file_text.count("\n")
            file_description = f"CSV file (~{row_count} rows): {file.filename}"
        else:
            file_text = data.decode("utf-8", errors="ignore")
            file_description = f"Text file: {file.filename}"

    raw_input = (content or "").strip() + ("\n" + file_text if file_text else "")

    # Image → DDL via vision
    if image_b64 and not raw_input:
        resp = client.chat.completions.create(
            model=_cm("gpt-4o"),
            messages=[{"role": "user", "content": [
                {"type": "text", "text": (
                    "This is an ER diagram or schema diagram. Extract ALL tables, columns, data types, "
                    "primary keys, and foreign key relationships visible. Output as DDL CREATE TABLE statements."
                )},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}", "detail": "high"}},
            ]}],
            max_tokens=2000,
        )
        raw_input = resp.choices[0].message.content or ""
        file_description = f"ER diagram image (vision-extracted): {file.filename if file else 'image'}"

    return raw_input, file_description


@router.post("/knowledge/preview-schema", dependencies=[Depends(require_non_viewer)])
async def preview_schema(
    content:    str        = Form(""),
    file:       Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """Parse schema and return structured preview + sample queries — does NOT save anything."""
    from api.services.ai_client import get_client, chat_model as _cm

    client = get_client()
    raw_input, file_description = await _extract_schema_text(content, file, client)

    if not raw_input:
        raise HTTPException(status_code=422, detail="Provide schema content or upload a file.")

    _PARSE_PROMPT = """Parse the schema definition below and return ONLY a JSON object (no markdown, no prose).

{{
  "tables": [
    {{
      "name": "table_name",
      "description": "what this table stores (infer if not stated)",
      "columns": [
        {{
          "name": "column_name",
          "data_type": "varchar|int|date|decimal|bit|text|etc",
          "nullable": true,
          "is_pk": false,
          "description": "what this column contains"
        }}
      ],
      "foreign_keys": [
        {{
          "column": "fk_column_name",
          "references_table": "parent_table",
          "references_column": "parent_pk_column"
        }}
      ]
    }}
  ]
}}

Rules: include ALL tables/columns, infer types and descriptions, detect PKs and FKs.
Return ONLY the JSON.

Schema:
{schema}
"""
    resp = client.chat.completions.create(
        model=_cm("gpt-4o-mini"),
        messages=[{"role": "user", "content": _PARSE_PROMPT.format(schema=raw_input[:8000])}],
        temperature=0,
    )
    raw_json = (resp.choices[0].message.content or "").strip()
    if raw_json.startswith("```"):
        raw_json = "\n".join(raw_json.split("\n")[1:]).rsplit("```", 1)[0].strip()

    try:
        parsed = json.loads(raw_json)
        tables = parsed.get("tables", [])
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Parse failed: {exc}")

    sample_queries = _build_sample_queries(tables)

    return {
        "tables":           tables,
        "file_description": file_description,
        "table_count":      len(tables),
        "column_count":     sum(len(t.get("columns", [])) for t in tables),
        "fk_count":         sum(len(t.get("foreign_keys", [])) for t in tables),
        "sample_queries":   sample_queries,
    }


@router.post("/knowledge/import-schema", dependencies=[Depends(require_non_viewer)])
async def import_schema(
    name:       str        = Form(..., description="Name for this schema (e.g. 'GL Module')"),
    content:    str        = Form("",  description="DDL text, CSV data dictionary, or natural language description"),
    project_id: Optional[int] = Form(None),
    file:       Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """
    Parse schema from DDL, file, or description → create virtual connection →
    populate catalog tables + column embeddings for Ask SAI schema-aware search.
    """
    from api.models import SourceConnection, CatalogColumn, CatalogRelation, ColumnEmbedding
    from api.services.ai_client import get_client, chat_model as _cm
    from api.services.embeddings import get_embedding, build_column_definition

    client = get_client()
    raw_input, _ = await _extract_schema_text(content, file, client)

    if not raw_input:
        raise HTTPException(status_code=422, detail="Provide schema content, a file, or an image.")

    # ── LLM: parse schema into structured JSON ────────────────────────────────
    _PARSE_PROMPT = """Parse the schema definition below and return ONLY a JSON object (no markdown, no prose).
{{
  "tables": [
    {{
      "name": "table_name",
      "description": "what this table stores",
      "columns": [
        {{"name": "col", "data_type": "int", "nullable": false, "is_pk": true, "description": "..."}}
      ],
      "foreign_keys": [
        {{"column": "fk_col", "references_table": "parent", "references_column": "pk_col"}}
      ]
    }}
  ]
}}
Rules: include ALL tables/columns, infer types and descriptions, detect PKs/FKs. Return ONLY the JSON.
Schema:
{schema}
"""
    parse_resp = client.chat.completions.create(
        model=_cm("gpt-4o-mini"),
        messages=[{"role": "user", "content": _PARSE_PROMPT.format(schema=raw_input[:8000])}],
        temperature=0,
    )
    raw_json = (parse_resp.choices[0].message.content or "").strip()
    if raw_json.startswith("```"):
        raw_json = "\n".join(raw_json.split("\n")[1:]).rsplit("```", 1)[0].strip()

    try:
        parsed = json.loads(raw_json)
        tables = parsed.get("tables", [])
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Schema parsing failed: {exc}\n\nRaw: {raw_json[:500]}")

    if not tables:
        raise HTTPException(status_code=422, detail="No tables found in the schema. Check your input.")

    # ── Create or update virtual SourceConnection ─────────────────────────────
    existing_conn = db.query(SourceConnection).filter(
        SourceConnection.source_type == "manual",
        SourceConnection.name == name,
        (SourceConnection.project_id == project_id) if project_id else SourceConnection.project_id.is_(None),
    ).first()

    if existing_conn:
        conn = existing_conn
        # Clear old catalog data
        db.query(CatalogColumn).filter_by(conn_id=conn.id).delete()
        db.query(CatalogRelation).filter_by(conn_id=conn.id).delete()
        db.query(ColumnEmbedding).filter_by(conn_id=conn.id).delete()
        db.commit()
    else:
        conn = SourceConnection(
            name=name,
            source_type="manual",
            dialect="manual",
            database_name=name,
            project_id=project_id,
            is_active=True,
        )
        db.add(conn)
        db.flush()

    # ── Populate catalog + embeddings ─────────────────────────────────────────
    col_count = 0
    emb_count = 0
    ordinal   = 1

    for tbl in tables:
        tbl_name = (tbl.get("name") or "").strip()
        if not tbl_name:
            continue
        tbl_desc = tbl.get("description", "")

        for col in tbl.get("columns", []):
            col_name = (col.get("name") or "").strip()
            if not col_name:
                continue
            data_type = (col.get("data_type") or "varchar").lower()
            is_pk     = bool(col.get("is_pk"))
            nullable  = bool(col.get("nullable", True))
            col_desc  = col.get("description", "")

            # Catalog column
            db.add(CatalogColumn(
                conn_id=conn.id,
                table_name=tbl_name,
                column_name=col_name,
                data_type=data_type,
                is_nullable=nullable,
                is_primary_key=is_pk,
                ordinal_position=ordinal,
            ))
            ordinal += 1
            col_count += 1

            # Column embedding
            col_def = build_column_definition(tbl_name, col_name, data_type, is_pk, [])
            if col_desc:
                col_def += f" {col_desc}"
            if tbl_desc:
                col_def += f" (Table: {tbl_desc})"
            try:
                emb = get_embedding(col_def)
                db.add(ColumnEmbedding(
                    conn_id=conn.id,
                    table_name=tbl_name,
                    column_name=col_name,
                    column_definition=col_def,
                    embedding_json=json.dumps(emb),
                    embedding_model="text-embedding-3-small",
                ))
                emb_count += 1
            except Exception:
                pass

        # FK relationships
        for fk in tbl.get("foreign_keys", []):
            fk_col   = (fk.get("column") or "").strip()
            ref_tbl  = (fk.get("references_table") or "").strip()
            ref_col  = (fk.get("references_column") or "").strip()
            if fk_col and ref_tbl and ref_col:
                db.add(CatalogRelation(
                    conn_id=conn.id,
                    parent_table=tbl_name,
                    parent_column=fk_col,
                    referenced_table=ref_tbl,
                    referenced_column=ref_col,
                ))

    db.commit()

    return {
        "conn_id":    conn.id,
        "conn_name":  conn.name,
        "tables":     len(tables),
        "columns":    col_count,
        "embeddings": emb_count,
        "message":    f"Schema '{name}' imported: {len(tables)} tables, {col_count} columns, {emb_count} embeddings generated.",
    }


# ── Knowledge Sessions ────────────────────────────────────────────────────────

@router.get("/knowledge/sessions", response_model=list[SessionOut])
def list_sessions(
    kb_schema_id:  Optional[int] = None,
    status:        Optional[str] = None,
    session_type:  Optional[str] = None,
    limit:         int = Query(50, ge=1, le=200),
    offset:        int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(RequirementSession)
    if kb_schema_id is not None:
        q = q.filter(RequirementSession.kb_schema_id == kb_schema_id)
    if status:
        q = q.filter(RequirementSession.status == status)
    if session_type:
        q = q.filter(RequirementSession.session_type == session_type)
    return q.order_by(RequirementSession.created_at.desc()).offset(offset).limit(limit).all()


@router.post("/knowledge/sessions", response_model=SessionOut, status_code=201,
             dependencies=[Depends(require_non_viewer)])
def create_session(req: SessionCreate, db: Session = Depends(get_db)):
    meeting_dt = None
    if req.meeting_datetime:
        try:
            meeting_dt = datetime.fromisoformat(req.meeting_datetime)
        except ValueError:
            pass
    s = RequirementSession(
        kb_schema_id=req.kb_schema_id,
        title=req.title,
        session_type=req.session_type,
        meeting_datetime=meeting_dt,
        duration_minutes=req.duration_minutes,
        attendees_json=json.dumps(req.attendees) if req.attendees else None,
        recording_url=req.recording_url,
        transcript_raw=req.transcript_raw,
        created_by=req.created_by,
        db_schema_name=req.db_schema_name,
        db_connection_name=req.db_connection_name,
        source_system=req.source_system,
        environment_name=req.environment_name,
        technical_context_json=req.technical_context_json,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.get("/knowledge/sessions/{session_id}", response_model=SessionOut)
def get_session(session_id: int, db: Session = Depends(get_db)):
    s = db.query(RequirementSession).filter_by(id=session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")
    return s


@router.put("/knowledge/sessions/{session_id}", response_model=SessionOut,
            dependencies=[Depends(require_non_viewer)])
def update_session(session_id: int, req: SessionUpdate, db: Session = Depends(get_db)):
    s = db.query(RequirementSession).filter_by(id=session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")
    if req.title is not None:
        s.title = req.title
    if req.transcript_raw is not None:
        s.transcript_raw = req.transcript_raw
        if s.status == "READY":
            s.status = "DRAFT"   # reset so user knows re-processing may be needed
    if req.attendees is not None:
        s.attendees_json = json.dumps(req.attendees)
    if req.meeting_datetime is not None:
        try:
            s.meeting_datetime = datetime.fromisoformat(req.meeting_datetime)
        except ValueError:
            pass
    if req.recording_url is not None:
        s.recording_url = req.recording_url
    if req.duration_minutes is not None:
        s.duration_minutes = req.duration_minutes
    if req.db_schema_name is not None:
        s.db_schema_name = req.db_schema_name
    if req.db_connection_name is not None:
        s.db_connection_name = req.db_connection_name
    if req.source_system is not None:
        s.source_system = req.source_system
    if req.environment_name is not None:
        s.environment_name = req.environment_name
    if req.technical_context_json is not None:
        s.technical_context_json = req.technical_context_json
    s.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(s)
    return s


@router.delete("/knowledge/sessions/{session_id}", status_code=204,
               dependencies=[Depends(require_non_viewer)])
def delete_session(session_id: int, db: Session = Depends(get_db)):
    s = db.query(RequirementSession).filter_by(id=session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")
    db.delete(s)
    db.commit()


# ── Session Attachments ────────────────────────────────────────────────────────

@router.post("/knowledge/sessions/{session_id}/attachments",
             response_model=SessionAttachmentOut, status_code=201,
             dependencies=[Depends(require_non_viewer)])
async def upload_attachment(
    session_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Upload a file (PDF/DOCX/XLSX/CSV/TXT/SQL) to a session."""
    from api.services.attachment_processor import get_upload_dir, unique_filename

    s = db.query(RequirementSession).filter_by(id=session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")

    dest_dir = get_upload_dir(session_id)
    safe_name = unique_filename(file.filename or "upload.bin")
    dest_path = dest_dir / safe_name

    content = await file.read()
    dest_path.write_bytes(content)

    att = SessionAttachment(
        session_id=session_id,
        kb_schema_id=s.kb_schema_id,
        file_name=file.filename or safe_name,
        mime_type=file.content_type or "application/octet-stream",
        storage_path=str(dest_path),
        file_size_bytes=len(content),
        uploaded_by=getattr(current_user, "username", None),
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@router.get("/knowledge/sessions/{session_id}/attachments",
            response_model=list[SessionAttachmentOut])
def list_attachments(session_id: int, db: Session = Depends(get_db)):
    return (db.query(SessionAttachment)
            .filter_by(session_id=session_id)
            .order_by(SessionAttachment.created_at.desc())
            .all())


@router.post("/knowledge/attachments/{attachment_id}/process",
             dependencies=[Depends(require_non_viewer)])
def process_attachment_endpoint(
    attachment_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger text extraction + AI pipeline in background."""
    att = db.query(SessionAttachment).filter_by(id=attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found.")

    att.processing_status = "EXTRACTING"
    db.commit()

    def _run():
        from api.database import SessionLocal
        from api.services.attachment_processor import process_attachment
        _db = SessionLocal()
        try:
            process_attachment(attachment_id, _db)
        finally:
            _db.close()

    background_tasks.add_task(_run)
    return {"status": "processing_started", "attachment_id": attachment_id}


@router.delete("/knowledge/attachments/{attachment_id}", status_code=204,
               dependencies=[Depends(require_non_viewer)])
def delete_attachment(attachment_id: int, db: Session = Depends(get_db)):
    att = db.query(SessionAttachment).filter_by(id=attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    # Remove file from disk
    try:
        p = Path(att.storage_path)
        if p.exists():
            p.unlink()
    except Exception:
        pass
    db.delete(att)
    db.commit()


@router.post("/knowledge/sessions/{session_id}/process",
             dependencies=[Depends(require_non_viewer)])
def process_session_endpoint(
    session_id: int,
    req: SessionProcessRequest = SessionProcessRequest(),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
):
    """Trigger AI extraction pipeline. Returns immediately; processing runs in background."""
    s = db.query(RequirementSession).filter_by(id=session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")
    if not s.transcript_raw or not s.transcript_raw.strip():
        raise HTTPException(status_code=422, detail="transcript_raw is empty — add notes before processing.")

    # Mark immediately so frontend can poll
    s.status = "EXTRACTING"
    s.processing_started_at = datetime.utcnow()
    db.commit()

    def _run():
        from api.database import SessionLocal
        with SessionLocal() as bg_db:
            try:
                sp.process_session(
                    session_id=session_id,
                    db=bg_db,
                    model=req.model,
                    create_kb_entries=req.create_kb_entries,
                )
            except Exception as exc:
                print(f"[knowledge] session {session_id} processing failed: {exc}")

    background_tasks.add_task(_run)
    return {"session_id": session_id, "status": "EXTRACTING", "message": "Processing started in background."}


@router.post("/knowledge/sessions/{session_id}/suggest-content",
             dependencies=[Depends(require_non_viewer)])
def suggest_kb_content(session_id: int, db: Session = Depends(get_db)):
    """
    Analyze a session transcript + existing KB entries to suggest what knowledge blocks
    should be added. Returns a list of pre-filled KB entry suggestions with content blocks.
    """
    s = db.query(RequirementSession).filter_by(id=session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")

    transcript = (s.transcript_raw or "").strip()
    summary    = (s.summary or "").strip()
    if not transcript and not summary:
        raise HTTPException(status_code=422, detail="Session has no transcript or summary yet.")

    # Existing KB entries for this session / schema to avoid re-suggesting already captured items
    existing_titles: list[str] = []
    try:
        q = db.query(KnowledgeEntry.title)
        if s.kb_schema_id:
            q = q.filter(KnowledgeEntry.kb_schema_id == s.kb_schema_id)
        existing_titles = [r[0] for r in q.limit(60).all()]
    except Exception:
        pass

    # Build context for LLM
    existing_block = ""
    if existing_titles:
        existing_block = "\n\n== ALREADY IN KNOWLEDGE BASE ==\n" + "\n".join(f"- {t}" for t in existing_titles)

    session_block = f"Session: {s.title or 'Untitled'}\nType: {s.session_type or 'N/A'}\n"
    if s.db_schema_name:
        session_block += f"Schema: {s.db_schema_name}\n"

    content_block = ""
    if transcript:
        content_block += f"\n== TRANSCRIPT ==\n{transcript[:6000]}"
    if summary:
        content_block += f"\n\n== SUMMARY ==\n{summary[:2000]}"

    _SUGGEST_PROMPT = """You are a Knowledge Engineering AI. Analyze the session content and existing KB entries below.
Identify the most valuable pieces of knowledge that are NOT already captured and should be added to the Knowledge Base.

Return ONLY a JSON array (no markdown, no prose) of suggested KB entries. Each entry:
{{
  "title": "concise title",
  "type": "UseCase|Process|Issue|QueryExample|SchemaDefinition|Question",
  "system": "DCT|ADO|Snowflake|General|MSSQL",
  "reason": "one sentence: why this is valuable knowledge to capture",
  "blocks": [
    {{
      "block_type": "text|sql|transcript",
      "content": "the actual content to put in this block",
      "explanation": "brief context / purpose of this block"
    }}
  ]
}}

Rules:
- Suggest 3-7 entries maximum — only the most impactful ones.
- Do NOT suggest anything already in "ALREADY IN KNOWLEDGE BASE".
- For SQL queries discussed: create a QueryExample entry with a sql block containing the actual SQL.
- For processes/workflows: create a Process entry with a text block explaining step by step.
- For issues/bugs discussed: create an Issue entry with a text block covering root cause + fix.
- For key decisions or agreements: create a UseCase entry.
- Keep content blocks concrete — actual content the user can immediately use, not placeholder descriptions.

Session context:
{session}
{content}
{existing}"""

    prompt = _SUGGEST_PROMPT.format(
        session=session_block,
        content=content_block,
        existing=existing_block,
    )

    from api.services.ai_client import get_client, chat_model as _cm
    import time as _time
    client = get_client()
    t0 = _time.monotonic()
    try:
        resp = client.chat.completions.create(
            model=_cm("gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        raw = resp.choices[0].message.content or "[]"
        elapsed = int((_time.monotonic() - t0) * 1000)

        # Strip markdown fences if present
        raw = raw.strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
            raw = raw.rsplit("```", 1)[0].strip()

        suggestions = json.loads(raw)
        if not isinstance(suggestions, list):
            suggestions = []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {exc}")

    try:
        from api.services.ai_trace import store as _trace
        _trace(module="suggest_content", conn_id=None, model="gpt-4o-mini",
               prompt=prompt[:3000], response=raw[:3000],
               tokens_in=resp.usage.prompt_tokens, tokens_out=resp.usage.completion_tokens,
               latency_ms=elapsed, db=db)
    except Exception:
        pass

    return {"session_id": session_id, "suggestions": suggestions, "existing_count": len(existing_titles)}


@router.get("/knowledge/sessions/{session_id}/artifacts", response_model=list[ArtifactOut])
def list_session_artifacts(session_id: int, db: Session = Depends(get_db)):
    s = db.query(RequirementSession).filter_by(id=session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")
    return db.query(SessionArtifact).filter_by(session_id=session_id).order_by(
        SessionArtifact.artifact_type, SessionArtifact.artifact_code
    ).all()


# ── Artifacts ─────────────────────────────────────────────────────────────────
# Fixed paths first, then parameterized — avoids route ordering conflicts

@router.delete("/knowledge/artifacts/links/{link_id}", status_code=204,
               dependencies=[Depends(require_non_viewer)])
def delete_artifact_link(link_id: int, db: Session = Depends(get_db)):
    link = db.query(ArtifactLink).filter_by(id=link_id).first()
    if not link:
        raise HTTPException(status_code=404, detail=f"Link {link_id} not found.")
    db.delete(link)
    db.commit()


@router.get("/knowledge/artifacts/{artifact_id}", response_model=ArtifactOut)
def get_artifact(artifact_id: int, db: Session = Depends(get_db)):
    a = db.query(SessionArtifact).filter_by(id=artifact_id).first()
    if not a:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found.")
    return a


@router.put("/knowledge/artifacts/{artifact_id}", response_model=ArtifactOut,
            dependencies=[Depends(require_non_viewer)])
def update_artifact(artifact_id: int, req: ArtifactUpdate, db: Session = Depends(get_db)):
    a = db.query(SessionArtifact).filter_by(id=artifact_id).first()
    if not a:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found.")
    if req.title is not None:
        a.title = req.title
    if req.description is not None:
        a.description = req.description
    if req.owner is not None:
        a.owner = req.owner
    if req.priority is not None:
        a.priority = req.priority
    if req.status is not None:
        a.status = req.status
    if req.due_date is not None:
        try:
            from datetime import date as _date
            a.due_date = datetime.strptime(req.due_date, "%Y-%m-%d").date()
        except ValueError:
            pass
    if req.systems_involved is not None:
        a.systems_involved = json.dumps(req.systems_involved)
    db.commit()
    db.refresh(a)
    return a


@router.post("/knowledge/artifacts/{artifact_id}/approve", response_model=ArtifactOut,
             dependencies=[Depends(require_developer)])
def approve_artifact(artifact_id: int, db: Session = Depends(get_db)):
    a = db.query(SessionArtifact).filter_by(id=artifact_id).first()
    if not a:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found.")
    a.status = "APPROVED"
    a.approved_at = datetime.utcnow()
    db.commit()
    db.refresh(a)
    return a


@router.post("/knowledge/artifacts/{artifact_id}/reject", response_model=ArtifactOut,
             dependencies=[Depends(require_developer)])
def reject_artifact(artifact_id: int, db: Session = Depends(get_db)):
    a = db.query(SessionArtifact).filter_by(id=artifact_id).first()
    if not a:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found.")
    a.status = "REJECTED"
    db.commit()
    db.refresh(a)
    return a


@router.post("/knowledge/artifacts/{artifact_id}/promote",
             dependencies=[Depends(require_developer)])
def promote_artifact(artifact_id: int, db: Session = Depends(get_db)):
    """Manually promote a session artifact to a KB entry."""
    from api.models import RequirementSession as _RS
    a = db.query(SessionArtifact).filter_by(id=artifact_id).first()
    if not a:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found.")
    if a.kb_entry_id:
        raise HTTPException(status_code=409, detail=f"Artifact already promoted to KB entry {a.kb_entry_id}.")
    session = db.query(_RS).filter_by(id=a.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Parent session not found.")
    try:
        entry_id = sp._promote_artifact(a, session, db, kp)
        if entry_id:
            a.kb_entry_id = entry_id
            db.commit()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"artifact_id": artifact_id, "kb_entry_id": entry_id, "status": "promoted"}


@router.post("/knowledge/artifacts/{artifact_id}/links", response_model=ArtifactLinkOut,
             status_code=201, dependencies=[Depends(require_non_viewer)])
def create_artifact_link(
    artifact_id: int,
    req: ArtifactLinkCreate,
    db: Session = Depends(get_db),
):
    if not db.query(SessionArtifact).filter_by(id=artifact_id).first():
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not found.")
    if not db.query(SessionArtifact).filter_by(id=req.target_artifact_id).first():
        raise HTTPException(status_code=404, detail=f"Target artifact {req.target_artifact_id} not found.")
    link = ArtifactLink(
        source_artifact_id=artifact_id,
        target_artifact_id=req.target_artifact_id,
        relationship_type=req.relationship_type,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.get("/knowledge/artifacts/{artifact_id}/links", response_model=list[ArtifactLinkOut])
def list_artifact_links(artifact_id: int, db: Session = Depends(get_db)):
    return db.query(ArtifactLink).filter(
        (ArtifactLink.source_artifact_id == artifact_id) |
        (ArtifactLink.target_artifact_id == artifact_id)
    ).all()


# ── Process new entry ─────────────────────────────────────────────────────────

@router.post("/knowledge/process", response_model=KnowledgeEntryOut, status_code=201,
             dependencies=[Depends(require_non_viewer)])
def process_knowledge_entry(
    req: KnowledgeEntryCreate,
    skip_duplicate_check: bool = Query(False),
    db: Session = Depends(get_db),
):
    # If content_blocks provided, combine them into raw_content
    effective_content = req.raw_content or ""
    if req.content_blocks:
        blocks_text = kp._combine_blocks(req.content_blocks)
        if blocks_text:
            effective_content = (effective_content + "\n\n" + blocks_text).strip() if effective_content else blocks_text

    if not effective_content or len(effective_content.strip()) < 10:
        raise HTTPException(status_code=422, detail="Content is required (text blocks or raw_content).")

    # Duplicate detection
    dup_id = kp.check_near_duplicate(effective_content, db, skip=skip_duplicate_check)
    if dup_id is not None:
        raise HTTPException(
            status_code=409,
            detail={"message": "Near-duplicate entry detected.", "existing_id": dup_id},
        )

    try:
        result = kp.process_entry(
            title=req.title, type=req.type, system=req.system,
            tags=req.tags, source_type=req.source_type,
            raw_content=effective_content, db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    entry = _persist_entry(result, req, db)

    # Persist content blocks linked to this entry
    if req.content_blocks:
        for i, blk in enumerate(req.content_blocks):
            db.add(KnowledgeEntryBlock(
                entry_id=entry.id,
                block_type=blk.get("block_type", "text"),
                sort_order=i,
                content=blk.get("content") or None,
                explanation=blk.get("explanation") or None,
                vision_text=blk.get("vision_text") or None,
                file_name=blk.get("file_name") or None,
                image_b64=blk.get("image_b64") or None,
            ))
        db.commit()

    summary = result["knowledge_entry"].get("summary") or ""
    kp.embed_and_store_chunks(
        entry_id=entry.id,
        chunks=result.get("chunks", []),
        summary=summary,
        db=db,
        kb_schema_id=entry.kb_schema_id,
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
    kb_schema_id:        Optional[int] = None,
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
    if kb_schema_id is not None:
        q = q.filter(KnowledgeEntry.kb_schema_id == kb_schema_id)
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
    # Operational rule fields — always refresh from LLM result on reprocess
    if ke.get("op_category"):
        entry.op_category = ke["op_category"]
    if ke.get("severity"):
        entry.severity = ke["severity"]
    if ke.get("owner_team"):
        entry.owner_team = ke["owner_team"]
    if ke.get("sql_template"):
        entry.sql_template = ke["sql_template"]
    entry.trigger_condition = ke.get("trigger_condition")
    entry.action_steps = (
        json.dumps(ke["action_steps"]) if isinstance(ke.get("action_steps"), list)
        else ke.get("action_steps")
    )
    entry.stop_condition  = ke.get("stop_condition")
    entry.recovery_steps  = (
        json.dumps(ke["recovery_steps"]) if isinstance(ke.get("recovery_steps"), list)
        else ke.get("recovery_steps")
    )
    si = ke.get("systems_involved_json")
    if isinstance(si, list):
        entry.systems_involved_json = json.dumps(si)
    # Phase 3 orchestration fields
    if ke.get("decision_type"):
        entry.decision_type = ke["decision_type"]
    if ke.get("execution_scope"):
        entry.execution_scope = ke["execution_scope"]
    _dep = ke.get("depends_on")
    if isinstance(_dep, list):
        entry.depends_on = json.dumps(_dep)
    elif _dep:
        entry.depends_on = _dep
    db.commit()

    # Re-resolve dependency edges
    try:
        from api.services.dependency_graph import resolve_edges
        resolve_edges(entry.id, db)
    except Exception as _e:
        print(f"[knowledge] resolve_edges failed for entry {entry.id}: {_e}")

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


# ── Shared constant: all rule type values ────────────────────────────────────
_RULE_TYPES_SET = {
    "OperationalRule", "ValidationRule", "ProcessingRule", "FailureRule",
    "RecoveryRule", "ReconciliationRule", "OwnershipRule", "StopCondition", "ExceptionRule",
}


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
            # Rule entries: build operational signal chunk from structured fields
            if entry.type in _RULE_TYPES_SET or entry.op_category in _RULE_TYPES_SET:
                rule_parts = [entry.title]
                if entry.op_category:
                    rule_parts.append(f"CATEGORY: {entry.op_category}")
                if entry.trigger_condition:
                    rule_parts.append(f"TRIGGER: {entry.trigger_condition}")
                if entry.action_steps:
                    try:
                        steps = json.loads(entry.action_steps)
                        rule_parts.append("ACTION: " + " | ".join(str(s) for s in steps))
                    except Exception:
                        rule_parts.append(f"ACTION: {entry.action_steps}")
                if entry.stop_condition:
                    rule_parts.append(f"STOP: {entry.stop_condition}")
                if entry.recovery_steps:
                    try:
                        recs = json.loads(entry.recovery_steps)
                        rule_parts.append("RECOVERY: " + " | ".join(str(r) for r in recs))
                    except Exception:
                        rule_parts.append(f"RECOVERY: {entry.recovery_steps}")
                if entry.severity:
                    rule_parts.append(f"SEVERITY: {entry.severity}")
                if entry.owner_team:
                    rule_parts.append(f"OWNER: {entry.owner_team}")
                if getattr(entry, "decision_type", None):
                    rule_parts.append(f"DECISION: {entry.decision_type}")
                if getattr(entry, "execution_scope", None):
                    rule_parts.append(f"SCOPE: {entry.execution_scope}")
                _dep_raw = getattr(entry, "depends_on", None)
                if _dep_raw:
                    try:
                        _dl = json.loads(_dep_raw)
                        if _dl:
                            rule_parts.append("DEPENDS ON: " + " | ".join(str(d) for d in _dl))
                    except Exception:
                        pass
                chunk_text = "\n".join(rule_parts) or (entry.raw_content or entry.title)
                chunks = [{"chunk_id": 1, "content": chunk_text, "topic": entry.title}]
            else:
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
                from api.services.knowledge_processor import _chunk_text
                chunks = _chunk_text("\n\n".join(parts), topic=entry.title)

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


# ── Bulk reprocess all operational rule entries ───────────────────────────────

@router.post("/knowledge/reprocess-rules", dependencies=[Depends(require_non_viewer)])
def reprocess_all_rules(db: Session = Depends(get_db)):
    """
    Re-run LLM extraction on every OperationalRule / rule-category entry so that
    trigger_condition, action_steps, stop_condition, recovery_steps, and all
    operational fields are populated with the latest prompt.
    Returns per-entry results so the caller can surface successes, failures, and
    LOW_QUALITY entries that need manual review.
    """
    rule_entries = (
        db.query(KnowledgeEntry)
        .filter(
            (KnowledgeEntry.type.in_(_RULE_TYPES_SET)) |
            (KnowledgeEntry.op_category.in_(_RULE_TYPES_SET))
        )
        .all()
    )

    results = []
    for entry in rule_entries:
        outcome: dict = {"id": entry.id, "title": entry.title, "status": "ok", "quality_score": None}
        try:
            _snapshot_entry(entry, db)
            db.query(KnowledgeChunk).filter_by(entry_id=entry.id).delete()
            entry.embedding_status = "pending"
            entry.version += 1
            db.commit()

            result = kp.process_entry(
                title=entry.title,
                type=entry.type,
                system=entry.system,
                tags=json.loads(entry.tags or "[]"),
                source_type=entry.source_type,
                raw_content=entry.raw_content or "",
                db=db,
            )

            ke = result["knowledge_entry"]
            quality = result.get("quality_score", "MEDIUM")
            entry.summary              = ke.get("summary")
            entry.detailed_explanation = ke.get("detailed_explanation")
            entry.key_points           = json.dumps(ke.get("key_points") or [])
            entry.decision             = ke.get("decision")
            entry.reason               = ke.get("reason")
            entry.is_reusable          = bool(ke.get("is_reusable", True))
            entry.quality_score        = quality
            entry.suggestions          = json.dumps(result.get("suggestions") or [])
            entry.status               = "LOW_QUALITY" if quality == "LOW" else result.get("status", "READY_FOR_EMBEDDING")
            entry.updated_at           = datetime.utcnow()
            # Operational rule fields
            if ke.get("op_category"):
                entry.op_category = ke["op_category"]
            if ke.get("severity"):
                entry.severity = ke["severity"]
            if ke.get("owner_team"):
                entry.owner_team = ke["owner_team"]
            if ke.get("sql_template"):
                entry.sql_template = ke["sql_template"]
            entry.trigger_condition = ke.get("trigger_condition")
            entry.action_steps = (
                json.dumps(ke["action_steps"]) if isinstance(ke.get("action_steps"), list)
                else ke.get("action_steps")
            )
            entry.stop_condition = ke.get("stop_condition")
            entry.recovery_steps = (
                json.dumps(ke["recovery_steps"]) if isinstance(ke.get("recovery_steps"), list)
                else ke.get("recovery_steps")
            )
            si = ke.get("systems_involved_json")
            if isinstance(si, list):
                entry.systems_involved_json = json.dumps(si)
            # Phase 3 orchestration fields
            if ke.get("decision_type"):
                entry.decision_type = ke["decision_type"]
            if ke.get("execution_scope"):
                entry.execution_scope = ke["execution_scope"]
            _dep = ke.get("depends_on")
            if isinstance(_dep, list):
                entry.depends_on = json.dumps(_dep)
            elif _dep:
                entry.depends_on = _dep
            db.commit()

            # Re-resolve dependency edges
            try:
                from api.services.dependency_graph import resolve_edges as _re
                _re(entry.id, db)
            except Exception:
                pass

            kp.embed_and_store_chunks(
                entry_id=entry.id,
                chunks=result.get("chunks", []),
                summary=ke.get("summary") or "",
                db=db,
            )

            outcome["quality_score"] = quality
            if quality == "LOW":
                outcome["status"] = "low_quality"
                outcome["suggestions"] = result.get("suggestions") or []

        except Exception as exc:
            db.rollback()
            outcome["status"] = "error"
            outcome["error"] = str(exc)

        results.append(outcome)

    ok    = sum(1 for r in results if r["status"] == "ok")
    lq    = sum(1 for r in results if r["status"] == "low_quality")
    errs  = sum(1 for r in results if r["status"] == "error")
    return {"total": len(results), "ok": ok, "low_quality": lq, "errors": errs, "results": results}


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
        op_category  = (row.get("op_category") or row.get("category") or "").strip() or None
        severity     = (row.get("severity") or "").strip() or None
        owner_team   = (row.get("owner_team") or row.get("owner") or "").strip() or None
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
                op_category=op_category, severity=severity, owner_team=owner_team,
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


# ── Bulk delete by search keyword (MUST be before /{entry_id} route) ──────────

@router.delete("/knowledge/entries/bulk-delete", status_code=200,
               dependencies=[Depends(require_developer)])
def bulk_delete_entries(
    search: str = Query(..., min_length=1, description="Keyword to match in title or summary"),
    db:     Session = Depends(get_db),
):
    """
    Delete all knowledge entries whose title OR summary contains the search keyword (case-insensitive).
    Returns count of deleted entries. Irreversible — use with care.
    """
    matches = db.query(KnowledgeEntry).filter(
        KnowledgeEntry.title.ilike(f"%{search}%") |
        KnowledgeEntry.summary.ilike(f"%{search}%") |
        KnowledgeEntry.raw_content.ilike(f"%{search}%")
    ).all()

    count = len(matches)
    for entry in matches:
        db.delete(entry)
    db.commit()
    return {"deleted": count, "keyword": search}


# ── Delete single entry ────────────────────────────────────────────────────────

@router.delete("/knowledge/entries/{entry_id}", status_code=204,
               dependencies=[Depends(require_developer)])
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(KnowledgeEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Entry {entry_id} not found.")
    db.delete(entry)
    db.commit()


# ── Content Blocks (per entry) ────────────────────────────────────────────────

@router.get("/knowledge/entries/{entry_id}/blocks")
def get_entry_blocks(entry_id: int, db: Session = Depends(get_db)):
    blocks = (
        db.query(KnowledgeEntryBlock)
        .filter(KnowledgeEntryBlock.entry_id == entry_id)
        .order_by(KnowledgeEntryBlock.sort_order)
        .all()
    )
    return [
        {
            "id":          b.id,
            "entry_id":    b.entry_id,
            "block_type":  b.block_type,
            "sort_order":  b.sort_order,
            "content":     b.content,
            "explanation": b.explanation,
            "vision_text": b.vision_text,
            "file_name":   b.file_name,
            "image_b64":   b.image_b64,
            "created_at":  b.created_at.isoformat() if b.created_at else None,
        }
        for b in blocks
    ]


@router.post("/knowledge/entries/{entry_id}/blocks", status_code=201,
             dependencies=[Depends(require_non_viewer)])
def add_entry_block(entry_id: int, block: dict, db: Session = Depends(get_db)):
    entry = db.query(KnowledgeEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found.")
    existing_count = db.query(KnowledgeEntryBlock).filter_by(entry_id=entry_id).count()
    db_block = KnowledgeEntryBlock(
        entry_id=entry_id,
        block_type=block.get("block_type", "text"),
        sort_order=block.get("sort_order", existing_count),
        content=block.get("content") or None,
        explanation=block.get("explanation") or None,
        vision_text=block.get("vision_text") or None,
        file_name=block.get("file_name") or None,
        image_b64=block.get("image_b64") or None,
    )
    db.add(db_block)
    db.commit()
    db.refresh(db_block)
    return {"id": db_block.id, "entry_id": db_block.entry_id, "block_type": db_block.block_type}


@router.delete("/knowledge/blocks/{block_id}", status_code=204,
               dependencies=[Depends(require_non_viewer)])
def delete_entry_block(block_id: int, db: Session = Depends(get_db)):
    block = db.query(KnowledgeEntryBlock).filter_by(id=block_id).first()
    if not block:
        raise HTTPException(status_code=404, detail="Block not found.")
    db.delete(block)
    db.commit()


# ── Preview AI Understanding of Content Blocks (dry-run, no save) ────────────

@router.post("/knowledge/preview-entry", dependencies=[Depends(require_non_viewer)])
async def preview_entry(
    payload: dict,
    db: Session = Depends(get_db),
):
    """
    Dry-run: for each content block, return what the AI understands from it.
    Used to review AI comprehension before committing Process & Save.
    """
    from api.services.ai_client import get_client, chat_model as _cm
    import base64

    client = get_client()
    blocks  = payload.get("content_blocks", [])
    title   = payload.get("title", "")
    results = []

    for i, block in enumerate(blocks):
        btype   = (block.get("block_type") or "text").lower()
        content = (block.get("content") or "").strip()
        expl    = (block.get("explanation") or "").strip()
        vision  = (block.get("vision_text") or "").strip()
        fname   = block.get("file_name") or ""

        understanding: dict = {"index": i, "block_type": btype, "file_name": fname}

        try:
            if btype == "sql":
                if not content:
                    understanding["summary"] = "No SQL provided yet."
                else:
                    resp = client.chat.completions.create(
                        model=_cm("gpt-4o-mini"),
                        messages=[{"role": "user", "content": (
                            f"Analyse this SQL query and provide a concise review:\n\n```sql\n{content}\n```"
                            + (f"\n\nUser's stated purpose: {expl}" if expl else "")
                            + "\n\nReturn a JSON object with keys:\n"
                            "- summary: one sentence what this query does\n"
                            "- tables_used: list of table names referenced\n"
                            "- returns: what columns/data it returns\n"
                            "- purpose: inferred business purpose\n"
                            "- issues: list of potential issues or improvements (empty list if none)\n"
                            "Return ONLY the JSON."
                        )}],
                        temperature=0,
                    )
                    raw = (resp.choices[0].message.content or "").strip()
                    if raw.startswith("```"): raw = "\n".join(raw.split("\n")[1:]).rsplit("```",1)[0].strip()
                    try:
                        understanding.update(json.loads(raw))
                    except Exception:
                        understanding["summary"] = raw[:300]

            elif btype == "image":
                if vision:
                    understanding["summary"] = f"Vision analysis: {vision[:300]}"
                    understanding["vision_text"] = vision
                else:
                    understanding["summary"] = "No image uploaded yet (vision analysis pending)."

            elif btype in ("document", "transcript", "text"):
                text = content or vision or ""
                if not text:
                    understanding["summary"] = f"No {btype} content provided yet."
                else:
                    label = {"document": "document", "transcript": "meeting transcript", "text": "note"}.get(btype, "text")
                    resp = client.chat.completions.create(
                        model=_cm("gpt-4o-mini"),
                        messages=[{"role": "user", "content": (
                            f"You are reviewing a {label} that will be added to a Knowledge Base.\n\n"
                            f"Content (first 3000 chars):\n{text[:3000]}\n\n"
                            + (f"User's context: {expl}\n\n" if expl else "")
                            + "Return a JSON object with keys:\n"
                            "- summary: 2-3 sentence summary of what this covers\n"
                            "- key_topics: list of 3-6 main topics/concepts\n"
                            "- knowledge_value: HIGH/MEDIUM/LOW — how valuable is this for a knowledge base\n"
                            "- suggested_type: best KB entry type (UseCase/Process/Issue/QueryExample/SchemaDefinition/Question)\n"
                            "- gaps: what important info is missing that would make this more useful (empty list if complete)\n"
                            "Return ONLY the JSON."
                        )}],
                        temperature=0,
                    )
                    raw = (resp.choices[0].message.content or "").strip()
                    if raw.startswith("```"): raw = "\n".join(raw.split("\n")[1:]).rsplit("```",1)[0].strip()
                    try:
                        understanding.update(json.loads(raw))
                    except Exception:
                        understanding["summary"] = raw[:300]

        except Exception as exc:
            understanding["summary"] = f"Preview failed: {exc}"

        results.append(understanding)

    return {"title": title, "block_count": len(blocks), "previews": results}


# ── Process Image via Vision API ──────────────────────────────────────────────

@router.post("/knowledge/process-image", dependencies=[Depends(require_non_viewer)])
async def process_image(
    file: UploadFile = File(...),
    hint: str = Query("", description="Optional user hint about what the image shows"),
):
    """Accept an image upload, call vision API, return extracted text description."""
    import base64
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10 MB).")
    b64 = base64.b64encode(data).decode()
    vision_text = kp._call_vision_api(b64, user_hint=hint)
    return {
        "vision_text": vision_text,
        "file_name":   file.filename,
        "size_bytes":  len(data),
    }


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
        schema_id=req.schema_id,
        response_type=req.response_type,
        conn_id=req.conn_id,
        db=db,
    )


# ── Dependency Graph API (Phase 3.1) ─────────────────────────────────────────

@router.get("/knowledge/entries/{entry_id}/dependencies")
def get_entry_dependencies(entry_id: int, db: Session = Depends(get_db)):
    """Return upstream (depends on) + downstream (impacted by) graph for a rule entry."""
    entry = db.query(KnowledgeEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Entry {entry_id} not found.")
    from api.services.dependency_graph import get_upstream, get_downstream, impact_score as _score
    return {
        "entry_id":    entry_id,
        "title":       entry.title,
        "upstream":    get_upstream(entry_id, db),
        "downstream":  get_downstream(entry_id, db),
        "impact_score": _score(entry_id, db),
    }


@router.get("/knowledge/entries/{entry_id}/impact-score")
def get_impact_score(entry_id: int, db: Session = Depends(get_db)):
    """Return the computed impact score (0–1) for a rule entry."""
    entry = db.query(KnowledgeEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Entry {entry_id} not found.")
    from api.services.dependency_graph import impact_score as _score
    return {"entry_id": entry_id, "impact_score": _score(entry_id, db)}


@router.post("/knowledge/graph/refresh", dependencies=[Depends(require_non_viewer)])
def refresh_dependency_graph(db: Session = Depends(get_db)):
    """Re-resolve all dependency edges from depends_on fields across all rule entries."""
    from api.services.dependency_graph import refresh_all_edges
    count = refresh_all_edges(db)
    return {"refreshed_entries": count}


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

    # Detect whether this is an operational question
    _OP_KW = {
        "stop","halt","block","fail","failure","error","exception","validate","validation",
        "recover","recovery","rollback","escalate","escalation","who handles","who owns",
        "who is responsible","what happens","should i","how to handle","rule","condition",
        "retry","reprocess","threshold","reject","when does","b&c","trf","recon",
        "reconciliation","batch","monthly","cycle","owner","routing","policy failure",
    }
    q_lower = question.lower()
    is_op = any(kw in q_lower for kw in _OP_KW)
    detected_tags = json.dumps({
        "category": "OperationalRule" if is_op else "General",
        "type":     "Feedback",
    })

    if existing:
        existing.frequency += 1
        existing.feedback_type = feedback_type
        existing.ai_answer = ai_answer[:4000] if ai_answer else existing.ai_answer
        existing.updated_at = datetime.utcnow()
        if is_op and existing.detected_tags:
            try:
                tags = json.loads(existing.detected_tags)
                tags["category"] = "OperationalRule"
                existing.detected_tags = json.dumps(tags)
            except Exception:
                pass
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
        detected_tags = detected_tags,
    )
    db.add(oq)
    db.commit()
    db.refresh(oq)
    return {"id": oq.id, "merged": False}


# ── Unanswered operational questions ────────────────────────────────────────

@router.get("/knowledge/open-questions/operational", response_model=list[dict])
def list_operational_open_questions(
    limit:  int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Return open/flagged questions whose detected_tags.category == 'OperationalRule'.
    Used by the Operational Rules tab to surface gaps in rule coverage.
    """
    all_q = (
        db.query(OpenQuestion)
        .filter(OpenQuestion.status.in_(["open", "flagged"]))
        .order_by(OpenQuestion.frequency.desc(), OpenQuestion.created_at.desc())
        .offset(offset).limit(limit).all()
    )
    results = []
    for oq in all_q:
        try:
            tags = json.loads(oq.detected_tags or "{}")
        except Exception:
            tags = {}
        if tags.get("category") == "OperationalRule":
            d = _enrich_question(oq)
            d["feedback_type"] = oq.feedback_type
            results.append(d)
    return results


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


# ── Direct rule save (no LLM — caller provides all structured fields) ─────────

class _DirectRule(BaseModel):
    title:             str
    op_category:       str = "ValidationRule"
    trigger_condition: str
    action_steps:      list[str] = []
    stop_condition:    Optional[str] = None
    recovery_steps:    list[str] = []
    severity:          str = "HIGH"
    owner_team:        Optional[str] = None
    systems_involved:  list[str] = []
    sql_template:      Optional[str] = None
    summary:           Optional[str] = None
    system:            str = "General"
    tags:              list[str] = []
    created_by:        Optional[str] = None


class _DirectRuleBatch(BaseModel):
    rules: list[_DirectRule]


@router.post("/knowledge/rules/direct-save", dependencies=[Depends(require_non_viewer)])
def direct_save_rules(req: _DirectRuleBatch, db: Session = Depends(get_db)):
    """
    Save pre-structured atomic rules directly — no LLM call.
    Caller provides trigger_condition, action_steps, etc. already filled.
    Builds operational chunk and embeds immediately.
    """
    saved: list[dict] = []
    failed: list[dict] = []

    for rule in req.rules:
        try:
            action_json   = json.dumps(rule.action_steps)   if rule.action_steps   else None
            recovery_json = json.dumps(rule.recovery_steps) if rule.recovery_steps else None
            systems_json  = json.dumps(rule.systems_involved) if rule.systems_involved else None
            summary = rule.summary or f"When {rule.trigger_condition}, {', '.join(rule.action_steps[:2]) or 'take action'}."

            entry = KnowledgeEntry(
                title=rule.title,
                type="OperationalRule",
                system=rule.system,
                tags=json.dumps(rule.tags),
                summary=summary,
                detailed_explanation="",
                key_points=json.dumps([]),
                decision="",
                reason="",
                is_reusable=True,
                source_type="Text",
                raw_content=(
                    f"RULE: {rule.title}\n"
                    f"TRIGGER: {rule.trigger_condition}\n"
                    f"ACTION: {'; '.join(rule.action_steps)}\n"
                    + (f"STOP: {rule.stop_condition}\n" if rule.stop_condition else "")
                    + (f"RECOVERY: {'; '.join(rule.recovery_steps)}\n" if rule.recovery_steps else "")
                    + (f"SEVERITY: {rule.severity}\n")
                    + (f"OWNER: {rule.owner_team}\n" if rule.owner_team else "")
                ),
                quality_score="HIGH",
                suggestions=json.dumps([]),
                status="READY_FOR_EMBEDDING",
                embedding_status="pending",
                version=1,
                created_by=rule.created_by,
                op_category=rule.op_category,
                severity=rule.severity,
                owner_team=rule.owner_team,
                systems_involved_json=systems_json,
                sql_template=rule.sql_template,
                trigger_condition=rule.trigger_condition,
                action_steps=action_json,
                stop_condition=rule.stop_condition,
                recovery_steps=recovery_json,
            )
            db.add(entry)
            db.commit()
            db.refresh(entry)

            # Build operational chunk — pure signal, no narrative
            rule_parts = [rule.title, f"CATEGORY: {rule.op_category}"]
            rule_parts.append(f"TRIGGER: {rule.trigger_condition}")
            if rule.action_steps:
                rule_parts.append("ACTION: " + " | ".join(rule.action_steps))
            if rule.stop_condition:
                rule_parts.append(f"STOP: {rule.stop_condition}")
            if rule.recovery_steps:
                rule_parts.append("RECOVERY: " + " | ".join(rule.recovery_steps))
            rule_parts.append(f"SEVERITY: {rule.severity}")
            if rule.owner_team:
                rule_parts.append(f"OWNER: {rule.owner_team}")
            chunk_text = "\n".join(rule_parts)

            kp.embed_and_store_chunks(
                entry_id=entry.id,
                chunks=[{"chunk_id": 1, "content": chunk_text, "topic": rule.title}],
                summary=summary,
                db=db,
            )
            saved.append({"id": entry.id, "title": rule.title})
        except Exception as exc:
            db.rollback()
            failed.append({"title": rule.title, "error": str(exc)})

    return {"saved": len(saved), "failed": len(failed), "entries": saved, "errors": failed}


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
