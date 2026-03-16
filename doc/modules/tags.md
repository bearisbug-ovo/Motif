# 标签系统

> 涉及代码：`backend/routers/tags.py` | `backend/models/tag.py` | `frontend/src/components/TagEditor.tsx` | `frontend/src/stores/tag.ts` | `frontend/src/api/tags.ts`

---

## 需求摘要

**所属阶段：P0 — 基础浏览与管理** [PRD §8.4]

人物和图集均支持多标签分类，便于跨人物/跨图集的分组浏览和筛选。

**标签属性：** 名称（唯一）+ 颜色（可选，默认灰色）+ 排序权重 [PRD §8.4]

**标签编辑器（TagEditor）：** [PRD §8.4]
- 触发方式：PersonCard / AlbumCard 右键菜单"管理标签"
- 弹出 Popover，列出所有标签（带颜色圆点），勾选/取消关联
- 顶部搜索框可过滤标签，输入不存在的名称时显示"创建标签"选项
- 新建标签时自动分配默认颜色，可在设置页"标签"Tab 修改

**筛选栏标签 chips：** [PRD §8.4]
- 人物库 FilterBar 显示标签筛选区，以彩色 chip 形式展示所有标签，支持多选
- 选中标签后仅显示包含任一选中标签的人物（OR 逻辑）
- 人物主页图集区 FilterBar 同理，按图集标签筛选

**PersonHome Hero 标签展示：** 人物姓名下方显示该人物的标签 chips，点击可跳转到人物库并按该标签筛选 [PRD §8.4]

**设置页标签管理（标签 Tab）：** [PRD §5.11.3]

标签管理列表按 sort_order 排列所有标签，每行显示：彩色圆点（tag.color）+ 标签名 + 关联数量（N 人物 / M 图集）+ 操作按钮

**操作：**
- 新建标签：输入名称 + 选择颜色（预设色板 + 自定义 HEX）
- 重命名：行内编辑
- 修改颜色：点击色块弹出色板
- 拖拽排序：调整 sort_order
- 合并标签：选择目标标签，将源标签的所有关联（PersonTag / AlbumTag）转移到目标标签并去重，完成后删除源标签
- 删除标签（红色危险操作，确认弹窗提示"将移除所有人物和图集上的该标签"）

---

## 数据模型

### Tag（标签） [PRD §3.13]

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | string | 标签名称（唯一） |
| color | string? | 标签颜色（HEX，如 `#FF6B6B`），为空时使用默认色 |
| sort_order | int | 排序权重（越小越靠前） |
| created_at | datetime | 创建时间 |

ORM 定义：`id (UUID PK), name (String(100) UNIQUE), color (String(20)?), sort_order (Integer), created_at (DateTime)` [开发指南 §4.8]

### PersonTag（人物-标签关联） [PRD §3.14]

| 字段 | 类型 | 说明 |
|------|------|------|
| person_id | UUID | 外键 → Person.id，联合主键 |
| tag_id | UUID | 外键 → Tag.id，联合主键 |

### AlbumTag（图集-标签关联） [PRD §3.15]

| 字段 | 类型 | 说明 |
|------|------|------|
| album_id | UUID | 外键 → Album.id，联合主键 |
| tag_id | UUID | 外键 → Tag.id，联合主键 |

**约束：** [PRD §3.13-3.15]
- 人物和图集均支持多标签，多对多关系
- 删除标签时级联删除所有关联记录（PersonTag / AlbumTag）
- 合并标签时将源标签的所有关联转移到目标标签，去重后删除源标签

**索引：** [PRD §3.16]

| 表 | 索引 | 用途 |
|-----|------|------|
| PersonTag | `(person_id)` | 人物标签查询 |
| PersonTag | `(tag_id)` | 按标签筛选人物 |
| AlbumTag | `(album_id)` | 图集标签查询 |
| AlbumTag | `(tag_id)` | 按标签筛选图集 |

---

## API 端点

