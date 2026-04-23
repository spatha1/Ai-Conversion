# ═══════════════════════════════════════════════════════════
# services/connector.py
# Unified connector — dispatches by source_type:
#   "sql"       → SQLAlchemy (MSSQL / PostgreSQL / MySQL / SQLite)
#   "snowflake" → snowflake-connector-python
#   "file"      → not handled here (client-side SheetJS / server upload)
# ═══════════════════════════════════════════════════════════
from __future__ import annotations
from typing import Any

# Supported server-side source types
_SQL_TYPES       = {"sql", "mssql", "postgresql", "mysql", "sqlite"}
_SNOWFLAKE_TYPES = {"snowflake"}


def _dispatch(source_type: str) -> str:
    """Return canonical backend name or raise for unsupported types."""
    st = (source_type or "").lower().strip()
    if st in _SNOWFLAKE_TYPES:
        return "snowflake"
    if st in _SQL_TYPES or st == "":   # legacy default
        return "sql"
    raise ValueError(
        f"Unsupported source_type '{source_type}'. "
        f"Supported: {sorted(_SQL_TYPES | _SNOWFLAKE_TYPES)}"
    )


# ── Public entry points ──────────────────────────────────────

def test_connection(cfg: dict) -> dict:
    """
    cfg keys: source_type, + dialect/host/… or sf_account/…
    Returns {"success": bool, "message": str}
    """
    try:
        backend = _dispatch(cfg.get("source_type", "sql"))
        if backend == "snowflake":
            return _test_snowflake(cfg)
        return _test_sql(cfg)
    except Exception as exc:
        return {"success": False, "message": _clean_error(exc)}


def preview_data(cfg: dict, limit: int = 200) -> dict:
    """
    Returns {"columns": [...], "rows": [...], "total": int, "sheet_alias": str}
    """
    try:
        backend = _dispatch(cfg.get("source_type", "sql"))
        if backend == "snowflake":
            return _preview_snowflake(cfg, limit)
        return _preview_sql(cfg, limit)
    except Exception as exc:
        raise RuntimeError(_clean_error(exc)) from exc


def fetch_all_data(cfg: dict) -> dict:
    """
    Fetch the full result set with no row limit.
    Called internally by the run engine — never exposed as an HTTP endpoint.
    Returns {"columns": [...], "rows": [...], "total": int, "sheet_alias": str}
    """
    try:
        backend = _dispatch(cfg.get("source_type", "sql"))
        if backend == "snowflake":
            return _preview_snowflake(cfg, limit=None)
        return _preview_sql(cfg, limit=None)
    except Exception as exc:
        raise RuntimeError(_clean_error(exc)) from exc


def execute_write(cfg: dict, sql: str) -> dict:
    """
    Execute a DML statement (INSERT/UPDATE/DELETE) against the source connection.
    Returns {"success": True, "rowcount": N} or {"success": False, "error": "..."}.
    Used by PS agent demo endpoints — never exposed directly as an HTTP endpoint.
    """
    try:
        from sqlalchemy import text
        engine = _build_sql_engine(cfg)
        with engine.begin() as conn:   # begin() auto-commits on exit
            result = conn.execute(text(sql))
            return {"success": True, "rowcount": result.rowcount}
    except Exception as exc:
        return {"success": False, "error": _clean_error(exc)}


# ══════════════════════════════════════════════════════════════
# SQL (pyodbc / SQLAlchemy)
# ══════════════════════════════════════════════════════════════

def _build_sql_engine(cfg: dict):
    """Build a SQLAlchemy engine from the connection config dict."""
    from sqlalchemy import create_engine

    dialect  = (cfg.get("dialect") or "mssql").lower()
    host     = cfg.get("host", "localhost")
    port     = cfg.get("port")
    database = cfg.get("database") or cfg.get("database_name", "")
    username = cfg.get("username", "")
    password = cfg.get("password", "")

    if dialect == "sqlite":
        return create_engine(f"sqlite:///{database}", connect_args={"check_same_thread": False})

    if dialect == "mssql":
        from api.config import settings
        from urllib.parse import quote_plus
        driver = cfg.get("driver", settings.DB_DRIVER)
        # Named instances (host contains '\') must NOT have port appended.
        # Express uses a dynamic port found via SQL Browser; adding ,port
        # bypasses Browser and causes "server not found" on the wrong port.
        server = host if (not port or "\\" in host) else f"{host},{port}"
        odbc = (
            f"DRIVER={{{driver}}};"
            f"SERVER={server};"
            f"DATABASE={database};"
            f"UID={username};"
            f"PWD={password};"
            f"TrustServerCertificate=yes;"
            f"Encrypt=no"
        )
        return create_engine(
            f"mssql+pyodbc:///?odbc_connect={quote_plus(odbc)}",
            pool_pre_ping=True,
        )

    if dialect == "postgresql":
        port_part = f":{port}" if port else ":5432"
        return create_engine(
            f"postgresql+psycopg2://{username}:{password}@{host}{port_part}/{database}",
            pool_pre_ping=True
        )

    if dialect == "mysql":
        port_part = f":{port}" if port else ":3306"
        return create_engine(
            f"mysql+pymysql://{username}:{password}@{host}{port_part}/{database}",
            pool_pre_ping=True
        )

    raise ValueError(f"Unsupported dialect: {dialect}")


