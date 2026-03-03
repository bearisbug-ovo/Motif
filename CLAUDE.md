# CLAUDE.md

## 已安装 Skills

| Skill | 触发场景 |
|---|---|
| `python-testing-patterns` | 编写 pytest / async 测试、mock、fixture |
| `sqlalchemy-orm` | ORM 模型定义、Alembic 迁移、关联查询 |
| `pydantic` | FastAPI schema、数据校验、序列化 |
| `simplify` | 代码审查、重构、消除重复 |
| `find-skills` | 搜索并安装新 skill |

## 项目概述

Motif — 本地图片/视频浏览、管理、AI 修复与联想生成工具。以 ComfyUI 为 AI 后端，React PWA 前端，支持局域网多设备访问。核心：以人物为核心的媒体管理体系、不复制文件（路径引用）、任务严格串行队列。详细需求见 `doc/prd.md`。

## 常用命令

```bash
# 后端（backend/venv 由 ComfyUI Python 3.11.9 创建，与 ComfyUI 完全隔离）
cd backend
venv\Scripts\uvicorn.exe main:app --reload --host 0.0.0.0 --port 8000
venv\Scripts\alembic.exe upgrade head
venv\Scripts\alembic.exe revision --autogenerate -m "描述"
venv\Scripts\pytest.exe

# 前端（React + Vite）
cd frontend
npm run dev      # 端口 5173，/api 代理到 localhost:8000
npm run build

# ComfyUI
"D:/ai/ComfyUI-aki-v1.6/python/python.exe" "D:/ai/ComfyUI-aki-v1.6/ComfyUI/main.py" --port 8188 --lowvram
```

## 架构概览

```
backend/
├── main.py                  # FastAPI 入口，绑定 0.0.0.0:8000
├── routers/
│   ├── persons.py           # 人物 CRUD
│   ├── albums.py            # 图集 CRUD
│   ├── media.py             # 媒体 CRUD + 导入 + 评分 + 软删除
│   ├── tasks.py             # 任务队列 CRUD + 执行控制
│   ├── workspace.py         # 工作区
│   ├── recycle_bin.py       # 回收站
│   ├── system.py            # 系统配置 + ComfyUI 状态
│   └── poses.py             # 动作资产 [P2]
├── models/                  # ORM 模型（见数据模型节）
├── comfyui/
│   ├── client.py            # ComfyUIClient（可复用旧实现）
│   ├── workflow.py          # WorkflowBuilder（可复用旧实现）
│   └── workflows/           # *.json 工作流模板（运行时从 AppData/workflows/ 加载）
├── queue_runner.py          # 后台串行任务队列调度线程
└── config.py                # AppData 路径、全局设置管理

frontend/src/
├── pages/                   # MediaLibrary / PersonHome / AlbumDetail / LightBox
│                            # TaskQueue / Workspace / RecycleBin / Settings / Tools
├── components/              # MediaCard / MaskEditor / BottomDrawer / ContextMenu / ...
├── stores/                  # person / album / media / task / workspace / system
└── api/                     # http.ts + 各模块接口

AppData/（路径可配置，默认 backend/appdata/）
├── db/main.sqlite
├── cache/thumbnails/
├── imports/clipboard/
├── generated/upscale|inpaint|face_swap|portrait|screenshot/
├── poses/
├── workflows/
└── downloads/xiaohongshu|bilibili|twitter|telegram|web/
```

**关键设计**

- **不复制文件**：本地图只存绝对路径引用，AppData 内生成图/截图除外
- **SQLite WAL 模式**：支持多设备并发读取
- **任务严格串行**：FastAPI 后台线程维护队列，一次只向 ComfyUI 提交一个任务
- **ComfyUI 集成**：`/prompt` 提交，`/history` 轮询（2秒间隔），工作流模板占位符格式 `{{param_name}}`
- **默认高清放大**：所有 AI 功能完成后自动串联放大；放大失败时保留原图，标记 `upscale_status=failed`
- **软删除**：本地图只删记录，生成图/截图软删后回收站永久删除时删物理文件

## 数据模型要点

