# Motif 前端测试计划

> 测试策略：基于 Puppeteer 的 E2E 前端模拟测试，所有测试用例与 PRD 需求项建立追溯关系。
> 测试框架：Jest + Puppeteer（`jest-puppeteer`）
> 基准文档：`prd.md`

---

## 1. 测试环境

### 1.1 依赖安装

```bash
cd frontend
npm install -D puppeteer jest jest-puppeteer @types/jest ts-jest
```

### 1.2 配置文件

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

### 1.3 前置条件

| 条件 | 说明 |
|---|---|
| 后端运行 | `uvicorn main:app --reload --host 0.0.0.0 --port 8000`（`--reload` 确保代码变更后 .pyc 缓存自动刷新） |
| 数据库 | 使用生产库，测试通过 `cleanupPerson()` 在 `afterAll` 中清理自身创建的数据，**不删除用户数据** |
| ComfyUI | AI 功能测试需启动 ComfyUI；纯浏览/管理测试可跳过 |
| 测试素材 | `tests/fixtures/` 下放置 `test_1.jpg` ~ `test_5.jpg` + `test_video.mp4` |
| 代理环境 | 若系统设置了 `HTTP_PROXY`，Node.js `fetch` 会受影响；需通过 `page.evaluate(fetch(...))` 走浏览器请求绕过代理 |

### 1.4 运行方式

```bash
# 运行全部 E2E 测试（需先启动 backend:8000，jest-puppeteer 自动启动 frontend:5173）
cd frontend
npx jest --config jest.config.ts --runInBand --verbose

# 运行单个测试文件
npx jest --config jest.config.ts --runInBand --verbose --testPathPatterns="media-type-filter"
```

### 1.5 测试数据隔离策略

**原则：测试不得删除用户已有数据。**

| 策略 | 说明 |
|---|---|
| 唯一命名 | 每个测试创建人物名加 `Date.now()` 后缀，避免与用户数据冲突 |
| `afterAll` 清理 | 使用 `cleanupPerson(personId)` 递归删除测试创建的人物→图集→媒体→回收站记录 |
| 导入去重感知 | 后端对 `file_path + is_deleted == False` 做去重，同一文件被多个测试套件导入时只有第一个成功。测试用 `getMediaByPerson()` / `getMediaByAlbum()` 获取实际导入数量，动态计算预期值 |
| 条件断言 | 当去重导致 0 条媒体时，测试退化为验证 API 可达而非验证具体数据 |

### 1.6 辅助函数

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

### 1.7 已知注意事项

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

## 2. 需求追溯矩阵

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

---

## 3. 测试用例详情

### 3.1 左侧导航栏 [PRD §5.1]

```
T-NAV-01: 导航栏固定展开状态
  PRD 需求: "固定宽度展开，始终显示图标 + 文字"
  前置: 打开首页（桌面端视口 ≥ 768px）
  步骤:
    1. 检查侧边栏宽度约 176px（w-44）
    2. 验证同时显示图标和文字标签
  预期: 侧边栏固定展开，显示图标 + 文字
  Puppeteer:
    await page.goto(BASE)
    const width = await page.$eval('[data-testid="sidebar"]', el => el.offsetWidth)
    expect(width).toBeGreaterThan(150)
    expect(width).toBeLessThan(200)

T-NAV-03: 任务角标显示
  PRD 需求: "角标：旋转（运行中）/ 蓝色数字（待开始）/ 红色数字（失败）/ 绿色数字（完成），按优先级只显示一个"
  前置: 数据库中有 1 个 failed 任务
  步骤:
    1. 等待侧边栏渲染完成
    2. 在"任务队列"导航项上检查红色角标
    3. 验证角标显示数字 "1"
  预期: 失败任务以红色角标显示
  Puppeteer:
    const badge = await page.$('[data-testid="task-badge-failed"]')
    expect(badge).not.toBeNull()
    const text = await page.$eval('[data-testid="task-badge-failed"]', el => el.textContent)
    expect(text).toBe('1')

T-NAV-03b: 待开始任务角标显示
  PRD 需求: "待开始：蓝色数字角标（pending 数量）"
  前置: 数据库中有 3 个 pending 任务，无 running 任务
  步骤:
    1. 等待侧边栏渲染完成
    2. 在"任务队列"导航项上检查蓝色角标
    3. 验证角标显示数字 "3"
  预期: 待开始任务以蓝色角标显示
  Puppeteer:
    const badge = await page.$('[data-testid="task-badge-pending"]')
    expect(badge).not.toBeNull()
    const text = await page.$eval('[data-testid="task-badge-pending"]', el => el.textContent)
    expect(text).toBe('3')
```

### 3.2 媒体库主页 [PRD §5.2]

```
T-LIB-01: 人物卡片网格展示
  PRD 需求: "网格卡片，每张卡片显示人物封面 + 姓名 + 平均评分"
  前置: 导入 3 个人物，各含 5 张图片
  步骤:
    1. 打开 /
    2. 验证 3 张人物卡片
    3. 每张卡片含封面图、姓名、评分
  预期: 网格正确渲染，信息完整
  Puppeteer:
    await page.goto(BASE)
    await waitForSelector('[data-testid="person-card"]')
    const count = await countElements('[data-testid="person-card"]')
    expect(count).toBe(3)

T-LIB-02: 人物卡片视觉样式
  PRD 需求: "正方形封面，底部渐变叠加，左上角评分徽章"
  前置: 人物 A 有 3 张已评分（4,5,3），人物 B 全部未评分
  步骤:
    1. 验证卡片为正方形（aspect-square）
    2. 验证底部渐变叠加显示人物名和计数
    3. 检查人物 A 左上角评分徽章显示 "★4.0"
    4. 检查人物 B 无评分徽章
  预期: 卡片样式符合 PRD 规范（正方形 + 渐变叠加）

T-LIB-03: 主页排序切换
  PRD 需求: "按导入时间（默认）/ 按平均评分 / 按名称"
  步骤:
    1. 验证默认排序为"导入时间"
    2. 切换到"评分最高"
    3. 验证高评分人物排在前面
    4. 切换到"名称"
    5. 验证按名称字母序排列
  预期: 三种排序均正确

T-LIB-04: 新建人物
  PRD 需求: §5.2 顶部操作 "新建人物"
  步骤:
    1. 点击"新建人物"按钮
    2. 弹窗中输入"测试人物"
    3. 点击确认
    4. 验证页面新增一张人物卡片
  预期: 人物创建成功，页面刷新显示

T-LIB-05: 人物卡片右键菜单 - 完整性
  PRD 需求: §5.2 人物卡片右键菜单
  步骤:
    1. 右键点击人物卡片
    2. 验证菜单包含：重命名人物、导入、新建图集、清理空图集、清理低分图、删除人物
  预期: 所有菜单项存在，与人物主页空白区域菜单一致

T-LIB-05b: 人物卡片右键菜单 - 重命名
  PRD 需求: §5.2 "重命名人物"
  步骤:
    1. 右键点击人物卡片
    2. 选择"重命名人物"
    3. 弹窗中修改为"新名字"
    4. 确认
    5. 验证卡片名称更新
  预期: 重命名成功
  Puppeteer:
    await rightClick('[data-testid="person-card"]:first-child')
    await page.click('text=重命名人物')
    await page.fill('input', '新名字')
    await page.click('text=保存')

T-LIB-06: 人物卡片右键菜单 - 删除（三选一）
  PRD 需求: §5.2 "删除人物（弹窗三选一）"
  步骤:
    1. 右键点击人物卡片 → "删除人物"
    2. 弹窗显示三个选项
    3. 选择"仅删除人物"
    4. 确认后人物消失，图片变为未分类
  预期: 三种删除模式弹窗正确显示

T-LIB-07: 人物卡片悬浮菜单
  PRD 需求: "卡片右上角隐藏 … 按钮，悬浮 0.5s 后显示"
  步骤:
    1. 鼠标悬浮在人物卡片上
    2. 等待 500ms
    3. 验证右上角出现 … 按钮
    4. 点击 → 弹出与右键相同的菜单
  预期: 悬浮显示菜单按钮

T-LIB-08: 评分筛选
  PRD 需求: §5.2 "评分筛选（等于 / 大于等于 / 小于等于指定星级）"
  前置: 人物 A 评分 4.0，人物 B 评分 2.0，人物 C 未评分
  步骤:
    1. 设置评分筛选 ≥ 3 星
    2. 验证仅人物 A 显示
    3. 清除筛选
    4. 验证 3 个人物全部显示
  预期: 筛选条件正确过滤
```

### 3.3 人物主页 [PRD §5.3]

```
T-PER-01: 人物主页布局
  PRD 需求: "顶部：人物封面大图 + 姓名 + 平均评分；主体：图集网格 + 未分类区域"
  前置: 人物有 2 个图集 + 3 张未分类
  步骤:
    1. 点击人物卡片进入主页
    2. 验证顶部显示封面、姓名、评分
    3. 验证图集区域显示 2 个图集卡片
    4. 验证未分类区域显示 3 张缩略图
  预期: 布局正确，数据完整
  Puppeteer:
    await page.goto(`${BASE}/person/${personId}`)
    await waitForSelector('h1')
    const albumCount = await countElements('[data-testid="album-card"]')
    expect(albumCount).toBe(2)

T-PER-01b: 未分类卡片显示文件名
  PRD 需求: §5.3 "未分类卡片底部渐变叠加显示文件名"
  前置: 人物有未分类（已知文件名）
  步骤:
    1. 进入人物主页
    2. 验证未分类卡片底部显示文件名（不含扩展名）
    3. 缩放网格至紧凑模式（列数≥10）
    4. 验证文件名叠层隐藏
  预期: 文件名正确显示，compact 模式下隐藏
  Puppeteer:
    await page.goto(`${BASE}/person/${personId}`)
    const fileName = await page.$eval('[data-testid="media-card"] h3', el => el.textContent)
    expect(fileName).toBeTruthy()

T-PER-02: 导入按钮默认关联当前人物
  PRD 需求: §5.3 "导入图片（默认关联当前人物）"
  步骤:
    1. 在人物主页点击"导入"
    2. 验证导入弹窗中人物已预选为当前人物
  预期: 导入默认关联当前人物

T-PER-03: 新建图集
  PRD 需求: §5.3 "新建图集"
  步骤:
    1. 点击"新建图集" → 输入名称 → 确认
    2. 验证图集区域新增一个卡片
  预期: 图集创建成功

T-PER-04: 随机探索（人物范围）
  PRD 需求: §5.3 / §8.8 "随机探索（该人物范围）"
  步骤:
    1. 点击"随机"按钮
    2. 验证进入大图模式
    3. 验证顶部显示探索进度（如 1/10）
    4. 验证图片来自当前人物
  预期: 随机探索正确限定人物范围

T-PER-05: 多选模式入口
  PRD 需求: §5.3 "多选模式入口"
  步骤:
    1. 点击"多选"按钮
    2. 验证每张未分类卡片右上角出现圆形选中标记
    3. 点击 3 张图片，验证右上角标记变为主色填充 + 勾号，卡片边框变为主色
    4. 验证底部出现选择工具栏，显示"已选 3"
    5. 点击"全选"，验证按钮变为"取消全选"，所有卡片显示选中标记
    6. 点击"取消全选"，验证所有卡片取消选中，按钮恢复为"全选"
    7. 再次点击"多选"退出
  预期: 多选模式正确切换，全选/取消全选自动切换

T-PER-06: 未分类卡片右键菜单完整性
  PRD 需求: §5.4 图片卡片右键菜单
  步骤:
    1. 右键点击未分类卡片（image 类型）
    2. 验证菜单包含：AI 功能（子菜单）、加入工作区、移动到图集、在资源管理器中显示、评分、开启多选、查看详情、删除
    3. 悬浮"AI 功能"项，验证子菜单展开含：高清放大、换脸、局部重绘、图生图、文生图、预处理
    4. 验证"开启多选"点击后进入多选模式并自动选中当前卡片
  预期: 所有菜单项存在，AI 操作收纳在子菜单中，开启多选自动选中当前项
  Puppeteer:
    await rightClick('[data-testid="media-card"]:first-child')
    // hover AI 功能 submenu
    await page.hover('text=AI 功能')
    await page.waitForSelector('text=高清放大')
    await page.waitForSelector('text=图生图')
    await page.waitForSelector('text=预处理')

T-PER-07: 空白处右键菜单
  PRD 需求: §5.3 "人物主页空白处（含 Hero 区域）→ 与人物卡片右键菜单一致"
  步骤:
    1. 右键点击页面空白处（非卡片区域）
    2. 验证菜单包含：重命名人物、导入、新建图集、清理空图集、清理低分图、删除人物
    3. 右键点击 Hero 区域（人物封面/名称/评分区域）
    4. 验证同样弹出菜单，内容与步骤 2 一致
  预期: 空白处和 Hero 区域右键菜单与人物卡片一致
```

### 3.4 图集详情页 [PRD §5.4]

```
T-ALB-01: 图集详情页布局
  PRD 需求: §5.4 顶部筛选和排序工具栏 + 图片网格
  前置: 图集含 10 张图片
  步骤:
    1. 进入图集详情页
    2. 验证顶部显示图集名称、图片数量
    3. 验证筛选栏存在
    4. 验证图片网格渲染 10 张缩略图
  预期: 布局和数据正确

T-ALB-02: 布局模式切换
  PRD 需求: §5.4（实现为 grid/row 两种模式）
  步骤:
    1. 默认为 row 布局
    2. 点击方块网格图标
    3. 验证切换为等宽方块网格
    4. 点击行布局图标切回
  预期: 两种布局正确切换

T-ALB-03: 排序切换
  PRD 需求: §5.4 "排序方式：导入时间 / 评分 / 名称"
  步骤:
    1. 验证默认排序为"默认顺序"
    2. 切换到"评分最高"
    3. 验证高评分图片排在前面
  预期: 排序正确

T-ALB-04: source_type 筛选
  PRD 需求: §5.4 "仅本地图 / 混合显示 / 仅生成图"
  前置: 图集含 5 张本地图 + 3 张生成图
  步骤:
    1. 筛选 source_type=local → 验证显示 5 张
    2. 筛选 source_type=generated → 验证显示 3 张
    3. 清除筛选 → 验证显示 8 张
  预期: 筛选正确过滤

T-ALB-05: 图片卡片点击进入大图模式
  PRD 需求: §5.5 "触发：点击任意图片卡片"
  步骤:
    1. 点击第一张图片卡片
    2. 验证大图模式打开（全屏覆盖层出现）
    3. 验证主图显示
  预期: 大图模式正确打开

T-ALB-06: 图集右键菜单 - 完整性
  PRD 需求: §5.3 图集卡片右键菜单
  步骤:
    1. 空白处右键
    2. 验证菜单包含：重命名图集、导入、移动到其他人物、AI 功能（子菜单）、删除图集
    3. 悬浮"AI 功能"项，验证子菜单含：批量 AI（子菜单列出可批量执行的工作流类别）
  预期: 所有菜单项存在，与图集卡片右键菜单一致

T-ALB-06b: 图集右键菜单 - 重命名
  PRD 需求: §5.3 图集卡片右键菜单 "重命名图集"
  步骤:
    1. 空白处右键 → "重命名图集"
    2. 修改名称 → 保存
    3. 验证顶部标题更新
  预期: 重命名成功

T-ALB-07: 图集右键菜单 - 批量 AI（AI 子菜单）
  PRD 需求: §5.3 / §7.5 "AI 功能 ▸ 批量 AI"
  步骤:
    1. 空白处右键 → 悬浮"AI 功能" → 选择一个可批量执行的类别（如"换脸"）
    2. 验证 BatchAiDialog 弹窗显示图片数量
    3. 选择具体工作流，配置共享参数
    4. 配置结果图集名称
    5. 点击提交
  预期: BatchAiDialog 正确渲染，提交后 toast 显示创建的任务数量

T-ALB-08: 图集右键菜单 - 删除
  PRD 需求: §5.3 "删除图集"
  步骤:
    1. 空白处右键 → "删除图集"
    2. 弹窗确认
    3. 验证页面跳转返回
  预期: 删除后正确导航

T-ALB-09: 多选批量操作（Grid + Row 布局）
  PRD 需求: §5.4 "多选后支持：批量移动到图集、批量加入工作区、批量删除"
  步骤:
    1. 在 Grid 布局下开启多选模式
    2. 点击 3 张图片，验证右上角圆形标记变为选中状态
    3. 点击底部工具栏"加入工作区"
    4. 验证 toast 提示成功
    5. 验证工作区新增 3 条
    6. 切换到 Row（等高行）布局
    7. 开启多选模式，点击图片，验证同样能选中并显示右上角标记
  预期: 两种布局下多选和批量操作均正常
```

### 3.5 大图浏览模式 [PRD §5.5]

```
T-LB-01: 大图模式基本布局
  PRD 需求: §5.5 顶部操作栏 + 主图展示区 + 底部预览条
  步骤:
    1. 点击图片进入大图模式
    2. 验证顶部栏存在（评分、删除、封面等按钮）
    3. 验证主图显示
    4. 验证底部预览条显示缩略图
  预期: 三段布局正确渲染

T-LB-02: 键盘导航 ← →
  PRD 需求: §9.7 "← / → 切换图片"
  前置: 图集 5 张图
  步骤:
    1. 打开第 1 张大图
    2. 按 → 键
    3. 验证切换到第 2 张（序号显示 2/5）
    4. 按 ← 键
    5. 验证回到第 1 张
  预期: 键盘切换正确
  Puppeteer:
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
    const counter = await getTextContent('[data-testid="lightbox-counter"]')
    expect(counter).toContain('2 / 5')

T-LB-03: 键盘快速评分 1-5
  PRD 需求: §9.7 "1-5 快速评分"
  步骤:
    1. 打开大图模式
    2. 按键盘 "4"
    3. 验证评分组件显示 4 星
    4. 按 "0" 清除评分
    5. 验证评分清除
  预期: 键盘评分即时生效

T-LB-04: Esc 退出大图
  PRD 需求: §9.7 "Esc 退出大图模式"
  步骤:
    1. 打开大图模式
    2. 按 Esc
    3. 验证大图覆盖层消失
  预期: 正确退出

T-LB-04b: 点击黑边退出大图
  PRD 需求: §5.5 "单击黑边区域退出大图模式"
  步骤:
    1. 打开大图模式（图片两侧或上下有黑边）
    2. 点击图片外的黑边区域
    3. 验证大图模式关闭
    4. 重新打开大图模式，点击图片本身
    5. 验证进入放大模式（不关闭大图）
  预期: 黑边点击关闭大图，图片点击进入放大

T-LB-04c: 左右导航条切换图片（PC）
  PRD 需求: §5.5 "左右切换导航条"
  步骤:
    1. 打开大图模式（非首张/末张）
    2. hover 左侧边缘，验证导航条显示半透明背景和左箭头
    3. 验证鼠标指针变为左方向箭头
    4. 点击左导航条，验证切换到上一张
    5. hover 右侧边缘并点击，验证切换到下一张
    6. 切换到首张图片，验证左导航条不显示
    7. 切换到末张图片，验证右导航条不显示
  预期: 导航条 hover 可见，点击切换流畅，首末张正确隐藏

T-LB-05: 放大模式（PC）— 鼠标移动平移
  PRD 需求: §5.5.2 "单击/滚轮/双击进入放大模式，鼠标移动平移"
  步骤:
    1. 打开大图模式
    2. 单击图片进入放大模式，验证以点击位置为中心放大到 2x
    3. 移动鼠标，验证放大图跟随鼠标平移（鼠标在原图位置点与放大图对应位置重合）
    4. 验证鼠标指针显示为放大镜图标
    5. 鼠标移出原图范围（移到黑边），验证放大图隐藏且鼠标恢复默认箭头
    6. 鼠标移回原图范围，验证放大图重新出现且指针恢复放大镜
    7. 单击图片，验证动画回到 fit-to-screen
    8. 在黑边区域滚轮，验证切换图片（不触发缩放）
  预期: 放大模式进入/退出/鼠标移动平移/超出隐藏交互完整，60fps 无卡顿

T-LB-06: 放大模式双击切换与滚轮缩放
  PRD 需求: §5.5.2 "双击切换 fit ↔ 2x"
  步骤:
    1. 双击主图，验证放大到 2x（带动画）
    2. 移动鼠标，验证放大图跟随鼠标平移
    3. 双击主图，验证动画回到 fit
    4. 滚轮放大到 4x，验证倍率指示器显示 "4.0x"
    5. 滚轮缩放时验证鼠标下像素点不动
    6. 右键退出放大，验证动画回到 fit
  预期: 双击切换带动画，鼠标移动平移流畅，滚轮连续缩放

T-LB-07: 沉浸模式
  PRD 需求: §5.5.1 "隐藏所有 UI，仅保留图片全屏展示"
  步骤:
    1. 打开大图模式
    2. 点击沉浸模式按钮
    3. 验证顶部栏、底部预览条隐藏
    4. 验证仍可用 ← → 切换
    5. 按 Esc 退出沉浸
    6. 验证 UI 恢复
  预期: 沉浸模式正确隐藏/恢复 UI

T-LB-08: 底部预览条滚动高亮
  PRD 需求: §5.5 "动态滚动，当前图高亮居中"
  步骤:
    1. 打开 20 张图的大图模式
    2. 切换到第 15 张
    3. 验证底部预览条中第 15 张缩略图处于高亮状态
    4. 验证其居中显示
  预期: 预览条跟随滚动

T-LB-09: 右键菜单 - 设为封面
  PRD 需求: §5.5 顶部操作栏与右键菜单一致
  步骤:
    1. 大图模式中右键
    2. 选择"设为图集封面"
    3. 验证 toast 提示"已设为图集封面"
  预期: 封面设置成功

T-LB-10: 右键菜单 - AI 功能子菜单 - 高清放大
  PRD 需求: §5.5 / §7.2 AI 功能子菜单
  步骤:
    1. 大图模式中（image）右键
    2. 悬浮"AI 功能"子菜单
    3. 选择"高清放大"
    4. 验证 WorkflowRunDialog 弹出，category 为 upscale
    5. 验证源图自动填入 source_image 参数
  预期: 正确打开工作流选择弹窗

T-LB-11: 右键菜单 - AI 功能子菜单 - 换脸
  PRD 需求: §5.5 / §7.4
  步骤:
    1. 大图模式中右键 → 悬浮"AI 功能" → "换脸"
    2. 验证 WorkflowRunDialog 弹出，category 为 face_swap
    3. 验证 base_image 自动填入，face_ref 需手动选取
  预期: 正确打开工作流选择弹窗

T-LB-12: 右键菜单 - AI 功能子菜单 - 局部修复
  PRD 需求: §5.5 / §7.3
  步骤:
    1. 大图模式中右键 → 悬浮"AI 功能" → "局部修复"
    2. 验证 WorkflowRunDialog 弹出，category 为 inpaint
    3. 验证 mask 参数显示"绘制遮罩"按钮
    4. 点击"绘制遮罩" → MaskEditor 全屏打开
  预期: 正确打开工作流选择弹窗，可触发蒙版编辑器
```

