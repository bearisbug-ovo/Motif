# Motif 开发文档

> 基于 rewrite/v2 分支，覆盖 P0（基础浏览管理）+ P1（核心 AI 功能）。

---

## 1. 环境搭建

### 1.1 前置依赖

| 依赖 | 版本 | 说明 |
|---|---|---|
| Python | 3.11.9 | 由 ComfyUI 自带 Python 创建 venv |
| Node.js | ≥ 18 | 前端构建 |
| ComfyUI | aki-v1.6 | AI 后端，路径 `D:\ai\ComfyUI-aki-v1.6` |
| SQLite | 内置 | 通过 SQLAlchemy + aiosqlite |

### 1.2 后端启动

```bash
cd backend

# 创建/激活 venv（首次）
"D:\ai\ComfyUI-aki-v1.6\python\python.exe" -m venv venv
venv\Scripts\pip.exe install -r requirements.txt

# 数据库迁移
venv\Scripts\alembic.exe upgrade head

# 启动
venv\Scripts\uvicorn.exe main:app --reload --host 0.0.0.0 --port 8000
```

### 1.3 前端启动

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173，/api 代理到 localhost:8000
```

### 1.4 ComfyUI 启动

```bash
"D:/ai/ComfyUI-aki-v1.6/python/python.exe" "D:/ai/ComfyUI-aki-v1.6/ComfyUI/main.py" --port 8188 --lowvram
```

就绪检测：`curl -s http://localhost:8188/object_info/KSampler` 返回 JSON 即就绪。

---

## 2. 项目架构

### 2.1 目录结构

```
backend/
├── main.py                   # FastAPI 入口 + 文件服务端点
├── config.py                 # AppData 路径、全局配置单例
├── database.py               # SQLAlchemy engine、Session、WAL 模式
├── queue_runner.py           # 异步串行任务队列调度
├── routers/
│   ├── persons.py            # 人物 CRUD（5 端点）
│   ├── albums.py             # 图集 CRUD（6 端点）
│   ├── media.py              # 媒体 CRUD + 导入 + 评分 + 软删除（16+ 端点）
│   ├── tasks.py              # 任务队列 CRUD + 队列控制（11 端点）
│   ├── workspace.py          # 工作区 CRUD（6 端点）
│   ├── recycle_bin.py         # 回收站（4 端点）
│   └── system.py             # 系统状态 + 配置（3 端点）
├── models/
│   ├── __init__.py            # 模型注册
│   ├── person.py              # Person ORM
│   ├── album.py               # Album ORM
│   ├── media.py               # Media ORM
│   ├── task.py                # Task + QueueConfig ORM
│   └── workspace.py           # WorkspaceItem ORM
├── comfyui/
│   ├── client.py              # ComfyUIClient（HTTP + WebSocket）
│   ├── workflow.py            # WorkflowBuilder（JSON 模板参数注入）
│   └── workflows/             # *.json 工作流模板
└── alembic/                   # 数据库迁移

frontend/src/
├── main.tsx                   # React 入口
├── App.tsx                    # 根组件
├── app/
│   ├── router.tsx             # React Router 路由定义
│   └── layout.tsx             # 全局布局（Sidebar + BottomNav + Outlet）
├── pages/
│   ├── MediaLibrary.tsx       # 主页：人物一览
│   ├── PersonHome.tsx         # 人物主页：图集 + 散图
│   ├── AlbumDetail.tsx        # 图集详情：网格/行布局
│   ├── TaskQueue.tsx          # 任务队列管理
│   ├── Workspace.tsx          # 工作区（100 张上限）
│   ├── RecycleBin.tsx         # 回收站
│   └── Settings.tsx           # 设置页
├── components/
│   ├── Sidebar.tsx            # 侧边导航（含任务角标轮询）
│   ├── BottomNav.tsx          # 移动端底部导航
│   ├── PersonCard.tsx         # 人物卡片
│   ├── AlbumCard.tsx          # 图集卡片
│   ├── MediaCard.tsx          # 媒体缩略图卡片（右键菜单）
│   ├── LightBox.tsx           # 大图浏览（放大镜、沉浸、键盘导航）
│   ├── FilterBar.tsx          # 筛选/排序工具栏
│   ├── StarRating.tsx         # 1-5 星评分组件
│   ├── ImportDialog.tsx       # 导入向导（文件/文件夹/子文件夹展平）
│   ├── ClipboardImportDialog.tsx # 剪贴板图片导入
│   ├── MoveToAlbumDialog.tsx  # 移动到图集
│   ├── SelectionToolbar.tsx   # 多选操作栏
│   ├── UpscaleDrawer.tsx      # 高清放大参数面板
│   ├── FaceSwapDrawer.tsx     # 单张换脸面板
│   ├── BatchFaceSwapDialog.tsx # 批量换脸确认
│   ├── FaceRefPicker.tsx      # 人脸参考图选择器（工作区/浏览两个 tab）
│   ├── MaskEditor.tsx         # 蒙版编辑器（全屏 Canvas）
│   ├── TaskCard.tsx           # 任务状态卡片
│   └── ContextMenuPortal.tsx  # 右键菜单
├── stores/                    # Zustand 状态管理
│   ├── person.ts
│   ├── album.ts
│   ├── media.ts               # 含 LightBox 状态 + 多选
│   ├── task.ts                # 含 3 秒轮询
│   ├── workspace.ts
│   └── system.ts
├── api/                       # Axios API 封装
│   ├── http.ts                # Axios 实例 + 拦截器
│   ├── persons.ts
│   ├── albums.ts
│   ├── media.ts
│   ├── tasks.ts
│   ├── workspace.ts
│   ├── recycleBin.ts
│   └── system.ts
├── hooks/
│   └── use-toast.ts
└── lib/
    └── utils.ts               # cn() 等工具函数
```

