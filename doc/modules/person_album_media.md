# 人物 / 图集 / 媒体管理

> 涉及代码：`backend/routers/persons.py, albums.py, media.py` | `backend/models/person.py, album.py, media.py` | `frontend/src/pages/MediaLibrary.tsx, PersonHome.tsx, AlbumDetail.tsx` | `frontend/src/stores/person.ts, album.ts, media.ts`

---

## 需求摘要

### 媒体库主页（人物一览）[PRD §5.2]

- **布局：** 网格卡片，支持 Ctrl+滚轮（桌面）或双指捏合（移动端）缩放网格列数。列数预设：`[20, 15, 12, 8, 5, 4, 3, 2, 1]`，默认 3 列，缩放后自动吸附最近预设值，持久化到 localStorage
- **人物卡片（PersonCard）：**
  - 正方形封面（`aspect-square`），底部渐变叠加（`from-black/70`）显示白色人物名 + "N张·N图集"
  - 左上角评分徽章（★4.2，半透明黑色背景），右上角 hover 显示 `…` 下拉菜单
  - 紧凑模式（compact）：桌面端列数 ≥10 时、移动端列数 ≥4 时进入，隐藏渐变叠层文字和评分徽章
  - 平均评分格式："★4.2 (12)"，括号内为已评分数量；全部未评分时不显示徽章
- **排序方式（可切换）：** 按导入时间（默认）/ 按平均评分 / 按名称
- **筛选：** 评分筛选（等于 / 大于等于 / 小于等于指定星级）、媒体类型（图片 / 视频，可叠加）
- **顶部操作：** 新建人物、导入图片、随机探索（全局范围）
- **人物卡片右键菜单：** 重命名人物、管理标签、导入、新建图集、清理空图集、清理低分图、删除人物（弹窗三选一：仅删除人物 / 删除人物及图集记录 / 删除人物及所有内容）
- **悬浮操作：** 卡片右上角隐藏 `…` 按钮，悬浮 0.5s 后显示，点击触发同右键菜单

### 人物主页 [PRD §5.3]

- **布局：**
  - 顶部：人物封面大图 + 姓名 + 平均评分 + 标签 chips（点击可快速筛选）
  - 移动端 hero 区域：缩小头像（64×64 vs 桌面端 96×96），紧凑文字排版，操作按钮仅显示图标
  - 主体：图集网格列表（含生成图集）+ 未分类区域并列展示
- **图集卡片（AlbumCard）：** 与 PersonCard 相同的正方形 + 渐变叠加样式，底部显示图集名 + "N张"，左上角评分徽章，右上角 hover 下拉菜单，支持 compact 模式
- **未分类卡片（MediaCard）：** 正方形缩略图，底部渐变叠加显示文件名（不含扩展名），左上角评分徽章，右上角来源类型标签（AI / 截图），支持 compact 模式。多选模式下：右上角显示圆形选中标记，隐藏评分徽章和来源标签
- **图集区筛选栏：** 排序（最新创建 / 评分最高 / 名称 A-Z）+ 评分筛选
- **未分类区筛选栏：** 排序（最新添加 / 评分最高）+ 评分筛选 + 来源类型筛选
- **筛选：** 进入页面时重置为设置页配置的默认值。来源类型筛选不影响大图切换逻辑（保证生成链遍历完整）
- **顶部操作：** 导入图片（默认关联当前人物）、新建图集、随机探索（该人物范围）、多选模式入口
- **图集卡片右键菜单：** 重命名图集、管理标签、导入、移动到其他人物、AI 功能（子菜单：批量 AI）、删除图集（三种模式：转为未分类 / 移到其他图集 / 连同媒体删除）
- **空白处右键菜单：** 人物主页空白处（含 Hero 区域）→ 与人物卡片右键菜单一致

### 图集详情页 [PRD §5.4]

