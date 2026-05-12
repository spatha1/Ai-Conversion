"""
import_gl_views.py — Run once to import CML_CUSTOM_BRONZE.GL view definitions into the KB.
Usage: .venv/Scripts/python.exe import_gl_views.py [path/to/views.csv]

The CSV must have columns: TABLE_NAME (or VIEW_NAME), VIEW_DEFINITION (or DEFINITION).
Default path: gl_views_extracted.csv in this directory.
"""
import csv
import json
import sys
import os

# ── Bootstrap the app's DB session ───────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))

from api.database import SessionLocal
from api.models import KnowledgeEntry, KnowledgeChunk
from api.services import knowledge_processor as kp

# ── Resolve CSV path ──────────────────────────────────────────────────────────
csv_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(__file__), "gl_views_extracted.csv"
)
if not os.path.exists(csv_path):
    print(f"ERROR: CSV not found at {csv_path}")
    sys.exit(1)

# ── Metadata derivation (mirrors knowledge.py _derive_view_metadata) ──────────
def _derive(view_name: str) -> dict:
    name = view_name.upper()
    region = (
        "Australia" if name.endswith("_AU") or "_AU_" in name else
        "New Zealand" if name.endswith("_NZ") or "_NZ_" in name else
        "All Regions"
    )
    region_short = "AU" if "AU" in name else "NZ" if "NZ" in name else ""

    domain_map = {
        "BILLING": "Billing", "CLAIMS": "Claims", "POLICY": "Policy",
        "BANKDETAIL": "Bank Detail", "UE": "Unearned Premium",
        "CLARITY": "Clarity GL", "GLUE": "GL Unearned Extract",
        "DC100000": "DC100000 General Ledger", "DC100005": "DC100005 General Ledger",
        "CANON": "Canonical", "PREMIUM": "Premium Extract",
    }
    domain = "General Ledger"
    for key, label in domain_map.items():
        if key in name:
            domain = label
            break

    is_summary = "SUMMARY" in name
    is_canon   = "CANON" in name
    is_all     = name.endswith("_ALL")

    parts = [domain]
    if is_summary: parts.append("Summary")
    if is_canon:   parts.append("Canonical")
    if is_all:     parts.append("All Records")

    title_domain = " ".join(parts)
    title = (
        f"{title_domain} — {region} ({view_name})"
        if region_short else
        f"{title_domain} ({view_name})"
    )
    tags = ["view_definition", "GL", "Snowflake", "sql"]
    if region_short: tags.append(region_short)
    if "BILLING" in name: tags.append("billing")
    if "CLAIMS"  in name: tags.append("claims")
    if "POLICY"  in name: tags.append("policy")

    summary = (
        f"Snowflake view `{view_name}` in CML_CUSTOM_BRONZE.GL schema. "
        f"Domain: {domain}. Region: {region}."
        + (" Summary/aggregated view." if is_summary else "")
        + (" Canonical form view for downstream mapping." if is_canon else "")
    )
    return {"title": title, "summary": summary, "tags": tags, "region": region}


# ── Run import ────────────────────────────────────────────────────────────────
db = SessionLocal()
processed = failed = skipped = 0

with open(csv_path, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    rows = list(reader)

print(f"Found {len(rows)} rows in {csv_path}")

for row in rows:
    # Normalise headers
    view_name = next((v.strip() for k, v in row.items() if k.strip().upper() in ("TABLE_NAME", "VIEW_NAME", "NAME")), "")
    sql = next((v.strip() for k, v in row.items() if k.strip().upper() in ("VIEW_DEFINITION", "DEFINITION", "SQL")), "")

    if not view_name or not sql:
        print(f"  SKIP — empty name or sql")
        skipped += 1
        continue

    # Skip if ViewDefinition entry for this view already exists
    existing = db.query(KnowledgeEntry).filter(
        KnowledgeEntry.type == "ViewDefinition",
        KnowledgeEntry.title.contains(view_name),
    ).first()
    if existing:
        print(f"  SKIP (already exists): {view_name}")
        skipped += 1
        continue

    meta = _derive(view_name)

    try:
        # ── ViewDefinition entry ─────────────────────────────────────────────
        view_entry = KnowledgeEntry(
            title=meta["title"],
            type="ViewDefinition",
            system="Snowflake",
            tags=json.dumps(meta["tags"]),
            summary=meta["summary"],
            detailed_explanation=(
                f"Full SQL definition of `{view_name}` (CML_CUSTOM_BRONZE.GL schema).\n\n"
                f"```sql\n{sql}\n```"
            ),
            key_points=json.dumps([
                "Schema: CML_CUSTOM_BRONZE.GL",
                f"View name: {view_name}",
                f"Region: {meta['region']}",
            ]),
            is_reusable=True,
            source_type="SQL",
            raw_content=f"View: {view_name}\n\n{sql}",
            quality_score="HIGH",
            status="READY_FOR_EMBEDDING",
            embedding_status="pending",
            version=1,
            sql_template=sql,
        )
        db.add(view_entry)
        db.commit()
        db.refresh(view_entry)

        combined = (
            f"Snowflake view {view_name} in schema CML_CUSTOM_BRONZE.GL. "
            f"{meta['summary']}\n\n{sql}"
        )
        chunks = kp._chunk_text(combined, topic=view_name)
        count = kp.embed_and_store_chunks(
            entry_id=view_entry.id,
            chunks=chunks,
            summary=meta["summary"],
            db=db,
        )

        # ── QueryExample entry ───────────────────────────────────────────────
        example_sql = f"SELECT * FROM CML_CUSTOM_BRONZE.GL.{view_name} LIMIT 100;"
        example_entry = KnowledgeEntry(
            title=f"Query Example — {view_name}",
            type="QueryExample",
            system="Snowflake",
            tags=json.dumps(meta["tags"] + ["query_example"]),
            summary=f"Sample SELECT query against `{view_name}`.",
            detailed_explanation=(
                f"Use this query to retrieve data from the {meta['title']}:\n\n"
                f"```sql\n{example_sql}\n```"
            ),
            key_points=json.dumps([
                f"Source view: {view_name}",
                "Database: CML_CUSTOM_BRONZE, Schema: GL",
            ]),
            is_reusable=True,
            source_type="SQL",
            raw_content=f"Query example for {view_name}:\n{example_sql}",
            quality_score="HIGH",
            status="READY_FOR_EMBEDDING",
            embedding_status="pending",
            version=1,
            sql_template=example_sql,
        )
        db.add(example_entry)
        db.commit()
        db.refresh(example_entry)

        ex_chunks = kp._chunk_text(
            f"Query example for Snowflake view {view_name}: {example_sql}",
            topic=f"Query: {view_name}",
        )
        kp.embed_and_store_chunks(
            entry_id=example_entry.id,
            chunks=ex_chunks,
            summary=f"Sample SELECT from {view_name}",
            db=db,
        )

        print(f"  OK: {view_name} -> {count} chunks embedded")
        processed += 1

    except Exception as exc:
        db.rollback()
        print(f"  FAIL: {view_name} — {exc}")
        failed += 1

db.close()
print(f"\nDone. processed={processed}, skipped={skipped}, failed={failed}")
