"""
api/services/knowledge_processor.py
SAI Knowledge Processing Agent — core service logic.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from api.config import settings

# ── Tunable constants ─────────────────────────────────────────────────────────

CONFIDENCE_THRESHOLD = 0.55
# text-embedding-3-small: short queries vs long structured content typically score 0.45-0.60.
# Unrelated content scores 0.25-0.40. Tune up if false positives appear.
# Do NOT use a value below 0.50 without corpus-specific calibration.

CONTEXT_TOKEN_BUDGET = 6000
# Rough token estimate: len(text.split()) * 1.3. Stop adding chunks once budget is exceeded.

DUPLICATE_THRESHOLD = 0.92
# Cosine similarity above which an incoming entry is treated as a near-duplicate.
# Operates on representative_emb (embedding of entry summary), not raw chunks.

CHUNK_WORD_SIZE = 400
CHUNK_WORD_OVERLAP = 50
# Chunking is done deterministically in Python — NOT delegated to the LLM.

SCHEMA_TOKEN_BUDGET = 3000
# Max tokens for the entire schema section of the connections context.
# At ~4 chars/token, 3000 tokens ≈ 12,000 chars — enough for ~60–80 tables.
# Tables that overflow this budget are listed by name only (no column detail).

_PROCESS_SYSTEM_PROMPT = """\
You are an enterprise KB processor. The user will supply content with a Type field.

== IF type is one of: OperationalRule, ValidationRule, ProcessingRule, FailureRule,
   RecoveryRule, ReconciliationRule, OwnershipRule, StopCondition, ExceptionRule ==

Extract ONE atomic operational rule from the content. Return a JSON object with these EXACT keys:

  knowledge_entry: {
    "title":             "Imperative action title <=80 chars — e.g. 'Stop batch when reconciliation fails'",
    "type":              "OperationalRule",
    "op_category":       "ValidationRule|ProcessingRule|FailureRule|RecoveryRule|ReconciliationRule|OwnershipRule|StopCondition|ExceptionRule",
    "trigger_condition": "The exact condition that activates this rule — e.g. 'When reconciliation fails'",
    "action_steps":      ["Concrete action 1", "Concrete action 2"],
    "stop_condition":    "What must stop — e.g. 'Stop Full TRF generation' or null",
    "recovery_steps":    ["Recovery step 1", "Recovery step 2"] or null,
    "severity":          "CRITICAL|HIGH|MEDIUM|LOW",
    "owner_team":        "Responsible team name or null",
    "decision_type":     "CONTINUE|PARTIAL_CONTINUE|STOP|ESCALATE|RETRY|WAIT — guideline only, custom values allowed, or null",
    "execution_scope":   "policy|batch|monthly_cycle|system — guideline only, custom values allowed, or null",
    "depends_on":        ["Title of rule this explicitly depends on"] or [],
    "systems_involved_json": ["System1", "System2"],
    "sql_template":      "SELECT ... or null",
    "summary":           "One operational sentence: WHEN [trigger] → [action]. No explanations.",
    "detailed_explanation": "",
    "key_points": [],
    "decision": "",
    "reason": "One-line reason this rule exists",
    "system": "General",
    "tags": [],
    "is_reusable": true
  }
  status: "READY_FOR_EMBEDDING" or "LOW_QUALITY"
  quality_score: "HIGH"|"MEDIUM"|"LOW"
  suggestions: []

STRICT QUALITY RULES — set status "LOW_QUALITY" and quality_score "LOW" if ANY of these are true:
  - Content describes governance overviews, architecture, financial concepts, or multiple rules
  - trigger_condition cannot be extracted from the content (leave field null and mark LOW_QUALITY)
  - action_steps cannot be extracted (no concrete actions in content — mark LOW_QUALITY)
  - title is descriptive rather than imperative (e.g. "GL Reconciliation Process" is bad; "Stop GL when reconciliation fails" is good)
  - Content is longer than 500 words and covers multiple operational concerns

If LOW_QUALITY, add to suggestions: "Content covers multiple concepts — use Decompose Document to split into atomic rules."

summary field RULE: Write ONLY as an operational assertion — "When X, do Y." NEVER write narrative explanations or governance descriptions.

== IF type is any other value (UseCase, Process, Issue, Architecture, etc.) ==

Extract general KB knowledge. Return a JSON object with these EXACT keys:
  knowledge_entry: {
    "title", "type", "system", "tags" (array), "summary", "detailed_explanation",
    "key_points" (array), "decision", "reason", "is_reusable" (boolean),
    "op_category": "BusinessProcess|ReconRule|Lineage|DCTMapping|IncidentHistory|Remediation|Ownership or null",
    "severity": null,
    "owner_team": "null or extracted team name",
    "systems_involved_json": null,
    "sql_template": null,
    "trigger_condition": null,
    "action_steps": null,
    "stop_condition": null,
    "recovery_steps": null
  }
  status: "READY_FOR_EMBEDDING" or "LOW_QUALITY"
  quality_score: "HIGH", "MEDIUM", or "LOW"
  suggestions: (array of strings)

Return ONLY valid JSON. No markdown fences. No text outside the JSON object."""

_OPERATIONAL_ANSWER_PROMPT = """\
You are SAI (Smart Architect Intelligence), an enterprise architect-level AI assistant.

== KNOWLEDGE AVAILABLE ==
{context}

== PROJECT CONNECTIONS ==
{connections}

== BEHAVIOR RULES ==
1. Answer using ONLY the knowledge and connections shown above.
2. If knowledge or connections are insufficient, say so clearly — do NOT guess.
3. Always reason across ALL available knowledge + connection context together.
4. Identify the involved domains: Conversion, DCT/ADO/DB, Architecture, Tool behavior.
5. Show how systems interact end-to-end using actual project connection names and types.

== RESPONSE FORMAT ==
You have retrieved operational rule entries. Use ONLY the format below — no exceptions.

## Decision Summary
2-3 sentence direct operational answer. State exactly what must happen.
No background context, no governance descriptions, no financial concepts.

## Applicable Rules
| Rule | Trigger | Action | Severity |
|------|---------|--------|----------|
One row per matched rule. Copy exact data from the context above — do NOT invent rows.

## Stop Conditions
List stop rules (StopCondition / FailureRule) from context. Omit this section entirely if none present.

## Recovery Path
Ordered numbered steps from RecoveryRule / ExceptionRule entries. Omit this section entirely if none present.

## Ownership
Team routing from OwnershipRule entries or owner_team fields. Omit this section entirely if none present.

## Rules Referenced
Bullet list of rule titles used from the context above.

STRICTLY FORBIDDEN: Mermaid diagrams, ## Summary, ## Detailed Explanation, ## How Systems Connect,
## Architecture / Flow, ## Key Insights, generic descriptions, governance narratives, financial concepts.

== QUESTION ==
{question}"""


_ANSWER_SYSTEM_PROMPT = """\
You are SAI (Smart Architect Intelligence), an AI assistant embedded in the Data Conversion Studio.
Your primary audience is **developers** — write every response as if explaining to a developer
who is smart but new to this specific codebase and data model.

== TONE AND LANGUAGE (MANDATORY) ==
- Use simple, plain English. Avoid business jargon and enterprise buzzwords.
- Explain WHAT it is, WHY it exists, and HOW a developer would use or change it.
- If a term is technical (e.g. "transient table", "UNION ALL"), explain it briefly in plain words
  the first time: e.g. "a transient table — a temporary table that exists only during the session".
- Prefer short sentences. Break complex logic into bullet points or numbered steps.
- When explaining SQL, describe what each clause does in plain English alongside the code block.
- Always answer the practical question: "What does this mean for me as a developer?"
- Avoid phrases like "facilitates", "consolidates", "orchestrates", "leverages" — say what it
  actually does in plain words.

== SYSTEM FACTS (ground truth — never contradict these) ==
- The Data Conversion Studio processes **XML Manuscript files** (DCT Extract Mapper format), NOT JSON.
- Core file type: ManuScript XML (.xml) containing <extractMap>, <fieldMap>, <properties> elements.
- Key components: Extract Mapper, Field Mapping, LOB Configuration (Auto/Property/GL),
  ManuScript Generator, Intent Parser, Rule Engine, Template Engine.
- Entities mapped: Policy, Risk, Coverage, Account.
- extractRef always targets a table (e.g. Policy.Policy, Policy.InsuredObject, Coverage.Coverage,
  Policy.Account) — NEVER a field name.
- When referencing file types in diagrams or answers, always say "XML Files" or "ManuScript XML",
  never "JSON Files".

== KNOWLEDGE AVAILABLE (includes SQL query library and view definitions) ==
{context}

== PROJECT CONNECTIONS ==
{connections}

== STRICT GROUNDING RULES (MANDATORY — violations are unacceptable) ==

**RULE 1 — ONLY USE RETRIEVED KNOWLEDGE**
Answer using ONLY the knowledge, connections, and System Facts shown above.
NEVER use general industry knowledge, domain assumptions, or training data to fill gaps.
If a specific value (coverage name, field, table, subcoverage, rule, SP name, etc.) does not
appear verbatim in the retrieved knowledge above, you MUST NOT mention it.

**RULE 2 — INSUFFICIENT KNOWLEDGE RESPONSE (use this when knowledge is missing)**
If the retrieved knowledge does not explicitly contain the answer, respond EXACTLY like this:

  ## Knowledge Insufficient
  The available knowledge does not explicitly contain [the requested information].

  **What the retrieved knowledge does state:**
  [Quote or paraphrase only what IS in the KB]

  **What is missing:**
  [Describe specifically what additional KB entries, SQL, or documentation would be needed]

  Do NOT generate plausible-sounding values. Do NOT complete from industry knowledge.

**RULE 3 — DISTINGUISH SOURCES**
Never mix retrieved KB content with industry assumptions. If you reference something,
it must trace back to a specific KB entry title or connection shown above.

**RULE 4 — EXPLICIT NAMES ONLY**
Coverage names, subcoverage names, table names, field names, SP names, XML elements —
list ONLY those that appear word-for-word in the retrieved knowledge.
If they are not there, say "not documented in the available knowledge."

**RULE 5 — CONVERSION / XML DOMAIN**
For questions about XML structure, coverage hierarchies, subcoverages, field mappings,
or SP logic: prioritize exact extraction from KB content. Never infer schema elements
from insurance industry conventions.

**RULE 6 — EXACT EXTRACTION FOR REFERENCE DATA (CRITICAL)**
When the question asks for any of the following, return the EXACT values from the KB —
never replace them with conceptual summaries or categories:
  - Account numbers / GL codes (e.g. 100000, 400000)
  - Account names and mappings
  - Transaction types or codes
  - Source tables, views, stored procedures
  - Product codes, business codes, APRA codes
  - Coverage names, subcoverage names, policy types
  - Field names, XML elements, mapping keys

CORRECT: "400000 - Gross Written Premium"
WRONG:   "Premium Accounts are used for written premium transactions"

If multiple accounts/codes are in the KB, list ALL of them exactly as stored.
Never collapse a list of specific values into a category description.

**RULE 7 — LOOKUP INTENT DETECTION**
If the question contains: "which", "what", "list", "show me", "give me the" combined
with any reference data type above (accounts, codes, tables, views, coverages, fields):
→ This is a LOOKUP question. Return exact values verbatim from KB. No paraphrasing.
→ Format: bullet list of exact values. No prose description unless explicitly asked.

**RULE 8 — PROJECT CONNECTIONS ARE NOT EVIDENCE OF LINEAGE**
The == PROJECT CONNECTIONS == section lists available systems only.
The EXISTENCE of a connection does NOT prove:
  - Where a coverage, field, or entity is stored
  - Which table or schema contains it
  - Which XML path or node contains it
  - Which process produces it
  - Which data lineage path exists
  - Which system owns it
Do NOT infer storage location, source table, schema, XML path, lineage, or
process ownership from a connection name alone. If a connection is named
"POLICY" or "CML_CUSTOM_BRONZE.POLICY", that does NOT mean a coverage is
stored there unless the KB explicitly states it.
When location/lineage is not in the KB: state it is unknown.

**RULE 9 — ARCHITECTURE SECTIONS MUST BE GROUNDED**
Every element in "## How Systems Connect", "## Architecture Diagram", or any
flow diagram (Mermaid) must be explicitly stated in the retrieved KB:
  - Every table name, schema, XML node, process step must appear in KB
  - Every connection/relationship must be stated in KB, not inferred
  - Do NOT generate a lineage or flow based on connection names alone
If the KB does not contain the architecture or lineage:
  Return: "Knowledge Insufficient — the storage location and architecture
  are not documented in the available knowledge."
  Do NOT generate a Mermaid diagram or architecture section based on inference.

== OTHER BEHAVIOR RULES ==
3. Always reason across ALL available knowledge + connection context together.
4. Identify the involved domains: Conversion, DCT/ADO/DB, Architecture, Tool behavior.
5. Show how systems interact end-to-end using actual project connection names and types.
6. In diagrams, use ONLY node labels that appear in the System Facts, KB, or connections above.
7. SQL FORMATTING RULE: Always render SQL inside a fenced code block — no exceptions:
   ```sql
   SELECT ...
   ```
   Never show SQL as plain prose. Show each SQL block separately with a label above it.

== SQL GENERATION MODE ==
When the question asks you to BUILD, WRITE, GENERATE, or CREATE a SQL query:

Step 1 — INTENT CHECK: If the request is ambiguous (missing filter values, date range, aggregation
level, output columns, or target table), ask the user specific clarifying questions BEFORE writing
any SQL. Use this format:
  > Before I write this query, I need a few details:
  > 1. [specific question]
  > 2. [specific question]

Step 2 — REFERENCE VIEWS: Identify which ViewDefinition or QueryLibrary entries from the Knowledge
Available section above are relevant. List them under "## Reference Views/Queries Used".

