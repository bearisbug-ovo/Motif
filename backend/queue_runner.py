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
            # Wait for the delay period after last task was added
            await asyncio.sleep(delay_minutes * 60)
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
        finally:
            db.close()
        logger.error(f"Task {task_id} failed: {e}", exc_info=True)
        return True


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
        return ids, None, []
    elif workflow_type == "face_swap":
        ids = await _run_faceswap(params, on_progress)
        return ids, None, []
    elif workflow_type in ("inpaint_flux", "inpaint_sdxl", "inpaint_klein"):
        ids = await _run_inpaint(params, workflow_type, on_progress)
        return ids, None, []
    else:
        return await _run_custom_workflow(params, workflow_type, on_progress)


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
        source_person_id = source.person_id
        source_album_id = source.album_id
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
        person_id = target_person_id or source.person_id
        album_id = result_album_id or source.album_id
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
                parent_media_id=face_ref_media_id,
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
        source_person_id = source.person_id
        source_album_id = source.album_id
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
        if ep_value is not None:
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
    if results:
        source_media_id = params.get("source_media_id")
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

        # Try to get person/album from source media
        if source_media_id and (not source_person_id or not source_album_id):
            db = SessionLocal()
            try:
                source = db.get(Media, source_media_id)
                if source:
                    source_person_id = source_person_id or source.person_id
                    source_album_id = source_album_id or source.album_id
            finally:
                db.close()

        out_dir = settings.generated_dir(wf_category)
        out_dir.mkdir(parents=True, exist_ok=True)

        for filename, data in results:
            ext = Path(filename).suffix or ".png"
            out_name = f"{wf_category}_{uuid.uuid4().hex[:8]}{ext}"
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
