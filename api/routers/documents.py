"""
documents.py — Azure File Share + Blob document store endpoints.
Provides folder management, file upload, and knowledge extraction
for the structured document repository (PolicyAttach/SQL, etc.).
"""
from __future__ import annotations

import json
import mimetypes
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.dependencies import get_current_user, require_non_viewer
from api.models import AfsFile, AfsFolder, KnowledgeEntry

router = APIRouter(dependencies=[Depends(get_current_user)])


# ─────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────

class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    process_name: Optional[str] = None
    source_system: Optional[str] = None
    target_system: Optional[str] = None
    lob: Optional[str] = None
    owner_team: Optional[str] = None
    kb_schema_id: Optional[int] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    process_name: Optional[str] = None
    source_system: Optional[str] = None
    target_system: Optional[str] = None
    lob: Optional[str] = None
    owner_team: Optional[str] = None
    kb_schema_id: Optional[int] = None


class ExtractBatchBody(BaseModel):
    file_ids: list[int]


class ExtractByProcessBody(BaseModel):
    process_name: str


def _folder_dict(f: AfsFolder, include_children: bool = False) -> dict:
    d = {
        "id": f.id,
        "name": f.name,
        "parent_id": f.parent_id,
        "process_name": f.process_name,
        "source_system": f.source_system,
        "target_system": f.target_system,
        "lob": f.lob,
        "owner_team": f.owner_team,
        "blob_prefix": f.blob_prefix,
        "afs_path": f.afs_path,
        "kb_schema_id": f.kb_schema_id,
        "created_by": f.created_by,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }
    if include_children:
        d["children"] = [_folder_dict(c, include_children=True) for c in (f.children or [])]
    return d


def _file_dict(f: AfsFile) -> dict:
    return {
        "id": f.id,
        "folder_id": f.folder_id,
        "filename": f.filename,
        "blob_path": f.blob_path,
        "afs_path": f.afs_path,
        "file_size": f.file_size,
        "mime_type": f.mime_type,
        "status": f.status,
        "extraction_error": f.extraction_error,
        "entry_count": f.entry_count,
        "uploaded_by": f.uploaded_by,
        "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else None,
        "extracted_at": f.extracted_at.isoformat() if f.extracted_at else None,
        "kb_schema_id": f.kb_schema_id,
    }


# ─────────────────────────────────────────────────────────────
# Folder endpoints
# ─────────────────────────────────────────────────────────────

@router.get("/documents/folders")
def list_folders(db: Session = Depends(get_db)):
    """Return full folder tree (top-level folders with nested children)."""
    roots = db.query(AfsFolder).filter(AfsFolder.parent_id.is_(None)).all()
    return [_folder_dict(f, include_children=True) for f in roots]


@router.post("/documents/folders", dependencies=[Depends(require_non_viewer)])
def create_folder(body: FolderCreate, db: Session = Depends(get_db),
                  current_user=Depends(get_current_user)):
    # Derive blob_prefix and afs_path from parent + name
    blob_prefix = ""
    afs_path = ""
    if body.parent_id:
        parent = db.query(AfsFolder).filter_by(id=body.parent_id).first()
        if parent:
            parent_prefix = (parent.blob_prefix or "").rstrip("/")
            blob_prefix = f"{parent_prefix}/{body.name}/" if parent_prefix else f"{body.name}/"
            parent_afs = (parent.afs_path or "").rstrip("/")
            afs_path = f"{parent_afs}/{body.name}" if parent_afs else f"/{body.name}"
    else:
        blob_prefix = f"{body.name}/"
        afs_path = f"/{body.name}"

    folder = AfsFolder(
        name=body.name,
        parent_id=body.parent_id,
        process_name=body.process_name,
        source_system=body.source_system,
        target_system=body.target_system,
        lob=body.lob,
        owner_team=body.owner_team,
        blob_prefix=blob_prefix,
        afs_path=afs_path,
        kb_schema_id=body.kb_schema_id,
        created_by=getattr(current_user, "username", None),
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)

    # Create AFS directory (non-blocking — graceful if not configured)
    try:
        from api.services import azure_file_service as afs
        afs.ensure_directory(afs_path)
    except Exception:
        pass

    return _folder_dict(folder)


