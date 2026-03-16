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

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from config import get_settings
from database import Base, engine
import models  # noqa: F401 — register all ORM models

from routers import system, persons, albums, media, recycle_bin, tasks, workspace, downloads, workflows, launcher, tags

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
app.include_router(tasks.router,      prefix="/api/tasks",       tags=["tasks"])
app.include_router(tasks.queue_router, prefix="/api/queue",      tags=["queue"])
app.include_router(workspace.router,  prefix="/api/workspace",   tags=["workspace"])
app.include_router(downloads.router,  prefix="/api/download",    tags=["download"])
app.include_router(workflows.router,  prefix="/api/workflows",   tags=["workflows"])
app.include_router(workflows.categories_router, prefix="/api/workflow-categories", tags=["workflow-categories"])
app.include_router(launcher.router,  prefix="/api/launcher",    tags=["launcher"])
app.include_router(tags.router,      prefix="/api/tags",        tags=["tags"])


# ── Middleware: track clients & errors for launcher dashboard ─────────────
@app.middleware("http")
async def launcher_tracking_middleware(request: Request, call_next):
    from routers.launcher import track_client, track_error

    # Track client connection (skip internal/health checks)
    path = request.url.path
    if path.startswith("/api/") and not path.startswith("/api/launcher/"):
        track_client(request)

    response = await call_next(request)

    # Track errors
    if response.status_code >= 400 and path.startswith("/api/"):
        track_error(response.status_code, request.method, path)

    return response


# ── Utility endpoints ─────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.0"}


def _ensure_dpi_aware():
    """Enable per-monitor DPI awareness so tkinter dialogs render crisp on HiDPI."""
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # Per-monitor DPI aware
    except Exception:
        try:
            import ctypes
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


@app.get("/api/files/pick-folder")
def pick_folder():
    """Open a native Windows folder-picker dialog and return the chosen path."""
    try:
        _ensure_dpi_aware()
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", 1)
        path = filedialog.askdirectory(title="选择媒体文件夹")
        root.destroy()
        return {"path": path.replace("/", "\\") if path else ""}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"无法打开文件夹选择器：{exc}")


@app.get("/api/files/pick-files")
def pick_files():
    """Open a native Windows file-picker dialog and return the chosen file paths."""
    try:
        _ensure_dpi_aware()
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", 1)
        paths = filedialog.askopenfilenames(
            title="选择媒体文件",
            filetypes=[
                ("媒体文件", "*.jpg *.jpeg *.png *.gif *.bmp *.webp *.tiff *.tif *.avif *.mp4 *.mov *.avi *.mkv *.webm"),
                ("图片文件", "*.jpg *.jpeg *.png *.gif *.bmp *.webp *.tiff *.tif *.avif"),
                ("视频文件", "*.mp4 *.mov *.avi *.mkv *.webm"),
                ("所有文件", "*.*"),
            ],
        )
        root.destroy()
        result = [p.replace("/", "\\") for p in paths] if paths else []
        return {"paths": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"无法打开文件选择器：{exc}")


VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


@app.get("/api/files/thumb")
def get_thumb(path: str, request: Request, size: int = 400):
    """Return a cached JPEG thumbnail for any local image or video file."""
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

    # ETag-based 304 — skip file I/O entirely if browser has it cached
    etag = f'"{cache_key}"'
    if_none_match = request.headers.get("if-none-match")
    if if_none_match == etag and cache_path.exists():
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=604800, immutable"})

    if not cache_path.exists():
        ext = os.path.splitext(path)[1].lower()
        if ext in VIDEO_EXTS:
            try:
                import cv2
                cap = cv2.VideoCapture(path)
                ret, frame = cap.read()
                cap.release()
                if not ret or frame is None:
                    raise HTTPException(status_code=422, detail="Cannot read video frame")
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                img = Image.fromarray(frame_rgb)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(status_code=422, detail=f"Cannot process video: {exc}")
        else:
            try:
                img = Image.open(path)
            except Exception as exc:
                raise HTTPException(status_code=422, detail=f"Cannot process image: {exc}")

        try:
            img.thumbnail((size, size), Image.LANCZOS)
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            img.save(str(cache_path), "JPEG", quality=82, optimize=True)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Cannot create thumbnail: {exc}")
        finally:
            img.close()

    return FileResponse(
        str(cache_path),
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=604800, immutable",
            "ETag": f'"{cache_key}"',
        },
    )


