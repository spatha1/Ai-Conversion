# Prompt Templates Reference

All LLM calls in the application support prompt overrides via the **Admin → Prompt Templates** page.
Create a template with the matching **Category** and set it active — the service will use it instead of the hardcoded default.
If no active template exists for a category, the hardcoded fallback is used automatically.

---

## How to Override a Prompt

1. Go to **Admin → Prompt Templates**
2. Click **Add Template**
3. Set the **Category** to the value from the table below
4. Paste your custom system prompt in **Content**
5. Toggle **Active** — only one active template per category is used

---

## Template Registry

| # | Template Category | Module / Service | Hardcoded Fallback Constant | AI Trace Module Label | Purpose |
|---|---|---|---|---|---|
| 1 | `multi_compare` | `api/services/multi_compare.py` | `_SYSTEM_PROMPT` | `multi_compare` | Multi-source dataset comparison — generates structured JSON checks, verdict, and narrative |
| 2 | `ask_ai` | `api/services/ask_ai_engine.py` | `_DEFAULT_INTENT_PROMPT` / `_DEFAULT_NARRATIVE_PROMPT` | `ask_ai` | Conversational data Q&A — intent detection, SQL generation, and narrative summary |
| 3 | `dev_plan` | `api/services/ai_engine.py` → `plan()` | Hardcoded inline | `development` | SQL artifact planning — breaks a BRD requirement into step-by-step SQL tasks |
| 4 | `dev_brd` | `api/routers/development.py` → `_resolve_brd_prompt()` | `_BRD_SYSTEM_PROMPT` | `brd` | BRD acceptance criteria generation — extracts data engineering requirements from a business requirements document |
| 5 | `testing` | `api/routers/testing.py` → `_resolve_prompt()` | `_SYSTEM_PROMPT` | `testing` | Test case generation — produces reconciliation and data quality test cases from schema |
| 6 | `admin_enrich` | `api/routers/admin.py` → `ai_enrich_chat()` | `_ENRICH_SYSTEM_PROMPT` | `admin_enrich` | Schema enrichment — conversational agent that identifies metadata gaps and prompts for business context |
| 7 | `report` | `api/services/query_skill.py` → `_load_prompt_template()` | Hardcoded inline | `report` | Report SQL generation — converts natural language questions into SQL for saved report sessions |
| 8 | `mapping` | `api/services/query_skill.py` → `_load_prompt_template()` | Hardcoded inline | `mapping` | Mapping SQL generation — builds JOIN-aware queries for source→target XML mapping |
| 9 | `agent` | `api/services/agent_loop.py` → `_resolve_agent_prompt()` | `COWORKER_SYSTEM_PROMPT` | *(tool-based, no trace)* | AI Co-worker agent — autonomous multi-step pipeline agent with tool-calling |
| 10 | `agentic_boundary_ba` | `api/services/agentic_orchestrator.py` | `_DEFAULT_BOUNDARY_BA` | *(role-based)* | Business Analyst agent boundary — defines scope and behaviour for the BA role in agentic workflows |
| 11 | `agentic_boundary_manager` | `api/services/agentic_orchestrator.py` | `_DEFAULT_BOUNDARY_MANAGER` | *(role-based)* | Manager agent boundary — orchestration and delegation rules for the Manager role |
| 12 | `agentic_boundary_qa` | `api/services/agentic_orchestrator.py` | `_DEFAULT_BOUNDARY_QA` | *(role-based)* | QA agent boundary — defines test and validation behaviour for the QA role |
| 13 | `agentic_boundary_developer` | `api/services/agentic_orchestrator.py` | `_DEFAULT_BOUNDARY_DEVELOPER` | *(role-based)* | Developer agent boundary — code/SQL generation rules for the Developer role |
| 14 | `agentic_boundary_default` | `api/services/agentic_orchestrator.py` | `_DEFAULT_BOUNDARY_DEFAULT` | *(role-based)* | Default agent boundary — fallback rules when no specific role matches |
| 15 | `agentic_decision_maker` | `api/services/agentic_orchestrator.py` | `_DEFAULT_DECISION_MAKER` | *(role-based)* | Decision maker — prompt used to choose the next agent action in a workflow step |
| 16 | `agentic_decision_optional` | `api/services/agentic_orchestrator.py` | `_DEFAULT_DECISION_OPTIONAL` | *(role-based)* | Optional decision — prompt used for branching logic when a step is not mandatory |

---

## Services with Hardcoded Prompts Only (no template override yet)

These modules make LLM calls but do not yet look up a `PromptTemplate` row. To add override support, follow the pattern in `multi_compare.py` (query by category, fall back to constant).

| Module / Service | File | AI Trace Label | Purpose |
|---|---|---|---|
| Reconciliation root-cause | `api/services/agents/reconciliation_agent.py` | `reconciliation` | Per-test AI root-cause analysis for failing DEV vs BASE checks |
| Query collector AI extras | `api/services/agents/query_collector_agent.py` | `reconciliation` | Generate additional custom test queries during BASE query collection |
| Query builder LLM refine | `api/services/query_builder.py` | *(not traced)* | Final LLM polish of BFS-generated JOIN SQL |
| Value mapper | `api/services/value_mapper.py` | `value_mapper` | Infer business label mappings for categorical columns |
| SQL explanation | `api/services/embeddings.py` | *(not traced)* | Generate plain-English explanation of a SQL query |
| Agent engine planner | `api/services/agent_engine.py` | *(not traced)* | Generate JSON execution plan from a natural-language agent goal |
| PS API extractor | `api/routers/ps_api_collection.py` | *(not traced)* | Extract REST API definitions from uploaded documents |
| Help chat | `api/routers/help_chat.py` | *(not traced)* | In-app assistant answering questions about Clarity Studio |
| Conversion agent | `api/routers/conversion_agent.py` | `ai_transform` | AI-driven data transformation during XML conversion |
| Dashboard AI | `api/routers/dashboards.py` (via `ai_engine.py`) | `dashboard` | KPI widget SQL and DAX measure generation |
| PS AI | `api/routers/ps_ai.py` | `ps` | PeopleSoft workflow step AI analysis and SQL generation |

---

## AI Trace Module Labels (for Admin → AI Traces filter)

| Label | What it covers |
|---|---|
| `multi_compare` | Multi-Source Compare tab runs |
| `ask_ai` | Ask AI / conversational data Q&A |
| `development` | Dev artifact SQL plan / generate / explain / fix |
| `brd` | BRD acceptance criteria generation |
| `dashboard` | Dashboard widget SQL and DAX generation |
| `mapping` | Mapping tab query and row generation |
| `report` | Report tab natural-language SQL |
| `reconciliation` | DEV vs BASE reconciliation root-cause analysis |
| `value_mapper` | Categorical column value mapping inference |
| `testing` | Test case generation |
| `admin_enrich` | Schema enrichment chat |
| `ps` | PS workflow AI analysis |
| `ai_transform` | Conversion agent data transformation |

---

## Model Used

All modules consistently use **`gpt-4o-mini`** unless overridden at the call site.
