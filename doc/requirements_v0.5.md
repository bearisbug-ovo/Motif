# AI图像生成系统 需求文档 V0.5

> 基于ComfyUI + Z-Image双模型策略，8GB显存本地部署，无需LoRA训练

---

## 1 核心决策

| 决策项 | 结论 |
|---|---|
| 底模 | **双模型策略**：Z-Image Turbo（迭代）+ Z-Image Base（出图） |
| 量化方案 | GGUF Q4_K_M~Q5（8GB显存），Q8可选（未来升级显卡） |
| 人物一致性 | IPAdapter + FaceID（参考图方案，不训练LoRA） |
| 姿势控制 | DWPose + Z-Image Turbo Fun ControlNet Union |
| 工作流框架 | ComfyUI |
| 硬件基准 | 8GB VRAM，16GB+ 系统内存，SSD |

### 双模型策略说明

| | Z-Image Turbo | Z-Image Base |
|---|---|---|
| 用途 | 快速迭代、构图探索、批量测试 | 最终出图、高质量交付 |
| 步数 | 8 | 28-50 |
| CFG | 1.0 | 3-5 |
| 量化格式 | GGUF Q4_K_M | GGUF Q4_K_M~Q5 |
| 采样器 | res_multistep / euler_ancestral | res_multistep |
| Shift | 默认 | 3 |
| 分辨率 | 768-1024 | 768-1024（后续高清放大） |

典型工作流：Turbo快速出5-10张草图 → 挑选满意构图 → 切换Base用相同参数精修出图 → 高清放大。

---

## 2 分期规划

### Phase 1 — 核心生成流程（MVP）

| 模块 | 范围 | Done定义 |
|---|---|---|
| 人物库 | 参考图集管理、FaceID特征提取、Prompt描述 | IPAdapter+FaceID生成图像人脸主观相似度 ≥ 7/10 |
| 动作库 | 姿势参考图导入、骨骼提取、标签管理 | 生成图像姿势与参考匹配度 ≥ 80% |
| 双模型生成 | Turbo迭代 + Base出图，共享Prompt/ControlNet参数 | 两模型可一键切换，参数自动适配 |
| 高清放大 | Ultimate SD Upscale 或 Tile ControlNet | 放大后无明显伪影 |
| 局部重绘 | ComfyUI Inpaint，支持NSFW模型 | 重绘区域光线/色调一致 |
| Web界面 | 数据录入 + Gallery浏览 + 评分 | 基本增删改查可用 |

### Phase 2 — 多要素组合

| 模块 | 范围 | Done定义 |
|---|---|---|
| 环境库 | 场景组管理、Qwen3联想扩展 | 联想Prompt与原场景风格一致 |
| 着装库 | 单品管理、穿搭方案、服装迁移 | 迁移后人脸不变形，服装自然 |
| Prompt整合 | Qwen3将各库要素转译为结构化Prompt | Prompt可直接驱动ComfyUI |
| 参考图驱动 | Qwen3-VL解析参考图并迁移要素 | 正确拆分着装/姿势/环境 |

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
| face_embed | filepath | InsightFace提取的FaceID特征向量 |
| appearance_desc | string | 极具体的外貌描述（用于多轮Prompt的`<think>`块） |

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
- IPAdapter（面部结构）+ FaceID（身份嵌入），生成时注入参考图
- Z-Image多轮对话`<think>`块显式声明保留/改变的特征
- 外貌描述要极具体（如"冰蓝色眼睛，虹膜周围有细微金色斑点"）
- 可选升级：云GPU训练LoRA（RunPod约$1-3/人物），Base上训练的LoRA兼容Turbo

### 3.2 动作库

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 动作名称 |
| reference_image | filepath | 参考图或骨骼图 |
| skeleton_data | filepath | DWPose提取的骨骼数据 |
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

### 4.1 双模型生成链路

