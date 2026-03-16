# ComfyUI 集成指南

## 环境信息

| 项目 | 值 |
|------|-----|
| 路径 | `D:\ai\ComfyUI-aki-v1.6` |
| Python | `D:\ai\ComfyUI-aki-v1.6\python\python.exe` |
| 启动命令 | `"D:/ai/ComfyUI-aki-v1.6/python/python.exe" "D:/ai/ComfyUI-aki-v1.6/ComfyUI/main.py" --port 8188 --lowvram` |
| 就绪检测 | `curl -s http://localhost:8188/object_info/KSampler` 返回 JSON 即就绪 |

## 模型文件

所有路径相对于 `D:\ai\ComfyUI-aki-v1.6\ComfyUI\models\`：

| 用途 | 路径 |
|---|---|
| Z-Image Base（ZIB） | `diffusion_models/z_image/ZIB-moodyWildMix_v01.safetensors` |
| Z-Image Base VAE | `vae/ae.safetensors` |
| Z-Image Turbo | `diffusion_models/z_image_turbo_bf16.safetensors` |
| Z-Image Turbo VAE | `vae/zImageClearVae_clear.safetensors` |
| 解剖 LoRA | `loras/Zimage/ZiB-female解剖学_anatomy.safetensors`（strength=0.7） |
| Text Encoder | `text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` |
| ControlNet Union | `model_patches/Z-Image-Fun-Controlnet-Union-2.1.safetensors` |
| Qwen-Image-Edit UNET | `diffusion_models/Qwen-Rapid-NSFW-v18.1_Q4_K.gguf` |
| Qwen-Image-Edit CLIP | `text_encoders/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf`（需同目录有 `mmproj-BF16.gguf`） |
| Qwen-Image-Edit VAE | `vae/qwen_image_vae.safetensors` |

## 必装插件

- **ComfyUI-GGUF** — GGUF 格式模型加载
- **comfyui-easy-use** — `easy imageRemBg` 等便捷节点
- **InsightFace** — 人脸检测/识别
- **Inspyrenet** — 背景移除
- **comfyui_controlnet_aux**（DWPose） — 姿态检测
- **ControlNet Union** — 统一 ControlNet

## 关键 Gotcha

### 1. ControlNet Union 加载方式

ControlNet Union 必须用 `ModelPatchLoader`（**不是** `ControlNetLoader`），然后接 `QwenImageDiffsynthControlnet` 节点。使用错误的加载器会导致模型无法正常工作。

### 2. GGUF CLIP 的隐式依赖

`Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf` 需要 `mmproj-BF16.gguf` 放在**同一目录**下。工作流中不需要选择这个文件，它会被自动加载。如果缺少此文件会导致加载失败。

### 3. easy imageRemBg 的背景设置

`easy imageRemBg` 节点**必须**设置 `add_background=white`。如果不设置，输出为 RGBA 4 通道图像，会触发 VL 编码器维度错误（期望 3 通道 RGB）。

### 4. 换脸模型选择（内存限制）

换脸工作流使用 GGUF Q4~Q6 量化模型 + `qwen_image_vae.safetensors`。**不要**使用 fp8 safetensors + `ae.safetensors` 组合——在 8GB 显存下会 OOM。

### 5. LoadImage API 调用

通过 API 调用 `LoadImage` 节点时，必须先调用 `upload_image` 将图片上传到 ComfyUI 的 `input/` 目录。手动测试时可以直接把文件放到 `input/` 目录下。

## 连接状态管理

前端页面轮询 ComfyUI 连接状态，三种状态：

| 状态 | 视觉 |
|------|------|
| 连接中 | 旋转加载图标 + "ComfyUI 启动中..." |
| 已连接 | 绿色图标 |
| 连接失败/未连接 | 红色图标 + 错误提示 |

**连接状态对功能的影响：**

- 浏览、管理、评分等功能不受影响
- AI 功能参数面板的"立即执行"按钮禁用，"加入队列"按钮保持可用
- 任务可以正常添加进队列，ComfyUI 恢复连接后按队列配置的启动模式继续执行

## 换脸工作流规范（已验证）

### 模型配置

- **UNET**：`Qwen-Rapid-NSFW-v18.1_Q4_K.gguf`
- **VAE**：`qwen_image_vae.safetensors`
- **CLIP**：`CLIPLoaderGGUF` with `Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf`，type=qwen_image

### 架构

Kontext 架构：`TextEncodeQwenImageEditPlus` + `FluxKontextMultiReferenceLatentMethod`

### 采样参数

| 参数 | 值 |
|------|-----|
| steps | 4 |
| cfg | 1 |
| sampler | euler |
| scheduler | simple |
| denoise | 1.0 |
| shift | 3.1 |

### 管线流程

1. **底图处理**：底图 → `ImageScaleToTotalPixels`(1MP) → `VAEEncode` → KSampler.latent
2. **人脸参考处理**：人脸参考图 → `easy imageRemBg`(white) → `TextEncodeQwenImageEditPlus`.image2
3. **Prompt**：`"将图中人物面部替换为参考图中的人脸，保持身体姿势、服装和背景完全不变，边缘自然融合"`

### 结果归属规则

- person_id 优先级：face_ref.person_id > target_person_id > source.person_id（换脸结果归属于人脸参考图的人物）
- album_id 仅在与 person_id 属于同一人物时继承，否则设为 null（散图）
- 批量换脸时自动为人脸参考图所属人物创建生成图集（is_generated_album=True），名称格式 "换脸 - {源图集名}"

## 后端集成方式

### 任务提交与结果获取

- 通过 `/prompt` 端点提交工作流 JSON
- 通过 `/history` 端点轮询结果（2 秒间隔）
- 工作流模板使用 `{{param_name}}` 占位符，由 `WorkflowBuilder` 注入参数

### 任务严格串行

FastAPI 后台线程维护队列（`queue_runner.py`），一次只向 ComfyUI 提交一个任务。支持四种启动模式：

| 模式 | 行为 |
|------|------|
| manual | 手动触发 |
| auto | 有新任务自动开始 |
| cron | 按 Cron 表达式定时启动 |
| delay | 新任务加入后 debounce 计时（默认 5 分钟），计时期间有新任务则重置 |

## 可复用旧代码（main 分支）

当前开发在 `rewrite/v2` 分支，旧代码保留在 `main` 分支。以下模块可复用：

| 模块 | 说明 | 查看方式 |
|------|------|----------|
| `backend/comfyui/client.py` | ComfyUIClient（submit/watch_progress/get_image/upload_image） | `git show main:backend/comfyui/client.py` |
| `backend/comfyui/workflow.py` | WorkflowBuilder（JSON 模板 + nodes.json 参数注入） | `git show main:backend/comfyui/workflow.py` |
| `backend/comfyui/workflows/` | faceswap、dwpose、upscale 等工作流模板 | `git show main:backend/comfyui/workflows/` |
