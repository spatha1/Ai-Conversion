"""
sql_guard.py — Read-only SQL validation.

Blocks any non-SELECT statement before execution.
Used in report_ai.py and mapping_ai.py to prevent accidental or injected mutations.
"""
import re

_BLOCKED = re.compile(
    r'\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXEC|EXECUTE|GRANT|REVOKE'
    r'|MERGE|REPLACE|CALL|INTO)\b',
    re.IGNORECASE,
)

# Comment strippers (to avoid false positives in inline comments)
_LINE_COMMENT  = re.compile(r'--[^\n]*')
_BLOCK_COMMENT = re.compile(r'/\*.*?\*/', re.DOTALL)


def _strip_comments(sql: str) -> str:
    sql = _BLOCK_COMMENT.sub(' ', sql)
    sql = _LINE_COMMENT.sub(' ', sql)
    return sql


def validate_readonly(sql: str) -> None:
    """
    Raises ValueError if the SQL is not a pure SELECT statement.

    Two-layer check:
      1. Keyword blocklist on comment-stripped text
      2. First meaningful token must be SELECT or WITH (for CTEs)
    """
    stripped = _strip_comments(sql).strip().lstrip(';').strip()

    if _BLOCKED.search(stripped):
        match = _BLOCKED.search(stripped)
        raise ValueError(
            f"Non-SELECT SQL blocked by safety guard (found '{match.group()}')."
        )

    # First meaningful word must be SELECT or WITH (CTE)
    first_token = stripped.split()[0].upper() if stripped.split() else ""
    if first_token not in ("SELECT", "WITH"):
        raise ValueError(
            f"SQL must begin with SELECT or WITH (CTE). Got '{first_token}'."
        )
