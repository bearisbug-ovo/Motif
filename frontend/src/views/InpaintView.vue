<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NButton, NSlider, NInput, NSelect, NTabs, NTabPane,
  NProgress, useMessage, NSpin,
} from 'naive-ui'
import { galleryApi, type ImageRecord } from '@/api/gallery'
import { inpaintApi } from '@/api/inpaint'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const imageId = computed(() => Number(route.params.id))
const imgRecord = ref<ImageRecord | null>(null)
const loading = ref(true)

// Canvas refs
const canvasRef = ref<HTMLCanvasElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)

// Drawing state
const brushSize = ref(30)
const isEraser = ref(false)
const isDrawing = ref(false)

// Mode state
const activeTab = ref<'nsw' | 'klein'>('nsw')
const nswMode = ref<'flux' | 'sdxl'>('flux')
const prompt = ref('')
const denoise = ref(0.45)

// Task state
const submitting = ref(false)
const progress = ref(0)
const stage = ref('')
const resultUrl = ref<string | null>(null)

function mediaUrl(path: string) {
  return path.startsWith('/') ? path : '/' + path
}

onMounted(async () => {
  try {
    const { data } = await galleryApi.get(imageId.value)
    imgRecord.value = data
  } catch {
    message.error('图片加载失败')
  } finally {
    loading.value = false
  }
})

// ── Canvas ──────────────────────────────────────────────────────────

function initCanvas() {
  const canvas = canvasRef.value
  const img = imgRef.value
  if (!canvas || !img) return
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  // Start fully transparent — painted areas show as red overlay
}

function getCanvasPos(e: MouseEvent | TouchEvent) {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  }
}

function startDraw(e: MouseEvent | TouchEvent) {
  e.preventDefault()
  isDrawing.value = true
  paintAt(e)
}

function onMove(e: MouseEvent | TouchEvent) {
  if (!isDrawing.value) return
  e.preventDefault()
  paintAt(e)
}

function paintAt(e: MouseEvent | TouchEvent) {
  const canvas = canvasRef.value!
  const ctx = canvas.getContext('2d')!
  const { x, y } = getCanvasPos(e)
  const rect = canvas.getBoundingClientRect()
  const radius = brushSize.value * (canvas.width / rect.width)

  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)

  if (isEraser.value) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = 'rgba(0,0,0,1)'
  } else {
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(255, 60, 60, 0.65)'
  }
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
}

function stopDraw() {
  isDrawing.value = false
}

function clearCanvas() {
  const canvas = canvasRef.value!
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

// Export display canvas → binary black/white mask PNG
async function exportMask(): Promise<Blob> {
  const src = canvasRef.value!
  const off = document.createElement('canvas')
  off.width = src.width
  off.height = src.height
  const ctx = off.getContext('2d')!

  // Fill black (background = preserve)
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, off.width, off.height)

  // Where display canvas has any painted pixel (alpha > 0) → white (repaint)
  const srcData = src.getContext('2d')!.getImageData(0, 0, src.width, src.height)
  const outData = ctx.createImageData(src.width, src.height)
  for (let i = 0; i < srcData.data.length; i += 4) {
    const v = srcData.data[i + 3] > 0 ? 255 : 0
    outData.data[i] = v
    outData.data[i + 1] = v
    outData.data[i + 2] = v
    outData.data[i + 3] = 255
  }
  ctx.putImageData(outData, 0, 0)

  return new Promise<Blob>((resolve) => off.toBlob((b) => resolve(b!), 'image/png'))
}

// ── Submit ──────────────────────────────────────────────────────────