### 3.6 视频大图模式 [PRD §5.6]

```
T-VID-01: 视频播放器渲染
  PRD 需求: §5.6 "主区域替换为独立 VideoPlayer 组件"
  前置: 导入一个 MP4 视频
  步骤:
    1. 点击视频卡片进入大图模式
    2. 验证显示 <video> 元素而非 <img>
    3. PC：验证控件栏存在（播放/暂停、进度条、音量、倍速、逐帧、截图、全屏）
    4. 移动端：验证控件栏精简为（播放/暂停、进度条、音量、时间、···、横屏），无逐帧/截图/倍速/全屏按钮
  预期: 视频播放器正确渲染，自动静音播放；移动端控件栏不溢出

T-VID-02: 播放/暂停控制（PC）
  PRD 需求: §5.6 "播放/暂停"
  步骤:
    1. 点击视频区域 → 验证暂停
    2. 再次点击 → 验证播放
    3. 按空格键 → 验证播放/暂停切换
  预期: 鼠标点击和空格键均可控制播放

T-VID-03: 进度条点击与拖拽 Seek
  PRD 需求: §5.6 "可点击/拖拽进度条"
  前提: 后端 /api/files/serve 支持 HTTP Range 请求（206 Partial Content），否则浏览器无法 seek
  步骤:
    1. 播放视频数秒
    2. 单击进度条某位置 → 验证 currentTime 立即跳转，视频画面同步更新
    3. 按住进度条拖拽到不同位置 → 验证进度条和视频画面实时跟随
    4. 松开 → 验证 currentTime 最终定位到松开位置，进度条不回弹
    5. 移动端：拖拽进度条时不触发 LightBox 左右滑动切换（由 Touch Arbiter 保证，详见 T-VID-17）
  预期: 单击即跳转，拖拽平滑 seek，含缓冲进度显示，移动端手势不冲突

T-VID-04: 音量控制
  PRD 需求: §5.6 "音量滑块"
  步骤:
    1. PC/移动端：点击控件栏静音/取消静音按钮 → 验证状态切换（图标 VolumeX ↔ Volume2）
    2. PC：hover 音量图标 → 验证音量滑块展开；拖拽滑块 → 验证音量变化
    3. 移动端：验证音量按钮可见（无滑块），点击切换静音状态
    4. PC：按 ↑/↓ 方向键 → 验证音量 ±10%
    5. 移动端：右键菜单（双指触碰）→ 验证包含"取消静音"或"静音"选项，点击后状态切换
  预期: PC 有按钮+滑块+键盘；移动端有按钮+右键菜单

T-VID-05: 倍速选择
  PRD 需求: §5.6 "倍速选择（0.5x–3x）"
  步骤:
    1. PC：点击倍速按钮（默认显示 "1x"）→ 弹出下拉菜单
    2. 选择 2x → 验证 playbackRate 变为 2
    3. 选择 0.5x → 验证 playbackRate 变为 0.5
    4. 移动端：点击 ··· 按钮 → 弹出菜单顶部显示倍速横排按钮
    5. 选择倍速 → 验证切换正常，当前倍速高亮
  预期: PC 下拉菜单选择；移动端溢出菜单内横排按钮选择

T-VID-06: 键盘快捷键
  PRD 需求: §5.6 "PC 键盘快捷键"
  步骤:
    1. 按 ← → 方向键 → 验证快退/快进 5s（不触发 LightBox 切换图片）
    2. 按 ↑ ↓ → 验证音量调节
    3. 按 F → 验证全屏切换
    4. 按空格 → 验证播放/暂停
  预期: 视频模式下键盘快捷键由 VideoPlayer 处理

T-VID-07: 视频截图与可选高清放大
  PRD 需求: §5.6 "截图后可选高清放大"
  步骤:
    1. 暂停视频在某一帧（记录当前时间 T）
    2. 点击控件栏截图按钮
    3. 验证 toast 提示"截图已保存"且附带"高清放大"按钮
    4. 验证截图 Media 记录的 video_timestamp ≈ T（允许误差 0.1s）
    5. 忽略 toast（等待自动消失）→ 验证截图已保存为原始分辨率
    6. 再次截图，点击 toast 中的"高清放大"按钮
    7. 验证 UpscaleDrawer 面板打开，且目标媒体为刚截的图
  预期: 截图默认保存原图且记录视频时间戳，用户可选择性进行高清放大

T-VID-08: 静音记忆（Session Unmute）
  PRD 需求: §5.6 "用户取消静音后同会话内后续视频不再静音"
  步骤:
    1. 进入视频大图模式 → 验证自动静音播放
    2. 点击取消静音
    3. 切换到下一个视频 → 验证不再静音
  预期: sessionUnmuted 状态跨视频保持

T-VID-09: 控件自动隐藏
  PRD 需求: §5.6 "3 秒无操作自动隐藏"
  步骤:
    1. PC：鼠标进入视频区域 → 控件显示
    2. 鼠标静止 3 秒 → 控件隐藏
    3. 移动鼠标 → 控件重新显示
  预期: 控件 3 秒无交互自动隐藏

T-VID-10: 逐帧步进
  PRD 需求: §5.6 "逐帧步进"
  步骤:
    1. 暂停视频
    2. 点击"下一帧"按钮 → 验证 currentTime 前进 ~1/30s
    3. 点击"上一帧"按钮 → 验证 currentTime 后退 ~1/30s
  预期: 逐帧步进精确控制

T-VID-11: 视频缩略图显示
  PRD 需求: §9.5 "视频缩略图"
  前置: 导入一个 MP4 视频
  步骤:
    1. 在瀑布流网格中查看视频卡片
    2. 验证显示第一帧缩略图（非空白/错误）
    3. 验证右下角有播放三角图标
  预期: 视频卡片正确显示缩略图和播放图标

T-VID-12: 截图自动设为视频封面
  PRD 需求: §5.6 "首张截图自动成为视频封面"
  前置: 导入一个 MP4 视频
  步骤:
    1. 在大图模式截取视频帧
    2. 返回网格查看视频卡片
    3. 验证视频封面切换为截图内容
  预期: thumbnail_path 被设置为截图路径，卡片显示截图封面

T-VID-13: 删除截图后视频封面回退
  PRD 需求: §5.6 "视频封面"
  前置: 视频已有一张截图作为封面
  步骤:
    1. 删除该截图
    2. 查看视频卡片
    3. 验证视频封面回退为第一帧
  预期: thumbnail_path 清空，卡片显示第一帧缩略图

T-VID-14: LightBox 缩略图条视频项
  PRD 需求: §9.5 "视频缩略图"
  前置: 图集中包含图片和视频
  步骤:
    1. 在大图模式查看底部缩略图条
    2. 验证视频项也正确显示缩略图
  预期: 缩略图条中视频项显示第一帧或截图封面

T-VID-15: 视频 letterbox 黑边点击关闭大图
  PRD 需求: §5.6 "点击 letterbox 黑边区域可关闭大图模式"
  前置: 导入一个 16:9 横屏视频
  步骤:
    1. 进入大图模式播放视频
    2. 点击视频上下方的黑边（letterbox）区域
    3. 验证大图模式关闭
    4. 重新进入大图模式
    5. 点击视频内容区域（非黑边）
    6. 验证大图模式不关闭
  预期: 黑边点击退出，内容区域点击不退出

T-VID-16: 视频切换无残影
  PRD 需求: §5.6 "双 video 元素 A/B 交替消除切换黑闪"
  前置: 图集中包含不同宽高比的视频（如 16:9 和 9:16）
  步骤:
    1. 进入大图模式播放第一个视频
    2. 切换到下一个不同宽高比的视频
    3. 观察切换瞬间，旧视频不应从边缘露出
  预期: 切换无黑闪、无旧帧残影

T-VID-17: Touch Arbiter — 进度条拖拽不触发切换（移动端）
  PRD 需求: §5.6 "进度条 pointerDown 立即 claim seeking，阻止其他手势"
  前置: 移动端，图集中包含多个视频
  步骤:
    1. 在视频大图模式下触摸并拖拽进度条
    2. 水平拖拽超过 60px
    3. 松开手指
  预期: 视频 seek 到拖拽位置，不触发 LightBox 左右切换

T-VID-18: Touch Arbiter — 长按倍速不弹菜单（移动端）
  PRD 需求: §5.6 "长按后松开：恢复原速 1x"
  步骤:
    1. 在视频区域静止长按超过 200ms（手指不移动）
    2. 观察倍速指示器显示 2x
    3. 松开手指（无论按住多久）
    4. 额外验证：长按过程中如有水平移动则不触发倍速，而是触发拖拽 seek（横屏）或无操作（竖屏）
  预期: 倍速恢复 1x，不弹出右键菜单，不触发原生 contextmenu

T-VID-19: 两指触碰弹出右键菜单（移动端）
  PRD 需求: §5.6 "两指同时触碰：弹出右键菜单"
  步骤:
    1. 在大图模式（图片或视频）两指同时触碰屏幕
    2. 松开手指
  预期: 弹出右键菜单（封面设置、移动、AI 功能、删除等），不触发倍速/滑动切换

T-VID-20: 快速轻扫切换（移动端）
  PRD 需求: §5.6 "velocity > 0.3 px/ms 且 |dx| > 20px 触发切换"
  前置: 图集中包含多个媒体
  步骤:
    1. 在大图模式快速向左轻扫（短距离但速度快）
    2. 观察是否触发切换到下一张
    3. 快速向右轻扫
    4. 观察是否切换到上一张
  预期: 快速轻扫即使距离<60px 也能触发切换

T-VID-21: 慢拖 >60px 切换（移动端）
  PRD 需求: §5.6 "|dx| > 60px 触发切换"
  步骤:
    1. 在大图模式慢速向左拖拽超过 60px
    2. 松开 → 验证切换到下一张
  预期: 慢速拖拽达到距离阈值也能触发切换

T-VID-22: PC 端手势不受影响
  PRD 需求: §5.6 Touch Arbiter 仅用于移动端
  步骤:
    1. PC 端进入视频大图模式
    2. 拖拽进度条 → 正常 seek
    3. 鼠标右键 → 正常弹出菜单
    4. 键盘 ←/→ → 正常快退/快进
  预期: PC 端所有操作不受 Touch Arbiter 影响

T-VID-23: 横屏拖拽视频区域 seek（移动端）
  PRD 需求: §5.6 "横屏时左右拖拽视频区域 = 拖拽 seek"
  前置: 移动端，进入视频大图模式
  步骤:
    1. 点击横屏按钮进入横屏全屏模式
    2. 等待控件自动隐藏
    3. 在视频区域水平向右拖拽（>5px 即触发）
    4. 验证进度条立即唤起显示
    5. 验证视频在拖拽期间暂停（不反复播放/缓冲）
    6. 观察 currentTime 是否随拖拽距离前进；向左拖拽 → 验证后退
    7. 松开手指 → 验证视频恢复播放 + 进度条立即收起
  预期: 拖拽映射范围 min(duration, 600s)，拖拽中暂停+显示进度条，松开恢复+隐藏

T-VID-24: 横屏模式进入与退出
  PRD 需求: §5.6 "横屏切换按钮，先全屏再 orientation.lock"
  前置: 移动端
  步骤:
    1. 进入视频大图模式
    2. 点击横屏按钮（Maximize 图标，即全屏）
    3. 验证进入全屏 + 屏幕旋转为横屏
    4. 验证 TopBar 和缩略图条隐藏，视频居中填满
    5. 按 Esc 或再次点击按钮（Minimize 图标）
    6. 验证退出全屏 + 屏幕恢复竖屏
    7. 验证移动端不存在独立的全屏按钮（横屏 = 全屏）
  预期: 横屏模式正确进入退出，视频居中显示

T-VID-25: 移动端溢出菜单（···）
  PRD 需求: §5.6 "移动端控件栏精简"
  前置: 移动端，进入视频大图模式
  步骤:
    1. 验证控件栏显示 ··· 按钮（MoreHorizontal 图标）
    2. 点击 ··· 按钮 → 验证弹出菜单包含：倍速选择（横排按钮）、上一帧、下一帧、截图
    3. 选择倍速 2x → 验证菜单关闭，playbackRate 变为 2
    4. 再次点击 ··· → 点击"截图" → 验证截图成功（toast 提示）
    5. 再次点击 ··· → 点击"下一帧" → 验证视频前进约 1/30s
    6. 点击菜单外部区域 → 验证菜单关闭
  预期: 溢出菜单功能完整，操作后自动关闭

T-VID-26: 视频右键菜单静音切换
  PRD 需求: §5.6 "右键菜单静音切换"
  步骤:
    1. 进入视频大图模式（默认静音）
    2. 右键（PC）或双指触碰（移动端）→ 验证菜单包含"取消静音"
    3. 点击"取消静音" → 验证视频取消静音，音量按钮图标变为 Volume2
    4. 再次右键 → 验证菜单变为"静音"
    5. 点击"静音" → 验证视频静音
    6. 在图片大图模式右键 → 验证不显示静音/取消静音选项
  预期: 仅视频模式显示静音切换，状态与控件栏音量按钮同步

T-VID-27: 视频播放进度自动保存
  PRD 需求: §5.6 "播放进度记忆（跨设备）"
  步骤:
    1. 播放视频至约 30 秒位置
    2. 暂停视频
    3. 调用 GET /api/media/{id} → 验证 playback_position 约等于 30
    4. 关闭大图模式
  预期: 暂停时自动保存进度到数据库

T-VID-28: 视频播放进度恢复
  PRD 需求: §5.6 "自动恢复：打开视频后自动跳转到上次位置"
  步骤:
    1. 确保视频有 playback_position（如 30s）
    2. 重新打开该视频
    3. 验证视频跳转到约 30 秒位置
    4. 验证顶部出现"从 0:30 继续播放"提示
    5. 等待 3 秒 → 验证提示消失
  预期: 自动恢复上次播放位置并显示提示

T-VID-29: 播完清除进度
  PRD 需求: §5.6 "播完清除：播放至距结尾 3 秒内时自动清除进度"
  步骤:
    1. 播放视频至距结尾 < 3 秒
    2. 等待自动保存触发
    3. 调用 GET /api/media/{id} → 验证 playback_position 为 null
    4. 重新打开视频 → 验证从头播放（无恢复提示）
  预期: 播完后下次从头播放

T-VID-30: 播放进度 API
  PRD 需求: §5.6 "播放进度记忆"
  步骤:
    1. PATCH /api/media/{id}/progress?position=45.5 → 验证 204
    2. GET /api/media/{id} → 验证 playback_position = 45.5
    3. PATCH /api/media/{id}/progress?position=0 → 验证 204
    4. GET /api/media/{id} → 验证 playback_position = null
  预期: 进度保存和清除正确
```

### 3.7 蒙版编辑器 [PRD §5.7]

```
T-MASK-01: 蒙版编辑器打开
  PRD 需求: §5.7 "从图片右键菜单触发"
  步骤:
    1. 图片卡片右键 → 悬浮"AI 功能" → "局部修复"
    2. 验证全屏蒙版编辑器打开
    3. 验证底图加载显示
    4. 验证顶部工具栏存在（返回、撤销、重做、清除、画笔大小、橡皮擦）
    5. 验证底部提交栏存在（模式选择、提示词、提交按钮）
  预期: 蒙版编辑器完整渲染

T-MASK-02: 画笔绘制蒙版
  PRD 需求: §5.7 "左键拖拽：绘制蒙版（绿色半透明覆盖）"
  步骤:
    1. 在画布区域按住左键拖拽
    2. 验证出现绿色半透明覆盖
  预期: 画笔绘制可见
  Puppeteer:
    const canvas = await page.$('canvas')
    const box = await canvas.boundingBox()
    await page.mouse.move(box.x + 100, box.y + 100)
    await page.mouse.down()
    await page.mouse.move(box.x + 300, box.y + 300, { steps: 20 })
    await page.mouse.up()

T-MASK-03: 橡皮擦擦除
  PRD 需求: §5.7 "橡皮擦模式下左键拖拽：擦除蒙版"
  步骤:
    1. 先画一些蒙版
    2. 按 E 切换到橡皮擦
    3. 在蒙版区域拖拽
    4. 验证蒙版被擦除
  预期: 橡皮擦功能正常

T-MASK-04: 撤销/重做
  PRD 需求: §5.7 "[撤销] [重做]"
  步骤:
    1. 绘制蒙版
    2. Ctrl+Z 撤销 → 验证蒙版消失
    3. Ctrl+Y 重做 → 验证蒙版恢复
  预期: 撤销/重做正确
  Puppeteer:
    await page.keyboard.down('Control')
    await page.keyboard.press('z')
    await page.keyboard.up('Control')

T-MASK-05: 画笔大小调节
  PRD 需求: §5.7 "画笔大小━━●━━"
  步骤:
    1. 按 [ 键 → 画笔缩小
    2. 按 ] 键 → 画笔增大
    3. 验证画笔光标大小变化
  预期: 快捷键调节画笔大小

T-MASK-06: 画布缩放
  PRD 需求: §5.7 "滚轮缩放画布（以指针为中心）"
  步骤:
    1. 在画布上滚轮向上
    2. 验证画布放大
    3. 滚轮向下
    4. 验证画布缩小
  预期: 缩放以指针为中心

T-MASK-07: 三种修复模式切换
  PRD 需求: §5.7 / §7.3 / §7.4 三种模式
  步骤:
    1. 验证默认模式为 "Flux (提示词)"
    2. 验证提示词输入框可见
    3. 验证"启用后位LoRA"复选框可见且默认未勾选
    4. 切换到 "SDXL (通用A)"
    5. 验证提示词输入框隐藏（SDXL 不需要提示词）
    6. 验证"启用后位LoRA"复选框隐藏（仅 Flux 可用）
    7. 切换到 "Klein (通用B)"
    8. 验证强度滑块隐藏（Klein 无强度参数）
    9. 切回 "Flux (提示词)"
    10. 验证"启用后位LoRA"复选框重新可见
  预期: 模式切换正确显示/隐藏参数，后位LoRA仅在Flux模式可见

T-MASK-08: 提交任务
  PRD 需求: §5.7 "[立即执行] [加入队列]"
  前置: 已绘制蒙版
  步骤:
    1. 选择 Flux 模式
    2. 输入提示词
    3. 点击"加入队列"
    4. 验证 toast 提示任务已创建
    5. 验证蒙版编辑器关闭
  预期: 任务创建成功

T-MASK-MOBILE-01: 移动端触摸绘制连续性
  PRD 需求: §9.6 "canvas touch-action: none 防止浏览器拦截触摸手势"
  步骤:
    1. 在触屏设备打开蒙版编辑器
    2. 单指在画布上连续滑动绘制
    3. 验证蒙版线条连续无中断（不被浏览器滚动/缩放手势打断）
    4. 手指移出画布边界后移回，验证绘制仍然连续
  预期: 触摸绘制流畅连续，pointer capture 确保跨边界绘制

T-MASK-MOBILE-02: 移动端双指缩放平移
  PRD 需求: §9.6 "单指绘制 + 双指缩放平移"
  步骤:
    1. 在触屏设备打开蒙版编辑器
    2. 双指捏合缩小画布
    3. 验证画布缩小，以双指中心点为缩放中心
    4. 双指张开放大画布
    5. 验证画布放大
    6. 双指平移画布
    7. 验证画布跟随平移
    8. 松开一指后验证不会误触发绘制
  预期: 双指缩放平移正常工作，不与单指绘制冲突

T-MASK-MOBILE-03: 触摸绘制延迟与捏合回退
  PRD 需求: §9.6 "触摸绘制 80ms 延迟检测多指触控，捏合时回退部分笔画"
  步骤:
    1. 在触屏设备打开蒙版编辑器
    2. 单指触摸并快速变为双指捏合（80ms 内）
    3. 验证未产生绘制痕迹（延迟阻止了绘制）
    4. 单指开始绘制，超过 80ms 后变为双指捏合
    5. 验证已绘制的部分笔画被自动回退（画布恢复到笔画前状态）
    6. 所有手指抬起后，再次单指绘制
    7. 验证绘制正常工作
  预期: 触摸延迟防止误绘，捏合检测到后回退部分笔画，所有手指抬起后恢复正常绘制
```

### 3.8 任务队列页 [PRD §5.8]