| 表 | 关键字段 |
|---|---|
| Person | id(UUID), name, cover_media_id, avg_rating, rated_count |
| Album | id, person_id?, name, cover_media_id, is_generated_album, source_face_media_id |
| Media | id, album_id?, person_id?, file_path, media_type(image/video), source_type(local/generated/screenshot), parent_media_id?, workflow_type?, generation_params(JSON), upscale_status, rating, is_deleted |
| Task | id, workflow_type, params(JSON), status(pending/running/completed/failed), queue_order, execution_mode(immediate/queued), result_media_ids(JSON) |
| QueueConfig | start_mode(manual/auto/cron/delay), cron_expression?, delay_minutes? |
| PoseAsset | id, name, tags(JSON), pose_image_path `[P2]` |
| WorkspaceItem | id, media_id(FK), sort_order（上限100条，持久化） |

**约束**：Media.person_id 当 album_id 不为空时必须等于 Album.person_id；生成链 parent_media_id 递归深度上限 10 层

## Phase 规划

- **P0 — 基础浏览与管理**：媒体库浏览（人物/图集/大图）、导入流程、评分/筛选/排序、回收站、设置页、ComfyUI 连接管理、启动脚本
- **P1 — 核心 AI 功能**：高清放大、换脸（单张+批量）、局部修复（带提示词+自动反推）、任务队列（4种启动模式）、工作区
- **P2 — 高级 AI 功能**：图生图（含提示词反推+润色）、写真生成、动作库（DWPose 管理+动作组）
- **P3 — 扩展工具**：网页图片抓取器（小红书/B站/Twitter/Telegram/通用网页）、平台账号管理

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

**必装插件**：ComfyUI-GGUF、comfyui-easy-use、InsightFace、Inspyrenet、comfyui_controlnet_aux（DWPose）、ControlNet Union

**关键 Gotcha**：
- ControlNet Union 用 `ModelPatchLoader`（不是 `ControlNetLoader`），接 `QwenImageDiffsynthControlnet`
- GGUF CLIP 需 `mmproj-BF16.gguf` 在同目录，工作流不选但自动加载
- `easy imageRemBg` 必须 `add_background=white`，否则 RGBA 4通道触发 VL 编码器维度错误
- 换脸用 GGUF Q4~Q6 + `qwen_image_vae.safetensors`，**不**用 fp8 safetensors + `ae.safetensors`（8GB OOM）
- LoadImage API 调用须先 `upload_image` 上传到 ComfyUI `input/`，手动测试直接放 `input/` 目录

## 换脸工作流规范（已验证）

- 模型：`Qwen-Rapid-AIO-NSFW-v19_Q6_K.gguf` + `qwen_image_vae.safetensors`
- CLIP：`CLIPLoaderGGUF` with `Qwen2.5-VL-7B-Instruct-Q3_K_S.gguf` type=qwen_image
- 架构：Kontext（TextEncodeQwenImageEditPlus + FluxKontextMultiReferenceLatentMethod）
- 参数：steps=4, cfg=1, euler, simple, denoise=1.0, shift=3.1
- 底图 → ImageScaleToTotalPixels(1MP) → VAEEncode → KSampler.latent
- 人脸参考 → easy imageRemBg(white) → TextEncodeQwenImageEditPlus.image2
- Prompt：`"将图中人物面部替换为参考图中的人脸，保持身体姿势、服装和背景完全不变，边缘自然融合"`

## 项目文档

| 文档 | 路径 | 说明 |
|---|---|---|
| 产品需求文档 | `doc/prd.md` | 完整功能定义、UI 规格、数据模型、API 约定（P0-P3 全量） |
| PRD 审查报告 | `doc/prd_review.md` | PRD 与实际实现的差异分析、命名不一致、未实现功能清单、修订建议 |
| 开发指南 | `doc/development_guide.md` | 环境搭建、架构详解、全量 API 参考（~45 端点）、数据模型、任务队列、前端状态管理 |
| 测试计划 | `doc/test_plan.md` | 127 个 Puppeteer E2E 测试用例，按 PRD 章节组织，含需求追溯矩阵 |
| 图生图/写真 Spec | `doc/img2img_portrait_spec.md` | P2 图生图 & 写真生成方案验证草稿（ComfyUI 工作流 + 提示词策略） |

**命名规范**：`doc/` 下统一 `snake_case.md`，不加项目前缀，不加版本号。版本信息写在文档内部 header 中，历史由 Git 管理。
