# ═══════════════════════════════════════════════════════════
# services/query_builder.py
# JOIN-aware SQL query builder (Steps 4+5 of the conversion plan)
#
# Algorithm:
#   1. Build a bidirectional FK graph from conversion_catalog_relations
#   2. BFS from the root table to find shortest join paths to every
#      other table referenced by the matched XML paths
#   3. Emit proper LEFT JOIN clauses for all reachable tables;
#      add comment stubs for tables with no FK path found
#   4. Send the generated SQL + full FK context to GPT-4o-mini
#      for a final review/fix pass
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

from collections import defaultdict, deque
from pathlib import Path
from typing import Optional


# ── FK graph helpers ──────────────────────────────────────────

def _build_fk_graph(relations: list) -> dict[str, list]:
    """
    Bidirectional adjacency list built from CatalogRelation ORM rows.
    {table: [(neighbor_table, my_join_col, their_join_col), ...]}
    Both directions are added so BFS can traverse parent→child and child→parent.
    """
    graph: dict[str, list] = defaultdict(list)
    for r in relations:
        # FK direction: parent_table.parent_column → referenced_table.referenced_column
        graph[r.parent_table].append((r.referenced_table, r.parent_column, r.referenced_column))
        # Reverse: referenced_table ← parent_table  (needed when root is the "parent")
        graph[r.referenced_table].append((r.parent_table, r.referenced_column, r.parent_column))
    return dict(graph)


def _bfs_join_paths(graph: dict, root: str, targets: set[str]) -> dict[str, list]:
    """
    BFS from root to find the shortest join path to each target table.
    Returns {target_table: [(from_tbl, from_col, to_tbl, to_col), ...]}
    Each tuple in the list is one JOIN hop.
    """
    remaining = targets - {root}
    if not remaining:
        return {}

    visited: set[str] = {root}
    queue: deque = deque([(root, [])])
    found: dict[str, list] = {}

    while queue and len(found) < len(remaining):
        node, path = queue.popleft()
        if node in remaining and node not in found:
            found[node] = path
        for nbr, my_col, their_col in graph.get(node, []):
            if nbr not in visited:
                visited.add(nbr)
                queue.append((nbr, path + [(node, my_col, nbr, their_col)]))

    return found


# ── SQL quoting helpers ───────────────────────────────────────

def _q(name: str, dialect: str) -> str:
    """Quote an identifier for the given dialect."""
    if dialect in ("snowflake", "postgresql", "mysql"):
        return f'"{name}"'
    return f"[{name}]"


def _path_alias(path: str, dialect: str) -> str:
    """Quote an XML path string as a column alias."""
    if dialect in ("snowflake", "postgresql", "mysql"):
        return f'"{path.replace(chr(34), chr(34)*2)}"'
    return f"[{path.replace(']', ']]')}]"


# ── Main public function ──────────────────────────────────────

