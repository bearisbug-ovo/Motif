# AI 任务队列与工作流

> 涉及代码：`backend/routers/tasks.py, workflows.py` | `backend/queue_runner.py` | `backend/comfyui/` | `backend/models/task.py, workflow.py` | `frontend/src/pages/TaskQueue.tsx, Tools.tsx, Workflows.tsx` | `frontend/src/stores/task.ts, workflow.ts` | `frontend/src/components/MaskEditor.tsx, WorkflowRunDialog.tsx, WorkflowParamForm.tsx`

---

## 需求摘要

### 任务队列页 [P1]

**布局：**

- *桌面端（md+）：* 双栏布局
  - 左栏：页头（暂停/恢复按钮 + 清空未完成按钮 + 队列启动模式配置） + 任务列表（按状态分组）
  - 右栏：最近完成结果（sticky 侧边栏，3 列网格，默认折叠 6 行，可展开）
- *移动端：* 单栏布局
  - 页头：按钮为图标模式（32px 正方形，无文字），sm+ 显示完整文字。内容区内边距响应式
  - 任务列表中，最近完成结果内嵌于"失败"和"已完成"区域之间（4 列网格，默认折叠 2 行，可展开/收起）
- *排序：* 已完成/失败任务按 `finished_at` 降序排列（最新完成的排在最前）

**页头按钮：**
- **暂停/恢复队列**：调用 `PUT /api/queue/config` 设置 `is_paused` 字段。暂停时按钮显示为琥珀色（amber），队列暂停后不会自动取下一个任务执行
- **清空未完成**：一键删除所有 pending + failed + cancelled 状态的任务，调用 `POST /api/tasks/bulk-delete`，返回删除数量

**队列启动模式（4 种，与 QueueConfig.start_mode 一一对应）：**
- **手动启动**（`manual`）：点击"开始执行"按钮触发
- **自动启动**（`auto`）：有待执行任务即自动开始
- **Cron 定时**（`cron`）：配置 Cron 表达式（如 `0 23 * * *` 表示每天 23:00）
- **延时启动**（`delay`）：配置 X 分钟后启动（从最后一个任务加入队列时刻起算）

**任务卡片显示：**
- 工作流类型、输入图预览、关键参数摘要
- 状态：待执行 / 执行中（实时进度条 + value/max 文字）/ 已完成 / 失败（显示错误原因）
- 执行时间
- 进度信息：通过 `GET /api/tasks/stats` 返回的 `progress` 字段（`{task_id, value, max}`）驱动，3秒轮询更新

**右键菜单（按状态动态显示）：**
- **所有状态**：查看详情（弹出任务详情对话框）
- **所有非 running 状态**（仅 custom 工作流）：编辑参数并新建（打开 WorkflowRunDialog，预填该任务的工作流和参数，用户编辑后作为新任务提交）
- **pending**：取消、删除
- **running**：取消
- **completed**：重新执行、查看结果（在 LightBox 中打开结果图）、删除
- **failed/cancelled**：重试（创建新任务，保留原任务历史）、删除

**任务详情对话框：**
- 显示任务类型、状态、创建/开始/完成时间、耗时
- 参数列表（键值对），媒体 ID 参数解析为缩略图预览 + 路径
- 错误信息（failed 时）
- 输出参数（`result_outputs`，非图片输出如反推提示词等文本/数值结果）
- 结果媒体列表（缩略图 + 路径）
- 通过 `POST /api/media/by-ids` 批量获取关联媒体信息

**最近完成结果视图（RecentResultsGrid 组件）：**
- 收集最近 50 个已完成任务的 `result_media_ids`，按 `finished_at` 降序排列，批量获取 MediaItem（`getByIds` 结果按请求顺序重排）
- 桌面端：右栏 sticky 侧边栏，3 列网格，默认折叠显示 6 行；侧边栏高度限制为视口高度，展开后超出部分可滚动
- 移动端：内嵌于"失败"和"已完成"任务区之间，4 列网格，默认折叠 2 行，支持展开/收起
- 点击进入 LightBox 大图模式（`taskResultsMode`：禁用生成链 UI，改为源图导航按钮）
- 右键菜单与图片卡片一致（AI 功能、加入工作区、移动到图集、资源管理器、评分、查看详情、删除），但隐藏"生成链"和"脱离生成链"菜单项
- **源图导航按钮**（替代生成链指示器，浮于媒体区底部中央）：
  - 「查看源图 / 返回结果」：切换显示当前结果图的源图（`parent_media_id`），查看源图时按钮高亮蓝色，左右导航时自动退出源图查看
  - 「在图集中查看」：关闭当前 LightBox，以源图所在的图集/人物上下文重新打开（支持完整双轴导航）

**批量任务分组（Batch Grouping）：**
- 通过 `POST /api/tasks/batch` 创建的任务共享同一 `batch_id`（UUID）
- 在待执行（pending）区域，同一 `batch_id` 的任务折叠为一张分组卡片，显示 Layers 图标 + 任务数量
- 点击分组卡片展开显示组内各个任务，再次点击收起
- 非 pending 状态的任务不分组，正常显示

**运行中区域折叠：**
- 当运行中的任务超过 2 个时，运行中区域可折叠，折叠后仅显示 1 个任务 + 剩余数量提示

**任务操作：**
- 重新启动（适用于 `failed`/`cancelled`/`completed` 任务，创建新任务而非重置原任务，保留历史记录）
- 删除任务
- 批量删除未完成任务（页头"清空未完成"按钮）

**任务失败处理：** 失败后自动跳过，继续执行下一个任务，任务标记为 `failed`，需手动重启

