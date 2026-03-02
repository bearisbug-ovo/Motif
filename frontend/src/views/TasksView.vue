<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { NButton, NProgress, NTag, NEmpty, NPopconfirm, useMessage } from 'naive-ui'
import { generateApi, type TaskMeta } from '@/api/generate'

const message = useMessage()
const tasks = ref<TaskMeta[]>([])
let pollTimer: ReturnType<typeof setInterval> | null = null

async function loadTasks() {
  try {
    const { data } = await generateApi.list()
    tasks.value = data
  } catch { /* ignore */ }
}

async function handleDelete(taskId: string) {
  try {
    await generateApi.remove(taskId)
    tasks.value = tasks.value.filter(t => t.task_id !== taskId)
    message.success('已移除')
  } catch (e: any) {
    message.error(e?.response?.data?.detail ?? '移除失败')
  }
}

async function clearDone() {
  const done = tasks.value.filter(t => t.stage === 'done' || t.stage === 'error')
  await Promise.all(done.map(t => generateApi.remove(t.task_id).catch(() => {})))
  tasks.value = tasks.value.filter(t => t.stage !== 'done' && t.stage !== 'error')
  message.success('已清除已完成任务')
}

const hasRunning = computed(() => tasks.value.some(t => !['done', 'error'].includes(t.stage)))
const hasDone = computed(() => tasks.value.some(t => t.stage === 'done' || t.stage === 'error'))

onMounted(() => {
  loadTasks()
  // Poll when there are active tasks
  pollTimer = setInterval(() => {
    if (hasRunning.value) loadTasks()
  }, 2000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

// ── Helpers ────────────────────────────────────────────────────────

const STAGE_LABEL: Record<string, string> = {
  pending: '等待中',
  preprocessing: '提取人脸',
  generating: '生成中',
  faceswapping: '换脸中',
  upscaling: '高清放大',
  done: '完成',
  error: '出错',
}

const STAGE_COLOR: Record<string, string> = {
  pending: '#6b7280',
  preprocessing: '#a78bfa',
  generating: '#818cf8',
  faceswapping: '#fb923c',
  upscaling: '#34d399',
  done: '#22c55e',
  error: '#ef4444',
}

function stageType(stage: string): 'default' | 'info' | 'success' | 'warning' | 'error' {
  if (stage === 'done') return 'success'
  if (stage === 'error') return 'error'
  if (stage === 'pending') return 'default'
  return 'info'
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function isActive(stage: string) {
  return !['done', 'error'].includes(stage)
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- 标题栏 -->
    <div
      class="flex items-center justify-between px-5 py-3 shrink-0"
      style="background:#111127; border-bottom:1px solid #2a2a4a;"
    >
      <span class="text-sm font-semibold text-white">任务队列</span>
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-500">{{ tasks.length }} 个任务</span>
        <NButton
          v-if="hasDone"
          size="small"
          ghost
          @click="clearDone"
        >清除已完成</NButton>
        <NButton size="small" ghost @click="loadTasks">刷新</NButton>
      </div>
    </div>

    <!-- 任务列表 -->
    <div class="flex-1 overflow-y-auto p-4">
      <NEmpty v-if="tasks.length === 0" description="暂无任务" class="mt-20" />

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="task in tasks"
          :key="task.task_id"
          class="rounded-xl p-3 flex gap-3"
          style="background:#1a1a32; border:1px solid #2a2a4a;"
        >
          <!-- 结果缩略图 -->
          <div
            class="shrink-0 rounded-lg overflow-hidden flex items-center justify-center"
            style="width:72px; height:72px; background:#111127;"
          >
            <img
              v-if="task.image_url"
              :src="task.image_url"
              class="w-full h-full object-cover"
              alt=""
            />
            <div v-else-if="task.stage === 'error'" class="text-2xl">✕</div>
            <div v-else class="text-xs text-gray-600 text-center px-1">
              {{ isActive(task.stage) ? '生成中' : '—' }}
            </div>
          </div>

          <!-- 信息区 -->
          <div class="flex-1 min-w-0 flex flex-col gap-1.5">
            <!-- 第一行：人物 + 阶段标签 + 时间 -->
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-medium text-white truncate max-w-[120px]">
                {{ task.character_name ?? '无人物' }}
              </span>
              <NTag
                size="tiny"
                :type="stageType(task.stage)"
                :bordered="false"
              >{{ STAGE_LABEL[task.stage] ?? task.stage }}</NTag>
              <NTag v-if="task.faceswap" size="tiny" :bordered="false" style="background:#312e81; font-size:10px;">换脸</NTag>
              <NTag v-if="task.upscale" size="tiny" :bordered="false" style="background:#14532d; font-size:10px;">放大</NTag>
              <NTag size="tiny" :bordered="false" style="background:#1e293b; font-size:10px;">
                {{ task.model === 'turbo' ? 'Turbo' : 'Base' }}
              </NTag>
              <span class="text-[10px] text-gray-600 ml-auto shrink-0">{{ formatTime(task.created_at) }}</span>
            </div>

            <!-- Prompt 预览 -->
            <p class="text-[11px] text-gray-400 truncate">{{ task.prompt }}</p>

            <!-- 进度条（运行中） -->
            <div v-if="isActive(task.stage)" class="flex items-center gap-2">
              <NProgress
                :percentage="task.progress"
                :color="STAGE_COLOR[task.stage]"
                :rail-color="'#2a2a4a'"
                :height="4"
                :show-indicator="false"
                class="flex-1"
              />
              <span class="text-[10px] text-gray-500 shrink-0">{{ task.progress }}%</span>
            </div>

            <!-- 错误信息 -->
            <p v-if="task.stage === 'error'" class="text-[11px]" style="color:#ef4444;">
              {{ task.error }}
            </p>
          </div>

          <!-- 操作按钮 -->
          <div class="shrink-0 flex flex-col gap-1 justify-start">
            <NButton
              v-if="task.image_url"
              size="tiny"
              tag="a"
              :href="task.image_url"
              target="_blank"
            >查看</NButton>
            <NPopconfirm
              v-if="!isActive(task.stage)"
              @positive-click="handleDelete(task.task_id)"
            >
              <template #trigger>
                <NButton size="tiny" ghost>移除</NButton>
              </template>
              移除此记录？
            </NPopconfirm>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
