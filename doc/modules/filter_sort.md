# 筛选与排序

> 涉及代码：`frontend/src/components/FilterBar.tsx` | `frontend/src/stores/media.ts`(filter/sort state) | `frontend/src/lib/filterDefaults.ts`

## 需求摘要

筛选与排序是跨页面的通用功能，在人物库、人物主页（图集区/未分类区）、图集详情页均有使用。筛选条件可叠加，在所有层级生效（包括大图模式的上下张切换；但来源类型筛选不影响大图切换逻辑，以保证生成链遍历完整）。[PRD §8.2]

每次进入页面时，筛选条件和排序方式均自动重置为设置页配置的默认值。默认值存储在 localStorage `motif-filter-defaults`，可在设置页"外观"Tab 的"筛选默认值"区域配置。[PRD §8.2, §8.3, §5.11.1]

## 筛选规则

[PRD §8.2]

| 维度 | 选项 | 适用页面 |
|------|------|----------|
| 评分 | 全部 / 5星 / 4星+ / 3星+ / 2星以下 | 人物库、图集列表、未分类、图集详情 |
| 来源类型 | 全部 / 本地图 / AI生成 / 截图 | 未分类、图集详情 |
| 标签 | 全部 / 各已有标签（多选） | 人物库、人物主页图集列表 |

**评分系统** [PRD §8.1]：
- 评分范围：1-5 星，可清除（清除后视为未评分）
- 平均分计算规则：所有未删除图片参与计算，已评分媒体使用实际评分，未评分媒体按 2.5 分计入加权平均
- 全部媒体数为 0 时，avg_rating 为 null，UI 显示"未评分"
- 前端显示格式：`★4.2 (12)` — 平均分 + 已评分数量
- 图集和人物的平均评分实时计算（基于下属未删除图片的加权平均）
- 评分入口：大图模式顶部、图片右键菜单、多选批量评分

## 排序规则

[PRD §8.3]

| 层级 | 排序选项 | 默认值 |
|------|----------|--------|
| 人物库 | 最新创建 / 最早创建 / 评分最高 / 评分最低 / 名称 A-Z / 名称 Z-A | 最新创建 |
| 图集列表 | 最新创建 / 最早创建 / 评分最高 / 评分最低 / 名称 A-Z / 名称 Z-A | 最新创建 |
| 未分类 | 最新添加 / 最早添加 / 评分最高 / 评分最低 | 最新添加 |
| 图集详情 | 默认顺序 / 默认倒序 / 最新添加 / 最早添加 / 评分最高 / 评分最低 | 默认顺序 |

**双向排序**：所有排序选项均支持升序和降序两个方向。前端排序值格式为 `field:dir`（如 `created_at:desc`），后端 API 通过 `sort_dir` 参数（`asc`/`desc`）控制方向。

**评分排序规则**：降序时有评分的按评分降序排列，未评分（avg_rating = null）的排末尾；升序时未评分排最前，有评分的按评分升序排列。未评分组内按导入时间降序。

## 默认值与重置

[PRD §8.2, §8.3, §5.11.1]

**筛选默认值配置**：在设置页"外观"Tab 的"筛选默认值"区域可配置评分筛选和来源类型的默认值（默认均为"全部"），存储在 localStorage `motif-filter-defaults`。每次进入页面时筛选条件自动重置为设置页配置的默认值。

**排序默认值配置**：在设置页"筛选默认值"区域可为每个页面单独配置默认排序方式，存储在 localStorage `motif-filter-defaults`。每次进入页面时排序自动重置为设置页配置的默认值。

**`lib/filterDefaults.ts` 实现** [开发指南 §7.8.1]：
- 参照 `zoomDefaults.ts` 模式，localStorage key: `motif-filter-defaults`
- 全局默认值：`filterRating`（评分筛选）、`sourceType`（来源类型），默认均为 `''`（全部）
- 每页排序默认值：`SortPageKey` = `media-library` / `person-albums` / `person-loose` / `album-detail`
- **排序值格式**：`field:dir`（如 `created_at:desc`、`avg_rating:asc`）。`parseSortValue(value)` 解析为 `{field, dir}`，兼容不带 `:dir` 的旧值（默认 `desc`）
- API：`getSortDefault(page)` / `setSortDefault(page, value)` / `getFilterDefault(key)` / `setFilterDefault(key, value)` / `getAllFilterDefaults()` / `parseSortValue(value)`
- 设置页 onChange 即时写入 localStorage，无需保存按钮
- **旧值迁移**：`getSortDefault()` 读取时自动检测不带方向后缀的旧值并追加默认方向

## 前端行为

[开发指南 §7.8]

**FilterBar 组件**：
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

**后端 API 筛选/排序参数** [开发指南 §3.1 ~ §3.3]：
- 人物列表 `GET /api/persons`：`sort` (created_at/avg_rating/name), `sort_dir` (asc/desc, 默认 desc), `min_rating`, `max_rating`, `tag_ids`（逗号分隔，交集过滤）
- 图集列表 `GET /api/albums/by-person/{pid}`：`sort`, `sort_dir` (asc/desc, 默认 desc), `min_rating`, `tag_ids`（逗号分隔，交集过滤）
- 图集内媒体 `GET /api/media/album/{album_id}`：`sort`, `sort_dir` (asc/desc, 默认 desc), `min_rating`, `source_type`, `media_type`。`source_type` 未指定时启用 DFS 重排（生成图紧跟原图）
- 未分类媒体 `GET /api/media/person/{pid}/loose`：`sort`, `sort_dir` (asc/desc, 默认 desc), `min_rating`, `source_type`, `media_type`。`source_type` 未指定时启用 DFS 重排

## 测试用例

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
