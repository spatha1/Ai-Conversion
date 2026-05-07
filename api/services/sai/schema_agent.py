"""
schema_agent.py — Resolves operator intent into domain entities, tables, FK graph.
Calls the SAI Knowledge Engine (knowledge_processor) for intelligence.
Never duplicates RAG or schema logic — only orchestrates.
"""
import json
import time
from typing import Optional
from sqlalchemy.orm import Session

from api.services.knowledge_processor import semantic_search
from api.models import CatalogColumn, CatalogRelation, SourceConnection

_DOMAIN_HINTS = {
    "b&c":      ["Benefits", "Claims", "Billing", "Collections"],
    "benefits": ["Benefits"],
    "claims":   ["Claims", "Claim", "ClaimAmount", "ClaimStatus"],
    "billing":  ["Billing", "BillingType", "Invoice", "Payment"],
    "policy":   ["Policy", "PolicyNumber", "PremiumAmount"],
    "premium":  ["PremiumAmount", "Premium"],
}


def _detect_domains(request_text: str) -> list[str]:
    lower = request_text.lower()
    found = []
    for key, labels in _DOMAIN_HINTS.items():
        if key in lower:
            found.extend(labels)
    return list(dict.fromkeys(found)) or ["General"]


async def run(
    request_text: str,
    project_id: Optional[int],
    conn_ids: Optional[list[int]],
    db: Session,
) -> dict:
    t0 = time.time()
    knowledge_sources = []

    # 1 — Detect domain from request text
    domains = _detect_domains(request_text)

    # 2 — Query Knowledge Engine for mapping/schema context
    kb_query = f"Schema and tables related to: {request_text}"
    try:
        kb_results = semantic_search(query=kb_query, top_k=5, db=db)
        for score, chunk in kb_results:
            knowledge_sources.append({
                "entry_id":   chunk.entry_id if hasattr(chunk, "entry_id") else None,
                "title":      chunk.entry.title if hasattr(chunk, "entry") and chunk.entry else chunk.topic or kb_query,
                "confidence": round(float(score), 3),
            })
    except Exception:
        pass

    # 3 — Resolve connections
    if conn_ids:
        connections = db.query(SourceConnection).filter(
            SourceConnection.id.in_(conn_ids),
            SourceConnection.is_active == True,
        ).all()
    elif project_id:
        connections = db.query(SourceConnection).filter(
            SourceConnection.project_id == project_id,
            SourceConnection.is_active == True,
        ).all()
    else:
        connections = db.query(SourceConnection).filter(
            SourceConnection.is_active == True,
        ).limit(4).all()

    resolved_conn_ids = [c.id for c in connections]

    # 4 — Collect relevant tables from catalog
    relevant_tables = []
    if resolved_conn_ids:
        cols = db.query(CatalogColumn).filter(
            CatalogColumn.conn_id.in_(resolved_conn_ids)
        ).all()
        seen = set()
        for c in cols:
            key = (c.conn_id, c.table_name)
            if key not in seen:
                seen.add(key)
                relevant_tables.append({"conn_id": c.conn_id, "table": c.table_name})

    return {
        "domains":          domains,
        "connections":      [{"id": c.id, "name": c.name} for c in connections],
        "conn_ids":         resolved_conn_ids,
        "relevant_tables":  relevant_tables,
        "knowledge_sources": knowledge_sources,
        "elapsed_ms":       int((time.time() - t0) * 1000),
    }
