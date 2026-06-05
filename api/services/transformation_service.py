"""
api/services/transformation_service.py
Core service logic for the Transformation Intelligence module.

All LLM calls:
  - use ai_client.get_client() / chat_model()
  - check PromptTemplate overrides (category='transformation_*')
  - log via ai_trace.store(module='transformation_intelligence')
"""
from __future__ import annotations

import json
import operator as _op
import re
import time
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from api.models import (
    CatalogColumn, CatalogSample, MappingRow,
    ConversionValueMapping, TargetFormulaRule,
    TransformationRule, RuleSimulationLog, RuleValidationIssue, RuleTestCase,
    PromptTemplate, AITraceLog, SavedReport,
)
from api.services.ai_client import get_client, chat_model
import api.services.ai_trace as ai_trace


# ──────────────────────────────────────────────────────────────────────────────
# Default prompts (overridable via PromptTemplate table)
# ──────────────────────────────────────────────────────────────────────────────

_DISCOVERY_PROMPT = """You are an expert insurance data conversion analyst.
Given a source schema (tables, columns, sample data), existing field mappings, and optional
knowledge base context, suggest transformation rules needed for the conversion.

Return a JSON array of rule objects with these fields:
- rule_name (string)
- category (DirectMapping|LookupMapping|ConditionalRule|DefaultValue|Formula|DataValidation|DataQualityRule|ReferenceDataRule)
- execution_stage (PreTransform|Transform|PostTransform|Validation)
- description (string)
- source_object (table name or null)
- source_column (column name or null)
- target_path (target XML/JSON path or null)
- condition_json (object with logic/conditions or null)
- transformation_json (object with action/cases or null)
- confidence_score (float 0.0-1.0)
- tags (array of strings)

Focus on: lookup/dropdown mappings, conditional business rules, default values,
data quality checks, reference data standardization (LOB codes, state codes, status codes).
Return ONLY the JSON array, no markdown fences."""

_NL_PARSE_PROMPT = """You are an expert at converting natural language business rules into
structured transformation specifications for insurance data conversion.

Parse the given natural language rule into a JSON object with:
- rule_name: short descriptive name
- category: DirectMapping|LookupMapping|ConditionalRule|DefaultValue|Formula|DataValidation|DataQualityRule|ReferenceDataRule
- execution_stage: PreTransform|Transform|PostTransform|Validation
- suggested_name: snake_case rule identifier
- confidence: float 0.0-1.0
- condition_json: {"logic":"AND","conditions":[{"field":"FieldName","operator":">","value":"10000"}]}
  or null if no condition
- transformation_json: {"action":"set","target_field":"TargetField",
    "cases":[{"when":{...},"then":"value"},{"else":"default"}]}
  or for simple direct: {"action":"direct_map","source_field":"SourceCol","target_field":"Target"}

Example input: "If Premium > 10000 then Tier = Gold else Standard"
Example output condition_json: {"logic":"AND","conditions":[{"field":"Premium","operator":">","value":"10000"}]}
Example transformation_json: {"action":"set","target_field":"Tier","cases":[{"when":{"logic":"AND","conditions":[{"field":"Premium","operator":">","value":"10000"}]},"then":"Gold"},{"else":"Standard"}]}

Return ONLY the JSON object, no markdown fences."""

_KB_EXTRACT_PROMPT = """You are an expert insurance data conversion analyst.
Given knowledge base context from KT sessions, meeting notes, or documentation,
extract actionable transformation rules.

For each rule found, produce a JSON object in the array with:
- rule_name, category, execution_stage, description
- source_object, source_column, target_path (where identifiable)
- condition_json, transformation_json (structured specs)
- confidence_score (0.0-1.0 based on how explicit the rule is in the source text)

Return a JSON array of rule objects. Return ONLY the JSON array."""

_RECON_GEN_PROMPT = """You are an expert insurance data conversion test engineer.
Given a list of transformation rules, generate reconciliation SQL queries that validate
the transformation was applied correctly.

For each rule, generate:
- name: descriptive test name
- source_sql: SQL to check source data (count, sum, or value check)
- target_sql: SQL to check transformed target data
- validation_type: count|sum|value_match|null_check|range_check

Return a JSON array. Return ONLY the JSON array."""

_EXPORT_PYTHON_PROMPT = """You are an expert Python developer specializing in data transformation.
Convert the given transformation rules into Python functions.
Return clean, executable Python code as a string."""


def _load_prompt(category: str, db: Session, fallback: str) -> str:
    try:
        tpl = db.query(PromptTemplate).filter(
            PromptTemplate.category == category,
            PromptTemplate.is_active == True,
        ).first()
        if tpl and tpl.content and tpl.content.strip():
            return tpl.content.strip()
    except Exception:
        pass
    return fallback


def _log_trace(module: str, conn_id: Optional[int], model: str,
               prompt: str, response: str,
               tokens_in: int, tokens_out: int, latency_ms: int, db: Session) -> None:
    ai_trace.store(
        module=module, conn_id=conn_id, model=model,
        prompt=prompt[:8000], response=response[:8000],
        tokens_in=tokens_in, tokens_out=tokens_out, latency_ms=latency_ms, db=db,
    )


def _extract_json(text: str):
    """Extract JSON from LLM response (handles markdown fences)."""
    text = text.strip()
    # Strip ```json ... ``` or ``` ... ```
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    return json.loads(text)


# ──────────────────────────────────────────────────────────────────────────────
# 1. AI Rule Discovery
# ──────────────────────────────────────────────────────────────────────────────