@router.put("/documents/folders/{folder_id}", dependencies=[Depends(require_non_viewer)])
def update_folder(folder_id: int, body: FolderUpdate, db: Session = Depends(get_db)):
    folder = db.query(AfsFolder).filter_by(id=folder_id).first()
    if not folder:
        raise HTTPException(404, "Folder not found")
    for field in ("name", "process_name", "source_system", "target_system", "lob", "owner_team", "kb_schema_id"):
        val = getattr(body, field, None)
        if val is not None:
            setattr(folder, field, val)
    db.commit()
    db.refresh(folder)
    return _folder_dict(folder)


@router.delete("/documents/folders/{folder_id}", dependencies=[Depends(require_non_viewer)])
def delete_folder(folder_id: int, delete_files: bool = False, db: Session = Depends(get_db)):
    folder = db.query(AfsFolder).filter_by(id=folder_id).first()
    if not folder:
        raise HTTPException(404, "Folder not found")

    afs_path = folder.afs_path

    if delete_files:
        # Delete all blob files under this folder prefix
        try:
            from api.services import azure_blob_service as blob_svc
            blobs = blob_svc.list_blobs(folder.blob_prefix or "")
            for b in blobs:
                blob_svc.delete_blob(b["name"])
        except Exception:
            pass
        try:
            from api.services import azure_file_service as afs
            afs.delete_directory(afs_path or "")
        except Exception:
            pass

    db.delete(folder)
    db.commit()
    return {"deleted": True}


@router.get("/documents/folders/{folder_id}/files")
def list_folder_files(folder_id: int, db: Session = Depends(get_db)):
    folder = db.query(AfsFolder).filter_by(id=folder_id).first()
    if not folder:
        raise HTTPException(404, "Folder not found")
    files = db.query(AfsFile).filter_by(folder_id=folder_id).all()
    return [_file_dict(f) for f in files]


# ─────────────────────────────────────────────────────────────
# File upload
# ─────────────────────────────────────────────────────────────

