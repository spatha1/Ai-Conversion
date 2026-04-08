# ═══════════════════════════════════════════════════════════
# routers/ps_ai.py
# Production Support AI agent — multi-tool agentic chat loop.
#
# LLM: OpenAI only (key from OPENAI_API_KEY in .env)
# Tools: lookup_schema, generate_sql, execute_sql,
#        list_api_endpoints, execute_api, execute_api_for_rows,
#        preview_email, generate_report
#
# API execution flow (MANDATORY):
#   1. list_api_endpoints → pick correct API
#   2. Read required_fields + body_template from API entry
#   3. Generate SQL fetching ONLY required_fields columns
#   4. execute_sql → get rows
#   5a. Single record  → execute_api(api_id, payload)
#   5b. Multiple records → execute_api_for_rows(api_id, sql)
#        → one approval → sequential calls, 200ms delay
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

import json
import re
import textwrap
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.config import settings
from api.database import get_db
from api.models import (
    CatalogColumn, CatalogRelation, SchemaMetadata,
    PsApiCollection, PsConversation, PsMessage, SourceConnection, QueryContext,
)
from api.services.connector import preview_data
from api.services.embeddings import generate_sql
from api.services.encryption import decrypt
from api.services.pii_guard import audit_prompt as _pii_scrub
from api.routers.connections import _to_cfg_from_model

# ── Vectorless RAG helpers ────────────────────────────────
_STOPWORDS = {
    "the","a","an","is","are","was","were","what","show","me","all","of","in",
    "for","from","where","how","many","list","get","find","with","by","on",
    "to","and","or","that","this","give","which","do","does","have","has",
}

def _tokenize(text: str) -> list[str]:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return [t for t in tokens if t not in _STOPWORDS and len(t) > 1]

def _char_bigrams(text: str) -> set[str]:
    t = text.lower()
    return {t[i:i+2] for i in range(len(t) - 1)}

def _score_column(q_tokens: list[str], q_bigrams: set[str],
                  table_name: str, column_name: str, data_type: str) -> float:
    score = 0.0
    col_l = column_name.lower()
    tbl_l = table_name.lower()
    for tok in q_tokens:
        if tok in col_l:  score += 3.0
        if tok in tbl_l:  score += 2.0
        if tok in (data_type or "").lower(): score += 0.5
    combined_bg = _char_bigrams(col_l + " " + tbl_l)
    score += len(q_bigrams & combined_bg) * 1.0
    return score

router = APIRouter()

# ── Constants ────────────────────────────────────────────────
MAX_TOOL_ROUNDS  = 10
MAX_HISTORY_MSGS = 20
TRUNC_JSON       = 50_000   # max chars stored for tool I/O in DB


# ═══════════════════════════════════════════════════════════
# Pydantic schemas
# ═══════════════════════════════════════════════════════════

class PendingApproval(BaseModel):
    tool_call_id: str
    approved:     bool = False
    # Carry the original tool inputs so we can execute directly on approval
    # without replaying the LLM (which generates new tool_call_ids and loops forever)
    api_id:   Optional[int]  = None   # for execute_api / execute_api_for_rows
    payload:  Optional[dict] = None   # for execute_api body (single record)
    sql:      Optional[str]  = None   # for execute_sql write ops
    rows_sql: Optional[str]  = None   # for execute_api_for_rows — SQL to fetch rows


class ChatRequest(BaseModel):
    conversation_id:   Optional[int]  = None
    message:           str
    conn_id:           Optional[int]  = None
    model:             str            = "gpt-4o-mini"
    pending_approvals: list[PendingApproval] = []


class ToolCallRecord(BaseModel):
    tool:   str
    input:  dict
    output: Any


class PendingApprovalOut(BaseModel):
    tool_call_id: str
    tool:         str
    input:        dict
    preview:      str


class ChatResponse(BaseModel):
    conversation_id:     int
    content:             str
    tool_calls_executed: list[ToolCallRecord] = []
    pending_approvals:   list[PendingApprovalOut] = []


class ConversationOut(BaseModel):
    id:         int
    title:      Optional[str]
    conn_id:    Optional[int]
    model:      str
    created_at: str


class MessageOut(BaseModel):
    id:               int
    role:             str
    content:          Optional[str]
    tool_name:        Optional[str]
    tool_input_json:  Optional[str]
    tool_output_json: Optional[str]
    created_at:       str


class ConversationDetail(BaseModel):
    conversation: ConversationOut
    messages:     list[MessageOut]


# ═══════════════════════════════════════════════════════════
# Tool definitions (OpenAI function-calling format)
# ═══════════════════════════════════════════════════════════

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "lookup_schema",
            "description": (
                "Find the most relevant database tables and columns for a given question "
                "using keyword and name matching over the schema catalog. "
                "Use this before generating SQL to identify which tables/columns are relevant."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The question or topic to find relevant schema for."
                    }
                },
                "required": ["question"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_sql",
            "description": (
                "Generate a SQL SELECT query from a natural language question "
                "and a list of relevant columns identified by lookup_schema. "
                "MUST use only the exact table and column names from the schema context. "
                "Never invent table names. Returns only the SQL string — does NOT execute it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The natural language question to answer with SQL."
                    },
                    "context_columns": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "List of matched column objects from lookup_schema."
                    },
                    "dialect": {
                        "type": "string",
                        "description": "SQL dialect: mssql, postgresql, mysql, sqlite, snowflake.",
                        "default": "mssql"
                    }
                },
                "required": ["question", "context_columns"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "execute_sql",
            "description": (
                "Execute a SQL query against the configured data source and return rows. "
                "SELECT statements run automatically. "
                "INSERT/UPDATE/DELETE/DROP require user approval — the system will pause and ask."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {
                        "type": "string",
                        "description": "The SQL query to execute."
                    }
                },
                "required": ["sql"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_api_endpoints",
            "description": "List all available REST API endpoints in the predefined API collection. Call this ONCE per conversation turn before calling execute_api. Do NOT call it multiple times in the same turn.",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "execute_api",
            "description": (
                "Execute a REST API call from the predefined collection. "
                "Always requires explicit user approval before running. "
                "Provide the api_id from list_api_endpoints and the payload dict."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "api_id": {
                        "type": "integer",
                        "description": "The ID of the API entry from list_api_endpoints."
                    },
                    "payload": {
                        "type": "object",
                        "description": "Key-value pairs to fill into the API body template."
                    }
                },
                "required": ["api_id", "payload"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "execute_api_for_rows",
            "description": (
                "Call the same REST API once for EACH ROW returned by a SQL query — sequential, one call per record. "
                "Use when you need to fix or update MULTIPLE records (e.g. 'fix all policies with status ERR'). "
                "The API's required_fields define which SQL columns become the payload. "
                "SQL must SELECT exactly the columns named in required_fields. "
                "Requires ONE user approval showing the record count, then runs sequentially with 200ms delay."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "api_id": {
                        "type": "integer",
                        "description": "The ID of the API entry from list_api_endpoints."
                    },
                    "sql": {
                        "type": "string",
                        "description": "SELECT query that returns the rows to process. Columns must match the API's required_fields."
                    }
                },
                "required": ["api_id", "sql"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "preview_email",
            "description": (
                "Generate an email preview card. Does NOT send any email — "
                "only renders how the email would look. Use when the user asks to send a report or notification."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "to":      {"type": "string", "description": "Recipient email address."},
                    "subject": {"type": "string", "description": "Email subject line."},
                    "body":    {"type": "string", "description": "Email body in markdown or plain text."}
                },
                "required": ["to", "subject", "body"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_report",
            "description": "Format query result rows into a markdown summary report with statistics.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title":       {"type": "string", "description": "Report title."},
                    "columns_json": {"type": "string", "description": "JSON array of column name strings, e.g. [\"Name\",\"Count\"]."},
                    "rows_json":   {"type": "string", "description": "JSON array of row arrays, e.g. [[\"Alice\",5],[\"Bob\",3]]."}
                },
                "required": ["title", "columns_json", "rows_json"]
            }
        }
    },
]