Step 3 — GENERATE SQL: Build the query using the referenced views/tables as data sources.
Show the final query under "## Generated SQL" with a ```sql block.

Step 4 — EXPLAIN: Briefly explain what the query does, what columns it returns, and any
performance notes (e.g. filter pushdown, row count expectations).

Step 5 — VARIATIONS: Offer 1-2 quick variations (e.g. "filtered by date range", "grouped by month")
as short code blocks so the user can adapt without asking again.

== RESPONSE TYPE SELECTION ==
Read the question and choose ONE of the 4 response modes below. Use ONLY that mode's format.

**Mode A — SQL QUERY** (question asks to write/build/generate/create/show a SQL query or script):
→ Use SQL GENERATION MODE format described above.

**Mode B — ARCHITECTURE** (question asks about system design, components, how something is built,
what talks to what, integration layers, or contains words: architecture, design, components, system, stack):
→ Use Architecture Format:
## Summary
2-3 sentence overview of the architecture.
## Components
Bullet list of the key components and their roles.
## Architecture Diagram
```mermaid
C4Context or flowchart TD/LR showing components and connections
```
Use only names from System Facts and KB. Labels ≤ 40 chars.
## Key Design Decisions
Important trade-offs, constraints, or principles.
## Knowledge & Context Used
List KB entries and connections referenced.

**Mode C — PROCESS / FLOW** (question asks how something works, steps to do X, flow of Y,
walkthrough, process, procedure, or contains words: flow, process, steps, how does, walkthrough):
→ Use Process Format:
## Summary
Brief answer to what the process is and why it matters.
## Process Flow
```mermaid
flowchart TD
  Step1[...] --> Step2[...] --> ...
```
Keep each node label concise (≤ 35 chars). Show decision points with {diamond shapes}.
## Step-by-Step Detail
Numbered steps in plain English. For each step explain: what happens, why it happens,
and what a developer needs to know or watch out for.
## Systems Involved
Which connections, APIs, or systems are touched at each step — and what data moves between them.
## Examples (if applicable)
If the KB contains SQL snippets, transformation logic, field value samples, or concrete
usage examples that illustrate a step — show them here as labelled code blocks.
Only include examples that appear verbatim in the retrieved KB. Never invent examples.
## Key Insights
Important edge cases, failure modes, or best practices.
## Knowledge & Context Used
List KB entries and connections referenced.

**Mode D — FACTUAL / ANALYSIS** (ownership, definitions, validations, comparisons, troubleshooting,
or any question that does NOT fit A, B, or C):
→ Use Standard Format:
## Summary
Short, clear answer (2-4 sentences). For lookup questions (accounts, codes, names, fields):
list the EXACT values from KB here — do NOT defer to later sections.
## Detailed Explanation
Explain in plain English as if talking to a developer who hasn't seen this code before.
Cover: what this object/table/process does, why it exists, and what a developer needs to
understand to work with it safely. If KB contains specific codes/names/numbers, show them
verbatim. NEVER replace exact reference data with category descriptions.
Where the KB contains SQL code, transformation logic, JOIN conditions, or concrete field
mappings — embed them as labelled ```sql code blocks and explain each block in plain English.
## Examples (if applicable)
If the KB contains SQL snippets, sample field values, transformation expressions, or concrete
data examples relevant to the question — show them here verbatim as labelled code blocks.
One label per block, e.g.: **T_Policyattach_002 — filter logic:**
Only show examples that appear word-for-word in the retrieved KB. Never invent examples.
## How Systems Connect
Which systems are involved and how they relate.
## Key Insights / Decisions
Important considerations, best practices, or trade-offs.
## Knowledge & Context Used
List the KB entries and connections referenced.

**IMPORTANT for Mode D lookup questions:**
If KB contains explicit values (account numbers, codes, field names, coverage names) that
directly answer the question — place them as an exact bulleted list in ## Summary.
Do not bury them, summarize them, or replace them with categories.

**Mode E — OPERATIONAL RULES** (choose this FIRST if ANY context entry is prefixed with "[RULE:"):
→ Operational rule data is available. Use ONLY this format — no other sections allowed:
## Decision Summary
2-3 sentence direct operational answer. State what must happen. No background, no governance, no finance concepts.
## Applicable Rules
| Rule | Trigger | Action | Severity |
|------|---------|--------|----------|
(one row per matched rule — copy exact data from context; do NOT invent rows)
## Stop Conditions
List stop rules (StopCondition / FailureRule) from context. Omit section entirely if none present.
## Recovery Path
Ordered numbered steps from RecoveryRule / ExceptionRule entries. Omit section entirely if none present.
## Ownership
Team routing from OwnershipRule entries or owner_team fields. Omit section entirely if none present.
## Rules Referenced
Bullet list of rule titles used.
FORBIDDEN in Mode E: Mermaid diagrams, ## Summary, ## Detailed Explanation, ## How Systems Connect, ## Architecture / Flow, ## Key Insights, generic GL/finance descriptions, governance narratives.

Always include a Mermaid diagram in Mode B and Mode C responses — never skip it.
Diagrams must use only terminology from System Facts and the KB — never invent names.

== QUESTION ==
{question}"""


# ── Pre-processing ────────────────────────────────────────────────────────────

def _preprocess_content(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)         # strip HTML tags
    text = re.sub(r"\r\n|\r", "\n", text)        # normalize line endings
    text = re.sub(r"\n{3,}", "\n\n", text)       # collapse excessive blank lines
    return text.strip()


# ── Chunking ──────────────────────────────────────────────────────────────────

def _chunk_text(text: str, topic: str = "") -> list[dict]:
    """Split text into overlapping word-window chunks deterministically."""
    words = text.split()
    chunks: list[dict] = []
    start = 0
    idx = 1
    while start < len(words):
        end = min(start + CHUNK_WORD_SIZE, len(words))
        chunks.append({
            "chunk_id": idx,
            "content": " ".join(words[start:end]),
            "topic": topic or f"Chunk {idx}",
        })
        if end == len(words):
            break
        start += CHUNK_WORD_SIZE - CHUNK_WORD_OVERLAP
        idx += 1
    return chunks


# ── Prompt template loader ────────────────────────────────────────────────────

def _load_prompt(category: str, name: str, db: Session) -> Optional[str]:
    try:
        from api.models import PromptTemplate
        row = db.query(PromptTemplate).filter_by(
            category=category, name=name, is_active=True
        ).first()
        return row.content if row else None
    except Exception:
        return None


# ── Process entry (LLM structuring) ──────────────────────────────────────────

def process_entry(
    *,
    title: str,
    type: str,
    system: str,
    tags: Optional[list[str]],
    source_type: str,
    raw_content: str,
    model: str = "gpt-4o-mini",
    db: Session,
) -> dict:
    """
    Call LLM to structure raw content into a KnowledgeEntry dict + chunks.
    Returns dict with keys: knowledge_entry, chunks, status, quality_score, suggestions.
    Raises ValueError on JSON parse failure.
    """
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured — cannot process knowledge entry.")

    content = _preprocess_content(raw_content)

    system_prompt = _load_prompt("knowledge", "knowledge_processor", db) or _PROCESS_SYSTEM_PROMPT

    user_msg = (
        f"Type: {type}\n"
        f"System: {system}\n"
        f"Tags: {', '.join(tags or [])}\n"
        f"Source Type: {source_type}\n"
        f"Title: {title}\n\n"
        f"Content:\n{content}"
    )

    from api.services.ai_client import get_client, chat_model as _cm
    client = get_client()
    t0 = time.monotonic()
    resp = client.chat.completions.create(
        model=_cm(model),
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_msg},
        ],
        temperature=0.2,
    )
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw_text = resp.choices[0].message.content or ""

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM returned non-JSON response: {raw_text[:500]}") from exc

    # Ensure expected top-level keys exist
    for key in ("knowledge_entry", "status", "quality_score", "suggestions"):
        if key not in result:
            raise ValueError(f"LLM response missing key '{key}'. Raw: {raw_text[:500]}")

    # Build embeddable content from all structured fields (not just detailed_explanation)
    ke = result["knowledge_entry"]
    parts: list[str] = []
    if ke.get("summary", "").strip():
        parts.append(ke["summary"])
    if ke.get("detailed_explanation", "").strip():
        parts.append(ke["detailed_explanation"])
    for kp_item in ke.get("key_points") or []:
        if str(kp_item).strip():
            parts.append(str(kp_item))
    if ke.get("decision", "").strip():
        parts.append(ke["decision"])
    if ke.get("reason", "").strip():
        parts.append(ke["reason"])
    # Fall back to raw content if LLM produced nothing useful
    if not parts:
        parts.append(raw_content[:CONTEXT_TOKEN_BUDGET * 4])

    combined = "\n\n".join(parts)
    result["chunks"] = _chunk_text(combined, topic=title)

    # For atomic rule entries: one chunk = structured rule signal only (no narrative)
    _RULE_OP_CATS = {
        "ValidationRule", "ProcessingRule", "FailureRule", "RecoveryRule",
        "ReconciliationRule", "OwnershipRule", "StopCondition", "ExceptionRule",
    }
    ke = result["knowledge_entry"]
    if ke.get("type") == "OperationalRule" or ke.get("op_category") in _RULE_OP_CATS:
        rule_parts: list[str] = [ke.get("title") or title]
        if ke.get("op_category"):
            rule_parts.append(f"CATEGORY: {ke['op_category']}")
        if ke.get("trigger_condition"):
            rule_parts.append(f"TRIGGER: {ke['trigger_condition']}")
        action = ke.get("action_steps")
        if action:
            steps = action if isinstance(action, list) else [action]
            rule_parts.append("ACTION: " + " | ".join(str(s) for s in steps))
        if ke.get("stop_condition"):
            rule_parts.append(f"STOP: {ke['stop_condition']}")
        recovery = ke.get("recovery_steps")
        if recovery:
            recs = recovery if isinstance(recovery, list) else [recovery]
            rule_parts.append("RECOVERY: " + " | ".join(str(r) for r in recs))
        if ke.get("severity"):
            rule_parts.append(f"SEVERITY: {ke['severity']}")
        if ke.get("owner_team"):
            rule_parts.append(f"OWNER: {ke['owner_team']}")
        if ke.get("decision_type"):
            rule_parts.append(f"DECISION: {ke['decision_type']}")
        if ke.get("execution_scope"):
            rule_parts.append(f"SCOPE: {ke['execution_scope']}")
        deps = ke.get("depends_on")
        if deps:
            dep_list = deps if isinstance(deps, list) else [deps]
            if dep_list:
                rule_parts.append("DEPENDS ON: " + " | ".join(str(d) for d in dep_list))
        rule_text = "\n".join(rule_parts)
        result["chunks"] = [{"chunk_id": 1, "content": rule_text or combined, "topic": ke.get("title", title)}]

    # Write AI trace (swallow errors)
    try:
        from api.services.ai_trace import store
        store(
            module="knowledge_process",
            conn_id=None,
            model=model,
            prompt=user_msg[:4000],
            response=raw_text[:4000],
            tokens_in=resp.usage.prompt_tokens,
            tokens_out=resp.usage.completion_tokens,
            latency_ms=elapsed_ms,
            db=db,
            schema_snapshot={"entry_title": title, "tags": tags or []},
        )
    except Exception:
        pass

    return result


# ── Document decomposition into atomic rules ─────────────────────────────────

_DECOMPOSE_PROMPT = """\
You are a KB decomposition specialist. Given a document, extract EVERY distinct operational rule,
validation, failure condition, recovery action, ownership mapping, or stop condition as a
SEPARATE entry. Ignore generic prose, introductions, and background information.

Return a JSON array (max 50 items). Each item must be:
{
  "title":             "Imperative rule title (<=80 chars)",
  "type":              "OperationalRule",
  "op_category":       "ValidationRule|ProcessingRule|FailureRule|RecoveryRule|ReconciliationRule|OwnershipRule|StopCondition|ExceptionRule",
  "trigger_condition": "When X occurs",
  "action_steps":      ["Step 1", "Step 2"],
  "stop_condition":    "Stop when Y or null",
  "recovery_steps":    ["Rollback A"] or null,
  "severity":          "CRITICAL|HIGH|MEDIUM|LOW",
  "owner_team":        "Team name or null",
  "decision_type":     "CONTINUE|PARTIAL_CONTINUE|STOP|ESCALATE|RETRY|WAIT or null",
  "execution_scope":   "policy|batch|monthly_cycle|system or null",
  "depends_on":        ["Title of rule this depends on"] or [],
  "systems_involved_json": ["System1", "System2"],
  "sql_template":      "SELECT ... or null",
  "summary":           "One-sentence rule statement"
}

