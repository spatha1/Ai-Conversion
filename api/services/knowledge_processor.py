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

CONFIDENCE_THRESHOLD = 0.45
# text-embedding-3-small: short queries vs long structured content typically score 0.45-0.60.
# Unrelated content scores 0.25-0.40. Tune up if false positives appear.
# Start at 0.75; tune down to 0.60-0.65 after reviewing first 50 Ask SAI interactions.
# Do NOT use a value below 0.50 without corpus-specific calibration.

CONTEXT_TOKEN_BUDGET = 6000
# Rough token estimate: len(text.split()) * 1.3. Stop adding chunks once budget is exceeded.

DUPLICATE_THRESHOLD = 0.92
# Cosine similarity above which an incoming entry is treated as a near-duplicate.
# Operates on representative_emb (embedding of entry summary), not raw chunks.

CHUNK_WORD_SIZE = 400
CHUNK_WORD_OVERLAP = 50
# Chunking is done deterministically in Python — NOT delegated to the LLM.

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
You are SAI, an enterprise architecture assistant. Answer the question using ONLY the context below.
If the context is insufficient, say so clearly — do not guess.

When the question asks for a flow, diagram, chart, or step-by-step visual representation, respond with:
1. A brief plain-text summary (1-2 sentences), then
2. A Mermaid flowchart diagram wrapped in ```mermaid ... ``` fences.
   Use "flowchart TD" or "flowchart LR" as appropriate.
   Keep node labels concise (under 40 chars).
For all other questions, respond with plain text only — no markdown fences.

Context:
{context}

Question: {question}"""


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

    # Chunk the detailed_explanation in Python (deterministic, not delegated to LLM)
    explanation = result["knowledge_entry"].get("detailed_explanation") or ""
    result["chunks"] = _chunk_text(explanation, topic=title) if explanation.strip() else []

    # Write AI trace (swallow errors)
    try:
        from api.services.ai_trace import store
        store(
            module="knowledge",
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
) -> list[tuple[float, object]]:
    """
    Embed query, compute cosine similarity against all stored chunk embeddings.
    Returns top_k (score, KnowledgeChunk) pairs, descending by score.
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
    if exclude_low_quality:
        q = (
            q.join(KnowledgeEntry, KnowledgeChunk.entry_id == KnowledgeEntry.id)
             .filter(KnowledgeEntry.status != "LOW_QUALITY")
        )

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


# ── Ask SAI ───────────────────────────────────────────────────────────────────

def ask_sai(
    *,
    question: str,
    asked_by: Optional[str] = None,
    top_k: int = 5,
    model: str = "gpt-4o-mini",
    db: Session,
) -> dict:
    """
    Semantic search → LLM answer synthesis, or UNANSWERED_FLOW if confidence is low.
    """
    results = semantic_search(question, top_k, db)

    if not results or results[0][0] < CONFIDENCE_THRESHOLD:
        return _unanswered_flow(question, asked_by, db)

    # Build context with token budget
    context_parts: list[str] = []
    used_results: list[tuple[float, object]] = []
    token_count = 0
    for score, chunk in results:
        est_tokens = int(len(chunk.content.split()) * 1.3)
        if token_count + est_tokens > CONTEXT_TOKEN_BUDGET:
            break
        context_parts.append(f"[{chunk.entry.title}] {chunk.content}")
        used_results.append((score, chunk))
        token_count += est_tokens

    context = "\n\n".join(context_parts)
    system_prompt = _load_prompt("knowledge", "ask_sai_answer", db) or _ANSWER_SYSTEM_PROMPT
    prompt_text = system_prompt.format(context=context, question=question)

    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0 = time.monotonic()
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt_text}],
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


def _unanswered_flow(question: str, asked_by: Optional[str], db: Session) -> dict:
    """
    Heuristic tag detection + Jaccard deduplication + OpenQuestion persistence.
    No LLM call — fast path.
    """
    from api.models import OpenQuestion

    # Heuristic tag detection
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

    # Jaccard deduplication against 200 most-recent open questions
    existing = (
        db.query(OpenQuestion)
        .filter(OpenQuestion.status == "open")
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
            return _build_unanswered_dict(question, detected_system, detected_category)

    # Persist new open question
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