# ═══════════════════════════════════════════════════════════
# Tool implementations
# ═══════════════════════════════════════════════════════════

_SCHEMA_NOISE = (
    "RAG_", "VECTOR_", "TARGET_", "VW_", "XML_", "LEGACY_",
    "conversion_", "EMP_XML", "FINAL_XML", "UserRequest", "Executer",
)

def _tool_lookup_schema(question: str, conn_id: Optional[int], db: Session) -> dict:
    if not conn_id:
        return {"error": "No data source connection selected. Please select a connection in the PS panel."}

    rows = db.query(CatalogColumn).filter_by(conn_id=conn_id).all()
    if not rows:
        return {
            "warning": "No schema found for this connection. Run 'Collect Schema' in the Admin tab first.",
            "columns": []
        }

    # Load user-defined metadata: (table_name, column_name|None) → row
    meta_rows = db.query(SchemaMetadata).filter_by(conn_id=conn_id).all()
    meta_map  = {(m.table_name, m.column_name): m for m in meta_rows}

    q_tokens  = _tokenize(question)
    q_bigrams = _char_bigrams(" ".join(q_tokens))

    scored = []
    for r in rows:
        if any(r.table_name.startswith(p) for p in _SCHEMA_NOISE):
            continue
        score = _score_column(q_tokens, q_bigrams, r.table_name, r.column_name, r.data_type or "")

        # Boost from metadata (column-level then table-level)
        col_meta = meta_map.get((r.table_name, r.column_name))
        tbl_meta = meta_map.get((r.table_name, None))
        for meta in [m for m in (col_meta, tbl_meta) if m]:
            alias_tokens = _tokenize(meta.aliases or "")
            desc_tokens  = _tokenize(meta.description or "")
            for tok in q_tokens:
                if tok in alias_tokens: score += 2.5
                if tok in desc_tokens:  score += 1.0
            score += len(q_bigrams & _char_bigrams((meta.aliases or "").lower())) * 1.5

        if score > 0:
            best_alias = (col_meta.aliases if col_meta else None) or \
                         (tbl_meta.aliases if tbl_meta else None) or ""
            scored.append({
                "table_schema": r.table_schema,
                "table_name":   r.table_name,
                "column_name":  r.column_name,
                "definition":   f"{r.column_name} {r.data_type or ''}".strip(),
                "aliases":      best_alias,
                "score":        round(score, 2),
            })

    # Generic fallback: nothing scored → return one representative column per table
    if not scored:
        seen: set[str] = set()
        for r in rows:
            if any(r.table_name.startswith(p) for p in _SCHEMA_NOISE):
                continue
            if r.table_name not in seen:
                seen.add(r.table_name)
                tbl_meta = meta_map.get((r.table_name, None))
                scored.append({
                    "table_schema": r.table_schema,
                    "table_name":   r.table_name,
                    "column_name":  r.column_name,
                    "definition":   f"{r.column_name} {r.data_type or ''}".strip(),
                    "aliases":      tbl_meta.aliases if tbl_meta else "",
                    "score":        0.0,
                })

    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[:15]

    # Append FK-related tables not already in top results (up to 5)
    matched_tables = {c["table_name"] for c in top}
    fk_rows = db.query(CatalogRelation).filter_by(conn_id=conn_id).all()
    fk_additions: list[dict] = []
    for fk in fk_rows:
        for hit_tbl in list(matched_tables):
            if fk.parent_table == hit_tbl:
                related, via_col = fk.referenced_table, fk.referenced_column
            elif fk.referenced_table == hit_tbl:
                related, via_col = fk.parent_table, fk.parent_column
            else:
                continue
            if related not in matched_tables:
                matched_tables.add(related)
                tbl_meta = meta_map.get((related, None))
                fk_additions.append({
                    "table_name":  related,
                    "column_name": via_col,
                    "definition":  f"(related via FK to {hit_tbl})",
                    "aliases":     tbl_meta.aliases if tbl_meta else "",
                    "score":       0.0,
                    "via_fk":      True,
                })
                if len(fk_additions) >= 5:
                    break
        if len(fk_additions) >= 5:
            break

    return {
        "matched_columns":  top + fk_additions,
        "total_columns":    len(rows),
        "metadata_entries": len(meta_rows),
    }


_NOISE_PREFIXES_SQL = (
    "RAG_", "VECTOR_", "TARGET_", "VW_", "XML_", "LEGACY_",
    "conversion_", "EMP_XML", "FINAL_XML", "UserRequest", "Executer",
)

def _tool_generate_sql(question: str, context_columns: list, dialect: str, db: Session,
                       conn_id: Optional[int] = None) -> dict:
    """Generate SQL using the full catalog schema — prevents hallucination of generic table names."""
    api_key = settings.OPENAI_API_KEY.strip()
    if not api_key:
        return {"error": "OPENAI_API_KEY not configured in .env"}

    # Build full schema block from CatalogColumn (same filtering as system prompt)
    conn_id_hint: Optional[int] = conn_id
    if not conn_id_hint and context_columns:
        first = context_columns[0] if context_columns else {}
        conn_id_hint = first.get("conn_id")

    # Build schema block: prefer full catalog over just matched columns
    schema_lines: list[str] = []
    if conn_id_hint:
        cat_rows = (
            db.query(CatalogColumn)
            .filter_by(conn_id=conn_id_hint)
            .order_by(CatalogColumn.table_name, CatalogColumn.column_name)
            .all()
        )
        tables: dict[str, list[str]] = {}
        for r in cat_rows:
            if any(r.table_name.startswith(p) for p in _NOISE_PREFIXES_SQL):
                continue
            tables.setdefault(r.table_name, []).append(f"{r.column_name} ({r.data_type or 'unknown'})")
        for tbl, cols in tables.items():
            schema_lines.append(f"  Table {tbl}: " + ", ".join(cols[:30]))

    # Fall back to context_columns if no catalog found
    if not schema_lines and context_columns:
        tbl_map: dict[str, list[str]] = {}
        for col in context_columns:
            tbl_map.setdefault(col.get("table_name", "?"), []).append(col.get("column_name", "?"))
        for tbl, cols in tbl_map.items():
            schema_lines.append(f"  Table {tbl}: " + ", ".join(cols))

    schema_block = "\n".join(schema_lines) or "  (no schema available)"
    db_hint = "SQL Server (T-SQL)" if (dialect or "mssql") in ("mssql", "sql server") else (dialect or "mssql").upper()

    # Fetch query context markdown (global + connection-specific) — never crash
    context_block = ""
    try:
        parts = []
        g = db.query(QueryContext).filter(QueryContext.conn_id == None).first()
        if g and g.content and g.content.strip():
            parts.append(g.content.strip())
        if conn_id_hint:
            c = db.query(QueryContext).filter(QueryContext.conn_id == conn_id_hint).first()
            if c and c.content and c.content.strip():
                parts.append(c.content.strip())
        if parts:
            context_block = "\n\n## Query Context\n" + "\n\n---\n\n".join(parts)
    except Exception:
        pass  # context is optional — never block query generation

    sys_prompt = (
        f"You are a {db_hint} SQL expert. "
        "Generate a SINGLE SQL SELECT query that answers the user's question.\n\n"
        "CRITICAL RULES — violation will cause runtime errors:\n"
        "1. Use ONLY the exact table names listed below. NEVER invent names.\n"
        "2. Use ONLY the exact column names listed below. NEVER invent columns.\n"
        "3. Do NOT use aliases like 'Employees', 'Departments', 'EmployeeID' — use the EXACT names given.\n"
        "4. Return ONLY the raw SQL — no explanation, no markdown fences.\n\n"
        f"AVAILABLE SCHEMA (use ONLY these):\n{schema_block}"
        f"{context_block}"
    )
    user_prompt = f"Question: {question}"

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0,
        )
        sql = resp.choices[0].message.content.strip()
        if sql.startswith("```"):
            sql = sql.split("\n", 1)[-1]
            sql = sql.rsplit("```", 1)[0].strip()
        return {"sql": sql}
    except Exception as exc:
        return {"error": str(exc)}


