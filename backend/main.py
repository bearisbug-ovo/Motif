import hashlib
import mimetypes
import os
import sqlite3

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from database import engine, Base
import models  # noqa: F401 — register all ORM models

from routers import characters, generate, gallery, inpaint


def _migrate_db() -> None:
    """Add missing columns to existing DB (safe to run on every startup)."""
    db_path = "motif.db"
    if not os.path.exists(db_path):
        return
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # characters.source_folder (added in Phase-1 folder-scan rework)
    cur.execute("PRAGMA table_info(characters)")
    char_cols = {row[1] for row in cur.fetchall()}
    if "source_folder" not in char_cols:
        cur.execute("ALTER TABLE characters ADD COLUMN source_folder VARCHAR(1000)")
        print("[migrate] Added characters.source_folder")

    conn.commit()
    conn.close()


_migrate_db()

# Create any new tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Motif API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static media files (generated + processed images)
app.mount("/media", StaticFiles(directory="media"), name="media")

# Routers
app.include_router(characters.router, prefix="/api/characters", tags=["characters"])
app.include_router(generate.router,   prefix="/api/generate",   tags=["generate"])
app.include_router(gallery.router,    prefix="/api/images",     tags=["gallery"])
app.include_router(inpaint.router,    prefix="/api/inpaint",    tags=["inpaint"])


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/files/pick-folder")
def pick_folder():
    """Open a native Windows folder-picker dialog and return the chosen path."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", 1)
        path = filedialog.askdirectory(title="选择人物图包所在文件夹")
        root.destroy()
        return {"path": path.replace("/", "\\") if path else ""}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"无法打开文件夹选择器：{exc}")


_THUMB_DIR = "media/thumbs"


@app.get("/api/files/thumb")
def get_thumb(path: str, size: int = 400):
    """Return a cached JPEG thumbnail (size×size max) for any local image file."""
    from PIL import Image
    from fastapi.responses import Response

    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="Path must be absolute")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    if size < 16 or size > 1600:
        raise HTTPException(status_code=400, detail="size must be 16–1600")

    # Cache key = hash of (path + mtime + size)
    mtime = str(os.path.getmtime(path))
    cache_key = hashlib.md5(f"{path}|{mtime}|{size}".encode()).hexdigest()
    os.makedirs(_THUMB_DIR, exist_ok=True)
    cache_path = os.path.join(_THUMB_DIR, f"{cache_key}.jpg")

    if not os.path.exists(cache_path):
        try:
            with Image.open(path) as img:
                img.thumbnail((size, size), Image.LANCZOS)
                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")
                img.save(cache_path, "JPEG", quality=82, optimize=True)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Cannot process image: {exc}")

    with open(cache_path, "rb") as f:
        data = f.read()

    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/files/serve")
def serve_native_file(path: str):
    """Serve an arbitrary local file by absolute path (for native image packs)."""
    if not os.path.isabs(path):
        raise HTTPException(status_code=400, detail="Path must be absolute")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    media_type = mimetypes.guess_type(path)[0] or "image/jpeg"
    return FileResponse(path, media_type=media_type)
