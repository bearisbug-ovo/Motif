# AI图像生成系统 需求文档 V1.0

> 基于ComfyUI + Z-Image双模型策略，8GB显存本地部署，Qwen-Image-Edit GGUF Kontext 换脸

---

## 1 核心决策

| 决策项 | 结论 |
|---|---|
| 底模 | **双模型策略**：Z-Image Turbo（迭代）+ Z-Image Base（出图） |
| 量化方案 | bf16 safetensors（目标 GGUF Q4_K_M~Q6，8GB显存） |
| 人物一致性 | **Qwen-Image-Edit GGUF（Kontext 多图参考换脸）** |
| 姿势控制 | DWPose + Z-Image ControlNet Union |
| 工作流框架 | ComfyUI |
| 硬件基准 | 8GB VRAM，16GB+ 系统内存，SSD |

> **V0.6**：人物一致性从 IPAdapter + FaceID 替换为 Qwen-Image-Edit GGUF 换脸，人脸保真度更高。
>
> **V0.8（Phase 0 验证结论）**：换脸改为 Kontext 多图参考方案（无需遮罩/噪声注入）；Character 移除 face_crop 字段，仅保留 face_crop_nobg；skeleton_data 存 PNG；串行显存策略简化为生成→换脸两阶段。
>
> **V0.9**：Phase 1 新增高清放大（UltimateSDUpscale）和局部重绘（Flux2-Klein/SDXL/Klein 三模式）；任务阶段扩展为 generating/faceswapping/upscaling/done。
>
> **V1.0**：新增图集（Album）系统——文件夹图集（原生图导入）+ 套图图集（批量生成）；图片区分 AI生成图/原生图，两类均可独立评分；文件夹图集原地读取，路径失效时元数据保留并支持重链；Gallery 评分阈值过滤；图集快捷重命名。

### 双模型策略说明

| | Z-Image Turbo | Z-Image Base |
|---|---|---|
| 用途 | 快速迭代、构图探索、批量测试 | 最终出图、高质量交付 |
| 步数 | 8 | 28-50 |
| CFG | 1.0 | 3-5 |
| 模型格式 | bf16 safetensors（目标 GGUF Q4_K_M） | bf16 safetensors（目标 GGUF Q5） |
| 采样器 | res_multistep | res_multistep |
| Shift | 3 | 3 |
| 分辨率 | 768-1024 | 768-1024 |

典型工作流：Turbo 快速出 5-10 张草图 → 挑选满意构图 → 切换 Base 用相同参数精修出图 → Qwen-Image-Edit 换脸。

---

## 2 分期规划

### Phase 1 — 核心生成流程（MVP）

| 模块 | 范围 | Done 定义 |
|---|---|---|
| 人物库 | 参考图集管理、去背景预处理、Prompt 描述 | 换脸后人脸主观相似度 ≥ 8/10 |
| 动作库 | 姿势参考图导入、骨骼提取（PNG）、标签管理 | 生成图像姿势与参考匹配度 ≥ 80% |
| 双模型生成 | Turbo 迭代 + Base 出图，共享 Prompt/ControlNet 参数 | 一键切换，参数自动适配 |
| **换脸** | **Qwen-Image-Edit GGUF Kontext 多图参考，推理后释放显存** | **人脸保真，边缘自然融合** |
| 高清放大 | UltimateSDUpscale（2×，4x-UltraSharp，steps=6，denoise=0.3） | 放大后无明显伪影，细节清晰 |
| 局部重绘 | NSW修复（Flux2-Klein / SDXL）+ Klein 高分重绘（3 种模式） | 重绘区域光线/色调一致，边缘自然 |
| Web 界面 | 人物库 / 动作库 / 生成页 / Gallery / 重绘页 | 全流程可用 |

> **前置验证（P0-E，先于编码）**：UltimateSDUpscale 8GB OOM 测试、解剖 LoRA 最优强度选定、ZIB vs z_image_bf16 底模对比。

### Phase 2 — 图集管理 + 多要素组合 + 套图生成

