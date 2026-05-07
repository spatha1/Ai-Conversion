"""
action_agent.py — Dispatches autonomous actions (email, ticket stubs, ETL retry).
Mode-gated: manual = no actions; assisted = queue for approval; autonomous = execute.
"""
import json
import time
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session

from api.models import SaiApprovalQueue, SaiFinding


_CRITICAL_SEVERITIES = {"CRITICAL", "HIGH"}


def _should_act(severity: str, mode: str) -> bool:
    return severity in _CRITICAL_SEVERITIES and mode in ("assisted", "autonomous")


def _build_email_payload(finding: dict) -> dict:
    team = finding.get("owner_team", "Operations Team")
    return {
        "to":      f"{team.lower().replace(' ', '-')}@enterprise.com",
        "subject": f"SAI Alert [{finding.get('severity')}]: {finding.get('issue_type')} — {finding.get('system_impacted', 'Unknown System')}",
        "body":    f"SAI has detected a {finding.get('severity')} severity issue.\n\n"
                   f"Type: {finding.get('issue_type')}\n"
                   f"System: {finding.get('system_impacted')}\n"
                   f"Description: {finding.get('description')}\n\n"
                   f"Please investigate immediately.",
    }


def _build_ticket_payload(finding: dict) -> dict:
    return {
        "system":      "ADO",
        "title":       f"[SAI] {finding.get('issue_type')}: {finding.get('system_impacted')}",
        "description": finding.get("description", ""),
        "severity":    finding.get("severity"),
        "team":        finding.get("owner_team"),
    }


async def run(
    findings: list[dict],
    mode: str,
    run_id: int,
    allowed_actions: Optional[dict],
    db: Session,
) -> dict:
    t0 = time.time()
    if allowed_actions is None:
        allowed_actions = {"email": True, "ticket": True, "etl_retry": False}

    actions_taken = []
    approval_items = []

    for f in findings:
        severity = f.get("severity", "LOW")
        if not _should_act(severity, mode):
            continue

        finding_id = f.get("id")

        # Email action
        if allowed_actions.get("email", True):
            email_payload = _build_email_payload(f)
            if mode == "autonomous":
                # In production: send real email via SMTP. Stub for now.
                actions_taken.append({
                    "type":    "email_sent",
                    "to":      email_payload["to"],
                    "subject": email_payload["subject"],
                    "status":  "dispatched",
                    "note":    "stub — wire to SMTP settings",
                })
            elif mode == "assisted":
                queue_item = SaiApprovalQueue(
                    run_id=run_id,
                    finding_id=finding_id,
                    action_type="send_email",
                    action_payload_json=json.dumps(email_payload),
                    status="pending",
                )
                db.add(queue_item)
                approval_items.append({
                    "action_type": "send_email",
                    "payload":     email_payload,
                })

        # Ticket action
        if allowed_actions.get("ticket", True):
            ticket_payload = _build_ticket_payload(f)
            if mode == "autonomous":
                actions_taken.append({
                    "type":    "ticket_created",
                    "system":  ticket_payload["system"],
                    "title":   ticket_payload["title"],
                    "status":  "dispatched",
                    "note":    "stub — wire to ADO/JIRA integration",
                })
            elif mode == "assisted":
                queue_item = SaiApprovalQueue(
                    run_id=run_id,
                    finding_id=finding_id,
                    action_type="create_ticket",
                    action_payload_json=json.dumps(ticket_payload),
                    status="pending",
                )
                db.add(queue_item)
                approval_items.append({
                    "action_type": "create_ticket",
                    "payload":     ticket_payload,
                })

    if approval_items or actions_taken:
        db.commit()

    return {
        "actions_taken":  actions_taken,
        "approval_items": approval_items,
        "elapsed_ms":     int((time.time() - t0) * 1000),
    }