@router.post("/documents/folders/{folder_id}/upload", dependencies=[Depends(require_non_viewer)])
async def upload_file(
    folder_id: int,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from api.config import settings

    folder = db.query(AfsFolder).filter_by(id=folder_id).first()
    if not folder:
        raise HTTPException(404, "Folder not found")

    data = await file.read()
    if len(data) > 200 * 1024 * 1024:  # 200 MB hard limit
        raise HTTPException(413, "File too large (max 200 MB)")

    filename = file.filename or "file"
    mime_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"

    blob_prefix = (folder.blob_prefix or "").rstrip("/")
    blob_path = f"{blob_prefix}/{filename}" if blob_prefix else filename
    afs_path = f"{(folder.afs_path or '').rstrip('/')}/{filename}"

    # Upload to Blob (required for ingestion)
    blob_error = None
    try:
        from api.services import azure_blob_service as blob_svc
        blob_svc.upload_bytes(blob_path, data)
    except Exception as exc:
        blob_error = str(exc)

    # Upload to AFS (optional — graceful if not configured)
    try:
        from api.services import azure_file_service as afs
        afs.upload_file(afs_path, data)
    except Exception:
        pass

    file_row = AfsFile(
        folder_id=folder_id,
        filename=filename,
        blob_path=blob_path,
        afs_path=afs_path,
        file_size=len(data),
        mime_type=mime_type,
        status="Uploaded",
        uploaded_by=getattr(current_user, "username", None),
        kb_schema_id=folder.kb_schema_id,
    )
    db.add(file_row)
    db.commit()
    db.refresh(file_row)

    # Auto-extract if enabled and file is small enough
    max_bytes = settings.AUTO_EXTRACT_MAX_SIZE_MB * 1024 * 1024
    if settings.AUTO_EXTRACT_ENABLED and len(data) <= max_bytes and not blob_error:
        from api.services.blob_ingestion import extract_file
        background_tasks.add_task(extract_file, file_row.id, db)

    result = _file_dict(file_row)
    if blob_error:
        result["blob_warning"] = f"Blob upload failed: {blob_error}. File registered but extraction unavailable."
    return result


# ─────────────────────────────────────────────────────────────
# File management
# ─────────────────────────────────────────────────────────────

@router.get("/documents/files/{file_id}")
def get_file(file_id: int, db: Session = Depends(get_db)):
    f = db.query(AfsFile).filter_by(id=file_id).first()
    if not f:
        raise HTTPException(404, "File not found")
    return _file_dict(f)


@router.delete("/documents/files/{file_id}", dependencies=[Depends(require_non_viewer)])
def delete_file(file_id: int, db: Session = Depends(get_db)):
    f = db.query(AfsFile).filter_by(id=file_id).first()
    if not f:
        raise HTTPException(404, "File not found")

    # Delete KB entries derived from this file
    db.query(KnowledgeEntry).filter_by(source_file_id=file_id).delete(synchronize_session=False)

    # Delete from Blob
    try:
        from api.services import azure_blob_service as blob_svc
        if f.blob_path:
            blob_svc.delete_blob(f.blob_path)
    except Exception:
        pass

    # Delete from AFS
    try:
        from api.services import azure_file_service as afs
        if f.afs_path:
            afs.delete_file(f.afs_path)
    except Exception:
        pass

    db.delete(f)
    db.commit()
    return {"deleted": True}


@router.get("/documents/files/{file_id}/entries")
def get_file_entries(file_id: int, db: Session = Depends(get_db)):
    entries = db.query(KnowledgeEntry).filter_by(source_file_id=file_id).all()
    return [
        {
            "id": e.id,
            "title": e.title,
            "type": e.type,
            "system": e.system,
            "summary": e.summary,
            "mapping_confidence": e.mapping_confidence,
            "status": e.status,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in entries
    ]


# ─────────────────────────────────────────────────────────────
# Extraction endpoints
# ─────────────────────────────────────────────────────────────

def _trigger_extract(file_id: int, db: Session) -> None:
    """Background task wrapper — marks file PendingExtraction then runs."""
    f = db.query(AfsFile).filter_by(id=file_id).first()
    if f and f.status not in ("Processing",):
        f.status = "PendingExtraction"
        try:
            db.commit()
        except Exception:
            db.rollback()
    from api.services.blob_ingestion import extract_file
    extract_file(file_id, db)


@router.post("/documents/files/{file_id}/extract", dependencies=[Depends(require_non_viewer)])
def extract_single(file_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    f = db.query(AfsFile).filter_by(id=file_id).first()
    if not f:
        raise HTTPException(404, "File not found")
    if f.status == "Processing":
        return {"queued": False, "message": "Already processing"}
    f.status = "PendingExtraction"
    db.commit()
    background_tasks.add_task(_trigger_extract, file_id, db)
    return {"queued": True, "file_id": file_id}


@router.post("/documents/files/extract-batch", dependencies=[Depends(require_non_viewer)])
def extract_batch(body: ExtractBatchBody, background_tasks: BackgroundTasks,
                  db: Session = Depends(get_db)):
    queued = []
    for fid in body.file_ids:
        f = db.query(AfsFile).filter_by(id=fid).first()
        if f and f.status != "Processing":
            f.status = "PendingExtraction"
            queued.append(fid)
    db.commit()
    for fid in queued:
        background_tasks.add_task(_trigger_extract, fid, db)
    return {"queued": len(queued), "file_ids": queued}


@router.post("/documents/folders/{folder_id}/extract", dependencies=[Depends(require_non_viewer)])
def extract_folder(folder_id: int, background_tasks: BackgroundTasks,
                   db: Session = Depends(get_db)):
    folder = db.query(AfsFolder).filter_by(id=folder_id).first()
    if not folder:
        raise HTTPException(404, "Folder not found")
    files = db.query(AfsFile).filter_by(folder_id=folder_id).all()
    queued = []
    for f in files:
        if f.status != "Processing":
            f.status = "PendingExtraction"
            queued.append(f.id)
    db.commit()
    for fid in queued:
        background_tasks.add_task(_trigger_extract, fid, db)
    return {"queued": len(queued), "folder_id": folder_id}


@router.post("/documents/extract-by-process", dependencies=[Depends(require_non_viewer)])
def extract_by_process(body: ExtractByProcessBody, background_tasks: BackgroundTasks,
                       db: Session = Depends(get_db)):
    folders = db.query(AfsFolder).filter(
        AfsFolder.process_name.ilike(f"%{body.process_name}%")
    ).all()
    if not folders:
        return {"queued": 0, "message": f"No folders found for process '{body.process_name}'"}

    folder_ids = [f.id for f in folders]
    files = db.query(AfsFile).filter(AfsFile.folder_id.in_(folder_ids)).all()
    queued = []
    for f in files:
        if f.status != "Processing":
            f.status = "PendingExtraction"
            queued.append(f.id)
    db.commit()
    for fid in queued:
        background_tasks.add_task(_trigger_extract, fid, db)
    return {"queued": len(queued), "process_name": body.process_name, "folders": len(folders)}
