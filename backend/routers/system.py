"""System status and configuration endpoints."""
from __future__ import annotations

import shutil

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import get_settings, update_settings

router = APIRouter()


class ConfigUpdate(BaseModel):
    comfyui_url: str | None = None
    thumbnail_size: int | None = None
    recycle_bin_days: int | None = None
    appdata_dir: str | None = None


@router.get("/status")
async def get_status():
    settings = get_settings()
    # Check ComfyUI
    comfyui_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.comfyui_url}/object_info/KSampler")
            comfyui_ok = r.status_code == 200
    except Exception:
        pass

    # Disk space for AppData volume
    disk = shutil.disk_usage(str(settings.appdata_dir))
    return {
        "comfyui": {"connected": comfyui_ok, "url": settings.comfyui_url},
        "disk": {
            "total_gb": round(disk.total / 1e9, 1),
            "used_gb": round(disk.used / 1e9, 1),
            "free_gb": round(disk.free / 1e9, 1),
        },
    }


@router.get("/config")
def get_config():
    return get_settings().to_dict()


@router.put("/config")
def update_config(body: ConfigUpdate):
    kwargs = {k: v for k, v in body.model_dump().items() if v is not None}
    if not kwargs:
        raise HTTPException(status_code=400, detail="No fields to update")
    s = update_settings(**kwargs)
    return s.to_dict()
