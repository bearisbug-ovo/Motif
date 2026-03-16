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

双击项目根目录 `start.bat`（或 `start.vbs`），打开图形化启动器，自动完成后端 + 前端 + ComfyUI 启动。

```
start.bat              # 入口
└── start.vbs          # 静默启动（无 CMD 窗口）
    └── launcher.py    # Python + tkinter GUI 启动器
```

**启动器行为**：窗口打开后自动执行——清理旧进程 → 构建前端（`npm run build`）→ 启动后端（:8000，同时 serve 前端静态文件）→ 检测/启动 ComfyUI（:8188）→ 打开浏览器。

**启动器界面**（tkinter，880×720，暗色主题，高 DPI 适配）：

| Tab | 内容 |
|-----|------|
| 状态 | 三张状态卡片（后端/ComfyUI/网络）+ 控制按钮 + 已连接设备列表 |
| 设置 | 启动前配置（端口、ComfyUI 地址/命令、缩略图大小）+ 跳过构建/ComfyUI 开关 |
| 日志 | 启动流程实时日志（带颜色标记） |

**控制按钮**：

| 按钮 | 行为 |
|------|------|
| 启动全部服务 | 构建前端 + 启动后端 + 启动 ComfyUI + 打开浏览器 |
| 停止全部 | 停止后端和 ComfyUI |
| 快速重启 | 重新构建前端 + 重启后端（不重启 ComfyUI，不打开浏览器） |
| 打开浏览器 | 打开 `http://localhost:{port}` |

**日志位置**：`.logs/backend.log`、`backend-error.log`

**进程管理**：后端通过 Win32 Job Object 绑定，启动器退出时自动终止；ComfyUI 独立运行不受影响。所有子进程使用 `CREATE_NO_WINDOW`，全程无控制台窗口。

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
npm run build    # 生成 dist/，后端自动 serve
# 或开发模式（热重载）：
npm run dev      # http://localhost:5173，/api 代理到 localhost:8000
```

> **生产模式**：后端自动 serve `frontend/dist/` 静态文件，通过 `http://localhost:8000` 统一访问 API + 前端页面，支持 PWA 安装。
> **开发模式**：`npm run dev` 提供热重载，通过 `http://localhost:5173` 访问，API 代理到 8000 端口。

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
│   ├── system.py             # 系统状态 + 配置（3 端点）
│   └── launcher.py           # 启动器仪表盘（5 端点：状态/ComfyUI控制/重启/日志）
├── models/
│   ├── __init__.py            # 模型注册
│   ├── person.py              # Person ORM
│   ├── album.py               # Album ORM
│   ├── media.py               # Media ORM
│   ├── task.py                # Task + QueueConfig ORM
│   ├── tag.py                 # Tag + PersonTag + AlbumTag ORM
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
│   ├── PersonHome.tsx         # 人物主页：图集 + 未分类
│   ├── AlbumDetail.tsx        # 图集详情：网格/行布局
│   ├── TaskQueue.tsx          # 任务队列管理
│   ├── Workflows.tsx          # 工作流页面（运行 | 管理）
│   ├── Workspace.tsx          # 工作区内容（嵌入 Settings「工作区」Tab）
│   ├── RecycleBin.tsx         # 回收站内容（嵌入 Settings「回收站」Tab）
│   ├── Dashboard.tsx          # 控制台内容（嵌入 Settings「控制台」Tab）
│   └── Settings.tsx           # 设置页（外观 | 服务 | 标签 | 工作区 | 回收站 | 控制台）
├── components/
│   ├── Sidebar.tsx            # 侧边导航（人物库/任务队列/工作流/小工具/设置 + 任务角标 + 全屏切换）
│   ├── BottomNav.tsx          # 移动端底部导航（仅图标无文字，同侧边栏 5 项 + 全屏图标按钮）
│   ├── PersonCard.tsx         # 人物卡片
│   ├── AlbumCard.tsx          # 图集卡片
│   ├── MediaCard.tsx          # 媒体缩略图卡片（右键菜单含开启多选，视频图标百分比缩放）
│   ├── lightbox/              # 大图浏览模块
│   │   ├── LightBox.tsx       # 主容器（双轴导航、放大模式、沉浸）
│   │   ├── LightBoxTopBar.tsx # 顶部操作栏（评分、AI功能、封面、删除等）
│   │   ├── LightBoxMedia.tsx  # 主图/视频展示区
│   │   ├── LightBoxContextMenu.tsx # 右键菜单
│   │   ├── ChainIndicator.tsx # 生成链指示器（替代旧右侧面板，位于主图与缩略图条之间）
│   │   ├── SourceButtons.tsx  # 任务队列结果模式下的源图导航按钮（替代 ChainIndicator）
│   │   ├── ThumbnailStrip.tsx # 底部缩略图预览条（仅本地图）
│   │   └── hooks/
│   │       └── useLightboxInput.ts # 键盘/滚轮/触摸手势统一输入处理
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
│   ├── MoveToPersonDialog.tsx # 移动到其他人物（搜索+选择，批量 batchUpdate person_id）
│   ├── SelectionToolbar.tsx   # 多选操作栏（全选/取消全选自动切换）
│   ├── WorkflowRunDialog.tsx  # AI 工作流选择 + 任务提交弹窗（使用 WorkflowParamForm）
│   ├── WorkflowParamForm.tsx  # 共享参数表单组件（category + extra_params 渲染，含 Toggle 开关，combo 参数渲染为 Select 下拉框）
│   ├── MaskEditor.tsx         # 纯遮罩绘制工具（全屏 Canvas，onComplete 回调返回 blob）
│   ├── BatchAiDialog.tsx       # 批量 AI 任务确认（通用，支持 upscale/face_swap/image_to_image/preprocess）
│   ├── FaceRefPicker.tsx      # 人脸参考图选择器（工作区/浏览两个 tab）
│   ├── ConfirmDialog.tsx      # 全局确认弹窗（Zustand store + Radix Dialog，替代浏览器 confirm()）
│   ├── MediaDetailDialog.tsx  # 媒体详情弹窗（文件名/目录/格式/分辨率/大小/时长等）
│   ├── TaskCard.tsx           # 任务状态卡片
│   ├── Skeleton.tsx           # 骨架屏 + 空状态组件（Skeleton / SkeletonGrid / EmptyState）
│   ├── ContextMenuPortal.tsx  # 右键菜单（MenuItem / MenuSeparator / SubMenuItem，移动端 SubMenuItem 使用 fixed 定位避免裁切）
│   ├── TagEditor.tsx          # 标签编辑器（SubMenu 行内编辑 + Dialog 管理两种模式）
│   └── AiContextMenu.tsx     # AI 功能子菜单（AiMediaSubMenu：upscale/face_swap/inpaint/image_to_image/text_to_image/preprocess / AiAlbumSubMenu）
├── stores/                    # Zustand 状态管理
│   ├── person.ts
│   ├── album.ts
│   ├── media.ts               # 媒体 CRUD + 多选
│   ├── lightbox.ts            # LightBox 双轴导航状态
│   ├── task.ts                # 含 3 秒轮询
│   ├── workspace.ts
│   ├── system.ts
│   └── tag.ts                 # 标签 CRUD + 关联管理
├── api/                       # Axios API 封装
│   ├── http.ts                # Axios 实例 + 拦截器
│   ├── persons.ts
│   ├── albums.ts
│   ├── media.ts
│   ├── tasks.ts
│   ├── workspace.ts
│   ├── recycleBin.ts
│   ├── system.ts
│   ├── tags.ts                # 标签 API
│   └── launcher.ts            # 启动器仪表盘 API（状态/ComfyUI 控制/重启/日志）
├── hooks/
│   ├── use-toast.ts
│   ├── useDevice.ts           # 统一设备检测 hook（isMobile + isTouch）
│   ├── useGridZoom.ts         # 网格缩放 hook（pinch-to-zoom + Ctrl+scroll）
│   └── useMissingFiles.ts     # 文件丢失检测 hook（批量检查 source_type=local 文件）
└── lib/
    ├── utils.ts               # cn() 等工具函数
    └── filterDefaults.ts      # 筛选默认值配置（含 mediaType）
