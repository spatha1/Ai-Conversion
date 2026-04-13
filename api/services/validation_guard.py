"""
api/services/validation_guard.py

Pre-execution validation layer. Call before running any SQL, sending XML,
or dispatching to an API endpoint.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse


# ── Result ─────────────────────────────────────────────────────

@dataclass
class ValidationResult:
    passed: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def fail(self, msg: str) -> None:
        self.passed = False
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)


# ── SQL Safety Guard ───────────────────────────────────────────

# Destructive patterns — these block execution
_BLOCKED_PATTERNS = [
    (r"\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW|INDEX|PROCEDURE|FUNCTION)\b", "DROP statement is not allowed"),
    (r"\bTRUNCATE\s+TABLE\b", "TRUNCATE TABLE is not allowed"),
    (r"\bDELETE\s+FROM\b(?!.*\bWHERE\b)", "DELETE without WHERE clause is not allowed"),
    (r"\bALTER\s+TABLE\b", "ALTER TABLE is not allowed"),
    (r"\bCREATE\s+TABLE\b", "CREATE TABLE is not allowed in query context"),
    (r"\bINSERT\s+INTO\s+(?:sys\.|information_schema\.)\w+", "INSERT into system tables is not allowed"),
    (r"\bEXEC(?:UTE)?\s*\(", "Dynamic EXEC() is not allowed"),
    (r"\bxp_cmdshell\b", "xp_cmdshell is not allowed"),
    (r"\bsp_configure\b", "sp_configure is not allowed"),
    (r"\bOPENROWSET\b", "OPENROWSET is not allowed"),
    (r"\bBULK\s+INSERT\b", "BULK INSERT is not allowed"),
]

# Patterns that warn but don't block
_WARN_PATTERNS = [
    (r"\bSELECT\s+\*\s+FROM\b(?!.*\bWHERE\b)", "SELECT * without WHERE may return large datasets"),
    (r"\bFROM\s+\w+\b(?!.*(?:WHERE|JOIN|LIMIT|TOP))", "Query has no WHERE clause — may scan full table"),
]


def validate_sql_safety(sql: str) -> ValidationResult:
    """
    Check SQL for dangerous/destructive patterns.
    Returns ValidationResult with passed=False if any blocked pattern is found.
    """
    result = ValidationResult()
    if not sql or not sql.strip():
        result.fail("SQL is empty")
        return result

    sql_upper = sql.upper()

    for pattern, message in _BLOCKED_PATTERNS:
        if re.search(pattern, sql_upper, re.IGNORECASE | re.DOTALL):
            result.fail(message)

    for pattern, message in _WARN_PATTERNS:
        if re.search(pattern, sql_upper, re.IGNORECASE | re.DOTALL):
            result.warn(message)

    return result


def validate_sql_schema(sql: str, context) -> ValidationResult:
    """
    Check that tables referenced in SQL exist in the schema catalog.
    context: ContextPayload from context_cache
    """
    result = ValidationResult()
    if not sql or not context or not context.tables:
        return result  # no catalog = skip (not an error)

    known_tables = {t["table"].upper() for t in context.tables}

    # Extract table names from FROM and JOIN clauses
    table_pattern = r'(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)'
    matches = re.findall(table_pattern, sql, re.IGNORECASE)

    for match in matches:
        # Handle schema-qualified names: schema.table → take the table part
        parts = match.split(".")
        table_name = parts[-1].upper()

        # Skip SQL Server system tables/aliases
        if table_name in ("SYS", "INFORMATION_SCHEMA", "DUAL", "#TEMP"):
            continue

        if table_name not in known_tables:
            result.warn(f"Table '{match}' not found in schema catalog — may cause runtime error")

    return result


# ── XML Payload Guard ──────────────────────────────────────────

def validate_xml_payload(xml_content: str, rules: list) -> ValidationResult:
    """
    Validate XML against stored XSD rules.
    Wraps xsd_builder logic; returns structured ValidationResult.
    """
    result = ValidationResult()
    if not xml_content:
        result.fail("XML content is empty")
        return result

    try:
        from api.services.xsd_builder import validate_xml_against_rules
        errors = validate_xml_against_rules(xml_content, rules)
        for e in errors:
            result.fail(e)
    except ImportError:
        # xsd_builder validation not available — skip
        pass
    except Exception as exc:
        result.warn(f"XML validation error: {exc}")

    return result


# ── API Config Guard ───────────────────────────────────────────

_VALID_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


def validate_api_config(
    url: str,
    method: str,
    headers: Optional[dict] = None,
    auth_type: str = "none",
) -> ValidationResult:
    """
    Validate API dispatch configuration before sending.
    """
    result = ValidationResult()
    headers = headers or {}

    # URL format
    if not url or not url.strip():
        result.fail("Endpoint URL is required")
    else:
        try:
            parsed = urlparse(url.strip())
            if parsed.scheme not in ("http", "https"):
                result.fail(f"URL must use http:// or https:// (got '{parsed.scheme}://')")
            if not parsed.netloc:
                result.fail("URL is missing a host/domain")
        except Exception:
            result.fail(f"URL is invalid: {url}")

    # HTTP method
    if not method or method.upper() not in _VALID_METHODS:
        result.fail(f"HTTP method must be one of {', '.join(_VALID_METHODS)}")

    # Auth completeness check
    if auth_type and auth_type != "none":
        has_auth_header = any(
            k.lower() in ("authorization", "x-api-key", "api-key")
            for k in headers.keys()
        )
        if not has_auth_header:
            result.warn(
                f"auth_type is '{auth_type}' but no Authorization/API-Key header is configured"
            )

    return result
