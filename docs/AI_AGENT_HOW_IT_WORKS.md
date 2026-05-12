# How the AI Agent Works — Data Conversion Studio

## Overview

The AI agent system in Data Conversion Studio is a **multi-agent orchestration pipeline** where a sequence of role-based AI "cards" collaborate to complete a user task. Each card represents a specific role (e.g., Business Analyst, Data Developer, QA Engineer) and has defined responsibilities, decision logic, and the ability to approve, reject, or request revisions from the next agent.

Approval is a first-class concept in this system. It operates at two levels:
1. **Agent-to-Agent (A2A) approval** — each card's LLM output contains a decision tag that controls the flow.
2. **Human-in-the-Loop (HITL) approval** — a human must review and approve certain steps before the pipeline continues.

---

## 1. Core Concepts

### Agent Card
A single unit of execution. Each card is bound to a **Role** (responsibilities, tone, decision logic) and optionally a **named AI persona**. Cards are ordered by `execution_order` and connected by rejection loops via `on_reject_card_id`.

### Agent Role
Defines how the card behaves:
- `responsibilities` — what this role is accountable for
- `skills` — domain knowledge areas
- `decision_logic` — how it evaluates the input
- `input_expectation` / `output_expectation` — what it receives and produces
- `tone` — e.g., "business-friendly", "strict QA", "analytical"

### Workflow Execution
A single run of the full pipeline, created when a user submits a query. It tracks overall status, the original query, the model used, and all step outputs.

### Approval Request
A formal multi-role sign-off process, triggered when a step requires human authorization. It follows a workflow template with ordered steps, each requiring a specific role (e.g., manager, security lead, data owner).

---

## 2. Pipeline Execution — Step by Step

```
User submits task query
        │
        ▼
Create WorkflowExecution  (status = running)
Load active AgentCards    (ordered by execution_order)
        │
        ▼  ┌─────────────────────────────────────────┐
           │        PIPELINE LOOP — per card          │
           │                                         │
           │  1. Check if execution was cancelled    │
           │     (if status == cancelled → stop)     │
           │                                         │
           │  2. Emit "thinking" event to UI         │
           │                                         │
           │  3. Build LLM prompt:                   │
           │     - Role definition (responsibilities,│
           │       skills, decision_logic, tone)     │
           │     - Output from previous card         │
           │     - Original user query               │
           │     - Schema context (if DB connected)  │
           │                                         │
           │  4. Call LLM (gpt-4o-mini)              │
           │                                         │
           │  5. Parse decision tag from response:   │
           │     [APPROVE]  → move to next card      │
           │     [REJECT]   → loop back to           │
           │                  on_reject_card_id      │
           │     [REVISE]   → re-run this card       │
           │                  (iteration count++)    │
           │     (none)     → treat as escalation    │
           │                                         │
           │  6. Save WorkflowExecutionStep record   │
           │  7. Emit "step" event to UI             │
           └─────────────────────────────────────────┘
        │
        ▼
All cards done
Generate final summary (LLM)
Update WorkflowExecution (status = success / partial / failed / escalated)
Emit "done" event to UI
```

---

## 3. Agent Decision Tags

Every LLM response from an agent card must end with exactly one decision tag. The orchestrator parses this tag to determine what happens next.

| Tag | Effect |
|---|---|
| `[APPROVE]` | Current card is satisfied. Move to the next card in `execution_order`. |
| `[REJECT reason="..."]` | Current card is not satisfied. Loop back to the card identified by `on_reject_card_id`. The rejection reason is passed as context. |
| `[REVISE notes="..."]` | Current card needs more work. Re-run the **same card** again, incrementing `iteration`. Notes are passed back as additional context. |
| _(no tag)_ | Treated as an escalation. Card is marked `escalated`, pipeline continues to the next card. |

### Iteration Safety
Each card has a `max_iterations` limit (default: 3). If a card loops (via REVISE or REJECT) more than this many times without reaching `[APPROVE]`, it is marked **escalated** and the pipeline moves on anyway. This prevents infinite loops.

---

## 4. Approval — Two Layers

### Layer 1: Agent-to-Agent Approval (Automated)
This is the primary flow described above. Each card automatically approves or rejects the work of the previous card using LLM-generated decision tags. No human is involved.