```

### 2.2 主题系统

**双主题支持：** 浅色（Warm Light）+ 深色（Warm Dark），基于 claude.ai 暖色调设计语言。

**实现架构：**

| 层级 | 文件 | 说明 |
|---|---|---|
| CSS 变量 | `src/index.css` | `:root` 定义浅色语义 token，`.dark` 定义深色语义 token |
| 主题工具 | `src/lib/theme.ts` | `getTheme()` / `setTheme(theme)` / `initTheme()` — 管理 localStorage 和 DOM class |
| 防闪烁 | `index.html` | `<script>` 在 React 挂载前读取 localStorage 并加 `.dark` class |
| UI 入口 | Settings「外观」Tab | 3 选项卡片：浅色 / 深色 / 跟随系统 |

**localStorage Key：** `motif-theme`，值为 `light` / `dark` / `system`（默认 `system`）

**CSS 变量命名（Tier 2 语义层）：**
- `:root` = 浅色主题：暖奶油底色（`30 25% 94%`）、赤陶橙强调色（`22 54% 49%`）
- `.dark` = 深色主题：暖深褐底色（`45 5% 16%`）、暖金橙强调色（`24 57% 62%`）
- Tailwind 通过 `hsl(var(--xxx))` 映射，组件代码无需关心当前主题

**Tailwind 配置：** `darkMode: ['class']` — 已启用 `dark:` 前缀（基于 `.dark` class）

### 2.3 数据流

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
| GET | `/` | 人物列表 | `sort` (created_at/avg_rating/name), `sort_dir` (asc/desc, 默认 desc), `min_rating`, `max_rating`, `tag_ids`（逗号分隔，交集过滤）。响应含 `tags[]` |
| GET | `/{pid}` | 人物详情 | — |
| POST | `/` | 创建人物 | Body: `{name}` |
| PATCH | `/{pid}` | 更新人物 | Body: `{name?, cover_media_id?, tag_ids?: string[]}`（tag_ids 为全量替换） |
| DELETE | `/{pid}` | 删除人物 | `mode` (person_only/person_and_albums/all) |

### 3.2 图集 `/api/albums`

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| GET | `/` | 图集列表 | `person_id`, `sort`, `sort_dir` (asc/desc, 默认 desc), `min_rating`, `tag_ids`（逗号分隔，交集过滤）。响应含 `tags[]` |
| GET | `/{aid}` | 图集详情 | — |
| GET | `/by-person/{pid}` | 人物下图集 | `sort`, `sort_dir` (asc/desc, 默认 desc), `min_rating`, `tag_ids`（逗号分隔，交集过滤）。响应含 `tags[]` |
| POST | `/` | 创建图集 | Body: `{name, person_id?}` |
| PATCH | `/{aid}` | 更新图集 | Body: `{name?, cover_media_id?, person_id?, tag_ids?: string[]}`（tag_ids 为全量替换） |
| DELETE | `/{aid}` | 删除图集 | `mode` (album_only/album_and_media/move_to_album), `target_album_id?` |
| POST | `/cleanup-empty` | 清理空图集 | `person_id?`（可选，限定某人物范围）。删除所有无媒体的空图集，返回 `{deleted_count, deleted_albums[]}` |

### 3.3 媒体 `/api/media`

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| POST | `/scan` | 扫描路径，返回每个路径的媒体总数和已存在数 | Body: `{paths[], recursive?}`。返回 `{results: [{path, total, existing}]}`，多路径时追加 `path="_total"` 汇总 |
| POST | `/import` | 导入媒体 | Body: `{paths[], person_id?, album_id?, album_name?}` |
| GET | `/import/{token}` | 导入进度 | — |
| POST | `/import/{token}/cancel` | 取消导入 | — |
| POST | `/import-clipboard` | 剪贴板导入 | FormData: `file` |
| POST | `/upload-files` | 移动端文件上传导入 | FormData: `files[]`, `person_id?`, `album_id?`。文件保存至 `AppData/imports/upload/`，返回 `{imported, media_ids[]}` |
| POST | `/backfill-dimensions` | 补填图片尺寸 | — |
| GET | `/album/{album_id}` | 图集内媒体 | `sort`, `sort_dir` (asc/desc, 默认 desc), `min_rating`, `source_type`, `media_type`。`source_type` 未指定时启用 DFS 重排（生成图紧跟原图） |
| GET | `/person/{pid}/loose` | 人物未分类 | `sort`, `sort_dir` (asc/desc, 默认 desc), `min_rating`, `source_type`, `media_type`。`source_type` 未指定时启用 DFS 重排 |
| GET | `/explore` | 随机浏览 | `person_id?`, `album_id?`, `min_rating?`, `media_type?` |
| GET | `/{mid}` | 媒体详情 | — |
| GET | `/{mid}/tree` | 生成链树 | — |
| PATCH | `/{mid}` | 更新媒体 | Body: `{rating?, album_id?, person_id?}` |
| PATCH | `/{mid}/progress` | 保存视频播放进度 | Query: `position` (float, 秒)。position=0 清除进度 |
| PATCH | `/batch` | 批量更新 | Body: `{ids[], rating?, album_id?, person_id?}` |
| POST | `/{mid}/detach` | 脱离生成链 | 无 Body。将 parent_media_id、workflow_type、generation_params 置为 null，source_type 改为 local。子代保持关联形成新独立树 |
| POST | `/batch-detach` | 批量脱离生成链 | Body: `{ids[]}` → 清除 parent_media_id、workflow_type、generation_params，source_type 改为 local。返回 `{detached[]}` |
| PATCH | `/{mid}/relocate` | 重定位文件 | Body: `{new_path}` |
| POST | `/batch-relocate` | 批量重定位 | Body: `{old_prefix, new_prefix}` |
| GET | `/{mid}/descendants-count` | 查询子图数量 | 返回 `{count}` |
| DELETE | `/{mid}` | 软删除 | Query: `mode`(cascade/reparent, 默认 cascade)。cascade=级联删除所有子图；reparent=仅删自身，子图归属到父节点 |
| POST | `/batch-delete` | 批量软删除 | Body: `{ids[], mode?}`（mode 同上，默认 cascade） |
| POST | `/{mid}/upload-mask` | 上传蒙版 | FormData: `mask` (PNG) |
| POST | `/{mid}/show-in-explorer` | 打开资源管理器 | — |
| POST | `/{mid}/crop` | 图片裁剪 | FormData: `file` (裁剪后图片), Query: `overwrite` (bool, 默认 false)。overwrite=true 覆盖原文件，否则存入 `generated/crop/` 创建新媒体。返回 MediaItem |
| POST | `/{mid}/upload-crop` | 上传工作流临时裁剪 | FormData: `file` (裁剪后图片)。存入 `cache/crops/`（自动清理），返回 `{crop_path: string}` |
| POST | `/{mid}/trim` | 视频剪辑 | Body: `{start: float, end: float, precise: bool}`。precise=false 使用 ffmpeg stream copy，precise=true 使用 re-encode。结果存入 `generated/trim/`，返回 MediaItem |
| POST | `/{mid}/screenshot` | 视频截图 | FormData: `file`, `timestamp?` (float，视频时间戳) |
| POST | `/by-ids` | 批量按 ID 获取媒体 | Body: `{ids[]}` |
| POST | `/check-files` | 批量检测文件存在性 | Body: `{ids[]}`，返回 `{missing: string[]}` |
| GET | `/{mid}/nav-context` | LightBox 导航上下文 | Query: `sort?`(sort_order/created_at/rating, 默认sort_order), `sort_dir?`(asc/desc, 默认asc), `source_type?`, `filter_rating?`, `media_type?`；返回 `{album_id, person_id, local_items[], album_order[], person_order[]}`。传入排序/筛选参数以保持与打开页面一致的显示顺序 |
| POST | `/fix-ownership` | 修复 ownership 不一致 | 扫描所有 album_id 非空的媒体，若 media.person_id != album.person_id 则清空 album_id（变为未分类）。返回 `{fixed_count, fixed: [{id, reason: "person_mismatch", media_person_id, album_person_id, old_album_id}]}` |

**约束保护**：
- `PATCH /api/media/batch` 设置 album_id 时自动同步 person_id = album.person_id
- 移动到其他人物时前端同时发送 `album_id: ""` 清空图集归属

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
| POST | `/{task_id}/retry` | 重试任务 | failed/cancelled/completed，创建新任务（新 ID）并返回，原任务保留不变 |
| POST | `/{task_id}/cancel` | 取消任务 | 仅 pending/running → cancelled |
| DELETE | `/{task_id}` | 删除任务 | 非 running |
| POST | `/bulk-delete` | 批量删除任务 | Body: `{statuses: ["pending", "failed", "cancelled"]}` → `{deleted: number}`。删除所有匹配状态的任务 |
| POST | `/batch` | 批量 AI 任务 | Body: `{workflow_type, media_ids?, album_id?, source_param_name, shared_params, target_person_id?, chain_step?}` → `{tasks_created, chains_created, skipped_generated, batch_id}`。仅处理本地图/截图，跳过 AI 生成图。结果逐张加入原图生成链，不创建结果图集。所有创建的任务共享同一 `batch_id` |
| POST | `/chain` | 创建链式任务 | Body: `{first: TaskCreate, then: [{workflow_type, params, chain_source_param}], execution_mode}` → 返回链内所有任务（共享 `chain_id`）。第二步的 `chain_source_param` 指定接收上一步结果的参数名。`then` 数组上限从 1 提升到 5，支持多步链式任务 |

**批量任务新增字段：**

- **新增请求字段：**
  - `chain_step`: Optional[ChainStepCreate] — 为每张图附加链式下一步

- **新增响应字段：**
  - `chains_created`: 创建的链式任务组数量
  - `skipped_generated`: 跳过的 AI 生成图数量

**链式任务响应字段：** `_task_dict` 序列化时额外包含 `chain_id`、`chain_order`、`chain_source_param`、`chain_tasks`（同链其他任务摘要列表）。

**链式任务行为：**
- 取消链中任一步骤 → 后续步骤级联取消
- 重试 `chain_order=0` → 重建整条链（新 chain_id）
- 重试 `chain_order>0` → 若存在失败/取消的前置步骤则重建整条链（重置 `__chain_input__` 占位符），否则创建独立任务（无 chain_id）
- `PATCH /reorder` 校验同一 chain 内的相对顺序不被打乱（注：前端已移除拖拽排序 UI，但后端 API 保留）

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

### 3.9 启动器仪表盘 `/api/launcher`

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/status` | 聚合状态：后端运行时间/PID、ComfyUI 连接、已连接设备列表、错误统计、磁盘空间 |
| POST | `/comfyui/start` | 启动 ComfyUI（使用设置中的启动命令） |
| POST | `/comfyui/stop` | 停止 ComfyUI 进程 |
| POST | `/restart-backend` | 延迟 1 秒后退出后端进程（由启动器检测并重启） |
| GET | `/logs` | 读取 `.logs/` 下的后端日志（query: `lines`，默认 50） |

