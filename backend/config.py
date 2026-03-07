"""AppData path management and global settings."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

# Default AppData directory (relative to backend/)
_DEFAULT_APPDATA = Path(__file__).parent / "appdata"

_settings_instance: Optional["Settings"] = None


class Settings:
    def __init__(self, data: dict):
        self.appdata_dir = Path(data.get("appdata_dir", str(_DEFAULT_APPDATA)))
        self.comfyui_url: str = data.get("comfyui_url", "http://127.0.0.1:8188")
        self.comfyui_launch_cmd: str = data.get("comfyui_launch_cmd", "")
        self.thumbnail_size: int = data.get("thumbnail_size", 400)
        self.recycle_bin_days: int = data.get("recycle_bin_days", 30)
        self.task_timeout_minutes: int = data.get("task_timeout_minutes", 10)
        self.fastapi_port: int = data.get("fastapi_port", 8000)

    # ── Sub-path helpers ──────────────────────────────────────────────────

    def db_path(self) -> Path:
        return self.appdata_dir / "db" / "main.sqlite"

    def thumbnails_dir(self) -> Path:
        return self.appdata_dir / "cache" / "thumbnails"

    def generated_dir(self, subtype: str = "") -> Path:
        base = self.appdata_dir / "generated"
        return base / subtype if subtype else base

    def imports_dir(self, subtype: str = "") -> Path:
        base = self.appdata_dir / "imports"
        return base / subtype if subtype else base

    def masks_dir(self) -> Path:
        return self.appdata_dir / "cache" / "masks"

    def poses_dir(self) -> Path:
        return self.appdata_dir / "poses"

    def workflows_dir(self) -> Path:
        return self.appdata_dir / "workflows"

    def downloads_dir(self, platform: str = "") -> Path:
        base = self.appdata_dir / "downloads"
        return base / platform if platform else base

    def to_dict(self) -> dict:
        return {
            "appdata_dir": str(self.appdata_dir),
            "comfyui_url": self.comfyui_url,
            "comfyui_launch_cmd": self.comfyui_launch_cmd,
            "thumbnail_size": self.thumbnail_size,
            "recycle_bin_days": self.recycle_bin_days,
            "task_timeout_minutes": self.task_timeout_minutes,
            "fastapi_port": self.fastapi_port,
        }


def _settings_file() -> Path:
    return _DEFAULT_APPDATA / "settings.json"


def _ensure_dirs(settings: Settings) -> None:
    """Create all required AppData subdirectories."""
    for d in [
        settings.appdata_dir,
        settings.appdata_dir / "db",
        settings.thumbnails_dir(),
        settings.generated_dir("upscale"),
        settings.generated_dir("inpaint"),
        settings.generated_dir("face_swap"),
        settings.generated_dir("portrait"),
        settings.generated_dir("screenshot"),
        settings.imports_dir("clipboard"),
        settings.masks_dir(),
        settings.poses_dir(),
        settings.workflows_dir(),
        settings.downloads_dir("xiaohongshu"),
    ]:
        d.mkdir(parents=True, exist_ok=True)


def get_settings() -> Settings:
    global _settings_instance
    if _settings_instance is None:
        sf = _settings_file()
        sf.parent.mkdir(parents=True, exist_ok=True)
        if sf.exists():
            with open(sf, "r", encoding="utf-8") as f:
                data = json.load(f)
        else:
            data = {}
        _settings_instance = Settings(data)
        _ensure_dirs(_settings_instance)
        if not sf.exists():
            save_settings(_settings_instance)
    return _settings_instance


def save_settings(settings: Settings) -> None:
    global _settings_instance
    sf = _settings_file()
    sf.parent.mkdir(parents=True, exist_ok=True)
    with open(sf, "w", encoding="utf-8") as f:
        json.dump(settings.to_dict(), f, indent=2, ensure_ascii=False)
    _settings_instance = settings
    _ensure_dirs(settings)


def update_settings(**kwargs) -> Settings:
    s = get_settings()
    data = s.to_dict()
    data.update(kwargs)
    new_s = Settings(data)
    save_settings(new_s)
    return new_s
