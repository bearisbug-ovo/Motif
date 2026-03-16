"""Workflow management API routes."""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models.workflow import Workflow
from comfyui.categories import get_categories, validate_manifest
from comfyui.client import ComfyUIClient
from comfyui.parser import parse_comfyui_workflow
from config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()
categories_router = APIRouter()


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class ParseRequest(BaseModel):
    workflow_json: dict


class WorkflowCreate(BaseModel):
    name: str
    category: str
    description: Optional[str] = None
    is_default: bool = False
    workflow_json: dict
    manifest: dict
    overwrite_id: Optional[str] = None


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    workflow_json: Optional[dict] = None
    manifest: Optional[dict] = None
    composite_steps: Optional[list] = None


class CompositeWorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    steps: list  # [{"workflow_id": "...", "params_override": {...}}, ...]


class WorkflowOut(BaseModel):
    id: str
    name: str
    category: str
    description: Optional[str]
    is_default: bool
    workflow_json: dict
    manifest: dict
    created_at: str
    updated_at: str


class WorkflowListItem(BaseModel):
    id: str
    name: str
    category: str
    description: Optional[str]
    is_default: bool
    created_at: str
    updated_at: str


def _to_list_item(wf: Workflow, db: Session | None = None) -> dict:
    d = {
        "id": wf.id,
        "name": wf.name,
        "category": wf.category,
        "description": wf.description,
        "is_default": wf.is_default,
        "is_composite": wf.is_composite,
        "created_at": wf.created_at.isoformat() + "Z",
        "updated_at": wf.updated_at.isoformat() + "Z",
    }
    if wf.is_composite and wf.composite_steps:
        steps = json.loads(wf.composite_steps)
        d["composite_step_count"] = len(steps)
    return d


def _to_full(wf: Workflow, db: Session | None = None) -> dict:
    d = {
        **_to_list_item(wf, db),
        "workflow_json": json.loads(wf.workflow_json),
        "manifest": json.loads(wf.manifest),
    }
    if wf.is_composite and wf.composite_steps:
        steps = json.loads(wf.composite_steps)
        # Enrich steps with workflow names
        if db:
            for step in steps:
                sw = db.get(Workflow, step.get("workflow_id", ""))
                if sw:
                    step["workflow_name"] = sw.name
                    step["workflow_category"] = sw.category
        d["composite_steps"] = steps
    return d


# ── Categories endpoint ──────────────────────────────────────────────────────

@categories_router.get("")
def list_categories():
    return get_categories()


# ── Parse endpoint ────────────────────────────────────────────────────────────

@router.post("/parse")
async def parse_workflow(body: ParseRequest):
    # Collect class_types of @-tagged nodes to fetch their definitions
    class_types: list[str] = []
    for node in body.workflow_json.values():
        if not isinstance(node, dict):
            continue
        meta = node.get("_meta", {})
        title = meta.get("title", "")
        if title.startswith("@"):
            ct = node.get("class_type", "")
            if ct and ct not in class_types:
                class_types.append(ct)

    # Fetch object_info from ComfyUI for combo/dropdown detection
    object_info = None
    if class_types:
        try:
            comfy = ComfyUIClient(get_settings().comfyui_url)
            object_info = await comfy.get_object_info(class_types)
        except Exception as e:
            logger.warning("Failed to fetch object_info from ComfyUI: %s", e)

    return parse_comfyui_workflow(body.workflow_json, object_info)


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("")
def list_workflows(category: Optional[str] = Query(None), db: Session = Depends(get_db)):
    stmt = select(Workflow).order_by(Workflow.category, Workflow.name)
    if category:
        stmt = stmt.where(Workflow.category == category)
    rows = db.execute(stmt).scalars().all()
    return [_to_list_item(w, db) for w in rows]


@router.get("/{workflow_id}")
def get_workflow(workflow_id: str, db: Session = Depends(get_db)):
    wf = db.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return _to_full(wf, db)


