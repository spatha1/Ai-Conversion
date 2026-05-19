"""
attachment_processor.py — Extract text from uploaded session files and run AI pipeline.
Supports: PDF, DOCX, XLSX/XLS, CSV, TXT, SQL, MD
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session as DBSession

# ── Upload directory (Linux VM path; falls back to repo-local for Windows dev) ──
_VM_UPLOAD = Path("/home/azureuser/Ai-Conversion/uploads")
UPLOAD_DIR: Path = _VM_UPLOAD if _VM_UPLOAD.parent.exists() else Path(__file__).parent.parent.parent / "uploads"


def get_upload_dir(session_id: int) -> Path:
    d = UPLOAD_DIR / str(session_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def unique_filename(original: str) -> str:
    ext = Path(original).suffix
    return f"{uuid.uuid4().hex}{ext}"


def extract_text(file_path: Path, mime_type: str) -> str:
    """Return plain text from file. Returns '' on failure."""
    try:
        suffix = file_path.suffix.lower()

        # PDF
        if suffix == ".pdf" or "pdf" in mime_type:
            try:
                import pdfplumber
                with pdfplumber.open(file_path) as pdf:
                    return "\n".join(p.extract_text() or "" for p in pdf.pages)
            except ImportError:
                pass
            try:
                from pypdf import PdfReader
                r = PdfReader(str(file_path))
                return "\n".join(p.extract_text() or "" for p in r.pages)
            except ImportError:
                pass

        # DOCX
        if suffix == ".docx" or "wordprocessingml" in mime_type or "msword" in mime_type:
            from docx import Document
            doc = Document(str(file_path))
            return "\n".join(p.text for p in doc.paragraphs)

        # XLSX / XLS
        if suffix in (".xlsx", ".xls") or "spreadsheet" in mime_type or "excel" in mime_type:
            import openpyxl
            wb = openpyxl.load_workbook(str(file_path), read_only=True, data_only=True)
            parts: list[str] = []
            for ws in wb.worksheets:
                parts.append(f"=== Sheet: {ws.title} ===")
                for row in ws.iter_rows(values_only=True):
                    parts.append("\t".join("" if v is None else str(v) for v in row))
            return "\n".join(parts)

        # CSV / TXT / SQL / MD and other text types
        return file_path.read_text(encoding="utf-8", errors="replace")

    except Exception as exc:
        return f"[extraction error: {exc}]"


def process_attachment(attachment_id: int, db: DBSession) -> None:
    """
    1. Load attachment, mark EXTRACTING
    2. Extract text from file
    3. Save extracted_text, mark EXTRACTED
    4. Append extracted text to session.transcript_raw
    5. Mark READY on success, FAILED on error
    """
    from api.models import SessionAttachment, RequirementSession

    att = db.query(SessionAttachment).filter_by(id=attachment_id).first()
    if not att:
        return

    try:
        att.processing_status = "EXTRACTING"
        db.commit()

        file_path = Path(att.storage_path)
        text = extract_text(file_path, att.mime_type)

        att.extracted_text = text
        att.processing_status = "EXTRACTED"
        db.commit()

        # Append to session transcript so AI extraction sees it
        if text.strip():
            session = db.query(RequirementSession).filter_by(id=att.session_id).first()
            if session:
                separator = f"\n\n--- ATTACHMENT: {att.file_name} ---\n\n"
                session.transcript_raw = (session.transcript_raw or "") + separator + text
                session.updated_at = datetime.utcnow()
                db.commit()

        att.processing_status = "READY"
        db.commit()

    except Exception as exc:
        try:
            att.processing_status = "FAILED"
            att.last_error = str(exc)[:2000]
            db.commit()
        except Exception:
            pass
