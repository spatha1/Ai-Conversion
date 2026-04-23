"""
api/services/dialect_utils.py

Central dialect helpers for all SQL generation, quoting, and prompt rules.
Import from here — do not duplicate these across routers or services.

Supported dialects: mssql, postgresql, mysql, snowflake, sqlite
"""
from __future__ import annotations

import re
from typing import Optional

# ── Dialect normalisation ────────────────────────────────────────────────────

_MSSQL_ALIASES   = {"mssql", "sqlserver", "sql server", "sql_server", "microsoftsqlserver"}
_PG_ALIASES      = {"postgresql", "postgres"}
_MYSQL_ALIASES   = {"mysql"}
_SNOWFLAKE_ALIAS = {"snowflake"}
_SQLITE_ALIASES  = {"sqlite", "sqlite3"}


def normalize_dialect(
    dialect: Optional[str],
    source_type: Optional[str] = None,
) -> str:
    """Return a canonical dialect string from raw ORM values.

    source_type=="snowflake" always wins, regardless of the dialect field.
    Defaults to "mssql" when nothing matches.
    """
    if source_type and source_type.lower() == "snowflake":
        return "snowflake"
    _d = (dialect or "").lower().strip()
    if _d in _MSSQL_ALIASES:
        return "mssql"
    if _d in _PG_ALIASES:
        return "postgresql"
    if _d in _MYSQL_ALIASES:
        return "mysql"
    if _d in _SNOWFLAKE_ALIAS:
        return "snowflake"
    if _d in _SQLITE_ALIASES:
        return "sqlite"
    return "mssql"  # safe legacy default


def get_dialect(conn_id: int, db) -> str:  # db: Session — avoid hard import cycle
    """Load SourceConnection and return its normalised dialect string."""
    try:
        from api.models import SourceConnection
        conn = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
        if conn:
            return normalize_dialect(conn.dialect, conn.source_type)
    except Exception:
        pass
    return "mssql"


# ── Dialect label + LLM rules ────────────────────────────────────────────────

def dialect_label_rules(dialect: str) -> tuple[str, str]:
    """Return (human_label, sql_rules_string) for the given normalised dialect.

    Rules are injected into LLM prompts. The rules string intentionally
    includes a line instructing the model to translate any query examples
    in the context to the current dialect rather than treating them as
    syntax authority.
    """
    _d = normalize_dialect(dialect)

    _translate_note = (
        "- If query examples in the schema context use a different SQL dialect, "
        "treat them as intent/style reference only — translate their syntax to "
        "the rules above."
    )

    if _d == "mssql":
        return (
            "Microsoft SQL Server / T-SQL",
            "T-SQL rules — follow exactly:\n"
            "- Use TOP N not LIMIT N\n"
            "- Use GETDATE() not CURRENT_DATE or NOW()\n"
            "- Use CAST('9999-12-31' AS DATE) for sentinel dates\n"
            "- Use 1/0 for booleans (not TRUE/FALSE)\n"
            "- Use DATEADD(day, -1, GETDATE()) not INTERVAL syntax\n"
            "- Use MERGE … WHEN MATCHED / WHEN NOT MATCHED instead of ON CONFLICT\n"
            "- Wrap reserved-word aliases in square brackets: AS [Count], AS [Name]\n"
            "- Use BEGIN TRANSACTION / COMMIT TRANSACTION\n"
            + _translate_note,
        )

    if _d == "postgresql":
        return (
            "PostgreSQL",
            "PostgreSQL rules:\n"
            "- Use LIMIT N (not TOP N)\n"
            "- Use CURRENT_DATE, NOW()\n"
            "- Use TRUE/FALSE for booleans\n"
            "- Use ON CONFLICT DO UPDATE for upserts\n"
            "- Use INTERVAL '1 day' syntax\n"
            "- Quote identifiers with double quotes when needed\n"
            + _translate_note,
        )

    if _d == "mysql":
        return (
            "MySQL",
            "MySQL rules:\n"
            "- Use LIMIT N (not TOP N)\n"
            "- Use NOW(), CURDATE()\n"
            "- Use 1/0 for booleans or TINYINT(1)\n"
            "- Use INSERT … ON DUPLICATE KEY UPDATE for upserts\n"
            "- Use DATE_SUB(NOW(), INTERVAL 1 DAY)\n"
            "- Quote identifiers with backticks\n"
            + _translate_note,
        )

    if _d == "snowflake":
        return (
            "Snowflake",
            "Snowflake rules:\n"
            "- Use LIMIT N (not TOP N)\n"
            "- Use CURRENT_DATE, CURRENT_TIMESTAMP\n"
            "- Use TRUE/FALSE for booleans\n"
            "- Use MERGE INTO … WHEN MATCHED / WHEN NOT MATCHED for upserts\n"
            "- Quote identifiers with double quotes (case-sensitive when quoted)\n"
            "- Use DATEADD(day, -1, CURRENT_DATE) for date arithmetic\n"
            + _translate_note,
        )

    if _d == "sqlite":
        return (
            "SQLite",
            "SQLite rules:\n"
            "- Use LIMIT N (not TOP N)\n"
            "- Use DATE('now') for current date, DATETIME('now') for timestamp\n"
            "- Use 1/0 for booleans\n"
            "- No schema prefix — tables are accessed directly by name\n"
            "- No MERGE statement — use INSERT OR REPLACE or INSERT OR IGNORE\n"
            + _translate_note,
        )

    return dialect.upper(), f"Use {dialect.upper()} SQL syntax.\n" + _translate_note


