"""
rca_agent.py — Cross-system analysis, anomaly detection, root cause analysis.
Calls SAI Knowledge Engine for RAG context and historical incidents.
"""
import json
import time
from typing import Optional
from sqlalchemy.orm import Session

from api.services.knowledge_processor import semantic_search, ask_sai
from api.config import settings

_ANOMALY_THRESHOLD_NULL_RATE = 0.10  # > 10% null rate is anomalous


def _detect_anomalies(datasets: list[dict]) -> list[dict]:
    anomalies = []
    for ds in datasets:
        stats = ds.get("stats", {})
        for col, stat in stats.items():
            null_rate = stat.get("null_rate", 0)
            if null_rate > _ANOMALY_THRESHOLD_NULL_RATE:
                anomalies.append({
                    "conn_id":   ds.get("conn_id"),
                    "label":     ds.get("label"),
                    "column":    col,
                    "type":      "high_null_rate",
                    "value":     null_rate,
                    "threshold": _ANOMALY_THRESHOLD_NULL_RATE,
                    "detail":    f"Null rate {null_rate:.1%} exceeds threshold {_ANOMALY_THRESHOLD_NULL_RATE:.0%}",
                })
    return anomalies


async def run(
    schema_context: dict,
    collection_context: dict,
    request_text: str,
    db: Session,
) -> dict:
    t0 = time.time()
    knowledge_sources = collection_context.get("knowledge_sources", [])
    datasets = collection_context.get("datasets", [])

    # 1 — Detect anomalies from collected stats
    anomalies = _detect_anomalies(datasets)

    # 2 — Query Knowledge Engine for historical incidents matching this signature
    anomaly_summary = "; ".join(a["detail"] for a in anomalies[:3]) if anomalies else "No anomalies detected"
    historical_query = f"Historical incidents related to: {request_text}. Anomalies: {anomaly_summary}"

    try:
        hist = ask_sai(question=historical_query, db=db)
        if hist.get("status") == "ANSWERED":
            knowledge_sources.append({
                "entry_id":   None,
                "title":      "Historical Incident Match",
                "confidence": 0.75,
                "answer":     hist.get("answer", "")[:500],
            })
        for src in hist.get("sources", []):
            if not any(s.get("entry_id") == src.get("entry_id") for s in knowledge_sources):
                knowledge_sources.append({
                    "entry_id":   src.get("entry_id"),
                    "title":      src.get("title"),
                    "confidence": src.get("score"),
                })
    except Exception:
        pass

    # 3 — Query KB for domain-specific mapping/DCT knowledge
    domain_query = f"DCT mappings and business rules for: {' '.join(schema_context.get('domains', []))}"
    try:
        mapping_kb_results = semantic_search(query=domain_query, top_k=3, db=db)
        for score, chunk in mapping_kb_results:
            entry_id = chunk.entry_id if hasattr(chunk, "entry_id") else None
            title = chunk.entry.title if hasattr(chunk, "entry") and chunk.entry else chunk.topic or domain_query
            if not any(s.get("entry_id") == entry_id for s in knowledge_sources):
                knowledge_sources.append({
                    "entry_id":   entry_id,
                    "title":      title,
                    "confidence": round(float(score), 3),
                })
    except Exception:
        pass

    # 4 — Build preliminary checks
    checks = []
    for a in anomalies:
        checks.append({
            "check_name": f"Null rate anomaly: {a['label']}.{a['column']}",
            "status":     "FAIL",
            "detail":     a["detail"],
            "datasets_involved": [a.get("conn_id")],
        })

    for ds in datasets:
        if ds.get("error"):
            checks.append({
                "check_name": f"Data collection failed: {ds.get('label')}",
                "status":     "ERROR",
                "detail":     ds["error"],
                "datasets_involved": [ds.get("conn_id")],
            })

    if not checks:
        checks.append({
            "check_name": "Data quality scan",
            "status":     "PASS",
            "detail":     "No anomalies detected in collected datasets",
            "datasets_involved": [],
        })

    return {
        "anomalies":         anomalies,
        "checks":            checks,
        "knowledge_sources": knowledge_sources,
        "elapsed_ms":        int((time.time() - t0) * 1000),
    }
