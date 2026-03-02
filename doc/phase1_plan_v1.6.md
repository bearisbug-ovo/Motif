# AI 图像生成系统 — Phase 1 开发计划

> 基于 ComfyUI + Z-Image 双模型 · Vue 3 + FastAPI · 8GB 显存本地部署

---

## Phase 0 — 最小工作流验证（预研）

> 不考虑模块串联和 Web 界面，每个核心能力独立在 ComfyUI 中跑通，确认技术可行性后再进入 Phase 1 开发。

### 目标与原则

- 每个工作流尽可能精简，只保留验证核心能力必须的节点
- 各工作流独立运行，互不依赖
- 高清放大方案暂不纳入 Phase 0，Phase 2 再行验证

### 工作流默认值规范

每个工作流 JSON 同时承担两个角色：**在 ComfyUI 界面可直接手动运行**，以及**作为 API 调用的模板**。为此，所有工作流的默认值必须填写为真实可用的参数，而非占位符：

| 字段 | 规范 |
|---|---|
| 正向 Prompt | 用中文段落式自然语言描述，如 `"一位年轻女性，半身人像，咖啡馆窗边，自然光，真实摄影风格"` |
| 负向 Prompt | **不需要**，负向条件固定置空（空字符串），工作流中负向编码器输入留空即可 |
| seed | 填写固定值（如 `42`），方便手动复现结果 |
| LoadImage 路径 | 填写放在 `ComfyUI/input/` 目录下的测试图文件名，如 `"test_face.png"` |
| 分辨率/步数/CFG | 填写正式参数值，不用"测试值"降配 |

> `LoadImage` 的图片路径在手动运行和 API 调用时行为不同：手动运行时 ComfyUI 只认 `input/` 目录下的文件名；API 调用时需先通过 `/upload/image` 接口上传图片，再将返回的文件名注入工作流。这一差异由 Phase 1 M3 的 `ComfyUIClient` 统一处理，Phase 0 手动验证时直接把测试图放入 `input/` 目录即可。

### P0-A — Z-Image 基础生成

**验证目标**：Turbo 和 Base 两个模型能正常出图，参数差异（步数/CFG/调度器）生效。

最小工作流节点：`UNETLoader → CLIPLoader → VAELoader → CLIPTextEncode（正/负） → KSampler → VAEDecode → SaveImage`

| 验证点 | 通过标准 |
|---|---|
| Turbo 8步出图 | 正常生成，无报错，显存不 OOM |
| Base 30步出图 | 正常生成，质量明显优于 Turbo |
| 分辨率 768×1024 | 输出尺寸正确 |

**交付物**：`p0_turbo.json` / `p0_base.json` · 各2张效果截图 · `p0_a.nodes.json`

---

### P0-B — InsightFace 裁脸 + 去背景预处理

**验证目标**：给定一张人脸照，能自动裁出正脸区域并去除背景，产出 face_crop_nobg 文件。

最小工作流节点：`LoadImage → easy imageRemBg（Inspyrenet, add_background=white）→ ACE_ImageFaceCrop（768×768）→ SaveImage`

| 验证点 | 通过标准 |
|---|---|
| 去背景 | 人像主体干净，背景完全移除，RGBA→RGB 转换正确 |
| 裁脸 | 正脸区域完整，无截断 |
| 输出尺寸 | face_crop_nobg 768×768 |

**交付物**：`p0_preprocess.json` · 原图/去背/裁脸对比截图 · `p0_b.nodes.json`

---

### P0-C — Qwen-Image-Edit Kontext 换脸

**验证目标**：给定底图（风格图）和人脸参考图（face_crop_nobg），换脸后人脸相似度达标，边缘自然融合。

