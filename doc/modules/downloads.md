# 网页抓取与下载

> 涉及代码：`backend/routers/downloads.py` | `backend/scrapers/` | `backend/batch_downloader.py` | `backend/models/platform_account.py, download_record.py` | `frontend/src/pages/Tools.tsx`(downloader section) | `frontend/src/stores/download.ts`

---

## 需求摘要

**所属阶段：P3 — 扩展工具** [PRD 版本规划]

解析社交平台帖子或含图网页链接，下载图片/视频并导入媒体库。支持单条下载、账号批量扫描下载、平台账号管理三大功能。[PRD §11.2]

**支持平台：** [PRD §11.2]

| 平台 | 技术方案 | 授权方式 | 账号扫描 |
|------|----------|----------|----------|
| 小红书 | Playwright 无头浏览器（单条解析），Cookie HTTP（账号扫描） | 单条无需授权；账号扫描需 Cookie | 支持 |
| 抖音 | Cookie HTTP（RSC flight data 解析） | 账号 Cookie | 支持 |
| B站动态/专栏 | API 较开放 | 账号 Cookie（部分内容需要） | 未实现 |
| X / Twitter | API 限制严格 | 账号 Cookie 或 API Key | 未实现 |
| Telegram | 公开频道直接抓取，私有频道需授权 | Telethon 账号授权 | 未实现 |
| 通用网页 | requests + Playwright 渲染动态页 | 无需授权 | 不适用 |

各平台授权配置在设置页"平台 Cookie"分区配置。小红书单条链接解析无需 Cookie（Playwright 抓取），但账号扫描需要 Cookie；抖音所有功能均需 Cookie。[PRD §11.2]

**触发方式：** [PRD §11.2.1]

- **PC 端**：在小工具页面的输入框粘贴链接，点击"解析"按钮
- **手机端**：同上，但粘贴内容可能包含分享提示文字（如"博主名发布了一条小红书笔记，快来看看吧~ http://xhslink.com/xxxxx"）。后端自动从粘贴文本中提取有效链接

**下载流程（单条）：** [PRD §11.2.2]

1. **粘贴文本 → 提取链接**：后端正则提取有效 URL，识别平台类型，检查授权是否配置
2. **解析元数据**：获取博主用户名/显示名、帖子标题、发布日期、图片/视频预览、媒体数量
3. **页面内展示解析结果，用户确认**
4. **账号关联步骤**：
   - 已关联人物 → 自动带入，可更改
   - 未关联 → 默认"新建人物"模式（预填博主显示名），可切换"已有人物"或"暂不关联"
   - "记住此账号的关联关系"选项（默认勾选，写入 PlatformAccount 表）
5. **图集配置**：图集名默认帖子标题，可选新建图集（默认）/ 合并到已有图集 / 作为未分类
6. **确认下载**：图片存入 `AppData/downloads/{platform}/`，写入 Media 和 DownloadRecord 记录，完成后跳转图集

**账号批量扫描与下载：** [PRD §11.2.4]

- **触发入口**：小工具页解析单条链接后显示"扫描该账号所有图文笔记"按钮；人物主页关联的平台账号徽章可点击触发扫描
- **扫描阶段**：后台异步任务，前端 2 秒轮询。通过平台内部 API 分页获取所有图文笔记，同时预收集图片 URL
- **去重**：按 `note_id` 查询 `DownloadRecord` 表，排除已成功下载且图集仍存在的笔记；已删除图集的笔记视为未下载，允许重新导入；`source_url` 统一存储为规范格式
- **确认下载**：小工具页可配置人物关联和图集模式；人物主页默认关联当前人物、每笔记一图集模式
- **批量下载**：优先使用扫描阶段预收集的图片 URL 直接下载（规避反爬），仅在无预收集 URL 时回退到单条解析；每条笔记间延迟 1 秒防限流；支持取消

**平台账号管理：** [PRD §11.2.5]

- 入口：设置页"平台账号"分区
- 功能：查看账号列表、编辑账号与人物关联、删除账号记录（不影响已下载图片）
- 人物主页 hero 区显示关联的所有平台账号徽章（平台名 + 显示名），点击触发批量扫描

**异常处理：** [PRD §13.4]

