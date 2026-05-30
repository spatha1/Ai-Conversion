# SAI — Smart Architect Intelligence: Complete Guide

**Platform URL:** http://104.211.112.63  
**Purpose:** Knowledge hub for operational intelligence, KT capture, and schema-aware Q&A

---

## What SAI Does

SAI is a team knowledge hub where you feed knowledge in (documentation, SQL, sessions, schemas) and anyone on the team can ask questions and get accurate, contextual answers — without database access, without digging through documents.

```
You feed →  Sessions + KB Entries + Schemas + SQL
SAI stores → Embeddings (semantic search vectors)
Anyone asks → SAI searches + answers in the format you request
```

---

## The Three Core Concepts

### 1. KB Schema — The Namespace
A KB Schema is a domain scope. Examples: `General Ledger`, `Policy Conversion`, `Claims`.

- All knowledge is tagged to a schema
- Ask SAI can be scoped to one schema ("answer only from GL knowledge")
- Prevents noise between domains

### 2. KB Entries — The Knowledge Units
Each atomic piece of knowledge is one entry. Types:

| Type | Use For |
|---|---|
| `Process` | Step-by-step workflows, runbooks |
| `OperationalRule` | Decision gates, stop conditions |
| `ValidationRule` | Checks that must pass |
| `RecoveryRule` | What to do when something fails |
| `OwnershipRule` | Who owns what |
| `ViewDefinition` | SQL view definitions with lineage |
| `QueryExample` | SQL queries, stored procedures |
| `UseCase` | KT documentation, group-level knowledge |
| `SchemaDefinition` | Table structures |

### 3. Sessions — The KT Container
A session is a KT meeting, document, or working session. It:
- Holds transcripts, notes, and files
- Links to a KB Schema
- Auto-suggests KB entries from its content

---

## How Knowledge Flows In

```
Session (meeting/document)
    │
    ├─ Transcript paste OR file upload
    │
    └─► "Ask SAI What to Feed" → Suggested KB Entries
                                        │
    Add Entry (manual) ────────────────►│
    Bulk Import (CSV) ─────────────────►│
    Import DB Schema (DDL) ────────────►│
                                        ▼
                              KB Entries with Embeddings
                                        │
                                        ▼
                              Ask SAI (semantic search)
```

---

## All Ways to Feed Knowledge

### Method 1: Sessions + Auto-Extract
1. Sessions tab → New Session → select schema, type `KnowledgeUpload` or `MeetingNotes`
2. Paste transcript or upload file
3. Click **"Ask SAI What to Feed"** → SAI reads content → suggests 3-7 KB entries
4. Click "Add to KB" on each suggestion → form pre-filled

**Best for:** Meeting notes, KT sessions, narrative documentation

---

### Method 2: Add Entry (rich content blocks)
1. Knowledge Base tab → **+ Add Entry**
2. Select Schema, Type
3. Add **Content Blocks** for rich multi-type content:

| Block Type | Use For |
|---|---|
| 📝 Text | Description, process notes, context |
| 🗄️ SQL Query | SQL code + "why written" explanation |
| 📄 Document | Upload PDF/DOCX, text extracted |
| 🖼️ Image | ER diagram, architecture screenshot → vision AI describes |
| 🎙️ Transcript | Meeting notes, video transcript |

4. Name each block so Ask SAI can reference it by name
5. Click **"🔍 Preview AI Understanding"** to verify before saving
6. **Process & Save**

**Best for:** Detailed technical KT, SQL + explanation, images + context

---

### Method 3: Guided KT Wizard
1. Knowledge Base tab → **🎓 Guided KT**
2. Walk through 5 steps: Schema → DB Schema Import → SQL Objects → KT Session → Save All

Steps capture:
- Database schema (views, tables, SPs with `feeds` relationships)
- Meeting transcript → auto-extracted entries
- Dependency links between SQL objects

**Best for:** Full project KT, complete process documentation

---

### Method 4: Bulk Import (CSV)
1. Knowledge Base tab → **Bulk Import**
2. Select **Schema** + optional **Session**
3. Upload CSV with columns:
   ```
   title, raw_content, type, system, tags, op_category, severity, owner_team
   ```
4. LLM structures each row (~10s per row), embeds, saves

**Best for:** Pre-written documentation, large batches of entries, GL/process rules

---

### Method 5: Import DB Schema
1. Schemas tab → **Import DB Schema**
2. Paste full DDL (CREATE TABLE / CREATE VIEW) — no size limit
3. Watch live progress: `[1/N] Embedding TableName (X cols)…`
4. SAI embeds every column → enables schema-aware answers + SQL generation

**Best for:** Sharing schema without DB access, client-provided DDLs

---

## Ask SAI — 7 Response Formats

| Format Chip | What SAI produces | Best for |
|---|---|---|
| 💬 **Answer** | Factual answer from KB | "Who owns GL processing?" |
| 🎓 **Teach Me** | Lesson with examples + takeaways | Onboarding, explaining concepts |
| ⚡ **Generate** | SQL, code, template with parameters | "Write the AU balance check query" |
| 🔍 **Review** | Structured critique + recommendations | "Review this SP design" |
| 🔧 **Troubleshoot** | Root causes + diagnostic steps | "GL reconciliation failed" |
| 🗺️ **Implementation Plan** | Phased plan with tasks | "Plan adding a new XML group" |
| 📋 **Executive Summary** | 5-8 bullet business summary | Stakeholder updates |