**实际工作流节点（Phase 0 验证结论）：**
`LoadImage（底图）→ ImageScaleToTotalPixels(1MP) → VAEEncode`
`LoadImage（人脸参考）→ easy imageRemBg（Inspyrenet, add_background=white）`
`UnetLoaderGGUF → ModelSamplingAuraFlow(shift=3.1) → CFGNorm(strength=1.0)`
`CLIPLoaderGGUF(type=qwen_image) + VAELoader(qwen_image_vae.safetensors)`
`TextEncodeQwenImageEditPlus（正向：image1=底图 + image2=参考 + 指令）→ FluxKontextMultiReferenceLatentMethod`
`TextEncodeQwenImageEditPlus（负向：空）→ FluxKontextMultiReferenceLatentMethod`
`KSampler(steps=4, cfg=1.0, euler, simple, denoise=1.0) → VAEDecode → SaveImage`

> **关键点**：无需 InsightFace 遮罩、无需噪声注入。`add_background=white` 是必须的（转 RGBA→RGB，否则 VL 编码器报维度错误）。CLIP mmproj-BF16.gguf 需与 CLIP GGUF 在同一目录（自动加载）。

| 验证点 | 通过标准 |
|---|---|
| 换脸人脸相似度 | 主观相似度 ≥ 8/10 |
| 边缘融合 | 脸部边缘无明显接缝 |
| 身体/背景保留 | 非脸部区域与底图一致 |
| 显存峰值 | 8GB 内完成推理，不 OOM |

**交付物**：`p0_faceswap.json` · 底图/换脸结果对比截图（≥3组）· `p0_c.nodes.json`

---

### P0-D — DWPose 骨骼提取 + ControlNet 姿势控制

**验证目标**：给定姿势参考图，能提取骨骼数据并控制生成图像的姿势匹配度。

最小工作流节点：`LoadImage（姿势参考）→ DWPose Estimator → ModelPatchLoader（ControlNet Union）→ UNETLoader（Z-Image）→ CLIPTextEncode → QwenImageDiffsynthControlnet → KSampler → VAEDecode → SaveImage`

| 验证点 | 通过标准 |
|---|---|
| 骨骼提取 | 关键点准确，主要部位无遗漏 |
| 骨骼图保存 | 输出为 PNG 格式骨骼可视化图 |
| 姿势控制生效 | 生成图姿势与参考图匹配度 ≥ 80% |
| ControlNet 强度调节 | strength 参数可调，0.5~0.9 效果有梯度变化 |

**交付物**：`p0_pose.json` · 参考图/骨骼图/生成图三联截图 · `p0_d.nodes.json`

---

### Phase 0 验收汇总

| 模块 | 工作流 | 核心验收标准 | 状态 |
|---|---|---|---|
| P0-A Z-Image 生成 | p0_turbo.json / p0_base.json | Turbo/Base 正常出图，不 OOM | ✅ 已验证 |
| P0-B 人脸预处理 | p0_preprocess.json | 裁脸去背干净，尺寸正确 | ✅ 已验证 |
| P0-C 换脸 | p0_faceswap.json | 相似度 ≥ 8/10，显存不 OOM | ✅ 已验证 |
| P0-D 姿势控制 | p0_pose.json | 姿势匹配度 ≥ 80% | ✅ 已验证 |

**Phase 0 全部通过，已启动 Phase 1 开发。**

### P0-E — 补充验证（ZIB模型 / 解剖LoRA / 放大方案）

> **状态：待验证（先于Phase 1编码）**

#### P0-E-1：ZIB备选底模对比

| 对比项 | 当前方案 | ZIB方案 |
|---|---|---|
| 模型 | z_image_bf16.safetensors | z_image/ZIB-moodyWildMix_v01.safetensors |
| VAE | zImageClearVae_clear.safetensors | ae.safetensors |
| LoRA | 无 | Zimage/ZiB-female解剖学_anatomy.safetensors (strength=0.7) |
| 步数/CFG | 30/3.5 | 10/1.0 |

#### P0-E-2：解剖LoRA兼容性（z_image_bf16）

用当前Base + 解剖LoRA（strength 0.5/0.7/1.0），确认是否报错，选定最优强度默认值。

#### P0-E-3：UltimateSDUpscale验证

