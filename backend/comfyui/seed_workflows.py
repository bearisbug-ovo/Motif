"""Seed default workflows from existing JSON templates on startup."""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.workflow import Workflow

logger = logging.getLogger("motif.seed_workflows")

WORKFLOWS_DIR = os.path.join(os.path.dirname(__file__), "workflows")

# Map existing workflow files to categories.
# Each entry: (json_file, nodes_json_file, category, name, description)
SEED_DEFINITIONS = [
    ("faceswap.json", "faceswap.nodes.json", "face_swap", "换脸 (默认)", "Kontext 架构换脸工作流"),
    ("upscale.json", "upscale.nodes.json", "upscale", "高清放大 (默认)", "Z-Image 分块放大工作流"),
    ("inpaint_flux.json", "inpaint_flux.nodes.json", "inpaint", "局部重绘 Flux", "Flux 模式局部重绘"),
    ("inpaint_sdxl.json", "inpaint_sdxl.nodes.json", "inpaint", "局部重绘 SDXL", "SDXL 模式局部重绘"),
    ("inpaint_klein.json", "inpaint_klein.nodes.json", "inpaint", "局部重绘 Klein", "Klein 模式局部重绘"),
    ("generate.json", "generate.nodes.json", "text_to_image", "文生图 (默认)", "Z-Image 文生图工作流"),
    ("generate_pose.json", "generate_pose.nodes.json", "image_to_image", "图生图+Pose (默认)", "带 ControlNet Pose 的图生图"),
]

# Map nodes.json param names to category contract param names.
# Only map params that exist in the category contract.
PARAM_NAME_MAP: dict[str, dict[str, str]] = {
    "face_swap": {
        "base_image": "base_image",
        "face_ref_image": "face_ref",
        "prompt": "prompt",
        "seed": "seed",
    },
    "upscale": {
        "input_image": "source_image",
        "seed": "seed",
        "upscale_by": "upscale_factor",
        "denoise": "denoise",
    },
    "inpaint": {
        "source_image": "source_image",
        "mask_image": "mask",
        "prompt": "prompt",
        "extra_prompt": "prompt",  # sdxl uses extra_prompt
        "seed": "seed",
        "denoise": "denoise",
    },
    "text_to_image": {
        "positive_prompt": "prompt",
        "seed": "seed",
        "width": "width",
        "height": "height",
    },
    "image_to_image": {
        "skeleton_image": "source_image",
        "positive_prompt": "prompt",
        "seed": "seed",
    },
}

# Param type inference from category contracts
TYPE_MAP = {
    "base_image": "image", "face_ref": "image", "source_image": "image",
    "mask": "image",
    "prompt": "string",
    "seed": "int",
    "upscale_factor": "float", "denoise": "float",
    "width": "int", "height": "int",
}


def _nodes_to_manifest(nodes: dict, category: str) -> dict:
    """Convert a nodes.json dict to the new manifest format."""
    name_map = PARAM_NAME_MAP.get(category, {})
    mappings = {}
    extra_params = []

    for param_key, node_ref in nodes.items():
        contract_name = name_map.get(param_key)
        if contract_name:
            mappings[contract_name] = {
                "node_id": node_ref["node_id"],
                "key": node_ref["key"],
                "type": TYPE_MAP.get(contract_name, "string"),
            }
            # Mark mask as file_path source
            if contract_name == "mask":
                mappings[contract_name]["source"] = "file_path"
        else:
            # Extra param (not in category contract)
            extra_params.append({
                "name": param_key,
                "label": node_ref.get("label", node_ref["key"]),
                "type": node_ref.get("type", "string"),
                "node_id": node_ref["node_id"],
                "key": node_ref["key"],
            })

    return {"mappings": mappings, "extra_params": extra_params}


def seed_default_workflows(db: Session) -> int:
    """Insert missing default workflows. Skips workflows whose name already exists."""
    # Collect existing workflow names for quick lookup
    existing_names: set[str] = set(
        db.execute(select(Workflow.name)).scalars().all()
    )

    # Track which categories already have a default
    categories_with_default: set[str] = set(
        db.execute(
            select(Workflow.category).where(Workflow.is_default == True)
        ).scalars().all()
    )

    count = 0
    for wf_file, nodes_file, category, name, description in SEED_DEFINITIONS:
        if name in existing_names:
            continue

        wf_path = os.path.join(WORKFLOWS_DIR, wf_file)
        nodes_path = os.path.join(WORKFLOWS_DIR, nodes_file)

        if not os.path.isfile(wf_path) or not os.path.isfile(nodes_path):
            logger.warning(f"Skipping seed: {wf_file} or {nodes_file} not found")
            continue

        with open(wf_path, encoding="utf-8") as f:
            workflow_json = json.load(f)
        with open(nodes_path, encoding="utf-8") as f:
            nodes = json.load(f)

        manifest = _nodes_to_manifest(nodes, category)
        is_default = category not in categories_with_default

        wf = Workflow(
            id=str(uuid.uuid4()),
            name=name,
            category=category,
            description=description,
            is_default=is_default,
            workflow_json=json.dumps(workflow_json),
            manifest=json.dumps(manifest),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(wf)
        count += 1
        existing_names.add(name)
        if is_default:
            categories_with_default.add(category)

    if count:
        db.commit()
        logger.info(f"Seeded {count} default workflows")
    return count
