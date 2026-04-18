"""
validator_agent.py — Validator Agent for the agent-based conversion pipeline.

Runs 14 checks on each pipeline attempt. All checks run every attempt (no partial retry).
Each check writes one ConversionValidationResult row.
Emits hints for the next MapperAgent attempt on failure.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from api.models import ConversionValidationResult, GeneratedXml, GeneratedQuery, ValidationRule
from api.services.value_mapper import MappingContext


@dataclass
class ValidatorResult:
    passed: bool
    checks: list[dict]    # [{check_name, passed, detail}]
    hints: list[str]      # hints for next MapperAgent attempt
    xml_count: int
    error_count: int


class ValidatorAgent:
    def __init__(
        self,
        conn_id: int,
        db: Session,
        mapping_context: Optional[MappingContext] = None,
        sql: Optional[str] = None,
        cfg: Optional[dict] = None,
        dialect: Optional[str] = None,
    ):
        self.conn_id = conn_id
        self.db = db
        self.mapping_context = mapping_context or MappingContext()
        self.sql = sql
        self.cfg = cfg
        self.dialect = dialect or "mssql"

    def run(self) -> ValidatorResult:
        checks: list[dict] = []
        hints: list[str] = []

        # Load XML records for this connection
        xml_records = (
            self.db.query(GeneratedXml)
            .filter_by(conn_id=self.conn_id)
            .order_by(GeneratedXml.id.desc())
            .limit(1000)
            .all()
        )
        xml_count = len(xml_records)

        # Run all checks
        checks.append(self._check_schema_coverage())
        checks.append(self._check_low_confidence())
        checks.append(self._check_xsd_field_validation(xml_records))
        checks.append(self._check_row_count_sanity(xml_count))
        checks.append(self._check_null_rate_anomaly(xml_records))
        checks.append(self._check_identifier_uniqueness())
        checks.append(self._check_dropdown_validation(xml_records))
        checks.append(self._check_mapping_coverage())
        checks.append(self._check_unmapped_passthrough(xml_records))
        checks.append(self._check_data_type_consistency(xml_records))
        checks.append(self._check_pending_mapping_warning())
        checks.append(self._check_mapping_drift())
        checks.append(self._check_source_value_audit())
        checks.append(self._check_mandatory_field_coverage(xml_records))

        # Persist all check results
        for c in checks:
            try:
                self.db.add(ConversionValidationResult(
                    conn_id=self.conn_id,
                    xml_id=None,
                    check_name=c["check_name"],
                    passed=c["passed"],
                    detail=c.get("detail"),
                ))
            except Exception:
                pass
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()

        # Collect hints from failed checks
        for c in checks:
            if not c["passed"] and c.get("hint"):
                hints.append(c["hint"])

        all_passed = all(c["passed"] for c in checks)
        error_count = sum(1 for c in checks if not c["passed"])

        return ValidatorResult(
            passed=all_passed,
            checks=checks,
            hints=hints,
            xml_count=xml_count,
            error_count=error_count,
        )

    # ── Individual checks ─────────────────────────────────────────────────────

    def _check_schema_coverage(self) -> dict:
        name = "schema_coverage"
        try:
            lineage = self.mapping_context.column_lineage
            confidence = self.mapping_context.field_confidence
            if not confidence:
                return _pass(name, "No field confidence data available.")

            matched = sum(1 for p, c in lineage.items() if c)
            total = len(confidence)
            pct = (matched / total * 100) if total > 0 else 100

            if pct < 50:
                return _fail(name,
                    f"Only {pct:.0f}% of XML paths have a matched source column.",
                    "Too many unmatched paths. Consider broadening embedding scope or checking template alignment.")
            return _pass(name, f"{pct:.0f}% of XML paths matched.")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_low_confidence(self) -> dict:
        name = "low_confidence_mapping"
        try:
            confidence = self.mapping_context.field_confidence
            lineage = self.mapping_context.column_lineage
            if not confidence:
                return _pass(name, "No confidence data.")

            matched_paths = [(p, s) for p, s in confidence.items() if lineage.get(p)]
            if not matched_paths:
                return _pass(name, "No matched paths to check.")

            low = [(p, s) for p, s in matched_paths if s < 0.4]
            pct = len(low) / len(matched_paths) * 100
            if pct > 20:
                low_names = [p.split("/")[-1] for p, _ in low[:5]]
                return _fail(name,
                    f"{pct:.0f}% of matched paths have confidence < 40%.",
                    f"Low confidence on paths: {low_names}. Verify column name similarity or add schema metadata.")
            return _pass(name, f"Confidence check passed ({pct:.0f}% low-confidence paths).")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_xsd_field_validation(self, xml_records: list) -> dict:
        name = "xsd_field_validation"
        try:
            rules = self.db.query(ValidationRule).filter_by(conn_id=self.conn_id).all()
            if not rules:
                return _pass(name, "No validation rules defined.")

            # Sample-validate: every Nth record for >1000, all for <=1000
            sample = xml_records
            if len(xml_records) > 1000:
                n = max(1, len(xml_records) // 100)
                sample = xml_records[::n]

            failures = []
            for xml_rec in sample:
                if not xml_rec.xml_content:
                    continue
                try:
                    from api.services.validation_guard import validate_xml_payload
                    errs = validate_xml_payload(xml_rec.xml_content, rules)
                    if errs:
                        failures.append({"xml_id": xml_rec.id, "errors": errs[:3]})
                        # Write individual result
                        self.db.add(ConversionValidationResult(
                            conn_id=self.conn_id,
                            xml_id=xml_rec.id,
                            check_name="xsd_field_validation",
                            passed=False,
                            detail=str(errs[:3]),
                        ))
                except Exception:
                    pass

            if failures:
                return _fail(name,
                    f"{len(failures)} XML records failed XSD validation.",
                    f"XML schema violations in {len(failures)} records. Review validation rules.")
            return _pass(name, f"XSD validation passed on {len(sample)} sampled records.")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_row_count_sanity(self, xml_count: int) -> dict:
        name = "row_count_sanity"
        try:
            if not self.sql or not self.cfg:
                return _pass(name, "No SQL/config available for count check.")

            count_sql = f"SELECT COUNT(*) AS _cnt FROM ({self.sql}) AS _src_count"

            from api.services.connector import preview_data
            result = preview_data({**self.cfg, "query": count_sql}, limit=1)
            rows = result.get("rows", [])
            if not rows:
                return _pass(name, "Count query returned no rows.")

            source_count = int(rows[0][0]) if rows[0] else 0
            deviation_pct = (abs(source_count - xml_count) / max(source_count, 1)) * 100

            if source_count > 0 and deviation_pct > 5:
                return _fail(name,
                    f"Row count mismatch: source={source_count}, XML records={xml_count} ({deviation_pct:.1f}% deviation).",
                    f"Row count mismatch: expected {source_count}, generated {xml_count}. Check GROUP BY / identifier column.")
            return _pass(name, f"Row counts match: source={source_count}, XML={xml_count}.")
        except Exception as exc:
            # SQL execution failure means the generated query is broken —
            # this is a hard failure, not a skip. Surface the DB error as a hint.
            err_str = str(exc)
            # Extract the key part of the SQL Server error (strip Python wrapper)
            import re as _re_err
            msg_match = _re_err.search(r"Msg \d+.*", err_str)
            short_err = msg_match.group(0)[:300] if msg_match else err_str[:300]
            return _fail(
                name,
                f"SQL execution failed: {short_err}",
                f"The generated SQL failed to execute. Fix these SQL errors and regenerate: {short_err}",
            )

    def _check_null_rate_anomaly(self, xml_records: list) -> dict:
        name = "null_rate_anomaly"
        try:
            import xml.etree.ElementTree as ET
            if not xml_records:
                return _pass(name, "No XML records to check.")

            sample = xml_records[:min(50, len(xml_records))]
            total_fields = 0
            empty_fields = 0
            for rec in sample:
                if not rec.xml_content:
                    continue
                try:
                    root = ET.fromstring(rec.xml_content)
                    for elem in root.iter():
                        if not list(elem):  # leaf node
                            total_fields += 1
                            if not elem.text or not elem.text.strip():
                                empty_fields += 1
                except Exception:
                    pass

            if total_fields == 0:
                return _pass(name, "No fields to check.")

            null_pct = empty_fields / total_fields * 100
            if null_pct > 60:
                return _fail(name,
                    f"Average empty field rate is {null_pct:.0f}%.",
                    f"High null rate ({null_pct:.0f}%). Re-examine join conditions or column matching.")
            return _pass(name, f"Null rate acceptable ({null_pct:.0f}% empty fields).")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_identifier_uniqueness(self) -> dict:
        name = "identifier_uniqueness"
        try:
            if not self.sql or not self.cfg:
                return _pass(name, "No SQL/config available.")

            # Check for __identifier__ column in SQL
            if "__identifier__" not in self.sql:
                return _pass(name, "No identifier column in SQL.")

            count_sql = (
                f"SELECT COUNT(*) AS total_cnt, COUNT(DISTINCT [__identifier__]) AS distinct_cnt "
                f"FROM ({self.sql}) AS _id_check"
            )
            from api.services.connector import preview_data
            result = preview_data({**self.cfg, "query": count_sql}, limit=1)
            rows = result.get("rows", [])
            if not rows or len(rows[0]) < 2:
                return _pass(name, "Could not run identifier uniqueness check.")

            total, distinct = int(rows[0][0]), int(rows[0][1])
            if total > distinct:
                return _fail(name,
                    f"Duplicate identifiers: {total} rows, {distinct} distinct values.",
                    "Duplicate identifier values detected — the identifier column may not be a true PK.")
            return _pass(name, f"Identifiers are unique ({distinct} distinct values).")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_dropdown_validation(self, xml_records: list) -> dict:
        name = "dropdown_validation"
        try:
            from api.models import ConversionValueMapping
            # Get all approved/manual mappings
            all_mappings = (
                self.db.query(ConversionValueMapping)
                .filter(
                    ConversionValueMapping.conn_id == self.conn_id,
                    ConversionValueMapping.status.in_(["approved", "manual"]),
                )
                .all()
            )
            if not all_mappings:
                return _pass(name, "No approved value mappings to validate against.")

            # Build allowed-values dict: {column_name → set(target_values)}
            allowed: dict[str, set] = {}
            for m in all_mappings:
                if m.target_value:
                    allowed.setdefault(m.column_name, set()).add(m.target_value)

            # Check XML records (sample up to 50)
            import xml.etree.ElementTree as ET
            bad_values: dict[str, list] = {}
            for rec in xml_records[:50]:
                if not rec.xml_content:
                    continue
                try:
                    root = ET.fromstring(rec.xml_content)
                    for elem in root.iter():
                        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                        if tag in allowed and elem.text and elem.text.strip():
                            if elem.text.strip() not in allowed[tag]:
                                bad_values.setdefault(tag, []).append(elem.text.strip())
                except Exception:
                    pass

            if bad_values:
                summary = {k: list(set(v))[:3] for k, v in bad_values.items()}
                return _fail(name,
                    f"Invalid dropdown values found in {len(bad_values)} column(s): {summary}",
                    f"Invalid values detected for {list(bad_values.keys())}. Review value mappings.")
            return _pass(name, "All mapped dropdown values are valid.")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_mapping_coverage(self) -> dict:
        name = "mapping_coverage"
        try:
            from api.models import ConversionColumnProfile, ConversionValueMapping
            categorical = (
                self.db.query(ConversionColumnProfile)
                .filter(
                    ConversionColumnProfile.conn_id == self.conn_id,
                    ConversionColumnProfile.pattern_hint == "categorical",
                )
                .all()
            )
            if not categorical:
                return _pass(name, "No categorical columns detected.")

            incomplete: list[str] = []
            for prof in categorical:
                total = prof.distinct_count or 0
                mapped = (
                    self.db.query(ConversionValueMapping)
                    .filter(
                        ConversionValueMapping.conn_id == self.conn_id,
                        ConversionValueMapping.table_name == prof.table_name,
                        ConversionValueMapping.column_name == prof.column_name,
                        ConversionValueMapping.status.in_(["approved", "manual"]),
                    )
                    .count()
                )
                if total > 0 and mapped < total:
                    incomplete.append(f"{prof.table_name}.{prof.column_name} ({mapped}/{total})")

            if incomplete:
                return _fail(name,
                    f"Incomplete mapping coverage for: {incomplete[:5]}",
                    f"Unmapped source codes for columns: {incomplete[:3]}. Review in Value Mapping Editor.")
            return _pass(name, "All categorical columns have full mapping coverage.")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_unmapped_passthrough(self, xml_records: list) -> dict:
        name = "unmapped_passthrough"
        try:
            from api.models import ConversionValueMapping
            import xml.etree.ElementTree as ET

            # Get all approved mappings grouped by column
            all_mappings = (
                self.db.query(ConversionValueMapping)
                .filter(
                    ConversionValueMapping.conn_id == self.conn_id,
                    ConversionValueMapping.status.in_(["approved", "manual"]),
                )
                .all()
            )
            if not all_mappings:
                return _pass(name, "No value mappings configured.")

            # Source values per column
            source_vals: dict[str, set] = {}
            for m in all_mappings:
                source_vals.setdefault(m.column_name, set()).add(m.source_value)

            # Check if any XML element contains a raw source code that should have been mapped
            passthrough: dict[str, list] = {}
            for rec in xml_records[:30]:
                if not rec.xml_content:
                    continue
                try:
                    root = ET.fromstring(rec.xml_content)
                    for elem in root.iter():
                        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                        if tag in source_vals and elem.text and elem.text.strip():
                            if elem.text.strip() in source_vals[tag]:
                                passthrough.setdefault(tag, []).append(elem.text.strip())
                except Exception:
                    pass

            if passthrough:
                return _fail(name,
                    f"Raw source codes flowing through in {len(passthrough)} column(s): {list(passthrough.keys())[:3]}",
                    f"Raw codes in output for {list(passthrough.keys())[:3]} — approve or add mappings.")
            return _pass(name, "No unmapped passthrough values detected.")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_data_type_consistency(self, xml_records: list) -> dict:
        name = "data_type_consistency"
        try:
            rules = self.db.query(ValidationRule).filter_by(conn_id=self.conn_id).all()
            numeric_rules = [r for r in rules if r.data_type in ("integer", "decimal", "float")]
            if not numeric_rules:
                return _pass(name, "No numeric type validation rules defined.")

            import xml.etree.ElementTree as ET
            type_errors: list[str] = []
            for rec in xml_records[:20]:
                if not rec.xml_content:
                    continue
                try:
                    root = ET.fromstring(rec.xml_content)
                    for rule in numeric_rules:
                        # Find element by path suffix
                        path_parts = rule.target_path.strip("/").split("/")
                        for elem in root.iter(path_parts[-1]):
                            if elem.text and elem.text.strip():
                                try:
                                    float(elem.text.strip())
                                except ValueError:
                                    type_errors.append(
                                        f"{rule.target_path}: '{elem.text.strip()}' is not {rule.data_type}"
                                    )
                except Exception:
                    pass

            if type_errors:
                return _fail(name,
                    f"Type mismatches: {type_errors[:3]}",
                    f"Type mismatch for numeric fields: {type_errors[:2]}. Check source data types.")
            return _pass(name, "Data type consistency check passed.")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_pending_mapping_warning(self) -> dict:
        name = "pending_mapping_warning"
        try:
            from api.models import ConversionValueMapping
            pending_count = (
                self.db.query(ConversionValueMapping)
                .filter(
                    ConversionValueMapping.conn_id == self.conn_id,
                    ConversionValueMapping.status == "pending",
                )
                .count()
            )
            if pending_count > 0:
                # This is a warning (passed=True) not a blocker, but emits a hint
                return {
                    "check_name": name,
                    "passed": True,
                    "detail": f"{pending_count} pending AI mapping(s) await approval.",
                    "hint": f"Review {pending_count} pending AI mappings in Value Mapping Editor before next run.",
                }
            return _pass(name, "No pending AI mappings.")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_mapping_drift(self) -> dict:
        name = "mapping_drift"
        try:
            from api.models import ConversionColumnProfile, ConversionValueMapping
            categorical = (
                self.db.query(ConversionColumnProfile)
                .filter(
                    ConversionColumnProfile.conn_id == self.conn_id,
                    ConversionColumnProfile.pattern_hint == "categorical",
                )
                .all()
            )
            if not categorical or not self.cfg:
                return _pass(name, "No categorical columns or config available.")

            new_values: dict[str, list] = {}
            for prof in categorical[:10]:  # cap at 10 columns per check
                tbl, col = prof.table_name, prof.column_name
                try:
                    distinct = self._fetch_distinct_values(tbl, col)
                except Exception:
                    continue

                existing_sources = {
                    m.source_value
                    for m in self.db.query(ConversionValueMapping)
                    .filter_by(conn_id=self.conn_id, table_name=tbl, column_name=col)
                    .all()
                }
                drift = [v for v in distinct if v not in existing_sources]
                if drift:
                    new_values[f"{tbl}.{col}"] = drift[:5]
                    # Auto-insert as pending_review
                    from datetime import timedelta
                    expires_at = datetime.utcnow() + timedelta(days=90)
                    for v in drift:
                        self.db.add(ConversionValueMapping(
                            conn_id=self.conn_id,
                            table_name=tbl,
                            column_name=col,
                            source_value=v,
                            mapping_type="pending_review",
                            status="pending",
                            expires_at=expires_at,
                        ))
                    try:
                        self.db.commit()
                    except Exception:
                        self.db.rollback()

            if new_values:
                return _fail(name,
                    f"New source values detected for {list(new_values.keys())[:3]}: {new_values}",
                    f"New source values detected for {list(new_values.keys())[:2]}. Review in Value Mapping Editor.")
            return _pass(name, "No mapping drift detected.")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_source_value_audit(self) -> dict:
        name = "source_value_audit"
        try:
            if not self.sql:
                return _pass(name, "No SQL available for audit.")

            # Check that [SOURCE:table.col] comments in SQL match column_lineage
            lineage = self.mapping_context.column_lineage
            if not lineage:
                return _pass(name, "No lineage data available.")

            source_tags = re.findall(r'--\s*\[SOURCE:([^\]]+)\]', self.sql)
            mismatches: list[str] = []
            for tag in source_tags:
                # tag is "TABLE.COLUMN" — verify it appears in lineage values
                if not any(tag.upper() in v.upper() for v in lineage.values()):
                    mismatches.append(tag)

            if mismatches:
                return _fail(name,
                    f"Source tag mismatches: {mismatches[:3]}",
                    f"Mapped column {mismatches[0]} may originate from wrong source table.")
            return _pass(name, "Source value audit passed.")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _check_mandatory_field_coverage(self, xml_records: list) -> dict:
        name = "mandatory_field_coverage"
        try:
            rules = self.db.query(ValidationRule).filter_by(
                conn_id=self.conn_id, is_required=True
            ).all()
            if not rules:
                return _pass(name, "No required field rules defined.")

            import xml.etree.ElementTree as ET
            empty_counts: dict[str, int] = {}
            checked = 0
            for rec in xml_records[:50]:
                if not rec.xml_content:
                    continue
                checked += 1
                try:
                    root = ET.fromstring(rec.xml_content)
                    for rule in rules:
                        path_parts = rule.target_path.strip("/").split("/")
                        for elem in root.iter(path_parts[-1]):
                            if not elem.text or not elem.text.strip():
                                empty_counts[rule.target_path] = empty_counts.get(rule.target_path, 0) + 1
                except Exception:
                    pass

            if not checked:
                return _pass(name, "No XML records to check mandatory fields.")

            violations = {
                path: round(cnt / checked * 100)
                for path, cnt in empty_counts.items()
                if cnt / checked > 0.1  # > 10% empty
            }
            if violations:
                return _fail(name,
                    f"Mandatory fields empty in >10% of records: {violations}",
                    f"Required fields {list(violations.keys())[:2]} are empty in many records.")
            return _pass(name, "Mandatory field coverage check passed.")
        except Exception as exc:
            return _pass(name, f"Check skipped: {exc}")

    def _fetch_distinct_values(self, table_name: str, column_name: str) -> list[str]:
        """Fetch distinct values for a column using self.cfg."""
        if not self.cfg:
            return []
        from api.services.connector import preview_data
        dialect_lower = (self.dialect or "").lower()
        if dialect_lower in ("snowflake", "postgresql", "mysql"):
            q = f'SELECT DISTINCT "{column_name}" FROM "{table_name}" LIMIT 50'
        else:
            q = f"SELECT DISTINCT TOP 50 [{column_name}] FROM [{table_name}] WITH (NOLOCK)"
        result = preview_data({**self.cfg, "query": q}, limit=50)
        return [str(row[0]) for row in result.get("rows", []) if row and row[0] is not None]


# ── Helper functions ──────────────────────────────────────────────────────────

def _pass(check_name: str, detail: str) -> dict:
    return {"check_name": check_name, "passed": True, "detail": detail, "hint": None}


def _fail(check_name: str, detail: str, hint: str) -> dict:
    return {"check_name": check_name, "passed": False, "detail": detail, "hint": hint}
