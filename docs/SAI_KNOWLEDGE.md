# SAI Knowledge Base — Architecture, Request/Response, and Operational Intelligence

## Overview

SAI (Smart Architect Intelligence) is the AI assistant embedded in Data Conversion Studio.
It answers questions by retrieving relevant knowledge from a structured KB, assembling it
into a context prompt, and calling an LLM to produce a response.

The KB has two distinct modes of content:

| Mode | Entry Types | Purpose |
|---|---|---|
| **General Knowledge** | UseCase, Process, Issue, Architecture, Q&A | Reference documentation, architecture descriptions, process walkthroughs |
| **Operational Rules** | OperationalRule + 8 sub-categories | Atomic decision rules: what to stop, who owns it, how to recover |

---

## Database Tables

| Table | Purpose |
|---|---|
| `conversion_knowledge_entries` | One row per KB entry. Holds all structured fields |
| `conversion_knowledge_chunks` | Overlapping text chunks with OpenAI embeddings (for RAG search) |
| `conversion_open_questions` | Unanswered Ask SAI questions queued for admin review |

### Key columns in `conversion_knowledge_entries`

| Column | Type | Used by |
|---|---|---|
| `title` | TEXT | Display, search, context |
| `type` | TEXT | Branch selector (OperationalRule vs general) |
| `op_category` | TEXT | Sub-category filter — see categories below |
| `severity` | TEXT | CRITICAL / HIGH / MEDIUM / LOW |
| `owner_team` | TEXT | Routing / escalation |
| `trigger_condition` | TEXT | When the rule activates |
| `action_steps` | TEXT (JSON array) | Ordered steps to execute |
| `stop_condition` | TEXT | When to halt processing |
| `recovery_steps` | TEXT (JSON array) | How to recover after failure |
| `summary` | TEXT | Used for general knowledge entries |
| `detailed_explanation` | TEXT | Used for general knowledge entries |
| `key_points` | TEXT (JSON array) | Used for general knowledge entries |
| `sql_template` | TEXT | SQL for validation rules |
| `systems_involved_json` | TEXT (JSON array) | Which systems the rule touches |
| `representative_emb` | TEXT (JSON) | Embedding of summary — used for duplicate detection |
| `embedding_status` | TEXT | pending / complete / partial / failed |

---

## Entry Types and Categories

### General Knowledge Types
`UseCase`, `Process`, `Issue`, `Architecture`, `Q&A`, `ViewDefinition`, `QueryLibrary`,
`QueryExample`, `SchemaDefinition`

These are ingested as narrative content. The LLM extracts:
`summary`, `detailed_explanation`, `key_points`, `decision`, `reason`

Chunked into ~400-word overlapping segments for RAG.

### Operational Rule Type
`OperationalRule` — atomic, decision-oriented entries.

**8 sub-categories (`op_category`):**

| Sub-category | What it captures |
|---|---|
| `ValidationRule` | Conditions that must be true before processing continues |
| `ProcessingRule` | Step-by-step rules for how data must flow |
| `FailureRule` | What constitutes a failure and what to do immediately |
| `RecoveryRule` | How to recover after a failure — ordered steps |
| `ReconciliationRule` | Recon-specific validation thresholds and match logic |
| `OwnershipRule` | Who owns what — routing, escalation, accountability |
| `StopCondition` | Explicit halt conditions — when to stop the batch/process |
| `ExceptionRule` | Handling edge cases that fall outside normal rules |

Rule entries are stored as a **single chunk** (no splitting) with this structured text:
```
[Title]
CATEGORY: StopCondition
TRIGGER: When GL recon variance exceeds threshold
ACTION: Halt batch | Alert GL team
STOP: Do not process downstream until variance cleared
SEVERITY: CRITICAL
OWNER: GL/Data Team
```

### Operational Intelligence Categories (Reference KB)
These use `op_category` on *any* entry type (not just OperationalRule), providing
a structured reference layer that agents and SAI can query directly:

| Category | What it captures |
|---|---|
| `BusinessProcess` | End-to-end business workflows |
| `ReconRule` | Reconciliation logic and validation thresholds |
| `Lineage` | Data lineage: source → transform → target paths |
| `DCTMapping` | DCT field/column mapping rules |
| `IncidentHistory` | Past incidents, root causes, resolutions |
| `Remediation` | Fix procedures and remediation playbooks |
| `Ownership` | Team/person ownership of systems and data |