- **布局：** 等高行布局（flex row）/ 方块网格（grid），顶部筛选和排序工具栏。移动端（< 768px）强制使用网格模式
- **网格缩放：** Grid 模式和 Row 模式均支持 Ctrl+滚轮/双指捏合缩放。Grid 模式调整列数（同人物库预设），Row 模式调整行高，预设 `[80, 120, 160, 200, 300, 400]` px
- **显示模式切换：** 仅本地图（默认）/ 混合显示（本地图 + 生成图；生成图按 DFS 顺序紧跟来源图后面）/ 仅生成图
- **排序方式：** 默认顺序 / 默认倒序 / 最新添加 / 最早添加 / 评分最高 / 评分最低
- **生成图集显示：** 加载 `is_generated_album=true` 的图集时，自动清除 sourceType 筛选 [PRD §3.3]
- **媒体卡片（MediaCard）：** 底部渐变叠加显示文件名（不含扩展名），支持 compact 模式
- **视频卡片：** 显示第一帧缩略图（有截图封面时优先使用），右下角叠加播放三角图标
- **图片卡片右键菜单（所有媒体页面一致）：** 设为图集封面、设为人物封面、AI 功能（子菜单）、裁剪/剪辑、加入工作区、移动到图集、移动到其他人物、在文件管理器中显示、评分 1-5、开启多选、查看详情、删除
- **多选模式：**
  - PC：点击卡片切换选中；手机：长按进入多选
  - 选中标记：右上角圆形指示器，选中时填充主色 + 白色勾号
  - 底部工具栏（SelectionToolbar）：已选数量、全选/取消全选、移动到图集、移动到其他人物、加入工作区、评分、删除、取消
  - 批量操作：批量移动到图集（支持跨人物）、批量移动到其他人物、批量加入工作区、批量删除、批量评分、批量 AI、批量脱离生成链
- **移动到图集**支持跨人物：移动时 person_id 自动同步为图集所属人物
- **移动到其他人物**时自动清空 album_id

---

## 数据模型

### Person（人物）[PRD §3.2] [Dev Guide §4.1]

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | string | 姓名 |
| cover_media_id | UUID? | 封面媒体 ID，默认第一张 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |
| avg_rating | float? | 加权平均评分（已评分用实际分，未评分按 2.5 计入；无媒体时为 null） |
| rated_count | int | 已评分媒体数量（用于前端显示"基于 N 张已评分"） |

**API 响应额外字段**：`cover_file_path`（解析后路径）、`media_count`、`album_count`、`accounts[]`（关联的平台账号列表，每项含 `id`、`platform`、`username`、`display_name`）、`tags[]`

### Album（图集）[PRD §3.3] [Dev Guide §4.2]

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| person_id | UUID? | 所属人物，可为空（无人物图集） |
| name | string | 图集名称 |
| cover_media_id | UUID? | 封面，默认第一张 |
| created_at | datetime | 导入时间 |
| updated_at | datetime | 更新时间 |
| avg_rating | float? | 加权平均评分（已评分用实际分，未评分按 2.5 计入；无媒体时为 null） |
| rated_count | int | 已评分媒体数量 |
| is_generated_album | bool | 是否为 AI 生成图集（如批量 AI 任务结果、写真套图） |
| source_face_media_id | UUID? | 生成图集关联的人脸参考图 |

### Media（媒体）[PRD §3.4] [Dev Guide §4.3]

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| album_id | UUID? | 所属图集，可为空（未分类） |
| person_id | UUID? | 所属人物 |
| file_path | string | 文件绝对路径 |
| media_type | enum | `image` / `video` |
| source_type | enum | `local`（本地图）/ `generated`（生成图）/ `screenshot`（视频截图） |
| parent_media_id | UUID? | 生成图/截图关联的来源媒体 ID |
| video_timestamp | float? | 截图对应视频时间戳（秒），仅 source_type=screenshot 时有值 |
| workflow_type | enum? | 使用的工作流类型 |
| generation_params | JSON? | 生成参数快照 |
| rating | int? | 评分 1-5，null 表示未评分 |
| sort_order | int | 图集内排序 |
| width | int? | 图片宽度 |
| height | int? | 图片高度 |
| file_size | int? | 文件大小 |
| playback_position | float? | 视频播放进度（秒），用于跨设备续播 |
| imported_at | datetime | 导入/生成时间 |
| is_deleted | bool | 软删除标记 |
| deleted_at | datetime? | 删除时间 |
| thumbnail_path | string? | 缩略图缓存路径（可重建） |