def discover_rules(
    conn_id: int,
    mapping_id: Optional[int],
    use_knowledge: bool,
    max_rules: int,
    created_by: Optional[str],
    db: Session,
) -> dict:
    """
    Analyze source schema + mappings + optional KB → suggest transformation rules.
    """
    # Gather schema context
    cols = db.query(CatalogColumn).filter(CatalogColumn.conn_id == conn_id).limit(200).all()
    samples = db.query(CatalogSample).filter(CatalogSample.conn_id == conn_id).limit(30).all()
    mappings = db.query(MappingRow).join(
        __import__('api.models', fromlist=['Mapping']).Mapping,
        MappingRow.mapping_id == __import__('api.models', fromlist=['Mapping']).Mapping.id
    ).filter(
        __import__('api.models', fromlist=['Mapping']).Mapping.conn_id == conn_id
    ).limit(100).all() if mapping_id is None else \
        db.query(MappingRow).filter(MappingRow.mapping_id == mapping_id).limit(100).all()

    val_maps = db.query(ConversionValueMapping).filter(
        ConversionValueMapping.conn_id == conn_id
    ).limit(100).all()

    # Build schema text
    schema_lines: list[str] = []
    by_table: dict = {}
    for c in cols:
        by_table.setdefault(c.table_name, []).append(f"  {c.column_name} ({c.data_type})")
    for tbl, fcols in list(by_table.items())[:20]:
        schema_lines.append(f"Table: {tbl}")
        schema_lines.extend(fcols[:15])

    mapping_lines = [
        f"  {r.source_column} → {r.target_path} (conf:{r.confidence})"
        for r in mappings[:30] if r.source_column and r.target_path
    ]

    value_lines = [
        f"  {m.table_name}.{m.column_name}: '{m.source_value}' → '{m.target_value or '?'}' ({m.status})"
        for m in val_maps[:30]
    ]

    sample_lines: list[str] = []
    for s in samples[:5]:
        try:
            rows = json.loads(s.sample_json or "[]")
            if rows:
                sample_lines.append(f"Sample {s.table_name}: {rows[0]}")
        except Exception:
            pass

    kb_context = ""
    kb_sources: list[str] = []
    if use_knowledge:
        try:
            from api.services.knowledge_processor import semantic_search
            hits = semantic_search(
                "transformation rules insurance conversion lookup mapping",
                top_k=5, db=db,
            )
            for score, chunk in hits:
                kb_context += f"\n[KB] {chunk.content[:300]}\n"
                kb_sources.append(f"chunk:{chunk.id}")
        except Exception:
            pass

    user_msg = (
        f"Source Schema:\n" + "\n".join(schema_lines) + "\n\n"
        f"Existing Mappings:\n" + "\n".join(mapping_lines or ["(none)"]) + "\n\n"
        f"Value Mappings:\n" + "\n".join(value_lines or ["(none)"]) + "\n\n"
        f"Sample Data:\n" + "\n".join(sample_lines or ["(none)"]) + "\n\n"
        + (f"Knowledge Context:\n{kb_context}\n\n" if kb_context else "")
        + f"Generate up to {max_rules} transformation rules."
    )

    system_prompt = _load_prompt("transformation_discovery", db, _DISCOVERY_PROMPT)
    model = chat_model()
    client = get_client()

    t0 = time.time()
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system_prompt},
                  {"role": "user", "content": user_msg}],
        temperature=0.2,
        max_tokens=3000,
    )
    latency_ms = int((time.time() - t0) * 1000)
    raw = resp.choices[0].message.content or "[]"
    tokens_in = resp.usage.prompt_tokens if resp.usage else 0
    tokens_out = resp.usage.completion_tokens if resp.usage else 0

    _log_trace("transformation_intelligence", conn_id, model, user_msg[:4000], raw[:4000],
               tokens_in, tokens_out, latency_ms, db)

    rules_data: list[dict] = []
    try:
        parsed = _extract_json(raw)
        if isinstance(parsed, list):
            rules_data = parsed[:max_rules]
    except Exception:
        pass

    # Persist suggested rules as draft
    created_rules = []
    for rd in rules_data:
        tags = rd.get("tags", [])
        rule = TransformationRule(
            conn_id=conn_id,
            rule_name=rd.get("rule_name", "Unnamed Rule"),
            description=rd.get("description"),
            category=rd.get("category", "DirectMapping"),
            execution_stage=rd.get("execution_stage", "Transform"),
            source_object=rd.get("source_object"),
            source_column=rd.get("source_column"),
            target_path=rd.get("target_path"),
            condition_json=json.dumps(rd["condition_json"]) if rd.get("condition_json") else None,
            transformation_json=json.dumps(rd["transformation_json"]) if rd.get("transformation_json") else None,
            confidence_score=rd.get("confidence_score"),
            ai_generated=True,
            approval_status="draft",
            tags_json=json.dumps(tags) if tags else None,
            created_by=created_by,
        )
        db.add(rule)
        db.flush()
        created_rules.append(rule)
    db.commit()

    return {
        "rules": [_rule_to_dict(r) for r in created_rules],
        "kb_sources": kb_sources,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "latency_ms": latency_ms,
    }


# ──────────────────────────────────────────────────────────────────────────────
# 2. Natural Language Rule Parser
# ──────────────────────────────────────────────────────────────────────────────

