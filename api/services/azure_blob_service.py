"""
azure_blob_service.py — thin wrapper around azure-storage-blob.
Used by the Documents feature to mirror uploaded files into Blob Storage
for ingestion, versioning, and re-processing.

Container used: settings.AZURE_STORAGE_CONN_STR + container "conversion-documents"
(separate from the existing "conversion-output" container used by dispatch).
"""
from __future__ import annotations

from typing import Optional
from fastapi import HTTPException

from api.config import settings

DOCS_CONTAINER = "conversion-documents"


def _client():
    if not settings.AZURE_STORAGE_CONN_STR.strip():
        raise HTTPException(
            status_code=503,
            detail="Azure Blob Storage is not configured. Set AZURE_STORAGE_CONN_STR in .env.",
        )
    from azure.storage.blob import BlobServiceClient
    return BlobServiceClient.from_connection_string(settings.AZURE_STORAGE_CONN_STR)


def _ensure_container(client, container: str) -> None:
    try:
        client.create_container(container)
    except Exception:
        pass  # already exists


def upload_bytes(blob_path: str, data: bytes, container: Optional[str] = None) -> str:
    """Upload bytes to Blob Storage. Returns the full blob URL."""
    c = container or DOCS_CONTAINER
    client = _client()
    _ensure_container(client, c)
    blob = client.get_blob_client(container=c, blob=blob_path)
    blob.upload_blob(data, overwrite=True)
    return blob.url


def download_bytes(blob_path: str, container: Optional[str] = None) -> bytes:
    """Download blob content as bytes."""
    c = container or DOCS_CONTAINER
    client = _client()
    blob = client.get_blob_client(container=c, blob=blob_path)
    stream = blob.download_blob()
    return stream.readall()


def list_blobs(prefix: str, container: Optional[str] = None) -> list[dict]:
    """List blobs under a prefix. Returns list of {name, size, last_modified}."""
    c = container or DOCS_CONTAINER
    client = _client()
    container_client = client.get_container_client(c)
    result = []
    try:
        for blob in container_client.list_blobs(name_starts_with=prefix):
            result.append({
                "name": blob.name,
                "size": blob.size,
                "last_modified": blob.last_modified.isoformat() if blob.last_modified else None,
            })
    except Exception:
        pass
    return result


def delete_blob(blob_path: str, container: Optional[str] = None) -> None:
    """Delete a blob (no-op if it does not exist)."""
    c = container or DOCS_CONTAINER
    client = _client()
    try:
        blob = client.get_blob_client(container=c, blob=blob_path)
        blob.delete_blob()
    except Exception:
        pass
