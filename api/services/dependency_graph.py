"""
api/services/dependency_graph.py
Phase 3.1 — Dependency Graph Engine for operational rule entries.

Uses an adjacency list (conversion_op_dependency_edges) resolved from
KnowledgeEntry.depends_on JSON arrays at ingestion time.
Graph traversal is BFS over the ORM — no recursive CTEs needed at this scale.
"""
from __future__ import annotations

import json
from collections import deque
from typing import Optional

from sqlalchemy.orm import Session


# ── Edge resolution ───────────────────────────────────────────────────────────

def resolve_edges(entry_id: int, db: Session) -> None:
    """
    After saving / updating a rule entry, parse its depends_on JSON array,
    look up target titles and insert / update OpDependencyEdge rows.
    Existing edges for this source are deleted first (clean re-resolve).
    """
    from api.models import KnowledgeEntry, OpDependencyEdge

    entry = db.query(KnowledgeEntry).filter_by(id=entry_id).first()
    if not entry or not getattr(entry, "depends_on", None):
        # No depends_on — remove any stale edges
        db.query(OpDependencyEdge).filter_by(source_entry_id=entry_id).delete()
        db.commit()
        return

    try:
        dep_titles: list[str] = json.loads(entry.depends_on)
    except Exception:
        return

    if not isinstance(dep_titles, list):
        return

    # Remove old edges
    db.query(OpDependencyEdge).filter_by(source_entry_id=entry_id).delete()

    for title in dep_titles:
        title = str(title).strip()
        if not title:
            continue
        # Attempt to resolve title → entry ID
        target = db.query(KnowledgeEntry).filter(
            KnowledgeEntry.title == title
        ).first()
        db.add(OpDependencyEdge(
            source_entry_id=entry_id,
            target_title=title,
            target_entry_id=target.id if target else None,
            edge_type="requires",
        ))

    db.commit()


# ── BFS traversal helpers ─────────────────────────────────────────────────────

def get_upstream(entry_id: int, db: Session, max_depth: int = 5) -> list[dict]:
    """
    Return all rules this entry depends on (direct + transitive), BFS.
    Each item: { id, title, op_category, severity, edge_type, depth }
    """
    from api.models import OpDependencyEdge, KnowledgeEntry

    visited: set[int] = {entry_id}
    queue: deque[tuple[int, int]] = deque([(entry_id, 0)])
    result: list[dict] = []

    while queue:
        current_id, depth = queue.popleft()
        if depth >= max_depth:
            continue

        edges = db.query(OpDependencyEdge).filter_by(source_entry_id=current_id).all()
        for edge in edges:
            if edge.target_entry_id and edge.target_entry_id not in visited:
                visited.add(edge.target_entry_id)
                target = db.query(KnowledgeEntry).filter_by(id=edge.target_entry_id).first()
                if target:
                    result.append({
                        "id":          target.id,
                        "title":       target.title,
                        "op_category": target.op_category,
                        "severity":    target.severity,
                        "edge_type":   edge.edge_type,
                        "depth":       depth + 1,
                    })
                    queue.append((target.id, depth + 1))
            elif not edge.target_entry_id:
                # Unresolved title — surface as dangling reference
                result.append({
                    "id":          None,
                    "title":       edge.target_title,
                    "op_category": None,
                    "severity":    None,
                    "edge_type":   edge.edge_type,
                    "depth":       depth + 1,
                    "unresolved":  True,
                })

    return result


def get_downstream(entry_id: int, db: Session, max_depth: int = 5) -> list[dict]:
    """
    Return all rules that depend on this entry (impact surface), BFS.
    Each item: { id, title, op_category, severity, edge_type, depth }
    """
    from api.models import OpDependencyEdge, KnowledgeEntry

    visited: set[int] = {entry_id}
    queue: deque[tuple[int, int]] = deque([(entry_id, 0)])
    result: list[dict] = []

    while queue:
        current_id, depth = queue.popleft()
        if depth >= max_depth:
            continue

        # Find all edges where current_id is the TARGET
        edges = db.query(OpDependencyEdge).filter_by(target_entry_id=current_id).all()
        for edge in edges:
            src_id = edge.source_entry_id
            if src_id not in visited:
                visited.add(src_id)
                source = db.query(KnowledgeEntry).filter_by(id=src_id).first()
                if source:
                    result.append({
                        "id":          source.id,
                        "title":       source.title,
                        "op_category": source.op_category,
                        "severity":    source.severity,
                        "edge_type":   edge.edge_type,
                        "depth":       depth + 1,
                    })
                    queue.append((src_id, depth + 1))

    return result


# ── Cycle detection ───────────────────────────────────────────────────────────

def check_cycles(entry_id: int, db: Session) -> bool:
    """
    Return True if the entry (after its edges are resolved) participates in a cycle.
    Uses DFS with a recursion-stack colour set.
    """
    from api.models import OpDependencyEdge

    def _neighbors(eid: int) -> list[int]:
        edges = db.query(OpDependencyEdge).filter_by(source_entry_id=eid).all()
        return [e.target_entry_id for e in edges if e.target_entry_id]

    visited: set[int] = set()
    rec_stack: set[int] = set()

    def _dfs(node: int) -> bool:
        visited.add(node)
        rec_stack.add(node)
        for nb in _neighbors(node):
            if nb not in visited:
                if _dfs(nb):
                    return True
            elif nb in rec_stack:
                return True
        rec_stack.discard(node)
        return False

    return _dfs(entry_id)


# ── Impact scoring ────────────────────────────────────────────────────────────

_SEV_WEIGHT = {"CRITICAL": 1.0, "HIGH": 0.75, "MEDIUM": 0.5, "LOW": 0.25}
_SCOPE_WEIGHT = {"system": 1.0, "monthly_cycle": 0.85, "batch": 0.6, "policy": 0.3}


def impact_score(entry_id: int, db: Session) -> float:
    """
    Score 0–1 based on severity, downstream rule count, and execution scope.
    Formula:
      score = base_severity × (1 + downstream_count × 0.1) × scope_weight
    Clamped to [0, 1].
    """
    from api.models import KnowledgeEntry

    entry = db.query(KnowledgeEntry).filter_by(id=entry_id).first()
    if not entry:
        return 0.0

    base = _SEV_WEIGHT.get((entry.severity or "").upper(), 0.5)
    scope = _SCOPE_WEIGHT.get((getattr(entry, "execution_scope", None) or "").lower(), 0.5)
    downstream = get_downstream(entry_id, db, max_depth=5)
    count = len(downstream)

    raw = base * (1 + count * 0.1) * scope
    return round(min(1.0, raw), 4)


# ── Bulk edge refresh ─────────────────────────────────────────────────────────

def refresh_all_edges(db: Session) -> int:
    """
    Re-resolve all edges for every rule entry that has a depends_on value.
    Returns count of entries processed.
    """
    from api.models import KnowledgeEntry

    _RULE_TYPES = {
        "OperationalRule", "ValidationRule", "ProcessingRule", "FailureRule",
        "RecoveryRule", "ReconciliationRule", "OwnershipRule", "StopCondition", "ExceptionRule",
    }
    entries = db.query(KnowledgeEntry).filter(
        KnowledgeEntry.depends_on.isnot(None)
    ).all()
    count = 0
    for entry in entries:
        if entry.type in _RULE_TYPES or entry.op_category in _RULE_TYPES:
            resolve_edges(entry.id, db)
            count += 1
    return count
