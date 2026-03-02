# AI 图像生成系统 — Phase 1 开发计划

> 基于 ComfyUI + Z-Image 双模型 · Vue 3 + FastAPI · 8GB 显存本地部署

---

## 技术栈概览

| 层级 | 技术选型 |
|---|---|
| 图像生成 | ComfyUI + Z-Image Turbo / Base (GGUF Q4~Q5) |
| 人物一致性 | IPAdapter + FaceID (InsightFace) |
| 姿势控制 | DWPose + ControlNet Union |
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
- Z-Image Turbo / Base GGUF 模型下载与加载验证
- 插件安装：IPAdapter、FaceID、DWPose、ControlNet Union、Ultimate SD Upscale、Inpaint

**工作流模板**

- `turbo.json`：Turbo 基础生成工作流（8步，CFG=1.0）
- `base.json`：Base 基础生成工作流（30步，CFG=3.5）
- `upscale.json`：高清放大工作流
- `inpaint.json`：局部重绘工作流
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

- `ComfyUIClient`：`submit` / `watch_progress` / `get_image` 封装
- `WorkflowBuilder`：模板加载 + 参数注入（prompt / face_reference / pose / seed）
- Turbo / Base 模式切换逻辑（步数、CFG、采样器、Shift 自动适配）
- 任务状态管理（task_store）
- 生成图片拉取并保存至 media 目录

**Turbo / Base 参数对照**

| 参数 | Turbo | Base |
|---|---|---|
| 模型 | z-image-turbo-q4.gguf | z-image-base-q5.gguf |
| 步数 | 8 | 30 |
| CFG | 1.0 | 3.5 |
| 采样器 | res_multistep | res_multistep |
| 调度器 | simple | sgm_uniform |

---

### M4 — 人物库模块

**后端**

- 数据模型：`Character` 表（name / reference_photos / face_embed / appearance_desc 等）
- InsightFace 集成：上传参考图后自动提取 `face_embed`
- CRUD 接口：增删改查 + 参考图上传

**前端**

- `/characters` 列表页（卡片展示 + 搜索）
- `/characters/:id` 详情 / 编辑页（参考图管理、外貌描述编辑）
- 新建人物表单（含多图上传）

---

### M5 — 动作库模块

**后端**

- 数据模型：`Action` 表（name / reference_image / skeleton_data / tags / camera_suggestion）
- DWPose 集成：上传参考图后自动提取骨骼数据
- CRUD 接口：增删改查 + 标签管理

**前端**

- `/actions` 列表页（卡片 + 标签筛选）
- 新建 / 编辑动作表单（参考图上传、骨骼预览、标签打标）

---

### M6 — 图像生成模块

**后端**

- 生成任务接口 `POST /api/generate`（接收人物 ID、动作 ID、Prompt、模型选择）
- SSE 进度推送 `GET /api/generate/{task_id}/progress`
- Prompt 组装逻辑（Phase 1 手动拼接：人物外貌描述 + 用户输入）

**前端 `/generate` 生成主页**

- 人物选择器（从人物库选）
- 动作选择器（从动作库选）
- 正向 / 负向 Prompt 输入框
- Turbo / Base 模式切换组件（`ModelSwitch.vue`）
- 生成按钮 + SSE 实时进度条（`ProgressBar.vue`）
- 生成结果多图预览

---

### M7 — 高清放大 & 局部重绘

**后端**

- 放大接口 `POST /api/upscale`（接收图片 ID，调用 `upscale.json` 工作流）
- 重绘接口 `POST /api/inpaint`（接收图片 ID + mask + 补充 Prompt）

**前端**

- 生成结果页内嵌「放大」按钮，触发后 SSE 推进度
- 重绘面板：canvas mask 绘制区域 + 触发重绘

---

### M8 — Gallery 模块

**后端**

- 数据模型：`Image` 表（filepath / character_id / action_id / prompt / model / rating / created_at）
- 查询接口：分页 + 按人物 / 动作 / 评分筛选
- 评分接口 `PATCH /api/images/:id/rating`

**前端 `/gallery` 图片浏览页**

- Grid 瀑布流图片浏览
- 筛选栏（人物、动作、模型、评分）
- 图片卡片组件（`ImageCard.vue`）：缩略图 + 评分 + 快捷操作（放大、重绘）
- 图片详情弹窗：大图 + 完整生成参数展示

---

## 模块依赖关系