**中间件**：`main.py` 中注册了 `launcher_tracking_middleware`，自动追踪所有 `/api/` 请求的客户端 IP（30 分钟活跃窗口）和 4xx/5xx 错误记录（最近 200 条）。

### 3.10 文件服务（main.py 内）

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/api/files/thumb` | 缩略图（`FileResponse` + ETag/304 + `Cache-Control: immutable, max-age=604800`；支持图片和视频，视频用 OpenCV 提取第一帧） |
| GET | `/api/files/serve` | 原始文件流式传输（支持 HTTP Range 请求，视频 seek 必需；有 Range 头时返回 206 + `Content-Range`，无则返回完整文件 + `Accept-Ranges: bytes`） |
| GET | `/api/files/pick-folder` | 系统文件夹选择对话框 |
| GET | `/api/files/pick-files` | 系统文件选择对话框 |
| GET | `/api/files/list-subfolders` | 递归列出子文件夹 |
| GET | `/api/health` | 健康检查 |

### 3.11 下载器 `/api/download`

**单条下载端点：**

| Method | 路径 | 说明 |
|---|---|---|
| POST | `/parse` | 解析粘贴文本，提取链接并返回元数据预览 |
| POST | `/confirm` | 确认下载：下载图片到 AppData/downloads，创建 Album/Media/DownloadRecord 记录 |
| GET | `/records` | 下载记录列表（分页；query: `page`, `page_size`, `platform`） |
| POST | `/records/{id}/retry` | 重试失败的下载记录 |
| GET | `/info-by-album/{albumId}` | 查询图集的下载来源信息 |

**批量扫描/下载端点：**

| Method | 路径 | 说明 |
|---|---|---|
| POST | `/scan-account` | 启动账号扫描，Body: `{platform, username, display_name?}` → `{job_id}` |
| GET | `/scan-jobs/{job_id}` | 轮询任务状态，返回 `{job_id, status, display_name, total_notes, skipped_notes, total_media, completed_notes, failed_notes, downloaded_media, notes?, error?}` |
| POST | `/batch-confirm` | 确认批量下载，Body: `{job_id, person_id?, create_person_name?, album_mode, remember_account}` |
| POST | `/scan-jobs/{job_id}/cancel` | 取消任务 |

**平台账号端点**（挂在同一路由下）：

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/platform-accounts` | 平台账号列表 |
| PATCH | `/platform-accounts/{id}` | 更新账号关联的人物 Body: `{person_id}` |
| DELETE | `/platform-accounts/{id}` | 删除账号记录（不影响已下载的图片） |

**抓取器架构**（`backend/scrapers/`）：

- `base.py`：`BaseScraper` 抽象基类 + `ScraperResult` / `MediaItem` / `NotePreview` / `AccountScanResult` 数据类
  - `ScraperResult.extra: dict`：平台特有数据（如抖音 `sec_uid`）
  - `list_user_notes(user_id, cursor?)` → `AccountScanResult`：账号扫描接口（子类实现）
- `xiaohongshu.py`：小红书解析器
  - **单条解析**：Playwright sync API 在 ThreadPoolExecutor 中运行（避免 Windows uvicorn ProactorEventLoop 不支持 subprocess 的问题）；使用 Cookie 认证浏览器 + API 响应拦截（拦截 `/api/sns/web/v1/feed`），回退到 `__INITIAL_STATE__` JSON 解析；需在设置页配置小红书 Cookie
  - **账号扫描**：Playwright 加载用户主页 + Cookie 认证，拦截浏览器 JS 自动签名的 `/api/sns/web/v1/user_posted` API 响应，滚动分页获取所有图文笔记；同时从响应中提取每张图片的完整 URL（`image_list[].info_list` 中 `WB_DFT` 场景），存入 `NotePreview.image_urls`
  - **反爬策略**：XHS 阻止 headless 浏览器直接访问笔记页面（302 到 404，error_code=300031），因此批量下载不逐条解析笔记，而是在扫描阶段一次性收集所有图片 URL
  - **URL 规范化**：所有 `source_url` 统一存储为 `https://www.xiaohongshu.com/explore/{note_id}` 格式，去重按 `note_id` 匹配而非完整 URL
  - 支持链接格式：`xhslink.com/xxx`、`xiaohongshu.com/explore/xxx`、`xiaohongshu.com/discovery/item/xxx`
- `douyin.py`：抖音解析器（Cookie HTTP，需在设置页配置 Cookie）
  - **单条解析**：从 `self.__pace_f.push()` RSC flight data 提取笔记数据；字段全部 camelCase（`authorInfo`、`urlList`、`createTime`）；`username` 使用 `secUid`（非数字 uid）
  - **账号扫描**：调用 `/aweme/v1/web/aweme/post/` API，按 `sec_user_id` 分页，筛选 `aweme_type=68`（图文笔记）
  - 支持链接格式：`douyin.com/note/xxx`、`douyin.com/video/xxx`、`douyin.com/user/xxx?modal_id=xxx`（自动转换为 `/note/` URL）、`v.douyin.com/xxx`（短链自动跟踪重定向）
- `__init__.py`：`SCRAPERS` 列表 + `get_scraper(text)` 自动匹配平台

**批量下载架构**（`backend/batch_downloader.py`）：

- `BatchJob` 数据类：内存状态机（scanning → scan_complete → downloading → completed/failed/cancelled）
- `run_scan(job, db_factory)`：异步扫描任务，完成后按 `note_id` 查询 DownloadRecord 去重（跳过已下载且图集仍存在的笔记）；扫描结果包含预收集的 `image_urls`
- `run_batch_download(job, db_factory)`：异步下载任务，优先使用扫描阶段预收集的 `image_urls` 直接下载（避免逐条解析触发反爬），仅在无预收集 URL 时回退到 `scraper.parse()`；per_note 模式仅在有文件下载成功时创建 Album（避免空图集）
- 进度通过 `GET /scan-jobs/{job_id}` 前端 2 秒轮询获取，响应包含 `platform`/`username` 字段
- `NotePreview.image_urls: list[str]`：扫描阶段收集的完整图片 URL 列表，序列化到 Job notes 中供下载阶段使用

**前端超时**：`/parse` 和 `/confirm` 请求超时设为 120 秒（Playwright 启动 + 页面加载耗时较长）

### 3.12 工作流管理 `/api/workflows` + `/api/workflow-categories`

| Method | 端点 | 说明 |
|---|---|---|
| GET | `/api/workflow-categories` | 返回 category 契约列表（face_swap/inpaint/upscale/text_to_image/image_to_image/preprocess） |
| POST | `/api/workflows/parse` | 解析 ComfyUI API JSON，返回 @-标记节点的图片输入/标量参数/图片输出/文本输出。前端自动映射时使用包含匹配（节点标签包含契约参数名即匹配） |
| GET | `/api/workflows?category=xxx` | 列出工作流（可按 category 过滤） |
| GET | `/api/workflows/:id` | 获取完整工作流（含 workflow_json 和 manifest） |
| POST | `/api/workflows` | 注册新工作流（Body: name, category, workflow_json, manifest, description?, is_default?, overwrite_id?）；manifest 校验失败 → 422，重名 → 409 |
| PUT | `/api/workflows/:id` | 更新工作流（name?, description?, workflow_json?, manifest?） |
| DELETE | `/api/workflows/:id` | 删除工作流 |
| PATCH | `/api/workflows/:id/default` | 设为该 category 的默认工作流 |

