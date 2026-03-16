# CLAUDE.md

## 工作规范

- **文档同步更新**：修改功能行为时，必须同步更新 `doc/modules/` 中对应模块文件，保持需求、API、测试用例与代码一致
- **doc/ 命名规范**：统一 `snake_case.md`，不加项目前缀和版本号，版本信息写在文档内部 header，历史由 Git 管理
- **功能验证**：完成功能开发后，通过 Claude in Chrome 实际操作验证
- **Bug 复现优先**：用户报告问题时，先通过 Claude in Chrome 复现，确认根因后再修复，不要基于猜测直接改代码
- **E2E 回归测试**：核心功能路径保留 E2E 测试（`screenshot()` 定义在 `frontend/tests/e2e/helpers.ts`，输出到 `frontend/tests/screenshots/{name}.png`），测试通过判定 = 程序断言通过 + Claude 视觉审查截图确认正确

## 文档维护规则

### 何时更新
- **改功能行为**：更新 `doc/modules/` 中对应模块文件的相关章节
- **新增 API**：先在模块文件的「API 端点」节写明接口定义，再实现代码
- **改数据模型**：在同一模块文件内同步更新「数据模型」节和「测试用例」节
- **新增模块**：创建 `doc/modules/新模块.md`，并在下方模块索引中添加条目

### 何时不更新
- 纯重构（不改外部行为）：不需要更新文档
- 修 bug（行为回归到文档描述）：不需要更新文档
- 改样式/动画：不需要更新文档

### 文档 vs 代码冲突
- 如果发现文档和代码不一致，**以代码为准**修正文档
- 修正后在 commit message 注明 `docs: fix drift in xxx.md`

## 页面层级术语

| 术语 | 对应页面 | 路由 |
|------|----------|------|
| **人物库** | 首页，人物卡片列表 | `/` |
| **人物主页** | 某人物的详情页 | `/persons/:id` |
| **人物主页 · 图集区** | PersonHome 的图集列表部分 | — |
| **人物主页 · 散图区** | PersonHome 的散图列表部分 | — |
| **图集详情** | 某图集的媒体列表页 | `/albums/:id` |
| **任务队列** | 任务管理页 | `/tasks` |
| **工作流** | 工作流运行与管理页 | `/workflows` |
| **小工具** | 网页抓取器等工具页 | `/tools` |
| **设置** | 设置页（外观/服务/标签/工作区/回收站/控制台） | `/settings` |
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

Motif — 本地图片/视频浏览、管理、AI 修复与联想生成工具。以 ComfyUI 为 AI 后端，React PWA 前端，支持局域网多设备访问。核心：以人物为核心的媒体管理体系、不复制文件（路径引用）、任务严格串行队列。

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

## 模块索引

改动功能时，读取对应模块文档获取完整上下文（数据模型 + API + 前端行为 + 测试用例）。

| 模块 | 文档 | 涉及代码 |
|------|------|----------|
| 人物/图集/媒体 | `doc/modules/person_album_media.md` | `routers/persons,albums,media` · `pages/MediaLibrary,PersonHome,AlbumDetail` |
| 导入流程 | `doc/modules/import.md` | `routers/media`(import) · `components/ImportDialog` |
| 大图浏览/视频 | `doc/modules/lightbox.md` | `components/lightbox/,video/` · `stores/lightbox` |
| AI 任务/工作流 | `doc/modules/ai_tasks.md` | `routers/tasks,workflows` · `queue_runner` · `comfyui/` · `pages/TaskQueue,Tools,Workflows` |
| 筛选与排序 | `doc/modules/filter_sort.md` | `components/FilterBar` · `stores/media`(filter state) |
| 工作区/回收站 | `doc/modules/workspace_recyclebin.md` | `routers/workspace,recycle_bin` · `pages/Workspace,RecycleBin` |
| 网页抓取/下载 | `doc/modules/downloads.md` | `routers/downloads` · `scrapers/` · `stores/download` |
| 标签系统 | `doc/modules/tags.md` | `routers/tags` · `components/TagEditor` · `stores/tag` |
| 设置/系统管理 | `doc/modules/settings_system.md` | `routers/system,launcher` · `pages/Settings,Dashboard` |

## 系统级文档

| 文档 | 说明 |
|------|------|
| `doc/architecture.md` | 技术栈、目录结构、设计原则、前端状态管理、环境搭建、Phase 规划 |
| `doc/comfyui_guide.md` | ComfyUI 模型路径、插件、Gotcha、换脸工作流规范、可复用旧代码 |
| `doc/test_strategy.md` | 测试环境配置、辅助函数、数据隔离策略、需求追溯矩阵 |
| `doc/ui_improvement_plan.md` | P3-UI 前端视觉/体验/性能改造方案 |
| `doc/user_manual.md` | 用户使用手册 |

## 原始参考文档（只读）

以下为重构前的完整文档，保留作为产品全景参考，日常开发以 `doc/modules/` 为准：

| 文档 | 说明 |
|------|------|
| `doc/prd.md` | 产品需求文档全量（P0-P3） |
| `doc/development_guide.md` | 开发指南全量（架构 + ~45 API 端点） |
| `doc/test_plan.md` | 测试计划全量（按 PRD 章节组织） |