async function handleSubmit() {
  if (!imgRecord.value) return
  const actualMode = activeTab.value === 'klein' ? 'klein' : nswMode.value

  submitting.value = true
  progress.value = 0
  stage.value = 'inpainting'
  resultUrl.value = null

  try {
    const maskBlob = await exportMask()
    const fd = new FormData()
    fd.append('image_id', String(imgRecord.value.id))
    fd.append('mode', actualMode)
    fd.append('prompt', prompt.value)
    if (actualMode !== 'klein') fd.append('denoise', String(denoise.value))
    fd.append('mask', maskBlob, 'mask.png')

    const { data } = await inpaintApi.submit(fd)

    const es = new EventSource(`/api/inpaint/${data.task_id}/progress`)
    es.onmessage = (evt) => {
      const s = JSON.parse(evt.data)
      stage.value = s.stage
      progress.value = s.progress
      if (s.stage === 'done') {
        resultUrl.value = s.image_url
        es.close()
        submitting.value = false
        message.success('重绘完成')
      } else if (s.stage === 'error') {
        message.error(s.error || '重绘失败')
        es.close()
        submitting.value = false
      }
    }
    es.onerror = () => {
      es.close()
      submitting.value = false
      message.error('连接中断')
    }
  } catch {
    message.error('提交失败')
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden" style="background:#0d0d1f;">
    <!-- Header -->
    <div
      class="flex items-center gap-3 px-5 py-3 shrink-0"
      style="background:#111127; border-bottom:1px solid #2a2a4a;"
    >
      <NButton size="small" @click="router.back()">← 返回</NButton>
      <span class="text-sm font-semibold text-white">局部重绘</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <NSpin size="large" />
    </div>

    <!-- Main -->
    <div v-else-if="imgRecord" class="flex flex-1 overflow-hidden">
      <!-- ── Left: Canvas ─────────────────────────────────────────── -->
      <div class="flex-1 flex flex-col overflow-hidden p-4 gap-3 min-w-0">
        <!-- Toolbar -->
        <div class="flex items-center gap-3 shrink-0 flex-wrap">
          <NButton
            size="small"
            :type="!isEraser ? 'primary' : 'default'"
            @click="isEraser = false"
          >画笔</NButton>
          <NButton
            size="small"
            :type="isEraser ? 'primary' : 'default'"
            @click="isEraser = true"
          >橡皮擦</NButton>
          <span class="text-xs text-gray-400">笔刷</span>
          <NSlider v-model:value="brushSize" :min="5" :max="120" style="width:100px;" />
          <span class="text-xs text-gray-500">{{ brushSize }}px</span>
          <NButton size="small" ghost @click="clearCanvas">清除全部</NButton>
          <span class="text-xs text-gray-600 ml-2">红色区域将被重绘</span>
        </div>

        <!-- Canvas wrapper — canvas overlays the image -->
        <div class="flex-1 overflow-auto flex items-center justify-center">
          <div class="relative" style="display:inline-block; line-height:0;">
            <img
              ref="imgRef"
              :src="mediaUrl(imgRecord.filepath)"
              style="display:block; max-width:100%; max-height:calc(100vh - 180px); object-fit:contain;"
              @load="initCanvas"
              alt="source"
            />
            <canvas
              ref="canvasRef"
              class="absolute inset-0 w-full h-full"
              style="cursor:crosshair;"
              @mousedown="startDraw"
              @mousemove="onMove"
              @mouseup="stopDraw"
              @mouseleave="stopDraw"
              @touchstart.prevent="startDraw"
              @touchmove.prevent="onMove"
              @touchend="stopDraw"
            />
          </div>
        </div>
      </div>

      <!-- ── Right: Controls ──────────────────────────────────────── -->
      <div
        class="flex flex-col gap-4 p-4 overflow-y-auto shrink-0"
        style="width:280px; background:#111127; border-left:1px solid #2a2a4a;"
      >
        <!-- Mode tabs -->
        <NTabs v-model:value="activeTab" size="small" type="line">
          <NTabPane name="nsw" tab="NSW修复">
            <div class="flex flex-col gap-3 mt-3">
              <div>
                <p class="text-xs text-gray-400 mb-1">修复模型</p>
                <NSelect
                  v-model:value="nswMode"
                  :options="[
                    { label: 'Flux2-Klein（推荐）', value: 'flux' },
                    { label: 'SDXL-写实', value: 'sdxl' },
                  ]"
                  size="small"
                  @update:value="(v: string) => { denoise = v === 'sdxl' ? 0.5 : 0.45 }"
                />
              </div>
              <div>
                <p class="text-xs text-gray-400 mb-1">追加提示词</p>
                <NInput
                  v-model:value="prompt"
                  type="textarea"
                  :autosize="{ minRows: 2, maxRows: 4 }"
                  placeholder="WD14 自动识别，可补充描述"
                  size="small"
                />
              </div>
              <div>
                <p class="text-xs text-gray-400 mb-1">降噪强度 {{ denoise.toFixed(2) }}</p>
                <NSlider v-model:value="denoise" :min="0.1" :max="0.9" :step="0.05" />
              </div>
            </div>
          </NTabPane>

          <NTabPane name="klein" tab="Klein高分重绘">
            <div class="flex flex-col gap-3 mt-3">
              <div>
                <p class="text-xs text-gray-400 mb-1">重绘指令</p>
                <NInput
                  v-model:value="prompt"
                  type="textarea"
                  :autosize="{ minRows: 3, maxRows: 6 }"
                  placeholder="描述重绘内容，例如：改为夜晚城市街道背景"
                  size="small"
                />
              </div>
              <p class="text-xs text-gray-500">降噪 1.0（全区域重建，保留结构参考）</p>
            </div>
          </NTabPane>
        </NTabs>

        <!-- Progress -->
        <div v-if="submitting" class="flex flex-col gap-2">
          <p class="text-xs text-gray-400">
            {{ stage === 'inpainting' ? '重绘中...' : stage }}
          </p>
          <NProgress
            type="line"
            :percentage="progress"
            :height="16"
            indicator-placement="inside"
          />
        </div>

        <!-- Result -->
        <div v-if="resultUrl" class="flex flex-col gap-2">
          <p class="text-xs text-gray-400">重绘完成</p>
          <img :src="resultUrl" class="w-full rounded-lg" alt="result" />
          <NButton size="small" tag="a" :href="resultUrl" target="_blank" block>
            查看原图
          </NButton>
        </div>

        <!-- Submit -->
        <NButton
          type="primary"
          :loading="submitting"
          :disabled="submitting"
          block
          @click="handleSubmit"
        >
          开始重绘
        </NButton>
      </div>
    </div>

    <div v-else class="flex-1 flex items-center justify-center text-gray-500 text-sm">
      图片不存在
    </div>
  </div>
</template>