def parse_natural_language(
    nl_text: str,
    conn_id: Optional[int],
    db: Session,
) -> dict:
    """Convert natural language rule description → structured condition + transformation JSON."""
    system_prompt = _load_prompt("transformation_nl_parse", db, _NL_PARSE_PROMPT)
    model = chat_model()
    client = get_client()

    t0 = time.time()
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system_prompt},
                  {"role": "user", "content": nl_text}],
        temperature=0.1,
        max_tokens=800,
    )
    latency_ms = int((time.time() - t0) * 1000)
    raw = resp.choices[0].message.content or "{}"
    tokens_in = resp.usage.prompt_tokens if resp.usage else 0
    tokens_out = resp.usage.completion_tokens if resp.usage else 0

    _log_trace("transformation_intelligence", conn_id, model, nl_text[:4000], raw[:4000],
               tokens_in, tokens_out, latency_ms, db)

    try:
        result = _extract_json(raw)
        return {
            "condition_json": result.get("condition_json"),
            "transformation_json": result.get("transformation_json"),
            "category": result.get("category", "ConditionalRule"),
            "execution_stage": result.get("execution_stage", "Transform"),
            "suggested_name": result.get("suggested_name", ""),
            "confidence": result.get("confidence", 0.7),
        }
    except Exception:
        return {
            "condition_json": None,
            "transformation_json": None,
            "category": "ConditionalRule",
            "execution_stage": "Transform",
            "suggested_name": "",
            "confidence": 0.0,
        }


# ──────────────────────────────────────────────────────────────────────────────
# 3. KB Rule Extraction
# ──────────────────────────────────────────────────────────────────────────────

def extract_rules_from_kb(
    query: str,
    conn_id: Optional[int],
    top_k: int,
    created_by: Optional[str],
    db: Session,
) -> dict:
    """Query SAI Knowledge Hub and extract transformation rules from relevant chunks."""
    from api.services.knowledge_processor import semantic_search

    hits = semantic_search(query, top_k=top_k, db=db)
    if not hits:
        return {"rules": [], "kb_sources": [], "context_used": ""}

    context_parts = []
    kb_sources = []
    for score, chunk in hits:
        context_parts.append(f"[score={score:.2f}] {chunk.content[:400]}")
        kb_sources.append(f"chunk:{chunk.id}")

    context_used = "\n\n".join(context_parts)
    system_prompt = _load_prompt("transformation_kb_extract", db, _KB_EXTRACT_PROMPT)
    model = chat_model()
    client = get_client()

    user_msg = f"Knowledge Context:\n{context_used}\n\nQuery: {query}\n\nExtract transformation rules."
    t0 = time.time()
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system_prompt},
                  {"role": "user", "content": user_msg}],
        temperature=0.1,
        max_tokens=2000,
    )
    latency_ms = int((time.time() - t0) * 1000)
    raw = resp.choices[0].message.content or "[]"
    tokens_in = resp.usage.prompt_tokens if resp.usage else 0
    tokens_out = resp.usage.completion_tokens if resp.usage else 0

    _log_trace("transformation_intelligence", conn_id, model, user_msg[:4000], raw[:4000],
               tokens_in, tokens_out, latency_ms, db)

    rules_data: list[dict] = []
    try:
        parsed = _extract_json(raw)
        if isinstance(parsed, list):
            rules_data = parsed
    except Exception:
        pass

    created_rules = []
    for rd in rules_data:
        rule = TransformationRule(
            conn_id=conn_id,
            rule_name=rd.get("rule_name", "KB Extracted Rule"),
            description=rd.get("description"),
            category=rd.get("category", "ConditionalRule"),
            execution_stage=rd.get("execution_stage", "Transform"),
            source_object=rd.get("source_object"),
            source_column=rd.get("source_column"),
            target_path=rd.get("target_path"),
            condition_json=json.dumps(rd["condition_json"]) if rd.get("condition_json") else None,
            transformation_json=json.dumps(rd["transformation_json"]) if rd.get("transformation_json") else None,
            confidence_score=rd.get("confidence_score"),
            ai_generated=True,
            approval_status="draft",
            created_by=created_by,
        )
        db.add(rule)
        db.flush()
        created_rules.append(rule)
    db.commit()

    return {
        "rules": [_rule_to_dict(r) for r in created_rules],
        "kb_sources": kb_sources,
        "context_used": context_used[:2000],
    }


# ──────────────────────────────────────────────────────────────────────────────
# 4. Rule Simulation (pure Python, no LLM)
# ──────────────────────────────────────────────────────────────────────────────

_OPERATORS = {
    "=": _op.eq, "==": _op.eq, "!=": _op.ne, "<>": _op.ne,
    ">": _op.gt, ">=": _op.ge, "<": _op.lt, "<=": _op.le,
    "contains": lambda a, b: str(b).lower() in str(a).lower(),
    "startswith": lambda a, b: str(a).lower().startswith(str(b).lower()),
    "endswith": lambda a, b: str(a).lower().endswith(str(b).lower()),
    "isnull": lambda a, _: a is None or str(a).strip() == "",
    "isnotnull": lambda a, _: a is not None and str(a).strip() != "",
    "in": lambda a, b: str(a) in [x.strip() for x in str(b).split(",")],
}


def _eval_condition(cond: dict, record: dict) -> bool:
    """Recursively evaluate a condition tree against a record dict."""
    if "logic" in cond and "conditions" in cond:
        logic = cond.get("logic", "AND").upper()
        results = [_eval_condition(c, record) for c in cond["conditions"]]
        return all(results) if logic == "AND" else any(results)

    field = cond.get("field", "")
    op_key = cond.get("operator", "=")
    value = cond.get("value", "")
    rec_val = record.get(field)

    op_fn = _OPERATORS.get(op_key)
    if op_fn is None:
        return False
    try:
        # Try numeric comparison
        if op_key in (">", ">=", "<", "<="):
            return op_fn(float(str(rec_val or 0)), float(str(value)))
        return op_fn(rec_val, value)
    except Exception:
        return False


