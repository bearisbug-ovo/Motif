"""Task queue CRUD and queue control endpoints."""
from __future__ import annotations

import json
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


class BatchFaceSwapRequest(BaseModel):
    album_id: str
    face_ref_media_id: str
    target_person_id: Optional[str] = None
    count: int = 1
    result_album_name: Optional[str] = None


class QueueConfigUpdate(BaseModel):
    start_mode: Optional[str] = None
    cron_expression: Optional[str] = None
    delay_minutes: Optional[int] = None
    is_paused: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _task_dict(t: Task) -> dict:
    return {
        "id": t.id,
        "workflow_type": t.workflow_type,
        "params": json.loads(t.params) if t.params else {},
        "status": t.status,
        "queue_order": t.queue_order,
        "execution_mode": t.execution_mode,
        "result_media_ids": json.loads(t.result_media_ids) if t.result_media_ids else [],
        "result_outputs": json.loads(t.result_outputs) if t.result_outputs else {},
        "error_message": t.error_message,
        "created_at": t.created_at.isoformat(),
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "finished_at": t.finished_at.isoformat() if t.finished_at else None,
    }


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

    return _task_dict(task)


@router.get("")
def list_tasks(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = select(Task).order_by(Task.queue_order.asc())
    if status:
        q = q.where(Task.status == status)
    return [_task_dict(t) for t in db.execute(q).scalars().all()]


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
    for idx, task_id in enumerate(body.task_ids):
        t = db.get(Task, task_id)
        if not t:
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
        if t.status != "pending":
            raise HTTPException(status_code=400, detail=f"Task {task_id} is not pending")
        t.queue_order = idx
    db.commit()
    return {"ok": True}


@router.get("/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_dict(t)


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
    return _task_dict(t)


@router.post("/{task_id}/cancel")
def cancel_task(task_id: str, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    if t.status not in ("pending", "running"):
        raise HTTPException(status_code=400, detail="Can only cancel pending/running tasks")
    t.status = "cancelled"
    t.finished_at = datetime.utcnow()
    db.commit()
    db.refresh(t)
    return _task_dict(t)


@router.post("/{task_id}/retry")
def retry_task(task_id: str, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    if t.status not in ("failed", "cancelled", "completed"):
        raise HTTPException(status_code=400, detail="Can only retry failed/cancelled/completed tasks")

    # Create a new task with a new ID, preserving the original params
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
    return _task_dict(new_task)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: str, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    if t.status == "running":
        raise HTTPException(status_code=400, detail="Cannot delete a running task")
    db.delete(t)
    db.commit()


@router.post("/batch-faceswap")
def batch_faceswap(body: BatchFaceSwapRequest, db: Session = Depends(get_db)):
    """Create batch faceswap tasks for all images in an album."""
    album = db.get(Album, body.album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")

    face_ref = db.get(Media, body.face_ref_media_id)
    if not face_ref or face_ref.is_deleted:
        raise HTTPException(status_code=404, detail="Face reference media not found")

    # Get all images in the source album
    images = db.execute(
        select(Media).where(
            Media.album_id == body.album_id,
            Media.is_deleted == False,
            Media.media_type == "image",
        )
    ).scalars().all()
    if not images:
        raise HTTPException(status_code=400, detail="No images in album")

    # Create result album
    result_album_name = body.result_album_name or f"{album.name} - 换脸"
    target_person_id = body.target_person_id or album.person_id
    result_album = Album(
        id=str(uuid.uuid4()),
        name=result_album_name,
        person_id=target_person_id,
        is_generated_album=True,
        source_face_media_id=body.face_ref_media_id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(result_album)
    db.commit()

    # Create tasks
    created_tasks = []
    for img in images:
        for _ in range(body.count):
            params = {
                "source_media_id": img.id,
                "face_ref_media_id": body.face_ref_media_id,
                "result_album_id": result_album.id,
                "target_person_id": target_person_id,
            }
            task = Task(
                id=str(uuid.uuid4()),
                workflow_type="face_swap",
                params=json.dumps(params, ensure_ascii=False),
                status="pending",
                queue_order=_next_queue_order(db),
                execution_mode="queued",
                created_at=datetime.utcnow(),
            )
            db.add(task)
            created_tasks.append(task)
    db.commit()

    _notify_queue("queued", db)

    return {
        "result_album_id": result_album.id,
        "tasks_created": len(created_tasks),
    }


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
        "updated_at": config.updated_at.isoformat(),
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
        "updated_at": config.updated_at.isoformat(),
    }


# ── Internal helpers ──────────────────────────────────────────────────────────

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
