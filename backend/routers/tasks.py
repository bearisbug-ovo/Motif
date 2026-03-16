"""Task queue CRUD and queue control endpoints."""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from models.task import Task, QueueConfig
from models.album import Album
from models.media import Media
from models.person import Person
from models.workflow import Workflow

router = APIRouter()
queue_router = APIRouter()

# ── Track completed tasks since last view (for badge) ────────────────────────
_completed_since_last_view: int = 0


def increment_completed_count():
    """Called by queue_runner when a task completes."""
    global _completed_since_last_view
    _completed_since_last_view += 1


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    workflow_type: str
    params: dict
    execution_mode: str = "queued"  # immediate | queued


class TaskPatch(BaseModel):
    params: Optional[dict] = None
    queue_order: Optional[int] = None


class TaskReorderRequest(BaseModel):
    task_ids: List[str]


class BatchAiRequest(BaseModel):
    workflow_type: str                    # "custom:<id>"
    media_ids: List[str] = []            # explicit media ID list (multi-select mode)
    album_id: Optional[str] = None       # or album ID (backend queries all images)
    source_param_name: str               # param name to replace per-image ("source_image" / "base_image")
    shared_params: dict = {}             # remaining params (face_ref, denoise, etc.)
    target_person_id: Optional[str] = None
    result_album_id: Optional[str] = None
    chain_step: Optional[ChainStepCreate] = None  # optional chain step after each task


class ChainStepCreate(BaseModel):
    workflow_type: str
    params: dict
    chain_source_param: str  # param name receiving previous step's output


class ChainTaskCreate(BaseModel):
    first: TaskCreate
    then: List[ChainStepCreate]  # up to 5 steps
    execution_mode: str = "queued"


class QueueConfigUpdate(BaseModel):
    start_mode: Optional[str] = None
    cron_expression: Optional[str] = None
    delay_minutes: Optional[int] = None
    is_paused: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _task_dict(t: Task, db: Session | None = None) -> dict:
    params = json.loads(t.params) if t.params else {}
    d = {
        "id": t.id,
        "workflow_type": t.workflow_type,
        "params": params,
        "status": t.status,
        "queue_order": t.queue_order,
        "execution_mode": t.execution_mode,
        "result_media_ids": json.loads(t.result_media_ids) if t.result_media_ids else [],
        "result_outputs": json.loads(t.result_outputs) if t.result_outputs else {},
        "error_message": t.error_message,
        "created_at": t.created_at.isoformat() + "Z",
        "started_at": t.started_at.isoformat() + "Z" if t.started_at else None,
        "finished_at": t.finished_at.isoformat() + "Z" if t.finished_at else None,
        "batch_id": t.batch_id,
        "chain_id": t.chain_id,
        "chain_order": t.chain_order,
        "chain_source_param": t.chain_source_param,
    }
    if db:
        d["resolved"] = _resolve_params(params, t.workflow_type, db)
        # Include chain partner info when part of a chain
        if t.chain_id:
            partners = db.execute(
                select(Task).where(Task.chain_id == t.chain_id).order_by(Task.chain_order.asc())
            ).scalars().all()
            chain_list = []
            for p in partners:
                ct = {"id": p.id, "workflow_type": p.workflow_type, "status": p.status, "chain_order": p.chain_order}
                # Resolve workflow display name
                if p.workflow_type.startswith("custom:"):
                    wf_id = p.workflow_type[len("custom:"):]
                    wf = db.get(Workflow, wf_id)
                    ct["label"] = _CATEGORY_LABELS.get(wf.category, wf.category) if wf else "工作流"
                else:
                    ct["label"] = _CATEGORY_LABELS.get(p.workflow_type, p.workflow_type)
                chain_list.append(ct)
            d["chain_tasks"] = chain_list
    return d


# Category labels for built-in workflows
_CATEGORY_LABELS = {
    "upscale": "高清放大",
    "face_swap": "换脸",
    "inpaint": "局部修复",
    "image_to_image": "图生图",
    "text_to_image": "文生图",
    "preprocess": "预处理",
}


