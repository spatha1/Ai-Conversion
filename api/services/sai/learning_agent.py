"""
learning_agent.py — Persists operational patterns to SaiOperationalMemory.
Increments frequency for recurring incidents; stores successful remediations.
On resolution, writes an IncidentHistory KB entry so future SAI runs and Ask SAI
can find and learn from past remediation outcomes.
"""
import hashlib
import json
import time
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session

from api.models import SaiOperationalMemory


def _fingerprint(issue_type: str, system_impacted: str, description: str) -> str:
    raw = f"{issue_type}|{system_impacted}|{description[:200]}"
    return hashlib.sha256(raw.encode()).hexdigest()


async def run(
    findings: list[dict],
    actions_taken: list[dict],
    validation_result: dict,
    project_id: Optional[int],
    db: Session,
    sai_run_id: Optional[int] = None,
) -> dict:
    t0 = time.time()
    learned = []

    for f in findings:
        issue_type      = f.get("issue_type", "")
        system_impacted = f.get("system_impacted", "")
        description     = f.get("description", "")
        fp = _fingerprint(issue_type, system_impacted, description)

        existing = db.query(SaiOperationalMemory).filter(
            SaiOperationalMemory.fingerprint == fp
        ).first()

        fix_json = json.dumps(actions_taken[:3]) if actions_taken else None

        if existing:
            existing.frequency += 1
            existing.last_seen_at = datetime.now(timezone.utc)
            if validation_result.get("validation_status") == "RESOLVED":
                existing.successful_fix_json = fix_json
            db.flush()
            learned.append({"fingerprint": fp, "action": "incremented", "frequency": existing.frequency})
        else:
            mem = SaiOperationalMemory(
                project_id=project_id,
                fingerprint=fp,
                issue_type=issue_type,
                system_impacted=system_impacted,
                description_summary=description[:500],
                frequency=1,
                last_seen_at=datetime.now(timezone.utc),
                successful_fix_json=fix_json if validation_result.get("validation_status") == "RESOLVED" else None,
            )
            db.add(mem)
            db.flush()
            learned.append({"fingerprint": fp, "action": "created"})

    try:
        db.commit()
    except Exception:
        db.rollback()

    # Write resolved incidents back to SAI KB as searchable IncidentHistory entries
    validation_passed = validation_result.get("validation_status") == "RESOLVED"
    if validation_passed and findings:
        try:
            from api.services.knowledge_processor import process_entry, embed_and_store_chunks
            from api.schemas import KnowledgeEntryCreate
            from api.routers.knowledge import _persist_entry

            systems = list({f.get("system_impacted", "") for f in findings if f.get("system_impacted")})
            action_labels = [a.get("type", "") for a in actions_taken[:3] if a.get("type")]
            run_label = f"Run {sai_run_id}" if sai_run_id else "SAI Ops"

            summary_text = (
                f"{run_label}: {len(findings)} finding(s) resolved. "
                f"Systems: {', '.join(systems) or 'N/A'}. "
                f"Actions: {', '.join(action_labels) or 'N/A'}."
            )
            raw_content = (
                f"{summary_text}\n\n"
                f"Findings:\n{json.dumps(findings[:5], indent=2)}\n\n"
                f"Actions taken:\n{json.dumps(actions_taken[:5], indent=2)}\n\n"
                f"Validation:\n{json.dumps(validation_result, indent=2)}"
            )

            result = process_entry(
                title=f"Incident Resolution — {run_label}",
                type="Issue",
                system="General",
                tags=["incident", "auto-learned", "sai-ops"],
                source_type="Text",
                raw_content=raw_content[:8000],
                db=db,
            )
            req_obj = KnowledgeEntryCreate(
                title=f"Incident Resolution — {run_label}",
                type="Issue",
                system="General",
                tags=["incident", "auto-learned", "sai-ops"],
                source_type="Text",
                raw_content=raw_content[:8000],
                op_category="IncidentHistory",
            )
            entry = _persist_entry(result, req_obj, db)
            embed_and_store_chunks(
                entry_id=entry.id,
                chunks=result.get("chunks", []),
                summary=result["knowledge_entry"].get("summary") or "",
                db=db,
            )
            learned.append({"action": "kb_entry_created", "entry_id": entry.id, "title": entry.title})
        except Exception as exc:
            print(f"[learning_agent] KB write-back failed: {exc}")

    return {
        "learned":    learned,
        "elapsed_ms": int((time.time() - t0) * 1000),
    }
