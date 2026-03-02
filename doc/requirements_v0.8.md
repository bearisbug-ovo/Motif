# AI图像生成系统 需求文档 V0.8

> 基于ComfyUI + Z-Image双模型策略，8GB显存本地部署，Qwen-Image-Edit GGUF Kontext 换脸

---

## 1 核心决策

| 决策项 | 结论 |
|---|---|
| 底模 | **双模型策略**：Z-Image Turbo（迭代）+ Z-Image Base（出图） |
| 量化方案 | bf16 safetensors（目标 GGUF Q4_K_M~Q6，8GB显存） |
| 人物一致性 | **Qwen-Image-Edit GGUF（Kontext 多图参考换脸）** |
| 姿势控制 | DWPose + Z-Image Turbo Fun ControlNet Union |
| 工作流框架 | ComfyUI |
| 硬件基准 | 8GB VRAM，16GB+ 系统内存，SSD |

> **V0.6 变更说明**：人物一致性方案从 IPAdapter + FaceID 替换为 Qwen-Image-Edit GGUF 换脸。前者通过特征向量影响生成过程，结果有随机性；后者直接以图像编辑指令语义级改写脸部区域，人脸保真度更高。显存管理通过 GGUF 量化 + 推理后释放缓存实现 8GB 兼容。

> **V0.8 变更说明（Phase 0 验证结论）**：换脸方案从遮罩精控改为 Kontext 多图参考方案（TextEncodeQwenImageEditPlus + FluxKontextMultiReferenceLatentMethod），无需 InsightFace 遮罩或噪声注入；Character 模型仅保留 face_crop_nobg（去背景正脸），face_crop 字段移除；Phase 1 暂不实现高清放大和局部重绘，移至 Phase 2；DWPose skeleton_data 存储 PNG 骨骼图；串行显存策略简化为生成→换脸两阶段。

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

典型工作流：Turbo快速出5-10张草图 → 挑选满意构图 → 切换Base用相同参数精修出图 → Qwen-Image-Edit换脸。

---

## 2 分期规划

### Phase 1 — 核心生成流程（MVP）

| 模块 | 范围 | Done定义 |
|---|---|---|
| 人物库 | 参考图集管理、去背景预处理、Prompt描述 | Qwen-Image-Edit换脸后人脸主观相似度 ≥ 8/10 |
| 动作库 | 姿势参考图导入、骨骼提取（PNG）、标签管理 | 生成图像姿势与参考匹配度 ≥ 80% |
| 双模型生成 | Turbo迭代 + Base出图，共享Prompt/ControlNet参数 | 两模型可一键切换，参数自动适配 |
| **换脸** | **Qwen-Image-Edit GGUF Kontext 多图参考，推理后释放显存** | **换脸结果人脸保真，边缘自然融合** |
| Web界面 | 数据录入 + Gallery浏览 + 评分 | 基本增删改查可用 |

### Phase 2 — 高清放大 + 多要素组合 + 套图生成

| 模块 | 范围 | Done定义 |
|---|---|---|
| 高清放大 | Tile 分块精修（4×4）+ Z-Image Turbo低强度增强 | 放大后无明显伪影，细节清晰 |
| 局部重绘 | ComfyUI Inpaint，支持NSFW模型 | 重绘区域光线/色调一致 |
| 环境库 | 场景组管理、Qwen3联想扩展 | 联想Prompt与原场景风格一致 |
| 着装库 | 单品管理、穿搭方案、服装迁移 | 迁移后人脸不变形，服装自然 |
| Prompt整合 | Qwen3将各库要素转译为结构化Prompt | Prompt可直接驱动ComfyUI |
| 参考图驱动 | Qwen3-VL解析参考图并迁移要素 | 正确拆分着装/姿势/环境 |
| **套图批量生成** | **VL模型看底图反推N个镜头/姿势方案，自动批量生成套图** | **一张底图自动扩展为≥6张不同构图，风格一致** |

### Phase 3 — 声音与视频预留

| 模块 | 范围 | Done定义 |
|---|---|---|
| 声音训练 | GPT-SoVITS / CosyVoice2，绑定人物库 | 生成语音主观相似度 ≥ 7/10 |
| 台词生成 | Qwen3基于人物设定生成台词 | 台词符合人物性格 |
| 视频接口 | 图像+音频合流预留 | 接口定义完成 |

