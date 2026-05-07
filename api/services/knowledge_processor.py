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
You are an enterprise architecture knowledge processor. Given raw content, return a single JSON \
object with these exact keys:
  knowledge_entry: {title, type, system, tags (array of strings), summary, detailed_explanation, \
key_points (array of strings), decision, reason, is_reusable (boolean)}
  status: "READY_FOR_EMBEDDING" or "LOW_QUALITY"
  quality_score: "HIGH", "MEDIUM", or "LOW"
  suggestions: (array of strings)
Return ONLY valid JSON. No markdown fences. No text outside the JSON object."""

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

== KNOWLEDGE AVAILABLE ==
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

== RESPONSE FORMAT (MANDATORY — always use ALL 6 sections) ==

## Summary
Short, clear answer (2-4 sentences).

## Detailed Explanation
Structured explanation of the concept, process, or issue.

## How Systems Connect
Describe which DCT APIs, databases, Snowflake connections, or integration layers are involved
and how they interact. Reference actual connection names from the Project Connections section above.

## Architecture / Flow
Step-by-step system or data flow. ALWAYS include a Mermaid flowchart diagram here:
```mermaid
flowchart TD
  ...
```
Keep node labels under 40 characters. Use flowchart TD or LR as appropriate.
Use only terminology from System Facts and the KB — never invent component names.

## Key Insights / Decisions
Important considerations, best practices, or architectural trade-offs.

## Knowledge & Context Used
List the KB entries referenced and the project connections used.

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

    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:top_k]


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
    kb_hit = bool(results)

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
    for score, chunk in results:
        # Always include top result; skip extras below threshold
        is_top = len(used_results) == 0
        if not is_top and score < CONFIDENCE_THRESHOLD:
            break
        est_tokens = int(len(chunk.content.split()) * 1.3)
        if token_count + est_tokens > CONTEXT_TOKEN_BUDGET:
            break
        context_parts.append(f"[score={score:.2f}] [{chunk.entry.title}] {chunk.content}")
        used_results.append((score, chunk))
        token_count += est_tokens

    context = "\n\n".join(context_parts) if context_parts else "(No matching KB entries — answer from Project Connections/Schema below)"
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

    return {
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
    Side-effect only — does not return anything. Safe to call even when we still
    intend to answer from schema context.
    """
    from api.models import OpenQuestion

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