**链式任务（Task Chaining）：** 允许用户将两个工作流步骤串联执行（如图生图 → 高清放大），原子性地按顺序完成：
- **创建方式：** WorkflowRunDialog 中点击"链接下一步"按钮，选择第二步的工作流类别、具体工作流及参数
- **执行机制：** 同一 `chain_id` 的步骤按 `chain_order` 顺序原子执行，不允许其他任务插入中间；第二步通过 `chain_source_param` 自动接收第一步的输出结果
- **成功处理：** 所有步骤都成功时，最终结果 reparent 到原始源图（即第一步的输入），中间步骤的结果图软删除
- **失败处理：** 若第二步失败，第一步的结果保留为正常生成图，不执行回滚
- **取消行为：** 取消链中任一步骤时，后续步骤级联取消
- **重试行为：** 重试 `chain_order=0` 的步骤会重建整条链；重试 `chain_order>0` 的步骤时，若存在失败/取消的前置步骤则重建整条链，否则创建独立任务
- **卡片显示：** TaskCard 显示 Link2 链式徽标 + 链信息行（格式：`1. 图生图 → 2. 高清放大`，仅步骤号 + 类别标签，不含工作流名称和状态），链内子任务在队列中视觉缩进

**添加任务时：** 弹出选择"立即执行"或"加入队列"

**导航角标（优先级从高到低，仅显示最高优先级的一个）：**
- 运行中：旋转动画（蓝色 Loader）
- 待开始：蓝色数字角标（pending 数量）
- 失败：红色数字角标，归零需手动清除失败任务
- 完成：绿色数字角标，进入任务队列页后清零

### 蒙版编辑器 [P1]

**定位：** 纯遮罩绘制工具，不包含任务提交逻辑。由 WorkflowRunDialog 按需调用。

**触发：** WorkflowRunDialog 中 inpaint 类工作流的 mask 参数点击"绘制遮罩"按钮

**布局：**
```
┌─────────────────────────────────────────────────┐
│ [返回] [画笔] [橡皮] [撤销] [重做] [清除]  画笔大小━━●━━  │ ← 顶部工具栏
├─────────────────────────────────────────────────┤
│                                                 │
│              画布区域                            │
│        （滚轮缩放，以指针为中心）                  │
│        （绿色半透明覆盖表示蒙版区域）               │
│        （画笔绘制蒙版，橡皮擦擦除）                 │
│                                                 │
├─────────────────────────────────────────────────┤
│                                      [取消] [确认遮罩] │
└─────────────────────────────────────────────────┘
```

**画布交互：**
- 滚轮：缩放画布（以指针为中心），不触发放大镜模式
- 左键拖拽：绘制蒙版（绿色半透明覆盖）
- 橡皮擦模式下左键拖拽：擦除蒙版
- 支持触屏绘制（手机端）

**手机端画布交互：**
- 单指拖拽：绘制蒙版（同 PC 左键拖拽）
- 双指缩放：缩放画布
- 画笔大小：通过顶部滑块调节（手机端滑块加大触控区域）
- 橡皮擦切换：顶部工具栏按钮（非长按手势，避免与绘制冲突）

**底部操作：** 取消 / 确认遮罩（返回 mask blob 给 WorkflowRunDialog，由 Dialog 负责上传和任务提交）

**返回逻辑：** 点击"取消"或"返回"关闭蒙版编辑器，返回 WorkflowRunDialog

### 工作流页面 [P4]

独立页面（路由 `/workflows`），侧边栏入口图标 Zap。顶部 Tab 切换：「运行」|「管理」。

**运行 Tab**：允许用户选择已注册的工作流并直接运行（原小工具页 AI 工具 Tab 的功能）。
- 工作流选择器（下拉，按 category 分组显示）
- 显示工作流描述
- 使用共享 `WorkflowParamForm` 组件渲染参数表单（与 WorkflowRunDialog 完全一致）
- [运行] 按钮 → 创建 Task（immediate 模式）

**默认工作流自动导入**：后端启动时按 name 逐个检查内置模板，自动导入缺失的默认工作流（已存在同名工作流则跳过）。新增模板无需用户手动操作，下次启动即自动可用。每个 category 首个导入的工作流自动标记为默认。

**管理 Tab 内容：**
- Category 过滤按钮栏（全部 / 换脸 / 局部重绘 / 高清放大 / 文生图 / 图生图 / 预处理）
- 选择具体类别时显示该类别的参考卡片（功能说明、用法指引、参数约定表格），选「全部」时不显示卡片
- 工作流卡片列表：名称、描述、默认标记、[设为默认][删除] 按钮，点击卡片打开详情对话框，右键菜单含「编辑配置」
- 工作流详情对话框：显示参数列表，允许编辑各参数的默认值并保存回工作流记录；头部含「编辑配置」按钮
- [+ 导入工作流] 按钮 → 打开导入对话框

**工作流编辑模式：**
- 「编辑配置」入口：工作流卡片右键菜单、详情对话框头部按钮
- 复用 `WorkflowImportDialog` 组件，通过 `editWorkflow` prop 传入已有工作流数据
- 编辑模式直接进入配置步骤（跳过上传步骤），预填所有字段
- 提交时调用 `PUT /api/workflows/:id` 更新

**导入对话框三步流程：**
1. **上传**：拖拽/选择 ComfyUI API JSON 文件 → 解析 `@` 前缀节点
2. **配置**：填写名称/类别/描述，将 Category 契约参数映射到解析出的节点参数（必填参数未映射时禁用提交）。选择类别后自动匹配：节点的 `@` 标签名包含契约参数名即视为匹配（如 `@my_prompt` 匹配参数 `prompt`），无需完全相等
3. **提交**：注册工作流，重名时提示是否覆盖

**`@` 前缀约定：**
- 工作流 JSON 中 `_meta.title` 以 `@` 开头的节点才会被解析
- `@` 标记的 LoadImage → 图片输入
- `@` 标记的 SaveImage/PreviewImage/ImageAndMaskPreview 等图像输出类节点 → 输出节点
- 其他 `@` 节点 → 进入「自定义参数分配」列表

**自定义参数分配：**

| 节点类型 | 可用角色 | 说明 |
|----------|----------|------|
| LoadImage（未映射） | 不使用 / 输入 | 设为「输入」后展开图片输入配置：类型切换（图片 / 遮罩）+ 标签编辑 |
| 其他节点 | 不使用 / 输入 / 输出 / 输入+输出 | 「输入」展开标量参数列表，「输出」展开输出标签编辑框 |