def _apply_transformation(trans: dict, record: dict) -> dict:
    """Apply transformation spec to a record, return modified copy."""
    result = dict(record)
    action = trans.get("action", "")
    target = trans.get("target_field", "")

    if action == "direct_map":
        source_field = trans.get("source_field", "")
        result[target] = record.get(source_field)

    elif action == "set":
        cases = trans.get("cases", [])
        for case in cases:
            if "when" in case:
                if _eval_condition(case["when"], record):
                    result[target] = case.get("then")
                    break
            elif "else" in case:
                result[target] = case.get("else")
                break

    elif action == "default":
        result[target] = trans.get("value")

    elif action == "formula":
        expr = trans.get("expression", "")
        try:
            for k, v in record.items():
                expr = expr.replace(f"{{{k}}}", str(v or 0))
            result[target] = eval(expr, {"__builtins__": {}})  # noqa: S307 — sandboxed
        except Exception as e:
            result[f"_error_{target}"] = str(e)

    return result


def simulate_rule(
    rule: TransformationRule,
    input_records: list[dict],
    executed_by: Optional[str],
    db: Session,
) -> dict:
    """Execute rule condition + transformation against sample records with step trace."""
    try:
        cond = json.loads(rule.condition_json) if rule.condition_json else None
        trans = json.loads(rule.transformation_json) if rule.transformation_json else None
    except Exception as e:
        return {"output_records": [], "trace": [], "passed": False, "error": str(e)}

    output_records = []
    trace = []
    step = 0

    for i, rec in enumerate(input_records):
        step += 1
        matched = True
        trace_entry: dict = {
            "step": step, "record_index": i,
            "description": f"Evaluating record #{i+1}",
            "input_value": rec, "output_value": None, "matched": True,
        }

        # Evaluate condition
        if cond:
            matched = _eval_condition(cond, rec)
            trace_entry["description"] = f"Condition check record #{i+1}: {'MATCHED' if matched else 'NO MATCH'}"
            trace_entry["matched"] = matched

        # Apply transformation
        if matched and trans:
            out_rec = _apply_transformation(trans, rec)
            trace_entry["output_value"] = out_rec
            output_records.append(out_rec)
        else:
            output_records.append(rec)
            trace_entry["output_value"] = rec

        trace.append(trace_entry)

    passed = all(t["matched"] for t in trace)

    # Persist simulation log
    try:
        log = RuleSimulationLog(
            rule_id=rule.id,
            conn_id=rule.conn_id,
            input_json=json.dumps(input_records)[:8000],
            output_json=json.dumps(output_records)[:8000],
            trace_json=json.dumps(trace)[:8000],
            passed=passed,
            executed_by=executed_by,
        )
        db.add(log)
        db.commit()
    except Exception:
        pass

    return {"output_records": output_records, "trace": trace, "passed": passed}


# ──────────────────────────────────────────────────────────────────────────────
# 5. Formal Test Case Runner
# ──────────────────────────────────────────────────────────────────────────────

def run_test_case(
    test_case: RuleTestCase,
    executed_by: Optional[str],
    db: Session,
) -> dict:
    """Run a formal test case — compare actual output against expected."""
    rule = db.query(TransformationRule).filter(
        TransformationRule.id == test_case.rule_id
    ).first()
    if not rule:
        return {"passed": False, "error": "Rule not found"}

    try:
        input_records = json.loads(test_case.input_json or "[]")
    except Exception:
        input_records = []

    sim = simulate_rule(rule, input_records, executed_by, db)
    actual = sim.get("output_records", [])

    try:
        expected = json.loads(test_case.expected_output_json or "[]")
    except Exception:
        expected = []

    # Simple equality comparison
    passed = actual == expected
    if not passed and len(actual) == len(expected):
        # Soft: check if key target fields match
        target_field = None
        try:
            trans = json.loads(rule.transformation_json or "{}")
            target_field = trans.get("target_field")
        except Exception:
            pass
        if target_field:
            passed = all(
                str(a.get(target_field)) == str(e.get(target_field))
                for a, e in zip(actual, expected)
            )

    # Update test case
    test_case.actual_output_json = json.dumps(actual)[:8000]
    test_case.passed = passed
    test_case.last_run_at = datetime.utcnow()
    test_case.last_run_by = executed_by
    db.commit()

    return {
        "passed": passed,
        "actual": actual,
        "expected": expected,
        "trace": sim.get("trace", []),
    }


# ──────────────────────────────────────────────────────────────────────────────
# 6. Rule Validation (static analysis)
# ──────────────────────────────────────────────────────────────────────────────

