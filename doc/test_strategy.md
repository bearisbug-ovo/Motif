# 测试策略

> 测试策略：基于 Puppeteer 的 E2E 前端模拟测试，所有测试用例与 PRD 需求项建立追溯关系。
> 测试框架：Jest + Puppeteer（`jest-puppeteer`）
> 基准文档：`prd.md`

---

## 测试环境

### 依赖安装

```bash
cd frontend
npm install -D puppeteer jest jest-puppeteer @types/jest ts-jest
```

### 配置文件

**jest.config.ts**
```ts
export default {
  preset: 'jest-puppeteer',
  transform: { '^.+\\.tsx?$': 'ts-jest' },
  testMatch: ['**/tests/e2e/**/*.test.ts'],
  testTimeout: 30000,
}
```

**jest-puppeteer.config.ts**
```ts
export default {
  launch: {
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 },
  },
  server: {
    command: 'npm run dev',
    port: 5173,
    launchTimeout: 15000,
  },
}
```

### 前置条件

| 条件 | 说明 |
|---|---|
| 后端运行 | `uvicorn main:app --reload --host 0.0.0.0 --port 8000`（`--reload` 确保代码变更后 .pyc 缓存自动刷新） |
| 数据库 | 使用生产库，测试通过 `cleanupPerson()` 在 `afterAll` 中清理自身创建的数据，**不删除用户数据** |
| ComfyUI | AI 功能测试需启动 ComfyUI；纯浏览/管理测试可跳过 |
| 测试素材 | `tests/fixtures/` 下放置 `test_1.jpg` ~ `test_5.jpg` + `test_video.mp4` |
| 代理环境 | 若系统设置了 `HTTP_PROXY`，Node.js `fetch` 会受影响；需通过 `page.evaluate(fetch(...))` 走浏览器请求绕过代理 |

### 运行方式

```bash
# 运行全部 E2E 测试（需先启动 backend:8000，jest-puppeteer 自动启动 frontend:5173）
cd frontend
npx jest --config jest.config.ts --runInBand --verbose

# 运行单个测试文件
npx jest --config jest.config.ts --runInBand --verbose --testPathPatterns="media-type-filter"
```

### 数据隔离策略

**原则：测试不得删除用户已有数据。**

| 策略 | 说明 |
|---|---|
| 唯一命名 | 每个测试创建人物名加 `Date.now()` 后缀，避免与用户数据冲突 |
| `afterAll` 清理 | 使用 `cleanupPerson(personId)` 递归删除测试创建的人物 → 图集 → 媒体 → 回收站记录 |
| 导入去重感知 | 后端对 `file_path + is_deleted == False` 做去重，同一文件被多个测试套件导入时只有第一个成功。测试用 `getMediaByPerson()` / `getMediaByAlbum()` 获取实际导入数量，动态计算预期值 |
| 条件断言 | 当去重导致 0 条媒体时，测试退化为验证 API 可达而非验证具体数据 |

### 辅助函数

完整源码见 `frontend/tests/e2e/helpers.ts`，主要函数：

```ts
// 基础常量
export const BASE = 'http://localhost:5173'
export const API = 'http://localhost:8000/api'

// CRUD 操作
export async function createPerson(name: string)
export async function deletePerson(personId: string)
export async function createAlbum(name: string, personId: string)
export async function deleteAlbum(albumId: string)
export async function importTestImages(personId: string, paths: string[])
export async function importToAlbum(albumId: string, paths: string[])
export async function rateMedia(mediaId: string, rating: number)
export async function softDeleteMedia(mediaId: string)
export async function batchDeleteMedia(ids: string[])

// 查询
export async function getMediaByPerson(personId: string): Promise<any[]>
export async function getMediaByAlbum(albumId: string): Promise<any[]>
export async function getPersons(): Promise<any[]>
export async function getAlbums(personId: string): Promise<any[]>
export async function getTasks(status?: string): Promise<any[]>
export async function getWorkspaceItems(): Promise<any[]>
export async function getRecycleBin(): Promise<any>

// 任务
export async function createTask(params: { workflow_type: string; params: Record<string, any>; execution_mode?: string })
export async function createChainTask(params: { first: TaskCreate; then: ChainStep[]; execution_mode?: string })
export async function deleteTask(taskId: string)
export async function cancelTask(taskId: string)

// 工作区
export async function addToWorkspace(mediaId: string)
export async function clearWorkspace()

// 回收站
export async function restoreMedia(mediaId: string)
export async function permanentDeleteMedia(mediaId: string)

// 页面导航与断言
export async function navigateTo(path: string)    // page.goto with networkidle0
export async function waitForTestId(testId: string, timeout?: number)
export async function clickTestId(testId: string)
export async function screenshot(name: string)    // 输出到 tests/screenshots/{name}.png
export function sleep(ms: number)

// 清理（非破坏性：只删除指定人物及其关联数据）
export async function cleanupPerson(personId: string)
```

