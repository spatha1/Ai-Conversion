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

from api.services.dialect_utils import quote_identifier, escape_alias, qualified_name, column_ref as _col_ref


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


# ── SQL quoting helpers (delegates to dialect_utils) ──────────

def _q(name: str, dialect: str) -> str:
    return quote_identifier(name, dialect)


def _path_alias(path: str, dialect: str) -> str:
    return escape_alias(path, dialect)


# ── Join scoring ─────────────────────────────────────────────

def score_join_paths(
    graph: dict,
    needed_tables: set[str],
    matched_cols: list,
    emb_data: list[dict],
    profiles: dict[str, dict],
) -> list[tuple[str, float]]:
    """
    Score each candidate root table using a composite of four signals.
    Returns sorted list of (table_name, composite_score) descending.

    Weights:
      FK centrality  0.35 — fraction of needed tables reachable via BFS
      Match density  0.30 — fraction of matched_cols belonging to this table
      PK presence    0.20 — 1.0 if table has a known PK column
      Profile quality 0.15 — avg (1 - null_pct/100) across profiled columns
    """
    if not needed_tables:
        return []

    # PK info from emb_data
    pk_tables: set[str] = {
        c["table_name"] for c in emb_data
        if c.get("is_primary_key")
    }

    # Match counts per table
    total_matched = max(sum(1 for c in matched_cols if c is not None), 1)
    match_counts: dict[str, int] = {}
    for c in matched_cols:
        if c is not None:
            match_counts[c["table_name"]] = match_counts.get(c["table_name"], 0) + 1

    candidates = list(needed_tables)
    scores: list[tuple[str, float]] = []

    for candidate in candidates:
        # FK centrality
        reachable = _bfs_join_paths(graph, candidate, needed_tables - {candidate})
        centrality = len(reachable) / max(len(needed_tables) - 1, 1)

        # Match density
        density = match_counts.get(candidate, 0) / total_matched

        # PK presence
        pk_score = 1.0 if candidate in pk_tables else 0.0

        # Profile quality
        col_profiles = [v for k, v in profiles.items() if k.startswith(f"{candidate}.")]
        if col_profiles:
            avg_null = sum(p.get("null_pct", 50.0) for p in col_profiles) / len(col_profiles)
            quality = max(0.0, 1.0 - avg_null / 100.0)
        else:
            quality = 0.5  # default when no profile data

        composite = (
            0.35 * centrality
            + 0.30 * density
            + 0.20 * pk_score
            + 0.15 * quality
        )
        scores.append((candidate, composite))

    scores.sort(key=lambda x: x[1], reverse=True)
    return scores


# ── Main public function ──────────────────────────────────────

def build_join_query(m: dict, extra_instructions: str = "") -> tuple[str, list[dict], list[tuple]]:
    """
    Build a JOIN-aware SELECT query using FK relationships from the catalog.

    m: the result dict from _run_matching() in mapping_ai.py.
       Must include m["relations"] (list of CatalogRelation ORM objects).
    extra_instructions: optional text appended to the LLM review prompt
       (used by MapperAgent to pass validator hints on retry attempts).

    Returns (sql_string, row_data_list, join_path_tuples).
    Returns (None, [], []) if not enough schema info to proceed.
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
        return None, [], []

    # ── 1. Build FK graph ─────────────────────────────────────
    graph = _build_fk_graph(relations)

    # ── 2. Identify needed tables ─────────────────────────────
    needed_tables: set[str] = {c["table_name"] for c in matched_cols if c is not None}
    if identifier_table:
        needed_tables.add(identifier_table)

    # Use score_join_paths() when profiles are available; fall back to main_table
    profiles: dict = m.get("profiles", {})
    if needed_tables and len(needed_tables) > 1:
        scored = score_join_paths(graph, needed_tables, matched_cols, emb_data, profiles)
        root = scored[0][0] if scored else main_table
    else:
        root = main_table or (next(iter(needed_tables)) if needed_tables else None)

    if not root:
        return None, [], []

    # ── 3. BFS to resolve join paths ─────────────────────────
    join_paths_map = _bfs_join_paths(graph, root, needed_tables)
    join_paths = join_paths_map  # keep original name for later use

    # Collect all JOIN steps in BFS order, deduped
    table_alias: dict[str, str] = {}   # {table_name: short_alias}
    join_steps:  list[tuple]    = []
    seen_steps:  set[tuple]     = set()

    def _reg(tbl: str):
        if tbl not in table_alias:
            table_alias[tbl] = f"t{len(table_alias)}"

    # Capture join path tuples for MappingContext
    all_join_tuples: list[tuple] = []
    for _target, step_list in join_paths_map.items():
        all_join_tuples.extend(step_list)

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

        alias_lines = [f"  {tbl} → {al}" for tbl, al in table_alias.items()]
        extra_block = f"\n\nAdditional instructions:\n{extra_instructions}" if extra_instructions else ""
        user_msg = (
            "You are reviewing a generated SQL query for a data conversion pipeline.\n\n"
            "Table aliases used in this query (CRITICAL — do NOT change these):\n"
            + "\n".join(alias_lines)
            + "\n\nDiscovered FK relationships in the legacy schema:\n"
            + "\n".join(fk_lines)
            + "\n\nXML path → matched source column:\n"
            + "\n".join(match_lines)
            + "\n\nRules:\n"
            "1. Fix any wrong JOIN conditions using the FK list above.\n"
            "2. Resolve any '-- LEFT JOIN ... ON /* no FK path */' stubs if you can infer the join.\n"
            "3. Keep every SELECT column alias exactly as-is — they are XML paths used downstream.\n"
            "4. Do NOT add or remove any SELECT columns.\n"
            "5. CRITICAL: Every column reference MUST use the short alias (e.g. t0, t1, t2) from the alias list above. "
            "NEVER use the full table name as a qualifier (e.g. PAYMENT.PAYMENT_METHOD is WRONG; t2.[PAYMENT_METHOD] is correct).\n"
            "6. Return ONLY the final SQL — no explanation, no markdown fences.\n"
            + extra_block
            + "\n\nSQL to review:\n" + sql
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
            import re as _re2

            # ── Reject if LLM wrapped the whole SQL in a subquery ──
            if _re2.search(r'FROM\s*\(\s*SELECT', refined, _re2.IGNORECASE):
                refined = sql   # revert to BFS

            # ── Fix any TableName.Col → alias.Col ──
            for tbl_name, alias in table_alias.items():
                pattern = _re2.compile(
                    r'(?<!\w)(?:\[' + _re2.escape(tbl_name) + r'\]|'
                    + _re2.escape(tbl_name) + r')\.(?=[\[\w])',
                    _re2.IGNORECASE,
                )
                refined = pattern.sub(alias + '.', refined)

            # ── Final guard: if any known table name still appears as a
            #    qualifier after the fix, the LLM output is still broken —
            #    revert entirely to the clean BFS SQL ──
            still_bad = False
            for tbl_name in table_alias:
                bad_pat = _re2.compile(
                    r'(?<!\w)(?:\[' + _re2.escape(tbl_name) + r'\]|'
                    + _re2.escape(tbl_name) + r')\.(?=[\[\w])',
                    _re2.IGNORECASE,
                )
                if bad_pat.search(refined):
                    still_bad = True
                    break
            if still_bad:
                refined = sql   # BFS SQL is guaranteed alias-correct

            sql = refined
    except Exception:
        pass  # Keep BFS-generated SQL if LLM call fails

    return sql, row_data, all_join_tuples