**Manifest 格式：**
```json
{
  "mappings": { "param_name": { "node_id": "1", "key": "image", "type": "image" } },
  "output_mappings": { "反推提示词": { "node_id": "15", "key": "text" } },
  "extra_params": [
    { "name": "prompt.text", "label": "text", "type": "string", "node_id": "10", "key": "text" },
    { "name": "ref_image", "label": "参考图", "type": "image", "node_id": "5", "key": "image" },
    { "name": "mask_image", "label": "遮罩", "type": "image", "node_id": "6", "key": "image", "source": "file_path" },
    { "name": "model.model", "label": "模型", "type": "string", "node_id": "27", "key": "model", "choices": ["model_a.safetensors", "model_b.safetensors"] }
  ]
}
```
- `output_mappings` 中外层 key 为显示标签，内层 `key` 固定为 ComfyUI 输出字段名（通常 `text`）
- `extra_params` 中标量参数的 `name` 格式为 `节点名.参数键`，`label` 为显示名称，`type` 为参数类型（string/int/float/bool/image）
- `extra_params` 中 `choices` 字段（可选）：combo/dropdown 类型时，导入阶段自动从 `/object_info` 获取可选值列表并存入 manifest，运行时渲染为 `<Select>` 下拉框
- image 类型的 `extra_params` 不从 workflow_json 提取默认值

**复合工作流：**
- 将多个子工作流组合为一个独立条目，运行时自动展开为链式任务序列
- 创建方式：工作流管理页 → 「创建复合工作流」按钮
- 步骤数量：2-5步，嵌套展开后总步数不超过 10
- 嵌套支持：复合工作流的步骤可以引用其他复合工作流，运行时递归展开
- 循环引用检测：DFS 检测，防止 A→B→A 死循环
- category：取首步工作流的 category（递归到叶子层）

---

## 数据模型

### Task（任务）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| workflow_type | enum | 工作流类型 |
| params | JSON | 工作流参数（含输入图路径） |
| status | enum | `pending` / `running` / `completed` / `failed` / `cancelled` |
| queue_order | int | 队列排序，支持拖拽调整 |
| created_at | datetime | 创建时间 |
| started_at | datetime? | 开始时间 |
| finished_at | datetime? | 完成/失败/取消时间 |
| error_message | string? | 失败原因 |
| result_media_ids | JSON? | 生成结果的 Media ID 列表 |
| result_outputs | JSON? | 输出结果，包含文本输出（如反推提示词）和图片输出（`{"type": "image", "path": "..."}`），格式 `{"key": value}` |
| execution_mode | enum | `immediate`（立即执行）/ `queued`（加入队列） |
| chain_id | UUID? | 链式任务组 ID，同一链的所有步骤共享此 ID |
| chain_order | int? | 链内步骤序号（0 = 第一步，1 = 第二步…） |
| chain_source_param | string? | 接收上一步结果的参数名（如 `source_media_id`），第一步为 null |
| batch_id | String? (indexed) | 批量任务分组 ID，由 POST /tasks/batch 设置 |

### QueueConfig（队列配置，全局单例）

| 字段 | 类型 | 说明 |
|------|------|------|
| start_mode | enum | `manual`（手动）/ `auto`（自动）/ `cron`（Cron 定时）/ `delay`（延时） |
| cron_expression | string? | Cron 表达式（仅 `cron` 模式生效，如 `0 23 * * *`） |
| delay_minutes | int? | 延时分钟数（仅 `delay` 模式生效） |
| is_paused | bool | 队列暂停标记（暂停后不执行新任务，已运行任务不受影响） |
| updated_at | datetime | 更新时间 |

**字段互斥规则：**
- `manual`：忽略 cron_expression 和 delay_minutes
- `auto`：忽略 cron_expression 和 delay_minutes
- `cron`：cron_expression 必填，忽略 delay_minutes
- `delay`：delay_minutes 必填，忽略 cron_expression

**delay 模式行为：**
- 收到新任务后开始 debounce 计时（默认 5 分钟）
- 计时期间如有新任务加入，重置计时器
- 计时期间如收到手动启动信号（立即执行），立即开始处理
- 使用 1 秒轮询循环实现，不阻塞队列运行器

### Workflow（工作流）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String(36) PK | UUID |
| name | String(200) | 工作流名称，全局唯一 |
| category | String(50) | 类别：face_swap / inpaint / upscale / text_to_image / image_to_image / preprocess |
| description | Text? | 描述 |
| is_default | Boolean | 是否为该 category 的默认工作流 |
| workflow_json | Text | ComfyUI API 格式 JSON |
| manifest | Text | 参数映射 JSON：`{"mappings": {...}, "output_mappings"?: {...}, "extra_params"?: [...]}` |
| is_composite | Boolean | 是否为复合工作流（default=false） |
| composite_steps | Text/JSON | 复合工作流步骤定义（nullable） |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |

**manifest.output_mappings**：外层 key 为显示标签（任务详情中展示），内层 key 固定为 ComfyUI 输出字段名（通常 `text`）。

**composite_steps 格式：**
```json
[{"workflow_id": "...", "params_override": {...}, "source_param": "..."}]
```

---

## API 端点

### 任务队列 `/api/tasks`

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
| POST | `/bulk-delete` | 批量删除任务 | Body: `{statuses: ["pending", "failed", "cancelled"]}` → `{deleted: number}` |
| POST | `/batch` | 批量 AI 任务 | Body: `{workflow_type, media_ids?, album_id?, source_param_name, shared_params, target_person_id?, chain_step?}` → `{tasks_created, chains_created, skipped_generated, batch_id}` |
| POST | `/chain` | 创建链式任务 | Body: `{first: TaskCreate, then: [{workflow_type, params, chain_source_param}], execution_mode}` → 返回链内所有任务 |

**批量任务字段：**
- 请求新增：`chain_step: Optional[ChainStepCreate]` — 为每张图附加链式下一步
- 响应新增：`chains_created`（链式组数量）、`skipped_generated`（跳过的 AI 生成图数量）
- 仅处理本地图/截图，跳过 AI 生成图。结果逐张加入原图生成链，不创建结果图集

