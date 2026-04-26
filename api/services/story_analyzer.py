"""
story_analyzer.py — Two-call LLM pipeline for user story analysis.

Call A (story_analyzer_parse):   Parse → Normalize → Consolidate → Detect Conflicts
Call B (story_analyzer_usecases): Extract distinct business use cases + generate 4 prompts each

Full datasets never leave the server. Results are stateless (no DB persistence of analysis).
"""
from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy.orm import Session


# ── System prompts ────────────────────────────────────────────────────────────

_PARSE_SYSTEM_PROMPT = """\
You are a senior data architect and AI requirement analyzer.

Analyze the provided list of user stories and perform these steps:

STEP 1 — PARSE EACH STORY
For each story extract:
- entities (e.g., policy, customer, invoice, payment)
- metrics (e.g., premium, amount, count)
- dimensions (e.g., status, date, type)
- filters (if any)
- time_granularity (daily | monthly | lifecycle | yearly | real-time | none)
- use_case (trend | aggregation | reconciliation | detail_view | other)

STEP 2 — NORMALIZE
- Standardize naming (e.g., "premium" vs "amount" → use "premium")
- Remove duplicates across stories
- Align similar concepts under one name

STEP 3 — CONSOLIDATE
- Merge all stories into a single unified_intent
- Combine all entities, metrics, dimensions into unified lists (deduplicated)
- List all identified use_cases and time granularities

STEP 4 — DETECT CONFLICTS
- Identify conflicting requirements (e.g., daily vs monthly granularity, different filter scopes)
- Report each conflict clearly
- Do NOT resolve conflicts — only report them

Return ONLY valid JSON (no markdown, no explanation):
{
  "parsed_stories": [
    {
      "title": "story title",
      "entities": [],
      "metrics": [],
      "dimensions": [],
      "filters": [],
      "time_granularity": "monthly",
      "use_case": "aggregation"
    }
  ],
  "unified_intent": {
    "entities": [],
    "metrics": [],
    "dimensions": [],
    "use_cases": [],
    "time_granularity": [],
    "filters": []
  },
  "conflicts": [
    {
      "type": "conflict type (e.g., granularity_mismatch)",
      "description": "clear description of the conflict"
    }
  ]
}
"""

_USECASE_SYSTEM_PROMPT = """\
You are a senior data architect specializing in requirement decomposition and BI solution design.

Given a unified intent from parsed user stories, extract a small set of clear, non-overlapping,
business-ready use cases that can each independently produce reports and dashboards.

STEP 1 — IDENTIFY CORE BUSINESS THEMES
Group similar concepts into logical themes representing real business questions.
Examples: Policy lifecycle tracking, Premium analysis, Customer insights, Payment reconciliation.

STEP 2 — MERGE OVERLAPPING CONCEPTS
Combine concepts that share the same entities, metrics, or similar intent.
Avoid splitting similar ideas into separate use cases.

STEP 3 — ENFORCE NON-OVERLAP
Each use case must be distinct. No duplicate or redundant use cases.
Each use case must answer a unique business problem.

STEP 4 — ENSURE OUTPUT READINESS (CRITICAL)
Each use case MUST:
- Support at least one report AND one dashboard
- Include measurable metrics (not abstract ideas)
- Include dimensions for grouping

Reject use cases that are:
- Too generic (e.g., "data analysis")
- Too technical (e.g., "build a table")
- Not actionable

STEP 5 — LIMIT COUNT
Generate a maximum of 5 use cases (minimum 1).
Prioritize high-value business scenarios.

STEP 6 — ASSIGN PRIORITY
Mark each use case as: high | medium | low

STEP 7 — GENERATE OUTPUTS PER USE CASE
For each use case generate:
1. development_prompt: Focus on data model and transformation logic. Include reusable structures and aggregations. Be concise and structured.
2. report_prompt: Focus on SQL generation. Include grouping, filters, and metrics. Be concise and structured.
3. dashboard_prompt: Define KPIs, chart types, and layout suggestions. Be concise and structured.
4. testing_prompt: Include validation rules and reconciliation checks. Be concise and structured.

CONSTRAINTS:
- Do NOT assume specific table or column names
- Use business-friendly naming
- Keep each use case independent and non-overlapping
- Ensure each use case is practical and actionable

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "use_cases": [
    {
      "name": "Short business-friendly name",
      "description": "Clear explanation of what this use case solves",
      "entities": [],
      "metrics": [],
      "dimensions": [],
      "filters": [],
      "time_granularity": [],
      "type": "trend | aggregation | reconciliation | detail",
      "priority": "high | medium | low",
      "expected_outputs": ["report", "dashboard"],
      "outputs": {
        "development_prompt": "...",
        "report_prompt": "...",
        "dashboard_prompt": "...",
        "testing_prompt": "..."
      }
    }
  ]
}
"""


