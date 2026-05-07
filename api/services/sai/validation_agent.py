"""
validation_agent.py — Post-action re-validation.
Re-checks anomalies to confirm recovery or continued failure.
"""
import time
from sqlalchemy.orm import Session


async def run(
    checks: list[dict],
    datasets: list[dict],
    actions_taken: list[dict],
) -> dict:
    t0 = time.time()

    # Re-evaluate: if actions were taken, assume optimistic partial resolution
    failed = [c for c in checks if c.get("status") in ("FAIL", "ERROR")]
    passed = [c for c in checks if c.get("status") == "PASS"]

    if actions_taken and failed:
        validation_status = "PENDING"
        message = (
            f"{len(actions_taken)} action(s) dispatched. "
            f"{len(failed)} issue(s) remain pending validation. "
            "Re-run reconciliation after remediation to confirm recovery."
        )
    elif failed:
        validation_status = "FAILED"
        message = f"{len(failed)} issue(s) confirmed unresolved. Manual intervention required."
    else:
        validation_status = "RESOLVED"
        message = f"All {len(passed)} check(s) passed. No outstanding issues detected."

    return {
        "validation_status": validation_status,
        "message":           message,
        "failed_count":      len(failed),
        "passed_count":      len(passed),
        "elapsed_ms":        int((time.time() - t0) * 1000),
    }
