# 图生图 & 写真生成 — 方案验证 Spec

> 状态：草稿 | 对应 PRD §7.6 / §7.7

---

## 1. 目标

验证两条核心链路的端到端可行性：

| 链路 | 一句话描述 |
|------|-----------|
| **图生图** | 一张参考图 → 提示词反推 → 后端润色 → ComfyUI 图生图 → 放大 |
| **写真生成** | 一张风格参考图 → VL 反推 + 摄影导演指令 → 拆成 N 条 → 后端逐条提交 ComfyUI → N 张写真 |

两者共用同一套 ComfyUI 图生图基础工作流，区别仅在**提示词生成策略**和**后端编排**。

---

## 2. 现有资产盘点

### 2.1 首选生图方案：ZiB-zimage-NSW 流（已验证）

来源：`老许/▶▶ZiB-zimage-NSW流.json`

| 组件 | 配置 |
|------|------|
| UNET | `z_image/ZIB-moodyWildMix_v01.safetensors` |
| LoRA | `Zimage/ZiB-female解剖学_anatomy.safetensors`（strength=0.7） |
| CLIP | `qwen_3_4b.safetensors` |
| VAE | `ae.safetensors` |
| Shift | ModelSamplingAuraFlow shift=3 |
| KSampler | steps=10, cfg=1, euler, simple, denoise=1.0 |
| 默认分辨率 | 720x1280（竖版） |
| 放大 | `4x-UltraSharp.pth` via UltimateSDUpscale（denoise=0.3） |

流程分组：`加载图片-反推用 → 初步采样 → 最终出图`

### 2.2 图生图 ControlNet 工作流

来源：`图生图_z_image_ControlNet.json`

在 ZiB 基础上增加：

| 组件 | 配置 |
|------|------|
| ControlNet | `Z-Image-Fun-Controlnet-Union-2.1.safetensors`（ModelPatchLoader + QwenImageDiffsynthControlnet） |
| 预处理器 | DWPose / Canny / DepthAnythingV2（三选一） |

### 2.3 提示词反推方案（两个都需验证）

| 方案 | 节点 | 模型 | 特点 | 来源 |
|------|------|------|------|------|
| **A: Qwen3-VL** | `llama_cpp_instruct_adv` | `Qwen3-VL-8B-Instruct-abliterated-v2.0.Q4_K_M.gguf` | 自然语言描述，支持中文，可多轮对话，适合摄影导演指令生成 | `图生图_z_image_ControlNet.json` |
| **B: WD14 Tagger** | `WD14Tagger\|pysssss` | `wd-vit-tagger-v3`（threshold=0.35, char_threshold=0.85） | tag 式输出，速度快，适合直接喂给 CLIP | `老许/★NSW修复流-V3.json` |

两者定位不同，不互斥：
- **WD14** 适合快速获取 tag 式提示词，直接用于图生图
- **Qwen3-VL** 适合自然语言描述和高级编排（五维度反推、摄影导演指令等）

### 2.4 五维度分离反推（文本处理增强版）

来源：`图生图_z_image_ControlNet+文本处理.json`

用 5 个 Qwen3-VL 调用分别描述，最终拼接：

| 维度 | 反推提示词 |
|------|-----------|
| 外貌 | "请详细描述图片中主体的外貌特征，包括：面部轮廓、五官、肤色、表情、妆容、发型..." |
| 穿着 | "请详细描述图片中主体可见的穿着与装饰..." |
| 配饰 | "请详细描述图片中主体的配饰..." |
| 背景 | "请详细描述图片的背景与环境..." |
| 摄影 | "请详细描述图片的摄影风格与整体氛围..." |

### 2.5 套图写真参考：`套图写真+真实换脸.json`

该工作流的**提示词生成策略**是写真生成要借鉴的核心（循环部分改为 Python 后端）：

```
风格参考图
  ├─ QwenVL #1：图像 caption（客观描述）
  │    prompt: "精准描述图片全部内容...发型/眼型/服饰/姿态..."
  │
  ├─ QwenVL #2：摄影导演（生成 N 条变体指令）
  │    system: "你是一位顶级商业人像摄影导演..."
  │    input: caption 结果 + 参考图
  │    output: N 条 "Next Scene: ..." 英文编辑指令
  │
  └─ 按行拆分 → Python 后端逐条提交 ComfyUI
```

---

## 3. 架构设计

### 3.1 职责划分