def _is_write_sql(sql: str) -> bool:
    first = sql.strip().upper().split()[0] if sql.strip() else ""
    return first in ("INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE", "ALTER", "CREATE")


def _tool_execute_sql(sql: str, conn_id: Optional[int], db: Session) -> dict:
    if not sql or not sql.strip():
        return {"error": "SQL query is empty."}
    if not conn_id:
        return {"error": "No data source connection selected."}
    conn = db.query(SourceConnection).filter_by(id=conn_id, is_active=True).first()
    if not conn:
        return {"error": f"Connection {conn_id} not found."}

    cfg = _to_cfg_from_model(conn)
    cfg["query"] = sql.strip()   # ← pass the actual SQL to execute
    try:
        result = preview_data(cfg, limit=500)
        return {
            "columns":   result.get("columns", []),
            "rows":      result.get("rows", [])[:500],
            "row_count": result.get("total", 0),
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_list_api_endpoints(db: Session) -> dict:
    rows = db.query(PsApiCollection).filter_by(is_active=True).order_by(PsApiCollection.id).all()
    return {
        "endpoints": [
            {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "method": r.method,
                "url": r.url,
                "body_template": r.body_template,
                "required_fields": json.loads(r.required_fields) if r.required_fields else [],
            }
            for r in rows
        ]
    }


def _tool_execute_api(api_id: int, payload: dict, db: Session) -> dict:
    entry = db.query(PsApiCollection).filter_by(id=api_id, is_active=True).first()
    if not entry:
        return {"error": f"API entry {api_id} not found."}

    # Build headers
    headers: dict = {}
    if entry.headers_json:
        try:
            headers = json.loads(entry.headers_json)
        except Exception:
            pass

    # Auth
    if entry.auth_type == "bearer":
        token = decrypt(entry.auth_value_enc) or ""
        headers["Authorization"] = f"Bearer {token}"
    elif entry.auth_type == "basic":
        import base64 as b64
        token = decrypt(entry.auth_value_enc) or ":"
        headers["Authorization"] = "Basic " + b64.b64encode(token.encode()).decode()

    # Fill body template — fall back to raw payload if any {{placeholder}} remains unreplaced
    if entry.body_template:
        body_str = entry.body_template
        for k, v in payload.items():
            body_str = body_str.replace(f"{{{{{k}}}}}", str(v))
        # If unreplaced placeholders remain the JSON will be invalid — use raw payload instead
        if "{{" in body_str:
            body_payload = payload
        else:
            try:
                body_payload = json.loads(body_str)
            except Exception:
                body_payload = payload   # last resort: send raw payload
    else:
        body_payload = payload

    try:
        resp = httpx.request(
            method=entry.method,
            url=entry.url,
            headers=headers,
            json=body_payload if isinstance(body_payload, dict) else None,
            content=body_payload if isinstance(body_payload, str) else None,
            timeout=30,
        )
        try:
            resp_body = resp.json()
        except Exception:
            resp_body = resp.text[:2000]

        return {
            "status_code": resp.status_code,
            "response":    resp_body,
        }
    except Exception as exc:
        return {"error": str(exc)}


# ── Intent classification ──────────────────────────────────
_ACTION_KW = {
    "create","update","delete","fix","send","trigger","push","terminate","add",
    "insert","change","modify","reactivate","adjust","correct","repair","resolve",
    "close","open","assign","remove","cancel","approve","reject","process","submit",
}
_QUERY_KW = {
    "show","list","get","find","count","select","display","view","fetch","report",
    "what","which","how","summarize","describe","explain",
}

def _classify_intent(message: str) -> str:
    """Return 'QUERY', 'ACTION', or 'MIXED' based on keyword presence."""
    tokens = set(re.findall(r"[a-z]+", message.lower()))
    has_action = bool(tokens & _ACTION_KW)
    has_query  = bool(tokens & _QUERY_KW)
    if has_action and has_query:
        return "MIXED"
    if has_action:
        return "ACTION"
    return "QUERY"

def _get_tools_for_intent(intent: str) -> list:
    """Filter tools: QUERY intent never receives API tools."""
    if intent == "QUERY":
        _api_tools = {"list_api_endpoints", "execute_api", "execute_api_for_rows"}
        return [t for t in _TOOLS if t["function"]["name"] not in _api_tools]
    return _TOOLS


def _tool_execute_api_for_rows(api_id: int, sql: str, conn_id: Optional[int], db: Session) -> dict:
    """Execute SQL then call API once per row sequentially with 200ms delay."""
    import time

    entry = db.query(PsApiCollection).filter_by(id=api_id, is_active=True).first()
    if not entry:
        return {"error": f"API entry {api_id} not found."}

    required_fields: list[str] = json.loads(entry.required_fields) if entry.required_fields else []

    rows_result = _tool_execute_sql(sql, conn_id, db)
    if "error" in rows_result:
        return rows_result

    rows    = rows_result.get("rows", [])
    columns = rows_result.get("columns", [])

    if not rows:
        return {"total": 0, "succeeded": 0, "failed": 0, "results": [],
                "note": "No rows returned by SQL."}

    succeeded, failed, api_results = 0, 0, []

    for i, row_data in enumerate(rows):
        # Build payload: use required_fields if defined, else all columns
        fields = required_fields or (list(row_data.keys()) if isinstance(row_data, dict) else columns)
        payload: dict = {}
        for field in fields:
            if isinstance(row_data, dict):
                val = row_data.get(field)
                if val is None:
                    # Case-insensitive fallback
                    for col in row_data:
                        if col.lower() == field.lower():
                            val = row_data[col]
                            break
                payload[field] = val if val is not None else ""
            elif isinstance(row_data, list) and field in columns:
                payload[field] = row_data[columns.index(field)]
            else:
                payload[field] = ""

        call_result = _tool_execute_api(api_id, payload, db)
        sc = call_result.get("status_code", 0)
        ok = (sc < 400) if sc else ("error" not in call_result)
        if ok:
            succeeded += 1
        else:
            failed += 1
        api_results.append({"row": i + 1, "payload": payload, "result": call_result})

        if i < len(rows) - 1:
            time.sleep(0.2)

    return {
        "total": len(rows),
        "succeeded": succeeded,
        "failed": failed,
        "results": api_results[:20],
    }


def _tool_preview_email(to: str, subject: str, body: str) -> dict:
    return {
        "type":    "email_preview",
        "to":      to,
        "subject": subject,
        "body":    body,
        "note":    "Preview only — no email was sent.",
    }


def _tool_generate_report(title: str, columns: list, rows: list) -> dict:
    if not columns:
        return {"report": f"# {title}\n\nNo data."}

    lines = [f"# {title}", "", f"**{len(rows)} rows · {len(columns)} columns**", ""]

    # Markdown table (max 20 rows for readability)
    header = "| " + " | ".join(str(c) for c in columns) + " |"
    sep    = "| " + " | ".join("---" for _ in columns) + " |"
    lines += [header, sep]
    for row in rows[:20]:
        if isinstance(row, dict):
            vals = [str(row.get(c, "")) for c in columns]
        else:
            vals = [str(v) for v in row]
        lines.append("| " + " | ".join(vals) + " |")
    if len(rows) > 20:
        lines.append(f"\n*... and {len(rows) - 20} more rows*")

    # Simple numeric stats
    stats = []
    for ci, col in enumerate(columns):
        vals = []
        for row in rows:
            try:
                v = row[col] if isinstance(row, dict) else row[ci]
                vals.append(float(v))
            except Exception:
                pass
        if vals:
            stats.append(f"**{col}**: min={min(vals):.2f}, max={max(vals):.2f}, avg={sum(vals)/len(vals):.2f}")
    if stats:
        lines += ["", "## Summary", ""] + stats

    return {"report": "\n".join(lines)}


# ═══════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════


def _get_conn_dialect(conn_id: Optional[int], db: Session) -> str:
    if not conn_id:
        return "mssql"
    conn = db.query(SourceConnection).filter_by(id=conn_id).first()
    if not conn:
        return "mssql"
    if conn.source_type == "snowflake":
        return "snowflake"
    return conn.dialect or "mssql"


def _build_system_prompt(conn_id: Optional[int], db: Session) -> str:
    table_ctx = ""

    # Internal/system table prefixes to exclude from the LLM schema context.
    # These add noise and cause the LLM to hallucinate generic names.
    _NOISE_PREFIXES = (
        "RAG_", "VECTOR_", "TARGET_", "VW_", "XML_", "LEGACY_",
        "conversion_", "EMP_XML", "FINAL_XML", "UserRequest", "Executer",
    )

    if conn_id:
        # Full catalog: group columns by table, skip internal/noise tables
        cat_rows = (
            db.query(CatalogColumn)
            .filter_by(conn_id=conn_id)
            .order_by(CatalogColumn.table_name, CatalogColumn.column_name)
            .all()
        )
        if cat_rows:
            tables: dict[str, list[str]] = {}
            for r in cat_rows:
                if any(r.table_name.startswith(p) for p in _NOISE_PREFIXES):
                    continue
                tables.setdefault(r.table_name, []).append(
                    f"{r.column_name} ({r.data_type or 'unknown'})"
                )
            lines = []
            for tbl, cols in tables.items():
                lines.append(f"  Table: {tbl}")
                lines.append("    Columns: " + ", ".join(cols[:20]))
            table_ctx = "\n".join(lines)

    schema_section = table_ctx or \
        "  (no schema found — run Admin > Collect Schema first)"

    # ── Load QueryContext (admin master prompt) per connection ──────────────
    master_prompt_section = ""
    try:
        parts: list[str] = []
        global_ctx = db.query(QueryContext).filter(QueryContext.conn_id == None).first()
        if global_ctx and global_ctx.content and global_ctx.content.strip():
            parts.append(global_ctx.content.strip())
        if conn_id:
            conn_ctx = db.query(QueryContext).filter(QueryContext.conn_id == conn_id).first()
            if conn_ctx and conn_ctx.content and conn_ctx.content.strip():
                parts.append(conn_ctx.content.strip())
        if parts:
            master_prompt_section = (
                "\n\n        DOMAIN KNOWLEDGE (from Admin → Query Master Prompt):\n"
                "        " + "\n        ---\n        ".join(parts)
            )
    except Exception:
        pass  # master prompt is optional — never block the chat

    return textwrap.dedent(f"""
        You are a Production Support AI assistant for a data warehouse / ETL pipeline.
        Your job is to help analysts identify and resolve data issues quickly.

        AVAILABLE TOOLS:
        - lookup_schema: find relevant tables/columns via keyword matching over the schema catalog
        - generate_sql: generate a SQL SELECT query from natural language
        - execute_sql: run the SQL query against the connected data source and return rows
        - list_api_endpoints: list available REST APIs in the predefined collection
        - execute_api: call an API to fix/update a SINGLE record (ALWAYS requires user approval)
        - execute_api_for_rows: call the same API once per row from SQL — for MULTIPLE records (one approval, sequential execution)
        - preview_email: render an email summary preview card (does NOT actually send)
        - generate_report: format query results as a markdown report with statistics

        DATABASE SCHEMA — USE ONLY THESE EXACT TABLE AND COLUMN NAMES:
        ⚠ CRITICAL: Every table and column in your SQL MUST appear in the list below.
        NEVER invent, guess, or use synonyms (e.g. do NOT use "Employees" if the table is "EMP",
        do NOT use "Departments" if the table is "DEPT"). If unsure, call lookup_schema first.
{schema_section}

        INTENT ROUTING — classify the request BEFORE executing any tools:
        ┌──────────────────────────────────────────────────────────────────────────┐
        │ QUERY   → data retrieval only → execute_sql only, NO API calls          │
        │           (show, list, find, count, get, report, describe, view)        │
        │ ACTION  → data modification / external system interaction → API tools   │
        │           (create, update, delete, fix, send, terminate, push, assign)  │
        │ MIXED   → query first, then action based on results                     │
        └──────────────────────────────────────────────────────────────────────────┘
        CRITICAL: If intent is QUERY → do NOT call list_api_endpoints or execute_api.

        TOOL USAGE RULES — READ vs MODIFY:
        ┌─────────────────────────────────────────────────────────────────┐
        │ READ  data  → ALWAYS use execute_sql (SELECT only)             │
        │ MODIFY data → ALWAYS use execute_api / execute_api_for_rows    │
        │               (never write INSERT/UPDATE/DELETE SQL directly)  │
        └─────────────────────────────────────────────────────────────────┘

        MANDATORY API EXECUTION FLOW (ACTION / MIXED only):
        Step 1: list_api_endpoints — identify the correct API (call ONCE per turn)
        Step 2: Read the API's required_fields + body_template
        Step 3: generate_sql — SELECT only the required_fields columns
        Step 4: execute_sql — fetch the rows
        Step 5a (single record)  → execute_api(api_id, payload)
        Step 5b (multiple records) → execute_api_for_rows(api_id, sql)
                 → ONE approval covers all records
                 → executed sequentially, one call per row, 200ms delay
                 → sql must SELECT the required_fields columns

        WORKFLOW RULES:
        1. QUERY intent: lookup_schema → generate_sql → execute_sql. Stop. No API calls.
        2. ACTION / MIXED intent: follow the MANDATORY API EXECUTION FLOW above.
        3. The generated SQL MUST be SELECT only and reference only tables in the schema above.
        4. Always show the generated SQL in your reply before it executes.
        5. Each API entry includes: id, name, description, method, url, body_template, required_fields.
           - required_fields: list of field names the API needs (e.g. ["emp_id", "deptno"]).
             The SQL must SELECT columns with these exact names.
           - body_template: JSON template with {{field}} placeholders — filled automatically.
        6. Do NOT ask for confirmation before calling execute_api — the approval card IS the confirmation.
        7. ALWAYS include a complete, non-null payload in execute_api. Never send payload: null.
        8. If no API perfectly matches, use the closest available one. Never refuse.
        9. When a prior API call shows success (status_code 200), treat it as DONE. Do NOT retry.
        10. execute_api ALWAYS requires user approval — never skip.
        11. For email requests: use preview_email — never claim to actually send.
        12. Be concise. Act first, explain briefly. Do NOT ask clarifying questions before attempting.
        13. If schema is empty: tell the user to run Admin > Collect Schema and Generate Embeddings.
{master_prompt_section}
    """).strip()


def _safe_json(s: Optional[str]):
    """Parse a stored JSON string — return raw string on decode error (truncated data)."""
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        return s  # truncated — return as-is


def _save_msg(db: Session, conv_id: int, role: str, content: Optional[str],
              tool_name: Optional[str] = None,
              tool_input: Optional[dict] = None,
              tool_output: Any = None) -> PsMessage:
    ti = json.dumps(tool_input)[:TRUNC_JSON] if tool_input else None
    to = json.dumps(tool_output)[:TRUNC_JSON] if tool_output is not None else None
    msg = PsMessage(
        conversation_id=conv_id,
        role=role,
        content=content,
        tool_name=tool_name,
        tool_input_json=ti,
        tool_output_json=to,
    )
    db.add(msg)
    db.flush()
    return msg


def _history_for_llm(conv_id: int, db: Session) -> list[dict]:
    """Reconstruct the last N messages into OpenAI message format."""
    msgs = (
        db.query(PsMessage)
        .filter_by(conversation_id=conv_id)
        .order_by(PsMessage.id.desc())
        .limit(MAX_HISTORY_MSGS)
        .all()
    )
    msgs = list(reversed(msgs))
    out = []
    for m in msgs:
        if m.role == "user":
            out.append({"role": "user", "content": m.content or ""})
        elif m.role == "assistant":
            out.append({"role": "assistant", "content": m.content or ""})
        elif m.role == "tool":
            # Represent tool results as assistant context
            out.append({
                "role": "assistant",
                "content": f"[Tool: {m.tool_name}]\nResult: {m.tool_output_json or ''}"
            })
    return out


# ═══════════════════════════════════════════════════════════
# Agentic loop
# ═══════════════════════════════════════════════════════════

def _run_agent_loop(
    messages: list[dict],
    system_prompt: str,
    model: str,
    conn_id: Optional[int],
    pending_approvals: list[PendingApproval],
    db: Session,
    intent: str = "MIXED",
) -> tuple[str, list[ToolCallRecord], list[PendingApprovalOut]]:
    """
    Run the OpenAI tool-calling loop.
    Returns (final_text, executed_tool_calls, pending_approvals_out).
    """
    from openai import OpenAI

    api_key = settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY not set in .env")

    client = OpenAI(api_key=api_key)
    tools_for_turn = _get_tools_for_intent(intent)

    # Build approval lookup from request
    approval_map: dict[str, bool] = {a.tool_call_id: a.approved for a in pending_approvals}

    executed: list[ToolCallRecord] = []
    pending_out: list[PendingApprovalOut] = []

    llm_messages = [{"role": "system", "content": system_prompt}] + messages

    for _round in range(MAX_TOOL_ROUNDS):
        resp = client.chat.completions.create(
            model=model,
            messages=llm_messages,
            tools=tools_for_turn,
            tool_choice="auto",
        )
        choice = resp.choices[0]
        msg = choice.message

        if not msg.tool_calls:
            # Final text answer
            return msg.content or "", executed, pending_out

        # Process tool calls
        llm_messages.append({"role": "assistant", "content": msg.content, "tool_calls": [
            {"id": tc.id, "type": "function",
             "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
            for tc in msg.tool_calls
        ]})

        for tc in msg.tool_calls:
            fn_name = tc.function.name
            try:
                fn_args = json.loads(tc.function.arguments)
            except Exception:
                fn_args = {}

            # ── execute_api always needs approval ─────────────
            if fn_name == "execute_api":
                if approval_map.get(tc.id) is True:
                    result = _tool_execute_api(fn_args.get("api_id"), fn_args.get("payload", {}), db)
                else:
                    entry = db.query(PsApiCollection).filter_by(
                        id=fn_args.get("api_id"), is_active=True).first()
                    preview = f"{entry.method} {entry.url}" if entry else f"API id={fn_args.get('api_id')}"
                    pending_out.append(PendingApprovalOut(
                        tool_call_id=tc.id, tool=fn_name,
                        input=fn_args, preview=preview,
                    ))
                    llm_messages.append({
                        "role": "tool", "tool_call_id": tc.id,
                        "content": json.dumps({"status": "awaiting_approval"})
                    })
                    continue

            # ── execute_sql: write ops need approval ──────────
            elif fn_name == "execute_sql":
                sql = fn_args.get("sql", "")
                if _is_write_sql(sql) and approval_map.get(tc.id) is not True:
                    pending_out.append(PendingApprovalOut(
                        tool_call_id=tc.id, tool=fn_name,
                        input=fn_args, preview=f"WRITE: {sql[:200]}",
                    ))
                    llm_messages.append({
                        "role": "tool", "tool_call_id": tc.id,
                        "content": json.dumps({"status": "awaiting_approval"})
                    })
                    continue
                else:
                    result = _tool_execute_sql(sql, conn_id, db)

            # ── auto-execute tools ────────────────────────────
            elif fn_name == "execute_api_for_rows":
                rows_api_id  = fn_args.get("api_id")
                rows_sql_str = fn_args.get("sql", "")
                rows_fp      = (rows_api_id, rows_sql_str[:200])
                is_rows_approved = approval_map.get(tc.id) is True
                if is_rows_approved:
                    result = _tool_execute_api_for_rows(rows_api_id, rows_sql_str, conn_id, db)
                else:
                    # Preview: count rows, then request approval
                    preview_result = _tool_execute_sql(rows_sql_str, conn_id, db)
                    row_count = preview_result.get("row_count", 0)
                    entry = db.query(PsApiCollection).filter_by(id=rows_api_id, is_active=True).first()
                    api_desc = f"{entry.method} {entry.url}" if entry else f"API id={rows_api_id}"
                    preview = f"{api_desc} — {row_count} record{'s' if row_count != 1 else ''}, sequential (200ms delay)"
                    pending_out.append(PendingApprovalOut(
                        tool_call_id=tc.id, tool=fn_name,
                        input=fn_args, preview=preview,
                    ))
                    llm_messages.append({
                        "role": "tool", "tool_call_id": tc.id,
                        "content": json.dumps({"status": "awaiting_approval", "record_count": row_count})
                    })
                    continue
            elif fn_name == "lookup_schema":
                result = _tool_lookup_schema(fn_args.get("question", ""), conn_id, db)
            elif fn_name == "generate_sql":
                dialect = fn_args.get("dialect") or _get_conn_dialect(conn_id, db)
                result = _tool_generate_sql(
                    fn_args.get("question", ""),
                    fn_args.get("context_columns", []),
                    dialect, db, conn_id,
                )
            elif fn_name == "list_api_endpoints":
                result = _tool_list_api_endpoints(db)
            elif fn_name == "preview_email":
                result = _tool_preview_email(
                    fn_args.get("to", ""),
                    fn_args.get("subject", ""),
                    fn_args.get("body", ""),
                )
            elif fn_name == "generate_report":
                try:
                    cols = json.loads(fn_args.get("columns_json", "[]"))
                except Exception:
                    cols = []
                try:
                    rows = json.loads(fn_args.get("rows_json", "[]"))
                except Exception:
                    rows = []
                result = _tool_generate_report(fn_args.get("title", "Report"), cols, rows)
            else:
                result = {"error": f"Unknown tool: {fn_name}"}

            executed.append(ToolCallRecord(tool=fn_name, input=fn_args, output=result))
            llm_messages.append({
                "role": "tool", "tool_call_id": tc.id,
                "content": json.dumps(result)[:8000],
            })

        # If we have pending approvals break out early
        if pending_out:
            # Ask LLM for an interim response explaining what's waiting
            try:
                interim = client.chat.completions.create(
                    model=model,
                    messages=llm_messages + [{
                        "role": "user",
                        "content": "Summarize what you found so far and what approvals are pending."
                    }],
                )
                interim_text = interim.choices[0].message.content or ""
            except Exception:
                interim_text = "I need your approval to proceed with the next step."
            return interim_text, executed, pending_out

    return "I reached the maximum number of tool-call rounds. Please rephrase or break down the request.", executed, pending_out


# ═══════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════
# Streaming agent loop — yields NDJSON events
# ═══════════════════════════════════════════════════════════

_TOOL_LABELS = {
    "lookup_schema":         "Looking up schema…",
    "generate_sql":          "Generating SQL query…",
    "execute_sql":           "Executing query…",
    "list_api_endpoints":    "Listing API endpoints…",
    "execute_api":           "Calling API…",
    "execute_api_for_rows":  "Preparing sequential API calls…",
    "preview_email":         "Preparing email preview…",
    "generate_report":       "Generating report…",
}


def _run_agent_loop_stream(
    messages: list[dict],
    system_prompt: str,
    model: str,
    conn_id: Optional[int],
    pending_approvals: list[PendingApproval],
    db: Session,
):
    """
    Generator — yields dicts that are serialised as NDJSON by the streaming endpoint.
    Event types: tool_start | tool_done | approval_needed | message | done | error
    """
    from openai import OpenAI

    api_key = settings.OPENAI_API_KEY.strip()
    if not api_key:
        yield {"type": "error", "detail": "OPENAI_API_KEY not set in .env"}
        return

    client = OpenAI(api_key=api_key)
    # Build approval sets — match by CONTENT (api_id / sql), not by ephemeral tool_call_id.
    # tool_call_id changes every time the LLM replays; api_id and sql fingerprint are stable.
    approval_map: dict[str, bool] = {a.tool_call_id: a.approved for a in pending_approvals}
    approved_api_ids: set[int]  = {a.api_id  for a in pending_approvals if a.approved and a.api_id is not None}
    approved_sql_fps: set[str]  = {(a.sql or "")[:200] for a in pending_approvals if a.approved and a.sql}
    # execute_api_for_rows approvals keyed by (api_id, sql_fingerprint)
    approved_rows: set[tuple] = {
        (a.api_id, (a.rows_sql or "")[:200])
        for a in pending_approvals if a.approved and a.rows_sql and a.api_id is not None
    }

    executed: list[ToolCallRecord] = []
    pending_out: list[PendingApprovalOut] = []
    llm_messages = [{"role": "system", "content": system_prompt}] + messages

    # Determine intent from the last user message for tool filtering
    user_msg_text = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    intent = _classify_intent(user_msg_text)
    tools_for_turn = _get_tools_for_intent(intent)

    for _round in range(MAX_TOOL_ROUNDS):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=llm_messages,
                tools=tools_for_turn,
                tool_choice="auto",
            )
        except Exception as exc:
            yield {"type": "error", "detail": str(exc)}
            return

        choice = resp.choices[0]
        msg = choice.message

        if not msg.tool_calls:
            yield {"type": "message", "content": _pii_scrub(msg.content or "")}
            yield {"type": "done", "executed": [{"tool": t.tool, "input": t.input, "output": t.output} for t in executed], "pending_approvals": [p.dict() for p in pending_out]}
            return

        llm_messages.append({"role": "assistant", "content": msg.content, "tool_calls": [
            {"id": tc.id, "type": "function",
             "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
            for tc in msg.tool_calls
        ]})

        for tc in msg.tool_calls:
            fn_name = tc.function.name
            try:
                fn_args = json.loads(tc.function.arguments)
            except Exception:
                fn_args = {}

            yield {"type": "tool_start", "tool": fn_name, "label": _TOOL_LABELS.get(fn_name, fn_name), "tool_call_id": tc.id}

            # execute_api — always needs approval; match by api_id (stable) not tool_call_id
            if fn_name == "execute_api":
                call_api_id = fn_args.get("api_id")
                is_approved = (
                    approval_map.get(tc.id) is True or
                    (call_api_id is not None and call_api_id in approved_api_ids)
                )
                if is_approved:
                    # Consume the approval so it can't be reused for a different API
                    approved_api_ids.discard(call_api_id)
                    result = _tool_execute_api(call_api_id, fn_args.get("payload", {}), db)
                    yield {"type": "tool_done", "tool": fn_name, "tool_call_id": tc.id, "output": result, "input": fn_args}
                    executed.append(ToolCallRecord(tool=fn_name, input=fn_args, output=result))
                    llm_messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)[:8000]})
                else:
                    entry = db.query(PsApiCollection).filter_by(id=call_api_id, is_active=True).first()
                    preview = f"{entry.method} {entry.url}" if entry else f"API id={call_api_id}"
                    pa = PendingApprovalOut(tool_call_id=tc.id, tool=fn_name, input=fn_args, preview=preview)
                    pending_out.append(pa)
                    # Don't yield approval_needed here — emit after the summary message below
                    # so the card is the LAST element and auto-scroll makes it visible.
                    llm_messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps({"status": "awaiting_approval"})})
                continue

            # execute_api_for_rows — sequential, one call per row; requires one approval
            elif fn_name == "execute_api_for_rows":
                rows_api_id  = fn_args.get("api_id")
                rows_sql_str = fn_args.get("sql", "")
                rows_fp      = (rows_api_id, rows_sql_str[:200])
                is_rows_approved = approval_map.get(tc.id) is True or rows_fp in approved_rows
                if is_rows_approved:
                    approved_rows.discard(rows_fp)
                    result = _tool_execute_api_for_rows(rows_api_id, rows_sql_str, conn_id, db)
                    yield {"type": "tool_done", "tool": fn_name, "tool_call_id": tc.id, "output": result, "input": fn_args}
                    executed.append(ToolCallRecord(tool=fn_name, input=fn_args, output=result))
                    llm_messages.append({"role": "tool", "tool_call_id": tc.id,
                                         "content": json.dumps({"total": result.get("total", 0), "succeeded": result.get("succeeded", 0), "failed": result.get("failed", 0)})})
                else:
                    # Preview: count rows, then request approval
                    preview_result = _tool_execute_sql(rows_sql_str, conn_id, db)
                    row_count = preview_result.get("row_count", 0)
                    entry = db.query(PsApiCollection).filter_by(id=rows_api_id, is_active=True).first()
                    api_desc = f"{entry.method} {entry.url}" if entry else f"API id={rows_api_id}"
                    preview = f"{api_desc} — {row_count} record{'s' if row_count != 1 else ''}, sequential (one call per row, 200ms delay)"
                    pa = PendingApprovalOut(tool_call_id=tc.id, tool=fn_name, input=fn_args, preview=preview)
                    pending_out.append(pa)
                    llm_messages.append({"role": "tool", "tool_call_id": tc.id,
                                         "content": json.dumps({"status": "awaiting_approval", "record_count": row_count})})
                continue

            # execute_sql — write ops need approval; match by sql fingerprint
            elif fn_name == "execute_sql":
                sql = fn_args.get("sql", "")
                sql_fp = sql[:200]
                is_sql_approved = approval_map.get(tc.id) is True or sql_fp in approved_sql_fps
                if _is_write_sql(sql) and not is_sql_approved:
                    pa = PendingApprovalOut(tool_call_id=tc.id, tool=fn_name, input=fn_args, preview=f"WRITE: {sql[:200]}")
                    pending_out.append(pa)
                    # Don't yield here — emitted after summary message so card is last/visible
                    llm_messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps({"status": "awaiting_approval"})})
                    continue
                else:
                    if is_sql_approved:
                        approved_sql_fps.discard(sql_fp)
                    result = _tool_execute_sql(sql, conn_id, db)

            # auto-execute tools
            elif fn_name == "lookup_schema":
                result = _tool_lookup_schema(fn_args.get("question", ""), conn_id, db)
            elif fn_name == "generate_sql":
                dialect = fn_args.get("dialect") or _get_conn_dialect(conn_id, db)
                result = _tool_generate_sql(fn_args.get("question", ""), fn_args.get("context_columns", []), dialect, db, conn_id)
            elif fn_name == "list_api_endpoints":
                result = _tool_list_api_endpoints(db)
            elif fn_name == "preview_email":
                result = _tool_preview_email(fn_args.get("to", ""), fn_args.get("subject", ""), fn_args.get("body", ""))
            elif fn_name == "generate_report":
                try:
                    cols = json.loads(fn_args.get("columns_json", "[]"))
                except Exception:
                    cols = []
                try:
                    rws = json.loads(fn_args.get("rows_json", "[]"))
                except Exception:
                    rws = []
                result = _tool_generate_report(fn_args.get("title", "Report"), cols, rws)
            else:
                result = {"error": f"Unknown tool: {fn_name}"}

            yield {"type": "tool_done", "tool": fn_name, "tool_call_id": tc.id, "output": result, "input": fn_args}
            executed.append(ToolCallRecord(tool=fn_name, input=fn_args, output=result))
            llm_messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)[:8000]})

        if pending_out:
            # Emit the summary text FIRST so the bubble renders above the approval card.
            # Then emit approval cards LAST so they are the final visible element and
            # auto-scroll brings them into view — the user cannot miss them.
            try:
                interim = client.chat.completions.create(
                    model=model,
                    messages=llm_messages + [{"role": "user", "content": "Briefly summarize what you found and what action requires approval."}],
                )
                interim_text = interim.choices[0].message.content or ""
            except Exception:
                interim_text = "Review the approval request below and click Approve or Reject."
            yield {"type": "message", "content": _pii_scrub(interim_text)}
            # Approval cards come after the bubble — scroll lands here
            for pa in pending_out:
                yield {"type": "approval_needed", "tool_call_id": pa.tool_call_id,
                       "tool": pa.tool, "input": pa.input, "preview": pa.preview}
            yield {"type": "done", "executed": [{"tool": t.tool, "input": t.input, "output": t.output} for t in executed], "pending_approvals": [p.dict() for p in pending_out]}
            return

    yield {"type": "message", "content": "I reached the maximum number of tool-call rounds. Please rephrase or break down the request."}
    yield {"type": "done", "executed": [], "pending_approvals": []}


