"""
P0 验证脚本 — 通过 ComfyUI API 提交工作流并等待完成

用法:
  python p0_verify.py comfyui/workflows/p0_turbo.json
  python p0_verify.py comfyui/workflows/p0_base.json
  python p0_verify.py comfyui/workflows/p0_pose.json
  python p0_verify.py comfyui/workflows/p0_preprocess.json
  python p0_verify.py comfyui/workflows/p0_faceswap.json
"""
import io
import json
import sys
import time
import urllib.request

# Windows GBK 终端兼容
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

COMFYUI_URL = "http://127.0.0.1:8188"


def submit_workflow(workflow_path: str) -> str:
    with open(workflow_path, encoding="utf-8") as f:
        workflow = json.load(f)
    data = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    if "error" in resp:
        raise RuntimeError(f"提交失败: {resp['error']}\n详情: {resp.get('node_errors', '')}")
    return resp["prompt_id"]


def wait_done(prompt_id: str, timeout: int = 600) -> dict:
    print(f"等待完成 (最长 {timeout}s) ...", end="", flush=True)
    for i in range(timeout):
        time.sleep(1)
        resp = json.loads(urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}").read())
        if prompt_id in resp:
            print(" 完成")
            return resp[prompt_id]
        if i % 10 == 9:
            print(".", end="", flush=True)
    raise TimeoutError(f"超时 {timeout}s，任务未完成")


def get_queue_remaining() -> int:
    resp = json.loads(urllib.request.urlopen(f"{COMFYUI_URL}/queue").read())
    return len(resp.get("queue_running", [])) + len(resp.get("queue_pending", []))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    wf_path = sys.argv[1]
    print(f"提交工作流: {wf_path}")

    try:
        pid = submit_workflow(wf_path)
        print(f"✅ 提交成功  prompt_id={pid}")
        result = wait_done(pid)
        outputs = result.get("outputs", {})
        images = []
        for node_output in outputs.values():
            for img in node_output.get("images", []):
                images.append(img["filename"])
        if images:
            print(f"✅ 生成图片: {images}")
        else:
            print("✅ 任务完成")
    except Exception as e:
        print(f"❌ 失败: {e}")
        sys.exit(1)
