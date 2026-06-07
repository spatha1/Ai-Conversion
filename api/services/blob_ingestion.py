"""
blob_ingestion.py — dispatches file KB extraction by extension.
Called by the documents router when the user triggers "Extract Knowledge"
on a file, folder, or process area.
"""
from __future__ import annotations

import os
from datetime import datetime

from sqlalchemy.orm import Session

from api.models import AfsFile


def extract_file(file_id: int, db: Session) -> dict:
    """
    Download the file from Blob Storage and route to the appropriate extractor
    based on file extension. Updates AfsFile.status throughout.
    Returns {entries_created, status}.
    """
    file_row = db.query(AfsFile).filter_by(id=file_id).first()
    if not file_row:
        return {"entries_created": 0, "status": "Failed", "error": "File not found"}

    file_row.status = "Processing"
    try:
        db.commit()
    except Exception:
        db.rollback()

    # Clean up any previously extracted entries so re-extraction is idempotent
    try:
        from api.models import KnowledgeEntry as _KE, KnowledgeChunk as _KC
        old_ids = [r[0] for r in db.query(_KE.id).filter(_KE.source_file_id == file_id).all()]
        if old_ids:
            db.query(_KC).filter(_KC.entry_id.in_(old_ids)).delete(synchronize_session=False)
            db.query(_KE).filter(_KE.id.in_(old_ids)).delete(synchronize_session=False)
            db.commit()
    except Exception as _ce:
        print(f"[blob_ingestion] cleanup warning: {_ce}")
        db.rollback()

    entries_created = 0
    error_msg = None

    try:
        # Prefer local disk copy (always present); fall back to Azure Blob
        from api.routers.documents import _local_upload_path
        local_path = _local_upload_path(file_row.folder_id, file_row.filename)
        if os.path.exists(local_path):
            with open(local_path, "rb") as fh:
                data = fh.read()
        else:
            from api.services import azure_blob_service as blob_svc
            data = blob_svc.download_bytes(file_row.blob_path)

        ext = os.path.splitext(file_row.filename)[1].lower()
        kb_schema_id = file_row.kb_schema_id
        source_file_id = file_row.id
        source_blob_path = file_row.blob_path

        if ext == ".xml":
            from api.services.knowledge_processor import extract_xml_paths
            result = extract_xml_paths(
                data, db, kb_schema_id=kb_schema_id,
                source_file_id=source_file_id, source_blob_path=source_blob_path,
            )
            entries_created = result.get("entries_created", 0)
            # Add a document summary so "explain this XML file" queries work
            xml_text = data.decode("utf-8", errors="replace")
            doc_summary = _build_document_summary(xml_text, file_row.filename)
            from api.services.knowledge_processor import _make_entry
            _make_entry(
                title=f"{file_row.filename} — Document Summary",
                type="Process",
                system="DCT",
                tags=["summary", "full-document", file_row.filename.lower()],
                summary=doc_summary[:2000],
                detailed=doc_summary,
                raw_content=doc_summary,
                db=db, kb_schema_id=kb_schema_id,
                source_file_id=source_file_id, source_blob_path=source_blob_path,
            )
            entries_created += 1

        elif ext == ".sql":
            sql_text = data.decode("utf-8", errors="replace")
            from api.services.knowledge_processor import extract_sql_dependencies
            result = extract_sql_dependencies(
                sql_text, db,
                kb_schema_id=kb_schema_id, source_file_id=source_file_id,
                source_blob_path=source_blob_path,
                filename=file_row.filename,
            )
            entries_created = result.get("entries_created", 0)
            stmt_entries = _extract_sql_by_statements(
                sql_text, file_row.filename, db, kb_schema_id,
                source_file_id, source_blob_path,
            )
            entries_created += stmt_entries
            # Document Summary — answers "explain this SQL file" broad queries
            doc_summary = _build_document_summary(sql_text, file_row.filename)
            from api.services.knowledge_processor import _make_entry
            _make_entry(
                title=f"{file_row.filename} — Document Summary",
                type="Process",
                system="DCT",
                tags=["summary", "full-document", "sql", file_row.filename.lower()],
                summary=doc_summary[:2000],
                detailed=doc_summary,
                raw_content=doc_summary,
                db=db, kb_schema_id=kb_schema_id,
                source_file_id=source_file_id, source_blob_path=source_blob_path,
            )
            entries_created += 1

        elif ext in (".xlsx", ".xls"):
            from api.services.knowledge_processor import extract_excel_knowledge
            result = extract_excel_knowledge(
                data, db, kb_schema_id=kb_schema_id,
                filename=file_row.filename, source_file_id=source_file_id,
                source_blob_path=source_blob_path,
            )
            entries_created = result.get("entries_created", 0)
            # Add document summary for "explain this spreadsheet" queries
            excel_text = _excel_to_text(data, file_row.filename)
            if excel_text:
                doc_summary = _build_document_summary(excel_text, file_row.filename)
                from api.services.knowledge_processor import _make_entry
                _make_entry(
                    title=f"{file_row.filename} — Document Summary",
                    type="Process",
                    system="DCT",
                    tags=["summary", "full-document", file_row.filename.lower()],
                    summary=doc_summary[:2000],
                    detailed=doc_summary,
                    raw_content=doc_summary,
                    db=db, kb_schema_id=kb_schema_id,
                    source_file_id=source_file_id, source_blob_path=source_blob_path,
                )
                entries_created += 1

        elif ext == ".docx":
            entries_created = _extract_docx(
                data, file_row.filename, db, kb_schema_id,
                source_file_id, source_blob_path,
            )

        elif ext == ".pdf":
            entries_created = _extract_pdf(
                data, file_row.filename, db, kb_schema_id,
                source_file_id, source_blob_path,
            )

        else:
            # Plain text / markdown / csv / unknown — treat as raw text document
            entries_created = _extract_text(
                data.decode("utf-8", errors="replace"), file_row.filename,
                db, kb_schema_id, source_file_id, source_blob_path,
            )

        file_row.status = "Extracted"
        file_row.entry_count = entries_created
        file_row.extracted_at = datetime.utcnow()

    except Exception as exc:
        error_msg = str(exc)[:2000]
        file_row.status = "Failed"
        file_row.extraction_error = error_msg

    try:
        db.commit()
    except Exception:
        db.rollback()

    return {"entries_created": entries_created, "status": file_row.status, "error": error_msg}