```
T-TASK-01: 任务队列页基本布局
  PRD 需求: §5.8 "顶部：队列启动模式配置；主体：任务列表"
  步骤:
    1. 导航到 /tasks
    2. 验证顶部存在模式选择区域
    3. 验证任务列表区域存在
  预期: 页面布局正确

T-TASK-02: 队列模式切换
  PRD 需求: §5.8 "4 种启动模式"
  步骤:
    1. 验证默认模式为"手动"
    2. 切换到"自动" → 验证选中状态
    3. 切换到"延时" → 验证延时输入框出现
  预期: 模式切换正确渲染

T-TASK-03: 任务卡片状态显示
  PRD 需求: §5.8 "状态：待执行 / 执行中 / 已完成 / 失败"
  前置: 数据库中有 pending、completed、failed 各 1 个任务
  步骤:
    1. 验证任务按状态分组显示
    2. pending 任务显示黄色标签
    3. completed 任务显示绿色标签
    4. failed 任务显示红色标签 + 错误信息
  预期: 状态标识正确
  Puppeteer:
    await page.goto(`${BASE}/tasks`)
    await waitForSelector('[data-testid="task-card"]')
    const statuses = await page.$$eval('[data-testid="task-status"]', els => els.map(e => e.textContent))
    expect(statuses).toContain('待执行')

T-TASK-04: 失败任务重试
  PRD 需求: §5.8 "重新启动（适用于 failed/cancelled/completed 任务，创建新任务）"
  步骤:
    1. 找到 failed 任务卡片
    2. 点击"重试"按钮
    3. 验证创建了新的 pending 任务（新 ID），原失败任务保留不变
  预期: 重试创建新任务，保留历史记录

T-TASK-04b: 已完成任务重新执行
  PRD 需求: §5.8 "completed：重新执行"
  步骤:
    1. 找到 completed 任务卡片
    2. 右键打开上下文菜单
    3. 验证菜单中包含"重新执行"选项（非直接按钮）
    4. 点击"重新执行"
    5. 验证创建了新的 pending 任务（新 ID），原已完成任务保留不变
  预期: 已完成任务可通过右键菜单重新执行，创建新任务而非重置原任务

T-TASK-05: 删除任务
  PRD 需求: §5.8 "删除任务"
  步骤:
    1. 找到 pending 任务
    2. 点击删除按钮
    3. 验证任务从列表消失
  预期: 删除成功

T-TASK-06: 手动触发执行
  PRD 需求: §5.8 "手动启动：点击 开始执行 按钮触发"
  前置: 有 pending 任务，ComfyUI 已连接
  步骤:
    1. 点击"开始执行"按钮
    2. 验证按钮响应（不报错）
  预期: 手动触发成功

T-TASK-07: 进入页面清零完成角标
  PRD 需求: §5.8 "完成数量（绿色），进入任务队列页后清零"
  前置: 侧边栏角标显示完成数 2
  步骤:
    1. 点击"任务队列"导航
    2. 验证完成角标消失（清零）
  预期: 进入页面后角标清零

T-TASK-08: 队列暂停/恢复
  PRD 需求: （额外实现，QueueConfig.is_paused）
  步骤:
    1. 点击暂停按钮
    2. 验证显示"已暂停"状态
    3. 点击恢复
    4. 验证恢复正常
  预期: 暂停/恢复切换正常

T-TASK-09: 任务信息展示
  PRD 需求: §5.8 "工作流类型、关键参数摘要、执行时间"
  步骤:
    1. 检查任务卡片显示工作流类型中文名（如"高清放大"、"换脸"）
    2. 检查显示创建时间
  预期: 信息展示完整
```

### 3.9 工作区 [PRD §5.9]

```
T-WS-01: 工作区页面布局
  PRD 需求: §5.9 "缩略图网格，支持移除单张、一键清空"
  步骤:
    1. 导航到 /workspace
    2. 验证页面显示网格布局
    3. 验证显示条目计数（如 "0/100"）
  预期: 页面正确渲染

T-WS-02: 通过右键菜单添加
  PRD 需求: §5.9 "任意图片卡片右键菜单 加入工作区"
  步骤:
    1. 在图集页右键图片 → "加入工作区"
    2. 验证 toast "已加入工作区"
    3. 导航到 /workspace
    4. 验证图片出现在工作区
  预期: 添加成功

T-WS-03: 移除单张
  PRD 需求: §5.9 "移除单张"
  步骤:
    1. 在工作区页面悬浮图片
    2. 点击移除按钮（×）
    3. 验证图片从工作区消失
  预期: 移除成功

T-WS-04: 一键清空
  PRD 需求: §5.9 "一键清空"
  步骤:
    1. 工作区有 5 张图
    2. 点击"清空"按钮
    3. 验证所有图片消失
    4. 验证计数变为 "0/100"
  预期: 清空成功

T-WS-05: 100 张上限
  PRD 需求: §5.9 "上限 100 张，超出时提示用户清理"
  前置: 工作区已有 100 张
  步骤:
    1. 尝试添加第 101 张
    2. 验证 toast 提示"工作区已满"
    3. 验证未添加成功
  预期: 上限限制生效

T-WS-06: 持久化验证
  PRD 需求: §5.9 "持久化存储于 SQLite，刷新/关闭不会丢失"
  步骤:
    1. 添加 3 张图到工作区
    2. 刷新页面（F5）
    3. 导航到 /workspace
    4. 验证 3 张图仍在
  预期: 数据持久化正确
  Puppeteer:
    await page.reload()
    await page.goto(`${BASE}/workspace`)
    const count = await countElements('[data-testid="workspace-item"]')
    expect(count).toBe(3)
```

### 3.10 回收站 [PRD §5.10]

```
T-BIN-01: 回收站列表
  PRD 需求: §5.10 "只读浏览，显示原所属人物/图集信息、删除时间"
  前置: 软删除 2 张图片
  步骤:
    1. 导航到 /recycle-bin
    2. 验证显示 2 条记录
    3. 验证每条显示删除时间
  预期: 回收站列表正确

T-BIN-02: 恢复操作
  PRD 需求: §5.10 "恢复到原位置"
  步骤:
    1. 右键回收站条目 → "恢复"
    2. 验证条目从回收站消失
    3. 验证原图集中图片恢复
  预期: 恢复成功

T-BIN-03: 永久删除
  PRD 需求: §5.10 "永久删除：生成图同时删除物理文件，本地图只删除记录"
  步骤:
    1. 右键回收站条目 → "永久删除"
    2. 确认弹窗
    3. 验证条目消失
  预期: 永久删除成功

T-BIN-04: 清空回收站
  PRD 需求: §5.10 "清空回收站（顶部按钮）"
  步骤:
    1. 点击"清空回收站"按钮
    2. 确认弹窗
    3. 验证所有条目清除
  预期: 清空成功

T-BIN-05: 回收站内无操作限制
  PRD 需求: §5.10 "无法在回收站内进行的操作：评分、移动、AI 功能等"
  步骤:
    1. 验证回收站条目无右键菜单中的评分/移动/AI 选项
  预期: 操作正确限制
```

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

### 3.12 导入流程 [PRD §6]

```
T-IMP-01: 文件选择导入
  PRD 需求: §6.1 "文件选择：唤起系统文件选择器"
  步骤:
    1. 点击"导入" → 打开导入弹窗
    2. 点击"选择文件"
    3. （模拟）选择 3 张图片
    4. 选择关联人物
    5. 点击导入
    6. 验证进度显示
    7. 验证导入完成
  预期: 文件导入成功

T-IMP-02: 文件夹导入（无子文件夹）
  PRD 需求: §6.2 "将该文件夹视为一个图集导入"
  步骤:
    1. 选择无子文件夹的文件夹
    2. 验证默认图集名为文件夹名
    3. 可修改图集名
    4. 导入
  预期: 以图集形式导入

T-IMP-02a: 文件夹名智能拆分（无子文件夹）
  PRD 需求: §6.2 "文件夹名称智能拆分"
  步骤:
    1. 选择名为 "Alice_Wedding" 的无子文件夹的文件夹
    2. 验证默认人物名为 "Alice"
    3. 验证默认图集名为 "Wedding"
    4. 选择名为 "Bob-旅行照片" 的文件夹
    5. 验证默认人物名为 "Bob"，图集名为 "旅行照片"
    6. 选择名为 "NoSeparator" 的文件夹
    7. 验证人物名和图集名均为 "NoSeparator"
  预期: 按第一个分隔符（_、-、空格）拆分为人物名和图集名

T-IMP-03: 文件夹导入（有子文件夹）
  PRD 需求: §6.2 "展开导入确认弹窗，列出所有子文件夹"
  步骤:
    1. 选择含 3 个子文件夹的目录
    2. 验证弹窗列出 3 行
    3. 每行显示文件夹路径 → 图集名（可编辑）→ 所属人物
    4. 修改某行图集名
    5. 批量设置人物
    6. 提交导入
  预期: 子文件夹展平显示，可逐行配置

T-IMP-03a: 文件夹名智能拆分（有子文件夹）
  PRD 需求: §6.2 "文件夹名称智能拆分"
  步骤:
    1. 选择含子文件夹的目录，其中子文件夹名为 "Alice_生活照"、"Alice_写真集"、"Bob 旅行"
    2. 验证第 1 行：默认人物名 "Alice"，图集名 "生活照"
    3. 验证第 2 行：默认人物名 "Alice"，图集名 "写真集"
    4. 验证第 3 行：默认人物名 "Bob"，图集名 "旅行"
    5. 修改某行后提交导入
  预期: 每行按第一个分隔符自动拆分默认值，用户可编辑覆盖

T-IMP-03b: 人物自动匹配已有人物
  PRD 需求: §6.2 "人物自动匹配与去重"
  步骤:
    1. 预先创建人物 "Alice"
    2. 选择含子文件夹 "Alice_新图集" 的目录
    3. 验证该行人物模式自动切换为"已有"，且选中人物 "Alice"
    4. 选择名为 "alice_test" 的无子文件夹（注意小写）
    5. 验证人物模式自动切换为"已有"，选中人物 "Alice"（不区分大小写匹配）
  预期: 拆分出的人物名与已有人物匹配时，自动选中已有人物

T-IMP-03b2: 新建人物重名提示与自动关联
  PRD 需求: §6.2 "人物自动匹配与去重"
  步骤:
    1. 预先创建人物 "Alice"
    2. 打开导入弹窗，选择统一模式，人物选"新建人物"
    3. 输入 "alice"（小写），验证输入框下方出现 amber 色提示"同名人物已存在，将自动关联"
    4. 提交导入
    5. 验证未创建新人物，媒体关联到已有的 "Alice"
    6. 同样验证逐文件夹模式、逐文件模式下的新建人物输入框均显示重名提示
  预期: 所有新建人物输入框实时检测重名并提示，导入时自动关联已有人物

T-IMP-03c: 同名人物跨子文件夹去重
  PRD 需求: §6.2 "人物自动匹配与去重"
  步骤:
    1. 数据库中无人物 "Charlie"
    2. 选择含子文件夹 "Charlie_照片A"、"Charlie_照片B"、"Charlie_照片C" 的目录
    3. 验证三行均显示新建人物 "Charlie"
    4. 提交导入
    5. 验证数据库中只创建了 1 个人物 "Charlie"（而非 3 个）
    6. 验证三个图集均关联到同一个人物 ID
  预期: 相同人物名只创建一次，后续子文件夹复用同一人物

T-IMP-04: 去重
  PRD 需求: §6.5 "以文件绝对路径作为唯一标识去重"
  步骤:
    1. 导入文件 A.jpg
    2. 再次导入同一个 A.jpg
    3. 验证不重复导入（数据库中只有 1 条记录）
  预期: 重复文件被跳过

T-IMP-05: 导入取消
  PRD 需求: §6.3 "可取消：导入过程中可随时取消"
  步骤:
    1. 开始导入 100 张图片
    2. 进度约 50% 时点击取消
    3. 验证停止导入
    4. 验证已导入的 ~50 张保留
  预期: 取消后已导入内容保留

T-IMP-05a: 导入中对话框不可意外关闭
  PRD 需求: §6.3 "导入中保护：点击外部或 Escape 不关闭对话框"
  步骤:
    1. 开始导入图片
    2. 导入进行中点击对话框外部区域
    3. 验证对话框未关闭，导入继续
    4. 按 Escape 键
    5. 验证对话框未关闭，导入继续
  预期: 导入进行中对话框不可被意外关闭

T-IMP-06: 导入进度显示
  PRD 需求: §6.3 "显示进度条和计数"
  步骤:
    1. 开始导入 20 张图
    2. 验证进度条可见
    3. 验证计数文本（如 "10 / 20"）
  预期: 进度信息实时更新

T-IMP-07: 人物上下文默认值
  PRD 需求: §6.4 "在人物主页触发导入：默认关联当前人物"
  步骤:
    1. 在人物 A 主页点击导入
    2. 验证导入弹窗人物下拉框默认选中人物 A
    3. 回到主页点击导入
    4. 验证人物下拉框为空（未选中）
  预期: 上下文默认值正确

T-IMP-08: 视频文件导入（桌面端 pick_files）
  PRD 需求: §6.1 "文件选择器默认显示媒体文件过滤器，包含图片和视频格式"
  步骤:
    1. 在桌面端点击"选择文件"按钮
    2. 验证文件选择器标题为"选择媒体文件"
    3. 验证默认过滤器为"媒体文件"，包含 jpg/png/mp4/mov 等格式
    4. 选择一个 .mp4 文件导入
    5. 验证视频正确创建为 media_type="video" 的 Media 记录
  预期: 文件选择器支持视频格式，视频可正常导入

T-IMP-09: 移动端文件上传导入
  PRD 需求: §6.1 "移动端使用 HTML file input 替代 tkinter 文件选择器"
  步骤:
    1. 在触屏设备（或模拟 pointer:coarse）打开导入弹窗
    2. 验证显示"选择图片或视频"上传按钮，不显示 tkinter 文件夹/文件按钮
    3. 选择 3 张图片
    4. 验证显示文件数量和总大小预览
    5. 选择关联人物和图集
    6. 点击"开始导入"
    7. 验证文件上传到服务器并创建 Media 记录
  预期: 移动端可通过 HTML file input 上传文件到服务器完成导入
```

### 3.13 AI 功能 - 高清放大 [PRD §7.2]

```
T-AI-UP-01: 高清放大 - WorkflowRunDialog
  PRD 需求: §7.2
  步骤:
    1. 图片右键 → 悬浮"AI 功能" → "高清放大"
    2. 验证 WorkflowRunDialog 弹出，标题显示 upscale 类别名
    3. 验证自动选中默认工作流
    4. 验证 source_image 已自动填入（只读）
    5. 验证存在"加入队列"和"立即执行"按钮
    6. 验证参数表单根据工作流 manifest 动态渲染
  预期: 工作流选择弹窗完整

T-AI-UP-02: 加入队列
  PRD 需求: §7.1 "加入队列"
  步骤:
    1. 配置参数，点击"加入队列"
    2. 验证 toast 提示任务已创建
    3. 导航到 /tasks
    4. 验证新增一条 workflow_type=custom:{id} 的 pending 任务
  预期: 任务创建成功

T-AI-UP-02b: 工作流自动反推提示词
  PRD 需求: §7.2 "自动反推提示词"
  前置: ComfyUI 已连接，Qwen3-VL 模型已加载
  步骤:
    1. 对任意图片发起高清放大（立即执行）
    2. 等待任务完成
    3. 验证 ComfyUI 工作流中 llama_cpp_instruct_adv 节点正确执行
    4. 验证放大结果图生成成功
  预期: 反推节点自动生成提示词，放大质量正常

T-AI-UP-03: 立即执行按钮状态
  PRD 需求: §2.3 "ComfyUI 未连接时立即执行按钮禁用"
  前置: ComfyUI 未连接
  步骤:
    1. 打开 WorkflowRunDialog（upscale）
    2. 验证"立即执行"按钮 disabled
    3. "加入队列"按钮仍可用
  预期: 按钮状态正确
```

### 3.14 AI 功能 - 换脸 [PRD §7.5]

```
T-AI-FS-01: 单张换脸 - WorkflowRunDialog
  PRD 需求: §7.4
  步骤:
    1. 图片右键 → 悬浮"AI 功能" → "换脸"
    2. 验证 WorkflowRunDialog 弹出，category 为 face_swap
    3. 验证 base_image 已自动填入（只读）
    4. 验证 face_ref 参数显示"选择图片"按钮
    5. 验证「交换底图和人脸参考」按钮存在（至少一个图片参数有值时显示）
    6. 验证「结果归属」下拉默认选中"人脸参考所属人物"
  预期: 弹窗完整，含交换按钮和归属选项

T-AI-FS-02: 人脸参考图选择 - 工作区
  PRD 需求: §7.4 "从工作区选取"
  前置: 工作区有 3 张图
  步骤:
    1. 点击 face_ref 的"选择图片"按钮
    2. 验证 FaceRefPicker 弹窗有"工作区"tab
    3. 点击工作区 tab
    4. 验证显示 3 张工作区图片
    5. 点击选择一张
    6. 验证 face_ref 参数预览更新
  预期: 从工作区选取成功

T-AI-FS-03: 人脸参考图选择 - 浏览
  PRD 需求: §7.4 "按人物 → 图集 → 图片层级浏览选取"
  步骤:
    1. 点击 face_ref 的"选择图片"按钮
    2. 选择"浏览"tab
    3. 验证人物列表
    4. 点击人物 → 验证图集列表
    5. 点击图集 → 验证图片列表
    6. 点击图片选择
  预期: 三级浏览选取成功

T-AI-FS-04: 工作流切换
  PRD 需求: §7.1 "工作流选择器"
  前置: face_swap 类别下有多个工作流
  步骤:
    1. 打开 WorkflowRunDialog（face_swap）
    2. 切换工作流选择器
    3. 验证参数表单根据新工作流的 manifest 更新
  预期: 工作流切换后参数表单正确更新

T-AI-FS-05: 底图与人脸参考交换按钮
  PRD 需求: §7.4 "交换底图与人脸参考"
  步骤:
    1. 打开 WorkflowRunDialog（face_swap）
    2. 设置 base_image 和 face_ref
    3. 点击两个图片参数之间的交换按钮（ArrowUpDown 图标）
    4. 验证 base_image 和 face_ref 的值互换
  预期: 一键交换底图与人脸参考

T-AI-FS-06: 结果归属选项
  PRD 需求: §7.4 "结果归属"
  步骤:
    1. 打开 WorkflowRunDialog（face_swap）
    2. 验证显示「结果归属」下拉选项
    3. 验证默认选中人脸参考图所属人物
    4. 切换为底图所属人物
    5. 提交任务
    6. 验证任务 params 中包含 result_owner 字段
  预期: 可切换结果归属，默认为人脸参考图

T-AI-FS-07: 工作区 AI 换脸入口
  PRD 需求: §7.4 + 工作区右键菜单
  前置: 工作区有图片
  步骤:
    1. 导航到 /workspace
    2. 右键图片 → 悬浮"AI 功能" → "换脸"
    3. 验证 WorkflowRunDialog 弹出，category 为 face_swap
    4. 验证 sourceMedia 已正确填入
  预期: 工作区右键 AI 功能可正常弹出 WorkflowRunDialog

### 换脸结果归属

#### 换脸结果 person_id/album_id 一致性
- 对人物 A 的图集中的图片执行换脸（face_ref 为人物 B）
- 验证：结果 person_id = B，album_id = null（未分类），不是 A 的图集
- 验证：结果出现在人物 B 的未分类区

#### 批量换脸自动创建图集
- 对人物 A 的图集批量换脸（face_ref 为人物 B）
- 验证：自动为人物 B 创建生成图集「换脸 - {源图集名}」
- 验证：所有结果的 result_album_id 指向新图集

#### 批量换脸归属正确性
- 在人物 A 的图集上批量换脸（face_ref 为人物 B）
- 验证：自动创建的生成图集归属人物 B（不是 A）
- 验证：所有结果的 person_id = B
- 验证：链式任务的所有步骤都包含 target_person_id 和 result_album_id

#### 生成图集显示
- 打开一个 is_generated_album=true 的图集
- 验证：即使 sourceType 默认设为 local，图集内容仍然正常显示
- 验证：大图模式下可以正常切换图片

#### 批量脱离生成链
- 多选若干 AI 生成图 → 点击「脱离生成链」
- 验证：图片变为 source_type=local
- 验证：parent_media_id 已清空
- 验证：生成链指示器不再显示这些图片的链式关系

#### 数据修复端点
- 调用 POST /api/media/fix-ownership
- 验证：person_mismatch 的记录 album_id 被清空
- 验证：修复后图片在对应人物未分类区可见

T-AI-BATCH-01: 批量 AI（通用）- 图集入口
  PRD 需求: §7.5 "批量 AI（通用）"
  步骤:
    1. 图集页空白右键 → 悬浮"AI 批量" → 选择可批量类别（如"批量换脸"）
    2. 验证 BatchAiDialog 弹窗显示提示文案（仅处理本地图/截图）
    3. 选择具体工作流，配置共享参数（如人脸参考图）
    4. 点击提交
    5. 验证 toast 显示创建的任务数量
    6. 验证任务队列中任务的 workflow_type 和 params 正确，无 result_album_id
  预期: 批量 AI 任务创建成功，结果加入原图生成链，不创建结果图集

T-AI-BATCH-02: 批量 AI - 多选入口
  PRD 需求: §5.4 / §7.5 "多选工具栏 → AI 功能"
  步骤:
    1. 开启多选模式，选择多张图片
    2. 点击多选工具栏 AI 功能按钮 → 选择可批量类别
    3. 验证 BatchAiDialog 弹窗显示选中的图片数量
    4. 配置参数并提交
  预期: 以选中的 media_ids 提交批量任务

T-AI-BATCH-03: 批量 AI - 不可批量类别不显示
  PRD 需求: §7.5 "不可批量执行：inpaint、text_to_image"
  步骤:
    1. 图集右键菜单 → AI 功能
    2. 验证批量 AI 子菜单不包含"局部重绘"和"文生图"
  预期: 仅显示可批量执行的类别（upscale、face_swap、image_to_image、preprocess）

```

### 3.15 AI 功能 - 局部修复 [PRD §7.3, §7.4]

```
T-AI-IP-01: 局部修复完整流程（WorkflowRunDialog + MaskEditor）
  PRD 需求: §7.3 "触发 → WorkflowRunDialog → 绘制遮罩 → 配置参数 → 提交"
  步骤:
    1. 图片右键 → 悬浮"AI 功能" → "局部修复"
    2. WorkflowRunDialog 弹出，category 为 inpaint
    3. 验证 source_image 已自动填入
    4. 验证 mask 参数显示"绘制遮罩"按钮
    5. 点击"绘制遮罩" → MaskEditor 全屏打开
    6. 绘制蒙版 → 点击"确认遮罩"
    7. 返回 WorkflowRunDialog，验证 mask 已填入（显示遮罩缩略预览）
    8. 配置其他参数（如提示词等，由工作流 manifest 决定）
    9. 点击"加入队列"
    10. 验证 toast 成功
    11. 验证 WorkflowRunDialog 关闭
    12. 导航到 /tasks 验证任务存在
  预期: 完整流程畅通

T-AI-IP-02: 工作流切换 - 不同 inpaint 工作流参数差异
  PRD 需求: §7.3
  前置: inpaint 类别下有多个工作流（如 Flux、SDXL、Klein）
  步骤:
    1. 打开 WorkflowRunDialog（inpaint）
    2. 切换不同工作流
    3. 验证参数表单根据 manifest 动态更新（如有/无提示词、有/无强度参数）
  预期: 参数表单正确反映所选工作流

T-AI-IP-03: MaskEditor 纯遮罩绘制验证
  PRD 需求: §5.7
  步骤:
    1. 从 WorkflowRunDialog 点击"绘制遮罩"
    2. MaskEditor 全屏打开
    3. 验证只有画笔工具栏 + 画布 + 取消/确认按钮（无模式选择/提示词/降噪等）
    4. 绘制蒙版 → 点击"确认遮罩"
    5. 验证返回 WorkflowRunDialog，mask 参数已填入
  预期: MaskEditor 为纯遮罩工具，无任务提交逻辑

T-AI-IP-04: 遮罩重新绘制
  PRD 需求: §7.3
  步骤:
    1. 完成首次遮罩绘制，返回 Dialog
    2. 验证显示遮罩缩略预览 + "重新绘制"按钮
    3. 点击"重新绘制" → MaskEditor 重新打开
    4. 重新绘制 → 确认
    5. 验证 mask 预览更新
  预期: 可重复编辑遮罩

T-AI-IP-05: 额外参数渲染
  PRD 需求: §7.1 "extra_params"
  前置: 所选 inpaint 工作流 manifest 包含 extra_params
  步骤:
    1. 打开 WorkflowRunDialog（inpaint）
    2. 验证额外参数区域显示在契约参数下方（分隔线 + "额外参数"标签）
    3. 修改额外参数值
    4. 提交任务
    5. 验证任务 params 包含修改后的额外参数
  预期: 额外参数正确渲染和提交
```