**链式任务行为：**
- 取消链中任一步骤 → 后续步骤级联取消
- 重试 `chain_order=0` → 重建整条链（新 chain_id）
- 重试 `chain_order>0` → 若存在失败/取消的前置步骤则重建整条链（重置 `__chain_input__` 占位符），否则创建独立任务（无 chain_id）
- `PATCH /reorder` 校验同一 chain 内的相对顺序不被打乱

### 队列控制 `/api/queue`

| Method | 路径 | 说明 |
|---|---|---|
| POST | `/start` | 手动触发执行 |
| GET | `/config` | 获取队列配置 |
| PUT | `/config` | 更新队列配置（start_mode, cron_expression, delay_minutes, is_paused） |

### 工作流管理 `/api/workflows` + `/api/workflow-categories`

| Method | 端点 | 说明 |
|---|---|---|
| GET | `/api/workflow-categories` | 返回 category 契约列表（face_swap/inpaint/upscale/text_to_image/image_to_image/preprocess） |
| POST | `/api/workflows/parse` | 解析 ComfyUI API JSON，返回 @-标记节点的图片输入/标量参数/图片输出/文本输出。前端自动映射时使用包含匹配 |
| GET | `/api/workflows?category=xxx` | 列出工作流（可按 category 过滤） |
| GET | `/api/workflows/:id` | 获取完整工作流（含 workflow_json 和 manifest） |
| POST | `/api/workflows` | 注册新工作流（Body: name, category, workflow_json, manifest, description?, is_default?, overwrite_id?）；manifest 校验失败 → 422，重名 → 409 |
| PUT | `/api/workflows/:id` | 更新工作流（name?, description?, workflow_json?, manifest?） |
| DELETE | `/api/workflows/:id` | 删除工作流 |
| PATCH | `/api/workflows/:id/default` | 设为该 category 的默认工作流 |
| POST | `/api/workflows/composite` | 创建复合工作流（Body: name, description?, steps[]）；验证至少 2 步、展开后不超过 10 步、DFS 循环引用检测 |

---

## 任务队列系统设计

### 执行流程

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

### 链式任务执行

当 `_execute_next_task()` 取到的任务有 `chain_id` 且 `chain_order=0` 时，进入链式执行模式：

1. 执行第一步，完成后将 `result_media_ids[0]` 写入第二步的 `params[chain_source_param]`
2. 立即执行第二步（不重新入队，不允许其他任务插入）
3. 全部成功：最终结果 reparent 到第一步的原始源图（`parent_media_id` 指向原始输入），中间结果软删除
4. 第二步失败：第一步结果保留为正常生成图，不回滚

**自定义工作流输出兼容：** 自定义工作流的图片输出有两种路径：标准 SaveImage 节点（`client.run_workflow()` 返回的 `results`）和 `output_mappings` 捕获的 PreviewImage 节点。当 SaveImage 无输出但 `output_mappings` 产出了图片时，`_run_custom_workflow` 会自动将这些图片从预览缓存提升为正式 Media 记录（移动到 `generated/<category>/` 目录），确保 `result_media_ids` 非空，链式后续步骤能正确获取前置输出。

**独立任务校验：** `POST /api/tasks` 创建独立任务时，如果 `params` 中包含未解析的链式占位符 `__chain_input__`，直接返回 400 错误，防止无效任务进入队列。

### 启动恢复

服务重启时，`main.py` startup 事件自动将所有遗留的 `running` 状态任务标记为 `failed`（错误信息："服务重启时任务仍在执行，已标记为失败（可重试）"），防止僵尸任务阻塞队列。

### 四种启动模式

| 模式 | 行为 |
|---|---|
| `manual` | 等待 `POST /api/queue/start` 信号 |
| `auto` | 有 pending 任务即自动执行 |
| `delay` | 最后一个任务加入后延迟 N 分钟执行 |
| `cron` | 按 cron 表达式定时检查（当前简化为 60s 轮询） |

### 安全机制

- 磁盘空间检查：< 500MB 拒绝执行
- 任务超时：默认 10 分钟（可配置）
- 失败跳过：标记 `failed`，继续下一任务

### workflow_type 枚举

| 类型 | 说明 | 参数 |
|---|---|---|
| `upscale` | 高清放大（内置 Qwen3-VL 自动反推提示词） | source_media_id, upscale_factor, denoise, model |
| `face_swap` | 换脸 | source_media_id, face_ref_media_id, result_album_id?, target_person_id? |
| `inpaint_flux` | Flux 局部修复（带提示词） | source_media_id, mask_path, prompt, denoise, enable_rear_lora? |
| `inpaint_sdxl` | SDXL 局部修复 | source_media_id, mask_path, denoise |
| `inpaint_klein` | Klein 局部修复 | source_media_id, mask_path |

### ComfyUI 集成

- 通过 `/prompt` 接口提交工作流 JSON
- 通过 WebSocket 实时监听任务进度（`/ws?clientId=...`），收到 `execution_success` / `execution_error` 后获取结果
- **WebSocket 健壮性：** 启用 heartbeat（30 秒 ping），空闲超时 120 秒（无消息则判定 ComfyUI 卡死，立即报错而非等到任务超时）；WebSocket 异常断开时抛出明确错误
- 工作流 JSON 模板存储在 `AppData/workflows/` 目录下
- 参数占位符格式：`{{param_name}}`
- 后端在提交前将占位符替换为实际参数值
- 任务严格串行，一次只向 ComfyUI 提交一个任务

---

## 前端行为

### TaskQueue 页面

- Store：`task`，职责：任务 + 3 秒轮询，`fetchTasks, fetchStats, startPolling, stopPolling`
- `fetchStats` 检测 `completed_since_last_view` 递增时自动调用 `lightboxStore.invalidateChainCache()`
- 导航角标轮询：3 秒间隔轮询 `/api/tasks/stats`，驱动侧边栏角标和进度条

### Workflows 页面

- Store：`workflow`（`useWorkflowStore`），状态：categories, workflows, parseResult
- 「运行」Tab 使用共享 `WorkflowParamForm` 渲染参数表单
- 「管理」Tab 提供 CRUD + 导入 + 编辑配置

### MaskEditor 组件