---

## 3 数据模型

### 3.1 人物库

**核心字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 人物名称 |
| reference_photos | filepath[] | 参考图集（3-5张，多角度/表情/清晰正脸） |
| face_crop_nobg | filepath | 去背景后的正脸图（Inspyrenet处理，用于Kontext换脸的参考图） |
| appearance_desc | string | 外貌描述（用于Prompt辅助，描述发色/肤色/五官特征等） |

**可选字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| styles | Style[] | 造型库（发型/妆容/服装组合参考图） |
| personality | string[] | 性格标签 |
| identity | string | 身份背景 |
| habits | string[] | 个人习惯 |
| prompt_tendencies | object | Prompt偏好（表情/姿态/场景/色调） |
| voice_model | filepath | 声音模型（Phase 3） |
| voice_samples | dirpath | 训练音频素材（Phase 3） |

**设计要点：**
- 入库时自动执行：参考图 → Inspyrenet 去背景（add_background=white）→ 保存 face_crop_nobg
- 换脸时将 face_crop_nobg 作为参考图（image2）送入 TextEncodeQwenImageEditPlus，底图作为 image1，FluxKontext 注入参考潜变量驱动语义级换脸
- appearance_desc 用于辅助 Prompt 描述，不作为人物一致性的主要手段

### 3.2 动作库

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 动作名称 |
| reference_image | filepath | 参考图或骨骼图 |
| skeleton_data | filepath | DWPose提取的骨骼图（PNG格式） |
| tags | object | 类型/部位/情绪/场景标签 |
| camera_suggestion | object | 推荐镜头参数（可覆盖） |

**镜头联动规则：**

| 动作类型 | 推荐景别 | 焦点 |
|---|---|---|
| 挥手/招呼 | 半身 | 人脸 |
| 脚部特写 | 局部特写 | 下移 |
| 全身舞蹈 | 全身 | 居中 |
| 面部表情 | 人脸特写 | 眼部 |

### 3.3 环境库（Phase 2）

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 场景组名称 |
| images | filepath[] | 多张图描述同一环境 |
| space_type | string | 室内/室外/半开放 |
| elements | object | 背景/道具/氛围/光线/天气/空间深度 |
| tags | string[] | 检索标签 |

联想功能：Qwen3扩展，可调联想比例（低=贴近原始，高=自由衍生）。

### 3.4 着装库（Phase 2）

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 单品名称 |
| image | filepath | 单品图片 |
| category | enum | 上装/下装/鞋/配饰/道具 |
| style_tags | string[] | 风格标签 |
| color_tags | string[] | 颜色标签 |

入库：穿着照→Qwen3-VL解析+分离→入库；或单品照直接入库。迁移：CatVTON / IDM-VTON。

---

## 4 图像生成流程

### 4.1 完整生成链路（Phase 1）

```
用户选择人物/动作
        ↓
  Prompt组装（手动）+ DWPose骨骼
        ↓
┌─── Turbo迭代模式 ────┐    ┌─── Base精修模式 ────┐
│ bf16/GGUF, 8步, CFG=1 │    │ bf16/GGUF, 30步,   │
│ 快速出5-10张草图       │ →  │ CFG=3-5             │
│ 挑选满意构图           │    │ 相同Prompt精修出图   │
└───────────────────────┘    └─────────────────────┘
        ↓
  Qwen-Image-Edit GGUF Kontext 换脸
  （底图 image1 + 去背景正脸 image2 + 编辑指令）
  推理完成后释放模型缓存
        ↓
      最终图像
```

### 4.2 换脸技术细节

**Kontext 多图参考换脸流程（Phase 0 验证结论）：**

1. 底图经 `ImageScaleToTotalPixels(1MP)` 缩放后同时作为 `image1`（正向编码）和 VAEEncode 的输入
2. 人脸参考图经 `easy imageRemBg（Inspyrenet, add_background=white）` 去背景后作为 `image2` 送入正向编码
3. `TextEncodeQwenImageEditPlus`（正向）输出经 `FluxKontextMultiReferenceLatentMethod(index_timestep_zero)` 注入参考潜变量
4. `TextEncodeQwenImageEditPlus`（负向，空字符串）同样经 `FluxKontextMultiReferenceLatentMethod` 处理
5. `KSampler`：steps=4，cfg=1.0，sampler=euler，scheduler=simple，denoise=1.0
6. VAE（qwen_image_vae.safetensors）解码生成换脸结果

