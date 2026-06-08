"""
api/routers/transformation_intelligence.py
REST API for the Transformation Intelligence module.
Prefix: /api/transformation-intelligence
Auth:   require_developer on all endpoints
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.dependencies import require_developer, get_current_user
from api.models import (
    TransformationRule, RuleSet, RuleSetRule, TransformationPipeline,
    TransformationPipelineStep, RuleTestCase, RuleSimulationLog, RuleValidationIssue,
    MappingRow, MappingRowTransformation, Mapping,
)
import api.services.transformation_service as svc

router = APIRouter(prefix="/transformation-intelligence", dependencies=[Depends(require_developer)])


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class RuleCreate(BaseModel):
    conn_id: Optional[int] = None
    rule_name: str
    description: Optional[str] = None
    category: str = "DirectMapping"
    execution_stage: str = "Transform"
    stage_order: int = 0
    priority: int = 0
    condition_json: Optional[str] = None
    transformation_json: Optional[str] = None
    source_object: Optional[str] = None
    source_column: Optional[str] = None
    target_object: Optional[str] = None
    target_path: Optional[str] = None
    tags_json: Optional[str] = None
    created_by: Optional[str] = None

class RuleUpdate(BaseModel):
    rule_name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    execution_stage: Optional[str] = None
    stage_order: Optional[int] = None
    priority: Optional[int] = None
    condition_json: Optional[str] = None
    transformation_json: Optional[str] = None
    source_object: Optional[str] = None
    source_column: Optional[str] = None
    target_object: Optional[str] = None
    target_path: Optional[str] = None
    tags_json: Optional[str] = None
    is_active: Optional[bool] = None
    approval_status: Optional[str] = None

class RuleSetCreate(BaseModel):
    conn_id: Optional[int] = None
    name: str
    description: Optional[str] = None
    set_type: Optional[str] = None
    created_by: Optional[str] = None

class RuleSetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    set_type: Optional[str] = None
    is_active: Optional[bool] = None

class PipelineCreate(BaseModel):
    conn_id: Optional[int] = None
    name: str
    description: Optional[str] = None
    created_by: Optional[str] = None

class PipelineUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class PipelineStepCreate(BaseModel):
    step_number: int
    step_name: str
    execution_stage: str = "Transform"
    rule_set_id: Optional[int] = None
    rule_id: Optional[int] = None
    description: Optional[str] = None

class PipelineStepUpdate(BaseModel):
    step_name: Optional[str] = None
    execution_stage: Optional[str] = None
    rule_set_id: Optional[int] = None
    rule_id: Optional[int] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class TestCaseCreate(BaseModel):
    rule_id: int
    conn_id: Optional[int] = None
    test_name: str
    description: Optional[str] = None
    input_json: Optional[str] = None
    expected_output_json: Optional[str] = None
    created_by: Optional[str] = None

class TestCaseUpdate(BaseModel):
    test_name: Optional[str] = None
    description: Optional[str] = None
    input_json: Optional[str] = None
    expected_output_json: Optional[str] = None

class DiscoverRequest(BaseModel):
    conn_id: int
    mapping_id: Optional[int] = None
    use_knowledge: bool = True
    max_rules: int = 15

class ParseNLRequest(BaseModel):
    natural_language: str
    conn_id: Optional[int] = None

class KBExtractRequest(BaseModel):
    query: str
    conn_id: Optional[int] = None
    top_k: int = 5

class SimulateRequest(BaseModel):
    rule_id: int
    input_records: list[dict]
    conn_id: Optional[int] = None

class ValidateRequest(BaseModel):
    rule_id: Optional[int] = None
    conn_id: Optional[int] = None

class ExportRequest(BaseModel):
    conn_id: int
    format: str = "sql_server"  # sql_server|snowflake|python|json|xml
    rule_ids: Optional[list[int]] = None

class ReconRequest(BaseModel):
    conn_id: int
    rule_ids: Optional[list[int]] = None

class LookupRequest(BaseModel):
    conn_id: int
    table_name: str
    column_name: str

class LookupBatchRequest(BaseModel):
    conn_id: int


# ── Helpers ────────────────────────────────────────────────────────────────────

def _rule_out(r: TransformationRule) -> dict:
    return svc._rule_to_dict(r)


def _get_rule_or_404(rule_id: int, db: Session) -> TransformationRule:
    rule = db.query(TransformationRule).filter(TransformationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


# ══════════════════════════════════════════════════════════════════════════════
# Rule Repository CRUD
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/rules")
def list_rules(
    conn_id: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    execution_stage: Optional[str] = Query(None),
    approval_status: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    ai_generated: Optional[bool] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    db: Session = Depends(get_db),
):
    q = db.query(TransformationRule)
    if conn_id is not None:
        q = q.filter(TransformationRule.conn_id == conn_id)
    if category:
        q = q.filter(TransformationRule.category == category)
    if execution_stage:
        q = q.filter(TransformationRule.execution_stage == execution_stage)
    if approval_status:
        q = q.filter(TransformationRule.approval_status == approval_status)
    if is_active is not None:
        q = q.filter(TransformationRule.is_active == is_active)
    if ai_generated is not None:
        q = q.filter(TransformationRule.ai_generated == ai_generated)
    q = q.order_by(TransformationRule.execution_stage, TransformationRule.stage_order, TransformationRule.id.desc())
    total = q.count()
    rules = q.offset(offset).limit(limit).all()
    return {"total": total, "items": [_rule_out(r) for r in rules]}


@router.post("/rules", status_code=201)
def create_rule(data: RuleCreate, db: Session = Depends(get_db)):
    rule = TransformationRule(**data.model_dump())
    db.add(rule)
    db.flush()  # get rule.id before auto-linking

    # Auto-link: find any existing MappingRows for this conn_id + source_column
    # so UI chips appear immediately without needing to re-run Step 3.
    if rule.conn_id and rule.source_column:
        linked_rows = (
            db.query(MappingRow)
            .join(Mapping, MappingRow.mapping_id == Mapping.id)
            .filter(
                Mapping.conn_id == rule.conn_id,
                Mapping.is_active == True,
                MappingRow.source_column == rule.source_column,
            )
            .all()
        )
        for mr in linked_rows:
            already = db.query(MappingRowTransformation).filter(
                MappingRowTransformation.mapping_row_id == mr.id,
                MappingRowTransformation.rule_id == rule.id,
            ).first()
            if not already:
                db.add(MappingRowTransformation(
                    mapping_row_id=mr.id,
                    rule_id=rule.id,
                    execution_order=0,
                    discovery_source="user",
                ))

    db.commit()
    db.refresh(rule)
    return _rule_out(rule)


@router.get("/rules/{rule_id}")
def get_rule(rule_id: int, db: Session = Depends(get_db)):
    return _rule_out(_get_rule_or_404(rule_id, db))


@router.put("/rules/{rule_id}")
def update_rule(rule_id: int, data: RuleUpdate, db: Session = Depends(get_db)):
    rule = _get_rule_or_404(rule_id, db)
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        return _rule_out(rule)

    # Version bump: create new row, mark old as inactive
    new_rule = TransformationRule(
        conn_id=rule.conn_id,
        rule_name=updates.get("rule_name", rule.rule_name),
        description=updates.get("description", rule.description),
        category=updates.get("category", rule.category),
        execution_stage=updates.get("execution_stage", rule.execution_stage),
        stage_order=updates.get("stage_order", rule.stage_order),
        priority=updates.get("priority", rule.priority),
        condition_json=updates.get("condition_json", rule.condition_json),
        transformation_json=updates.get("transformation_json", rule.transformation_json),
        source_object=updates.get("source_object", rule.source_object),
        source_column=updates.get("source_column", rule.source_column),
        target_object=updates.get("target_object", rule.target_object),
        target_path=updates.get("target_path", rule.target_path),
        tags_json=updates.get("tags_json", rule.tags_json),
        version=rule.version + 1,
        parent_rule_id=rule.id,
        approval_status=updates.get("approval_status", "draft"),
        created_by=rule.created_by,
        is_active=updates.get("is_active", True),
        ai_generated=rule.ai_generated,
        confidence_score=rule.confidence_score,
    )
    rule.is_active = False
    db.add(new_rule)
    db.commit()
    db.refresh(new_rule)
    return _rule_out(new_rule)


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = _get_rule_or_404(rule_id, db)
    rule.is_active = False
    db.commit()
    return {"deleted": True, "id": rule_id}


@router.post("/rules/{rule_id}/approve")
def approve_rule(
    rule_id: int,
    approved_by: str = Form(...),
    db: Session = Depends(get_db),
):
    rule = _get_rule_or_404(rule_id, db)
    rule.approval_status = "approved"
    rule.approved_by = approved_by
    rule.approved_at = datetime.utcnow()
    db.commit()
    return _rule_out(rule)


@router.post("/rules/{rule_id}/reject")
def reject_rule(
    rule_id: int,
    reason: str = Form(""),
    db: Session = Depends(get_db),
):
    rule = _get_rule_or_404(rule_id, db)
    rule.approval_status = "rejected"
    if reason:
        rule.description = (rule.description or "") + f"\n[Rejected: {reason}]"
    db.commit()
    return _rule_out(rule)


@router.get("/rules/{rule_id}/versions")
def get_rule_versions(rule_id: int, db: Session = Depends(get_db)):
    """Return all historical versions by following parent_rule_id chain."""
    versions = []
    cur_id: Optional[int] = rule_id
    visited = set()
    while cur_id and cur_id not in visited:
        visited.add(cur_id)
        rule = db.query(TransformationRule).filter(TransformationRule.id == cur_id).first()
        if not rule:
            break
        versions.append(_rule_out(rule))
        cur_id = rule.parent_rule_id
    return versions


@router.get("/rules/{rule_id}/lineage")
def get_rule_lineage(rule_id: int, db: Session = Depends(get_db)):
    rule = _get_rule_or_404(rule_id, db)
    return {
        "rule_id": rule.id,
        "rule_name": rule.rule_name,
        "source": {
            "object": rule.source_object,
            "column": rule.source_column,
        },
        "target": {
            "object": rule.target_object,
            "path": rule.target_path,
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# AI Rule Discovery
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/discover")
def discover_rules(
    data: DiscoverRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        result = svc.discover_rules(
            conn_id=data.conn_id,
            mapping_id=data.mapping_id,
            use_knowledge=data.use_knowledge,
            max_rules=data.max_rules,
            created_by=user.username if user else None,
            db=db,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/parse-nl")
def parse_nl(
    data: ParseNLRequest,
    db: Session = Depends(get_db),
):
    try:
        return svc.parse_natural_language(
            nl_text=data.natural_language,
            conn_id=data.conn_id,
            db=db,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/extract-from-kb")
def extract_from_kb(
    data: KBExtractRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        return svc.extract_rules_from_kb(
            query=data.query,
            conn_id=data.conn_id,
            top_k=data.top_k,
            created_by=user.username if user else None,
            db=db,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════════════════════════════════════
# Rule Sets
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/rule-sets")
def list_rule_sets(
    conn_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(RuleSet).filter(RuleSet.is_active == True)
    if conn_id is not None:
        q = q.filter(RuleSet.conn_id == conn_id)
    sets = q.order_by(RuleSet.name).all()
    return [_rs_out(s) for s in sets]


@router.post("/rule-sets", status_code=201)
def create_rule_set(data: RuleSetCreate, db: Session = Depends(get_db)):
    rs = RuleSet(**data.model_dump())
    db.add(rs)
    db.commit()
    db.refresh(rs)
    return _rs_out(rs)


@router.put("/rule-sets/{rs_id}")
def update_rule_set(rs_id: int, data: RuleSetUpdate, db: Session = Depends(get_db)):
    rs = db.query(RuleSet).filter(RuleSet.id == rs_id).first()
    if not rs:
        raise HTTPException(status_code=404, detail="Rule set not found")
    for k, v in data.model_dump().items():
        if v is not None:
            setattr(rs, k, v)
    db.commit()
    return _rs_out(rs)


@router.delete("/rule-sets/{rs_id}")
def delete_rule_set(rs_id: int, db: Session = Depends(get_db)):
    rs = db.query(RuleSet).filter(RuleSet.id == rs_id).first()
    if not rs:
        raise HTTPException(status_code=404, detail="Rule set not found")
    rs.is_active = False
    db.commit()
    return {"deleted": True}


@router.get("/rule-sets/{rs_id}/rules")
def list_rule_set_rules(rs_id: int, db: Session = Depends(get_db)):
    links = db.query(RuleSetRule).filter(
        RuleSetRule.rule_set_id == rs_id
    ).order_by(RuleSetRule.sort_order).all()
    rules = []
    for link in links:
        rule = db.query(TransformationRule).filter(TransformationRule.id == link.rule_id).first()
        if rule:
            rd = _rule_out(rule)
            rd["sort_order"] = link.sort_order
            rules.append(rd)
    return rules


@router.post("/rule-sets/{rs_id}/rules")
def add_rule_to_set(rs_id: int, rule_id: int = Form(...), sort_order: int = Form(0),
                    added_by: Optional[str] = Form(None),
                    db: Session = Depends(get_db)):
    link = RuleSetRule(rule_set_id=rs_id, rule_id=rule_id, sort_order=sort_order, added_by=added_by)
    db.add(link)
    db.commit()
    return {"added": True}


@router.delete("/rule-sets/{rs_id}/rules/{rule_id}")
def remove_rule_from_set(rs_id: int, rule_id: int, db: Session = Depends(get_db)):
    db.query(RuleSetRule).filter(
        RuleSetRule.rule_set_id == rs_id,
        RuleSetRule.rule_id == rule_id,
    ).delete()
    db.commit()
    return {"removed": True}


def _rs_out(rs: RuleSet) -> dict:
    return {
        "id": rs.id, "conn_id": rs.conn_id, "name": rs.name,
        "description": rs.description, "set_type": rs.set_type,
        "is_active": rs.is_active, "created_by": rs.created_by,
        "created_at": rs.created_at.isoformat() if rs.created_at else None,
        "updated_at": rs.updated_at.isoformat() if rs.updated_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Transformation Pipelines
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/pipelines")
def list_pipelines(conn_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    q = db.query(TransformationPipeline).filter(TransformationPipeline.is_active == True)
    if conn_id is not None:
        q = q.filter(TransformationPipeline.conn_id == conn_id)
    pipelines = q.order_by(TransformationPipeline.name).all()
    result = []
    for p in pipelines:
        pd = _pipeline_out(p)
        steps = db.query(TransformationPipelineStep).filter(
            TransformationPipelineStep.pipeline_id == p.id,
            TransformationPipelineStep.is_active == True,
        ).order_by(TransformationPipelineStep.step_number).all()
        pd["steps"] = [_step_out(s) for s in steps]
        result.append(pd)
    return result


@router.post("/pipelines", status_code=201)
def create_pipeline(data: PipelineCreate, db: Session = Depends(get_db)):
    p = TransformationPipeline(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return _pipeline_out(p)


@router.put("/pipelines/{pid}")
def update_pipeline(pid: int, data: PipelineUpdate, db: Session = Depends(get_db)):
    p = db.query(TransformationPipeline).filter(TransformationPipeline.id == pid).first()
    if not p:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    for k, v in data.model_dump().items():
        if v is not None:
            setattr(p, k, v)
    db.commit()
    return _pipeline_out(p)


@router.get("/pipelines/{pid}/steps")
def list_pipeline_steps(pid: int, db: Session = Depends(get_db)):
    steps = db.query(TransformationPipelineStep).filter(
        TransformationPipelineStep.pipeline_id == pid,
        TransformationPipelineStep.is_active == True,
    ).order_by(TransformationPipelineStep.step_number).all()
    return [_step_out(s) for s in steps]


@router.post("/pipelines/{pid}/steps", status_code=201)
def add_pipeline_step(pid: int, data: PipelineStepCreate, db: Session = Depends(get_db)):
    step = TransformationPipelineStep(pipeline_id=pid, **data.model_dump())
    db.add(step)
    db.commit()
    db.refresh(step)
    return _step_out(step)


@router.put("/pipelines/{pid}/steps/{step_id}")
def update_pipeline_step(pid: int, step_id: int, data: PipelineStepUpdate,
                          db: Session = Depends(get_db)):
    step = db.query(TransformationPipelineStep).filter(
        TransformationPipelineStep.id == step_id,
        TransformationPipelineStep.pipeline_id == pid,
    ).first()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    for k, v in data.model_dump().items():
        if v is not None:
            setattr(step, k, v)
    db.commit()
    return _step_out(step)


@router.delete("/pipelines/{pid}/steps/{step_id}")
def delete_pipeline_step(pid: int, step_id: int, db: Session = Depends(get_db)):
    step = db.query(TransformationPipelineStep).filter(
        TransformationPipelineStep.id == step_id,
        TransformationPipelineStep.pipeline_id == pid,
    ).first()
    if step:
        step.is_active = False
        db.commit()
    return {"deleted": True}


def _pipeline_out(p: TransformationPipeline) -> dict:
    return {
        "id": p.id, "conn_id": p.conn_id, "name": p.name,
        "description": p.description, "is_active": p.is_active,
        "created_by": p.created_by,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _step_out(s: TransformationPipelineStep) -> dict:
    return {
        "id": s.id, "pipeline_id": s.pipeline_id, "step_number": s.step_number,
        "step_name": s.step_name, "execution_stage": s.execution_stage,
        "rule_set_id": s.rule_set_id, "rule_id": s.rule_id,
        "description": s.description, "is_active": s.is_active,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Simulation
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/simulate")
def simulate(
    data: SimulateRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    rule = _get_rule_or_404(data.rule_id, db)
    return svc.simulate_rule(
        rule=rule,
        input_records=data.input_records,
        executed_by=user.username if user else None,
        db=db,
    )


@router.get("/simulate/{rule_id}/history")
def simulation_history(
    rule_id: int,
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db),
):
    logs = db.query(RuleSimulationLog).filter(
        RuleSimulationLog.rule_id == rule_id
    ).order_by(RuleSimulationLog.created_at.desc()).limit(limit).all()
    return [_sim_log_out(l) for l in logs]


def _sim_log_out(l: RuleSimulationLog) -> dict:
    return {
        "id": l.id, "rule_id": l.rule_id, "conn_id": l.conn_id,
        "input_json": l.input_json, "output_json": l.output_json,
        "trace_json": l.trace_json, "passed": l.passed,
        "error_message": l.error_message, "executed_by": l.executed_by,
        "created_at": l.created_at.isoformat() if l.created_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Test Cases
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/test-cases")
def list_test_cases(
    rule_id: Optional[int] = Query(None),
    conn_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(RuleTestCase)
    if rule_id is not None:
        q = q.filter(RuleTestCase.rule_id == rule_id)
    if conn_id is not None:
        q = q.filter(RuleTestCase.conn_id == conn_id)
    return [_tc_out(tc) for tc in q.order_by(RuleTestCase.rule_id, RuleTestCase.id).all()]


@router.post("/test-cases", status_code=201)
def create_test_case(data: TestCaseCreate, db: Session = Depends(get_db)):
    tc = RuleTestCase(**data.model_dump())
    db.add(tc)
    db.commit()
    db.refresh(tc)
    return _tc_out(tc)


@router.put("/test-cases/{tc_id}")
def update_test_case(tc_id: int, data: TestCaseUpdate, db: Session = Depends(get_db)):
    tc = db.query(RuleTestCase).filter(RuleTestCase.id == tc_id).first()
    if not tc:
        raise HTTPException(status_code=404, detail="Test case not found")
    for k, v in data.model_dump().items():
        if v is not None:
            setattr(tc, k, v)
    db.commit()
    return _tc_out(tc)


@router.delete("/test-cases/{tc_id}")
def delete_test_case(tc_id: int, db: Session = Depends(get_db)):
    tc = db.query(RuleTestCase).filter(RuleTestCase.id == tc_id).first()
    if tc:
        db.delete(tc)
        db.commit()
    return {"deleted": True}


@router.post("/test-cases/{tc_id}/run")
def run_test_case(
    tc_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    tc = db.query(RuleTestCase).filter(RuleTestCase.id == tc_id).first()
    if not tc:
        raise HTTPException(status_code=404, detail="Test case not found")
    return svc.run_test_case(tc, executed_by=user.username if user else None, db=db)


@router.post("/test-cases/run-all")
def run_all_test_cases(
    conn_id: int = Form(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    tcs = db.query(RuleTestCase).filter(RuleTestCase.conn_id == conn_id).all()
    results = []
    for tc in tcs:
        res = svc.run_test_case(tc, executed_by=user.username if user else None, db=db)
        results.append({"test_case_id": tc.id, "test_name": tc.test_name, **res})
    passed = sum(1 for r in results if r.get("passed"))
    return {"total": len(results), "passed": passed, "failed": len(results) - passed, "results": results}


def _tc_out(tc: RuleTestCase) -> dict:
    return {
        "id": tc.id, "rule_id": tc.rule_id, "conn_id": tc.conn_id,
        "test_name": tc.test_name, "description": tc.description,
        "input_json": tc.input_json, "expected_output_json": tc.expected_output_json,
        "actual_output_json": tc.actual_output_json, "passed": tc.passed,
        "last_run_at": tc.last_run_at.isoformat() if tc.last_run_at else None,
        "last_run_by": tc.last_run_by, "created_by": tc.created_by,
        "created_at": tc.created_at.isoformat() if tc.created_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Validation
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/validate")
def validate_rule_endpoint(data: ValidateRequest, db: Session = Depends(get_db)):
    if not data.rule_id:
        raise HTTPException(status_code=400, detail="rule_id required")
    rule = _get_rule_or_404(data.rule_id, db)
    conn_id = rule.conn_id
    all_rules = db.query(TransformationRule).filter(
        TransformationRule.conn_id == conn_id,
        TransformationRule.is_active == True,
    ).all() if conn_id else []
    issues = svc.validate_rule(rule, all_rules, db)
    return {"issues": issues, "clean": len(issues) == 0}


@router.post("/validate-all")
def validate_all(data: ValidateRequest, db: Session = Depends(get_db)):
    if not data.conn_id:
        raise HTTPException(status_code=400, detail="conn_id required")
    return svc.validate_all_rules(data.conn_id, db)


@router.post("/issues/{issue_id}/resolve")
def resolve_issue(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(RuleValidationIssue).filter(RuleValidationIssue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    issue.resolved = True
    db.commit()
    return {"resolved": True}


@router.get("/issues")
def list_issues(
    conn_id: Optional[int] = Query(None),
    rule_id: Optional[int] = Query(None),
    resolved: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(RuleValidationIssue)
    if conn_id is not None:
        q = q.filter(RuleValidationIssue.conn_id == conn_id)
    if rule_id is not None:
        q = q.filter(RuleValidationIssue.rule_id == rule_id)
    if resolved is not None:
        q = q.filter(RuleValidationIssue.resolved == resolved)
    issues = q.order_by(RuleValidationIssue.detected_at.desc()).limit(200).all()
    return [_issue_out(i) for i in issues]


def _issue_out(i: RuleValidationIssue) -> dict:
    return {
        "id": i.id, "rule_id": i.rule_id, "conn_id": i.conn_id,
        "issue_type": i.issue_type, "severity": i.severity,
        "description": i.description, "conflicting_rule_id": i.conflicting_rule_id,
        "resolved": i.resolved,
        "detected_at": i.detected_at.isoformat() if i.detected_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Impact Analysis
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/impact/{rule_id}")
def get_impact(rule_id: int, db: Session = Depends(get_db)):
    rule = _get_rule_or_404(rule_id, db)
    # Return cached or recompute
    if rule.impact_json:
        try:
            return json.loads(rule.impact_json)
        except Exception:
            pass
    return svc.analyze_impact(rule, db)


# ══════════════════════════════════════════════════════════════════════════════
# Readiness Dashboard
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/readiness")
def readiness(conn_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    return svc.get_readiness_dashboard(conn_id, db)


# ══════════════════════════════════════════════════════════════════════════════
# Reconciliation Queries
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/generate-recon-queries")
def generate_recon_queries(data: ReconRequest, db: Session = Depends(get_db)):
    try:
        return svc.generate_recon_queries(data.conn_id, data.rule_ids, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════════════════════════════════════
# Export
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/export")
def export_rules(data: ExportRequest, db: Session = Depends(get_db)):
    content, filename = svc.export_rules(
        conn_id=data.conn_id,
        fmt=data.format,
        rule_ids=data.rule_ids,
        db=db,
    )
    return {"content": content, "filename": filename}


# ══════════════════════════════════════════════════════════════════════════════
# Lookup Intelligence
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/lookup-intelligence")
def lookup_intelligence(data: LookupRequest, db: Session = Depends(get_db)):
    return svc.enhance_lookup_intelligence(data.conn_id, data.table_name, data.column_name, db)


@router.post("/lookup-intelligence/batch")
def lookup_intelligence_batch(data: LookupBatchRequest, db: Session = Depends(get_db)):
    """Enrich all categorical columns for conn_id."""
    from api.models import ConversionColumnProfile
    from sqlalchemy import func as sqlfunc

    # Get distinct categorical columns from value mappings
    from api.models import ConversionValueMapping
    cols = (
        db.query(
            ConversionValueMapping.table_name,
            ConversionValueMapping.column_name,
        )
        .filter(ConversionValueMapping.conn_id == data.conn_id)
        .distinct()
        .limit(30)
        .all()
    )

    results = []
    for table_name, column_name in cols:
        result = svc.enhance_lookup_intelligence(data.conn_id, table_name, column_name, db)
        results.append({
            "table_name": table_name,
            "column_name": column_name,
            "total_suggestions": len(result["suggestions"]),
            "unmapped_count": len(result["unmapped_values"]),
            "conflict_count": len(result["conflicts"]),
        })

    return {
        "processed_columns": len(results),
        "total_suggestions": sum(r["total_suggestions"] for r in results),
        "columns": results,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Document / PDF Rule Extraction
# ══════════════════════════════════════════════════════════════════════════════

def _extract_text_from_file(file_bytes: bytes, filename: str) -> str:
    """
    Extract plain text from an uploaded file.
    Supports: .pdf, .docx, .doc, .txt, .md, .csv
    Falls back to UTF-8 decode for unknown types.
    """
    fname = filename.lower()

    # ── PDF ──────────────────────────────────────────────────────────────────
    if fname.endswith(".pdf"):
        text_parts: list[str] = []
        try:
            import io
            import PyPDF2  # type: ignore
            reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
            for page in reader.pages:
                part = page.extract_text()
                if part:
                    text_parts.append(part.strip())
            if text_parts:
                return "\n\n".join(text_parts)
        except Exception:
            pass
        try:
            import io
            from pdfminer.high_level import extract_text as pdfminer_extract  # type: ignore
            return pdfminer_extract(io.BytesIO(file_bytes)) or ""
        except Exception:
            pass
        return ""  # extraction failed — caller will surface error

    # ── DOCX ─────────────────────────────────────────────────────────────────
    if fname.endswith((".docx", ".doc")):
        try:
            import io
            import docx  # python-docx  # type: ignore
            doc = docx.Document(io.BytesIO(file_bytes))
            paras = [p.text for p in doc.paragraphs if p.text.strip()]
            tables: list[str] = []
            for tbl in doc.tables:
                for row in tbl.rows:
                    tables.append(" | ".join(c.text.strip() for c in row.cells if c.text.strip()))
            return "\n\n".join(paras + tables)
        except Exception:
            pass
        return ""

    # ── Plain text / markdown / csv ───────────────────────────────────────────
    for enc in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return file_bytes.decode(enc)
        except Exception:
            pass
    return ""


@router.post("/extract-from-document")
async def extract_from_document(
    file: UploadFile = File(...),
    conn_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Upload a PDF, DOCX, or TXT document.
    Extracts text, then uses the LLM (transformation_kb_extract prompt) to discover
    transformation rules. Returns the same structure as /extract-from-kb.
    """
    MAX_BYTES = 10 * 1024 * 1024  # 10 MB
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")

    filename = file.filename or "upload.txt"
    text = _extract_text_from_file(raw, filename)
    if not text or not text.strip():
        raise HTTPException(
            status_code=422,
            detail=(
                f"Could not extract text from '{filename}'. "
                "Please ensure it is a readable PDF, DOCX, or plain-text file."
            ),
        )

    # Truncate to ~8 000 words to stay within context budget
    words = text.split()
    if len(words) > 8000:
        text = " ".join(words[:8000]) + "\n\n[...document truncated for processing...]"

    try:
        result = svc.extract_rules_from_kb(
            query=text,
            conn_id=conn_id,
            top_k=0,           # 0 = skip semantic search; use text as-is
            created_by=user.username if user else None,
            db=db,
        )
        result["source_filename"] = filename
        result["chars_extracted"] = len(text)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Rule Impact & Promote ────────────────────────────────────────────────────────