- **定位**：纯遮罩绘制组件，不含任务提交逻辑，由 WorkflowRunDialog 按需调用
- **Props**：`open`, `onClose`, `media?`（绑定底图）, `canvasSize?`（无底图时指定尺寸）, `onComplete(blob)`（确认回调）
- createPortal 全屏，双 Canvas 架构：
  - 显示画布（屏幕分辨率）：叠加渲染底图 + 蒙版
  - 蒙版画布（原图分辨率，离屏）：记录实际蒙版数据
- 工具：画笔（B）、橡皮（E）、大小调节（[/]）
- 撤销/重做：ImageData 快照栈（最大 50 步），Ctrl+Z / Ctrl+Y
- 缩放：滚轮以指针为中心缩放，中键/Alt+拖拽平移
- 移动端触摸：容器 div 设置 `touch-action: none` 阻止浏览器手势干扰，`setPointerCapture` 确保绘制连续性，双指 pinch-to-zoom 缩放+平移
- 触摸绘制延迟：触摸开始后延迟 80ms 才开始绘制（鼠标不受影响），用于检测是否为多指触控
- 部分笔画回退：绘制开始前保存 pre-stroke 快照，若绘制过程中检测到捏合手势，自动回退到快照状态
- 捏合状态管理：捏合状态仅在所有手指抬起后才清除
- 移动端画笔：默认大小 20（桌面端 40），范围 5-100（桌面端 5-200）
- 导出：RGBA PNG（alpha=0 为修复区域，alpha=255 为保留区域）

### WorkflowRunDialog 组件

- **定位**：统一的 AI 功能入口，替代旧的各类 Drawer
- **Props**：`open`, `onOpenChange`, `category`（upscale/face_swap/inpaint/image_to_image/text_to_image/preprocess）, `sourceMedia`, `initialWorkflowId?`, `initialParams?`
- **数据流**：
  1. 从 `useWorkflowStore` 获取 categories + workflows；调用 `fetchStatus()` 刷新 ComfyUI 连接状态
  2. 按 category 过滤工作流列表，自动选中 `is_default` 的工作流（若提供 `initialWorkflowId` 则优先选中）
  3. 调用 `workflowsApi.get(id)` 获取完整 manifest
  4. 使用共享 `WorkflowParamForm` 组件渲染参数表单
- **默认值提取**：标量参数从 workflow_json 提取默认值；image 类型参数不提取默认值；若提供 `initialParams` 则合并覆盖默认值（跳过 `workflow_id` 和 `__chain_input__`）
- **任务提交**：`workflow_type: "custom:{workflowId}"`, `params: { workflow_id, ...formValues }`
- **"编辑参数并新建"流程**：任务队列页右键菜单触发，从 TaskItem 提取 workflow_id → 获取工作流 category → 解析源媒体 → 以 `initialWorkflowId` + `initialParams` 打开对话框
- **布局**：固定 Header + 可滚动 Body（`onWheel stopPropagation` 防止穿透）+ 固定 Footer

### WorkflowParamForm 组件

WorkflowRunDialog 和 AiToolsTab 共用的参数渲染组件。

- **Props**：`categoryParams`, `extraParams`, `params`, `onParamChange`, `onParamClear`, `mediaThumbs`, `maskPreview`, `onPickImage`, `onDrawMask`, `sourceMedia?`, `canDrawMask?`
- **参数类型渲染**：
  - `image` + name 为 `source_image`/`base_image` + sourceMedia 已填入 → 只读显示
  - `image` + `source: "file_path"` → 遮罩参数，"绘制遮罩"按钮 → 回调 `onDrawMask`
  - `image`（其他）→ "选择图片"按钮 → 回调 `onPickImage`
  - `string` + `choices` → `<Select>` 下拉框
  - `string`（无 choices）→ textarea
  - `int`/`float` → number input
  - `bool` → Toggle 滑块开关（CSS 实现）
- **extra_params 渲染**：以分隔线 + "额外参数" 标签显示，渲染规则与契约参数完全一致（含 image/mask 类型）

---

## AI 功能规格

### 通用规范

- 所有 AI 功能通过 **WorkflowRunDialog**（居中弹窗）配置
- **统一流程**：右键菜单 → AI 功能 → 选择类别 → WorkflowRunDialog 弹出 → 自动按 category 筛选已注册的工作流 → 动态渲染参数表单 → 提交任务
- WorkflowRunDialog 布局：标题（category label）→ 源图预览 → 工作流选择器（默认选 `is_default` 的工作流）→ 参数表单 → 底部"加入队列"/"立即执行"按钮
- 任务提交后弹窗关闭，结果生成后自动存入 `AppData/generated/` 对应子目录
- 生成结果作为生成图关联至来源图（人脸参考图为准）

### 高清放大 [P1]

**工作流：** 分块高清放大工作流（分块逻辑对用户透明，由 ComfyUI 节点自动处理）

**自动反推提示词：** 工作流内置 `llama_cpp_instruct_adv` + Qwen3-VL 反推节点，自动从输入图像生成正向提示词（Extreme Detailed 风格），无需用户手动输入

**触发：** 右键 → AI 功能 → 高清放大 → WorkflowRunDialog 弹出（category=`upscale`），自动选中默认工作流，source_image 自动填入。参数由工作流 manifest 决定（如放大倍数、降噪强度等）

**结果处理：** 存入 `generated/upscale/`，链接至原图

### 局部修复 [P1]

**工作流：** `inpaint` 类别下可注册多个工作流（如 Flux、SDXL、Klein 等），用户在 WorkflowRunDialog 中选择

**流程：** 右键 → AI 功能 → 局部修复 → WorkflowRunDialog 弹出（category=`inpaint`） → 选择工作流 → 点击"绘制遮罩"按钮 → MaskEditor 全屏打开 → 绘制蒙版 → 确认 → 返回 Dialog → 配置其他参数（如提示词、降噪等，由工作流 manifest 决定） → 提交

**MaskEditor**：纯遮罩绘制工具，不包含任务提交逻辑。完成后返回 mask blob 给 WorkflowRunDialog，由 Dialog 负责上传遮罩和提交任务