**索引**：`(person_id, is_deleted)`, `(album_id, sort_order)`, `(rating)`, `(is_deleted, deleted_at)`, `(parent_media_id)` [Dev Guide §4.3]

### 核心实体关系 [PRD §3.1]

```
人物 (Person) ──<>── 标签 (Tag)     ← 多对多（PersonTag）
  └──< 图集 (Album) ──<>── 标签 (Tag) ← 多对多（AlbumTag）
         └──< 媒体 (Media)  ←─────────────── 生成图也是 Media
                                              ↑
                                        关联人脸参考图
未分类（无图集的媒体，直属人物）
无人物未分类（导入时选择暂无人物）
```

### 数据完整性约束 [PRD §3.4]

- **person_id 一致性**：当 Media 属于某 Album 时，Media.person_id 必须与 Album.person_id 相同。后端在导入和移动操作时强制校验
- **生成链深度限制**：`parent_media_id` 递归深度上限 10 层，超过时 UI 提示"已达最大嵌套深度"
- **换脸结果归属规则**：
  - person_id 优先级：face_ref.person_id > target_person_id > source.person_id
  - album_id 仅在与 person_id 属于同一人物时继承，否则设为 null（散图）
  - 批量换脸时自动为人脸参考图所属人物创建生成图集

---

## API 端点

### 人物 `/api/persons` [Dev Guide §3.1]

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| GET | `/` | 人物列表 | `sort` (created_at/avg_rating/name), `sort_dir` (asc/desc, 默认 desc), `min_rating`, `max_rating`, `tag_ids`（逗号分隔，交集过滤）。响应含 `tags[]` |
| GET | `/{pid}` | 人物详情 | — |
| POST | `/` | 创建人物 | Body: `{name}` |
| PATCH | `/{pid}` | 更新人物 | Body: `{name?, cover_media_id?, tag_ids?: string[]}`（tag_ids 为全量替换） |
| DELETE | `/{pid}` | 删除人物 | `mode` (person_only/person_and_albums/all) |

### 图集 `/api/albums` [Dev Guide §3.2]

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| GET | `/` | 图集列表 | `person_id`, `sort`, `sort_dir` (asc/desc, 默认 desc), `min_rating`, `tag_ids`（逗号分隔，交集过滤）。响应含 `tags[]` |
| GET | `/{aid}` | 图集详情 | — |
| GET | `/by-person/{pid}` | 人物下图集 | `sort`, `sort_dir` (asc/desc, 默认 desc), `min_rating`, `tag_ids`（逗号分隔，交集过滤）。响应含 `tags[]` |
| POST | `/` | 创建图集 | Body: `{name, person_id?}` |
| PATCH | `/{aid}` | 更新图集 | Body: `{name?, cover_media_id?, person_id?, tag_ids?: string[]}`（tag_ids 为全量替换） |
| DELETE | `/{aid}` | 删除图集 | `mode` (album_only/album_and_media/move_to_album), `target_album_id?` |
| POST | `/cleanup-empty` | 清理空图集 | `person_id?`（可选，限定某人物范围）。删除所有无媒体的空图集，返回 `{deleted_count, deleted_albums[]}` |

### 媒体 `/api/media` [Dev Guide §3.3]

