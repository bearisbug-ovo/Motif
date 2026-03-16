# 设置与系统管理

> 涉及代码：`backend/routers/system.py, launcher.py` | `backend/config.py` | `frontend/src/pages/Settings.tsx, Dashboard.tsx` | `frontend/src/stores/system.ts`

## 需求摘要

设置页（路由 `/settings`）提供六个 Tab：外观 | 服务 | 标签 | 工作区 | 回收站 | 控制台。[PRD §5.11]

系统管理包括：ComfyUI 连接状态监控、图形化启动器（launcher.py）、后端配置管理、文件服务。启动器通过 `start.bat` / `start.vbs` 启动，全程无 CMD 窗口，自动完成前端构建、后端启动、ComfyUI 启动和浏览器打开。[PRD §2.2, §2.3]

## API 端点

### 系统 `/api/system` [开发指南 §3.8]

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/status` | 系统状态（ComfyUI 连接、磁盘空间、重连次数） |
| GET | `/config` | 获取配置 |
| PUT | `/config` | 更新配置 |

### 启动器仪表盘 `/api/launcher` [开发指南 §3.9]

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/status` | 聚合状态：后端运行时间/PID、ComfyUI 连接、已连接设备列表、错误统计、磁盘空间 |
| POST | `/comfyui/start` | 启动 ComfyUI（使用设置中的启动命令） |
| POST | `/comfyui/stop` | 停止 ComfyUI 进程 |
| POST | `/restart-backend` | 延迟 1 秒后退出后端进程（由启动器检测并重启） |
| GET | `/logs` | 读取 `.logs/` 下的后端日志（query: `lines`，默认 50） |

**中间件**：`main.py` 中注册了 `launcher_tracking_middleware`，自动追踪所有 `/api/` 请求的客户端 IP（30 分钟活跃窗口）和 4xx/5xx 错误记录（最近 200 条）。

### 文件服务（main.py 内） [开发指南 §3.10]

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/api/files/thumb` | 缩略图（`FileResponse` + ETag/304 + `Cache-Control: immutable, max-age=604800`；支持图片和视频，视频用 OpenCV 提取第一帧） |
| GET | `/api/files/serve` | 原始文件流式传输（支持 HTTP Range 请求，视频 seek 必需；有 Range 头时返回 206 + `Content-Range`，无则返回完整文件 + `Accept-Ranges: bytes`） |
| GET | `/api/files/pick-folder` | 系统文件夹选择对话框 |
| GET | `/api/files/pick-files` | 系统文件选择对话框 |
| GET | `/api/files/list-subfolders` | 递归列出子文件夹 |
| GET | `/api/health` | 健康检查 |

## 前端行为

### 外观 Tab [PRD §5.11.1]

**主题设置**：
- 主题切换：浅色 / 深色 / 跟随系统（默认跟随系统）
- 持久化存储：localStorage `motif-theme` key，值为 `light` / `dark` / `system`
- 防闪烁脚本：`index.html` 中立即执行脚本读取 localStorage，在 `<html>` 元素上加 `.dark` class（若使用深色主题）

**显示配置**：
- 缩略图大小（影响网格密度，单位 px）
- 网格缩放默认值：为每个页面分别配置桌面端和手机端的默认列数/行高
- 筛选默认值：评分筛选、来源类型、媒体类型、各页面排序默认值

### 服务 Tab [PRD §5.11.2]

**ComfyUI 连接**：
- ComfyUI 地址（默认 `http://127.0.0.1:8188`）+ 连接状态指示器（绿色已连接 / 红色未连接）
- ComfyUI 启动命令（可配置）

**服务器配置**：
- FastAPI 监听端口（默认 `8000`，修改后需重启）
- 任务超时阈值（默认 10 分钟）

**存储管理**：
- AppData 目录路径（可更改，触发迁移流程）
- 磁盘使用情况（总大小 / 已用 / 可用 + 进度条）
- 回收站自动清除天数（默认 30 天，设为 0 关闭自动清理）