@router.get("/rules/{rule_id}/impact")
def get_rule_impact(rule_id: int, db: Session = Depends(get_db)):
    """
    Return usage counts for a rule: mapping rows, active mappings,
    simulations, and test cases that reference it.
    """
    rule = _get_rule_or_404(rule_id, db)

    links = (
        db.query(MappingRowTransformation)
        .filter(
            MappingRowTransformation.rule_id == rule_id,
            MappingRowTransformation.is_active == True,
        )
        .all()
    )
    row_ids   = [lnk.mapping_row_id for lnk in links]
    row_count = len(row_ids)

    mapping_count = 0
    if row_ids:
        mapping_ids = (
            db.query(MappingRow.mapping_id)
            .filter(MappingRow.id.in_(row_ids))
            .distinct()
            .all()
        )
        mapping_count = db.query(Mapping).filter(
            Mapping.id.in_([m[0] for m in mapping_ids]),
            Mapping.is_active == True,
        ).count()

    sim_count = db.query(RuleSimulationLog).filter(
        RuleSimulationLog.rule_id == rule_id,
    ).count()
    tc_count = db.query(RuleTestCase).filter(
        RuleTestCase.rule_id == rule_id,
    ).count()

    return {
        "rule_id":              rule_id,
        "rule_name":            rule.rule_name,
        "category":             rule.category,
        "mapping_row_count":    row_count,
        "active_mapping_count": mapping_count,
        "simulation_count":     sim_count,
        "test_case_count":      tc_count,
    }


@router.post("/rules/{rule_id}/promote-global", status_code=201)
def promote_to_global(rule_id: int, db: Session = Depends(get_db)):
    """
    Promote a connection-specific rule to global (conn_id = NULL).
    Creates a new versioned rule with conn_id cleared; marks old as deprecated.
    """
    rule = _get_rule_or_404(rule_id, db)
    if rule.conn_id is None:
        return _rule_out(rule)  # already global

    new_rule = TransformationRule(
        conn_id=None,
        rule_name=rule.rule_name,
        description=rule.description,
        category=rule.category,
        execution_stage=rule.execution_stage,
        stage_order=rule.stage_order,
        priority=rule.priority,
        condition_json=rule.condition_json,
        transformation_json=rule.transformation_json,
        source_object=rule.source_object,
        source_column=rule.source_column,
        target_object=rule.target_object,
        target_path=rule.target_path,
        tags_json=rule.tags_json,
        version=rule.version + 1,
        parent_rule_id=rule.id,
        approval_status="draft",
        ai_generated=rule.ai_generated,
        created_by=rule.created_by,
    )
    db.add(new_rule)
    rule.approval_status = "deprecated"
    rule.is_active = False
    db.commit()
    db.refresh(new_rule)
    return _rule_out(new_rule)
