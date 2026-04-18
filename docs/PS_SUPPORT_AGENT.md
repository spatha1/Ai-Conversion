# PS Support Agent — How It Works

**Backend:** `api/routers/ps_ai.py`  
**Frontend:** `frontend/src/pages/PsSupport/PsSupportPage.tsx`  
**DB Tables:** `conversion_ps_conversations`, `conversion_ps_messages`, `conversion_ps_api_collection`

---

## What It Is

A **conversational AI assistant** for production support tasks. The user types a question or request in natural language. The agent reasons about it, optionally runs tools (SQL, API calls), and responds. It is a single-user chat interface — one conversation thread at a time.

This is NOT a multi-step pipeline. It is a chat agent that can take actions.

---

## How a Message Is Processed

```
User types message → POST /api/ps/chat/stream
        │
        ▼
1. Load or create conversation (conversion_ps_conversations)
2. Save user message (conversion_ps_messages)
3. Build system prompt:
     - Schema context (tables + columns for active connection)
     - Registered APIs from conversion_ps_api_collection
     - Tool usage rules
4. Load last 20 messages as LLM context
        │
        ▼
┌───────────────────────────────────────────┐
│         REACT LOOP  (max 10 rounds)       │
│                                           │
│  Ask LLM: what should I do?              │
│     │                                     │
│     ├─ Pure text response → done         │
│     │                                     │
│     └─ Tool calls → execute or gate:     │
│          ├─ Auto tools    → run now      │
│          │   inject result into context  │
│          │   loop again                  │
│          │                               │
│          └─ Gated tools  → ask user     │
│              store pending in DB         │
│              return to user              │
└───────────────────────────────────────────┘
        │
        ▼
5. Save assistant reply + tool records
6. Write AI trace log
7. Write tool execution audit log
```

---

## Tools the Agent Can Use

| Tool | What it does | Auto / Gated |
|---|---|---|
| `lookup_schema` | Finds relevant tables/columns from catalog | Auto |
| `generate_sql` | Generates a SQL query | Auto |
| `execute_sql` (SELECT) | Runs read-only SQL against the data source | Auto |
| `execute_sql` (write) | INSERT / UPDATE / DELETE / DROP | **User approval required** |
| `list_api_endpoints` | Lists APIs registered in API Collection | Auto |
| `execute_api` | Calls one registered API with a payload | **User approval required** |
| `execute_api_for_rows` | Calls an API once per row from SQL result (loop) | **User approval required** |
| `preview_email` | Drafts an email (does not send) | Auto |
| `generate_report` | Formats data as a table report | Auto |

---

## SQL Safety

Write SQL is detected and blocked using a 3-layer approach:

1. **sqlglot AST parser** — parses the full SQL and rejects any non-SELECT statement. Catches `WITH ... DELETE` CTEs, multi-statement batches, etc.
2. **Regex fallback** — if sqlglot fails, scans for `DELETE|INSERT|UPDATE|DROP` keywords.
3. **Read-only DB credential** — the connection used by the agent has SELECT-only permission at the database level.

---

## API Loop Safety

`execute_api_for_rows` is capped at **200 rows maximum** before the loop starts. If the SQL returns more than 200 rows, only the first 200 are processed and a `cap_note` is included in the result.

---

## Approval Flow (HITL Gate)

When a gated tool is called:

```
Agent wants to call execute_api (or write SQL, or API loop)
        │
        ▼
Backend creates PendingApprovalOut:
  - tool name + preview text
  - api_id (for fingerprint matching)
  - rows_sql (for loop fingerprint)
        │
        ▼
Stored in conversion_pending_approvals (DB — survives restart, 30 min TTL)
        │
        ▼
Returned to user: "I need approval to proceed — POST /update for 47 records"
        │
User clicks Approve
        │
        ▼
Next message includes pending_approvals list
Backend matches by fingerprint (api_id + sql content, not ephemeral tool_call_id)
Approval consumed (cannot be replayed)
Tool executes
```

---

## Audit Trail

Every tool execution writes to `conversion_tool_executions`:

```
session_id   — UUID per /chat request
conv_id      — which conversation
conn_id      — which data source
tool_name    — which tool ran
tool_args    — JSON (SQL truncated to 200 chars)
result_summary — {row_count, error}
status       — success | error
execution_ms — duration
iteration    — which ReAct round
```

---

## Streaming Events

The stream endpoint (`/api/ps/chat/stream`) sends NDJSON line-by-line:

```json
{"type": "tool_start", "tool": "execute_sql", "tool_call_id": "call_abc"}
{"type": "tool_done",  "tool": "execute_sql", "output": {"rows": [...]}}
{"type": "message",    "content": "Here are 47 records..."}
{"type": "done",       "executed": [...], "conversation_id": 12}
```

The browser renders tool steps as expandable cards as they arrive, then shows the final text response.

**Stop button:** Red Stop button appears while streaming. Clicking it calls `AbortController.abort()` which cancels the HTTP request. The current LLM call may complete but no further rounds start.

---

## Conversation Memory

All messages (user, assistant, tool calls) are stored in `conversion_ps_messages`. On reload, the full history is sent as context so the agent remembers what was discussed earlier in the session.

---

## Intent Detection

Before giving tools to the LLM, the agent classifies the message:

| Intent | Tools provided |
|---|---|
| `QUERY` | lookup_schema, generate_sql, execute_sql, generate_report |
| `ACTION` | All tools |
| `MIXED` | All tools |

Action keywords: `create`, `update`, `delete`, `send`, `call`, `fix`, `trigger`...  
Query keywords: `show`, `list`, `find`, `count`, `what`, `how many`...

Fewer tools = less chance of the LLM calling the wrong thing.

---

## Key Files

| File | Purpose |
|---|---|
| `api/routers/ps_ai.py` | All PS chat endpoints + ReAct loop |
| `frontend/src/pages/PsSupport/PsSupportPage.tsx` | Chat UI, tool step cards, stop button |
| `frontend/src/pages/PsSupport/components/WorkflowDialog.tsx` | Save chat as workflow dialog |
| `frontend/src/pages/PsSupport/components/WorkflowDetail.tsx` | Workflow run detail view |
| `frontend/src/pages/ApiCollection/ApiCollectionPage.tsx` | Manage registered APIs |