**典型参数（由各工作流 manifest 定义）：**
- Flux 工作流：提示词（中文）、绘制强度、启用后位LoRA
- SDXL 工作流：绘制强度（无需提示词）
- Klein 工作流：无参数（无提示词、无强度）

**结果处理：** 存入 `generated/inpaint/`，链接至原图

### 换脸 [P1]

**工作流：** `face_swap` 类别下注册的工作流（如 qwen edit 换脸工作流）

#### 单张换脸

**流程：** 右键 → AI 功能 → 换脸 → WorkflowRunDialog 弹出（category=`face_swap`） → base_image 自动填入 → 通过 FaceRefPicker 选择 face_ref → 配置其他参数 → 提交

**结果处理：** 存入 `generated/face_swap/`，生成链 `parent_media_id` 指向底图（结果是底图的衍生）；**归属默认继承人脸参考图的人物/图集**（结果展示的是参考人脸）。WorkflowRunDialog 提供「结果归属」下拉选项，可切换为底图所属人物。

**交换底图与人脸参考：** WorkflowRunDialog 中两个图片参数之间提供快捷交换按钮，一键互换底图与人脸参考。

#### 批量 AI（通用）

**触发入口：**
- 图集右键菜单 → AI 功能 → 批量 AI → 选择工作流类别
- 人物主页图集卡片右键菜单 → 同上
- 多选工具栏 → AI 功能按钮 → 选择工作流类别

**可批量执行的工作流类别：** `upscale`（高清放大）、`face_swap`（换脸）、`image_to_image`（图生图）、`preprocess`（预处理）
**不可批量执行：** `inpaint`（需要逐张绘制遮罩）、`text_to_image`（无源图）

**流程（BatchAiDialog）：**
1. 弹出 BatchAiDialog，展示将要处理的图片数量（仅本地图/截图，跳过 AI 生成图）
2. 选择 AI 类别（仅可批量类别）
3. 选择具体工作流（从该类别下已注册的工作流中选取）
4. 配置共享参数（WorkflowParamForm，隐藏源图和遮罩参数，所有图片共用的参数如人脸参考图等）
5. 提交批量任务

**后端 API：** `POST /api/tasks/batch`，按图片数量创建独立任务，共享参数统一、每张图片替换 `source_param_name` 对应的参数值。返回 `{tasks_created}`。

**结果处理：** 每张生成图加入对应原图的生成链（`parent_media_id`），放回原图所在图集，不额外创建结果图集

#### 批量+链式

批量处理支持三种模式：
1. **独立任务**：每张图创建独立任务（现有行为）
2. **复合工作流**：选择复合工作流时，每张图展开为链式任务
3. **手动链式**：通过 `chain_step` 参数为每张图附加后续步骤

### 文件命名规则（全局统一）

```
{参考图文件名}_{workflow_type缩写}_{序号}.png
示例：IMG_001_img2img_001.png
     IMG_001_faceswap_002.png
```

---

## 测试用例

### 蒙版编辑器 [PRD §5.7]

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
    1. 在画布上滚轮向上 → 验证画布放大
    2. 滚轮向下 → 验证画布缩小
  预期: 缩放以指针为中心

T-MASK-07: 三种修复模式切换
  PRD 需求: §5.7 / §7.3 / §7.4 三种模式
  步骤:
    1. 验证默认模式为 "Flux (提示词)"，提示词输入框可见，"启用后位LoRA"复选框可见且默认未勾选
    2. 切换到 "SDXL (通用A)"，验证提示词输入框和后位LoRA复选框隐藏
    3. 切换到 "Klein (通用B)"，验证强度滑块隐藏
    4. 切回 "Flux (提示词)"，验证后位LoRA复选框重新可见
  预期: 模式切换正确显示/隐藏参数

T-MASK-08: 提交任务
  PRD 需求: §5.7 "[立即执行] [加入队列]"
  前置: 已绘制蒙版
  步骤:
    1. 选择 Flux 模式，输入提示词
    2. 点击"加入队列"
    3. 验证 toast 提示任务已创建，蒙版编辑器关闭
  预期: 任务创建成功

T-MASK-MOBILE-01: 移动端触摸绘制连续性
  步骤: 单指连续滑动绘制 → 验证蒙版线条连续无中断 → 手指移出画布边界后移回，验证绘制仍然连续
  预期: 触摸绘制流畅连续，pointer capture 确保跨边界绘制

T-MASK-MOBILE-02: 移动端双指缩放平移
  步骤: 双指捏合缩小/放大/平移画布 → 松开一指后验证不会误触发绘制
  预期: 双指缩放平移正常工作，不与单指绘制冲突

T-MASK-MOBILE-03: 触摸绘制延迟与捏合回退
  步骤:
    1. 单指触摸并快速变为双指捏合（80ms 内） → 验证未产生绘制痕迹
    2. 单指开始绘制，超过 80ms 后变为双指捏合 → 验证部分笔画被自动回退
    3. 所有手指抬起后单指绘制 → 验证正常工作
  预期: 触摸延迟防止误绘，捏合检测到后回退部分笔画
```

### 任务队列页 [PRD §5.8]

```
T-TASK-01: 任务队列页基本布局
  步骤: 导航到 /tasks → 验证顶部模式选择区域和任务列表区域
  预期: 页面布局正确

T-TASK-02: 队列模式切换
  步骤: 验证默认模式为"手动" → 切换到"自动"/"延时" → 验证选中状态和延时输入框
  预期: 模式切换正确渲染

T-TASK-03: 任务卡片状态显示
  前置: 数据库中有 pending、completed、failed 各 1 个任务
  步骤: 验证按状态分组显示，pending 黄色/completed 绿色/failed 红色 + 错误信息
  预期: 状态标识正确

T-TASK-04: 失败任务重试
  步骤: 找到 failed 任务 → 点击"重试" → 验证创建新 pending 任务（新 ID），原失败任务保留
  预期: 重试创建新任务，保留历史记录

T-TASK-04b: 已完成任务重新执行
  步骤: 右键 completed 任务 → 验证菜单含"重新执行" → 点击 → 验证创建新 pending 任务
  预期: 通过右键菜单重新执行，创建新任务

