"""Launcher dashboard: service control, client tracking, error stats."""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

from config import get_settings

router = APIRouter()

# ── Backend uptime tracking ─────────────────────────────────────────────────
_start_time = time.time()


# ── Connected clients tracking ──────────────────────────────────────────────
@dataclass
class ClientInfo:
    ip: str
    user_agent: str
    first_seen: float
    last_seen: float
    request_count: int = 0


_clients: dict[str, ClientInfo] = {}
_clients_lock = Lock()


def track_client(request: Request):
    """Called from middleware to record client connections."""
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "unknown")
    now = time.time()

    with _clients_lock:
        if ip in _clients:
            _clients[ip].last_seen = now
            _clients[ip].request_count += 1
            _clients[ip].user_agent = ua
        else:
            _clients[ip] = ClientInfo(
                ip=ip, user_agent=ua,
                first_seen=now, last_seen=now,
                request_count=1,
            )


# ── Error tracking ──────────────────────────────────────────────────────────
@dataclass
class ErrorRecord:
    timestamp: float
    status_code: int
    method: str
    path: str
    detail: str = ""


_errors: deque[ErrorRecord] = deque(maxlen=200)
_errors_lock = Lock()


def track_error(status_code: int, method: str, path: str, detail: str = ""):
    """Called from middleware on 4xx/5xx responses."""
    with _errors_lock:
        _errors.append(ErrorRecord(
            timestamp=time.time(),
            status_code=status_code,
            method=method,
            path=path,
            detail=detail[:200],
        ))


# ── ComfyUI process management ─────────────────────────────────────────────
_comfyui_process: subprocess.Popen | None = None


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/status")
async def launcher_status():
    """Combined dashboard status."""
    settings = get_settings()

    # Backend info
    uptime_secs = time.time() - _start_time
    hours, remainder = divmod(int(uptime_secs), 3600)
    minutes, seconds = divmod(remainder, 60)

    # ComfyUI check
    comfyui_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.comfyui_url}/object_info/KSampler")
            comfyui_ok = r.status_code == 200
    except Exception:
        pass

    # Connected clients (active in last 30 min)
    cutoff = time.time() - 1800
    with _clients_lock:
        active_clients = [
            {
                "ip": c.ip,
                "user_agent": _short_ua(c.user_agent),
                "last_seen": _format_ts(c.last_seen),
                "last_seen_ago": _ago(c.last_seen),
                "request_count": c.request_count,
            }
            for c in _clients.values()
            if c.last_seen > cutoff
        ]
    active_clients.sort(key=lambda x: x["last_seen"], reverse=True)

    # Error stats
    now = time.time()
    with _errors_lock:
        errors_1h = sum(1 for e in _errors if now - e.timestamp < 3600)
        errors_24h = sum(1 for e in _errors if now - e.timestamp < 86400)
        recent_errors = [
            {
                "time": _format_ts(e.timestamp),
                "time_ago": _ago(e.timestamp),
                "status": e.status_code,
                "method": e.method,
                "path": e.path,
                "detail": e.detail,
            }
            for e in list(_errors)[-20:]
        ]
        recent_errors.reverse()

    # Disk space
    import shutil
    disk = shutil.disk_usage(str(settings.appdata_dir))

    return {
        "backend": {
            "running": True,
            "uptime": f"{hours}h {minutes}m {seconds}s",
            "uptime_seconds": int(uptime_secs),
            "version": "2.0.0",
            "port": settings.fastapi_port,
            "pid": os.getpid(),
        },
        "comfyui": {
            "connected": comfyui_ok,
            "url": settings.comfyui_url,
            "managed": _comfyui_process is not None,
        },
        "clients": active_clients,
        "client_count": len(active_clients),
        "errors": {
            "last_1h": errors_1h,
            "last_24h": errors_24h,
            "recent": recent_errors,
        },
        "disk": {
            "total_gb": round(disk.total / 1e9, 1),
            "used_gb": round(disk.used / 1e9, 1),
            "free_gb": round(disk.free / 1e9, 1),
        },
    }


@router.post("/comfyui/start")
async def start_comfyui():
    """Start ComfyUI process."""
    global _comfyui_process
    settings = get_settings()

    # Check if already running
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.comfyui_url}/object_info/KSampler")
            if r.status_code == 200:
                return {"status": "already_running"}
    except Exception:
        pass

    cmd = settings.comfyui_launch_cmd
    if not cmd:
        return {"status": "error", "detail": "ComfyUI 启动命令未配置，请在设置中填写"}

    try:
        _comfyui_process = subprocess.Popen(
            cmd,
            shell=True,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
        )
        return {"status": "starting", "pid": _comfyui_process.pid}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@router.post("/comfyui/stop")
async def stop_comfyui():
    """Stop managed ComfyUI process."""
    global _comfyui_process
    if _comfyui_process is not None:
        try:
            _comfyui_process.terminate()
            _comfyui_process.wait(timeout=10)
        except Exception:
            try:
                _comfyui_process.kill()
            except Exception:
                pass
        _comfyui_process = None
        return {"status": "stopped"}

    # Try to kill by port
    if sys.platform == "win32":
        try:
            os.system("for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :8188 ^| findstr LISTENING') do taskkill /F /PID %a >nul 2>&1")
        except Exception:
            pass
    return {"status": "stopped"}


@router.post("/restart-backend")
async def restart_backend():
    """Schedule backend restart (exits process, launcher script will restart)."""
    import asyncio

    async def _delayed_exit():
        await asyncio.sleep(1)
        os._exit(0)  # Hard exit — launcher script detects and restarts

    asyncio.create_task(_delayed_exit())
    return {"status": "restarting"}


@router.get("/logs")
async def get_logs(lines: int = 50):
    """Read recent backend log lines."""
    log_dir = Path(__file__).resolve().parent.parent.parent / ".logs"
    result = {}

    for name in ("backend.log", "backend-error.log"):
        log_path = log_dir / name
        if log_path.exists():
            try:
                text = log_path.read_text(encoding="utf-8", errors="replace")
                all_lines = text.strip().split("\n")
                result[name] = all_lines[-lines:]
            except Exception:
                result[name] = []
        else:
            result[name] = []

    return result


# ── Helpers ─────────────────────────────────────────────────────────────────

def _short_ua(ua: str) -> str:
    """Extract meaningful part of user-agent string."""
    if not ua or ua == "unknown":
        return "unknown"
    # Detect common browsers/devices
    if "iPhone" in ua:
        return "iPhone"
    if "iPad" in ua:
        return "iPad"
    if "Android" in ua:
        if "Mobile" in ua:
            return "Android Mobile"
        return "Android Tablet"
    if "Edge" in ua:
        return "Edge"
    if "Chrome" in ua:
        return "Chrome"
    if "Firefox" in ua:
        return "Firefox"
    if "Safari" in ua:
        return "Safari"
    if "python" in ua.lower() or "httpx" in ua.lower():
        return "API Client"
    return ua[:30]


def _format_ts(ts: float) -> str:
    dt = datetime.fromtimestamp(ts)
    return dt.strftime("%H:%M:%S")


def _ago(ts: float) -> str:
    diff = int(time.time() - ts)
    if diff < 60:
        return f"{diff}秒前"
    if diff < 3600:
        return f"{diff // 60}分钟前"
    return f"{diff // 3600}小时前"
