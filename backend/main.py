"""Motif FastAPI application entry point."""
from __future__ import annotations

import asyncio
import hashlib
import mimetypes
import os
import sys

# Fix Chinese encoding on Windows console
if sys.platform == "win32":
    import ctypes
    try:
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)
    except Exception:
        pass
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from config import get_settings
from database import Base, engine
import models  # noqa: F401 — register all ORM models

from routers import system, persons, albums, media, recycle_bin

# Ensure tables exist (Alembic handles migrations; this is a safety net)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Motif API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(system.router,      prefix="/api/system",      tags=["system"])
app.include_router(persons.router,     prefix="/api/persons",     tags=["persons"])
app.include_router(albums.router,      prefix="/api/albums",      tags=["albums"])
app.include_router(media.router,       prefix="/api/media",       tags=["media"])
app.include_router(recycle_bin.router, prefix="/api/recycle-bin", tags=["recycle-bin"])


# ── Utility endpoints ─────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.0"}


@app.get("/api/files/pick-folder")
def pick_folder():
    """Open a native Windows folder-picker dialog and return the chosen path."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", 1)
        path = filedialog.askdirectory(title="选择图片文件夹")
        root.destroy()
        return {"path": path.replace("/", "\\") if path else ""}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"无法打开文件夹选择器：{exc}")


@app.get("/api/files/pick-files")
def pick_files():
    """Open a native Windows file-picker dialog and return the chosen file paths."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", 1)
        paths = filedialog.askopenfilenames(
            title="选择图片文件",
            filetypes=[
                ("图片文件", "*.jpg *.jpeg *.png *.gif *.bmp *.webp *.tiff *.tif *.avif"),
                ("所有文件", "*.*"),
            ],
        )
        root.destroy()
        result = [p.replace("/", "\\") for p in paths] if paths else []
        return {"paths": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"无法打开文件选择器：{exc}")


@app.get("/api/files/thumb")
def get_thumb(path: str, size: int = 400):
    """Return a cached JPEG thumbnail for any local image file."""
    from PIL import Image

    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="Path must be absolute")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    if size < 16 or size > 1600:
        raise HTTPException(status_code=400, detail="size must be 16-1600")

    settings = get_settings()
    thumb_dir = settings.thumbnails_dir()
    thumb_dir.mkdir(parents=True, exist_ok=True)

    mtime = str(os.path.getmtime(path))
    cache_key = hashlib.md5(f"{path}|{mtime}|{size}".encode()).hexdigest()
    cache_path = thumb_dir / f"{cache_key}.jpg"

    if not cache_path.exists():
        try:
            with Image.open(path) as img:
                img.thumbnail((size, size), Image.LANCZOS)
                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")
                img.save(str(cache_path), "JPEG", quality=82, optimize=True)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Cannot process image: {exc}")

    with open(str(cache_path), "rb") as f:
        data = f.read()

    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/files/list-subfolders")
def list_subfolders(path: str):
    """Return immediate subdirectories of a given path."""
    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="Path must be absolute")
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail="Directory not found")
    try:
        entries = sorted(
            {"name": name, "path": os.path.join(path, name)}
            for name in os.listdir(path)
            if os.path.isdir(os.path.join(path, name))
        )
        return {"subfolders": entries}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/files/serve")
def serve_native_file(path: str):
    """Serve an arbitrary local file by absolute path."""
    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="Path must be absolute")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    media_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type)


# ── ComfyUI background health polling ────────────────────────────────────────

_comfyui_status = {"connected": False}


async def _poll_comfyui():
    while True:
        try:
            settings = get_settings()
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(f"{settings.comfyui_url}/object_info/KSampler")
                _comfyui_status["connected"] = r.status_code == 200
        except Exception:
            _comfyui_status["connected"] = False
        await asyncio.sleep(5)


async def _recycle_bin_cleanup_loop():
    """Run recycle bin auto-cleanup on startup and then daily."""
    import logging
    from database import SessionLocal
    from routers.recycle_bin import auto_cleanup_expired

    logger = logging.getLogger("motif.cleanup")
    while True:
        try:
            settings = get_settings()
            days = settings.recycle_bin_days
            if days > 0:
                db = SessionLocal()
                try:
                    auto_cleanup_expired(db, days)
                finally:
                    db.close()
        except Exception as e:
            logger.error(f"Recycle bin cleanup error: {e}")
        await asyncio.sleep(86400)  # 24 hours


@app.on_event("startup")
async def startup():
    asyncio.create_task(_poll_comfyui())
    asyncio.create_task(_recycle_bin_cleanup_loop())
