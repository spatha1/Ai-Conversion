"""
api/routers/agent_mapper_templates.py
Template Library endpoints for Agent Mapper OOTB + custom manuscripts.

GET    /agent-mapper/templates          list (filter: entity, lob, is_ootb)
GET    /agent-mapper/templates/{id}     detail with full XML
POST   /agent-mapper/templates          create custom template
PUT    /agent-mapper/templates/{id}     update name/notes/xml
DELETE /agent-mapper/templates/{id}     soft-disable (is_active=False)
POST   /agent-mapper/templates/seed     seed OOTB from samples/agent_mapper/*.xml
"""
from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.dependencies import require_developer
from api.database import get_db
from api.models import AgentMapperTemplate

router = APIRouter(dependencies=[Depends(require_developer)])

SAMPLES_DIR = Path(__file__).parent.parent.parent / "samples" / "agent_mapper"


# ── Pydantic models ──────────────────────────────────────────────────────────

class TemplateOut(BaseModel):
    id:           int
    name:         str
    template_key: str
    mapping_type: Optional[str]
    entity:       Optional[str]
    lob:          Optional[str]
    template_xml: str
    notes:        Optional[str]
    is_ootb:      bool
    is_active:    bool
    kb_entry_id:  Optional[int] = None
    created_at:   datetime
    model_config = {"from_attributes": True}


class TemplateCreate(BaseModel):
    name:         str
    template_key: str
    mapping_type: Optional[str] = None
    entity:       Optional[str] = None
    lob:          Optional[str] = None
    template_xml: str
    notes:        Optional[str] = None


class TemplateUpdate(BaseModel):
    name:         Optional[str] = None
    mapping_type: Optional[str] = None
    entity:       Optional[str] = None
    lob:          Optional[str] = None
    template_xml: Optional[str] = None
    notes:        Optional[str] = None


class SeedResult(BaseModel):
    seeded:  int
    skipped: int
    files:   list[str]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse_ootb_xml(xml_text: str, filename: str) -> dict:
    """Extract metadata from OOTB sample XML."""
    meta: dict = {"lob": None, "entity": None, "mapping_type": None, "name": None}
    try:
        root = ET.fromstring(xml_text)
        props = root.find("properties")
        if props is not None:
            manuscript_id = props.get("manuscriptID", "")
            caption       = props.get("caption", "")
            meta["name"]  = caption or manuscript_id

            # manuscriptID format: {LOB}_{Entity}_{type}  e.g. Auto_Risk_risk
            parts = manuscript_id.split("_")
            if len(parts) >= 3:
                meta["lob"]          = parts[0]
                meta["entity"]       = parts[1]
                meta["mapping_type"] = parts[2]
            elif len(parts) == 2:
                meta["entity"]       = parts[0]
                meta["mapping_type"] = parts[1]
    except Exception:
        pass

    if not meta["name"]:
        meta["name"] = filename.replace(".xml", "").replace("_", " ").title()

    return meta


# ── SAI KB Indexing ──────────────────────────────────────────────────────────

def _index_to_kb(template: AgentMapperTemplate, db: Session) -> Optional[int]:
    """
    Create a KnowledgeEntry + embedded chunk for this template so it is
    discoverable by the Mapping Assistant (and any SAI KB search).
    Returns the new kb_entry_id, or None on failure.
    """
    try:
        from api.config import settings
        from api.models import KnowledgeEntry, KnowledgeChunk
        from api.services.embeddings import get_embedding

        label   = f"DCT Manuscript: {template.name}"
        summary = (
            f"DCT Extract Mapper manuscript template for entity={template.entity}, "
            f"type={template.mapping_type}, LOB={template.lob}. "
            f"{'OOTB template.' if template.is_ootb else 'Custom template.'}"
            + (f" {template.notes}" if template.notes else "")
        ).strip()

        content = (
            f"{summary}\n\n"
            f"Template Key: {template.template_key}\n"
            f"XML:\n{template.template_xml}"
        )

        tags = json.dumps([t for t in [
            template.entity, template.lob, template.mapping_type,
            "DCT", "manuscript", "extract-mapper",
            "OOTB" if template.is_ootb else "custom",
        ] if t])

        entry = KnowledgeEntry(
            title                = label,
            type                 = "UseCase",
            system               = "DCT",
            tags                 = tags,
            summary              = summary,
            detailed_explanation = content[:4000],
            raw_content          = content,
            source_type          = "XML",
            is_reusable          = True,
            status               = "READY_FOR_EMBEDDING",
            embedding_status     = "pending",
        )
        db.add(entry)
        db.flush()

        chunk_text = content[:800]
        chunk = KnowledgeChunk(
            entry_id    = entry.id,
            chunk_index = 0,
            content     = chunk_text,
            topic       = f"{template.entity} {template.mapping_type} manuscript",
        )

        if settings.OPENAI_API_KEY:
            try:
                vec = get_embedding(chunk_text, api_key=settings.OPENAI_API_KEY)
                chunk.embedding      = json.dumps(vec)
                entry.embedding_status = "complete"
                # Also embed the summary as representative vector
                sum_vec = get_embedding(summary, api_key=settings.OPENAI_API_KEY)
                entry.representative_emb = json.dumps(sum_vec)
            except Exception:
                pass

        db.add(chunk)
        db.flush()
        return entry.id
    except Exception as exc:
        print(f"[mapper-templates] KB indexing failed: {exc}")
        return None


