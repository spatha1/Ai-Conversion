# ═══════════════════════════════════════════════════════════
# routers/mapping_ai.py
#
# AI-powered mapping generation.
#
# Endpoints:
#   POST   /api/mapping/generate-query              — build SQL query only (no mapping rows)
#   POST   /api/mapping/generate-rows               — build mapping rows only (SQL untouched)
#   GET    /api/mapping/{conn_id}                   — load latest mapping rows
#   GET    /api/mapping/{conn_id}/query             — load latest generated SQL
#   POST   /api/mapping/save                        — save mapping rows + optional SQL
#   GET    /api/mapping/{conn_id}/preview           — preview query (TOP 10)
#   GET    /api/mapping/{conn_id}/identifier-values — distinct identifier values from source
#   POST   /api/mapping/{conn_id}/generate-xml      — generate XML for one identifier value
#   DELETE /api/mapping/{conn_id}                   — clear mapping + query
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

import json
import re as _re_global
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from collections import defaultdict
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.config import settings
from api.models import (
    XmlTemplate, TargetFormulaRule, ColumnEmbedding,
    SourceConnection, Mapping, MappingRow, MappingRowTransformation, GeneratedQuery,
    CatalogColumn, GeneratedXml, CatalogRelation, QueryContext, TransformationRule,
)
from api.services.embeddings import cosine_similarity
from api.services.matching import run_matching as _run_matching_shared
from api.services.dialect_utils import (
    normalize_dialect, quote_identifier, escape_alias,
    qualified_name as _qualified_name, column_ref as _col_ref, limit_query,
)

from api.dependencies import require_developer

router = APIRouter(dependencies=[Depends(require_developer)])

_PROMPT_FILE = Path(__file__).parent.parent.parent / "prompts" / "mapping_prompt.md"


def _fetch_context(conn_id: int, db: Session) -> str:
    """Return combined global + connection-specific query context for AI prompts."""
    parts = []
    g = db.query(QueryContext).filter(QueryContext.conn_id == None).first()
    if g and g.content and g.content.strip():
        parts.append(g.content.strip())
    c = db.query(QueryContext).filter(QueryContext.conn_id == conn_id).first()
    if c and c.content and c.content.strip():
        parts.append(c.content.strip())
    return "\n\n".join(parts)


def _load_system_prompt() -> str:
    try:
        if _PROMPT_FILE.exists():
            return _PROMPT_FILE.read_text(encoding="utf-8")
    except Exception:
        pass
    return "You are a SQL expert helping generate data mapping queries."


# ── Pydantic schemas ─────────────────────────────────────────

class GenerateRequest(BaseModel):
    conn_id: int

class TransformationRef(BaseModel):
    rule_id:          int
    rule_name:        str
    category:         str
    execution_order:  int           = 0
    # "ai_discovery" | "user" | "repository_attach"
    discovery_source: str           = "ai_discovery"

class MappingRowOut(BaseModel):
    source_sheet:          Optional[str]             = None
    source_column:         Optional[str]             = None
    formula:               Optional[str]             = None
    target_path:           Optional[str]             = None
    each_sheet:            Optional[str]             = None
    confidence:            int                       = 0
    transform_sql:         Optional[str]             = None   # human-readable rule summary
    rule_confidence_boost: int                       = 0
    transformations:       List[TransformationRef]   = []

class LinkRuleBody(BaseModel):
    rule_id:          int
    execution_order:  int = 0
    discovery_source: str = "user"

class GenerateQueryResult(BaseModel):
    query_sql:         str
    identifier_column: Optional[str] = None
    identifier_table:  Optional[str] = None
    debug:             Optional[dict] = None   # DebugSession.to_response() when debug is on

class GenerateRowsResult(BaseModel):
    mapping_id:        int
    rows:              list[MappingRowOut]
    identifier_column: Optional[str] = None
    identifier_table:  Optional[str] = None

class SaveRequest(BaseModel):
    conn_id:           int
    rows:              list[MappingRowOut]
    query_sql:         Optional[str] = None
    identifier_column: Optional[str] = None
    identifier_table:  Optional[str] = None

class GenerateXmlRequest(BaseModel):
    identifier_value: str


# ── XML path extractor ────────────────────────────────────────

def _extract_paths(xml_content: str) -> list[str]:
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


def _alias(path: str, dialect: str) -> str:
    return escape_alias(path, dialect)


def _clean_sql_for_exec(sql: str, dialect: str, strip_order_by: bool = True) -> str:
    import re as _re
    lines = [ln for ln in sql.split("\n") if not ln.strip().startswith("--")]
    sql = "\n".join(lines).strip()
    if strip_order_by:
        sql = _re.sub(r"\bORDER\s+BY\b[^\n;]*", "", sql, flags=_re.IGNORECASE).strip()
    return sql


# ── Shared: load template + run embedding matching ────────────
# Delegates to api.services.matching to avoid circular dependency with MapperAgent.

def _run_matching(conn_id: int, db: Session) -> dict:
    """
    Load XML template paths + column embeddings, run cosine + name matching.
    Returns a dict with everything needed to build SQL or mapping rows.
    Raises HTTPException on failure.
    Delegates to api.services.matching.run_matching for shared use with MapperAgent.
    """
    return _run_matching_shared(conn_id, db)


def _run_matching_legacy(conn_id: int, db: Session) -> dict:
    """Legacy inline implementation — kept for reference only. Not called."""
    import re as _re
    from api.services.matching import _extract_paths_for_format as _epf

    # Load template
    tpl = (db.query(XmlTemplate)
             .filter_by(conn_id=conn_id)
             .order_by(XmlTemplate.id.desc())
             .first())
    if not tpl or not tpl.content:
        raise HTTPException(404, "No template found for this connection. Upload one in the Target tab first.")
    fmt = tpl.format_type or "xml"
    paths = _epf(tpl.content, fmt)
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
        emb_data.append({
            "table_schema": e.table_schema or "dbo",
            "table_name":   e.table_name,
            "column_name":  e.column_name,
            "definition":   e.column_definition or "",
            "vector":       vec,
        })
    if not emb_data:
        raise HTTPException(422, "Embeddings exist but contain no vectors. Re-run Generate Embeddings.")

    # Connection + dialect
    src = db.query(SourceConnection).get(conn_id)
    dialect = normalize_dialect(src.dialect if src else None, src.source_type if src else None)

    # OpenAI embeddings for XML paths
    api_key = settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(400, "OPENAI_API_KEY not set in .env — required for AI mapping.")
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    path_texts = [f"XML field '{p.split('/')[-1].lstrip('@')}' at path: {p}" for p in paths]
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
        leaf = _norm(path.split("/")[-1].lstrip("@"))
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

    # Auto-detect identifier (PK)
    table_counts = Counter(
        c["table_name"] for c in matched_cols if c is not None
    )
    main_table = table_counts.most_common(1)[0][0] if table_counts else None
    identifier_column: Optional[str] = None
    identifier_table:  Optional[str] = None
    if main_table:
        pk = (db.query(CatalogColumn)
                .filter_by(conn_id=conn_id, table_name=main_table, is_primary_key=True)
                .first())
        if not pk:
            pk = db.query(CatalogColumn).filter_by(conn_id=conn_id, is_primary_key=True).first()
        if pk:
            identifier_column = pk.column_name
            identifier_table  = pk.table_name

    return {
        "paths":          paths,
        "matched_cols":   matched_cols,
        "match_scores":   match_scores,
        "emb_data":       emb_data,
        "default_map":    default_map,
        "dialect":        dialect,
        "src":            src,
        "tpl":            tpl,
        "main_table":     main_table,
        "identifier_column": identifier_column,
        "identifier_table":  identifier_table,
        "client":         client,
        "relations":      relations,   # CatalogRelation list for JOIN-aware builder
        "db":             db,          # passed to query_skill for live schema enrichment
        "conn_id":        conn_id,
    }