| 模块 | 范围 | Done 定义 |
|---|---|---|
| **图集管理** | 文件夹图集导入、图集打标签、封面选定、平均评分、快捷重命名、路径失效重链 | 图集增删改查可用，重链功能正常 |
| **原生图支持** | 从磁盘文件夹导入原生图（非 AI 生成）、独立评分 | 原生图可浏览、可评分，不复制文件 |
| **Gallery 评分筛选** | 「≥N 星」阈值过滤，在现有页面内隐性过滤 | 筛选结果准确，不改变页面结构 |
| **套图批量生成** | VL 模型看底图反推 N 个场景，自动生成套图，结果归入套图图集 | 一张底图扩展为 ≥6 张，风格一致 |
| 环境库 | 场景组管理、Qwen3 联想扩展 | 联想 Prompt 与原场景风格一致 |
| 着装库 | 单品管理、穿搭方案、CatVTON 服装迁移 | 迁移后人脸不变形，服装自然 |
| Prompt 整合 | Qwen3 将各库要素转译为结构化 Prompt | Prompt 可直接驱动 ComfyUI |
| 参考图驱动 | Qwen3-VL 解析参考图并迁移要素 | 正确拆分着装/姿势/环境 |

### Phase 3 — 声音与视频预留

| 模块 | 范围 | Done 定义 |
|---|---|---|
| 声音训练 | GPT-SoVITS / CosyVoice2，绑定人物库 | 生成语音主观相似度 ≥ 7/10 |
| 台词生成 | Qwen3 基于人物设定生成台词 | 台词符合人物性格 |
| 视频接口 | 图像 + 音频合流预留 | 接口定义完成 |

---

## 3 数据模型

### 3.1 人物库（Character）

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 人物名称 |
| reference_photos | filepath[] | 参考图集（3-5 张，多角度/表情/清晰正脸） |
| face_crop_nobg | filepath | 去背景后的正脸图（Inspyrenet 处理，用于 Kontext 换脸的 image2） |
| appearance_desc | string | 外貌描述（辅助 Prompt，描述发色/肤色/五官特征等） |

入库流水线：参考图 → Inspyrenet 去背景（add_background=white）→ 保存 face_crop_nobg

### 3.2 动作库（Action）

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 动作名称 |
| reference_image | filepath | 参考图 |
| skeleton_data | filepath | DWPose 提取的骨骼图（PNG 格式） |
| tags | JSON | 类型/部位/情绪/场景标签 |
| camera_suggestion | JSON | 推荐镜头参数（可被用户覆盖） |

### 3.3 图片（Image）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 |
| filepath | string | 文件路径（AI生成图为 media/generated/；原生图为磁盘原始路径） |
| is_native | bool | true = 原生图（从磁盘导入），false = AI 生成图 |
| is_missing | bool | 原生图路径失效标记（文件不存在时置 true，元数据保留） |
| album_id | int FK nullable | 所属图集（可为 null，独立生成图） |
| character_id | int FK nullable | 关联人物（原生图为 null） |
| action_id | int FK nullable | 关联动作（原生图为 null） |
| prompt | string nullable | 生成 Prompt（原生图为 null） |
| model | string nullable | turbo / base（原生图为 null） |
| seed | int nullable | 生成种子（原生图为 null） |
| faceswapped | bool | 是否已换脸 |
| upscaled | bool | 是否已高清放大 |
| inpainted | bool | 是否经过局部重绘 |
| rating | int nullable | 评分 1-5（AI生成图和原生图均可评分） |
| created_at | datetime | 创建时间 |

### 3.4 图集（Album）— Phase 2

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 |
| name | string | 图集名称（文件夹图集默认为文件夹名，可重命名） |
| type | enum | `folder`（文件夹导入）/ `generated`（套图生成） |
| source_folder | string nullable | 导入时的原始文件夹路径（用于重链时的参照） |
| cover_image_id | int FK nullable | 手动指定的封面图 |
| character_id | int FK nullable | 关联人物（套图图集） |
| tags | JSON | 自由标签 |
| created_at | datetime | 创建时间 |

