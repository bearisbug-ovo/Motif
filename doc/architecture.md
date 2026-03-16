# Motif 系统架构

## 产品定位

Motif 是一款面向个人用户的本地图片/视频浏览、管理、AI 修复与联想生成工具。以 ComfyUI 作为 AI 能力后端，通过友好的 React PWA Web 界面提供照片整理、高清修复、换脸、写真生成等功能。核心特性：以人物为核心的媒体管理体系、基于本地文件系统不复制文件（只存储路径引用）、通过 ComfyUI API 调用 AI 工作流（任务严格串行队列执行）、支持局域网多设备访问。

## 技术栈

| 层级 | 技术选型 |
|------|----------|
| 前端 | React + PWA，响应式布局，Zustand 状态管理，Tailwind CSS，shadcn/ui |
| 后端 | Python FastAPI（绑定 `0.0.0.0`，默认端口 `8000`） |
| 数据库 | SQLite（WAL 模式，通过 SQLAlchemy + aiosqlite） |
| ORM / 迁移 | SQLAlchemy + Alembic |
| AI 后端 | ComfyUI（API 模式，`/prompt` 接口） |
| 构建工具 | Vite（前端）、uvicorn（后端） |
| 启动方式 | 一键启动脚本（`start.bat` → `start.vbs` → `launcher.py` tkinter GUI） |

## 整体架构

```
用户浏览器（PC / 手机）
      ↕ HTTP
FastAPI 后端
  ├── 文件系统管理（扫描、路径引用、缩略图）
  ├── SQLite 数据库（元数据 CRUD）
  ├── 任务队列管理（串行调度）
  └── ComfyUI 代理（/prompt API 调用）
      ↕ HTTP API
ComfyUI（本地运行）
  └── 各工作流节点
```

数据流：

```
用户操作 → React 组件 → Zustand store → API 模块(axios)
                                            ↓
                                    FastAPI 端点 → SQLAlchemy ORM → SQLite (WAL)
                                            ↓ (AI 任务)
                                    queue_runner → ComfyUIClient → ComfyUI API
                                            ↓ (结果)
                                    保存文件 → 创建 Media 记录 → 前端轮询刷新
```

## 核心实体关系

```
人物 (Person) ──<>── 标签 (Tag)     ← 多对多（PersonTag）
  └──< 图集 (Album) ──<>── 标签 (Tag) ← 多对多（AlbumTag）
         └──< 媒体 (Media)  ←─────────────── 生成图也是 Media
                                              ↑
                                        关联人脸参考图
未分类（无图集的媒体，直属人物）
无人物未分类（导入时选择暂无人物）
```

**约束**：Media.person_id 当 album_id 不为空时必须等于 Album.person_id；生成链 parent_media_id 递归深度上限 10 层。

## 目录结构

```
launcher.py                      # 图形化启动器（Python + tkinter）
start.bat / start.vbs            # 启动入口（无 CMD 窗口）

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
│   ├── downloads.py         # 网页抓取下载 + 平台账号
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
├── scrapers/                # 网页抓取器（base + xiaohongshu + douyin）
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
│   ├── Sidebar.tsx            # 侧边导航
│   ├── BottomNav.tsx          # 移动端底部导航
│   ├── PersonCard.tsx         # 人物卡片
│   ├── AlbumCard.tsx          # 图集卡片
│   ├── MediaCard.tsx          # 媒体缩略图卡片
│   ├── lightbox/              # 大图浏览模块（LightBox + TopBar + Media + ContextMenu + ChainIndicator + ThumbnailStrip）
│   ├── video/                 # 视频播放器模块（VideoPlayer + Controls + GestureLayer）
│   ├── FilterBar.tsx          # 筛选/排序工具栏
│   ├── ImportDialog.tsx       # 导入向导
│   ├── WorkflowRunDialog.tsx  # AI 工作流选择 + 任务提交弹窗
│   ├── MaskEditor.tsx         # 蒙版绘制工具
│   ├── ConfirmDialog.tsx      # 全局确认弹窗
│   └── ...                    # 其他组件
├── stores/                    # Zustand 状态管理
│   ├── person.ts / album.ts / media.ts / lightbox.ts / task.ts
│   ├── workspace.ts / system.ts / tag.ts / download.ts
│   └── workflow.ts
├── api/                       # Axios API 封装
│   ├── http.ts                # Axios 实例 + 拦截器
│   └── persons.ts / albums.ts / media.ts / tasks.ts / ...
├── hooks/                     # 自定义 hooks（useDevice、useGridZoom 等）
└── lib/
    ├── utils.ts               # cn() 等工具函数
    └── filterDefaults.ts      # 筛选默认值配置
```