def _test_sql(cfg: dict) -> dict:
    from sqlalchemy import text
    engine = _build_sql_engine(cfg)
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    db   = cfg.get("database") or cfg.get("database_name", "")
    host = cfg.get("host", "")
    return {"success": True, "message": f"Connected to {db} on {host}"}


def _preview_sql(cfg: dict, limit: int | None) -> dict:
    from sqlalchemy import text
    engine = _build_sql_engine(cfg)
    query  = _wrap_query(cfg.get("query", ""), limit, dialect=cfg.get("dialect", "mssql"))
    with engine.connect() as conn:
        result = conn.execute(text(query))
        columns = list(result.keys())
        rows    = [dict(zip(columns, row)) for row in result.fetchall()]
    return {
        "columns":     columns,
        "rows":        [_serialize_row(r) for r in rows],
        "total":       len(rows),
        "sheet_alias": cfg.get("sheet_alias", "Sheet1"),
    }


# ══════════════════════════════════════════════════════════════
# Snowflake
# ══════════════════════════════════════════════════════════════

def _build_sf_connection(cfg: dict):
    try:
        import snowflake.connector as sf
    except ImportError:
        raise RuntimeError(
            "snowflake-connector-python is not installed. "
            "Run: pip install snowflake-connector-python"
        )

    account   = cfg.get("account") or cfg.get("sf_account", "")
    warehouse = cfg.get("warehouse") or cfg.get("sf_warehouse", "")
    database  = cfg.get("database") or cfg.get("sf_database", "")
    schema    = cfg.get("schema") or cfg.get("sf_schema", "PUBLIC")
    role      = cfg.get("role") or cfg.get("sf_role", "")
    user      = cfg.get("username") or cfg.get("sf_username", "")
    password  = cfg.get("password") or cfg.get("sf_password", "")
    priv_key  = cfg.get("private_key") or cfg.get("sf_private_key", "")

    # Guard against silent decrypt failures — give an actionable message
    if not user:
        raise RuntimeError(
            "Snowflake username is missing. Re-open the connection in Source tab and re-save."
        )
    if not priv_key and not password:
        raise RuntimeError(
            "Snowflake password could not be retrieved (possible encryption key mismatch). "
            "Re-open the connection in Source tab, re-enter the password, and Save again."
        )

    conn_kwargs: dict[str, Any] = {
        "account":   account,
        "user":      user,
        "warehouse": warehouse,
        "database":  database,
        "schema":    schema,
    }
    if role:
        conn_kwargs["role"] = role

    if priv_key:
        from cryptography.hazmat.primitives.serialization import load_pem_private_key
        from cryptography.hazmat.backends import default_backend
        passphrase = cfg.get("sf_private_key_passphrase") or cfg.get("private_key_passphrase") or ""
        key_bytes  = priv_key.encode() if isinstance(priv_key, str) else priv_key
        pwd_bytes  = passphrase.encode() if passphrase else None
        private_key_obj = load_pem_private_key(key_bytes, password=pwd_bytes, backend=default_backend())
        conn_kwargs["private_key"] = private_key_obj
    else:
        conn_kwargs["password"] = password

    return sf.connect(**conn_kwargs)


def _test_snowflake(cfg: dict) -> dict:
    account = cfg.get("account") or cfg.get("sf_account", "")
    user    = cfg.get("username") or cfg.get("sf_username", "")
    try:
        conn = _build_sf_connection(cfg)
    except Exception as exc:
        raise RuntimeError(
            f"Snowflake auth failed (account={account}, user={user}): {exc}"
        ) from exc
    cur  = conn.cursor()
    cur.execute("SELECT CURRENT_VERSION()")
    version = cur.fetchone()[0]
    cur.close(); conn.close()
    return {"success": True, "message": f"Connected to Snowflake {account} (user: {user}) — version {version}"}