**计算字段**（查询时聚合，不持久化）：
- `avg_rating`：集内所有有评分图片的平均分
- `image_count`：集内图片总数
- `missing_count`：路径失效图片数

**路径失效处理**：
- 图集级重链：指定新文件夹路径 → 按文件名自动匹配原有 Image 记录 → 批量更新 filepath + 清除 is_missing
- 单图重链：手动为单张图指定新路径

### 3.5 环境库（Phase 2）

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 场景组名称 |
| images | filepath[] | 多张图描述同一环境 |
| space_type | string | 室内/室外/半开放 |
| elements | JSON | 背景/道具/氛围/光线/天气/空间深度 |
| tags | string[] | 检索标签 |

### 3.6 着装库（Phase 2）

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 单品名称 |
| image | filepath | 单品图片 |
| category | enum | 上装/下装/鞋/配饰/道具 |
| style_tags | string[] | 风格标签 |
| color_tags | string[] | 颜色标签 |

---

## 4 图像生成流程

### 4.1 完整生成链路（Phase 1）

```
用户选择人物/动作
        ↓
  Prompt 组装 + DWPose 骨骼
        ↓
Turbo 迭代 or Base 精修
        ↓
  Qwen-Image-Edit GGUF Kontext 换脸（可选）
  推理完成后释放缓存
        ↓
  UltimateSDUpscale 高清放大（可选）
  推理完成后释放缓存
        ↓
      最终图像 → 写入 Image 记录
```

**任务阶段**：`generating` → `faceswapping`（可选）→ `upscaling`（可选）→ `done` / `error`

### 4.2 换脸技术细节

**Kontext 多图参考换脸流程（Phase 0 验证结论）：**

1. 底图经 `ImageScaleToTotalPixels(1MP)` 缩放后同时作为 image1（正向编码）和 VAEEncode 的输入
2. 人脸参考图（face_crop_nobg，已去背景白底）作为 image2 送入正向编码
3. `TextEncodeQwenImageEditPlus`（正向）→ `FluxKontextMultiReferenceLatentMethod(index_timestep_zero)`
4. `TextEncodeQwenImageEditPlus`（负向，空字符串）→ 同样经 FluxKontext 处理
5. `KSampler`：steps=4，cfg=1.0，sampler=euler，scheduler=simple，denoise=1.0
6. VAE（qwen_image_vae.safetensors）解码

**核心节点**：UnetLoaderGGUF → ModelSamplingAuraFlow(shift=3.1) → CFGNorm(strength=1.0) → KSampler

### 4.3 Prompt 编写规范

- **语言**：支持中文，无需强制英文
- **格式**：自然语言段落式描述，不用逗号分隔词组堆叠
- **正向示例**：`"一位年轻女性坐在咖啡馆窗边，阳光从左侧斜射进来，半身构图，眼神望向窗外，自然真实的摄影风格"`
- **负向 Prompt**：Z-Image 和 Qwen-Image-Edit **不需要负向 Prompt**，负向条件固定置空
- **换脸指令示例**：`"将图中人物的面部替换为参考图中的人脸，保持身体姿势、服装和背景完全不变，边缘自然融合"`

### 4.4 关键设计

- **串行显存策略**：生成 / 换脸 / 放大三阶段顺序执行，每阶段结束后释放模型缓存，8GB 内完成全流程
- **参数自动适配**：切换 Turbo/Base 时，步数/CFG/采样器/调度器自动调整，Prompt 和 ControlNet 参数不变

### 4.5 8GB 显存配置

| 配置项 | Turbo/Base 生成 | Qwen-Image-Edit 换脸 | UltimateSDUpscale 放大 |
|---|---|---|---|
| 模型格式 | bf16 safetensors（目标 GGUF） | GGUF Q4~Q6 | Z-Image + 4x-UltraSharp |
| 显存峰值估算 | 6-8GB | 5-7GB | 待 P0-E 验证 |
| 执行顺序 | 第一阶段 | 第二阶段 | 第三阶段 |
| 执行后操作 | 释放缓存 | 释放缓存 | 释放缓存 |