def _extract_docx(data: bytes, filename: str, db: Session,
                  kb_schema_id, source_file_id, source_blob_path) -> int:
    from io import BytesIO
    from api.services.knowledge_processor import process_entry, _chunk_text, embed_and_store_chunks
    from api.models import KnowledgeEntry as _KE
    import json

    try:
        import docx as _docx
        doc = _docx.Document(BytesIO(data))
        text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception:
        text = data.decode("utf-8", errors="replace")

    if not text.strip():
        return 0

    ext_tag = os.path.splitext(filename)[1].lstrip(".").lower() or "document"
    result = process_entry(
        title=filename,
        type="Process",
        system="DCT",
        tags=["document", ext_tag, filename.lower()],
        source_type="Document",
        raw_content=text,
        db=db,
    )
    ke_data = result.get("knowledge_entry", {})
    entry = _KE(
        title=(ke_data.get("title") or filename)[:500],
        type=ke_data.get("type", "Process"),
        system="DCT",
        tags=json.dumps(ke_data.get("tags") or ["document", ext_tag]),
        summary=ke_data.get("summary", ""),
        detailed_explanation=ke_data.get("detailed_explanation", text[:2000]),
        key_points=json.dumps(ke_data.get("key_points") or []),
        is_reusable=True,
        source_type="Document",
        raw_content=text,
        quality_score=result.get("quality_score", "MEDIUM"),
        status="READY_FOR_EMBEDDING",
        embedding_status="pending",
        version=1,
        kb_schema_id=kb_schema_id,
        source_file_id=source_file_id,
        source_blob_path=source_blob_path,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    chunks = result.get("chunks") or _chunk_text(text, topic=entry.title)
    embed_and_store_chunks(
        entry_id=entry.id, chunks=chunks,
        summary=ke_data.get("summary", ""), db=db, kb_schema_id=kb_schema_id,
        source_file_id=source_file_id,
    )
    return 1


def _extract_pdf(data: bytes, filename: str, db: Session,
                 kb_schema_id, source_file_id, source_blob_path) -> int:
    from io import BytesIO
    text = ""
    try:
        import pypdf
        reader = pypdf.PdfReader(BytesIO(data))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        text = data.decode("utf-8", errors="replace")
    if not text.strip():
        return 0
    return _extract_text(text, filename, db, kb_schema_id, source_file_id, source_blob_path)


def _split_sql_statements(sql_text: str) -> list[str]:
    """
    Split a T-SQL file into individual statements using GO as the primary
    separator, then further split on blank lines before SQL keywords as fallback.
    Strips empty blocks. Merges tiny fragments (<50 chars) with the previous block.
    """
    import re
    # Primary: split on GO (T-SQL batch separator) on its own line
    go_pattern = re.compile(r'^\s*GO\s*$', re.IGNORECASE | re.MULTILINE)
    blocks = go_pattern.split(sql_text)

    # If GO gave us only 1 block, try splitting on double-newlines before SQL keywords
    if len(blocks) <= 1:
        kw_pattern = re.compile(
            r'\n{2,}(?=\s*(?:CREATE|ALTER|DROP|INSERT|SELECT|UPDATE|DELETE|MERGE|'
            r'DECLARE|SET|EXEC|EXECUTE|IF|BEGIN|END|WITH|USE)\b)',
            re.IGNORECASE,
        )
        blocks = kw_pattern.split(sql_text)

    # Clean and merge short fragments
    cleaned: list[str] = []
    for b in blocks:
        b = b.strip()
        if not b:
            continue
        if cleaned and len(b) < 50:
            cleaned[-1] = cleaned[-1] + "\n" + b
        else:
            cleaned.append(b)
    return cleaned or [sql_text]


# Max chars per chunk — keeps LLM context reasonable while staying complete
_SQL_CHUNK_MAX = 6000


def _extract_sql_by_statements(sql_text: str, filename: str, db,
                                kb_schema_id, source_file_id, source_blob_path) -> int:
    """
    Split SQL into statement-boundary chunks and create one KB entry per chunk.
    Each entry's raw_content = the full SQL statement(s), so the LLM always
    sees complete, syntactically coherent code — never a mid-statement fragment.
    Large statements are further split at _SQL_CHUNK_MAX chars.
    Also generates a document-level summary entry for broad 'explain this file' queries.
    """
    from api.services.knowledge_processor import _make_entry

    statements = _split_sql_statements(sql_text)
    entries_created = 0

    # Group statements into chunks capped at _SQL_CHUNK_MAX chars
    groups: list[list[str]] = []
    current_group: list[str] = []
    current_len = 0
    for stmt in statements:
        if current_len + len(stmt) > _SQL_CHUNK_MAX and current_group:
            groups.append(current_group)
            current_group = [stmt]
            current_len = len(stmt)
        else:
            current_group.append(stmt)
            current_len += len(stmt)
    if current_group:
        groups.append(current_group)

    import re as _re
    for idx, group in enumerate(groups, 1):
        chunk_sql = "\n\nGO\n\n".join(group)
        # Derive a title from the first meaningful SQL keyword + object name
        m = _re.search(
            r'(?:CREATE|ALTER|SELECT\s+INTO|INSERT\s+INTO)\s+(?:\S+\s+)?(\S+)',
            chunk_sql, _re.IGNORECASE,
        )
        title = f"{filename} — Part {idx}" if not m else f"{filename} — {m.group(1)[:80]}"

        # Build a compact raw_content for embedding — table refs + first 400 chars of SQL.
        # Keeps each statement entry to 1 embedding call instead of 4-5 word-window chunks.
        tables = _re.findall(
            r'(?:FROM|JOIN|INTO|TABLE|UPDATE)\s+([\w\.\[\]]+)',
            chunk_sql, _re.IGNORECASE,
        )
        tables_str = ", ".join(dict.fromkeys(t.strip("[]") for t in tables[:20]))
        compact_rc = f"File: {filename}\nObject: {title}\nTables referenced: {tables_str}\n\n{chunk_sql[:600]}"

        _make_entry(
            title=title,
            type="QueryDefinition",
            system="DCT",
            tags=["sql", "statement", filename.lower()],
            summary=chunk_sql[:300],
            detailed=chunk_sql[:4000],
            raw_content=compact_rc,   # short → 1 chunk → 1 embedding call
            db=db,
            kb_schema_id=kb_schema_id,
            source_file_id=source_file_id,
            source_blob_path=source_blob_path,
        )
        entries_created += 1

    # Document-level summary so 'explain the whole file' queries have a complete answer.
    # raw_content = GPT prose (not raw SQL) so this entry only matches broad queries;
    # specific object name queries hit the statement chunks above instead.
    doc_summary = _build_document_summary(sql_text, filename)
    _make_entry(
        title=f"{filename} — Document Summary",
        type="Process",
        system="DCT",
        tags=["summary", "full-document", filename.lower()],
        summary=doc_summary[:2000],
        detailed=doc_summary,
        raw_content=doc_summary,
        db=db,
        kb_schema_id=kb_schema_id,
        source_file_id=source_file_id,
        source_blob_path=source_blob_path,
    )
    entries_created += 1

    return entries_created


def _build_document_summary(text: str, filename: str) -> str:
    """
    Single-call summary: samples the beginning, middle, and end of the document
    and asks GPT-4o-mini to produce a comprehensive overview in one request.
    Fast (~3 seconds) regardless of file size.
    """
    from api.services.ai_client import get_client, chat_model as _cm
    client = get_client()

    total = len(text)
    # Sample: first 3000, middle 2000, last 2000 chars — enough for any document size
    head   = text[:3000]
    mid_s  = max(0, total // 2 - 1000)
    middle = text[mid_s:mid_s + 2000]
    tail   = text[max(0, total - 2000):]
    sample = (
        f"=== START ===\n{head}\n\n"
        f"=== MIDDLE (chars {mid_s}–{mid_s+2000} of {total}) ===\n{middle}\n\n"
        f"=== END ===\n{tail}"
    )

    try:
        resp = client.chat.completions.create(
            model=_cm("gpt-4o-mini"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a technical writer creating documentation ABOUT a file. "
                        "Write entirely about the file's content — never about yourself or your capabilities. "
                        "Do not use first person. Do not mention AI or knowledge cutoffs. "
                        "Output is plain documentation a developer will read."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Write a developer-friendly overview of the file '{filename}' "
                        f"({total:,} chars total) based on these sampled sections.\n\n"
                        f"Structure the output EXACTLY as:\n\n"
                        f"**What this file does** — 1-2 plain-English sentences about the file's purpose\n\n"
                        f"**SQL objects defined** — list every CREATE TABLE/VIEW/PROCEDURE found, "
                        f"one line each: object name + one sentence on what it does\n\n"
                        f"**Data sources** — every external table/schema the file reads from, "
                        f"one line each: source name — which object uses it\n\n"
                        f"**Data flow** — plain English: source tables → intermediate tables → output tables\n\n"
                        f"**Key logic** — filters, UNIONs, transformations, or conditions a developer must know\n\n"
                        f"**Watch out for** — dependencies or gotchas that could break if changed\n\n"
                        f"FILE CONTENT (sampled):\n{sample}"
                    ),
                },
            ],
            temperature=0.1,
            max_tokens=1400,
        )
        return resp.choices[0].message.content.strip()
    except Exception:
        return text[:2000]


