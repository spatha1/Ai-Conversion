# AI Agent Pipeline — How It Works

**Backend:** `api/routers/agentic.py`, `api/services/agentic_orchestrator.py`  
**Frontend:** `frontend/src/pages/Agents/AgentsPage.tsx`  
**DB Tables:** `conversion_workflow_executions`, `conversion_workflow_execution_steps`, `conversion_agent_roles`, `conversion_agent_cards`

---

## What It Is

A **multi-role sequential pipeline** where different AI "agents" (each with a specific role) process the same task one after another. Each agent receives the output of the previous agent as its input, builds on it, and passes results forward.

This is NOT a chat interface. It is a structured workflow where the user defines a pipeline upfront and then runs it against a task.

Think of it like an assembly line:
```
Manager → Business Analyst → Data Developer → QA Engineer
```
Each step has a defined role, goal, and expected output format.

---

## Core Concepts

### Role
Defines WHO the agent is — its expertise, responsibilities, and how it should think.

Examples: `Business Analyst`, `Data Developer`, `QA Engineer`, `Manager`

Each role has:
- `responsibilities` — what it is accountable for
- `skills` — domain knowledge it uses
- `input_expectation` — what it receives
- `output_expectation` — what it should produce
- `decision_logic` — how it makes choices
- `tone` — communication style (e.g. `business-friendly`, `analytical`, `strict QA`)

### Card
A card is a step in the pipeline. It links a Role + an Agent to a position in the sequence.

Each card has:
- `execution_order` — position in the pipeline (1, 2, 3…)
- `role_id` — which role this card plays
- `agent_id` — which AI agent powers it
- `on_reject_card_id` — which card to loop back to on REJECT decision
- `max_iterations` — max times this card can loop before escalating

### Pipeline
The ordered list of cards. The pipeline is shared — all workflows run through the same card sequence.

---

## How a Workflow Runs

```
User submits: "Identify duplicate premium issues and delete them"
        │
        ▼
POST /api/agentic/execute/stream
        │
        ▼
1. Load all active cards (ordered by execution_order)
2. Create WorkflowExecution record (status=running)
3. Yield: {"type": "start", "execution_id": 23, "total_steps": 4}

        ▼
┌──────────────────────────────────────────────────────────────┐
│                    PIPELINE LOOP                             │
│                                                              │
│  For each card in sequence:                                  │
│                                                              │
│    1. Check cancellation (db.refresh → if cancelled: stop)   │
│                                                              │
│    2. Yield: {"type": "thinking", "card_name": "Manager"...} │
│                                                              │
│    3. Build prompt:                                          │
│         - Role definition (responsibilities, skills, etc.)  │
│         - Previous card output as context                    │
│         - User's original query                             │
│         - Schema context (if connection selected)           │
│                                                              │
│    4. Call LLM → get response                               │
│                                                              │
│    5. Parse decision tag at end of response:                 │
│         [APPROVE] → move to next card                       │
│         [REJECT reason="..."] → loop back to previous card  │
│         [REVISE notes="..."] → re-run current card          │
│                                                              │
│    6. Save WorkflowExecutionStep                             │
│    7. Yield: {"type": "step", "step": {...}}                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
4. All cards done → generate final summary
5. Update WorkflowExecution (status=success/failed, finished_at)
6. Yield: {"type": "done", "execution": {...}, "steps": [...]}
```

---

## Decision Routing (Loop-Back)

After each card runs, the LLM must end its response with a decision tag:

```
[APPROVE]
→ Pipeline moves forward to the next card

[REJECT reason="SQL is missing the JOIN to DEPT table"]
→ Pipeline routes back to the card specified in on_reject_card_id
→ Rejection reason passed as feedback to the target card

[REVISE notes="Add NULL check for PREMIUM column"]
→ Current card re-runs with the revision notes as additional context
→ Iteration counter increments
```

If a card hits `max_iterations` without APPROVE, it is marked `escalated` and the pipeline continues forward anyway.

---

## HITL (Human-in-the-Loop) Gate

The pipeline has a HITL flag on the `WorkflowExecution`:

- `hitl_required = True` (default) — user must approve before execution reaches certain cards
- Stored in `human_approved_at`, `human_approved_by`, `human_rejection_reason`

This is different from PS Support's per-tool approval. Here, the approval is at the **workflow level** before the pipeline starts executing sensitive steps.

---

## Cancellation

While a pipeline is running:

```
User clicks Stop button (History tab)
        │
        ▼
POST /api/agentic/executions/{id}/cancel
        │
        ▼
Sets status = "cancelled" in DB
        │
        ▼
Orchestrator checks before each card:
    db.refresh(execution)
    if execution.status == "cancelled":
        yield error event → stop
```

The current card finishes its LLM call. The next card never starts.

---

## Saved Workflows

Users can save a task query as a **Saved Workflow** for reuse:

```
conversion_saved_agentic_workflows:
  name           — display name
  user_query     — the task description
  conn_id        — data source to use
  model          — LLM model
  schedule_label — manual | daily | weekly (display only)
```

Running a saved workflow is identical to running a fresh execution — it passes the saved `user_query` through the same pipeline.

---

## Execution History

All runs are stored and viewable in the History tab:

```
conversion_workflow_executions:
  status         — running | success | failed | partial | escalated | cancelled
  total_steps    — number of cards in pipeline at run time
  completed_steps — how many cards finished
  final_summary  — LLM-generated executive summary

conversion_workflow_execution_steps (one per card per run):
  card_name      — e.g. "Manager"
  role_name      — e.g. "Business Analyst"
  agent_name     — e.g. "Developer"
  input_text     — what this card received
  output_text    — what this card produced
  decision       — APPROVE | REJECT | REVISE | ESCALATED
  decision_notes — reason text from the decision tag
  iteration      — which loop iteration (1 = first run)
  status         — success | failed | escalated
  execution_time_ms
```

---

## Tabs in the UI

| Tab | What it shows |
|---|---|
| **Employees** | Manage AI Agents (name, goal, role, tools) |
| **Roles** | Define role personas (responsibilities, skills, tone) |
| **Pipeline Cards** | Build and reorder the card pipeline |
| **Workflows** | Saved workflow templates |
| **History** | All past and current execution runs |

The **History tab** auto-refreshes every 5 seconds when any execution has `status = running`. Each running execution shows a progress bar and a red Stop button.

---

## Key Files

| File | Purpose |
|---|---|
| `api/routers/agentic.py` | All pipeline endpoints (execute, list, cancel, etc.) |
| `api/services/agentic_orchestrator.py` | Core pipeline loop, card execution, decision parsing |
| `frontend/src/pages/Agents/AgentsPage.tsx` | Full UI: roles, cards, history, stop button |
| `frontend/src/api/index.ts` | `agenticApi` — all API client calls |