# ── Identifier quoting ───────────────────────────────────────────────────────

def quote_identifier(name: str, dialect: str) -> str:
    """Quote a single identifier (table or column name) for the given dialect.

    MSSQL          → [name]
    MySQL          → `name`   (backticks; double quotes require ANSI_QUOTES)
    PostgreSQL /
    Snowflake /
    SQLite         → "name"
    """
    _d = normalize_dialect(dialect)
    if _d == "mssql":
        return f"[{name}]"
    if _d == "mysql":
        return f"`{name}`"
    # postgresql, snowflake, sqlite
    return f'"{name}"'


def escape_alias(alias: str, dialect: str) -> str:
    """Quote an alias string (e.g. XML path) for the given dialect, escaping inner chars.

    Use this for column aliases that may contain slashes, dots, or quote chars.
    """
    _d = normalize_dialect(dialect)
    if _d == "mssql":
        return f"[{alias.replace(']', ']]')}]"
    if _d == "mysql":
        return f"`{alias.replace('`', '``')}`"
    # postgresql, snowflake, sqlite
    return f'"{alias.replace(chr(34), chr(34) * 2)}"'


# ── Schema-qualified table names ─────────────────────────────────────────────

def qualified_name(schema: Optional[str], table: str, dialect: str) -> str:
    """Return a schema-qualified table reference for the given dialect.

    MySQL: schema maps to a database name — rendered as `schema`.`table`.
           If schema is empty/None, renders as `table` only.
    MSSQL: [schema].[table] (defaults schema to "dbo" when empty)
    PostgreSQL / Snowflake / SQLite: "schema"."table" or just "table" when no schema.
    """
    _d = normalize_dialect(dialect)
    qi = quote_identifier

    if _d == "mssql":
        _s = schema or "dbo"
        return f"{qi(_s, _d)}.{qi(table, _d)}"

    if _d == "mysql":
        if schema:
            return f"{qi(schema, _d)}.{qi(table, _d)}"
        return qi(table, _d)

    # postgresql, snowflake, sqlite
    if schema:
        return f"{qi(schema, _d)}.{qi(table, _d)}"
    return qi(table, _d)


def column_ref(alias_or_table: str, column: str, dialect: str) -> str:
    """Return alias_or_table.quoted_column.

    The alias/table prefix is NOT quoted — it is assumed to be a safe
    short alias like "t0", "_src", or a plain table name from the query.
    Only the column name is quoted for the target dialect.
    """
    return f"{alias_or_table}.{quote_identifier(column, dialect)}"


# ── Row-limit wrapping ───────────────────────────────────────────────────────

_TRAILING_ORDER_BY = re.compile(r"\bORDER\s+BY\b[^;]*$", re.IGNORECASE | re.DOTALL)
_TRAILING_SEMI     = re.compile(r";+\s*$")


def limit_query(sql: str, n: int, dialect: str) -> str:
    """Wrap *sql* in an outer SELECT that caps rows to *n*.

    This function is intended for preview/probe queries only — it strips
    trailing ORDER BY before wrapping for MSSQL (SQL Server rejects ORDER BY
    inside a derived table unless paired with TOP/OFFSET).  Do NOT use this
    for user-visible ordered result sets.

    Strategy (outer-wrap to avoid fragile token insertion):
      MSSQL:              SELECT TOP {n} * FROM ({inner}) AS _src
      others:             SELECT * FROM ({inner}) AS _src LIMIT {n}
    """
    _d = normalize_dialect(dialect)
    inner = _TRAILING_SEMI.sub("", sql).strip()

    if _d == "mssql":
        inner_no_order = _TRAILING_ORDER_BY.sub("", inner).strip()
        return f"SELECT TOP {n} * FROM ({inner_no_order}) AS _src"

    return f"SELECT * FROM ({inner}) AS _src LIMIT {n}"