### 2.2 数据流

```
用户操作 → React 组件 → Zustand store → API 模块(axios)
                                            ↓
                                    FastAPI 端点 → SQLAlchemy ORM → SQLite (WAL)
                                            ↓ (AI 任务)
                                    queue_runner → ComfyUIClient → ComfyUI API
                                            ↓ (结果)
                                    保存文件 → 创建 Media 记录 → 前端轮询刷新
```

---

## 3. 后端 API 参考

### 3.1 人物 `/api/persons`

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| GET | `/` | 人物列表 | `sort` (created_at/avg_rating/name), `min_rating`, `max_rating` |
| GET | `/{pid}` | 人物详情 | — |
| POST | `/` | 创建人物 | Body: `{name}` |
| PATCH | `/{pid}` | 更新人物 | Body: `{name?, cover_media_id?}` |
| DELETE | `/{pid}` | 删除人物 | `mode` (person_only/person_and_albums/all) |

### 3.2 图集 `/api/albums`

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| GET | `/` | 图集列表 | `person_id`, `sort`, `min_rating` |
| GET | `/{aid}` | 图集详情 | — |
| GET | `/by-person/{pid}` | 人物下图集 | — |
| POST | `/` | 创建图集 | Body: `{name, person_id?}` |
| PATCH | `/{aid}` | 更新图集 | Body: `{name?, cover_media_id?, person_id?}` |
| DELETE | `/{aid}` | 删除图集 | `mode` (album_only/album_and_media) |

### 3.3 媒体 `/api/media`

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| POST | `/import` | 导入媒体 | Body: `{paths[], person_id?, album_id?, album_name?}` |
| GET | `/import/{token}` | 导入进度 | — |
| POST | `/import/{token}/cancel` | 取消导入 | — |
| POST | `/import-clipboard` | 剪贴板导入 | FormData: `file` |
| POST | `/backfill-dimensions` | 补填图片尺寸 | — |
| GET | `/album/{album_id}` | 图集内媒体 | `sort`, `min_rating`, `source_type` |
| GET | `/person/{pid}/loose` | 人物散图 | `sort`, `min_rating` |
| GET | `/explore` | 随机浏览 | `person_id?`, `album_id?`, `min_rating?` |
| GET | `/{mid}` | 媒体详情 | — |
| GET | `/{mid}/tree` | 生成链树 | — |
| PATCH | `/{mid}` | 更新媒体 | Body: `{rating?, album_id?, person_id?}` |
| PATCH | `/batch` | 批量更新 | Body: `{ids[], rating?, album_id?, person_id?}` |
| PATCH | `/{mid}/relocate` | 重定位文件 | Body: `{new_path}` |
| POST | `/batch-relocate` | 批量重定位 | Body: `{old_prefix, new_prefix}` |
| DELETE | `/{mid}` | 软删除 | — |
| POST | `/batch-delete` | 批量软删除 | Body: `{ids[]}` |
| POST | `/{mid}/upload-mask` | 上传蒙版 | FormData: `mask` (PNG) |
| POST | `/{mid}/show-in-explorer` | 打开资源管理器 | — |
| POST | `/{mid}/screenshot` | 视频截图 | FormData: `file` |

