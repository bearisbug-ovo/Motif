# CLAUDE.md

## 工作规范

- **文档同步更新**：修改功能行为时，必须同步更新相关文档（`doc/prd.md`、`doc/development_guide.md`、`doc/test_plan.md`），保持需求、开发指南、测试用例与代码一致
- **doc/ 命名规范**：统一 `snake_case.md`，不加项目前缀和版本号，版本信息写在文档内部 header，历史由 Git 管理
- **E2E 测试截图审查**：所有前端 E2E 测试必须在关键视觉断言点调用 `screenshot()`（定义在 `frontend/tests/e2e/helpers.ts`，输出到 `frontend/tests/screenshots/{name}.png`）。测试通过判定 = **程序断言通过 + Claude 视觉审查截图确认正确**。运行测试后必须用 Read 工具逐张查看所有截图，验证页面布局、数据渲染、无错误状态

## 页面层级术语

| 术语 | 对应页面 | 路由 |
|------|----------|------|
| **人物库** | 首页，人物卡片列表 | `/` |
| **人物主页** | 某人物的详情页 | `/persons/:id` |
| **人物主页 · 图集区** | PersonHome 的图集列表部分 | — |
| **人物主页 · 散图区** | PersonHome 的散图列表部分 | — |
| **图集详情** | 某图集的媒体列表页 | `/albums/:id` |
| **任务队列** | 任务管理页 | `/tasks` |
| **工作区** | 工作区页 | `/workspace` |
| **回收站** | 回收站页 | `/recycle-bin` |
| **小工具** | 网页抓取器等工具页 | `/tools` |
| **设置** | 设置页 | `/settings` |
| **大图浏览 / LightBox** | 浮层大图查看器 | — |
| **筛选栏** | FilterBar 组件 | — |
| **侧边栏** | Sidebar 导航 | — |

## 已安装 Skills

| Skill | 触发场景 |
|---|---|
| `python-testing-patterns` | 编写 pytest / async 测试、mock、fixture |
| `sqlalchemy-orm` | ORM 模型定义、Alembic 迁移、关联查询 |
| `pydantic` | FastAPI schema、数据校验、序列化 |
| `simplify` | 代码审查、重构、消除重复 |
| `find-skills` | 搜索并安装新 skill |
| `vercel-react-best-practices` | React 组件设计、性能优化、最佳实践 |
| `ui-design-system` | UI 设计系统规范、布局一致性、组件设计 |

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
npm run build    # 生产构建，后端自动 serve dist/，统一通过 :8000 访问
npm run dev      # 开发模式（热重载），端口 5173，/api 代理到 localhost:8000

# E2E 测试（需先启动 backend:8000，jest-puppeteer 自动启动 frontend:5173）
cd frontend
npx jest --config jest.config.ts --runInBand --verbose

# ComfyUI
"D:/ai/ComfyUI-aki-v1.6/python/python.exe" "D:/ai/ComfyUI-aki-v1.6/ComfyUI/main.py" --port 8188 --lowvram
```

## 架构概览

```
backend/
├── main.py                  # FastAPI 入口 + 文件选择器 API
├── routers/
│   ├── persons.py           # 人物 CRUD
│   ├── albums.py            # 图集 CRUD
│   ├── media.py             # 媒体 CRUD + 导入 + 评分 + 软删除
│   ├── tasks.py             # 任务队列 CRUD + 执行控制
│   ├── workspace.py         # 工作区
│   ├── recycle_bin.py       # 回收站
│   ├── downloads.py         # 网页抓取下载 + 平台账号
│   └── system.py            # 系统配置 + ComfyUI 状态
├── models/                  # ORM：person / album / media / task / workspace / platform_account / download_record
├── scrapers/                # 网页抓取器（base + xiaohongshu）
├── comfyui/
│   ├── client.py            # ComfyUIClient
│   ├── workflow.py          # WorkflowBuilder
│   └── workflows/           # *.json 工作流模板
├── queue_runner.py          # 后台串行任务队列调度线程
└── config.py                # AppData 路径、全局设置管理

frontend/src/
├── pages/                   # MediaLibrary / PersonHome / AlbumDetail
│                            # TaskQueue / Workspace / RecycleBin / Settings / Tools
├── components/              # LightBox / ImportDialog / MediaCard / MaskEditor / ...
├── stores/                  # person / album / media / task / workspace / system / download
└── api/                     # http.ts + 各模块接口（含 downloads.ts）

