# CLAUDE.md

## 已安装 Skills

| Skill | 触发场景 |
|---|---|
| `python-testing-patterns` | 编写 pytest / async 测试、mock、fixture |
| `sqlalchemy-orm` | ORM 模型定义、Alembic 迁移、关联查询 |
| `pydantic` | FastAPI schema、数据校验、序列化 |
| `vuejs-typescript-best-practices` | Vue 3 组件、Pinia store、TypeScript、Vite |
| `simplify` | 代码审查、重构、消除重复 |
| `find-skills` | 搜索并安装新 skill |

## 项目概述

Motif — 本地部署 AI 图像生成管理系统。ComfyUI + Z-Image 双模型，8GB 显存。核心能力：Qwen-Image-Edit GGUF Kontext 换脸、DWPose 姿势控制、UltimateSDUpscale 高清放大、Flux2-Klein 局部重绘，配套 Vue 3 Web 界面。详细需求见 `doc/requirements_v1.0.md`。

## 常用命令

```bash
# 后端（backend/venv 由 ComfyUI Python 3.11.9 创建，与 ComfyUI 完全隔离）
cd backend
venv\Scripts\uvicorn.exe main:app --reload --port 8000
venv\Scripts\alembic.exe upgrade head
venv\Scripts\alembic.exe revision --autogenerate -m "描述"
venv\Scripts\pytest.exe

# 前端
cd frontend
npm run dev      # 端口 5173，/api 代理到 localhost:8000
npm run build

# ComfyUI
"D:/ai/ComfyUI-aki-v1.6/python/python.exe" "D:/ai/ComfyUI-aki-v1.6/ComfyUI/main.py" --port 8188 --lowvram
```

## 架构概览

```
backend/
├── main.py                  # FastAPI 入口
├── routers/
│   ├── characters.py        # 人物库 CRUD + 参考图上传 + 去背景预处理
│   ├── actions.py           # 动作库 CRUD + DWPose 骨骼提取
│   ├── generate.py          # 生成任务 + 换脸/放大子任务 + SSE 进度
│   ├── inpaint.py           # 局部重绘任务 + SSE 进度
│   └── gallery.py           # 图片浏览 + 评分
├── models/                  # Character / Action / Image ORM
├── comfyui/
│   ├── client.py            # ComfyUIClient：submit / watch_progress / get_image / free_cache / upload_image
│   ├── workflow.py          # WorkflowBuilder：JSON 模板 + nodes.json 参数注入
│   └── workflows/           # generate / generate_pose / faceswap / preprocess / dwpose
│       └── *.nodes.json     # upscale / inpaint_flux / inpaint_sdxl / inpaint_klein
└── media/
    ├── uploads/             # 原始参考图
    ├── processed/           # face_crop_nobg
    └── generated/           # 生成图

frontend/src/
├── views/                   # Generate / Characters / Actions / Gallery / Inpaint
├── stores/                  # character / action / generate（含 SSE + 阶段状态）
└── api/                     # http.ts + 各模块接口
```

**关键设计**

| 参数 | Turbo | Base（ZIB） |
|---|---|---|
| UNET | z_image_turbo_bf16.safetensors | z_image/ZIB-moodyWildMix_v01.safetensors |
| VAE | zImageClearVae_clear.safetensors | ae.safetensors |
| 步数 | 8 | 10 |
| CFG | 1.0 | 1.0 |
| 采样器 | res_multistep | res_multistep |
| 调度器 | simple | simple |

- **串行显存**：生成 → `/free` → 换脸（可选）→ `/free` → 放大（可选）→ `/free`
- **任务阶段**：`generating / faceswapping / upscaling / done / error`
- **SSE 进度**：`GET /api/generate/{task_id}/progress`，前端 EventSource 连接
- **媒体文件**：统一存 `backend/media/`，由 `/media/` 静态路由暴露，URL 格式 `/media/<子目录>/<文件名>`
- **WorkflowBuilder**：通过 `*.nodes.json` 映射 node_id/key 注入参数，图片参数先调用 `upload_image` 上传至 ComfyUI `input/`

## Prompt 规范

Z-Image / Qwen-Image-Edit 使用 Qwen 文本编码器，**不**使用传统 CLIP：
- 中文段落式自然语言，不堆叠关键词
- **无需负向 Prompt**，负向条件固定传空字符串
- 示例：`"一位年轻女性坐在咖啡馆窗边，阳光从左侧斜射，半身构图，自然真实的摄影风格"`
- 换脸指令：`"将图中人物面部替换为参考图中的人脸，保持身体姿势、服装和背景完全不变，边缘自然融合"`

## 数据模型要点