These can be queried directly by `get_operational_knowledge(category=...)` without embedding
search — used when an agent knows exactly what category of knowledge it needs.

---

## Ingestion Flow

```
User Input (raw_content + type + metadata)
        │
        ▼
  _preprocess_content()
  Strip HTML, normalize whitespace, enforce 12,000 char limit
        │
        ▼
  Duplicate check — cosine similarity vs representative_emb of all entries
  Score > 0.92 → reject as near-duplicate
        │
        ▼
  LLM: _PROCESS_SYSTEM_PROMPT (gpt-4o-mini)
  ┌─ type = OperationalRule ──────────────────────────────────────────┐
  │  Extract ONE atomic rule:                                          │
  │  trigger_condition, action_steps, stop_condition, recovery_steps  │
  │  severity, owner_team, systems_involved_json, sql_template         │
  └───────────────────────────────────────────────────────────────────┘
  ┌─ type = UseCase / Process / Issue / etc. ─────────────────────────┐
  │  Extract: summary, detailed_explanation, key_points,              │
  │  decision, reason, op_category (optional)                          │
  └───────────────────────────────────────────────────────────────────┘
        │
        ▼
  Build chunks:
  • OperationalRule → 1 chunk: structured TRIGGER/ACTION/STOP text
  • General         → N chunks: ~400-word overlapping segments
        │
        ▼
  Embed each chunk (text-embedding-3-small via OpenAI)
  Store in conversion_knowledge_chunks
        │
        ▼
  Embed summary as representative_emb (for future duplicate detection)
  entry.embedding_status = "complete"
```

### Ingestion Entry Points

| Method | How it works |
|---|---|
| **Manual Add** | Single-entry form in KB tab → calls `POST /api/knowledge/entries` |
| **Bulk Import** | Upload CSV/Excel → `POST /api/knowledge/bulk-import` → one `process_entry()` per row |
| **Quick Add Rules** | Paste `---`-separated blocks in Operational Rules tab → `POST /api/knowledge/rules/direct-save` — no LLM, saves fields directly |
| **Decompose Document** | Paste full document → `POST /api/knowledge/decompose` → LLM splits into N atomic rules for preview → save selected rules |
| **Reprocess All Rules** | `POST /api/knowledge/reprocess-rules` → re-runs LLM extraction on all existing rule entries to populate structured fields |

---

## Ask SAI — Request / Response Flow

### Request

The frontend sends `POST /api/knowledge/ask`:

```json
{
  "question": "What should happen when B&C policy validation fails?",
  "project_id": 1,
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

`history` holds the last N turns of the conversation for multi-turn continuity.

### Processing Pipeline

```
Question text
      │
      ▼
  semantic_search(query, top_k=8)
  ┌─────────────────────────────────────────────────────────────────┐
  │ 1. Embed query (text-embedding-3-small)                         │
  │ 2. Cosine similarity vs ALL chunk embeddings in DB              │
  │ 3. Filter: status != LOW_QUALITY                                │
  │ 4. SQL boost: +0.08 if query has SQL keywords + entry is SQL    │
  │ 5. Rule boost (when query has rule keywords):                   │
  │    • OperationalRule / rule op_category → score + 0.15          │
  │    • Generic doc entry on rule query    → score − 0.25          │
  │ 6. Sort descending, return top 8                                │
  └─────────────────────────────────────────────────────────────────┘
      │
      ▼
  Threshold filter: keep only chunks with score ≥ 0.55
  Token budget check: stop adding chunks once context reaches ~6,000 tokens
      │
      ▼
  Context assembly: _format_chunk_context() per chunk
  ┌─ Rule entry ───────────────────────────────────────────────────┐
  │  [score=0.72] [RULE: Stop batch when GL recon fails]           │
  │    TRIGGER: When GL recon variance exceeds threshold           │
  │    ACTION: Halt batch | Alert GL team                          │
  │    STOP CONDITION: Do not process downstream                   │
  │    SEVERITY: CRITICAL | OWNER: GL/Data Team                    │
  └────────────────────────────────────────────────────────────────┘
  ┌─ General entry ────────────────────────────────────────────────┐
  │  [score=0.61] [GL Reconciliation Facts] <chunk.content>        │
  └────────────────────────────────────────────────────────────────┘
      │
      ▼
  Count rule entries in top results
  ┌─ rule_count > 0 ──────────────────────────────────────────────┐
  │  system_prompt = _OPERATIONAL_ANSWER_PROMPT                    │
  │  (dedicated operational format — bypasses DB template)         │
  └────────────────────────────────────────────────────────────────┘
  ┌─ rule_count == 0 ─────────────────────────────────────────────┐
  │  system_prompt = DB template (ask_sai_answer) or              │
  │                  _ANSWER_SYSTEM_PROMPT (fallback)              │
  └────────────────────────────────────────────────────────────────┘
      │
      ▼
  Build message chain:
    [system: prompt] + [last 6 history turns] + [user: question]
      │
      ▼
  LLM call: gpt-4o-mini, temperature=0.3
      │
      ▼
  Response returned to frontend