### 标签 CRUD `/api/tags` [开发指南 §3.13]

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| GET | `/api/tags` | 标签列表 | 响应含 `person_count`, `album_count` |
| POST | `/api/tags` | 创建标签 | Body: `{name}` |
| PATCH | `/api/tags/{tag_id}` | 重命名标签 | Body: `{name}` |
| DELETE | `/api/tags/{tag_id}` | 删除标签 | — |
| POST | `/api/tags/{tag_id}/merge` | 合并标签 | Body: `{target_id}`，将当前标签的关联迁移到目标标签后删除当前标签 |
| PATCH | `/api/tags/reorder` | 重排序 | Body: `{tag_ids: [...]}` 按数组顺序更新 sort_order |

### 通过 Person/Album API 管理标签关联 [PRD §15.5]

| Method | 端点 | 说明 |
|--------|------|------|
| PUT | `/api/persons/{id}/tags` | 设置人物标签（Body: tag_ids 列表，全量替换） |
| PUT | `/api/albums/{id}/tags` | 设置图集标签（Body: tag_ids 列表，全量替换） |

也可通过 PATCH 更新 Person/Album 时传入 `tag_ids` 字段实现全量替换：[开发指南 §3.1, §3.2]
- `PATCH /api/persons/{pid}` Body: `{tag_ids?: string[]}`
- `PATCH /api/albums/{aid}` Body: `{tag_ids?: string[]}`

### 标签筛选参数 [开发指南 §3.1, §3.2]

人物列表和图集列表均支持 `tag_ids` 查询参数（逗号分隔，交集过滤）：
- `GET /api/persons?tag_ids=uuid1,uuid2` → 返回同时关联这些标签的人物
- `GET /api/albums?tag_ids=uuid1,uuid2` → 返回同时关联这些标签的图集
- `GET /api/albums/by-person/{pid}?tag_ids=uuid1` → 人物下按标签筛选图集

---

## 前端行为

### Store（tag） [开发指南 §6.1]

Actions: `fetchTags`, `createTag`, `updateTag`, `deleteTag`, `mergeTag`, `reorderTags`

### FilterBar 标签筛选 [开发指南 §6.1]

- 人物库 FilterBar：排序 + 评分 + 标签（PersonStore）
- 人物主页图集区 FilterBar：排序 + 评分 + 标签（AlbumStore）
- 标签筛选以 tag chips 形式展示，点击切换选中状态，支持多选交集过滤

### PersonHome Hero 区 [PRD §5.5]

- 人物信息区：人物封面大图 + 姓名 + 平均评分 + 标签 chips（点击可快速筛选）
- 标签 chips 以彩色小标签（`rounded-full`，背景色为 tag.color）形式排列，点击标签进入按该标签筛选的人物库视图

### 右键菜单标签管理 [PRD §5.3, §5.5]

PersonCard 和 AlbumCard 的右键菜单均包含"管理标签"子菜单，弹出 TagEditor 组件（SubMenu 行内编辑模式）。

### TagEditor 组件 [开发指南 §2.1]

`frontend/src/components/TagEditor.tsx`：标签编辑器，支持 SubMenu 行内编辑 + Dialog 管理两种模式。

---

## 测试用例

> 来源：测试计划 §13（标签系统测试 T-TAG-01 ~ 12）

### 13.1 后端 API

**T-TAG-01: Tag CRUD**
- PRD 需求: 标签管理
- 步骤:
  1. POST /api/tags 创建标签 "角色A"
  2. GET /api/tags 列出标签，验证含 person_count/album_count 字段
  3. PATCH /api/tags/:id 重命名为 "角色B"
  4. DELETE /api/tags/:id 删除标签
- 预期: 创建/列出/重命名/删除均正常，列表含关联计数

**T-TAG-02: Tag 合并**
- PRD 需求: 标签合并
- 步骤:
  1. 创建标签 A 和标签 B
  2. 将人物 1 关联标签 A，人物 2 关联标签 B
  3. POST /api/tags/:targetId/merge 将 B 合并到 A
  4. 验证人物 2 现在关联标签 A，标签 B 已删除
- 预期: 关联转移到目标标签，源标签删除