### 已知注意事项

| 问题 | 原因 | 解决方案 |
|---|---|---|
| 后端 `.pyc` 缓存不刷新 | uvicorn 未加 `--reload` 启动，修改 `.py` 后 `.pyc` 不更新 | 始终用 `--reload` 启动；或手动删除 `__pycache__/*.pyc` 后重启 |
| `navigateTo('/tasks')` 超时 | `networkidle0` 等待所有请求完成，任务页可能有长轮询 | 改用 `page.goto(url, { waitUntil: 'domcontentloaded' })` + `sleep()` |
| `jest-puppeteer` 捕获 `pageerror` | 前端页面抛出的未捕获错误会被 jest-puppeteer 报告为测试失败 | 对可能触发前端报错的场景（如导航到不存在的 ID）用 API 测试替代 UI 测试 |
| Radix UI Select 不是原生 `<select>` | shadcn/ui 的 Select 组件渲染为 `button[role="combobox"]` | 用 `button[role="combobox"]` 选择器查找下拉控件 |
| 确认弹窗非浏览器原生 | 所有确认操作使用 ConfirmDialog（Radix Dialog），非 `window.confirm()` | 用 `[role="dialog"]` 选择器查找确认弹窗，点击弹窗内的"确定"按钮确认 |
| 任务队列 runner 竞态 | 后端 queue_runner 线程可能在取消请求到达前就处理了任务 | 使用 `waitForTerminal()` 轮询等待终态，接受多种终态（cancelled/failed/completed） |
| `HTTP_PROXY` 影响 Node.js fetch | 系统代理会拦截测试请求并可能丢失查询参数 | 通过 `page.evaluate(fetch(...))` 使用浏览器 fetch（走 Vite 代理） |

---

## 需求追溯矩阵

> 每个测试用例标注对应的 PRD 章节，格式 `[PRD §X.Y]`。