#### POST /api/workflows/composite

创建复合工作流。

**请求体：**
```json
{
  "name": "换脸+高清放大",
  "description": "先换脸再高清放大",
  "steps": [
    {"workflow_id": "aaa-bbb", "params_override": {}},
    {"workflow_id": "ccc-ddd", "params_override": {"upscale_factor": 2}}
  ]
}
```

**验证：**
- 至少 2 步，展开后不超过 10 步
- 循环引用检测（DFS）
- 自动检测每步的 source_param

**响应：** WorkflowFull（含 composite_steps 和步骤详情）

### 3.13 标签 `/api/tags`

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| GET | `/` | 标签列表 | 响应含 `person_count`, `album_count` |
| POST | `/` | 创建标签 | Body: `{name}` |
| PATCH | `/{tag_id}` | 重命名标签 | Body: `{name}` |
| DELETE | `/{tag_id}` | 删除标签 | — |
| POST | `/{tag_id}/merge` | 合并标签 | Body: `{target_id}`，将当前标签的关联迁移到目标标签后删除当前标签 |
| PATCH | `/reorder` | 重排序 | Body: `{tag_ids: [...]}` 按数组顺序更新 sort_order |

---

## 4. 数据模型

### 4.1 Person

```
id (UUID PK), name, cover_media_id (FK→Media?),
avg_rating (float?), rated_count (int),
created_at, updated_at
```

**API 响应额外字段**：`cover_file_path`（解析后路径）、`media_count`、`album_count`、`accounts[]`（关联的平台账号列表，每项含 `id`、`platform`、`username`、`display_name`）

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
video_timestamp (float?),
playback_position (float?),
thumbnail_path, is_deleted, deleted_at,
created_at, updated_at
```

索引：`(person_id, is_deleted)`, `(album_id, sort_order)`, `(rating)`, `(is_deleted, deleted_at)`, `(parent_media_id)`

### 4.4 Task

```
id (UUID PK), workflow_type, params (JSON),
status (pending|running|completed|failed|cancelled),
queue_order, execution_mode (immediate|queued),
result_media_ids (JSON), result_outputs (JSON),
error_message, created_at, started_at, finished_at,
chain_id (UUID?), chain_order (int?), chain_source_param (string?),
batch_id (String? indexed) — 批量任务分组 ID，由 POST /tasks/batch 设置
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

### 4.7 Workflow

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String(36) PK | UUID |
| name | String(200) | 工作流名称，全局唯一 |
| category | String(50) | 类别 |
| description | Text? | 描述 |
| is_default | Boolean | 该 category 的默认工作流 |
| workflow_json | Text | ComfyUI API 格式 JSON |
| manifest | Text | 参数映射：`{"mappings": {param: {node_id, key, type}}, "output_mappings"?: {display_label: {node_id, key:"text"}}, "extra_params"?: [{name, label, type, node_id, key}]}`。output_mappings 外层 key 为显示标签，内层 key 固定为 ComfyUI 输出字段名（通常 `text`） |
| is_composite | Boolean | 是否为复合工作流 | default=false |
| composite_steps | Text | 复合步骤 JSON | nullable |
| created_at | DateTime | |
| updated_at | DateTime | |

### 4.8 Tag

```
id (UUID PK), name (String(100) UNIQUE),
color (String(20)?), sort_order (Integer),
created_at (DateTime)
```

### 4.9 PersonTag（关联表）

```
person_id (FK→Person PK), tag_id (FK→Tag PK)
```

### 4.10 AlbumTag（关联表）