**T-TAG-03: Tag 排序**
- PRD 需求: 标签排序
- 步骤:
  1. 创建标签 A、B、C
  2. PUT /api/tags/reorder 设置顺序 [C, A, B]
  3. GET /api/tags 验证返回顺序
- 预期: 标签按指定顺序返回

**T-TAG-04: Person tag 过滤**
- PRD 需求: 标签筛选
- 步骤:
  1. 创建标签 X，关联人物 1 和 2
  2. 创建标签 Y，关联人物 2 和 3
  3. GET /api/persons?tag_ids=X → 返回人物 1, 2
  4. GET /api/persons?tag_ids=X,Y → 返回人物 2（交集）
- 预期: 单标签过滤和多标签交集过滤均正确

**T-TAG-05: Album tag 过滤**
- PRD 需求: 标签筛选
- 步骤:
  1. 创建标签，关联若干图集
  2. GET /api/albums?tag_ids=xxx → 验证过滤结果
- 预期: 图集标签过滤正确

**T-TAG-06: Person/Album patch tag_ids**
- PRD 需求: 标签关联
- 步骤:
  1. PATCH /api/persons/:id 设置 tag_ids=[A, B]
  2. 验证人物关联标签 A 和 B
  3. PATCH /api/persons/:id 设置 tag_ids=[B] → 验证全量替换（A 移除）
  4. 同样测试 PATCH /api/albums/:id 的 tag_ids
- 预期: tag_ids 全量替换，非增量

### 13.2 前端 E2E

**T-TAG-07: 标签芯片筛选**
- PRD 需求: 人物库标签筛选
- 步骤:
  1. 导航到人物库
  2. 验证 FilterBar 显示标签芯片
  3. 点击标签芯片筛选
  4. 验证人物列表仅显示关联该标签的人物
  5. screenshot('tag-filter-chip')
- 预期: 点击标签芯片后人物列表正确过滤
- 文件: tag-system.test.ts

**T-TAG-08: PersonCard 标签管理**
- PRD 需求: 右键菜单标签管理
- 步骤:
  1. 右键点击人物卡片
  2. 验证菜单中有"管理标签"子菜单
  3. 展开子菜单，勾选一个标签
  4. 再次右键，验证该标签已勾选
  5. 取消勾选，验证标签移除
  6. screenshot('person-card-tag-menu')
- 预期: 右键菜单可勾选/取消标签，状态正确持久化
- 文件: tag-system.test.ts

**T-TAG-09: PersonHome 标签展示**
- PRD 需求: 人物主页标签显示
- 步骤:
  1. 进入已关联标签的人物主页
  2. 验证人物信息区显示标签芯片
  3. 点击编辑标签，验证标签管理弹窗/交互
  4. screenshot('person-home-tags')
- 预期: 人物主页正确显示标签，可编辑
- 文件: tag-system.test.ts

**T-TAG-10: AlbumCard 标签管理**
- PRD 需求: 右键菜单标签管理
- 步骤:
  1. 进入人物主页图集区
  2. 右键点击图集卡片
  3. 验证菜单中有"管理标签"子菜单
  4. 勾选/取消标签，验证操作生效
  5. screenshot('album-card-tag-menu')
- 预期: 图集卡片右键菜单标签管理正常
- 文件: tag-system.test.ts

**T-TAG-11: 设置页标签管理**
- PRD 需求: 设置页标签管理 tab
- 步骤:
  1. 导航到设置页 → 标签 tab
  2. 新建标签，验证列表更新
  3. 重命名标签，验证名称变更
  4. 合并两个标签，验证合并结果
  5. 删除标签，验证列表移除
  6. screenshot('settings-tag-management')
- 预期: 设置页可完整管理标签生命周期
- 文件: tag-system.test.ts

**T-TAG-12: 未分类区标题一致性**
- PRD 需求: 未分类区域命名
- 步骤:
  1. 进入人物主页，验证未分类区标题为"未分类"
  2. 导航到 MediaLibrary 未分类区，验证标题为"未分类"
  3. screenshot('uncategorized-title')
- 预期: 所有页面未分类区标题统一为"未分类"
- 文件: tag-system.test.ts