```
┌──────────────────────────────────────────────────┐
│                  Python 后端                       │
│                                                    │
│  ┌──────────────┐    ┌───────────────────────┐    │
│  │ 提示词反推    │    │   提示词编排引擎       │    │
│  │ (ComfyUI 节点 │───▶│  - 图生图：直接反推    │    │
│  │  WD14/QwenVL) │    │  - 写真：导演指令拆分   │    │
│  └──────────────┘    └──────────┬────────────┘    │
│                                  │                  │
│  ┌───────────────────────────────▼──────────────┐  │
│  │            任务队列 (queue_runner)             │  │
│  │  逐条提交 ComfyUI，收集结果，串联放大          │  │
│  └──────────────────────────────────────────────┘  │
└──────────────────────┬─────────────────────────────┘
                       │ /prompt + /history
               ┌───────▼───────┐
               │   ComfyUI     │
               │ 纯图生图工作流  │
               │ (无 VL、无循环) │
               └───────────────┘
```

**核心原则**：ComfyUI 工作流只做**单次图生图**（或单次反推），所有智能编排（提示词处理、循环、错误重试）放在 Python 后端。

### 3.2 提示词反推实现

方案验证阶段通过 ComfyUI 节点执行反推（提交只含反推节点的轻量工作流），后续可迁移到后端直接调用 llama-cpp-python。

需准备两个反推工作流模板：

| 模板 | 节点 | 用途 |
|------|------|------|
| `caption_wd14.json` | WD14Tagger | 快速 tag 反推，用于图生图 |
| `caption_vl.json` | llama_cpp_instruct_adv | 自然语言反推，用于图生图高级模式 / 写真导演指令 |

---

## 4. 图生图链路（单张）

### 4.1 流程

```
用户选择参考图 + 配置参数
  │
  ▼
Step 1: 提示词反推（可选，用户也可直接输入提示词）
  │  方案一：WD14 Tagger → tag 式提示词（快速）
  │  方案二：Qwen3-VL → 自然语言描述（详细）
  │  → 返回到前端编辑框，用户可修改
  │
  ▼
Step 2: 提示词润色（可选，PRD 中的 qwen-vl3 润色步骤）
  │  将基础描述 + 用户追加指令 + 场景模板 → 润色为最终提示词
  │
  ▼
Step 3: 提交 ComfyUI 图生图工作流
  │  模型: ZIB-moodyWildMix + 解剖学 LoRA(0.7) + ae.safetensors
  │  KSampler: steps=10, cfg=1, euler, simple, shift=3
  │  ControlNet: 可选（pose/canny/depth）
  │
  ▼
Step 4: 高清放大（默认启用，PRD §10.1 规则）
  │  4x-UltraSharp → UltimateSDUpscale(denoise=0.3)
  │
  ▼
Step 5: 存储结果
    路径: generated/img2img/{参考图名}_img2img_{序号}.png
    关联: parent_media_id → 参考图
    多张归集: {参考图名}_img2img_{日期} 图集
```

### 4.2 ComfyUI 工作流模板

从 `▶▶ZiB-zimage-NSW流.json` + `图生图_z_image_ControlNet.json` 精简合并，**移除 VL 反推部分**（改由后端单独提交），保留纯生图流程。

```
占位符参数:
  {{image}}           - 参考图（需先 upload_image 到 ComfyUI input/）
  {{prompt}}          - 正向提示词（由后端传入）
  {{negative_prompt}} - 反向提示词（默认值见 4.3）
  {{denoise}}         - 图生图强度（默认 1.0，文生图场景）
  {{seed}}            - 随机种子
  {{width}}           - 输出宽（默认 720）
  {{height}}          - 输出高（默认 1280）
  {{control_type}}    - ControlNet 类型 (none/pose/canny/depth)
```

### 4.3 默认反向提示词

从 ZiB-NSW 工作流提取（已验证有效）：

```
拒绝, 限制, 不应答, lowres, error, cropped, worst quality, low quality,
jpeg artifacts, heterochromia, out of frame, disfigured, blurry, fat,
(ugly:1.3), deformed, mutilated, bad anatomy, bad proportions, two heads,
two faces, deformed hands, (twisted fingers:1.22), extra fingers, poorly drawn,
grainy, poorly drawn face, mutation, poor facial details, cropped head,
poorly drawn eyes, unclear eyes, cross-eyes, malformed limbs, poorly drawn hands,
fused hands, mutated hands, malformed hands, (mutated fingers:1.4),
(fused fingers:1.313), interlocked fingers, extra or missing fingers,
(one hand with more than 5 fingers), (one hand with less than 5 fingers),
extra digits, fewer digits, bad hair, poorly drawn hair, fused hair,
poorly drawn feet, malformed feet, extra or missing feet, fused feet,
missing or extra limbs, disfigured, mutilated hands, extra hands, extra arms,
extra legs, missing arms, missing hands, missing legs, sharp fingernails,
(long thumbs:1.35), (greyscale:1.3), grain, (monochrome:1.3)
```