### 3.16 评分系统 [PRD §8.1]

```
T-RATE-01: 图片评分
  PRD 需求: §8.1 "评分范围 1-5 星，可清除"
  步骤:
    1. 大图模式中点击 4 星
    2. 验证评分显示 4 星
    3. 关闭大图 → 重新打开
    4. 验证评分仍为 4 星（持久化）
  预期: 评分持久化

T-RATE-02: 清除评分
  PRD 需求: §8.1 "可清除（清除后视为未评分）"
  步骤:
    1. 图片有 3 星评分
    2. 按键盘 "0" 清除
    3. 验证评分组件显示未评分
  预期: 评分清除成功

T-RATE-03: 平均分计算规则
  PRD 需求: §8.1 "仅计算已评分媒体的平均值，未评分媒体不参与计算"
  前置: 人物 A 有 5 张图，其中 2 张评分 4 和 5，3 张未评分
  步骤:
    1. 查看人物 A 主页
    2. 验证平均评分显示 4.5（(4+5)/2）而非 1.8（(4+5)/5）
    3. 验证显示 "(2)" 表示已评分数量
  预期: 平均分仅计算已评分

T-RATE-04: 全部未评分显示
  PRD 需求: §8.1 "全部未评分时，UI 显示 未评分"
  前置: 人物 B 所有图片未评分
  步骤:
    1. 查看人物 B 卡片
    2. 验证评分区域显示"未评分"
  预期: 未评分状态正确

T-RATE-05: 批量评分
  PRD 需求: §8.1 "多选批量评分"
  步骤:
    1. 开启多选模式
    2. 选中 3 张图
    3. 在选择工具栏中评分 5 星
    4. 验证 3 张图均变为 5 星
  预期: 批量评分生效
```

### 3.17 筛选系统 [PRD §8.2]

```
T-FILT-01: 评分筛选
  PRD 需求: §8.2 "等于 / 大于等于 / 小于等于 指定星级"
  步骤:
    1. 在图集页设置评分筛选 ≥ 4 星
    2. 验证仅 4、5 星图片显示
    3. 清除筛选 → 所有图片恢复
  预期: 评分筛选正确

T-FILT-02: 筛选条件跨层级生效
  PRD 需求: §8.2 "在所有层级生效（包括大图模式的上下张切换）"
  步骤:
    1. 图集页设置评分筛选 ≥ 3 星
    2. 点击图片进入大图模式
    3. 按 → 切换
    4. 验证切换的图片也满足 ≥ 3 星
  预期: 筛选在大图模式生效

T-FILT-03: source_type 筛选
  PRD 需求: §8.2 "来源类型：本地图 / 生成图"
  步骤:
    1. 图集含本地图 + 生成图
    2. 筛选 source_type=local
    3. 验证只显示本地图
  预期: 来源筛选正确

T-FILT-04: 筛选条件叠加
  PRD 需求: §8.2 "筛选条件可叠加"
  步骤:
    1. 设置评分 ≥ 3 星 + source_type=local
    2. 验证仅显示评分 ≥ 3 的本地图
  预期: 多条件叠加正确
```

### 3.18 排序系统 [PRD §8.3]

```
T-SORT-01: 人物列表排序（降序）
  PRD 需求: §8.3 "人物列表：双向排序"
  前置: 3 个人物，评分分别为 3.0, 5.0, null
  步骤:
    1. 切换到"评分最高"排序
    2. 验证 5.0 排第一，3.0 排第二，null 排最后
  预期: 降序排序正确

T-SORT-01b: 人物列表排序（升序）
  PRD 需求: §8.3 双向排序
  前置: 3 个人物，评分分别为 3.0, 5.0, null
  步骤:
    1. 切换到"评分最低"排序
    2. 验证 null 排第一，3.0 排第二，5.0 排最后
  预期: 升序排序正确，未评分排最前

T-SORT-02: 未评分排末尾（降序）/ 排最前（升序）
  PRD 需求: §8.3 "降序时未评分排末尾，升序时未评分排最前"
  步骤:
    1. 评分降序模式下，验证所有未评分人物在已评分人物之后
    2. 评分升序模式下，验证所有未评分人物在已评分人物之前
    3. 验证未评分人物之间按导入时间降序
  预期: 未评分排位规则在两个方向均正确

T-SORT-03: 图集内图片排序
  PRD 需求: §8.3 "图集内图片：导入时间 / 评分 / 名称"
  步骤:
    1. 在图集页切换排序方式
    2. 验证每种排序结果正确
  预期: 图片排序正确

T-SORT-04: 图集列表排序与评分筛选
  PRD 需求: §8.3 "图集列表：最新创建 / 评分最高 / 名称 A-Z" + §8.2 评分筛选
  步骤:
    1. 进入人物主页·图集区
    2. 验证 FilterBar 显示排序 + 评分筛选
    3. 切换排序为"评分最高"，验证排序生效
    4. 设置评分筛选 ≥ 4 星，验证仅显示高评分图集
  预期: 图集区排序 + 评分筛选正确

T-SORT-05: 未分类来源类型筛选
  PRD 需求: §8.2 "来源类型：全部 / 本地图 / AI生成 / 截图"
  步骤:
    1. 进入人物主页·未分类区（含本地图 + 生成图）
    2. 验证 FilterBar 显示排序 + 评分 + 来源筛选
    3. 选择"本地图"，验证仅显示本地图
    4. 选择"全部"，验证所有图恢复
  预期: 未分类来源筛选正确
```

### 3.18.1 筛选默认值与重置 [PRD §8.2, §8.3]

```
T-FILT-DEF-01: 页面进入时筛选重置为默认值
  PRD 需求: §8.2 "每次进入页面时筛选条件自动重置为设置页配置的默认值"
  步骤:
    1. 在图集详情页设置排序为"评分最高"、评分筛选为"5星"
    2. 返回人物主页
    3. 再次进入图集详情页
    4. 验证排序重置为"默认顺序"、评分筛选重置为"全部"
  预期: 筛选条件在重新进入页面时重置为默认值

T-FILT-DEF-02: 设置页修改筛选默认值
  PRD 需求: §8.2 "在设置页配置各字段默认值"
  步骤:
    1. 进入设置页"筛选默认值"区域
    2. 将评分筛选默认值改为"4星+"
    3. 将图集详情默认排序改为"评分最高"
    4. 切换到图集详情页
    5. 验证评分筛选为"4星+"、排序为"评分最高"
  预期: 设置页修改的默认值在页面进入时生效

T-FILT-DEF-03: 筛选默认值持久化
  PRD 需求: §8.2 localStorage 持久化
  步骤:
    1. 设置页修改评分筛选默认值为"3星+"
    2. 刷新页面
    3. 进入设置页，验证评分筛选默认值仍为"3星+"
    4. 进入任意页面，验证评分筛选初始为"3星+"
  预期: 默认值跨刷新保持

T-FILT-DEF-04: API 层面 sort + sort_dir 参数
  PRD 需求: §8.3 排序默认值 + 双向排序
  步骤:
    1. 以 sort=sort_order&sort_dir=asc 查询图集，验证升序排列
    2. 以 sort=rating&sort_dir=desc 查询图集，验证评分降序排列
    3. 以 sort=created_at&sort_dir=asc 查询图集，验证最早创建排前
  预期: API sort_dir 参数正确控制排序方向

T-FILT-DEF-05: 排序值格式 field:dir 与旧值兼容
  PRD 需求: §8.3 排序值格式
  步骤:
    1. localStorage 写入旧格式值（如 "created_at"，无方向后缀）
    2. 进入页面，验证 getSortDefault 返回带默认方向的值
    3. 验证排序正常生效
  预期: 旧值自动迁移为 field:dir 格式
```

> 实现文件: `filter-defaults.test.ts`（T-FILT-DEF-01 ~ 04，共 4 用例）
> 测试特性: 不调用 resetDB()，使用唯一名称创建数据，afterAll 清理测试数据

### 3.19 封面管理 [PRD §8.4]

```
T-COVER-01: 设为人物封面
  PRD 需求: §8.4 "右键图片 设为人物封面"
  步骤:
    1. 大图模式中右键 → "设为人物封面"
    2. 验证 toast 成功
    3. 返回主页 → 验证人物卡片封面更新
  预期: 封面设置成功

T-COVER-02: 设为图集封面
  PRD 需求: §8.4 "右键图片 设为图集封面"
  步骤:
    1. 同上，选择"设为图集封面"
    2. 验证图集封面更新
  预期: 图集封面设置成功

T-COVER-03: 默认封面
  PRD 需求: §8.4 "默认第一张图"
  前置: 新建图集导入 5 张图
  步骤:
    1. 验证图集卡片封面为第一张导入的图
  预期: 默认封面正确

T-COVER-04: 人物封面在首页卡片可见
  PRD 需求: §8.4 封面展示
  步骤:
    1. 设置人物封面后导航到首页
    2. 验证人物卡片显示封面图片
  预期: 封面图片正确渲染

T-COVER-05: 更换封面后 API 返回新封面
  PRD 需求: §8.4 封面更新
  步骤:
    1. 通过 API 将图集封面改为另一张图
    2. 重新获取图集数据，验证 cover_media_id 更新
  预期: 封面 ID 与最新设置一致
```

> 实现文件: `cover-management.test.ts`（T-COVER-01 ~ 05，共 5 用例）
> 测试特性: 不调用 resetDB()，使用唯一名称创建数据，afterAll 清理测试数据

### 3.20 软删除与回收站 [PRD §8.6]

```
T-DEL-01: 软删除图片（无子图）
  PRD 需求: §8.6 "删除操作均为软删除"
  步骤:
    1. 对无子图的图片右键 → "删除"
    2. 验证弹出 ConfirmDialog（Radix Dialog 样式，非浏览器原生 confirm）
    3. 点击确认按钮
    4. 验证图片从图集消失
    5. 验证回收站中出现
  预期: 无子图时走简单确认对话框

T-DEL-01b: 软删除图片（有子图 - 级联删除）
  PRD 需求: §8.6 "生成链删除模式选择"
  前置: 图片 A 有 2 张子图 B、C
  步骤:
    1. 图片 A 右键 → "删除"
    2. 验证弹出 DeleteChoiceDialog（显示"该图片有 2 张子图"）
    3. 点击"一并删除所有子图"
    4. 验证 A、B、C 均进入回收站
  预期: 级联删除所有子图

T-DEL-01c: 软删除图片（有子图 - 保留子图）
  PRD 需求: §8.6 "保留子图（reparent）"
  前置: 图片 A（parent=P）有子图 B
  步骤:
    1. 图片 A 右键 → "删除"
    2. 验证弹出 DeleteChoiceDialog
    3. 点击"保留子图（子图归属到父节点）"
    4. 验证 A 进入回收站
    5. 验证 B 仍存在且 parent_media_id 变为 P
  预期: 仅删除自身，子图上移到祖父节点

T-DEL-02: 批量软删除
  PRD 需求: §5.4 "多选后支持批量删除"
  步骤:
    1. 多选 3 张无子图的图
    2. 点击删除按钮
    3. 验证弹出 ConfirmDialog
    4. 验证 3 张均移入回收站
  预期: 批量删除正确

T-DEL-02b: 批量软删除（含生成链图片）
  PRD 需求: §8.6 "批量删除时，若选中项包含生成链图片，同样弹出选择对话框"
  步骤:
    1. 多选包含生成链图片的若干图
    2. 点击删除按钮
    3. 验证弹出 DeleteChoiceDialog（而非 ConfirmDialog）
    4. 选择"一并删除所有子图"
    5. 验证选中图及其子图均移入回收站
  预期: 批量删除时正确检测生成链并提供删除模式选择

T-DEL-03: 恢复到原位置
  PRD 需求: §8.6 "回收站支持恢复到原位置"
  步骤:
    1. 删除图集 A 中的图片 X
    2. 在回收站恢复 X
    3. 验证 X 重新出现在图集 A 中
  预期: 恢复位置正确

T-DEL-04: 本地图物理文件不删除
  PRD 需求: §8.6 "本地图：任何情况下只删除记录，物理文件不动"
  步骤:
    1. 导入本地图片（路径 D:\test\photo.jpg）
    2. 软删除 → 永久删除
    3. 验证 D:\test\photo.jpg 文件仍然存在
  预期: 物理文件不受影响
```

### 3.21 随机探索 [PRD §8.8]

```
T-EXP-01: 全局随机探索
  PRD 需求: §8.8 "从触发层级自动继承"
  步骤:
    1. 主页点击"随机探索"
    2. 验证进入大图模式
    3. 验证图片来自所有人物
  预期: 全局范围随机

T-EXP-02: 人物范围随机探索
  PRD 需求: §8.8 "人物主页 = 该人物"
  步骤:
    1. 人物 A 主页点击"随机"
    2. 浏览多张图片
    3. 验证所有图片属于人物 A
  预期: 限定人物范围

T-EXP-03: 重新洗牌
  PRD 需求: §8.8 "手动点击 重新洗牌"
  步骤:
    1. 进入随机探索
    2. 记录前 3 张图片顺序
    3. 点击"重新洗牌"按钮
    4. 验证图片序列变化（高概率变化）
  预期: 重新洗牌生效

T-EXP-04: 沉浸模式下探索
  PRD 需求: §8.8 "可在随机探索中开启沉浸模式"
  步骤:
    1. 随机探索 → 点击沉浸模式
    2. 验证 UI 隐藏
    3. 键盘切换仍有效
    4. Esc 退出沉浸（不退出探索）
  预期: 沉浸模式在探索中正常工作

T-EXP-05: explore API 支持筛选参数
  PRD 需求: §8.8 "从触发层级自动继承筛选条件"
  步骤:
    1. GET /api/media/explore?person_id=X&media_type=image
    2. 验证返回结果全部为图片类型
  预期: 筛选参数在 explore API 中生效
```

> 实现文件: `random-explore.test.ts`（T-EXP-01 ~ 05，共 5 用例）
> 测试特性: 不调用 resetDB()，使用唯一名称创建数据，afterAll 清理测试数据

### 3.22 响应式布局 [PRD §9.6]

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

T-RESP-05: 网格缩放 - Ctrl+滚轮
  PRD 需求: §9.6 "网格缩放" + §5.2 PersonCard 缩放
  前置: 导入 3 个人物
  步骤:
    1. 设置 viewport 1280×800，导航到首页
    2. 在网格区域 Ctrl+滚轮向上（放大）
    3. 验证列数减少（卡片变大）
    4. Ctrl+滚轮向下（缩小）
    5. 验证列数增加（卡片变小）
    6. 刷新页面验证缩放级别持久化
  预期: 缩放在预设值间吸附切换，localStorage 持久化
  文件: responsive-layout.test.ts

T-RESP-06: 图集详情移动端强制 Grid
  PRD 需求: §5.4 "移动端强制使用网格模式，隐藏行/网格切换按钮"
  步骤:
    1. 设置 viewport 375×812
    2. 导航到图集详情页
    3. 验证无行/网格切换按钮
    4. 验证使用网格布局
  预期: 移动端只显示网格模式
  文件: responsive-layout.test.ts

T-RESP-07: PersonCard 紧凑模式（桌面端 vs 移动端阈值）
  PRD 需求: §9.6 "桌面端列数≥10 / 移动端列数≥4 时隐藏渐变叠层和评分徽章"
  步骤:
    1. 设置 viewport 1920×1080（桌面端）
    2. 缩小网格至 ≥10 列
    3. 验证 PersonCard 隐藏渐变叠层和评分徽章
    4. 放大至 <10 列 → 验证渐变叠层和评分徽章重新显示
    5. 设置 viewport 375×812（移动端）
    6. 缩小网格至 ≥4 列
    7. 验证 PersonCard 隐藏渐变叠层和评分徽章
    8. 放大至 <4 列 → 验证重新显示
  预期: 桌面端和移动端分别在不同阈值触发 compact 模式，评分徽章随 compact 同步隐藏
  文件: responsive-layout.test.ts

T-RESP-08: 移动端页面头部图标按钮
  PRD 需求: §9.6 "移动端使用图标按钮（文字通过 hidden sm:inline 隐藏）"
  步骤:
    1. 设置 viewport 375×812
    2. 导航到首页 → 验证头部按钮仅显示图标（无文字标签）
    3. 导航到人物主页 → 验证同上
    4. 导航到图集详情页 → 验证同上
    5. 设置 viewport 1280×800 → 验证按钮文字标签可见
  预期: 移动端头部按钮仅图标，桌面端显示图标+文字
  文件: responsive-layout.test.ts

T-RESP-09: 移动端 FilterBar 紧凑尺寸
  PRD 需求: §9.6 "移动端更小的下拉触发器"
  步骤:
    1. 设置 viewport 375×812
    2. 导航到图集详情页
    3. 验证 FilterBar 下拉控件可见且不溢出屏幕
    4. 设置 viewport 1280×800
    5. 验证 FilterBar 使用默认尺寸
  预期: 移动端 FilterBar 紧凑显示，桌面端正常尺寸
  文件: responsive-layout.test.ts

T-RESP-10: 视频卡片播放图标自适应缩放
  PRD 需求: §9.6 "视频播放图标使用百分比尺寸（卡片宽度的 20%）"
  前置: 导入含视频的媒体
  步骤:
    1. 导航到图集详情页
    2. 验证视频卡片显示播放图标
    3. 缩小网格列数 → 验证播放图标随卡片缩小
    4. 放大网格列数 → 验证播放图标随卡片放大
  预期: 播放图标按卡片宽度 20% 缩放，clamp 在 16px–28px
  文件: responsive-layout.test.ts

T-RESP-11: 全屏切换按钮（桌面端 Sidebar + 移动端 BottomNav）
  PRD 需求: §9.6 "桌面端 Sidebar 底部全屏按钮；移动端 BottomNav 全屏按钮"
  步骤:
    1. 设置 viewport 1280×800（桌面端）
    2. 验证 Sidebar 底部存在全屏按钮
    3. 点击全屏按钮 → 验证进入全屏（或验证 Fullscreen API 被调用）
    4. 设置 viewport 375×812（移动端）
    5. 验证 BottomNav 存在全屏按钮（仅图标，无文字）
  预期: 桌面端和移动端均可触发全屏
  文件: responsive-layout.test.ts

T-RESP-12: 移动端 BottomNav 仅图标显示
  PRD 需求: §5.1 "移动端底部导航仅显示图标（无文字标签）"
  步骤:
    1. 设置 viewport 375×812（移动端）
    2. 验证 BottomNav 可见
    3. 验证 BottomNav 包含小工具入口（Wrench 图标）
    4. 验证所有导航项仅显示图标，无文字标签
    5. 点击小工具图标 → 验证导航到 /tools
  预期: 移动端底部导航仅图标，包含小工具入口
  文件: responsive-layout.test.ts

T-RESP-13: 移动端页面底部内边距
  PRD 需求: §9.6 "底部内边距 pb-28 md:pb-4 为移动端底部导航栏预留空间"
  步骤:
    1. 设置 viewport 375×812（移动端）
    2. 分别导航到 Tools、TaskQueue、Settings 页面
    3. 滚动到页面底部
    4. 验证内容未被 BottomNav 遮挡
  预期: 所有页面底部有足够内边距，内容不被底部导航遮挡
  文件: responsive-layout.test.ts
```

### 3.23 侧边栏 [PRD §5.1]

```
T-SIDE-01: 侧边栏存在所有导航项
  PRD 需求: §5.1 导航栏包含媒体库、任务队列、工作区、回收站、设置
  步骤:
    1. 打开首页
    2. 验证侧边栏包含所有导航项
  预期: 所有导航项存在
  文件: sidebar.test.ts

T-SIDE-02: 当前页面对应导航项高亮
  PRD 需求: §5.1 当前页面对应项高亮
  步骤:
    1. 导航到设置页
    2. 验证设置导航项有 active 样式
  预期: 高亮正确
  文件: sidebar.test.ts

T-SIDE-03: 点击导航项跳转对应页面
  PRD 需求: §5.1 导航跳转
  步骤:
    1. 点击"任务队列"→ 验证 URL 包含 /tasks
    2. 点击"工作区"→ 验证 URL 包含 /workspace
  预期: 导航跳转正确
  文件: sidebar.test.ts

T-SIDE-04: 侧边栏固定展开显示文字
  PRD 需求: §5.1 "固定宽度展开，始终显示图标 + 文字"
  步骤:
    1. 打开首页
    2. 验证侧边栏宽度约 176px
    3. 验证文字标签可见
  预期: 固定展开，图标 + 文字同时显示
  文件: sidebar.test.ts

T-SIDE-05: 侧边栏图标可见
  PRD 需求: §5.1 显示图标
  步骤:
    1. 验证侧边栏中 SVG 图标数量 ≥ 5
  预期: 图标可见
  文件: sidebar.test.ts
```

### 3.24 人物 CRUD [PRD §5.2]

```
T-PCRUD-01: 通过 UI 创建人物
  PRD 需求: §5.2 "新建人物"
  步骤:
    1. 点击新建人物按钮
    2. 输入名称并确认
    3. 验证人物卡片出现
  预期: 人物创建成功
  文件: person-crud.test.ts

T-PCRUD-02: 人物卡片显示名称和统计
  PRD 需求: §5.2 "每张卡片显示人物封面 + 姓名 + 平均评分"
  步骤:
    1. 创建人物并导入图片
    2. 验证卡片显示人物名称
  预期: 名称和统计正确显示
  文件: person-crud.test.ts