| Method | 路径 | 说明 | 参数 |
|---|---|---|---|
| POST | `/scan` | 扫描路径，返回每个路径的媒体总数和已存在数 | Body: `{paths[], recursive?}`。返回 `{results: [{path, total, existing}]}`，多路径时追加 `path="_total"` 汇总 |
| POST | `/import` | 导入媒体 | Body: `{paths[], person_id?, album_id?, album_name?}` |
| GET | `/import/{token}` | 导入进度 | — |
| POST | `/import/{token}/cancel` | 取消导入 | — |
| POST | `/import-clipboard` | 剪贴板导入 | FormData: `file` |
| POST | `/upload-files` | 移动端文件上传导入 | FormData: `files[]`, `person_id?`, `album_id?`。文件保存至 `AppData/imports/upload/`，返回 `{imported, media_ids[]}` |
| POST | `/backfill-dimensions` | 补填图片尺寸 | — |
| GET | `/album/{album_id}` | 图集内媒体 | `sort`, `sort_dir` (asc/desc, 默认 desc), `min_rating`, `source_type`, `media_type`。`source_type` 未指定时启用 DFS 重排（生成图紧跟原图） |
| GET | `/person/{pid}/loose` | 人物未分类 | `sort`, `sort_dir` (asc/desc, 默认 desc), `min_rating`, `source_type`, `media_type`。`source_type` 未指定时启用 DFS 重排 |
| GET | `/explore` | 随机浏览 | `person_id?`, `album_id?`, `min_rating?`, `media_type?` |
| GET | `/{mid}` | 媒体详情 | — |
| GET | `/{mid}/tree` | 生成链树 | — |
| PATCH | `/{mid}` | 更新媒体 | Body: `{rating?, album_id?, person_id?}` |
| PATCH | `/{mid}/progress` | 保存视频播放进度 | Query: `position` (float, 秒)。position=0 清除进度 |
| PATCH | `/batch` | 批量更新 | Body: `{ids[], rating?, album_id?, person_id?}` |
| POST | `/{mid}/detach` | 脱离生成链 | 无 Body。将 parent_media_id、workflow_type、generation_params 置为 null，source_type 改为 local。子代保持关联形成新独立树 |
| POST | `/batch-detach` | 批量脱离生成链 | Body: `{ids[]}` → 清除 parent_media_id、workflow_type、generation_params，source_type 改为 local。返回 `{detached[]}` |
| PATCH | `/{mid}/relocate` | 重定位文件 | Body: `{new_path}` |
| POST | `/batch-relocate` | 批量重定位 | Body: `{old_prefix, new_prefix}` |
| GET | `/{mid}/descendants-count` | 查询子图数量 | 返回 `{count}` |
| DELETE | `/{mid}` | 软删除 | Query: `mode`(cascade/reparent, 默认 cascade)。cascade=级联删除所有子图；reparent=仅删自身，子图归属到父节点 |
| POST | `/batch-delete` | 批量软删除 | Body: `{ids[], mode?}`（mode 同上，默认 cascade） |
| POST | `/{mid}/upload-mask` | 上传蒙版 | FormData: `mask` (PNG) |
| POST | `/{mid}/show-in-explorer` | 打开资源管理器 | — |
| POST | `/{mid}/crop` | 图片裁剪 | FormData: `file`, Query: `overwrite` (bool, 默认 false)。overwrite=true 覆盖原文件，否则存入 `generated/crop/`。返回 MediaItem |
| POST | `/{mid}/upload-crop` | 上传工作流临时裁剪 | FormData: `file`。存入 `cache/crops/`（自动清理），返回 `{crop_path: string}` |
| POST | `/{mid}/trim` | 视频剪辑 | Body: `{start: float, end: float, precise: bool}`。结果存入 `generated/trim/`，返回 MediaItem |
| POST | `/{mid}/screenshot` | 视频截图 | FormData: `file`, `timestamp?` (float) |
| POST | `/by-ids` | 批量按 ID 获取媒体 | Body: `{ids[]}` |
| POST | `/check-files` | 批量检测文件存在性 | Body: `{ids[]}`，返回 `{missing: string[]}` |
| GET | `/{mid}/nav-context` | LightBox 导航上下文 | Query: `sort?`, `sort_dir?`, `source_type?`, `filter_rating?`, `media_type?`；返回 `{album_id, person_id, local_items[], album_order[], person_order[]}` |
| POST | `/fix-ownership` | 修复 ownership 不一致 | 扫描所有 album_id 非空的媒体，若 media.person_id != album.person_id 则清空 album_id。返回 `{fixed_count, fixed[]}` |

