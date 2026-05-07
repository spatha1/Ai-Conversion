"""
learning_agent.py — Persists operational patterns to SaiOperationalMemory.
Increments frequency for recurring incidents; stores successful remediations.
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

    return {
        "learned":    learned,
        "elapsed_ms": int((time.time() - t0) * 1000),
    }
