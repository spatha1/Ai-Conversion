"""
api/services/debug_collector.py

DebugSession — per-request debug step collector for the AI observability framework.

Usage in a router:
    session = get_debug_session("development", db)

    session.add_step("context_assembly", "Context Assembly",
        input_data={"conn_id": 5},
        output_data={"tables_loaded": 12},
        duration_ms=34,
    )

    # In response:
    return {**payload, "debug": session.to_response() if session.enabled else None}

    # Persist to DB when level is ADVANCED:
    session.persist(db, conn_id=5)
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Optional

# Max characters for any single string field in debug output.
# Keeps payloads bounded and prevents accidental full-prompt leakage.
MAX_FIELD_CHARS = 2000

# Keys whose values are always redacted regardless of content.
_SENSITIVE_KEYS = {"password", "token", "key", "secret", "api_key", "auth", "credential"}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _truncate_dict(d: dict) -> dict:
    """
    Recursively truncate long strings and redact sensitive keys.
    Leaves non-string values (int, float, bool, list, None) untouched.
    """
    if not isinstance(d, dict):
        return d
    result: dict = {}
    for k, v in d.items():
        if k.lower() in _SENSITIVE_KEYS:
            result[k] = "[REDACTED]"
        elif isinstance(v, str) and len(v) > MAX_FIELD_CHARS:
            result[k] = v[:MAX_FIELD_CHARS] + f"… [truncated, {len(v)} chars total]"
        elif isinstance(v, dict):
            result[k] = _truncate_dict(v)
        elif isinstance(v, list):
            result[k] = [_truncate_dict(i) if isinstance(i, dict) else i for i in v]
        else:
            result[k] = v
    return result


# ── DebugSession ───────────────────────────────────────────────────────────────

@dataclass
class DebugSession:
    """
    Request-scoped debug step collector.

    Instantiated once per request via get_debug_session().
    Threaded through service/router functions as a keyword argument.
    add_step() is a no-op when self.enabled is False, so callers need
    no conditional logic — just always call it.
    """
    module:   str
    level:    str                                          # "OFF" | "BASIC" | "ADVANCED"
    trace_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    steps:    list = field(default_factory=list)

    @property
    def enabled(self) -> bool:
        return self.level != "OFF"

    def add_step(
        self,
        step: str,
        label: str,
        input_data:    Optional[dict] = None,
        output_data:   Optional[dict] = None,
        duration_ms:   Optional[int]  = None,
        template_used: Optional[dict] = None,
        status:        str = "success",
        error:         Optional[dict] = None,
    ) -> None:
        """
        Append a processing step to this session.

        step:          machine identifier  e.g. "context_assembly"
        label:         human label         e.g. "Context Assembly"
        input_data:    what went in  (truncated + redacted automatically)
        output_data:   what came out (truncated + redacted automatically)
        duration_ms:   wall-clock ms for this step (None = not measured)
        template_used: {"category": str, "name": str} when a DB template was used, else None
        status:        "success" | "error"
        error:         {"type": str, "message": str, "step": str} on failure
        """
        if not self.enabled:
            return
        self.steps.append({
            "step":          step,
            "label":         label,
            "input":         _truncate_dict(input_data  or {}),
            "output":        _truncate_dict(output_data or {}),
            "duration_ms":   duration_ms,
            "template_used": template_used,
            "status":        status,
            "error":         error,
        })

    def to_response(self) -> dict:
        """Serialisable payload included in API responses."""
        return {
            "trace_id":    self.trace_id,
            "debug_level": self.level,
            "steps":       self.steps,
        }

    def persist(self, db, conn_id: Optional[int] = None) -> None:
        """
        Write full step trace to conversion_debug_traces.
        Only fires when level == "ADVANCED". Swallows all errors
        so a logging failure never breaks the endpoint.
        """
        if self.level != "ADVANCED" or not self.steps:
            return
        try:
            import json
            from api.models import DebugTrace
            db.add(DebugTrace(
                trace_id=self.trace_id,
                module=self.module,
                conn_id=conn_id,
                debug_level=self.level,
                steps_json=json.dumps(self.steps, ensure_ascii=False, default=str),
            ))
            db.commit()
        except Exception:
            pass


# ── Factory ────────────────────────────────────────────────────────────────────

def get_debug_session(module: str, db) -> DebugSession:
    """
    One DB query. Returns a DebugSession with the correct level for the module.
    Falls back to OFF on any error so it never disrupts the request.
    """
    try:
        from api.models import DebugSetting
        row = db.query(DebugSetting).filter(DebugSetting.module == module).first()
        level = (row.debug_level or "OFF") if row else "OFF"
        if level not in ("OFF", "BASIC", "ADVANCED"):
            level = "OFF"
    except Exception:
        level = "OFF"
    return DebugSession(module=module, level=level)