@router.post("", status_code=201)
def create_workflow(body: WorkflowCreate, db: Session = Depends(get_db)):
    # Validate category
    errors = validate_manifest(body.category, body.manifest)
    if errors:
        raise HTTPException(status_code=422, detail="; ".join(errors))

    # Check name conflict
    if body.overwrite_id:
        existing = db.get(Workflow, body.overwrite_id)
        if existing:
            existing.name = body.name
            existing.category = body.category
            existing.description = body.description
            existing.workflow_json = json.dumps(body.workflow_json)
            existing.manifest = json.dumps(body.manifest)
            existing.is_default = body.is_default
            existing.updated_at = datetime.utcnow()
            if body.is_default:
                _clear_other_defaults(db, body.category, existing.id)
            db.commit()
            db.refresh(existing)
            return _to_full(existing, db)

    conflict = db.execute(
        select(Workflow).where(Workflow.name == body.name)
    ).scalar_one_or_none()
    if conflict:
        raise HTTPException(status_code=409, detail=f"Workflow with name '{body.name}' already exists",
                            headers={"X-Conflict-Id": conflict.id})

    wf = Workflow(
        id=str(uuid.uuid4()),
        name=body.name,
        category=body.category,
        description=body.description,
        is_default=body.is_default,
        workflow_json=json.dumps(body.workflow_json),
        manifest=json.dumps(body.manifest),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    if body.is_default:
        _clear_other_defaults(db, body.category, wf.id)
    db.add(wf)
    db.commit()
    db.refresh(wf)
    return _to_full(wf, db)


@router.put("/{workflow_id}")
def update_workflow(workflow_id: str, body: WorkflowUpdate, db: Session = Depends(get_db)):
    wf = db.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if body.name is not None:
        wf.name = body.name
    if body.description is not None:
        wf.description = body.description
    if body.workflow_json is not None:
        wf.workflow_json = json.dumps(body.workflow_json)
    if body.manifest is not None:
        errors = validate_manifest(wf.category, body.manifest)
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))
        wf.manifest = json.dumps(body.manifest)

    if body.composite_steps is not None and wf.is_composite:
        # Validate and update composite steps
        _validate_composite_steps(body.composite_steps, db, exclude_id=wf.id)
        wf.composite_steps = json.dumps(body.composite_steps)
        # Update category from first step
        if body.composite_steps:
            first_wf = db.get(Workflow, body.composite_steps[0].get("workflow_id", ""))
            if first_wf:
                wf.category = _get_leaf_category(first_wf, db)

    wf.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(wf)
    return _to_full(wf, db)


@router.delete("/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: str, db: Session = Depends(get_db)):
    wf = db.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    db.delete(wf)
    db.commit()


@router.patch("/{workflow_id}/default")
def set_default(workflow_id: str, db: Session = Depends(get_db)):
    wf = db.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    _clear_other_defaults(db, wf.category, wf.id)
    wf.is_default = True
    wf.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(wf)
    return _to_list_item(wf, db)


def _clear_other_defaults(db: Session, category: str, exclude_id: str):
    others = db.execute(
        select(Workflow).where(
            Workflow.category == category,
            Workflow.is_default == True,
            Workflow.id != exclude_id,
        )
    ).scalars().all()
    for o in others:
        o.is_default = False


# ── Composite workflow helpers ────────────────────────────────────────────────

def _get_leaf_category(wf: Workflow, db: Session) -> str:
    """Get the leaf category for a workflow (recursing into composites)."""
    if wf.is_composite and wf.composite_steps:
        steps = json.loads(wf.composite_steps)
        if steps:
            first_wf = db.get(Workflow, steps[0].get("workflow_id", ""))
            if first_wf:
                return _get_leaf_category(first_wf, db)
    return wf.category


def _flatten_composite_steps(workflow_id: str, db: Session, visited: set | None = None) -> list[dict]:
    """Recursively flatten composite workflow steps into a flat list.

    Each returned dict: {"workflow_id": "...", "params_override": {...}, "source_param": "..."}
    Detects circular references via the visited set.
    """
    if visited is None:
        visited = set()
    if workflow_id in visited:
        raise HTTPException(status_code=422, detail=f"Circular reference detected: workflow {workflow_id[:8]}...")
    visited.add(workflow_id)

    wf = db.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail=f"Workflow {workflow_id[:8]}... not found")

    if not wf.is_composite:
        # Leaf workflow — auto-detect source_param
        source_param = _detect_source_param(wf, db)
        return [{"workflow_id": workflow_id, "params_override": {}, "source_param": source_param}]

    steps = json.loads(wf.composite_steps) if wf.composite_steps else []
    flat = []
    for step in steps:
        step_wf_id = step.get("workflow_id", "")
        step_override = step.get("params_override", {})
        sub_steps = _flatten_composite_steps(step_wf_id, db, visited.copy())
        for i, ss in enumerate(sub_steps):
            merged_override = {**ss.get("params_override", {})}
            if i == 0:
                # Apply parent step's override to the first sub-step
                merged_override.update(step_override)
            flat.append({**ss, "params_override": merged_override})
    return flat