### 4.4 五维度反推（高级模式，Phase C）

后端实现为 5 次 VL 调用，用户可在 UI 上选择性编辑各维度：

```python
DIMENSIONS = {
    "appearance":  "请详细描述图片中主体的外貌特征，包括：面部轮廓（脸型、五官比例）、眼睛、鼻子、嘴唇、肤色、表情、妆容、发型...",
    "clothing":    "请详细描述图片中主体可见的穿着与装饰，包括：上衣/下装款式、颜色、材质、图案...",
    "background":  "请详细描述图片的背景与环境，包括：场景类型、光线、时间段、色彩主调、空间层次...",
    "photography": "请详细描述图片的摄影风格与整体氛围，包括：拍摄角度、景深、构图、色调、情绪...",
}
```

---

## 5. 写真生成链路（套图 N 张）

### 5.1 流程

```
用户选择风格参考图 + 配置参数（生成数量 N，默认 9）
  │
  ▼
Step 1: VL 图像描述（Qwen3-VL）
  │  prompt: "精准描述图片全部内容：画面主体、背景环境、物体材质/颜色/
  │           形状/纹理、人物全身姿态/服饰细节；若含人物，必须详细刻画
  │           头部：发型、眉形、眼型、鼻梁、嘴唇、面部轮廓、脸部角度..."
  │  → caption 文本
  │
  ▼
Step 2: 摄影导演指令生成（Qwen3-VL）
  │  input: 参考图 + caption + 导演系统提示词（含 N）
  │  → N 条 "Next Scene: ..." 英文编辑指令
  │
  ▼
Step 3: 后端解析指令
  │  parse_scene_instructions() → instructions[0..N-1]
  │  用户可在前端预览/编辑指令后再提交
  │
  ▼
Step 4: 逐条创建任务（Python 后端循环）
  │  for i, instruction in enumerate(instructions):
  │    创建 Task(workflow_type="portrait", prompt=instruction, ...)
  │    → 入队由 queue_runner 串行执行
  │    → 每条独立完成：图生图 → (可选换脸) → (可选放大)
  │
  ▼
Step 5: 结果归集
    创建图集: "{人物名}_portrait_{日期}"
    is_generated_album=True
    所有结果图关联至参考图 (parent_media_id)
```

### 5.2 摄影导演系统提示词

```
**角色定义：**
你是一位顶级商业人像摄影导演，擅长指导模特通过微妙的肢体语言
和眼神传递极致的女性魅力与性张力（Sex Appeal）。

**任务目标：**
我将提供一张人物原图。请根据这张图的**人物特征、服装细节、
背景环境**，构思 {N} 个不同的拍摄方案。
你需要输出 {N} 条**自然语言指令**，用于指导 AI 图片编辑模型修改原图。

**生成规则（Natural Language Instruction）：**
每条指令必须是一段完整的、流畅的英文自然语言（Prompt），结构如下：
1. **动作描述**：详细描述模特新的身体姿态（Pose），重点描述曲线、
   腿部线条和身体折叠感。
2. **表情刻画**：描述面部微表情，使用侧重情绪传递的词汇（如：迷离、
   渴望、挑逗）。
3. **镜头语言**：指定特殊的拍摄角度（如：俯视、男友视角）和景别。
4. **一致性约束**：每条指令的最后必须包含一句强制约束，要求保留原背景和服装。

**词汇策略（高级性感）：**
- 不要使用露骨词汇，而是使用暗示性描述。
- 替换词示例：
    - Not "Show butt" -> Use "Arching back to emphasize the hip curve"
    - Not "Open legs" -> Use "Relaxed pose revealing the inner thigh lines"
    - Not "Horny face" -> Use "Eyes half-closed with a flushed look of desire"

**输出格式：**
Next Scene 1: ...
Next Scene 2: ...
...
Next Scene {N}: ...

**现在，请读取图片，按照输出格式生成 {N} 条指令：**
```

### 5.3 指令解析

```python
import re

def parse_scene_instructions(vl_output: str) -> list[str]:
    """将 VL 输出解析为独立指令列表"""
    scenes = re.split(r'Next Scene\s*\d+\s*:', vl_output)
    return [s.strip() for s in scenes if s.strip()]
```

### 5.4 后端编排伪代码