T-PCRUD-03: 人物主页重命名
  PRD 需求: §5.2 "重命名"
  步骤:
    1. 进入人物主页
    2. 验证人物名称显示
  预期: 人物名称正确显示
  文件: person-crud.test.ts

T-PCRUD-04: 人物封面设置
  PRD 需求: §8.4 "人物封面"
  步骤:
    1. 通过 API 设置人物封面
    2. 验证人物主页封面更新
  预期: 封面设置成功
  文件: person-crud.test.ts

T-PCRUD-05: 删除人物
  PRD 需求: §5.2 "删除人物"
  步骤:
    1. 创建并删除人物
    2. 验证人物数量减少
  预期: 删除成功
  文件: person-crud.test.ts
```

### 3.25 图集 CRUD [PRD §5.3]

```
T-ACRUD-01: 创建图集
  PRD 需求: §5.3 "新建图集"
  步骤:
    1. 通过 API 创建图集
    2. 验证图集出现在人物主页
  预期: 图集创建成功
  文件: album-crud.test.ts

T-ACRUD-02: 重命名图集
  PRD 需求: §5.3 图集右键菜单 "重命名"
  步骤:
    1. 通过 API 修改图集名称
    2. 验证名称更新
  预期: 重命名成功
  文件: album-crud.test.ts

T-ACRUD-03: 设置图集封面
  PRD 需求: §8.4 "图集封面"
  步骤:
    1. 导入图片到图集
    2. 通过 API 设置封面
    3. 验证封面更新
  预期: 封面设置成功
  文件: album-crud.test.ts

T-ACRUD-04: 图集内有媒体
  PRD 需求: §5.4 图集内显示媒体
  步骤:
    1. 导入多张图片到图集
    2. 验证图集内媒体数量正确
  预期: 媒体正确关联
  文件: album-crud.test.ts

T-ACRUD-05: 删除图集
  PRD 需求: §5.3 "删除图集"
  步骤:
    1. 创建并删除图集
    2. 验证图集数量减少
  预期: 删除成功
  文件: album-crud.test.ts
```

### 3.26 图集详情页（实现） [PRD §5.4]

```
T-ADET-01: 图集详情页加载并显示媒体
  PRD 需求: §5.4 图集详情页
  步骤:
    1. 导航到图集详情页
    2. 验证图集名称显示
  预期: 页面正确加载
  文件: album-detail.test.ts

T-ADET-02: 图集详情显示正确数量的媒体
  PRD 需求: §5.4 媒体列表
  步骤:
    1. 导入 5 张图到图集
    2. 验证 API 返回 5 条媒体
  预期: 数量正确
  文件: album-detail.test.ts

T-ADET-03: 图集筛选栏存在
  PRD 需求: §5.4 "顶部筛选和排序工具栏"
  步骤:
    1. 导航到图集详情
    2. 验证筛选栏 UI 存在
  预期: 筛选栏渲染
  文件: album-detail.test.ts

T-ADET-04: 图集内评分筛选
  PRD 需求: §5.4 / §8.2 评分筛选
  步骤:
    1. 给图片评分
    2. 验证评分筛选后结果正确
  预期: 筛选生效
  文件: album-detail.test.ts

T-ADET-05: 图集排序切换
  PRD 需求: §5.4 "排序方式"
  步骤:
    1. 按评分排序
    2. 验证最高分排在前面
  预期: 排序正确
  文件: album-detail.test.ts

T-ADET-06: 图集封面设置
  PRD 需求: §8.4 "图集封面"
  步骤:
    1. 通过 API 设置图集封面
    2. 验证 cover_media_id 更新
  预期: 封面设置成功
  文件: album-detail.test.ts

T-ADET-07: 图集内点击打开大图
  PRD 需求: §5.5 "触发：点击任意图片卡片"
  步骤:
    1. 点击媒体卡片
    2. 验证 lightbox 打开
  预期: 大图模式正确打开
  文件: album-detail.test.ts

T-ADET-08: 图集返回按钮
  PRD 需求: §5.4 页面导航
  步骤:
    1. 验证返回按钮存在
  预期: 返回按钮可用
  文件: album-detail.test.ts
```

### 3.27 导入流程（实现） [PRD §6]

```
T-IMP-01: 导入文件到人物
  PRD 需求: §6.2 导入流程
  步骤:
    1. 通过 API 导入单张图片
    2. 验证导入成功
  预期: 文件导入成功
  文件: import-flow.test.ts

T-IMP-02: 批量导入多个文件
  PRD 需求: §6.2 多文件导入
  步骤:
    1. 通过 API 导入 4 张图片
    2. 验证总数达到 5
  预期: 批量导入成功
  文件: import-flow.test.ts

T-IMP-03: 导入去重（重复文件不重复导入）
  PRD 需求: §6.5 "以文件绝对路径作为唯一标识去重"
  步骤:
    1. 重复导入同一文件
    2. 验证数量不增加
  预期: 去重生效
  文件: import-flow.test.ts

T-IMP-09: 导入前重复预览（scan 接口）
  PRD 需求: §6.5 "导入前预览"
  步骤:
    1. 先导入若干文件到数据库
    2. 调用 POST /api/media/scan 传入包含已导入文件的路径
    3. 验证返回的 total 和 existing 数值正确
  预期: existing 等于已导入文件数，total 等于目录内全部媒体文件数
  文件: import-flow.test.ts

T-IMP-10: 子文件夹列表排序（全已存在排后）
  PRD 需求: §6.5 "全部已存在的文件夹自动排到列表末尾"
  步骤:
    1. 准备多个子文件夹，部分全已导入，部分含新文件
    2. 打开导入对话框选择父文件夹
    3. 验证含新文件的子文件夹排在全已存在的子文件夹之前
  预期: 有新文件的文件夹优先展示
  文件: import-flow.test.ts

T-IMP-04: 导入到图集
  PRD 需求: §6.2 图集导入
  步骤:
    1. 创建图集
    2. 导入文件到图集
    3. 验证图集内媒体数量
  预期: 导入到图集成功
  文件: import-flow.test.ts

T-IMP-05: 导入不支持的文件类型被忽略
  PRD 需求: §6 文件类型过滤
  步骤:
    1. 尝试导入不存在的 .txt 文件
    2. 验证导入数量为 0
  预期: 不支持类型被忽略
  文件: import-flow.test.ts

T-IMP-06: 导入对话框可在人物主页打开
  PRD 需求: §5.3 "导入图片"
  步骤:
    1. 在人物主页验证导入按钮存在
  预期: 导入入口可用
  文件: import-flow.test.ts

T-IMP-07: 导入后人物主页显示新媒体
  PRD 需求: §5.3 人物主页未分类区
  步骤:
    1. 导入图片后导航到人物主页
    2. 验证未分类区域显示
  预期: 导入结果可见
  文件: import-flow.test.ts

T-IMP-08: 导入到图集后图集详情显示
  PRD 需求: §5.4 图集详情
  步骤:
    1. 导入到图集后导航到图集详情
    2. 验证图集详情页正确加载
  预期: 图集详情显示导入内容
  文件: import-flow.test.ts

T-IMP-11: 子文件夹全部已存在自动取消勾选
  PRD 需求: §6.5 "子文件夹自动取消勾选"
  步骤:
    1. 准备含子文件夹的目录，其中一个子文件夹的所有文件均已导入
    2. 打开导入对话框选择父文件夹
    3. 等待扫描完成
    4. 验证全已存在的子文件夹复选框未勾选
  预期: 全部已存在的子文件夹自动取消勾选，不会创建空图集

T-IMP-12: 导入完成后清理空图集
  PRD 需求: §6.5 "空图集清理"
  步骤:
    1. 导入一批全部已存在的文件（强制勾选）
    2. 验证导入完成后无新建的空图集残留
  预期: 导入流程自动清理未导入任何媒体的新建图集
```

### 3.28 大图浏览基础 [PRD §5.5]

```
T-LB-01: 点击卡片打开大图
  PRD 需求: §5.5 "触发：点击任意图片卡片"
  步骤:
    1. 点击未分类卡片
    2. 验证 lightbox 出现
  预期: 大图模式打开
  文件: lightbox-basic.test.ts

T-LB-02: ESC 关闭大图
  PRD 需求: §9.7 "Esc 退出大图模式"
  步骤:
    1. 按 Escape 键
    2. 验证 lightbox 消失
  预期: 正确退出
  文件: lightbox-basic.test.ts

T-LB-03: 左右箭头切换本地图（水平轴）
  PRD 需求: §5.5 "← / → 本地图导航（水平轴）"
  步骤:
    1. 按右箭头 → 验证切换到下一张本地图
    2. 按左箭头 → 验证回到上一张本地图
  预期: 水平轴键盘导航正确，跳过生成图
  文件: lightbox-basic.test.ts

T-LB-04: 大图显示图片计数器
  PRD 需求: §5.5 图片序号
  步骤:
    1. 打开大图
    2. 验证计数器格式 "N / M"
  预期: 计数器显示正确
  文件: lightbox-basic.test.ts

T-LB-05: 大图顶部工具栏可见
  PRD 需求: §5.5 "顶部操作栏"
  步骤:
    1. 打开大图
    2. 验证存在操作按钮
  预期: 工具栏渲染
  文件: lightbox-basic.test.ts

T-LB-06: 大图缩略图条可见
  PRD 需求: §5.5 "底部图集预览条"
  步骤:
    1. 打开大图
    2. 验证底部缩略图条存在
  预期: 缩略图条渲染
  文件: lightbox-basic.test.ts

T-LB-07: 大图图片正确加载
  PRD 需求: §5.5 主图展示
  步骤:
    1. 打开大图
    2. 验证图片 src 包含 /api/files/serve
  预期: 图片正确加载
  文件: lightbox-basic.test.ts
```

### 3.29 大图操作 [PRD §5.5]

```
T-LBA-01: 键盘数字键快捷评分
  PRD 需求: §9.7 "1-5 快速评分"
  步骤:
    1. 打开大图，按键盘 3
    2. 验证图片评分变为 3
  预期: 键盘评分即时生效
  文件: lightbox-actions.test.ts

T-LBA-02: 键盘 0 键清除评分
  PRD 需求: §8.1 "可清除"
  步骤:
    1. 按键盘 0
    2. 验证评分清除
  预期: 评分清除成功
  文件: lightbox-actions.test.ts

T-LBA-03: 右键菜单打开
  PRD 需求: §9.1 右键菜单
  步骤:
    1. 右键点击 lightbox
    2. 验证上下文菜单出现
  预期: 右键菜单打开
  文件: lightbox-actions.test.ts

T-LBA-04: 右键菜单包含加入工作区
  PRD 需求: §5.4 "加入工作区"
  步骤:
    1. 右键点击图片
    2. 验证菜单包含"加入工作区"
  预期: 菜单项存在
  文件: lightbox-actions.test.ts

T-LBA-05: 右键菜单包含生成链选项
  PRD 需求: §5.5 "右侧生成链面板"
  步骤:
    1. 右键点击图片
    2. 验证菜单包含"生成链"
  预期: 生成链菜单项存在
  文件: lightbox-actions.test.ts

T-LBA-06: 大图删除按钮存在
  PRD 需求: §5.5 顶部操作栏 "删除"
  步骤:
    1. 打开大图
    2. 验证删除按钮存在
  预期: 删除按钮可见
  文件: lightbox-actions.test.ts
```

### 3.30 大图生成链功能 [PRD §5.5, §8.5]

```
T-LBGEN-01: 生成链指示器显示
  PRD 需求: §5.5 "生成链指示器（常驻，替代原右侧面板）"
  步骤:
    1. 打开有生成子图的本地图大图
    2. 验证 ChainIndicator 显示链节点
  预期: 指示器正确渲染，当前图高亮
  文件: lightbox-generation.test.ts

T-LBGEN-02: 生成链指示器点击跳转
  PRD 需求: §5.5 "点击任意节点 = 跳转到该图（垂直轴导航）"
  步骤:
    1. 打开有生成子图的本地图大图
    2. 点击 ChainIndicator 中的子图节点
  预期: 跳转到对应生成图
  文件: lightbox-generation.test.ts

T-LBGEN-03: 生成链 API 返回树结构
  PRD 需求: §10.8 "后端提供 /api/media/{id}/tree"
  步骤:
    1. 调用 GET /api/media/{id}/tree
    2. 验证返回 root 节点
  预期: API 返回正确
  文件: lightbox-generation.test.ts

T-LBGEN-04: 脱离生成链 API
  PRD 需求: §8.5 "脱离链接变为本地图" / POST /api/media/{id}/detach
  步骤:
    1. 调用 POST /api/media/{id}/detach
    2. 验证 parent_media_id、workflow_type、generation_params 变为 null
    3. 验证 source_type 变为 "local"
    4. 验证子代（parent_media_id 指向被脱离图的媒体）保持关联不变
  预期: 脱离成功，子代跟随形成新独立树
  文件: lightbox-generation.test.ts

T-LBGEN-05: 无生成链图片显示无数据提示
  PRD 需求: §5.5 生成链面板空状态
  步骤:
    1. 打开无生成链图片的生成链面板
    2. 验证显示相应提示
  预期: 空状态正确
  文件: lightbox-generation.test.ts
```

### 3.31 媒体操作 [PRD §5.4, §8.1]

```
T-MCRUD-01: 评分持久化
  PRD 需求: §8.1 "评分范围 1-5 星"
  步骤:
    1. 通过 API 评分
    2. 重新获取验证评分值
  预期: 评分持久化
  文件: media-crud.test.ts

T-MCRUD-02: 清除评分
  PRD 需求: §8.1 "可清除（清除后视为未评分）"
  步骤:
    1. 评分设为 0（清除）
    2. 验证评分变为 null
  预期: 评分清除成功
  文件: media-crud.test.ts

T-MCRUD-03: 软删除
  PRD 需求: §8.6 "删除操作均为软删除"
  步骤:
    1. 软删除一张图片
    2. 验证该人物下媒体数量减少
  预期: 软删除正确
  文件: media-crud.test.ts

T-MCRUD-04: 批量删除
  PRD 需求: §5.4 "批量删除"
  步骤:
    1. 批量删除 2 张图片
    2. 验证媒体数量减少 2
  预期: 批量删除正确
  文件: media-crud.test.ts

T-MCRUD-05: 移动到图集
  PRD 需求: §5.4 "移动到图集"
  步骤:
    1. 通过 API 移动媒体到图集
    2. 验证图集内出现该媒体
  预期: 移动成功
  文件: media-crud.test.ts

T-MCRUD-06: 批量评分
  PRD 需求: §8.1 "多选批量评分"
  步骤:
    1. 批量评分 2 张图为 3 星
    2. 验证两张图均为 3 星
  预期: 批量评分生效
  文件: media-crud.test.ts
```

### 3.32 筛选排序（实现） [PRD §8.2, §8.3]

```
T-FILT-01: 按评分降序排列
  PRD 需求: §8.3 "评分排序"
  步骤:
    1. 按 rating 排序
    2. 验证第一个为 5 星，最后为 1 星
  预期: 排序正确
  文件: filter-sort.test.ts

T-FILT-02: 按创建时间排序
  PRD 需求: §8.3 "导入时间"
  步骤:
    1. 按 created_at 排序
    2. 验证最新在前
  预期: 时间排序正确
  文件: filter-sort.test.ts

T-FILT-03: 按 sort_order 排序
  PRD 需求: §5.4 默认排序
  步骤:
    1. 按 sort_order 排序
    2. 验证递增顺序
  预期: sort_order 排序正确
  文件: filter-sort.test.ts

T-FILT-04: 评分等于筛选
  PRD 需求: §8.2 "等于指定星级"
  步骤:
    1. 筛选 eq:5
    2. 验证仅返回 1 条 5 星记录
  预期: 等于筛选正确
  文件: filter-sort.test.ts

T-FILT-05: 评分大于等于筛选
  PRD 需求: §8.2 "大于等于指定星级"
  步骤:
    1. 筛选 gte:3
    2. 验证返回 3 条（5,4,3）
  预期: 大于等于筛选正确
  文件: filter-sort.test.ts

T-FILT-06: 评分小于等于筛选
  PRD 需求: §8.2 "小于等于指定星级"
  步骤:
    1. 筛选 lte:2
    2. 验证返回 2 条（2,1）
  预期: 小于等于筛选正确
  文件: filter-sort.test.ts

T-FILT-07: 排序+筛选组合
  PRD 需求: §8.2 "筛选条件可叠加"
  步骤:
    1. 按评分排序 + gte:3 筛选
    2. 验证 3 条，5 在前 3 在后
  预期: 组合查询正确
  文件: filter-sort.test.ts

T-FILT-08: 筛选栏 UI 存在
  PRD 需求: §5.4 "顶部筛选和排序工具栏"
  步骤:
    1. 导航到图集详情
    2. 验证筛选 UI 渲染
  预期: UI 存在
  文件: filter-sort.test.ts
```

### 3.33 任务队列（实现） [PRD §5.8]

```
T-TQ-01: 空状态显示
  PRD 需求: §5.8 任务列表
  步骤:
    1. 导航到 /tasks
    2. 验证显示 EmptyState 组件（含图标 + "暂无任务" 标题 + 描述文字）
  预期: 空状态正确（使用 EmptyState 组件而非纯文字）
  文件: task-queue.test.ts

T-TQ-02: 创建任务后显示在队列
  PRD 需求: §5.8 "任务卡片显示"
  步骤:
    1. 创建 upscale 任务
    2. 验证页面显示"等待中"和"高清放大"
  预期: 任务显示正确
  文件: task-queue.test.ts

T-TQ-03: 任务状态显示正确
  PRD 需求: §5.8 "状态：待执行 / 执行中 / 已完成 / 失败"
  步骤:
    1. 获取任务列表
    2. 验证 status 为 pending
  预期: 状态正确
  文件: task-queue.test.ts

T-TQ-04: 删除任务
  PRD 需求: §5.8 "删除任务"
  步骤:
    1. 删除任务
    2. 验证任务从列表消失
  预期: 删除成功
  文件: task-queue.test.ts

T-TQ-05: 多任务排序
  PRD 需求: §5.8 "队列排序"
  步骤:
    1. 创建 3 个任务
    2. 验证按 queue_order 升序排列
  预期: 排序正确
  文件: task-queue.test.ts

T-TQ-06: 排序 API（后端保留）
  PRD 需求: §5.8 PATCH /api/tasks/reorder（前端已移除拖拽排序 UI，后端 API 保留）
  步骤:
    1. 获取 pending 任务
    2. 反转顺序调用 reorder API
    3. 验证新顺序生效
  预期: 重排序 API 正常工作
  文件: task-queue.test.ts

T-TQ-07: 队列配置界面
  PRD 需求: §5.8 "队列启动模式配置"
  步骤:
    1. 导航到 /tasks
    2. 验证显示"队列配置"、"手动"、"自动"
  预期: 配置界面正确
  文件: task-queue.test.ts

T-TQ-08: 页头暂停/恢复按钮
  PRD 需求: §5.8 "暂停/恢复队列"
  步骤:
    1. 导航到 /tasks
    2. 验证页头显示暂停按钮
    3. 点击暂停按钮
    4. 验证按钮变为琥珀色（amber），表示队列已暂停
    5. 再次点击恢复
    6. 验证按钮恢复默认颜色
  预期: 暂停/恢复状态正确切换，调用 PUT /api/queue/config 设置 is_paused
  文件: task-queue.test.ts

T-TQ-09: 任务右键菜单
  PRD 需求: §5.8 "右键菜单（按状态动态显示）"
  前置: 创建 1 个 pending 任务
  步骤:
    1. 右键点击任务卡片
    2. 验证显示"查看详情"和"删除"菜单项
    3. 点击"查看详情"
    4. 验证弹出任务详情对话框
  预期: 右键菜单按状态正确显示，详情对话框打开
  文件: task-queue.test.ts

T-TQ-10: 任务详情对话框
  PRD 需求: §5.8 "任务详情对话框"
  前置: 创建 1 个 completed 任务（带 result_media_ids）
  步骤:
    1. 右键点击已完成任务
    2. 点击"查看详情"
    3. 验证弹窗显示任务类型、状态、时间信息
    4. 验证结果媒体显示缩略图
  预期: 详情对话框完整展示任务信息和结果
  文件: task-queue.test.ts

T-TQ-11: 进度条显示
  PRD 需求: §5.8 "执行中（实时进度条 + value/max 文字）"
  前置: 1 个 running 任务，stats API 返回 progress 数据
  步骤:
    1. 导航到 /tasks
    2. 验证运行中任务卡片显示进度条
    3. 验证显示 value/max 文字
  预期: 进度条随 stats 轮询实时更新
  文件: task-queue.test.ts

T-TQ-12: 最近完成结果视图
  PRD 需求: §5.8 "最近完成结果视图"
  前置: 2 个已完成任务（各有 result_media_ids）
  步骤:
    1. 导航到 /tasks
    2. 验证"最近完成结果"区域显示缩略图网格（按 finished_at 降序排列）
    3. 点击缩略图，验证进入 LightBox 大图模式
    4. 右键缩略图，验证完整右键菜单（AI 功能、加入工作区、移动到图集、评分、查看详情、删除），但不含"生成链"和"脱离生成链"
  预期: 结果图片正确展示，可点击放大，右键菜单完整（无生成链项）
  文件: task-queue.test.ts

T-TQ-13: 任务结果源图导航按钮
  PRD 需求: §5.8 "源图导航按钮（替代生成链指示器）"
  前置: 1 个已完成任务，结果图有 parent_media_id
  步骤:
    1. 导航到 /tasks，点击最近结果缩略图进入 LightBox
    2. 验证不显示 ChainIndicator（生成链指示器）
    3. 验证底部中央显示"查看源图"和"在图集中查看"两个按钮
    4. 点击"查看源图"，验证显示源图，按钮文字变为"返回结果"且高亮蓝色
    5. 点击"返回结果"，验证回到结果图
    6. 点击"在图集中查看"，验证 LightBox 关闭后重新打开，显示源图及其图集上下文
  预期: 源图切换和图集跳转正常工作
  文件: task-queue.test.ts

T-TQ-14: 创建链式任务
  PRD 需求: §5.8 "链式任务（Task Chaining）"
  步骤:
    1. POST /api/tasks/chain，body 包含 first（upscale）和 then（face_swap，chain_source_param=source_media_id）
    2. 验证返回的任务列表包含 2 个任务，共享同一 chain_id
    3. 验证第一步 chain_order=0，第二步 chain_order=1
    4. 验证第二步 chain_source_param="source_media_id"
  预期: 链式任务创建成功，chain_id/chain_order/chain_source_param 正确

