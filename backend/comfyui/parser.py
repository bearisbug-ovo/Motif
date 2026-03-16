"""Parse ComfyUI API-format JSON to extract @-tagged nodes for parameter mapping."""
from __future__ import annotations

IMAGE_INPUT_CLASSES = {"LoadImage"}
# Standard + common plugin image output nodes
IMAGE_OUTPUT_CLASSES = {"SaveImage", "PreviewImage", "ImageAndMaskPreview"}  # KJNodes


def parse_comfyui_workflow(workflow_json: dict, object_info: dict | None = None) -> dict:
    """Parse a ComfyUI workflow dict and return structured info about @-tagged nodes.

    Only nodes whose _meta.title starts with '@' are processed.
    - @-tagged LoadImage -> image_inputs
    - @-tagged SaveImage/PreviewImage -> output_nodes
    - Other @-tagged nodes -> text_outputs (always, as potential output candidates)
    - Other @-tagged nodes with scalar inputs -> also scalar_params (for input configuration)

    A node can appear in BOTH scalar_params and text_outputs — the user decides
    during import whether to treat it as an input parameter, an output to capture,
    or both.

    Args:
        workflow_json: The ComfyUI API-format workflow dict.
        object_info: Optional dict from ComfyUI /object_info containing node class
            definitions. When provided, combo/dropdown inputs are detected and their
            choices are included in scalar_params.

    Returns:
        {
            "image_inputs": [{"node_id", "node_key", "suggested_name", "current_value"}],
            "scalar_params": [{"node_id", "node_key", "type", "current_value", "node_title", "choices"?}],
            "output_nodes": [{"node_id", "class_type"}],
            "text_outputs": [{"node_id", "suggested_name", "class_type"}],
        }
    """
    # Build combo choices lookup from object_info: {class_type: {input_key: [choices]}}
    combo_lookup: dict[str, dict[str, list[str]]] = {}
    if object_info:
        for class_type, info in object_info.items():
            node_info = info if "input" in info else {}
            input_defs = node_info.get("input", {})
            combos: dict[str, list[str]] = {}
            for section in ("required", "optional"):
                for key, spec in input_defs.get(section, {}).items():
                    if not isinstance(spec, (list, tuple)) or len(spec) < 1:
                        continue
                    first = spec[0]
                    # New format: ["COMBO", {"options": [...], "default": ...}]
                    if first == "COMBO" and len(spec) >= 2 and isinstance(spec[1], dict):
                        options = spec[1].get("options", [])
                        if options and all(isinstance(c, str) for c in options):
                            combos[key] = options
                    # Legacy format: [["choice1", "choice2", ...], {...}]
                    elif isinstance(first, list) and all(isinstance(c, str) for c in first):
                        combos[key] = first
            if combos:
                combo_lookup[class_type] = combos

    image_inputs: list[dict] = []
    scalar_params: list[dict] = []
    output_nodes: list[dict] = []
    text_outputs: list[dict] = []

    for node_id, node in workflow_json.items():
        if not isinstance(node, dict):
            continue

        meta = node.get("_meta", {})
        title = meta.get("title", "")
        if not title.startswith("@"):
            continue

        class_type = node.get("class_type", "")
        tag_name = title[1:]  # strip '@'
        inputs = node.get("inputs", {})

        if class_type in IMAGE_INPUT_CLASSES:
            image_inputs.append({
                "node_id": node_id,
                "node_key": "image",
                "suggested_name": tag_name,
                "current_value": inputs.get("image", ""),
            })
        elif class_type in IMAGE_OUTPUT_CLASSES:
            output_nodes.append({
                "node_id": node_id,
                "class_type": class_type,
            })
            # Also add to text_outputs so it appears in the assignment UI
            text_outputs.append({
                "node_id": node_id,
                "suggested_name": tag_name,
                "class_type": class_type,
            })
        else:
            node_combos = combo_lookup.get(class_type, {})
            # Collect scalar inputs for parameter configuration
            for key, value in inputs.items():
                if isinstance(value, list):
                    continue  # node link reference, skip
                param: dict = {
                    "node_id": node_id,
                    "node_key": key,
                    "type": _infer_type(value),
                    "current_value": value,
                    "node_title": tag_name,
                }
                # Attach combo choices if available from object_info
                if key in node_combos:
                    param["choices"] = node_combos[key]
                scalar_params.append(param)

            # Always add as a text_output candidate — user decides during import
            # whether this node should be used to capture output values.
            text_outputs.append({
                "node_id": node_id,
                "suggested_name": tag_name,
                "class_type": class_type,
            })

    return {
        "image_inputs": image_inputs,
        "scalar_params": scalar_params,
        "output_nodes": output_nodes,
        "text_outputs": text_outputs,
    }


def _infer_type(value) -> str:
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    return "string"