**核心工作流节点：**
- UnetLoaderGGUF（Qwen-Rapid GGUF Q4~Q6）→ ModelSamplingAuraFlow(shift=3.1) → CFGNorm(strength=1.0)
- CLIPLoaderGGUF（Qwen2.5-VL GGUF，type=qwen_image）
- VAELoader（qwen_image_vae.safetensors）
- TextEncodeQwenImageEditPlus（正向：vae + image1=底图 + image2=参考 + 指令）
- TextEncodeQwenImageEditPlus（负向：空字符串，无图像输入）
- FluxKontextMultiReferenceLatentMethod（正/负两侧均接此节点）
- VAEEncode（底图缩放后编码为初始潜变量）→ KSampler → VAEDecode → SaveImage

**显存管理：**
- Qwen-Image-Edit GGUF Q4~Q6 推理约 5-7GB
- Z-Image 生成阶段先完成并释放显存，再加载换脸模型
- 换脸推理完成后调用 `/free` 接口清理缓存
- 两个阶段（生成→换脸）串行执行，不同时加载

### 4.3 Prompt 编写规范

Z-Image 和 Qwen-Image-Edit 均使用 Qwen 系列文本编码器，与传统 CLIP 编码器有本质差异，编写规范如下：

**语言与格式**
- 支持中文，无需强制使用英文
- 使用自然语言段落式描述，而非逗号分隔的词组堆叠
- 描述应像在向摄影师说明拍摄意图，而非关键词列表

**正向 Prompt**
- 直接描述想要的内容：人物状态、场景、光线、镜头、情绪
- 示例：`"一位年轻女性坐在咖啡馆窗边，阳光从左侧斜射进来，半身构图，眼神望向窗外，自然真实的摄影风格"`

**负向 Prompt**
- Z-Image 和 Qwen-Image-Edit **不需要负向 Prompt**
- 不想要的内容通过**条件零化（空字符串）**处理，即负向文本编码器输入置空即可
- 前端不展示负向 Prompt 输入框，后端组装时负向条件固定传空字符串

**Qwen-Image-Edit 编辑指令**
- 同样使用自然语言描述编辑意图，支持中文
- 示例：`"将图一中人物的面部替换为参考图二中人物的面部，保持身体姿势、服装和背景完全不变，边缘自然融合"`

### 4.4 关键设计

- **串行显存策略**：生成/换脸两阶段顺序执行，每阶段结束后释放模型缓存，8GB 内完成全流程
- **Kontext 参考换脸**：image1=底图，image2=去背景正脸，FluxKontext 注入参考潜变量，无需遮罩或噪声注入
- **参数自动适配**：切换 Turbo/Base 时，步数/CFG/采样器/Shift 自动调整，Prompt 和 ControlNet 参数保持不变

### 4.5 8GB显存配置

| 配置项 | Turbo/Base生成 | Qwen-Image-Edit换脸 |
|---|---|---|
| 模型格式 | bf16 safetensors（目标 GGUF） | GGUF Q4~Q6 |
| 显存峰值估算 | 6-8GB | 5-7GB |
| 执行顺序 | 第一阶段 | 第二阶段 |
| 执行后操作 | 释放缓存 | 释放缓存 |
| ComfyUI启动 | --lowvram | --lowvram |

---

## 5 套图批量生成流程（Phase 2）

```
底图（换脸完成的单张图）
        ↓
  Qwen3-VL 看图反推 N 个场景描述
  （镜头/姿势/情绪/构图各不相同）
        ↓
  按行拆分场景指令
        ↓
  逐条执行：Qwen-Image-Edit 按指令改写底图
        ↓
  Tile 分块高清修复（每张独立）
        ↓
  自动拼封面（可选，宫格排列 + 圆形人脸头像）
        ↓
  输出整套写真
```

