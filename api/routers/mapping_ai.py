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
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.config import settings
from api.models import (
    XmlTemplate, TargetFormulaRule, ColumnEmbedding,
    SourceConnection, Mapping, MappingRow, GeneratedQuery, CatalogColumn, GeneratedXml,
    CatalogRelation, QueryContext,
)
from api.services.embeddings import cosine_similarity

router = APIRouter()

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

class MappingRowOut(BaseModel):
    source_sheet:  Optional[str] = None
    source_column: Optional[str] = None
    formula:       Optional[str] = None
    target_path:   Optional[str] = None
    each_sheet:    Optional[str] = None
    confidence:    int           = 0

class GenerateQueryResult(BaseModel):
    query_sql:         str
    identifier_column: Optional[str] = None
    identifier_table:  Optional[str] = None

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
    if dialect in ("snowflake", "postgresql", "mysql"):
        return f'"{path.replace(chr(34), chr(34)*2)}"'
    return f"[{path.replace(']', ']]')}]"


def _clean_sql_for_exec(sql: str, dialect: str, strip_order_by: bool = True) -> str:
    import re as _re
    lines = [ln for ln in sql.split("\n") if not ln.strip().startswith("--")]
    sql = "\n".join(lines).strip()
    if strip_order_by:
        sql = _re.sub(r"\bORDER\s+BY\b[^\n;]*", "", sql, flags=_re.IGNORECASE).strip()
    return sql


# ── Shared: load template + run embedding matching ────────────

def _run_matching(conn_id: int, db: Session) -> dict:
    """
    Load XML template paths + column embeddings, run cosine + name matching.
    Returns a dict with everything needed to build SQL or mapping rows.
    Raises HTTPException on failure.
    """
    import re as _re

    # Load XML template
    tpl = (db.query(XmlTemplate)
             .filter_by(conn_id=conn_id)
             .order_by(XmlTemplate.id.desc())
             .first())
    if not tpl or not tpl.content:
        raise HTTPException(404, "No XML template found for this connection. Upload one in the Target tab first.")
    paths = _extract_paths(tpl.content)
    if not paths:
        raise HTTPException(422, "No mappable paths found in the XML template.")

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
    dialect = "snowflake" if (src and src.source_type == "snowflake") else (
        (src.dialect or "mssql").lower() if src else "mssql"
    )

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