### 4.6 局部重绘（Phase 1）

支持三种重绘模式，共用 Canvas 遮罩绘制界面。重绘入口：**Gallery 详情弹窗**内的「局部重绘」按钮，跳转至独立重绘页面。

**Tab 1 — NSW 修复**（inpaint_flux / inpaint_sdxl）

| 参数 | Flux2-Klein | SDXL 写实 |
|---|---|---|
| 底模架构 | Flux2-Klein（fp8） | SDXL-epicrealism |
| steps / cfg | 6 / 1 | 15 / 3.5 |
| sampler | euler | dpmpp_2m_sde / karras |
| denoise | 0.45 | 0.5 |
| 裁剪目标尺寸 | 512×512 | 1024×1024 |
| Prompt 来源 | WD14 自动识别 + 用户补充 | WD14 自动识别 + 用户补充 |

**Tab 2 — Klein 高分重绘**（inpaint_klein）

- Flux2-Klein ReferenceLatent 方案，denoise=1.0（全重绘遮罩区域）
- 用户直接输入编辑指令（自然语言中文），裁剪 1024×1024

**工作流共用逻辑**：
```
LoadImage(原图 + 遮罩 PNG)
  → INPAINT_ExpandMask → InpaintCropImproved
  → WD14Tagger + CLIPTextEncode → InpaintModelConditioning
  → KSampler → VAEDecode → ColorMatch → InpaintStitchImproved → SaveImage
```

**Canvas 遮罩规范**：白色 = 需重绘区域，黑色 = 保留区域；前端导出为 PNG 后 POST 至后端。

---

## 5 套图批量生成流程（Phase 2）

```
底图（换脸完成的单张图）
        ↓
  Qwen3-VL 看图反推 N 个场景描述
  （镜头/姿势/情绪/构图各不相同）
        ↓
  逐条执行：Qwen-Image-Edit 按指令改写底图
        ↓
  UltimateSDUpscale 高清修复（每张独立）
        ↓
  输出结果自动归入「套图图集」
  可选：自动拼封面（宫格排列 + 圆形人脸头像）
```

设计要点：
- 底图为 Phase 1 换脸后的成品，保证人脸一致性贯穿全套
- 批量执行时遵循串行显存策略，每张生成后释放缓存
- 生成结束后创建 Album 记录（type=generated），绑定 character_id

---

## 6 声音模块（Phase 3）

- 技术：GPT-SoVITS（首选）/ CosyVoice2 / Fish Speech
- 每人物独立声音模型，绑定人物库
- 流程：场景 + 人物 profile → Qwen3 台词 → TTS 语音
- 为图像 + 语音 → 视频预留接口

---

## 7 Web 管理界面

技术：FastAPI + Vue 3，与 ComfyUI 通过 REST API 交互。

### 7.1 Phase 1 功能

| 功能 | 说明 |
|---|---|
| 人物库增删改查 | 上传参考图后自动去背景，展示 face_crop_nobg |
| 动作库增删改查 | 上传参考图后自动 DWPose 提取骨骼图 |
| 生成主页 | 选人物/动作 + Prompt + 模型切换 + 换脸/放大开关 + SSE 进度条 |
| Gallery 浏览 | 网格 + 评分（1-5星）+ 筛选（人物/动作/模型/评分阈值） |
| 图片详情弹窗 | 大图 + 生成参数 + 评分 + 「查看原图」+ 「局部重绘」+ 「删除」 |
| 局部重绘页 | Canvas 遮罩绘制 + 模式 Tab（NSW修复 / Klein高分重绘）+ SSE 进度 |

### 7.2 Phase 2 功能