### 3.4 任务队列 `/api/tasks`

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| POST | `/` | 创建任务 | Body: `{workflow_type, params, execution_mode}` |
| GET | `/` | 任务列表 | `status` 筛选 |
| GET | `/stats` | 任务统计 | 返回 running/failed/pending/completed_since_last_view |
| POST | `/stats/reset` | 重置完成计数 | — |
| GET | `/{task_id}` | 任务详情 | — |
| PATCH | `/{task_id}` | 编辑任务 | Body: `{params?, queue_order?}` (仅 pending) |
| POST | `/{task_id}/retry` | 重试任务 | 仅 failed/cancelled |
| DELETE | `/{task_id}` | 删除任务 | 非 running |
| POST | `/batch-faceswap` | 批量换脸 | Body: `{album_id, face_ref_media_id, count?, ...}` |

### 3.5 队列控制 `/api/queue`

| Method | 路径 | 说明 |
|---|---|---|
| POST | `/start` | 手动触发执行 |
| GET | `/config` | 获取队列配置 |
| PUT | `/config` | 更新队列配置（start_mode, cron_expression, delay_minutes, is_paused） |

### 3.6 工作区 `/api/workspace`

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/` | 工作区列表（含 Media 信息） |
| POST | `/` | 添加条目 Body: `{media_id}` |
| POST | `/batch` | 批量添加 Body: `{media_ids[]}` |
| DELETE | `/{item_id}` | 移除条目 |
| DELETE | `/` | 清空工作区 |
| PATCH | `/reorder` | 重排序 Body: `{ordered_ids[]}` |

### 3.7 回收站 `/api/recycle-bin`

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/` | 列表（含保留倒计时） |
| POST | `/{mid}/restore` | 恢复 |
| DELETE | `/{mid}` | 永久删除 |
| DELETE | `/` | 清空 |

### 3.8 系统 `/api/system`

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/status` | 系统状态（ComfyUI 连接、磁盘空间、重连次数） |
| GET | `/config` | 获取配置 |
| PUT | `/config` | 更新配置 |

### 3.9 文件服务（main.py 内）

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/api/files/thumb` | 缩略图（JPEG，带缓存） |
| GET | `/api/files/serve` | 原始文件流式传输 |
| GET | `/api/files/pick-folder` | 系统文件夹选择对话框 |
| GET | `/api/files/pick-files` | 系统文件选择对话框 |
| GET | `/api/files/list-subfolders` | 递归列出子文件夹 |
| GET | `/api/health` | 健康检查 |

---

## 4. 数据模型

### 4.1 Person

```
id (UUID PK), name, cover_media_id (FK→Media?),
avg_rating (float?), rated_count (int),
created_at, updated_at
```

### 4.2 Album

```
id (UUID PK), person_id (FK→Person?), name,
cover_media_id (FK→Media?),
is_generated_album (bool), source_face_media_id (UUID?),
avg_rating (float?), rated_count (int),
created_at, updated_at
```

### 4.3 Media

```
id (UUID PK), album_id (FK→Album?), person_id (FK→Person?),
file_path, media_type (image|video),
source_type (local|generated|screenshot),
parent_media_id (FK→Media?),
workflow_type, generation_params (JSON),
upscale_status (pending|completed|failed|skipped?),
rating (1-5?), sort_order,
width, height, file_size,
thumbnail_path, is_deleted, deleted_at,
created_at, updated_at
```

