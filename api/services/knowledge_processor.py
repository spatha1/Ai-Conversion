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
You are SAI (Smart Architect Intelligence), an enterprise architect-level AI assistant
embedded in the Data Conversion Studio.

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

== BEHAVIOR RULES ==
1. Answer using ONLY the knowledge, connections, and System Facts shown above.
2. If knowledge or connections are insufficient, say so clearly — do NOT guess or invent facts.
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
Numbered steps with explanations.
## Systems Involved
Which connections, APIs, or systems are touched at each step.
## Key Insights
Important edge cases, failure modes, or best practices.
## Knowledge & Context Used
List KB entries and connections referenced.

**Mode D — FACTUAL / ANALYSIS** (ownership, definitions, validations, comparisons, troubleshooting,
or any question that does NOT fit A, B, or C):
→ Use Standard Format:
## Summary
Short, clear answer (2-4 sentences).
## Detailed Explanation
Structured explanation of the concept, process, or issue.
## How Systems Connect
Which systems are involved and how they relate.
## Key Insights / Decisions
Important considerations, best practices, or trade-offs.
## Knowledge & Context Used
List the KB entries and connections referenced.

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

    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0 = time.monotonic()
    resp = client.chat.completions.create(
        model=model,
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
    from openai import OpenAI
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    content = _preprocess_content(raw_content)
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0 = time.monotonic()
    resp = client.chat.completions.create(
        model=model,
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
) -> list[tuple[float, object]]:
    """
    Embed query, compute cosine similarity against all stored chunk embeddings.
    Returns top_k (score, KnowledgeChunk) pairs, descending by score.
    Pass category= to filter to a specific op_category (e.g. 'ReconRule', 'Ownership').
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

    boosted2.sort(key=lambda x: x[0], reverse=True)
    return boosted2[:top_k]


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


# ── Ask SAI ───────────────────────────────────────────────────────────────────

def ask_sai(
    *,
    question: str,
    asked_by: Optional[str] = None,
    top_k: int = 5,
    model: str = "gpt-4o-mini",
    project_id: Optional[int] = None,
    history: list[dict] | None = None,
    db: Session,
) -> dict:
    """
    Semantic search → LLM answer synthesis.
    Falls through to connection/schema context even when KB confidence is below threshold.
    Only returns UNANSWERED when both KB and schema context are empty.
    """
    results = semantic_search(question, top_k, db)

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

    # Only queue as Open Question when we have nothing to answer with
    if not kb_confident and not schema_available:
        _persist_open_question(question, asked_by, db)
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

    context = "\n\n".join(context_parts) if context_parts else "(No matching KB entries — answer from Project Connections/Schema below)"

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

    prompt_text = system_template.format(
        context=context,
        connections=connections_block,
        question=question,
    )

    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)

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
        model=model,
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
        "sources": [
            {
                "entry_id":     chunk.entry_id,
                "chunk_id":     chunk.id,
                "topic":        chunk.topic,
                "score":        round(score, 4),
                "entry_title":  chunk.entry.title,
                "entry_system": chunk.entry.system,
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
