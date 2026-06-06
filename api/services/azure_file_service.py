"""
azure_file_service.py — thin wrapper around azure-storage-file-share.
Connection string is read from DB (Admin → Integrations) first, then falls back to .env.
"""
from __future__ import annotations

import time
from fastapi import HTTPException
from api.config import settings

_cache: dict = {}
_cache_ts: float = 0.0
_CACHE_TTL = 30.0


def _bust_cache() -> None:
    global _cache_ts
    _cache_ts = 0.0


def _db_cfg() -> dict:
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
                SystemConfig.key.in_(["AZURE_FILES_CONN_STR", "AZURE_FILES_SHARE_NAME"])
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
    return cfg.get("AZURE_FILES_CONN_STR") or settings.AZURE_FILES_CONN_STR or ""


def _share_name() -> str:
    cfg = _db_cfg()
    return cfg.get("AZURE_FILES_SHARE_NAME") or settings.AZURE_FILES_SHARE_NAME or "conversion-documents"


def _client():
    cs = _conn_str().strip()
    if not cs:
        raise HTTPException(
            status_code=503,
            detail="Azure File Share is not configured. Set it in Admin → Integrations → Azure Storage.",
        )
    from azure.storage.fileshare import ShareServiceClient
    return ShareServiceClient.from_connection_string(cs)


def _share_client():
    return _client().get_share_client(_share_name())


def _ensure_share() -> None:
    try:
        _share_client().create_share()
    except Exception:
        pass


def ensure_directory(afs_path: str) -> None:
    _ensure_share()
    share = _share_client()
    parts = [p for p in afs_path.strip("/").split("/") if p]
    current = ""
    for part in parts:
        current = f"{current}/{part}" if current else part
        try:
            share.get_directory_client(current).create_directory()
        except Exception:
            pass


def upload_file(afs_path: str, data: bytes, overwrite: bool = True) -> None:
    _ensure_share()
    share = _share_client()
    path_parts = afs_path.strip("/").split("/")
    if len(path_parts) > 1:
        ensure_directory("/".join(path_parts[:-1]))
    filename = path_parts[-1]
    directory = "/".join(path_parts[:-1]) if len(path_parts) > 1 else ""
    fc = share.get_directory_client(directory).get_file_client(filename) if directory else share.get_file_client(filename)
    fc.upload_file(data)


def download_file(afs_path: str) -> bytes:
    share = _share_client()
    path_parts = afs_path.strip("/").split("/")
    filename = path_parts[-1]
    directory = "/".join(path_parts[:-1]) if len(path_parts) > 1 else ""
    fc = share.get_directory_client(directory).get_file_client(filename) if directory else share.get_file_client(filename)
    return fc.download_file().readall()


def list_directory(afs_path: str) -> list[dict]:
    share = _share_client()
    dir_path = afs_path.strip("/")
    dir_client = share.get_directory_client(dir_path) if dir_path else share.get_directory_client("")
    result = []
    try:
        for item in dir_client.list_directories_and_files():
            result.append({"name": item["name"], "type": "directory" if item.get("is_directory") else "file", "size": item.get("size")})
    except Exception:
        pass
    return result


def delete_file(afs_path: str) -> None:
    try:
        share = _share_client()
        path_parts = afs_path.strip("/").split("/")
        filename = path_parts[-1]
        directory = "/".join(path_parts[:-1]) if len(path_parts) > 1 else ""
        fc = share.get_directory_client(directory).get_file_client(filename) if directory else share.get_file_client(filename)
        fc.delete_file()
    except Exception:
        pass


def delete_directory(afs_path: str) -> None:
    try:
        share = _share_client()
        dir_path = afs_path.strip("/")
        if dir_path:
            share.get_directory_client(dir_path).delete_directory()
    except Exception:
        pass
