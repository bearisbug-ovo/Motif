"""M6 — Generation task: preprocessing + 3-stage serial dispatch + SSE."""
import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models.character import Character
from models.image import Image
from schemas.generate import GenerateRequest, TaskStatus, TaskMeta
from comfyui.client import client
from comfyui.workflow import builder

router = APIRouter()

# In-memory task store  {task_id: dict}
task_store: dict[str, dict] = {}


def _task(task_id: str, meta: dict) -> dict:
    entry = {
        "stage": "pending",
        "progress": 0,
        "image_url": None,
        "error": None,
        **meta,
    }
    task_store[task_id] = entry
    return entry


def _update(task_id: str, **kwargs) -> None:
    if task_id in task_store:
        task_store[task_id].update(kwargs)


# ------------------------------------------------------------------ #
# GET /api/generate  — list all tasks                                  #
# ------------------------------------------------------------------ #

@router.get("", response_model=list[TaskMeta])
def list_tasks():
    """Return all tasks newest-first."""
    tasks = sorted(task_store.values(), key=lambda t: t["created_at"], reverse=True)
    return [TaskMeta(**t) for t in tasks]


# ------------------------------------------------------------------ #
# DELETE /api/generate/{task_id}  — remove from list                   #
# ------------------------------------------------------------------ #

@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: str):
    if task_id not in task_store:
        raise HTTPException(status_code=404, detail="Task not found")
    task_store.pop(task_id)


# ------------------------------------------------------------------ #
# POST /api/generate                                                    #
# ------------------------------------------------------------------ #