def build_join_query(m: dict) -> tuple[str, list[dict]]:
    """
    Build a JOIN-aware SELECT query using FK relationships from the catalog.

    m: the result dict from _run_matching() in mapping_ai.py.
       Must include m["relations"] (list of CatalogRelation ORM objects).

    Returns (sql_string, row_data_list) — same shape as _build_sql().
    Returns (None, []) if not enough schema info to proceed.
    """
    paths             = m["paths"]
    matched_cols      = m["matched_cols"]
    match_scores      = m["match_scores"]
    emb_data          = m["emb_data"]
    default_map       = m["default_map"]
    dialect           = m["dialect"]
    main_table        = m["main_table"]
    identifier_column = m["identifier_column"]
    identifier_table  = m["identifier_table"]
    relations         = m["relations"]
    client            = m["client"]

    if not relations:
        return None, []

    # ── 1. Build FK graph ─────────────────────────────────────
    graph = _build_fk_graph(relations)

    # ── 2. Identify needed tables ─────────────────────────────
    needed_tables: set[str] = {c["table_name"] for c in matched_cols if c is not None}
    if identifier_table:
        needed_tables.add(identifier_table)

    root = main_table or (next(iter(needed_tables)) if needed_tables else None)
    if not root:
        return None, []

    # ── 3. BFS to resolve join paths ─────────────────────────
    join_paths = _bfs_join_paths(graph, root, needed_tables)

    # Collect all JOIN steps in BFS order, deduped
    table_alias: dict[str, str] = {}   # {table_name: short_alias}
    join_steps:  list[tuple]    = []
    seen_steps:  set[tuple]     = set()

    def _reg(tbl: str):
        if tbl not in table_alias:
            table_alias[tbl] = f"t{len(table_alias)}"

    _reg(root)
    for _target, step_list in join_paths.items():
        for step in step_list:
            from_tbl, from_col, to_tbl, to_col = step
            _reg(from_tbl)
            _reg(to_tbl)
            key = (from_tbl, from_col, to_tbl, to_col)
            if key not in seen_steps:
                seen_steps.add(key)
                join_steps.append(step)

    # Register any tables that BFS couldn't reach
    for tbl in needed_tables:
        _reg(tbl)

    # Schema lookup
    schema_map = {c["table_name"]: c["table_schema"] for c in emb_data}

    def tbl_ref(tbl: str) -> str:
        sch = schema_map.get(tbl, "dbo")
        return f"{_q(sch, dialect)}.{_q(tbl, dialect)}"

    def col_ref(tbl: str, col: str) -> str:
        return f"{table_alias.get(tbl, tbl)}.{_q(col, dialect)}"

    # ── 4. Build SELECT parts + row_data ─────────────────────
    select_parts: list[str] = []
    row_data:     list[dict] = []

    for path, col, score in zip(paths, matched_cols, match_scores):
        al = _path_alias(path, dialect)
        if col:
            select_parts.append(f"{col_ref(col['table_name'], col['column_name'])} AS {al}")
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

    # Prepend __identifier__ column
    id_col_ref = None
    if identifier_column:
        id_tbl     = identifier_table or root
        id_col_ref = col_ref(id_tbl, identifier_column)
        id_al      = _path_alias("__identifier__", dialect)
        id_select  = f"{id_col_ref} AS {id_al}"
        if id_select not in select_parts:
            select_parts = [id_select] + select_parts
            row_data = [{
                "source_sheet":  id_tbl,
                "source_column": identifier_column,
                "formula":       f"{{{identifier_column}}}",
                "target_path":   "__identifier__",
                "each_sheet":    "",
                "confidence":    100,
            }] + row_data

    # ── 5. Build FROM + LEFT JOIN clauses ────────────────────
    root_alias = table_alias[root]
    from_parts = [f"FROM {tbl_ref(root)} AS {root_alias}"]

    reached = {root} | {s[2] for s in join_steps}
    for from_tbl, from_col, to_tbl, to_col in join_steps:
        fa = table_alias.get(from_tbl, from_tbl)
        ta = table_alias.get(to_tbl, to_tbl)
        from_parts.append(
            f"LEFT JOIN {tbl_ref(to_tbl)} AS {ta} "
            f"ON {fa}.{_q(from_col, dialect)} = {ta}.{_q(to_col, dialect)}"
        )

    # Stub for tables with no FK path found
    for tbl in needed_tables:
        if tbl not in reached:
            ta = table_alias.get(tbl, tbl)
            from_parts.append(
                f"-- LEFT JOIN {tbl_ref(tbl)} AS {ta} ON /* no FK path found — add condition manually */"
            )

    from_clause = "\n".join(from_parts)
    sql = "SELECT\n  " + ",\n  ".join(select_parts) + "\n" + from_clause
    if id_col_ref:
        sql += f"\nORDER BY {id_col_ref}"

    # ── 6. LLM review pass with full skill prompt + FK context ──
    try:
        import re as _re

        # Build enriched skill prompt if DB session available in m
        sys_prompt = None
        if m.get("db") and m.get("conn_id"):
            try:
                from api.services.query_skill import build_skill_prompt
                sys_prompt = build_skill_prompt(
                    m["conn_id"], m["db"], dialect,
                    context="mapping",
                    matched_cols=matched_cols,
                    match_scores=match_scores,
                    paths=paths,
                )
            except Exception:
                pass
        if not sys_prompt:
            prompt_path = Path(__file__).parent.parent.parent / "prompts" / "query_skill.md"
            fallback    = Path(__file__).parent.parent.parent / "prompts" / "mapping_prompt.md"
            for p in (prompt_path, fallback):
                if p.exists():
                    sys_prompt = p.read_text(encoding="utf-8")
                    break
            sys_prompt = sys_prompt or "You are a SQL expert helping with a data conversion pipeline."

        fk_lines = [
            f"  {r.parent_table}.{r.parent_column} → "
            f"{r.referenced_table}.{r.referenced_column}"
            for r in relations[:80]
        ]
        match_lines = [
            f"  {path} → {col['table_name']}.{col['column_name']} (score {score:.2f})"
            for path, col, score in zip(paths, matched_cols, match_scores)
            if col is not None
        ][:60]

        user_msg = (
            "You are reviewing a generated SQL query for a data conversion pipeline.\n\n"
            "Discovered FK relationships in the legacy schema:\n"
            + "\n".join(fk_lines)
            + "\n\nXML path → matched source column:\n"
            + "\n".join(match_lines)
            + "\n\nRules:\n"
            "1. Fix any wrong JOIN conditions using the FK list above.\n"
            "2. Resolve any '-- LEFT JOIN ... ON /* no FK path */' stubs if you can infer the join.\n"
            "3. Keep every SELECT column alias exactly as-is — they are XML paths used downstream.\n"
            "4. Do NOT add or remove any SELECT columns.\n"
            "5. Return ONLY the final SQL — no explanation, no markdown fences.\n\n"
            "SQL to review:\n" + sql
        )
        resp    = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0,
            max_tokens=3000,
        )
        refined = resp.choices[0].message.content.strip()
        refined = _re.sub(r"^```[a-z]*\n?", "", refined, flags=_re.MULTILINE)
        refined = _re.sub(r"\n?```$",         "", refined, flags=_re.MULTILINE).strip()
        if refined.upper().startswith("SELECT"):
            sql = refined
    except Exception:
        pass  # Keep BFS-generated SQL if LLM call fails

    return sql, row_data