_MODEL_GROUPING_SYSTEM_PROMPT = """\
You are a senior data architect specializing in data modeling and BI system design.

Task:
Group multiple use cases into a small set of reusable data models. Each model should support multiple reports and dashboards efficiently.

Input:
A list of use cases. Each use case contains: name, description, entities, metrics, dimensions, filters, time_granularity, type, priority.

Instructions:

Step 1: Identify Model Candidates
Group use cases that share:
- Same primary entities
- Similar metrics
- Similar grain (e.g., policy-level, customer-level, time-series)
Each group becomes one model.

Step 2: Define Model Type
Classify each model as one of:
- history (time-based tracking, e.g., status changes)
- aggregation (summaries, totals, averages)
- summary (flattened entity-level view)
- reconciliation (comparison between sources)

Step 3: Merge Use Cases into Models
- Combine related use cases into a single model
- Avoid duplication of logic across models
- Ensure each model supports multiple use cases

Step 4: Define Model Structure
For each model define:
- core entities
- derived metrics (e.g., processing_time)
- grain (one row per policy / per customer / per time period)
- key dimensions

Step 5: Generate Outputs Per Model
For each model generate:

1. development_prompt:
   - Define how to build the model
   - Include derived columns and transformations
   - Ensure reusability for multiple reports

2. reports (MULTIPLE):
   - Create 2-4 reports per model
   - Each report must have: a clear business name, description based on the model, metrics and grouping logic

3. dashboard_prompt:
   - Define KPIs and charts using the model
   - Include: KPIs, 2-3 charts, layout suggestion

4. testing_prompt:
   - Define validation rules for the model
   - Include: derived metric validation, aggregation checks, reconciliation logic (if applicable)

Step 6: Output Exactly ONE Model
- Combine ALL use cases into a single unified data model
- The model must cover every use case from the input
- The reports array must include one report per use case (plus any meaningful cross-cutting reports)
- One development_prompt that builds the complete model
- One dashboard_prompt covering all key metrics
- One testing_prompt validating the full model

Step 7: Output Format (STRICT JSON ONLY)

Return ONLY valid JSON (no markdown, no explanation):
{
  "models": [
    {
      "name": "Model name (business-friendly)",
      "type": "history | aggregation | summary | reconciliation",
      "grain": "description of row-level granularity",
      "entities": [],
      "metrics": [],
      "dimensions": [],
      "derived_metrics": [],
      "use_cases": [],
      "development_prompt": "...",
      "reports": [
        {
          "name": "...",
          "description": "...",
          "prompt": "..."
        }
      ],
      "dashboard_prompt": "...",
      "testing_prompt": "..."
    }
  ]
}

Constraints:
- Do NOT assume specific table or column names
- Use business-friendly naming
- Ensure each model is reusable across multiple reports
- Avoid duplicate models
- Ensure reports are distinct and meaningful
- Keep output concise but complete
"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_fences(text: str) -> str:
    """Remove markdown code fences if the LLM wrapped the JSON."""
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("```", 2)[1]
        if clean.startswith("json"):
            clean = clean[4:]
        clean = clean.rsplit("```", 1)[0]
    return clean.strip()


def _call_openai(system_prompt: str, user_message: str, model: str) -> tuple[str, int, int]:
    """Call OpenAI and return (raw_text, tokens_in, tokens_out)."""
    from api.config import settings
    from openai import OpenAI

    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured.")

    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_message},
        ],
        temperature=0.2,
        max_tokens=4000,
    )
    raw = resp.choices[0].message.content or ""
    tokens_in  = resp.usage.prompt_tokens     if resp.usage else 0
    tokens_out = resp.usage.completion_tokens if resp.usage else 0
    return raw, tokens_in, tokens_out


def _log_trace(
    db: Session,
    module: str,
    model: str,
    system_prompt: str,
    user_msg: str,
    raw_response: str,
    tokens_in: int,
    tokens_out: int,
    elapsed_ms: int,
    schema_snapshot: str | None = None,
) -> None:
    try:
        from api.models import AITraceLog
        db.add(AITraceLog(
            module=module,
            conn_id=None,
            model=model,
            prompt_text=(system_prompt[:500] + "\n---\n" + user_msg)[:4000],
            response_text=raw_response[:4000],
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=elapsed_ms,
            schema_snapshot=schema_snapshot,
        ))
        db.commit()
    except Exception:
        pass  # logging failure must never break the response


def _get_prompt_override(db: Session, category: str) -> str | None:
    try:
        from api.models import PromptTemplate as _PT
        tmpl = (
            db.query(_PT)
            .filter(_PT.category == category, _PT.is_active == True)  # noqa: E712
            .first()
        )
        if tmpl and tmpl.content and tmpl.content.strip():
            return tmpl.content.strip()
    except Exception:
        pass
    return None


# ── Public entry point ────────────────────────────────────────────────────────

async def analyze_stories(
    stories: list[dict],
    db: Session,
    model: str = "gpt-4o-mini",
    refinement_instructions: str | None = None,
    previous_result: dict | None = None,
) -> dict[str, Any]:
    """
    Two-call LLM pipeline:
      Call A — parse/normalize/consolidate/conflicts  (module=story_analyzer_parse)
      Call B — extract distinct use cases + 4 prompts (module=story_analyzer_usecases)
    Returns the assembled result dict.
    """
    total_tokens_in  = 0
    total_tokens_out = 0

    # ── Call A: Parse & Consolidate ───────────────────────────────────────────
    t0 = time.monotonic()

    system_a = _get_prompt_override(db, "story_analyzer_parse") or _PARSE_SYSTEM_PROMPT
    user_msg_a = json.dumps({"stories": stories}, ensure_ascii=False, indent=2)

    parse_result: dict[str, Any] = {}
    raw_a = ""
    tokens_in_a = 0
    tokens_out_a = 0

    try:
        raw_a, tokens_in_a, tokens_out_a = _call_openai(system_a, user_msg_a, model)
        parse_result = json.loads(_strip_fences(raw_a))
    except json.JSONDecodeError:
        parse_result = {
            "parsed_stories": [],
            "unified_intent": {"entities": [], "metrics": [], "dimensions": [], "use_cases": [], "time_granularity": [], "filters": []},
            "conflicts": [{"type": "parse_error", "description": "AI response could not be parsed as JSON."}],
        }
    except Exception as exc:
        parse_result = {
            "parsed_stories": [],
            "unified_intent": {"entities": [], "metrics": [], "dimensions": [], "use_cases": [], "time_granularity": [], "filters": []},
            "conflicts": [{"type": "ai_error", "description": str(exc)}],
        }

    elapsed_a = round((time.monotonic() - t0) * 1000)
    total_tokens_in  += tokens_in_a
    total_tokens_out += tokens_out_a

    _log_trace(
        db, "story_analyzer_parse", model, system_a, user_msg_a,
        raw_a, tokens_in_a, tokens_out_a, elapsed_a,
        schema_snapshot=json.dumps({"story_count": len(stories)}),
    )

    # ── Call B: Use Case Extraction ───────────────────────────────────────────
    t1 = time.monotonic()

    system_b = _get_prompt_override(db, "story_analyzer_usecases") or _USECASE_SYSTEM_PROMPT
    b_payload: dict[str, Any] = {
        "unified_intent": parse_result.get("unified_intent", {}),
        "parsed_stories": parse_result.get("parsed_stories", []),
    }
    if refinement_instructions and refinement_instructions.strip():
        b_payload["refinement_instructions"] = refinement_instructions.strip()
        if previous_result and previous_result.get("use_cases"):
            b_payload["previous_use_cases"] = previous_result["use_cases"]
    user_msg_b = (
        "=== REFINEMENT INSTRUCTIONS (MUST BE ADDRESSED) ===\n"
        f"{refinement_instructions.strip()}\n\n"
        + (
            "=== PREVIOUS USE CASES (improve upon these) ===\n"
            + json.dumps(previous_result.get("use_cases", []), ensure_ascii=False, indent=2)
            + "\n\n"
            if previous_result and previous_result.get("use_cases") else ""
        )
        + "=== STORY DATA ===\n"
        + json.dumps({"unified_intent": b_payload["unified_intent"], "parsed_stories": b_payload["parsed_stories"]}, ensure_ascii=False, indent=2)
        if refinement_instructions and refinement_instructions.strip()
        else json.dumps({"unified_intent": b_payload["unified_intent"], "parsed_stories": b_payload["parsed_stories"]}, ensure_ascii=False, indent=2)
    )

    use_cases_result: dict[str, Any] = {"use_cases": []}
    raw_b = ""
    tokens_in_b = 0
    tokens_out_b = 0

    try:
        raw_b, tokens_in_b, tokens_out_b = _call_openai(system_b, user_msg_b, model)
        use_cases_result = json.loads(_strip_fences(raw_b))
    except json.JSONDecodeError:
        use_cases_result = {
            "use_cases": [{
                "name": "Analysis Unavailable",
                "description": "AI response could not be parsed.",
                "entities": [], "metrics": [], "dimensions": [], "filters": [],
                "time_granularity": [], "type": "aggregation", "priority": "medium",
                "expected_outputs": ["report", "dashboard"],
                "outputs": {
                    "development_prompt": "", "report_prompt": "",
                    "dashboard_prompt": "", "testing_prompt": "",
                },
            }]
        }
    except Exception as exc:
        use_cases_result = {
            "use_cases": [{
                "name": "Error",
                "description": str(exc),
                "entities": [], "metrics": [], "dimensions": [], "filters": [],
                "time_granularity": [], "type": "aggregation", "priority": "low",
                "expected_outputs": ["report", "dashboard"],
                "outputs": {
                    "development_prompt": "", "report_prompt": "",
                    "dashboard_prompt": "", "testing_prompt": "",
                },
            }]
        }

    elapsed_b = round((time.monotonic() - t1) * 1000)
    total_tokens_in  += tokens_in_b
    total_tokens_out += tokens_out_b

    _log_trace(
        db, "story_analyzer_usecases", model, system_b, user_msg_b,
        raw_b, tokens_in_b, tokens_out_b, elapsed_b,
        schema_snapshot=json.dumps({"use_case_count": len(use_cases_result.get("use_cases", []))}),
    )

    # ── Assemble final result ─────────────────────────────────────────────────
    use_cases = use_cases_result.get("use_cases", [])

    # Sort by priority: high → medium → low
    priority_order = {"high": 0, "medium": 1, "low": 2}
    use_cases.sort(key=lambda uc: priority_order.get(uc.get("priority", "low"), 2))

    # Build ui_actions
    ui_actions = {
        "run_button": {
            "label": "Run",
            "description": "Executes selected use case",
        },
        "navigation": [
            {
                "use_case": uc.get("name", ""),
                "actions": [
                    {"target": "development_tab", "action": "navigate and load development_prompt"},
                    {"target": "report_tab",      "action": "navigate and load report_prompt"},
                    {"target": "dashboard_tab",   "action": "navigate and load dashboard_prompt"},
                    {"target": "testing_tab",     "action": "navigate and load testing_prompt"},
                ],
            }
            for uc in use_cases
        ],
    }

    # ── Call C: Model Grouping ────────────────────────────────────────────────
    models: list[dict[str, Any]] = []

    if use_cases:
        t2 = time.monotonic()

        system_c   = _get_prompt_override(db, "story_analyzer_models") or _MODEL_GROUPING_SYSTEM_PROMPT
        user_msg_c = json.dumps({
            "use_cases":      use_cases,
            "unified_intent": parse_result.get("unified_intent", {}),
        }, ensure_ascii=False, indent=2)

        raw_c       = ""
        tokens_in_c = 0
        tokens_out_c = 0

        try:
            raw_c, tokens_in_c, tokens_out_c = _call_openai(system_c, user_msg_c, model)
            models_result = json.loads(_strip_fences(raw_c))
            models = models_result.get("models", [])
        except Exception:
            models = []

        elapsed_c        = round((time.monotonic() - t2) * 1000)
        total_tokens_in  += tokens_in_c
        total_tokens_out += tokens_out_c

        _log_trace(
            db, "story_analyzer_models", model, system_c, user_msg_c,
            raw_c, tokens_in_c, tokens_out_c, elapsed_c,
            schema_snapshot=json.dumps({"model_count": len(models)}),
        )

        # Fallback: if Call C produced nothing, consolidate ALL use cases into ONE model
        if not models:
            all_entities   = list(dict.fromkeys(e for uc in use_cases for e in uc.get("entities", [])))
            all_metrics    = list(dict.fromkeys(m for uc in use_cases for m in uc.get("metrics", [])))
            all_dimensions = list(dict.fromkeys(d for uc in use_cases for d in uc.get("dimensions", [])))
            primary_entity = all_entities[0] if all_entities else "record"

            all_reports = []
            for uc in use_cases:
                rp = uc.get("outputs", {}).get("report_prompt", "")
                if rp.strip():
                    all_reports.append({
                        "name":        uc.get("name", "Report"),
                        "description": uc.get("description", ""),
                        "prompt":      rp,
                    })

            dev_prompts  = [uc.get("outputs", {}).get("development_prompt", "") for uc in use_cases if uc.get("outputs", {}).get("development_prompt", "").strip()]
            dash_prompts = [uc.get("outputs", {}).get("dashboard_prompt", "")   for uc in use_cases if uc.get("outputs", {}).get("dashboard_prompt", "").strip()]
            test_prompts = [uc.get("outputs", {}).get("testing_prompt", "")     for uc in use_cases if uc.get("outputs", {}).get("testing_prompt", "").strip()]

            models = [{
                "name":               "Consolidated Data Model",
                "type":               "aggregation",
                "grain":              f"one row per {primary_entity}",
                "entities":           all_entities,
                "metrics":            all_metrics,
                "dimensions":         all_dimensions,
                "derived_metrics":    [],
                "use_cases":          [uc.get("name", "") for uc in use_cases],
                "development_prompt": "\n\n".join(dev_prompts),
                "reports":            all_reports,
                "dashboard_prompt":   "\n\n".join(dash_prompts),
                "testing_prompt":     "\n\n".join(test_prompts),
            }]

    total_elapsed = round((time.monotonic() - t0) * 1000)

    return {
        "parsed_stories":  parse_result.get("parsed_stories", []),
        "unified_intent":  parse_result.get("unified_intent", {}),
        "conflicts":       parse_result.get("conflicts", []),
        "use_cases":       use_cases,
        "ui_actions":      ui_actions,
        "models":          models,
        "tokens_in":       total_tokens_in,
        "tokens_out":      total_tokens_out,
        "latency_ms":      total_elapsed,
    }