```
用户选择人物/动作/环境/着装
        ↓
  Prompt组装（Phase1手动 / Phase2 Qwen3自动）
        ↓
┌─── Turbo迭代模式 ───┐    ┌─── Base精修模式 ────┐
│ GGUF Q4, 8步, CFG=1 │    │ GGUF Q4-Q5, 30步,  │
│ 快速出5-10张草图     │ →  │ CFG=3-5             │
│ 挑选满意构图         │    │ 相同Prompt精修出图   │
└─────────────────────┘    └─────────────────────┘
        ↓
  高清放大 / 局部重绘（可选）
        ↓
      最终图像
```

### 4.2 关键设计

- **参数自动适配**：切换模型时，步数/CFG/采样器/Shift自动调整，Prompt和ControlNet参数保持不变
- **IPAdapter/FaceID共享**：两个模型使用相同的参考图和FaceID特征，人物一致性不受模型切换影响
- **显存管理**：同一时间只加载一个模型，切换时释放前一个模型显存

### 4.3 8GB显存配置

| 配置项 | Turbo | Base |
|---|---|---|
| 模型格式 | GGUF Q4_K_M | GGUF Q4_K_M~Q5 |
| 步数 | 8 | 28-50 |
| CFG | 1.0 | 3-5 |
| 采样器 | res_multistep | res_multistep |
| 调度器 | simple | sgm_uniform |
| Shift | 默认 | 3 |
| ComfyUI启动 | --lowvram | --lowvram |

---

## 5 声音模块（Phase 3）

- 技术：GPT-SoVITS（首选）/ CosyVoice2 / Fish Speech
- 每人物独立声音模型，绑定人物库
- 流程：场景 + 人物profile → Qwen3台词 → TTS语音
- 为图像+语音→视频预留接口

---

## 6 Web管理界面

技术：FastAPI + 前端，与ComfyUI通过API/共享目录交互。

| 功能 | Phase 1 | Phase 2+ |
|---|---|---|
| 数据库管理 | 人物库、动作库增删改查 | 环境库、着装库 |
| 标签检索 | 基础标签管理 | 高级筛选与组合 |
| 图片浏览 | Gallery + 评分 | 多维度筛选 |
| 模型切换 | Turbo/Base一键切换 | — |

---

## 7 技术栈

| 模块 | 技术 | Phase |
|---|---|---|
| 图像生成 | Z-Image Turbo + Base (GGUF) | 1 |
| 工作流 | ComfyUI | 1 |
| 人物一致性 | IPAdapter + FaceID + 多轮Prompt | 1 |
| 姿势控制 | DWPose + ControlNet Union | 1 |
| 高清放大 | Ultimate SD Upscale / Tile ControlNet | 1 |
| 局部重绘 | ComfyUI Inpaint + NSFW模型 | 1 |
| 图像理解 | Qwen3-VL | 2 |
| Prompt整合/台词 | Qwen3 | 2-3 |
| 服装迁移 | CatVTON / IDM-VTON | 2 |
| 声音 | GPT-SoVITS / CosyVoice2 | 3 |
| Web界面 | FastAPI + 前端 | 1 |

---

## 8 可选升级路径

| 升级项 | 条件 | 收益 |
|---|---|---|
| 云GPU训练LoRA | RunPod $1-3/人物 | 更强人物一致性，Base上训练可兼容Turbo |
| 升级显卡至12-16GB | 硬件投资 | 可用Q8/FP8，Base跑更高分辨率，IPAdapter更从容 |
| Z-Image Base全精度 | 24GB显存 | 最高质量上限 |

---

## 9 版本变更记录

| 版本 | 主要变更 |
|---|---|
| V0.2 | 初始需求文档 |
| V0.3 | 新增分期规划、Done定义、阻塞性决策前置 |
| V0.4 | 适配8GB显存，LoRA改为IPAdapter+FaceID方案 |
| V0.5 | 双模型策略（Turbo迭代+Base出图），新增模型切换机制和升级路径 |
