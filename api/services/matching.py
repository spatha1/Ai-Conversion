"""
matching.py — Shared embedding + name matching service.

Extracted from mapping_ai.py so MapperAgent can import without circular dependency.
"""
from __future__ import annotations

import json
import re as _re
from collections import Counter
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from api.config import settings
from api.models import (
    XmlTemplate, TargetFormulaRule, ColumnEmbedding,
    SourceConnection, CatalogColumn, CatalogRelation, QueryContext,
)
from api.services.embeddings import cosine_similarity


def _extract_paths(xml_content: str) -> list[str]:
    """Walk an XML tree and return leaf text paths + attribute paths."""
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as exc:
        raise ValueError(f"XML parse error: {exc}") from exc
    seen = {}

    def walk(node, path):
        tag  = node.tag.split("}")[-1] if "}" in node.tag else node.tag
        path = f"{path}/{tag}"
        kids = list(node)
        for attr_name in node.attrib:
            if attr_name != "each":
                seen[f"{path}/@{attr_name}"] = True
        if not kids:
            seen[path] = True
        else:
            for child in kids:
                walk(child, path)

    walk(root, "")
    return list(seen.keys())


def _extract_paths_json(content: str) -> list[str]:
    """Walk a JSON structure and return leaf paths in $.Key.Nested notation."""
    def walk(obj, prefix: str, results: list):
        if isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, f"{prefix}.{k}", results)
        elif isinstance(obj, list):
            sample = obj[0] if obj else None
            walk(sample, f"{prefix}[*]", results)
        else:
            results.append(prefix)

    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON parse error: {exc}") from exc

    raw: list[str] = []
    walk(data, "$", raw)
    seen_set: set[str] = set()
    unique: list[str] = []
    for p in raw:
        if p not in seen_set:
            seen_set.add(p)
            unique.append(p)
    return unique


def _extract_paths_text(content: str) -> list[str]:
    """Extract unique {Placeholder} tokens from text or SQL templates."""
    seen_set: set[str] = set()
    unique: list[str] = []
    for name in _re.findall(r'\{([^}]+)\}', content):
        if name not in seen_set:
            seen_set.add(name)
            unique.append(name)
    return unique


def _extract_paths_for_format(content: str, format_type: str) -> list[str]:
    """Dispatch to the correct path extractor based on format_type."""
    if format_type == "json":
        return _extract_paths_json(content)
    if format_type in ("text", "sql"):
        return _extract_paths_text(content)
    return _extract_paths(content)


def _parse_identifier_hint(hints: list[str]) -> tuple[str | None, str | None]:
    """
    Scan user hints for an identifier override like:
      "use PolicyId from policy as an identifier"
      "PolicyId from POLICY as identifier"
      "set identifier to PolicyId"
      "identifier should be PolicyNumber"
    Returns (column_name, table_name) — table_name may be None.
    """
    patterns = [
        # "use <col> from <tbl> as [the/a/an] identifier"
        _re.compile(
            r'use\s+(\w+)\s+from\s+(\w+)\s+as\s+(?:the\s+|a\s+|an\s+)?identifier', _re.IGNORECASE),
        # "<col> from <tbl> as [the/a/an] identifier"
        _re.compile(
            r'(\w+)\s+from\s+(\w+)\s+as\s+(?:the\s+|a\s+|an\s+)?identifier', _re.IGNORECASE),
        # "use <col> as [the/a/an] identifier"
        _re.compile(
            r'use\s+(\w+)\s+as\s+(?:the\s+|a\s+|an\s+)?identifier', _re.IGNORECASE),
        # "<col> as [the/a/an] identifier"
        _re.compile(
            r'(\w+)\s+as\s+(?:the\s+|a\s+|an\s+)?identifier', _re.IGNORECASE),
        # "identifier.*should be|use|is|=|: <col>"
        _re.compile(
            r'identifier.*?(?:should\s+be|should\s+use|is|=|:)\s+(\w+)', _re.IGNORECASE),
        # "set identifier to <col>"
        _re.compile(
            r'set\s+identifier\s+to\s+(\w+)', _re.IGNORECASE),
    ]
    for hint in hints:
        for pat in patterns:
            m = pat.search(hint)
            if m:
                groups = m.groups()
                col = groups[0]
                tbl = groups[1] if len(groups) > 1 else None
                return col, tbl
    return None, None