# ── Build SQL from match results ──────────────────────────────

def _build_sql(m: dict, session=None) -> tuple[str, list[dict]]:
    """
    Build SELECT SQL and row_data list from _run_matching result dict.
    Uses the JOIN-aware query_builder when FK relations exist in the catalog;
    falls back to the flat embedding-only approach otherwise.
    session: Optional[DebugSession] — if provided, debug steps are appended.
    """
    # ── JOIN-aware path (Steps 4+5): uses FK graph from catalog ──
    if m.get("relations"):
        from api.services.query_builder import build_join_query
        sql, row_data, _join_tuples = build_join_query(m)
        if sql:
            if session is not None:
                session.add_step(
                    step="context_assembly",
                    label="Context Assembly (JOIN-aware)",
                    input_data={"conn_id": m.get("conn_id"), "path_count": len(m.get("paths", []))},
                    output_data={
                        "matched_cols": len([c for c in m.get("matched_cols", []) if c]),
                        "relations_used": len(m.get("relations", [])),
                        "identifier_column": m.get("identifier_column"),
                        "sql_preview": sql[:300],
                    },
                )
            return sql, row_data
        # query_builder returned nothing — fall through to flat builder
    # ── Flat fallback (no FK relations in catalog) ────────────
    paths        = m["paths"]
    matched_cols = m["matched_cols"]
    match_scores = m["match_scores"]
    emb_data     = m["emb_data"]
    default_map  = m["default_map"]
    dialect      = m["dialect"]
    main_table   = m["main_table"]
    identifier_column = m["identifier_column"]
    identifier_table  = m["identifier_table"]

    select_parts: list[str] = []
    row_data:     list[dict] = []

    for path, col, score in zip(paths, matched_cols, match_scores):
        al = _alias(path, dialect)
        if col:
            col_ref = _col_ref(
                quote_identifier(col["table_name"], dialect),
                col["column_name"], dialect,
            )
            select_parts.append(f"{col_ref} AS {al}")
            row_data.append({
                "source_sheet":  col["table_name"],
                "source_column": col["column_name"],
                "formula":       f"{{{col['column_name']}}}",
                "target_path":   path,
                "each_sheet":    "",
                "confidence":    round(score * 100),
            })
        elif path in default_map and default_map[path]:
            dv = default_map[path].replace("'", "''")
            select_parts.append(f"'{dv}' AS {al}")
            row_data.append({
                "source_sheet":  "",
                "source_column": "",
                "formula":       f'"{default_map[path]}"',
                "target_path":   path,
                "each_sheet":    "",
                "confidence":    0,
            })
        else:
            select_parts.append(f"NULL AS {al}")
            row_data.append({
                "source_sheet": "", "source_column": "",
                "formula": "", "target_path": path,
                "each_sheet": "", "confidence": 0,
            })

    # FROM clause
    table_counts = Counter(r["source_sheet"] for r in row_data if r["source_sheet"])
    if main_table:
        main_schema = next((c["table_schema"] for c in emb_data if c["table_name"] == main_table), "dbo")
        from_clause = f"FROM {_qualified_name(main_schema, main_table, dialect)}"
        for tbl in [t for t, _ in table_counts.most_common() if t != main_table]:
            tbl_schema = next((c["table_schema"] for c in emb_data if c["table_name"] == tbl), "dbo")
            from_clause += f"\n-- JOIN {_qualified_name(tbl_schema, tbl, dialect)} ON /* add join condition */"
    else:
        from_clause = "-- No source table matched; update FROM clause manually"

    # Prepend __identifier__ column
    id_col_ref = None
    if identifier_column:
        id_alias = _alias("__identifier__", dialect)
        id_tbl   = identifier_table or main_table or ""
        id_col_ref = (
            _col_ref(quote_identifier(id_tbl, dialect), identifier_column, dialect)
            if id_tbl else identifier_column
        )
        id_select = f"{id_col_ref} AS {id_alias}"
        if id_select not in select_parts:
            select_parts = [id_select] + select_parts
            row_data = [{
                "source_sheet":  identifier_table or main_table or "",
                "source_column": identifier_column,
                "formula":       f"{{{identifier_column}}}",
                "target_path":   "__identifier__",
                "each_sheet":    "",
                "confidence":    100,
            }] + row_data

    sql = "SELECT\n  " + ",\n  ".join(select_parts) + "\n" + from_clause
    if id_col_ref:
        sql += f"\nORDER BY {id_col_ref}"

    # debug step: context assembly (flat path)
    if session is not None:
        session.add_step(
            step="context_assembly",
            label="Context Assembly (Flat Embedding)",
            input_data={"conn_id": m.get("conn_id"), "path_count": len(paths)},
            output_data={
                "matched_cols": len([c for c in matched_cols if c]),
                "main_table": main_table,
                "identifier_column": identifier_column,
                "sql_preview": sql[:300],
            },
        )

    # Optional GPT refinement — only refine the FROM/JOIN clause, not the full SELECT.
    # Sending the full SQL (which can have 80+ long XML-path aliases) blows the output
    # token budget and causes a truncated / broken query.  Instead we:
    #   1. Extract the FROM … [ORDER BY] portion from the programmatic SQL.
    #   2. Ask GPT to fix only that clause (tiny output).
    #   3. Splice the refined FROM back into the unchanged SELECT list.
    try:
        import re as _re2
        client        = m["client"]
        system_prompt = _load_system_prompt()
        ctx_md = _fetch_context(m["conn_id"], m["db"])
        if ctx_md:
            system_prompt += f"\n\nAdditional Instructions (from Admin Query Context):\n{ctx_md}"

        # debug step: template lookup
        if session is not None:
            session.add_step(
                step="prompt_template_lookup",
                label="Prompt Template Lookup",
                input_data={"source": "_load_system_prompt()"},
                output_data={"has_context": bool(ctx_md), "system_prompt_length": len(system_prompt)},
                template_used=None,  # mapping uses hardcoded system prompt
            )

        # ── Extract SELECT / FROM / ORDER BY parts ─────────────────
        # sql is:  SELECT\n  col1,\n  col2\nFROM [schema].[table]\n-- JOIN ...\nORDER BY ...
        from_match = _re2.search(r'\bFROM\b', sql, flags=_re2.IGNORECASE)
        if not from_match:
            raise ValueError("No FROM clause to refine")

        select_block = sql[:from_match.start()].rstrip()   # everything before FROM
        from_block   = sql[from_match.start():]            # FROM … (may include ORDER BY)

        _d = m.get("dialect", "mssql")
        from api.services.dialect_utils import dialect_label_rules as _dlr
        _dialect_label, _ = _dlr(_d)
        schema_lines = [
            f"  {_qualified_name(c['table_schema'], c['table_name'], _d)}.{quote_identifier(c['column_name'], _d)}"
            for c in emb_data[:150]
        ]

        user_msg = (
            f"Below is the FROM/JOIN clause of a generated SQL query ({_dialect_label}).\n"
            "Fix any JOIN conditions that can be inferred from the schema.\n"
            "Leave '-- JOIN' stubs for joins you cannot infer.\n"
            "Return ONLY the corrected FROM/JOIN/ORDER BY clause — no SELECT list, "
            "no explanation, no markdown fences.\n\n"
            "Available schema columns:\n" + "\n".join(schema_lines[:80]) + "\n\n"
            f"FROM clause to fix:\n{from_block}"
        )

        # debug step: prompt construction
        if session is not None:
            session.add_step(
                step="prompt_construction",
                label="Prompt Construction",
                input_data={"dialect": _dialect_label, "schema_cols_count": len(schema_lines)},
                output_data={
                    "system_prompt": system_prompt,
                    "user_prompt": user_msg,
                },
            )

        import time as _time
        _t0 = _time.monotonic()
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0,
            max_tokens=1024,   # FROM/JOIN clause is always small
        )
        _lat = int((_time.monotonic() - _t0) * 1000)

        from api.services import ai_trace as _at
        refined_from = (resp.choices[0].message.content or "").strip()
        _at.store(
            module="mapping", conn_id=m.get("conn_id"), model="gpt-4o-mini",
            prompt=user_msg[:8000], response=refined_from[:8000],
            tokens_in=getattr(getattr(resp, "usage", None), "prompt_tokens", 0),
            tokens_out=getattr(getattr(resp, "usage", None), "completion_tokens", 0),
            latency_ms=_lat, db=m["db"],
        )

        # debug step: LLM call
        if session is not None:
            _tok_in  = getattr(getattr(resp, "usage", None), "prompt_tokens", 0)
            _tok_out = getattr(getattr(resp, "usage", None), "completion_tokens", 0)
            session.add_step(
                step="llm_call",
                label="LLM Call (FROM/JOIN Refinement)",
                input_data={"model": "gpt-4o-mini", "temperature": 0, "tokens_in": _tok_in,
                            "system_prompt": system_prompt, "user_prompt": user_msg},
                output_data={"tokens_out": _tok_out, "response": refined_from},
                duration_ms=_lat,
            )

        # Strip any accidental markdown fences
        refined_from = _re2.sub(r"^```[a-z]*\n?", "", refined_from, flags=_re2.MULTILINE)
        refined_from = _re2.sub(r"\n?```$",         "", refined_from, flags=_re2.MULTILINE).strip()

        # Only apply if GPT returned a FROM clause (sanity check)
        if refined_from.upper().startswith("FROM"):
            sql = select_block + "\n" + refined_from

        # debug step: response parsing
        if session is not None:
            session.add_step(
                step="response_parsing",
                label="Response Parsing",
                input_data={"refined_from_starts_with_FROM": refined_from.upper().startswith("FROM")},
                output_data={"final_sql_preview": sql[:500]},
            )
    except Exception:
        pass  # refinement is best-effort; fall back to programmatic SQL

    return sql, row_data