def validate_rule(
    rule: TransformationRule,
    all_conn_rules: list[TransformationRule],
    db: Session,
) -> list[dict]:
    """Run static analysis checks on a rule; write RuleValidationIssue rows."""
    issues = []

    # 1. Invalid condition JSON
    if rule.condition_json:
        try:
            json.loads(rule.condition_json)
        except Exception as e:
            issues.append({
                "issue_type": "invalid_condition",
                "severity": "error",
                "description": f"condition_json is not valid JSON: {e}",
            })

    # 2. Invalid transformation JSON
    if rule.transformation_json:
        try:
            json.loads(rule.transformation_json)
        except Exception as e:
            issues.append({
                "issue_type": "invalid_condition",
                "severity": "error",
                "description": f"transformation_json is not valid JSON: {e}",
            })

    # 3. Missing source — no source_column but category requires one
    needs_source = rule.category in (
        "DirectMapping", "LookupMapping", "ConditionalRule", "Formula",
    )
    if needs_source and not rule.source_column and not rule.source_object:
        issues.append({
            "issue_type": "missing_source",
            "severity": "warning",
            "description": f"Rule category '{rule.category}' expects source_column or source_object.",
        })

    # 4. Overlapping rules — same source+target, both active
    if rule.source_column and rule.target_path:
        for other in all_conn_rules:
            if other.id == rule.id or not other.is_active:
                continue
            if (other.source_column == rule.source_column and
                    other.target_path == rule.target_path and
                    other.category == rule.category):
                issues.append({
                    "issue_type": "overlapping_rule",
                    "severity": "warning",
                    "description": f"Overlaps with rule '{other.rule_name}' (id={other.id}) "
                                   f"on {rule.source_column}→{rule.target_path}.",
                    "conflicting_rule_id": other.id,
                })

    # 5. Circular dependency (follow parent_rule_id chain)
    visited = {rule.id}
    cur_id = rule.parent_rule_id
    while cur_id:
        if cur_id in visited:
            issues.append({
                "issue_type": "circular_dependency",
                "severity": "error",
                "description": f"Circular parent_rule_id chain detected at rule id={cur_id}.",
            })
            break
        visited.add(cur_id)
        parent = db.query(TransformationRule).filter(TransformationRule.id == cur_id).first()
        cur_id = parent.parent_rule_id if parent else None

    # Clear old unresolved issues for this rule, then write new ones
    db.query(RuleValidationIssue).filter(
        RuleValidationIssue.rule_id == rule.id,
        RuleValidationIssue.resolved == False,
    ).delete()

    for iss in issues:
        db.add(RuleValidationIssue(
            rule_id=rule.id,
            conn_id=rule.conn_id,
            issue_type=iss["issue_type"],
            severity=iss["severity"],
            description=iss["description"],
            conflicting_rule_id=iss.get("conflicting_rule_id"),
        ))
    db.commit()

    return issues


def validate_all_rules(conn_id: int, db: Session) -> dict:
    """Run validation for all active rules for conn_id."""
    rules = db.query(TransformationRule).filter(
        TransformationRule.conn_id == conn_id,
        TransformationRule.is_active == True,
    ).all()

    all_issues = []
    rules_with_issues = set()
    for rule in rules:
        issues = validate_rule(rule, rules, db)
        if issues:
            rules_with_issues.add(rule.id)
            for iss in issues:
                iss["rule_id"] = rule.id
                iss["rule_name"] = rule.rule_name
            all_issues.extend(issues)

    return {
        "total_issues": len(all_issues),
        "rules_with_issues": len(rules_with_issues),
        "clean": len(all_issues) == 0,
        "issues": all_issues,
    }


# ──────────────────────────────────────────────────────────────────────────────
# 7. Impact Analysis
# ──────────────────────────────────────────────────────────────────────────────

def analyze_impact(rule: TransformationRule, db: Session) -> dict:
    """Find all entities affected by this rule across the codebase."""
    impact: dict = {
        "rule_id": rule.id,
        "mapping_rows": [],
        "xml_groups": [],
        "pipelines": [],
        "apis": [],
        "reports": [],
        "total_affected": 0,
    }

    # Mapping rows with matching source or target
    if rule.source_column or rule.target_path:
        from api.models import MappingRow as MR
        q = db.query(MR)
        if rule.source_column:
            q = q.filter(MR.source_column == rule.source_column)
        rows = q.limit(50).all()
        for r in rows:
            impact["mapping_rows"].append({
                "id": r.id, "label": f"{r.source_column} → {r.target_path}",
                "detail": f"mapping_id={r.mapping_id}", "link_type": "mapping_row",
            })

    # Target formula rules (XML groups) with matching path
    if rule.target_path:
        tf_rules = db.query(TargetFormulaRule).filter(
            TargetFormulaRule.target_path.like(f"%{rule.target_path.split('/')[-1]}%")
        ).limit(20).all()
        for tf in tf_rules:
            impact["xml_groups"].append({
                "id": tf.id, "label": tf.target_path or "",
                "detail": f"group={tf.group_path}", "link_type": "xml_group",
            })

    # Reports referencing source column
    if rule.source_column:
        try:
            reports = db.query(SavedReport).filter(
                SavedReport.query_sql.like(f"%{rule.source_column}%")
            ).limit(10).all()
            for rep in reports:
                impact["reports"].append({
                    "id": rep.id, "label": rep.name or f"Report #{rep.id}",
                    "detail": "SQL references source column", "link_type": "report",
                })
        except Exception:
            pass

    # Pipeline steps bound to this rule
    from api.models import TransformationPipelineStep as TPS
    steps = db.query(TPS).filter(TPS.rule_id == rule.id).limit(10).all()
    for step in steps:
        impact["pipelines"].append({
            "id": step.pipeline_id, "label": f"Pipeline step: {step.step_name}",
            "detail": f"stage={step.execution_stage}", "link_type": "pipeline",
        })

    total = sum(len(v) for v in impact.values() if isinstance(v, list))
    impact["total_affected"] = total

    # Cache in rule
    rule.impact_json = json.dumps(impact)
    db.commit()

    return impact


