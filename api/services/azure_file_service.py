"""
azure_file_service.py — thin wrapper around azure-storage-file-share.
Used by the Documents feature to store files in Azure File Share with a
structured folder hierarchy (e.g. /PolicyAttach/SQL/file.sql).
"""
from __future__ import annotations

from fastapi import HTTPException

from api.config import settings


def _client():
    if not settings.AZURE_FILES_CONN_STR.strip():
        raise HTTPException(
            status_code=503,
            detail="Azure File Share is not configured. Set AZURE_FILES_CONN_STR in .env.",
        )
    from azure.storage.fileshare import ShareServiceClient
    return ShareServiceClient.from_connection_string(settings.AZURE_FILES_CONN_STR)


def _share_client():
    return _client().get_share_client(settings.AZURE_FILES_SHARE_NAME)


def _ensure_share() -> None:
    try:
        _share_client().create_share()
    except Exception:
        pass  # already exists


def ensure_directory(afs_path: str) -> None:
    """Create directory (and all parents) in AFS. afs_path like '/PolicyAttach/SQL'."""
    _ensure_share()
    share = _share_client()
    parts = [p for p in afs_path.strip("/").split("/") if p]
    current = ""
    for part in parts:
        current = f"{current}/{part}" if current else part
        try:
            share.get_directory_client(current).create_directory()
        except Exception:
            pass  # already exists


def upload_file(afs_path: str, data: bytes, overwrite: bool = True) -> None:
    """Upload bytes to AFS. afs_path like '/PolicyAttach/SQL/policyattach.sql'."""
    _ensure_share()
    share = _share_client()
    # Ensure parent directory exists
    path_parts = afs_path.strip("/").split("/")
    if len(path_parts) > 1:
        parent = "/".join(path_parts[:-1])
        ensure_directory(parent)
    filename = path_parts[-1]
    directory = "/".join(path_parts[:-1]) if len(path_parts) > 1 else ""
    if directory:
        file_client = share.get_directory_client(directory).get_file_client(filename)
    else:
        file_client = share.get_file_client(filename)
    file_client.upload_file(data)


def download_file(afs_path: str) -> bytes:
    """Download file from AFS as bytes."""
    share = _share_client()
    path_parts = afs_path.strip("/").split("/")
    filename = path_parts[-1]
    directory = "/".join(path_parts[:-1]) if len(path_parts) > 1 else ""
    if directory:
        file_client = share.get_directory_client(directory).get_file_client(filename)
    else:
        file_client = share.get_file_client(filename)
    stream = file_client.download_file()
    return stream.readall()


def list_directory(afs_path: str) -> list[dict]:
    """List contents of an AFS directory. Returns list of {name, type, size}."""
    share = _share_client()
    dir_path = afs_path.strip("/")
    if dir_path:
        dir_client = share.get_directory_client(dir_path)
    else:
        dir_client = share.get_directory_client("")
    result = []
    try:
        for item in dir_client.list_directories_and_files():
            result.append({
                "name": item["name"],
                "type": "directory" if item.get("is_directory") else "file",
                "size": item.get("size"),
            })
    except Exception:
        pass
    return result


def delete_file(afs_path: str) -> None:
    """Delete a file from AFS (no-op if not found)."""
    try:
        share = _share_client()
        path_parts = afs_path.strip("/").split("/")
        filename = path_parts[-1]
        directory = "/".join(path_parts[:-1]) if len(path_parts) > 1 else ""
        if directory:
            file_client = share.get_directory_client(directory).get_file_client(filename)
        else:
            file_client = share.get_file_client(filename)
        file_client.delete_file()
    except Exception:
        pass


def delete_directory(afs_path: str) -> None:
    """Recursively delete a directory from AFS (no-op if not found)."""
    try:
        share = _share_client()
        dir_path = afs_path.strip("/")
        if dir_path:
            share.get_directory_client(dir_path).delete_directory()
    except Exception:
        pass