# ── Endpoints ────────────────────────────────────────────────────────────────

# NOTE: /seed must be registered BEFORE /{id} to avoid FastAPI coercing "seed" to int
@router.post("/agent-mapper/templates/seed", response_model=SeedResult)
def seed_ootb(db: Session = Depends(get_db)):
    if not SAMPLES_DIR.exists():
        raise HTTPException(status_code=404, detail=f"Samples dir not found: {SAMPLES_DIR}")

    xml_files = sorted(SAMPLES_DIR.glob("*.xml"))
    if not xml_files:
        raise HTTPException(status_code=404, detail="No XML files found in samples/agent_mapper/")

    seeded  = 0
    skipped = 0
    names:  list[str] = []

    for xml_path in xml_files:
        template_key = xml_path.stem  # e.g. "04_risk_auto"
        xml_text     = xml_path.read_text(encoding="utf-8")
        meta         = _parse_ootb_xml(xml_text, xml_path.name)

        existing = db.query(AgentMapperTemplate).filter_by(template_key=template_key).first()
        if existing:
            skipped += 1
            continue

        row = AgentMapperTemplate(
            name         = meta["name"] or template_key,
            template_key = template_key,
            mapping_type = meta["mapping_type"],
            entity       = meta["entity"],
            lob          = meta["lob"],
            template_xml = xml_text,
            is_ootb      = True,
            is_active    = True,
        )
        db.add(row)
        db.flush()

        # Index to SAI KB for Mapping Assistant search
        kb_id = _index_to_kb(row, db)
        if kb_id:
            row.kb_entry_id = kb_id

        seeded += 1
        names.append(xml_path.name)

    db.commit()
    return SeedResult(seeded=seeded, skipped=skipped, files=names)


@router.get("/agent-mapper/templates", response_model=list[TemplateOut])
def list_templates(
    entity:  Optional[str] = None,
    lob:     Optional[str] = None,
    is_ootb: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    q = db.query(AgentMapperTemplate).filter(AgentMapperTemplate.is_active == True)
    if entity:
        q = q.filter(AgentMapperTemplate.entity == entity)
    if lob:
        q = q.filter(AgentMapperTemplate.lob == lob)
    if is_ootb is not None:
        q = q.filter(AgentMapperTemplate.is_ootb == is_ootb)
    return q.order_by(AgentMapperTemplate.id).all()


@router.get("/agent-mapper/templates/{template_id}", response_model=TemplateOut)
def get_template(template_id: int, db: Session = Depends(get_db)):
    row = db.query(AgentMapperTemplate).filter_by(id=template_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    return row


@router.post("/agent-mapper/templates", response_model=TemplateOut)
def create_template(data: TemplateCreate, db: Session = Depends(get_db)):
    existing = db.query(AgentMapperTemplate).filter_by(template_key=data.template_key).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"template_key '{data.template_key}' already exists")
    row = AgentMapperTemplate(
        name         = data.name,
        template_key = data.template_key,
        mapping_type = data.mapping_type,
        entity       = data.entity,
        lob          = data.lob,
        template_xml = data.template_xml,
        notes        = data.notes,
        is_ootb      = False,
        is_active    = True,
    )
    db.add(row)
    db.flush()

    kb_id = _index_to_kb(row, db)
    if kb_id:
        row.kb_entry_id = kb_id

    db.commit()
    db.refresh(row)
    return row


@router.put("/agent-mapper/templates/{template_id}", response_model=TemplateOut)
def update_template(template_id: int, data: TemplateUpdate, db: Session = Depends(get_db)):
    row = db.query(AgentMapperTemplate).filter_by(id=template_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    for field, val in data.model_dump(exclude_none=True).items():
        setattr(row, field, val)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


@router.delete("/agent-mapper/templates/{template_id}")
def disable_template(template_id: int, db: Session = Depends(get_db)):
    row = db.query(AgentMapperTemplate).filter_by(id=template_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    row.is_active  = False
    row.updated_at = datetime.utcnow()
    db.commit()
    return {"detail": "disabled"}