def run_matching(conn_id: int, db: Session, hints: list[str] | None = None) -> dict:
    """
    Load XML template paths + column embeddings, run cosine + name matching.
    Returns a dict with everything needed to build SQL or mapping rows.
    Raises HTTPException on failure.

    This is the extracted version of _run_matching() from mapping_ai.py.
    Both mapping_ai.py and MapperAgent import from here.
    """
    # Load XML template
    tpl = (db.query(XmlTemplate)
             .filter_by(conn_id=conn_id)
             .order_by(XmlTemplate.id.desc())
             .first())
    if not tpl or not tpl.content:
        raise HTTPException(404, "No template found for this connection. Upload one in the Target tab first.")
    fmt = tpl.format_type or "xml"
    paths = _extract_paths_for_format(tpl.content, fmt)
    if not paths:
        raise HTTPException(422, "No mappable paths found in the template.")

    # Formula rules (default values per path)
    rules = db.query(TargetFormulaRule).filter_by(conn_id=conn_id).all()
    default_map = {r.target_path: r.default_value for r in rules if r.default_value}

    # Column embeddings
    embeddings = db.query(ColumnEmbedding).filter_by(conn_id=conn_id).all()
    if not embeddings:
        raise HTTPException(422,
            "No embeddings found. Go to Admin → select connection → Generate Embeddings first.")

    emb_data = []
    for e in embeddings:
        if not e.embedding_json:
            continue
        try:
            vec = json.loads(e.embedding_json)
        except Exception:
            continue
        # Include is_primary_key from CatalogColumn for join scoring
        pk_col = (db.query(CatalogColumn)
                    .filter_by(conn_id=conn_id, table_name=e.table_name,
                               column_name=e.column_name)
                    .first())
        emb_data.append({
            "table_schema": e.table_schema or "dbo",
            "table_name":   e.table_name,
            "column_name":  e.column_name,
            "definition":   e.column_definition or "",
            "vector":       vec,
            "is_primary_key": bool(pk_col and pk_col.is_primary_key),
        })
    if not emb_data:
        raise HTTPException(422, "Embeddings exist but contain no vectors. Re-run Generate Embeddings.")

    # Connection + dialect
    src = db.query(SourceConnection).get(conn_id)
    dialect = "snowflake" if (src and src.source_type == "snowflake") else (
        (src.dialect or "mssql").lower() if src else "mssql"
    )

    # OpenAI embeddings for XML paths
    api_key = settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(400, "OPENAI_API_KEY not set in .env — required for AI mapping.")
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    path_texts = [f"field '{p.split('/')[-1].lstrip('@').split('.')[-1]}' at path: {p}" for p in paths]
    embed_resp = client.embeddings.create(input=path_texts, model="text-embedding-3-small")
    path_vectors = [item.embedding for item in embed_resp.data]

    # Cosine similarity pass
    MIN_THRESHOLD = 0.25
    matched_cols: list[dict | None] = []
    match_scores: list[float]       = []
    for pvec in path_vectors:
        best_col, best_score = None, 0.0
        for col in emb_data:
            s = cosine_similarity(pvec, col["vector"])
            if s > best_score:
                best_score, best_col = s, col
        if best_col and best_score >= MIN_THRESHOLD:
            matched_cols.append(best_col)
            match_scores.append(best_score)
        else:
            matched_cols.append(None)
            match_scores.append(0.0)

    # Name-based pass (overrides embedding if stronger)
    def _norm(s: str) -> str:
        return _re.sub(r'[_\-\s\.@/]+', '', s.lower())

    for i, path in enumerate(paths):
        # Handle XML (/Root/Leaf or /Root/@attr), JSON ($.Foo.Bar or $.Items[*].Name), and plain names
        leaf_raw = path.split("/")[-1].lstrip("@").split(".")[-1].rstrip("]").replace("[*", "")
        leaf = _norm(leaf_raw)
        best_col, best_score = None, 0.0
        for c in emb_data:
            nc = _norm(c["column_name"])
            s = 1.0 if nc == leaf else (0.85 if (nc in leaf or leaf in nc) else 0.0)
            if s > best_score:
                best_score, best_col = s, c
        if best_col and best_score > match_scores[i]:
            matched_cols[i], match_scores[i] = best_col, best_score

    # FK relations from schema catalog (used by JOIN-aware query builder)
    relations = db.query(CatalogRelation).filter_by(conn_id=conn_id).all()

    # Auto-detect identifier (PK) — will be refined by score_join_paths() in query_builder
    table_counts = Counter(
        c["table_name"] for c in matched_cols if c is not None
    )
    main_table = table_counts.most_common(1)[0][0] if table_counts else None
    identifier_column: Optional[str] = None
    identifier_table:  Optional[str] = None

    # Check user hints for an explicit identifier override FIRST
    hint_col, hint_tbl = _parse_identifier_hint(hints or [])
    if hint_col:
        # Normalize: strip underscores/hyphens/spaces and lowercase for fuzzy matching
        # e.g. "policyID" matches "POLICY_ID", "PolicyId" matches "POLICY_ID"
        def _norm_col(s: str) -> str:
            return _re.sub(r'[_\-\s]', '', s).lower()

        norm_hint_col = _norm_col(hint_col)
        norm_hint_tbl = _norm_col(hint_tbl) if hint_tbl else None

        # Load all catalog columns for this connection and fuzzy-match in Python
        all_cols = db.query(CatalogColumn).filter_by(conn_id=conn_id).all()
        best_row = None
        for c in all_cols:
            if _norm_col(c.column_name) != norm_hint_col:
                continue
            if norm_hint_tbl and _norm_col(c.table_name) != norm_hint_tbl:
                continue
            # Prefer the match from the hinted table, or first match found
            if best_row is None or (norm_hint_tbl and _norm_col(c.table_name) == norm_hint_tbl):
                best_row = c
        if best_row:
            identifier_column = best_row.column_name
            identifier_table  = best_row.table_name

    # Fall back to PK auto-detection when no hint resolved
    if not identifier_column and main_table:
        pk = (db.query(CatalogColumn)
                .filter_by(conn_id=conn_id, table_name=main_table, is_primary_key=True)
                .first())
        if not pk:
            pk = db.query(CatalogColumn).filter_by(conn_id=conn_id, is_primary_key=True).first()
        if pk:
            identifier_column = pk.column_name
            identifier_table  = pk.table_name

    return {
        "paths":             paths,
        "matched_cols":      matched_cols,
        "match_scores":      match_scores,
        "emb_data":          emb_data,
        "default_map":       default_map,
        "dialect":           dialect,
        "src":               src,
        "tpl":               tpl,
        "main_table":        main_table,
        "identifier_column": identifier_column,
        "identifier_table":  identifier_table,
        "client":            client,
        "relations":         relations,
        "db":                db,
        "conn_id":           conn_id,
    }