```
album_id (FK→Album PK), tag_id (FK→Tag PK)
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

### 5.1.1 链式任务执行

当 `_execute_next_task()` 取到的任务有 `chain_id` 且 `chain_order=0` 时，进入链式执行模式：

1. 执行第一步，完成后将 `result_media_ids[0]` 写入第二步的 `params[chain_source_param]`
2. 立即执行第二步（不重新入队，不允许其他任务插入）
3. 全部成功：最终结果 reparent 到第一步的原始源图（`parent_media_id` 指向原始输入），中间结果软删除
4. 第二步失败：第一步结果保留为正常生成图，不回滚

**自定义工作流输出兼容：** 自定义工作流的图片输出有两种路径：标准 SaveImage 节点（`client.run_workflow()` 返回的 `results`）和 `output_mappings` 捕获的 PreviewImage 节点。当 SaveImage 无输出但 `output_mappings` 产出了图片时，`_run_custom_workflow` 会自动将这些图片从预览缓存提升为正式 Media 记录（移动到 `generated/<category>/` 目录），确保 `result_media_ids` 非空，链式后续步骤能正确获取前置输出。

**独立任务校验：** `POST /api/tasks` 创建独立任务时，如果 `params` 中包含未解析的链式占位符 `__chain_input__`，直接返回 400 错误，防止无效任务进入队列。

### 5.1.2 启动恢复

服务重启时，`main.py` startup 事件自动将所有遗留的 `running` 状态任务标记为 `failed`（错误信息："服务重启时任务仍在执行，已标记为失败（可重试）"），防止僵尸任务阻塞队列。

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
| `media` | 媒体 CRUD + 多选 | fetchByAlbum, fetchLoose, updateMedia, softDelete(id, mode?), replaceItem, toggleSelection, selectAll, clearSelection, batchRate, batchDelete(mode?), batchMoveToAlbum |
| `lightbox` | LightBox 双轴导航（`stores/lightbox.ts`） | openLightbox, closeLightbox, goHorizontal(dir), goVertical(dir), goToChainNode(id), setFlatMode, invalidateChainCache — 状态: localItems, localIndex, chainFlat, chainIndex, chainCache, albumOrder, personOrder, flatMode。mediaStore 的 openLightbox/closeLightbox/lightboxNext/lightboxPrev 委托到此 store |
| `task` | 任务 + 3 秒轮询 | fetchTasks, fetchStats, startPolling, stopPolling — fetchStats 检测 `completed_since_last_view` 递增时自动调用 `lightboxStore.invalidateChainCache()` |
| `workspace` | 工作区 CRUD | fetchItems, addItem, batchAdd, removeItem, clear, reorder |
| `system` | 系统状态/配置 | fetchStatus, fetchConfig, updateConfig |
| `workflow` | `useWorkflowStore` | categories, workflows, parseResult — 工作流管理 |
| `tag` | 标签 CRUD + 关联 | fetchTags, createTag, updateTag, deleteTag, mergeTag, reorderTags |
| `download` | 网页抓取 + 批量扫描 | parseUrl, confirmDownload, fetchRecords, retryRecord, fetchAccounts, startScan, pollScanJob, confirmBatch, cancelScan, clearScanJob — 状态: parseResult, scanJob, scanning |

### 6.2 Store 加载态规范

所有 store 的 `loading` 初始值为 `false`。加载中显示空白页面（不使用骨架屏），EmptyState 仅在 `!loading` 确认数据为空后才显示。

**渲染条件模式**：

```tsx
{items.length === 0 && !loading ? <EmptyState /> : <DataGrid />}
```

- **空白**：加载中（`loading=true` 且无数据）时页面留空，不显示任何占位组件
- **empty state**：仅在 `loading=false` 且数据确认为空时显示
- **data**：有数据时始终显示，即使后台正在刷新（re-fetch 不闪烁）

**实体切换防旧数据残留**（同组件不同 ID 导航时）：

共享 store 的数据在路由参数变化时不会自动重置，需在 `useEffect` 中按需清除旧数据：

```tsx
// AlbumDetail: 仅在切换到不同图集时清除旧数据
useEffect(() => {
  const { currentAlbum } = useAlbumStore.getState()
  if (!currentAlbum || currentAlbum.id !== albumId) {
    useMediaStore.setState({ items: [], loading: true })
  }
  fetchAlbum(albumId); fetchByAlbum(albumId)
}, [albumId])
```

同理 PersonHome 在 `currentPerson?.id !== personId` 时清除 `albums` / `looseItems`，并用 `currentPerson?.id !== personId` 守卫渲染。

已应用的页面：MediaLibrary、AlbumDetail、RecycleBin、PersonHome、Workspace、TaskQueue。

### 6.3 任务角标轮询

`task.ts` 的 `startPolling()` 每 3 秒请求 `GET /api/tasks/stats`，返回：

```json
{ "running": 1, "failed": 0, "pending": 5, "completed_since_last_view": 3 }
```

Sidebar/BottomNav 显示角标（优先级从高到低，仅显示最高优先级的一个）：
- 运行中：旋转动画（蓝色 Loader）
- 待开始：蓝色数字角标（pending 数量）
- 失败：红色数字
- 完成：绿色数字（进入任务页后清零）

**全屏切换**：
- 桌面端 Sidebar：底部（ComfyUI 状态指示灯上方）放置全屏按钮，调用 Fullscreen API
- 移动端 BottomNav：仅显示图标（无文字标签），包含小工具入口（Wrench 图标，路由 `/tools`）。全屏按钮也仅显示图标，通过 `fullscreenchange` 事件监听器同步按钮状态

---

## 7. 关键组件说明

### 7.1 LightBox（大图浏览）

- **组件拆分**：`lightbox/` 目录，LightBox.tsx（主容器）、LightBoxTopBar.tsx（顶部操作栏）、LightBoxMedia.tsx（主图/视频）、LightBoxContextMenu.tsx（右键菜单）、ChainIndicator.tsx（生成链指示器）、ThumbnailStrip.tsx（底部缩略图条）、hooks/useLightboxInput.ts（统一输入）
- **双轴导航**：水平轴（← → / 左右滑动）在本地图间导航，支持跨图集/跨人物；垂直轴（↑ ↓ / 滚轮 / 上下滑动）在生成链中深度优先遍历。状态由独立 `lightbox` store（`stores/lightbox.ts`）管理。navigateV(-1) 在根节点时切换到上一张本地图。随机探索模式使用 flatMode（保持 shuffled 顺序）
- **滚轮映射**：图片/黑边区域滚轮 = 垂直轴（生成链导航）；底部预览条滚轮 = 滚动预览条本身（不触发导航）；弹窗覆盖层（`[role="dialog"]`）滚轮不触发导航
- **ChainIndicator**：替代旧右侧生成链面板，位于主图区与底部缩略图条之间。无生成图时高度收为 0 不显示，有生成图时显示紧凑单行链节点。展开态为水平树布局（横向=深度层级，纵向=同级按时间排列，SVG 曲线连接父子）。`taskResultsMode` 下不显示，改为 SourceButtons
- 全屏覆盖，createPortal 挂载到 body
- 键盘导航：← → 本地图导航（水平轴），↑ ↓ 生成链导航（垂直轴），1-5 评分，Esc 退出。焦点在 input/textarea 时方向键不拦截。放大模式下方向键导航但保持缩放
- **移动端滑动切换**：左右滑动 = 水平轴（本地图），上下滑动 = 垂直轴（生成链）；速度阈值（velocity>0.3px/ms 且 |dx|>20px）或距离阈值（|dx|>60px）触发切换；视频模式下通过 Touch Arbiter 仲裁
- **移动端右键菜单**：两指同时触碰触发（替代长按，避免与视频倍速冲突），LightBox handleTouchStart 检测 `touches.length >= 2`，handleTouchEnd 时打开 contextMenu
- 放大模式（PC）：单击/双击进入，CSS transform 缩放（1x~8x），鼠标移动即平移（无需拖拽，鼠标在原图位置与放大图对应位置精确重合），鼠标指针替换为 SVG 放大镜（CSS `cursor: url(data-uri)` 原生渲染），鼠标移出原图范围时隐藏放大图并恢复默认指针，单击/右键/Esc 退出。useImageZoom hook 管理，ref+rAF 60fps 直接 DOM 操作。hook 暴露 `isPointOnImage()` 方法供 LightBox 判断点击位置，黑边点击不拦截冒泡（触发 closeLightbox）
- **左右导航条**（PC）：左右边缘全高长条（`w-28`），hover 显示 `bg-white/20` 半透明背景 + 方向箭头图标，光标替换为 SVG 方向箭头（`cursor: url(data-uri)`）；首张/末张时隐藏对应导航条；移动端不显示
- **相邻图片预加载**：`LightBox.tsx` 内 useEffect 监听 `item?.id` 变化，按优先级预加载前后共 8 张图片（偏移量 +1, -1, +2, -2, +3, -3, +4, +5，近处优先、前进方向偏重）。图片通过 `new Image()` 触发浏览器缓存，视频通过 `<link rel="preload">` 预获取
- **背景**：纯黑不透明（`bg-black`），不透出底层页面
- 放大模式（移动端）：双指捏合 pinch-to-zoom 缩放图片（1x~8x），单指拖拽平移，单击恢复原始大小
- 沉浸模式：全屏，隐藏所有 UI，保留键盘操作
- 底部缩略图条（ThumbnailStrip）：仅本地图，滚动高亮当前本地原图，点击跳转（水平轴导航）
- 右键菜单（LightBoxContextMenu）：封面设置、AI 功能子菜单（放大/换脸/局部修复 → `onAiAction(category, media)`，仅 image）、静音（仅 video）、工作区、移动到图集、移动到其他人物、资源管理器、生成链/脱离生成链（`taskResultsMode` 下隐藏）、评分、删除
- **视频模式**：视频媒体使用独立 `<VideoPlayer>` 组件替代图片显示区域

### 7.1.1 VideoPlayer（视频播放器）

- **架构**：双 `<video>` 元素 A/B 交替 + `requestVideoFrameCallback` 首帧 swap，消除切换黑闪；非活跃 slot 加 `invisible` 防止不同宽高比残影；全自定义 Tailwind UI + 手势系统
- **Props**：`src`、`poster`、`autoPlay`、`initialMuted`、`initialTime?`（播放恢复位置）、`onMutedChange`、`onProgressSave?`（播放进度保存回调）、`onScreenshot`、`isLandscape`、`onLandscapeChange`、`touchArbiter?`、`onContextMenu?`；通过 `forwardRef` 暴露 `VideoPlayerHandle`（`toggleMute()`），供 LightBox 右键菜单调用
- **播放进度记忆**：`initialTime` 在 `loadedmetadata` 后 seek 到保存位置（距结尾 3s 内不恢复），显示"从 X:XX 继续播放"提示 2.5s。`onProgressSave` 在暂停/定时 15s/离开视频时调用，位置变化 > 2s 才保存；播完自动清除进度（position=0）。LightBoxMedia 将 `item.playback_position` 和 `mediaApi.saveProgress(id, time)` 传入。进度存储在 DB，多设备共享
- **关闭行为**：视频区域 `onClick` 计算 `object-contain` 实际渲染矩形，点击 letterbox 黑边不阻止冒泡（LightBox 关闭），点击视频内容区域 `stopPropagation`（保持打开）
- **静音策略**：LightBox 维护 `sessionUnmuted` 状态，首视频自动静音，用户取消静音后后续视频不再静音
- **控件（VideoControls，z-10 置于手势层之上）**：
  - 可点击/拖拽进度条（pointerDown 即时 seek + document 级 pointermove/pointerup 拖拽），拖拽中实时 seek 视频画面，`handleSeek` 同步更新 `setCurrentTime` 避免松开时进度条闪回；含缓冲进度显示
  - 音量按钮（静音切换，PC/移动端均显示）+ 音量滑块（仅 PC hover 展开）
  - **移动端溢出菜单**：控件栏精简为「播放 | 音量 | 时间 | ··· | 横屏」，`···`（MoreHorizontal）弹出菜单包含倍速选择（横排按钮）、上一帧、下一帧、截图；点击外部关闭
  - **PC 端**：倍速选择菜单（0.5x–3x）、逐帧步进（±1/30s）、截图、全屏切换直接显示在控件栏
  - 截图：Canvas → `toBlob` + `currentTime` → `onScreenshot(blob, timestamp)` → API 上传并写入 `video_timestamp` 字段，截图后 Toast 提示"截图已保存"+ 可选"高清放大"按钮，不强制放大
  - 移动端横屏按钮 = 全屏（不再单独显示全屏按钮），图标用 Maximize/Minimize
  - 布局模式：`bottom-bar`（PC 非全屏，视频下方）/ `overlay`（横屏/全屏，底部悬浮渐变背景）
- **自动隐藏（useControlsAutoHide）**：PC 鼠标 3s 无移动隐藏；移动端单击切换
- **Touch Arbiter（useTouchArbiter）**：统一手势仲裁状态机，LightBox 创建 arbiterRef 并传入 VideoPlayer → VideoGestureLayer / VideoControls。状态流：`idle → pending → seeking/swiping/swiping_vertical/speed_control → idle`。`claimGesture(arbiter, desired)` 仅在 `pending` 或已持有时成功，防止多手势竞争冲突
- **手势层（VideoGestureLayer）**：接收 `touchArbiter` + `duration`/`currentTime`/`onSeek` + `onSeekingStart`/`onSeekingEnd`，阻止原生 `contextmenu`。200ms 定时器 claim `speed_control`（期间任何水平移动 >1px 立即取消定时器，确保拖拽优先）。横屏时水平拖拽（|dx|>5px）claim `seeking`，映射范围 min(duration, 600s)；拖拽开始暂停视频 + 显示进度条，结束恢复播放 + 隐藏进度条。竖屏时不 claim（交 LightBox 做 swiping）。两指触碰时取消长按定时器，交由 LightBox 处理
- **倍速控制（useSpeedControl）**：长按 200ms（无移动）→ 2x，左右滑调速（40px/0.25x），上滑锁定，松开恢复
- **进度条手势协调**：VideoControls 在 progressPointerDown 时立即 `claimGesture('seeking')`，阻止 LightBox swipe 和 speed_control 竞争；pointerUp 时 resetArbiter
- **SpeedIndicator**：顶部居中倍速提示条，显示当前倍速 + 锁定图标
- **横屏模式（useOrientationMode）**：LightBox 使用 `useOrientationMode` hook，进入横屏时先 `requestFullscreen()` 再 `screen.orientation.lock('landscape')`，退出时 `unlock()` + `exitFullscreen()`。横屏时 LightBox TopBar 高度收为 0 + 缩略图条隐藏
- **键盘快捷键**：空格（播放/暂停）、←/→（±5s）、↑/↓（音量 ±10%）、F（全屏），视频模式时 LightBox 不拦截这些按键

### 7.2 MaskEditor（纯遮罩绘制工具）

- **定位**：纯遮罩绘制组件，不含任务提交逻辑。由 WorkflowRunDialog 按需调用
- **Props**：`open`, `onClose`, `media?`（绑定底图）, `canvasSize?`（无底图时指定尺寸）, `onComplete(blob)`（确认回调）
- createPortal 全屏，双 Canvas 架构：
  - 显示画布（屏幕分辨率）：叠加渲染底图 + 蒙版
  - 蒙版画布（原图分辨率，离屏）：记录实际蒙版数据
- 工具：画笔（B）、橡皮（E）、大小调节（[/]）
- 撤销/重做：ImageData 快照栈（最大 50 步），Ctrl+Z / Ctrl+Y
- 缩放：滚轮以指针为中心缩放，中键/Alt+拖拽平移
- 移动端触摸：容器 div 设置 `touch-action: none` 阻止浏览器手势干扰，`setPointerCapture` 确保绘制连续性，双指 pinch-to-zoom 缩放+平移
- 触摸绘制延迟：触摸开始后延迟 80ms 才开始绘制（鼠标不受影响），用于检测是否为多指触控。`drawing` 状态使用 ref 而非 React state，确保 pointer handler 中同步访问
- 部分笔画回退：绘制开始前保存 pre-stroke 快照，若绘制过程中检测到捏合手势，自动回退到快照状态
- 捏合状态管理：捏合状态仅在所有手指抬起后才清除，防止松开一指后误触发绘制
- 移动端画笔：默认大小 20（桌面端 40），范围 5-100（桌面端 5-200）
- 底部操作：取消 / 确认遮罩
- 导出：RGBA PNG（alpha=0 为修复区域，alpha=255 为保留区域）
- 确认时调用 `onComplete(blob)` 返回 mask blob 给调用方

### 7.2.1 WorkflowRunDialog（AI 工作流选择弹窗）

- **定位**：统一的 AI 功能入口，替代旧的 UpscaleDrawer / FaceSwapDrawer / MaskEditor 提交面板
- **Props**：`open`, `onOpenChange`, `category`（upscale/face_swap/inpaint/image_to_image/text_to_image/preprocess）, `sourceMedia`, `initialWorkflowId?`, `initialParams?`
- **数据流**：
  1. 从 `useWorkflowStore` 获取 categories + workflows；调用 `fetchStatus()` 刷新 ComfyUI 连接状态
  2. 按 category 过滤工作流列表，自动选中 `is_default` 的工作流（若提供 `initialWorkflowId` 则优先选中）
  3. 调用 `workflowsApi.get(id)` 获取完整 manifest
  4. 使用共享 `WorkflowParamForm` 组件渲染参数表单
- **默认值提取**：标量参数从 workflow_json 提取默认值；image 类型参数（含 extra_params）不提取默认值；若提供 `initialParams` 则合并覆盖默认值（跳过 `workflow_id` 和 `__chain_input__`）
- **任务提交**：`workflow_type: "custom:{workflowId}"`, `params: { workflow_id, ...formValues }`
- **"编辑参数并新建"流程**：任务队列页右键菜单触发，从 TaskItem 提取 workflow_id → 获取工作流 category → 解析源媒体 → 以 `initialWorkflowId` + `initialParams` 打开对话框
- **布局**：固定 Header + 可滚动 Body（`onWheel stopPropagation` 防止穿透）+ 固定 Footer

### 7.2.2 WorkflowParamForm（共享参数表单组件）

WorkflowRunDialog 和 AiToolsTab 共用的参数渲染组件，避免代码重复。

- **Props**：`categoryParams`, `extraParams`, `params`, `onParamChange`, `onParamClear`, `mediaThumbs`, `maskPreview`, `onPickImage`, `onDrawMask`, `sourceMedia?`, `canDrawMask?`
- **参数类型渲染**：
  - `image` + name 为 `source_image`/`base_image` + sourceMedia 已填入 → 只读显示
  - `image` + `source: "file_path"` → 遮罩参数，"绘制遮罩"按钮 → 回调 `onDrawMask`
  - `image`（其他）→ "选择图片"按钮 → 回调 `onPickImage`
  - `string` → textarea、`int`/`float` → number input、`bool` → Toggle 滑块开关（CSS 实现）
- **extra_params 渲染**：以分隔线 + "额外参数" 标签显示，渲染规则与契约参数完全一致（含 image/mask 类型）

### 7.3 ImportDialog（导入向导）

- 文件选择 / 文件夹选择 / 子文件夹展平
- 每个子文件夹独立配置：图集名、所属人物
- **文件夹名智能拆分**：若文件夹名包含 `_`、`-` 或空格，按第一个分隔符拆分，左侧作为默认人物名，右侧作为默认图集名（如 `Alice_Wedding` → 人物"Alice"，图集"Wedding"）；无分隔符时人物名和图集名均为完整文件夹名
- **人物自动匹配与重名检测**：拆分出的人物名若与数据库已有人物名匹配（不区分大小写），自动切换为"已有人物"模式；多个子文件夹拆分出相同人物名时，仅创建一次，后续复用同一人物 ID。`resolvePersonAlbum` 在创建新人物前会通过 `findPersonByName()` 在已加载的 `persons` 列表中按名称（不区分大小写）查找匹配，匹配到则直接关联已有人物而非新建。所有新建人物输入框下方实时显示 `PersonMatchHint` 提示（"同名人物已存在，将自动关联"，amber 色）
- 进度显示 + 可取消
- **导入中保护**：`importing` 状态下，`onOpenChange` 忽略关闭请求，`onInteractOutside` 和 `onEscapeKeyDown` 调用 `preventDefault()` 阻止对话框关闭
- 路径去重（同路径不重复导入）
- **导入前重复预览**：选择来源后异步调用 `POST /api/media/scan` 扫描，显示每个文件夹的媒体总数/已存在数；子文件夹列表按"有新文件 → 全已存在"排序，全已存在行 `opacity-50`
- **逐个配置已导入标记**：`POST /api/media/list-files` 返回每个文件的 `existing: boolean`。逐个配置/子文件夹逐个视图中，已导入文件显示"已导入"琥珀色标签（`text-amber-500`，置于文件名外层 flex 容器，`shrink-0` 防截断），复选框 `disabled`，全选跳过已导入文件
- **回收站重导入**：后端 import 检测到同路径已软删除记录时，恢复 `is_deleted=False` 并更新关联，而非创建重复记录
- **图集名去重**：三种导入路径（逐个导入、子文件夹逐个、子文件夹批量）均使用 `createdAlbums` Map（key=`personId|albumName`）防止同名图集重复创建
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
- `animIndex?: number` prop：入场 stagger 动画索引，控制 `animate-fade-in-up` 的 `animation-delay`（上限 600ms）
- Hover 效果：`scale-[1.02]` + `shadow-lg shadow-black/30`

### 7.7 MediaCard（媒体卡片）

- 底部渐变叠加（`from-black/70`）显示文件名（从 `file_path` 提取，去除路径和扩展名，`truncate` 截断），格式与 AlbumCard 一致，`pointer-events-none` 不阻断鼠标事件
- 视频播放图标：百分比尺寸 `w-[20%]`，clamp 在 16px–28px 之间（替代原固定 `w-7 h-7`），随卡片大小自适应
- `compact?: boolean` prop：同 PersonCard/AlbumCard 阈值，隐藏文件名渐变叠层和评分徽章
- `animIndex?: number` prop：同 PersonCard/AlbumCard，入场 stagger 动画
- Hover 效果：`scale-[1.02]` + `shadow-lg shadow-black/30`

### 7.8 FilterBar（筛选栏）

- 排序下拉：`w-[5.5rem] sm:w-32`、`h-7 sm:h-8`、`text-xs`
- 评分/来源下拉：`w-20 sm:w-28`、`h-7 sm:h-8`、`text-xs`
- 各页面使用情况：
  - 人物库：排序 + 评分 + 标签（PersonStore）
  - 人物主页·图集区：排序 + 评分 + 标签（AlbumStore）
  - 人物主页·未分类区：排序 + 评分 + 来源（MediaStore）
  - 图集详情：排序 + 评分 + 来源（MediaStore）
- 标签筛选：以 tag chips 形式展示，点击切换选中状态，支持多选交集过滤
- 每次进入页面调用 `resetFilters(pageKey)` 从 `lib/filterDefaults.ts` 读取默认值
- FilterBar 纯展示组件，onChange 由页面手动调用 store.fetch

### 7.8.1 筛选默认值配置（`lib/filterDefaults.ts`）

- 参照 `zoomDefaults.ts` 模式，localStorage key: `motif-filter-defaults`
- 全局默认值：`filterRating`（评分筛选）、`sourceType`（来源类型），默认均为 `''`（全部）
- 每页排序默认值：`SortPageKey` = `media-library` / `person-albums` / `person-loose` / `album-detail`
- **排序值格式**：`field:dir`（如 `created_at:desc`、`avg_rating:asc`）。`parseSortValue(value)` 解析为 `{field, dir}`，兼容不带 `:dir` 的旧值（默认 `desc`）
- API：`getSortDefault(page)` / `setSortDefault(page, value)` / `getFilterDefault(key)` / `setFilterDefault(key, value)` / `getAllFilterDefaults()` / `parseSortValue(value)`
- 设置页 onChange 即时写入 localStorage，无需保存按钮
- **旧值迁移**：`getSortDefault()` 读取时自动检测不带方向后缀的旧值并追加默认方向

### 7.8.2 ConfirmDialog（全局确认弹窗）

替代浏览器原生 `confirm()` 的统一确认弹窗，基于 Zustand store + Radix Dialog，与项目整体 UI 风格一致。

- **文件**：`components/ConfirmDialog.tsx`（store + 组件 + `confirm()` 快捷函数）
- **挂载**：`app/layout.tsx` 全局挂载 `<ConfirmDialog />`
- **用法**：`import { confirm } from '@/components/ConfirmDialog'`，在 `async` 函数中 `if (await confirm({ title, description?, variant? })) { ... }`
- **参数**：`title`（标题）、`description?`（副标题说明）、`confirmText?`（确认按钮文字，默认"确定"）、`cancelText?`（取消按钮文字，默认"取消"）、`variant?`（`'destructive'`（默认，红色）或 `'default'`）
- **返回**：`Promise<boolean>`，用户点确认返回 `true`，取消/关闭返回 `false`

### 7.9 页面头部/工具栏响应式

所有页面（MediaLibrary、PersonHome、AlbumDetail）的头部在移动端：
- 操作按钮仅显示图标，文字通过 `hidden sm:inline` 隐藏
- 缩减内边距 `px-3`（桌面端 `px-6`）
- 缩小高度 `h-12`（桌面端默认）
- 缩小字号

内容区域：
- 侧边距 `px-1 sm:px-6`
- 底部内边距 `pb-28 md:pb-4` 为移动端底部导航栏预留空间（所有页面均需添加，包括 Tools、TaskQueue、Settings）

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
| `run_workflow(workflow)` | 提交 /prompt → WebSocket 监听进度（heartbeat=30s, 空闲超时 120s） → 获取输出图片。WS 断开或空闲超时时抛出明确错误 |
| `save_image(data, path)` | 将 ComfyUI 返回的图片数据保存到本地 |

### 8.2 WorkflowBuilder (`backend/comfyui/workflow.py`)

| 方法 | 说明 |
|---|---|
| `build_upscale(...)` | 构建放大工作流 JSON（内置 Qwen3-VL 反推节点自动生成正向提示词，不需要外部传入 prompt） |
| `build_faceswap(...)` | 构建换脸工作流 JSON |
| `build_inpaint(...)` | 构建局部修复工作流 JSON（mode: flux/sdxl/klein）；`enable_rear_lora=True` 时动态注入 `LoraLoaderModelOnly` 节点（仅 flux 模式） |

### 8.3 工作流模板

模板位于 `AppData/workflows/` 或 `backend/comfyui/workflows/`，JSON 格式，参数占位符 `{{param_name}}`。

### 8.4 统一工作流系统

新增数据驱动的工作流注册系统，与现有硬编码工作流并行运行。

**核心文件**：
- `backend/comfyui/categories.py` — Category 契约定义（每种 category 的必填/可选参数、description 功能说明、usage 用法指引）
- `backend/comfyui/parser.py` — ComfyUI JSON 解析器（只解析 `@` 前缀节点）
- `backend/comfyui/engine.py` — 通用工具函数（upload_images_from_manifest, build_workflow_from_manifest, run_and_save）。`upload_images_from_manifest` 同时处理 mappings 和 extra_params 中的 image 类型参数（`source: "file_path"` 直接用路径上传，否则按 media_id 查找路径）
- `backend/comfyui/seed_workflows.py` — 启动时按 name 逐个检查并种入缺失的默认工作流（已存在同名工作流则跳过；新增到 `SEED_DEFINITIONS` 的模板会在下次启动时自动导入；自动生成的 manifest 中 extra_params 包含 `label` 和 `type` 字段）
- `backend/routers/workflows.py` — CRUD + parse + categories API

**前端组件**：
- `WorkflowManager` — 设置页「工作流管理」Tab，工作流列表管理 + 选择具体类别时显示参考卡片（功能说明/用法/参数表）+ 点击工作流卡片打开详情对话框（可编辑参数默认值并保存）+ 右键菜单和详情头部提供「编辑配置」入口
- `WorkflowImportDialog` — 三步导入对话框（上传 → 配置映射 → 提交）。支持编辑模式：接收 `editWorkflow` prop 传入已有工作流，直接进入配置步骤，预填所有字段（名称、类别、描述、参数映射、节点分配、输出映射），提交时调用 `workflowsApi.update()` 而非 `create()`。配置步骤包含「自定义参数分配」统一区域：对每个未映射的 `@` 节点，用户可分配角色。未映射 LoadImage 节点也加入分配列表（仅可选「不使用」/「输入」），设为「输入」后可配置类型（图片/遮罩）和标签。其他节点可选（不使用/输入/输出/输入+输出）。生成的 manifest 中 `extra_params` 包含 `{name, label, type, node_id, key, source?}` 字段（image 类型的 `source: "file_path"` 表示遮罩），`output_mappings` 从输出/两者角色的节点导出。解析摘要区域默认折叠
- `WorkflowParamForm` — 共享参数表单组件，被 WorkflowRunDialog 和 AiToolsTab 共同使用。渲染 category 契约参数 + extra_params，支持所有参数类型（image/mask/string/bool toggle/int/float）
- `AiToolsTab` — 小工具页「AI 工具」Tab，选择工作流并运行。使用共享 `WorkflowParamForm` 组件渲染参数表单（与 WorkflowRunDialog 行为完全一致）。标量默认值从 workflow_json 提取，image 类型不提取默认值

**自定义工作流执行流程**：
- 前端创建任务时 `workflow_type` 格式为 `custom:<workflow_id>`（UUID），与硬编码类型（upscale/face_swap/inpaint_*）区分
- `queue_runner._run_task()` 对非硬编码类型 fallback 到 `_run_custom_workflow()`
- `_run_custom_workflow()` 解析 `custom:` 前缀提取 workflow ID，通过 `Workflow.id` 查找工作流记录
- 生成文件保存目录和文件名前缀使用 `Workflow.category`（如 `upscale`），而非原始 workflow_type（避免路径中出现冒号等非法字符）
- Media 记录的 `workflow_type` 字段同样使用 category 值
- **结果归属继承**：生成的 Media 记录从第一个 image 类型输入参数对应的源媒体继承 `parent_media_id`；`person_id` 和 `album_id` 通常从同一图继承，但 **face_swap 类别特殊处理**：默认从 `face_ref`（人脸参考图）继承 person/album（因为结果展示的是参考人脸），可通过 `result_owner` 参数切换为 `base_image`
- **换脸结果 album_id 安全逻辑**：queue_runner 中 `_run_faceswap` 和 `_run_custom_workflow` 在设置结果 media 的 album_id 时，仅在 album 的 person_id 与结果 media 的 person_id 一致时才继承，否则 album_id 设为 null。防止约束违反导致图片在 UI 中不可见
- **链式任务 ownership 传播**：`_create_composite_chain` 将 target_person_id 和 result_album_id 传播到链中所有步骤，确保最终结果（如 upscale 后的图）也进入正确的图集
- **批量换脸归属**：batch_ai 中 face_swap 类别的 target_person_id 优先使用 face_ref.person_id（人脸参考图的人物），而非 body.target_person_id（可能是底图人物）
- **extra_params 图片上传**：`extra_params` 中 `type: "image"` 的参数现在会正确查找 media 文件路径并上传到 ComfyUI（而非直接将 media_id 当作文件名传入）

**选择性输出捕获**：
- 仅显式 `@` 标记并分配了角色的输出节点被捕获
- 图像输出存入 `result_outputs` 格式 `{"type": "image", "path": "..."}`
- `ImageAndMaskPreview` 已加入 `IMAGE_OUTPUT_CLASSES` 解析列表
- 图像输出节点同时加入 `text_outputs` 以便导入 UI 分配角色

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
- 字体：Inter Variable（`@fontsource-variable/inter`，在 `main.tsx` 中 import）
- 状态管理：Zustand（每个功能域一个 store）
- API 层：Axios 封装，每个后端模块对应一个 API 文件
- UI 组件库：shadcn/ui（`components/ui/` 下）
- 路由：React Router v6
- 样式：TailwindCSS + `cn()` 工具函数合并 class，CSS token 三层架构（Tier 1 原语 → Tier 2 语义 → Tier 3 组件级，见 `index.css`）
- 设备检测：`useDevice` hook 统一提供 `isMobile`（响应式）和 `isTouch`（触摸能力）
- 页面居中：表单/列表页（Settings、Tools、TaskQueue、Workspace、RecycleBin）的页头和内容区用 `max-w-2xl mx-auto` 居中；网格页（MediaLibrary、PersonHome、AlbumDetail）保持全宽。页头结构：外层 `<div className="border-b border-border shrink-0">` 包裹内层居中容器
- 构建：`npm run build` 输出到 `dist/`
- 构建时间注入：Vite `define` 配置注入 `__BUILD_TIME__` 全局变量（ISO 时间戳），TypeScript 声明在 `src/globals.d.ts`。Settings 页「服务」Tab 底部显示构建时间
- 缓存管理：Settings 页提供"强制刷新缓存"按钮，执行注销所有 Service Worker + 清空 Cache Storage + 强制重新加载
- PWA：workbox 配置启用 `skipWaiting: true` 和 `clientsClaim: true`，确保 Service Worker 更新后立即激活

### 9.3 性能优化要点

- **缩略图缓存**：`/api/files/thumb` 使用 `FileResponse` + ETag + `If-None-Match` 304 响应 + `Cache-Control: public, immutable, max-age=604800`（7天）
- **轮询稳定性**：TaskQueue 的 `getByIds` 调用需使用稳定的依赖键（如 ID 字符串拼接）避免 `useMemo` 因引用不稳定导致每 3 秒重复请求。`getByIds` 结果按请求 ID 顺序重排
- **TaskQueue 布局**：桌面端双栏（左任务列表 + 右 sticky 最近结果侧边栏，3 列 6 行折叠，`max-h-[calc(100vh-6rem)] overflow-y-auto` 限高可滚动），移动端单栏（最近结果内嵌于失败和已完成区之间，4 列 2 行折叠）。`RecentResultsGrid` 共享组件接收 `cols`/`collapsedRows` 配置。最近结果取最近 50 个已完成任务。已完成/失败任务按 `finished_at` 降序。页头按钮移动端为图标模式（32px 正方形），sm+ 显示完整文字
- **批量任务分组**：pending 区域同一 `batch_id` 的任务折叠为可展开的分组卡片（Layers 图标），点击展开/收起。非 pending 状态不分组
- **运行中区域折叠**：超过 2 个运行中任务时可折叠，仅显示 1 个 + 剩余数量
- **暂停/恢复队列**：页头暂停按钮调用 `PUT /api/queue/config` 设置 `is_paused`，暂停时按钮为 amber 色
- **清空未完成**：页头按钮调用 `POST /api/tasks/bulk-delete`，删除所有 pending + failed + cancelled 任务
- **TaskQueue LightBox（taskResultsMode）**：最近结果点击/查看结果打开 LightBox 时传入 `{ taskResultsMode: true }`。此模式下：(1) `loadChainForCurrent` 跳过，不加载生成链树；(2) ChainIndicator 替换为 SourceButtons 组件（浮于媒体区底部中央）；(3) 右键菜单隐藏"生成链"和"脱离生成链"。SourceButtons 提供「查看源图/返回结果」切换和「在图集中查看」跳转，状态通过组件内 useState 管理，导航切换时自动重置
- **生成链导航**：LightBox 链导航使用 `getState()` 获取 store 最新值，避免闭包捕获过期状态
- **生成链树构建**：后端 `get_generation_tree` 先从当前节点沿 `parent_media_id` 向上追溯到根节点，再从根节点向下构建完整树。子节点按 `created_at` 升序排列
- **媒体列表 DFS 排序**：当 `source_type` 未过滤时（混合显示），后端 `_reorder_with_children()` 后处理将生成图按 DFS 顺序插到原图后面，同级按 `created_at` 排序。影响 `list_album_media`、`list_loose_media`、`list_uncategorized_media`
- **脱离生成链**：`detach_media` 清空 `parent_media_id`/`workflow_type`/`generation_params` 并将 `source_type` 改为 `local`，子代保持关联形成新独立树。前端从 chainFlat 移除脱离项及后代，将脱离项插入 localItems，全量清除 chainCache 并重载

### 9.4 路由表

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

## 10. E2E 测试

### 10.1 框架与目录结构

```
frontend/
├── jest.config.ts              # Jest 配置（preset: jest-puppeteer）
├── jest-puppeteer.config.ts    # Puppeteer 启动配置 + Vite dev server 自动启动
└── tests/
    ├── e2e/
    │   ├── helpers.ts           # 测试辅助函数（API 调用、导航、截图、清理）
    │   ├── navigation.test.ts   # T-NAV: 导航栏
    │   ├── sidebar.test.ts      # T-SIDE: 侧边栏
    │   ├── media-library.test.ts # T-LIB: 媒体库主页
    │   ├── person-crud.test.ts  # T-PCRUD: 人物 CRUD
    │   ├── person-home.test.ts  # T-PER: 人物主页
    │   ├── album-crud.test.ts   # T-ACRUD: 图集 CRUD
    │   ├── album-detail.test.ts # T-ADET: 图集详情
    │   ├── lightbox-*.test.ts   # T-LB/LBA/LBGEN: 大图浏览
    │   ├── video-*.test.ts      # T-VID: 视频播放/缩略图
    │   ├── import-flow.test.ts  # T-IMP: 导入流程
    │   ├── filter-*.test.ts     # T-FILT/FILT-DEF: 筛选排序
    │   ├── rating-filter.test.ts # T-RATE: 评分系统
    │   ├── media-type-filter.test.ts # T-MTYPE: 媒体类型筛选
    │   ├── cover-management.test.ts  # T-COVER: 封面管理
    │   ├── random-explore.test.ts    # T-EXP: 随机探索
    │   ├── task-queue.test.ts   # T-TQ: 任务队列
    │   ├── task-cancel.test.ts  # T-CANCEL: 任务取消
    │   ├── workspace.test.ts    # T-WS: 工作区
    │   ├── recycle-bin.test.ts  # T-BIN: 回收站
    │   ├── batch-operations.test.ts  # T-BATCH: 批量操作
    │   ├── keyboard-shortcuts.test.ts # T-KB: 键盘快捷键
    │   ├── responsive-layout.test.ts  # T-RESP: 响应式布局
    │   ├── media-crud.test.ts   # T-MCRUD: 媒体操作
    │   ├── settings.test.ts     # T-SET: 设置页
    │   ├── comfyui-status.test.ts    # T-CUI: ComfyUI 状态
    │   └── error-handling.test.ts    # T-ERR: 异常处理
    ├── fixtures/                # 测试素材（test_1~5.jpg + test_video.mp4）
    └── screenshots/             # 截图输出目录（gitignore）