def _resolve_params(params: dict, workflow_type: str, db: Session) -> dict:
    """Resolve internal IDs in task params to human-readable names."""
    resolved = {}

    # Determine which param keys hold media IDs
    media_id_keys = {"source_media_id", "face_ref_media_id"}

    # Resolve custom workflow → name + category label + image param keys
    if workflow_type.startswith("custom:"):
        wf_id = workflow_type[len("custom:"):]
        wf = db.get(Workflow, wf_id)
        if wf:
            resolved["workflow_name"] = wf.name
            resolved["workflow_category"] = _CATEGORY_LABELS.get(wf.category, wf.category)
            # Extract image-type param names from manifest
            try:
                manifest = json.loads(wf.manifest) if wf.manifest else {}
                for pname, mapping in manifest.get("mappings", {}).items():
                    if mapping.get("type") == "image" and mapping.get("source") != "file_path":
                        media_id_keys.add(pname)
            except (json.JSONDecodeError, AttributeError):
                pass

    # Resolve media IDs → file name + thumb path
    for key in media_id_keys:
        mid = params.get(key)
        if mid and isinstance(mid, str) and len(mid) > 8:
            m = db.get(Media, mid)
            if m:
                resolved[key] = os.path.basename(m.file_path)
                resolved[f"{key}__path"] = m.thumbnail_path or m.file_path

    # Resolve person ID → name
    pid = params.get("target_person_id")
    if pid:
        p = db.get(Person, pid)
        if p:
            resolved["target_person_id"] = p.name

    # Resolve album ID → name
    aid = params.get("result_album_id")
    if aid:
        a = db.get(Album, aid)
        if a:
            resolved["result_album_id"] = a.name

    return resolved


def _next_queue_order(db: Session) -> int:
    max_order = db.execute(select(func.max(Task.queue_order))).scalar()
    return (max_order or 0) + 1


def _get_or_create_queue_config(db: Session) -> QueueConfig:
    config = db.get(QueueConfig, 1)
    if not config:
        config = QueueConfig(id=1, start_mode="manual")
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


# ── Task CRUD ─────────────────────────────────────────────────────────────────

