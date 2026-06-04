# Data Conversion Studio — AI Architecture Guide

> **Purpose:** Explains every AI concept powering this tool, how they connect, and which module benefits from each technique. Use this as the reference when onboarding new engineers or designing new features.

---

## Table of Contents

1. [Core AI Concepts at a Glance](#1-core-ai-concepts-at-a-glance)
2. [AI Infrastructure Layer](#2-ai-infrastructure-layer)
3. [Module-by-Module Breakdown](#3-module-by-module-breakdown)
   - [3.1 Reports — NL→SQL](#31-reports--nlsql)
   - [3.2 Mapping AI — XML Generation](#32-mapping-ai--xml-generation)
   - [3.3 Reconciliation — DEV vs BASE](#33-reconciliation--dev-vs-base)
   - [3.4 Multi-Source Compare](#34-multi-source-compare)
   - [3.5 Ask SAI — Q&A](#35-ask-sai--qa)
   - [3.6 Knowledge Base — KB Management](#36-knowledge-base--kb-management)
   - [3.7 Admin — Schema Discovery & Embeddings](#37-admin--schema-discovery--embeddings)
   - [3.8 PS AI Agent — Production Support](#38-ps-ai-agent--production-support)
   - [3.9 PS Workflows](#39-ps-workflows)
   - [3.10 SAI — Intelligent Operations](#310-sai--intelligent-operations)
   - [3.11 Conversion Agent — Multi-Agent Pipeline](#311-conversion-agent--multi-agent-pipeline)
   - [3.12 Agentic — A2A Workflow Platform](#312-agentic--a2a-workflow-platform)
   - [3.13 Agents — Goal-driven Agents](#313-agents--goal-driven-agents)
   - [3.14 Development Hub — Stories & BRD](#314-development-hub--stories--brd)
   - [3.15 Query Intelligence](#315-query-intelligence)
   - [3.16 Payload Intelligence](#316-payload-intelligence)
   - [3.17 Dashboards — AI Dashboard Generator](#317-dashboards--ai-dashboard-generator)
   - [3.18 Mapping Assistant — DCT Expert Chat](#318-mapping-assistant--dct-expert-chat)
   - [3.19 Agent Mapper — DCT Manuscript Generator](#319-agent-mapper--dct-manuscript-generator)
   - [3.20 Form Builder](#320-form-builder)
   - [3.21 Ask AI — General Chat](#321-ask-ai--general-chat)
   - [3.22 Help Chat — In-app Contextual Help](#322-help-chat--in-app-contextual-help)
   - [3.23 Power BI Export](#323-power-bi-export)
   - [3.24 Pipeline — Conversion Orchestrator](#324-pipeline--conversion-orchestrator)
   - [3.25 Dashboard Summary](#325-dashboard-summary)
   - [3.26 Approval Workflows](#326-approval-workflows)
   - [3.27 Run Engine](#327-run-engine)
4. [Cross-Cutting AI Patterns](#4-cross-cutting-ai-patterns)
5. [Data Flow Examples (End-to-End)](#5-data-flow-examples-end-to-end)
6. [AI Concept Reference](#6-ai-concept-reference)

---

## 1. Core AI Concepts at a Glance

| AI Concept | What It Is | Where Used |
|---|---|---|
| **Embeddings** | Dense vectors that capture semantic meaning of text | Column matching, KB search, duplicate detection, Conversion Agent |
| **Cosine Similarity** | Measures how semantically close two vectors are (0.0–1.0) | All embedding lookups |
| **RAG** | Retrieve relevant context first, then feed to LLM for a grounded answer | Ask SAI, Reports, Mapping, Query Intelligence |
| **Vectorless RAG** | Schema retrieval via keyword tokenization + bigrams — no embeddings needed | PS AI Agent |
| **Schema-aware RAG** | Full DB schema (tables + FK relations) injected as LLM context | Dev Hub BRD, Dashboards |
| **BFS Graph Traversal** | Breadth-First Search over FK graph to find optimal JOIN paths | Mapping AI, Query Builder |
| **Prompt Engineering** | Structuring system + user + context to get reliable formatted output | Every LLM call |
| **Prompt Templates (DB-overridable)** | Admin-managed prompts override hardcoded defaults at runtime | All modules |
| **Session Memory / Compression** | Multi-turn history; old turns compressed via LLM summary | Reports, Ask SAI, PS AI |
| **Chunking** | Fixed 400-word / 50-word-overlap segments for embedding | Knowledge Base, Query Intelligence |
| **Streaming (SSE)** | Server-Sent Events push real-time progress to browser | Admin, SAI, Pipeline |
| **Confidence Scoring** | Numeric 0–1 indicator of AI output reliability | Reports, Reconciliation, KB, Conversion Agent |
| **Approval Gates** | Human approval required before write/destructive actions | Reports, PS AI, Agentic, SAI |
| **Multi-Agent Orchestration** | Specialized agents (Manager → Worker) each owning a sub-task | Conversion Agent, SAI, Agentic |
| **Agentic Tool Use** | LLM calls tools (lookup_schema, generate_sql, execute_sql) in a loop | PS AI, Ask AI, Agentic |
| **Structured LLM Output** | JSON-mode responses enforced for downstream parsing | Stories, BRD, Query Intelligence, Form Builder |
| **Delta Embeddings** | Re-embed only new/changed columns; skip already embedded ones | Admin |
| **Deterministic Chunking** | Fixed segments computed in Python — never delegated to LLM | Knowledge Base |
| **Vision / OCR** | Image/PDF → structured schema extraction | Form Builder |
| **DAX Generation** | LLM generates Power BI DAX measures from schema context | Dashboards, Power BI |

---

## 2. AI Infrastructure Layer

```
┌──────────────────────────────────────────────────────────────────────┐
│                        ai_client.py                                  │
│                                                                      │
│  Priority:  Azure OpenAI  (if AZURE_OPENAI_ENDPOINT set)            │
│             ↓                                                        │
│             OpenAI API   (fallback)                                 │
│                                                                      │
│  Chat model:       gpt-4o-mini  (temperature=0 for SQL/KB)          │
│  Embedding model:  text-embedding-3-small  (1536-dim vectors)       │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                        embeddings.py                                 │
│                                                                      │
│  build_column_definition(table, col, type, pk, samples)             │
│    → rich text description for each DB column                       │
│  embed_text(text) → 1536-dim float vector                           │
│  cosine_similarity(v1, v2) → float 0.0 … 1.0                       │
│  find_similar_columns(query_vec, stored_embeddings, top_k=15)       │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                   Prompt Template System                             │
│                                                                      │
│  DB table: conversion_prompt_templates                               │
│  At runtime: each module queries for its category (is_active=True)  │
│  If found → use DB prompt  │  If not → use hardcoded fallback       │
│  Admin UI can edit prompts live without redeploying code            │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                    AI Trace Log                                      │
│                                                                      │
│  Every LLM call writes to: conversion_ai_trace_log                  │
│  Captures: module, model, tokens_in, tokens_out, latency_ms,        │
│            prompt_text[:4000], response_text[:4000]                 │
│  Viewable in Admin → AI Traces tab                                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Module-by-Module Breakdown

---

### 3.1 Reports — NL→SQL

**What it does:** User types a question in plain English. The system converts it to SQL, runs it, and returns data with explanations and follow-up suggestions.

**File:** `api/routers/report_ai.py`

| AI Concept | How Applied |
|---|---|
| **Embeddings** | User question embedded → matched against column embeddings in `ColumnEmbedding` |
| **Cosine Similarity** | Top-K columns ranked by closeness to question; injected as schema context |
| **RAG** | Retrieved column context + session history → LLM generates SQL |
| **Session Memory** | Multi-turn history per session; compressed by LLM after 10 exchanges |
| **Document Context** | Uploaded PDF/DOCX/XLSX parsed → text injected as extra domain context |
| **Confidence Scoring** | 0–1 score based on how well matched columns covered the question |
| **Approval Gate** | Row count estimated; if > threshold → human approval required before execute |
| **Follow-up Suggestions** | LLM generates 3 next questions from result columns + first 5 rows |

#### Pipeline

```
User: "Show me total revenue by region for Q1"
  ↓
1. Embed question → 1536-dim vector
2. Cosine match vs stored column embeddings → top 15 columns selected
3. Schema agent: extract query_intent, ambiguities, confidence (0.84)
4. Prompt = SQL rules (dialect) + schema context + history + doc context
5. LLM (gpt-4o-mini, temp=0) → SQL
6. Safety check (block INSERT/UPDATE/DELETE)
7. Approval gate (COUNT estimate > threshold → 202 Accepted)
8. Execute → result rows
9. LLM generates explanation + 3 follow-up suggestions
10. Write to ai_trace_log
```

#### Session Memory Compression

```
After 10 conversation turns — old turns compressed:
  LLM: "Summarize this history in 3 sentences for continuity"
  → "User analyzed customer distribution by US state. Compared NY (1,240)
     vs CA (3,100). Most recent focus was West Coast states."
Next prompt: [compressed summary] + [last 2 raw turns only]
```

---

### 3.2 Mapping AI — XML Generation

**What it does:** Takes an XML/JSON/text template + source DB. AI maps source columns to template paths, builds JOIN-aware SQL, then fills the template row-by-row to produce output files.

**File:** `api/routers/mapping_ai.py`, `api/services/query_builder.py`

| AI Concept | How Applied |
|---|---|
| **Embeddings** | XML path names embedded; cosine-matched to column embeddings |
| **BFS Graph Traversal** | FK graph traversed to find optimal JOIN path between tables |
| **Root Table Scoring** | Candidate roots scored: FK centrality 35%, match density 30%, PK 20%, profile 15% |
| **Two-stage LLM Refinement** | Stage 1: flat SELECT list; Stage 2: GPT refines FROM/JOIN only |
| **Template Filling** | `{ColumnName}` substitution + Python expression transforms per field |

#### BFS JOIN Builder

```
XML paths matched to columns:
  {CustomerName} → customers.full_name  (0.91)
  {OrderDate}    → orders.order_date    (0.88)
  {ProductSKU}   → products.sku         (0.85)
  {LineTotal}    → order_items.total    (0.83)

Root scored: orders (highest FK centrality + match density)

BFS from "orders":
  Level 0: orders
  Level 1: customers (via orders.customer_id)
           order_items (via order_items.order_id)
  Level 2: products (via order_items.product_id)

Emits:
  SELECT customers.full_name AS CustomerName, orders.order_date AS OrderDate,
         products.sku AS ProductSKU, order_items.total AS LineTotal
  FROM orders
    LEFT JOIN customers  ON orders.customer_id = customers.customer_id
    LEFT JOIN order_items ON order_items.order_id = orders.order_id
    LEFT JOIN products   ON order_items.product_id = products.product_id
```

---

### 3.3 Reconciliation — DEV vs BASE

**What it does:** Compares a DEV environment's data against a BASE reference to validate correctness. AI auto-generates test queries and interprets discrepancy results.

**File:** `api/routers/reconciliation.py`

| AI Concept | How Applied |
|---|---|
| **Agent-based Query Generation** | `QueryCollectorAgent` generates count, duplicate, set_diff, join_explosion checks |
| **Confidence Scoring** | `0.4 × pass_rate + 0.6 × critical_pass_rate` |
| **AI Narrative** | LLM explains discrepancies in plain English |
| **Post-compare Chat** | User asks follow-up questions; run results injected as context |

#### Auto-generated Test Types

```
count_check:     SELECT COUNT(*) → DEV: 5120 vs BASE: 5118 → WARN
duplicate_check: GROUP BY + HAVING COUNT(*) > 1 → PASS
set_diff_check:  DEV EXCEPT BASE → FAIL (47 IDs only in DEV)
join_check:      FK integrity via JOIN COUNT → PASS

Confidence = 0.4 × 0.50 + 0.6 × 0.67 = 0.60
→ "60% confidence — DEV data does not fully match BASE"
```

---

### 3.4 Multi-Source Compare

**What it does:** Compares up to 4 data sources (DB queries + uploaded files) side-by-side using AI statistical analysis and structured checks.

**File:** `api/services/multi_compare.py`

| AI Concept | How Applied |
|---|---|
| **Statistical Profiling** | Null rates, numeric min/max/mean, top-5 categorical — server-side, no LLM |
| **Structured LLM Analysis** | GPT produces per-column comparison checks + narrative |
| **User Instruction Priority** | User instructions placed FIRST in prompt with `=== MUST BE ADDRESSED ===` header |

---

### 3.5 Ask SAI — Q&A

**What it does:** User asks a natural language question. Semantic search retrieves relevant KB chunks; LLM answers grounded in that context.

**File:** `api/routers/knowledge.py`, `api/services/knowledge_processor.py`

| AI Concept | How Applied |
|---|---|
| **RAG** | Embed question → retrieve top-K chunks (cosine ≥ 0.55) → LLM answers from chunks |
| **Token Budget** | Max 6,000 tokens of chunk context; stop adding chunks when budget exceeded |
| **Operational Rule Format** | Special answer format: trigger → action → stop condition |
| **Open Question Fallback** | If no chunk ≥ 0.55 → log to `conversion_open_questions` for admin review |
| **Multi-turn Chat** | Session history injected as prior Q&A context |

#### RAG Pipeline

```
Question: "What is the process for handling duplicate employee records?"
  ↓
1. Embed question → vector
2. Cosine match vs KnowledgeChunk embeddings
   0.89 → Chunk: "When duplicate detected, primary record retained. Secondary soft-deleted."
   0.81 → Chunk: "Duplicate detection: employee_id exact match OR name+DOB >95%"
   0.73 → Chunk: "TRIGGER: SSN match → ACTION: route to exceptions queue"
   0.51 → (below 0.55 threshold — excluded)
3. Inject 3 chunks into LLM context (within 6000-token budget)
4. LLM answers: "Per KB: duplicates detected by employee_id or name+DOB match...
                  primary record retained, secondary soft-deleted, routed to exceptions."
If no chunks qualify → reply: "I don't have a confident answer — queued for knowledge team."
```

---

### 3.6 Knowledge Base — KB Management

**What it does:** Admins paste raw content (SOPs, meeting notes, rules). System extracts structured knowledge, chunks, embeds, and indexes for Ask SAI retrieval.

**File:** `api/services/knowledge_processor.py`

| AI Concept | How Applied |
|---|---|
| **LLM Extraction** | GPT reads raw content → extracts title, type, summary, key_points, decision, trigger, action |
| **Deterministic Chunking** | Fixed 400-word / 50-word-overlap (Python only, no LLM) |
| **Embeddings** | Each chunk embedded; representative embedding = average of all chunk vectors |
| **Duplicate Detection** | New entry cosine vs existing entries; ≥ 0.92 → flagged as near-duplicate |
| **Quality Scoring** | LOW if trigger/action missing; MEDIUM if key_points empty; HIGH if complete |
| **Operational Rule Extraction** | trigger_condition → action_steps → stop_condition (atomic imperative format) |

#### Chunking Strategy

```
Document: 1,000 words

Without overlap:         With 50-word overlap (our approach):
  Chunk 1: words 1–400    Chunk 1: words 1–400
  Chunk 2: words 401–800  Chunk 2: words 351–750  ← overlap
  Chunk 3: words 801–1000 Chunk 3: words 701–1000 ← overlap

Overlap ensures a sentence at a boundary is fully captured in at least one chunk.
```

---

### 3.7 Admin — Schema Discovery & Embeddings

**What it does:** Connects to source DB, discovers full schema (tables, columns, PKs, FKs, sample rows), then generates embeddings for every column. Prerequisite for all AI features.

**File:** `api/routers/admin.py`, `api/services/embeddings.py`

| AI Concept | How Applied |
|---|---|
| **Column Definition Building** | table + column + data type + PK flag + sample values → rich text description |
| **Embedding Generation** | Streamed via SSE; vector stored in `ColumnEmbedding` |
| **Delta Mode** | Skip columns already embedded with same model; only embed new/changed |
| **Schema AI Chat** | Admin describes tables/columns conversationally; LLM enriches metadata |

#### Column Definition Example

```python
build_column_definition("employees", "annual_salary", "FLOAT", is_pk=False,
                         sample_values=[45000.0, 72000.0, 31500.0])
# → "Table employees, column annual_salary, type FLOAT, PK: No,
#    sample values: 45000.0, 72000.0, 31500.0"
# This rich text → 1536-dim vector stored in ColumnEmbedding
```

**Why sample values matter:** Without samples, `emp_stat` embedding is vague. With samples `["A","I","T","R"]`, it captures Active/Inactive/Terminated/Retired — much stronger match for queries like "show active employees."

---

### 3.8 PS AI Agent — Production Support

**What it does:** Conversational AI for on-call analysts. Lets them ask questions about live data and trigger remediation actions via pre-registered APIs — without needing embeddings pre-generated.

**File:** `api/routers/ps_ai.py`

| AI Concept | How Applied |
|---|---|
| **Vectorless RAG** | `lookup_schema` tool scores columns via keyword tokens + character bigrams (no vectors) |
| **Alias/Synonym Boost** | `SchemaMetadata.aliases` and `.synonyms` extend keyword matching vocabulary |
| **FK Expansion** | After scoring, FK-related tables automatically appended even if not directly matched |
| **Agentic Tool Loop** | LLM calls tools (`lookup_schema → generate_sql → execute_sql`) up to 10 rounds |
| **Intent Routing** | LLM classifies QUERY / ACTION / MIXED before selecting tools |
| **Approval Gate** | Any write via API requires explicit user approval card before execution |
| **Session Memory** | Per-conversation history up to 20 messages |

#### Vectorless Scoring Formula

```python
def _score_column(q_tokens, q_bigrams, table_name, column_name, data_type):
    score = 0.0
    for token in q_tokens:
        if token in column_name.lower():  score += 3.0   # column name match
        if token in table_name.lower():   score += 2.0   # table name match
        if token in data_type.lower():    score += 0.5   # type hint
    score += len(q_bigrams & char_bigrams(col + " " + table)) * 1.0  # fuzzy match
    return score
```

#### Alias/Synonym Boost

```
Admin configures in SchemaMetadata:
  Table: policy_master
    aliases:  "Policy, Contract, Agreement"
    synonyms: ["pol", "plcy"]

User asks: "Show me all contracts for client 1234"
  q_tokens = ["contracts", "client", "1234"]
  "contracts" matches alias "Contract" → policy_master scores highest → selected
```

#### Agentic Tool Loop Example

```
User: "Find failed ETL runs from yesterday and retry them"
  Round 1 → lookup_schema("failed ETL runs") → etl_runs table
  Round 2 → generate_sql("failed ETL runs yesterday") → SELECT sql
  Round 3 → execute_sql(sql) → [{job_id:101}, {job_id:102}]
  Round 4 → list_api_endpoints() → Retry ETL Job API (id=5)
  Round 5 → execute_api_for_rows(api_id=5, sql)
            ⚠ APPROVAL CARD: "Retry 2 ETL jobs?" → User approves
            → 2 API calls made sequentially (200ms delay)
```

---

### 3.9 PS Workflows

**What it does:** Workflow automation engine for multi-step SQL→API→Email pipelines. Steps extracted from PS AI conversations or built manually. Supports scheduling.

**File:** `api/routers/ps_workflows.py`

| AI Concept | How Applied |
|---|---|
| **SQL Extraction from Chat** | Parses PS AI conversation text to extract SQL steps automatically |
| **No LLM at runtime** | Workflow execution is deterministic — LLM only used at creation time for SQL extraction |

```
Workflow Example:
  Step 1: SQL — SELECT * FROM etl_failures WHERE date = YESTERDAY
  Step 2: API — POST /etl/retry for each row from Step 1
  Step 3: Email — Send summary report to ops@company.com

Scheduling: manual / every N minutes / daily 06:00 / weekly Monday
```

---

### 3.10 SAI — Intelligent Operations

**What it does:** AI-powered root cause analysis and automated remediation. A manager agent orchestrates specialized worker agents, streams step-by-step reasoning, and surfaces actions requiring human approval.

**File:** `api/routers/sai.py`

| AI Concept | How Applied |
|---|---|
| **Multi-Agent Orchestration** | Manager agent → specialized sub-agents (RCA, Remediation, Notification) |
| **Streaming (SSE)** | Real-time reasoning lines, findings, and action statuses pushed to browser |
| **Operational Memory** | Issue frequency patterns tracked in DB; used to detect recurring problems |
| **Embeddings** | Schema understanding injected into agent context |
| **Approval Workflow** | Actions (email/ticket/API call) held for human approval in assisted mode |
| **Modes** | Manual (human-driven) / Assisted (AI suggests, human approves) / Autonomous |

```
Run triggered on anomaly:
  ↓
Manager Agent: "Reconciliation failed — 2,000 records missing in DEV"
  ↓
RCA Agent: analyzes etl_runs, reconciliation_results, pipeline logs
  → Finding: "ETL job 'Load_Employees' failed at 03:42 — timeout"
  → Root cause: "Source DB query exceeded 30s limit"
  ↓
Remediation Agent: proposes actions
  → [1] Retry ETL job 'Load_Employees'
  → [2] Increase timeout setting to 120s
  → [3] Notify data team via email
  ↓
Approval Queue (assisted mode):
  User sees: "SAI wants to retry Load_Employees ETL. Approve?"
  → Approved → API call executed
```

---

### 3.11 Conversion Agent — Multi-Agent Pipeline

**What it does:** Full column-matching pipeline: Manager → Mapper → Transformer → Validator. Profiles source columns, matches to target using embeddings, infers value mappings, generates transform expressions, then validates.

**File:** `api/routers/conversion_agent.py`

| AI Concept | How Applied |
|---|---|
| **Embeddings + Cosine Similarity** | Column matching: source column embeddings vs target column embeddings |
| **LLM Value Mapping Inference** | GPT infers code mappings (e.g., `A` → `Active`, `I` → `Inactive`) |
| **Transformation Expression Generation** | LLM generates Python/SQL expressions for field-level transforms |
| **14-point Validation** | Rule + AI hybrid validator with per-check confidence thresholds |
| **Column Profiling** | Null%, distinct count, pattern detection — used to guide mapping confidence |

```
Mapper Agent:
  Source: employees.emp_status  (samples: ["A","I","T"])
  Target: staff.status_code     (samples: ["Active","Inactive","Terminated"])
  Cosine similarity: 0.78 → matched

Value Mapping LLM:
  "Infer the mapping from source codes to target values"
  → { "A": "Active", "I": "Inactive", "T": "Terminated" }

Transform Expression:
  "CASE emp_status WHEN 'A' THEN 'Active' WHEN 'I' THEN 'Inactive'
                   WHEN 'T' THEN 'Terminated' ELSE emp_status END"
```

---

### 3.12 Agentic — A2A Workflow Platform

**What it does:** Role/Agent/Card/Execution management for Agent-to-Agent (A2A) workflows. Each agent card has a role-based system prompt; cards execute sequentially with loop-back routing and human approval gates.

**File:** `api/routers/agentic.py`

| AI Concept | How Applied |
|---|---|
| **Role-based Prompt Engineering** | Each agent card has a role (Business Analyst, Data Developer, QA Engineer, Manager) with specialized system prompt |
| **Structured Tag Parsing** | LLM outputs `[DECISION: APPROVE|REJECT|REVISE]` tags; executor routes based on tag |
| **Module Execution Tools** | LLM outputs `[CREATE_DEV_PLAN]`, `[GENERATE_TESTS]`, `[DESIGN_DASHBOARD]`, `[RUN_REPORT]` → backend executes the corresponding module |
| **Loop-back State Machine** | Cards can loop back to prior agents (e.g., Manager rejects → Developer revises → resubmit) |
| **Approval Workflow** | Manager card `[DECISION: APPROVE]` required before next stage executes |
| **AI Role Generation** | `POST /agentic/roles/ai-generate` → LLM generates full role description from job title |

```
Workflow Example: "Analyze payroll discrepancies"

Card 1 — Business Analyst:
  Prompt: "You are a BA. Analyze the requirements and identify data needs."
  Output: "Need payroll_runs, employees tables. Key fields: gross_amount, net_amount."
          [CREATE_DEV_PLAN]
  → Backend: generates dev plan artifact

Card 2 — Data Developer:
  Prompt: "You are a developer. Write SQL for the BA's requirements."
  Output: SQL query + explanation
          [DECISION: READY_FOR_REVIEW]

Card 3 — Manager:
  Prompt: "Review the developer's SQL for correctness."
  Output: "Looks correct."
          [DECISION: APPROVE]
  → Next card executes

Card 4 — QA Engineer:
  Prompt: "Write test cases for this SQL."
          [GENERATE_TESTS]
  → Backend: generates test cases
```

---

### 3.13 Agents — Goal-driven Agents

**What it does:** Simple goal-driven agents created from a description. Can be created manually or bootstrapped from a PS AI conversation. LLM generates and executes a step-by-step plan.

**File:** `api/routers/agents.py`

| AI Concept | How Applied |
|---|---|
| **Goal-to-Plan LLM** | LLM generates a step-by-step plan from the agent's goal description |
| **Step-by-step Execution** | Agent engine executes each step, logging results and timing |
| **From-PS-Chat Bootstrap** | Extract agent goal from a Production Support conversation automatically |

```
Agent: goal = "Validate that all GL accounts in DEV match the BASE reference"
  LLM plan:
    Step 1: Query DEV for distinct GL account codes
    Step 2: Query BASE for distinct GL account codes
    Step 3: Compare sets — find DEV-only and BASE-only codes
    Step 4: Report discrepancies with counts
  Execute → logs each step with timing and result
```

---

### 3.14 Development Hub — Stories & BRD

**What it does:** Two AI features for developers — (A) multi-call story analysis: import JIRA/ADO tickets → extract use cases + SQL prompts for 4 personas; (B) BRD analysis: paste requirements → LLM generates Given/When/Then criteria + SQL validation queries anchored to real schema.

**Files:** `api/routers/stories.py`, `api/routers/development.py`

#### A — Stories (Three-Call LLM Pipeline)

| AI Concept | How Applied |
|---|---|
| **Multi-call Structured Extraction** | Call A: parse stories; Call B: unified intent + conflict detection; Call C: use-case + SQL prompts |
| **Structured LLM Output** | JSON-mode enforced; 4 SQL prompt sets per story (dev / report / dashboard / test) |
| **Persona-specific SQL Prompts** | Different prompt framing per role to produce relevant SQL for each team |

```
Input: 5 JIRA tickets about employee payroll feature

Call A — Parse & Consolidate:
  "Extract key fields from each ticket: title, description, acceptance_criteria, priority"
  → structured list of parsed stories

Call B — Unified Intent:
  "Find conflicts, dependencies, and unified data intent across all stories"
  → { conflicts: ["AC-3 and AC-7 define different fiscal year start"],
      unified_intent: "Monthly payroll reconciliation with tax validation" }

Call C — Use-case Extraction + SQL Prompts:
  "For each use-case, generate SQL prompts for: Developer / Report author /
   Dashboard designer / Test engineer"
  → {
      use_case: "Tax amount validation",
      dev_sql_prompt:       "Write SQL to compute tax_amount per employee for Q1",
      report_sql_prompt:    "Write SQL returning tax breakdown by department for export",
      dashboard_sql_prompt: "Write SQL for a KPI widget showing total tax liability",
      test_sql_prompt:      "Write SQL to compare tax_amount DEV vs BASE"
    }
```

#### B — BRD Analysis (Schema-aware RAG)

| AI Concept | How Applied |
|---|---|
| **Schema-aware RAG** | Full schema (30 tables + 20 FK relations) loaded from `context_cache` and injected into prompt |
| **Structured LLM Output** | JSON-mode: `{"criteria": [{given, when, then, sql_validation, priority, complexity}]}` |
| **FK-aware SQL** | LLM writes JOIN queries using only real table/column names from injected schema |

```
System prompt contains:
  "DATABASE SCHEMA:
   - employees: employee_id, full_name, dept_id, salary, status, hire_date
   - departments: dept_id, dept_name, manager_id
   FK: employees.dept_id → departments.dept_id"

BRD: "Payroll admin wants to export tax data by state for quarterly filings."

Output:
  AC-1: Given active employees with state assignment,
        When admin requests Q1 state export,
        Then system returns payroll grouped by state
        SQL: SELECT e.state, SUM(p.tax_amount) FROM employees e
             JOIN payroll p ON e.employee_id = p.employee_id
             WHERE e.status='ACTIVE' GROUP BY e.state
```

---

### 3.15 Query Intelligence

**What it does:** Comprehensive SQL analysis — anti-pattern detection, 11-section deep extraction (lineage, business rules, KPI detection, validation hints, troubleshooting), SQL enhancement, KB persistence, and RAG chat interface.

**File:** `api/routers/query_intelligence.py`

| AI Concept | How Applied |
|---|---|
| **Structured LLM Extraction** | 14-field JSON output: lineage, business rules, KPIs, validation hints, index recommendations, cost estimate, Mermaid diagram |
| **Anti-pattern Library** | Rule-based checks for N+1 joins, missing indexes, SELECT *, full table scans — no LLM needed |
| **Mermaid Diagram Generation** | LLM generates data lineage as a Mermaid flowchart string |
| **RAG Chat** | KB chunk retrieval (cosine similarity) provides grounded answers to SQL questions |
| **SQL Enhancement** | LLM rewrites query applying best practices from anti-pattern analysis |

```
Input SQL:
  SELECT * FROM orders o, customers c WHERE o.customer_id = c.customer_id

Anti-pattern detection (rule-based):
  ✗ SELECT *: forces full row fetch — use explicit columns
  ✗ Implicit JOIN (comma syntax): use explicit JOIN syntax
  ✗ No index hint on orders.customer_id

LLM deep extraction:
  lineage: orders → customers (customer_id)
  business_rules: "Order must have a valid customer"
  kpis: ["order_count", "customer_order_avg"]
  sql_validation: "SELECT COUNT(*) FROM orders WHERE customer_id IS NULL"
  troubleshooting: "If query is slow, check index on orders.customer_id"
  mermaid: "graph LR\n  orders -->|customer_id| customers"
  estimated_cost: "HIGH — full table scan on orders (no index)"
  recommended_indexes: ["CREATE INDEX IX_orders_cust ON orders(customer_id)"]

Enhanced SQL:
  SELECT o.order_id, o.order_date, c.full_name, c.email
  FROM orders o
  INNER JOIN customers c ON o.customer_id = c.customer_id
  -- WITH (INDEX = IX_orders_cust)
```

---

### 3.16 Payload Intelligence

**What it does:** Analyzes JSON payloads to detect schema mismatches, missing fields, type errors, and field mappings — with confidence scores per field. Sessions are persisted for comparison.

**File:** `api/routers/payload_intelligence.py`

| AI Concept | How Applied |
|---|---|
| **LLM Schema Inference** | GPT infers the expected schema from the payload structure |
| **Named Entity Extraction** | Identifies field names, types, nested objects, arrays |
| **Confidence Scoring** | Per-field mapping confidence (0–1) based on type match + name similarity |
| **Issue Categorization** | `missing_required`, `null_value`, `type_mismatch`, `unexpected_field` |

```
Input JSON payload:
  { "emp_id": "E001", "salary": "75000", "dept": null, "start_dt": "2024-01-15" }

Expected schema (inferred from DB catalog):
  { "employee_id": int, "annual_salary": float, "department_name": str, "hire_date": date }

Output:
  Issues:
    - emp_id → employee_id: type mismatch (string vs int), confidence: 0.82
    - salary → annual_salary: type mismatch (string vs float), confidence: 0.91
    - dept → department_name: null_value (required), confidence: 0.76
    - start_dt → hire_date: name mapping, confidence: 0.68
  Field mappings: { emp_id→employee_id, salary→annual_salary, dept→department_name, start_dt→hire_date }
```

---

### 3.17 Dashboards — AI Dashboard Generator

**What it does:** Generates full analytics dashboards from natural language intent or SQL. Each widget (KPI, bar, line, pie, table) is generated by LLM with dialect-aware SQL. Power BI export produces DAX measures + TMSL model.

**File:** `api/routers/dashboards.py`

| AI Concept | How Applied |
|---|---|
| **Schema-aware RAG** | Query context (tables, columns, relations) injected into dashboard prompt |
| **Structured LLM Output** | JSON-mode: widget type, title, SQL, position, size — layout validated for 12-column grid |
| **Dialect-aware SQL** | Prompt includes dialect-specific rules (MSSQL TOP vs PostgreSQL LIMIT) |
| **DAX Generation** | LLM generates Power BI DAX measures with table/column validation from schema |
| **Per-widget Refinement** | Individual widget SQL/title regenerated via LLM with user feedback |
| **Layout Constraint Solving** | LLM respects 12-column grid, no overlaps, widget minimum sizes |

```
User: "Build a sales performance dashboard"

LLM output (JSON):
  {
    "widgets": [
      { "type": "kpi",   "title": "Total Revenue",    "sql": "SELECT SUM(amount) FROM sales",         "x":0, "y":0, "w":3, "h":2 },
      { "type": "bar",   "title": "Revenue by Region", "sql": "SELECT region, SUM(amount) FROM sales GROUP BY region", "x":3, "y":0, "w":6, "h":4 },
      { "type": "line",  "title": "Monthly Trend",     "sql": "SELECT MONTH(sale_date), SUM(amount) FROM sales GROUP BY MONTH(sale_date)", "x":0, "y":2, "w":6, "h":4 },
      { "type": "table", "title": "Top 10 Deals",      "sql": "SELECT TOP 10 deal_name, amount FROM sales ORDER BY amount DESC", "x":6, "y":4, "w":6, "h":4 }
    ]
  }

Power BI Export:
  DAX: TotalRevenue = SUM(sales[amount])
  TMSL model with table/column definitions
```

---

### 3.18 Mapping Assistant — DCT Expert Chat

**What it does:** Expert chatbot specifically for Duck Creek Technologies (DCT) manuscript questions. Answers are grounded in the Knowledge Base + OOTB sample XML templates via semantic search.

**File:** `api/routers/mapping_assistant.py`

| AI Concept | How Applied |
|---|---|
| **KB Semantic Search** | Cosine similarity ≥ 0.72 on KB chunks to retrieve relevant DCT knowledge |
| **Sample XML Keyword Ranking** | OOTB sample XML files ranked by entity + type keyword matching from the question |
| **Context-aware Prompting** | KB chunks + matching sample XMLs + session history injected into LLM prompt |
| **Source Attribution** | Answer includes which KB entries and sample files were used |

```
User: "How do I map a policy endorsement in a DCT manuscript?"

KB retrieval (cosine ≥ 0.72):
  Chunk A: "Policy endorsement requires <Endorsement> element under <Policy>..."
  Chunk B: "Use manuscriptID='ENB.ENDORSE' for endorsement entity type"

Sample XML ranking:
  policy_endorsement_sample.xml → score: 8.5 (entity "policy" + type "endorsement" in filename)
  base_policy_sample.xml        → score: 3.0

LLM answer (grounded in both):
  "To map a policy endorsement: use manuscriptID='ENB.ENDORSE', place
   <Endorsement> as a child of <Policy>. See sample: policy_endorsement_sample.xml
   Source: KB entries #12, #34"
```

---

### 3.19 Agent Mapper — DCT Manuscript Generator

**What it does:** Generates Duck Creek DCT manuscript XML from natural language descriptions. Parses intent → infers entity/field/source/type → produces Grid rows with operation tags (added/updated).

**File:** `api/routers/agent_mapper.py`, `api/routers/agent_mapper_templates.py`

| AI Concept | How Applied |
|---|---|
| **Intent-to-Mapping Inference** | LLM extracts: entity name, LOB, field list, source system, manuscript type |
| **Template Inheritance Detection** | LLM identifies whether to create or extend an existing OOTB template |
| **Confidence Warnings** | Low-confidence field suggestions flagged with alternatives |
| **KB Indexing for Templates** | OOTB templates embedded in KB for semantic retrieval via Mapping Assistant |

```
User: "Create a property risk manuscript that maps building values from the PRISM system"

LLM extracts:
  entity:     "PropertyRisk"
  lob:        "Property"
  source:     "PRISM"
  type:       "Risk"
  fields:     [BuildingValue, ConstructionType, YearBuilt, SquareFootage]
  mode:       "create"  (no matching OOTB template found)

Output XML:
  <ManuscriptMapping manuscriptID="PROP.RISK.PRISM">
    <GridRow operation="added">
      <Field name="BuildingValue" source="PRISM.building_value" type="decimal"/>
      <Field name="ConstructionType" source="PRISM.const_type" type="string"/>
      ...
    </GridRow>
  </ManuscriptMapping>
```

---

### 3.20 Form Builder

**What it does:** AI-driven form design and data binding. Supports image/PDF OCR extraction for form drafting, AI-ask modifications, confidence-scored field auto-mapping, and multi-format output (PDF/web/JSON).

**File:** `api/routers/form_builder.py`

| AI Concept | How Applied |
|---|---|
| **Vision / OCR** | Image or PDF uploaded → GPT-4o vision extracts form schema (sections, fields, labels) |
| **Structured LLM Drafting** | `POST /form-builder/draft` → LLM produces JSON form schema from description or image |
| **LLM Ask-AI Modifications** | User types "add a phone number field to section 2" → LLM edits form JSON |
| **Embedding-based Field Auto-mapping** | Form field names embedded → cosine matched to DB column embeddings with confidence scores |
| **Layout Suggestions** | LLM suggests `label_value` vs `grid` layout per section based on field types |

```
Input: Upload a PDF of an employee onboarding form

Vision extraction:
  Section 1: Personal Information
    Fields: [Full Name (text), Date of Birth (date), SSN (masked)]
  Section 2: Employment Details
    Fields: [Start Date (date), Department (dropdown), Job Title (text)]
  Section 3: Emergency Contact
    Fields: [Contact Name (text), Relationship (dropdown), Phone (tel)]

Field auto-mapping (embedding cosine match):
  "Full Name"   → employees.full_name       (0.94)
  "Date of Birth" → employees.date_of_birth (0.91)
  "Department"  → departments.dept_name     (0.88)
  "Start Date"  → employees.hire_date       (0.85)
  "SSN"         → employees.ssn             (0.79 — flagged: PII)
```

---

### 3.21 Ask AI — General Chat

**What it does:** Conversational AI for business questions, SQL generation, KPI computation, and action execution (reports, fixes, workflows) with confirmation gates.

**File:** `api/routers/ask_ai.py`

| AI Concept | How Applied |
|---|---|
| **Multi-step LLM Pipeline** | Intent detection → schema inference → SQL generation → data fetch → KPI computation → narrative |
| **Action Execution with Confirmation** | Actions (update, trigger, send) require user preview + explicit confirmation |
| **Entity-driven Context** | Entity names extracted from question → used to narrow schema context |
| **Session History** | Prior Q&A injected as context for multi-turn coherence |
| **AI Trace Logging** | Every call logged to `ai_trace_log` |

```
User: "What is the average salary by department and flag any department above 150k?"

Step 1 — Intent: aggregation + threshold filter
Step 2 — Schema inference: employees.salary, departments.dept_name
Step 3 — SQL:
  SELECT d.dept_name, AVG(e.salary) as avg_salary,
         CASE WHEN AVG(e.salary) > 150000 THEN 'FLAG' ELSE 'OK' END as status
  FROM employees e JOIN departments d ON e.dept_id = d.dept_id
  GROUP BY d.dept_name ORDER BY avg_salary DESC
Step 4 — Execute → results
Step 5 — KPI: max_avg = 187,000 (Engineering, FLAGGED)
Step 6 — Narrative: "Engineering exceeds the $150k threshold. 2 of 8 departments flagged."
```

---

### 3.22 Help Chat — In-app Contextual Help

**What it does:** In-app chatbot that answers questions about how to use the platform. Aware of the current project's connections, mappings, agents, and test cases.

**File:** `api/routers/help_chat.py`

| AI Concept | How Applied |
|---|---|
| **Few-shot Prompting** | Extensive system prompt with all platform features, workflow steps, and example Q&A |
| **Project Context Injection** | Active project's connections, mappings, agents, test cases injected into prompt |
| **Multi-turn Conversation** | Session history maintained for follow-up questions |

```
System prompt includes:
  "Platform features: [Reports, Mapping, Reconciliation, SAI, Knowledge Base, ...]
   Current project: ProjectAlpha
     Connections: [MSSQL prod_db, Snowflake dw_source]
     Mappings: [employee_mapping (v3), payroll_mapping (v1)]
     Agents: [Reconciliation_Agent_1]
     Test cases: [TC-001 count_check, TC-002 duplicate_check]"

User: "How do I regenerate my SQL query?"
LLM: "In the Mapping tab for employee_mapping, click 'Generate Query' — this
      runs the BFS JOIN builder using your collected schema. If you want to
      customize it, use the SQL editor below the generated query."
```

---

### 3.23 Power BI Export

**What it does:** Generates Power BI-ready DAX measures and TMSL model definitions from dashboard widgets and schema context. Includes a DAX function reference library and snippet builder.

**File:** `api/routers/dashboards.py` (`/dashboards/{id}/powerbi-export`)

| AI Concept | How Applied |
|---|---|
| **DAX Generation** | LLM generates DAX measures (e.g., `TotalRevenue = SUM(sales[amount])`) using schema context |
| **Schema Validation** | Generated DAX table/column references validated against discovered schema |
| **TMSL Model Generation** | LLM structures the Power BI tabular model (relationships, measures, formatting) |
| **Grammar Validation** | DAX syntax rules enforced in prompt to prevent invalid measures |

```
Input: Dashboard with "Revenue by Region" bar widget

DAX output:
  Revenue_by_Region =
    CALCULATE(
      SUM(sales[amount]),
      ALLSELECTED(sales[region])
    )

TMSL model:
  {
    "name": "SalesDashboard",
    "tables": [{ "name": "sales", "columns": [...], "measures": [...] }],
    "relationships": [{ "fromTable": "sales", "fromColumn": "customer_id",
                        "toTable": "customers", "toColumn": "customer_id" }]
  }
```

---

### 3.24 Pipeline — Conversion Orchestrator

**What it does:** Orchestrates the full conversion pipeline (Generate SQL → Validate → Dispatch) with background scheduling. Coordinates the Mapping AI, Validation, and Dispatch services.

**File:** `api/routers/pipeline.py`

| AI Concept | How Applied |
|---|---|
| **Orchestration (not LLM)** | Calls downstream agents sequentially — no LLM at runtime |
| **XSD Validation** | Optional schema validation of generated XML output |
| **Scheduling** | Manual / interval / daily / weekly triggers |

```
Pipeline run:
  Step 1 — Generate: mapping_ai.generate_all_xml() → 5,120 XML files
  Step 2 — Validate: check required fields, XSD schema, PII rules
            → PASS: 5,102 / FAIL: 18 (missing required field 'TaxCode')
  Step 3 — Dispatch: send valid files to Azure Blob / SFTP / API endpoint
  Step 4 — Log: write run_log entry with counts + timings
```

---

### 3.25 Dashboard Summary

**What it does:** Real-time KPI dashboard aggregating pipeline health metrics — schema tables, mappings, generated records, validation status, run logs, PS conversations, admin activity.

**File:** `api/routers/dashboard.py`

| AI Concept | How Applied |
|---|---|
| **No AI** | Pure aggregation of downstream outputs from the database |

```
Summary metrics:
  Schema tables discovered: 42
  Mappings created: 7
  XML records generated today: 5,120
  Validation pass rate: 99.6%
  Pipeline runs (last 7 days): 14 success / 2 failed
  PS AI conversations today: 23
  AI trace calls today: 187 (avg latency: 1,240ms)
```

---

### 3.26 Approval Workflows

**What it does:** Multi-step approval chains gating agent pipeline runs, agentic card executions, SAI remediation actions, and dispatch operations at the project level.

**File:** `api/routers/approval_workflows.py`, `api/routers/approval_requests.py`

| AI Concept | How Applied |
|---|---|
| **Human-in-the-loop** | Approval step required by Manager role before pipeline proceeds |
| **No LLM** | Approval routing is rule-based (role → step → required decision) |

```
Approval chain:
  Step 1 (Developer) → submits artifact
  Step 2 (Team Lead) → review within 24h → APPROVE / REJECT with notes
  Step 3 (Manager)   → final approval → triggers dispatch

On rejection: notified back to developer, re-submit triggers new chain
```

---

### 3.27 Run Engine

**What it does:** Triggers conversion runs and records run logs (status, timing, record counts) per connection.

**File:** `api/routers/run_engine.py`

| AI Concept | How Applied |
|---|---|
| **No AI** | Thin orchestration layer — calls Conversion Agent service and records results |

---

## 4. Cross-Cutting AI Patterns

### 4.1 Prompt Template Override (Every Module)

Every LLM call checks the DB for an admin-configured prompt before using the hardcoded default:

```python
system_prompt = _HARDCODED_FALLBACK

try:
    tmpl = db.query(PromptTemplate).filter(
        PromptTemplate.category == "my_module",
        PromptTemplate.is_active == True
    ).first()
    if tmpl and tmpl.content.strip():
        system_prompt = tmpl.content.strip()  # DB override wins
except Exception:
    pass  # never break on logging failure
```

### 4.2 AI Trace Logging (Every LLM Call)

```python
try:
    db.add(AITraceLog(
        module="report_ai", conn_id=conn_id, model="gpt-4o-mini",
        prompt_text=full_prompt[:4000], response_text=raw[:4000],
        tokens_in=usage.prompt_tokens, tokens_out=usage.completion_tokens,
        latency_ms=int((time.time() - t0) * 1000),
    ))
    db.commit()
except Exception:
    pass
```

### 4.3 Context Budget Management

| Module | Token Budget | Strategy |
|---|---|---|
| Reports schema context | 3,000 tokens | Top-K (15) columns by cosine score |
| Ask SAI chunk context | 6,000 tokens | Chunks sorted by score; stop when budget exceeded |
| Schema-aware RAG (BRD) | Up to 30 tables + 20 FKs | Full schema dump, no filtering |
| Session history | Variable | LLM compresses old turns after 10 exchanges |
| Mapping AI JOIN prompt | 2,000 tokens | Two-stage: SELECT list first, FROM/JOIN in second call |

### 4.4 Fallback Chain

```
1. Try primary approach (BFS JOIN builder with FK graph)
2. FK graph empty → fallback to flat embedding-only SQL
3. Embeddings not generated → fallback to column name Jaccard similarity (client-side)
4. LLM call fails → return structured error with partial results
5. DB prompt template missing → use hardcoded fallback prompt
6. KB chunks below threshold → log to open_questions, reply with uncertainty
```

### 4.5 RAG Mode Comparison

| Mode | How Context is Retrieved | Prerequisite | Best For |
|---|---|---|---|
| **Embedding RAG** | Cosine similarity on pre-generated vectors | Run "Generate Embeddings" | Reports, Ask SAI, Mapping |
| **Vectorless RAG** | Keyword token scoring + character bigrams | None — instant | PS AI, on-call triage |
| **Schema-aware RAG** | Full schema structure injected directly | Run "Collect Schema" | BRD analysis, Dashboards |
| **KB Chunk RAG** | Chunked document retrieval (cosine ≥ 0.55–0.72) | KB entries processed | Ask SAI, Mapping Assistant, Query Intelligence |

---

## 5. Data Flow Examples (End-to-End)

### Example A — First-Time Setup (Admin → Reports)

```
[1] Admin: Collect Schema
    → Connect to source DB → 42 tables, 380 columns, 23 FKs, 3 sample rows/table
    → Stored in: CatalogColumn, CatalogRelation, CatalogSample

[2] Admin: Generate Embeddings
    → 380 columns × build_column_definition() → embed → store in ColumnEmbedding

[3] Reports: User asks "What were total sales in 2023?"
    → Embed question → cosine match top 15 cols → SQL → execute → results
```

### Example B — Knowledge Base → Ask SAI

```
Day 1: Admin adds rule:
  "Terminated employees must have system access revoked within 24 hours."
  → LLM extracts: trigger="status=Terminated", action="revoke_system_access()"
  → 1 chunk → embedded → stored in KnowledgeChunk

Day 2: User asks: "When should we remove an employee's system access?"
  → Embed question → cosine 0.93 hit → inject chunk → LLM answers from chunk
```

### Example C — PS AI Agent On-call Triage

```
On-call analyst: "Find the 3 ETL jobs that failed last night and retry them"

Round 1: lookup_schema("ETL jobs failed") [vectorless — no embeddings needed]
  → etl_runs (status, run_date, job_id, job_name) scored highest
Round 2: generate_sql → SELECT job_id, job_name FROM etl_runs WHERE status='FAILED'
                         AND run_date = CAST(GETDATE()-1 AS DATE) ORDER BY run_date DESC
Round 3: execute_sql → [{job_id:101, job_name:'Load_GL'}, ...]
Round 4: list_api_endpoints → "Retry ETL Job" (id=5)
Round 5: execute_api_for_rows → ⚠ Approval: "Retry 3 jobs?" → Approved → 3 API calls
```

### Example D — Full XML Conversion Flow

```
1. Admin: Collect Schema + Generate Embeddings (one-time)
2. User uploads XML template with {CustomerName}, {OrderDate}, {LineTotal}
3. Mapping: BFS → orders (root) → customers, order_items, products → JOIN SQL
4. Execute SQL → 5,120 rows → fill template → 5,120 XML files
5. Pipeline: Validate → Dispatch to Azure Blob
6. Approval: Team Lead → Manager → approved → dispatched
```

---

## 6. AI Concept Reference

### Embeddings
Text converted to a 1,536-number vector where similar meanings produce similar vectors. Stored in the DB. Used to find relevant columns or knowledge chunks at query time.
**Analogy:** GPS coordinates — nearby cities have close coordinates; semantically similar texts have close vectors.

### Cosine Similarity
Measures the angle between two vectors. Returns 0.0 (unrelated) to 1.0 (identical meaning).
```
Thresholds in this system:
  ≥ 0.55  → include in Ask SAI context
  ≥ 0.72  → include in Mapping Assistant context
  ≥ 0.80  → high-confidence column match
  ≥ 0.92  → near-duplicate KB entry
```

### RAG (Retrieval-Augmented Generation)
Instead of LLM guessing from training data, first retrieve relevant facts from our DB, then inject into the prompt. LLM answers grounded in our data — not hallucinations.

### Vectorless RAG
Schema retrieval without embeddings, using keyword tokenization and character bigrams. Instant (no preprocessing). Lower precision than embedding RAG but always available.

### Schema-aware RAG
The "knowledge base" is structured DB schema (tables, columns, FKs). Injected directly into LLM context so SQL output references real column names.

### BFS (Breadth-First Search on FK Graph)
Traverses the FK relationship graph to find the shortest JOIN path between any two tables. Enables automatic multi-table SQL without human guidance.

### Chunking
Split large text into fixed 400-word overlapping segments (50-word overlap). Each segment embedded separately for precise retrieval. Overlap prevents sentences at boundaries from being missed.

### Confidence Scoring
Numeric 0–1 reliability indicator, computed per module:
- **Reports:** Cosine score coverage of matched columns
- **Reconciliation:** `0.4 × pass_rate + 0.6 × critical_pass_rate`
- **KB:** Content completeness (trigger + action + title = HIGH)
- **Conversion Agent:** Per-field mapping confidence from cosine score

### Agentic Tool Use
LLM decides which tool to call (e.g., `lookup_schema`, `generate_sql`, `execute_sql`), calls it, receives the result, and decides the next tool — up to a maximum of 10 rounds. Human approval gates block write operations.

### Structured LLM Output (JSON Mode)
LLM forced to return valid JSON via `response_format={"type":"json_object"}`. Enables downstream code to parse and act on structured results (criteria, widget configs, field mappings) without brittle text parsing.

---

*Document generated from codebase analysis — Data Conversion Studio, branch: dev*