```
M1 环境基础
    ↓
M2 后端框架 ──── M3 ComfyUI 客户端
    ↓                    ↓
M4 人物库           M6 生成模块 ←── M5 动作库
M5 动作库                ↓
                    M7 放大 / 重绘
                         ↓
                    M8 Gallery
```

**关键路径：M1 → M2 → M3 → M6**，这条链路打通后其余模块可并行推进。

---

## 开发计划

### 第 1 周 — 基础打通

| 天 | 任务 |
|---|---|
| Day 1-2 | M1：ComfyUI 环境搭建，插件安装，GGUF 模型验证，手动跑通一次完整生成 |
| Day 3 | M1：4 套工作流模板制作（turbo / base / upscale / inpaint），节点 ID 映射 |
| Day 4 | M2：FastAPI 项目骨架，数据库初始化，文件上传与静态路由 |
| Day 5 | M3：ComfyUIClient + WorkflowBuilder，联调 Turbo/Base 切换，任务状态管理 |

**第 1 周交付标准**：通过后端接口可触发 ComfyUI 生成，SSE 能推送进度，图片落库。

---

### 第 2 周 — 数据库模块

| 天 | 任务 |
|---|---|
| Day 6-7 | M4 后端：Character 数据模型，InsightFace 集成，CRUD 接口 |
| Day 8 | M4 前端：人物列表页、详情页、新建表单 |
| Day 9 | M5 后端：Action 数据模型，DWPose 集成，CRUD 接口 + 标签管理 |
| Day 10 | M5 前端：动作列表页、标签筛选、新建表单 |

**第 2 周交付标准**：人物库和动作库可正常增删改查，参考图上传后自动提取特征。

---

### 第 3 周 — 核心生成链路

| 天 | 任务 |
|---|---|
| Day 11-12 | M6 后端：生成接口，Prompt 组装，SSE 进度推送 |
| Day 13-14 | M6 前端：生成主页（人物/动作选择、Prompt 输入、模型切换、进度条、结果预览） |
| Day 15 | M7：放大接口 + 重绘接口，前端放大按钮 + mask 画布 |

**第 3 周交付标准**：端到端可选人物、动作，触发生成，实时看进度，结果可放大/重绘。

---

### 第 4 周 — Gallery 与联调

| 天 | 任务 |
|---|---|
| Day 16-17 | M8 后端：Image 表，分页查询，评分接口 |
| Day 18-19 | M8 前端：Gallery 页，筛选栏，图片卡片，详情弹窗 |
| Day 20 | 全链路联调，Bug 修复，Phase 1 验收 |

**第 4 周交付标准**：完整走通「选人物 → 生成 → 放大 → Gallery 浏览评分」全流程。

---

## Phase 1 验收标准（Done 定义）

| 模块 | 验收标准 |
|---|---|
| 人物库 | IPAdapter + FaceID 生成图像人脸主观相似度 ≥ 7/10 |
| 动作库 | 生成图像姿势与参考匹配度 ≥ 80% |
| 双模型切换 | Turbo / Base 一键切换，参数自动适配，无需手动修改 |
| 高清放大 | 放大后无明显伪影 |
| 局部重绘 | 重绘区域光线 / 色调与原图一致 |
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
│   │   ├── generate.py
│   │   └── gallery.py
│   ├── models/              # SQLAlchemy 模型
│   ├── comfyui/
│   │   ├── client.py        # ComfyUIClient
│   │   ├── workflow.py      # WorkflowBuilder
│   │   └── workflows/       # JSON 模板
│   └── media/               # 上传图 + 生成图
└── frontend/
    ├── src/
    │   ├── views/
    │   │   ├── Characters/
    │   │   ├── Actions/
    │   │   ├── Generate/
    │   │   └── Gallery/
    │   ├── components/
    │   │   ├── ImageCard.vue
    │   │   ├── TagSelector.vue
    │   │   ├── ModelSwitch.vue
    │   │   └── ProgressBar.vue
    │   ├── stores/
    │   │   ├── character.ts
    │   │   ├── action.ts
    │   │   └── generate.ts  # 含 SSE 逻辑
    │   └── api/
    │       ├── http.ts       # axios 封装
    │       ├── character.ts
    │       ├── action.ts
    │       └── generate.ts
    └── vite.config.ts        # 开发代理 /api → localhost:8000
```

---

*文档版本：Phase 1 v1.0 · 对应需求文档 V0.5*