@router.post("")
def create_task(body: TaskCreate, db: Session = Depends(get_db)):
    # Reject standalone tasks that contain unresolved chain placeholders
    if body.params:
        for k, v in body.params.items():
            if v == "__chain_input__":
                raise HTTPException(
                    status_code=400,
                    detail=f"参数 '{k}' 包含未解析的链式占位符 __chain_input__，不能作为独立任务提交",
                )

    # Check if this is a composite workflow — expand into chain
    if body.workflow_type.startswith("custom:"):
        wf_id = body.workflow_type[len("custom:"):]
        wf = db.get(Workflow, wf_id)
        if wf and wf.is_composite:
            return _create_composite_chain(wf, body.params, body.execution_mode, db)

    task = Task(
        id=str(uuid.uuid4()),
        workflow_type=body.workflow_type,
        params=json.dumps(body.params, ensure_ascii=False),
        status="pending",
        queue_order=_next_queue_order(db),
        execution_mode=body.execution_mode,
        created_at=datetime.utcnow(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # Notify queue_runner if immediate or auto mode
    _notify_queue(body.execution_mode, db)

    return _task_dict(task, db)


@router.get("")
def list_tasks(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = select(Task).order_by(Task.queue_order.asc())
    if status:
        q = q.where(Task.status == status)
    return [_task_dict(t, db) for t in db.execute(q).scalars().all()]


@router.get("/stats")
def get_task_stats(db: Session = Depends(get_db)):
    running = db.execute(
        select(func.count(Task.id)).where(Task.status == "running")
    ).scalar() or 0
    failed = db.execute(
        select(func.count(Task.id)).where(Task.status == "failed")
    ).scalar() or 0
    pending = db.execute(
        select(func.count(Task.id)).where(Task.status == "pending")
    ).scalar() or 0

    progress = None
    try:
        from queue_runner import get_current_progress
        progress = get_current_progress()
    except ImportError:
        pass

    return {
        "running": running,
        "failed": failed,
        "pending": pending,
        "completed_since_last_view": _completed_since_last_view,
        "progress": progress,
    }


@router.post("/stats/reset")
def reset_task_stats():
    global _completed_since_last_view
    _completed_since_last_view = 0
    return {"ok": True}


@router.patch("/reorder")
def reorder_tasks(body: TaskReorderRequest, db: Session = Depends(get_db)):
    """Reorder pending tasks by the given ID list."""
    # Load tasks and validate
    tasks_by_id: dict[str, Task] = {}
    for task_id in body.task_ids:
        t = db.get(Task, task_id)
        if not t:
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
        if t.status != "pending":
            raise HTTPException(status_code=400, detail=f"Task {task_id} is not pending")
        tasks_by_id[task_id] = t

    # Validate chain ordering: for each chain_id, all members must be present
    # and their relative order must be preserved (chain_order ascending)
    chain_positions: dict[str, list[tuple[int, int]]] = {}  # chain_id -> [(list_index, chain_order)]
    for idx, task_id in enumerate(body.task_ids):
        t = tasks_by_id[task_id]
        if t.chain_id:
            chain_positions.setdefault(t.chain_id, []).append((idx, t.chain_order))

    for cid, positions in chain_positions.items():
        # Check all chain members are included
        all_chain = db.execute(
            select(Task).where(Task.chain_id == cid, Task.status == "pending")
        ).scalars().all()
        if len(positions) != len(all_chain):
            raise HTTPException(
                status_code=400,
                detail=f"All pending tasks in chain {cid[:8]}... must be included in reorder"
            )
        # Check relative order is preserved
        sorted_by_list_index = sorted(positions, key=lambda x: x[0])
        chain_orders = [co for _, co in sorted_by_list_index]
        if chain_orders != sorted(chain_orders):
            raise HTTPException(
                status_code=400,
                detail=f"Chain tasks must maintain their relative order"
            )

    for idx, task_id in enumerate(body.task_ids):
        tasks_by_id[task_id].queue_order = idx
    db.commit()
    return {"ok": True}


@router.get("/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_dict(t, db)


@router.patch("/{task_id}")
def patch_task(task_id: str, body: TaskPatch, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    if t.status != "pending":
        raise HTTPException(status_code=400, detail="Can only edit pending tasks")
    if body.params is not None:
        t.params = json.dumps(body.params, ensure_ascii=False)
    if body.queue_order is not None:
        t.queue_order = body.queue_order
    db.commit()
    db.refresh(t)
    return _task_dict(t, db)


@router.post("/{task_id}/cancel")
def cancel_task(task_id: str, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    if t.status not in ("pending", "running"):
        raise HTTPException(status_code=400, detail="Can only cancel pending/running tasks")
    t.status = "cancelled"
    t.finished_at = datetime.utcnow()

    # Cascade cancel to later chain steps
    if t.chain_id:
        later = db.execute(
            select(Task).where(
                Task.chain_id == t.chain_id,
                Task.chain_order > t.chain_order,
                Task.status == "pending",
            )
        ).scalars().all()
        for lt in later:
            lt.status = "cancelled"
            lt.finished_at = datetime.utcnow()

    db.commit()
    db.refresh(t)
    return _task_dict(t, db)


@router.post("/{task_id}/retry")
def retry_task(task_id: str, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    if t.status not in ("failed", "cancelled", "completed"):
        raise HTTPException(status_code=400, detail="Can only retry failed/cancelled/completed tasks")

    # Chain retry logic
    if t.chain_id:
        # Check if any predecessor in the chain also failed
        has_failed_predecessor = False
        if t.chain_order > 0:
            has_failed_predecessor = db.execute(
                select(func.count(Task.id)).where(
                    Task.chain_id == t.chain_id,
                    Task.chain_order < t.chain_order,
                    Task.status.in_(("failed", "cancelled")),
                )
            ).scalar() > 0

        if t.chain_order == 0 or has_failed_predecessor:
            # Rebuild the whole chain from the beginning
            old_chain = db.execute(
                select(Task).where(Task.chain_id == t.chain_id).order_by(Task.chain_order.asc())
            ).scalars().all()

            new_chain_id = str(uuid.uuid4())
            new_tasks = []
            for orig in old_chain:
                # Reset chain_source_param placeholder for non-first steps
                params_str = orig.params
                if orig.chain_order > 0 and orig.chain_source_param:
                    p = json.loads(params_str) if params_str else {}
                    p[orig.chain_source_param] = "__chain_input__"
                    params_str = json.dumps(p, ensure_ascii=False)

                order = _next_queue_order(db)
                nt = Task(
                    id=str(uuid.uuid4()),
                    workflow_type=orig.workflow_type,
                    params=params_str,
                    status="pending",
                    execution_mode=orig.execution_mode,
                    queue_order=order,
                    created_at=datetime.utcnow(),
                    chain_id=new_chain_id,
                    chain_order=orig.chain_order,
                    chain_source_param=orig.chain_source_param,
                )
                db.add(nt)
                new_tasks.append(nt)
            db.commit()
            for nt in new_tasks:
                db.refresh(nt)

            _notify_queue(new_tasks[0].execution_mode, db)
            return [_task_dict(nt, db) for nt in new_tasks]

        # chain_order > 0 but all predecessors succeeded — retry just this step standalone.
        # Known limitation: standalone retry won't trigger _finalize_chain_success
        # (reparenting/intermediate cleanup). The result stays as a standalone output.

    # Non-chain or chain_order>0 with all predecessors OK: create standalone task
    new_task = Task(
        id=str(uuid.uuid4()),
        workflow_type=t.workflow_type,
        params=t.params,
        status="pending",
        execution_mode=t.execution_mode,
        queue_order=_next_queue_order(db),
        created_at=datetime.utcnow(),
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)

    _notify_queue(new_task.execution_mode, db)
    return _task_dict(new_task, db)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: str, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    if t.status == "running":
        raise HTTPException(status_code=400, detail="Cannot delete a running task")
    db.delete(t)
    db.commit()


class BulkDeleteRequest(BaseModel):
    statuses: List[str]  # e.g. ["pending", "failed", "cancelled"]


@router.post("/bulk-delete")
def bulk_delete_tasks(body: BulkDeleteRequest, db: Session = Depends(get_db)):
    """Delete all tasks matching the given statuses (cannot delete running tasks)."""
    allowed = {"pending", "failed", "cancelled"}
    invalid = set(body.statuses) - allowed
    if invalid:
        raise HTTPException(status_code=400, detail=f"Cannot bulk-delete statuses: {invalid}")
    tasks = db.execute(
        select(Task).where(Task.status.in_(body.statuses))
    ).scalars().all()
    count = len(tasks)
    for t in tasks:
        db.delete(t)
    db.commit()
    return {"deleted": count}


@router.post("/batch")
def batch_ai(body: BatchAiRequest, db: Session = Depends(get_db)):
    """Create batch AI tasks for multiple images with a shared workflow."""
    # Validate media_ids or album_id (one must be provided)
    if not body.media_ids and not body.album_id:
        raise HTTPException(status_code=400, detail="Either media_ids or album_id is required")
    if body.media_ids and body.album_id:
        raise HTTPException(status_code=400, detail="Provide media_ids or album_id, not both")

    # Resolve media list
    skipped_generated = 0
    album = None
    if body.album_id:
        album = db.get(Album, body.album_id)
        if not album:
            raise HTTPException(status_code=404, detail="Album not found")
        images = db.execute(
            select(Media).where(
                Media.album_id == body.album_id,
                Media.is_deleted == False,
                Media.media_type == "image",
                Media.source_type.in_(["local", "screenshot"]),
            )
        ).scalars().all()
        if not images:
            raise HTTPException(status_code=400, detail="No images in album")
    else:
        images = []
        skipped_generated = 0
        for mid in body.media_ids:
            m = db.get(Media, mid)
            if not m or m.is_deleted:
                raise HTTPException(status_code=404, detail=f"Media {mid} not found")
            if m.media_type != "image":
                continue
            if m.source_type == "generated":
                skipped_generated += 1
                continue
            images.append(m)
        if not images:
            raise HTTPException(status_code=400, detail="No valid images provided")

    # Validate workflow exists
    if not body.workflow_type.startswith("custom:"):
        raise HTTPException(status_code=400, detail="workflow_type must be custom:<id>")
    wf_id = body.workflow_type[len("custom:"):]
    wf = db.get(Workflow, wf_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Check if workflow is composite
    is_composite = wf.is_composite
    # Effective category: for composites, use the workflow's category (derived from first step)
    wf_category = wf.category

    # For face_swap batch: auto-create a generated album for the face ref person
    # The result belongs to the face_ref person (whose face appears in the output)
    result_album_id = None
    face_ref_person_id = None
    if wf_category == "face_swap":
        face_ref_id = body.shared_params.get("face_ref")
        if face_ref_id:
            face_ref = db.get(Media, face_ref_id)
            if face_ref:
                face_ref_person_id = face_ref.person_id
                if face_ref_person_id:
                    source_name = album.name if album else f"{len(images)}张图"
                    new_album = Album(
                        name=f"换脸 - {source_name}",
                        person_id=face_ref_person_id,
                        is_generated_album=True,
                    )
                    db.add(new_album)
                    db.flush()
                    result_album_id = new_album.id

    # Allow explicit result_album_id from request to override auto-created album
    if body.result_album_id and not result_album_id:
        result_album_id = body.result_album_id

    # Create tasks — each result joins the source image's generation chain
    # For face_swap: results belong to face_ref person, not the source album person
    target_person_id = face_ref_person_id or body.target_person_id or (album.person_id if album else None)
    batch_id = str(uuid.uuid4())
    created_tasks = []
    chains_created = 0

    for img in images:
        img_params = {
            **body.shared_params,
            body.source_param_name: img.id,
        }
        if target_person_id:
            img_params["target_person_id"] = target_person_id
        if result_album_id:
            img_params["result_album_id"] = result_album_id

        if is_composite:
            # Expand composite workflow into chain for each image
            chain_tasks = _create_composite_chain(wf, img_params, "queued", db)
            chain_task_list = chain_tasks if isinstance(chain_tasks, list) else [chain_tasks]
            # Set batch_id on all composite chain tasks
            for ct in chain_task_list:
                if isinstance(ct, dict):
                    # _create_composite_chain returns dicts via _task_dict; update underlying Task
                    t_obj = db.get(Task, ct["id"])
                    if t_obj:
                        t_obj.batch_id = batch_id
                else:
                    ct.batch_id = batch_id
            created_tasks.extend(chain_task_list)
            chains_created += 1
        elif body.chain_step:
            # Manual chain step
            chain_id = str(uuid.uuid4())
            order_base = _next_queue_order(db)
            task_a = Task(
                id=str(uuid.uuid4()),
                workflow_type=body.workflow_type,
                params=json.dumps(img_params, ensure_ascii=False),
                status="pending",
                queue_order=order_base,
                execution_mode="queued",
                created_at=datetime.utcnow(),
                batch_id=batch_id,
                chain_id=chain_id,
                chain_order=0,
            )
            db.add(task_a)

            step_params = {**body.chain_step.params}
            step_params[body.chain_step.chain_source_param] = "__chain_input__"
            task_b = Task(
                id=str(uuid.uuid4()),
                workflow_type=body.chain_step.workflow_type,
                params=json.dumps(step_params, ensure_ascii=False),
                status="pending",
                queue_order=order_base + 1,
                execution_mode="queued",
                created_at=datetime.utcnow(),
                batch_id=batch_id,
                chain_id=chain_id,
                chain_order=1,
                chain_source_param=body.chain_step.chain_source_param,
            )
            db.add(task_b)
            created_tasks.extend([task_a, task_b])
            chains_created += 1
        else:
            task = Task(
                id=str(uuid.uuid4()),
                workflow_type=body.workflow_type,
                params=json.dumps(img_params, ensure_ascii=False),
                status="pending",
                queue_order=_next_queue_order(db),
                execution_mode="queued",
                created_at=datetime.utcnow(),
                batch_id=batch_id,
            )
            db.add(task)
            created_tasks.append(task)

    db.commit()
    _notify_queue("queued", db)

    result = {"tasks_created": len(created_tasks), "batch_id": batch_id}
    if chains_created > 0:
        result["chains_created"] = chains_created
    if skipped_generated > 0:
        result["skipped_generated"] = skipped_generated
    return result


@router.post("/chain")
def create_chain_task(body: ChainTaskCreate, db: Session = Depends(get_db)):
    """Create a chain of tasks (A → B) that execute atomically."""
    if len(body.then) == 0:
        raise HTTPException(status_code=400, detail="At least one chained step is required")
    if len(body.then) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 chained steps supported")

    chain_id = str(uuid.uuid4())
    exec_mode = body.execution_mode

    # Task A (first step)
    order_a = _next_queue_order(db)
    task_a = Task(
        id=str(uuid.uuid4()),
        workflow_type=body.first.workflow_type,
        params=json.dumps(body.first.params, ensure_ascii=False),
        status="pending",
        queue_order=order_a,
        execution_mode=exec_mode,
        created_at=datetime.utcnow(),
        chain_id=chain_id,
        chain_order=0,
        chain_source_param=None,
    )
    db.add(task_a)

    # Chained steps (1..N)
    all_tasks = [task_a]
    for idx, step in enumerate(body.then):
        step_params = {**step.params}
        step_params[step.chain_source_param] = "__chain_input__"

        task_step = Task(
            id=str(uuid.uuid4()),
            workflow_type=step.workflow_type,
            params=json.dumps(step_params, ensure_ascii=False),
            status="pending",
            queue_order=order_a + idx + 1,
            execution_mode=exec_mode,
            created_at=datetime.utcnow(),
            chain_id=chain_id,
            chain_order=idx + 1,
            chain_source_param=step.chain_source_param,
        )
        db.add(task_step)
        all_tasks.append(task_step)

    db.commit()
    for t in all_tasks:
        db.refresh(t)

    _notify_queue(exec_mode, db)

    return [_task_dict(t, db) for t in all_tasks]


# ── Queue control ─────────────────────────────────────────────────────────────

@queue_router.post("/start")
def start_queue(db: Session = Depends(get_db)):
    """Manually trigger queue execution."""
    from queue_runner import trigger_manual_start
    pending = db.execute(
        select(func.count(Task.id)).where(Task.status == "pending")
    ).scalar() or 0
    if pending == 0:
        raise HTTPException(status_code=400, detail="No pending tasks")
    trigger_manual_start()
    return {"ok": True, "pending": pending}


@queue_router.get("/config")
def get_queue_config(db: Session = Depends(get_db)):
    config = _get_or_create_queue_config(db)
    return {
        "start_mode": config.start_mode,
        "cron_expression": config.cron_expression,
        "delay_minutes": config.delay_minutes,
        "is_paused": config.is_paused,
        "updated_at": config.updated_at.isoformat() + "Z",
    }


@queue_router.put("/config")
def update_queue_config(body: QueueConfigUpdate, db: Session = Depends(get_db)):
    config = _get_or_create_queue_config(db)
    if body.start_mode is not None:
        if body.start_mode not in ("manual", "auto", "cron", "delay"):
            raise HTTPException(status_code=400, detail="Invalid start_mode")
        config.start_mode = body.start_mode
    if body.cron_expression is not None:
        config.cron_expression = body.cron_expression
    if body.delay_minutes is not None:
        config.delay_minutes = body.delay_minutes
    if body.is_paused is not None:
        config.is_paused = body.is_paused
    config.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(config)
    return {
        "start_mode": config.start_mode,
        "cron_expression": config.cron_expression,
        "delay_minutes": config.delay_minutes,
        "is_paused": config.is_paused,
        "updated_at": config.updated_at.isoformat() + "Z",
    }


# ── Internal helpers ──────────────────────────────────────────────────────────

def _create_composite_chain(
    composite_wf: Workflow, user_params: dict, execution_mode: str, db: Session
):
    """Expand a composite workflow into a chain of tasks."""
    from routers.workflows import _flatten_composite_steps

    flat_steps = _flatten_composite_steps(composite_wf.id, db)

    chain_id = str(uuid.uuid4())
    order_base = _next_queue_order(db)
    all_tasks = []

    # Extract ownership params to propagate to all steps
    ownership_params = {}
    for key in ("target_person_id", "result_album_id"):
        if key in user_params:
            ownership_params[key] = user_params[key]

    for idx, step in enumerate(flat_steps):
        step_params = {**step.get("params_override", {})}

        if idx == 0:
            # First step: merge user params
            step_params.update(user_params)
        else:
            # Subsequent steps: set chain input placeholder + propagate ownership
            source_param = step.get("source_param", "source_image")
            step_params[source_param] = "__chain_input__"
            step_params.update(ownership_params)

        task = Task(
            id=str(uuid.uuid4()),
            workflow_type=f"custom:{step['workflow_id']}",
            params=json.dumps(step_params, ensure_ascii=False),
            status="pending",
            queue_order=order_base + idx,
            execution_mode=execution_mode,
            created_at=datetime.utcnow(),
            chain_id=chain_id,
            chain_order=idx,
            chain_source_param=step.get("source_param") if idx > 0 else None,
        )
        db.add(task)
        all_tasks.append(task)

    db.commit()
    for t in all_tasks:
        db.refresh(t)

    _notify_queue(execution_mode, db)
    return [_task_dict(t, db) for t in all_tasks]


def _notify_queue(execution_mode: str, db: Session):
    """Signal the queue runner based on execution mode and queue config."""
    try:
        from queue_runner import trigger_manual_start, notify_task_added
        if execution_mode == "immediate":
            trigger_manual_start()
        else:
            config = _get_or_create_queue_config(db)
            if config.start_mode == "auto":
                trigger_manual_start()
            elif config.start_mode == "delay":
                notify_task_added()
    except ImportError:
        pass
