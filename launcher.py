"""
Motif Launcher — tkinter GUI that replaces start.ps1.

Manages backend (uvicorn), frontend build, and ComfyUI lifecycle.
Uses Win32 Job Object so all child processes die when this window closes.
"""
import ctypes
import ctypes.wintypes

# ── High-DPI awareness (must be called before any tkinter import) ─────────
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()  # fallback for older Windows
    except Exception:
        pass
import json
import os
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

# ── Paths ──────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
PYTHON = BACKEND / "venv" / "Scripts" / "python.exe"
LOG_DIR = ROOT / ".logs"
SETTINGS_FILE = BACKEND / "appdata" / "settings.json"

COMFYUI_PYTHON = Path(r"D:\ai\ComfyUI-aki-v1.6\python\python.exe")
COMFYUI_MAIN = Path(r"D:\ai\ComfyUI-aki-v1.6\ComfyUI\main.py")


# ── Win32 Job Object (auto-kill children on window close) ──────────────────
class JobObject:
    """Wraps a Windows Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE."""

    def __init__(self):
        self._handle = ctypes.windll.kernel32.CreateJobObjectW(None, None)

        # JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_int64),
                ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", ctypes.c_uint32),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", ctypes.c_uint32),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", ctypes.c_uint32),
                ("SchedulingClass", ctypes.c_uint32),
            ]

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [("i", ctypes.c_uint64 * 6)]

        class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
        ctypes.windll.kernel32.SetInformationJobObject(
            self._handle, 9,
            ctypes.byref(info), ctypes.sizeof(info),
        )

    def add(self, proc: subprocess.Popen):
        handle = ctypes.windll.kernel32.OpenProcess(0x1FFFFF, False, proc.pid)
        ctypes.windll.kernel32.AssignProcessToJobObject(self._handle, handle)
        ctypes.windll.kernel32.CloseHandle(handle)

    def close(self):
        if self._handle:
            ctypes.windll.kernel32.CloseHandle(self._handle)
            self._handle = None


# ── Single-instance guard ─────────────────────────────────────────────────
def ensure_single_instance():
    mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Global\\MotifLauncherGUI")
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        ctypes.windll.kernel32.CloseHandle(mutex)
        return None
    return mutex


