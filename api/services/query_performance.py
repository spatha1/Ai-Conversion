"""
query_performance.py — slow query classification and AI-driven analysis.
"""
import re
import json
import time
from typing import Optional


# ── Thresholds ────────────────────────────────────────────────────────────────
SLOW_DURATION_MS  = 3_000   # queries longer than this are flagged
SLOW_ROWS_PER_SEC = 500     # throughput below this is flagged
MULTI_JOIN_RE     = re.compile(r'\bJOIN\b', re.IGNORECASE)


def classify_slow(
    duration_ms: Optional[int],
    row_count: Optional[int],
    query_text: str,
) -> tuple[bool, Optional[str], Optional[float]]:
    """
    Heuristic slow-query classifier.
    Returns (is_slow, slowness_reason, rows_per_second).
    Pure computation — no I/O.
    """
    if duration_ms is None or duration_ms <= 0:
        return False, None, None

    reasons: list[str] = []
    rps: Optional[float] = None

    if duration_ms > SLOW_DURATION_MS:
        reasons.append("long_duration")

    if row_count and row_count > 0:
        rps = round((row_count * 1000.0) / duration_ms, 1)
        if rps < SLOW_ROWS_PER_SEC:
            reasons.append("low_throughput")

    join_count = len(MULTI_JOIN_RE.findall(query_text))
    if join_count >= 3:
        reasons.append("multi_join")

    is_slow = bool(reasons)
    reason_str = " | ".join(reasons) if reasons else None
    return is_slow, reason_str, rps


def analyze_performance(conn_id: int, db) -> dict:
    """
    Pull slow queries for conn_id, send to GPT-4o-mini for analysis.
    Returns structured dict with index_suggestions, regression_summary,
    top_offenders, narrative, and token/latency metrics.
    """
    from api.models import QueryHistory, AITraceLog, PromptTemplate
    from api.config import settings

    rows = (
        db.query(QueryHistory)
        .filter(
            QueryHistory.conn_id == conn_id,
            QueryHistory.is_slow == True,
            QueryHistory.status == "success",
        )
        .order_by(QueryHistory.executed_at.desc())
        .limit(50)
        .all()
    )

    if not rows:
        return {
            "index_suggestions": [],
            "regression_summary": "No slow queries recorded for this connection yet.",
            "top_offenders": [],
            "narrative": "No slow queries found. Run some queries and check back.",
            "tokens_in": 0,
            "tokens_out": 0,
            "latency_ms": 0,
        }

    # Build concise summary for the prompt
    query_summaries = []
    for r in rows:
        query_summaries.append({
            "query": r.query_text[:300],
            "duration_ms": r.duration_ms,
            "row_count": r.row_count,
            "rows_per_second": r.rows_per_second,
            "reason": r.slowness_reason,
            "executed_at": r.executed_at.isoformat() if r.executed_at else None,
        })

    _SYSTEM_PROMPT = """You are a database performance expert. Analyze the provided slow query log and return ONLY valid JSON with this exact structure:
{
  "index_suggestions": [
    {"table": "table_name", "columns": ["col1", "col2"], "rationale": "why this index helps"}
  ],
  "regression_summary": "plain text — note any sudden latency spikes or patterns over time",
  "top_offenders": [
    {"query_pattern": "truncated query pattern", "avg_ms": 0, "count": 0}
  ],
  "narrative": "2-3 sentence plain English summary for a developer or DBA"
}
Do not include markdown fences or extra text — return raw JSON only."""

    system_prompt = _SYSTEM_PROMPT
    try:
        tmpl = db.query(PromptTemplate).filter(
            PromptTemplate.category == "query_performance",
            PromptTemplate.is_active == True,
        ).first()
        if tmpl and tmpl.content and tmpl.content.strip():
            system_prompt = tmpl.content.strip()
    except Exception:
        pass

    user_msg = (
        f"Connection ID: {conn_id}\n"
        f"Slow query count: {len(rows)}\n\n"
        f"Slow queries (most recent first):\n"
        + json.dumps(query_summaries, indent=2)
    )

    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    t0 = time.time()
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_msg},
        ],
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    elapsed_ms = int((time.time() - t0) * 1000)
    raw = resp.choices[0].message.content or "{}"

    try:
        result = json.loads(raw)
    except Exception:
        result = {
            "index_suggestions": [],
            "regression_summary": "Could not parse AI response.",
            "top_offenders": [],
            "narrative": raw[:500],
        }

    result["tokens_in"]  = resp.usage.prompt_tokens
    result["tokens_out"] = resp.usage.completion_tokens
    result["latency_ms"] = elapsed_ms

    try:
        db.add(AITraceLog(
            module="query_performance",
            conn_id=conn_id,
            model="gpt-4o-mini",
            prompt_text=user_msg[:4000],
            response_text=raw[:4000],
            tokens_in=resp.usage.prompt_tokens,
            tokens_out=resp.usage.completion_tokens,
            latency_ms=elapsed_ms,
        ))
        db.commit()
    except Exception:
        pass

    return result


def get_performance_stats(conn_id: int, db) -> dict:
    """Return quick summary stats for the performance tab header."""
    from api.models import QueryHistory
    from sqlalchemy import func as sqlfunc

    total = (
        db.query(sqlfunc.count(QueryHistory.id))
        .filter(QueryHistory.conn_id == conn_id)
        .scalar() or 0
    )
    slow_count = (
        db.query(sqlfunc.count(QueryHistory.id))
        .filter(QueryHistory.conn_id == conn_id, QueryHistory.is_slow == True)
        .scalar() or 0
    )
    avg_slow_ms = (
        db.query(sqlfunc.avg(QueryHistory.duration_ms))
        .filter(QueryHistory.conn_id == conn_id, QueryHistory.is_slow == True)
        .scalar()
    )

    slow_rows = (
        db.query(QueryHistory)
        .filter(QueryHistory.conn_id == conn_id, QueryHistory.is_slow == True)
        .order_by(QueryHistory.executed_at.desc())
        .limit(25)
        .all()
    )

    return {
        "total_queries": total,
        "slow_count": slow_count,
        "avg_slow_ms": round(avg_slow_ms) if avg_slow_ms else 0,
        "slow_queries": [
            {
                "id": r.id,
                "query_text": r.query_text[:300],
                "duration_ms": r.duration_ms,
                "row_count": r.row_count,
                "rows_per_second": r.rows_per_second,
                "slowness_reason": r.slowness_reason,
                "executed_at": r.executed_at.isoformat() if r.executed_at else None,
            }
            for r in slow_rows
        ],
    }
