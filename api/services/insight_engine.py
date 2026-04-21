"""
insight_engine.py — Generic, domain-neutral insight detection.

No LLM calls in the base path. Optional LLM narrative layer via analyze_with_narrative().
Language is intentionally domain-neutral: "This dataset shows...", "The trend indicates..."
"""
from __future__ import annotations

import statistics
from datetime import datetime
from typing import Optional


def _try_float(v) -> Optional[float]:
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _try_date(v) -> Optional[datetime]:
    if v is None:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(str(v)[:19], fmt)
        except ValueError:
            pass
    return None


def _detect_numeric_cols(columns: list[str], rows: list[dict]) -> list[str]:
    result = []
    for col in columns:
        vals = [_try_float(r.get(col)) for r in rows if r.get(col) is not None]
        if vals and len(vals) >= max(3, len(rows) * 0.5):
            result.append(col)
    return result


def _detect_time_cols(columns: list[str], rows: list[dict]) -> list[str]:
    TIME_HINTS = ("date", "time", "year", "month", "week", "day", "period", "quarter")
    result = []
    for col in columns:
        name_lower = col.lower()
        if any(h in name_lower for h in TIME_HINTS):
            vals = [r.get(col) for r in rows[:10] if r.get(col) is not None]
            if vals and any(_try_date(v) is not None for v in vals):
                result.append(col)
    return result


def _detect_trends(
    numeric_cols: list[str],
    time_cols: list[str],
    rows: list[dict],
) -> list[dict]:
    if not time_cols or not numeric_cols or len(rows) < 6:
        return []

    time_col = time_cols[0]
    # Sort by time column
    def sort_key(r):
        d = _try_date(r.get(time_col))
        return d or datetime.min

    sorted_rows = sorted(rows, key=sort_key)
    mid = len(sorted_rows) // 2
    first_half = sorted_rows[:mid]
    second_half = sorted_rows[mid:]

    trends = []
    for col in numeric_cols[:5]:
        first_vals = [_try_float(r.get(col)) for r in first_half if _try_float(r.get(col)) is not None]
        second_vals = [_try_float(r.get(col)) for r in second_half if _try_float(r.get(col)) is not None]
        if not first_vals or not second_vals:
            continue
        first_mean = statistics.mean(first_vals)
        second_mean = statistics.mean(second_vals)
        if first_mean == 0:
            continue
        change_pct = (second_mean - first_mean) / abs(first_mean) * 100
        if abs(change_pct) < 5:
            direction = "stable"
            note = f"The trend for '{col}' appears stable (< 5% change over the period)."
        elif change_pct > 0:
            direction = "increasing"
            note = f"The trend indicates '{col}' is increasing (+{change_pct:.1f}% from first to second half of the dataset)."
        else:
            direction = "decreasing"
            note = f"The trend indicates '{col}' is decreasing ({change_pct:.1f}% from first to second half of the dataset)."
        trends.append({"column": col, "direction": direction, "change_pct": round(change_pct, 1), "note": note})

    return trends


def _detect_outliers(numeric_cols: list[str], rows: list[dict]) -> list[dict]:
    outliers = []
    for col in numeric_cols[:8]:
        vals = [_try_float(r.get(col)) for r in rows if _try_float(r.get(col)) is not None]
        if len(vals) < 5:
            continue
        mean = statistics.mean(vals)
        try:
            std = statistics.stdev(vals)
        except statistics.StatisticsError:
            continue
        if std == 0:
            continue
        for row in rows:
            v = _try_float(row.get(col))
            if v is None:
                continue
            z = abs(v - mean) / std
            if z >= 2.5:
                outliers.append({
                    "column": col,
                    "value": v,
                    "z_score": round(z, 2),
                    "note": f"An unusual value is observed in column '{col}': {v} ({z:.1f} standard deviations from the mean).",
                })
                if len(outliers) >= 10:
                    return outliers
    return outliers


def _top_categories(columns: list[str], numeric_cols: list[str], rows: list[dict]) -> list[dict]:
    text_cols = [c for c in columns if c not in numeric_cols]
    patterns = []
    for col in text_cols[:5]:
        counts: dict = {}
        for row in rows:
            v = row.get(col)
            if v is None:
                continue
            key = str(v)[:100]
            counts[key] = counts.get(key, 0) + 1
        if 1 < len(counts) <= 50:
            top5 = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:5]
            patterns.append({
                "type": "top_categories",
                "column": col,
                "values": [{"label": k, "count": v} for k, v in top5],
            })
    return patterns


def _null_rates(columns: list[str], rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    n = len(rows)
    result = []
    for col in columns:
        null_count = sum(1 for r in rows if r.get(col) is None or str(r.get(col, "")).strip() == "")
        rate = null_count / n
        if rate > 0.10:
            result.append({"column": col, "null_rate": f"{rate:.0%}", "null_count": null_count})
    return result


def analyze(columns: list[str], rows: list[dict]) -> dict:
    """Pure Python insight detection — no LLM, no DB."""
    n_rows = len(rows)
    n_cols = len(columns)
    summary = f"This dataset contains {n_rows} rows across {n_cols} columns."

    numeric_cols = _detect_numeric_cols(columns, rows)
    time_cols = _detect_time_cols(columns, rows)

    trends   = _detect_trends(numeric_cols, time_cols, rows)
    outliers = _detect_outliers(numeric_cols, rows)
    patterns = _top_categories(columns, numeric_cols, rows)
    nulls    = _null_rates(columns, rows)

    if time_cols:
        summary += f" A time dimension was detected in column '{time_cols[0]}'."
    if numeric_cols:
        summary += f" Numeric columns found: {', '.join(numeric_cols[:5])}."

    return {
        "summary":  summary,
        "trends":   trends,
        "outliers": outliers,
        "patterns": patterns,
        "nulls":    nulls,
    }


def analyze_with_narrative(
    columns: list[str],
    rows: list[dict],
    question: str,
    api_key: str,
    model: str = "gpt-4o-mini",
) -> dict:
    """Extend base analysis with an LLM-generated narrative (executive summary + recommendation)."""
    base = analyze(columns, rows)

    insight_text = f"Summary: {base['summary']}\n"
    if base["trends"]:
        insight_text += "Trends: " + "; ".join(t["note"] for t in base["trends"][:3]) + "\n"
    if base["outliers"]:
        insight_text += "Outliers: " + "; ".join(o["note"] for o in base["outliers"][:3]) + "\n"

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model,
            temperature=0.3,
            max_tokens=400,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": (
                    "You are a data analyst providing domain-neutral business narrative. "
                    "Use neutral language: 'This dataset shows...', 'The data indicates...' "
                    "Return JSON with keys: executive_summary, key_finding, recommendation."
                )},
                {"role": "user", "content": (
                    f"User question: {question}\n\nData insights:\n{insight_text}\n\n"
                    "Provide a brief executive summary, key finding, and one recommendation."
                )},
            ],
        )
        import json
        narrative = json.loads(resp.choices[0].message.content)
        base["narrative"] = narrative
    except Exception as exc:
        base["narrative"] = {"executive_summary": str(exc), "key_finding": "", "recommendation": ""}

    return base