T-TQ-15: 链式任务取消级联
  PRD 需求: §5.8 "取消链中任一步骤时，后续步骤级联取消"
  前置: 创建一条 2 步链式任务（均为 pending）
  步骤:
    1. POST /api/tasks/{step0_id}/cancel
    2. GET /api/tasks/{step1_id}
    3. 验证第二步状态也变为 cancelled
  预期: 取消第一步后，第二步自动级联取消

T-TQ-16: 链式任务重试（chain_order=0 重建整链）
  PRD 需求: §5.8 "重试 chain_order=0 的步骤会重建整条链"
  前置: 一条 failed 的链式任务（chain_order=0）
  步骤:
    1. POST /api/tasks/{step0_id}/retry
    2. 验证返回新任务有新的 chain_id
    3. 验证新链包含与原链相同数量的步骤
  预期: 重试第一步重建完整链

T-TQ-17: 链式任务重试（chain_order>0，前置步骤已成功 → 创建独立任务）
  PRD 需求: §5.8 "重试 chain_order>0 的步骤，若前置步骤全部成功则创建独立任务"
  前置: 一条链式任务，第一步 completed，第二步 failed
  步骤:
    1. POST /api/tasks/{step1_id}/retry
    2. 验证返回的新任务无 chain_id
  预期: 前置步骤正常时，重试非首步创建独立任务

T-TQ-17b: 链式任务重试（chain_order>0，前置步骤也失败 → 重建整链）
  PRD 需求: §5.8 "重试 chain_order>0 的步骤时，若存在失败的前置步骤则重建整条链"
  前置: 一条链式任务，第一步 failed，第二步也被级联 failed
  步骤:
    1. POST /api/tasks/{step1_id}/retry（对第二步发起重试）
    2. 验证返回新任务数组，有新的 chain_id
    3. 验证新链包含与原链相同数量的步骤
    4. 验证第二步的 chain_source_param 占位符已重置为 "__chain_input__"
  预期: 前置步骤失败时，重试非首步也会重建完整链

T-TQ-18: 链式任务排序 API 保持链内顺序（后端验证）
  PRD 需求: §5.8 "reorder 时校验链内相对顺序不被打乱"（前端已移除拖拽排序 UI，此为后端 API 测试）
  前置: 创建链式任务（2 步）+ 1 个普通任务，共 3 个 pending
  步骤:
    1. PATCH /api/tasks/reorder，尝试将链的第二步排在第一步之前
    2. 验证返回 400 错误
    3. PATCH /api/tasks/reorder，将普通任务排在链之前
    4. 验证成功
  预期: 链内相对顺序受保护，链外任务可自由排序

T-TQ-19: 链式任务卡片显示
  PRD 需求: §5.8 "TaskCard 显示 Link2 链式徽标 + 链信息行"
  前置: 创建一条 2 步链式任务（如图生图 → 高清放大）
  步骤:
    1. 导航到 /tasks
    2. 验证链式任务卡片显示链式徽标图标
    3. 验证链信息行格式为"1. 图生图 → 2. 高清放大"（步骤号 + 类别标签，无工作流名称，无状态）
    4. 验证链内子任务视觉缩进
  预期: 链式任务在队列中有正确的视觉标识
  文件: task-queue.test.ts

T-TQ-19b: 编辑参数并新建任务
  PRD 需求: §5.8 "编辑参数并新建（打开 WorkflowRunDialog，预填该任务的工作流和参数）"
  前置: 至少一个 custom 工作流类型的已完成或失败任务
  步骤:
    1. 导航到 /tasks
    2. 右键点击该任务
    3. 验证右键菜单中出现"编辑参数并新建"选项
    4. 点击该选项，验证 WorkflowRunDialog 弹出
    5. 验证对话框中工作流已选中为原任务的工作流
    6. 验证参数表单预填了原任务的参数值
    7. 修改任意参数后点击"加入队列"
    8. 验证新任务已创建且参数为修改后的值
  预期: 用户可基于已有任务编辑参数后快速创建新任务
  文件: task-queue.test.ts

T-TQ-19c: 自定义工作流 output_mappings 图片提升为 Media 记录
  PRD 需求: §10.3 "自定义工作流输出兼容"
  前置: 注册一个仅有 PreviewImage 输出节点（通过 output_mappings 配置）、无 SaveImage 节点的自定义工作流
  步骤:
    1. POST /api/tasks 提交该工作流任务
    2. 等待任务执行完成
    3. 验证任务 result_media_ids 非空
    4. 验证对应 Media 记录存在，file_path 指向 generated/<category>/ 目录（非 cache/previews/）
    5. 验证该 Media 的 source_type="generated"，workflow_type 正确
  预期: output_mappings 产出的图片被提升为正式 Media 记录，而非仅保存为预览缓存

T-TQ-19d: 链式任务 - 前置步骤仅有 output_mappings 输出时链式传递正常
  PRD 需求: §10.3 "自定义工作流输出兼容" + §5.8 "链式任务"
  前置: 创建 2 步链式任务，第一步为仅有 output_mappings 输出的自定义工作流，第二步为正常工作流
  步骤:
    1. 提交链式任务并等待执行
    2. 验证第一步 result_media_ids 非空
    3. 验证第二步的 params[chain_source_param] 被正确替换为第一步的输出 media_id
    4. 验证第二步执行成功（非"链式前置任务无输出"错误）
  预期: output_mappings 输出的图片能正确作为链式后续步骤的输入

T-TQ-19e: 独立任务拒绝未解析的 __chain_input__ 占位符
  PRD 需求: §10.3 "独立任务校验"
  步骤:
    1. POST /api/tasks，params 中包含 {"source_image": "__chain_input__"}
    2. 验证返回 400 错误
    3. 验证错误信息包含"__chain_input__"相关提示
  预期: 含未解析链式占位符的独立任务被拒绝，不进入队列

T-TQ-20: 启动恢复 - 遗留 running 任务标记为失败
  PRD 需求: §10.3 "启动恢复"
  步骤:
    1. 手动将数据库中某任务 status 设为 running
    2. 重启后端服务
    3. 查询该任务状态
  预期: status 变为 failed，error_message 包含"服务重启时任务仍在执行"

T-TQ-21: 链接下一步默认工作流为高清放大
  PRD 需求: §10.3 "链式默认工作流"
  步骤:
    1. 打开 WorkflowRunDialog 的链接下一步功能
    2. 验证默认选择的 category 为 upscale
  预期: 链接下一步默认使用高清放大类别
```

### 3.34 工作区（实现） [PRD §5.9]

```
T-WS-01: 工作区空状态
  PRD 需求: §5.9 空状态
  步骤:
    1. 导航到 /workspace
    2. 验证显示 EmptyState 组件（含图标 + "工作区为空" 标题 + 描述文字）
  预期: 空状态正确（使用 EmptyState 组件而非纯文字）
  文件: workspace.test.ts

T-WS-02: 添加到工作区
  PRD 需求: §5.9 "加入工作区"
  步骤:
    1. 添加一张图到工作区
    2. 验证工作区显示 1/100
  预期: 添加成功
  文件: workspace.test.ts

T-WS-03: 批量添加到工作区
  PRD 需求: §5.9 "批量加入"
  步骤:
    1. 批量添加 4 张图
    2. 验证工作区总数为 5
  预期: 批量添加成功
  文件: workspace.test.ts

T-WS-04: 去重添加
  PRD 需求: §5.9 去重
  步骤:
    1. 重复添加已在工作区的图片
    2. 验证数量不增加
  预期: 去重生效
  文件: workspace.test.ts

T-WS-05: 移除单个
  PRD 需求: §5.9 "移除单张"
  步骤:
    1. 删除一个工作区条目
    2. 验证数量减少 1
  预期: 移除成功
  文件: workspace.test.ts

T-WS-06: 拖拽排序 API
  PRD 需求: §5.9 "拖拽排序" / PATCH /api/workspace/reorder
  步骤:
    1. 反转工作区条目顺序
    2. 调用 reorder API
    3. 验证新顺序生效
  预期: 重排序成功
  文件: workspace.test.ts

T-WS-07: 清空工作区
  PRD 需求: §5.9 "一键清空"
  步骤:
    1. 清空工作区
    2. 验证数量为 0，显示"工作区为空"
  预期: 清空成功
  文件: workspace.test.ts
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

### 3.36 批量操作 [PRD §5.4, §8.7]

```
T-BATCH-01: 批量删除 API
  PRD 需求: §5.4 "批量删除"
  步骤:
    1. 批量删除 2 张图
    2. 验证删除数量正确
  预期: 批量删除成功
  文件: batch-operations.test.ts

T-BATCH-02: 批量评分 API
  PRD 需求: §8.1 "多选批量评分"
  步骤:
    1. 批量评分所有图片为 4 星
    2. 验证每张图评分为 4
  预期: 批量评分成功
  文件: batch-operations.test.ts

T-BATCH-03: 清理低分图 API
  PRD 需求: §8.7 "批量清理低分生成图"
  步骤:
    1. 评分一张图为 1 星
    2. 批量删除所有 ≤ 2 星的图
    3. 验证剩余图均 > 2 星
  预期: 清理成功
  文件: batch-operations.test.ts

T-BATCH-04: 多选模式 UI
  PRD 需求: §5.3 "多选模式入口"
  步骤:
    1. 导航到人物主页
    2. 验证显示"多选"按钮
  预期: 多选入口存在
  文件: batch-operations.test.ts

T-BATCH-05: 批量移动到图集 API
  PRD 需求: §5.4 "批量移动到图集"
  步骤:
    1. 创建目标图集
    2. 批量移动媒体到图集
    3. 验证图集内包含该媒体
  预期: 批量移动成功
  文件: batch-operations.test.ts

T-BATCH-06: 批量移动到其他人物 API
  PRD 需求: §5.3 "移动到其他人物"
  步骤:
    1. 在人物 A 下创建未分类
    2. 批量移动到人物 B（PATCH /api/media/batch {ids, person_id}）
    3. 验证媒体的 person_id = B
    4. 验证人物 A 和 B 的 avg_rating 均已重算
  预期: 批量移动成功，旧/新人物评分均正确重算
  文件: batch-operations.test.ts

### 多选操作补全

#### 图集内移动到其他人物
- 图集详情页进入多选模式 → 选择若干图片 → 点击「移动到其他人物」
- 选择目标人物 → 确认移动
- 验证：图片从当前图集消失，出现在目标人物未分类区
- 验证：图片 album_id 已清空，person_id 已更新

#### 跨人物移动到图集
- 人物主页未分类区进入多选模式 → 选择图片 → 点击「移动到图集」
- 点击人物切换按钮 → 选择其他人物的图集
- 验证：图片 person_id 自动同步为目标图集的 person_id

#### 跨人物新建图集并移动
- 移动到图集对话框 → 点击人物切换 → 点击「新建图集」
- 选择目标人物 → 输入图集名 → 创建并移动
- 验证：新图集创建在目标人物下，图片已移入

T-BATCH-07: 删除图集 — 转为未分类
  PRD 需求: §5.3 "删除图集（album_only）"
  步骤:
    1. 创建图集并导入 3 张图
    2. DELETE /api/albums/{id}?mode=album_only
    3. 验证图集已删除
    4. 验证 3 张图变为未分类（album_id = null，person_id 不变）
  预期: 图集删除，媒体保留为未分类

T-BATCH-08: 删除图集 — 移到其他图集
  PRD 需求: §5.3 "删除图集（move_to_album）"
  步骤:
    1. 创建图集 A（3 张图）和图集 B
    2. DELETE /api/albums/{A}?mode=move_to_album&target_album_id={B}
    3. 验证图集 A 已删除
    4. 验证 3 张图属于图集 B
  预期: 图集删除，媒体移入目标图集

T-BATCH-09: 删除图集 — 连同媒体删除
  PRD 需求: §5.3 "删除图集（album_and_media）"
  步骤:
    1. 创建图集并导入 3 张图
    2. DELETE /api/albums/{id}?mode=album_and_media
    3. 验证图集已删除
    4. 验证 3 张图已软删除（is_deleted=true）
  预期: 图集和媒体一起删除
```

### 3.37 键盘快捷键 [PRD §9.7]

```
T-KB-01: 右箭头前进
  PRD 需求: §9.7 "→ 切换图片"
  步骤:
    1. 打开大图，按右箭头
    2. 验证计数器从 1/ 变为 2/
  预期: 前进正确
  文件: keyboard-shortcuts.test.ts

T-KB-02: 左箭头后退
  PRD 需求: §9.7 "← 切换图片"
  步骤:
    1. 先前进再后退
    2. 验证回到 1/
  预期: 后退正确
  文件: keyboard-shortcuts.test.ts

T-KB-03: ESC 关闭大图
  PRD 需求: §9.7 "Esc 退出大图模式"
  步骤:
    1. 打开大图
    2. 按 Escape
    3. 验证 lightbox 消失
  预期: 正确退出
  文件: keyboard-shortcuts.test.ts

T-KB-04: 数字键 1-5 评分
  PRD 需求: §9.7 "1-5 快速评分"
  步骤:
    1. 在大图中按 1-5 数字键
    2. 验证最后一次按键（5）评分生效
  预期: 数字键评分正确
  文件: keyboard-shortcuts.test.ts

T-KB-05: 数字键 0 清除评分
  PRD 需求: §8.1 "可清除"
  步骤:
    1. 按 5 评分，再按 0 清除
    2. 验证评分清除
  预期: 清除成功
  文件: keyboard-shortcuts.test.ts
```

### 3.38 人物主页扩展测试 [PRD §5.3]

```
T-PER-06: 图集区和未分类区同时显示
  PRD 需求: §5.3 "主体：图集网格列表 + 未分类区域并列展示"
  步骤:
    1. 导航到人物主页
    2. 验证页面包含"图集"和"未分类"区域
  预期: 两区域并列显示
  文件: person-home.test.ts

T-PER-07: 空图集提示
  PRD 需求: §5.4 空图集
  步骤:
    1. 点击空图集进入详情
    2. 验证显示图集名称
  预期: 空图集正确显示
  文件: person-home.test.ts

T-PER-08: 未分类右键菜单操作
  PRD 需求: §5.4 "图片卡片右键菜单"
  步骤:
    1. 右键点击未分类卡片
    2. 验证菜单包含"高清放大"
  预期: 右键菜单正确
  文件: person-home.test.ts
```

### 3.39 评分筛选扩展测试 [PRD §8.1, §8.2]

```
T-RATE-03: 多星级 API 筛选组合
  PRD 需求: §8.2 "大于等于指定星级"
  步骤:
    1. 筛选 gte:3
    2. 验证返回 2 条记录（5 和 3）
  预期: 筛选正确
  文件: rating-filter.test.ts

T-RATE-04: 清除筛选恢复全部
  PRD 需求: §8.2 筛选清除
  步骤:
    1. 不带筛选参数查询
    2. 验证返回全部 5 条
  预期: 全部恢复
  文件: rating-filter.test.ts

T-RATE-05: 筛选与排序联动
  PRD 需求: §8.2 + §8.3 组合
  步骤:
    1. 按评分排序 + gte:1 筛选
    2. 验证返回 3 条，5 在前
  预期: 联动正确
  文件: rating-filter.test.ts
```

### 3.40 回收站扩展测试 [PRD §5.10]

```
T-BIN-04: 永久删除确认
  PRD 需求: §5.10 "永久删除"
  步骤:
    1. 软删除图片
    2. 在回收站验证出现
    3. 验证回收站页面包含删除操作
  预期: 永久删除入口存在
  文件: recycle-bin.test.ts

T-BIN-05: 批量恢复
  PRD 需求: §5.10 "恢复到原位置"
  步骤:
    1. 软删除多张图
    2. 逐一恢复
    3. 验证回收站清空
  预期: 批量恢复成功
  文件: recycle-bin.test.ts
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

### 3.42 媒体库扩展测试 [PRD §5.2]

```
T-LIB-06: 空状态下无人物网格
  PRD 需求: §5.2 空状态
  步骤:
    1. 重置数据库后导航到首页
    2. 验证无人物卡片，显示 EmptyState 组件（含图标 + "还没有任何人物" 标题 + 描述文字 + 导入按钮）
  预期: 空状态正确（使用 EmptyState 组件而非纯文字）
  文件: media-library.test.ts

T-LIB-07: 人物卡片封面图
  PRD 需求: §8.4 "人物封面"
  步骤:
    1. 创建人物 + 导入图片 + 设置封面
    2. 验证人物卡片显示图片
  预期: 封面图正确
  文件: media-library.test.ts

T-LIB-08: 人物评分统计显示
  PRD 需求: §5.2 "平均评分"
  步骤:
    1. 导航到首页
    2. 验证人物卡片存在
  预期: 评分统计区域渲染
  文件: media-library.test.ts
```

### 3.43 异常处理 [PRD §13]

```
T-ERR-01: ComfyUI 状态在设置页可见
  PRD 需求: §13.1 "前端显示 ComfyUI 状态"
  步骤:
    1. 打开设置页
    2. 验证页面包含 ComfyUI 相关文本
  预期: ComfyUI 状态区域可见
  文件: error-handling.test.ts

T-ERR-02: system/status API 返回 ComfyUI 连接状态
  PRD 需求: §13.1
  步骤:
    1. GET /api/system/status
    2. 验证返回 comfyui_connected 布尔字段
  预期: API 正确返回连接状态
  文件: error-handling.test.ts

T-ERR-03: 访问不存在的人物页面
  PRD 需求: §13 容错处理
  步骤:
    1. 导航到 /persons/nonexistent-uuid
    2. 验证页面不崩溃
  预期: 页面正常显示错误或重定向
  文件: error-handling.test.ts

T-ERR-04: 访问不存在的图集页面
  PRD 需求: §13 容错处理
  步骤:
    1. 导航到 /albums/nonexistent-uuid
    2. 验证页面不崩溃
  预期: 页面正常显示错误或重定向
  文件: error-handling.test.ts

T-ERR-05: API 404 响应格式
  PRD 需求: §13 错误处理
  步骤:
    1. GET /api/persons/nonexistent-id
    2. 验证返回 404 + detail 字段
  预期: 标准错误响应格式
  文件: error-handling.test.ts

T-ERR-06: API 验证错误响应
  PRD 需求: §13 输入验证
  步骤:
    1. POST /api/persons 传空名称
    2. 验证返回 4xx 错误
  预期: 拒绝无效输入
  文件: error-handling.test.ts

T-ERR-07: 无效媒体 ID 的 PATCH 返回 404
  PRD 需求: §13 错误处理
  步骤:
    1. PATCH /api/media/nonexistent-id 设评分
    2. 验证返回 404
  预期: 不存在的资源返回正确错误码
  文件: error-handling.test.ts
```

### 3.44 P3-UI 视觉改进 [P3-UI]

```
T-UI-01: 加载态空白（不使用骨架屏）
  PRD 需求: P3-UI 加载态规范
  步骤:
    1. 导航到首页（人物库）
    2. 验证数据加载完成前页面显示空白（无骨架屏、无 EmptyState）
    3. 数据加载完成后正常显示内容
  预期: 加载中显示空白页面，不使用骨架屏
  适用页面: MediaLibrary, PersonHome, AlbumDetail, RecycleBin

T-UI-01b: 页面切换无闪烁
  PRD 需求: P3-UI 加载态规范（防闪烁）
  步骤:
    1. 导航到人物库，等待数据加载完成
    2. 切换到其他页面（回收站/任务队列/工作区等）再切换回人物库
    3. 验证页面切换过程中不会出现 EmptyState 的短暂闪烁
  预期: 已有数据的页面在 re-fetch 期间保持显示现有数据，不闪烁空状态
  实现: EmptyState 仅在 `!loading && items.length === 0` 时显示

T-UI-01c: 同类实体切换无旧数据闪烁
  PRD 需求: P3-UI 加载态规范（防旧数据残留）
  步骤:
    1. 进入图集 A，等待加载完成
    2. 返回后进入图集 B
    3. 验证不会先显示图集 A 的内容再切换到图集 B
    4. 同理测试人物 A → 人物 B 的切换
  预期: 切换到不同实体时清除旧数据，显示空白直到新数据加载完成
  实现: useEffect 中按需清除 store 旧数据（仅在 entity ID 变化时）+ 渲染条件增加 currentEntity.id !== routeId 守卫

T-UI-02: EmptyState 空状态组件
  PRD 需求: P3-UI-B6 空状态组件
  步骤:
    1. 重置数据库后访问各页面
    2. 等待加载完成（loading=false）后验证空状态显示 EmptyState 组件（含图标容器 + 标题 + 描述文字）
    3. 验证加载过程中不会提前显示 EmptyState（应显示空白）
  预期: 所有空列表使用 EmptyState 组件，且仅在加载完成确认数据为空后才显示
  适用页面: MediaLibrary, PersonHome(图集/未分类), AlbumDetail, TaskQueue, Workspace, RecycleBin

T-UI-03: 卡片入场 stagger 动画
  PRD 需求: P3-UI-C1 入场动画
  步骤:
    1. 导航到人物库页面
    2. 验证卡片带有 animate-fade-in-up class
    3. 验证不同卡片有递增的 animation-delay
  预期: 卡片依次 fade-in-up 入场

T-UI-04: Inter 字体加载
  PRD 需求: P3-UI-B1 Inter 字体
  步骤:
    1. 打开任意页面
    2. 检查 body computed font-family 包含 "Inter Variable"
  预期: Inter 字体正确应用

T-UI-05: prefers-reduced-motion 支持
  PRD 需求: P3-UI-C4 无障碍
  步骤:
    1. 启用 prefers-reduced-motion: reduce
    2. 验证卡片入场无动画（animation-duration ≈ 0）
  预期: 动画被禁用
```

### 3.24 性能指标 [PRD §14]

```
T-PERF-01: 人物列表首屏渲染 < 500ms
  PRD 需求: §14 "100 个人物，PC Chrome"
  前置: 导入 100 个人物
  步骤:
    1. 导航到首页
    2. 测量从导航到首个人物卡片渲染完成的时间
    3. 验证 < 500ms
  预期: 首屏渲染满足指标
  Puppeteer:
    const start = Date.now()
    await page.goto(BASE)
    await waitForSelector('[data-testid="person-card"]')
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)

