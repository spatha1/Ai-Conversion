"""
multi_compare.py — AI-powered multi-source dataset comparison service.

Accepts up to 4 data sources (DB connections + SQL queries, or uploaded files),
fetches/parses all data server-side, computes per-column statistics, then asks
an LLM to produce structured comparison checks and a narrative.

Full dataset rows never leave the server — only 5-row previews are returned.
"""
from __future__ import annotations

import csv
import io
import json
import time
import uuid
from typing import Any, Optional

from fastapi import UploadFile
from sqlalchemy.orm import Session


# ── Internal helpers ──────────────────────────────────────────────────────────

def _parse_file_to_rows(content: bytes, filename: str) -> dict:
    """Parse uploaded file bytes into {"columns": [...], "rows": [...], "total": N}."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext in ("xlsx", "xls"):
        try:
            import openpyxl  # type: ignore
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            ws = wb.active
            rows_iter = ws.iter_rows(values_only=True)
            header = [str(c) if c is not None else f"col_{i}" for i, c in enumerate(next(rows_iter, []))]
            rows = [dict(zip(header, (str(v) if v is not None else None for v in r))) for r in rows_iter]
            wb.close()
            return {"columns": header, "rows": rows, "total": len(rows)}
        except Exception as exc:
            raise ValueError(f"Could not parse Excel file: {exc}") from exc

    if ext == "csv":
        try:
            text = content.decode("utf-8", errors="replace")
            reader = csv.DictReader(io.StringIO(text))
            rows = [dict(r) for r in reader]
            columns = list(rows[0].keys()) if rows else []
            return {"columns": columns, "rows": rows, "total": len(rows)}
        except Exception as exc:
            raise ValueError(f"Could not parse CSV file: {exc}") from exc

    if ext == "json":
        try:
            data = json.loads(content.decode("utf-8", errors="replace"))
            if isinstance(data, list):
                items = data
            elif isinstance(data, dict):
                # unwrap first list value
                items = next((v for v in data.values() if isinstance(v, list)), [data])
            else:
                raise ValueError("JSON root must be a list or object")
            rows = [dict(r) if isinstance(r, dict) else {"value": r} for r in items]
            columns = list(rows[0].keys()) if rows else []
            return {"columns": columns, "rows": rows, "total": len(rows)}
        except Exception as exc:
            raise ValueError(f"Could not parse JSON file: {exc}") from exc

    if ext == "xml":
        try:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(content.decode("utf-8", errors="replace"))
            # Find the most repeated child tag
            from collections import Counter
            tag_counts = Counter(child.tag for child in root)
            if not tag_counts:
                # one level deeper
                for sub in root:
                    tag_counts.update(child.tag for child in sub)
            if not tag_counts:
                raise ValueError("No repeated XML elements found to extract rows from")
            record_tag = tag_counts.most_common(1)[0][0]
            # collect all elements with that tag anywhere in the tree
            elements = root.findall(f".//{record_tag}")
            if not elements:
                elements = list(root)
            rows = []
            for el in elements:
                row: dict[str, Any] = dict(el.attrib)
                for child in el:
                    row[child.tag] = child.text
                if el.text and el.text.strip():
                    row["_text"] = el.text.strip()
                rows.append(row)
            columns = list(dict.fromkeys(k for r in rows for k in r))
            return {"columns": columns, "rows": rows, "total": len(rows)}
        except Exception as exc:
            raise ValueError(f"Could not parse XML file: {exc}") from exc

    raise ValueError(f"Unsupported file type: .{ext}. Supported: xlsx, xls, csv, json, xml")


def _compute_stats(columns: list[str], rows: list[dict]) -> dict[str, dict]:
    """Compute per-column null rate + numeric min/max/mean (server-side only)."""
    total = len(rows)
    if total == 0:
        return {}
    stats: dict[str, dict] = {}
    for col in columns:
        vals = [r.get(col) for r in rows]
        non_null = [v for v in vals if v not in (None, "", "None", "NULL")]
        null_rate = round(1 - len(non_null) / total, 3)
        col_stat: dict[str, Any] = {"null_rate": null_rate}

        # try numeric
        numeric: list[float] = []
        for v in non_null[:10_000]:
            try:
                numeric.append(float(str(v).replace(",", "")))
            except (ValueError, TypeError):
                pass
        if len(numeric) >= len(non_null) * 0.5 and numeric:
            col_stat["min"] = round(min(numeric), 4)
            col_stat["max"] = round(max(numeric), 4)
            col_stat["mean"] = round(sum(numeric) / len(numeric), 4)

        # top-5 distinct values for categorical (non-numeric, low cardinality)
        if "min" not in col_stat and non_null:
            from collections import Counter
            top = Counter(str(v) for v in non_null[:5_000]).most_common(5)
            col_stat["top_values"] = [v for v, _ in top]

        stats[col] = col_stat
    return stats


def _build_prompt(datasets: list[dict], stats_per_dataset: dict, user_instructions: str) -> str:
    lines: list[str] = []

    # User instructions go FIRST so the AI sees them before the data
    if user_instructions and user_instructions.strip():
        lines.append("=== USER COMPARISON INSTRUCTIONS (MUST BE ADDRESSED) ===")
        lines.append(user_instructions.strip()[:500])
        lines.append("You MUST produce checks that directly address the above instructions.")
        lines.append("")
    else:
        lines.append("=== COMPARISON FOCUS ===")
        lines.append("No specific instructions provided. Determine the most meaningful comparisons from the data.")
        lines.append("")

    lines.append("=== DATASETS ===")
    for ds in datasets:
        idx = ds["slot_index"]
        label = ds["label"]
        lines.append(f"--- Dataset {idx + 1}: \"{label}\" ---")
        lines.append(f"Source: {ds['source_type'].upper()}")
        lines.append(f"Rows: {ds['row_count']}  |  Columns: {ds['column_count']}")
        lines.append(f"Column names: {', '.join(ds['columns'])}")

        st = stats_per_dataset.get(idx, {})
        stat_lines = []
        for col, s in list(st.items())[:20]:
            parts = [f"null_rate={s['null_rate']}"]
            if "min" in s:
                parts.append(f"min={s['min']} max={s['max']} mean={s['mean']}")
            elif "top_values" in s:
                parts.append(f"top_values={s['top_values']}")
            stat_lines.append(f"  {col}: {', '.join(parts)}")
        if stat_lines:
            lines.append("Column stats:\n" + "\n".join(stat_lines))

        sample = ds["sample_rows"]
        if sample:
            lines.append("Sample rows (first 5):")
            lines.append(json.dumps(sample, default=str, indent=2)[:2000])
        lines.append("")

    return "\n".join(lines)


_SYSTEM_PROMPT = """\
You are a data quality and comparison expert. You receive metadata, statistics, and sample rows \
from 2-4 datasets and produce a structured JSON comparison report.