参数：upscale_by=2，steps=6，cfg=1，euler，simple，denoise=0.3，Linear模式，tile 1024×1024，seam_fix=None
验证目标：8GB内不OOM，输出质量合格。

### Python 调用验证脚本

每个工作流验证完成后，用以下最小脚本确认可通过 API 触发（为 Phase 1 M3 做准备）：

```python
# p0_verify.py — 最小 ComfyUI API 调用验证
import json, urllib.request, urllib.parse, time

COMFYUI_URL = "http://127.0.0.1:8188"

def submit_workflow(workflow_path: str) -> str:
    with open(workflow_path) as f:
        workflow = json.load(f)
    data = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(f"{COMFYUI_URL}/prompt", data=data,
                                  headers={"Content-Type": "application/json"})
    resp = json.loads(urllib.request.urlopen(req).read())
    return resp["prompt_id"]

def wait_done(prompt_id: str, timeout: int = 600) -> bool:
    for _ in range(timeout):
        resp = json.loads(urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}").read())
        if prompt_id in resp:
            return True
        time.sleep(1)
    return False

if __name__ == "__main__":
    import sys
    wf = sys.argv[1]  # 传入工作流 JSON 路径
    pid = submit_workflow(wf)
    print(f"提交成功 prompt_id={pid}，等待完成...")
    ok = wait_done(pid)
    print("完成" if ok else "超时")
```

用法：`python p0_verify.py workflows/p0_turbo.json`

---

## 技术栈概览

| 层级 | 技术选型 |
|---|---|
| 图像生成 | ComfyUI + Z-Image Turbo / Base (bf16 safetensors，目标 GGUF Q4~Q5) |
| 人物一致性 / 换脸 | Qwen-Image-Edit GGUF + Kontext 多图参考（TextEncodeQwenImageEditPlus + FluxKontextMultiReferenceLatentMethod） |
| 姿势控制 | DWPose + ControlNet Union |
| 高清放大 | Phase 2（Tile 分块精修） |
| 后端框架 | FastAPI + SQLAlchemy + SQLite |
| 前端框架 | Vue 3 + Vite + TypeScript + Naive UI |
| 状态管理 | Pinia |
| 实时推送 | SSE（Server-Sent Events） |
| HTTP 客户端 | axios |

---

## 模块清单

### M1 — 环境与基础设施

**ComfyUI 环境**

- ComfyUI 安装与启动配置（`--lowvram` 8GB 模式）
- Z-Image Turbo / Base bf16 模型加载验证
- Qwen-Image-Edit GGUF 模型加载验证（含 mmproj-BF16.gguf 同目录依赖）
- 插件安装：ComfyUI-GGUF（UnetLoaderGGUF / CLIPLoaderGGUF）、comfyui-easy-use（easy imageRemBg / easy cleanGpuUsed）、DWPose（comfyui_controlnet_aux）、ControlNet Union（ModelPatchLoader）
- 显存释放验证：确认 `/free` 接口可正常清理各阶段模型缓存

**工作流模板**

- `generate.json`：Z-Image 文生图（含解剖LoRA），UNETLoader → LoraLoaderModelOnly → ModelSamplingAuraFlow → KSampler
- `generate_pose.json`：Z-Image + ControlNet（直接LoadImage已提取的skeleton PNG，无DWPreprocessor）
- `faceswap.json`：Qwen-Image-Edit Kontext换脸（LoadImage face_crop_nobg直接作image2，无需内嵌rembg）
- `preprocess.json`：参考图Inspyrenet去背景，LoadImage → easy imageRemBg(white) → SaveImage
- `dwpose.json`：DWPose骨骼提取（仅提取，LoadImage → DWPreprocessor → SaveImage）
- `upscale.json`：UltimateSDUpscale放大（4x-UltraSharp，2x upscale）
- `inpaint_flux.json`：局部重绘Flux2-Klein
- `inpaint_sdxl.json`：局部重绘SDXL-写实
- `inpaint_klein.json`：Klein高分重绘
- 各工作流节点 ID 映射文件（`*.nodes.json`）

---