# ──────────────────────────────────────────────────────────────────────────────
# 8. Readiness Dashboard
# ──────────────────────────────────────────────────────────────────────────────

def get_readiness_dashboard(conn_id: Optional[int], db: Session) -> dict:
    """Compute all conversion readiness metrics."""
    base_q = db.query(TransformationRule)
    if conn_id:
        base_q = base_q.filter(TransformationRule.conn_id == conn_id)

    total_rules = base_q.filter(TransformationRule.is_active == True).count()
    approved_rules = base_q.filter(
        TransformationRule.is_active == True,
        TransformationRule.approval_status == "approved",
    ).count()
    pending_rules = base_q.filter(
        TransformationRule.is_active == True,
        TransformationRule.approval_status == "pending_review",
    ).count()
    ref_data_rules = base_q.filter(
        TransformationRule.is_active == True,
        TransformationRule.category == "ReferenceDataRule",
        TransformationRule.approval_status == "approved",
    ).count()

    # Average AI confidence (approved rules only)
    conf_rows = base_q.filter(
        TransformationRule.is_active == True,
        TransformationRule.approval_status == "approved",
        TransformationRule.confidence_score != None,  # noqa: E711
    ).with_entities(TransformationRule.confidence_score).all()
    avg_conf = None
    if conf_rows:
        avg_conf = round(sum(r[0] for r in conf_rows) / len(conf_rows), 3)

    # Mapping coverage
    catalog_cols = 0
    mapped_cols = 0
    if conn_id:
        catalog_cols = db.query(CatalogColumn).filter(CatalogColumn.conn_id == conn_id).count()
        from api.models import Mapping
        mapping = db.query(Mapping).filter(
            Mapping.conn_id == conn_id, Mapping.is_active == True,
        ).first()
        if mapping:
            mapped_cols = db.query(MappingRow).filter(
                MappingRow.mapping_id == mapping.id,
                MappingRow.source_column != None,  # noqa: E711
            ).count()

    mapping_coverage_pct = round(mapped_cols / max(catalog_cols, 1) * 100, 1)

    # Value mapping coverage
    total_vals = 0
    mapped_vals = 0
    if conn_id:
        total_vals = db.query(ConversionValueMapping).filter(
            ConversionValueMapping.conn_id == conn_id
        ).count()
        mapped_vals = db.query(ConversionValueMapping).filter(
            ConversionValueMapping.conn_id == conn_id,
            ConversionValueMapping.target_value != None,  # noqa: E711
            ConversionValueMapping.status == "approved",
        ).count()

    value_mapping_pct = round(mapped_vals / max(total_vals, 1) * 100, 1)
    unmapped_values = total_vals - mapped_vals

    # Rule coverage = approved rules vs mapped fields
    rule_coverage_pct = round(approved_rules / max(mapped_cols, 1) * 100, 1) if mapped_cols else 0.0

    # Rules by category
    from sqlalchemy import func as sqlfunc
    cat_rows = (
        base_q.filter(TransformationRule.is_active == True)
        .with_entities(TransformationRule.category, sqlfunc.count(TransformationRule.id))
        .group_by(TransformationRule.category)
        .all()
    )
    rules_by_category = {cat: cnt for cat, cnt in cat_rows}

    # Test cases
    tc_q = db.query(RuleTestCase)
    if conn_id:
        tc_q = tc_q.filter(RuleTestCase.conn_id == conn_id)
    test_case_count = tc_q.count()
    test_cases_passing = tc_q.filter(RuleTestCase.passed == True).count()
    test_coverage_pct = round(test_cases_passing / max(test_case_count, 1) * 100, 1)

    # Validation issues
    iss_q = db.query(RuleValidationIssue)
    if conn_id:
        iss_q = iss_q.filter(RuleValidationIssue.conn_id == conn_id)
    issues_count = iss_q.filter(RuleValidationIssue.resolved == False).count()

    # Reconciliation queries (stored as approved rules with category=DataValidation targeting recon)
    recon_rules = base_q.filter(
        TransformationRule.is_active == True,
        TransformationRule.category.in_(["DataValidation", "DataQualityRule"]),
        TransformationRule.approval_status == "approved",
    ).count()

    # Readiness gates
    ready_for_sit = (
        mapping_coverage_pct >= 90
        and value_mapping_pct >= 85
        and (approved_rules >= total_rules * 0.8 if total_rules > 0 else True)
        and issues_count == 0
    )
    ready_for_uat = (
        ready_for_sit
        and test_case_count > 0
        and test_cases_passing == test_case_count
        and recon_rules > 0
    )

    return {
        "mapping_coverage_pct": mapping_coverage_pct,
        "unmapped_fields": max(catalog_cols - mapped_cols, 0),
        "value_mapping_coverage_pct": value_mapping_pct,
        "unmapped_values": unmapped_values,
        "rule_coverage_pct": rule_coverage_pct,
        "total_rules": total_rules,
        "approved_rules": approved_rules,
        "avg_ai_confidence": avg_conf,
        "manual_review_count": pending_rules,
        "rules_by_category": rules_by_category,
        "test_case_count": test_case_count,
        "test_cases_passing": test_cases_passing,
        "test_coverage_pct": test_coverage_pct,
        "issues_count": issues_count,
        "reference_data_rules": ref_data_rules,
        "recon_query_count": recon_rules,
        "ready_for_sit": ready_for_sit,
        "ready_for_uat": ready_for_uat,
    }