```

---

## Response Formats

### When Operational Rules are Retrieved

Prompt used: `_OPERATIONAL_ANSWER_PROMPT`
This prompt has **no** competing format instructions — only Mode E:

```markdown
## Decision Summary
2–3 sentences stating exactly what must happen.

## Applicable Rules
| Rule | Trigger | Action | Severity |
|------|---------|--------|----------|
| Stop batch when GL recon fails | When variance exceeds threshold | Halt batch &#124; Alert GL team | CRITICAL |

## Stop Conditions
(only if StopCondition/FailureRule entries present)

## Recovery Path
(only if RecoveryRule/ExceptionRule entries present — numbered steps)

## Ownership
(only if OwnershipRule entries or owner_team fields present)

## Rules Referenced
- Stop batch when GL recon fails
- GL team escalation rule
```

**FORBIDDEN in this mode:** Mermaid diagrams, ## Summary, ## Detailed Explanation,
## Architecture / Flow, ## Key Insights, governance narratives, financial descriptions.

### When General Knowledge is Retrieved

Prompt used: DB template (`ask_sai_answer`) or `_ANSWER_SYSTEM_PROMPT` fallback.
The LLM selects one of 4 modes:

| Mode | Trigger keywords | Format |
|---|---|---|
| **A — SQL** | write, build, generate SQL | Step-by-step SQL generation with ```sql blocks |
| **B — Architecture** | architecture, design, components, system, stack | ## Summary + Mermaid C4/flowchart |
| **C — Process/Flow** | how does, flow, steps, walkthrough, procedure | ## Summary + Mermaid flowchart + ## Step-by-Step |
| **D — Factual** | ownership, definition, comparison, troubleshooting | ## Summary + ## Detailed Explanation |

---

## Operational Rules vs Operational Intelligence — What's the Difference?

| Concept | Where it lives | `type` | `op_category` values | Used for |
|---|---|---|---|---|
| **Operational Rules** | Operational Rules tab | `OperationalRule` | ValidationRule, ProcessingRule, FailureRule, RecoveryRule, ReconciliationRule, OwnershipRule, StopCondition, ExceptionRule | Atomic runtime decisions — Ask SAI answers operational questions with structured rule tables |
| **Operational Intelligence** | Any KB entry + Operational Intelligence tab | Any type | BusinessProcess, ReconRule, Lineage, DCTMapping, IncidentHistory, Remediation, Ownership | Reference data — agents and advanced features query by category directly (no embedding search needed) |

Both use the same `op_category` column. Operational Rules is the strict runtime-decision
subset; Operational Intelligence is the broader reference layer.

---

## How Rules Feed Into Ask SAI — End-to-End Example

**Setup:** Admin adds a rule via Operational Rules tab:
- Title: "Stop Batch When GL Recon Fails"
- Type: OperationalRule / op_category: StopCondition
- Trigger: "When GL recon variance exceeds $0.01"
- Action: ["Halt batch", "Alert GL team via email"]
- Severity: CRITICAL / Owner: GL/Data Team