def _detect_source_param(wf: Workflow, db: Session) -> str:
    """Auto-detect the source image param name for a workflow."""
    from comfyui.categories import get_categories
    cats = get_categories()
    cat_info = next((c for c in cats if c["key"] == wf.category), None)
    if cat_info:
        for p in cat_info.get("params", []):
            if p.get("type") == "image" and p["name"] in ("source_image", "base_image", "input_image"):
                return p["name"]
        # Fallback: first image param that isn't a mask
        for p in cat_info.get("params", []):
            if p.get("type") == "image" and "mask" not in p["name"].lower():
                return p["name"]
    return "source_image"


def _validate_composite_steps(steps: list, db: Session, exclude_id: str | None = None):
    """Validate composite steps: existence, no circular refs, max 10 expanded steps."""
    if len(steps) < 2:
        raise HTTPException(status_code=422, detail="复合工作流至少需要 2 个步骤")

    # Check each step workflow exists
    for step in steps:
        wf_id = step.get("workflow_id", "")
        wf = db.get(Workflow, wf_id)
        if not wf:
            raise HTTPException(status_code=404, detail=f"步骤工作流 {wf_id[:8]}... 不存在")

    # Flatten to check circular refs and total step count
    visited = {exclude_id} if exclude_id else set()
    total_flat = []
    for step in steps:
        flat = _flatten_composite_steps(step["workflow_id"], db, visited.copy())
        total_flat.extend(flat)

    if len(total_flat) > 10:
        raise HTTPException(status_code=422, detail=f"展开后总步数 ({len(total_flat)}) 超过上限 (10)")


@router.post("/composite", status_code=201)
def create_composite_workflow(body: CompositeWorkflowCreate, db: Session = Depends(get_db)):
    """Create a composite workflow from multiple sub-workflows."""
    _validate_composite_steps(body.steps, db)

    # Check name conflict
    conflict = db.execute(
        select(Workflow).where(Workflow.name == body.name)
    ).scalar_one_or_none()
    if conflict:
        raise HTTPException(status_code=409, detail=f"工作流名称「{body.name}」已存在",
                            headers={"X-Conflict-Id": conflict.id})

    # Determine category from first step (recursing to leaf)
    first_step_wf = db.get(Workflow, body.steps[0]["workflow_id"])
    category = _get_leaf_category(first_step_wf, db)

    # Detect source_param for each step
    enriched_steps = []
    for step in body.steps:
        step_wf = db.get(Workflow, step["workflow_id"])
        source_param = _detect_source_param(step_wf, db)
        enriched_steps.append({
            "workflow_id": step["workflow_id"],
            "params_override": step.get("params_override", {}),
            "source_param": source_param,
        })

    wf = Workflow(
        id=str(uuid.uuid4()),
        name=body.name,
        category=category,
        description=body.description,
        is_default=False,
        is_composite=True,
        composite_steps=json.dumps(enriched_steps),
        workflow_json="{}",
        manifest="{}",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(wf)
    db.commit()
    db.refresh(wf)
    return _to_full(wf, db)