**Schema selector:** Pick `DB Schema: [Connection]` to use embedded column knowledge for SQL generation.

---

## GL Example — How SAI Answers GL Questions

**Setup:**
- KB Schema: `General Ledger`
- 50 entries across 13 categories (Process, Rules, Recovery, Views, Queries)
- Imported via `docs/GL_KB_Bulk_Import.csv`

**Example questions:**

| Question | Format | SAI does |
|---|---|---|
| "GL reconciliation failed, what do I do?" | Troubleshoot | Returns GL Reconciliation Failure Recovery steps: Stop TRF → Run variance query → Identify root cause → Fix + rerun |
| "Who owns TRF generation?" | Answer | "Aggne owns generation, Capricorn submits to Informatica" |
| "Show the full GL pipeline" | Flow Diagram | Mermaid: Policy/Billing/Claims → ADF → Bronze → Silver → Canonical → GL SPs → GL_DETAIL → Views → Recon → TRF → Informatica |
| "Write the GL AU balance check SQL" | Generate | Complete SQL with {run_date} parameter, comments, verify step |
| "What must complete before SP_GL_AU_FULL_LOAD?" | Answer | "5 prerequisites: 3 canonical views non-empty + Policy B&C PASS + Billing B&C PASS" |
| "EM validation failed" | Troubleshoot | EM Failure Recovery: check V_BILLING_CANON → recalculate → repost → DB Team approves |

**DB Schema selector:** Pick `GL Connection` → SAI searches column embeddings → generates schema-accurate SQL.

---

## Conversion Example — Policy Attach XML Pipeline

**Setup:**
- KB Schema: `Policy Conversion`
- Sessions: one per processing step
- Entries: one per SQL object + one per XML group

**Knowledge structure:**

```
Schema: Policy Conversion
    │
    ├── Sessions
    │   ├── Step 1: Collect Legacy Data (KnowledgeUpload)
    │   ├── Step 2: Prepare Source Views (KnowledgeUpload)  
    │   ├── Step 3: Configure XML Mapping (KnowledgeUpload)
    │   ├── Step 4: Load Target Tables (KnowledgeUpload)
    │   ├── Step 5: Generate XML (KnowledgeUpload)
    │   └── Step 6: Validate and Troubleshoot (KnowledgeUpload)
    │
    └── KB Entries
        ├── Process: "6-Step XML Generation Pipeline" 
        ├── Process: "Step 1: Collect Legacy Data"
        ├── Process: "Step 2: Prepare Source Views"
        ├── ViewDefinition: "V_PolicyHeader_SRC" (SQL + context)
        ├── ViewDefinition: "V_ClaimsGroup_SRC" (SQL + context)
        ├── QueryExample: "GenerateSmallXML_SP" (dynamic SP with {source_view} {formula})
        ├── QueryExample: "AssembleBigXML_SP"
        ├── OperationalRule: "B&C Must Pass Before GL"
        └── UseCase: "[GroupName] XML Group KT" (per group)
```

**Example questions:**

| Question | Format | SAI does |
|---|---|---|
| "How is the PolicyHeader XML generated?" | Answer | Returns UseCase entry for PolicyHeader group: source view → SP → XML |
| "What staging tables are used for Claims?" | Answer | Returns KT entry listing all staging tables for Claims group |
| "Show the complete XML pipeline" | Flow Diagram | Legacy → Staging → Source Views → Config → Target Tables → XML |
| "The billing XML is missing data — how to trace?" | Troubleshoot | Returns traceability path: XML → Target Table → Config → Source View → Staging → Legacy |
| "Write a query to check if V_Billing_SRC is populated" | Generate | SQL with row count check + empty alert |

---

## Key Features Quick Reference

| Feature | Where | Purpose |
|---|---|---|
| New KB Schema | Schemas tab | Create domain scope |
| Import DB Schema | Schemas tab → Import DB Schema | Upload DDL → column embeddings |
| New Session | Sessions tab | KT meeting / document container |
| Ask SAI What to Feed | Sessions tab → open session | Auto-suggest KB entries from transcript |
| Add Entry + Blocks | Knowledge Base → + Add Entry | Rich multi-type KT entry |
| Preview AI Understanding | Add Entry dialog → bottom | Verify AI understood content before saving |
| Guided KT Wizard | Knowledge Base → 🎓 Guided KT | Full project KT in one flow |
| Bulk Import | Knowledge Base → Bulk Import | CSV with schema+session assignment |
| Ask SAI | Ask SAI tab | Question → answer in chosen format |
| DB Schema chip | Ask SAI toolbar | Use column embeddings for SQL gen |
| Dependency links | Entry links (after creation) | feeds/requires relationships |

---

## What SAI Cannot Do (Today)

| Limitation | Workaround |
|---|---|
| Answer from a specific session only | Use KB Schema scoping — scope schema per project |
| Parse 172 temp tables from a large SP | Split DDL: CREATE TABLE only file → import separately |
| Live DB queries | It knows the schema but doesn't connect to live DB |
| Video transcription | Paste transcript text or upload .txt file |
| Auto-update when source changes | Re-add entry or reprocess when knowledge changes |

---

*SAI Complete Guide — docs/SAI_Complete_Guide.md | Updated 2026-05-30*