CRITICAL RULE: If the user has provided specific comparison instructions, those instructions are \
your PRIMARY objective. Every check you produce must either directly address the user instructions \
or be clearly labelled as supplementary. Do NOT ignore or bury user instructions.

Return ONLY a valid JSON object with exactly this structure (no markdown, no explanation):
{
  "checks_performed": ["check name 1", "check name 2", ...],
  "checks": [
    {
      "check_name": "descriptive name",
      "status": "PASS" | "WARN" | "FAIL" | "INFO",
      "detail": "specific finding with numbers/values",
      "datasets_involved": [0, 1]
    }
  ],
  "overall_verdict": "PASS" | "WARN" | "FAIL",
  "verdict_summary": "One concise sentence summarizing the overall result.",
  "ai_narrative": "2-4 paragraphs covering: how user instructions were addressed, schema compatibility, \
data volume differences, value distribution comparisons, key anomalies, and recommendations."
}

Standard dimensions to cover (after user instructions):
1. Schema compatibility — shared vs unique columns, naming mismatches
2. Row count differences — flag significant discrepancies
3. NULL/missing rates per column across datasets
4. Numeric column ranges — flag where min/max/mean diverge significantly
5. Categorical distribution — top values present in one dataset but absent in another

Use 0-based dataset indices in "datasets_involved".\
"""


# ── Public entry point ────────────────────────────────────────────────────────

async def run_multi_compare(
    slot_dicts: list[dict],
    file_map: dict[int, Optional[UploadFile]],
    user_instructions: str,
    db: Session,
) -> dict:
    from api.models import SourceConnection, AITraceLog
    from api.services.connector import fetch_all_data
    from api.routers.reconciliation import _to_cfg

    t0 = time.monotonic()

    # ── 1. Validate slots ──────────────────────────────────────────────────────
    filled: list[dict] = []
    for s in slot_dicts:
        st = s.get("source_type")
        if st == "db" and s.get("conn_id") and s.get("sql", "").strip():
            filled.append(s)
        elif st == "file" and file_map.get(s.get("slot_index")) is not None:
            filled.append(s)

    if len(filled) < 2:
        raise ValueError("At least 2 filled data source slots are required.")
    if len(filled) > 4:
        raise ValueError("Maximum 4 data source slots are supported.")

    # ── 2. Fetch/parse each dataset ───────────────────────────────────────────
    all_data: dict[int, dict] = {}
    for s in filled:
        idx = s["slot_index"]
        st = s["source_type"]

        if st == "db":
            conn_row = db.query(SourceConnection).filter_by(id=s["conn_id"], is_active=True).first()
            if not conn_row:
                raise ValueError(f"Connection {s['conn_id']} not found or inactive.")
            cfg = _to_cfg(conn_row)
            cfg["query"] = s["sql"].strip()
            try:
                data = fetch_all_data(cfg)
            except RuntimeError as exc:
                raise ValueError(f"Dataset {idx + 1} query failed: {exc}") from exc

        else:  # file
            upload: UploadFile = file_map[idx]
            content = await upload.read()
            if len(content) > 10_000_000:
                raise ValueError(f"Dataset {idx + 1} file exceeds 10 MB limit.")
            data = _parse_file_to_rows(content, upload.filename or f"file_{idx}")

        all_data[idx] = data

    # ── 3. Build dataset summaries + stats ────────────────────────────────────
    dataset_summaries: list[dict] = []
    stats_per_dataset: dict[int, dict] = {}

    for s in filled:
        idx = s["slot_index"]
        data = all_data[idx]
        columns = data.get("columns", [])
        rows = data.get("rows", [])
        total = data.get("total", len(rows))
        label = (s.get("label") or "").strip() or f"Dataset {idx + 1}"
        upload_ref = file_map.get(idx)

        summary = {
            "slot_index":   idx,
            "label":        label,
            "source_type":  s["source_type"],
            "row_count":    total,
            "column_count": len(columns),
            "columns":      columns,
            "sample_rows":  rows[:5],
            "file_name":    upload_ref.filename if upload_ref else None,
        }
        dataset_summaries.append(summary)
        stats_per_dataset[idx] = _compute_stats(columns, rows)

    # ── 4. Build AI prompt ────────────────────────────────────────────────────
    prompt_user = _build_prompt(dataset_summaries, stats_per_dataset, user_instructions)

    # ── 5. Call OpenAI ────────────────────────────────────────────────────────
    raw_response = ""
    parsed: dict = {}
    tokens_in = 0
    tokens_out = 0

    # Resolve system prompt: DB template override first, hardcoded constant as fallback
    system_prompt = _SYSTEM_PROMPT
    try:
        from api.models import PromptTemplate as _PT
        _tmpl = (
            db.query(_PT)
            .filter(_PT.category == "multi_compare", _PT.is_active == True)  # noqa: E712
            .first()
        )
        if _tmpl and _tmpl.content and _tmpl.content.strip():
            system_prompt = _tmpl.content.strip()
    except Exception:
        pass

    try:
        from api.config import settings
        from openai import OpenAI
        if not settings.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY not configured.")
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": prompt_user},
            ],
            temperature=0.2,
            max_tokens=2000,
        )
        raw_response = resp.choices[0].message.content or ""
        tokens_in  = resp.usage.prompt_tokens     if resp.usage else 0
        tokens_out = resp.usage.completion_tokens if resp.usage else 0
        # strip markdown fences if present
        clean = raw_response.strip()
        if clean.startswith("```"):
            clean = clean.split("```", 2)[1]
            if clean.startswith("json"):
                clean = clean[4:]
            clean = clean.rsplit("```", 1)[0]
        parsed = json.loads(clean)
    except json.JSONDecodeError:
        parsed = {
            "checks_performed": ["AI parse error"],
            "checks": [],
            "overall_verdict": "WARN",
            "verdict_summary": "AI response could not be parsed as JSON.",
            "ai_narrative": raw_response or "No response from AI.",
        }
    except Exception as exc:
        parsed = {
            "checks_performed": ["AI unavailable"],
            "checks": [],
            "overall_verdict": "WARN",
            "verdict_summary": f"AI analysis unavailable: {exc}",
            "ai_narrative": str(exc),
        }

    # ── 6. Log trace ──────────────────────────────────────────────────────────
    elapsed_ms = round((time.monotonic() - t0) * 1000)
    try:
        # include which datasets were compared as schema_snapshot for the trace panel
        dataset_labels = [f"{d['label']} ({d['row_count']} rows)" for d in dataset_summaries]
        db.add(AITraceLog(
            module="multi_compare",
            conn_id=None,
            model="gpt-4o-mini",
            prompt_text=(system_prompt[:500] + "\n---\n" + prompt_user)[:4000],
            response_text=raw_response[:4000],
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=elapsed_ms,
            schema_snapshot=json.dumps(dataset_labels),
        ))
        db.commit()
    except Exception:
        pass  # logging failure must not break the response

    # ── 7. Return result ──────────────────────────────────────────────────────
    return {
        "run_id":            str(uuid.uuid4()),
        "datasets":          dataset_summaries,
        "checks_performed":  parsed.get("checks_performed", []),
        "checks":            parsed.get("checks", []),
        "overall_verdict":   parsed.get("overall_verdict", "WARN"),
        "verdict_summary":   parsed.get("verdict_summary", ""),
        "ai_narrative":      parsed.get("ai_narrative", ""),
        "user_instructions": user_instructions or None,
        "elapsed_ms":        elapsed_ms,
        "tokens_in":         tokens_in,
        "tokens_out":        tokens_out,
        "prompt_text":       prompt_user,
    }
