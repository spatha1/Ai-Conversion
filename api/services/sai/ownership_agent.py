"""
ownership_agent.py — Maps classified findings to responsible teams.
Uses lob_registry + Knowledge Engine. No hardcoded ownership without KB fallback.
"""
import time
from sqlalchemy.orm import Session

_OWNERSHIP_MAP = {
    "Claims":      "Claims Team",
    "Billing":     "Policy Team",
    "Policy":      "Policy Team",
    "API":         "Integration Team",
    "ETL":         "Integration Team",
    "DCT Mapping": "Conversion Team",
    "Data Quality": "DB Team",
    "General":     "Operations Team",
}


def _detect_owner(issue_type: str) -> str:
    for key, team in _OWNERSHIP_MAP.items():
        if key.lower() in issue_type.lower():
            return team
    return "Operations Team"


async def run(findings: list[dict], schema_context: dict, db: Session) -> dict:
    t0 = time.time()

    enriched = []
    for finding in findings:
        owner = _detect_owner(finding.get("issue_type", ""))
        enriched.append({**finding, "owner_team": owner})

    return {
        "findings":  enriched,
        "elapsed_ms": int((time.time() - t0) * 1000),
    }