# ── XML filling helper ────────────────────────────────────────

def _fill_xml_from_row(tpl_content: str, row: dict) -> str:
    """Fill an XML template string with values from a single query result row."""
    import re as _re
    path_to_value = {k: str(v) if v is not None else "" for k, v in row.items()}

    tree = ET.ElementTree(ET.fromstring(tpl_content))
    root = tree.getroot()

    def fill_element(node, path_prefix=""):
        tag  = node.tag.split("}")[-1] if "}" in node.tag else node.tag
        path = f"{path_prefix}/{tag}"
        if path in path_to_value:
            node.text = path_to_value[path]
        elif node.text and "{" in node.text:
            def _repl(match):
                col = match.group(1)
                for k, v in path_to_value.items():
                    if k.split("/")[-1] == col or k.endswith(f"/{col}"):
                        return v
                return row.get(col, "")
            node.text = _re.sub(r'\{([^}]+)\}', _repl, node.text)
        for attr in list(node.attrib):
            if attr == "each":
                continue
            ap = f"{path}/@{attr}"
            if ap in path_to_value:
                node.set(attr, path_to_value[ap])
            elif "{" in node.get(attr, ""):
                def _repl_a(match):
                    col = match.group(1)
                    for k, v in path_to_value.items():
                        if k.split("/")[-1] == col or k.endswith(f"/{col}"):
                            return v
                    return row.get(col, "")
                node.set(attr, _re.sub(r'\{([^}]+)\}', _repl_a, node.get(attr, "")))
        for child in node:
            fill_element(child, path)

    fill_element(root)
    try:
        from xml.etree.ElementTree import indent as _indent
        _indent(tree, space="  ")
    except ImportError:
        pass  # Python < 3.9 — skip pretty-printing
    from io import StringIO
    buf = StringIO()
    tree.write(buf, encoding="unicode", xml_declaration=True)
    return buf.getvalue()


# ── JSON / Text / SQL filling helpers ────────────────────────

def _fill_json_from_row(tpl_content: str, row: dict) -> str:
    """Fill a JSON template structure with values from a single query result row."""
    path_to_value = {k: (str(v) if v is not None else "") for k, v in row.items()}

    def fill(obj, prefix: str):
        if isinstance(obj, dict):
            return {k: fill(v, f"{prefix}.{k}") for k, v in obj.items()}
        if isinstance(obj, list):
            return [fill(obj[0], f"{prefix}[*]")] if obj else []
        # Scalar — look up by exact JSONPath, then by leaf key suffix
        if prefix in path_to_value:
            return path_to_value[prefix]
        leaf = prefix.split(".")[-1].rstrip("]").replace("[*", "")
        for k, v in path_to_value.items():
            k_leaf = k.split(".")[-1].rstrip("]").replace("[*", "")
            if k_leaf == leaf:
                return v
        return obj  # keep original value if no match found

    try:
        data = json.loads(tpl_content)
    except json.JSONDecodeError:
        return tpl_content
    filled = fill(data, "$")
    return json.dumps(filled, indent=2, ensure_ascii=False)


def _fill_text_from_row(tpl_content: str, row: dict) -> str:
    """Replace {Placeholder} tokens in a text or SQL template with row values."""
    path_to_value = {k: (str(v) if v is not None else "") for k, v in row.items()}

    def _repl(match):
        key = match.group(1)
        if key in path_to_value:
            return path_to_value[key]
        # Try matching by trailing path segment
        for k, v in path_to_value.items():
            if k.split("/")[-1] == key or k.split(".")[-1] == key:
                return v
        return ""

    return _re_global.sub(r'\{([^}]+)\}', _repl, tpl_content)


def _fill_template_from_row(tpl_content: str, row: dict, fmt: str) -> str:
    """Dispatch to the correct template filler based on format type."""
    if fmt == "json":
        return _fill_json_from_row(tpl_content, row)
    if fmt in ("text", "sql"):
        return _fill_text_from_row(tpl_content, row)
    return _fill_xml_from_row(tpl_content, row)


# ── Endpoints ─────────────────────────────────────────────────