| 场景 | 预期行为 |
|------|----------|
| Cookie 过期 | 提示"授权已过期，请在设置页更新 Cookie" |
| 平台限流/封禁 | 显示具体错误信息，建议等待后重试，记录失败到 DownloadRecord |
| 内容已删除/不可访问 | 提示"原始内容不可访问"，记录失败原因 |

---

## 数据模型

### PlatformAccount（平台账号） [PRD §3.10]

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| platform | enum | `xiaohongshu` / `douyin` / `bilibili` / `twitter` / `telegram` / `web` |
| username | string | 平台用户名（唯一标识） |
| display_name | string? | 显示名称 |
| person_id | UUID? | 关联人物（可为空，多账号可关联同一人物） |
| created_at | datetime | 首次创建时间 |

**约束：**
- 同一人物可关联多个平台账号（如小红书账号A + X账号B → 同一人物）
- 同一平台账号只能关联一个人物
- 账号与人物的关联关系在首次下载时询问，后续自动带入

### DownloadRecord（下载记录） [PRD §3.11]

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| source_url | string | 原始链接（清洗后） |
| raw_text | string? | 原始粘贴文本（含分享提示文字） |
| platform | enum | 来源平台 |
| account_id | UUID? | 来源平台账号 |
| title | string? | 帖子/动态标题 |
| published_at | datetime? | 原帖发布日期 |
| media_count | int | 图片/视频数量 |
| album_id | UUID? | 生成的图集 ID |
| downloaded_at | datetime | 下载时间 |
| status | enum | `pending` / `completed` / `failed` |
| error_message | string? | 失败原因 |

**索引：** `(status)` — 下载记录筛选 [PRD §3.16]

---

## API 端点

### 单条下载端点 [开发指南 §3.11]

| Method | 路径 | 说明 |
|---|---|---|
| POST | `/api/download/parse` | 解析粘贴文本，提取链接并返回元数据预览 |
| POST | `/api/download/confirm` | 确认下载：下载图片到 AppData/downloads，创建 Album/Media/DownloadRecord 记录 |
| GET | `/api/download/records` | 下载记录列表（分页；query: `page`, `page_size`, `platform`） |
| POST | `/api/download/records/{id}/retry` | 重试失败的下载记录 |
| GET | `/api/download/info-by-album/{albumId}` | 查询图集的下载来源信息 |

### 批量扫描/下载端点 [开发指南 §3.11]

| Method | 路径 | 说明 |
|---|---|---|
| POST | `/api/download/scan-account` | 启动账号扫描，Body: `{platform, username, display_name?}` → `{job_id}` |
| GET | `/api/download/scan-jobs/{job_id}` | 轮询任务状态，返回 `{job_id, status, display_name, total_notes, skipped_notes, total_media, completed_notes, failed_notes, downloaded_media, notes?, error?}` |
| POST | `/api/download/batch-confirm` | 确认批量下载，Body: `{job_id, person_id?, create_person_name?, album_mode, remember_account}` |
| POST | `/api/download/scan-jobs/{job_id}/cancel` | 取消任务 |