### M2 — 后端基础框架

**项目骨架**

- FastAPI 项目初始化，目录结构搭建
- SQLite + SQLAlchemy 数据库初始化与迁移
- 统一响应格式、异常处理、日志

**媒体文件管理**

- 上传接口（参考图、骨骼图）
- `/media/` 静态文件路由
- 文件命名规范与存储目录结构

---

### M3 — ComfyUI 客户端层

- `ComfyUIClient`：`submit` / `watch_progress` / `get_image` / `free_cache` / `upload_image` 封装
- `WorkflowBuilder`：模板加载 + 参数注入（prompt / face_reference / pose / seed）；图片类参数先调用 `upload_image` 上传至 ComfyUI `input/` 目录，再将返回的文件名注入对应节点的 `inputs.image` 字段
- **Prompt 组装规范**：正向 Prompt 使用中文段落式自然语言；负向条件固定置空（空字符串传入负向编码器节点），不接受用户输入负向 Prompt；Qwen-Image-Edit 编辑指令同样使用中文自然语言
- Turbo / Base 模式切换逻辑（步数、CFG、采样器、Shift 自动适配）
- **串行任务调度**：生成 → 释放缓存 → 换脸 → 释放缓存 → 放大 → 释放缓存，三阶段顺序执行
- 任务状态管理：

```
task_store[task_id] = {
    stage: "generating" | "faceswapping" | "upscaling" | "done" | "error",
    progress: 0-100,
    image_url: str | None,
    error: str | None
}
```

- 生成图片拉取并保存至 media 目录

**Turbo / Base 参数对照**

| 参数 | Turbo | Base |
|---|---|---|
| 模型 | z_image_turbo_bf16.safetensors | z_image_bf16.safetensors |
| 步数 | 8 | 30 |
| CFG | 1.0 | 3.5 |
| 采样器 | res_multistep | res_multistep |
| 调度器 | simple | sgm_uniform |

---

### M4 — 人物库模块

**后端**

- 数据模型：`Character` 表（name / reference_photos / face_crop_nobg / appearance_desc 等）
- 入库预处理流水线：上传参考图 → Inspyrenet 去背景（add_background=white）→ 保存 face_crop_nobg
- CRUD 接口：增删改查 + 参考图上传

**前端**

- `/characters` 列表页（卡片展示 + 搜索）
- `/characters/:id` 详情 / 编辑页（参考图管理、去背景预览、外貌描述编辑）
- 新建人物表单（含多图上传，上传后展示预处理结果）

---

### M5 — 动作库模块

**后端**

- 数据模型：`Action` 表（name / reference_image / skeleton_data / tags / camera_suggestion）
  - `skeleton_data`：DWPose 提取的骨骼可视化图，PNG 格式文件路径
- DWPose 集成：上传参考图后自动提取骨骼图（PNG）并保存
- CRUD 接口：增删改查 + 标签管理

**前端**

- `/actions` 列表页（卡片 + 标签筛选）
- 新建 / 编辑动作表单（参考图上传、骨骼图预览、标签打标）

---

### M6 — 图像生成模块

**后端**

- 生成任务接口 `POST /api/generate`（接收人物 ID、动作 ID、Prompt、模型选择、是否换脸、是否放大）
- SSE 进度推送 `GET /api/generate/{task_id}/progress`（推送阶段 + 百分比）
- Prompt 组装逻辑（Phase 1 手动拼接：人物外貌描述 + 用户输入）
- 三阶段串行任务调度：
  - 阶段1：生成（generating）→ save → free_cache
  - 阶段2：换脸（faceswapping，可选）→ save → free_cache
  - 阶段3：放大（upscaling，可选）→ save → free_cache
  - 写Image记录 → done

**前端 `/generate` 生成主页**

- 人物选择器（从人物库选）
- 动作选择器（从动作库选）
- 正向 Prompt 输入框（中文段落式，附简短说明提示）
- Turbo / Base 模式切换组件（`ModelSwitch.vue`）
- 换脸开关（默认开启）
- 放大开关（可选）
- 生成按钮 + SSE 实时进度条（`ProgressBar.vue`，显示当前阶段：生成中 / 换脸中 / 放大中）
- 生成结果多图预览

