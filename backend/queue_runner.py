"""Serial task queue execution engine.

Started as an asyncio task on app startup. Processes tasks one at a time,
dispatching to the appropriate workflow runner (_run_upscale, _run_faceswap,
_run_inpaint).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import shutil
import uuid

import aiohttp
from datetime import datetime
from pathlib import Path
from typing import Optional

from config import get_settings
from database import SessionLocal
from models.task import Task, QueueConfig
from models.media import Media

logger = logging.getLogger("motif.queue_runner")

# ── Progress tracking ────────────────────────────────────────────────────────
_current_progress: dict | None = None


def get_current_progress() -> dict | None:
    """Return current running task progress, or None."""
    return _current_progress


# ── Signals ───────────────────────────────────────────────────────────────────
_manual_event = asyncio.Event()
_task_added_event = asyncio.Event()
_last_task_added_at: float = 0.0


def trigger_manual_start():
    """Called from tasks router to wake up the queue runner."""
    _manual_event.set()


def notify_task_added():
    """Called when a new task is added (for delay mode tracking)."""
    global _last_task_added_at
    _last_task_added_at = asyncio.get_event_loop().time()
    _task_added_event.set()


# ── Main loop ─────────────────────────────────────────────────────────────────

async def run_queue_forever():
    """Main queue runner loop — started once at app startup."""
    logger.info("Queue runner started")

    while True:
        try:
            should = await _should_execute()
            if should:
                # Process all pending tasks sequentially
                while True:
                    executed = await _execute_next_task()
                    if not executed:
                        break
        except Exception as e:
            logger.error(f"Queue runner error: {e}", exc_info=True)

        # Small sleep to prevent busy loop
        await asyncio.sleep(1)


async def _should_execute() -> bool:
    """Decide whether to start processing based on QueueConfig.start_mode."""
    db = SessionLocal()
    try:
        config = db.get(QueueConfig, 1)
        if not config:
            # Default: manual mode, wait for signal
            try:
                await asyncio.wait_for(_manual_event.wait(), timeout=5.0)
                _manual_event.clear()
                return True
            except asyncio.TimeoutError:
                return False

        if config.is_paused:
            await asyncio.sleep(5)
            return False

        mode = config.start_mode

        if mode == "manual":
            try:
                await asyncio.wait_for(_manual_event.wait(), timeout=5.0)
                _manual_event.clear()
                return True
            except asyncio.TimeoutError:
                return False

        elif mode == "auto":
            # Check if any pending tasks exist
            from sqlalchemy import select, func
            pending = db.execute(
                select(func.count(Task.id)).where(Task.status == "pending")
            ).scalar() or 0
            if pending > 0:
                return True
            # Wait a bit for new tasks or manual trigger
            try:
                await asyncio.wait_for(_manual_event.wait(), timeout=3.0)
                _manual_event.clear()
                return True
            except asyncio.TimeoutError:
                return False

        elif mode == "delay":
            delay_minutes = config.delay_minutes or 5
            try:
                await asyncio.wait_for(_task_added_event.wait(), timeout=5.0)
                _task_added_event.clear()
            except asyncio.TimeoutError:
                return False
            # Debounce: wait for delay period, but respond to manual start
            # and reset timer when new tasks are added
            loop = asyncio.get_event_loop()
            deadline = loop.time() + delay_minutes * 60
            while loop.time() < deadline:
                if _manual_event.is_set():
                    _manual_event.clear()
                    return True
                if _task_added_event.is_set():
                    _task_added_event.clear()
                    deadline = loop.time() + delay_minutes * 60  # reset debounce
                await asyncio.sleep(1)
            return True

        elif mode == "cron":
            # Simple cron: check if we should run based on expression
            # For now, just poll every 60 seconds
            await asyncio.sleep(60)
            from sqlalchemy import select, func
            pending = db.execute(
                select(func.count(Task.id)).where(Task.status == "pending")
            ).scalar() or 0
            return pending > 0

        return False
    finally:
        db.close()


async def _execute_next_task() -> bool:
    """Pick the next pending task, execute it, return True if one was processed."""
    from sqlalchemy import select

    db = SessionLocal()
    try:
        task = db.execute(
            select(Task)
            .where(Task.status == "pending")
            .order_by(Task.queue_order.asc())
            .limit(1)
        ).scalar_one_or_none()

        if not task:
            return False

        task_id = task.id
        workflow_type = task.workflow_type
        # Check if task was cancelled before we start
        if task.status == "cancelled":
            return True

        task.status = "running"
        task.started_at = datetime.utcnow()
        db.commit()

        logger.info(f"Executing task {task_id} ({workflow_type})")
    finally:
        db.close()

    # Execute outside the DB session (use task_id, not task.id — task is detached)
    global _current_progress
    try:
        settings = get_settings()
        timeout_s = settings.task_timeout_minutes * 60

        # Safety checks
        _check_disk_space(settings)

        # Initialize progress tracking
        _current_progress = {"task_id": task_id, "value": 0, "max": 1}

        result_media_ids, result_outputs, preview_paths = await asyncio.wait_for(
            _run_task(task_id),
            timeout=timeout_s,
        )

        _current_progress = None

        # Mark completed (unless cancelled during execution)
        db = SessionLocal()
        try:
            t = db.get(Task, task_id)
            if t.status == "cancelled":
                logger.info(f"Task {task_id} was cancelled during execution")
                return True
            t.status = "completed"
            t.result_media_ids = json.dumps(result_media_ids)
            if result_outputs:
                t.result_outputs = json.dumps(result_outputs, ensure_ascii=False)
            t.finished_at = datetime.utcnow()
            db.commit()

            # Chain handling: if this task is part of a chain, try to execute next step
            if t.chain_id:
                chain_continued = await _handle_chain_success(t, db)
                if chain_continued:
                    return True  # chain step was executed, skip normal badge notify
        finally:
            db.close()

        logger.info(f"Task {task_id} completed, results: {result_media_ids}")

        # Notify badge
        try:
            from routers.tasks import increment_completed_count
            increment_completed_count()
        except ImportError:
            pass

        return True

    except asyncio.TimeoutError:
        _current_progress = None
        db = SessionLocal()
        try:
            t = db.get(Task, task_id)
            t.status = "failed"
            t.error_message = f"Task timed out after {settings.task_timeout_minutes} minutes"
            t.finished_at = datetime.utcnow()
            db.commit()
            if t.chain_id:
                _fail_chain_successors(t, db)
        finally:
            db.close()
        logger.error(f"Task {task_id} timed out")
        return True

    except Exception as e:
        _current_progress = None
        db = SessionLocal()
        try:
            t = db.get(Task, task_id)
            t.status = "failed"
            t.error_message = str(e)[:2000]
            t.finished_at = datetime.utcnow()
            db.commit()
            if t.chain_id:
                _fail_chain_successors(t, db)
        finally:
            db.close()
        logger.error(f"Task {task_id} failed: {e}", exc_info=True)
        return True


# ── Chain helpers ──────────────────────────────────────────────────────────────

async def _handle_chain_success(completed_task: Task, db) -> bool:
    """After a chain task succeeds, forward output to next step and execute it.

    Returns True if a chain step was executed (caller should skip normal flow).
    """
    from sqlalchemy import select

    next_task = db.execute(
        select(Task).where(
            Task.chain_id == completed_task.chain_id,
            Task.chain_order == completed_task.chain_order + 1,
            Task.status == "pending",
        )
    ).scalar_one_or_none()

    if not next_task:
        # No more steps — finalize chain
        _finalize_chain_success(completed_task.chain_id, db)
        return False

    # Forward: inject previous result into next task's params
    result_ids = json.loads(completed_task.result_media_ids) if completed_task.result_media_ids else []
    if not result_ids:
        next_task.status = "failed"
        next_task.error_message = "链式前置任务无输出"
        next_task.finished_at = datetime.utcnow()
        db.commit()
        logger.warning(f"Chain {completed_task.chain_id}: no output from step {completed_task.chain_order}")
        return True

    # Replace __chain_input__ placeholder with actual media ID
    next_params = json.loads(next_task.params) if next_task.params else {}
    source_param = next_task.chain_source_param
    if source_param and next_params.get(source_param) == "__chain_input__":
        next_params[source_param] = result_ids[0]
        next_task.params = json.dumps(next_params, ensure_ascii=False)
        db.commit()

    logger.info(f"Chain {completed_task.chain_id}: forwarding to step {next_task.chain_order} (task {next_task.id})")

    # Close current DB session before executing next task
    db.close()

    # Execute the next task immediately (atomic chain execution)
    executed = await _execute_chain_step(next_task.id)
    return True


async def _execute_chain_step(task_id: str) -> bool:
    """Execute a single chain step task. Similar to _execute_next_task but for a specific task."""
    global _current_progress
    from sqlalchemy import select

    db = SessionLocal()
    try:
        task = db.get(Task, task_id)
        if not task or task.status != "pending":
            return False

        task.status = "running"
        task.started_at = datetime.utcnow()
        db.commit()
        logger.info(f"Executing chain step task {task_id} ({task.workflow_type})")
    finally:
        db.close()

    try:
        settings = get_settings()
        timeout_s = settings.task_timeout_minutes * 60
        _check_disk_space(settings)
        _current_progress = {"task_id": task_id, "value": 0, "max": 1}

        result_media_ids, result_outputs, preview_paths = await asyncio.wait_for(
            _run_task(task_id), timeout=timeout_s,
        )
        _current_progress = None

        db = SessionLocal()
        try:
            t = db.get(Task, task_id)
            if t.status == "cancelled":
                return True
            t.status = "completed"
            t.result_media_ids = json.dumps(result_media_ids)
            if result_outputs:
                t.result_outputs = json.dumps(result_outputs, ensure_ascii=False)
            t.finished_at = datetime.utcnow()
            db.commit()

            # Continue chain if there are more steps
            if t.chain_id:
                await _handle_chain_success(t, db)
        finally:
            db.close()

        # Notify badge for the final chain result
        try:
            from routers.tasks import increment_completed_count
            increment_completed_count()
        except ImportError:
            pass

        return True

    except (asyncio.TimeoutError, Exception) as e:
        _current_progress = None
        is_timeout = isinstance(e, asyncio.TimeoutError)
        db = SessionLocal()
        try:
            t = db.get(Task, task_id)
            t.status = "failed"
            if is_timeout:
                t.error_message = f"Task timed out after {get_settings().task_timeout_minutes} minutes"
            else:
                t.error_message = str(e)[:2000]
            t.finished_at = datetime.utcnow()
            db.commit()
            # Cascade failure to subsequent chain steps
            if t.chain_id:
                _fail_chain_successors(t, db)
            logger.error(f"Chain step {task_id} failed: {e}")
        finally:
            db.close()
        return True


def _fail_chain_successors(failed_task: Task, db):
    """When a chain task fails, mark all later pending steps as failed."""
    from sqlalchemy import select

    if not failed_task.chain_id:
        return

    later = db.execute(
        select(Task).where(
            Task.chain_id == failed_task.chain_id,
            Task.chain_order > failed_task.chain_order,
            Task.status == "pending",
        )
    ).scalars().all()

    for t in later:
        t.status = "failed"
        t.error_message = f"链式前置任务失败: {(failed_task.error_message or '未知错误')[:200]}"
        t.finished_at = datetime.utcnow()

    if later:
        db.commit()
        logger.info(f"Chain {failed_task.chain_id}: failed {len(later)} successor tasks")


def _finalize_chain_success(chain_id: str, db):
    """After all chain steps succeed, reparent final output and soft-delete intermediates."""
    if not chain_id:
        return

    from sqlalchemy import select

    chain_tasks = db.execute(
        select(Task).where(Task.chain_id == chain_id).order_by(Task.chain_order.asc())
    ).scalars().all()

    if not chain_tasks or len(chain_tasks) < 2:
        return

    # Check all completed
    if not all(t.status == "completed" for t in chain_tasks):
        return

    first_task = chain_tasks[0]
    last_task = chain_tasks[-1]

    # Determine original source media ID from first task
    first_params = json.loads(first_task.params) if first_task.params else {}
    original_source_id = first_params.get("source_media_id")

    # If no explicit source_media_id, look through workflow manifest
    if not original_source_id:
        from models.workflow import Workflow
        if first_task.workflow_type.startswith("custom:"):
            wf_id = first_task.workflow_type[len("custom:"):]
            wf = db.get(Workflow, wf_id)
            if wf and wf.manifest:
                manifest = json.loads(wf.manifest)
                for pname, mapping in manifest.get("mappings", {}).items():
                    if mapping.get("type") == "image" and mapping.get("source") != "file_path":
                        val = first_params.get(pname)
                        if val and val != "__chain_input__":
                            original_source_id = val
                            break

    if not original_source_id:
        logger.warning(f"Chain {chain_id}: could not determine original source, skipping reparent")
        return

    # Reparent final output to original source
    last_result_ids = json.loads(last_task.result_media_ids) if last_task.result_media_ids else []
    for mid in last_result_ids:
        m = db.get(Media, mid)
        if m:
            m.parent_media_id = original_source_id
            # Record chain history in generation_params (with category for display)
            gen_params = json.loads(m.generation_params) if m.generation_params else {}
            history = []
            for t in chain_tasks:
                entry = {"workflow_type": t.workflow_type, "chain_order": t.chain_order}
                # Resolve category from custom workflow
                if t.workflow_type.startswith("custom:"):
                    from models.workflow import Workflow as WfModel
                    wf_obj = db.get(WfModel, t.workflow_type[len("custom:"):])
                    if wf_obj:
                        entry["category"] = wf_obj.category
                else:
                    entry["category"] = t.workflow_type
                history.append(entry)
            gen_params["chain_history"] = history
            m.generation_params = json.dumps(gen_params, ensure_ascii=False)

    # Soft-delete intermediate results (from steps before the last)
    for t in chain_tasks[:-1]:
        intermediate_ids = json.loads(t.result_media_ids) if t.result_media_ids else []
        for mid in intermediate_ids:
            m = db.get(Media, mid)
            if m and not m.is_deleted:
                m.is_deleted = True
                logger.info(f"Chain {chain_id}: soft-deleted intermediate media {mid}")

    db.commit()
    logger.info(f"Chain {chain_id}: finalized, reparented {len(last_result_ids)} results to {original_source_id}")


def _check_disk_space(settings):
    """Raise if disk space is below 500 MB."""
    disk = shutil.disk_usage(str(settings.appdata_dir))
    if disk.free < 500 * 1024 * 1024:
        raise RuntimeError(f"Disk space too low: {disk.free // (1024*1024)} MB free")


# ── Task dispatcher ───────────────────────────────────────────────────────────

async def _run_task(task_id: str) -> tuple[list[str], dict | None, list[str]]:
    """Dispatch task to the appropriate runner.

    Returns (media_ids, text_outputs, preview_paths).
    """
    global _current_progress

    db = SessionLocal()
    try:
        task = db.get(Task, task_id)
        params = json.loads(task.params) if task.params else {}
        workflow_type = task.workflow_type
    finally:
        db.close()

    async def on_progress(value: int, max_val: int):
        global _current_progress
        _current_progress = {"task_id": task_id, "value": value, "max": max_val}

    if workflow_type == "upscale":
        ids = await _run_upscale(params, on_progress)
        result = ids, None, []
    elif workflow_type == "face_swap":
        ids = await _run_faceswap(params, on_progress)
        result = ids, None, []
    elif workflow_type in ("inpaint_flux", "inpaint_sdxl", "inpaint_klein"):
        ids = await _run_inpaint(params, workflow_type, on_progress)
        result = ids, None, []
    else:
        result = await _run_custom_workflow(params, workflow_type, on_progress)

    # Clean up temporary crop file if present
    crop_path = params.get("crop_path")
    if crop_path:
        try:
            os.remove(crop_path)
        except OSError:
            pass

    return result


# ── Upscale ───────────────────────────────────────────────────────────────────

async def _run_upscale(params: dict, on_progress=None) -> list[str]:
    """
    params: source_media_id, upscale_factor?, denoise?, model?, prompt?, seed?
    """
    from comfyui.client import ComfyUIClient
    from comfyui.workflow import WorkflowBuilder

    settings = get_settings()
    client = ComfyUIClient(settings.comfyui_url)
    builder = WorkflowBuilder()

    source_media_id = params["source_media_id"]
    upscale_factor = params.get("upscale_factor", 2)
    denoise = params.get("denoise", 0.3)
    model = params.get("model", "turbo")
    seed = params.get("seed", -1)

    db = SessionLocal()
    try:
        source = db.get(Media, source_media_id)
        if not source or source.is_deleted:
            raise RuntimeError(f"Source media {source_media_id} not found")
        source_path = source.file_path
        source_person_id = params.get("target_person_id") or source.person_id
        source_album_id = params.get("result_album_id") or source.album_id
    finally:
        db.close()

    # Upload to ComfyUI
    comfy_filename = await client.upload_image(source_path)

    # Build workflow
    prefix = f"motif_upscale_{uuid.uuid4().hex[:8]}"
    workflow = builder.build_upscale(
        input_image=comfy_filename,
        seed=seed,
        filename_prefix=prefix,
        upscale_by=float(upscale_factor),
        denoise=denoise,
        model=model,
    )

    # Run
    results, _previews, _prompt_id = await client.run_workflow(workflow, on_progress=on_progress)
    if not results:
        raise RuntimeError("No output images from ComfyUI")

    # Save result(s)
    media_ids = []
    out_dir = settings.generated_dir("upscale")
    out_dir.mkdir(parents=True, exist_ok=True)

    for i, (filename, data) in enumerate(results):
        stem = Path(source_path).stem
        ext = Path(filename).suffix or ".png"
        out_name = f"{stem}_upscale_{uuid.uuid4().hex[:6]}{ext}"
        out_path = out_dir / out_name
        await client.save_image(data, str(out_path))

        # Get dimensions
        width, height = _get_image_dimensions(str(out_path))

        db = SessionLocal()
        try:
            m = Media(
                id=str(uuid.uuid4()),
                person_id=source_person_id,
                album_id=source_album_id,
                file_path=str(out_path),
                media_type="image",
                source_type="generated",
                parent_media_id=source_media_id,
                workflow_type="upscale",
                generation_params=json.dumps({"upscale_factor": upscale_factor, "denoise": denoise, "model": model}),
                width=width,
                height=height,
                file_size=out_path.stat().st_size,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            db.add(m)
            db.commit()
            media_ids.append(m.id)
        finally:
            db.close()

    return media_ids


# ── Faceswap ─────────────────────────────────────────────────────────────────

async def _run_faceswap(params: dict, on_progress=None) -> list[str]:
    """
    params: source_media_id, face_ref_media_id, result_album_id?, target_person_id?, seed?
    """
    from comfyui.client import ComfyUIClient
    from comfyui.workflow import WorkflowBuilder

    settings = get_settings()
    client = ComfyUIClient(settings.comfyui_url)
    builder = WorkflowBuilder()

    source_media_id = params["source_media_id"]
    face_ref_media_id = params["face_ref_media_id"]
    result_album_id = params.get("result_album_id")
    target_person_id = params.get("target_person_id")
    seed = params.get("seed", -1)

    db = SessionLocal()
    try:
        source = db.get(Media, source_media_id)
        face_ref = db.get(Media, face_ref_media_id)
        if not source or source.is_deleted:
            raise RuntimeError(f"Source media {source_media_id} not found")
        if not face_ref or face_ref.is_deleted:
            raise RuntimeError(f"Face ref media {face_ref_media_id} not found")
        source_path = source.file_path
        face_ref_path = face_ref.file_path
        # Default: result belongs to face_ref's person (the face in the result)
        person_id = target_person_id or face_ref.person_id or source.person_id
        # album_id must belong to the same person (constraint: Media.person_id == Album.person_id)
        if result_album_id:
            album_id = result_album_id
        elif face_ref.album_id and face_ref.person_id == person_id:
            album_id = face_ref.album_id
        elif source.album_id and source.person_id == person_id:
            album_id = source.album_id
        else:
            album_id = None  # loose item under person
    finally:
        db.close()

    # Upload both images
    comfy_base = await client.upload_image(source_path)
    comfy_face = await client.upload_image(face_ref_path)

    # Build workflow
    prefix = f"motif_faceswap_{uuid.uuid4().hex[:8]}"
    workflow = builder.build_faceswap(
        base_image=comfy_base,
        face_ref_image=comfy_face,
        seed=seed,
        filename_prefix=prefix,
    )

    # Run
    results, _previews, _prompt_id = await client.run_workflow(workflow, on_progress=on_progress)
    if not results:
        raise RuntimeError("No output images from ComfyUI")

    # Save
    media_ids = []
    out_dir = settings.generated_dir("face_swap")
    out_dir.mkdir(parents=True, exist_ok=True)

    for filename, data in results:
        stem = Path(source_path).stem
        ext = Path(filename).suffix or ".png"
        out_name = f"{stem}_faceswap_{uuid.uuid4().hex[:6]}{ext}"
        out_path = out_dir / out_name
        await client.save_image(data, str(out_path))

        width, height = _get_image_dimensions(str(out_path))

        db = SessionLocal()
        try:
            m = Media(
                id=str(uuid.uuid4()),
                person_id=person_id,
                album_id=album_id,
                file_path=str(out_path),
                media_type="image",
                source_type="generated",
                parent_media_id=source_media_id,
                workflow_type="face_swap",
                generation_params=json.dumps({
                    "source_media_id": source_media_id,
                    "face_ref_media_id": face_ref_media_id,
                }),
                width=width,
                height=height,
                file_size=out_path.stat().st_size,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            db.add(m)
            db.commit()
            media_ids.append(m.id)
        finally:
            db.close()

    return media_ids


# ── Inpaint ───────────────────────────────────────────────────────────────────

async def _run_inpaint(params: dict, workflow_type: str, on_progress=None) -> list[str]:
    """
    params: source_media_id, mask_path, prompt?, denoise?, seed?
    workflow_type: inpaint_flux | inpaint_sdxl | inpaint_klein
    """
    from comfyui.client import ComfyUIClient
    from comfyui.workflow import WorkflowBuilder

    settings = get_settings()
    client = ComfyUIClient(settings.comfyui_url)
    builder = WorkflowBuilder()

    source_media_id = params["source_media_id"]
    mask_path = params["mask_path"]
    prompt = params.get("prompt", "")
    denoise = params.get("denoise")
    seed = params.get("seed", -1)
    enable_rear_lora = params.get("enable_rear_lora", False)

    db = SessionLocal()
    try:
        source = db.get(Media, source_media_id)
        if not source or source.is_deleted:
            raise RuntimeError(f"Source media {source_media_id} not found")
        source_path = source.file_path
        source_person_id = params.get("target_person_id") or source.person_id
        source_album_id = params.get("result_album_id") or source.album_id
    finally:
        db.close()

    # Upload source + mask
    comfy_source = await client.upload_image(source_path)
    comfy_mask = await client.upload_image(mask_path)

    # Map workflow_type to inpaint mode
    mode_map = {
        "inpaint_flux": "flux",
        "inpaint_sdxl": "sdxl",
        "inpaint_klein": "klein",
    }
    mode = mode_map[workflow_type]

    prefix = f"motif_inpaint_{uuid.uuid4().hex[:8]}"
    workflow = builder.build_inpaint(
        source_image=comfy_source,
        mask_image=comfy_mask,
        mode=mode,
        prompt=prompt,
        seed=seed,
        filename_prefix=prefix,
        denoise=denoise,
        enable_rear_lora=enable_rear_lora,
    )

    results, _previews, _prompt_id = await client.run_workflow(workflow, on_progress=on_progress)
    if not results:
        raise RuntimeError("No output images from ComfyUI")

    media_ids = []
    out_dir = settings.generated_dir("inpaint")
    out_dir.mkdir(parents=True, exist_ok=True)

    for filename, data in results:
        stem = Path(source_path).stem
        ext = Path(filename).suffix or ".png"
        out_name = f"{stem}_inpaint_{uuid.uuid4().hex[:6]}{ext}"
        out_path = out_dir / out_name
        await client.save_image(data, str(out_path))

        width, height = _get_image_dimensions(str(out_path))

        db = SessionLocal()
        try:
            m = Media(
                id=str(uuid.uuid4()),
                person_id=source_person_id,
                album_id=source_album_id,
                file_path=str(out_path),
                media_type="image",
                source_type="generated",
                parent_media_id=source_media_id,
                workflow_type=workflow_type,
                generation_params=json.dumps({
                    "prompt": prompt,
                    "mode": mode,
                    "denoise": denoise,
                    **({"enable_rear_lora": True} if enable_rear_lora else {}),
                }),
                width=width,
                height=height,
                file_size=out_path.stat().st_size,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            db.add(m)
            db.commit()
            media_ids.append(m.id)
        finally:
            db.close()

    # Clean up mask file
    try:
        os.remove(mask_path)
    except OSError:
        pass

    # Clean up crop file if present
    crop_path = params.get("crop_path")
    if crop_path:
        try:
            os.remove(crop_path)
        except OSError:
            pass

    return media_ids


# ── Custom workflow (registered via workflow system) ──────────────────

async def _run_custom_workflow(
    params: dict, workflow_type: str, on_progress=None,
) -> tuple[list[str], dict | None, list[str]]:
    """Run a user-registered workflow. Returns (media_ids, outputs, preview_paths)."""
    from comfyui.client import ComfyUIClient
    from sqlalchemy import select
    from models.workflow import Workflow

    settings = get_settings()
    client = ComfyUIClient(settings.comfyui_url)

    # Look up registered workflow
    # workflow_type format: "custom:<workflow_id>" or bare category name
    workflow_id = None
    if workflow_type.startswith("custom:"):
        workflow_id = workflow_type[len("custom:"):]

    db = SessionLocal()
    try:
        if workflow_id:
            # Look up by workflow ID directly
            wf = db.get(Workflow, workflow_id)
        else:
            # Legacy: look up by category
            wf = db.execute(
                select(Workflow).where(
                    Workflow.category == workflow_type,
                    Workflow.is_default == True,
                ).limit(1)
            ).scalar_one_or_none()
            if not wf:
                wf = db.execute(
                    select(Workflow).where(Workflow.category == workflow_type).limit(1)
                ).scalar_one_or_none()

        if not wf:
            raise RuntimeError(f"No registered workflow for type: {workflow_type}")

        workflow_json = json.loads(wf.workflow_json)
        manifest = json.loads(wf.manifest)
        wf_category = wf.category  # safe dir/file name (e.g. "upscale")
    finally:
        db.close()

    # Apply parameter mappings
    mappings = manifest.get("mappings", {})

    # Detect image+mask sharing the same node → merge into RGBA
    image_mappings_by_node: dict[str, list[tuple[str, dict]]] = {}
    for param_name, mapping in mappings.items():
        if mapping.get("type") == "image" and params.get(param_name) is not None:
            nid = mapping["node_id"]
            image_mappings_by_node.setdefault(nid, []).append((param_name, mapping))

    merged_nodes: set[str] = set()  # node_ids already handled by RGBA merge
    for nid, img_maps in image_mappings_by_node.items():
        if len(img_maps) < 2:
            continue
        # Find the "image" param (media_id) and the "mask" param (file_path)
        image_param = next(((pn, m) for pn, m in img_maps if m.get("source") != "file_path"), None)
        mask_param = next(((pn, m) for pn, m in img_maps if m.get("source") == "file_path"), None)
        if not image_param or not mask_param:
            continue

        # Resolve image file path
        image_value = params[image_param[0]]
        db = SessionLocal()
        try:
            media = db.get(Media, image_value)
            if not media or media.is_deleted:
                raise RuntimeError(f"Media {image_value} not found")
            image_file_path = media.file_path
        finally:
            db.close()

        mask_file_path = params[mask_param[0]]

        # Merge into RGBA PNG
        from PIL import Image as PILImage
        img = PILImage.open(image_file_path).convert("RGB")
        mask = PILImage.open(mask_file_path).convert("L")
        if mask.size != img.size:
            mask = mask.resize(img.size, PILImage.LANCZOS)
        rgba = img.copy()
        rgba.putalpha(mask)

        import tempfile
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        rgba.save(tmp.name, "PNG")
        tmp.close()

        comfy_name = await client.upload_image(tmp.name)
        os.remove(tmp.name)

        # Both mappings point to same node+key, set once
        workflow_json[nid]["inputs"][image_param[1]["key"]] = comfy_name
        merged_nodes.add(nid)
        logger.info(f"Merged image+mask into RGBA for node {nid}")

    for param_name, mapping in mappings.items():
        node_id = mapping["node_id"]
        key = mapping["key"]
        value = params.get(param_name)
        if value is None:
            continue

        # Skip image params already handled by RGBA merge
        if mapping.get("type") == "image" and node_id in merged_nodes:
            continue

        if mapping.get("type") == "image":
            # value is a media_id or file_path
            if mapping.get("source") == "file_path":
                # Direct file path (e.g. mask)
                comfy_name = await client.upload_image(value)
            else:
                # Media ID — look up file_path
                db = SessionLocal()
                try:
                    media = db.get(Media, value)
                    if not media or media.is_deleted:
                        raise RuntimeError(f"Media {value} not found")
                    comfy_name = await client.upload_image(media.file_path)
                finally:
                    db.close()
            workflow_json[node_id]["inputs"][key] = comfy_name
        else:
            workflow_json[node_id]["inputs"][key] = value

    # Apply extra params
    for ep in manifest.get("extra_params", []):
        ep_value = params.get(ep["name"])
        if ep_value is None:
            continue
        if ep.get("type") == "image":
            # Image extra param: value is a media_id — upload to ComfyUI
            if ep.get("source") == "file_path":
                comfy_name = await client.upload_image(ep_value)
            else:
                db = SessionLocal()
                try:
                    media = db.get(Media, ep_value)
                    if not media or media.is_deleted:
                        raise RuntimeError(f"Media {ep_value} not found")
                    comfy_name = await client.upload_image(media.file_path)
                finally:
                    db.close()
            workflow_json[ep["node_id"]]["inputs"][ep["key"]] = comfy_name
        else:
            workflow_json[ep["node_id"]]["inputs"][ep["key"]] = ep_value

    # Run workflow
    results, previews, prompt_id = await client.run_workflow(workflow_json, on_progress=on_progress)

    # Extract outputs (text + image) from output_mappings
    text_outputs: dict | None = None
    output_mappings = manifest.get("output_mappings", {})
    if output_mappings:
        raw_outputs = await client.get_all_outputs(prompt_id)
        text_outputs = await _extract_outputs(raw_outputs, output_mappings, client, settings)

    # Save result images
    media_ids: list[str] = []

    # Collect image data from SaveImage results + output_mappings images
    image_items: list[tuple[str, bytes | None, str | None]] = []
    # (filename, data, None) for SaveImage results — need to save data
    # (filename, None, existing_path) for output_mapping images — already on disk
    for filename, data in results:
        image_items.append((filename, data, None))

    # If no SaveImage results but output_mappings produced images, promote them
    if not image_items and text_outputs:
        for out_name, out_val in text_outputs.items():
            if isinstance(out_val, dict) and out_val.get("type") == "image":
                if "path" in out_val:
                    p = out_val["path"]
                    image_items.append((Path(p).name, None, p))
                elif "paths" in out_val:
                    for p in out_val["paths"]:
                        image_items.append((Path(p).name, None, p))

    if image_items:
        source_media_id = params.get("parent_media_id_override") or params.get("source_media_id")
        source_person_id = params.get("target_person_id")
        source_album_id = params.get("result_album_id")

        # If no explicit source_media_id, find the first image-type param from mappings
        if not source_media_id:
            for param_name, mapping in mappings.items():
                if mapping.get("type") == "image" and mapping.get("source") != "file_path":
                    mid_val = params.get(param_name)
                    if mid_val:
                        source_media_id = mid_val
                        break

        # Determine which image to inherit person/album from
        # For face_swap: default to face_ref (the person whose face appears in result)
        # The "result_owner" param lets users override: "face_ref" or "base_image"
        owner_media_id = None
        if wf_category == "face_swap":
            result_owner = params.get("result_owner", "face_ref")
            owner_media_id = params.get(result_owner)

        # Fall back to source_media_id if no owner resolved
        if not owner_media_id:
            owner_media_id = source_media_id

        # Try to get person/album from the owner media
        if owner_media_id and (not source_person_id or not source_album_id):
            db = SessionLocal()
            try:
                owner = db.get(Media, owner_media_id)
                if owner:
                    source_person_id = source_person_id or owner.person_id
                    # Only inherit album_id if it belongs to the same person
                    # (constraint: Media.person_id == Album.person_id when album_id is set)
                    if not source_album_id and owner.album_id and owner.person_id == source_person_id:
                        source_album_id = owner.album_id
            finally:
                db.close()

        out_dir = settings.generated_dir(wf_category)
        out_dir.mkdir(parents=True, exist_ok=True)

        for filename, data, existing_path in image_items:
            ext = Path(filename).suffix or ".png"
            out_name = f"{wf_category}_{uuid.uuid4().hex[:8]}{ext}"
            out_path = out_dir / out_name

            if data is not None:
                # SaveImage result — write data to file
                await client.save_image(data, str(out_path))
            else:
                # output_mapping image — move from preview cache to generated dir
                shutil.move(existing_path, str(out_path))

            width, height = _get_image_dimensions(str(out_path))

            db = SessionLocal()
            try:
                m = Media(
                    id=str(uuid.uuid4()),
                    person_id=source_person_id,
                    album_id=source_album_id,
                    file_path=str(out_path),
                    media_type="image",
                    source_type="generated",
                    parent_media_id=source_media_id,
                    workflow_type=wf_category,
                    generation_params=json.dumps(params, ensure_ascii=False),
                    width=width,
                    height=height,
                    file_size=out_path.stat().st_size,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                db.add(m)
                db.commit()
                media_ids.append(m.id)
            finally:
                db.close()

    return media_ids, text_outputs, []


async def _extract_outputs(
    raw_outputs: dict, output_mappings: dict, client, settings,
) -> dict:
    """Extract text and image outputs from ComfyUI /history raw outputs using mappings.

    For text mappings:  {"caption": {"node_id": "15", "key": "text"}}
    For image mappings: {"preview": {"node_id": "20", "key": "images", "type": "image"}}

    Image outputs are downloaded, saved locally, and stored as {"type": "image", "path": "..."}.
    """
    result = {}
    for name, mapping in output_mappings.items():
        node_id = mapping["node_id"]
        key = mapping["key"]
        mapping_type = mapping.get("type")
        node_output = raw_outputs.get(node_id, {})
        values = node_output.get(key)
        if values is None:
            continue

        if mapping_type == "image":
            # values is a list of image descriptors: [{"filename": ..., "subfolder": ..., "type": "temp"/"output"}]
            preview_dir = settings.appdata_dir / "cache" / "previews"
            preview_dir.mkdir(parents=True, exist_ok=True)
            saved_paths = []
            async with aiohttp.ClientSession() as session:
                for img_desc in values:
                    filename = img_desc["filename"]
                    subfolder = img_desc.get("subfolder", "")
                    img_type = img_desc.get("type", "output")
                    params = f"filename={filename}&subfolder={subfolder}&type={img_type}"
                    async with session.get(f"{client.base_url}/view?{params}") as resp:
                        resp.raise_for_status()
                        data = await resp.read()
                    ext = Path(filename).suffix or ".png"
                    out_name = f"preview_{uuid.uuid4().hex[:8]}{ext}"
                    out_path = preview_dir / out_name
                    await client.save_image(data, str(out_path))
                    saved_paths.append(str(out_path))

            if len(saved_paths) == 1:
                result[name] = {"type": "image", "path": saved_paths[0]}
            elif saved_paths:
                result[name] = {"type": "image", "paths": saved_paths}
        else:
            # Text / scalar output
            if isinstance(values, list) and len(values) == 1:
                result[name] = values[0]
            elif isinstance(values, list):
                result[name] = values
            else:
                result[name] = values
    return result


# ── Utilities ─────────────────────────────────────────────────────────────────

def _get_image_dimensions(path: str) -> tuple[Optional[int], Optional[int]]:
    """Get image width and height, returns (None, None) on failure."""
    try:
        from PIL import Image
        with Image.open(path) as img:
            return img.size
    except Exception:
        return None, None
