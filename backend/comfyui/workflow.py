"""WorkflowBuilder: load JSON templates and inject parameters."""
import copy
import json
import os
import random

WORKFLOWS_DIR = os.path.join(os.path.dirname(__file__), "workflows")

# Turbo/Base model parameters
MODEL_PARAMS = {
    "turbo": {
        "unet_name": "z_image_turbo_bf16.safetensors",
        "vae_name": "zImageClearVae_clear.safetensors",
        "steps": 8,
        "cfg": 1.0,
        "scheduler": "simple",
    },
    "base": {
        "unet_name": "z_image\\ZIB-moodyWildMix_v01.safetensors",
        "vae_name": "ae.safetensors",
        "steps": 10,
        "cfg": 1.0,
        "scheduler": "simple",
    },
}


def _load_json(name: str) -> dict:
    path = os.path.join(WORKFLOWS_DIR, name)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class WorkflowBuilder:
    """Build a ComfyUI-ready workflow dict from a named template + params."""

    def __init__(self, comfyui_client=None):
        # Optional: pass client to auto-upload image params
        self._client = comfyui_client

    def build(self, workflow_name: str, params: dict) -> dict:
        """
        Load `workflow_name` + `workflow_name[:-5].nodes.json`,
        inject `params` values into the workflow, return the modified dict.

        Image params (nodes.json key == "image") are NOT uploaded here;
        callers must pass the ComfyUI filename (after upload_image).
        """
        wf = copy.deepcopy(_load_json(workflow_name))
        nodes_file = workflow_name.replace(".json", ".nodes.json")
        nodes = _load_json(nodes_file)

        for param_key, value in params.items():
            if param_key not in nodes:
                continue
            node_id = nodes[param_key]["node_id"]
            input_key = nodes[param_key]["key"]
            wf[node_id]["inputs"][input_key] = value

        return wf

    def build_generate(
        self,
        prompt: str,
        model: str,
        seed: int,
        width: int,
        height: int,
        filename_prefix: str,
        skeleton_image: str | None = None,
        controlnet_strength: float = 0.7,
        lora_strength: float = 0.7,
    ) -> dict:
        """Build a generate or generate_pose workflow with Turbo/Base params."""
        if seed < 0:
            seed = random.randint(0, 2**32 - 1)

        mp = MODEL_PARAMS[model]
        workflow_name = "generate_pose.json" if skeleton_image else "generate.json"

        params: dict = {
            "unet_name": mp["unet_name"],
            "vae_name": mp["vae_name"],
            "lora_strength": lora_strength,
            "positive_prompt": prompt,
            "seed": seed,
            "steps": mp["steps"],
            "cfg": mp["cfg"],
            "scheduler": mp["scheduler"],
            "width": width,
            "height": height,
            "filename_prefix": filename_prefix,
        }

        if skeleton_image:
            params["skeleton_image"] = skeleton_image
            params["controlnet_strength"] = controlnet_strength

        return self.build(workflow_name, params)

    def build_faceswap(
        self,
        base_image: str,
        face_ref_image: str,
        seed: int,
        filename_prefix: str,
        prompt: str = "将图一中人物的面部替换为参考图二中人物的面部，保持身体姿势、服装和背景完全不变，边缘自然融合",
    ) -> dict:
        if seed < 0:
            seed = random.randint(0, 2**32 - 1)
        return self.build("faceswap.json", {
            "base_image": base_image,
            "face_ref_image": face_ref_image,
            "prompt": prompt,
            "seed": seed,
            "steps": 4,
            "filename_prefix": filename_prefix,
        })

    def build_preprocess(self, input_image: str, filename_prefix: str) -> dict:
        return self.build("preprocess.json", {
            "input_image": input_image,
            "filename_prefix": filename_prefix,
        })

    def build_dwpose(self, input_image: str, filename_prefix: str) -> dict:
        return self.build("dwpose.json", {
            "input_image": input_image,
            "filename_prefix": filename_prefix,
        })

    def build_upscale(
        self,
        input_image: str,
        seed: int,
        filename_prefix: str,
        upscale_by: float = 2.0,
        denoise: float = 0.3,
        model: str = "turbo",
        lora_strength: float = 0.7,
        shift: float = 3.0,
    ) -> dict:
        if seed < 0:
            seed = random.randint(0, 2**32 - 1)
        mp = MODEL_PARAMS[model]
        return self.build("upscale.json", {
            "input_image": input_image,
            "unet_name": mp["unet_name"],
            "vae_name": mp["vae_name"],
            "lora_strength": lora_strength,
            "shift": shift,
            "seed": seed,
            "upscale_by": upscale_by,
            "steps": 6,
            "cfg": 1.0,
            "denoise": denoise,
            "tile_width": 1024,
            "tile_height": 1024,
            "filename_prefix": filename_prefix,
        })

    def build_inpaint(
        self,
        source_image: str,
        mask_image: str,
        mode: str,
        prompt: str,
        seed: int,
        filename_prefix: str,
        denoise: float | None = None,
        enable_rear_lora: bool = False,
    ) -> dict:
        if seed < 0:
            seed = random.randint(0, 2**32 - 1)

        workflow_map = {
            "flux": ("inpaint_flux.json", 1.0),
            "sdxl": ("inpaint_sdxl.json", 0.50),
            "klein": ("inpaint_klein.json", 0.45),
        }
        wf_name, default_denoise = workflow_map[mode]
        actual_denoise = denoise if denoise is not None else default_denoise

        params: dict = {
            "source_image": source_image,
            "mask_image": mask_image,
            "prompt": prompt,
            "seed": seed,
            "denoise": actual_denoise,
            "filename_prefix": filename_prefix,
        }

        # sdxl uses extra_prompt instead of prompt
        if mode == "sdxl":
            params["extra_prompt"] = params.pop("prompt")

        wf = self.build(wf_name, params)

        # Dynamically inject rear LoRA node for inpaint_flux
        if enable_rear_lora and mode == "flux":
            # Insert LoraLoaderModelOnly between UNETLoader(5) and KSampler(15)
            wf["19"] = {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {
                    "model": ["5", 0],
                    "lora_name": "flux-2-kelin\\Klein_9B-\u540e\u4f4d.safetensors",
                    "strength_model": 1.0,
                },
            }
            wf["15"]["inputs"]["model"] = ["19", 0]

        return wf


# Singleton
builder = WorkflowBuilder()
