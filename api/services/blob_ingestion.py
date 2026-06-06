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

    entries_created = 0
    error_msg = None

    try:
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
            from api.services.knowledge_processor import extract_sql_dependencies
            result = extract_sql_dependencies(
                data.decode("utf-8", errors="replace"), db,
                kb_schema_id=kb_schema_id, source_file_id=source_file_id,
                source_blob_path=source_blob_path,
            )
            entries_created = result.get("entries_created", 0)

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


def _extract_text(text: str, filename: str, db: Session,
                  kb_schema_id, source_file_id, source_blob_path) -> int:
    from api.services.knowledge_processor import _make_entry
    if not text.strip():
        return 0
    _make_entry(
        title=filename[:500],
        type="Process",
        system="DCT",
        tags=["document", "policy-attach"],
        summary=text[:300],
        detailed=text[:4000],
        raw_content=text,
        db=db,
        kb_schema_id=kb_schema_id,
        source_file_id=source_file_id,
        source_blob_path=source_blob_path,
    )
    return 1
