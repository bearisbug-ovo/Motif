"""Parse ComfyUI API-format JSON to extract @-tagged nodes for parameter mapping."""
from __future__ import annotations

IMAGE_INPUT_CLASSES = {"LoadImage"}
# Standard + common plugin image output nodes
IMAGE_OUTPUT_CLASSES = {"SaveImage", "PreviewImage", "ImageAndMaskPreview"}  # KJNodes


def parse_comfyui_workflow(workflow_json: dict) -> dict:
    """Parse a ComfyUI workflow dict and return structured info about @-tagged nodes.

    Only nodes whose _meta.title starts with '@' are processed.
    - @-tagged LoadImage -> image_inputs
    - @-tagged SaveImage/PreviewImage -> output_nodes
    - Other @-tagged nodes -> text_outputs (always, as potential output candidates)
    - Other @-tagged nodes with scalar inputs -> also scalar_params (for input configuration)

    A node can appear in BOTH scalar_params and text_outputs — the user decides
    during import whether to treat it as an input parameter, an output to capture,
    or both.

    Returns:
        {
            "image_inputs": [{"node_id", "node_key", "suggested_name", "current_value"}],
            "scalar_params": [{"node_id", "node_key", "type", "current_value", "node_title"}],
            "output_nodes": [{"node_id", "class_type"}],
            "text_outputs": [{"node_id", "suggested_name", "class_type"}],
        }
    """
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
            # Collect scalar inputs for parameter configuration
            for key, value in inputs.items():
                if isinstance(value, list):
                    continue  # node link reference, skip
                scalar_params.append({
                    "node_id": node_id,
                    "node_key": key,
                    "type": _infer_type(value),
                    "current_value": value,
                    "node_title": tag_name,
                })

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