**版本与缓存**：
- 构建时间戳：服务 Tab 底部显示当前构建版本时间（通过 Vite `__BUILD_TIME__` 注入）
- "强制刷新缓存"按钮：注销所有 Service Worker、清空 Cache Storage、强制重新加载页面

### 标签 Tab [PRD §5.11.3]

**标签管理列表**：按 sort_order 排列所有标签，每行显示：彩色圆点（tag.color）+ 标签名 + 关联数量（N 人物 / M 图集）+ 操作按钮

**操作**：
- 新建标签：输入名称 + 选择颜色（预设色板 + 自定义 HEX）
- 重命名：行内编辑
- 修改颜色：点击色块弹出色板
- 拖拽排序：调整 sort_order
- 合并标签：选择目标标签，将源标签的所有关联（PersonTag / AlbumTag）转移到目标标签并去重，完成后删除源标签
- 删除标签（红色危险操作，确认弹窗提示"将移除所有人物和图集上的该标签"）

### 工作区 Tab [PRD §5.11.4]

内容详见 `workspace_recyclebin.md`。

### 回收站 Tab [PRD §5.11.5]

内容详见 `workspace_recyclebin.md`。

### 控制台 Tab [PRD §5.11.6]

设置页内嵌"控制台"Tab，提供 Web 端的服务监控与控制：
- 服务状态卡片（后端/ComfyUI/磁盘空间）+ 启动/停止/重启按钮
- 已连接设备列表（IP/UA/请求数/最后活跃时间）
- 错误统计（1h/24h 错误计数 + 最近 20 条错误详情）
- 后端日志查看

### ComfyUI 连接状态 [PRD §2.3]

- **连接中**：旋转加载图标 + "ComfyUI 启动中..."
- **已连接**：绿色图标
- **连接失败 / 未连接**：红色图标 + 错误提示

**连接状态对功能的影响**：
- 浏览、管理、评分等功能不受影响
- AI 功能参数面板的"立即执行"按钮禁用，"加入队列"按钮保持可用
- 任务可以正常添加进队列，ComfyUI 恢复连接后按队列配置的启动模式继续执行

**前端 ComfyUI 状态** [PRD §2.2]：
- 前端页面轮询 ComfyUI 连接状态，连接成功前 AI 功能按钮禁用，浏览功能不受影响
- 侧边栏底部显示 ComfyUI 连接状态指示器

## 启动流程与服务管理

### 启动流程 [PRD §2.2]

用户双击 `start.bat`（或 `start.vbs`），启动图形化启动器（`launcher.py`，Python + tkinter），窗口打开后自动完成以下步骤：

1. **单实例检测**：通过命名 Mutex 防止重复启动，已有实例时弹窗提示并退出
2. **清理旧进程**：检测并关闭占用端口 8000 的旧进程
3. **构建前端**：执行 `npm run build`，生成生产包到 `frontend/dist/`（含 PWA Service Worker）。可在设置 tab 勾选"跳过前端构建"加速启动
4. **启动后端**：以隐藏窗口启动 `uvicorn`，日志写入 `.logs/backend.log`，等待端口 8000 就绪（超时 30 秒）。后端同时 serve 前端静态文件
5. **启动 ComfyUI**：检测 ComfyUI 是否已运行（请求 `/object_info/KSampler`），未运行则使用设置中的启动命令拉起。可在设置 tab 勾选"不启动 ComfyUI"跳过
6. **打开浏览器**：自动打开 `http://localhost:8000`

### 启动器界面 [PRD §2.2]

启动器为 tkinter GUI 窗口（880x720，暗色主题，高 DPI 适配），包含三个 Tab：

**状态 Tab**：
- 三张状态卡片：后端服务（运行时间/PID/端口/错误统计）、ComfyUI（连接状态/地址）、网络（本机/局域网访问地址）
- 控制按钮：启动全部服务 / 停止全部 / 快速重启 / 打开浏览器
- 已连接设备列表：显示 30 分钟内活跃的客户端 IP、设备类型、请求数
- 状态每 5 秒自动刷新（通过后端 `/api/launcher/status`）

**设置 Tab**：
- 启动前可修改：后端端口、ComfyUI 地址和启动命令、缩略图大小
- 勾选项：跳过前端构建、不启动 ComfyUI

