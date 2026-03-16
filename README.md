<div align="center">

# Motif

**本地媒体浏览、管理与 AI 生成工具**

以人物为核心的图片/视频管理系统，集成 ComfyUI AI 工作流，支持局域网多设备访问。

[功能特性](#功能特性) · [快速开始](#快速开始) · [操作手册](doc/user_manual.md) · [开发指南](doc/development_guide.md)

</div>

---


## 功能特性

### 媒体管理

- **人物为核心** — 按人物 → 图集 → 媒体的层级组织照片和视频
- **不复制文件** — 只存储路径引用，不占用额外磁盘空间
- **灵活导入** — 文件夹扫描（含子文件夹）、剪贴板粘贴，导入时指定人物和图集归属
- **五星评分** — 快速评分 + 按评分筛选/排序，支持 ≥ / = / ≤ 比较
- **回收站** — 软删除 + 可配置自动清理天数

### 大图浏览

- **LightBox 查看器** — 图片放大（1x–8x）、鼠标移动平移、放大镜光标
- **视频播放** — 原生控件、变速（0.5x–3x）、逐帧、截图、设为封面
- **沉浸模式** — 全屏浏览，键盘快速评分和切图
- **生成链面板** — 可视化查看 AI 生成的衍生关系树

### AI 工作流（需 ComfyUI）

- **高清放大** — 2x/4x 超分辨率
- **AI 换脸** — 单张/批量换脸，保持姿势、服装、背景不变
- **局部修复** — 蒙版绘制 + 提示词引导的局部重绘
- **任务队列** — 严格串行执行，支持排队、重试、取消
- **工作区** — 跨人物/图集的 100 条媒体引用书架

### 更多

- **PWA** — 手机/平板通过局域网访问，响应式布局
- **网页抓取** — 小红书等平台的图片批量下载（开发中）

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.11 · FastAPI · SQLAlchemy · SQLite (WAL) · Alembic |
| 前端 | React 18 · TypeScript · Vite · Zustand · Tailwind CSS · Radix UI |
| AI | ComfyUI · GGUF 量化模型 · ControlNet · InsightFace |

## 快速开始

### 环境要求

- **Windows 10/11**（目前仅支持 Windows）
- **Python 3.11**
- **Node.js 18+**
- **ComfyUI**（AI 功能需要，纯管理功能可不装）
- **显卡** 8GB+ VRAM（推荐，AI 功能需要）

### 安装

```bash
# 克隆项目
git clone https://github.com/your-username/Motif.git
cd Motif

# 后端
cd backend
python -m venv venv
venv\Scripts\pip.exe install -r requirements.txt
venv\Scripts\alembic.exe upgrade head
cd ..

# 前端
cd frontend
npm install
cd ..
```

### 启动

**一键启动（推荐）：**

```batch
start.bat
```

双击即可启动后端、前端和 ComfyUI（如已配置）。启动后自动打开浏览器。

**手动启动：**

```bash
# 终端 1 — 后端
cd backend
venv\Scripts\uvicorn.exe main:app --reload --host 0.0.0.0 --port 8000

# 终端 2 — 前端
cd frontend
npm run dev
```

打开浏览器访问 `http://localhost:5173`。

### ComfyUI 配置（可选）

AI 功能需要本地运行 ComfyUI。启动后在 Motif 设置页配置 ComfyUI 地址（默认 `http://127.0.0.1:8188`）。

所需插件：ComfyUI-GGUF、comfyui-easy-use、InsightFace、Inspyrenet、comfyui_controlnet_aux、ControlNet Union

详细模型和插件列表见 [CLAUDE.md](CLAUDE.md#comfyui-环境)。

## 项目结构

```
Motif/
├── backend/                # FastAPI 后端
│   ├── main.py             # 应用入口
│   ├── routers/            # API 路由（persons/albums/media/tasks/...）
│   ├── models/             # SQLAlchemy ORM 模型
│   ├── comfyui/            # ComfyUI 集成（客户端 + 工作流模板）
│   └── config.py           # 全局配置
│
├── frontend/               # React + Vite 前端
│   └── src/
│       ├── pages/          # 页面组件
│       ├── components/     # 通用组件（LightBox/MediaCard/...）
│       ├── stores/         # Zustand 状态管理
│       └── api/            # HTTP 接口层
│
├── doc/                    # 项目文档
│   ├── user_manual.md      # 操作手册
│   ├── prd.md              # 产品需求文档
│   └── development_guide.md# 开发指南
│
├── start.bat               # 一键启动脚本
└── CLAUDE.md               # AI 辅助开发指令
```

**AppData 目录**（默认 `backend/appdata/`，可在设置中更改）：

```
appdata/
├── db/main.sqlite          # SQLite 数据库
├── cache/thumbnails/       # 缩略图缓存
├── generated/              # AI 生成的图片（放大/换脸/修复/截图）
├── imports/clipboard/      # 剪贴板导入
└── settings.json           # 配置文件
```

## 数据模型

| 实体 | 说明 |
|---|---|
| Person | 人物，包含名称、封面、平均评分 |
| Album | 图集，归属于人物，支持 AI 生成图集 |
| Media | 媒体文件（图片/视频），支持本地/生成/截图三种来源 |
| Task | AI 任务，严格串行队列执行 |
| WorkspaceItem | 工作区引用，上限 100 条 |

**设计原则：**
- 本地图片只存路径引用，删除只删记录
- 生成图/截图存入 AppData，回收站清空时删物理文件
- `parent_media_id` 追踪 AI 生成链，最大递归深度 10 层

## 开发

```bash
# 运行 E2E 测试（需先启动后端）
cd frontend
npx jest --config jest.config.ts --runInBand --verbose

# 数据库迁移
cd backend
venv\Scripts\alembic.exe revision --autogenerate -m "描述"
venv\Scripts\alembic.exe upgrade head

# 前端构建
cd frontend
npm run build
```

## 开发阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 基础浏览、管理、导入、评分、设置 | 已完成 |
| P1 | 高清放大、换脸、局部修复、任务队列、工作区 | 进行中 |
| P2 | 图生图、写真生成、动作库 | 设计中 |
| P3 | 网页抓取器、平台账号管理 | 设计中 |
| P3-UI | 设计系统升级、视觉打磨 | 设计中 |

## 许可证

[MIT](LICENSE)