## AppData 目录

路径可配置（默认 `backend/appdata/`），可整体迁移。

```
[AppData]/
  ├── db/
  │   └── main.sqlite
  ├── cache/
  │   ├── thumbnails/          ← 缩略图缓存（可重建）
  │   └── crops/               ← 工作流临时裁剪文件（自动清理）
  ├── imports/
  │   └── clipboard/           ← 剪贴板导入图片的实际存储位置
  ├── generated/
  │   ├── upscale/             ← 高清放大结果
  │   ├── inpaint/             ← 局部修复/重绘结果
  │   ├── face_swap/           ← 换脸结果
  │   ├── crop/                ← 裁剪结果
  │   ├── trim/                ← 视频剪辑结果
  │   ├── portrait/            ← 写真生成结果
  │   └── screenshot/          ← 视频截图
  ├── poses/                   ← DWPose 骨骼图
  ├── workflows/               ← ComfyUI 工作流 JSON 模板
  └── downloads/               ← 网页抓取下载的图片/视频
      ├── xiaohongshu/
      ├── bilibili/
      ├── twitter/
      ├── telegram/
      └── web/
```

**目录迁移**：设置页提供"迁移 AppData 目录"功能。迁移时复制整个 AppData 文件夹至新路径 → 更新 SQLite 中所有 `generated/` 和 `clipboard/` 的路径引用 → 更新设置中的 AppData 路径。用户本地图片的路径引用不受影响（文件未移动）。

## 设计原则

### 不复制文件

本地图只存储绝对路径引用，物理文件永远不删除，只删除数据库记录。AppData 内的生成图/截图/剪贴板导入图是例外——这些文件由 Motif 管理。

### SQLite WAL 模式

启用 Write-Ahead Logging 模式，支持多设备并发读取。写入操作由 FastAPI 后端统一管理，避免多客户端直接写入冲突。任务队列调度使用数据库乐观锁（`queue_order` + `status` 联合条件更新）。

### 任务严格串行

FastAPI 后台线程维护队列，一次只向 ComfyUI 提交一个任务。四种启动模式：手动（manual）、自动（auto）、Cron 定时、延时（delay，debounce 机制）。

### ComfyUI 集成

- 通过 `/prompt` 提交工作流，`/history` 轮询结果（2 秒间隔）
- 工作流模板使用 `{{param_name}}` 占位符格式
- P4 阶段引入数据驱动的工作流注册系统，用户可通过前端导入 ComfyUI JSON 并注册

### 软删除规则

- 本地图：只删记录，不删物理文件
- 生成图/截图：软删后进入回收站，永久删除时同时删除物理文件

## 数据库设计规范

### 索引策略（SQLite）

| 表 | 索引 | 用途 |
|-----|------|------|
| Media | `(person_id, is_deleted)` | 人物主页查询 |
| Media | `(album_id, sort_order)` | 图集内排序展示 |
| Media | `(rating)` | 评分筛选/排序 |
| Media | `(parent_media_id)` | 生成链查询 |
| Media | `(is_deleted, deleted_at)` | 回收站列表及自动清理 |
| Task | `(status, queue_order)` | 队列调度 |
| WorkspaceItem | `(sort_order)` | 工作区展示 |
| DownloadRecord | `(status)` | 下载记录筛选 |
| PersonTag | `(person_id)` | 人物标签查询 |
| PersonTag | `(tag_id)` | 按标签筛选人物 |
| AlbumTag | `(album_id)` | 图集标签查询 |
| AlbumTag | `(tag_id)` | 按标签筛选图集 |