**日志 Tab**：
- 实时显示启动流程日志，带颜色标记（信息/成功/警告/错误）

### 控制按钮 [PRD §2.2]

| 按钮 | 行为 |
|------|------|
| 启动全部服务 | 构建前端 + 启动后端 + 启动 ComfyUI + 打开浏览器（启动器打开时自动执行） |
| 停止全部 | 停止后端和 ComfyUI |
| 快速重启 | 重新构建前端 + 重启后端（不重启 ComfyUI，不打开浏览器） |
| 打开浏览器 | 打开 `http://localhost:{port}` |

### 进程管理 [PRD §2.2]

- 启动器通过 `start.bat` -> `start.vbs` -> `pythonw.exe launcher.py` 启动，全程无 CMD 窗口
- 后端进程通过 Win32 Job Object 绑定到启动器，启动器退出时自动终止
- ComfyUI 作为独立进程启动，不受启动器生命周期影响
- 所有子进程使用 `CREATE_NO_WINDOW` 标志，不弹出控制台窗口
- 日志输出到项目根目录 `.logs/` 下：`backend.log`、`backend-error.log`

## 测试用例

### 3.11 设置页 [PRD §5.11]

```
T-SET-01: 设置页 Tab 切换
  PRD 需求: §5.11 "五个 Tab：外观、服务、工作区、回收站、控制台"
  步骤:
    1. 导航到 /settings
    2. 验证顶部存在 5 个 Tab：外观 / 服务 / 工作区 / 回收站 / 控制台
    3. 依次点击各 Tab，验证内容切换
  预期: 所有 Tab 可切换，内容区域更新

T-SET-02: 外观 Tab - 主题切换
  PRD 需求: §5.11.1 "主题切换：浅色 / 深色 / 跟随系统"
  步骤:
    1. 导航到 /settings，默认在「外观」Tab
    2. 验证存在 3 个主题选项（浅色 / 深色 / 跟随系统）
    3. 点击"深色" → 验证页面背景变深
    4. 点击"浅色" → 验证页面背景变浅
    5. 刷新页面 → 验证主题选择保持
  预期: 主题切换正确，跨刷新保持（localStorage motif-theme）

T-SET-03: 外观 Tab - 缩略图大小
  PRD 需求: §5.11.1 "缩略图大小"
  步骤:
    1. 在「外观」Tab 修改缩略图大小
    2. 保存后验证值持久化
  预期: 缩略图大小配置生效

T-SET-04: 外观 Tab - 网格缩放默认值
  PRD 需求: §5.11.1 "网格缩放默认值"
  步骤:
    1. 在「外观」Tab 验证各页面缩放默认值输入框存在
    2. 修改人物库桌面端默认列数
    3. 导航到人物库验证列数
  预期: 网格默认值配置生效

T-SET-05: 外观 Tab - 筛选默认值
  PRD 需求: §5.11.1 "筛选默认值"
  步骤:
    1. 在「外观」Tab 验证筛选默认值区域存在
    2. 修改评分筛选默认值为"4星+"
    3. 导航到图集详情验证筛选初始为"4星+"
  预期: 筛选默认值配置生效

T-SET-06: 服务 Tab - ComfyUI 连接配置
  PRD 需求: §5.11.2 "ComfyUI 连接"
  步骤:
    1. 点击「服务」Tab
    2. 验证 ComfyUI 地址输入框和连接状态指示器
    3. 修改地址为 http://127.0.0.1:9999，保存
    4. 刷新页面，验证值持久化
  预期: ComfyUI 配置正确显示且可持久化

T-SET-07: 服务 Tab - 服务器端口配置
  PRD 需求: §5.11.2 "FastAPI 监听端口"
  步骤:
    1. 在「服务」Tab 验证端口输入框（默认 8000）
    2. 验证有"修改后需重启"提示
  预期: 端口配置显示正确

T-SET-08: 服务 Tab - AppData 路径
  PRD 需求: §5.11.2 "AppData 目录路径"
  步骤:
    1. 在「服务」Tab 验证 AppData 路径显示
    2. 验证路径为有效目录
  预期: 路径正确显示

T-SET-09: 服务 Tab - 构建版本时间戳
  PRD 需求: §5.11.2 "构建时间戳"
  步骤:
    1. 在「服务」Tab 滚动到底部
    2. 验证显示构建时间戳文本
  预期: 构建时间信息可见

T-SET-10: 服务 Tab - 强制刷新缓存
  PRD 需求: §5.11.2 "强制刷新缓存按钮"
  步骤:
    1. 在「服务」Tab 验证存在"强制刷新缓存"按钮
    2. 点击按钮（验证触发刷新操作）
  预期: 按钮存在且可点击
```