### 平台账号端点 [开发指南 §3.11]

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/api/download/platform-accounts` | 平台账号列表 |
| PATCH | `/api/download/platform-accounts/{id}` | 更新账号关联的人物 Body: `{person_id}` |
| DELETE | `/api/download/platform-accounts/{id}` | 删除账号记录（不影响已下载的图片） |

**前端超时**：`/parse` 和 `/confirm` 请求超时设为 120 秒（Playwright 启动 + 页面加载耗时较长）。[开发指南 §3.11]

---

## 前端行为

### Store（download） [开发指南 §6.1]

Actions: `parseUrl`, `confirmDownload`, `fetchRecords`, `retryRecord`, `fetchAccounts`, `startScan`, `pollScanJob`, `confirmBatch`, `cancelScan`, `clearScanJob`

状态: `parseResult`, `scanJob`, `scanning`

### 页面结构 [PRD §11.2]

**小工具页面**（`/tools`）包含"网页抓取"和"下载记录"两个 Tab：
- **网页抓取 Tab**：粘贴链接输入框 + 解析按钮 → 解析结果预览（作者名、标题、缩略图网格、媒体数量）→ 账号关联配置 → 图集配置 → 确认下载按钮。解析后可触发"扫描该账号所有图文笔记"
- **下载记录 Tab**：历史下载记录列表（来源平台、账号、标题、日期、状态），失败记录显示错误原因支持重试，成功记录可跳转对应图集

**人物主页展示** [PRD §11.2.5]：
- hero 区显示关联的平台账号徽章（平台名 + 显示名）
- 点击账号徽章触发批量扫描，内容区顶部显示扫描进度卡片
- 进度卡片仅在当前人物关联的平台账号匹配时显示（按 platform+username 作用域限定）

### 抓取器架构 [开发指南 §3.11]

- `backend/scrapers/base.py`：`BaseScraper` 抽象基类 + `ScraperResult` / `MediaItem` / `NotePreview` / `AccountScanResult` 数据类
  - `ScraperResult.extra: dict`：平台特有数据（如抖音 `sec_uid`）
  - `list_user_notes(user_id, cursor?)` → `AccountScanResult`：账号扫描接口（子类实现）
- `backend/scrapers/xiaohongshu.py`：Playwright + Cookie + API 响应拦截
  - **单条解析**：Playwright sync API 在 ThreadPoolExecutor 中运行（避免 Windows uvicorn ProactorEventLoop 不支持 subprocess 的问题）
  - **账号扫描**：加载用户主页，拦截 `/api/sns/web/v1/user_posted` API 响应，滚动分页获取所有图文笔记，同时提取图片完整 URL（`WB_DFT` 场景）
  - **反爬策略**：XHS 阻止 headless 浏览器直接访问笔记页面（302 到 404），批量下载使用扫描阶段预收集的 URL
  - **URL 规范化**：所有 `source_url` 统一存储为 `https://www.xiaohongshu.com/explore/{note_id}` 格式
  - 支持链接格式：`xhslink.com/xxx`、`xiaohongshu.com/explore/xxx`、`xiaohongshu.com/discovery/item/xxx`
- `backend/scrapers/douyin.py`：Cookie HTTP
  - **单条解析**：从 `self.__pace_f.push()` RSC flight data 提取笔记数据；`username` 使用 `secUid`
  - **账号扫描**：调用 `/aweme/v1/web/aweme/post/` API，按 `sec_user_id` 分页，筛选 `aweme_type=68`（图文笔记）
  - 支持链接格式：`douyin.com/note/xxx`、`douyin.com/video/xxx`、`douyin.com/user/xxx?modal_id=xxx`、`v.douyin.com/xxx`（短链）
- `backend/scrapers/__init__.py`：`SCRAPERS` 列表 + `get_scraper(text)` 自动匹配平台

### 批量下载架构 [开发指南 §3.11]

- `backend/batch_downloader.py`：`BatchJob` 数据类，内存状态机（scanning → scan_complete → downloading → completed/failed/cancelled）
- `run_scan(job, db_factory)`：异步扫描任务，完成后按 `note_id` 查询 DownloadRecord 去重；扫描结果包含预收集的 `image_urls`
- `run_batch_download(job, db_factory)`：异步下载任务，优先使用预收集 URL 直接下载，仅在无预收集 URL 时回退到 `scraper.parse()`；per_note 模式仅在有文件下载成功时创建 Album（避免空图集）
- `NotePreview.image_urls: list[str]`：扫描阶段收集的完整图片 URL 列表，序列化到 Job notes 中供下载阶段使用

---

## 测试用例

> 来源：测试计划 §6（P3 网页抓取器测试用例）

### T-TOOL-01: 小工具页面导航

**PRD**: §11.2
**前提**: 应用已启动

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 点击侧边栏"小工具" | 导航到 `/tools`，页面显示"网页抓取"和"下载记录"两个 Tab |
| 2 | screenshot('tools-page') | Tab 切换 UI 正常渲染 |

### T-TOOL-02: 解析小红书链接

**PRD**: §11.2.1, §11.2.2
**前提**: 后端已启动，mock `/api/download/parse` 返回预设数据

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 在 textarea 输入小红书分享文本 | 文本正常显示 |
| 2 | 点击"解析"按钮 | 显示加载状态 |
| 3 | 等待解析完成 | 显示解析结果：作者名、标题、图片缩略图网格、媒体数量 |
| 4 | screenshot('tools-parse-result') | 结果预览布局正确 |

### T-TOOL-03: 关联设置默认值