### 并发策略

- SQLite 启用 WAL（Write-Ahead Logging）模式，支持多设备并发读取
- 写入操作由 FastAPI 后端统一管理，避免多客户端直接写入冲突
- 任务队列调度使用数据库乐观锁（`queue_order` + `status` 联合条件更新）

### Schema 迁移

- 使用 Alembic 管理数据库版本迁移
- 每次 schema 变更生成迁移脚本，启动时自动检测并执行
- `db/` 目录下保留 `alembic/versions/` 存放迁移历史

## 前端状态管理

### Zustand Store 概览

| Store | 职责 | 关键方法 |
|---|---|---|
| `person` | 人物 CRUD | fetchPersons, fetchPerson, createPerson, updatePerson, deletePerson |
| `album` | 图集 CRUD | fetchAlbums, fetchAlbum, fetchAlbumsByPerson, createAlbum, updateAlbum, deleteAlbum |
| `media` | 媒体 CRUD + 多选 | fetchByAlbum, fetchLoose, updateMedia, softDelete, replaceItem, toggleSelection, selectAll, clearSelection, batchRate, batchDelete, batchMoveToAlbum |
| `lightbox` | LightBox 双轴导航 | openLightbox, closeLightbox, goHorizontal, goVertical, goToChainNode, setFlatMode, invalidateChainCache |
| `task` | 任务 + 3 秒轮询 | fetchTasks, fetchStats, startPolling, stopPolling |
| `workspace` | 工作区 CRUD | fetchItems, addItem, batchAdd, removeItem, clear, reorder |
| `system` | 系统状态/配置 | fetchStatus, fetchConfig, updateConfig |
| `workflow` | 工作流管理 | categories, workflows, parseResult |
| `tag` | 标签 CRUD + 关联 | fetchTags, createTag, updateTag, deleteTag, mergeTag, reorderTags |
| `download` | 网页抓取 + 批量扫描 | parseUrl, confirmDownload, fetchRecords, retryRecord, startScan, pollScanJob, confirmBatch |

### 加载态规范

所有 store 的 `loading` 初始值为 `false`。加载中显示空白页面（不使用骨架屏），EmptyState 仅在 `!loading` 确认数据为空后才显示。

```tsx
{items.length === 0 && !loading ? <EmptyState /> : <DataGrid />}
```

- **空白**：加载中（`loading=true` 且无数据）时页面留空，不显示任何占位组件
- **empty state**：仅在 `loading=false` 且数据确认为空时显示
- **data**：有数据时始终显示，即使后台正在刷新（re-fetch 不闪烁）

**实体切换防旧数据残留**：共享 store 的数据在路由参数变化时不会自动重置，需在 `useEffect` 中按需清除旧数据（如 AlbumDetail 切换不同图集时清除旧媒体列表）。已应用页面：MediaLibrary、AlbumDetail、RecycleBin、PersonHome、Workspace、TaskQueue。

### 任务角标轮询

`task.ts` 的 `startPolling()` 每 3 秒请求 `GET /api/tasks/stats`，Sidebar/BottomNav 显示角标（优先级从高到低，仅显示最高优先级的一个）：
- 运行中：旋转动画（蓝色 Loader）
- 待开始：蓝色数字角标（pending 数量）
- 失败：红色数字
- 完成：绿色数字（进入任务页后清零）

## 主题系统

**双主题支持**：浅色（Warm Light）+ 深色（Warm Dark），基于 claude.ai 暖色调设计语言。

| 层级 | 文件 | 说明 |
|---|---|---|
| CSS 变量 | `src/index.css` | `:root` 定义浅色语义 token，`.dark` 定义深色语义 token |
| 主题工具 | `src/lib/theme.ts` | `getTheme()` / `setTheme(theme)` / `initTheme()` — 管理 localStorage 和 DOM class |
| 防闪烁 | `index.html` | `<script>` 在 React 挂载前读取 localStorage 并加 `.dark` class |
| UI 入口 | Settings「外观」Tab | 3 选项卡片：浅色 / 深色 / 跟随系统 |

