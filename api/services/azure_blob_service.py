"""
azure_blob_service.py — thin wrapper around azure-storage-blob.
Connection string is read from DB (Admin → Integrations) first, then falls back to .env.
"""
from __future__ import annotations

import time
from typing import Optional

from fastapi import HTTPException
from api.config import settings

DOCS_CONTAINER = "conversion-documents"

# Simple 30-second cache so every request doesn't hit the DB
_cache: dict = {}
_cache_ts: float = 0.0
_CACHE_TTL = 30.0


def _bust_cache() -> None:
    global _cache_ts
    _cache_ts = 0.0


def _db_cfg() -> dict:
    """Return {AZURE_STORAGE_CONN_STR, AZURE_STORAGE_CONTAINER} from DB, cached 30s."""
    global _cache, _cache_ts
    now = time.monotonic()
    if now - _cache_ts < _CACHE_TTL:
        return _cache
    result: dict = {}
    try:
        from api.database import SessionLocal
        from api.models import SystemConfig
        db = SessionLocal()
        try:
            for row in db.query(SystemConfig).filter(
                SystemConfig.key.in_(["AZURE_STORAGE_CONN_STR", "AZURE_STORAGE_CONTAINER"])
            ).all():
                if row.value:
                    result[row.key] = row.value
        finally:
            db.close()
    except Exception:
        pass
    _cache = result
    _cache_ts = now
    return result


def _conn_str() -> str:
    cfg = _db_cfg()
    return cfg.get("AZURE_STORAGE_CONN_STR") or settings.AZURE_STORAGE_CONN_STR or ""


def _container_name() -> str:
    cfg = _db_cfg()
    return cfg.get("AZURE_STORAGE_CONTAINER") or settings.AZURE_STORAGE_CONTAINER or DOCS_CONTAINER


def _client():
    cs = _conn_str().strip()
    if not cs:
        raise HTTPException(
            status_code=503,
            detail="Azure Blob Storage is not configured. Set it in Admin → Integrations → Azure Storage.",
        )
    from azure.storage.blob import BlobServiceClient
    return BlobServiceClient.from_connection_string(cs)


def _ensure_container(client, container: str) -> None:
    try:
        client.create_container(container)
    except Exception:
        pass  # already exists


def upload_bytes(blob_path: str, data: bytes, container: Optional[str] = None) -> str:
    c = container or _container_name()
    client = _client()
    _ensure_container(client, c)
    blob = client.get_blob_client(container=c, blob=blob_path)
    blob.upload_blob(data, overwrite=True)
    return blob.url


def download_bytes(blob_path: str, container: Optional[str] = None) -> bytes:
    c = container or _container_name()
    client = _client()
    blob = client.get_blob_client(container=c, blob=blob_path)
    return blob.download_blob().readall()


def list_blobs(prefix: str, container: Optional[str] = None) -> list[dict]:
    c = container or _container_name()
    client = _client()
    result = []
    try:
        for blob in client.get_container_client(c).list_blobs(name_starts_with=prefix):
            result.append({
                "name": blob.name,
                "size": blob.size,
                "last_modified": blob.last_modified.isoformat() if blob.last_modified else None,
            })
    except Exception:
        pass
    return result


def delete_blob(blob_path: str, container: Optional[str] = None) -> None:
    c = container or _container_name()
    client = _client()
    try:
        client.get_blob_client(container=c, blob=blob_path).delete_blob()
    except Exception:
        pass