**PRD**: §11.2.2 步骤 4
**前提**: 解析结果已返回（新账号，无已关联人物）

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 检查人物关联区域 | 默认选中"新建人物"，人物名预填为博主显示名 |
| 2 | 检查"记住此账号"选项 | 默认勾选 |
| 3 | 检查图集模式 | 默认选中"新建图集"，图集名预填为帖子标题 |
| 4 | screenshot('tools-association-defaults') | 默认值正确 |

### T-TOOL-04: 确认下载

**PRD**: §11.2.2 步骤 6
**前提**: 解析结果已展示，关联设置已填写，mock `/api/download/confirm`

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 点击"确认下载"按钮 | 显示下载中状态 |
| 2 | 等待完成 | toast 提示"下载完成"，自动跳转到生成的图集页 |

### T-TOOL-05: 下载记录列表

**PRD**: §11.2.3
**前提**: 已有下载记录数据

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 切换到"下载记录" Tab | 显示记录列表：平台标签、标题、日期、状态 |
| 2 | screenshot('tools-records') | 列表布局正确 |
| 3 | 对失败记录点击重试按钮 | 触发重试请求 |
| 4 | 对成功记录点击跳转按钮 | 导航到对应图集页 |

### T-TOOL-06: 批量扫描 — 小工具页入口

**PRD**: §11.2.4
**前提**: 已解析一条抖音/小红书链接，解析结果已显示

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 点击"扫描该账号所有图文笔记"按钮 | 按钮变为加载状态，显示扫描进度面板 |
| 2 | 等待扫描完成 | 显示笔记数量、图片数量、已跳过数量（如有去重） |
| 3 | 检查笔记预览列表 | 显示封面缩略图、标题、图片数，可展开查看全部 |
| 4 | 配置关联设置（人物、图集模式） | 关联设置 UI 正常渲染 |
| 5 | 点击"开始批量下载" | 显示下载进度条，笔记/图片计数递增 |
| 6 | screenshot('tools-batch-downloading') | 进度条和计数正确 |
| 7 | 等待下载完成 | 显示完成提示，含成功/失败笔记数 |

### T-TOOL-07: 批量扫描 — 人物主页入口

**PRD**: §11.2.4, §11.2.5
**前提**: 人物已关联平台账号

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 进入人物主页 | hero 区显示平台账号徽章（平台名 + 显示名） |
| 2 | screenshot('person-account-badges') | 徽章样式正确，不与操作按钮挤压 |
| 3 | 点击账号徽章 | 内容区顶部显示扫描进度卡片 |
| 4 | 等待扫描完成 | 显示"扫描完成 · X 个新笔记，Y 张图片（已跳过 Z 个已下载）" |
| 5 | 点击"每个笔记建一个图集，开始下载" | 进度条出现，逐步推进 |
| 6 | 等待完成 | 完成提示 + 页面数据自动刷新（图集/未分类列表更新） |
| 7 | 导航到另一个人物主页（未关联该账号） | 不显示扫描进度卡片（按 platform+username 作用域限定） |

### T-TOOL-08: 批量扫描 — 去重逻辑

**PRD**: §11.2.4 去重
**前提**: 已通过批量扫描下载过某账号的全部笔记

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 再次扫描同一账号 | 扫描完成后提示"所有笔记都已下载过，没有新内容" |
| 2 | 删除其中一个已下载的图集 | 图集删除成功 |
| 3 | 再次扫描同一账号 | 扫描完成后显示 1 个新笔记（被删除图集对应的那条） |
| 4 | 确认下载 | 仅下载被删除的那条笔记 |
| 5 | 通过手机分享链接（`/discovery/item/xxx?...`）单条下载某笔记 | 下载成功，记录的 source_url 为规范格式 `/explore/{id}` |
| 6 | 扫描该笔记所属账号 | 该笔记被正确跳过（按 note_id 去重，不受 URL 格式影响） |

### T-TOOL-09: 抖音链接解析

**PRD**: §11.2
**前提**: 已配置抖音 Cookie

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 粘贴 `douyin.com/note/xxx` 格式链接 | 解析成功，显示平台标签"抖音" |
| 2 | 粘贴 `douyin.com/user/xxx?modal_id=xxx` 格式链接 | 解析成功（自动转换为 note URL） |
| 3 | 粘贴 `v.douyin.com/xxx` 短链 | 解析成功（自动跟踪重定向） |
