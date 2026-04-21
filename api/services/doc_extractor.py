"""
doc_extractor.py — Extract text/tabular content from uploaded documents.

Supported formats: pdf, docx, xlsx, csv, txt
Raw file bytes → { text, row_count, summary }
Never executes uploaded content.
"""
from __future__ import annotations

import io
import csv as _csv
from typing import Optional

MAX_TEXT_CHARS = 32000
PREVIEW_ROWS   = 100


def extract(filename: str, content: bytes, file_type: str) -> dict:
    """
    Returns:
      text       — extracted text (≤ MAX_TEXT_CHARS chars)
      row_count  — number of data rows (tabular files only)
      summary    — short preview (first 500 chars)
    """
    ft = file_type.lower().lstrip(".")

    if ft == "pdf":
        return _extract_pdf(content)
    elif ft == "docx":
        return _extract_docx(content)
    elif ft in ("xlsx", "xls"):
        return _extract_xlsx(content)
    elif ft == "csv":
        return _extract_csv(content)
    elif ft == "txt":
        return _extract_txt(content)
    else:
        raise ValueError(f"Unsupported file type: {ft}")


def _extract_pdf(content: bytes) -> dict:
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(content))
        pages = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        text = "\n".join(pages)[:MAX_TEXT_CHARS]
        return {"text": text, "row_count": None, "summary": text[:500]}
    except ImportError:
        raise RuntimeError("pypdf is not installed. Run: pip install pypdf")


def _extract_docx(content: bytes) -> dict:
    try:
        import docx
        doc = docx.Document(io.BytesIO(content))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        text = "\n".join(paragraphs)[:MAX_TEXT_CHARS]
        return {"text": text, "row_count": None, "summary": text[:500]}
    except ImportError:
        raise RuntimeError("python-docx is not installed. Run: pip install python-docx")


def _extract_xlsx(content: bytes) -> dict:
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return {"text": "", "row_count": 0, "summary": ""}

        header = [str(c) if c is not None else "" for c in rows[0]]
        data_rows = rows[1:PREVIEW_ROWS + 1]

        lines = [",".join(header)]
        for row in data_rows:
            lines.append(",".join("" if v is None else str(v)[:200] for v in row))

        text = "\n".join(lines)[:MAX_TEXT_CHARS]
        row_count = len(rows) - 1
        return {"text": text, "row_count": row_count, "summary": text[:500]}
    except ImportError:
        raise RuntimeError("openpyxl is not installed. Run: pip install openpyxl")


def _extract_csv(content: bytes) -> dict:
    try:
        decoded = content.decode("utf-8", errors="replace")
    except Exception:
        decoded = content.decode("latin-1", errors="replace")

    reader = _csv.reader(io.StringIO(decoded))
    lines = []
    row_count = 0
    for i, row in enumerate(reader):
        if i > PREVIEW_ROWS:
            break
        lines.append(",".join(str(c)[:200] for c in row))
        if i > 0:
            row_count += 1

    text = "\n".join(lines)[:MAX_TEXT_CHARS]
    return {"text": text, "row_count": row_count, "summary": text[:500]}


def _extract_txt(content: bytes) -> dict:
    try:
        text = content.decode("utf-8", errors="replace")
    except Exception:
        text = content.decode("latin-1", errors="replace")
    text = text[:MAX_TEXT_CHARS]
    return {"text": text, "row_count": None, "summary": text[:500]}