**Example scenario:**
```
Card 1: Business Analyst
  → Reviews the query, defines requirements
  → Emits [APPROVE]

Card 2: Data Developer
  → Writes SQL / transformation logic
  → Emits [REVISE notes="need to handle nulls"]

Card 2 (iteration 2):
  → Revised SQL with null handling
  → Emits [APPROVE]

Card 3: QA Engineer
  → Reviews the output for correctness
  → Emits [REJECT reason="column types mismatch"]

Card 2 (looped back via on_reject_card_id):
  → Fixes column types
  → Emits [APPROVE]

Card 3:
  → Re-reviews, passes
  → Emits [APPROVE]

Pipeline completes → status = success
```

---

### Layer 2: Human-in-the-Loop (HITL) Approval

For sensitive or high-risk steps, the pipeline pauses and waits for a human to approve before continuing.

#### How HITL pauses the pipeline

```
Card reaches a step that requires human approval
        │
        ▼
Set WorkflowExecution.status = "pending_approval"
Set WorkflowExecution.paused_card_id = <this card's id>
Stop yielding events to client
        │
        ▼
Emit "approval_gate" event to UI:
  {
    "type": "approval_gate",
    "requires_approval": true,
    "approval_request_id": 123
  }
        │
        ▼
Pipeline is BLOCKED — no further cards execute
```

#### The Approval Request workflow

When a HITL gate is triggered, an **ApprovalRequest** is created from a pre-configured **ApprovalWorkflow** template. The workflow template has ordered steps, each requiring a specific role.

```
ApprovalWorkflow (template for project):
  Step 1: "Manager Review"      → required_role: "manager"
  Step 2: "Security Sign-off"   → required_role: "security_lead"
  Step 3: "Data Owner Approval" → required_role: "data_owner"

ApprovalRequest (live instance):
  status: "in_progress"
  current_step_order: 1   ← waiting for Step 1
```

#### Approval progression

```
User with role "manager" approves Step 1
        │
        ▼
ApprovalRequestDecision:
  step_order: 1
  decision: "approve"
  decided_by: "manager_user"
  decided_at: <timestamp>
        │
        ▼
current_step_order → 2 (advance to next step)
Notify next approver (security_lead)
        │
        ▼
User with role "security_lead" approves Step 2
        │
        ... (repeats for each step) ...
        │
        ▼
Final step approved
ApprovalRequest.status = "approved"
Notify original requester
        │
        ▼
Orchestrator detects approval
Resumes pipeline from paused_card_id
Emits "resume" event
Cards continue executing
```

#### What happens on rejection

```
Any approver rejects their step
        │
        ▼
ApprovalRequest.status = "rejected"
WorkflowExecution.status = "rejected"
human_rejection_reason stored
        │
        ▼
Pipeline does NOT resume
User must start a new execution
```

---

## 5. Approval Authorization Rules

| Scenario | Who Can Approve |
|---|---|
| Normal step approval | User whose `project_role` matches the step's `required_role` |
| Admin bypass | Admin role bypasses all role checks |
| Cancel a pending request | The original requester (`triggered_by`) or an admin |
| HITL expiry | `AgentPendingApproval` records expire after 30 minutes (TTL) |

---

## 6. Execution Status Reference

### WorkflowExecution Status

```
running
  ├─→ pending_approval   (HITL gate, waiting for human)
  │     ├─→ approved     (human approved, pipeline resumes)
  │     └─→ rejected     (human rejected, pipeline ends)
  ├─→ success            (all cards completed with APPROVE)
  ├─→ partial            (some cards escalated, others succeeded)
  ├─→ failed             (LLM or system error)
  ├─→ escalated          (pipeline finished but cards hit max_iterations)
  └─→ cancelled          (user clicked Stop)
```

### WorkflowExecutionStep Status

```
pending → running → success     (normal)
                  → failed      (LLM error)
                  → escalated   (max_iterations exceeded)
```

---

## 7. Agentic Tool Approval (Session-Level Gates)

Separate from the pipeline approval, individual **tool calls** within a conversational agent session can require approval before execution. This is tracked in `AgentPendingApproval`.