**约束保护**：
- `PATCH /api/media/batch` 设置 album_id 时自动同步 person_id = album.person_id
- 移动到其他人物时前端同时发送 `album_id: ""` 清空图集归属

---

## 前端行为

### 页面组件 [Dev Guide §6.1]

| 页面 | 路由 | 职责 |
|------|------|------|
| MediaLibrary | `/` | 人物卡片列表，支持网格缩放、排序、评分筛选、标签筛选 |
| PersonHome | `/persons/:id` | 人物详情：Hero 区域 + 图集网格 + 未分类区域 |
| AlbumDetail | `/albums/:id` | 图集媒体列表：Grid/Row 双布局，筛选排序，多选操作 |

### Zustand Store 职责 [Dev Guide §6.1]

| Store | 职责 | 关键方法 |
|---|---|---|
| `person` | 人物 CRUD | fetchPersons, fetchPerson, createPerson, updatePerson, deletePerson |
| `album` | 图集 CRUD | fetchAlbums, fetchAlbum, fetchAlbumsByPerson, createAlbum, updateAlbum, deleteAlbum |
| `media` | 媒体 CRUD + 多选 | fetchByAlbum, fetchLoose, updateMedia, softDelete(id, mode?), replaceItem, toggleSelection, selectAll, clearSelection, batchRate, batchDelete(mode?), batchMoveToAlbum |

### Store 加载态规范 [Dev Guide §6.2]

- **空白**：加载中（`loading=true` 且无数据）时页面留空，不使用骨架屏
- **EmptyState**：仅在 `loading=false` 且数据确认为空时显示
- **数据**：有数据时始终显示，re-fetch 不闪烁

**实体切换防旧数据残留**：共享 store 的数据在路由参数变化时不自动重置，需在 `useEffect` 中按需清除旧数据（AlbumDetail 在切换到不同图集时清除 `items`；PersonHome 在切换人物时清除 `albums` / `looseItems`）

### 关键组件 [Dev Guide §7.6-7.8]

- **PersonCard / AlbumCard**：正方形封面 + 渐变叠加 + 评分徽章 + hover 下拉菜单，支持 compact 模式
- **MediaCard**：正方形缩略图 + 文件名叠层 + 来源标签 + 评分徽章，多选模式下显示圆形选中标记
- **FilterBar**：排序下拉 + 评分筛选 + 来源类型筛选 + 标签筛选 chips，各页面独立配置可用选项
- **筛选默认值**：存储在 localStorage `motif-filter-defaults`，可在设置页配置

---

## 功能细节

### 评分系统 [PRD §8.1]

- 评分范围：1-5 星，可清除（清除后视为未评分）
- **平均分计算规则**：所有未删除图片参与计算，已评分媒体使用实际评分，未评分媒体按 2.5 分计入加权平均
- 全部媒体数为 0 时，avg_rating 为 null，UI 显示"未评分"
- 前端显示格式：`★4.2 (12)` — 平均分 + 已评分数量
- 图集和人物的平均评分实时计算（基于下属未删除图片的加权平均）
- 评分入口：大图模式顶部、图片右键菜单、多选批量评分、键盘 1-5/0（大图模式）

### 封面管理 [PRD §8.5]

- 人物封面：默认第一张图，右键图片"设为人物封面"
- 图集封面：默认第一张图，右键图片"设为图集封面"
- 视频封面：默认第 1 帧；有截图后使用第一张截图；多张截图时可手动指定

### 生成链管理 [PRD §8.6] [PRD §10.8]