| 功能 | 说明 |
|---|---|
| 文件夹图集导入 | 指定本地文件夹路径 → 以文件夹名创建图集 → 扫描图片为原生图 |
| 图集浏览 | 图集卡片：封面图 + 图集名 + 平均评分 + 标签 |
| 图集管理 | 行内快捷重命名、打标签、选封面图、跨人物图集联动浏览 |
| 路径重链 | 图集级重链（按文件名匹配）+ 单图重链；路径失效时元数据保留 |
| Gallery 评分筛选 | 「≥N 星」阈值过滤，在现有页面内隐性过滤不满足条件的图片 |
| 套图图集 | 批量生成结果自动归集，可选封面、打标签 |
| 环境库/着装库 | 增删改查（Phase 2 后期） |

---

## 8 技术栈

| 模块 | 技术 | Phase |
|---|---|---|
| 图像生成 | Z-Image Turbo + Base (bf16/GGUF) | 1 |
| 工作流 | ComfyUI | 1 |
| **人物一致性/换脸** | **Qwen-Image-Edit GGUF + Kontext 多图参考** | **1** |
| 姿势控制 | DWPose + ControlNet Union | 1 |
| **高清放大** | **UltimateSDUpscale + 4x-UltraSharp（2×放大）** | **1** |
| **局部重绘** | **Flux2-Klein / SDXL-写实 / Klein高分重绘（3种模式）** | **1** |
| 后端框架 | FastAPI + SQLAlchemy + SQLite | 1 |
| 前端框架 | Vue 3 + Vite + TypeScript + Naive UI（深色主题）+ Tailwind CSS | 1 |
| 状态管理 | Pinia | 1 |
| 实时推送 | SSE（Server-Sent Events） | 1 |
| **图集管理 / 原生图** | **Album 模型 + 文件夹扫描导入 + 路径重链** | **2** |
| **评分筛选增强** | **「≥N 星」阈值过滤** | **2** |
| 图像理解/场景反推 | Qwen3-VL | 2 |
| Prompt 整合/台词 | Qwen3 | 2-3 |
| 套图批量生成 | Qwen3-VL 反推场景 + Qwen-Image-Edit 批量执行 | 2 |
| 服装迁移 | CatVTON / IDM-VTON | 2 |
| 声音 | GPT-SoVITS / CosyVoice2 | 3 |

---

## 9 可选升级路径

| 升级项 | 条件 | 收益 |
|---|---|---|
| Qwen-Image-Edit Q8/FP8 | 12-16GB 显存 | 换脸质量提升，边缘更自然 |
| 云 GPU 训练 LoRA | RunPod $1-3/人物 | 生成阶段即保持人脸一致性，减少换脸依赖 |
| 升级显卡至 12-16GB | 硬件投资 | 换脸与生成可并行，减少串行等待；Base 跑更高分辨率 |
| Z-Image Base 全精度 | 24GB 显存 | 最高质量上限 |

---

## 10 版本变更记录

| 版本 | 主要变更 |
|---|---|
| V0.2 | 初始需求文档 |
| V0.3 | 新增分期规划、Done 定义、阻塞性决策前置 |
| V0.4 | 适配 8GB 显存，LoRA 改为 IPAdapter + FaceID 方案 |
| V0.5 | 双模型策略（Turbo 迭代 + Base 出图），新增模型切换机制和升级路径 |
| V0.6 | 人物一致性替换为 Qwen-Image-Edit GGUF 换脸方案；Phase 2 新增套图批量生成 |
| V0.7 | 新增 Prompt 编写规范（支持中文段落式，无需负向 Prompt） |
| V0.8 | Phase 0 验证结论：换脸改为 Kontext 多图参考；Character 移除 face_crop；skeleton_data 存 PNG；串行两阶段 |
| V0.9 | Phase 1 新增高清放大（UltimateSDUpscale）和局部重绘（Flux2-Klein/SDXL/Klein 三模式）；任务阶段扩展为三阶段；P0-E 验证计划 |
| V1.0 | 新增图集（Album）系统：文件夹图集（原生图，原地读取，路径失效重链）+ 套图图集；Image 模型新增 is_native / is_missing / album_id / upscaled / inpainted；Gallery 评分阈值过滤；图集快捷重命名、封面选定、平均评分、跨人物联动浏览 |