T-TASK-05: 删除任务
  步骤: 找到 pending 任务 → 删除 → 验证从列表消失
  预期: 删除成功

T-TASK-06: 手动触发执行
  前置: 有 pending 任务，ComfyUI 已连接
  步骤: 点击"开始执行" → 验证无报错
  预期: 手动触发成功

T-TASK-07: 进入页面清零完成角标
  前置: 侧边栏角标显示完成数
  步骤: 点击"任务队列"导航 → 验证完成角标消失
  预期: 进入页面后角标清零

T-TASK-08: 队列暂停/恢复
  步骤: 点击暂停 → 验证"已暂停"状态 → 点击恢复 → 验证恢复
  预期: 暂停/恢复切换正常

T-TASK-09: 任务信息展示
  步骤: 检查任务卡片显示工作流类型中文名和创建时间
  预期: 信息展示完整
```

### 任务队列实现 [PRD §5.8]

```
T-TQ-01: 空状态显示
  步骤: 导航到 /tasks → 验证 EmptyState 组件（含图标 + "暂无任务" 标题 + 描述文字）
  预期: 空状态正确

T-TQ-02: 创建任务后显示在队列
  步骤: 创建 upscale 任务 → 验证页面显示"等待中"和"高清放大"
  预期: 任务显示正确

T-TQ-03: 任务状态显示正确
  步骤: 获取任务列表 → 验证 status 为 pending
  预期: 状态正确

T-TQ-04: 删除任务
  步骤: 删除任务 → 验证从列表消失
  预期: 删除成功

T-TQ-05: 多任务排序
  步骤: 创建 3 个任务 → 验证按 queue_order 升序排列
  预期: 排序正确

T-TQ-06: 排序 API（后端保留）
  步骤: 获取 pending 任务 → 反转顺序调用 reorder API → 验证新顺序
  预期: 重排序 API 正常工作

T-TQ-07: 队列配置界面
  步骤: 导航到 /tasks → 验证显示"队列配置"、"手动"、"自动"
  预期: 配置界面正确

T-TQ-08: 页头暂停/恢复按钮
  步骤: 导航到 /tasks → 点击暂停按钮 → 验证琥珀色 → 再次点击恢复 → 验证恢复
  预期: 暂停/恢复状态正确切换

T-TQ-09: 任务右键菜单
  前置: 创建 1 个 pending 任务
  步骤: 右键任务卡片 → 验证"查看详情"和"删除" → 点击"查看详情" → 验证弹出详情对话框
  预期: 右键菜单和详情对话框正确

T-TQ-10: 任务详情对话框
  前置: 创建 1 个 completed 任务（带 result_media_ids）
  步骤: 右键已完成任务 → "查看详情" → 验证任务类型、状态、时间、结果缩略图
  预期: 详情完整

T-TQ-11: 进度条显示
  前置: 1 个 running 任务，stats API 返回 progress 数据
  步骤: 导航到 /tasks → 验证运行中任务显示进度条和 value/max 文字
  预期: 进度条随 stats 轮询实时更新

T-TQ-12: 最近完成结果视图
  前置: 2 个已完成任务（各有 result_media_ids）
  步骤: 导航到 /tasks → 验证"最近完成结果"区域显示缩略图网格（降序）→ 点击缩略图进入 LightBox → 右键验证菜单（无"生成链"和"脱离生成链"）
  预期: 结果图片正确展示

T-TQ-13: 任务结果源图导航按钮
  前置: 已完成任务，结果图有 parent_media_id
  步骤: 点击结果缩略图进入 LightBox → 验证无 ChainIndicator → 验证底部"查看源图"和"在图集中查看"按钮 → 点击"查看源图"/"返回结果"切换 → 点击"在图集中查看"跳转
  预期: 源图导航正常

T-TQ-14: 创建链式任务
  步骤: POST /api/tasks/chain → 验证返回 2 个任务共享 chain_id，chain_order 正确
  预期: 链式任务创建成功

T-TQ-15: 链式任务取消级联
  步骤: 取消 chain_order=0 → 验证 chain_order=1 也变为 cancelled
  预期: 级联取消正确

T-TQ-16: 链式任务重试（chain_order=0 重建整链）
  步骤: 重试 failed 的 chain_order=0 → 验证新 chain_id，步骤数量一致
  预期: 重建完整链

T-TQ-17: 链式任务重试（chain_order>0，前置成功 → 独立任务）
  步骤: 重试前置步骤已 completed 的 failed 第二步 → 验证新任务无 chain_id
  预期: 前置正常时创建独立任务

T-TQ-17b: 链式任务重试（chain_order>0，前置也失败 → 重建整链）
  步骤: 重试两步均 failed 的第二步 → 验证新 chain_id，步骤数量一致，占位符已重置
  预期: 前置失败时重建整链

T-TQ-18: 链式任务排序 API 保持链内顺序
  步骤: 尝试将链的第二步排在第一步之前 → 验证 400 错误 → 普通任务排在链之前 → 验证成功
  预期: 链内顺序受保护

T-TQ-19: 链式任务卡片显示
  步骤: 导航到 /tasks → 验证链式徽标 + 链信息行格式（步骤号 + 类别标签）+ 视觉缩进
  预期: 链式任务视觉标识正确

T-TQ-19b: 编辑参数并新建任务
  步骤: 右键 custom 工作流任务 → "编辑参数并新建" → 验证 WorkflowRunDialog 预填参数 → 修改后提交
  预期: 可基于已有任务快速创建新任务

T-TQ-19c: 自定义工作流 output_mappings 图片提升为 Media 记录
  步骤: 提交仅有 PreviewImage 输出的工作流 → 验证 result_media_ids 非空，Media 在 generated/<category>/
  预期: output_mappings 产出的图片被提升为正式 Media 记录

T-TQ-19d: 链式任务 - 前置步骤仅有 output_mappings 输出时链式传递正常
  步骤: 提交 2 步链式（第一步仅 output_mappings 输出）→ 验证第二步正确获取前置输出
  预期: output_mappings 输出能正确传递

