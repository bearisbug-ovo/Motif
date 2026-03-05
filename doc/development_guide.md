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

### 1.2 一键启动（推荐）

双击项目根目录 `start.bat`，自动完成后端 + 前端 + ComfyUI 启动。

```
start.bat          # 入口，调用 start.ps1
└── start.ps1      # PowerShell 启动器主逻辑
```

**启动器行为**：清理旧进程 → 启动后端（:8000）→ 启动前端（:5173）→ 检测/启动 ComfyUI（:8188）→ 打开浏览器 → 进入交互模式。

**交互命令**：

| 按键 | 行为 |
|------|------|
| `r` | 快速重启后端 + 前端（不重启 ComfyUI） |
| `Enter` | 停止所有服务并退出 |

**日志位置**：`.logs/backend.log`、`backend-error.log`、`frontend.log`、`frontend-error.log`

**进程管理**：后端和前端通过 Win32 Job Object 绑定，启动器退出时自动终止；ComfyUI 独立运行不受影响。

### 1.3 手动启动（开发调试）

#### 后端

```bash
cd backend

# 创建/激活 venv（首次）
"D:\ai\ComfyUI-aki-v1.6\python\python.exe" -m venv venv
venv\Scripts\pip.exe install -r requirements.txt

# 数据库迁移
venv\Scripts\alembic.exe upgrade head

# 启动（带热重载）
venv\Scripts\uvicorn.exe main:app --reload --host 0.0.0.0 --port 8000
```