When an agent calls a tool like `execute_api` or `write_sql`:
1. The call is paused with `status = "pending"`.
2. The full message snapshot and tool arguments are saved.
3. The user sees an approval prompt in the UI.
4. On approval: tool executes, conversation continues.
5. On rejection: tool is skipped, agent notified.
6. Unanswered within 30 minutes: `status = "expired"`, gate closes.

---

## 8. Ask SAI — Knowledge Base Agent

Ask SAI is a separate retrieval-augmented agent for answering questions about the system's data, processes, and rules.

```
User asks a question
        │
        ▼
1. Embed the question (text-embedding-3-small)
2. Semantic search over conversion_knowledge_chunks
   (cosine similarity, top_k results)
        │
        ├── score ≥ 0.55 → CONFIDENT HIT
        │     → Use KB chunk content as context
        │     → Build answer prompt
        │     → Call gpt-4o-mini (temp=0.3)
        │     → Return ANSWERED with sources
        │
        └── score < 0.55 → WEAK / NO HIT
              │
              ├── Schema available → Use schema context instead
              │     → Build answer from schema
              │     → Return ANSWERED
              │
              └── No schema either
                    → Create OpenQuestion record
                    → Return UNANSWERED
```

### Open Questions (unanswered queue)

When Ask SAI cannot answer confidently, the question is queued in `conversion_open_questions` with `status = "open"`. Admins can then:

| Action | Effect |
|---|---|
| **Resolve** | Create a full `KnowledgeEntry` from provided content; marks question resolved |
| **Quick Answer** | Embed a short answer text into a synthetic KB entry; marks `quick_answered` |
| **Dismiss** | Mark as `dismissed` (not worth answering) |

Duplicate detection uses Jaccard similarity — questions more than 80% similar to a recent open question are merged (frequency bumped), not duplicated.

---

## 9. Prompt Override System

All AI modules support runtime prompt overrides stored in `conversion_prompt_templates`. This allows admins to tune agent behavior without code changes.

```
LLM call in any module:
        │
        ▼
Query conversion_prompt_templates
  WHERE category = "<module_category>"
    AND is_active = true
        │
        ├── Found → Use custom prompt content
        └── Not found → Use hardcoded fallback prompt
```

Key categories:
| Category | Module |
|---|---|
| `multi_compare` | Multi-source dataset comparison |
| `ask_ai` | Ask SAI answer synthesis |
| `agentic_boundary_ba` | Business Analyst card |
| `agentic_boundary_dev` | Data Developer card |
| `agentic_boundary_qa` | QA Engineer card |
| `agentic_decision_maker` | Decision logic across cards |

---

## 10. Audit Trail

Every execution produces a complete audit trail:

| Table | What it captures |
|---|---|
| `conversion_workflow_executions` | Full execution record with status, timing, HITL fields |
| `conversion_workflow_execution_steps` | Per-card: input, output, decision, iteration, full prompt used |
| `conversion_approval_requests` | Every approval chain instance with status progression |
| `conversion_approval_request_decisions` | Every individual approver decision with timestamp |
| `conversion_pending_approvals` | Session-level tool call gates |
| `conversion_ai_trace_log` | Every LLM call: tokens, latency, prompt text, response text |
| `conversion_open_questions` | Every unanswered Ask SAI question |

---

## 11. Summary — How Approval Impacts the Pipeline

| Approval Type | Who triggers it | What is blocked | How it unblocks |
|---|---|---|---|
| **A2A [APPROVE]** | The LLM agent card itself | Next card waits | Tag parsed from response |
| **A2A [REJECT]** | The LLM agent card itself | Sends flow back to previous card | Previous card re-runs and re-approves |
| **A2A [REVISE]** | The LLM agent card itself | Same card must re-run | Card re-runs with notes, re-emits decision |
| **HITL (WorkflowExecution)** | A sensitive card triggers it | Entire pipeline pauses | Human approves each step of ApprovalWorkflow |
| **Tool call gate** | Agentic session tool use | Individual tool execution | User approves in UI (30-min TTL) |
| **Ask SAI fallback** | Low confidence score | Question goes to Open Questions queue | Admin resolves with KB content |

Without an [APPROVE] decision — whether from an LLM agent or a human approver — execution does not advance. Rejection at any layer terminates that path and requires the requester to start again or an admin to intervene.