# ──────────────────────────────────────────────────────────────────────────────
# 9. Lookup Intelligence
# ──────────────────────────────────────────────────────────────────────────────

def enhance_lookup_intelligence(
    conn_id: int,
    table_name: str,
    column_name: str,
    db: Session,
) -> dict:
    """Enrich value mappings for a column with conflict detection and CASE statement."""
    mappings = db.query(ConversionValueMapping).filter(
        ConversionValueMapping.conn_id == conn_id,
        ConversionValueMapping.table_name == table_name,
        ConversionValueMapping.column_name == column_name,
    ).all()

    # Detect conflicts: same source_value → different target_values
    from collections import defaultdict
    src_to_targets: dict = defaultdict(list)
    for m in mappings:
        if m.source_value:
            src_to_targets[m.source_value].append(m)

    conflicts = []
    for src_val, ms in src_to_targets.items():
        unique_targets = {m.target_value for m in ms if m.target_value}
        if len(unique_targets) > 1:
            conflicts.append({
                "source_value": src_val,
                "mappings": [_vm_to_dict(m) for m in ms],
            })

    # Unmapped values: source_value exists but no target_value
    unmapped = [m.source_value for m in mappings if not m.target_value]

    # Build CASE statement
    mapped_ms = [m for m in mappings if m.source_value and m.target_value]
    case_lines = [f"CASE [{column_name}]"]
    python_lookup: dict = {}
    for m in mapped_ms:
        case_lines.append(f"    WHEN '{m.source_value}' THEN '{m.target_value}'")
        python_lookup[m.source_value] = m.target_value or ""
    case_lines.append(f"    ELSE [{column_name}]")
    case_lines.append("END")
    case_statement = "\n".join(case_lines) if mapped_ms else None

    return {
        "suggestions": [_vm_to_dict(m) for m in mappings],
        "unmapped_values": unmapped,
        "conflicts": conflicts,
        "case_statement": case_statement,
        "python_lookup": python_lookup,
    }


# ──────────────────────────────────────────────────────────────────────────────
# 10. Reconciliation Query Generation
# ──────────────────────────────────────────────────────────────────────────────

def generate_recon_queries(
    conn_id: int,
    rule_ids: Optional[list[int]],
    db: Session,
) -> dict:
    """Generate reconciliation SQL queries from approved transformation rules."""
    q = db.query(TransformationRule).filter(
        TransformationRule.conn_id == conn_id,
        TransformationRule.is_active == True,
        TransformationRule.approval_status == "approved",
    )
    if rule_ids:
        q = q.filter(TransformationRule.id.in_(rule_ids))
    rules = q.limit(50).all()

    if not rules:
        return {"queries": []}

    rules_text = json.dumps([{
        "id": r.id,
        "rule_name": r.rule_name,
        "category": r.category,
        "source_object": r.source_object,
        "source_column": r.source_column,
        "target_path": r.target_path,
        "transformation_json": r.transformation_json,
    } for r in rules], indent=2)

    system_prompt = _load_prompt("transformation_recon_gen", db, _RECON_GEN_PROMPT)
    model = chat_model()
    client = get_client()

    user_msg = f"Approved Transformation Rules:\n{rules_text}\n\nGenerate reconciliation queries."
    t0 = time.time()
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system_prompt},
                  {"role": "user", "content": user_msg}],
        temperature=0.1,
        max_tokens=2000,
    )
    latency_ms = int((time.time() - t0) * 1000)
    raw = resp.choices[0].message.content or "[]"
    tokens_in = resp.usage.prompt_tokens if resp.usage else 0
    tokens_out = resp.usage.completion_tokens if resp.usage else 0

    _log_trace("transformation_intelligence", conn_id, model, user_msg[:4000], raw[:4000],
               tokens_in, tokens_out, latency_ms, db)

    queries: list[dict] = []
    try:
        parsed = _extract_json(raw)
        if isinstance(parsed, list):
            queries = parsed
    except Exception:
        pass

    return {"queries": queries}


# ──────────────────────────────────────────────────────────────────────────────
# 11. Export Rules
# ──────────────────────────────────────────────────────────────────────────────