@router.post("/mapping/generate/query", response_model=GenerateQueryResult)
def generate_query_only(req: GenerateRequest, db: Session = Depends(get_db)):
    """
    Build the SQL SELECT query using embeddings + GPT and persist it to
    GeneratedQuery so preview / generate-xml can use it without requiring
    a separate Save Mapping step.
    """
    from api.services.debug_collector import get_debug_session
    session = get_debug_session("mapping", db)

    m   = _run_matching(req.conn_id, db)

    # debug step: embedding match summary (before SQL build)
    if session.enabled:
        session.add_step(
            step="context_assembly",
            label="Embedding Match",
            input_data={"conn_id": req.conn_id},
            output_data={
                "paths_count": len(m.get("paths", [])),
                "matched_cols": len([c for c in m.get("matched_cols", []) if c]),
                "relations_found": len(m.get("relations", [])),
                "main_table": m.get("main_table"),
                "identifier_column": m.get("identifier_column"),
            },
        )

    sql, _ = _build_sql(m, session=session)

    session.persist(db, conn_id=req.conn_id)

    # Persist to DB immediately so Preview / Generate XML work right away
    gq = db.query(GeneratedQuery).filter_by(conn_id=req.conn_id).first()
    if gq:
        gq.query_sql = sql
    else:
        db.add(GeneratedQuery(conn_id=req.conn_id, query_sql=sql))
    db.commit()

    return GenerateQueryResult(
        query_sql=sql,
        identifier_column=m["identifier_column"],
        identifier_table=m["identifier_table"],
        debug=session.to_response() if session.enabled else None,
    )


@router.post("/mapping/generate/rows", response_model=GenerateRowsResult)
def generate_rows_only(req: GenerateRequest, db: Session = Depends(get_db)):
    """
    Build mapping rows by executing the saved SQL query (TOP 1) and reading
    the actual result column names. Each alias = source_column = target_path.
    Falls back to embedding-based matching if no saved query exists.
    Returns rows for human review — does NOT save anything.
    """
    import re as _re2

    # Try the query-execution path first
    gq = (db.query(GeneratedQuery)
            .filter_by(conn_id=req.conn_id)
            .order_by(GeneratedQuery.id.desc())
            .first())

    if gq and gq.query_sql:
        src = db.query(SourceConnection).filter(SourceConnection.id == req.conn_id).first()
        if not src:
            raise HTTPException(404, "Source connection not found.")

        from api.routers.connections import _to_cfg_from_model
        from api.services.connector import preview_data, _clean_error

        cfg     = _to_cfg_from_model(src)
        dialect = normalize_dialect(src.dialect, src.source_type)
        sql     = _clean_sql_for_exec(gq.query_sql, dialect)

        # Execute with limit 1 to get column schema cheaply (outer-wrap, probe only)
        sql1    = limit_query(sql, 1, dialect)
        cfg["query"] = sql1
        try:
            result = preview_data(cfg, limit=1)
        except Exception as exc:
            raise HTTPException(400, detail=f"Could not execute query: {_clean_error(exc)}")

        columns = result.get("columns", [])
        if not columns:
            raise HTTPException(422, "Query returned no columns. Check the saved SQL query.")

        # Load existing mapping to preserve identifier info
        mapping = (db.query(Mapping)
                     .filter_by(conn_id=req.conn_id, is_active=True)
                     .order_by(Mapping.id.desc())
                     .first())
        id_col   = mapping.identifier_column if mapping else None
        id_table = mapping.identifier_table  if mapping else None

        rows = []
        for col in columns:
            if col == "__identifier__":
                # Treat the identifier column specially
                rows.append(MappingRowOut(
                    source_sheet="",
                    source_column=col,
                    formula=f"{{{col}}}",
                    target_path="__identifier__",
                    each_sheet="",
                    confidence=100,
                ))
                continue
            # col IS the XML path alias (e.g. /DepartmentConversion/Department/DeptNo)
            rows.append(MappingRowOut(
                source_sheet="",
                source_column=col,
                formula=f"{{{col}}}",
                target_path=col,
                each_sheet="",
                confidence=100,
            ))

        rows = _enrich_rows_with_rules(rows, req.conn_id, db)
        return GenerateRowsResult(
            mapping_id=0,
            rows=rows,
            identifier_column=id_col,
            identifier_table=id_table,
        )

    # Fallback: embedding-based matching (no saved query yet)
    m = _run_matching(req.conn_id, db)
    _, row_data = _build_sql(m)
    rows = [MappingRowOut(**rd) for rd in row_data]
    rows = _enrich_rows_with_rules(rows, req.conn_id, db)
    return GenerateRowsResult(
        mapping_id=0,
        rows=rows,
        identifier_column=m["identifier_column"],
        identifier_table=m["identifier_table"],
    )


def _enrich_rows_with_rules(
    rows: List[MappingRowOut], conn_id: int, db: Session
) -> List[MappingRowOut]:
    """
    Enrich mapping rows with any active TransformationRules that match by
    conn_id + source_column. Boosts confidence by +10 and populates the
    transformations list so the UI can show rule chips immediately.
    """
    ti_rules = (
        db.query(TransformationRule)
        .filter(
            TransformationRule.conn_id == conn_id,
            TransformationRule.is_active == True,
            TransformationRule.approval_status.in_(["draft", "approved"]),
        )
        .order_by(TransformationRule.source_column, TransformationRule.priority)
        .all()
    )
    # Group by source_column; rules with no source_column are skipped (global rules)
    rules_by_col: dict[str, list] = defaultdict(list)
    for r in ti_rules:
        if r.source_column:
            rules_by_col[r.source_column].append(r)

    enriched = []
    for row in rows:
        col = row.source_column or ""
        matched = rules_by_col.get(col, [])
        if not matched:
            enriched.append(row)
            continue
        refs = [
            TransformationRef(
                rule_id=r.id,
                rule_name=r.rule_name,
                category=r.category,
                execution_order=i,
                discovery_source="ai_discovery",
            )
            for i, r in enumerate(matched)
        ]
        summary = "; ".join(f"[{r.category}] {r.rule_name}" for r in matched)
        primary = matched[0]
        formula = row.formula
        if primary.category == "LookupMapping" and primary.transformation_json:
            formula = f"LOOKUP({{{col}}}, {primary.transformation_json})"
        enriched.append(row.model_copy(update={
            "confidence":            min(100, row.confidence + 10),
            "rule_confidence_boost": 10,
            "transformations":       refs,
            "transform_sql":         summary,
            "formula":               formula,
        }))
    return enriched


@router.get("/mapping/{conn_id}")
def get_mapping(conn_id: int, db: Session = Depends(get_db)):
    mapping = (db.query(Mapping)
                 .filter_by(conn_id=conn_id, is_active=True)
                 .order_by(Mapping.id.desc())
                 .first())
    if not mapping:
        return {"rows": [], "identifier_column": None, "identifier_table": None}
    rows = (db.query(MappingRow)
              .filter_by(mapping_id=mapping.id)
              .order_by(MappingRow.sort_order, MappingRow.id)
              .all())
    out_rows = []
    for r in rows:
        links = (
            db.query(MappingRowTransformation, TransformationRule)
            .join(TransformationRule,
                  MappingRowTransformation.rule_id == TransformationRule.id)
            .filter(
                MappingRowTransformation.mapping_row_id == r.id,
                MappingRowTransformation.is_active == True,
            )
            .order_by(MappingRowTransformation.execution_order)
            .all()
        )
        refs = [
            TransformationRef(
                rule_id=tr.id, rule_name=tr.rule_name, category=tr.category,
                execution_order=link.execution_order,
                discovery_source=link.discovery_source,
            )
            for link, tr in links
        ]
        out_rows.append(MappingRowOut(
            source_sheet=r.source_sheet, source_column=r.source_column,
            formula=r.formula, target_path=r.target_path,
            each_sheet=r.each_sheet, confidence=r.confidence or 0,
            transform_sql=r.transform_sql,
            transformations=refs,
        ))
    return {
        "rows": out_rows,
        "identifier_column": mapping.identifier_column,
        "identifier_table":  mapping.identifier_table,
    }