T-PERF-02: 大图切换响应 < 100ms
  PRD 需求: §14 "切换到已缓存的相邻图片（预加载 ±5 张共 8 张）"
  步骤:
    1. 打开大图模式
    2. 等待预加载完成（当前图前后 8 张相邻图片，偏移 +1/-1/+2/-2/+3/-3/+4/+5）
    3. 按 → 键，测量到图片显示完成的时间
    4. 验证 < 100ms
  预期: 切换响应满足指标

T-PERF-03: 图集 1000 张图首屏 < 1s
  PRD 需求: §14 "1000 张图的图集，PC Chrome"
  前置: 图集含 1000 张图
  步骤:
    1. 导航到该图集
    2. 测量首屏（可视区域内缩略图）加载时间
    3. 验证 < 1s
  预期: 大数据量首屏满足指标
```

---

## 4. 测试执行

### 4.1 运行命令

```bash
cd frontend

# 运行所有 E2E 测试
npx jest --config jest.config.ts

# 运行特定模块
npx jest --config jest.config.ts --testPathPattern="navigation"

# 带截图的调试模式（非 headless）
HEADLESS=false npx jest --config jest.config.ts
```

### 4.2 测试报告

使用 `jest-html-reporter` 生成 HTML 报告：

```bash
npx jest --config jest.config.ts --reporters=default --reporters=jest-html-reporter
```

### 4.3 CI 集成

```yaml
# .github/workflows/e2e.yml
- name: Start backend
  run: cd backend && venv/Scripts/uvicorn.exe main:app --port 8000 &
- name: Start frontend
  run: cd frontend && npm run dev &
- name: Run E2E tests
  run: cd frontend && npx jest --config jest.config.ts
```

---

## 5. 覆盖率统计

### 5.1 需求覆盖率

| PRD 章节 | 总需求点 | 已覆盖测试 | 覆盖率 |
|---|---|---|---|
| §5.1 导航栏 | 8 | 8 (T-NAV-*, T-SIDE-*) | 100% |
| §5.2 媒体库主页 | 13 | 13 (T-LIB-*, T-PCRUD-*) | 100% |
| §5.3 人物主页 | 13 | 13 (T-PER-*, T-ACRUD-*) | 100% |
| §5.4 图集详情 | 17 | 17 (T-ALB-*, T-ADET-*) | 100% |
| §5.5 大图模式 | 30 | 30 (T-LB-规划12, T-LB-实现7, T-LBA-6, T-LBGEN-5) | 100% |
| §5.6 视频模式 | 7 | 7 (T-VID-*) | 100% |
| §5.7 蒙版编辑器 + 媒体操作 | 15 | 15 (T-MASK-*, T-MCRUD-*) | 100% |
| §5.8 任务队列 | 36 | 36 (T-TASK-*, T-TQ-*, T-TQL-06~14) | 100% |
| §5.9 工作区 | 7 | 7 (T-WS-*) | 100% |
| §5.10 回收站 | 5 | 5 (T-BIN-*) | 100% |
| §5.11 设置页 + ComfyUI | 11 | 11 (T-SET-*, T-CUI-*) | 100% |
| §6 导入流程 | 8 | 8 (T-IMP-*) | 100% |
| §7.2 高清放大 | 3 | 3 (T-AI-UP-*) | 100% |
| §7.3/7.4 局部修复 | 5 | 5 (T-AI-IP-*) | 100% |
| §7.5 换脸 | 5 | 5 (T-AI-FS-*) | 100% |
| §8.1 评分 | 5 | 5 (T-RATE-*) | 100% |
| §8.2/8.3 筛选排序 | 15 | 15 (T-FILT-*, T-FILT-DEF-*, T-SORT-*) | 100% |
| §8.4 封面 | 5 | 5 (T-COVER-*) | 100% |
| §8.6 软删除 | 4 | 4 (T-DEL-*) | 100% |
| §8.7 批量操作 | 5 | 5 (T-BATCH-*) | 100% |
| §8.8 随机探索 | 5 | 5 (T-EXP-*) | 100% |
| §9.6 响应式 | 13 | 13 (T-RESP-*) | 100% |
| §9.7 键盘快捷键 | 5 | 5 (T-KB-*) | 100% |
| §13 异常处理 | 7 | 7 (T-ERR-*) | 100% |
| §14 性能指标 | 3 | 3 (T-PERF-*) | 100% |
| P0/P1 补齐 | 10 | 10 (T-MTYPE-*, T-CANCEL-*) | 100% |
| MediaDetailDialog | 3 | 3 (T-DETAIL-*) | 100% |
| 统一右键菜单 | 2 | 2 (T-CTX-*) | 100% |
| 工作流默认值/遮罩 | 2 | 2 (T-WF-20~21) | 100% |
| **总计** | **238** | **238** | **100%** |

### 5.2 未覆盖的 PRD 功能（标记为后续实现）

| PRD 章节 | 功能 | 原因 |
|---|---|---|
| §5.5 优先级遍历导航 | 生成链 DFS 遍历 | 已实现，覆盖在 T-LBNAV-02 |
| §9.2 鼠标框选多选 | 框选交互 | 低优先级，未实现 |

**已覆盖的原"后续"功能：**
- §8.5 脱离链接：已通过 T-LBGEN-04 测试 `POST /api/media/{id}/detach`
- §8.7 清理低分生成图：已通过 T-BATCH-03 测试批量清理低分图 API

---

## 6. P3 网页抓取器测试用例

### 6.1 小工具页面导航 (T-TOOL-01)

**PRD**: §11.2
**前提**: 应用已启动

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 点击侧边栏"小工具" | 导航到 `/tools`，页面显示"网页抓取"和"下载记录"两个 Tab |
| 2 | screenshot('tools-page') | Tab 切换 UI 正常渲染 |

### 6.2 解析小红书链接 (T-TOOL-02)

**PRD**: §11.2.1, §11.2.2
**前提**: 后端已启动，mock `/api/download/parse` 返回预设数据

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 在 textarea 输入小红书分享文本 | 文本正常显示 |
| 2 | 点击"解析"按钮 | 显示加载状态 |
| 3 | 等待解析完成 | 显示解析结果：作者名、标题、图片缩略图网格、媒体数量 |
| 4 | screenshot('tools-parse-result') | 结果预览布局正确 |

### 6.3 关联设置默认值 (T-TOOL-03)

**PRD**: §11.2.2 步骤 4
**前提**: 解析结果已返回（新账号，无已关联人物）

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 检查人物关联区域 | 默认选中"新建人物"，人物名预填为博主显示名 |
| 2 | 检查"记住此账号"选项 | 默认勾选 |
| 3 | 检查图集模式 | 默认选中"新建图集"，图集名预填为帖子标题 |
| 4 | screenshot('tools-association-defaults') | 默认值正确 |

### 6.4 确认下载 (T-TOOL-04)

**PRD**: §11.2.2 步骤 6
**前提**: 解析结果已展示，关联设置已填写，mock `/api/download/confirm`

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 点击"确认下载"按钮 | 显示下载中状态 |
| 2 | 等待完成 | toast 提示"下载完成"，自动跳转到生成的图集页 |

### 6.5 下载记录列表 (T-TOOL-05)

**PRD**: §11.2.3
**前提**: 已有下载记录数据

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 切换到"下载记录" Tab | 显示记录列表：平台标签、标题、日期、状态 |
| 2 | screenshot('tools-records') | 列表布局正确 |
| 3 | 对失败记录点击重试按钮 | 触发重试请求 |
| 4 | 对成功记录点击跳转按钮 | 导航到对应图集页 |

### 6.6 批量扫描 — 小工具页入口 (T-TOOL-06)

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

### 6.7 批量扫描 — 人物主页入口 (T-TOOL-07)

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

### 6.8 批量扫描 — 去重逻辑 (T-TOOL-08)

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

### 6.9 抖音链接解析 (T-TOOL-09)

**PRD**: §11.2
**前提**: 已配置抖音 Cookie

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 粘贴 `douyin.com/note/xxx` 格式链接 | 解析成功，显示平台标签"抖音" |
| 2 | 粘贴 `douyin.com/user/xxx?modal_id=xxx` 格式链接 | 解析成功（自动转换为 note URL） |
| 3 | 粘贴 `v.douyin.com/xxx` 短链 | 解析成功（自动跟踪重定向） |

---

## 7. P0/P1 补齐功能测试用例

### 7.1 媒体类型筛选 (T-MTYPE-01 ~ 02)

**PRD**: §5.5 "媒体类型（图片/视频，可叠加）"

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-MTYPE-01: API 无筛选返回全部类型 | 1. 导入图片+视频到图集<br>2. GET /api/media/album/{id} | 返回全部 4 条（3图+1视频） |
| T-MTYPE-02: API media_type=image 只返回图片 | GET /api/media/album/{id}?media_type=image | 返回 3 条图片，media_type 全为 image |
| T-MTYPE-03: API media_type=video 只返回视频 | GET /api/media/album/{id}?media_type=video | 返回 1 条视频，media_type 为 video |
| T-MTYPE-04: FilterBar 显示媒体类型下拉 | 1. 进入图集详情页<br>2. 检查 select 元素 | 存在下拉选择器 |
| T-MTYPE-05: media_type 与 filter_rating 组合筛选 | 1. 给一张图评5星<br>2. GET ?media_type=image&filter_rating=eq:5 | 仅返回该图片 |

> 实现文件: `media-type-filter.test.ts`（T-MTYPE-01 ~ 05，共 5 用例）

### 7.2 任务取消 (T-CANCEL-01 ~ 02)

**PRD**: §5.10 "pending：取消、删除"

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-CANCEL-01: 取消 pending 任务 | 1. 创建 pending 任务<br>2. POST /tasks/{id}/cancel<br>3. 验证状态为 cancelled | 状态更新为 cancelled |
| T-CANCEL-02: 已取消任务不能再次取消 | 1. 取消一个任务<br>2. 再次取消同一任务 | 返回 400 错误 |
| T-CANCEL-03: 取消后任务列表更新 | 1. 取消任务<br>2. GET /tasks/{id} | status=cancelled，finished_at 有值 |
| T-CANCEL-04: 任务队列页面显示 | 1. 创建 pending 任务<br>2. 导航到 /tasks | 任务页面正常加载 |
| T-CANCEL-05: 删除已取消的任务 | 1. 取消任务<br>2. DELETE /tasks/{id}<br>3. GET /tasks/{id} | 删除成功，返回 404 |

> 实现文件: `task-cancel.test.ts`（T-CANCEL-01 ~ 05，共 5 用例）

### 7.3 图集移动到其他人物 (T-AMOVE-01)

**PRD**: §5.4 "移动到其他人物"

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-AMOVE-01: 图集移动 | 1. 在人物主页右键图集卡片<br>2. 点击"移动到其他人物"<br>3. 在弹窗中选择目标人物<br>4. 确认移动 | 图集及其所有媒体的 person_id 更新为目标人物 |

### 7.4 文件丢失检测与重新定位 (T-MISS-01 ~ 05)

**PRD**: §6.6 "文件丢失处理"

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-MISS-01: 丢失文件红框标记 | 1. 导入本地图片<br>2. 手动删除物理文件<br>3. 刷新页面 | 丢失文件的 MediaCard 显示红色边框 + 警告图标 |
| T-MISS-02: MediaCard 右键重新定位 | 1. 导入本地图片并移动物理文件<br>2. 刷新页面确认红色标记<br>3. 右键点击缺失卡片<br>4. 选择"重新定位文件"<br>5. 选择新路径 | 文件成功重新定位，红色标记消失 |
| T-MISS-03: MediaDetailDialog 重新定位 | 1. 右键缺失文件卡片 → 查看详情<br>2. 验证顶部显示文件不存在警告横幅<br>3. 点击"重新定位"按钮<br>4. 选择新路径 | 警告消失，文件路径更新 |
| T-MISS-04: LightBox 右键重新定位 | 1. 打开缺失文件的大图浏览<br>2. 验证显示错误占位 UI<br>3. 右键 → "重新定位文件" | 文件重新定位成功 |
| T-MISS-05: LightBox 图片加载失败占位 | 1. 打开缺失文件的大图浏览 | 显示 AlertTriangle 图标 + "文件不存在或无法加载"提示 |

### 7.5 设置页新字段 (T-SET-06 ~ 10)

**PRD**: §5.11

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-SET-06: ComfyUI 启动命令 | 1. 导航到设置页<br>2. 查看 ComfyUI 区域 | 显示启动命令输入框 |
| T-SET-07: FastAPI 端口配置 | 1. 导航到设置页<br>2. 查看"服务器"区域 | 显示端口输入框 + "修改后需重启后端" 提示 |
| T-SET-08: AppData 迁移确认 | 1. 导航到设置页<br>2. 修改 AppData 路径<br>3. 点击保存 | 弹出 ConfirmDialog（含标题+描述说明），点击确认后执行迁移 |

### 7.6 LightBox 双轴导航 (T-LBNAV-01 ~ 06)

**PRD**: §5.5 "双轴导航模型"

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-LBNAV-01: 水平轴键盘导航 | 1. 打开有多张本地图的图集 LightBox<br>2. 按 → 键<br>3. 按 ← 键 | → 切换到下一张本地图（跳过生成图），← 切换回上一张本地图 |
| T-LBNAV-02: 垂直轴键盘导航 | 1. 打开有生成子图的本地图 LightBox<br>2. 按 ↓ 键<br>3. 按 ↑ 键 | ↓ 进入第一张子生成图（深度优先），↑ 返回父图 |
| T-LBNAV-03: 跨图集导航 | 1. 打开人物最后一个图集的最后一张本地图<br>2. 按 → 键 | 跳转到同人物下一个图集的第一张本地图，且媒体排序与打开 LightBox 时页面的排序/筛选一致 |
| T-LBNAV-08: 跨图集导航排序一致性 | 1. 在图集详情页选择排序为"创建时间最新"<br>2. 点击图片打开 LightBox<br>3. 左右导航到其他图集<br>4. 再导航回原图集 | 原图集内的媒体显示顺序与步骤 2 打开时完全一致，不会因跨图集往返而改变 |
| T-LBNAV-04: 扁平模式（无上下文） | 1. 从任务队列/工作区打开 LightBox<br>2. 按 → 键 | 在传入的 items 扁平数组中顺序切换，不触发跨图集/跨人物跳转 |
| T-LBNAV-05: ChainIndicator 可见性 | 1. 打开无生成图的本地图 LightBox<br>2. 打开有生成子图的本地图 LightBox | 无生成图时 ChainIndicator 不显示（高度 0），有生成图时显示链节点 |
| T-LBNAV-06: 滚轮垂直轴导航 | 1. 打开有生成子图的本地图 LightBox<br>2. 在图片/黑边区域滚轮向下<br>3. 滚轮向上 | 滚轮下 = ↓ 进入生成链子图，滚轮上 = ↑ 返回父图 |
| T-LBNAV-07: 弹窗覆盖层屏蔽滚轮导航 | 1. 在 LightBox 中打开任意弹窗（如 MediaDetailDialog）<br>2. 在弹窗内滚动鼠标滚轮 | 滚轮不触发 LightBox 垂直轴导航 |
| T-LBNAV-09: 混合显示 DFS 排序 | 1. 图集详情页切换到"混合显示"模式（不过滤 source_type）<br>2. 验证生成图紧跟在其原图后面<br>3. 同一原图的多个生成图按创建时间排列 | 列表按 DFS 顺序展示，生成图紧跟原图 |
| T-LBNAV-10: ChainIndicator 展开树布局 | 1. 打开有多级生成链的图片 LightBox<br>2. 点击 ChainIndicator 展开按钮<br>3. 验证浮层显示水平树布局 | 横向=深度层级，纵向=同级时间排列，SVG 曲线连接父子，当前图高亮 |
| T-LBNAV-11: 脱离后链状态正确 | 1. 在 LightBox 中查看生成链中的某个生成图<br>2. 右键脱离生成链<br>3. 验证该图变为本地图（source_type=local）<br>4. 验证其子代仍可通过新的生成链访问 | 脱离后该图从原链移除，成为独立本地图，子代跟随形成新链 |

### 7.8 PWA (T-PWA-01)

**PRD**: §1 "PWA + 响应式设计"

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-PWA-01: Service Worker 注册 | 1. `npm run build`<br>2. 检查 dist/ 输出 | 生成 sw.js、manifest.webmanifest、registerSW.js |

### 7.9 API 字段验证 (T-API-01 ~ 02)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-API-01: Media 返回 generation_params | 1. 创建含 generation_params 的媒体<br>2. GET /api/media/{id} | 响应包含解析后的 generation_params JSON 对象 |
| T-API-02: Media 返回 video_timestamp | 1. 截图并传入 timestamp<br>2. GET /api/media/{id} | 响应包含 video_timestamp 字段 |

## 8. 工作流管理系统测试用例

### 8.1 工作流 Categories API (T-WF-01)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-WF-01: 获取 Category 列表 | 1. GET /api/workflow-categories | 返回 6 个 category（face_swap, inpaint, upscale, text_to_image, image_to_image, preprocess），每个含 params 数组 |

### 8.2 工作流 JSON 解析 (T-WF-02 ~ 03)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-WF-02: 解析含 @ 节点的 JSON | 1. POST /api/workflows/parse，传入含 @base_image(LoadImage)、@output(SaveImage)、@sampler(KSampler) 的 JSON | 返回 image_inputs=[{suggested_name: "base_image"}]，output_nodes=[{class_type: "SaveImage"}]，scalar_params 包含 KSampler 的标量输入，text_outputs=[] |
| T-WF-02b: 解析含文本输出节点的 JSON | 1. POST /api/workflows/parse，传入含 @caption(ShowText，无标量输入) 的 JSON | 返回 text_outputs=[{node_id, suggested_name: "caption", class_type: "ShowText"}] |
| T-WF-03: 不含 @ 节点的 JSON | 1. POST /api/workflows/parse，传入无 @ 前缀节点的 JSON | 返回空的 image_inputs、scalar_params、output_nodes、text_outputs |

### 8.3 工作流 CRUD (T-WF-04 ~ 08)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-WF-04: 创建工作流 | 1. POST /api/workflows（name, category=face_swap, workflow_json, manifest 含 base_image 和 face_ref 映射） | 201，返回完整工作流对象 |
| T-WF-05: 重名创建 | 1. 创建工作流 A<br>2. 创建同名工作流 B | 第二次返回 409 |
| T-WF-06: 覆盖创建 | 1. 创建工作流 A<br>2. 传入 overwrite_id=A.id 创建同名 | 201，返回更新后的工作流 |
| T-WF-07: 更新工作流 | 1. PUT /api/workflows/:id（name="新名称"） | 200，name 已更新 |
| T-WF-08: 删除工作流 | 1. DELETE /api/workflows/:id | 204，再 GET 返回 404 |

### 8.4 Manifest 校验 (T-WF-09 ~ 10)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-WF-09: 缺少必填映射 | 1. POST /api/workflows，category=face_swap，manifest 缺少 base_image 映射 | 422，错误信息包含 "Required parameter 'base_image'" |
| T-WF-10: 完整映射 | 1. POST /api/workflows，category=face_swap，manifest 含 base_image + face_ref | 201 |

### 8.5 默认工作流 (T-WF-11 ~ 12)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-WF-11: 设为默认 | 1. 创建两个 face_swap 工作流 A 和 B<br>2. PATCH /api/workflows/B/default | B.is_default=true，A.is_default=false |
| T-WF-12: 列表过滤 | 1. 创建 face_swap 和 upscale 工作流<br>2. GET /api/workflows?category=face_swap | 只返回 face_swap 类别的工作流 |

### 8.5b 输出映射 (T-WF-12b ~ 12d)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-WF-12b: Category 输出定义 | 1. GET /api/workflow-categories | preprocess 类别包含 outputs 数组（含 caption: {type: "string", label: "反推提示词"}） |
| T-WF-12c: Manifest 含 output_mappings | 1. 创建 preprocess 工作流，manifest 含 output_mappings: {"反推提示词": {node_id: "15", key: "text"}}（外层 key 为显示标签，内层 key 为 ComfyUI 输出字段名） | 201，返回的 manifest 包含 output_mappings |
| T-WF-12d: 任务详情含 result_outputs | 1. 已完成任务的 result_outputs 为 {"caption": "some text"}<br>2. GET /api/tasks/:id | 返回的 result_outputs 包含 caption 字段 |

### 8.6 预置工作流种子 (T-WF-13)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-WF-13: 空表自动种入 | 1. 清空 workflows 表<br>2. 重启后端 | workflows 表包含预置工作流（faceswap/upscale/inpaint_flux/sdxl/klein/generate/generate_pose），每个 category 第一个 is_default=true |

### 8.7 前端工作流管理 (T-WF-14 ~ 19)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-WF-14: 设置页 Tab 切换 | 1. 导航到 /settings<br>2. 点击「工作流管理」Tab | 显示工作流列表和 category 过滤按钮 |
| T-WF-15: 导入对话框 | 1. 点击「导入工作流」<br>2. 上传 JSON 文件 | 显示解析摘要（默认折叠）和参数映射表单 |
| T-WF-15b: 自动映射包含匹配 | 1. 上传含 `@my_base_image`(LoadImage) 和 `@my_prompt`(KSampler) 的 JSON<br>2. 选择类别 | `base_image` 参数自动匹配到 `@my_base_image`，`prompt` 参数自动匹配到 `@my_prompt`（包含匹配，无需完全相等） |
| T-WF-15c: 自定义参数分配 — 角色切换（标量节点） | 1. 上传含 `@extra_node`(非 LoadImage/SaveImage) 的 JSON<br>2. 在自定义参数分配区域找到该节点<br>3. 将角色从「不使用」切换为「输入」 | 展开该节点的标量参数列表，每个参数显示勾选框和可编辑标签 |
| T-WF-15c2: 自定义参数分配 — 未映射 LoadImage | 1. 上传含 `@ref_img`(LoadImage) 的 JSON，该节点未被契约参数映射<br>2. 在自定义参数分配区域找到该节点 | 该 LoadImage 节点出现在分配列表中，仅可选「不使用」/「输入」。设为「输入」后显示类型切换（图片/遮罩）和标签编辑框 |
| T-WF-15d: 自定义参数分配 — 输出角色 | 1. 将某未映射 `@` 节点角色切换为「输出」 | 展开输出键编辑框，默认值为 "text" |
| T-WF-15e: 自定义参数分配 — 输入+输出 | 1. 将某节点角色切换为「输入+输出」 | 同时显示标量参数勾选列表和输出键编辑框 |
| T-WF-15f: 自定义参数分配 — Manifest 生成 | 1. 将节点 A 设为「输入」并勾选一个参数（编辑 label 为 "my_label"），将节点 B 设为「输出」<br>2. 提交 | 生成的 manifest 中 extra_params 包含 `{name: "A.key", label: "my_label", type: "string", node_id, key}`，output_mappings 包含节点 B 的映射 |
| T-WF-15g: Category 输出节点自动角色 | 1. 上传含 `@caption`(ShowText) 的 JSON<br>2. 选择 preprocess 类别（定义了 outputs） | `@caption` 节点自动设为「输出」角色 |
| T-WF-16: AI 工具 Tab — 契约参数 | 1. 导航到 /tools<br>2. 点击「AI 工具」Tab<br>3. 选择一个工作流 | 显示工作流描述和 Category 契约参数表单 |
| T-WF-17: AI 工具 Tab — 额外参数渲染 | 1. 选择一个 manifest 含 extra_params 的工作流 | 契约参数下方显示分隔线 + "额外参数" 标签，渲染额外参数表单 |
| T-WF-18: AI 工具 Tab — 额外参数类型 | 1. 工作流的 extra_params 包含 string/bool/int/float 类型参数 | string 渲染为 textarea，bool 渲染为 toggle 滑块开关，int/float 渲染为 number input |
| T-WF-18b: AI 工具 Tab — 图片类型额外参数 | 1. 工作流的 extra_params 包含 `type: "image"` 的条目 | 显示"选择图片"按钮，点击可通过 FaceRefPicker 选取媒体 |
| T-WF-18c: AI 工具 Tab — 遮罩类型额外参数 | 1. 工作流的 extra_params 包含 `type: "image", source: "file_path"` 的条目 | 显示"绘制遮罩"按钮，点击打开 MaskEditor |
| T-WF-19: AI 工具 Tab — 额外参数默认值 | 1. 选择含 extra_params 的工作流 | 标量参数默认值从 workflow_json 提取并正确填充；image 类型参数无默认值（空） |

### 8.8 工作流默认值编辑与 AI 工具遮罩 (T-WF-20 ~ 21)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-WF-20: 工作流详情编辑默认值 | 1. 导航到 /settings 工作流管理 Tab<br>2. 点击某工作流卡片<br>3. 修改参数默认值<br>4. 点击保存 | 默认值更新成功，再次打开详情对话框显示新值 |
| T-WF-21: AI 工具 Tab 遮罩绘制 | 1. 导航到 /tools AI 工具 Tab<br>2. 选择含 mask 类型参数的 inpaint 工作流<br>3. 点击"绘制遮罩"按钮 | MaskEditor 全屏打开，完成绘制后遮罩路径回填参数 |
| T-WF-22-COMBO: 工作流 combo 参数下拉框 | 1. 导入含 combo/dropdown 类型参数的工作流（如模型选择节点）<br>2. 在导入配置中将 combo 参数设为自定义输入<br>3. 查看工作流详情页和运行对话框的参数面板 | combo 参数渲染为 Select 下拉框而非文本输入，选项列表与 ComfyUI 一致；manifest 中存储 choices 字段 |
| T-WF-23-COMBO-OFFLINE: combo 参数离线缓存 | 1. 导入工作流（ComfyUI 在线），记录 combo 选项<br>2. 关闭 ComfyUI<br>3. 重新编辑该工作流 | combo 参数选项仍然可用（从 manifest 存储的 choices 回退），下拉框正常渲染 |

### 8.9 工作流编辑模式 (T-WF-22 ~ 25)

**PRD**: §5.11.1 "工作流编辑模式"

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-WF-22: 右键菜单编辑入口 | 1. 导航到 /settings 工作流管理 Tab<br>2. 右键某工作流卡片<br>3. 点击「编辑配置」 | WorkflowImportDialog 打开，直接进入配置步骤（跳过上传步骤） |
| T-WF-23: 详情对话框编辑入口 | 1. 点击工作流卡片打开详情对话框<br>2. 点击头部「编辑配置」按钮 | WorkflowImportDialog 打开，进入配置步骤 |
| T-WF-24: 编辑模式预填字段 | 1. 通过编辑入口打开 WorkflowImportDialog<br>2. 检查配置步骤各字段 | 名称、类别、描述预填；参数映射从已保存 manifest 恢复；节点分配和输出映射正确还原 |
| T-WF-25: 编辑提交更新 | 1. 在编辑模式中修改工作流名称和描述<br>2. 点击提交 | 调用 PUT /api/workflows/:id 更新，返回工作流管理页后显示新名称/描述 |

### 8.10 复合工作流 (T-WF-26 ~ 30)

#### 创建复合工作流
- 工作流管理页点击「创建复合工作流」→ 输入名称 → 选择 2 个步骤 → 创建成功
- 列表中显示「复合」标签和步骤数量
- 验证：步骤少于 2 个时无法创建
- 验证：展开后超过 10 步时无法创建
- 验证：循环引用时返回 422 错误

#### 复合工作流运行（单任务）
- 右键图片 → 选择复合工作流 → 创建链式任务组
- 验证：任务列表显示正确的链式步骤
- 验证：步骤概览正确显示各步骤名称

#### 复合工作流运行（批量）
- 批量处理对话框 → 选择复合工作流 → 显示步骤概览
- 提交后每张图创建一个链式任务组
- toast 显示正确的任务数和链式数

### 8.11 链式任务改进 (T-WF-31 ~ 33)

#### 链式步骤失败级联
- 创建链式任务（A→B→C），让步骤 B 失败
- 验证步骤 C 被标记为 failed，错误信息包含前置任务失败原因

#### delay 模式即时响应
- 设置 delay 模式（5分钟）→ 添加任务
- 在等待期间点击「立即执行」→ 验证任务立即开始执行

#### 批量跳过生成图反馈
- 选择包含 AI 生成图的多张图片 → 批量处理
- toast 提示中显示跳过的生成图数量

---

## 9. MediaDetailDialog 测试 (T-DETAIL-01 ~ 03)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-DETAIL-01: 图集详情页查看详情 | 1. 在图集详情页右键图片<br>2. 点击"查看详情" | 弹出 MediaDetailDialog，显示文件名、目录、格式、分辨率、百万像素、文件大小、来源类型、评分、创建时间 |
| T-DETAIL-02: 任务队列最近结果查看详情 | 1. 导航到 /tasks<br>2. 在最近完成结果区域右键图片<br>3. 点击"查看详情" | 弹出相同的 MediaDetailDialog |
| T-DETAIL-03: 工作区查看详情 | 1. 导航到 /workspace<br>2. 右键工作区图片<br>3. 点击"查看详情" | 弹出相同的 MediaDetailDialog |
| T-DETAIL-04: 长文本截断与复制 | 1. 打开含长路径媒体的详情弹窗<br>2. 验证文件名、目录路径等长字段单行截断显示<br>3. 鼠标悬停截断字段，验证 title 显示完整内容<br>4. 点击复制按钮，验证图标变为 ✓ | 长文本截断展示，复制功能正常，1.5 秒后图标恢复 |
| T-DETAIL-05: 弹窗内滚轮不导航 | 1. 在 LightBox 中打开媒体详情弹窗<br>2. 在弹窗内滚动鼠标滚轮 | 滚轮不触发 LightBox 垂直轴导航，弹窗内容正常滚动 |

---

## 10. 统一右键菜单测试 (T-CTX-01 ~ 02)

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-CTX-01: 任务队列最近结果右键菜单 | 1. 导航到 /tasks<br>2. 右键最近完成结果区域的缩略图 | 弹出完整右键菜单（AI 功能、加入工作区、移动到图集、资源管理器、评分、查看详情、删除），与图集详情页菜单一致 |
| T-CTX-02: 工作区右键菜单与 LightBox | 1. 导航到 /workspace<br>2. 右键工作区图片，验证完整右键菜单<br>3. 点击图片，验证进入 LightBox 大图浏览 | 右键菜单完整，点击可打开 LightBox |
| T-CTX-03: 右键菜单开启多选 | 1. 在图集详情或人物主页未分类区右键点击媒体卡片<br>2. 点击"开启多选"<br>3. 验证进入多选模式且当前卡片自动选中 | 多选模式开启，右键点击的卡片显示选中标记，底部出现选择工具栏 |
| T-CTX-04: 移动端子菜单定位 | 1. 使用移动端（<640px 宽度）<br>2. 在屏幕边缘位置长按呼出右键菜单<br>3. 展开含子菜单的项（如 AI 功能） | 子菜单使用 fixed 定位，不被父容器裁切，完整显示在视口内并保持 8px 边距 |

---

## 11. 任务队列布局测试 (T-TQL-01 ~ 14)

**PRD**: §5.8 "任务队列页布局"

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-TQL-01: 桌面端双栏布局 | 1. 桌面端导航到 /tasks<br>2. 验证页面布局 | 左栏显示任务列表（按状态分组），右栏显示最近完成结果（sticky 侧边栏，3 列网格，最多 50 个任务的结果） |
| T-TQL-02: 移动端单栏布局 | 1. 移动端或窄屏导航到 /tasks<br>2. 验证页面布局 | 单栏布局，最近完成结果内嵌于失败和已完成区域之间（4 列网格，默认 2 行折叠） |
| T-TQL-03: 已完成任务排序 | 1. 有多个已完成任务<br>2. 导航到 /tasks | 已完成/失败任务按 finished_at 降序排列（最新完成的排在最前） |
| T-TQL-04: 最近结果展开/收起 | 1. 最近完成结果区域默认折叠显示有限行数<br>2. 点击展开按钮 | 展开显示全部结果缩略图，再次点击可收起 |
| T-TQL-05: 桌面端侧边栏滚动 | 1. 桌面端有大量已完成结果（>18 张）<br>2. 展开最近结果<br>3. 在右栏区域滚动鼠标滚轮 | 右栏内容可独立滚动，不超出视口高度 |
| T-TQL-06: 批量任务分组显示 | 1. 通过 POST /api/tasks/batch 创建多个任务（共享 batch_id）<br>2. 导航到 /tasks | pending 区域显示折叠的分组卡片，带 Layers 图标和任务数量 |
| T-TQL-07: 批量任务分组展开/收起 | 1. 有 batch_id 分组的 pending 任务<br>2. 点击分组卡片 | 展开显示组内各任务，再次点击收起 |
| T-TQL-08: 批量任务非 pending 不分组 | 1. batch 任务中部分已完成/失败<br>2. 导航到 /tasks | 已完成/失败区域的任务正常显示，不按 batch_id 折叠 |
| T-TQL-09: 暂停/恢复队列 | 1. 导航到 /tasks<br>2. 点击暂停按钮<br>3. 验证按钮变为 amber 色<br>4. 再次点击恢复 | 暂停时按钮 amber 色，恢复后颜色复原，调用 PUT /api/queue/config 设置 is_paused |
| T-TQL-10: 清空未完成任务 | 1. 有 pending + failed + cancelled 任务<br>2. 点击"清空未完成"按钮 | 所有 pending/failed/cancelled 任务被删除，running 和 completed 任务保留，调用 POST /api/tasks/bulk-delete |
| T-TQL-11: 运行中区域折叠 | 1. 有 3 个以上 running 任务<br>2. 导航到 /tasks | 运行中区域可折叠，折叠后仅显示 1 个任务 + 剩余数量提示 |
| T-TQL-12: 移动端按钮图标模式 | 1. 移动端（<640px）导航到 /tasks<br>2. 检查页头按钮 | 按钮为 32px 正方形图标，无文字标签 |
| T-TQL-13: batch_id 字段返回 | 1. POST /api/tasks/batch 创建批量任务<br>2. GET /api/tasks 获取任务列表 | 每个任务的 API 响应包含 batch_id 字段 |
| T-TQL-14: bulk-delete API | 1. POST /api/tasks/bulk-delete，body: {statuses: ["pending", "failed"]}<br>2. GET /api/tasks 验证 | 返回 {deleted: N}，对应状态的任务全部删除，其他状态不受影响 |

---

## 12. LightBox 键盘行为变更测试 (T-LBKB-01 ~ 03)

**PRD**: §5.5 "键盘快捷键"、§5.5.2 "放大模式"

| 用例 | 步骤 | 预期 |
|------|------|------|
| T-LBKB-01: input 内方向键不拦截 | 1. 打开 LightBox<br>2. 焦点聚焦到 input 元素（如评分输入）<br>3. 按 ← → ↑ ↓ | 方向键行为为 input 默认行为，不触发图片导航 |
| T-LBKB-02: 放大模式下方向键导航 | 1. 打开 LightBox 并进入放大模式（单击图片）<br>2. 按 → 键 | 切换到下一张图片，保持缩放比例不变（不先退出放大模式） |
| T-LBKB-03: 垂直轴根节点向上 | 1. 打开有生成链的本地图 LightBox，停留在根节点<br>2. 按 ↑ 键 | 切换到上一张本地图（等同水平轴 ←），而非无反应 |

## 13. 标签系统测试 (T-TAG-01 ~ 12)

### 13.1 后端 API

```
T-TAG-01: Tag CRUD
  PRD 需求: 标签管理
  步骤:
    1. POST /api/tags 创建标签 "角色A"
    2. GET /api/tags 列出标签，验证含 person_count/album_count 字段
    3. PATCH /api/tags/:id 重命名为 "角色B"
    4. DELETE /api/tags/:id 删除标签
  预期: 创建/列出/重命名/删除均正常，列表含关联计数

