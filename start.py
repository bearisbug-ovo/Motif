"""Motif 一键启动器 — 依次启动 ComfyUI + 后端 + 前端，就绪后打开浏览器。

重复运行策略：
  - ComfyUI 已在运行 → 跳过启动，直接复用
  - 后端 / 前端 已在运行 → 终止旧进程后重启
"""
import os
import subprocess
import sys
import time
import urllib.request

BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
COMFYUI_PYTHON = r"D:\ai\ComfyUI-aki-v1.6\python\python.exe"
COMFYUI_MAIN   = r"D:\ai\ComfyUI-aki-v1.6\ComfyUI\main.py"
BACKEND_DIR    = os.path.join(BASE_DIR, "backend")
BACKEND_UV     = os.path.join(BACKEND_DIR, r"venv\Scripts\uvicorn.exe")
FRONTEND_DIR   = os.path.join(BASE_DIR, "frontend")

COMFYUI_URL  = "http://localhost:8188/object_info/KSampler"
BACKEND_URL  = "http://localhost:8000/api/health"
FRONTEND_URL = "http://localhost:5173"


# ── 端口检测与清理 ──────────────────────────────────────────────────

def is_alive(url: str) -> bool:
    """单次探测 URL，返回 True 表示已有服务在响应。"""
    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def kill_port(port: int) -> None:
    """终止所有正在监听指定端口的进程（Windows netstat + taskkill）。"""
    result = subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True
    )
    pids: set[str] = set()
    for line in result.stdout.splitlines():
        if f":{port} " in line and "LISTENING" in line:
            parts = line.split()
            if parts:
                pids.add(parts[-1])

    for pid in pids:
        if pid == "0":
            continue
        ret = subprocess.run(
            ["taskkill", "/F", "/PID", pid],
            capture_output=True, text=True,
        )
        if ret.returncode == 0:
            print(f"  已终止 PID {pid}（端口 {port}）")
        else:
            print(f"  无法终止 PID {pid}：{ret.stderr.strip()}")

    if pids:
        time.sleep(1)  # 等待端口释放


# ── 就绪等待 ────────────────────────────────────────────────────────

def wait_ready(url: str, label: str, timeout: int = 300) -> bool:
    print(f"  等待 {label}", end="", flush=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status == 200:
                    print(" ✓")
                    return True
        except Exception:
            pass
        print(".", end="", flush=True)
        time.sleep(3)
    print(" 超时")
    return False


# ── 主流程 ──────────────────────────────────────────────────────────

def main():
    print()
    print("=" * 46)
    print("  Motif 启动器")
    print("=" * 46)

    # ── 1. ComfyUI ────────────────────────────────
    comfyui_proc = None
    if is_alive(COMFYUI_URL):
        print("[1/3] ComfyUI 已在运行，跳过启动 ✓")
    else:
        print("[1/3] 启动 ComfyUI ...")
        comfyui_proc = subprocess.Popen(
            [COMFYUI_PYTHON, COMFYUI_MAIN, "--port", "8188", "--lowvram"],
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )
        if not wait_ready(COMFYUI_URL, "ComfyUI（首次加载约 1-2 分钟）", timeout=300):
            print("\n[错误] ComfyUI 启动失败，请查看 ComfyUI 窗口的错误信息。")
            input("按 Enter 退出...")
            sys.exit(1)

    # ── 2. 后端 ───────────────────────────────────
    print("[2/3] 启动后端 ...")
    if is_alive(BACKEND_URL):
        print("  检测到旧后端，正在重启...")
        kill_port(8000)
    backend_proc = subprocess.Popen(
        [BACKEND_UV, "main:app", "--port", "8000"],
        cwd=BACKEND_DIR,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )
    if not wait_ready(BACKEND_URL, "后端", timeout=30):
        print("\n[错误] 后端启动失败，请查看后端窗口的错误信息。")
        input("按 Enter 退出...")
        sys.exit(1)

    # ── 3. 前端 ───────────────────────────────────
    print("[3/3] 启动前端 ...")
    if is_alive(FRONTEND_URL):
        print("  检测到旧前端，正在重启...")
        kill_port(5173)
    frontend_proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=FRONTEND_DIR,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
        shell=True,
    )
    if not wait_ready(FRONTEND_URL, "前端", timeout=30):
        print("\n[警告] 前端未能确认就绪，仍尝试打开浏览器...")

    # ── 4. 打开浏览器 ─────────────────────────────
    import webbrowser
    webbrowser.open("http://localhost:5173")

    print()
    print("  全部服务已就绪！")
    print("  ─────────────────────────────────────")
    print("  Motif 界面 : http://localhost:5173")
    print("  ComfyUI    : http://localhost:8188")
    print("  ─────────────────────────────────────")
    print("  关闭此窗口 / Ctrl+C = 停止所有服务")
    print("  （ComfyUI 独立运行，关闭此窗口不影响它）")
    print()

    # ── 5. 监控子进程 ─────────────────────────────
    try:
        while True:
            if comfyui_proc and comfyui_proc.poll() is not None:
                print("[警告] ComfyUI 已退出。")
                break
            if backend_proc.poll() is not None:
                print("[警告] 后端已退出。")
                break
            if frontend_proc.poll() is not None:
                print("[警告] 前端已退出。")
                break
            time.sleep(2)
    except KeyboardInterrupt:
        pass

    print("正在停止后端和前端...")
    for proc in (backend_proc, frontend_proc):
        if proc.poll() is None:
            proc.terminate()
    if comfyui_proc and comfyui_proc.poll() is None:
        ans = input("是否同时停止 ComfyUI？(y/N) ").strip().lower()
        if ans == "y":
            comfyui_proc.terminate()
    print("已停止。")


if __name__ == "__main__":
    main()