- **Character**：`reference_photos`（filepath[]）、`face_crop_nobg`（Inspyrenet 去白底，Kontext 换脸的 image2）、`appearance_desc`
- **Action**：`skeleton_data`（DWPose 输出的 PNG 骨骼图）、`camera_suggestion`
- **Image**：`filepath / is_native / album_id / character_id / action_id / prompt / model / seed / faceswapped / upscaled / inpainted / rating`

## Phase 规划

- **Phase 0 ✅**：Z-Image 生成、裁脸去背景、Qwen-Image-Edit 换脸、DWPose 姿势控制
- **Phase 1（当前）**：人物库、动作库、双模型生成 + 换脸 + 高清放大 + 局部重绘（Flux2-Klein/SDXL/Klein 三模式）、Web 界面
  - 局部重绘入口：Gallery 详情弹窗 →「局部重绘」按钮 → 独立重绘页
  - 重绘使用 Flux2-Klein（不使用 Wan 14B）
- **Phase 2**：图集管理（文件夹导入/套图图集）、原生图支持、评分阈值筛选、环境库、着装库、套图批量生成
- **Phase 3**：声音模型（GPT-SoVITS/CosyVoice2）、视频接口

## ComfyUI 环境

**路径**：`D:\ai\ComfyUI-aki-v1.6`　**Python**：`D:\ai\ComfyUI-aki-v1.6\python\python.exe`

**模型文件**（`ComfyUI\models\` 下）：

| 用途 | 路径 |
|---|---|
| Z-Image Base（ZIB） | `diffusion_models/z_image/ZIB-moodyWildMix_v01.safetensors` |
| Z-Image Base VAE | `vae/ae.safetensors` |
| Z-Image Turbo | `diffusion_models/z_image_turbo_bf16.safetensors` |
| Z-Image Turbo VAE | `vae/zImageClearVae_clear.safetensors` |
| 解剖 LoRA | `loras/Zimage/ZiB-female解剖学_anatomy.safetensors`（strength=0.7） |
| Text Encoder | `text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` |
| ControlNet Union | `model_patches/Z-Image-Fun-Controlnet-Union-2.1.safetensors` |
| Qwen-Image-Edit UNET | `diffusion_models/Qwen/Qwen-Rapid-AIO-NSFW-v19_Q6_K.gguf` |
| Qwen-Image-Edit CLIP | `text_encoders/Qwen2.5-VL-7B-Instruct-Q3_K_S.gguf`（需同目录有 `mmproj-BF16.gguf`） |
| Qwen-Image-Edit VAE | `vae/qwen_image_vae.safetensors` |
| 局部重绘 inpaint 模型 | ⚠️ 文件名待确认（Flux2-Klein 方案，非 Wan 14B） |

**必装插件**：ComfyUI-GGUF、comfyui-easy-use、InsightFace、Inspyrenet、comfyui_controlnet_aux（DWPose）、ControlNet Union、Inpaint 系列

**关键 Gotcha**：
- ControlNet Union 用 `ModelPatchLoader`（不是 `ControlNetLoader`），接 `QwenImageDiffsynthControlnet`
- GGUF CLIP 需 `mmproj-BF16.gguf` 在同目录，工作流不选但自动加载
- `easy imageRemBg` 必须 `add_background=white`，否则 RGBA 4通道触发 VL 编码器维度错误
- 换脸用 GGUF Q4~Q6 + `qwen_image_vae.safetensors`，**不**用 fp8 safetensors + `ae.safetensors`（8GB OOM）
- LoadImage API 调用须先 `upload_image` 上传到 ComfyUI `input/`，手动测试直接放 `input/` 目录

## P0-E 验证结论

| 项目 | 结论 |
|---|---|
| P0-E-1 底模选择 | ✅ **ZIB-moodyWildMix_v01**（放弃 z_image_bf16） |
| P0-E-2 解剖 LoRA | ✅ **ZiB-female解剖学_anatomy.safetensors，strength=0.7** |
| P0-E-3 UltimateSDUpscale | ⚠️ 待手动验证（8GB OOM 测试，steps=6，denoise=0.3） |

**Base 模型参数（已确定）**：

| 参数 | 值 |
|---|---|
| UNET | `diffusion_models/z_image/ZIB-moodyWildMix_v01.safetensors` |
| VAE | `vae/ae.safetensors` |
| LoRA | `loras/Zimage/ZiB-female解剖学_anatomy.safetensors`，strength=0.7 |
| steps / CFG | 10 / 1.0 |
| scheduler | simple |

## 参考文档

详细需求、分期规划、工作流设计见 `doc/` 文件夹（当前版本：requirements_v1.0.md、phase1_plan_v1.6.md）。