T-TAG-02: Tag 合并
  PRD 需求: 标签合并
  步骤:
    1. 创建标签 A 和标签 B
    2. 将人物 1 关联标签 A，人物 2 关联标签 B
    3. POST /api/tags/:targetId/merge 将 B 合并到 A
    4. 验证人物 2 现在关联标签 A，标签 B 已删除
  预期: 关联转移到目标标签，源标签删除

T-TAG-03: Tag 排序
  PRD 需求: 标签排序
  步骤:
    1. 创建标签 A、B、C
    2. PUT /api/tags/reorder 设置顺序 [C, A, B]
    3. GET /api/tags 验证返回顺序
  预期: 标签按指定顺序返回

T-TAG-04: Person tag 过滤
  PRD 需求: 标签筛选
  步骤:
    1. 创建标签 X，关联人物 1 和 2
    2. 创建标签 Y，关联人物 2 和 3
    3. GET /api/persons?tag_ids=X → 返回人物 1, 2
    4. GET /api/persons?tag_ids=X,Y → 返回人物 2（交集）
  预期: 单标签过滤和多标签交集过滤均正确

T-TAG-05: Album tag 过滤
  PRD 需求: 标签筛选
  步骤:
    1. 创建标签，关联若干图集
    2. GET /api/albums?tag_ids=xxx → 验证过滤结果
  预期: 图集标签过滤正确

T-TAG-06: Person/Album patch tag_ids
  PRD 需求: 标签关联
  步骤:
    1. PATCH /api/persons/:id 设置 tag_ids=[A, B]
    2. 验证人物关联标签 A 和 B
    3. PATCH /api/persons/:id 设置 tag_ids=[B] → 验证全量替换（A 移除）
    4. 同样测试 PATCH /api/albums/:id 的 tag_ids
  预期: tag_ids 全量替换，非增量
```

### 13.2 前端 E2E

```
T-TAG-07: 标签芯片筛选
  PRD 需求: 人物库标签筛选
  步骤:
    1. 导航到人物库
    2. 验证 FilterBar 显示标签芯片
    3. 点击标签芯片筛选
    4. 验证人物列表仅显示关联该标签的人物
    5. screenshot('tag-filter-chip')
  预期: 点击标签芯片后人物列表正确过滤
  文件: tag-system.test.ts

T-TAG-08: PersonCard 标签管理
  PRD 需求: 右键菜单标签管理
  步骤:
    1. 右键点击人物卡片
    2. 验证菜单中有"管理标签"子菜单
    3. 展开子菜单，勾选一个标签
    4. 再次右键，验证该标签已勾选
    5. 取消勾选，验证标签移除
    6. screenshot('person-card-tag-menu')
  预期: 右键菜单可勾选/取消标签，状态正确持久化
  文件: tag-system.test.ts

T-TAG-09: PersonHome 标签展示
  PRD 需求: 人物主页标签显示
  步骤:
    1. 进入已关联标签的人物主页
    2. 验证人物信息区显示标签芯片
    3. 点击编辑标签，验证标签管理弹窗/交互
    4. screenshot('person-home-tags')
  预期: 人物主页正确显示标签，可编辑
  文件: tag-system.test.ts

T-TAG-10: AlbumCard 标签管理
  PRD 需求: 右键菜单标签管理
  步骤:
    1. 进入人物主页图集区
    2. 右键点击图集卡片
    3. 验证菜单中有"管理标签"子菜单
    4. 勾选/取消标签，验证操作生效
    5. screenshot('album-card-tag-menu')
  预期: 图集卡片右键菜单标签管理正常
  文件: tag-system.test.ts

T-TAG-11: 设置页标签管理
  PRD 需求: 设置页标签管理 tab
  步骤:
    1. 导航到设置页 → 标签 tab
    2. 新建标签，验证列表更新
    3. 重命名标签，验证名称变更
    4. 合并两个标签，验证合并结果
    5. 删除标签，验证列表移除
    6. screenshot('settings-tag-management')
  预期: 设置页可完整管理标签生命周期
  文件: tag-system.test.ts

T-TAG-12: 未分类区标题一致性
  PRD 需求: 未分类区域命名
  步骤:
    1. 进入人物主页，验证未分类区标题为"未分类"
    2. 导航到 MediaLibrary 未分类区，验证标题为"未分类"
    3. screenshot('uncategorized-title')
  预期: 所有页面未分类区标题统一为"未分类"
  文件: tag-system.test.ts
```

## 14. 裁剪与剪辑测试 (T-CROP-01 ~ 06, T-TRIM-01 ~ 04)

### 14.1 图片裁剪

```
T-CROP-01: 图片裁剪完整流程（保存为新图）
  PRD 需求: §7.5 "CropEditor 弹窗"
  步骤:
    1. 图片右键 → "裁剪"
    2. CropEditor 弹窗打开，验证预览画布和裁剪框显示
    3. 拖拽裁剪框调整区域
    4. 确认"覆盖原图"复选框未勾选（默认）
    5. 点击"确认裁剪"
    6. 验证 toast 成功提示
    7. 验证生成链中新增裁剪结果（parent_media_id 指向原图）
    8. screenshot('crop-new-image')
  预期: 裁剪保存为新媒体，原图保持不变
  文件: crop-trim.test.ts

T-CROP-02: 图片裁剪覆盖原图
  PRD 需求: §7.5
  步骤:
    1. 图片右键 → "裁剪"
    2. 勾选"覆盖原图"
    3. 确认裁剪
    4. 验证原文件被替换（分辨率变化）
    5. screenshot('crop-overwrite')
  预期: 覆盖模式下原文件被替换，不创建新媒体

T-CROP-03: 宽高比预设
  PRD 需求: §7.5 "宽高比预设按钮"
  步骤:
    1. 打开 CropEditor
    2. 依次点击预设按钮：1:1、4:3、16:9
    3. 验证裁剪框比例相应变化
    4. 点击"自由"恢复自由裁剪
    5. screenshot('crop-aspect-presets')
  预期: 预设按钮正确约束裁剪框比例

T-CROP-04: 旋转功能
  PRD 需求: §7.5 "旋转"
  步骤:
    1. 打开 CropEditor
    2. 点击顺时针旋转按钮
    3. 验证预览图旋转 90°
    4. 点击逆时针旋转按钮
    5. 验证预览图恢复原始方向
    6. screenshot('crop-rotate')
  预期: 旋转按钮正确旋转预览图

T-CROP-05: LightBox 入口裁剪
  PRD 需求: §7.5 "LightBox 右键菜单"
  步骤:
    1. 进入 LightBox 大图模式
    2. 右键 → "裁剪"
    3. 验证 CropEditor 打开
    4. 完成裁剪
    5. 验证结果正确
  预期: LightBox 右键菜单裁剪入口正常

T-CROP-06: 工作流临时裁剪
  PRD 需求: §7.5 "工作流临时裁剪"
  步骤:
    1. 图片右键 → AI 功能 → 高清放大
    2. WorkflowRunDialog 打开，验证源图预览区有裁剪按钮
    3. 点击裁剪按钮 → CropEditor 打开（无覆盖选项）
    4. 裁剪后确认
    5. 验证返回 Dialog，源图预览更新为裁剪后的图
    6. screenshot('workflow-temp-crop')
  预期: 临时裁剪不影响原图，工作流使用裁剪后的图提交
  文件: crop-trim.test.ts
```

### 14.2 视频剪辑

```
T-TRIM-01: 视频剪辑完整流程
  PRD 需求: §7.5 "VideoTrimEditor 弹窗"
  步骤:
    1. 视频右键 → "剪辑"
    2. VideoTrimEditor 弹窗打开
    3. 验证视频预览 + 时间轴显示
    4. 拖拽时间轴设置起止点
    5. 验证精确模式开关默认关闭
    6. 点击确认
    7. 验证 toast 成功提示
    8. 验证生成链中新增剪辑结果
    9. screenshot('trim-video')
  预期: 剪辑结果保存为新媒体，parent_media_id 指向原视频
  文件: crop-trim.test.ts

T-TRIM-02: 精确模式剪辑
  PRD 需求: §7.5 "精确模式开关"
  步骤:
    1. 视频右键 → "剪辑"
    2. 开启精确模式
    3. 设置起止时间
    4. 确认剪辑
    5. 验证结果视频时长与设定一致（帧级精确）
  预期: 精确模式使用 re-encode，时间点精确

T-TRIM-03: 手动输入时间
  PRD 需求: §7.5 "起始/结束时间输入框"
  步骤:
    1. 打开 VideoTrimEditor
    2. 手动输入起始时间和结束时间
    3. 验证时间轴选区同步更新
    4. 确认剪辑
  预期: 手动输入时间与时间轴拖拽联动

T-TRIM-04: 右键菜单条件显示
  PRD 需求: §7.5 "仅 image/仅 video"
  步骤:
    1. 图片右键 → 验证有"裁剪"菜单项，无"剪辑"
    2. 视频右键 → 验证有"剪辑"菜单项，无"裁剪"
    3. screenshot('crop-trim-menu-visibility')
  预期: 裁剪仅对图片显示，剪辑仅对视频显示
  文件: crop-trim.test.ts
```

---

*测试计划版本：v2.1 | 基于 PRD v1.8 | 2026-03-15*