@router.post("")
async def submit_generate(
    body: GenerateRequest,
    db: Session = Depends(get_db),
):
    task_id = str(uuid.uuid4())

    char_name: str | None = None
    face_crop_nobg: str | None = None
    char_photos: list[str] = []

    if body.character_id:
        char = db.get(Character, body.character_id)
        if not char:
            raise HTTPException(status_code=404, detail="Character not found")
        char_name = char.name
        face_crop_nobg = char.face_crop_nobg
        char_photos = json.loads(char.reference_photos or "[]")

    _task(task_id, {
        "task_id": task_id,
        "character_id": body.character_id,
        "character_name": char_name,
        "prompt": body.prompt,
        "model": body.model,
        "faceswap": body.faceswap,
        "upscale": body.upscale,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    asyncio.create_task(
        _run_pipeline(
            task_id=task_id,
            body=body,
            face_crop_nobg=face_crop_nobg,
            char_photos=char_photos,
        )
    )
    return {"task_id": task_id}


# ------------------------------------------------------------------ #
# Background pipeline                                                   #
# ------------------------------------------------------------------ #

async def _run_pipeline(
    task_id: str,
    body: GenerateRequest,
    face_crop_nobg: str | None,
    char_photos: list[str],
) -> None:
    try:
        prefix_base = f"generated/{task_id}"
        final_path: str | None = None

        # ── Stage 0: Preprocess face (on-demand) ─────────────────────
        if body.faceswap and body.character_id and not face_crop_nobg and char_photos:
            _update(task_id, stage="preprocessing", progress=0)
            face_crop_nobg = await _preprocess_face(
                char_id=body.character_id,
                photo_path=char_photos[0],
                task_id=task_id,
            )

        # ── Stage 1: Generate ─────────────────────────────────────────
        _update(task_id, stage="generating", progress=0)

        async def on_gen_progress(val: int, max_val: int) -> None:
            _update(task_id, progress=int(val / max_val * 100) if max_val else 0)

        wf = builder.build_generate(
            prompt=body.prompt,
            model=body.model,
            seed=body.seed,
            width=body.width,
            height=body.height,
            filename_prefix=f"{prefix_base}_gen",
        )
        images = await client.run_workflow(wf, on_progress=on_gen_progress)

        if not images:
            raise RuntimeError("No output images from generation stage")

        fname, data = images[0]
        gen_local = f"media/generated/{task_id}_gen.png"
        await client.save_image(data, gen_local)
        final_path = gen_local
        _update(task_id, progress=100)

        await client.free_cache()

        # ── Stage 2: Faceswap (optional) ─────────────────────────────
        if body.faceswap and face_crop_nobg and os.path.exists(face_crop_nobg):
            _update(task_id, stage="faceswapping", progress=0)

            async def on_fs_progress(val: int, max_val: int) -> None:
                _update(task_id, progress=int(val / max_val * 100) if max_val else 0)

            base_comfyui = await client.upload_image(gen_local)
            face_comfyui = await client.upload_image(face_crop_nobg)

            wf_fs = builder.build_faceswap(
                base_image=base_comfyui,
                face_ref_image=face_comfyui,
                seed=body.seed,
                filename_prefix=f"{prefix_base}_fs",
            )
            fs_images = await client.run_workflow(wf_fs, on_progress=on_fs_progress)

            if fs_images:
                fs_fname, fs_data = fs_images[0]
                fs_local = f"media/generated/{task_id}_fs.png"
                await client.save_image(fs_data, fs_local)
                final_path = fs_local
                _update(task_id, progress=100)

            await client.free_cache()

        # ── Stage 3: Upscale (optional) ──────────────────────────────
        if body.upscale and final_path:
            _update(task_id, stage="upscaling", progress=0)

            async def on_up_progress(val: int, max_val: int) -> None:
                _update(task_id, progress=int(val / max_val * 100) if max_val else 0)

            up_comfyui = await client.upload_image(final_path)
            wf_up = builder.build_upscale(
                input_image=up_comfyui,
                prompt=body.prompt,
                seed=body.seed,
                filename_prefix=f"{prefix_base}_up",
                model=body.model,
            )
            up_images = await client.run_workflow(wf_up, on_progress=on_up_progress)

            if up_images:
                up_fname, up_data = up_images[0]
                up_local = f"media/generated/{task_id}_up.png"
                await client.save_image(up_data, up_local)
                final_path = up_local
                _update(task_id, progress=100)

            await client.free_cache()

        # ── Persist Image record ──────────────────────────────────────
        with SessionLocal() as db:
            img = Image(
                filepath=final_path,
                character_id=body.character_id,
                action_id=None,
                prompt=body.prompt,
                model=body.model,
                seed=body.seed if body.seed >= 0 else 0,
                faceswapped=body.faceswap and face_crop_nobg is not None,
                upscaled=body.upscale,
            )
            db.add(img)
            db.commit()

        image_url = f"/{final_path.replace(os.sep, '/')}"
        _update(task_id, stage="done", progress=100, image_url=image_url)

    except Exception as exc:
        _update(task_id, stage="error", error=str(exc))
        try:
            await client.free_cache()
        except Exception:
            pass


async def _preprocess_face(char_id: int, photo_path: str, task_id: str) -> str | None:
    """Run Inspyrenet on photo, save result, update Character DB. Returns face_crop_nobg path."""
    import uuid as _uuid
    PROCESSED_DIR = "media/processed"
    os.makedirs(PROCESSED_DIR, exist_ok=True)
    prefix = f"processed/char{char_id}_{_uuid.uuid4().hex[:8]}_nobg"

    comfyui_filename = await client.upload_image(photo_path)

    # Simple progress proxy: preprocessing is indeterminate, just show 50%
    _update(task_id, progress=50)

    wf = builder.build_preprocess(comfyui_filename, prefix)
    images = await client.run_workflow(wf)

    if not images:
        return None

    fname, data = images[0]
    local_path = os.path.join(PROCESSED_DIR, os.path.basename(fname))
    await client.save_image(data, local_path)
    face_path = f"media/processed/{os.path.basename(fname)}"

    # Update Character record
    with SessionLocal() as db:
        char = db.get(Character, char_id)
        if char:
            char.face_crop_nobg = face_path
            db.commit()

    await client.free_cache()
    return face_path


# ------------------------------------------------------------------ #
# GET /api/generate/{task_id}/progress  — SSE                          #
# ------------------------------------------------------------------ #

@router.get("/{task_id}/progress")
async def stream_progress(task_id: str):
    if task_id not in task_store:
        raise HTTPException(status_code=404, detail="Task not found")
    return StreamingResponse(
        _sse_generator(task_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _sse_generator(task_id: str) -> AsyncIterator[str]:
    while True:
        state = task_store.get(task_id)
        if state is None:
            yield _sse_event({"stage": "error", "error": "task not found"})
            return

        yield _sse_event({
            "stage": state["stage"],
            "progress": state["progress"],
            "image_url": state.get("image_url"),
            "error": state.get("error"),
        })

        if state["stage"] in ("done", "error"):
            return

        await asyncio.sleep(0.5)


def _sse_event(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# ------------------------------------------------------------------ #
# GET /api/generate/{task_id}  — one-shot status poll                  #
# ------------------------------------------------------------------ #

@router.get("/{task_id}", response_model=TaskStatus)
def get_task_status(task_id: str):
    state = task_store.get(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskStatus(task_id=task_id, **{
        k: state[k] for k in ("stage", "progress", "image_url", "error")
    })