---

### M7 — 重绘模块

**后端**

- 重绘任务接口 `POST /api/inpaint`（接收图片 ID、遮罩数据、重绘模式、Prompt）
- 支持三种模式：`inpaint_flux`（Flux2-Klein）、`inpaint_sdxl`（SDXL写实）、`inpaint_klein`（Klein高分重绘）
- SSE 进度推送 `GET /api/inpaint/{task_id}/progress`
- 重绘完成后保存至 media/generated，更新 Image 记录

**前端 `/inpaint` 重绘页**

- Canvas 遮罩绘制界面（笔刷大小调节、撤销）
- Tab 切换：NSW修复 / Klein高分重绘
- NSW修复 Tab：Flux2-Klein / SDXL 子模式切换，Prompt 补充输入框
- Klein高分重绘 Tab：编辑指令输入框
- SSE 实时进度条
- 重绘结果预览与对比（原图 / 重绘结果并排）

---

### M8 — Gallery 模块

**后端**

- 数据模型：`Image` 表（filepath / character_id / action_id / prompt / model / faceswapped / rating / created_at）
- 查询接口：分页 + 按人物 / 动作 / 评分筛选
- 评分接口 `PATCH /api/images/:id/rating`

**前端 `/gallery` 图片浏览页**

- Grid 瀑布流图片浏览
- 筛选栏（人物、动作、模型、评分）
- 图片卡片组件（`ImageCard.vue`）：缩略图 + 评分 + 快捷操作
- 图片详情弹窗：大图 + 完整生成参数展示

---

## 模块依赖关系

```
M1 环境基础
    ↓
M2 后端框架 ──── M3 ComfyUI 客户端
    ↓                    ↓
M4 人物库           M6 生成模块（含换脸+放大子任务）←── M5 动作库
M5 动作库                ↓
                    M7 重绘模块（依赖M6生成图）
                    M8 Gallery
```

**关键路径：M1 → M2 → M3 → M6**，M7重绘 requires M6完成，其余模块可并行推进。

---

## 开发计划

### 第 1 周 — 基础打通

| 天 | 任务 |
|---|---|
| Day 1-2 | M1：ComfyUI 环境搭建，插件安装，Z-Image / Qwen-Image-Edit GGUF 模型验证，手动跑通一次完整生成 + 换脸 |
| Day 3 | M1：工作流模板制作（generate / generate_pose / faceswap / preprocess / dwpose / upscale / inpaint_flux / inpaint_sdxl / inpaint_klein），节点 ID 映射 |
| Day 4 | M2：FastAPI 项目骨架，数据库初始化，文件上传与静态路由 |
| Day 5 | M3：ComfyUIClient（含 free_cache）+ WorkflowBuilder，联调 Turbo/Base 切换，串行任务调度验证 |

**第 1 周交付标准**：通过后端接口可触发 ComfyUI 生成 + 换脸完整链路，SSE 能推送阶段进度，图片落库；显存串行释放验证通过。

---

### 第 2 周 — 数据库模块

| 天 | 任务 |
|---|---|
| Day 6-7 | M4 后端：Character 数据模型，入库预处理流水线（去背景 → face_crop_nobg），CRUD 接口 |
| Day 8 | M4 前端：人物列表页、详情页（含去背景预览）、新建表单 |
| Day 9 | M5 后端：Action 数据模型，DWPose 集成（存 PNG），CRUD 接口 + 标签管理 |
| Day 10 | M5 前端：动作列表页、标签筛选、新建表单 |

**第 2 周交付标准**：人物库和动作库可正常增删改查，参考图上传后自动完成去背景预处理并展示结果。

---

### 第 3 周 — 核心生成链路