def _build_sql(m: dict) -> tuple[str, list[dict]]:
    """
    Build SELECT SQL and row_data list from _run_matching result dict.
    Uses the JOIN-aware query_builder when FK relations exist in the catalog;
    falls back to the flat embedding-only approach otherwise.
    """
    # ── JOIN-aware path (Steps 4+5): uses FK graph from catalog ──
    if m.get("relations"):
        from api.services.query_builder import build_join_query
        sql, row_data = build_join_query(m)
        if sql:
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
            col_ref = (f'"{col["table_name"]}"."{col["column_name"]}"'
                       if dialect == "snowflake"
                       else f"[{col['table_name']}].[{col['column_name']}]")
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
        from_clause = (f'FROM "{main_schema}"."{main_table}"'
                       if dialect in ("snowflake", "postgresql", "mysql")
                       else f"FROM [{main_schema}].[{main_table}]")
        for tbl in [t for t, _ in table_counts.most_common() if t != main_table]:
            tbl_schema = next((c["table_schema"] for c in emb_data if c["table_name"] == tbl), "dbo")
            from_clause += (f'\n-- JOIN "{tbl_schema}"."{tbl}" ON /* add join condition */'
                            if dialect == "snowflake"
                            else f"\n-- JOIN [{tbl_schema}].[{tbl}] ON /* add join condition */")
    else:
        from_clause = "-- No source table matched; update FROM clause manually"

    # Prepend __identifier__ column
    id_col_ref = None
    if identifier_column:
        id_alias = _alias("__identifier__", dialect)
        id_tbl   = identifier_table or main_table or ""
        id_col_ref = (f'"{id_tbl}"."{identifier_column}"'
                      if dialect == "snowflake"
                      else f"[{id_tbl}].[{identifier_column}]") if id_tbl else identifier_column
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

    # Optional GPT refinement (best-effort)
    try:
        import re as _re2
        client        = m["client"]
        system_prompt = _load_system_prompt()
        # Inject query context (global + connection-specific)
        ctx_md = _fetch_context(m["conn_id"], m["db"])
        if ctx_md:
            system_prompt += f"\n\nAdditional Instructions (from Admin Query Context):\n{ctx_md}"
        schema_lines  = [f"  [{c['table_schema']}].[{c['table_name']}].[{c['column_name']}]"
                         for c in emb_data[:150]]
        user_msg = (
            "Below is a generated SQL query. Review it against the schema and context above.\n"
            "Fix JOIN conditions if inferable; otherwise leave -- JOIN stubs.\n"
            "Return ONLY the final SQL — no explanation, no markdown fences.\n\n"
            "Available columns:\n" + "\n".join(schema_lines[:80]) + "\n\n"
            f"Generated SQL:\n{sql}"
        )
        resp    = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": system_prompt},
                      {"role": "user",   "content": user_msg}],
            temperature=0, max_tokens=2000,
        )
        refined = resp.choices[0].message.content.strip()
        refined = _re2.sub(r"^```[a-z]*\n?", "", refined, flags=_re2.MULTILINE)
        refined = _re2.sub(r"\n?```$",         "", refined, flags=_re2.MULTILINE).strip()
        if refined.upper().startswith("SELECT"):
            sql = refined
    except Exception:
        pass

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


# ── Endpoints ─────────────────────────────────────────────────