```

### 10.2 运行命令

```bash
# 前提：后端需要先启动（带 --reload 确保 .pyc 缓存自动刷新）
cd backend
venv\Scripts\uvicorn.exe main:app --reload --host 0.0.0.0 --port 8000

# 运行全部 E2E 测试（jest-puppeteer 自动启动 Vite dev server:5173）
cd frontend
npx jest --config jest.config.ts --runInBand --verbose

# 运行指定测试文件
npx jest --config jest.config.ts --runInBand --verbose --testPathPatterns="media-type-filter"
```

### 10.3 测试数据隔离

**核心原则：测试不得删除用户已有数据。**

- **唯一命名**：`createPerson('测试_' + Date.now())` 避免与用户数据冲突
- **`afterAll` 清理**：`cleanupPerson(personId)` 递归删除人物→图集→媒体→回收站
- **导入去重感知**：后端对 `file_path` 去重，测试动态查询实际导入数量，不硬编码期望值
- **条件断言**：去重导致 0 条媒体时，测试退化为验证 API 可达性

### 10.4 截图审查

所有测试通过 `screenshot(name)` 在关键断言点生成截图（`tests/screenshots/{name}.png`）。测试通过判定 = 程序断言通过 + 人工/Claude 视觉审查截图确认正确。

---

*文档版本：v1.6 | 基于 rewrite/v2 分支 | 2026-03-08*
