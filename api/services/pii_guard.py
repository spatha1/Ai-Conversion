# ═══════════════════════════════════════════════════════════
# services/pii_guard.py
# PII detection and masking — prevents sensitive data from
# reaching LLM prompts (OpenAI API calls).
#
# Used by:
#   - services/query_skill.py   (sample values in skill prompt)
#   - services/embeddings.py    (build_column_definition sample values)
#
# Strategy:
#   1. Field-name heuristics: if the column name looks like a
#      PII field, mask the value regardless of content.
#   2. Content pattern matching: regex scan for common PII
#      patterns (SSN, email, phone, credit card, etc.).
#   3. Return a safe placeholder string instead of the real value.
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

import re

# ── Field-name keywords that indicate PII ────────────────────
# Any column whose name contains one of these (case-insensitive)
# will have its value masked, regardless of content.
_PII_FIELD_KEYWORDS: tuple[str, ...] = (
    "password", "passwd", "pwd", "secret", "token", "api_key", "apikey",
    "ssn", "sin", "national_id", "tax_id", "ein", "itin",
    "dob", "date_of_birth", "birth_date", "birthdate",
    "email", "e_mail",
    "phone", "mobile", "cell", "fax",
    "credit_card", "cc_num", "card_number", "cvv", "cvc",
    "bank_account", "account_number", "routing_number", "iban",
    "license", "passport", "dl_number",
    "ip_address", "mac_address",
    "gender", "race", "ethnicity", "religion",
    "salary", "wage", "income", "compensation",
    "medical", "diagnosis", "prescription", "insurance_id",
)

# ── Content-level PII regex patterns ─────────────────────────
# Checked against the value string.
_PII_PATTERNS: list[tuple[str, re.Pattern]] = [
    # US Social Security Number: 123-45-6789 or 123456789
    ("SSN",         re.compile(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b")),
    # Email address
    ("email",       re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")),
    # US phone: (123) 456-7890 / 123-456-7890 / +1-123-456-7890
    ("phone",       re.compile(r"(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b")),
    # Credit card: 16 digits optionally grouped by 4
    ("credit_card", re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b")),
    # IPv4 address
    ("ip_address",  re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    # ISO 8601 / common date of birth patterns
    ("date",        re.compile(r"\b\d{4}[-/]\d{2}[-/]\d{2}\b")),
    # Passwords (heuristic: long mixed alphanumeric strings often are)
    ("hash",        re.compile(r"\b[0-9a-fA-F]{32,}\b")),   # MD5 / SHA hashes
]

# Placeholder returned in place of a masked value
_MASK = "[REDACTED]"


def _field_is_pii(field_name: str) -> bool:
    """Return True if the column name suggests PII."""
    lower = field_name.lower()
    return any(kw in lower for kw in _PII_FIELD_KEYWORDS)


def _content_has_pii(value: str) -> tuple[bool, str]:
    """
    Scan value string for known PII patterns.
    Returns (found, pii_type_label).
    """
    for label, pattern in _PII_PATTERNS:
        if pattern.search(value):
            return True, label
    return False, ""


def mask_value(value: str, field_name: str = "") -> str:
    """
    Mask a single value before it is included in an LLM prompt.

    - If field_name is a known PII field → always mask.
    - If value content matches a PII pattern → mask.
    - Otherwise → return value unchanged (truncated to 80 chars).

    Args:
        value:      The sample value to check.
        field_name: The column name this value came from (optional).

    Returns:
        Either the original (safe) value or _MASK.
    """
    if not isinstance(value, str):
        value = str(value)

    if field_name and _field_is_pii(field_name):
        return _MASK

    found, _ = _content_has_pii(value)
    if found:
        return _MASK

    # Safe — return truncated copy
    return value[:80]


def mask_sample_row(row: dict) -> dict:
    """
    Mask all PII fields in a sample row dict.
    Returns a new dict with safe values.
    """
    return {k: mask_value(str(v) if v is not None else "", k) for k, v in row.items()}


def mask_sample_values(values: list, field_name: str = "") -> list[str]:
    """
    Mask a list of sample values for a single column.
    Returns a list of safe string values.
    """
    return [mask_value(str(v) if v is not None else "", field_name) for v in values]


# Field-value pattern — handles all formats:
#   "password is Abc123"        natural language
#   "pwd: Abc123"               config style
#   "DB_PASSWORD=Abc123"        env var (keyword embedded in longer name)
#   DB_PASSWORD="Abc123"        env var with quotes
# \w* before/after keyword allows prefixes like DB_, APP_, MY_
_FIELD_VALUE_PATTERN = re.compile(
    r'\b\w*(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|'
    r'ssn|sin|national[_-]?id|dob|date[_-]?of[_-]?birth|'
    r'credit[_-]?card|cvv|cvc|iban|bank[_-]?account)\w*'
    r'\s*(?:is|:|=|was|\?)\s*["\']?([^\s"\'\\,\n]+)["\']?',
    re.IGNORECASE,
)


def audit_prompt(prompt: str) -> str:
    """
    Last-pass scan: redact any remaining PII patterns found in the
    assembled prompt string.  This is a safety net — primary masking
    should happen before values are interpolated into the prompt.

    Handles both:
    - Bare PII tokens (SSN, email, credit card, phone)
    - Field-value phrases: "password is Abc123" → "password is [REDACTED]"
    """
    result = prompt

    # 1. Field-value inline masking — mask only the value, preserve the key name
    def _replace_value(m: re.Match) -> str:
        # Use group position offsets to avoid str.replace('', ...) corruption
        # when group(1) is empty or appears multiple times in group(0)
        g1_start = m.start(1) - m.start()
        g1_end   = m.end(1)   - m.start()
        if g1_start >= g1_end:
            return m.group(0)   # nothing to replace
        return m.group(0)[:g1_start] + _MASK + m.group(0)[g1_end:]

    result = _FIELD_VALUE_PATTERN.sub(_replace_value, result)

    # 2. Content-level patterns
    for _label, pattern in _PII_PATTERNS:
        result = pattern.sub(_MASK, result)

    return result