Return ONLY the JSON array. No text outside it."""


def decompose_document(
    *,
    raw_content: str,
    model: str = "gpt-4o-mini",
    db: Session,
) -> list[dict]:
    """
    Decompose a document into N atomic operational rule dicts for preview before save.
    Returns list of knowledge_entry dicts — NOT yet saved to DB.
    """
    from api.services.ai_client import get_client, chat_model as _cm
    if not settings.OPENAI_API_KEY and not settings.use_azure_openai:
        raise RuntimeError("No AI key configured — set OPENAI_API_KEY or AZURE_OPENAI_* in .env")

    content = _preprocess_content(raw_content)
    client = get_client()
    t0 = time.monotonic()
    resp = client.chat.completions.create(
        model=_cm(model),
        messages=[
            {"role": "system", "content": _DECOMPOSE_PROMPT},
            {"role": "user",   "content": content},
        ],
        temperature=0.1,
    )
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw = resp.choices[0].message.content or "[]"

    # Strip markdown fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    raw = re.sub(r"\s*```$", "", raw.strip())

    try:
        entries = json.loads(raw)
        if not isinstance(entries, list):
            entries = []
    except json.JSONDecodeError:
        entries = []

    try:
        from api.services.ai_trace import store
        store(module="knowledge_decompose", conn_id=None, model=model,
              prompt=content[:2000], response=raw[:4000],
              tokens_in=resp.usage.prompt_tokens,
              tokens_out=resp.usage.completion_tokens,
              latency_ms=elapsed_ms, db=db)
    except Exception:
        pass

    return entries[:50]


# ── Embed and store chunks ────────────────────────────────────────────────────

def embed_and_store_chunks(
    *,
    entry_id: int,
    chunks: list[dict],
    summary: str,
    db: Session,
    kb_schema_id: int = None,
    source_file_id: Optional[int] = None,
) -> int:
    """
    Embed each chunk and persist as KnowledgeChunk rows.
    Also embeds summary → stored as representative_emb on the entry.
    Updates entry.embedding_status to 'complete' | 'partial' | 'failed'.
    Returns count of chunks successfully embedded.
    """
    from api.models import KnowledgeEntry, KnowledgeChunk
    from api.services.embeddings import get_embedding

    entry = db.query(KnowledgeEntry).filter_by(id=entry_id).first()
    if not entry:
        return 0

    entry.embedding_status = "pending"
    db.commit()

    # Embed the summary for near-duplicate detection
    if summary and summary.strip():
        try:
            rep_vec = get_embedding(summary[:2000], api_key=settings.OPENAI_API_KEY)
            entry.representative_emb = json.dumps(rep_vec)
            db.commit()
        except Exception as exc:
            print(f"[knowledge] representative_emb failed for entry {entry_id}: {exc}")

    # Embed each chunk
    stored = 0
    for chunk in chunks:
        try:
            vec = get_embedding(chunk["content"], api_key=settings.OPENAI_API_KEY)
            db.add(KnowledgeChunk(
                entry_id=entry_id,
                chunk_index=chunk["chunk_id"],
                content=chunk["content"],
                topic=chunk["topic"],
                embedding=json.dumps(vec),
                kb_schema_id=kb_schema_id,
                source_file_id=source_file_id,
            ))
            stored += 1
        except Exception as exc:
            print(f"[knowledge] chunk {chunk['chunk_id']} embed failed for entry {entry_id}: {exc}")

    if stored == len(chunks):
        entry.embedding_status = "complete"
    elif stored > 0:
        entry.embedding_status = "partial"
    else:
        entry.embedding_status = "failed"

    db.commit()
    return stored


# ── Near-duplicate detection ──────────────────────────────────────────────────

def check_near_duplicate(raw_content: str, db: Session, skip: bool = False) -> Optional[int]:
    """
    Embed the incoming content and compare against existing entries' representative_emb.
    Returns entry.id if a near-duplicate is found, else None.
    """
    if skip:
        return None

    from api.models import KnowledgeEntry
    from api.services.embeddings import get_embedding, cosine_similarity

    try:
        query_vec = get_embedding(raw_content[:2000], api_key=settings.OPENAI_API_KEY)
    except Exception as exc:
        print(f"[knowledge] duplicate check embedding failed: {exc}")
        return None

    entries = db.query(KnowledgeEntry).filter(
        KnowledgeEntry.representative_emb.isnot(None)
    ).all()

    for entry in entries:
        try:
            vec = json.loads(entry.representative_emb)
            score = cosine_similarity(query_vec, vec)
            if score > DUPLICATE_THRESHOLD:
                return entry.id
        except Exception:
            continue

    return None


# ── Semantic search ───────────────────────────────────────────────────────────

def semantic_search(
    query: str,
    top_k: int,
    db: Session,
    exclude_low_quality: bool = True,
    *,
    category: str = None,
    schema_id: int = None,
    entry_ids: list[int] = None,
) -> list[tuple[float, object]]:
    """
    Embed query, compute cosine similarity against stored chunk embeddings.
    Returns top_k (score, KnowledgeChunk) pairs, descending by score.
    Pass schema_id= to scope to a KB schema (uses indexed seek on kb_schema_id).
    Pass category= to filter to a specific op_category.
    Pass entry_ids= to scope to specific KB entries (for file/folder scoped Ask SAI).
    joinedload prevents N+1 when accessing chunk.entry.title later.
    """
    from api.models import KnowledgeChunk, KnowledgeEntry
    from api.services.embeddings import get_embedding, cosine_similarity

    query_vec = get_embedding(query, api_key=settings.OPENAI_API_KEY)

    q = (
        db.query(KnowledgeChunk)
        .options(joinedload(KnowledgeChunk.entry))
        .filter(KnowledgeChunk.embedding.isnot(None))
    )
    # Schema filter uses the denormalized kb_schema_id on chunks (indexed seek, no join needed)
    if schema_id is not None:
        q = q.filter(KnowledgeChunk.kb_schema_id == schema_id)
    # File/folder scope: filter to specific entry IDs (denormalized source_file_id or explicit list)
    if entry_ids is not None:
        q = q.filter(KnowledgeChunk.entry_id.in_(entry_ids))
    if exclude_low_quality or category:
        q = q.join(KnowledgeEntry, KnowledgeChunk.entry_id == KnowledgeEntry.id)
        if exclude_low_quality:
            q = q.filter(KnowledgeEntry.status != "LOW_QUALITY")
        if category:
            q = q.filter(KnowledgeEntry.op_category == category)

    chunks = q.all()
    scored: list[tuple[float, object]] = []
    for chunk in chunks:
        try:
            vec = json.loads(chunk.embedding)
            score = cosine_similarity(query_vec, vec)
            scored.append((score, chunk))
        except Exception:
            continue

    # Boost SQL-type entries when the query looks like a SQL-building request
    sql_request_keywords = {"write", "build", "generate", "create", "show", "give", "query",
                             "select", "sql", "view", "how to query", "example"}
    query_lower = query.lower()
    is_sql_request = any(kw in query_lower for kw in sql_request_keywords)

    boosted: list[tuple[float, object]] = []
    for score, chunk in scored:
        adj = score
        if is_sql_request and chunk.entry.type in ("ViewDefinition", "QueryLibrary", "QueryExample", "SchemaDefinition"):
            adj = min(1.0, score + 0.08)  # small relevance boost for SQL entries on SQL questions
        boosted.append((adj, chunk))

    # Boost operational rule entries when query is decision/failure/recovery oriented
    _RULE_KEYWORDS = {
        "block", "stop", "fail", "error", "exception", "validate", "validation",
        "recover", "recovery", "rollback", "owner", "who handles", "who owns",
        "what happens if", "should i", "how to handle", "rule", "condition",
        "escalate", "escalation", "threshold", "reject", "when does",
    }
    is_rule_request = any(kw in query_lower for kw in _RULE_KEYWORDS)
    _RULE_TYPES = {
        "OperationalRule", "ValidationRule", "ProcessingRule", "FailureRule",
        "RecoveryRule", "ReconciliationRule", "OwnershipRule", "StopCondition", "ExceptionRule",
    }

    boosted2: list[tuple[float, object]] = []
    for score, chunk in boosted:
        is_rule = (
            chunk.entry.type in _RULE_TYPES or
            chunk.entry.op_category in _RULE_TYPES
        )
        if is_rule_request:
            if is_rule:
                adj = min(1.0, score + 0.15)   # boost rules
            else:
                adj = score - 0.25              # penalize generic docs on rule queries
        else:
            adj = score
        boosted2.append((adj, chunk))

    # Time-aware boost: formally approved KB entries get a small relevance bump
    boosted3: list[tuple[float, object]] = []
    for score, chunk in boosted2:
        adj = score
        if getattr(chunk.entry, "approved_at", None) is not None:
            adj = min(1.0, adj + 0.04)
        boosted3.append((adj, chunk))

    boosted3.sort(key=lambda x: x[0], reverse=True)
    return boosted3[:top_k]


def get_operational_knowledge(
    category: str,
    db: Session,
    system: str = None,
    limit: int = 20,
) -> list[dict]:
    """
    Return structured operational knowledge entries for a given op_category.
    Skips embedding search — used when agents know exactly what category they need.
    """
    from api.models import KnowledgeEntry

    q = db.query(KnowledgeEntry).filter(
        KnowledgeEntry.op_category == category,
        KnowledgeEntry.embedding_status == "complete",
    )
    if system:
        q = q.filter(KnowledgeEntry.systems_involved_json.like(f"%{system}%"))
    entries = q.order_by(KnowledgeEntry.updated_at.desc()).limit(limit).all()
    return [
        {
            "id":                   e.id,
            "title":                e.title,
            "op_category":          e.op_category,
            "severity":             e.severity,
            "systems_involved":     json.loads(e.systems_involved_json or "[]"),
            "owner_team":           e.owner_team,
            "sql_template":         e.sql_template,
            "validation_query":     e.validation_query,
            "remediation":          json.loads(e.remediation_json or "{}"),
            "summary":              e.summary,
            "detailed_explanation": e.detailed_explanation,
            "key_points":           json.loads(e.key_points or "[]") if e.key_points else [],
            "quality_score":        e.quality_score,
            "updated_at":           e.updated_at.isoformat() if e.updated_at else None,
        }
        for e in entries
    ]


def get_remediation_for_issue(issue_type: str, system: str, db: Session) -> dict | None:
    """
    Find the best Remediation KB entry for a given issue type and system.
    Returns structured remediation dict or None if no entry found.
    """
    try:
        results = semantic_search(
            f"Remediation workflow for {issue_type} in {system}",
            top_k=1,
            db=db,
            category="Remediation",
        )
        if not results:
            return None
        _, chunk = results[0]
        entry = chunk.entry
        if not entry:
            return None
        return {
            "title":            entry.title,
            "owner_team":       entry.owner_team,
            "remediation":      json.loads(entry.remediation_json or "{}"),
            "validation_query": entry.validation_query,
            "summary":          entry.summary,
        }
    except Exception:
        return None


# ── Rule-aware chunk context formatter ───────────────────────────────────────

_RULE_OP_CATS_SET = {
    "ValidationRule", "ProcessingRule", "FailureRule", "RecoveryRule",
    "ReconciliationRule", "OwnershipRule", "StopCondition", "ExceptionRule",
}


def _format_chunk_context(score: float, chunk, sql_block: str) -> str:
    entry = chunk.entry
    if entry.type == "OperationalRule" or entry.op_category in _RULE_OP_CATS_SET:
        lines = [f"[score={score:.2f}] [RULE: {entry.title}]"]
        has_structure = False
        if entry.trigger_condition:
            lines.append(f"  TRIGGER: {entry.trigger_condition}")
            has_structure = True
        if entry.action_steps:
            try:
                steps = json.loads(entry.action_steps)
                lines.append("  ACTION: " + " | ".join(str(s) for s in steps))
            except Exception:
                lines.append(f"  ACTION: {entry.action_steps}")
            has_structure = True
        if entry.stop_condition:
            lines.append(f"  STOP CONDITION: {entry.stop_condition}")
            has_structure = True
        if entry.recovery_steps:
            try:
                recs = json.loads(entry.recovery_steps)
                lines.append("  RECOVERY: " + " | ".join(str(r) for r in recs))
            except Exception:
                lines.append(f"  RECOVERY: {entry.recovery_steps}")
            has_structure = True
        if not has_structure:
            # Entry predates structured fields — surface chunk content so LLM has something
            lines.append(f"  {chunk.content}")
        sev = entry.severity or ""
        own = entry.owner_team or ""
        if sev or own:
            lines.append(f"  SEVERITY: {sev}" + (f" | OWNER: {own}" if own else ""))
        # Phase 3 orchestration fields
        if getattr(entry, "decision_type", None):
            lines.append(f"  DECISION: {entry.decision_type}")
        if getattr(entry, "execution_scope", None):
            lines.append(f"  SCOPE: {entry.execution_scope}")
        _deps_raw = getattr(entry, "depends_on", None)
        if _deps_raw:
            try:
                _dep_list = json.loads(_deps_raw)
                if _dep_list:
                    lines.append("  DEPENDS ON: " + " | ".join(str(d) for d in _dep_list))
            except Exception:
                lines.append(f"  DEPENDS ON: {_deps_raw}")
        if sql_block:
            lines.append(sql_block)
        return "\n".join(lines)
    return f"[score={score:.2f}] [{entry.title}] {chunk.content}{sql_block}"


# ── Connection context builder ────────────────────────────────────────────────

def _build_connections_metadata(project_id: int, db: Session) -> str:
    """Return connection names and types only — no schema detail. Used when KB already answers."""
    from api.models import SourceConnection
    conns = (
        db.query(SourceConnection)
        .filter(
            (SourceConnection.project_id == project_id) | (SourceConnection.project_id.is_(None)),
            SourceConnection.is_active == True,
        )
        .order_by(SourceConnection.name)
        .all()
    )
    if not conns:
        return "(No connections configured for this project)"
    lines = []
    for c in conns:
        if c.source_type == "snowflake":
            lines.append(f"- [{c.name}] Snowflake | DB: {c.sf_database or 'n/a'} | Schema: {c.sf_schema or 'n/a'}")
        else:
            lines.append(f"- [{c.name}] {c.source_type} ({c.dialect or 'sql'}) | DB: {c.database_name or 'n/a'} | Schema: {c.schema_name or 'dbo'}")
    return "\n".join(lines)


def _build_connections_context(project_id: int, db: Session) -> str:
    """Return a plain-text summary of all active connections + their catalog schema."""
    from api.models import SourceConnection, CatalogColumn, CatalogRelation
    from collections import defaultdict

    conns = (
        db.query(SourceConnection)
        .filter(
            (SourceConnection.project_id == project_id) | (SourceConnection.project_id.is_(None)),
            SourceConnection.is_active == True,
        )
        .order_by(SourceConnection.name)
        .all()
    )
    if not conns:
        return "(No connections configured for this project)"

    lines = []
    for c in conns:
        if c.source_type == "snowflake":
            lines.append(
                f"Connection: [{c.name}] Type: Snowflake | "
                f"Account: {c.sf_account or 'n/a'} | "
                f"Database: {c.sf_database or 'n/a'} | "
                f"Schema: {c.sf_schema or 'n/a'}"
            )
        else:
            lines.append(
                f"Connection: [{c.name}] Type: {c.source_type} ({c.dialect or 'sql'}) | "
                f"Host: {c.host or 'n/a'} | "
                f"Database: {c.database_name or 'n/a'} | "
                f"Schema: {c.schema_name or 'dbo'}"
            )

        # ── Schema details from catalog ───────────────────────────────────────
        catalog_cols = (
            db.query(CatalogColumn)
            .filter(CatalogColumn.conn_id == c.id)
            .order_by(CatalogColumn.table_name, CatalogColumn.ordinal_position)
            .all()
        )
        if catalog_cols:
            # Group columns by table
            tables: dict[str, list[CatalogColumn]] = defaultdict(list)
            for col in catalog_cols:
                tables[col.table_name].append(col)

            table_names = sorted(tables.keys())
            lines.append(f"  Tables ({len(table_names)}): {', '.join(table_names)}")

            # Emit column detail per table until schema token budget is exhausted
            schema_chars = sum(len(l) for l in lines)
            schema_char_budget = SCHEMA_TOKEN_BUDGET * 4  # ~4 chars per token
            overflow: list[str] = []
            for tbl in table_names:
                if schema_chars >= schema_char_budget:
                    overflow.append(tbl)
                    continue
                cols = tables[tbl]
                col_parts = []
                for col in cols:
                    tag = " (PK)" if col.is_primary_key else ""
                    col_parts.append(f"{col.column_name}:{col.data_type or '?'}{tag}")
                row = f"  {tbl}: {', '.join(col_parts)}"
                lines.append(row)
                schema_chars += len(row)

            if overflow:
                lines.append(f"  (Column detail omitted for {len(overflow)} tables due to size limit: {', '.join(overflow)})")

            # FK relationships (cap at 100 to avoid runaway output)
            relations = (
                db.query(CatalogRelation)
                .filter(CatalogRelation.conn_id == c.id)
                .order_by(CatalogRelation.parent_table)
                .limit(100)
                .all()
            )
            if relations:
                lines.append("  Foreign Keys:")
                for rel in relations:
                    lines.append(
                        f"    {rel.parent_table}.{rel.parent_column} → "
                        f"{rel.referenced_table}.{rel.referenced_column}"
                    )
        else:
            lines.append("  (No schema collected — run Admin → Collect Schema first)")

    return "\n".join(lines)


# ── Session context helper (weighted multi-layer retrieval) ──────────────────

_SESSION_CONTEXT_TOKEN_BUDGET = 1500

def _get_weighted_session_context(schema_id: int, db: Session) -> str:
    """
    Fetch recent APPROVED session artifacts for this schema, ordered by priority:
      1. Decisions (APPROVED, most recent first)
      2. Requirements (APPROVED or PENDING_REVIEW, most recent first)
      3. TechnicalMetadata (any status, most recent)
    Returns a formatted string for injection into the LLM context.
    Token-budget capped at _SESSION_CONTEXT_TOKEN_BUDGET.
    """
    from api.models import SessionArtifact, RequirementSession

    # Priority 1: Approved decisions
    decisions = (
        db.query(SessionArtifact)
        .join(RequirementSession, SessionArtifact.session_id == RequirementSession.id)
        .filter(SessionArtifact.kb_schema_id == schema_id)
        .filter(SessionArtifact.artifact_type == "Decision")
        .filter(SessionArtifact.status == "APPROVED")
        .order_by(RequirementSession.meeting_datetime.desc().nullslast())
        .limit(8)
        .all()
    )

    # Priority 2: Recent requirements
    requirements = (
        db.query(SessionArtifact)
        .join(RequirementSession, SessionArtifact.session_id == RequirementSession.id)
        .filter(SessionArtifact.kb_schema_id == schema_id)
        .filter(SessionArtifact.artifact_type == "Requirement")
        .filter(SessionArtifact.status.in_(["APPROVED", "PENDING_REVIEW"]))
        .order_by(RequirementSession.meeting_datetime.desc().nullslast())
        .limit(6)
        .all()
    )

    # Priority 3: Technical metadata
    tech = (
        db.query(SessionArtifact)
        .join(RequirementSession, SessionArtifact.session_id == RequirementSession.id)
        .filter(SessionArtifact.kb_schema_id == schema_id)
        .filter(SessionArtifact.artifact_type == "TechnicalMetadata")
        .order_by(RequirementSession.meeting_datetime.desc().nullslast())
        .limit(5)
        .all()
    )

    lines: list[str] = []
    token_used = 0

    for group_label, items in [
        ("DECISIONS", decisions),
        ("REQUIREMENTS", requirements),
        ("TECHNICAL METADATA", tech),
    ]:
        if not items:
            continue
        group_lines = [f"[{group_label}]"]
        for a in items:
            desc = (a.description or "")[:200]
            line = f"- {a.artifact_code}: {a.title}" + (f" — {desc}" if desc else "")
            est = int(len(line.split()) * 1.3)
            if token_used + est > _SESSION_CONTEXT_TOKEN_BUDGET:
                break
            group_lines.append(line)
            token_used += est
        if len(group_lines) > 1:
            lines.extend(group_lines)

    return "\n".join(lines)


# ── Content Block Helpers ─────────────────────────────────────────────────────

_RESPONSE_TYPE_INSTRUCTIONS: dict[str, str] = {
    "answer": "",   # default — no extra instruction
    "teach_me": (
        "\n\n== RESPONSE FORMAT: TEACH ME ==\n"
        "Structure your response as a lesson. Explain the concept from first principles, use analogies "
        "where helpful, then show a real-world example from the knowledge base. End with 2-3 key takeaways "
        "in a **Key Takeaways** section."
    ),
    "generate": (
        "\n\n== RESPONSE FORMAT: GENERATE ==\n"
        "Detect the type of artifact needed from the question and knowledge context, then generate it fully.\n\n"
        "Structure your response EXACTLY as follows:\n\n"
        "**1. Artifact** — The main deliverable in a properly-labelled fenced code block (```sql, ```python, ```xml, etc.).\n"
        "   - For SQL: include WITH clauses for readability, inline `-- comments` on every non-obvious line, "
        "alias every column, add a WHERE clause with placeholder values the user should replace.\n"
        "   - For code/scripts: include a docstring/header block explaining purpose, inputs, outputs.\n"
        "   - For templates/config: annotate every field with an inline comment.\n\n"
        "**2. What this generates** — 2-3 sentences: what data/output it produces and when to use it.\n\n"
        "**3. Parameters to customise** — bulleted list of values the user must replace or configure "
        "(table names, thresholds, date ranges, system names). Mark required items with ⚠️.\n\n"
        "**4. Edge cases / gotchas** — numbered list of things that might break or need checking "
        "(nulls, duplicates, timezone, permissions, large data volumes). Skip if none apply.\n\n"
        "**5. How to verify** — one SQL `SELECT` or test step to confirm the output is correct.\n\n"
        "Do NOT add prose paragraphs between sections. Keep each section tight."
    ),
    "review": (
        "\n\n== RESPONSE FORMAT: REVIEW ==\n"
        "Provide a structured review using exactly these sections:\n"
        "**What it does** — one paragraph summary\n"
        "**Issues found** — numbered list of problems (or 'None found')\n"
        "**Recommendations** — numbered list of improvements\n"
        "**Risk level** — CRITICAL / HIGH / MEDIUM / LOW with one-sentence justification"
    ),
    "troubleshoot": (
        "\n\n== RESPONSE FORMAT: TROUBLESHOOT ==\n"
        "Diagnose step-by-step:\n"
        "1. **Likely root causes** — ranked by probability with explanation\n"
        "2. **Diagnostic checks** — SQL queries or steps to confirm each cause\n"
        "3. **Resolution steps** — numbered fix for each cause\n"
        "4. **Prevention** — how to avoid this in future"
    ),
    "plan": (
        "\n\n== RESPONSE FORMAT: IMPLEMENTATION PLAN ==\n"
        "Produce a phased implementation plan:\n"
        "- Number each phase clearly (Phase 1, Phase 2, ...)\n"
        "- Under each phase list tasks as checkboxes (- [ ] Task)\n"
        "- Note dependencies between phases\n"
        "- Flag risks or blockers with a ⚠️ prefix\n"
        "- End with an **Estimated Effort** section if inferable from the knowledge base"
    ),
    "summary": (
        "\n\n== RESPONSE FORMAT: EXECUTIVE SUMMARY ==\n"
        "Audience: business stakeholders with no deep technical background.\n"
        "Format:\n"
        "**Context** — 2-3 sentences on what this is and why it matters\n"
        "**Key Points** — 5-8 bullet points, business-language only\n"
        "**Bottom Line** — one sentence recommendation or status\n"
        "Avoid SQL, code blocks, and jargon unless unavoidable."
    ),
}


def _call_vision_api(image_b64: str, user_hint: str = "") -> str:
    """Send a base64 image to the vision model and return a text description."""
    from api.services.ai_client import get_client
    client = get_client()
    hint = f" The user says: {user_hint}" if user_hint else ""
    try:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Analyze this image and provide a detailed description suitable for a knowledge base.{hint} "
                            "Include: what the image shows, any diagrams/flows/tables/charts present, "
                            "key data or labels visible, and what process or concept it illustrates."
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_b64}", "detail": "high"},
                    },
                ],
            }],
            max_tokens=1000,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        return f"[Vision analysis failed: {e}]"


def _combine_blocks(blocks: list[dict]) -> str:
    """Combine rich content blocks into a single structured text string for LLM processing.
    Each named block gets a labelled header so Ask SAI can reference blocks by name."""
    parts: list[str] = []
    for block in blocks:
        btype = (block.get("block_type") or "text").lower()
        name  = (block.get("name") or "").strip()
        content = (block.get("content") or "").strip()
        explanation = (block.get("explanation") or "").strip()
        vision = (block.get("vision_text") or "").strip()
        fname = block.get("file_name") or ""

        # Named label — Ask SAI can reference by this name
        label = name if name else (fname or btype.upper())

        if btype == "text":
            if content:
                parts.append(f"=== {label} (TEXT NOTE) ===\n{content}")
            if explanation:
                parts.append(f"=== {label} CONTEXT ===\n{explanation}")

        elif btype == "image":
            if vision:
                parts.append(f"=== {label} (IMAGE ANALYSIS) ===\n{vision}")
            if explanation:
                parts.append(f"=== {label} CONTEXT ===\n{explanation}")

        elif btype == "sql":
            if content:
                parts.append(f"=== {label} (SQL QUERY) ===\n```sql\n{content}\n```")
            if explanation:
                parts.append(f"=== {label} PURPOSE ===\n{explanation}")

        elif btype == "document":
            if content:
                parts.append(f"=== {label} (DOCUMENT) ===\n{content}")
            if explanation:
                parts.append(f"=== {label} CONTEXT ===\n{explanation}")

        elif btype == "transcript":
            if content:
                parts.append(f"=== {label} (TRANSCRIPT) ===\n{content}")
            if explanation:
                parts.append(f"=== {label} CONTEXT ===\n{explanation}")

        else:
            if content:
                parts.append(f"=== {label} ({btype.upper()}) ===\n{content}")

    return "\n\n".join(parts)


# ── Reference Value Extractor (prevents hallucination / summarization) ────────

_LOOKUP_TRIGGER_PATTERNS = [
    r'\bwhich\b.{0,30}\b(account|gl|code|number|mapping|coverage|subcover|field|table|view|sp|procedure|rule)\b',
    r'\bwhat\b.{0,20}\b(account|gl account|account number|account code|gl code|coverage|subcover)\b',
    r'\blist\b.{0,30}\b(account|gl|coverage|code|mapping|field|table|view)\b',
    r'\bshow\b.{0,30}\b(account|gl|mapping|coverage|code)\b',
    r'\bgive me\b.{0,30}\b(account|gl|code|coverage|mapping)\b',
    r'\bgl accounts?\b',
    r'\baccount numbers?\b',
    r'\baccount mapping\b',
    r'\bsubcoverage\b',
    r'\bsubcover\b',
    r'\bwhat account\b',
    r'\bwhich account\b',
    r'\baccount.{0,15}(used for|for)\b',
    r'\baccount.{0,15}(gst|premium|creditor|debtor|payment)\b',
]

_REFERENCE_PATTERNS = [
    # GL account numbers: 5-7 digit code - Name  (e.g. "400000 - Gross Written Premium")
    (r'\b(\d{5,7})\s*[-–:]\s*([A-Za-z][A-Za-z0-9 /&,()\']{2,60})', 'account'),
    # Short alphanumeric codes with digits: must contain at least one digit (e.g. "GL001 - Name")
    # Excludes pure-word abbreviations like "KPI", "UPR", "GST" without digits
    (r'\b([A-Z]{2,5}\d{1,4})\s*[-–:]\s*([A-Za-z][A-Za-z0-9 /&,()\']{2,60})', 'code'),
]


def _extract_reference_values(question: str, used_results: list,
                               raw_content_cache: dict | None = None) -> str:
    """
    Detect lookup-intent questions and pre-extract exact structured values
    (account numbers, codes) from retrieved KB chunks.
    raw_content_cache: pre-fetched {chunk_id: raw_content} captured before
    any other DB calls expire the SQLAlchemy objects.
    Returns a mandatory injection block for the LLM prompt, or empty string.
    """
    import re as _re

    q_lower = question.lower()
    is_lookup = any(_re.search(p, q_lower, _re.IGNORECASE) for p in _LOOKUP_TRIGGER_PATTERNS)
    if not is_lookup:
        return ""

    # Scan all retrieved chunks for reference values
    found_accounts: list[str] = []

    for _, chunk in used_results:
        content = chunk.content or ""
        # Use pre-cached raw_content (avoids expired ORM object access)
        if raw_content_cache is not None:
            raw = raw_content_cache.get(chunk.id, "") or ""
        else:
            try:
                raw = chunk.entry.raw_content or ""
            except Exception:
                raw = ""
        full_text = content + "\n" + raw

        for pattern, kind in _REFERENCE_PATTERNS:
            for m in _re.finditer(pattern, full_text):
                val = f"{m.group(1)} - {m.group(2).strip().rstrip('.,;')}"
                if val not in found_accounts and len(val) < 120:
                    found_accounts.append(val)

    if not found_accounts:
        return ""

    lines = [
        "", "",
        "== MANDATORY: EXACT VALUES FOUND IN RETRIEVED KNOWLEDGE ==",
        "These values exist verbatim in the KB. You MUST include ALL of them in your response.",
        "List them exactly — do NOT summarize, group, or replace with category names.",
        "",
    ]
    for v in found_accounts:
        lines.append(f"  • {v}")
    lines.extend([
        "",
        "BEGIN your ## Summary with this exact list as bullet points.",
        "Only use Knowledge-Insufficient logic if NO values were found above.",
        "=========================================================",
    ])
    return "\n".join(lines)


# ── Ask SAI ───────────────────────────────────────────────────────────────────

def _build_schema_embedding_context(conn_id: int, question: str, db: Session, top_n: int = 15) -> str:
    """
    Embed the question, then find the top-N most semantically similar columns
    from conversion_column_embeddings for the given connection.
    Returns a formatted context block for injection into the LLM prompt.
    """
    from api.models import ColumnEmbedding, SourceConnection
    from api.services.embeddings import get_embedding, cosine_similarity

    # Load all embeddings for this connection
    rows = (
        db.query(ColumnEmbedding)
        .filter(ColumnEmbedding.conn_id == conn_id)
        .filter(ColumnEmbedding.embedding_json.isnot(None))
        .all()
    )
    if not rows:
        return ""

    try:
        q_emb = get_embedding(question)
    except Exception:
        return ""

    # Score each column
    scored: list[tuple[float, ColumnEmbedding]] = []
    for row in rows:
        try:
            col_emb = json.loads(row.embedding_json)
            score = cosine_similarity(q_emb, col_emb)
            scored.append((score, row))
        except Exception:
            continue

    if not scored:
        return ""

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:top_n]

    # Get connection info for context header
    conn = db.query(SourceConnection).filter_by(id=conn_id).first()
    conn_label = conn.name if conn else f"Connection {conn_id}"
    dialect = getattr(conn, "dialect", "") or getattr(conn, "source_type", "sql")

    # Group by table
    from collections import defaultdict
    tables: dict[str, list[tuple[float, ColumnEmbedding]]] = defaultdict(list)
    for score, row in top:
        tables[row.table_name].append((score, row))

    lines = [f"== RELEVANT SCHEMA from [{conn_label}] (dialect: {dialect}) =="]
    for tbl, cols in sorted(tables.items()):
        col_parts = []
        for score, row in sorted(cols, key=lambda x: x[0], reverse=True):
            col_parts.append(f"{row.column_name} (score:{score:.2f})")
        lines.append(f"  Table {tbl}: {', '.join(col_parts)}")

    # Include column definitions for top-5 highest scorers
    top5 = sorted(top, key=lambda x: x[0], reverse=True)[:5]
    if any(r.column_definition for _, r in top5):
        lines.append("")
        lines.append("Top column details:")
        for score, row in top5:
            if row.column_definition:
                lines.append(f"  [{row.table_name}.{row.column_name}] {row.column_definition}")

    return "\n".join(lines)


def ask_sai(
    *,
    question: str,
    asked_by: Optional[str] = None,
    top_k: int = 5,
    model: str = "gpt-4o-mini",
    project_id: Optional[int] = None,
    history: list[dict] | None = None,
    schema_id: int = None,
    response_type: str = "answer",
    conn_id: Optional[int] = None,
    db: Session,
    scope: str = "kb",
    file_ids: list[int] = None,
    folder_ids: list[int] = None,
) -> dict:
    """
    Semantic search → LLM answer synthesis.
    Falls through to connection/schema context even when KB confidence is below threshold.
    Only returns UNANSWERED when both KB and schema context are empty.
    When conn_id is provided, also searches column embeddings for that connection
    and injects the most relevant schema elements into the LLM context.
    schema_id scopes semantic search to a KB schema (GL, AR, etc.) for domain-aware answers.
    scope/file_ids/folder_ids scope search to specific AFS documents (existing behaviour unchanged when omitted).
    """
    # Resolve scope → entry_ids filter
    resolved_entry_ids = None
    if scope in ("files", "folders") and (file_ids or folder_ids):
        from api.models import AfsFile as _AfsFile, KnowledgeEntry as _KESco
        source_file_ids = list(file_ids or [])
        if folder_ids:
            rows = db.query(_AfsFile.id).filter(_AfsFile.folder_id.in_(folder_ids)).all()
            source_file_ids += [r[0] for r in rows]
        if source_file_ids:
            resolved_entry_ids = [r[0] for r in
                db.query(_KESco.id)
                  .filter(_KESco.source_file_id.in_(source_file_ids)).all()]
            if not resolved_entry_ids:
                resolved_entry_ids = [-1]  # no entries → return no results

    # When scoped to specific files/folders, raise top_k so more of the document
    # is visible — broad questions like "explain this file" need more context.
    if resolved_entry_ids and resolved_entry_ids != [-1]:
        top_k = max(top_k, 20)

    # If file/folder scope was requested but those files have no extracted KB entries,
    # don't silently fall back to project schema context — return a clear message.
    if resolved_entry_ids == [-1]:
        return {
            "status": "UNANSWERED",
            "message": "The selected file(s) have not been extracted into the Knowledge Base yet.",
            "question": question,
            "detected_tags": {"system": "General", "category": "General", "type": "Question"},
            "suggested_tags": [],
            "reason": "No KB entries found for the selected file(s). Extract the file first via Documents → Extract Knowledge.",
            "action": "Go to the Documents tab, select the file, and click 'Extract Knowledge', then ask again.",
        }

    results = semantic_search(question, top_k, db, schema_id=schema_id,
                              entry_ids=resolved_entry_ids)

    # ── Extract reference values NOW, before any other DB calls expire the objects ──
    # SQLAlchemy expires ORM objects after subsequent queries. chunk.entry.raw_content
    # must be read immediately while the session still has fresh data.
    # We cache raw_content keyed by chunk id to avoid re-accessing expired objects later.
    _raw_content_cache: dict[int, str] = {}
    for _, chunk in results:
        try:
            rc = chunk.entry.raw_content or ""
            _raw_content_cache[chunk.id] = rc
        except Exception:
            _raw_content_cache[chunk.id] = ""

    # Is the top KB result a confident match?
    top_score = results[0][0] if results else 0.0
    kb_confident = top_score >= CONFIDENCE_THRESHOLD

    # Operational rule entries use a lower confidence floor (0.42) because:
    # - Rule chunks are short and structured, naturally scoring lower than narrative docs
    # - False positives on operational queries are less harmful than missed answers
    _RULE_CONFIDENCE_FLOOR = 0.42
    _top_is_rule = bool(results) and (
        results[0][1].entry.type in _RULE_OP_CATS_SET or
        results[0][1].entry.op_category in _RULE_OP_CATS_SET or
        results[0][1].entry.type == "OperationalRule"
    )
    if not kb_confident and _top_is_rule and top_score >= _RULE_CONFIDENCE_FLOOR:
        kb_confident = True   # treat as confident for operational questions

    # Build connections block.
    # When KB is already a strong hit: send metadata only (connection names/types).
    # When KB is weak or absent: send full schema so the LLM can reason over data structures.
    if not project_id:
        connections_block = "(No project context provided)"
    elif kb_confident:
        connections_block = _build_connections_metadata(project_id, db)
    else:
        connections_block = _build_connections_context(project_id, db)

    # Determine whether schema was collected (block contains table info)
    schema_available = not kb_confident and project_id and "Tables (" in connections_block

    # For lookup queries: if the extractor found exact values in raw_content even though
    # chunk similarity score is below threshold, treat as confident — the exact values
    # ARE present in the KB, the low score is because chunks are indexed from LLM summaries
    # rather than raw content. Pre-check before UNANSWERED gate.
    _early_mandatory = _extract_reference_values(question, results, _raw_content_cache)
    if not kb_confident and _early_mandatory:
        kb_confident = True  # we have exact values to return; answer the question

    # Only queue as Open Question when we have nothing to answer with
    if not kb_confident and not schema_available:
        try:
            _persist_open_question(question, asked_by, db)
        except Exception:
            pass  # Never let open question logging crash the ask response
        return _build_unanswered_dict(question, "General", "General")

    # Build KB context with token budget, always include results above soft floor
    context_parts: list[str] = []
    used_results: list[tuple[float, object]] = []
    token_count = 0
    seen_sql_entries: set[int] = set()
    for score, chunk in results:
        # Always include top result; skip extras below threshold
        is_top = len(used_results) == 0
        if not is_top and score < CONFIDENCE_THRESHOLD:
            break
        est_tokens = int(len(chunk.content.split()) * 1.3)
        if token_count + est_tokens > CONTEXT_TOKEN_BUDGET:
            break
        # For ViewDefinition / QueryExample entries, show the full sql_template once
        entry = chunk.entry
        sql_block = ""
        if entry.type in ("ViewDefinition", "QueryExample", "QueryLibrary", "SchemaDefinition") and \
                entry.sql_template and entry.id not in seen_sql_entries:
            sql_tokens = int(len(entry.sql_template.split()) * 1.3)
            if token_count + sql_tokens <= CONTEXT_TOKEN_BUDGET:
                seen_sql_entries.add(entry.id)
                sql_block = f"\n```sql\n{entry.sql_template}\n```"
                token_count += sql_tokens  # account for sql in budget
        context_parts.append(_format_chunk_context(score, chunk, sql_block))
        used_results.append((score, chunk))
        token_count += est_tokens

    kb_context = "\n\n".join(context_parts) if context_parts else "(No matching KB entries — answer from Project Connections/Schema below)"

    # Schema label: tell the LLM which domain is scoped
    schema_label = ""
    if schema_id is not None:
        try:
            from api.models import KnowledgeSchema as _KS
            _ks = db.query(_KS).filter_by(id=schema_id).first()
            if _ks:
                schema_label = f"== KNOWLEDGE SCOPED TO SCHEMA: {_ks.name} ==\n\n"
        except Exception:
            pass

    # Weighted session context: recent APPROVED decisions and requirements for this schema
    session_ctx = ""
    if schema_id is not None:
        try:
            session_ctx = _get_weighted_session_context(schema_id, db)
        except Exception:
            pass

    # Technical context: inject from most recent session with technical_context_json for this schema
    tech_ctx_block = ""
    if schema_id is not None:
        try:
            from api.models import RequirementSession as _RS
            _recent = (db.query(_RS)
                       .filter(_RS.kb_schema_id == schema_id)
                       .filter(_RS.technical_context_json.isnot(None))
                       .order_by(_RS.created_at.desc())
                       .first())
            if _recent and _recent.technical_context_json:
                _label = _recent.source_system or "schema"
                tech_ctx_block = f"== TECHNICAL CONTEXT ({_label}) ==\n{_recent.technical_context_json}\n\n"
        except Exception:
            pass

    # Schema embedding context — find most relevant columns for this question
    schema_emb_block = ""
    if conn_id:
        try:
            schema_emb_block = _build_schema_embedding_context(conn_id, question, db)
        except Exception:
            pass

    context = (
        schema_label
        + tech_ctx_block
        + kb_context
        + (("\n\n== RECENT APPROVED SESSION DECISIONS / REQUIREMENTS ==\n" + session_ctx) if session_ctx else "")
        + (("\n\n" + schema_emb_block) if schema_emb_block else "")
    )

    # Detect whether retrieved context contains operational rule entries.
    # When rules are present, bypass the DB prompt template entirely — DB templates may have
    # conflicting "MANDATORY" format instructions (e.g. 6-section doc format) that override Mode E.
    _rule_entry_count = sum(
        1 for _, chunk in used_results
        if chunk.entry.type in _RULE_OP_CATS_SET or chunk.entry.op_category in _RULE_OP_CATS_SET
        or chunk.entry.type == "OperationalRule"
    )

    if _rule_entry_count > 0:
        system_template = _OPERATIONAL_ANSWER_PROMPT
    else:
        system_template = _load_prompt("knowledge", "ask_sai_answer", db) or _ANSWER_SYSTEM_PROMPT

    # ── Pre-extract exact reference values and inject into CONTEXT (not appendix) ──
    # Use the pre-cached raw_content to avoid SQLAlchemy expiry issues.
    _mandatory_block = _extract_reference_values(question, used_results, _raw_content_cache)
    if _mandatory_block:
        context = context + _mandatory_block

    # Inject response-type formatting instruction
    _format_instruction = _RESPONSE_TYPE_INSTRUCTIONS.get(response_type, "")
    prompt_text = system_template.format(
        context=context,
        connections=connections_block,
        question=question,
    ) + _format_instruction

    # Debug log: confirm mandatory values reached the context
    if _mandatory_block:
        print(f"[ask_sai] MANDATORY BLOCK INJECTED ({len(_mandatory_block)} chars). "
              f"Values found: {_mandatory_block.count('•')}. "
              f"Context now {len(context)} chars.")

    from api.services.ai_client import get_client, chat_model as _cm
    client = get_client()

    # Build message chain: system prompt + prior turns (last 6) + current question
    messages: list[dict] = [{"role": "system", "content": prompt_text}]
    for turn in (history or [])[-6:]:
        role = turn.get("role", "")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            # Assistant turns may be the full AskSAIResult dict — extract the answer text
            if isinstance(content, dict):
                content = content.get("answer", str(content))
            messages.append({"role": role, "content": str(content)[:2000]})
    messages.append({"role": "user", "content": question})

    t0 = time.monotonic()
    resp = client.chat.completions.create(
        model=_cm(model),
        messages=messages,
        temperature=0.3,
    )
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    answer = resp.choices[0].message.content or ""

    try:
        from api.services.ai_trace import store
        store(
            module="knowledge",
            conn_id=None,
            model=model,
            prompt=prompt_text[:4000],
            response=answer[:4000],
            tokens_in=resp.usage.prompt_tokens,
            tokens_out=resp.usage.completion_tokens,
            latency_ms=elapsed_ms,
            db=db,
            schema_snapshot={"question": question[:200]},
        )
    except Exception:
        pass

    # Build deterministic operational payload from matched rule entries (not LLM output)
    _DECISION_PRIORITY = {"STOP": 0, "ESCALATE": 1, "RETRY": 2, "PARTIAL_CONTINUE": 3, "CONTINUE": 4, "WAIT": 5}
    operational: dict | None = None
    if _rule_entry_count > 0:
        _all_actions: list[str] = []
        _all_owners: list[str] = []
        _all_recovery: list[str] = []
        _all_stops: list[str] = []
        _all_depends: list[str] = []
        _all_titles: list[str] = []
        _all_scopes: list[str] = []
        _all_severities: list[str] = []
        _decision_candidates: list[str] = []

        for _, chunk in used_results:
            e = chunk.entry
            if e.type not in _RULE_OP_CATS_SET and e.op_category not in _RULE_OP_CATS_SET and e.type != "OperationalRule":
                continue
            _all_titles.append(e.title)
            # Actions
            if e.action_steps:
                try:
                    _all_actions.extend(json.loads(e.action_steps))
                except Exception:
                    _all_actions.append(str(e.action_steps))
            # Owners
            if e.owner_team and e.owner_team not in _all_owners:
                _all_owners.append(e.owner_team)
            # Recovery
            if e.recovery_steps:
                try:
                    _all_recovery.extend(json.loads(e.recovery_steps))
                except Exception:
                    _all_recovery.append(str(e.recovery_steps))
            # Stop conditions
            if e.stop_condition and e.stop_condition not in _all_stops:
                _all_stops.append(e.stop_condition)
            # Depends on
            _dep_raw = getattr(e, "depends_on", None)
            if _dep_raw:
                try:
                    _all_depends.extend(json.loads(_dep_raw))
                except Exception:
                    _all_depends.append(str(_dep_raw))
            # Decision type (collect for priority resolution)
            _dt = getattr(e, "decision_type", None)
            if _dt:
                _decision_candidates.append(_dt.upper())
            # Scope
            _sc = getattr(e, "execution_scope", None)
            if _sc and _sc not in _all_scopes:
                _all_scopes.append(_sc)
            # Severity
            if e.severity and e.severity not in _all_severities:
                _all_severities.append(e.severity)

        # Highest-priority decision wins (STOP > ESCALATE > RETRY > PARTIAL_CONTINUE > CONTINUE > WAIT)
        resolved_decision = "CONTINUE"
        if _decision_candidates:
            resolved_decision = min(
                _decision_candidates,
                key=lambda d: _DECISION_PRIORITY.get(d, 99),
            )

        # Highest severity
        _SEV_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
        resolved_severity = min(_all_severities, key=lambda s: _SEV_ORDER.get(s.upper(), 99)) if _all_severities else "MEDIUM"

        # Dominant scope (most common, else first)
        from collections import Counter
        resolved_scope = Counter(_all_scopes).most_common(1)[0][0] if _all_scopes else "system"

        operational = {
            "decision_type":   resolved_decision,
            "severity":        resolved_severity,
            "scope":           resolved_scope,
            "actions":         list(dict.fromkeys(_all_actions)),      # deduplicated, ordered
            "owners":          _all_owners,
            "recovery_steps":  list(dict.fromkeys(_all_recovery)),
            "stop_conditions": _all_stops,
            "depends_on":      list(dict.fromkeys(_all_depends)),
            "rules_matched":   list(dict.fromkeys(_all_titles)),
            "rule_count":      _rule_entry_count,
        }

    result: dict = {
        "status": "ANSWERED",
        "answer": answer,
        "response_type": response_type,
        "sources": [
            {
                "entry_id":      chunk.entry_id,
                "chunk_id":      chunk.id,
                "topic":         chunk.topic,
                "score":         round(score, 4),
                "entry_title":   chunk.entry.title,
                "entry_system":  chunk.entry.system,
                "kb_schema_id":  getattr(chunk.entry, "kb_schema_id", None),
            }
            for score, chunk in used_results
        ],
        "debug": {
            "tokens_in":  resp.usage.prompt_tokens,
            "tokens_out": resp.usage.completion_tokens,
            "latency_ms": elapsed_ms,
            "model":      model,
        },
    }
    if operational:
        result["operational"] = operational
    return result


# ── Unanswered flow ───────────────────────────────────────────────────────────

def _build_unanswered_dict(question: str, system: str, category: str) -> dict:
    return {
        "status": "UNANSWERED",
        "message": "This question is not yet covered in the current knowledge base.",
        "question": question,
        "detected_tags": {"system": system, "category": category, "type": "Question"},
        "suggested_tags": [],
        "reason": "No relevant knowledge chunks found above confidence threshold.",
        "action": "This question has been recorded for admin review.",
    }


def _persist_open_question(question: str, asked_by: Optional[str], db: Session) -> None:
    """
    Heuristic tag detection + Jaccard deduplication + OpenQuestion persistence.
    Operational questions are tagged with category="OperationalRule" so the
    Operational Rules tab can surface them separately from general open questions.
    Side-effect only — does not return anything.
    """
    from api.models import OpenQuestion

    system_map = {"dct": "DCT", "ado": "ADO", "snowflake": "Snowflake"}
    q_lower = question.lower()
    detected_system = next((v for k, v in system_map.items() if k in q_lower), "General")

    # Detect operational intent before generic category checks
    _OP_KEYWORDS = {
        "stop", "halt", "block", "fail", "failure", "error", "exception",
        "validate", "validation", "recover", "recovery", "rollback",
        "escalate", "escalation", "who handles", "who owns", "who is responsible",
        "what happens", "should i", "how to handle", "rule", "condition",
        "retry", "reprocess", "threshold", "reject", "when does", "b&c",
        "trf", "recon", "reconciliation", "batch", "monthly", "cycle",
        "owner", "team", "routing", "escalate", "policy failure",
    }
    is_operational = any(kw in q_lower for kw in _OP_KEYWORDS)

    if is_operational:
        detected_category = "OperationalRule"
    elif any(w in q_lower for w in ["convert", "mapping", "xml"]):
        detected_category = "Conversion"
    elif any(w in q_lower for w in ["design", "pattern", "architect"]):
        detected_category = "Architecture"
    elif any(w in q_lower for w in ["table", "query", "sql", "schema"]):
        detected_category = "DB"
    else:
        detected_category = "General"

    try:
        existing = (
            db.query(OpenQuestion)
            .filter(OpenQuestion.status.in_(["open", "flagged"]))
            .order_by(OpenQuestion.created_at.desc())
            .limit(200)
            .all()
        )
        q_words = set(q_lower.split())
        for existing_q in existing:
            e_words = set(existing_q.question.lower().split())
            union = q_words | e_words
            intersection = q_words & e_words
            jaccard = len(intersection) / len(union) if union else 0.0
            if jaccard > 0.80:
                existing_q.frequency += 1
                existing_q.updated_at = datetime.utcnow()
                db.commit()
                return

        oq = OpenQuestion(
            question=question,
            detected_tags=json.dumps({
                "system": detected_system,
                "category": detected_category,
                "type": "Question",
            }),
            suggested_tags=json.dumps([]),
            reason="No relevant knowledge chunks found above confidence threshold.",
            asked_by=asked_by,
            frequency=1,
            status="open",
        )
        db.add(oq)
        db.commit()
    except Exception as exc:
        print(f"[knowledge] _persist_open_question failed: {exc}")
        try:
            db.rollback()
        except Exception:
            pass


def _unanswered_flow(question: str, asked_by: Optional[str], db: Session) -> dict:
    """Queue question and return UNANSWERED dict."""
    system_map = {"dct": "DCT", "ado": "ADO", "snowflake": "Snowflake"}
    q_lower = question.lower()
    detected_system = next((v for k, v in system_map.items() if k in q_lower), "General")
    if any(w in q_lower for w in ["convert", "mapping", "xml"]):
        detected_category = "Conversion"
    elif any(w in q_lower for w in ["design", "pattern", "architect"]):
        detected_category = "Architecture"
    elif any(w in q_lower for w in ["table", "query", "sql", "schema"]):
        detected_category = "DB"
    else:
        detected_category = "General"

    _persist_open_question(question, asked_by, db)
    return _build_unanswered_dict(question, detected_system, detected_category)


# ── Quick-answer embedding (called in background) ─────────────────────────────

def embed_quick_answer(
    *,
    question: str,
    resolution_text: str,
    db: Session,
) -> None:
    """
    Embed a quick-answer and store it on a synthetic 'SAI Quick Answers' KB entry
    so future Ask SAI queries can find it.
    """
    from api.models import KnowledgeEntry, KnowledgeChunk
    from api.services.embeddings import get_embedding

    try:
        # Find or create synthetic entry
        synthetic = db.query(KnowledgeEntry).filter_by(
            title="SAI Quick Answers", type="Question"
        ).first()
        if not synthetic:
            synthetic = KnowledgeEntry(
                title="SAI Quick Answers",
                type="Question",
                system="General",
                status="READY_FOR_EMBEDDING",
                embedding_status="complete",
                source_type="Text",
                is_reusable=True,
            )
            db.add(synthetic)
            db.flush()  # get synthetic.id without full commit

        chunk_content = f"Q: {question}\nA: {resolution_text}"
        vec = get_embedding(chunk_content, api_key=settings.OPENAI_API_KEY)
        existing_count = db.query(KnowledgeChunk).filter_by(entry_id=synthetic.id).count()
        db.add(KnowledgeChunk(
            entry_id=synthetic.id,
            chunk_index=existing_count + 1,
            content=chunk_content,
            topic="Quick Answer",
            embedding=json.dumps(vec),
        ))
        db.commit()
    except Exception as exc:
        print(f"[knowledge] embed_quick_answer failed: {exc}")
        try:
            db.rollback()
        except Exception:
            pass


# ── Policy Attach / Bulk Document Extractors ──────────────────────────────────

def _make_entry(*, title: str, type: str, system: str, tags: list[str],
                summary: str, detailed: str, raw_content: str,
                db: Session, kb_schema_id: Optional[int],
                source_file_id: Optional[int] = None,
                source_blob_path: Optional[str] = None,
                mapping_confidence: Optional[str] = None) -> int:
    """Persist a KnowledgeEntry + chunks + embeddings. Returns entry.id."""
    from api.models import KnowledgeEntry as _KE
    entry = _KE(
        title=title[:500],
        type=type,
        system=system,
        tags=json.dumps(tags),
        summary=summary[:2000] if summary else "",
        detailed_explanation=detailed,
        key_points=json.dumps([f"Type: {type}", f"System: {system}"]),
        is_reusable=True,
        source_type="AI-Import",
        raw_content=raw_content,
        quality_score="HIGH",
        status="READY_FOR_EMBEDDING",
        embedding_status="pending",
        version=1,
        kb_schema_id=kb_schema_id,
        source_file_id=source_file_id,
        source_blob_path=source_blob_path,
        mapping_confidence=mapping_confidence,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    chunks = _chunk_text(raw_content, topic=title)
    embed_and_store_chunks(entry_id=entry.id, chunks=chunks, summary=summary, db=db,
                           kb_schema_id=kb_schema_id, source_file_id=source_file_id)
    return entry.id


def extract_xml_paths(xml_bytes: bytes, db: Session, kb_schema_id: Optional[int] = None,
                      source_file_id: Optional[int] = None, source_blob_path: Optional[str] = None) -> dict:
    """
    Parse a sample XML file, extract unique XPaths, and create XMLPathDefinition +
    XMLMapping KB entries for each path. Returns {entries_created, paths_found}.
    """
    import xml.etree.ElementTree as ET
    from api.services.ai_client import get_client, chat_model as _cm

    def _walk(element: ET.Element, path: str, results: dict):
        tag = element.tag.split("}")[-1] if "}" in element.tag else element.tag
        current_path = f"{path}/{tag}"
        text_val = (element.text or "").strip()
        if text_val and current_path not in results:
            results[current_path] = text_val
        for attr_name, attr_val in element.attrib.items():
            attr_path = f"{current_path}/@{attr_name}"
            if attr_path not in results:
                results[attr_path] = attr_val
        for child in element:
            _walk(child, current_path, results)

    try:
        root = ET.fromstring(xml_bytes.decode("utf-8", errors="replace"))
    except ET.ParseError as e:
        raise ValueError(f"Invalid XML: {e}")

    paths: dict[str, str] = {}
    _walk(root, "", paths)

    if not paths:
        return {"entries_created": 0, "paths_found": 0}

    client = get_client()
    entries_created = 0

    # Cap GPT-per-path calls for large XML files — prevents runaway extraction time
    MAX_PATHS = 50
    path_items = list(paths.items())
    if len(path_items) > MAX_PATHS:
        path_items = path_items[:MAX_PATHS]

    for xpath, example_value in path_items:
        parent = "/".join(xpath.rsplit("/", 1)[:-1]) or "/"
        node_name = xpath.rsplit("/", 1)[-1]

        path_raw = f"XPath: {xpath}\nExample Value: {example_value}\nParent Element: {parent}"
        path_tags = ["xml-path", node_name.lstrip("@").split("[")[0]]

        path_entry_id = _make_entry(
            title=xpath[:500],
            type="XMLPathDefinition",
            system="DCT",
            tags=path_tags,
            summary=f"XML path {xpath} with example value: {example_value}",
            detailed=path_raw,
            raw_content=path_raw,
            db=db,
            kb_schema_id=kb_schema_id,
            source_file_id=source_file_id,
            source_blob_path=source_blob_path,
            mapping_confidence="Explicit",
        )
        entries_created += 1

        # XMLMapping — LLM enrichment: source column, transformation, null scenarios, fix steps
        try:
            prompt = (
                f"You are a data conversion expert analyzing an XML file.\n\n"
                f"Analyze this XML path and provide a developer-friendly mapping explanation.\n"
                f"XPath: {xpath}\nExample value: {example_value}\nParent element: {parent}\n\n"
                f"Return a JSON object with these keys:\n"
                f"- source_view: likely source table or view that populates this field (or 'Unknown')\n"
                f"- source_column: likely source column name (or 'Unknown')\n"
                f"- transformation: transformation logic or 'Direct Mapping' if straightforward\n"
                f"- config_dependency: config table or view driving this element, if any\n"
                f"- null_scenarios: list of 2-3 plain-English reasons this field could be null/wrong\n"
                f"- fix_steps: list of 2-3 plain-English steps a developer would take to debug this\n"
                f"- data_type: expected data type or format"
            )
            resp = client.chat.completions.create(
                model=_cm("gpt-4o-mini"),
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=800,
            )
            mapping_data = json.loads(resp.choices[0].message.content or "{}")
        except Exception:
            mapping_data = {}

        source_view   = mapping_data.get("source_view", "Unknown")
        source_col    = mapping_data.get("source_column", "Unknown")
        transform     = mapping_data.get("transformation", "Direct Mapping")
        config_dep    = mapping_data.get("config_dependency", "")
        null_scenarios = mapping_data.get("null_scenarios") or []
        fix_steps     = mapping_data.get("fix_steps") or []
        data_type     = mapping_data.get("data_type", "")

        mapping_raw = "\n".join(filter(None, [
            f"XPath: {xpath}",
            f"Source View: {source_view}",
            f"Source Column: {source_col}",
            f"Transformation: {transform}",
            f"Config Dependency: {config_dep}" if config_dep else "",
            f"Data Type: {data_type}" if data_type else "",
            "",
            "Null/Failure Scenarios:",
            *[f"  - {s}" for s in null_scenarios],
            "",
            "Fix Steps:",
            *[f"  {i+1}. {s}" for i, s in enumerate(fix_steps)],
        ]))

        mapping_entry_id = _make_entry(
            title=f"Mapping: {xpath}"[:500],
            type="XMLMapping",
            system="DCT",
            tags=["xml-mapping", "policy-attach", "source-mapping", node_name.lstrip("@").split("[")[0]],
            summary=f"{xpath} ← {source_view}.{source_col} | {transform}",
            detailed=mapping_raw,
            raw_content=mapping_raw,
            db=db,
            kb_schema_id=kb_schema_id,
            source_file_id=source_file_id,
            source_blob_path=source_blob_path,
            mapping_confidence="Derived",
        )
        entries_created += 1

        try:
            from api.models import OpDependencyEdge
            db.add(OpDependencyEdge(
                source_entry_id=path_entry_id,
                target_entry_id=mapping_entry_id,
                edge_type="requires",
            ))
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

    return {"entries_created": entries_created, "paths_found": len(paths)}


def extract_sql_dependencies(sql_text: str, db: Session, kb_schema_id: Optional[int] = None,
                             system: str = "DCT", source_file_id: Optional[int] = None,
                             source_blob_path: Optional[str] = None,
                             filename: str = "script.sql") -> dict:
    """
    Full SQL Intelligence extraction — all 5 phases in a single GPT call per block.

    Phase 1 — Object Classification : SQLObject entries (TABLE/VIEW/PROCEDURE/FUNCTION/TRIGGER)
    Phase 2 — Column Metadata       : ColumnMetadata entries (name, type, PK/FK, business meaning)
    Phase 3 — Dependency Graph      : DependencyDefinition entries (upstream direction, OpDependencyEdge)
    Phase 4 — Business Rules        : BusinessRule entries (CASE/IF/CALCULATION/FILTER/VALIDATION)
    Phase 5 — Data Lineage          : DataLineage entries (sources → object → targets chain)

    Returns {entries_created, blocks_found}.
    """
    from api.services.ai_client import get_client, chat_model as _cm

    block_pattern = re.compile(
        r"(CREATE\s+(?:OR\s+REPLACE\s+)?(?:VIEW|TABLE|PROCEDURE|PROC|FUNCTION|TRIGGER)"
        r"\s+(?:\[?[\w\.\[\]]+\]?\s*){1,3})",
        re.IGNORECASE,
    )
    parts = re.split(block_pattern, sql_text)
    blocks: list[tuple[str, str]] = []
    i = 0
    while i < len(parts):
        part = parts[i].strip()
        if re.match(r"CREATE\s+", part, re.IGNORECASE) and i + 1 < len(parts):
            blocks.append((part.strip(), parts[i + 1].strip()))
            i += 2
        elif part:
            if not blocks:
                blocks.append(("SCRIPT", part))
            else:
                last_h, last_b = blocks[-1]
                blocks[-1] = (last_h, last_b + "\n" + part)
            i += 1
        else:
            i += 1

    if not blocks:
        blocks = [("SCRIPT", sql_text)]

    # Cap GPT-per-block calls — statement-chunker in blob_ingestion handles the rest.
    MAX_BLOCKS = 10
    if len(blocks) > MAX_BLOCKS:
        blocks = blocks[:MAX_BLOCKS]

    client = get_client()
    entries_created = 0

    for header, body in blocks:
        full_sql = (header + "\n" + body).strip()
        if not full_sql:
            continue

        # ── Phase 1: Classify object type from header ─────────────────────────
        name_match = re.search(
            r"CREATE\s+(?:OR\s+REPLACE\s+)?(?:VIEW|TABLE|PROCEDURE|PROC|FUNCTION|TRIGGER)\s+"
            r"(?:\[?[\w]+\]?\.)?\[?([\w]+)\]?",
            header, re.IGNORECASE,
        )
        raw_name = name_match.group(1) if name_match else header[:60]
        h_upper = header.upper()
        if "VIEW" in h_upper:
            sql_obj_type = "VIEW"
        elif "TABLE" in h_upper:
            sql_obj_type = "TABLE"
        elif "PROCEDURE" in h_upper or "PROC " in h_upper:
            sql_obj_type = "PROCEDURE"
        elif "FUNCTION" in h_upper:
            sql_obj_type = "FUNCTION"
        elif "TRIGGER" in h_upper:
            sql_obj_type = "TRIGGER"
        else:
            sql_obj_type = "SCRIPT"

        # ── Single comprehensive GPT call — all 5 phases ──────────────────────
        try:
            prompt = (
                f"You are a SQL intelligence analyst. Analyze this SQL {sql_obj_type} and extract "
                f"structured metadata across five intelligence areas.\n\n"
                f"SQL:\n```sql\n{full_sql[:5000]}\n```\n\n"
                f"Return ONLY valid JSON with exactly this structure:\n"
                f'{{\n'
                f'  "object_name": "exact SQL object name without brackets",\n'
                f'  "object_type": "{sql_obj_type}",\n'
                f'  "schema_name": "schema name (dbo if not explicit)",\n'
                f'  "purpose": "2-3 plain English sentences — what this object does and why it exists",\n'
                f'  "upstream_deps": ["table or view names this object reads from"],\n'
                f'  "downstream_impact": "what would break if this object is changed or dropped",\n'
                f'  "columns": [\n'
                f'    {{\n'
                f'      "name": "column_name",\n'
                f'      "data_type": "SQL data type e.g. INT, VARCHAR(200)",\n'
                f'      "nullable": true,\n'
                f'      "is_primary_key": false,\n'
                f'      "is_foreign_key": false,\n'
                f'      "references": "TargetTable.TargetColumn or null",\n'
                f'      "business_meaning": "plain English: what this field represents"\n'
                f'    }}\n'
                f'  ],\n'
                f'  "business_rules": [\n'
                f'    {{\n'
                f'      "rule_name": "short descriptive name",\n'
                f'      "rule_type": "CASE|IF|CALCULATION|FILTER|VALIDATION",\n'
                f'      "condition": "the condition or expression",\n'
                f'      "outcome": "what the result or action is",\n'
                f'      "related_fields": ["field1", "field2"],\n'
                f'      "sql_snippet": "the relevant SQL fragment (max 200 chars)"\n'
                f'    }}\n'
                f'  ],\n'
                f'  "lineage": {{\n'
                f'    "sources": ["upstream tables/views this object reads from"],\n'
                f'    "transformations": ["intermediate objects or CTEs involved"],\n'
                f'    "targets": ["downstream objects that consume this — leave empty if not in this file"]\n'
                f'  }}\n'
                f'}}\n\n'
                f"Guidelines:\n"
                f"- columns: for TABLE list all columns; for VIEW/PROCEDURE list up to 15 key columns/params\n"
                f"- business_rules: extract up to 5 most important rules; skip if none present\n"
                f"- lineage.sources same as upstream_deps; targets only if inferable from this code\n"
                f"- Base everything strictly on the SQL provided — do not invent names"
            )
            resp = client.chat.completions.create(
                model=_cm("gpt-4o-mini"),
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=2000,
            )
            info = json.loads(resp.choices[0].message.content or "{}")
        except Exception:
            info = {}

        resolved_name  = (info.get("object_name") or raw_name).strip("[]")
        schema_name    = info.get("schema_name") or "dbo"
        purpose        = info.get("purpose") or f"SQL {sql_obj_type}: {resolved_name}"
        upstream_deps  = [str(d).strip("[]") for d in (info.get("upstream_deps") or []) if d]
        downstream_imp = info.get("downstream_impact") or ""
        columns        = [c for c in (info.get("columns") or []) if isinstance(c, dict)]
        biz_rules      = [r for r in (info.get("business_rules") or []) if isinstance(r, dict)]
        lineage_info   = info.get("lineage") or {}
        qualified_name = f"{schema_name}.{resolved_name}"

        base_tags = ["sql", sql_obj_type.lower(), resolved_name, schema_name, filename]

        # ── Phase 1: SQLObject entry ───────────────────────────────────────────
        pk_cols  = [c["name"] for c in columns if c.get("is_primary_key") and c.get("name")]
        fk_descs = [f"{c['name']} → {c['references']}" for c in columns
                    if c.get("is_foreign_key") and c.get("references") and c.get("name")]
        col_names = [c["name"] for c in columns if c.get("name")]
        col_summary = ", ".join(col_names[:10])

        obj_raw = "\n".join(filter(None, [
            f"SQL Object: {resolved_name}",
            f"Type: {sql_obj_type}",
            f"Schema: {schema_name}",
            f"File: {filename}",
            f"Purpose: {purpose}",
            f"Key columns: {col_summary}" if col_summary else "",
            f"Primary keys: {', '.join(pk_cols)}" if pk_cols else "",
            f"Reads from: {', '.join(upstream_deps[:10])}" if upstream_deps else "",
            f"Impact if changed: {downstream_imp}" if downstream_imp else "",
            "",
            f"SQL (first 600 chars):\n```sql\n{full_sql[:600]}\n```",
        ]))
        obj_detailed = json.dumps({
            "object_name":    resolved_name,
            "qualified_name": qualified_name,
            "object_type":    sql_obj_type,
            "schema":         schema_name,
            "purpose":        purpose,
            "upstream_deps":  upstream_deps,
            "downstream_impact": downstream_imp,
            "column_count":   len(columns),
            "primary_keys":   pk_cols,
            "foreign_keys":   fk_descs,
            "business_rule_count": len(biz_rules),
            "source_file":    filename,
            "full_sql":       full_sql,
        }, indent=2)

        obj_entry_id = _make_entry(
            title=resolved_name[:500],
            type="SQLObject",
            system=system,
            tags=base_tags,
            summary=purpose,
            detailed=obj_detailed,
            raw_content=obj_raw,
            db=db,
            kb_schema_id=kb_schema_id,
            source_file_id=source_file_id,
            source_blob_path=source_blob_path,
            mapping_confidence="Derived",
        )
        entries_created += 1

        # ── Phase 2: ColumnMetadata entry ─────────────────────────────────────
        if columns:
            col_lines = []
            for c in columns:
                pk_flag   = " [PK]" if c.get("is_primary_key") else ""
                fk_flag   = f" [FK→{c.get('references','')}]" if c.get("is_foreign_key") else ""
                null_flag = " NULL" if c.get("nullable") else " NOT NULL"
                meaning   = f" — {c['business_meaning']}" if c.get("business_meaning") else ""
                col_lines.append(
                    f"{c.get('name','?')} {c.get('data_type','?')}{null_flag}{pk_flag}{fk_flag}{meaning}"
                )
            col_raw = "\n".join(filter(None, [
                f"Column Metadata: {resolved_name} ({sql_obj_type})",
                f"Schema: {schema_name}  |  File: {filename}",
                f"Total columns: {len(columns)}",
                "",
                *col_lines[:30],
            ]))
            _make_entry(
                title=f"{resolved_name} — Column Metadata"[:500],
                type="ColumnMetadata",
                system=system,
                tags=["columns", "schema", "metadata"] + base_tags,
                summary=f"{len(columns)} columns in {qualified_name}: {col_summary}",
                detailed=json.dumps(columns, indent=2),
                raw_content=col_raw,
                db=db,
                kb_schema_id=kb_schema_id,
                source_file_id=source_file_id,
                source_blob_path=source_blob_path,
                mapping_confidence="Derived",
            )
            entries_created += 1

        # ── Phase 3: DependencyDefinition entries (upstream) ──────────────────
        for dep in upstream_deps:
            if not dep or dep.lower() == resolved_name.lower():
                continue
            dep_raw = (
                f"Dependency: {resolved_name} reads from {dep}.\n"
                f"Direction: upstream\n"
                f"File: {filename}\n"
                f"Impact: If '{dep}' is changed or removed, '{resolved_name}' will break.\n"
                f"{downstream_imp}"
            )
            dep_entry_id = _make_entry(
                title=f"{resolved_name} depends on {dep}"[:500],
                type="DependencyDefinition",
                system=system,
                tags=["dependency", "upstream", "sql-lineage", resolved_name, dep, filename],
                summary=f"{resolved_name} reads from {dep}",
                detailed=dep_raw,
                raw_content=dep_raw,
                db=db,
                kb_schema_id=kb_schema_id,
                source_file_id=source_file_id,
                source_blob_path=source_blob_path,
                mapping_confidence="Derived",
            )
            entries_created += 1
            try:
                from api.models import OpDependencyEdge
                db.add(OpDependencyEdge(
                    source_entry_id=obj_entry_id,
                    target_entry_id=dep_entry_id,
                    edge_type="requires",
                ))
                db.commit()
            except Exception:
                try:
                    db.rollback()
                except Exception:
                    pass

        # ── Phase 4: BusinessRule entries ──────────────────────────────────────
        for rule in biz_rules[:5]:
            rule_name = rule.get("rule_name") or ""
            if not rule_name:
                continue
            rule_raw = "\n".join(filter(None, [
                f"Business Rule: {rule_name}",
                f"Object: {resolved_name} ({sql_obj_type})  |  File: {filename}",
                f"Rule Type: {rule.get('rule_type','')}",
                f"Condition: {rule.get('condition','')}",
                f"Outcome: {rule.get('outcome','')}",
                f"Related Fields: {', '.join(rule.get('related_fields') or [])}",
                "",
                f"SQL:\n```sql\n{rule.get('sql_snippet','')}\n```" if rule.get("sql_snippet") else "",
            ]))
            _make_entry(
                title=f"{resolved_name} — {rule_name}"[:500],
                type="BusinessRule",
                system=system,
                tags=["business-rule", (rule.get("rule_type") or "rule").lower(),
                      resolved_name, sql_obj_type.lower(), filename],
                summary=(
                    f"{rule.get('rule_type','Rule')} in {resolved_name}: "
                    f"{rule.get('condition','')[:120]}"
                ),
                detailed=json.dumps(rule, indent=2),
                raw_content=rule_raw,
                db=db,
                kb_schema_id=kb_schema_id,
                source_file_id=source_file_id,
                source_blob_path=source_blob_path,
                mapping_confidence="Derived",
            )
            entries_created += 1

        # ── Phase 5: DataLineage entry ─────────────────────────────────────────
        sources         = [s for s in (lineage_info.get("sources") or upstream_deps[:5]) if s]
        transformations = [t for t in (lineage_info.get("transformations") or []) if t]
        targets         = [t for t in (lineage_info.get("targets") or []) if t]
        if sources or targets:
            chain_parts = []
            if sources:       chain_parts.append(" + ".join(sources[:5]))
            chain_parts.append(f"[{resolved_name}]")
            if transformations: chain_parts.append(" + ".join(transformations[:3]))
            if targets:       chain_parts.append(" + ".join(targets[:5]))
            lineage_chain = " → ".join(chain_parts)

            lineage_raw = "\n".join(filter(None, [
                f"Data Lineage: {resolved_name}",
                f"Object Type: {sql_obj_type}  |  Schema: {schema_name}  |  File: {filename}",
                "",
                f"Lineage Chain: {lineage_chain}",
                "",
                f"Sources (upstream):    {', '.join(sources)}"         if sources         else "",
                f"Transformations:       {', '.join(transformations)}" if transformations else "",
                f"Targets (downstream):  {', '.join(targets)}"         if targets         else "",
                "",
                f"Purpose: {purpose}",
            ]))
            _make_entry(
                title=f"{resolved_name} — Data Lineage"[:500],
                type="DataLineage",
                system=system,
                tags=["lineage", "data-flow", resolved_name, sql_obj_type.lower(), filename],
                summary=lineage_chain[:500],
                detailed=json.dumps({
                    "object":          resolved_name,
                    "qualified_name":  qualified_name,
                    "type":            sql_obj_type,
                    "sources":         sources,
                    "transformations": transformations,
                    "targets":         targets,
                    "chain":           lineage_chain,
                }, indent=2),
                raw_content=lineage_raw,
                db=db,
                kb_schema_id=kb_schema_id,
                source_file_id=source_file_id,
                source_blob_path=source_blob_path,
                mapping_confidence="Derived",
            )
            entries_created += 1

    return {"entries_created": entries_created, "blocks_found": len(blocks)}


def extract_excel_knowledge(xlsx_bytes: bytes, db: Session,
                            kb_schema_id: Optional[int] = None,
                            filename: str = "workbook.xlsx",
                            system: str = "DCT",
                            source_file_id: Optional[int] = None,
                            source_blob_path: Optional[str] = None) -> dict:
    """
    Process an Excel workbook for KB ingestion:
    - Mapping sheets → FieldMapping entries (one per data row)
    - Embedded images → DiagramDefinition entries (vision API)
    - Other sheets → document fallback via process_entry()
    Returns {entries_created, sheets_processed, images_found}.
    """
    import io as _io
    import openpyxl
    from api.services.ai_client import get_client, chat_model as _cm

    MAPPING_KEYWORDS = {"source", "legacy", "target", "xpath", "rule", "mandatory",
                        "transformation", "field", "column", "mapping"}

    def _detect_mapping_sheet(headers: list[str]) -> bool:
        header_words = {h.lower().strip() for h in headers}
        matches = sum(1 for h in header_words if any(kw in h for kw in MAPPING_KEYWORDS))
        return matches >= 3

    def _canonical(headers: list[str]) -> dict[str, str]:
        result = {}
        for h in headers:
            hl = h.lower().strip()
            if any(k in hl for k in ("source_field", "source field", "legacy_field", "legacy field", "legacy")):
                result[h] = "source_field"
            elif any(k in hl for k in ("target_field", "target field", "target_column", "target col")):
                result[h] = "target_field"
            elif any(k in hl for k in ("xpath", "xml_path", "xml path", "path")):
                result[h] = "xpath"
            elif any(k in hl for k in ("rule", "transformation", "mapping_rule", "logic")):
                result[h] = "rule"
            elif any(k in hl for k in ("mandatory", "required", "nullable")):
                result[h] = "mandatory"
            elif any(k in hl for k in ("source_view", "source view", "source_table", "source table")):
                result[h] = "source_view"
            elif any(k in hl for k in ("description", "notes", "comment")):
                result[h] = "description"
            else:
                result[h] = hl
        return result

    wb = openpyxl.load_workbook(_io.BytesIO(xlsx_bytes), data_only=True)
    client = get_client()
    entries_created = 0
    sheets_processed = 0
    images_found = 0

    for ws in wb.worksheets:
        sheet_name = ws.title or "Sheet"

        # ── Embedded images → DiagramDefinition ──────────────────────────────
        raw_images = getattr(ws, "_images", [])
        for img_obj in raw_images:
            images_found += 1
            try:
                img_bytes = None
                if hasattr(img_obj, "ref") and hasattr(img_obj.ref, "tobytes"):
                    img_bytes = img_obj.ref.tobytes()
                elif hasattr(img_obj, "_data") and callable(img_obj._data):
                    img_bytes = img_obj._data()
                elif hasattr(img_obj, "path"):
                    img_bytes = wb._archive.read(img_obj.path.lstrip("/"))

                if not img_bytes:
                    continue

                import base64
                b64_str = base64.b64encode(img_bytes).decode("utf-8")

                vision_prompt = (
                    f"This diagram is from the workbook '{filename}'. "
                    "Describe in plain English for a developer: (1) what process or flow it shows, "
                    "(2) all table/view/field names visible, "
                    "(3) relationships between components, "
                    "(4) key data flow steps. "
                    "Be specific — a developer must use this to debug issues."
                )
                vision_resp = client.chat.completions.create(
                    model=_cm("gpt-4o"),
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": vision_prompt},
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64_str}"}},
                        ],
                    }],
                    max_tokens=1000,
                )
                vision_text = vision_resp.choices[0].message.content or ""

                diag_raw = f"Sheet: {sheet_name}\nFilename: {filename}\n\nDiagram Description:\n{vision_text}"
                _make_entry(
                    title=f"Diagram: {sheet_name} — {filename}"[:500],
                    type="DiagramDefinition",
                    system=system,
                    tags=["diagram", "policy-attach", "excel-import", sheet_name.lower()],
                    summary=vision_text[:300],
                    detailed=diag_raw,
                    raw_content=diag_raw,
                    db=db,
                    kb_schema_id=kb_schema_id,
                    source_file_id=source_file_id,
                    source_blob_path=source_blob_path,
                    mapping_confidence="Explicit",
                )
                entries_created += 1
            except Exception as exc:
                print(f"[knowledge] image extraction failed in {sheet_name}: {exc}")

        # ── Get sheet headers ─────────────────────────────────────────────────
        rows_iter = list(ws.iter_rows(min_row=1, values_only=True))
        if not rows_iter:
            continue

        headers = [str(c or "").strip() for c in rows_iter[0]]
        if not any(headers):
            continue

        canon = _canonical(headers)

        if _detect_mapping_sheet(headers):
            # ── Mapping sheet → FieldMapping entries ─────────────────────────
            for row_vals in rows_iter[1:]:
                row = {headers[i]: (str(v).strip() if v is not None else "") for i, v in enumerate(row_vals)}
                src  = row.get(next((h for h, c in canon.items() if c == "source_field"), ""), "")
                tgt  = row.get(next((h for h, c in canon.items() if c == "target_field"), ""), "")
                if not src and not tgt:
                    continue

                xpath   = row.get(next((h for h, c in canon.items() if c == "xpath"), ""), "")
                rule    = row.get(next((h for h, c in canon.items() if c == "rule"), ""), "")
                mand    = row.get(next((h for h, c in canon.items() if c == "mandatory"), ""), "")
                sv      = row.get(next((h for h, c in canon.items() if c == "source_view"), ""), "")
                desc    = row.get(next((h for h, c in canon.items() if c == "description"), ""), "")

                row_lines = [
                    f"Source Field: {src}" if src else "",
                    f"Target Field: {tgt}" if tgt else "",
                    f"XPath: {xpath}" if xpath else "",
                    f"Source View: {sv}" if sv else "",
                    f"Mapping Rule: {rule}" if rule else "",
                    f"Mandatory: {mand}" if mand else "",
                    f"Description: {desc}" if desc else "",
                ]
                raw = "\n".join(filter(None, row_lines))
                title = (
                    f"Mapping: {src} → {tgt}" if (src and tgt)
                    else (f"Mapping: {src}" if src else f"Mapping: {tgt}")
                )

                _make_entry(
                    title=title[:500],
                    type="FieldMapping",
                    system=system,
                    tags=["field-mapping", "policy-attach", "excel-import"],
                    summary=f"{src} → {tgt}{(' | ' + rule) if rule else ''}",
                    detailed=raw,
                    raw_content=raw,
                    db=db,
                    kb_schema_id=kb_schema_id,
                    source_file_id=source_file_id,
                    source_blob_path=source_blob_path,
                    mapping_confidence="Explicit",
                )
                entries_created += 1

            sheets_processed += 1

        else:
            # ── Fallback: serialize sheet to text → LLM process ───────────────
            lines = []
            for row_vals in rows_iter:
                line = " | ".join(str(v or "").strip() for v in row_vals if str(v or "").strip())
                if line:
                    lines.append(line)
            if not lines:
                continue
            text = f"Sheet: {sheet_name}\nFile: {filename}\n\n" + "\n".join(lines[:200])
            try:
                result = process_entry(
                    title=f"{filename} — {sheet_name}",
                    type="Process",
                    system=system,
                    tags=["excel-import", "policy-attach", sheet_name.lower()],
                    source_type="Document",
                    raw_content=text,
                    db=db,
                )
                ke_data = result.get("knowledge_entry", {})
                from api.models import KnowledgeEntry as _KE
                entry = _KE(
                    title=(ke_data.get("title") or f"{filename} — {sheet_name}")[:500],
                    type=ke_data.get("type", "Process"),
                    system=system,
                    tags=json.dumps(ke_data.get("tags") or ["excel-import", "policy-attach"]),
                    summary=ke_data.get("summary", ""),
                    detailed_explanation=ke_data.get("detailed_explanation", text[:2000]),
                    key_points=json.dumps(ke_data.get("key_points") or []),
                    is_reusable=True,
                    source_type="Document",
                    raw_content=text,
                    quality_score=result.get("quality_score", "MEDIUM"),
                    status="READY_FOR_EMBEDDING",
                    embedding_status="pending",
                    version=1,
                    kb_schema_id=kb_schema_id,
                    source_file_id=source_file_id,
                    source_blob_path=source_blob_path,
                )
                db.add(entry)
                db.commit()
                db.refresh(entry)
                chunks = result.get("chunks") or _chunk_text(text, topic=entry.title)
                embed_and_store_chunks(
                    entry_id=entry.id, chunks=chunks,
                    summary=ke_data.get("summary", ""), db=db, kb_schema_id=kb_schema_id,
                    source_file_id=source_file_id,
                )
                entries_created += 1
                sheets_processed += 1
            except Exception as exc:
                print(f"[knowledge] Excel sheet fallback failed for {sheet_name}: {exc}")

    return {"entries_created": entries_created, "sheets_processed": sheets_processed, "images_found": images_found}