**What gets stored:**
```
Chunk content:
  Stop Batch When GL Recon Fails
  CATEGORY: StopCondition
  TRIGGER: When GL recon variance exceeds $0.01
  ACTION: Halt batch | Alert GL team via email
  SEVERITY: CRITICAL
  OWNER: GL/Data Team
```

**User asks:** "What should happen when reconciliation fails?"

**Retrieval:**
- "fails" and "reconciliation" are rule keywords → rule boost +0.15 applied
- The StopCondition chunk scores 0.72 (with boost); generic GL doc scores 0.61 − 0.25 = 0.36
- Rule entry surfaces to top; generic doc drops below threshold

**Context assembled:**
```
[score=0.72] [RULE: Stop Batch When GL Recon Fails]
  TRIGGER: When GL recon variance exceeds $0.01
  ACTION: Halt batch | Alert GL team via email
  SEVERITY: CRITICAL | OWNER: GL/Data Team
```

**Prompt:** `_OPERATIONAL_ANSWER_PROMPT` (no DB template, no competing format)

**Response:**
```markdown
## Decision Summary
When GL reconciliation variance exceeds $0.01, halt the batch immediately and alert
the GL team via email. Do not allow downstream processing until reconciliation is cleared.

## Applicable Rules
| Rule | Trigger | Action | Severity |
|------|---------|--------|----------|
| Stop Batch When GL Recon Fails | When GL recon variance exceeds $0.01 | Halt batch &#124; Alert GL team | CRITICAL |

## Ownership
GL/Data Team

## Rules Referenced
- Stop Batch When GL Recon Fails
```

---

## Key Service Functions

| Function | File | Purpose |
|---|---|---|
| `process_entry()` | `knowledge_processor.py` | LLM extraction + chunking + embedding for a single entry |
| `embed_entry()` | `knowledge_processor.py` | Embed chunks and store in DB |
| `semantic_search()` | `knowledge_processor.py` | Embed query, score all chunks, apply boosts, return top-K |
| `ask_sai()` | `knowledge_processor.py` | Full Q&A pipeline: search → context → LLM → response |
| `decompose_document()` | `knowledge_processor.py` | Split a document into N atomic rule dicts (preview, no save) |
| `check_near_duplicate()` | `knowledge_processor.py` | Reject near-duplicate entries before ingestion |
| `get_operational_knowledge()` | `knowledge_processor.py` | Direct category lookup (no embedding) for agents |
| `_format_chunk_context()` | `knowledge_processor.py` | Format a chunk for LLM context (rule card vs prose) |

## Key API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/knowledge/entries` | Create single KB entry |
| GET | `/api/knowledge/entries` | List entries (filterable by type, op_category) |
| POST | `/api/knowledge/ask` | Ask SAI a question |
| POST | `/api/knowledge/bulk-import` | Import CSV/Excel (up to 500 rows) |
| POST | `/api/knowledge/rules/direct-save` | Save pre-structured rules without LLM |
| POST | `/api/knowledge/decompose` | Extract atomic rules from a document (preview) |
| POST | `/api/knowledge/reprocess-rules` | Re-run LLM on all rule entries to populate fields |
| POST | `/api/knowledge/rebuild-embeddings` | Rebuild all chunk embeddings |
| DELETE | `/api/knowledge/entries/bulk-delete` | Delete entries matching a keyword |
| DELETE | `/api/knowledge/entries/{id}` | Delete single entry |

---

## Tuning Constants (`knowledge_processor.py`)

| Constant | Default | Meaning |
|---|---|---|
| `CONFIDENCE_THRESHOLD` | 0.55 | Minimum cosine similarity to include a chunk in context |
| `CONTEXT_TOKEN_BUDGET` | 6,000 | Max tokens of context sent to LLM |
| `DUPLICATE_THRESHOLD` | 0.92 | Cosine similarity above which entry is rejected as duplicate |
| `CHUNK_WORD_SIZE` | 400 | Words per chunk for general entries |
| `CHUNK_WORD_OVERLAP` | 50 | Overlap words between consecutive chunks |
| Rule boost | +0.15 | Score bonus for rule entries on rule queries |
| Generic penalty | −0.25 | Score penalty for non-rule entries on rule queries |
