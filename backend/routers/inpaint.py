"""M7 — Inpaint router (flux / sdxl / klein) + SSE progress."""
import asyncio
import json
import os
import uuid
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models.image import Image
from schemas.image import InpaintRequest
from comfyui.client import client
from comfyui.workflow import builder

router = APIRouter()

# Separate task store for inpaint tasks
inpaint_store: dict[str, dict] = {}


def _task(task_id: str) -> dict:
    return inpaint_store.setdefault(
        task_id,
        {"stage": "pending", "progress": 0, "image_url": None, "error": None},
    )


def _update(task_id: str, **kwargs) -> None:
    inpaint_store[task_id].update(kwargs)


# ------------------------------------------------------------------ #
# POST /api/inpaint                                                     #
# ------------------------------------------------------------------ #

@router.post("")
async def submit_inpaint(
    image_id: int = Form(...),
    prompt: str = Form(""),
    mode: str = Form("flux"),
    denoise: float | None = Form(None),
    seed: int = Form(-1),
    mask: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if mode not in ("flux", "sdxl", "klein"):
        raise HTTPException(status_code=400, detail="mode must be flux | sdxl | klein")

    img_record = db.get(Image, image_id)
    if not img_record:
        raise HTTPException(status_code=404, detail="Image not found")

    source_path = img_record.filepath
    if not os.path.exists(source_path):
        raise HTTPException(status_code=404, detail="Source image file not found")

    # Save mask to temp file
    os.makedirs("media/uploads", exist_ok=True)
    mask_filename = f"mask_{uuid.uuid4().hex}.png"
    mask_path = f"media/uploads/{mask_filename}"
    mask_bytes = await mask.read()
    with open(mask_path, "wb") as f:
        f.write(mask_bytes)

    task_id = str(uuid.uuid4())
    _task(task_id)

    asyncio.create_task(
        _run_inpaint(
            task_id=task_id,
            source_path=source_path,
            mask_path=mask_path,
            mode=mode,
            prompt=prompt,
            denoise=denoise,
            seed=seed,
            source_image_id=image_id,
        )
    )
    return {"task_id": task_id}


# ------------------------------------------------------------------ #
# Background pipeline                                                   #
# ------------------------------------------------------------------ #

async def _run_inpaint(
    task_id: str,
    source_path: str,
    mask_path: str,
    mode: str,
    prompt: str,
    denoise: float | None,
    seed: int,
    source_image_id: int,
) -> None:
    try:
        _update(task_id, stage="inpainting", progress=0)

        async def on_progress(val: int, max_val: int) -> None:
            pct = int(val / max_val * 100) if max_val else 0
            _update(task_id, progress=pct)

        src_comfyui = await client.upload_image(source_path)
        mask_comfyui = await client.upload_image(mask_path)

        prefix = f"generated/inpaint_{task_id}"
        wf = builder.build_inpaint(
            source_image=src_comfyui,
            mask_image=mask_comfyui,
            mode=mode,
            prompt=prompt,
            seed=seed,
            filename_prefix=prefix,
            denoise=denoise,
        )
        images = await client.run_workflow(wf, on_progress=on_progress)

        if not images:
            raise RuntimeError("No output images from inpaint stage")

        fname, data = images[0]
        local_path = f"media/generated/{task_id}_inpaint.png"
        await client.save_image(data, local_path)
        _update(task_id, progress=100)

        await client.free_cache()

        # Record in DB
        with SessionLocal() as db:
            src = db.get(Image, source_image_id)
            new_img = Image(
                filepath=local_path,
                character_id=src.character_id if src else None,
                action_id=src.action_id if src else None,
                prompt=prompt,
                model=src.model if src else "turbo",
                seed=seed if seed >= 0 else 0,
                inpainted=True,
            )
            db.add(new_img)
            db.commit()

        image_url = f"/{local_path}"
        _update(task_id, stage="done", progress=100, image_url=image_url)

    except Exception as exc:
        _update(task_id, stage="error", error=str(exc))
        try:
            await client.free_cache()
        except Exception:
            pass


# ------------------------------------------------------------------ #
# GET /api/inpaint/{task_id}/progress  — SSE                           #
# ------------------------------------------------------------------ #

@router.get("/{task_id}/progress")
async def stream_inpaint_progress(task_id: str):
    if task_id not in inpaint_store:
        raise HTTPException(status_code=404, detail="Task not found")
    return StreamingResponse(
        _sse_generator(task_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _sse_generator(task_id: str) -> AsyncIterator[str]:
    while True:
        state = inpaint_store.get(task_id)
        if state is None:
            yield f"data: {json.dumps({'stage': 'error', 'error': 'task not found'})}\n\n"
            return
        yield f"data: {json.dumps({'stage': state['stage'], 'progress': state['progress'], 'image_url': state.get('image_url'), 'error': state.get('error')}, ensure_ascii=False)}\n\n"
        if state["stage"] in ("done", "error"):
            return
        await asyncio.sleep(0.5)