def _preview_snowflake(cfg: dict, limit: int | None) -> dict:
    conn  = _build_sf_connection(cfg)
    cur   = conn.cursor()
    query = _wrap_query(cfg.get("query", ""), limit, dialect="snowflake")
    cur.execute(query)
    columns = [desc[0] for desc in cur.description]
    rows    = [dict(zip(columns, row)) for row in cur.fetchall()]
    cur.close(); conn.close()
    return {
        "columns":     columns,
        "rows":        [_serialize_row(r) for r in rows],
        "total":       len(rows),
        "sheet_alias": cfg.get("sheet_alias", "Sheet1"),
    }


# ══════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════

def _wrap_query(query: str, limit: int | None, dialect: str = "mssql") -> str:
    """Add a row cap to a query using the correct syntax for the target dialect.

    Strategy per dialect:
      mssql      → inject TOP n right after the SELECT keyword (no subquery → avoids
                   "column specified multiple times" errors from JOINs with shared names)
      postgresql / mysql / sqlite → append LIMIT n at the end
      snowflake  → append LIMIT n at the end

    Pass limit=None to execute without any row cap.
    """
    import re as _re
    from api.services.dialect_utils import normalize_dialect
    _d = normalize_dialect(dialect)

    q = query.strip().rstrip(";")
    if not q:
        raise ValueError("Query is empty")

    # Bare table name (no spaces / SELECT keyword) — generate a simple SELECT
    if " " not in q and "\n" not in q:
        if limit is None:
            return f"SELECT * FROM {q}"
        if _d == "mssql":
            return f"SELECT TOP {limit} * FROM {q}"
        return f"SELECT * FROM {q} LIMIT {limit}"

    # Already a SELECT statement
    # Strip trailing ORDER BY — SQL Server forbids it in subqueries without TOP/OFFSET
    q_safe = _re.sub(r'\s+ORDER\s+BY\s+.+$', '', q, flags=_re.IGNORECASE | _re.DOTALL).strip()
    if limit is None:
        return q_safe

    lower = q_safe.lower()
    # Already has a row cap — return as-is
    if "top " in lower or "limit " in lower or "rownum" in lower or "fetch first" in lower:
        return q_safe

    if _d == "mssql":
        # Inject TOP n directly after SELECT — avoids subquery column-name conflicts
        return _re.sub(r'(?i)^(SELECT\s+(?:DISTINCT\s+)?)', f'SELECT TOP {limit} ', q_safe, count=1)
    # PostgreSQL, MySQL, SQLite, Snowflake — append LIMIT
    return f"{q_safe} LIMIT {limit}"


def _serialize_row(row: dict) -> dict:
    """Convert non-JSON-serialisable types to strings."""
    from datetime import date, datetime, time
    from decimal import Decimal
    result = {}
    for k, v in row.items():
        if isinstance(v, (datetime, date, time)):
            result[k] = str(v)
        elif isinstance(v, Decimal):
            result[k] = float(v)
        elif v is None:
            result[k] = ""
        else:
            result[k] = str(v) if not isinstance(v, (int, float, bool, str)) else v
    return result


def _clean_error(exc: Exception) -> str:
    """
    Return a short, human-readable error string.
    Strips SQLAlchemy boilerplate and pyodbc error codes, keeping
    only the descriptive sentence from the driver message.
    """
    import re
    raw = str(exc)

    # Drop SQLAlchemy footer
    raw = raw.split("\n(Background on this error")[0].strip()

    # Extract readable segments from ODBC bracket format:
    # [Microsoft][ODBC Driver 17 for SQL Server]<message>
    segments = re.findall(r'\][^\[;(]{5,}', raw)
    if segments:
        # Last segment is usually the most descriptive
        for seg in reversed(segments):
            clean = seg.lstrip('] \t').strip().rstrip('.')
            # Skip short or purely numeric fragments
            if len(clean) > 15 and not re.fullmatch(r'[\d\s\-]+', clean):
                return clean

    # Fallback: strip pyodbc class prefix "(pyodbc.OperationalError) ..."
    match = re.match(r'\([\w.]+\)\s+(.*)', raw, re.DOTALL)
    if match:
        return match.group(1)[:300].strip()

    return raw[:300]
