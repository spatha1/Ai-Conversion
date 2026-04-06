"""
api/services/agent_prompts.py

System prompt and tool schema definitions for the AI Co-worker Agent.
"""

# ── Manager system prompt ─────────────────────────────────────────────────────

COWORKER_SYSTEM_PROMPT = """\
You are an AI Co-worker for data conversion and production support.

Your role is to autonomously investigate problems, execute pipeline tasks,
validate results, fix issues, and return a clear structured summary.

## Behaviour Rules
1. Break the user's request into concrete steps before acting.
2. Always EXECUTE — never stop at planning or query generation alone.
3. After executing, VALIDATE the result (check row counts, error flags, pass/fail).
4. If a step fails, retry ONCE with a corrected approach before moving on.
5. Collect evidence at every step: row counts, error messages, status codes.
6. Summarise findings, identify root cause, and state what was fixed.
7. Never ask clarifying questions — make reasonable assumptions and proceed.

## Tool Usage Order (for conversion pipeline tasks)
  generate_mapping_sql  →  execute_sql  →  generate_mapping_rows
  →  generate_xml  →  validate_xml

For ad-hoc data queries, use execute_sql directly.
For scheduled tasks, use run_workflow.

## Output
At the end, always emit a JSON block with this exact structure (nothing else after it):
```json
{
  "problem": "<one-line restatement of the user request>",
  "steps_executed": [
    {"step": 1, "tool": "<tool_name>", "summary": "<input/output in one line>", "status": "ok|failed"}
  ],
  "findings": "<what was discovered>",
  "root_cause": "<root cause if there was an error, else 'N/A'>",
  "fix_applied": "<what was done to fix it, else 'N/A'>",
  "final_status": "SUCCESS or FAILED"
}
```
"""

# ── OpenAI tool definitions ───────────────────────────────────────────────────

COWORKER_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "generate_mapping_sql",
            "description": (
                "Generate the JOIN-aware SQL query needed to extract source data for XML conversion. "
                "Uses the schema catalog, FK relationships, and LLM refinement. "
                "Returns the generated SQL and the identifier column/table."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "conn_id": {
                        "type": "integer",
                        "description": "Source connection ID."
                    }
                },
                "required": ["conn_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "execute_sql",
            "description": (
                "Execute a SQL SELECT query against a saved connection and return rows + columns. "
                "Use to inspect data, verify counts, check for errors, or preview results."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "conn_id": {
                        "type": "integer",
                        "description": "Source connection ID."
                    },
                    "sql": {
                        "type": "string",
                        "description": "The SQL SELECT query to execute."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max rows to return (default 100).",
                        "default": 100
                    }
                },
                "required": ["conn_id", "sql"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_mapping_rows",
            "description": (
                "Generate field-level mapping rows: source column → target XML path. "
                "Uses OpenAI embedding cosine similarity between source columns and target formula rules. "
                "Saves the mapping to the database. Prerequisite: mapping SQL must already be generated."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "conn_id": {
                        "type": "integer",
                        "description": "Source connection ID."
                    }
                },
                "required": ["conn_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_xml",
            "description": (
                "Generate XML output for a specific identifier value using the saved mapping. "
                "Applies formula rules and field substitution. Returns the generated XML."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "conn_id": {
                        "type": "integer",
                        "description": "Source connection ID."
                    },
                    "identifier_value": {
                        "type": "string",
                        "description": "The identifier value to generate XML for (e.g. employee ID, policy number)."
                    }
                },
                "required": ["conn_id", "identifier_value"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "validate_xml",
            "description": (
                "Run XML validation against all generated XML records for a connection. "
                "Checks required fields, data types, patterns, and enumeration rules. "
                "Returns total/passed/failed counts and a list of failures."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "conn_id": {
                        "type": "integer",
                        "description": "Source connection ID."
                    }
                },
                "required": ["conn_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_workflow",
            "description": (
                "Execute a saved PS workflow by its ID. "
                "Runs all steps (SQL queries, API calls, emails) in sequence. "
                "Returns status and per-step results."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "integer",
                        "description": "The workflow ID to run."
                    }
                },
                "required": ["workflow_id"]
            }
        }
    },
]
