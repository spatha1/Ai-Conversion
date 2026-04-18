"""
value_mapper.py — Value mapping service for the agent-based conversion pipeline.

Handles legacy categorical code → business-meaningful value transformation.
Priority: manual override > rule-based (auto-approved) > AI-inferred (pending approval).

MappingContext is the single shared object passed from Mapper → Transformer → Validator
→ _fill_xml_from_row(), carrying SQL CASE expressions, Python lookup tables, join paths,
and field confidence scores.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from api.models import ConversionValueMapping, AITraceLog


# ─── MappingContext dataclass ─────────────────────────────────────────────────

@dataclass
class MappingContext:
    """
    Single source of truth for all mapping information across pipeline stages.
    Built by MapperAgent, consumed by TransformerAgent, ValidatorAgent, and _fill_xml_from_row().
    """
    sql_case_expressions: dict[str, str] = field(default_factory=dict)
    # xml_path → "-- [SOURCE:TABLE.COL]\nCASE t0.[COL] WHEN ..."

    python_lookups: dict[tuple, dict] = field(default_factory=dict)
    # (table_name, col_name) → {source_val: target_val}  — for mappings with >= 10 entries

    column_lineage: dict[str, str] = field(default_factory=dict)
    # xml_path → "table_name.column_name"

    join_paths: list[tuple] = field(default_factory=list)
    # BFS join path tuples from build_join_query()

    field_confidence: dict[str, float] = field(default_factory=dict)
    # xml_path → embedding similarity score (0.0–1.0)


# ─── Rule-based pattern library ──────────────────────────────────────────────

RULE_PATTERNS: list[tuple[frozenset, dict]] = [
    (frozenset({"A", "I"}),
     {"A": "Active", "I": "Inactive"}),
    (frozenset({"A", "I", "D"}),
     {"A": "Active", "I": "Inactive", "D": "Deleted"}),
    (frozenset({"A", "I", "D", "S"}),
     {"A": "Active", "I": "Inactive", "D": "Deleted", "S": "Suspended"}),
    (frozenset({"A", "I", "D", "S", "P"}),
     {"A": "Active", "I": "Inactive", "D": "Deleted", "S": "Suspended", "P": "Pending"}),
    (frozenset({"Y", "N"}),
     {"Y": "Yes", "N": "No"}),
    (frozenset({"0", "1"}),
     {"0": "Inactive", "1": "Active"}),
    (frozenset({"M", "F"}),
     {"M": "Male", "F": "Female"}),
    (frozenset({"T", "F"}),
     {"T": "True", "F": "False"}),
    (frozenset({"S", "P", "C"}),
     {"S": "Suspended", "P": "Pending", "C": "Closed"}),
    (frozenset({"TRUE", "FALSE"}),
     {"TRUE": "True", "FALSE": "False"}),
    (frozenset({"YES", "NO"}),
     {"YES": "Yes", "NO": "No"}),
    (frozenset({"ACTIVE", "INACTIVE"}),
     {"ACTIVE": "Active", "INACTIVE": "Inactive"}),
]


def _match_rule_pattern(distinct_values: list[str]) -> Optional[dict]:
    """Find a rule pattern that matches the given set of distinct values (case-insensitive)."""
    upper_vals = frozenset(v.upper().strip() for v in distinct_values if v)
    for pattern_set, mapping in RULE_PATTERNS:
        # Match if all values in the pattern are covered by the input
        if upper_vals and upper_vals.issubset(pattern_set):
            # Return original-case values mapped to targets
            result: dict[str, str] = {}
            for v in distinct_values:
                upper_v = v.upper().strip()
                if upper_v in mapping:
                    result[v] = mapping[upper_v]
            return result
    return None


# ─── Core functions ───────────────────────────────────────────────────────────

def suggest_mappings(
    conn_id: int,
    table_name: str,
    column_name: str,
    distinct_values: list[str],
    db: Session,
    openai_client=None,
) -> list[dict]:
    """
    Suggest value mappings for a categorical column.
    Priority: existing manual rows > rule-based > AI-inferred.
    Returns list of mapping dicts (not yet saved).
    """
    # Check for existing approved/manual rows — return them as-is
    existing = (
        db.query(ConversionValueMapping)
        .filter(
            ConversionValueMapping.conn_id == conn_id,
            ConversionValueMapping.table_name == table_name,
            ConversionValueMapping.column_name == column_name,
            ConversionValueMapping.status.in_(["approved", "manual"]),
        )
        .all()
    )
    if existing:
        return [_row_to_dict(r) for r in existing]

    # Try rule-based matching
    rule_match = _match_rule_pattern(distinct_values)
    if rule_match:
        results = []
        expires_at = datetime.utcnow() + timedelta(days=90)
        for src, tgt in rule_match.items():
            results.append({
                "conn_id": conn_id,
                "table_name": table_name,
                "column_name": column_name,
                "source_value": src,
                "target_value": tgt,
                "confidence": "1.0",
                "mapping_type": "rule",
                "status": "approved",
                "expires_at": expires_at,
            })
        return results

    # AI-inferred (only for small value sets, confidence >= 0.6)
    if openai_client and len(distinct_values) <= 20:
        try:
            prompt = (
                f'Column "{column_name}" in table "{table_name}" has these legacy code values: '
                f'{distinct_values}. '
                f'Return a JSON array of {{"source_value": "X", "target_value": "Human Label"}} '
                f'objects only. No explanation.'
            )
            resp = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_tokens=300,
            )
            raw = resp.choices[0].message.content.strip()
            # Log to AITraceLog for audit
            try:
                db.add(AITraceLog(
                    module="value_mapper",
                    conn_id=conn_id,
                    model="gpt-4o-mini",
                    prompt_text=prompt[:4000],
                    response_text=raw[:4000],
                    tokens_in=resp.usage.prompt_tokens if resp.usage else None,
                    tokens_out=resp.usage.completion_tokens if resp.usage else None,
                ))
                db.flush()
            except Exception:
                pass

            # Parse JSON response
            import re
            raw_clean = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("```").strip()
            parsed = json.loads(raw_clean)
            if isinstance(parsed, list):
                results = []
                expires_at = datetime.utcnow() + timedelta(days=90)
                for item in parsed:
                    if isinstance(item, dict) and "source_value" in item and "target_value" in item:
                        confidence = float(item.get("confidence", 0.8))
                        if confidence < 0.6:
                            continue
                        results.append({
                            "conn_id": conn_id,
                            "table_name": table_name,
                            "column_name": column_name,
                            "source_value": str(item["source_value"]),
                            "target_value": str(item["target_value"]),
                            "confidence": str(confidence),
                            "mapping_type": "ai",
                            "status": "pending",
                            "expires_at": expires_at,
                        })
                return results
        except Exception:
            pass

    return []


def save_mappings(
    conn_id: int,
    table_name: str,
    column_name: str,
    mappings: list[dict],
    db: Session,
) -> None:
    """
    Upsert mappings into ConversionValueMapping.
    Never overwrites manual or approved rows.
    """
    for m in mappings:
        existing = (
            db.query(ConversionValueMapping)
            .filter(
                ConversionValueMapping.conn_id == conn_id,
                ConversionValueMapping.table_name == table_name,
                ConversionValueMapping.column_name == column_name,
                ConversionValueMapping.source_value == m["source_value"],
            )
            .first()
        )
        if existing:
            # Never overwrite manual/approved entries
            if existing.status in ("approved", "manual"):
                continue
            existing.target_value = m.get("target_value")
            existing.confidence = m.get("confidence")
            existing.mapping_type = m.get("mapping_type", existing.mapping_type)
            existing.status = m.get("status", existing.status)
            existing.expires_at = m.get("expires_at")
        else:
            row = ConversionValueMapping(
                conn_id=conn_id,
                table_name=table_name,
                column_name=column_name,
                source_value=m["source_value"],
                target_value=m.get("target_value"),
                confidence=m.get("confidence"),
                mapping_type=m.get("mapping_type", "pending_review"),
                status=m.get("status", "pending"),
                expires_at=m.get("expires_at"),
            )
            db.add(row)
    db.commit()


def get_approved_mappings(
    conn_id: int,
    table_name: str,
    column_name: str,
    db: Session,
) -> list[ConversionValueMapping]:
    """Return only approved/manual mappings for a column (used by build_sql_expression)."""
    return (
        db.query(ConversionValueMapping)
        .filter(
            ConversionValueMapping.conn_id == conn_id,
            ConversionValueMapping.table_name == table_name,
            ConversionValueMapping.column_name == column_name,
            ConversionValueMapping.status.in_(["approved", "manual"]),
        )
        .all()
    )


def build_sql_expression(
    col_alias: str,
    table_name: str,
    column_name: str,
    mappings: list[ConversionValueMapping],
    dialect: str,
) -> Optional[str]:
    """
    Build a SQL transformation expression for a categorical column.
    - < 10 approved mappings → inline CASE statement with [SOURCE:] comment
    - >= 10 approved mappings → None (caller uses Python post-processing)

    Returns None if no approved mappings exist.
    """
    if not mappings:
        return None

    if len(mappings) >= 10:
        return None  # Use Python post-processing (python_lookups in MappingContext)

    if dialect in ("snowflake", "postgresql", "mysql"):
        q = '"'
    else:
        q = "["
        qe = "]"

    def _q(n: str) -> str:
        if dialect in ("snowflake", "postgresql", "mysql"):
            return f'"{n}"'
        return f"[{n}]"

    when_clauses = " ".join(
        f"WHEN {_q(col_alias)}.{_q(column_name)} = '{m.source_value}' THEN '{m.target_value}'"
        for m in mappings
        if m.target_value is not None
    )
    if not when_clauses:
        return None

    case_expr = f"CASE {when_clauses} ELSE {_q(col_alias)}.{_q(column_name)} END"
    # Add source traceability comment
    return f"-- [SOURCE:{table_name}.{column_name}]\n{case_expr}"


def build_python_lookup(mappings: list[ConversionValueMapping]) -> dict[str, str]:
    """Build a {source_value → target_value} dict for Python-level post-processing."""
    return {
        m.source_value: m.target_value
        for m in mappings
        if m.target_value is not None
    }


def get_all_python_lookups(conn_id: int, db: Session) -> dict[tuple, dict]:
    """
    Load all approved/manual mappings for a connection into a keyed dict.
    Returns {(table_name, column_name): {source_val: target_val}}
    """
    rows = (
        db.query(ConversionValueMapping)
        .filter(
            ConversionValueMapping.conn_id == conn_id,
            ConversionValueMapping.status.in_(["approved", "manual"]),
        )
        .all()
    )
    result: dict[tuple, dict] = {}
    for row in rows:
        key = (row.table_name, row.column_name)
        if key not in result:
            result[key] = {}
        if row.target_value is not None:
            result[key][row.source_value] = row.target_value
    return result


# ─── Helper ───────────────────────────────────────────────────────────────────

def _row_to_dict(r: ConversionValueMapping) -> dict:
    return {
        "conn_id": r.conn_id,
        "table_name": r.table_name,
        "column_name": r.column_name,
        "source_value": r.source_value,
        "target_value": r.target_value,
        "confidence": r.confidence,
        "mapping_type": r.mapping_type,
        "status": r.status,
        "expires_at": r.expires_at,
    }