```python
async def run_portrait_generation(
    reference_image_path: str,
    count: int = 9,
    face_image_path: str | None = None,  # 可选换脸
    upscale: bool = True,
    denoise: float = 1.0,  # 写真默认 1.0（ZiB-NSW 工作流默认值）
):
    # Step 1: 图像描述
    caption = await vl_caption(reference_image_path, CAPTION_PROMPT)

    # Step 2: 生成 N 条导演指令
    director_prompt = DIRECTOR_SYSTEM_PROMPT.format(N=count)
    instructions_raw = await vl_caption(
        reference_image_path,
        prompt=f"{director_prompt}\n\n图像描述参考：{caption}"
    )
    instructions = parse_scene_instructions(instructions_raw)

    # Step 3: 逐条创建任务
    album = create_album(
        name=f"{person_name}_portrait_{datetime.now():%Y%m%d_%H%M}",
        is_generated_album=True,
    )
    for i, instruction in enumerate(instructions):
        create_task(
            workflow_type="portrait",
            params={
                "image": reference_image_path,
                "prompt": instruction,
                "negative_prompt": DEFAULT_NEGATIVE,
                "denoise": denoise,
                "control_type": "none",
                "seed": random_seed(),
                "width": 720,
                "height": 1280,
            },
            album_id=album.id,
            # 可选：串联换脸 + 放大
            chain=[
                {"type": "face_swap", "face_image": face_image_path} if face_image_path else None,
                {"type": "upscale"} if upscale else None,
            ],
        )
```

---

## 6. ComfyUI 工作流模板规划

需从现有工作流精简出以下 API 可用模板：

| 模板文件 | 用途 | 精简自 |
|----------|------|--------|
| `img2img_zib.json` | ZiB 图生图（无 VL、无 ControlNet） | `▶▶ZiB-zimage-NSW流.json` |
| `img2img_zib_controlnet.json` | ZiB 图生图 + ControlNet（可选） | `图生图_z_image_ControlNet.json` 合并 ZiB 模型配置 |
| `caption_wd14.json` | WD14 tag 反推 | `★NSW修复流-V3.json` 中 WD14Tagger 节点 |
| `caption_vl.json` | Qwen3-VL 自然语言反推 | `图生图_z_image_ControlNet.json` 中 llama_cpp 节点 |
| `upscale.json` | 独立放大 | 已有（UltimateSDUpscale + 4x-UltraSharp） |
| `faceswap.json` | 独立换脸 | 已有 |

**模板参数化格式**：沿用 `{{param_name}}` 占位符 + `nodes.json` 参数映射。

---

## 7. 方案验证步骤（POC）

### Phase A: 反推验证

- [ ] A1. 提取 WD14 Tagger 为独立工作流模板，验证 tag 输出质量
- [ ] A2. 提取 Qwen3-VL 为独立工作流模板，验证自然语言描述质量
- [ ] A3. 对比两种反推方案在图生图场景下的效果差异

### Phase B: 图生图基础链路

- [ ] B1. 从 ZiB-NSW 工作流精简出 `img2img_zib.json` 模板（移除 VL 节点，参数化）
- [ ] B2. 编写 `nodes.json` 参数映射
- [ ] B3. 后端 API：`POST /api/caption` — 提交反推任务（WD14 或 VL）
- [ ] B4. 后端 API：`POST /api/img2img/generate` — 提交图生图任务
- [ ] B5. 端到端测试：选图 → 反推 → 生成 → 放大 → 存储

### Phase C: 写真生成链路

- [ ] C1. 验证摄影导演提示词模板：提交 VL 节点，确认输出 N 条可用指令
- [ ] C2. 后端实现指令解析 `parse_scene_instructions()`
- [ ] C3. 后端编排：循环提交 N 次图生图任务
- [ ] C4. 端到端测试：选图 → 9 条指令 → 逐条生图 → 归集到图集

### Phase D: 可选增强

- [ ] D1. 五维度分离反推
- [ ] D2. VL 迁移到后端 llama-cpp-python
- [ ] D3. 写真 + 换脸串联
- [ ] D4. ControlNet 动作引导（可选，不默认）

---

## 8. 已确认决策

| 问题 | 决策 |
|------|------|
| 生图模型 | **ZIB-moodyWildMix + 解剖学 LoRA(0.7)**，即 ZiB-zimage-NSW 流方案 |
| 反推节点 | **WD14 Tagger + Qwen3-VL 双方案并行验证**，按场景选用 |
| denoise 默认值 | 按参考工作流：**ZiB-NSW 文生图 denoise=1.0**，UltimateSDUpscale denoise=0.3 |
| KSampler 参数 | steps=10, cfg=1, euler, simple, shift=3 |
| ControlNet | **可选，不默认**；写真生成不强制启用 |
| 放大模型 | `4x-UltraSharp.pth` + UltimateSDUpscale |
| 一致性约束 | 暂通过提示词约束，不额外处理 |
| 循环方式 | **Python 后端**逐条提交，不用 ComfyUI forLoop |
