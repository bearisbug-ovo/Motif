"""Generic workflow engine utilities for the unified workflow system.

These are standalone functions — not a framework. Callers (queue_runner, etc.)
import and call whichever functions they need.
"""
from __future__ import annotations

import copy
import json
import random
import uuid
from pathlib import Path
from typing import Callable, Awaitable, Optional

from database import SessionLocal
from models.media import Media


async def upload_images_from_manifest(
    client,
    manifest: dict,
    params: dict,
    db=None,
) -> dict[str, str]:
    """Upload image params to ComfyUI based on manifest mappings.

    For each mapping with type=image:
    - If the param value looks like a UUID (media_id), resolve file_path from DB
    - If source=file_path in the category def, treat value as a file path directly
    - Upload to ComfyUI and return {param_name: comfyui_filename}
    """
    mappings = manifest.get("mappings", {})
    uploaded: dict[str, str] = {}
    own_db = db is None

    if own_db:
        db = SessionLocal()

    try:
        for param_name, mapping in mappings.items():
            if mapping.get("type") != "image":
                continue

            value = params.get(param_name)
            if not value:
                continue

            # Determine file path
            file_path = value
            source = mapping.get("source")
            if source != "file_path":
                # Treat as media_id, look up file path
                media = db.get(Media, value)
                if not media or media.is_deleted:
                    raise RuntimeError(f"Media {value} not found for param '{param_name}'")
                file_path = media.file_path

            comfy_filename = await client.upload_image(file_path)
            uploaded[param_name] = comfy_filename

        # Also upload image-type extra_params
        for extra in manifest.get("extra_params", []):
            if extra.get("type") != "image":
                continue
            ep_name = extra["name"]
            value = params.get(ep_name)
            if not value:
                continue
            source = extra.get("source")
            if source == "file_path":
                # Treat value as a file path directly (e.g. mask)
                file_path = value
            else:
                # Treat as media_id, look up file path
                media = db.get(Media, value)
                if not media or media.is_deleted:
                    raise RuntimeError(f"Media {value} not found for extra param '{ep_name}'")
                file_path = media.file_path
            comfy_filename = await client.upload_image(file_path)
            uploaded[ep_name] = comfy_filename
    finally:
        if own_db:
            db.close()

    return uploaded


def build_workflow_from_manifest(
    workflow_json: dict,
    manifest: dict,
    params: dict,
    uploaded_images: dict[str, str] | None = None,
) -> dict:
    """Deep-copy workflow_json and inject param values per manifest mappings.

    Args:
        workflow_json: The ComfyUI API-format workflow template.
        manifest: {"mappings": {param_name: {"node_id", "key", "type", ...}}, "extra_params": [...]}
        params: User-provided parameter values.
        uploaded_images: {param_name: comfyui_filename} from upload_images_from_manifest.
    """
    wf = copy.deepcopy(workflow_json)
    mappings = manifest.get("mappings", {})
    uploaded = uploaded_images or {}

    for param_name, mapping in mappings.items():
        node_id = mapping["node_id"]
        key = mapping["key"]

        # Image params: use uploaded ComfyUI filename
        if mapping.get("type") == "image" and param_name in uploaded:
            wf[node_id]["inputs"][key] = uploaded[param_name]
            continue

        # Scalar params: use provided value or default
        if param_name in params:
            value = params[param_name]
            # Handle seed=-1 -> random
            if key == "seed" and isinstance(value, int) and value < 0:
                value = random.randint(0, 2**32 - 1)
            wf[node_id]["inputs"][key] = value

    # Handle extra_params (additional node params exposed beyond category contract)
    for extra in manifest.get("extra_params", []):
        ep_name = extra["name"]
        node_id = extra["node_id"]
        key = extra["key"]

        # Image-type extra params: use uploaded ComfyUI filename
        if extra.get("type") == "image" and ep_name in uploaded:
            wf[node_id]["inputs"][key] = uploaded[ep_name]
            continue

        if ep_name in params:
            wf[node_id]["inputs"][key] = params[ep_name]

    return wf


async def run_and_save(
    client,
    workflow: dict,
    output_dir: Path,
    on_progress: Optional[Callable[[int, int], Awaitable[None]]] = None,
) -> list[tuple[str, Path]]:
    """Submit workflow, watch progress, download outputs, save to output_dir.

    Returns list of (original_filename, local_saved_path).
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    results = await client.run_workflow(workflow, on_progress=on_progress)
    if not results:
        raise RuntimeError("No output images from ComfyUI")

    saved: list[tuple[str, Path]] = []
    for filename, data in results:
        ext = Path(filename).suffix or ".png"
        out_name = f"wf_{uuid.uuid4().hex[:10]}{ext}"
        out_path = output_dir / out_name
        await client.save_image(data, str(out_path))
        saved.append((filename, out_path))

    return saved
