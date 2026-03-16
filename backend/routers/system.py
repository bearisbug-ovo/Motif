"""System status and configuration endpoints."""
from __future__ import annotations

import os
import shutil

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path

from config import get_settings, update_settings

router = APIRouter()

# ── Reconnection tracking ────────────────────────────────────────────────────
_reconnect_failures: int = 0
_max_retries_reached: bool = False
_MAX_RECONNECT_FAILURES = 30


class ConfigUpdate(BaseModel):
    comfyui_url: str | None = None
    comfyui_launch_cmd: str | None = None
    thumbnail_size: int | None = None
    recycle_bin_days: int | None = None
    appdata_dir: str | None = None
    task_timeout_minutes: int | None = None
    fastapi_port: int | None = None
    platform_cookies: dict | None = None


@router.get("/status")
async def get_status():
    global _reconnect_failures, _max_retries_reached

    settings = get_settings()
    # Check ComfyUI
    comfyui_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.comfyui_url}/object_info/KSampler")
            comfyui_ok = r.status_code == 200
    except Exception:
        pass

    # Track reconnection state
    if comfyui_ok:
        _reconnect_failures = 0
        _max_retries_reached = False
    else:
        _reconnect_failures += 1
        if _reconnect_failures >= _MAX_RECONNECT_FAILURES:
            _max_retries_reached = True

    # Disk space for AppData volume
    disk = shutil.disk_usage(str(settings.appdata_dir))
    return {
        "comfyui": {
            "connected": comfyui_ok,
            "url": settings.comfyui_url,
            "reconnect_failures": _reconnect_failures,
            "max_retries_reached": _max_retries_reached,
        },
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
    global _reconnect_failures, _max_retries_reached

    kwargs = {k: v for k, v in body.model_dump().items() if v is not None}
    if not kwargs:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Reset reconnection tracking when ComfyUI URL changes
    if "comfyui_url" in kwargs:
        _reconnect_failures = 0
        _max_retries_reached = False

    # Handle AppData directory migration
    if "appdata_dir" in kwargs:
        old_settings = get_settings()
        old_dir = old_settings.appdata_dir
        new_dir = Path(kwargs["appdata_dir"])
        if old_dir.resolve() != new_dir.resolve():
            _migrate_appdata(old_dir, new_dir)

    s = update_settings(**kwargs)
    return {**s.to_dict(), "restart_required": "appdata_dir" in kwargs}


def _migrate_appdata(old_dir: Path, new_dir: Path):
    """Copy AppData files (excluding DB) to new directory and update DB paths."""
    # Validate new dir is writable
    try:
        new_dir.mkdir(parents=True, exist_ok=True)
        test_file = new_dir / ".write_test"
        test_file.write_text("test")
        test_file.unlink()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"新目录不可写: {e}")

    # Copy all files except the DB
    db_rel = Path("db") / "main.sqlite"
    for item in old_dir.rglob("*"):
        rel = item.relative_to(old_dir)
        # Skip DB files (will stay or be recreated)
        if str(rel).startswith("db"):
            continue
        target = new_dir / rel
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif item.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(item), str(target))

    # Update file paths in DB
    from database import SessionLocal
    from models.media import Media
    from sqlalchemy import select

    old_prefix = str(old_dir)
    new_prefix = str(new_dir)
    db = SessionLocal()
    try:
        # Update file_path
        media_items = db.execute(
            select(Media).where(Media.file_path.startswith(old_prefix))
        ).scalars().all()
        for m in media_items:
            m.file_path = new_prefix + m.file_path[len(old_prefix):]

        # Update thumbnail_path
        thumb_items = db.execute(
            select(Media).where(Media.thumbnail_path.isnot(None), Media.thumbnail_path.startswith(old_prefix))
        ).scalars().all()
        for m in thumb_items:
            m.thumbnail_path = new_prefix + m.thumbnail_path[len(old_prefix):]

        db.commit()
    finally:
        db.close()
