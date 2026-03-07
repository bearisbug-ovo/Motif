"""ComfyUI HTTP + WebSocket client."""
import asyncio
import json
import os
import uuid
from typing import Callable, Awaitable

import aiohttp
import aiofiles

COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188")
COMFYUI_WS = COMFYUI_URL.replace("http://", "ws://").replace("https://", "wss://")

# 10 s connect timeout; no read timeout (workflows can be slow)
_TIMEOUT = aiohttp.ClientTimeout(connect=10, sock_connect=10, sock_read=None)


class ComfyUIClient:
    def __init__(self, base_url: str = COMFYUI_URL):
        self.base_url = base_url.rstrip("/")
        self.ws_url = self.base_url.replace("http://", "ws://").replace("https://", "wss://")
        self.client_id = str(uuid.uuid4())

    # ------------------------------------------------------------------ #
    # Submit a workflow and return prompt_id                               #
    # ------------------------------------------------------------------ #
    async def submit(self, workflow: dict) -> str:
        payload = {"prompt": workflow, "client_id": self.client_id}
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.post(
                f"{self.base_url}/prompt",
                json=payload,
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    raise RuntimeError(
                        f"ComfyUI /prompt returned {resp.status}: {body[:2000]}"
                    )
                data = await resp.json()
                return data["prompt_id"]

    # ------------------------------------------------------------------ #
    # Watch progress via WebSocket                                         #
    # on_progress(value, max_value) is called for each progress tick      #
    # Returns when execution completes or errors                           #
    # ------------------------------------------------------------------ #
    async def watch_progress_ws(
        self,
        prompt_id: str,
        on_progress: Callable[[int, int], Awaitable[None]] | None = None,
    ) -> None:
        ws_endpoint = f"{self.ws_url}/ws?clientId={self.client_id}"
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.ws_connect(ws_endpoint) as ws:
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        data = json.loads(msg.data)
                        msg_type = data.get("type")

                        if msg_type == "progress":
                            payload = data.get("data", {})
                            if payload.get("prompt_id") == prompt_id and on_progress:
                                await on_progress(
                                    int(payload.get("value", 0)),
                                    int(payload.get("max", 1)),
                                )

                        elif msg_type == "execution_success":
                            if data.get("data", {}).get("prompt_id") == prompt_id:
                                return

                        elif msg_type == "execution_error":
                            if data.get("data", {}).get("prompt_id") == prompt_id:
                                err = data.get("data", {}).get("exception_message", "Unknown error")
                                raise RuntimeError(f"ComfyUI execution error: {err}")

                    elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED):
                        break

    # ------------------------------------------------------------------ #
    # Get output images for a prompt                                       #
    # Returns (saved_outputs, preview_outputs)                             #
    #   saved: list of (filename, bytes) from SaveImage nodes              #
    #   preview: list of (filename, bytes) from preview/temp nodes         #
    # ------------------------------------------------------------------ #
    async def get_output_images(
        self, prompt_id: str
    ) -> tuple[list[tuple[str, bytes]], list[tuple[str, bytes]]]:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.get(
                f"{self.base_url}/history/{prompt_id}"
            ) as resp:
                resp.raise_for_status()
                history = await resp.json()

        outputs = history.get(prompt_id, {}).get("outputs", {})
        saved: list[tuple[str, bytes]] = []
        preview: list[tuple[str, bytes]] = []

        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            for node_output in outputs.values():
                for img in node_output.get("images", []):
                    filename = img["filename"]
                    subfolder = img.get("subfolder", "")
                    img_type = img.get("type", "output")
                    params = f"filename={filename}&subfolder={subfolder}&type={img_type}"
                    async with session.get(
                        f"{self.base_url}/view?{params}"
                    ) as img_resp:
                        img_resp.raise_for_status()
                        data = await img_resp.read()
                        if img_type == "temp":
                            preview.append((filename, data))
                        else:
                            saved.append((filename, data))

        return saved, preview

    # ------------------------------------------------------------------ #
    # Upload an image to ComfyUI input directory                           #
    # Returns the filename that ComfyUI assigned                           #
    # ------------------------------------------------------------------ #
    async def upload_image(self, filepath: str, subfolder: str = "") -> str:
        async with aiofiles.open(filepath, "rb") as f:
            data = await f.read()

        filename = os.path.basename(filepath)
        form = aiohttp.FormData()
        form.add_field("image", data, filename=filename, content_type="image/png")
        if subfolder:
            form.add_field("subfolder", subfolder)
        form.add_field("overwrite", "true")

        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.post(
                f"{self.base_url}/upload/image", data=form
            ) as resp:
                resp.raise_for_status()
                result = await resp.json()
                return result.get("name", filename)

    # ------------------------------------------------------------------ #
    # Free model cache (releases VRAM)                                     #
    # ------------------------------------------------------------------ #
    async def free_cache(self) -> None:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.post(
                f"{self.base_url}/free",
                json={"unload_models": True, "free_memory": True},
            ) as resp:
                resp.raise_for_status()

    # ------------------------------------------------------------------ #
    # Save image bytes to a local path                                     #
    # ------------------------------------------------------------------ #
    @staticmethod
    async def save_image(data: bytes, dest_path: str) -> None:
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        async with aiofiles.open(dest_path, "wb") as f:
            await f.write(data)

    # ------------------------------------------------------------------ #
    # Get all raw outputs for a prompt (images + text + any other data)  #
    # ------------------------------------------------------------------ #
    async def get_all_outputs(self, prompt_id: str) -> dict:
        """Return the raw outputs dict from /history for the given prompt."""
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.get(
                f"{self.base_url}/history/{prompt_id}"
            ) as resp:
                resp.raise_for_status()
                history = await resp.json()
        return history.get(prompt_id, {}).get("outputs", {})

    # ------------------------------------------------------------------ #
    # High-level: submit → watch → fetch output images + prompt_id       #
    # ------------------------------------------------------------------ #
    async def run_workflow(
        self,
        workflow: dict,
        on_progress: Callable[[int, int], Awaitable[None]] | None = None,
    ) -> tuple[list[tuple[str, bytes]], list[tuple[str, bytes]], str]:
        """Returns (saved_images, preview_images, prompt_id)."""
        prompt_id = await self.submit(workflow)
        await self.watch_progress_ws(prompt_id, on_progress)
        saved, preview = await self.get_output_images(prompt_id)
        return saved, preview, prompt_id


# Singleton for the app lifetime
client = ComfyUIClient()