# ── Settings I/O ──────────────────────────────────────────────────────────
def load_settings() -> dict:
    if SETTINGS_FILE.exists():
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_settings(data: dict):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ── Port utilities ────────────────────────────────────────────────────────
def test_port(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except (OSError, ConnectionRefusedError):
        return False


def kill_port(port: int):
    subprocess.run(
        f'for /f "tokens=5" %a in (\'netstat -ano ^| findstr :{port} ^| findstr LISTENING\') do taskkill /F /PID %a >nul 2>&1',
        shell=True, creationflags=subprocess.CREATE_NO_WINDOW,
    )


def check_comfyui(url: str) -> bool:
    try:
        r = urlopen(f"{url}/object_info/KSampler", timeout=3)
        return r.status == 200
    except Exception:
        return False


def get_local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


# ═══════════════════════════════════════════════════════════════════════════
#  Main GUI
# ═══════════════════════════════════════════════════════════════════════════
class MotifLauncher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Motif Launcher")
        self.geometry("880x720")
        self.resizable(True, True)
        self.configure(bg="#1a1a2e")
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        self._job = JobObject()
        self._backend_proc: subprocess.Popen | None = None
        self._comfyui_proc: subprocess.Popen | None = None
        self._running = False
        self._poll_id: str | None = None

        # Load settings
        self._settings = load_settings()

        self._setup_styles()
        self._build_ui()
        self._update_status()

        # Auto-start all services on launch
        self.after(100, self._start_all)

    # ── Styles ────────────────────────────────────────────────────────────
    def _setup_styles(self):
        style = ttk.Style(self)
        style.theme_use("clam")

        BG = "#1a1a2e"
        CARD = "#16213e"
        FG = "#e0e0e0"
        FG_DIM = "#8899aa"
        PRIMARY = "#6366f1"
        GREEN = "#22c55e"
        RED = "#ef4444"
        BORDER = "#2a3a5e"

        self._colors = {
            "bg": BG, "card": CARD, "fg": FG, "dim": FG_DIM,
            "primary": PRIMARY, "green": GREEN, "red": RED, "border": BORDER,
        }

        FONT = "Segoe UI"
        style.configure(".", background=BG, foreground=FG, fieldbackground=CARD,
                         bordercolor=BORDER, troughcolor=CARD, selectbackground=PRIMARY,
                         font=(FONT, 11))
        style.configure("Card.TFrame", background=CARD, relief="solid", borderwidth=1)
        style.configure("Card.TLabel", background=CARD, foreground=FG, font=(FONT, 11))
        style.configure("Dim.TLabel", background=CARD, foreground=FG_DIM, font=(FONT, 10))
        style.configure("Title.TLabel", background=BG, foreground=FG, font=(FONT, 16, "bold"))
        style.configure("Section.TLabel", background=BG, foreground=FG, font=(FONT, 12, "bold"))
        style.configure("StatusGreen.TLabel", background=CARD, foreground=GREEN, font=(FONT, 11, "bold"))
        style.configure("StatusRed.TLabel", background=CARD, foreground=RED, font=(FONT, 11, "bold"))

        style.configure("Primary.TButton", background=PRIMARY, foreground="white",
                         font=(FONT, 11, "bold"), padding=(20, 10))
        style.map("Primary.TButton",
                   background=[("active", "#5558dd"), ("disabled", "#444")])

        style.configure("Outline.TButton", background=CARD, foreground=FG,
                         font=(FONT, 11), padding=(14, 7))
        style.map("Outline.TButton",
                   background=[("active", "#2a3a5e"), ("disabled", "#222")])

        style.configure("TEntry", fieldbackground="#0f1629", foreground=FG,
                         insertcolor=FG, padding=6, font=(FONT, 11))
        style.configure("TCheckbutton", font=(FONT, 11))
        style.configure("TNotebook.Tab", font=(FONT, 11), padding=(12, 6))

        style.configure("Log.TFrame", background="#0f1629")

    # ── Build UI ──────────────────────────────────────────────────────────
    def _build_ui(self):
        # Title bar
        title_frame = ttk.Frame(self)
        title_frame.pack(fill="x", padx=16, pady=(12, 4))
        ttk.Label(title_frame, text="Motif Launcher", style="Title.TLabel").pack(side="left")

        # Notebook for tabs
        self._notebook = ttk.Notebook(self)
        self._notebook.pack(fill="both", expand=True, padx=12, pady=8)

        self._build_main_tab()
        self._build_settings_tab()
        self._build_log_tab()

    def _build_main_tab(self):
        tab = ttk.Frame(self._notebook)
        self._notebook.add(tab, text="  状态  ")
        tab.configure(style="TFrame")

        # ── Status cards row ──
        cards = ttk.Frame(tab)
        cards.pack(fill="x", padx=8, pady=8)
        cards.columnconfigure(0, weight=1)
        cards.columnconfigure(1, weight=1)
        cards.columnconfigure(2, weight=1)

        # Backend card
        self._backend_card = self._make_status_card(cards, "后端服务", 0)
        # ComfyUI card
        self._comfyui_card = self._make_status_card(cards, "ComfyUI", 1)
        # Network card
        self._network_card = self._make_status_card(cards, "网络", 2)

        # ── Control buttons ──
        btn_frame = ttk.Frame(tab)
        btn_frame.pack(fill="x", padx=8, pady=(4, 8))

        self._start_btn = ttk.Button(btn_frame, text="启动全部服务", style="Primary.TButton",
                                      command=self._start_all)
        self._start_btn.pack(side="left", padx=4)

        self._stop_btn = ttk.Button(btn_frame, text="停止全部", style="Outline.TButton",
                                     command=self._stop_all, state="disabled")
        self._stop_btn.pack(side="left", padx=4)

        self._restart_btn = ttk.Button(btn_frame, text="快速重启", style="Outline.TButton",
                                        command=self._quick_restart, state="disabled")
        self._restart_btn.pack(side="left", padx=4)

        self._open_btn = ttk.Button(btn_frame, text="打开浏览器", style="Outline.TButton",
                                     command=self._open_browser, state="disabled")
        self._open_btn.pack(side="right", padx=4)

        # ── Connected devices ──
        ttk.Label(tab, text="已连接设备", style="Section.TLabel").pack(anchor="w", padx=12, pady=(8, 4))

        dev_frame = ttk.Frame(tab, style="Card.TFrame")
        dev_frame.pack(fill="both", expand=True, padx=8, pady=(0, 8))

        self._devices_text = tk.Text(dev_frame, height=6, bg="#16213e", fg="#e0e0e0",
                                      font=("Consolas", 11), relief="flat", state="disabled",
                                      selectbackground="#6366f1", borderwidth=0, padx=10, pady=8)
        self._devices_text.pack(fill="both", expand=True)

    def _make_status_card(self, parent, title, col) -> dict:
        frame = ttk.Frame(parent, style="Card.TFrame")
        frame.grid(row=0, column=col, sticky="nsew", padx=4, pady=4)
        frame.columnconfigure(0, weight=1)

        inner = ttk.Frame(frame, style="Card.TFrame")
        inner.pack(fill="both", padx=12, pady=10)

        title_row = ttk.Frame(inner, style="Card.TFrame")
        title_row.pack(fill="x")
        ttk.Label(title_row, text=title, style="Card.TLabel",
                   font=("Segoe UI", 12, "bold")).pack(side="left")
        dot = tk.Canvas(title_row, width=12, height=12, bg=self._colors["card"],
                         highlightthickness=0)
        dot.pack(side="right")
        dot_id = dot.create_oval(1, 1, 11, 11, fill=self._colors["red"], outline="")

        status_lbl = ttk.Label(inner, text="未启动", style="StatusRed.TLabel")
        status_lbl.pack(anchor="w", pady=(4, 0))

        detail_lbl = ttk.Label(inner, text="", style="Dim.TLabel", wraplength=220)
        detail_lbl.pack(anchor="w", pady=(2, 0))

        return {"frame": frame, "dot": dot, "dot_id": dot_id,
                "status": status_lbl, "detail": detail_lbl}

    def _set_card_status(self, card: dict, ok: bool, text: str, detail: str = ""):
        color = self._colors["green"] if ok else self._colors["red"]
        style = "StatusGreen.TLabel" if ok else "StatusRed.TLabel"
        card["dot"].itemconfig(card["dot_id"], fill=color)
        card["status"].configure(text=text, style=style)
        card["detail"].configure(text=detail)

    def _build_settings_tab(self):
        tab = ttk.Frame(self._notebook)
        self._notebook.add(tab, text="  设置  ")

        canvas = tk.Canvas(tab, bg=self._colors["bg"], highlightthickness=0)
        canvas.pack(fill="both", expand=True)

        inner = ttk.Frame(canvas)
        canvas.create_window((0, 0), window=inner, anchor="nw")

        def _on_configure(e):
            canvas.configure(scrollregion=canvas.bbox("all"))
            canvas.itemconfigure(canvas.find_all()[0], width=e.width)

        inner.bind("<Configure>", _on_configure)
        canvas.bind("<Configure>", _on_configure)

        pad = {"padx": 12, "pady": 4}
        row = 0

        ttk.Label(inner, text="启动前可修改以下设置，保存后下次启动生效",
                   style="Dim.TLabel").grid(row=row, column=0, columnspan=3, sticky="w", padx=12, pady=(12, 8))
        row += 1

        # Backend port
        ttk.Label(inner, text="后端端口:").grid(row=row, column=0, sticky="w", **pad)
        self._port_var = tk.StringVar(value=str(self._settings.get("fastapi_port", 8000)))
        ttk.Entry(inner, textvariable=self._port_var, width=10).grid(row=row, column=1, sticky="w", **pad)
        row += 1

        # ComfyUI URL
        ttk.Label(inner, text="ComfyUI 地址:").grid(row=row, column=0, sticky="w", **pad)
        self._comfyui_url_var = tk.StringVar(value=self._settings.get("comfyui_url", "http://127.0.0.1:8188"))
        ttk.Entry(inner, textvariable=self._comfyui_url_var, width=36).grid(row=row, column=1, columnspan=2, sticky="w", **pad)
        row += 1

        # ComfyUI launch cmd
        ttk.Label(inner, text="ComfyUI 启动命令:").grid(row=row, column=0, sticky="w", **pad)
        default_cmd = self._settings.get("comfyui_launch_cmd", "")
        if not default_cmd and COMFYUI_PYTHON.exists():
            default_cmd = f'"{COMFYUI_PYTHON}" "{COMFYUI_MAIN}" --port 8188 --lowvram'
        self._comfyui_cmd_var = tk.StringVar(value=default_cmd)
        ttk.Entry(inner, textvariable=self._comfyui_cmd_var, width=60).grid(row=row, column=1, columnspan=2, sticky="we", **pad)
        row += 1

        # Thumbnail size
        ttk.Label(inner, text="缩略图大小 (px):").grid(row=row, column=0, sticky="w", **pad)
        self._thumb_var = tk.StringVar(value=str(self._settings.get("thumbnail_size", 400)))
        ttk.Entry(inner, textvariable=self._thumb_var, width=10).grid(row=row, column=1, sticky="w", **pad)
        row += 1

        # Skip build checkbox
        self._skip_build_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(inner, text="跳过前端构建（已有 dist/ 时可加速启动）",
                         variable=self._skip_build_var).grid(row=row, column=0, columnspan=3, sticky="w", **pad)
        row += 1

        # Skip ComfyUI checkbox
        self._skip_comfyui_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(inner, text="不启动 ComfyUI（仅浏览媒体库时可跳过）",
                         variable=self._skip_comfyui_var).grid(row=row, column=0, columnspan=3, sticky="w", **pad)
        row += 1

        # Save button
        ttk.Button(inner, text="保存设置", style="Outline.TButton",
                    command=self._save_settings).grid(row=row, column=0, sticky="w", padx=12, pady=(12, 8))

    def _build_log_tab(self):
        tab = ttk.Frame(self._notebook, style="Log.TFrame")
        self._notebook.add(tab, text="  日志  ")

        self._log_text = tk.Text(tab, bg="#0f1629", fg="#e0e0e0",
                                  font=("Consolas", 11), relief="flat",
                                  state="disabled", selectbackground="#6366f1",
                                  borderwidth=0, padx=10, pady=8)
        scrollbar = ttk.Scrollbar(tab, orient="vertical", command=self._log_text.yview)
        self._log_text.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self._log_text.pack(fill="both", expand=True)

        # Tag colors
        self._log_text.tag_configure("info", foreground="#6366f1")
        self._log_text.tag_configure("ok", foreground="#22c55e")
        self._log_text.tag_configure("err", foreground="#ef4444")
        self._log_text.tag_configure("warn", foreground="#eab308")
        self._log_text.tag_configure("dim", foreground="#8899aa")

    # ── Logging ───────────────────────────────────────────────────────────
    def _log(self, msg: str, tag: str = "info"):
        ts = time.strftime("%H:%M:%S")
        self._log_text.configure(state="normal")
        self._log_text.insert("end", f"[{ts}] ", "dim")
        self._log_text.insert("end", msg + "\n", tag)
        self._log_text.see("end")
        self._log_text.configure(state="disabled")

    # ── Settings ──────────────────────────────────────────────────────────
    def _save_settings(self):
        try:
            port = int(self._port_var.get())
        except ValueError:
            port = 8000
        try:
            thumb = int(self._thumb_var.get())
        except ValueError:
            thumb = 400

        self._settings["fastapi_port"] = port
        self._settings["comfyui_url"] = self._comfyui_url_var.get()
        self._settings["comfyui_launch_cmd"] = self._comfyui_cmd_var.get()
        self._settings["thumbnail_size"] = thumb
        save_settings(self._settings)
        self._log("设置已保存", "ok")

    # ── Service control ───────────────────────────────────────────────────
    def _start_all(self):
        self._start_btn.configure(state="disabled")
        self._running = True
        threading.Thread(target=self._startup_sequence, daemon=True).start()

    def _startup_sequence(self):
        port = int(self._port_var.get() or 8000)

        # Phase 1: Kill old processes
        self._log("清理旧进程...", "info")
        kill_port(port)
        time.sleep(0.5)

        # Phase 2: Build frontend
        if not self._skip_build_var.get():
            self._log("构建前端...", "info")
            try:
                result = subprocess.run(
                    ["cmd", "/c", "npm run build"],
                    cwd=str(FRONTEND),
                    capture_output=True, text=True, timeout=120,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
                if result.returncode == 0:
                    self._log("前端构建完成", "ok")
                else:
                    self._log(f"前端构建失败: {result.stderr[-200:]}", "err")
            except subprocess.TimeoutExpired:
                self._log("前端构建超时", "err")
            except Exception as e:
                self._log(f"前端构建异常: {e}", "err")
        else:
            self._log("跳过前端构建", "warn")

        # Phase 3: Start backend
        self._log(f"启动后端 (port {port})...", "info")
        LOG_DIR.mkdir(exist_ok=True)

        env = os.environ.copy()
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"

        self._backend_proc = subprocess.Popen(
            [str(PYTHON), "-m", "uvicorn", "main:app",
             "--host", "0.0.0.0", "--port", str(port)],
            cwd=str(BACKEND),
            stdout=open(LOG_DIR / "backend.log", "w", encoding="utf-8"),
            stderr=open(LOG_DIR / "backend-error.log", "w", encoding="utf-8"),
            env=env,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        self._job.add(self._backend_proc)

        # Wait for backend
        for i in range(30):
            if test_port(port):
                self._log(f"后端已启动 (PID: {self._backend_proc.pid})", "ok")
                break
            time.sleep(1)
        else:
            self._log("后端启动超时！请检查 .logs/backend-error.log", "err")

        # Phase 4: ComfyUI
        comfyui_url = self._comfyui_url_var.get()
        if not self._skip_comfyui_var.get():
            if check_comfyui(comfyui_url):
                self._log("ComfyUI 已在运行", "ok")
            else:
                cmd = self._comfyui_cmd_var.get()
                if cmd:
                    self._log("启动 ComfyUI...", "info")
                    try:
                        self._comfyui_proc = subprocess.Popen(
                            cmd, shell=True,
                            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
                        )
                        self._log(f"ComfyUI 进程已启动 (PID: {self._comfyui_proc.pid})", "ok")
                    except Exception as e:
                        self._log(f"ComfyUI 启动失败: {e}", "err")
                else:
                    self._log("ComfyUI 启动命令未配置，跳过", "warn")
        else:
            self._log("跳过 ComfyUI", "warn")

        # Done
        self._log("所有服务已启动", "ok")
        local_ip = get_local_ip()
        self._log(f"本机访问: http://localhost:{port}", "info")
        self._log(f"局域网访问: http://{local_ip}:{port}", "info")

        self.after(0, self._on_started)

    def _on_started(self):
        self._stop_btn.configure(state="normal")
        self._restart_btn.configure(state="normal")
        self._open_btn.configure(state="normal")
        self._start_polling()
        self._open_browser()

    def _stop_all(self):
        self._running = False
        self._stop_polling()
        self._log("停止所有服务...", "warn")

        port = int(self._port_var.get() or 8000)
        if self._backend_proc:
            try:
                self._backend_proc.terminate()
                self._backend_proc.wait(timeout=5)
            except Exception:
                try:
                    self._backend_proc.kill()
                except Exception:
                    pass
            self._backend_proc = None

        kill_port(port)

        self._log("服务已停止", "ok")
        self._start_btn.configure(state="normal")
        self._stop_btn.configure(state="disabled")
        self._restart_btn.configure(state="disabled")
        self._open_btn.configure(state="disabled")
        self._update_status()

    def _quick_restart(self):
        """Quick restart: rebuild frontend + restart backend. ComfyUI untouched."""
        self._restart_btn.configure(state="disabled")
        self._log("快速重启（前端构建 + 后端重启）...", "warn")
        threading.Thread(target=self._do_quick_restart, daemon=True).start()

    def _do_quick_restart(self):
        port = int(self._port_var.get() or 8000)

        # Stop backend
        if self._backend_proc:
            try:
                self._backend_proc.terminate()
                self._backend_proc.wait(timeout=5)
            except Exception:
                pass
        kill_port(port)
        time.sleep(0.5)

        # Rebuild frontend
        if not self._skip_build_var.get():
            self._log("构建前端...", "info")
            try:
                result = subprocess.run(
                    ["cmd", "/c", "npm run build"],
                    cwd=str(FRONTEND),
                    capture_output=True, text=True, timeout=120,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
                if result.returncode == 0:
                    self._log("前端构建完成", "ok")
                else:
                    self._log(f"前端构建失败: {result.stderr[-200:]}", "err")
            except subprocess.TimeoutExpired:
                self._log("前端构建超时", "err")
            except Exception as e:
                self._log(f"前端构建异常: {e}", "err")
        else:
            self._log("跳过前端构建", "warn")

        # Restart backend
        self._log(f"启动后端 (port {port})...", "info")
        LOG_DIR.mkdir(exist_ok=True)

        env = os.environ.copy()
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"

        self._backend_proc = subprocess.Popen(
            [str(PYTHON), "-m", "uvicorn", "main:app",
             "--host", "0.0.0.0", "--port", str(port)],
            cwd=str(BACKEND),
            stdout=open(LOG_DIR / "backend.log", "w", encoding="utf-8"),
            stderr=open(LOG_DIR / "backend-error.log", "w", encoding="utf-8"),
            env=env,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        self._job.add(self._backend_proc)

        for i in range(30):
            if test_port(port):
                self._log(f"快速重启完成 (PID: {self._backend_proc.pid})", "ok")
                self.after(0, lambda: self._restart_btn.configure(state="normal"))
                return
            time.sleep(1)
        self._log("后端启动超时", "err")
        self.after(0, lambda: self._restart_btn.configure(state="normal"))

    def _open_browser(self):
        port = int(self._port_var.get() or 8000)
        os.startfile(f"http://localhost:{port}")

    # ── Status polling ────────────────────────────────────────────────────
    def _start_polling(self):
        self._poll_id = self.after(3000, self._poll_tick)

    def _stop_polling(self):
        if self._poll_id:
            self.after_cancel(self._poll_id)
            self._poll_id = None

    def _poll_tick(self):
        threading.Thread(target=self._update_status, daemon=True).start()
        if self._running:
            self._poll_id = self.after(5000, self._poll_tick)

    def _update_status(self):
        port = int(self._port_var.get() or 8000)
        comfyui_url = self._comfyui_url_var.get()
        local_ip = get_local_ip()

        backend_ok = test_port(port)
        comfyui_ok = False
        devices_info = ""
        uptime = ""
        errors_1h = 0
        errors_24h = 0

        if backend_ok:
            # Try to get full status from backend API (includes ComfyUI check)
            try:
                r = urlopen(f"http://127.0.0.1:{port}/api/launcher/status", timeout=3)
                import json as _json
                data = _json.loads(r.read().decode())

                comfyui_ok = data.get("comfyui", {}).get("connected", False)
                clients = data.get("clients", [])
                uptime = data.get("backend", {}).get("uptime", "")
                errors_1h = data.get("errors", {}).get("last_1h", 0)
                errors_24h = data.get("errors", {}).get("last_24h", 0)

                if clients:
                    for c in clients:
                        devices_info += f"  {c['ip']:20s} {c['user_agent']:16s} {c['last_seen_ago']:>8s}  ({c['request_count']} 请求)\n"
                else:
                    devices_info = "  暂无设备连接\n"
            except Exception:
                # API failed but port is open — check ComfyUI directly
                comfyui_ok = check_comfyui(comfyui_url)
                devices_info = "  （无法获取）\n"
        else:
            # Backend down — still check ComfyUI independently
            comfyui_ok = check_comfyui(comfyui_url)
            devices_info = "  服务未启动\n"

        # Schedule all UI updates on main thread (use default args to capture values)
        def _update_ui(
            _backend_ok=backend_ok, _comfyui_ok=comfyui_ok,
            _port=port, _uptime=uptime, _e1h=errors_1h, _e24h=errors_24h,
            _comfyui_url=comfyui_url, _local_ip=local_ip, _devices=devices_info
        ):
            # Backend card
            if _backend_ok:
                pid = self._backend_proc.pid if self._backend_proc else '?'
                detail = f"端口 {_port} · PID {pid}"
                if _uptime:
                    detail += f"\n运行 {_uptime} · 错误 {_e1h}(1h)/{_e24h}(24h)"
                self._set_card_status(self._backend_card, True, "运行中", detail)
            else:
                self._set_card_status(self._backend_card, False, "未启动", f"端口 {_port}")

            # ComfyUI card
            self._set_card_status(
                self._comfyui_card, _comfyui_ok,
                "已连接" if _comfyui_ok else "未连接",
                _comfyui_url
            )

            # Network card
            self._set_card_status(
                self._network_card, _backend_ok,
                "就绪" if _backend_ok else "离线",
                f"本机: localhost:{_port}\n局域网: {_local_ip}:{_port}"
            )

            # Devices
            self._devices_text.configure(state="normal")
            self._devices_text.delete("1.0", "end")
            self._devices_text.insert("end", _devices)
            self._devices_text.configure(state="disabled")

        self.after(0, _update_ui)

    # ── Cleanup ───────────────────────────────────────────────────────────
    def _on_close(self):
        if self._running:
            self._stop_all()
        self._job.close()
        self.destroy()


# ═══════════════════════════════════════════════════════════════════════════
#  Entry point
# ═══════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    mutex = ensure_single_instance()
    if mutex is None:
        import tkinter.messagebox as mb
        root = tk.Tk()
        root.withdraw()
        mb.showwarning("Motif", "启动器已在运行中！")
        root.destroy()
        sys.exit(1)

    try:
        app = MotifLauncher()
        app.mainloop()
    finally:
        try:
            ctypes.windll.kernel32.CloseHandle(mutex)
        except Exception:
            pass