**localStorage Key**：`motif-theme`，值为 `light` / `dark` / `system`（默认 `system`）

**CSS 变量命名（Tier 2 语义层）**：
- `:root` = 浅色主题：暖奶油底色（`30 25% 94%`）、赤陶橙强调色（`22 54% 49%`）
- `.dark` = 深色主题：暖深褐底色（`45 5% 16%`）、暖金橙强调色（`24 57% 62%`）
- Tailwind 通过 `hsl(var(--xxx))` 映射，组件代码无需关心当前主题

**Tailwind 配置**：`darkMode: ['class']` — 已启用 `dark:` 前缀（基于 `.dark` class）

## 环境搭建

### 前置依赖

| 依赖 | 版本 | 说明 |
|---|---|---|
| Python | 3.11.9 | 由 ComfyUI 自带 Python 创建 venv |
| Node.js | >= 18 | 前端构建 |
| ComfyUI | aki-v1.6 | AI 后端，路径 `D:\ai\ComfyUI-aki-v1.6` |
| SQLite | 内置 | 通过 SQLAlchemy + aiosqlite |

### 一键启动（推荐）

双击项目根目录 `start.bat`（或 `start.vbs`），打开图形化启动器，自动完成后端 + 前端 + ComfyUI 启动。

启动流程：清理旧进程 → 构建前端（`npm run build`）→ 启动后端（:8000，同时 serve 前端静态文件）→ 检测/启动 ComfyUI（:8188）→ 打开浏览器。

进程管理：后端通过 Win32 Job Object 绑定，启动器退出时自动终止；ComfyUI 独立运行不受影响。所有子进程使用 `CREATE_NO_WINDOW`，全程无控制台窗口。

### 手动启动（开发调试）

**后端**：

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

**前端**：

```bash
cd frontend
npm install
npm run build    # 生成 dist/，后端自动 serve
# 或开发模式（热重载）：
npm run dev      # http://localhost:5173，/api 代理到 localhost:8000
```

> **生产模式**：后端自动 serve `frontend/dist/` 静态文件，通过 `http://localhost:8000` 统一访问。
> **开发模式**：`npm run dev` 提供热重载，通过 `http://localhost:5173` 访问，API 代理到 8000 端口。

**ComfyUI**：

```bash
"D:/ai/ComfyUI-aki-v1.6/python/python.exe" "D:/ai/ComfyUI-aki-v1.6/ComfyUI/main.py" --port 8188 --lowvram
```

就绪检测：`curl -s http://localhost:8188/object_info/KSampler` 返回 JSON 即就绪。

## Phase 规划

| 阶段 | 范围 | 交付标准 |
|------|------|----------|
| **P0 — 基础浏览与管理** | 媒体库浏览（人物/图集/大图模式）、导入流程、评分/筛选/排序、回收站、设置页、ComfyUI 连接管理、启动脚本 | 可完整导入本地图片并按人物/图集组织浏览，评分和筛选功能可用 |
| **P1 — 核心 AI 功能** | 高清放大、换脸（单张+批量）、局部修复（带提示词+自动反推）、任务队列（含 4 种启动模式）、工作区 | 可对图片执行 AI 操作并管理任务队列，生成链可视化可用 |
| **P2 — 高级 AI 功能** | 图生图（含提示词反推+润色）、写真生成、动作库（DWPose 管理+动作组） | 图生图含提示词反推+润色完整链路可用，动作库支持批量提取和引用 |
| **P3 — 扩展工具** | 网页图片抓取器（5 平台适配）、平台账号管理 | 至少 2 个平台（小红书+通用网页）可用 |
| **P3-UI — 前端 UI/UX 改进** | 设计 token 三层架构、视觉升级、体验打磨、性能优化 | WCAG AA 对比度合规，EmptyState 组件替代空文字 |
| **P4 — 工作流管理** | 数据驱动的工作流注册系统、ComfyUI JSON 导入 + 可视化参数映射、AI 工具 Tab | 用户可通过前端导入 ComfyUI 工作流 JSON 并注册，无需改 Python 代码 |