| 测试编号 | PRD 章节 | 功能点 | 优先级 | 测试文件 |
|---|---|---|---|---|
| T-NAV-01 ~ 03b | §5.1 | 左侧导航栏 | P0 | navigation.test.ts |
| T-SIDE-01 ~ 05 | §5.1 | 侧边栏 | P0 | sidebar.test.ts |
| T-LIB-01 ~ 08 | §5.2 | 媒体库主页 | P0 | media-library.test.ts |
| T-PCRUD-01 ~ 05 | §5.2 | 人物 CRUD | P0 | person-crud.test.ts |
| T-PER-01 ~ 08 | §5.3 | 人物主页 | P0 | person-home.test.ts |
| T-ACRUD-01 ~ 05 | §5.3 | 图集 CRUD | P0 | album-crud.test.ts |
| T-ALB-01 ~ 09 | §5.4 | 图集详情页 | P0 | — |
| T-ADET-01 ~ 08 | §5.4 | 图集详情页 | P0 | album-detail.test.ts |
| T-LB-01 ~ 12 | §5.5 | 大图浏览模式（规划） | P0 | — |
| T-LB-01 ~ 07 | §5.5 | 大图浏览基础 | P0 | lightbox-basic.test.ts |
| T-LBA-01 ~ 06 | §5.5 | 大图操作 | P0 | lightbox-actions.test.ts |
| T-LBGEN-01 ~ 05 | §5.5 | 大图生成链 | P1 | lightbox-generation.test.ts |
| T-LBNAV-01 ~ 06 | §5.5 | 大图双轴导航 | P0 | lightbox-navigation.test.ts |
| T-VID-01 ~ 14 | §5.6 | 视频大图模式 | P0 | video-player.test.ts |
| T-MASK-01 ~ 08 | §5.7 | 蒙版编辑器 | P1 | — |
| T-MCRUD-01 ~ 06 | §5.7 | 媒体操作 | P0 | media-crud.test.ts |
| T-TASK-01 ~ 09 | §5.8 | 任务队列页（规划） | P1 | — |
| T-TQ-01 ~ 21 | §5.8 | 任务队列（含链式任务） | P1 | task-queue.test.ts |
| T-WS-01 ~ 07 | §5.9 | 工作区（设置页 Tab） | P1 | workspace.test.ts |
| T-BIN-01 ~ 05 | §5.10 | 回收站（设置页 Tab） | P0 | recycle-bin.test.ts |
| T-SET-01 ~ 10 | §5.11 | 设置页 | P0 | settings.test.ts |
| T-CUI-01 ~ 04 | §5.11 | ComfyUI 状态 | P0 | comfyui-status.test.ts |
| T-IMP-01 ~ 08 | §6 | 导入流程 | P0 | import-flow.test.ts |
| T-AI-UP-01 ~ 03 | §7.2 | 高清放大 | P1 | — |
| T-AI-FS-01 ~ 07 | §7.4 | 换脸 | P1 | — |
| T-AI-IP-01 ~ 05 | §7.3, §7.4 | 局部修复 | P1 | — |
| T-RATE-01 ~ 05 | §8.1 | 评分系统 | P0 | rating-filter.test.ts |
| T-FILT-01 ~ 08 | §8.2, §8.3 | 筛选排序系统 | P0 | filter-sort.test.ts |
| T-FILT-DEF-01 ~ 04 | §8.2, §8.3 | 筛选默认值与重置 | P0 | filter-defaults.test.ts |
| T-SORT-01 ~ 03 | §8.3 | 排序系统 | P0 | — |
| T-COVER-01 ~ 05 | §8.4 | 封面管理 | P0 | cover-management.test.ts |
| T-DEL-01 ~ 04 (含 01b/01c/02b) | §8.6 | 软删除与回收站 | P0 | — |
| T-EXP-01 ~ 05 | §8.8 | 随机探索 | P0 | random-explore.test.ts |
| T-BATCH-01 ~ 05 | §5.4, §8.7 | 批量操作 | P0 | batch-operations.test.ts |
| T-KB-01 ~ 05 | §9.7 | 键盘快捷键 | P0 | keyboard-shortcuts.test.ts |
| T-RESP-01 ~ 13 | §9.6 | 响应式布局 | P0 | responsive-layout.test.ts |
| T-ERR-01 ~ 07 | §13 | 异常处理 | P0 | error-handling.test.ts |
| T-PERF-01 ~ 03 | §14 | 性能指标 | P0 | — |
| T-MTYPE-01 ~ 05 | §5.5 | 媒体类型筛选 | P0 | media-type-filter.test.ts |
| T-CANCEL-01 ~ 05 | §5.10 | 任务取消 | P1 | task-cancel.test.ts |
| T-AMOVE-01 | §5.4 | 图集移动 | P1 | — |
| T-MISS-01 ~ 05 | §6.6 | 文件丢失检测与重新定位 | P1 | — |
| T-LBNAV-09 ~ 11 | §5.5, §8.5 | 混合DFS排序、树布局、脱离链状态 | P1 | — |
| T-PWA-01 | §1 | PWA | P0 | — |
| T-API-01 ~ 02 | §4 | API 字段验证 | P0 | — |
| T-WF-01 ~ T-WF-19 | §5.11.1, §11.3, §15.6 | 工作流页面（运行/管理） | P1 | — |
| T-WF-20 ~ 21 | §5.11.1, §11.3 | 工作流默认值编辑、运行 Tab 遮罩 | P1 | — |
| T-WF-22-COMBO ~ 23-COMBO | §5.11.1 | 工作流 combo 参数下拉框、离线缓存 | P1 | — |
| T-DETAIL-01 ~ 03 | §5.4, §5.8, §5.9 | MediaDetailDialog | P0 | — |
| T-CTX-01 ~ 03 | §5.8, §5.9, §5.4 | 统一右键菜单（TaskQueue/Workspace）、开启多选、移动端子菜单 | P1 | — |
| T-UI-01 ~ 05 | P3-UI | 视觉改进（骨架屏/空状态/动画/字体/无障碍） | P3-UI | — |

> 测试文件列为 "—" 的测试用例尚未实现，详细用例描述见各功能模块文档。