- `parent_media_id` 自引用外键实现多级嵌套
- **最大递归深度 10 层**，后端在创建生成图时检查深度
- 树状图渲染需递归查询子节点（后端 `/api/media/{id}/tree` 接口返回完整生成链）
- 任意生成图可脱离链接变为本地图（子数据：评分、二次生成图全部跟随）
- **脱离 API**：`POST /api/media/{id}/detach`，将 `parent_media_id`、`workflow_type`、`generation_params` 置为 null，`source_type` 改为 `local`。子代保持与被脱离图的关联，形成新的独立生成树
- **批量脱离**：`POST /api/media/batch-detach`，Body: `{ids[]}`
- **生成链缓存**：LightBox 使用 `chainCache`（Map<rootId, {tree, flat}>）缓存已加载的生成链。缓存在关闭 LightBox / 删除媒体 / 任务完成 / 脱离操作时失效

### 软删除与回收站 [PRD §8.7]

- 删除操作均为软删除（标记 `is_deleted = true`，记录 `deleted_at`）
- 本地图：任何情况下只删除记录，物理文件不动
- 生成图/截图：软删除后进入回收站；回收站永久删除时同时删除物理文件
- **生成链删除模式选择**：删除有子图的媒体时，弹出 DeleteChoiceDialog 让用户选择：
  - **级联删除（cascade）**：一并删除该图片的所有子图（默认）
  - **保留子图（reparent）**：仅删除该图片，其子图的 `parent_media_id` 指向被删图的父节点
  - 批量删除时，若选中项包含生成链图片，同样弹出选择对话框
  - 无子图的图片直接走简单确认对话框（ConfirmDialog）
- 回收站支持恢复到原位置
- 回收站手动清空
- **自动清理：默认 30 天后自动永久删除，保留天数可在设置页配置（设为 0 关闭自动清理）**

### 批量操作 [PRD §5.4]

- **多选模式**：PC 点击切换选中，手机长按进入多选
- 底部工具栏支持：全选/取消全选、批量移动到图集、批量移动到其他人物、批量加入工作区、批量评分、批量删除、批量 AI、批量脱离生成链
- **移动到图集**支持跨人物：点击人物切换按钮可查看所有人物的图集，移动时 person_id 自动同步
- **移动到其他人物**时自动清空 album_id

### 批量清理低分生成图 [PRD §8.8]

- 批量删除当前作用域内评分低于指定值的生成图
- 作用域：主页（全局）/ 人物主页 / 图集详情页
- 仅清理生成图（source_type 为 `generated` 或 `screenshot`），本地图不受影响
- **未评分的生成图永远不参与清理**
- 操作流程：选择评分阈值 → 展示预览列表 → 二次确认后执行软删除

### 随机探索 [PRD §8.9]

- 在指定作用域和筛选条件内随机排列媒体，以大图模式浏览
- 触发入口：各层级顶部工具栏"随机探索"按钮，自动继承当前作用域和已设筛选条件
- 作用域从触发层级自动继承（主页 = 全局，人物主页 = 该人物，图集页 = 该图集），进入后可手动切换
- **筛选选项**：评分（未评分 / 大于等于指定星级）、媒体类型（图片 / 视频）、来源类型（本地图 / 生成图）
- **探索行为**：进入时对符合条件的媒体随机洗牌，生成本次探索序列。筛选条件变更后需手动点击"重新洗牌"。水平轴在 shuffled 序列中顺序切换，垂直轴仍可进入当前图的生成链。评分操作实时生效但不重排
- 界面复用大图模式，顶部额外显示"探索进度"（如 12 / 87）和"重新洗牌"按钮

---

## 测试用例

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
    3. 悬浮"AI 功能"项，验证子菜单含：批量 AI
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

### 3.26 图集详情页（实现）[PRD §5.4]

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

### 多选操作补全

- **图集内移动到其他人物**：图集详情页进入多选 → 选择图片 → "移动到其他人物" → 选择目标人物 → 确认。验证图片 album_id 已清空、person_id 已更新
- **跨人物移动到图集**：人物主页未分类区多选 → "移动到图集" → 点击人物切换按钮选择其他人物的图集。验证 person_id 自动同步
- **跨人物新建图集并移动**：移动到图集对话框 → 人物切换 → "新建图集" → 选择目标人物 → 输入名称 → 创建并移动。验证新图集在目标人物下
