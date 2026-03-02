<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NSelect, NInput, NSwitch, NButton, NProgress, NSpin,
  NEmpty, NTooltip, useMessage,
} from 'naive-ui'
import { useGenerateStore } from '@/stores/generate'
import { useCharactersStore } from '@/stores/characters'

const message = useMessage()
const route = useRoute()
const genStore = useGenerateStore()
const charStore = useCharactersStore()

onMounted(() => charStore.fetchAll())

// Pre-select character from query param (?char=id)
watch(() => charStore.list, (list) => {
  const charParam = route.query.char
  if (charParam && list.length > 0 && !selectedCharId.value) {
    const id = Number(charParam)
    if (list.find(c => c.id === id)) selectedCharId.value = id
  }
}, { immediate: true })

// ── 表单状态 ──────────────────────────────────
const selectedCharId = ref<number | null>(null)
const prompt = ref('一位年轻女性，半身人像，咖啡馆窗边，自然光，真实摄影风格')
const model = ref<'turbo' | 'base'>('turbo')
const faceswap = ref(false)
const upscale = ref(false)

const charOptions = computed(() =>
  charStore.list.map(c => ({ label: c.name, value: c.id }))
)

// Faceswap is available whenever a character is selected.
// If the character has no face_crop_nobg yet, preprocessing runs automatically
// as Stage 0 of the pipeline.
const canFaceswap = computed(() => !!selectedCharId.value)

// ── 进度展示 ──────────────────────────────────
const stageColor = computed(() => {
  const m: Record<string, string> = {
    generating: '#818cf8', faceswapping: '#fb923c',
    upscaling: '#34d399', done: '#22c55e', error: '#ef4444',
  }
  return m[genStore.stage] ?? '#818cf8'
})

const progressStatus = computed(() => {
  if (genStore.stage === 'error') return 'error'
  if (genStore.stage === 'done') return 'success'
  return 'default'
})

function openResultImage() {
  if (genStore.imageUrl) window.open(genStore.imageUrl, '_blank')
}

// ── 提交 ─────────────────────────────────────
async function handleSubmit() {
  if (!prompt.value.trim()) { message.warning('请输入描述提示词'); return }
  try {
    await genStore.submit({
      character_id: selectedCharId.value,
      prompt: prompt.value,
      model: model.value,
      faceswap: faceswap.value && canFaceswap.value,
      upscale: upscale.value,
    })
  } catch (e: any) {
    message.error('提交失败：' + (e?.message ?? '未知错误'))
  }
}
</script>