@router.get("/mapping/{conn_id}/query")
def get_generated_query(conn_id: int, db: Session = Depends(get_db)):
    gq = (db.query(GeneratedQuery)
            .filter_by(conn_id=conn_id)
            .order_by(GeneratedQuery.id.desc())
            .first())
    if not gq:
        raise HTTPException(404, "No generated query found for this connection.")
    mapping = (db.query(Mapping)
                 .filter_by(conn_id=conn_id, is_active=True)
                 .order_by(Mapping.id.desc())
                 .first())
    return {
        "conn_id":           conn_id,
        "query_sql":         gq.query_sql,
        "identifier_column": mapping.identifier_column if mapping else None,
        "identifier_table":  mapping.identifier_table  if mapping else None,
    }


@router.post("/mapping/save", status_code=200)
def save_mapping(req: SaveRequest, db: Session = Depends(get_db)):
    db.query(Mapping).filter_by(conn_id=req.conn_id, is_active=True).update({"is_active": False})
    tpl  = (db.query(XmlTemplate).filter_by(conn_id=req.conn_id).order_by(XmlTemplate.id.desc()).first())
    prev = (db.query(Mapping).filter_by(conn_id=req.conn_id).order_by(Mapping.id.desc()).first())
    mapping = Mapping(
        conn_id=req.conn_id,
        template_id=tpl.id if tpl else None,
        version=(prev.version + 1) if prev else 1,
        is_active=True,
        identifier_column=req.identifier_column,
        identifier_table=req.identifier_table,
    )
    db.add(mapping)
    db.flush()
    for i, rd in enumerate(req.rows):
        mr = MappingRow(
            mapping_id=mapping.id,
            source_sheet=rd.source_sheet, source_column=rd.source_column,
            formula=rd.formula, target_path=rd.target_path,
            each_sheet=rd.each_sheet, sort_order=i,
            confidence=rd.confidence or None,
            transform_sql=rd.transform_sql,
        )
        db.add(mr)
        db.flush()  # get mr.id
        for t in (rd.transformations or []):
            db.add(MappingRowTransformation(
                mapping_row_id=mr.id,
                rule_id=t.rule_id,
                execution_order=t.execution_order,
                discovery_source=t.discovery_source,
            ))
    if req.query_sql:
        gq = db.query(GeneratedQuery).filter_by(conn_id=req.conn_id).first()
        if gq:
            gq.query_sql = req.query_sql; gq.mapping_id = mapping.id
        else:
            db.add(GeneratedQuery(conn_id=req.conn_id, mapping_id=mapping.id, query_sql=req.query_sql))
    db.commit()
    return {"mapping_id": mapping.id, "rows_saved": len(req.rows)}


@router.post("/mapping/rows/{row_id}/transformations")
def link_rule_to_row(row_id: int, body: LinkRuleBody, db: Session = Depends(get_db)):
    """Link an existing TransformationRule to a MappingRow (user or repository attach)."""
    row = db.query(MappingRow).filter(MappingRow.id == row_id).first()
    if not row:
        raise HTTPException(404, "Mapping row not found.")
    rule = db.query(TransformationRule).filter(TransformationRule.id == body.rule_id).first()
    if not rule:
        raise HTTPException(404, "TransformationRule not found.")
    # Avoid duplicate links
    existing = db.query(MappingRowTransformation).filter(
        MappingRowTransformation.mapping_row_id == row_id,
        MappingRowTransformation.rule_id == body.rule_id,
        MappingRowTransformation.is_active == True,
    ).first()
    if not existing:
        db.add(MappingRowTransformation(
            mapping_row_id=row_id,
            rule_id=body.rule_id,
            execution_order=body.execution_order,
            discovery_source=body.discovery_source,
        ))
        db.commit()
    return TransformationRef(
        rule_id=rule.id, rule_name=rule.rule_name, category=rule.category,
        execution_order=body.execution_order, discovery_source=body.discovery_source,
    )