@app.get("/api/files/list-subfolders")
def list_subfolders(path: str):
    """Recursively walk all subdirectories and return those that directly contain
    supported media files. Each entry includes the folder name, full path, and
    the count of direct media files (not in deeper subdirs)."""
    MEDIA_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".avif",
                  ".mp4", ".mov", ".avi", ".mkv", ".webm"}
    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="Path must be absolute")
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail="Directory not found")
    try:
        result = []
        for dirpath, dirnames, filenames in os.walk(path):
            # Count direct media files in this directory
            media_count = sum(
                1 for f in filenames
                if os.path.splitext(f)[1].lower() in MEDIA_EXTS
            )
            if media_count > 0:
                folder_name = os.path.basename(dirpath)
                result.append({
                    "name": folder_name,
                    "path": dirpath,
                    "media_count": media_count,
                })
        # Sort by path for consistent ordering
        result.sort(key=lambda x: x["path"])
        return {"subfolders": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/files/serve")
def serve_native_file(path: str, request: Request):
    """Serve an arbitrary local file by absolute path (with Range support for video seeking)."""
    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="Path must be absolute")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    media_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    file_size = os.path.getsize(path)

    range_header = request.headers.get("range")
    if range_header and range_header.startswith("bytes="):
        # Parse Range header: "bytes=start-end", "bytes=start-", or "bytes=-N" (suffix)
        range_spec = range_header[6:]
        parts = range_spec.split("-", 1)
        if not parts[0]:
            # Suffix range: "bytes=-N" means last N bytes
            suffix_len = int(parts[1])
            start = max(0, file_size - suffix_len)
            end = file_size - 1
        else:
            start = int(parts[0])
            end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        content_length = end - start + 1

        def iter_range():
            with open(path, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_range(),
            status_code=206,
            media_type=media_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Content-Length": str(content_length),
                "Accept-Ranges": "bytes",
            },
        )

    # No Range header — return full file with Accept-Ranges hint
    return FileResponse(path, media_type=media_type, headers={"Accept-Ranges": "bytes"})


# ── Serve frontend (production build) ────────────────────────────────────────
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if FRONTEND_DIST.is_dir():
    # Serve static assets (js/css/icons/manifest)
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="frontend-assets")

    # Serve root-level static files (manifest.webmanifest, sw.js, icons, etc.)
    @app.get("/manifest.webmanifest")
    @app.get("/sw.js")
    @app.get("/registerSW.js")
    @app.get("/icon-192.png")
    @app.get("/icon-512.png")
    @app.get("/vite.svg")
    def serve_pwa_file(request: Request):
        filename = request.url.path.lstrip("/")
        file_path = FRONTEND_DIST / filename
        if file_path.is_file():
            return FileResponse(str(file_path))
        raise HTTPException(status_code=404)

    # SPA catch-all: any non-API route returns index.html
    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # Skip API routes (already handled above)
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        # Try to serve the exact file first (e.g. workbox-*.js)
        file_path = FRONTEND_DIST / full_path
        if full_path and file_path.is_file():
            return FileResponse(str(file_path))
        # Fallback to index.html for SPA routing
        return FileResponse(str(FRONTEND_DIST / "index.html"))


# ── Background tasks ────────────────────────────────────────────────────────

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
    import logging
    _logger = logging.getLogger("motif")

    # Seed default workflows on first run
    from database import SessionLocal
    from comfyui.seed_workflows import seed_default_workflows
    db = SessionLocal()
    try:
        seed_default_workflows(db)
    except Exception as e:
        _logger.error(f"Failed to seed workflows: {e}")
    finally:
        db.close()

    # Recover stale "running" tasks from a previous crash/restart
    from sqlalchemy import select
    from models.task import Task
    from datetime import datetime
    db = SessionLocal()
    try:
        stale = db.execute(
            select(Task).where(Task.status == "running")
        ).scalars().all()
        for t in stale:
            t.status = "failed"
            t.error_message = "服务重启时任务仍在执行，已标记为失败（可重试）"
            t.finished_at = datetime.utcnow()
            _logger.warning(f"Recovered stale running task {t.id} → failed")
        if stale:
            db.commit()
    finally:
        db.close()

    asyncio.create_task(_recycle_bin_cleanup_loop())

    from queue_runner import run_queue_forever
    asyncio.create_task(run_queue_forever())