#### 前端

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173，/api 代理到 localhost:8000
```

#### ComfyUI

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
│   ├── Sidebar.tsx            # 侧边导航（含任务角标轮询 + 底部全屏切换按钮）
│   ├── BottomNav.tsx          # 移动端底部导航（含全屏按钮 + fullscreenchange 状态同步）
│   ├── PersonCard.tsx         # 人物卡片
│   ├── AlbumCard.tsx          # 图集卡片
│   ├── MediaCard.tsx          # 媒体缩略图卡片（右键菜单，视频图标百分比缩放）
│   ├── LightBox.tsx           # 大图浏览（放大镜、沉浸、键盘导航）
│   ├── video/
│   │   ├── VideoPlayer.tsx    # 视频播放器主组件（引擎+手势+控件）
│   │   ├── VideoControls.tsx  # 控件栏（进度条、音量、倍速、截图等）
│   │   ├── VideoGestureLayer.tsx # 移动端触摸手势层
│   │   ├── SpeedIndicator.tsx # 倍速提示条
│   │   └── hooks/
│   │       ├── useControlsAutoHide.ts  # 控件自动隐藏（3秒）
│   │       ├── useOrientationMode.ts   # 横竖屏检测+切换
│   │       └── useSpeedControl.ts      # 长按倍速状态机
│   ├── FilterBar.tsx          # 筛选/排序工具栏（移动端紧凑下拉尺寸）
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
│   ├── use-toast.ts
│   └── useGridZoom.ts         # 网格缩放 hook（pinch-to-zoom + Ctrl+scroll）
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
| POST | `/upload-files` | 移动端文件上传导入 | FormData: `files[]`, `person_id?`, `album_id?`。文件保存至 `AppData/imports/upload/`，返回 `{imported, media_ids[]}` |
| POST | `/backfill-dimensions` | 补填图片尺寸 | — |
| GET | `/album/{album_id}` | 图集内媒体 | `sort`, `min_rating`, `source_type` |
| GET | `/person/{pid}/loose` | 人物散图 | `sort`, `min_rating` |
| GET | `/explore` | 随机浏览 | `person_id?`, `album_id?`, `min_rating?` |
| GET | `/{mid}` | 媒体详情 | — |
| GET | `/{mid}/tree` | 生成链树 | — |
| PATCH | `/{mid}` | 更新媒体 | Body: `{rating?, album_id?, person_id?}` |
| PATCH | `/batch` | 批量更新 | Body: `{ids[], rating?, album_id?, person_id?}` |
| POST | `/{mid}/detach` | 脱离生成链 | 无 Body。将 parent_media_id、workflow_type、generation_params 置为 null |
| PATCH | `/{mid}/relocate` | 重定位文件 | Body: `{new_path}` |
| POST | `/batch-relocate` | 批量重定位 | Body: `{old_prefix, new_prefix}` |
| DELETE | `/{mid}` | 软删除 | — |
| POST | `/batch-delete` | 批量软删除 | Body: `{ids[]}` |
| POST | `/{mid}/upload-mask` | 上传蒙版 | FormData: `mask` (PNG) |
| POST | `/{mid}/show-in-explorer` | 打开资源管理器 | — |
| POST | `/{mid}/screenshot` | 视频截图 | FormData: `file` |
| POST | `/by-ids` | 批量按 ID 获取媒体 | Body: `{ids[]}` |

### 3.4 任务队列 `/api/tasks`

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| POST | `/` | 创建任务 | Body: `{workflow_type, params, execution_mode}` |
| GET | `/` | 任务列表 | `status` 筛选 |
| GET | `/stats` | 任务统计 | 返回 running/failed/pending/completed_since_last_view/progress |
| POST | `/stats/reset` | 重置完成计数 | — |
| GET | `/{task_id}` | 任务详情 | — |
| PATCH | `/{task_id}` | 编辑任务 | Body: `{params?, queue_order?}` (仅 pending) |
| PATCH | `/reorder` | 批量重排序 pending 任务 | Body: `{task_ids: ["id1", "id2", ...]}` 按顺序更新 queue_order |
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
| GET | `/api/files/thumb` | 缩略图（JPEG，带缓存；支持图片和视频，视频用 OpenCV 提取第一帧） |
| GET | `/api/files/serve` | 原始文件流式传输（支持 HTTP Range 请求，视频 seek 必需；有 Range 头时返回 206 + `Content-Range`，无则返回完整文件 + `Accept-Ranges: bytes`） |
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

### 5.4 workflow_type 枚举

| 类型 | 说明 | 参数 |
|---|---|---|
| `upscale` | 高清放大（内置 Qwen3-VL 自动反推提示词） | source_media_id, upscale_factor, denoise, model |
| `face_swap` | 换脸 | source_media_id, face_ref_media_id, result_album_id?, target_person_id? |
| `inpaint_flux` | Flux 局部修复（带提示词） | source_media_id, mask_path, prompt, denoise, enable_rear_lora? |
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

**全屏切换**：
- 桌面端 Sidebar：底部（ComfyUI 状态指示灯上方）放置全屏按钮，调用 Fullscreen API
- 移动端 BottomNav：保留全屏按钮，通过 `fullscreenchange` 事件监听器同步按钮状态

---

## 7. 关键组件说明

### 7.1 LightBox（大图浏览）

- 全屏覆盖，createPortal 挂载到 body
- 键盘导航：← → 切换，1-5 评分，Esc 退出
- **移动端滑动切换**：速度阈值（velocity>0.3px/ms 且 |dx|>20px）或距离阈值（|dx|>60px）触发切换；视频模式下通过 Touch Arbiter 仲裁，避免与进度条拖拽/长按倍速冲突
- **移动端右键菜单**：两指同时触碰触发（替代长按，避免与视频倍速冲突），LightBox handleTouchStart 检测 `touches.length >= 2`，handleTouchEnd 时打开 contextMenu
- 放大镜模式：点击进入，Canvas 绘制高分辨率裁剪区域，滚轮调倍率，右键退出
- 沉浸模式：全屏，隐藏所有 UI，保留键盘操作
- 底部缩略图条：滚动高亮当前图，点击跳转
- 右键菜单：封面设置、放大、换脸、局部修复、工作区、删除
- **视频模式**：视频媒体使用独立 `<VideoPlayer>` 组件替代图片显示区域

### 7.1.1 VideoPlayer（视频播放器）

- **架构**：双 `<video>` 元素 A/B 交替 + `requestVideoFrameCallback` 首帧 swap，消除切换黑闪；非活跃 slot 加 `invisible` 防止不同宽高比残影；全自定义 Tailwind UI + 手势系统
- **Props**：`src`、`poster`、`autoPlay`、`initialMuted`、`onMutedChange`、`onScreenshot`、`isLandscape`、`onLandscapeChange`、`touchArbiter?`、`onContextMenu?`；通过 `forwardRef` 暴露 `VideoPlayerHandle`（`toggleMute()`），供 LightBox 右键菜单调用
- **关闭行为**：视频区域 `onClick` 计算 `object-contain` 实际渲染矩形，点击 letterbox 黑边不阻止冒泡（LightBox 关闭），点击视频内容区域 `stopPropagation`（保持打开）
- **静音策略**：LightBox 维护 `sessionUnmuted` 状态，首视频自动静音，用户取消静音后后续视频不再静音
- **控件（VideoControls，z-10 置于手势层之上）**：
  - 可点击/拖拽进度条（pointerDown 即时 seek + document 级 pointermove/pointerup 拖拽），拖拽中实时 seek 视频画面，`handleSeek` 同步更新 `setCurrentTime` 避免松开时进度条闪回；含缓冲进度显示
  - 音量按钮（静音切换，PC/移动端均显示）+ 音量滑块（仅 PC hover 展开）
  - **移动端溢出菜单**：控件栏精简为「播放 | 音量 | 时间 | ··· | 横屏」，`···`（MoreHorizontal）弹出菜单包含倍速选择（横排按钮）、上一帧、下一帧、截图；点击外部关闭
  - **PC 端**：倍速选择菜单（0.5x–3x）、逐帧步进（±1/30s）、截图、全屏切换直接显示在控件栏
  - 截图：Canvas → Blob → 回调，截图后 Toast 提示"截图已保存"+ 可选"高清放大"按钮，不强制放大
  - 移动端横屏按钮 = 全屏（不再单独显示全屏按钮），图标用 Maximize/Minimize
  - 布局模式：`bottom-bar`（PC 非全屏，视频下方）/ `overlay`（横屏/全屏，底部悬浮渐变背景）
- **自动隐藏（useControlsAutoHide）**：PC 鼠标 3s 无移动隐藏；移动端单击切换
- **Touch Arbiter（useTouchArbiter）**：统一手势仲裁状态机，LightBox 创建 arbiterRef 并传入 VideoPlayer → VideoGestureLayer / VideoControls。状态流：`idle → pending → seeking/swiping/speed_control → idle`。`claimGesture(arbiter, desired)` 仅在 `pending` 或已持有时成功，防止多手势竞争冲突
- **手势层（VideoGestureLayer）**：接收 `touchArbiter` + `duration`/`currentTime`/`onSeek` + `onSeekingStart`/`onSeekingEnd`，阻止原生 `contextmenu`。200ms 定时器 claim `speed_control`（期间任何水平移动 >1px 立即取消定时器，确保拖拽优先）。横屏时水平拖拽（|dx|>5px）claim `seeking`，映射范围 min(duration, 600s)；拖拽开始暂停视频 + 显示进度条，结束恢复播放 + 隐藏进度条。竖屏时不 claim（交 LightBox 做 swiping）。两指触碰时取消长按定时器，交由 LightBox 处理
- **倍速控制（useSpeedControl）**：长按 200ms（无移动）→ 2x，左右滑调速（40px/0.25x），上滑锁定，松开恢复
- **进度条手势协调**：VideoControls 在 progressPointerDown 时立即 `claimGesture('seeking')`，阻止 LightBox swipe 和 speed_control 竞争；pointerUp 时 resetArbiter
- **SpeedIndicator**：顶部居中倍速提示条，显示当前倍速 + 锁定图标
- **横屏模式（useOrientationMode）**：LightBox 使用 `useOrientationMode` hook，进入横屏时先 `requestFullscreen()` 再 `screen.orientation.lock('landscape')`，退出时 `unlock()` + `exitFullscreen()`。横屏时 LightBox TopBar 高度收为 0 + 缩略图条隐藏
- **键盘快捷键**：空格（播放/暂停）、←/→（±5s）、↑/↓（音量 ±10%）、F（全屏），视频模式时 LightBox 不拦截这些按键

### 7.2 MaskEditor（蒙版编辑器）

- createPortal 全屏，双 Canvas 架构：
  - 显示画布（屏幕分辨率）：叠加渲染底图 + 蒙版
  - 蒙版画布（原图分辨率，离屏）：记录实际蒙版数据
- 工具：画笔（B）、橡皮（E）、大小调节（[/]）
- 撤销/重做：ImageData 快照栈（最大 50 步），Ctrl+Z / Ctrl+Y
- 缩放：滚轮以指针为中心缩放，中键/Alt+拖拽平移
- 移动端触摸：canvas `touch-action: none` 阻止浏览器手势拦截，`setPointerCapture` 确保绘制连续性，双指 pinch-to-zoom 缩放+平移
- 移动端画笔：默认大小 20（桌面端 40），范围 5-100（桌面端 5-200）
- 移动端底部栏：垂直堆叠 4 行（模式按钮 / 提示词 / 降噪+LoRA / 提交按钮），桌面端保持单行
- 导出：RGBA PNG（alpha=0 为修复区域，alpha=255 为保留区域）
- 提交：上传蒙版 → 创建任务（三种模式：Flux/SDXL/Klein）

### 7.3 ImportDialog（导入向导）

- 文件选择 / 文件夹选择 / 子文件夹展平
- 每个子文件夹独立配置：图集名、所属人物
- **文件夹名智能拆分**：若文件夹名包含 `_`、`-` 或空格，按第一个分隔符拆分，左侧作为默认人物名，右侧作为默认图集名（如 `Alice_Wedding` → 人物"Alice"，图集"Wedding"）；无分隔符时人物名和图集名均为完整文件夹名
- **人物自动匹配**：拆分出的人物名若与数据库已有人物名匹配（不区分大小写），自动切换为"已有人物"模式；多个子文件夹拆分出相同人物名时，仅创建一次，后续复用同一人物 ID
- 进度显示 + 可取消
- 路径去重（同路径不重复导入）
- **移动端文件上传**：检测 `(pointer: coarse)` 时使用 HTML `<input type="file" multiple>` 替代 tkinter 文件选择器，文件通过 `POST /api/media/upload-files` 上传到服务器缓存（`AppData/imports/upload/`）。移动端隐藏文件夹选择和路径输入，不支持子文件夹模式

### 7.4 FaceRefPicker（人脸参考图选择器）

- 两个 Tab：
  - 工作区：直接从 WorkspaceItem 列表选取
  - 浏览：人物 → 图集 → 媒体 三级导航
- 返回 `{ id, file_path, person_id }`

### 7.5 useGridZoom Hook（网格缩放）

通用缩放 hook，连续调整网格列数或行高。每次进入页面重置为设置页面配置的默认值，不持久化当前缩放状态。

**默认值配置**（`lib/zoomDefaults.ts`）：
- 每个页面（人物库/人物主页/图集详情Grid/图集详情Row/工作区/回收站）独立设置
- 桌面端和手机端分开配置
- 支持任意正整数
- 在设置页面修改，存储在 localStorage `motif-zoom-defaults`

**API：**
```ts
useGridZoom({
  pageKey: ZoomPageKey,  // 页面标识，用于读取默认值
  min?: number,          // 最小值（默认 1）
  max?: number,          // 最大值（默认 30）
}) => {
  value: number,         // 当前列数或行高
  containerRef: RefObject<HTMLDivElement>, // 绑定到可滚动容器
  gridStyle: CSSProperties,  // { display:'grid', gridTemplateColumns, gap, touchAction }
  gapPx: number,         // 当前 gap 像素值
}
```

**手势：**
- 桌面端：Ctrl+滚轮，每次 ±1 列（document 级别拦截，阻止浏览器缩放）
- 移动端：双指捏合连续调整（40px/步），两指检测即锁定滚动
- 缩放结束后 300ms 抑制 click 防误触
- `touch-action: pan-y` 阻止浏览器 pinch-zoom

**Gap 自动缩放**：桌面端按列数分段（16/8/6/4/2/1px），手机端统一 1px

**使用示例：**
```tsx
const { value: cols, containerRef, gridStyle } = useGridZoom({ pageKey: 'media-library' })
return <div ref={containerRef}><div style={gridStyle}>...</div></div>
```

### 7.6 PersonCard / AlbumCard（卡片组件）

两者共享相同的视觉设计：
- 正方形封面（`aspect-square`）
- 底部渐变叠加（`from-black/70`），白色文字显示名称和计数
- 左上角评分徽章（★4.2，`bg-black/60`）
- 右上角 hover 显示 `…` 下拉菜单（`bg-black/40`）
- `compact?: boolean` prop：桌面端列数 ≥10 / 移动端列数 ≥4 时传入，隐藏渐变叠层和评分徽章（防止小卡片误触）
- 手机端无圆角（`rounded-none sm:rounded-lg`）

### 7.7 MediaCard（媒体卡片）

- 底部渐变叠加（`from-black/70`）显示文件名（从 `file_path` 提取，去除路径和扩展名，`truncate` 截断），格式与 AlbumCard 一致，`pointer-events-none` 不阻断鼠标事件
- 视频播放图标：百分比尺寸 `w-[20%]`，clamp 在 16px–28px 之间（替代原固定 `w-7 h-7`），随卡片大小自适应
- `compact?: boolean` prop：同 PersonCard/AlbumCard 阈值，隐藏文件名渐变叠层和评分徽章

### 7.8 FilterBar（筛选栏）

- 排序下拉：`w-[5.5rem] sm:w-32`、`h-7 sm:h-8`、`text-xs`
- 评分/来源下拉：`w-20 sm:w-28`、`h-7 sm:h-8`、`text-xs`
- 各页面使用情况：
  - 人物库：排序 + 评分（PersonStore）
  - 人物主页·图集区：排序 + 评分（AlbumStore）
  - 人物主页·散图区：排序 + 评分 + 来源（MediaStore）
  - 图集详情：排序 + 评分 + 来源（MediaStore）
- 每次进入页面调用 `resetFilters(pageKey)` 从 `lib/filterDefaults.ts` 读取默认值
- FilterBar 纯展示组件，onChange 由页面手动调用 store.fetch

### 7.8.1 筛选默认值配置（`lib/filterDefaults.ts`）

- 参照 `zoomDefaults.ts` 模式，localStorage key: `motif-filter-defaults`
- 全局默认值：`filterRating`（评分筛选）、`sourceType`（来源类型），默认均为 `''`（全部）
- 每页排序默认值：`SortPageKey` = `media-library` / `person-albums` / `person-loose` / `album-detail`
- API：`getSortDefault(page)` / `setSortDefault(page, value)` / `getFilterDefault(key)` / `setFilterDefault(key, value)` / `getAllFilterDefaults()`
- 设置页 onChange 即时写入 localStorage，无需保存按钮

### 7.9 页面头部/工具栏响应式

所有页面（MediaLibrary、PersonHome、AlbumDetail）的头部在移动端：
- 操作按钮仅显示图标，文字通过 `hidden sm:inline` 隐藏
- 缩减内边距 `px-3`（桌面端 `px-6`）
- 缩小高度 `h-12`（桌面端默认）
- 缩小字号

内容区域：
- 侧边距 `px-1 sm:px-6`
- 底部内边距 `pb-20 sm:pb-*` 为移动端底部导航栏预留空间

PersonHome hero 区域移动端：
- 头像 64×64（桌面端 96×96）
- 紧凑文字排版
- 操作按钮仅图标

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
| `build_upscale(...)` | 构建放大工作流 JSON（内置 Qwen3-VL 反推节点自动生成正向提示词，不需要外部传入 prompt） |
| `build_faceswap(...)` | 构建换脸工作流 JSON |
| `build_inpaint(...)` | 构建局部修复工作流 JSON（mode: flux/sdxl/klein）；`enable_rear_lora=True` 时动态注入 `LoraLoaderModelOnly` 节点（仅 flux 模式） |

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

*文档版本：v1.1 | 基于 rewrite/v2 分支 | 2026-03-04*