@router.post("/mapping/{mapping_id}/transform-preview")
def preview_transformations(mapping_id: int, db: Session = Depends(get_db)):
    """
    Apply linked TransformationRules to a sample of source data and return
    before/after per field. Used by the Mapping tab Preview panel.
    """
    import json as _jpv
    from api.services.transformation_service import _eval_condition, _apply_transformation

    mapping = db.query(Mapping).filter(Mapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(404, "Mapping not found.")

    mr_list = (
        db.query(MappingRow)
        .filter(MappingRow.mapping_id == mapping_id)
        .order_by(MappingRow.sort_order, MappingRow.id)
        .all()
    )

    # Fetch sample data (5 rows) via saved query
    sample_rows: list[dict] = []
    gq = (db.query(GeneratedQuery).filter_by(conn_id=mapping.conn_id)
            .order_by(GeneratedQuery.id.desc()).first())
    if gq and gq.query_sql:
        try:
            src = db.query(SourceConnection).filter(SourceConnection.id == mapping.conn_id).first()
            if src:
                from api.routers.connections import _to_cfg_from_model
                from api.services.connector import preview_data
                from api.services.dialect_utils import normalize_dialect
                cfg = _to_cfg_from_model(src)
                dialect = normalize_dialect(src.dialect, src.source_type)
                sql = _clean_sql_for_exec(gq.query_sql, dialect)
                cfg["query"] = limit_query(sql, 5, dialect)
                res = preview_data(cfg, limit=5)
                sample_rows = res.get("rows", [])
        except Exception:
            pass

    previews = []
    for mr in mr_list:
        if not mr.source_column or mr.source_column == "__identifier__":
            continue
        # Load linked rules
        links = (
            db.query(MappingRowTransformation, TransformationRule)
            .join(TransformationRule,
                  MappingRowTransformation.rule_id == TransformationRule.id)
            .filter(
                MappingRowTransformation.mapping_row_id == mr.id,
                MappingRowTransformation.is_active == True,
                TransformationRule.is_active == True,
            )
            .order_by(MappingRowTransformation.execution_order)
            .all()
        )
        if not links:
            continue

        rule_results = []
        for link, rule in links:
            trans = _jpv.loads(rule.transformation_json) if rule.transformation_json else {}
            cond  = _jpv.loads(rule.condition_json)      if rule.condition_json      else {}
            # Apply to each sample row and collect before/after
            for s_row in sample_rows[:3]:
                raw_val = s_row.get(mr.target_path) or s_row.get(mr.source_column)
                if raw_val is None:
                    continue
                try:
                    applied = not cond or _eval_condition(cond, s_row)
                    out_row = _apply_transformation(trans, dict(s_row)) if applied and trans else dict(s_row)
                    out_val = out_row.get(mr.target_path) or out_row.get(rule.target_path or "") or raw_val
                    rule_results.append({
                        "rule_name": rule.rule_name,
                        "category":  rule.category,
                        "input":     str(raw_val),
                        "output":    str(out_val),
                        "applied":   applied,
                    })
                    break  # one sample per rule is enough for preview
                except Exception:
                    pass

        if rule_results:
            previews.append({
                "source_column": mr.source_column,
                "target_path":   mr.target_path,
                "rules":         rule_results,
            })

    return {"mapping_id": mapping_id, "previews": previews, "sample_count": len(sample_rows)}


class PreviewRequest(BaseModel):
    query_sql: Optional[str] = None  # if omitted, falls back to saved DB query


@router.post("/mapping/{conn_id}/preview")
def preview_mapping_query(conn_id: int, req: Optional[PreviewRequest] = None, db: Session = Depends(get_db)):
    import re as _re2
    # Use SQL from request body if provided, otherwise load from DB
    sql_text = ((req.query_sql or "") if req else "").strip()
    if not sql_text:
        gq = (db.query(GeneratedQuery).filter_by(conn_id=conn_id).order_by(GeneratedQuery.id.desc()).first())
        if not gq or not gq.query_sql:
            raise HTTPException(404, "No query available. Generate or paste a SQL query first.")
        sql_text = gq.query_sql
    src = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not src:
        raise HTTPException(404, "Source connection not found.")
    from api.routers.connections import _to_cfg_from_model
    from api.services.connector import preview_data, _clean_error
    cfg     = _to_cfg_from_model(src)
    dialect = normalize_dialect(src.dialect, src.source_type)
    sql     = _clean_sql_for_exec(sql_text, dialect)
    cfg["query"] = limit_query(sql, 10, dialect)
    try:
        return preview_data(cfg, limit=10000)
    except Exception as exc:
        raise HTTPException(400, detail=_clean_error(exc))


@router.get("/mapping/{conn_id}/identifier-values")
def get_identifier_values(conn_id: int, db: Session = Depends(get_db)):
    gq = (db.query(GeneratedQuery).filter_by(conn_id=conn_id).order_by(GeneratedQuery.id.desc()).first())
    if not gq or not gq.query_sql:
        raise HTTPException(404, "No generated query found. Run Generate Query in the Mapping tab first.")
    # identifier_column is a hint for the UI label — optional
    mapping = (db.query(Mapping).filter_by(conn_id=conn_id, is_active=True).order_by(Mapping.id.desc()).first())
    identifier_column = mapping.identifier_column if mapping else None
    identifier_table  = mapping.identifier_table  if mapping else None
    src = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not src:
        raise HTTPException(404, "Source connection not found.")
    from api.routers.connections import _to_cfg_from_model
    from api.services.connector import preview_data, _clean_error
    cfg     = _to_cfg_from_model(src)
    dialect = normalize_dialect(src.dialect, src.source_type)
    sql     = _clean_sql_for_exec(gq.query_sql, dialect)
    qi      = quote_identifier

    if identifier_column:
        col_q   = qi(identifier_column, dialect)
        wrapped = f"SELECT DISTINCT {col_q} AS identifier_value FROM ({sql}) AS _src ORDER BY 1"
        cfg["query"] = wrapped
        try:
            result = preview_data(cfg, limit=10000)
            values = [str(r.get("identifier_value", "")) for r in result.get("rows", [])
                      if r.get("identifier_value") is not None]
        except Exception as exc:
            raise HTTPException(400, detail=_clean_error(exc))
    else:
        # No identifier column set — probe to discover column names, then use first column
        cfg["query"] = limit_query(sql, 1, dialect)
        try:
            probe = preview_data(cfg, limit=1)
            cols = probe.get("columns", [])
            if not cols:
                raise HTTPException(400, "Query returned no columns — set an identifier column in the Mapping tab first.")
            first_col = cols[0]
            identifier_column = first_col
            col_q   = qi(first_col, dialect)
            wrapped = f"SELECT DISTINCT {col_q} AS identifier_value FROM ({sql}) AS _src ORDER BY 1"
            cfg["query"] = wrapped
            result = preview_data(cfg, limit=10000)
            values = [str(r.get("identifier_value", "")) for r in result.get("rows", [])
                      if r.get("identifier_value") is not None]
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(400, detail=_clean_error(exc))

    return {"identifier_column": identifier_column,
            "identifier_table":  identifier_table,
            "values":            values}


@router.post("/mapping/{conn_id}/generate-xml")
def generate_xml_for_identifier(conn_id: int, req: GenerateXmlRequest, db: Session = Depends(get_db)):
    tpl = (db.query(XmlTemplate).filter_by(conn_id=conn_id).order_by(XmlTemplate.id.desc()).first())
    if not tpl or not tpl.content:
        raise HTTPException(404, "No template found for this connection.")
    fmt = tpl.format_type or "xml"
    gq = (db.query(GeneratedQuery).filter_by(conn_id=conn_id).order_by(GeneratedQuery.id.desc()).first())
    if not gq or not gq.query_sql:
        raise HTTPException(404, "No generated query for this connection. Run Generate Query first.")
    src = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not src:
        raise HTTPException(404, "Source connection not found.")
    from api.routers.connections import _to_cfg_from_model
    from api.services.connector import preview_data, _clean_error
    mapping = (db.query(Mapping).filter_by(conn_id=conn_id, is_active=True)
                 .order_by(Mapping.id.desc()).first())
    identifier_column = mapping.identifier_column if mapping else None
    cfg      = _to_cfg_from_model(src)
    dialect  = normalize_dialect(src.dialect, src.source_type)
    sql      = _clean_sql_for_exec(gq.query_sql, dialect)
    safe_val = req.identifier_value.replace("'", "''")
    qi       = quote_identifier

    if identifier_column:
        col_q    = qi(identifier_column, dialect)
        filtered = f"SELECT * FROM ({sql}) AS _src WHERE {col_q} = '{safe_val}'"
    else:
        # No identifier column — probe to discover column names, then filter by first column
        cfg["query"] = limit_query(sql, 1, dialect)
        try:
            probe = preview_data(cfg, limit=1)
            cols = probe.get("columns", [])
            if not cols:
                raise HTTPException(400, "Query returned no columns. Set an identifier column in the Mapping tab.")
            identifier_column = cols[0]
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(400, detail=_clean_error(exc))
        col_q    = qi(identifier_column, dialect)
        filtered = f"SELECT * FROM ({sql}) AS _src WHERE {col_q} = '{safe_val}'"

    cfg["query"] = filtered
    try:
        result = preview_data(cfg, limit=10000)
    except Exception as exc:
        raise HTTPException(400, detail=_clean_error(exc))
    rows = result.get("rows", [])
    if not rows:
        raise HTTPException(404, f"No data found for identifier: {req.identifier_value!r}")
    # Apply rules in two passes (same engine as generate-all-xml)
    import json as _json_ti_single
    from api.services.transformation_service import _eval_condition as _ev_cond, \
        _apply_transformation as _ap_trans

    # Pass 1: global approved rules
    _ti_rules_single = db.query(TransformationRule).filter(
        TransformationRule.conn_id == conn_id,
        TransformationRule.is_active == True,
        TransformationRule.approval_status == "approved",
        TransformationRule.execution_stage.in_(["Transform", "PostTransform"]),
    ).order_by(TransformationRule.execution_stage, TransformationRule.stage_order).all()

    # Pass 2: per-field scoped rules (conn_id + source_column + target_path)
    _field_rules_single: dict = defaultdict(list)
    if mapping:
        _mr_list = db.query(MappingRow).filter(MappingRow.mapping_id == mapping.id).all()
        for _mr in _mr_list:
            if _mr.source_column and _mr.target_path:
                _scoped = db.query(TransformationRule).filter(
                    TransformationRule.conn_id == conn_id,
                    TransformationRule.source_column == _mr.source_column,
                    TransformationRule.target_path == _mr.target_path,
                    TransformationRule.is_active == True,
                    TransformationRule.approval_status == "approved",
                ).order_by(TransformationRule.priority).all()
                if _scoped:
                    _field_rules_single[_mr.target_path].extend(_scoped)

    def _apply_single_ti_rules(row: dict) -> dict:
        result = dict(row)
        for rule in _ti_rules_single:
            try:
                cond  = _json_ti_single.loads(rule.condition_json)  if rule.condition_json  else None
                trans = _json_ti_single.loads(rule.transformation_json) if rule.transformation_json else None
                if trans and (_ev_cond(cond, result) if cond else True):
                    result = _ap_trans(trans, result)
            except Exception:
                pass
        for _tgt, _fr_list in _field_rules_single.items():
            if _tgt not in result:
                continue
            for _rule in _fr_list:
                try:
                    _cond  = _json_ti_single.loads(_rule.condition_json)  if _rule.condition_json  else None
                    _trans = _json_ti_single.loads(_rule.transformation_json) if _rule.transformation_json else None
                    if _trans and (not _cond or _ev_cond(_cond, result)):
                        result = _ap_trans(_trans, result)
                except Exception:
                    pass
        return result

    try:
        xml_out = _fill_template_from_row(tpl.content, _apply_single_ti_rules(rows[0]), fmt)
    except Exception as exc:
        raise HTTPException(500, detail=f"Output generation failed: {exc}")
    existing = (db.query(GeneratedXml)
                  .filter_by(conn_id=conn_id, identifier_value=req.identifier_value)
                  .first())
    if existing:
        existing.xml_content = xml_out
        existing.mapping_id  = mapping.id if mapping else None
        xml_record = existing
    else:
        xml_record = GeneratedXml(
            conn_id=conn_id,
            mapping_id=mapping.id if mapping else None,
            identifier_value=req.identifier_value,
            xml_content=xml_out,
        )
        db.add(xml_record)
    db.commit()
    db.refresh(xml_record)
    return {"identifier_value": req.identifier_value, "xml": xml_out,
            "rows_used": len(rows), "saved_id": xml_record.id}


@router.post("/mapping/{conn_id}/generate-all-xml")
def generate_all_xml(conn_id: int, db: Session = Depends(get_db)):
    """
    Run the saved query, group rows by __identifier__, generate XML for each group,
    upsert all into conversion_generated_xml, and return the list of saved records.
    """
    from collections import defaultdict as _defaultdict
    tpl = (db.query(XmlTemplate).filter_by(conn_id=conn_id).order_by(XmlTemplate.id.desc()).first())
    if not tpl or not tpl.content:
        raise HTTPException(404, "No template found. Upload one in the Target tab first.")
    fmt = tpl.format_type or "xml"
    gq = (db.query(GeneratedQuery).filter_by(conn_id=conn_id).order_by(GeneratedQuery.id.desc()).first())
    if not gq or not gq.query_sql:
        raise HTTPException(404, "No generated query found. Run Generate Query in the Mapping tab first.")
    src = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not src:
        raise HTTPException(404, "Source connection not found.")

    from api.routers.connections import _to_cfg_from_model
    from api.services.connector import _build_sql_engine, _serialize_row, _clean_error, _build_sf_connection
    cfg     = _to_cfg_from_model(src)
    dialect = normalize_dialect(src.dialect, src.source_type)
    sql     = _clean_sql_for_exec(gq.query_sql, dialect)

    # Guard: if the LLM wrapped the query in a subquery (SELECT * FROM (SELECT...))
    # we need to run the inner SELECT directly to preserve XML path column aliases.
    import re as _re_unwrap
    _inner_match = _re_unwrap.match(
        r'^\s*SELECT\s+\*\s+FROM\s*\(\s*(SELECT[\s\S]+)\)\s+AS\s+\w+\s*$',
        sql, _re_unwrap.IGNORECASE,
    )
    if _inner_match:
        sql = _inner_match.group(1).strip()

    # Run the query directly (bypass _wrap_query which wraps in a subquery
    # and may drop column names containing '/' path separators)
    try:
        if dialect == "snowflake":
            conn = _build_sf_connection(cfg)
            cur  = conn.cursor()
            cur.execute(sql)
            columns = [desc[0] for desc in cur.description]
            raw_rows = [dict(zip(columns, row)) for row in cur.fetchall()]
            cur.close(); conn.close()
        else:
            from sqlalchemy import text as _sa_text
            engine = _build_sql_engine(cfg)
            with engine.connect() as _conn:
                result  = _conn.execute(_sa_text(sql))
                columns = list(result.keys())
                raw_rows = [dict(zip(columns, row)) for row in result.fetchall()]
        rows = [_serialize_row(r) for r in raw_rows]
    except Exception as exc:
        raise HTTPException(400, detail=_clean_error(exc))

    if not rows:
        raise HTTPException(404, "Query returned no data.")

    # Group rows by identifier column
    # The agent-generated SQL always aliases the PK as '__identifier__', so prefer that
    # over the raw mapping.identifier_column name (which won't appear as a key in results).
    mapping = (db.query(Mapping).filter_by(conn_id=conn_id, is_active=True)
                 .order_by(Mapping.id.desc()).first())
    id_col = mapping.identifier_column if mapping else None

    if rows and "__identifier__" in rows[0]:
        # Agent SQL — PK is already aliased; use the alias key for grouping
        id_col = "__identifier__"
    elif not id_col and rows:
        id_col = list(rows[0].keys())[0]   # fall back to first column

    groups: dict = _defaultdict(list)
    for row in rows:
        id_val = str(row.get(id_col, "") or "") if id_col else ""
        groups[id_val].append(row)

    mapping = (db.query(Mapping).filter_by(conn_id=conn_id, is_active=True)
                 .order_by(Mapping.id.desc()).first())
    mid = mapping.id if mapping else None

    # ── Load field-level transforms (Python expressions from MappingRow) ────────
    transforms: dict = {}
    if mid:
        mrows = db.query(MappingRow).filter(
            MappingRow.mapping_id == mid,
            MappingRow.transform_expression.isnot(None),
        ).all()
        for mr in mrows:
            if mr.target_path and mr.transform_expression:
                transforms[mr.target_path] = mr.transform_expression

    # ── Load approved TransformationRules for this connection ────────────────
    # These are the governed rules from the Transformation Intelligence module.
    # Stages: PreTransform rules have already influenced SQL generation;
    # Transform + PostTransform rules are applied here at row-processing time.
    import json as _json_ti
    ti_rules = db.query(TransformationRule).filter(
        TransformationRule.conn_id == conn_id,
        TransformationRule.is_active == True,
        TransformationRule.approval_status == "approved",
        TransformationRule.execution_stage.in_(["Transform", "PostTransform"]),
    ).order_by(TransformationRule.execution_stage, TransformationRule.stage_order,
               TransformationRule.priority).all()

    # ── Load per-field rules from MappingRowTransformation ───────────────────
    # Scoped by conn_id + source_column + target_path for precise field matching.
    # Any rule a business user adds (approved) is auto-applied without re-running Step 3.
    field_rules_by_target: dict = defaultdict(list)
    if mid:
        mr_all = db.query(MappingRow).filter(MappingRow.mapping_id == mid).all()
        for mr in mr_all:
            if not mr.target_path or not mr.source_column:
                continue
            scoped = db.query(TransformationRule).filter(
                TransformationRule.conn_id == conn_id,
                TransformationRule.source_column == mr.source_column,
                TransformationRule.target_path == mr.target_path,
                TransformationRule.is_active == True,
                TransformationRule.approval_status == "approved",
            ).order_by(TransformationRule.priority).all()
            if scoped:
                field_rules_by_target[mr.target_path].extend(scoped)

    def _eval_ti_condition(cond: dict, record: dict) -> bool:
        """Evaluate a TransformationRule condition_json tree against a record."""
        if "logic" in cond and "conditions" in cond:
            logic = cond.get("logic", "AND").upper()
            results = [_eval_ti_condition(c, record) for c in cond["conditions"]]
            return all(results) if logic == "AND" else any(results)
        field = cond.get("field", "")
        op    = cond.get("operator", "=")
        val   = cond.get("value", "")
        rec_v = record.get(field)
        try:
            if op in (">", ">=", "<", "<="):
                _ops = {">": float.__gt__, ">=": float.__ge__, "<": float.__lt__, "<=": float.__le__}
                return _ops[op](float(str(rec_v or 0)), float(str(val)))
            if op in ("=", "=="):   return str(rec_v) == str(val)
            if op in ("!=", "<>"): return str(rec_v) != str(val)
            if op == "contains":   return str(val).lower() in str(rec_v or "").lower()
            if op == "in":         return str(rec_v) in [x.strip() for x in str(val).split(",")]
        except Exception:
            pass
        return False

    def _apply_ti_rule(trans: dict, record: dict) -> None:
        """Apply a TransformationRule transformation_json to a record in-place."""
        action = trans.get("action", "")
        target = trans.get("target_field", "")
        if not target:
            return
        if action == "set":
            for case in trans.get("cases", []):
                if "when" in case:
                    if _eval_ti_condition(case["when"], record):
                        record[target] = str(case.get("then", ""))
                        break
                elif "else" in case:
                    record[target] = str(case.get("else", ""))
        elif action == "default":
            if not record.get(target):
                record[target] = str(trans.get("value", ""))
        elif action == "direct_map":
            src = trans.get("source_field", "")
            if src and src in record:
                record[target] = record[src]

    def _apply_transforms(row: dict) -> dict:
        """Apply MappingRow Python transforms + approved TransformationRules to a SQL result row."""
        result = dict(row)

        # 1. Field-level MappingRow Python expressions (existing)
        for target_path, expr in transforms.items():
            if target_path in result:
                raw_value = result[target_path]
                try:
                    value = str(raw_value) if raw_value is not None else ""
                    result[target_path] = str(eval(expr, {"__builtins__": {}}, {"value": value}))  # noqa: S307
                except Exception:
                    pass

        # 2. Approved TransformationRules — global (conn-level, existing)
        for rule in ti_rules:
            try:
                cond  = _json_ti.loads(rule.condition_json)  if rule.condition_json  else None
                trans = _json_ti.loads(rule.transformation_json) if rule.transformation_json else None
                if not trans:
                    continue
                matched = _eval_ti_condition(cond, result) if cond else True
                if matched:
                    _apply_ti_rule(trans, result)
            except Exception:
                pass  # rule errors must never break XML generation

        # 3. Per-field rules scoped by source_column + target_path (new)
        for target_key, fr_list in field_rules_by_target.items():
            if target_key not in result:
                continue
            for rule in fr_list:
                try:
                    cond  = _json_ti.loads(rule.condition_json)  if rule.condition_json  else None
                    trans = _json_ti.loads(rule.transformation_json) if rule.transformation_json else None
                    if not trans:
                        continue
                    if not cond or _eval_ti_condition(cond, result):
                        _apply_ti_rule(trans, result)
                except Exception:
                    pass

        return result

    saved_records = []
    errors = []
    for id_val, group_rows in groups.items():
        try:
            xml_out = _fill_template_from_row(tpl.content, _apply_transforms(group_rows[0]), fmt)
        except Exception as exc:
            errors.append(f"'{id_val}': {exc}")
            continue
        try:
            existing = (db.query(GeneratedXml)
                          .filter_by(conn_id=conn_id, identifier_value=id_val)
                          .first())
            if existing:
                existing.xml_content = xml_out
                existing.mapping_id  = mid
                rec = existing
            else:
                rec = GeneratedXml(conn_id=conn_id, mapping_id=mid,
                                   identifier_value=id_val, xml_content=xml_out)
                db.add(rec)
            db.flush()
            saved_records.append({"id": rec.id, "identifier_value": id_val})
        except Exception as exc:
            db.rollback()
            errors.append(f"DB save '{id_val}': {exc}")

    if saved_records:
        db.commit()

    # If nothing was saved, surface the first error so the caller can diagnose
    if not saved_records and errors:
        raise HTTPException(422, detail=f"Output generation failed for all {len(groups)} group(s). "
                                        f"First error: {errors[0]}")

    return {
        "generated":  len(saved_records),
        "total_rows": len(rows),
        "groups":     len(groups),
        "errors":     errors,
        "records":    saved_records,
    }


@router.get("/mapping/{conn_id}/generated-xml")
def list_generated_xml(conn_id: int, db: Session = Depends(get_db)):
    """Return list of saved XML records for this connection."""
    records = (db.query(GeneratedXml)
                 .filter_by(conn_id=conn_id)
                 .order_by(GeneratedXml.identifier_value)
                 .all())
    return [{"id": r.id, "identifier_value": r.identifier_value,
             "generated_at": r.generated_at.isoformat() if r.generated_at else None}
            for r in records]


@router.get("/mapping/{conn_id}/generated-xml/{record_id}")
def get_generated_xml(conn_id: int, record_id: int, db: Session = Depends(get_db)):
    """Fetch a single generated XML record by ID."""
    rec = db.query(GeneratedXml).filter_by(id=record_id, conn_id=conn_id).first()
    if not rec:
        raise HTTPException(404, "Generated XML record not found.")
    return {"id": rec.id, "identifier_value": rec.identifier_value,
            "xml_content": rec.xml_content}


class PatchQueryRequest(BaseModel):
    query_sql: str


@router.patch("/mapping/{conn_id}/query", status_code=200)
def patch_query(conn_id: int, req: PatchQueryRequest, db: Session = Depends(get_db)):
    """Save an edited SQL query directly, without touching mapping rows."""
    if not req.query_sql.strip():
        raise HTTPException(422, "query_sql cannot be empty.")
    gq = (db.query(GeneratedQuery)
            .filter_by(conn_id=conn_id)
            .order_by(GeneratedQuery.id.desc())
            .first())
    if gq:
        gq.query_sql = req.query_sql
    else:
        db.add(GeneratedQuery(conn_id=conn_id, query_sql=req.query_sql))
    db.commit()
    return {"query_sql": req.query_sql}


class PatchIdentifierRequest(BaseModel):
    identifier_column: Optional[str] = None
    identifier_table:  Optional[str] = None


@router.patch("/mapping/{conn_id}/identifier", status_code=200)
def patch_identifier(conn_id: int, req: PatchIdentifierRequest, db: Session = Depends(get_db)):
    """Update only the identifier_column / identifier_table on the active mapping."""
    mapping = (db.query(Mapping)
                 .filter_by(conn_id=conn_id, is_active=True)
                 .order_by(Mapping.id.desc())
                 .first())
    if not mapping:
        raise HTTPException(404, "No active mapping found for this connection.")
    mapping.identifier_column = req.identifier_column
    mapping.identifier_table  = req.identifier_table
    db.commit()
    return {"identifier_column": mapping.identifier_column, "identifier_table": mapping.identifier_table}


@router.delete("/mapping/{conn_id}", status_code=204)
def delete_mapping(conn_id: int, db: Session = Depends(get_db)):
    for m in db.query(Mapping).filter_by(conn_id=conn_id).all():
        db.query(MappingRow).filter_by(mapping_id=m.id).delete()
    db.query(Mapping).filter_by(conn_id=conn_id).delete()
    db.query(GeneratedQuery).filter_by(conn_id=conn_id).delete()
    db.commit()