### 3.22 响应式布局（设置页相关） [PRD §9.6]

```
T-RESP-01: 桌面宽屏布局 (1920px)
  PRD 需求: §9.6 "大屏 PC / 4K（更多列）"
  步骤:
    1. 设置 viewport 为 1920×1080
    2. 导航到首页
    3. 验证页面正确渲染
  预期: 大屏布局正确
  文件: responsive-layout.test.ts

T-RESP-02: 标准桌面布局 (1280px)
  PRD 需求: §9.6 "标准 PC（多列网格）"
  步骤:
    1. 设置 viewport 为 1280×800
    2. 导航到首页
    3. 验证页面正确渲染
  预期: 标准桌面布局正确
  文件: responsive-layout.test.ts

T-RESP-03: 平板布局 (768px)
  PRD 需求: §9.6 "平板/小屏 PC（双列网格，侧边导航收起）"
  步骤:
    1. 设置 viewport 为 768×1024
    2. 导航到首页
    3. 验证页面正确渲染
  预期: 平板布局正确
  文件: responsive-layout.test.ts

T-RESP-04: 手机布局 (375px)
  PRD 需求: §9.6 "手机布局（单列，底部导航，全宽面板）"
  步骤:
    1. 设置 viewport 为 375×812
    2. 导航到首页
    3. 验证页面正确渲染
  预期: 手机布局正确
  文件: responsive-layout.test.ts
```

### 3.35 ComfyUI 状态 [PRD §5.11.2, §2.3]

```
T-CUI-01: 设置页·服务 Tab 显示 ComfyUI 状态
  PRD 需求: §5.11.2 / §2.3 ComfyUI 连接状态
  步骤:
    1. 导航到 /settings，点击「服务」Tab
    2. 验证页面包含"ComfyUI"文字和连接状态指示器
  预期: 状态区域渲染
  文件: comfyui-status.test.ts

T-CUI-02: 系统状态 API 返回 ComfyUI 信息
  PRD 需求: §2.3 系统状态
  步骤:
    1. 调用 GET /api/system/status
    2. 验证返回 comfyui.connected 布尔值
  预期: API 返回正确
  文件: comfyui-status.test.ts

T-CUI-03: ComfyUI 地址配置显示
  PRD 需求: §5.11.2 "ComfyUI 连接地址"
  步骤:
    1. 导航到 /settings，点击「服务」Tab
    2. 验证显示 8188（默认端口）
  预期: 地址配置显示
  文件: comfyui-status.test.ts

T-CUI-04: 连接状态颜色指示
  PRD 需求: §2.3 "绿色图标 / 红色图标"
  步骤:
    1. 导航到 /settings，点击「服务」Tab
    2. 验证有绿色/红色状态指示器
  预期: 颜色指示器存在
  文件: comfyui-status.test.ts
```

### 3.41 设置页扩展测试 [PRD §5.11]

```
T-SET-04: ComfyUI 地址修改
  PRD 需求: §5.11 "ComfyUI 连接地址"
  步骤:
    1. 导航到设置页
    2. 验证显示 8188 默认端口
  预期: 地址配置显示
  文件: settings.test.ts

T-SET-05: AppData 路径配置
  PRD 需求: §5.11 "AppData 目录路径"
  步骤:
    1. 导航到设置页
    2. 验证显示数据路径配置
  预期: 路径正确显示
  文件: settings.test.ts
```