def _generate_title(message: str, model: str) -> str:
    """Ask LLM for a short 4-8 word conversation title."""
    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY.strip())
        r = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Generate a short 4-8 word title for a production support chat based on the user's first message. Reply with only the title, no quotes."},
                {"role": "user", "content": message},
            ],
            max_tokens=20,
            temperature=0.3,
        )
        return r.choices[0].message.content.strip()[:120]
    except Exception:
        return message[:80]


@router.post("/ps/chat/stream", tags=["ps-agent"])
def ps_chat_stream(req: ChatRequest, db: Session = Depends(get_db)):
    """Streaming version — yields NDJSON events as the agent works."""
    from fastapi.responses import StreamingResponse
    from api.database import SessionLocal

    is_new_conv = req.conversation_id is None
    if req.conversation_id:
        conv = db.query(PsConversation).filter_by(id=req.conversation_id).first()
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if req.conn_id is not None:
            conv.conn_id = req.conn_id
        conv.model = req.model
    else:
        conv = PsConversation(
            conn_id=req.conn_id, provider="openai", model=req.model,
            title=req.message[:80],
        )
        db.add(conv)
        db.flush()

    # Don't persist synthetic approval acknowledgement messages — they pollute LLM history
    is_approval_msg = req.message.startswith("[Approved:") or req.message.startswith("[Rejected:")
    if not is_approval_msg:
        _save_msg(db, conv.id, "user", _pii_scrub(req.message))

    # ── Fast-path: direct execution for approved tool calls ──────────────────
    # When the user approves an execute_api or execute_sql, DON'T replay the LLM
    # (it generates a new tool_call_id every time, causing an infinite approval loop).
    # Instead, execute the approved tool directly using the stored payload and return.
    approved_direct = [a for a in req.pending_approvals if a.approved and (a.api_id is not None or a.sql or a.rows_sql)]
    if approved_direct:
        conv_id = conv.id
        conn_id = conv.conn_id
        db.commit()

        def generate_direct():
            stream_db = SessionLocal()
            try:
                results_text_parts = []
                for ap in approved_direct:
                    if ap.api_id is not None:
                        yield json.dumps({"type": "tool_start", "tool": "execute_api",
                                          "label": "Executing approved API call…",
                                          "tool_call_id": ap.tool_call_id, "conversation_id": conv_id}) + "\n"
                        result = _tool_execute_api(ap.api_id, ap.payload or {}, stream_db)
                        yield json.dumps({"type": "tool_done", "tool": "execute_api",
                                          "tool_call_id": ap.tool_call_id, "output": result,
                                          "conversation_id": conv_id}) + "\n"
                        _save_msg(stream_db, conv_id, "tool", None,
                                  tool_name="execute_api", tool_input={"api_id": ap.api_id, "payload": ap.payload},
                                  tool_output=result)
                        # result shape: {"status_code": 200, "response": {...}}
                        sc = result.get("status_code", 0)
                        inner = result.get("response", result) if isinstance(result.get("response"), dict) else result
                        http_ok = (sc < 400) if sc else True
                        # Also check the body's own success flag (e.g. {"success": false} at HTTP 200)
                        body_ok = inner.get("success", True) if isinstance(inner, dict) and "success" in inner else True
                        api_ok = http_ok and body_ok
                        if api_ok:
                            msg = inner.get("message") or json.dumps(inner)
                            results_text_parts.append(f"✅ API call succeeded: {msg}")
                        else:
                            msg = inner.get("error") or inner.get("message") or json.dumps(inner)
                            results_text_parts.append(f"❌ API call failed: {msg}")

                    elif ap.sql:
                        yield json.dumps({"type": "tool_start", "tool": "execute_sql",
                                          "label": "Executing approved SQL…",
                                          "tool_call_id": ap.tool_call_id, "conversation_id": conv_id}) + "\n"
                        result = _tool_execute_sql(ap.sql, conn_id, stream_db)
                        yield json.dumps({"type": "tool_done", "tool": "execute_sql",
                                          "tool_call_id": ap.tool_call_id, "output": result,
                                          "conversation_id": conv_id}) + "\n"
                        _save_msg(stream_db, conv_id, "tool", None,
                                  tool_name="execute_sql", tool_input={"sql": ap.sql},
                                  tool_output=result)
                        results_text_parts.append(f"✅ SQL executed: {result.get('row_count', 0)} rows affected.")

                    elif ap.rows_sql and ap.api_id is not None:
                        yield json.dumps({"type": "tool_start", "tool": "execute_api_for_rows",
                                          "label": "Running sequential API calls…",
                                          "tool_call_id": ap.tool_call_id, "conversation_id": conv_id}) + "\n"
                        rows_out = _tool_execute_api_for_rows(ap.api_id, ap.rows_sql, conn_id, stream_db)
                        yield json.dumps({"type": "tool_done", "tool": "execute_api_for_rows",
                                          "tool_call_id": ap.tool_call_id, "output": rows_out,
                                          "conversation_id": conv_id}) + "\n"
                        _save_msg(stream_db, conv_id, "tool", None,
                                  tool_name="execute_api_for_rows",
                                  tool_input={"api_id": ap.api_id, "sql": ap.rows_sql},
                                  tool_output=rows_out)
                        succeeded = rows_out.get("succeeded", 0)
                        failed    = rows_out.get("failed", 0)
                        total     = rows_out.get("total", 0)
                        status_icon = "✅" if failed == 0 else ("⚠️" if succeeded > 0 else "❌")
                        results_text_parts.append(
                            f"{status_icon} API calls: {succeeded}/{total} records succeeded"
                            + (f", {failed} failed" if failed else "") + "."
                        )

                final_text = "\n".join(results_text_parts) or "Done."
                yield json.dumps({"type": "message", "content": final_text, "conversation_id": conv_id}) + "\n"
                _save_msg(stream_db, conv_id, "assistant", final_text)
                stream_db.commit()
                yield json.dumps({"type": "done", "executed": [], "pending_approvals": [],
                                  "conversation_id": conv_id}) + "\n"
            except Exception as exc:
                stream_db.rollback()
                yield json.dumps({"type": "error", "detail": str(exc), "conversation_id": conv_id}) + "\n"
            finally:
                stream_db.close()

        return StreamingResponse(generate_direct(), media_type="application/x-ndjson")
    # ── End fast-path ─────────────────────────────────────────────────────────

    # Snapshot everything needed before the request-scoped session closes
    system_prompt = _build_system_prompt(conv.conn_id, db)
    history       = _history_for_llm(conv.id, db)
    conv_id       = conv.id
    conn_id       = conv.conn_id
    first_message = _pii_scrub(req.message)

    # Commit now — get_db's finally block will close the session before
    # the StreamingResponse generator runs, so we must persist up-front.
    db.commit()

    def generate():
        # Fresh session — the request-scoped `db` is already closed here
        stream_db = SessionLocal()
        final_text = ""
        all_executed = []
        try:
            for event in _run_agent_loop_stream(
                messages=history,
                system_prompt=system_prompt,
                model=req.model,
                conn_id=conn_id,
                pending_approvals=req.pending_approvals,
                db=stream_db,
            ):
                event["conversation_id"] = conv_id
                if event["type"] == "message":
                    event["content"] = _pii_scrub(event.get("content", ""))
                    final_text = event["content"]
                if event["type"] == "tool_done":
                    all_executed.append(event)
                yield json.dumps(event) + "\n"

        except Exception as exc:
            yield json.dumps({"type": "error", "detail": str(exc), "conversation_id": conv_id}) + "\n"
            stream_db.close()
            return

        # Persist assistant reply + tool results
        try:
            _save_msg(stream_db, conv_id, "assistant", final_text)
            for ev in all_executed:
                _save_msg(stream_db, conv_id, "tool", None,
                          tool_name=ev.get("tool"),
                          tool_input=ev.get("input"),
                          tool_output=ev.get("output"))

            if is_new_conv:
                title = _generate_title(first_message, req.model)
                stream_db.query(PsConversation).filter_by(id=conv_id).update({"title": title})
                yield json.dumps({"type": "title_update", "conversation_id": conv_id, "title": title}) + "\n"

            stream_db.commit()
        except Exception as exc:
            stream_db.rollback()
            yield json.dumps({"type": "error", "detail": "Save failed: " + str(exc), "conversation_id": conv_id}) + "\n"
        finally:
            stream_db.close()

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.post("/ps/chat", response_model=ChatResponse, tags=["ps-agent"])
def ps_chat(req: ChatRequest, db: Session = Depends(get_db)):
    # ── 1. Load or create conversation ───────────────────────
    if req.conversation_id:
        conv = db.query(PsConversation).filter_by(id=req.conversation_id).first()
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        # Update connection/model if provided
        if req.conn_id is not None:
            conv.conn_id = req.conn_id
        conv.model = req.model
    else:
        conv = PsConversation(
            conn_id=req.conn_id,
            provider="openai",
            model=req.model,
            title=req.message[:80],
        )
        db.add(conv)
        db.flush()

    # ── 2. Save user message ─────────────────────────────────
    _save_msg(db, conv.id, "user", _pii_scrub(req.message))

    # ── 3. Build context ─────────────────────────────────────
    system_prompt = _build_system_prompt(conv.conn_id, db)
    history = _history_for_llm(conv.id, db)

    # ── 4. Run agent loop ────────────────────────────────────
    try:
        final_text, executed, pending_out = _run_agent_loop(
            messages=history,
            system_prompt=system_prompt,
            model=req.model,
            conn_id=conv.conn_id,
            pending_approvals=req.pending_approvals,
            db=db,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # ── 5. Persist assistant reply + tool calls ──────────────
    asst_msg = _save_msg(db, conv.id, "assistant", final_text)
    for tc in executed:
        _save_msg(db, conv.id, "tool", None,
                  tool_name=tc.tool,
                  tool_input=tc.input,
                  tool_output=tc.output)

    db.commit()

    return ChatResponse(
        conversation_id=conv.id,
        content=final_text,
        tool_calls_executed=executed,
        pending_approvals=pending_out,
    )


@router.get("/ps/conversations", tags=["ps-agent"])
def list_conversations(conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    if conn_id is None:
        return []
    q = db.query(PsConversation).filter(PsConversation.conn_id == conn_id)
    rows = q.order_by(PsConversation.id.desc()).limit(50).all()
    return [ConversationOut(
        id=r.id, title=r.title, conn_id=r.conn_id, model=r.model,
        created_at=r.created_at.isoformat() if r.created_at else "",
    ) for r in rows]


@router.get("/ps/conversations/{conv_id}", response_model=ConversationDetail, tags=["ps-agent"])
def get_conversation(conv_id: int, db: Session = Depends(get_db)):
    conv = db.query(PsConversation).filter_by(id=conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    msgs = db.query(PsMessage).filter_by(conversation_id=conv_id).order_by(PsMessage.id).all()
    return ConversationDetail(
        conversation=ConversationOut(
            id=conv.id, title=conv.title, conn_id=conv.conn_id, model=conv.model,
            created_at=conv.created_at.isoformat() if conv.created_at else "",
        ),
        messages=[MessageOut(
            id=m.id, role=m.role, content=m.content,
            tool_name=m.tool_name, tool_input_json=m.tool_input_json,
            tool_output_json=m.tool_output_json,
            created_at=m.created_at.isoformat() if m.created_at else "",
        ) for m in msgs],
    )


@router.delete("/ps/conversations/{conv_id}", tags=["ps-agent"])
def delete_conversation(conv_id: int, db: Session = Depends(get_db)):
    conv = db.query(PsConversation).filter_by(id=conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(conv)
    db.commit()
    return {"deleted": conv_id}


@router.patch("/ps/conversations/{conv_id}/title", tags=["ps-agent"])
def rename_conversation(conv_id: int, body: dict, db: Session = Depends(get_db)):
    conv = db.query(PsConversation).filter_by(id=conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conv.title = body.get("title", conv.title)
    db.commit()
    return {"id": conv_id, "title": conv.title}


@router.get("/ps/conversations/{conv_id}/export", tags=["ps-agent"])
def export_conversation(conv_id: int, fmt: str = "json", db: Session = Depends(get_db)):
    """
    Export a conversation as JSON or plain text.
    ?fmt=json  (default) — structured JSON ready for upload/import
    ?fmt=text  — human-readable transcript (for copy-paste or LLM upload)
    """
    from fastapi.responses import Response

    conv = db.query(PsConversation).filter_by(id=conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    msgs = db.query(PsMessage).filter_by(conversation_id=conv_id).order_by(PsMessage.id).all()

    title = conv.title or f"Chat #{conv_id}"

    if fmt == "text":
        lines = [
            f"# Production Support Chat Export",
            f"Title   : {title}",
            f"Model   : {conv.model}",
            f"Exported: {conv.created_at.isoformat() if conv.created_at else ''}",
            "",
        ]
        for m in msgs:
            if m.role == "user":
                lines += [f"[USER]", m.content or "", ""]
            elif m.role == "assistant":
                lines += [f"[ASSISTANT]", m.content or "", ""]
            elif m.role == "tool":
                inp = m.tool_input_json or ""
                out = m.tool_output_json or ""
                lines += [
                    f"[TOOL: {m.tool_name}]",
                    f"  Input : {inp[:500]}",
                    f"  Output: {out[:500]}",
                    "",
                ]
        content = "\n".join(lines)
        safe = re.sub(r"[^\w\-]", "_", title)[:60]
        return Response(
            content=content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="ps_{safe}.txt"'},
        )

    # Default: JSON
    payload = {
        "conversation": {
            "id": conv.id,
            "title": title,
            "model": conv.model,
            "conn_id": conv.conn_id,
            "created_at": conv.created_at.isoformat() if conv.created_at else None,
        },
        "messages": [],
    }
    for m in msgs:
        payload["messages"].append({
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "tool_name": m.tool_name,
            "tool_input_raw": m.tool_input_json,
            "tool_output_raw": m.tool_output_json,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        })
    safe = re.sub(r"[^\w\-]", "_", title)[:60]
    return Response(
        content=json.dumps(payload, indent=2, default=str),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="ps_{safe}.json"'},
    )


# ═══════════════════════════════════════════════════════════
# AI Co-worker Agent  — POST /api/ps/agent
# ═══════════════════════════════════════════════════════════

class AgentRequest(BaseModel):
    request:    str                   # Natural language task
    conn_id:    Optional[int] = None  # Source connection to operate on
    project_id: Optional[int] = None  # Optional project scope
    model:      str = "gpt-4o-mini"


@router.post("/ps/agent", tags=["ps-agent"])
def run_agent(req: AgentRequest, db: Session = Depends(get_db)):
    """
    Autonomous AI Co-worker Agent.

    Breaks the user's request into steps, executes each using conversion
    pipeline tools (generate SQL, execute query, generate mapping, generate XML,
    validate), retries on failure, and returns a structured report.

    Response:
    {
      "problem":        "...",
      "steps_executed": [{"step": 1, "tool": "...", "summary": "...", "status": "ok|failed"}],
      "findings":       "...",
      "root_cause":     "...",
      "fix_applied":    "...",
      "final_status":   "SUCCESS or FAILED"
    }
    """
    from api.services.agent_loop import run_coworker_agent

    if not req.request.strip():
        raise HTTPException(status_code=422, detail="request cannot be empty")

    result = run_coworker_agent(
        request=req.request,
        conn_id=req.conn_id,
        db=db,
        model=req.model,
        project_id=req.project_id,
    )
    return result.to_dict()


# ═══════════════════════════════════════════════════════════
# DEBUG — GET /api/ps/debug/system-prompt
# Returns the rendered system prompt for a connection so the
# PS Debug panel can display it in the browser.
# ═══════════════════════════════════════════════════════════

@router.get("/ps/debug/system-prompt", tags=["ps-agent"])
def debug_system_prompt(
    conn_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Return the fully-rendered PS system prompt (including master prompt + schema) for debugging."""
    prompt = _build_system_prompt(conn_id, db)
    return {"conn_id": conn_id, "system_prompt": prompt, "length": len(prompt)}