AppData/（路径可配置，默认 backend/appdata/）
├── db/main.sqlite
├── cache/thumbnails/
├── imports/clipboard/
├── generated/upscale|inpaint|face_swap|portrait|screenshot/
├── workflows/
└── downloads/xiaohongshu/
```

**关键设计**

- **不复制文件**：本地图只存绝对路径引用，AppData 内生成图/截图除外
- **SQLite WAL 模式**：支持多设备并发读取
- **任务严格串行**：FastAPI 后台线程维护队列，一次只向 ComfyUI 提交一个任务
- **ComfyUI 集成**：`/prompt` 提交，`/history` 轮询（2秒间隔），工作流模板占位符格式 `{{param_name}}`
- **软删除**：本地图只删记录，生成图/截图软删后回收站永久删除时删物理文件

## 数据模型要点

| 表 | 关键字段 |
|---|---|
| Person | id(UUID), name, cover_media_id, avg_rating, rated_count |
| Album | id, person_id?, name, cover_media_id, is_generated_album, source_face_media_id |
| Media | id, album_id?, person_id?, file_path, media_type(image/video), source_type(local/generated/screenshot), parent_media_id?, workflow_type?, generation_params(JSON), rating, is_deleted |
| Task | id, workflow_type, params(JSON), status(pending/running/completed/failed), queue_order, execution_mode(immediate/queued), result_media_ids(JSON) |
| WorkspaceItem | id, media_id(FK), sort_order（上限100条，持久化） |
| PlatformAccount | id, platform, username, display_name?, person_id?(FK→Person) |
| DownloadRecord | id, source_url, raw_text?, platform, account_id?(FK→PlatformAccount), title?, published_at?, media_count, album_id?(FK→Album), downloaded_at, status(pending/completed/failed), error_message? |

**约束**：Media.person_id 当 album_id 不为空时必须等于 Album.person_id；生成链 parent_media_id 递归深度上限 10 层

## Phase 规划

- **P0 — 基础浏览与管理**：媒体库浏览（人物/图集/大图）、导入流程、评分/筛选/排序、回收站、设置页、ComfyUI 连接管理、启动脚本
- **P1 — 核心 AI 功能**：高清放大、换脸（单张+批量）、局部修复（带提示词+自动反推）、任务队列（4种启动模式）、工作区
- **P2 — 高级 AI 功能**：图生图（含提示词反推+润色）、写真生成、动作库（DWPose 管理+动作组）
- **P3 — 扩展工具**：网页图片抓取器（小红书/B站/Twitter/Telegram/通用网页）、平台账号管理
- **P3-UI — 前端 UI/UX 改进**：设计 token 三层架构、视觉升级、体验打磨、性能优化（详见 `doc/ui_improvement_plan.md`）

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
| Qwen-Image-Edit UNET | `diffusion_models/Qwen-Rapid-NSFW-v18.1_Q4_K.gguf` |
| Qwen-Image-Edit CLIP | `text_encoders/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf`（需同目录有 `mmproj-BF16.gguf`） |
| Qwen-Image-Edit VAE | `vae/qwen_image_vae.safetensors` |

**必装插件**：ComfyUI-GGUF、comfyui-easy-use、InsightFace、Inspyrenet、comfyui_controlnet_aux（DWPose）、ControlNet Union

**关键 Gotcha**：
- ControlNet Union 用 `ModelPatchLoader`（不是 `ControlNetLoader`），接 `QwenImageDiffsynthControlnet`
- GGUF CLIP 需 `mmproj-BF16.gguf` 在同目录，工作流不选但自动加载
- `easy imageRemBg` 必须 `add_background=white`，否则 RGBA 4通道触发 VL 编码器维度错误
- 换脸用 GGUF Q4~Q6 + `qwen_image_vae.safetensors`，**不**用 fp8 safetensors + `ae.safetensors`（8GB OOM）
- LoadImage API 调用须先 `upload_image` 上传到 ComfyUI `input/`，手动测试直接放 `input/` 目录

## 换脸工作流规范（已验证）

- 模型：`Qwen-Rapid-NSFW-v18.1_Q4_K.gguf` + `qwen_image_vae.safetensors`
- CLIP：`CLIPLoaderGGUF` with `Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf` type=qwen_image
- 架构：Kontext（TextEncodeQwenImageEditPlus + FluxKontextMultiReferenceLatentMethod）
- 参数：steps=4, cfg=1, euler, simple, denoise=1.0, shift=3.1
- 底图 → ImageScaleToTotalPixels(1MP) → VAEEncode → KSampler.latent
- 人脸参考 → easy imageRemBg(white) → TextEncodeQwenImageEditPlus.image2
- Prompt：`"将图中人物面部替换为参考图中的人脸，保持身体姿势、服装和背景完全不变，边缘自然融合"`

## 可复用旧代码（main 分支）

当前开发在 `rewrite/v2` 分支，旧代码保留在 `main` 分支。以下模块可复用：

- `backend/comfyui/client.py`：ComfyUIClient（submit/watch_progress/get_image/upload_image）
- `backend/comfyui/workflow.py`：WorkflowBuilder（JSON 模板 + nodes.json 参数注入）
- `backend/comfyui/workflows/`：faceswap、dwpose、upscale 等工作流模板
- 查看方式：`git show main:backend/comfyui/client.py`

## 项目文档

| 文档 | 路径 | 说明 |
|---|---|---|
| 产品需求文档 | `doc/prd.md` | 完整功能定义、UI 规格、数据模型、API 约定（P0-P3 全量） |
| 开发指南 | `doc/development_guide.md` | 环境搭建、架构详解、全量 API 参考（~45 端点）、数据模型、前端状态管理 |
| 测试计划 | `doc/test_plan.md` | Puppeteer E2E 测试用例，按 PRD 章节组织，含需求追溯矩阵 |
| 图生图/写真 Spec | `doc/img2img_portrait_spec.md` | P2 图生图 & 写真生成方案验证草稿 |
| UI/UX 改进计划 | `doc/ui_improvement_plan.md` | P3-UI 前端视觉/体验/性能改造方案，含影响分析与执行路线图 |
| PRD 审查报告 | `doc/prd_review.md` | 历史文档，PRD 已据此修订完成 |