T-TQ-19e: 独立任务拒绝未解析的 __chain_input__ 占位符
  步骤: POST /api/tasks，params 含 `__chain_input__` → 验证 400 错误
  预期: 含未解析占位符的独立任务被拒绝

T-TQ-20: 启动恢复 - 遗留 running 任务标记为失败
  步骤: 手动设置某任务为 running → 重启后端 → 验证 status=failed，含"服务重启"错误信息
  预期: 遗留任务正确标记

T-TQ-21: 链接下一步默认工作流为高清放大
  步骤: 打开链接下一步功能 → 验证默认 category 为 upscale
  预期: 链式默认使用高清放大
```

### AI 功能 - 高清放大 [PRD §7.2]

```
T-AI-UP-01: 高清放大 - WorkflowRunDialog
  步骤: 图片右键 → AI 功能 → 高清放大 → 验证 Dialog 弹出，默认工作流选中，source_image 只读，参数表单动态渲染
  预期: 工作流选择弹窗完整

T-AI-UP-02: 加入队列
  步骤: 配置参数 → "加入队列" → 验证 toast → 导航 /tasks → 验证 pending 任务
  预期: 任务创建成功

T-AI-UP-02b: 工作流自动反推提示词
  前置: ComfyUI 已连接，Qwen3-VL 模型已加载
  步骤: 对图片立即执行高清放大 → 等待完成 → 验证放大结果图生成
  预期: 反推节点自动生成提示词，放大质量正常

T-AI-UP-03: 立即执行按钮状态
  前置: ComfyUI 未连接
  步骤: 打开 WorkflowRunDialog → 验证"立即执行" disabled，"加入队列"可用
  预期: 按钮状态正确
```

### AI 功能 - 换脸 [PRD §7.4]

```
T-AI-FS-01: 单张换脸 - WorkflowRunDialog
  步骤: 图片右键 → AI 功能 → 换脸 → 验证 category=face_swap，base_image 只读，face_ref "选择图片"按钮，交换按钮，结果归属下拉
  预期: 弹窗完整

T-AI-FS-02: 人脸参考图选择 - 工作区
  前置: 工作区有 3 张图
  步骤: 点击"选择图片" → FaceRefPicker"工作区"tab → 选择一张 → 验证预览更新
  预期: 从工作区选取成功

T-AI-FS-03: 人脸参考图选择 - 浏览
  步骤: FaceRefPicker"浏览"tab → 人物 → 图集 → 图片 → 选择
  预期: 三级浏览选取成功

T-AI-FS-04: 工作流切换
  前置: face_swap 类别下有多个工作流
  步骤: 切换工作流选择器 → 验证参数表单更新
  预期: 工作流切换后参数正确

T-AI-FS-05: 底图与人脸参考交换按钮
  步骤: 设置 base_image 和 face_ref → 点击交换按钮 → 验证值互换
  预期: 一键交换成功

T-AI-FS-06: 结果归属选项
  步骤: 验证默认选中人脸参考图所属人物 → 切换为底图所属 → 提交 → 验证 params 含 result_owner
  预期: 可切换结果归属

T-AI-FS-07: 工作区 AI 换脸入口
  前置: 工作区有图片
  步骤: 导航到 /workspace → 右键图片 → AI 功能 → 换脸 → 验证 WorkflowRunDialog 弹出
  预期: 工作区入口正常

换脸结果归属测试:
  - 验证单张换脸结果 person_id = 参考图人物，album_id = null
  - 验证批量换脸自动创建生成图集归属人脸参考人物
  - 验证链式任务所有步骤都包含 target_person_id 和 result_album_id
  - 验证生成图集即使 sourceType 默认为 local 也能正常显示
  - 验证批量脱离生成链后 source_type=local，parent_media_id 清空
  - 验证 POST /api/media/fix-ownership 修复 person_mismatch

T-AI-BATCH-01: 批量 AI - 图集入口
  步骤: 图集右键 → AI 批量 → 选择类别 → BatchAiDialog → 配置参数 → 提交 → 验证任务数量
  预期: 批量 AI 任务创建成功

T-AI-BATCH-02: 批量 AI - 多选入口
  步骤: 多选图片 → AI 功能 → 选择类别 → BatchAiDialog → 配置参数 → 提交
  预期: 以选中的 media_ids 提交

T-AI-BATCH-03: 批量 AI - 不可批量类别不显示
  步骤: 图集右键 → AI 功能 → 验证批量子菜单不含"局部重绘"和"文生图"
  预期: 仅显示可批量类别
```

### AI 功能 - 局部修复 [PRD §7.3]

```
T-AI-IP-01: 局部修复完整流程
  步骤: 图片右键 → AI 功能 → 局部修复 → WorkflowRunDialog（inpaint）→ 验证 source_image 和 mask "绘制遮罩"按钮 → 点击 → MaskEditor 全屏 → 绘制 → 确认 → 返回 Dialog 验证 mask 已填 → 配置参数 → "加入队列" → 验证成功
  预期: 完整流程畅通

T-AI-IP-02: 工作流切换 - 参数差异
  前置: inpaint 类别下有多个工作流
  步骤: 切换不同工作流 → 验证参数表单动态更新
  预期: 参数表单正确反映所选工作流

T-AI-IP-03: MaskEditor 纯遮罩绘制验证
  步骤: 从 WorkflowRunDialog 点击"绘制遮罩" → 验证 MaskEditor 只有画笔工具栏 + 画布 + 取消/确认（无模式选择/提示词等）→ 绘制 → 确认 → 验证返回 Dialog
  预期: MaskEditor 为纯遮罩工具，无任务提交逻辑

T-AI-IP-04: 遮罩重新绘制
  步骤: 完成首次遮罩 → 返回 Dialog 验证缩略预览和"重新绘制"按钮 → 重新绘制 → 确认 → 验证预览更新
  预期: 可重复编辑遮罩

T-AI-IP-05: 额外参数渲染
  前置: 工作流 manifest 包含 extra_params
  步骤: 打开 WorkflowRunDialog → 验证额外参数区域（分隔线 + 标签）→ 修改值 → 提交 → 验证任务 params 包含修改后的额外参数
  预期: 额外参数正确渲染和提交
```