<template>
  <div class="flex h-full overflow-hidden">
    <!-- ── 左侧参数面板 ───────────────────────── -->
    <div
      class="flex flex-col gap-4 p-5 overflow-y-auto shrink-0"
      style="width:320px; background:#111127; border-right:1px solid #2a2a4a;"
    >
      <h2 class="text-base font-semibold text-white">生成参数</h2>

      <!-- 人物选择 -->
      <div class="flex flex-col gap-1.5">
        <label class="text-xs text-gray-400">人物（可选）</label>
        <NSelect
          v-model:value="selectedCharId"
          :options="charOptions"
          placeholder="不限人物"
          clearable
          size="small"
        />
      </div>

      <!-- Prompt -->
      <div class="flex flex-col gap-1.5">
        <label class="text-xs text-gray-400">描述提示词</label>
        <NInput
          v-model:value="prompt"
          type="textarea"
          placeholder="用自然语言描述画面..."
          :autosize="{ minRows: 4, maxRows: 8 }"
          size="small"
        />
      </div>

      <!-- 模型选择 -->
      <div class="flex flex-col gap-1.5">
        <label class="text-xs text-gray-400">生成模型</label>
        <div class="flex gap-2">
          <button
            v-for="m in [
              { v: 'turbo', label: 'Turbo', tip: '8步，快速迭代' },
              { v: 'base',  label: 'Base（ZIB）', tip: '10步，精修出图' },
            ]"
            :key="m.v"
            class="flex-1 py-1.5 rounded text-xs font-medium transition-all"
            :style="model === m.v
              ? 'background:#818cf8; color:#fff;'
              : 'background:#1a1a32; color:#94a3b8; border:1px solid #2a2a4a;'"
            @click="model = m.v as 'turbo' | 'base'"
          >
            {{ m.label }}
            <span class="block text-[10px] opacity-70">{{ m.tip }}</span>
          </button>
        </div>
      </div>

      <!-- 换脸开关 -->
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs text-gray-300">换脸</p>
          <p class="text-[10px] text-gray-500">用人物参考图替换脸部</p>
        </div>
        <NTooltip v-if="!canFaceswap" trigger="hover">
          <template #trigger>
            <NSwitch v-model:value="faceswap" :disabled="!canFaceswap" size="small" />
          </template>
          请先选择人物
        </NTooltip>
        <NSwitch v-else v-model:value="faceswap" size="small" />
      </div>

      <!-- 高清放大开关 -->
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs text-gray-300">高清放大</p>
          <p class="text-[10px] text-gray-500">2× 放大，增强细节</p>
        </div>
        <NSwitch v-model:value="upscale" size="small" />
      </div>

      <!-- 提交 -->
      <NButton
        type="primary"
        block
        :loading="genStore.isRunning"
        :disabled="genStore.isRunning"
        style="margin-top:auto;"
        @click="handleSubmit"
      >
        {{ genStore.isRunning ? genStore.stageLabel + '...' : '开始生成' }}
      </NButton>
    </div>

    <!-- ── 右侧结果区 ─────────────────────────── -->
    <div class="flex-1 flex flex-col overflow-hidden p-5 gap-4">
      <h2 class="text-base font-semibold text-white shrink-0">生成结果</h2>

      <!-- 进度条 -->
      <div
        v-if="genStore.isRunning || genStore.stage === 'done' || genStore.stage === 'error'"
        class="shrink-0"
      >
        <div class="flex justify-between text-xs mb-1.5">
          <span :style="{ color: stageColor }">{{ genStore.stageLabel || '处理中' }}</span>
          <span class="text-gray-500">{{ genStore.progress }}%</span>
        </div>
        <NProgress
          :percentage="genStore.progress"
          :status="progressStatus"
          :color="stageColor"
          :rail-color="'#2a2a4a'"
          :height="6"
        />
        <p v-if="genStore.stage === 'error'" class="text-xs mt-2" style="color:#ef4444;">
          {{ genStore.errorMsg }}
        </p>
      </div>

      <!-- 结果图 -->
      <div class="flex-1 overflow-hidden flex flex-col gap-3">
        <div
          v-if="genStore.imageUrl"
          class="flex-1 min-h-0 flex items-center justify-center rounded-xl overflow-hidden cursor-pointer"
          style="background:#1a1a32; border:1px solid #2a2a4a;"
          @click="openResultImage"
        >
          <img
            :src="genStore.imageUrl"
            class="max-h-full max-w-full object-contain rounded"
            alt="生成结果"
          />
        </div>
        <div
          v-else
          class="flex-1 flex items-center justify-center rounded-xl"
          style="background:#1a1a32; border:1px solid #2a2a4a;"
        >
          <NSpin v-if="genStore.isRunning" size="large" />
          <NEmpty v-else description="填写参数后点击「开始生成」" />
        </div>

        <!-- 历史缩略图 -->
        <div v-if="genStore.resultImages.length > 1" class="flex gap-2 shrink-0 overflow-x-auto pb-1">
          <img
            v-for="(url, i) in genStore.resultImages.slice(0, 10)"
            :key="i"
            :src="url"
            class="h-16 w-16 object-cover rounded cursor-pointer shrink-0"
            style="border:2px solid #2a2a4a;"
            :style="url === genStore.imageUrl ? 'border-color:#818cf8;' : ''"
            @click="genStore.imageUrl = url"
          />
        </div>
      </div>
    </div>
  </div>
</template>