**设计要点：**
- 底图为 Phase 1 换脸后的成品，保证人脸一致性贯穿全套
- 场景描述由 VL 模型自动生成，包含：动作姿势、镜头语言、表情情绪、背景环境
- 批量执行时仍遵循串行显存策略，每张生成后释放缓存

---

## 6 声音模块（Phase 3）

- 技术：GPT-SoVITS（首选）/ CosyVoice2 / Fish Speech
- 每人物独立声音模型，绑定人物库
- 流程：场景 + 人物profile → Qwen3台词 → TTS语音
- 为图像+语音→视频预留接口

---

## 7 Web管理界面

技术：FastAPI + 前端，与ComfyUI通过API/共享目录交互。

| 功能 | Phase 1 | Phase 2+ |
|---|---|---|
| 数据库管理 | 人物库、动作库增删改查 | 环境库、着装库 |
| 人物预处理 | 上传参考图后自动去背景，保存face_crop_nobg | — |
| 标签检索 | 基础标签管理 | 高级筛选与组合 |
| 图片浏览 | Gallery + 评分 | 多维度筛选 |
| 模型切换 | Turbo/Base一键切换 | — |
| 高清放大/重绘 | — | 放大按钮、重绘面板 |
| 套图生成 | — | 底图→批量场景生成入口 |

---

## 8 技术栈

| 模块 | 技术 | Phase |
|---|---|---|
| 图像生成 | Z-Image Turbo + Base (bf16/GGUF) | 1 |
| 工作流 | ComfyUI | 1 |
| **人物一致性/换脸** | **Qwen-Image-Edit GGUF + Kontext 多图参考** | **1** |
| 姿势控制 | DWPose + ControlNet Union | 1 |
| 高清放大 | Tile 分块精修（4×4）+ Z-Image Turbo | 2 |
| 局部重绘 | ComfyUI Inpaint + NSFW模型 | 2 |
| 图像理解/场景反推 | Qwen3-VL | 2 |
| Prompt整合/台词 | Qwen3 | 2-3 |
| 套图批量生成 | Qwen3-VL反推场景 + Qwen-Image-Edit批量执行 | 2 |
| 服装迁移 | CatVTON / IDM-VTON | 2 |
| 声音 | GPT-SoVITS / CosyVoice2 | 3 |
| Web界面 | FastAPI + Vue 3 | 1 |

---

## 9 可选升级路径

| 升级项 | 条件 | 收益 |
|---|---|---|
| Qwen-Image-Edit Q8/FP8 | 12-16GB显存 | 换脸质量提升，边缘更自然 |
| 云GPU训练LoRA | RunPod $1-3/人物 | 可在 Z-Image 生成阶段即保持人脸一致性，减少换脸依赖 |
| 升级显卡至12-16GB | 硬件投资 | 换脸与生成可并行，减少串行等待；Base跑更高分辨率 |
| Z-Image Base全精度 | 24GB显存 | 最高质量上限 |

---

## 10 版本变更记录

| 版本 | 主要变更 |
|---|---|
| V0.2 | 初始需求文档 |
| V0.3 | 新增分期规划、Done定义、阻塞性决策前置 |
| V0.4 | 适配8GB显存，LoRA改为IPAdapter+FaceID方案 |
| V0.5 | 双模型策略（Turbo迭代+Base出图），新增模型切换机制和升级路径 |
| V0.6 | 人物一致性替换为Qwen-Image-Edit GGUF换脸方案，新增遮罩精控和串行显存策略；高清放大改为Tile分块方案；Phase 2新增套图批量生成模块；人物库数据模型更新（face_crop/face_crop_nobg替换face_embed） |
| V0.7 | 新增Prompt编写规范（4.3节）：支持中文段落式描述，无需负向Prompt，负向条件固定置空 |
| V0.8 | Phase 0 验证结论更新：换脸改为Kontext多图参考方案（TextEncodeQwenImageEditPlus + FluxKontextMultiReferenceLatentMethod，无需遮罩/噪声注入）；Character移除face_crop字段，入库流水线简化为仅Inspyrenet去背景；skeleton_data存PNG；Phase 1暂不实现高清放大和局部重绘（移至Phase 2）；串行显存策略简化为生成→换脸两阶段，任务状态：generating/faceswapping/done |
