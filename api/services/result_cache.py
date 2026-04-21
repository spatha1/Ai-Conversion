"""
result_cache.py — In-memory TTL cache for SQL query results and insights.

Uses cachetools.TTLCache (5-minute TTL). Falls back gracefully if cachetools is unavailable.
"""
from __future__ import annotations

import hashlib

try:
    from cachetools import TTLCache
    _result_cache  = TTLCache(maxsize=200, ttl=300)
    _insight_cache = TTLCache(maxsize=200, ttl=300)
    _ENABLED = True
except ImportError:
    _result_cache  = {}
    _insight_cache = {}
    _ENABLED = False


def _key(sql: str, conn_id: int) -> str:
    return hashlib.sha256(f"{conn_id}:{sql}".encode()).hexdigest()


def get_result(sql: str, conn_id: int):
    if not _ENABLED:
        return None
    return _result_cache.get(_key(sql, conn_id))


def put_result(sql: str, conn_id: int, result) -> None:
    if not _ENABLED:
        return
    try:
        _result_cache[_key(sql, conn_id)] = result
    except Exception:
        pass


def get_insights(sql_hash: str):
    if not _ENABLED:
        return None
    return _insight_cache.get(sql_hash)


def put_insights(sql_hash: str, insights) -> None:
    if not _ENABLED:
        return
    try:
        _insight_cache[sql_hash] = insights
    except Exception:
        pass


def sql_hash(sql: str) -> str:
    return hashlib.sha256(sql.encode()).hexdigest()