索引：`(person_id, is_deleted)`, `(album_id, sort_order)`, `(rating)`, `(is_deleted, deleted_at)`

### 4.4 Task

```
id (UUID PK), workflow_type, params (JSON),
status (pending|running|completed|failed|cancelled),
queue_order, execution_mode (immediate|queued),
result_media_ids (JSON), error_message,
created_at, started_at, finished_at
```

### 4.5 QueueConfig（全局单例 id=1）

```
start_mode (manual|auto|cron|delay),
cron_expression?, delay_minutes?, is_paused,
updated_at
```

### 4.6 WorkspaceItem

```
id (UUID PK), media_id (FK→Media),
sort_order, created_at
```

---

## 5. 任务队列系统

### 5.1 执行流程

```
前端提交任务 → POST /api/tasks → 写入 Task 表
                                    ↓
                          queue_runner 检测到待执行任务
                                    ↓
                        _execute_next_task() 取最小 queue_order 的 pending 任务
                                    ↓
                        设置 status=running → 分发到对应 runner
                                    ↓
            ┌────────────────────┬──────────────────────────┐
         _run_upscale     _run_faceswap          _run_inpaint
            ↓                    ↓                      ↓
      upload → workflow → run → save → 创建 Media 记录
                                    ↓
                        status=completed → 通知角标
                                    ↓
                    _auto_chain_upscale（非 upscale 任务自动串联放大）
```

### 5.2 四种启动模式

| 模式 | 行为 |
|---|---|
| `manual` | 等待 `POST /api/queue/start` 信号 |
| `auto` | 有 pending 任务即自动执行 |
| `delay` | 最后一个任务加入后延迟 N 分钟执行 |
| `cron` | 按 cron 表达式定时检查（当前简化为 60s 轮询） |

### 5.3 安全机制

- 磁盘空间检查：< 500MB 拒绝执行
- 任务超时：默认 10 分钟（可配置）
- 失败跳过：标记 `failed`，继续下一任务
- 自动放大失败：保留原图，标记 `upscale_status=failed`

### 5.4 workflow_type 枚举

| 类型 | 说明 | 参数 |
|---|---|---|
| `upscale` | 高清放大 | source_media_id, upscale_factor, denoise, model |
| `face_swap` | 换脸 | source_media_id, face_ref_media_id, result_album_id?, target_person_id? |
| `inpaint_flux` | Flux 局部修复（带提示词） | source_media_id, mask_path, prompt, denoise |
| `inpaint_sdxl` | SDXL 局部修复 | source_media_id, mask_path, denoise |
| `inpaint_klein` | Klein 局部修复 | source_media_id, mask_path |

---

## 6. 前端状态管理

### 6.1 Zustand Store 概览

| Store | 职责 | 关键方法 |
|---|---|---|
| `person` | 人物 CRUD | fetchPersons, fetchPerson, createPerson, updatePerson, deletePerson |
| `album` | 图集 CRUD | fetchAlbums, fetchAlbum, fetchAlbumsByPerson, createAlbum, updateAlbum, deleteAlbum |
| `media` | 媒体 + LightBox + 多选 | fetchByAlbum, fetchLoose, openLightbox, closeLightbox, lightboxNext/Prev, updateMedia, softDelete, toggleSelection |
| `task` | 任务 + 3 秒轮询 | fetchTasks, fetchStats, startPolling, stopPolling |
| `workspace` | 工作区 CRUD | fetchItems, addItem, batchAdd, removeItem, clear, reorder |
| `system` | 系统状态/配置 | fetchStatus, fetchConfig, updateConfig |

### 6.2 任务角标轮询

`task.ts` 的 `startPolling()` 每 3 秒请求 `GET /api/tasks/stats`，返回：

```json
{ "running": 1, "failed": 0, "pending": 5, "completed_since_last_view": 3 }
```

Sidebar/BottomNav 显示角标：
- 运行中：旋转动画
- 失败：红色数字
- 完成：绿色数字（进入任务页后清零）

---

## 7. 关键组件说明

### 7.1 LightBox（大图浏览）