@router.post("/mapping/generate/query", response_model=GenerateQueryResult)
def generate_query_only(req: GenerateRequest, db: Session = Depends(get_db)):
    """
    Build the SQL SELECT query using embeddings + GPT.
    Returns the generated SQL for human review — does NOT save anything.
    Human must call POST /mapping/save to persist after reviewing.
    """
    m   = _run_matching(req.conn_id, db)
    sql, _ = _build_sql(m)
    return GenerateQueryResult(
        query_sql=sql,
        identifier_column=m["identifier_column"],
        identifier_table=m["identifier_table"],
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
        dialect = "snowflake" if src.source_type == "snowflake" else (src.dialect or "mssql").lower()
        sql     = _clean_sql_for_exec(gq.query_sql, dialect)

        # Execute with TOP 1 / LIMIT 1 to get column schema cheaply
        if dialect == "snowflake":
            sql1 = _re2.sub(r"(?i)^(\s*SELECT\s+)", r"\1", sql, count=1).rstrip(";") + " LIMIT 1"
        else:
            sql1 = _re2.sub(r"(?i)^(\s*SELECT\s+)", r"\g<1>TOP 1 ", sql, count=1)

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

        return GenerateRowsResult(
            mapping_id=0,
            rows=rows,
            identifier_column=id_col,
            identifier_table=id_table,
        )

    # Fallback: embedding-based matching (no saved query yet)
    m = _run_matching(req.conn_id, db)
    _, row_data = _build_sql(m)
    return GenerateRowsResult(
        mapping_id=0,
        rows=[MappingRowOut(**rd) for rd in row_data],
        identifier_column=m["identifier_column"],
        identifier_table=m["identifier_table"],
    )


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
    return {
        "rows": [MappingRowOut(
            source_sheet=r.source_sheet, source_column=r.source_column,
            formula=r.formula, target_path=r.target_path,
            each_sheet=r.each_sheet, confidence=r.confidence or 0,
        ) for r in rows],
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
        db.add(MappingRow(
            mapping_id=mapping.id,
            source_sheet=rd.source_sheet, source_column=rd.source_column,
            formula=rd.formula, target_path=rd.target_path,
            each_sheet=rd.each_sheet, sort_order=i,
            confidence=rd.confidence or None,
        ))
    if req.query_sql:
        gq = db.query(GeneratedQuery).filter_by(conn_id=req.conn_id).first()
        if gq:
            gq.query_sql = req.query_sql; gq.mapping_id = mapping.id
        else:
            db.add(GeneratedQuery(conn_id=req.conn_id, mapping_id=mapping.id, query_sql=req.query_sql))
    db.commit()
    return {"mapping_id": mapping.id, "rows_saved": len(req.rows)}


@router.get("/mapping/{conn_id}/preview")
def preview_mapping_query(conn_id: int, db: Session = Depends(get_db)):
    import re as _re2
    gq = (db.query(GeneratedQuery).filter_by(conn_id=conn_id).order_by(GeneratedQuery.id.desc()).first())
    if not gq or not gq.query_sql:
        raise HTTPException(404, "No generated query for this connection.")
    src = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not src:
        raise HTTPException(404, "Source connection not found.")
    from api.routers.connections import _to_cfg_from_model
    from api.services.connector import preview_data, _clean_error
    cfg     = _to_cfg_from_model(src)
    dialect = "snowflake" if (src.source_type == "snowflake") else (src.dialect or "mssql").lower()
    sql     = _clean_sql_for_exec(gq.query_sql, dialect)
    sql     = (_re2.sub(r"(?i)^(\s*SELECT\s+)", r"\1", sql, count=1).rstrip(";") + " LIMIT 10"
               if dialect == "snowflake"
               else _re2.sub(r"(?i)^(\s*SELECT\s+)", r"\g<1>TOP 10 ", sql, count=1))
    cfg["query"] = sql
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
    dialect = "snowflake" if (src.source_type == "snowflake") else (src.dialect or "mssql").lower()
    sql     = _clean_sql_for_exec(gq.query_sql, dialect)

    if identifier_column:
        # Use the stored identifier column
        if dialect == "snowflake":
            wrapped = f'SELECT DISTINCT "{identifier_column}" AS identifier_value FROM ({sql}) AS _src ORDER BY 1'
        else:
            wrapped = f'SELECT DISTINCT [{identifier_column}] AS identifier_value FROM ({sql}) AS _src ORDER BY 1'
        cfg["query"] = wrapped
        try:
            result = preview_data(cfg, limit=10000)
            values = [str(r.get("identifier_value", "")) for r in result.get("rows", [])
                      if r.get("identifier_value") is not None]
        except Exception as exc:
            raise HTTPException(400, detail=_clean_error(exc))
    else:
        # No identifier column set — execute query TOP 1 to discover column names, then use first column
        if dialect == "snowflake":
            probe_sql = sql.rstrip(";") + " LIMIT 1"
        else:
            import re as _re3
            probe_sql = _re3.sub(r"(?i)^(\s*SELECT\s+)", r"\g<1>TOP 1 ", sql, count=1)
        cfg["query"] = probe_sql
        try:
            probe = preview_data(cfg, limit=1)
            cols = probe.get("columns", [])
            if not cols:
                raise HTTPException(400, "Query returned no columns — set an identifier column in the Mapping tab first.")
            first_col = cols[0]
            identifier_column = first_col   # use first column as identifier
            if dialect == "snowflake":
                wrapped = f'SELECT DISTINCT "{first_col}" AS identifier_value FROM ({sql}) AS _src ORDER BY 1'
            else:
                wrapped = f'SELECT DISTINCT [{first_col}] AS identifier_value FROM ({sql}) AS _src ORDER BY 1'
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
        raise HTTPException(404, "No XML template found for this connection.")
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
    cfg     = _to_cfg_from_model(src)
    dialect = "snowflake" if (src.source_type == "snowflake") else (src.dialect or "mssql").lower()
    sql     = _clean_sql_for_exec(gq.query_sql, dialect)
    safe_val = req.identifier_value.replace("'", "''")

    if identifier_column:
        # Filter by the known identifier column
        if dialect == "snowflake":
            filtered = f'SELECT * FROM ({sql}) AS _src WHERE "{identifier_column}" = \'{safe_val}\''
        else:
            filtered = f"SELECT * FROM ({sql}) AS _src WHERE [{identifier_column}] = '{safe_val}'"
    else:
        # No identifier column — run full query and match on first column value
        if dialect == "snowflake":
            probe_sql = sql.rstrip(";") + " LIMIT 1"
        else:
            import re as _re_gen
            probe_sql = _re_gen.sub(r"(?i)^(\s*SELECT\s+)", r"\g<1>TOP 1 ", sql, count=1)
        cfg["query"] = probe_sql
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
        if dialect == "snowflake":
            filtered = f'SELECT * FROM ({sql}) AS _src WHERE "{identifier_column}" = \'{safe_val}\''
        else:
            filtered = f"SELECT * FROM ({sql}) AS _src WHERE [{identifier_column}] = '{safe_val}'"

    cfg["query"] = filtered
    try:
        result = preview_data(cfg, limit=10000)
    except Exception as exc:
        raise HTTPException(400, detail=_clean_error(exc))
    rows = result.get("rows", [])
    if not rows:
        raise HTTPException(404, f"No data found for identifier: {req.identifier_value!r}")
    try:
        xml_out = _fill_xml_from_row(tpl.content, rows[0])
    except Exception as exc:
        raise HTTPException(500, detail=f"XML generation failed: {exc}")
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
        raise HTTPException(404, "No XML template found. Upload one in the Target tab first.")
    gq = (db.query(GeneratedQuery).filter_by(conn_id=conn_id).order_by(GeneratedQuery.id.desc()).first())
    if not gq or not gq.query_sql:
        raise HTTPException(404, "No generated query found. Run Generate Query in the Mapping tab first.")
    src = db.query(SourceConnection).filter(SourceConnection.id == conn_id).first()
    if not src:
        raise HTTPException(404, "Source connection not found.")

    from api.routers.connections import _to_cfg_from_model
    from api.services.connector import _build_sql_engine, _serialize_row, _clean_error, _build_sf_connection
    cfg     = _to_cfg_from_model(src)
    dialect = "snowflake" if (src.source_type == "snowflake") else (src.dialect or "mssql").lower()
    sql     = _clean_sql_for_exec(gq.query_sql, dialect)

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
    mapping = (db.query(Mapping).filter_by(conn_id=conn_id, is_active=True)
                 .order_by(Mapping.id.desc()).first())
    id_col = mapping.identifier_column if mapping else None
    if not id_col and rows:
        id_col = list(rows[0].keys())[0]   # fall back to first column
    groups: dict = _defaultdict(list)
    for row in rows:
        id_val = str(row.get(id_col, "") or "") if id_col else ""
        groups[id_val].append(row)

    mapping = (db.query(Mapping).filter_by(conn_id=conn_id, is_active=True)
                 .order_by(Mapping.id.desc()).first())
    mid = mapping.id if mapping else None

    saved_records = []
    errors = []
    for id_val, group_rows in groups.items():
        try:
            xml_out = _fill_xml_from_row(tpl.content, group_rows[0])
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
        raise HTTPException(422, detail=f"XML generation failed for all {len(groups)} group(s). "
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


@router.delete("/mapping/{conn_id}", status_code=204)
def delete_mapping(conn_id: int, db: Session = Depends(get_db)):
    for m in db.query(Mapping).filter_by(conn_id=conn_id).all():
        db.query(MappingRow).filter_by(mapping_id=m.id).delete()
    db.query(Mapping).filter_by(conn_id=conn_id).delete()
    db.query(GeneratedQuery).filter_by(conn_id=conn_id).delete()
    db.commit()