def export_rules(
    conn_id: int,
    fmt: str,
    rule_ids: Optional[list[int]],
    db: Session,
) -> tuple[str, str]:
    """Generate transformation output in the requested format."""
    q = db.query(TransformationRule).filter(
        TransformationRule.conn_id == conn_id,
        TransformationRule.is_active == True,
    )
    if rule_ids:
        q = q.filter(TransformationRule.id.in_(rule_ids))
    rules = q.order_by(TransformationRule.execution_stage, TransformationRule.stage_order).all()

    if fmt in ("sql_server", "snowflake"):
        lines = [f"-- Transformation Rules Export ({fmt.upper()}) — {datetime.utcnow().date()}\n"]
        for r in rules:
            lines.append(f"-- Rule: {r.rule_name} [{r.category}]")
            if r.description:
                lines.append(f"-- {r.description}")
            try:
                trans = json.loads(r.transformation_json or "{}")
                if trans.get("action") == "set" and r.source_object and r.target_path:
                    tgt_col = r.target_path.split("/")[-1]
                    src_col = r.source_column or tgt_col
                    cases = trans.get("cases", [])
                    if cases:
                        case_sql = f"CASE\n"
                        for case in cases:
                            if "when" in case:
                                conds = case["when"].get("conditions", [])
                                cond_str = " AND ".join(
                                    f"[{c['field']}] {c['operator']} '{c['value']}'"
                                    for c in conds
                                )
                                then_val = case.get("then", "")
                                case_sql += f"    WHEN {cond_str} THEN '{then_val}'\n"
                            elif "else" in case:
                                case_sql += f"    ELSE '{case['else']}'\n"
                        case_sql += "END"
                        if fmt == "snowflake":
                            case_sql = case_sql.replace("[", "").replace("]", "")
                        lines.append(f"-- UPDATE {r.source_object} SET [{tgt_col}] = {case_sql};")
                    else:
                        lines.append(f"-- SELECT [{src_col}] AS [{tgt_col}] FROM {r.source_object};")
                else:
                    lines.append(f"-- Category: {r.category}")
            except Exception:
                lines.append(f"-- (parse error)")
            lines.append("")
        content = "\n".join(lines)
        filename = f"transformation_rules_{conn_id}.sql"

    elif fmt == "python":
        lines = [
            f'"""Transformation Rules — conn_id={conn_id} — generated {datetime.utcnow().date()}"""',
            "from typing import Any\n",
        ]
        for r in rules:
            fn_name = re.sub(r"[^a-z0-9_]", "_", r.rule_name.lower())[:40]
            lines.append(f"def {fn_name}(record: dict) -> dict:")
            lines.append(f'    """[{r.category}] {r.description or r.rule_name}"""')
            try:
                trans = json.loads(r.transformation_json or "{}")
                target = trans.get("target_field", "output")
                cases = trans.get("cases", [])
                if cases:
                    lines.append("    result = dict(record)")
                    for case in cases:
                        if "when" in case:
                            conds = case["when"].get("conditions", [])
                            cond_parts = []
                            for c in conds:
                                field = c.get("field", "")
                                op = c.get("operator", "=").replace("=", "==")
                                val = c.get("value", "")
                                cond_parts.append(
                                    "str(record.get('" + field + "', '')) " + op + " '" + val + "'"
                                )
                            py_cond = " and ".join(cond_parts)
                            then_val = str(case.get("then", ""))
                            lines.append("    if " + py_cond + ":")
                            lines.append("        result['" + target + "'] = '" + then_val + "'")
                        elif "else" in case:
                            else_val = str(case.get("else", ""))
                            lines.append("    else:")
                            lines.append("        result['" + target + "'] = '" + else_val + "'")
                    lines.append("    return result")
                else:
                    lines.append(f"    return dict(record)")
            except Exception:
                lines.append(f"    return dict(record)")
            lines.append("")
        content = "\n".join(lines)
        filename = f"transformation_rules_{conn_id}.py"

    elif fmt == "json":
        data = []
        for r in rules:
            data.append({
                "id": r.id, "rule_name": r.rule_name, "category": r.category,
                "execution_stage": r.execution_stage, "stage_order": r.stage_order,
                "source_object": r.source_object, "source_column": r.source_column,
                "target_path": r.target_path,
                "condition": json.loads(r.condition_json) if r.condition_json else None,
                "transformation": json.loads(r.transformation_json) if r.transformation_json else None,
                "approval_status": r.approval_status, "confidence_score": r.confidence_score,
            })
        content = json.dumps(data, indent=2)
        filename = f"transformation_rules_{conn_id}.json"

    elif fmt == "xml":
        lines = ['<?xml version="1.0" encoding="UTF-8"?>',
                 f'<TransformationRules conn_id="{conn_id}" generated="{datetime.utcnow().date()}">']
        for r in rules:
            lines.append(f'  <Rule id="{r.id}" category="{r.category}" stage="{r.execution_stage}">')
            lines.append(f'    <Name>{r.rule_name}</Name>')
            if r.description:
                lines.append(f'    <Description>{r.description}</Description>')
            if r.source_object:
                lines.append(f'    <Source object="{r.source_object}" column="{r.source_column or ""}"/>')
            if r.target_path:
                lines.append(f'    <Target path="{r.target_path}"/>')
            lines.append(f'  </Rule>')
        lines.append('</TransformationRules>')
        content = "\n".join(lines)
        filename = f"transformation_rules_{conn_id}.xml"

    else:
        content = ""
        filename = "transformation_rules.txt"

    return content, filename


# ──────────────────────────────────────────────────────────────────────────────
# Helper serializers
# ──────────────────────────────────────────────────────────────────────────────

def _rule_to_dict(r: TransformationRule) -> dict:
    return {
        "id": r.id, "conn_id": r.conn_id, "rule_name": r.rule_name,
        "description": r.description, "category": r.category,
        "execution_stage": r.execution_stage, "stage_order": r.stage_order,
        "priority": r.priority, "condition_json": r.condition_json,
        "transformation_json": r.transformation_json,
        "source_object": r.source_object, "source_column": r.source_column,
        "target_object": r.target_object, "target_path": r.target_path,
        "version": r.version, "parent_rule_id": r.parent_rule_id,
        "approval_status": r.approval_status, "approved_by": r.approved_by,
        "approved_at": r.approved_at.isoformat() if r.approved_at else None,
        "created_by": r.created_by, "is_active": r.is_active,
        "confidence_score": r.confidence_score, "ai_generated": r.ai_generated,
        "tags_json": r.tags_json, "impact_json": r.impact_json,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _vm_to_dict(m: ConversionValueMapping) -> dict:
    return {
        "id": m.id, "conn_id": m.conn_id, "table_name": m.table_name,
        "column_name": m.column_name, "source_value": m.source_value,
        "target_value": m.target_value, "confidence": m.confidence,
        "mapping_type": m.mapping_type, "status": m.status,
    }