- 全屏覆盖，createPortal 挂载到 body
- 键盘导航：← → 切换，1-5 评分，Esc 退出
- 放大镜模式：点击进入，Canvas 绘制高分辨率裁剪区域，滚轮调倍率，右键退出
- 沉浸模式：全屏，隐藏所有 UI，保留键盘操作
- 底部缩略图条：滚动高亮当前图，点击跳转
- 右键菜单：封面设置、放大、换脸、局部修复、工作区、删除

### 7.2 MaskEditor（蒙版编辑器）

- createPortal 全屏，双 Canvas 架构：
  - 显示画布（屏幕分辨率）：叠加渲染底图 + 蒙版
  - 蒙版画布（原图分辨率，离屏）：记录实际蒙版数据
- 工具：画笔（B）、橡皮（E）、大小调节（[/]）
- 撤销/重做：ImageData 快照栈（最大 50 步），Ctrl+Z / Ctrl+Y
- 缩放：滚轮以指针为中心缩放，中键/Alt+拖拽平移
- 导出：RGBA PNG（alpha=0 为修复区域，alpha=255 为保留区域）
- 提交：上传蒙版 → 创建任务（三种模式：Flux/SDXL/Klein）

### 7.3 ImportDialog（导入向导）

- 文件选择 / 文件夹选择 / 子文件夹展平
- 每个子文件夹独立配置：图集名、所属人物
- 进度显示 + 可取消
- 路径去重（同路径不重复导入）

### 7.4 FaceRefPicker（人脸参考图选择器）

- 两个 Tab：
  - 工作区：直接从 WorkspaceItem 列表选取
  - 浏览：人物 → 图集 → 媒体 三级导航
- 返回 `{ id, file_path, person_id }`

---

## 8. ComfyUI 集成

### 8.1 ComfyUIClient (`backend/comfyui/client.py`)

关键方法：

| 方法 | 说明 |
|---|---|
| `upload_image(path)` | 上传图片到 ComfyUI input/ 目录 |
| `run_workflow(workflow)` | 提交 /prompt → WebSocket 监听进度 → 获取输出图片 |
| `save_image(data, path)` | 将 ComfyUI 返回的图片数据保存到本地 |

### 8.2 WorkflowBuilder (`backend/comfyui/workflow.py`)

| 方法 | 说明 |
|---|---|
| `build_upscale(...)` | 构建放大工作流 JSON |
| `build_faceswap(...)` | 构建换脸工作流 JSON |
| `build_inpaint(...)` | 构建局部修复工作流 JSON（mode: flux/sdxl/klein） |

### 8.3 工作流模板

模板位于 `AppData/workflows/` 或 `backend/comfyui/workflows/`，JSON 格式，参数占位符 `{{param_name}}`。

---

## 9. 开发约定

### 9.1 后端

- FastAPI 路由按功能模块拆分到 `routers/` 下
- ORM 模型在 `models/` 下，`__init__.py` 注册所有模型
- 所有 ID 使用 UUID（string 存储）
- JSON 字段使用 Text 类型 + `json.dumps/loads`
- 数据库迁移用 Alembic：`venv\Scripts\alembic.exe revision --autogenerate -m "描述"`
- 日期时间统一 UTC（`datetime.utcnow()`）

### 9.2 前端

- 技术栈：React + TypeScript + Vite + TailwindCSS + shadcn/ui
- 状态管理：Zustand（每个功能域一个 store）
- API 层：Axios 封装，每个后端模块对应一个 API 文件
- UI 组件库：shadcn/ui（`components/ui/` 下）
- 路由：React Router v6
- 样式：TailwindCSS + `cn()` 工具函数合并 class
- 构建：`npm run build` 输出到 `dist/`

### 9.3 路由表

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | MediaLibrary | 人物一览 |
| `/person/:personId` | PersonHome | 人物主页 |
| `/album/:albumId` | AlbumDetail | 图集详情 |
| `/tasks` | TaskQueue | 任务队列 |
| `/workspace` | Workspace | 工作区 |
| `/recycle-bin` | RecycleBin | 回收站 |
| `/settings` | Settings | 设置 |

---

*文档版本：v1.0 | 基于 rewrite/v2 分支 | 2026-03-03*
