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

        elif ext == ".sql":
            sql_text = data.decode("utf-8", errors="replace")
            from api.services.knowledge_processor import extract_sql_dependencies
            result = extract_sql_dependencies(
                sql_text, db,
                kb_schema_id=kb_schema_id, source_file_id=source_file_id,
                source_blob_path=source_blob_path,
            )
            entries_created = result.get("entries_created", 0)
            # Also chunk the full raw SQL so every table/column reference is searchable,
            # regardless of whether it matched the CREATE-block extractor regex.
            raw_entries = _extract_text(
                sql_text, file_row.filename, db, kb_schema_id,
                source_file_id, source_blob_path,
            )
            entries_created += raw_entries

        elif ext in (".xlsx", ".xls"):
            from api.services.knowledge_processor import extract_excel_knowledge
            result = extract_excel_knowledge(
                data, db, kb_schema_id=kb_schema_id,
                filename=file_row.filename, source_file_id=source_file_id,
                source_blob_path=source_blob_path,
            )
            entries_created = result.get("entries_created", 0)

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
            # Plain text / unknown — treat as raw text document
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

    result = process_entry(
        title=filename,
        type="Process",
        system="DCT",
        tags=["document", "policy-attach", "docx"],
        source_type="Document",
        raw_content=text,
        db=db,
    )
    ke_data = result.get("knowledge_entry", {})
    entry = _KE(
        title=(ke_data.get("title") or filename)[:500],
        type=ke_data.get("type", "Process"),
        system="DCT",
        tags=json.dumps(ke_data.get("tags") or ["document", "policy-attach"]),
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


def _build_document_summary(text: str, filename: str) -> str:
    """
    Summarise a large document by batching it into 6000-char windows,
    summarising each window with GPT-4o-mini, then combining the section
    summaries into a single comprehensive explanation.
    Returns a plain-text summary string (or the first 2000 chars on failure).
    """
    from api.services.ai_client import get_client, chat_model as _cm
    client = get_client()

    # Split into ~6000-char sections (≈ 1500 tokens each, leaves room for response)
    SECTION_SIZE = 6000
    sections = [text[i:i + SECTION_SIZE] for i in range(0, len(text), SECTION_SIZE)]

    section_summaries: list[str] = []
    for idx, section in enumerate(sections, 1):
        if not section.strip():
            continue
        try:
            resp = client.chat.completions.create(
                model=_cm("gpt-4o-mini"),
                messages=[{
                    "role": "user",
                    "content": (
                        f"Summarise section {idx}/{len(sections)} of '{filename}'.\n"
                        f"Focus on: what tables/views/procedures are defined or referenced, "
                        f"what data flows occur, key business logic.\n"
                        f"Be concise (3-5 sentences).\n\n"
                        f"CONTENT:\n{section}"
                    ),
                }],
                temperature=0.1,
                max_tokens=300,
            )
            section_summaries.append(resp.choices[0].message.content.strip())
        except Exception:
            # On failure, keep a snippet so we don't lose coverage
            section_summaries.append(f"[Section {idx}]: {section[:300]}...")

    if not section_summaries:
        return text[:2000]

    if len(section_summaries) == 1:
        return section_summaries[0]

    # Combine section summaries into a master document explanation
    combined = "\n\n".join(f"Section {i+1}: {s}" for i, s in enumerate(section_summaries))
    try:
        resp = client.chat.completions.create(
            model=_cm("gpt-4o-mini"),
            messages=[{
                "role": "user",
                "content": (
                    f"You have section-by-section summaries of '{filename}'.\n"
                    f"Write a comprehensive document-level explanation covering:\n"
                    f"1. Overall purpose and business function\n"
                    f"2. Key tables/views/objects and what they do\n"
                    f"3. Data flow and dependencies\n"
                    f"4. Important business logic or transformations\n\n"
                    f"SECTION SUMMARIES:\n{combined[:8000]}"
                ),
            }],
            temperature=0.1,
            max_tokens=800,
        )
        return resp.choices[0].message.content.strip()
    except Exception:
        return combined[:3000]


def _extract_text(text: str, filename: str, db: Session,
                  kb_schema_id, source_file_id, source_blob_path) -> int:
    from api.services.knowledge_processor import _make_entry
    if not text.strip():
        return 0

    # Generate a full document summary so broad "explain this document" queries
    # get a complete answer instead of only seeing 3-5 random chunks.
    doc_summary = _build_document_summary(text, filename)

    _make_entry(
        title=f"{filename} — Full Document Summary",
        type="Process",
        system="DCT",
        tags=["document", "summary", "full-document"],
        summary=doc_summary[:2000],
        detailed=doc_summary,
        raw_content=text,           # full raw text → chunked + embedded for detail queries
        db=db,
        kb_schema_id=kb_schema_id,
        source_file_id=source_file_id,
        source_blob_path=source_blob_path,
    )
    return 1