def _excel_to_text(data: bytes, filename: str) -> str:
    """Convert Excel workbook to plain text for document summary generation."""
    try:
        import io as _io
        import openpyxl
        wb = openpyxl.load_workbook(_io.BytesIO(data), data_only=True)
        parts = []
        for ws in wb.worksheets:
            rows = list(ws.iter_rows(values_only=True))
            if not rows:
                continue
            parts.append(f"=== Sheet: {ws.title} ===")
            for row in rows[:200]:  # cap at 200 rows per sheet for summary
                cells = [str(c) if c is not None else "" for c in row]
                line = "\t".join(cells).strip()
                if line:
                    parts.append(line)
        return "\n".join(parts)
    except Exception:
        return ""


def _extract_text(text: str, filename: str, db: Session,
                  kb_schema_id, source_file_id, source_blob_path) -> int:
    """Used for .txt, .docx fallback, and .pdf. Generates summary + word-window chunks."""
    from api.services.knowledge_processor import _make_entry
    if not text.strip():
        return 0

    doc_summary = _build_document_summary(text, filename)

    _make_entry(
        title=f"{filename} — Document Summary",
        type="Process",
        system="DCT",
        tags=["document", "summary", "full-document"],
        summary=doc_summary[:2000],
        detailed=doc_summary,
        raw_content=text,
        db=db,
        kb_schema_id=kb_schema_id,
        source_file_id=source_file_id,
        source_blob_path=source_blob_path,
    )
    return 1
