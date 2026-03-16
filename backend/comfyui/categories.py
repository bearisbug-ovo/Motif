"""Category contracts for the unified workflow system.

Each category defines required and optional parameters that a workflow
in that category must/can map to ComfyUI nodes.
"""
from __future__ import annotations

CATEGORIES: dict[str, dict] = {
    "face_swap": {
        "label": "换脸",
        "description": "将底图中人物的面部替换为参考图中的人脸，保持姿势、服装和背景不变。",
        "usage": "在 ComfyUI 工作流中用 @base_image 标记底图的 LoadImage 节点，用 @face_ref 标记人脸参考的 LoadImage 节点。KSampler 等需要暴露的参数节点也加 @ 前缀。",
        "params": {
            "base_image":  {"type": "image", "required": True,  "label": "底图"},
            "face_ref":    {"type": "image", "required": True,  "label": "人脸参考"},
            "prompt":      {"type": "string", "required": False, "label": "提示词"},
            "seed":        {"type": "int",    "required": False, "label": "种子"},
        },
    },
    "inpaint": {
        "label": "局部重绘",
        "description": "对图片的蒙版区域进行局部重绘，可搭配提示词引导生成内容。",
        "usage": "用 @source_image 标记原图 LoadImage。蒙版可映射到同一个 LoadImage 节点（后端自动合并为 RGBA，IMAGE 输出原图，MASK 输出蒙版），也可用单独的 @mask LoadImage 节点。提示词和去噪强度等参数的节点也加 @ 前缀。",
        "params": {
            "source_image": {"type": "image",  "required": True,  "label": "原图"},
            "mask":         {"type": "image",  "required": True,  "label": "蒙版", "source": "file_path"},
            "prompt":       {"type": "string", "required": False, "label": "提示词"},
            "denoise":      {"type": "float",  "required": False, "label": "去噪强度"},
            "seed":         {"type": "int",    "required": False, "label": "种子"},
        },
    },
    "upscale": {
        "label": "高清放大",
        "description": "将图片按指定倍数放大并提升细节清晰度，通常使用分块处理避免显存不足。",
        "usage": "用 @source_image 标记输入图 LoadImage。放大倍数、去噪强度等参数的节点加 @ 前缀。",
        "params": {
            "source_image":   {"type": "image", "required": True,  "label": "原图"},
            "upscale_factor": {"type": "float", "required": False, "label": "放大倍数"},
            "denoise":        {"type": "float", "required": False, "label": "去噪强度"},
            "seed":           {"type": "int",   "required": False, "label": "种子"},
        },
    },
    "text_to_image": {
        "label": "文生图",
        "description": "根据文字提示词生成图片，可指定宽高。",
        "usage": "将提示词输入节点标记为 @prompt，尺寸节点中的 width/height 所在节点加 @ 前缀。无需 LoadImage。",
        "params": {
            "prompt": {"type": "string", "required": True,  "label": "提示词"},
            "width":  {"type": "int",    "required": False, "label": "宽度"},
            "height": {"type": "int",    "required": False, "label": "高度"},
            "seed":   {"type": "int",    "required": False, "label": "种子"},
        },
    },
    "image_to_image": {
        "label": "图生图",
        "description": "以原图为基础，结合提示词生成新图片。",
        "usage": "用 @source_image 标记原图 LoadImage。提示词/去噪等节点加 @ 前缀。如需额外图片输入（如骨架参考），可通过自定义输入参数添加。",
        "params": {
            "source_image": {"type": "image",  "required": True,  "label": "原图"},
            "prompt":       {"type": "string", "required": False, "label": "提示词"},
            "denoise":      {"type": "float",  "required": False, "label": "去噪强度"},
            "seed":         {"type": "int",    "required": False, "label": "种子"},
        },
    },
    "preprocess": {
        "label": "预处理",
        "description": "对图片进行预处理（如去背景、提取骨架、提示词反推等），不涉及生成。",
        "usage": "用 @source_image 标记输入图 LoadImage，输出节点标记 @output。如有文本输出（如反推提示词），将 ShowText 等节点标记为 @caption。",
        "params": {
            "source_image": {"type": "image", "required": True, "label": "原图"},
        },
        "outputs": {
            "caption": {"type": "string", "label": "反推提示词"},
        },
    },
}


def get_categories() -> list[dict]:
    """Return serialized category contracts for the API."""
    result = []
    for key, cat in CATEGORIES.items():
        params = []
        for pname, pdef in cat["params"].items():
            params.append({"name": pname, **pdef})
        outputs = []
        for oname, odef in cat.get("outputs", {}).items():
            outputs.append({"name": oname, **odef})
        entry: dict = {
            "key": key,
            "label": cat["label"],
            "description": cat.get("description", ""),
            "usage": cat.get("usage", ""),
            "params": params,
        }
        if outputs:
            entry["outputs"] = outputs
        result.append(entry)
    return result


def validate_manifest(category: str, manifest: dict) -> list[str]:
    """Validate that all required params for the category have mappings.

    Returns a list of error messages (empty = valid).
    """
    if category not in CATEGORIES:
        return [f"Unknown category: {category}"]

    errors = []
    cat_params = CATEGORIES[category]["params"]
    mappings = manifest.get("mappings", {})

    for pname, pdef in cat_params.items():
        if pdef["required"] and pname not in mappings:
            errors.append(f"Required parameter '{pname}' has no mapping")

    return errors