| 天 | 任务 |
|---|---|
| Day 11-12 | M6 后端：生成接口，Prompt 组装，换脸+放大子任务串行调度，SSE 三阶段进度推送 |
| Day 13-14 | M6 前端：生成主页（人物/动作选择、Prompt 输入、换脸开关、放大开关、模型切换、三阶段进度条、结果预览） |
| Day 15 | M8 后端：Image 表，分页查询，评分接口；Gallery 前端骨架 |

**第 3 周交付标准**：端到端可选人物、动作，触发生成 + 换脸 + 放大，实时看三阶段进度，结果图片落库可浏览。

---

### 第 4 周 — Gallery、重绘与联调

| 天 | 任务 |
|---|---|
| Day 16 | M8 前端：Gallery 页完善（瀑布流、筛选栏、图片卡片、详情弹窗） |
| Day 17-18 | M7：重绘模块后端接口 + 前端 Canvas 遮罩界面（三种模式） |
| Day 19 | 全链路联调，Bug 修复 |
| Day 20 | Phase 1 验收 |

**第 4 周交付标准**：完整走通「选人物 → 生成 + 换脸 + 放大 → Gallery 浏览评分 → 局部重绘」全流程。

---

## Phase 1 验收标准（Done 定义）

| 模块 | 验收标准 |
|---|---|
| 人物库 | 上传参考图后自动完成去背景，face_crop_nobg 可正常用于 Kontext 换脸 |
| 换脸 | Qwen-Image-Edit GGUF Kontext 换脸人脸主观相似度 ≥ 8/10，边缘融合自然 |
| 动作库 | 生成图像姿势与参考匹配度 ≥ 80%，骨骼图以 PNG 保存 |
| 双模型切换 | Turbo / Base 一键切换，参数自动适配，无需手动修改 |
| 串行显存 | 生成→换脸→放大三阶段串行执行，8GB 内不 OOM |
| 局部重绘 | 三种重绘模式可用，遮罩绘制界面正常，重绘结果边缘自然 |
| Web 界面 | 人物库、动作库、Gallery 增删改查全部可用 |

---

## 目录结构参考

```
project/
├── backend/
│   ├── main.py
│   ├── routers/
│   │   ├── characters.py
│   │   ├── actions.py
│   │   ├── generate.py       # 含换脸+放大子任务调度
│   │   ├── inpaint.py        # 重绘模块
│   │   └── gallery.py
│   ├── models/               # SQLAlchemy 模型
│   ├── comfyui/
│   │   ├── client.py         # ComfyUIClient（含 free_cache）
│   │   ├── workflow.py       # WorkflowBuilder
│   │   └── workflows/        # generate.json / generate_pose.json / faceswap.json
│   │       │                 # preprocess.json / dwpose.json / upscale.json
│   │       │                 # inpaint_flux.json / inpaint_sdxl.json / inpaint_klein.json
│   │       └── *.nodes.json  # 各工作流节点 ID 映射
│   └── media/
│       ├── uploads/          # 原始参考图
│       ├── processed/        # face_crop_nobg
│       └── generated/        # 生成图
└── frontend/
    ├── src/
    │   ├── views/
    │   │   ├── Characters/
    │   │   ├── Actions/
    │   │   ├── Generate/
    │   │   ├── Inpaint/
    │   │   └── Gallery/
    │   ├── components/
    │   │   ├── ImageCard.vue
    │   │   ├── TagSelector.vue
    │   │   ├── ModelSwitch.vue
    │   │   ├── FaceSwapToggle.vue
    │   │   └── ProgressBar.vue    # 三阶段显示：生成中 / 换脸中 / 放大中
    │   ├── stores/
    │   │   ├── character.ts
    │   │   ├── action.ts
    │   │   └── generate.ts        # 含 SSE 逻辑 + 阶段状态（generating/faceswapping/upscaling/done）
    │   └── api/
    │       ├── http.ts
    │       ├── character.ts
    │       ├── action.ts
    │       ├── generate.ts
    │       └── inpaint.ts
    └── vite.config.ts             # 开发代理 /api → localhost:8000
```

---

*Phase 1 v1.6 · 对应需求文档 V0.9*
