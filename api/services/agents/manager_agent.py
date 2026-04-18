"""
manager_agent.py — Manager Agent for the agent-based conversion pipeline.

Orchestrates: DataProfiler → MapperAgent → TransformerAgent → ValidatorAgent
Runs up to max_attempts, passing validator hints back to MapperAgent on retry.
Logs each agent invocation to ConversionAgentRunLog.
Creates a ConversionQueryVersion on completion.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from api.models import (
    ConversionAgentRunLog, ConversionQueryVersion, ConversionColumnProfile,
    SourceConnection, WorkflowExecution, WorkflowExecutionStep, GeneratedXml,
)
from api.services.profiler import profile_connection, get_cached_profiles, profiles_are_stale
from api.services.agents.mapper_agent import MapperAgent, MapperResult
from api.services.agents.transformer_agent import TransformerAgent
from api.services.agents.validator_agent import ValidatorAgent


@dataclass
class ManagerResult:
    status: str                          # "success" | "failed" | "partial"
    attempts: int
    sql: Optional[str]
    mapping_snapshot: Optional[list[dict]]
    xml_records: list[dict]
    validation_summary: dict
    run_log_id: Optional[int]
    version: int
    errors: list[str] = field(default_factory=list)


class ManagerAgent:
    def __init__(self, conn_id: int, db: Session):
        self.conn_id = conn_id
        self.db = db
        self._run_start = datetime.utcnow()

    def run(self, max_attempts: int = 3, initial_hints: Optional[list[str]] = None) -> ManagerResult:
        errors: list[str] = []

        # ── Create WorkflowExecution for UI tracking ──────────────
        workflow_exec = WorkflowExecution(
            conn_id=self.conn_id,
            user_query=f"Agent-based conversion pipeline for conn_id={self.conn_id}",
            model="gpt-4o-mini",
            status="running",
            total_steps=max_attempts * 3,  # mapper + transformer + validator per attempt
            completed_steps=0,
        )
        self.db.add(workflow_exec)
        self.db.flush()
        exec_id = workflow_exec.id

        # ── Log manager start ─────────────────────────────────────
        manager_log_id = self._log_start("manager", attempt=1)

        # ── Load connection ───────────────────────────────────────
        src: Optional[SourceConnection] = self.db.query(SourceConnection).get(self.conn_id)
        if not src:
            self._log_end(manager_log_id, "failed", f"Connection {self.conn_id} not found.", 0)
            return ManagerResult(
                status="failed", attempts=0, sql=None, mapping_snapshot=None,
                xml_records=[], validation_summary={}, run_log_id=manager_log_id,
                version=0, errors=[f"Connection {self.conn_id} not found."],
            )

        cfg = self._build_cfg(src)
        dialect = src.dialect or "mssql"

        # ── Step 1: Profile if stale ──────────────────────────────
        if profiles_are_stale(self.conn_id, self.db):
            try:
                profile_connection(self.conn_id, self.db, cfg, dialect)
            except Exception as exc:
                errors.append(f"Profiling warning: {exc}")

        # ── Step 2: Categorical detection ─────────────────────────
        self._update_categorical_flags()

        # ── Step 3: Agent loop ────────────────────────────────────
        previous_hints: list[str] = list(initial_hints or [])
        last_mapper_result: Optional[MapperResult] = None
        last_validator_result = None
        attempt = 0

        for attempt in range(1, max_attempts + 1):
            step_base = (attempt - 1) * 3

            # ── Mapper ──────────────────────────────────────────
            mapper_log_id = self._log_start("mapper", attempt=attempt)
            self._add_workflow_step(exec_id, step_base + 1, "mapper", attempt, "running")

            mapper = MapperAgent(self.conn_id, self.db, hints=previous_hints)
            mapper_result = mapper.run()
            last_mapper_result = mapper_result

            duration_ms = int((datetime.now() - self._run_start).total_seconds() * 1000)
            self._log_end(mapper_log_id, mapper_result.status,
                         json.dumps({"sql_preview": (mapper_result.sql or "")[:200]}),
                         duration_ms)
            self._update_workflow_step(exec_id, step_base + 1, mapper_result.status)
            workflow_exec.completed_steps += 1

            if mapper_result.status == "failed":
                errors.extend(mapper_result.errors)
                continue

            # ── Transformer ──────────────────────────────────────
            transformer_log_id = self._log_start("transformer", attempt=attempt)
            self._add_workflow_step(exec_id, step_base + 2, "transformer", attempt, "running")

            transformer = TransformerAgent(
                self.conn_id, self.db, mapper_result, mapper_result.mapping_context
            )
            transformer_result = transformer.run()

            self._log_end(transformer_log_id, transformer_result.status, "", duration_ms)
            self._update_workflow_step(exec_id, step_base + 2, transformer_result.status)
            workflow_exec.completed_steps += 1

            # ── Validator ────────────────────────────────────────
            validator_log_id = self._log_start("validator", attempt=attempt)
            self._add_workflow_step(exec_id, step_base + 3, "validator", attempt, "running")

            validator = ValidatorAgent(
                conn_id=self.conn_id,
                db=self.db,
                mapping_context=mapper_result.mapping_context,
                sql=mapper_result.sql,
                cfg=cfg,
                dialect=dialect,
            )
            validator_result = validator.run()
            last_validator_result = validator_result

            self._log_end(
                validator_log_id,
                "success" if validator_result.passed else "failed",
                json.dumps({"checks_failed": validator_result.error_count}),
                duration_ms,
            )
            self._update_workflow_step(exec_id, step_base + 3,
                                       "success" if validator_result.passed else "failed")
            workflow_exec.completed_steps += 1

            if validator_result.passed:
                break

            previous_hints = validator_result.hints

        # ── Save version ──────────────────────────────────────────
        version = 1
        if last_mapper_result and last_mapper_result.sql:
            max_ver = (
                self.db.query(ConversionQueryVersion)
                .filter_by(conn_id=self.conn_id)
                .order_by(ConversionQueryVersion.version.desc())
                .first()
            )
            version = (max_ver.version + 1) if max_ver else 1
            # Store column_lineage + confidence in snapshot (more useful than raw row data)
            if last_mapper_result.mapping_context:
                ctx = last_mapper_result.mapping_context
                snapshot = json.dumps({
                    "column_lineage":   ctx.column_lineage,
                    "field_confidence": ctx.field_confidence,
                    "identifier_column": last_mapper_result.identifier_column,
                    "identifier_table":  last_mapper_result.identifier_table,
                })
            else:
                snapshot = None
            self.db.add(ConversionQueryVersion(
                conn_id=self.conn_id,
                version=version,
                sql_text=last_mapper_result.sql,
                mapping_snapshot=snapshot,
                agent_run_id=manager_log_id,
            ))

        # ── XML upsert idempotency ────────────────────────────────
        xml_records = self._list_xml_records()

        # ── Finalize workflow execution ───────────────────────────
        final_status = "success" if (last_validator_result and last_validator_result.passed) else (
            "partial" if last_mapper_result and last_mapper_result.sql else "failed"
        )
        workflow_exec.status = final_status
        workflow_exec.final_summary = (
            f"Completed {attempt} attempt(s). "
            f"Validation: {'passed' if (last_validator_result and last_validator_result.passed) else 'failed'}."
        )
        workflow_exec.finished_at = datetime.utcnow()

        validation_summary = {}
        if last_validator_result:
            validation_summary = {
                "passed": last_validator_result.passed,
                "checks": [
                    {"name": c["check_name"], "passed": c["passed"]}
                    for c in last_validator_result.checks
                ],
                "xml_count": last_validator_result.xml_count,
            }

        duration_total = int((datetime.utcnow() - self._run_start).total_seconds() * 1000)
        self._log_end(manager_log_id, final_status,
                     json.dumps({"version": version, "attempts": attempt}),
                     duration_total)

        try:
            self.db.commit()
        except Exception as exc:
            errors.append(f"DB commit warning: {exc}")
            self.db.rollback()

        return ManagerResult(
            status=final_status,
            attempts=attempt,
            sql=last_mapper_result.sql if last_mapper_result else None,
            mapping_snapshot=last_mapper_result.row_data if last_mapper_result else None,
            xml_records=xml_records,
            validation_summary=validation_summary,
            run_log_id=manager_log_id,
            version=version,
            errors=errors,
        )

    # ── Helpers ───────────────────────────────────────────────────

    def _build_cfg(self, src: SourceConnection) -> dict:
        from api.services.encryption import decrypt
        return {
            "source_type": src.source_type,
            "dialect":     src.dialect,
            "host":        src.host,
            "port":        src.port,
            "database":    src.database_name,
            "schema":      src.schema_name,
            "username":    src.username,
            "password":    decrypt(src.password_enc) if src.password_enc else "",
        }

    def _update_categorical_flags(self) -> None:
        """Update pattern_hint to 'categorical' for low-distinct, non-numeric columns."""
        try:
            rows = (
                self.db.query(ConversionColumnProfile)
                .filter(
                    ConversionColumnProfile.conn_id == self.conn_id,
                    ConversionColumnProfile.pattern_hint.notin_(["numeric", "free_text", "categorical"]),
                )
                .all()
            )
            for row in rows:
                if row.distinct_count is not None and row.distinct_count < 10:
                    row.pattern_hint = "categorical"
            self.db.flush()
        except Exception:
            pass

    def _log_start(self, agent_name: str, attempt: int) -> int:
        log = ConversionAgentRunLog(
            conn_id=self.conn_id,
            agent_name=agent_name,
            attempt=attempt,
            status="running",
        )
        self.db.add(log)
        self.db.flush()
        return log.id

    def _log_end(self, log_id: int, status: str, output_summary: str, duration_ms: int) -> None:
        log = self.db.query(ConversionAgentRunLog).get(log_id)
        if log:
            log.status = status
            log.output_summary = output_summary
            log.duration_ms = duration_ms
        self.db.flush()

    def _add_workflow_step(self, exec_id: int, step_number: int,
                           agent_name: str, iteration: int, status: str) -> None:
        step = WorkflowExecutionStep(
            execution_id=exec_id,
            step_number=step_number,
            card_name=agent_name.capitalize() + " Agent",
            agent_name=agent_name,
            iteration=iteration,
            status=status,
        )
        self.db.add(step)
        self.db.flush()

    def _update_workflow_step(self, exec_id: int, step_number: int, status: str) -> None:
        step = (
            self.db.query(WorkflowExecutionStep)
            .filter_by(execution_id=exec_id, step_number=step_number)
            .first()
        )
        if step:
            step.status = status
            step.execution_time_ms = int(
                (datetime.utcnow() - self._run_start).total_seconds() * 1000
            )
        self.db.flush()

    def _list_xml_records(self) -> list[dict]:
        records = (
            self.db.query(GeneratedXml)
            .filter_by(conn_id=self.conn_id)
            .order_by(GeneratedXml.id.desc())
            .limit(100)
            .all()
        )
        return [
            {"id": r.id, "identifier_value": r.identifier_value, "generated_at": str(r.generated_at)}
            for r in records
        ]
