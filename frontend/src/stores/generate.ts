import { defineStore } from 'pinia'
import { ref } from 'vue'
import { generateApi, type GenerateRequest, type TaskStatus } from '@/api/generate'

const STAGE_LABELS: Record<string, string> = {
  pending: '等待中',
  preprocessing: '提取人脸中',
  generating: '生成中',
  faceswapping: '换脸中',
  upscaling: '高清放大中',
  done: '完成',
  error: '出错',
}

export const useGenerateStore = defineStore('generate', () => {
  const isRunning = ref(false)
  const stage = ref('')
  const stageLabel = ref('')
  const progress = ref(0)
  const imageUrl = ref<string | null>(null)
  const errorMsg = ref<string | null>(null)
  const resultImages = ref<string[]>([])

  let eventSource: EventSource | null = null

  function reset() {
    stage.value = ''
    stageLabel.value = ''
    progress.value = 0
    imageUrl.value = null
    errorMsg.value = null
  }

  async function submit(params: GenerateRequest) {
    reset()
    isRunning.value = true

    const { data } = await generateApi.submit(params)
    const taskId = data.task_id

    // Close any previous SSE connection
    if (eventSource) { eventSource.close(); eventSource = null }

    eventSource = new EventSource(`/api/generate/${taskId}/progress`)

    eventSource.onmessage = (e) => {
      const status: TaskStatus = JSON.parse(e.data)
      stage.value = status.stage
      stageLabel.value = STAGE_LABELS[status.stage] ?? status.stage
      progress.value = status.progress

      if (status.stage === 'done') {
        if (status.image_url) {
          imageUrl.value = status.image_url
          resultImages.value.unshift(status.image_url)
        }
        isRunning.value = false
        eventSource?.close()
      } else if (status.stage === 'error') {
        errorMsg.value = status.error ?? '生成失败'
        isRunning.value = false
        eventSource?.close()
      }
    }

    eventSource.onerror = () => {
      errorMsg.value = '连接中断，请刷新后重试'
      isRunning.value = false
      eventSource?.close()
    }
  }

  return {
    isRunning, stage, stageLabel, progress,
    imageUrl, errorMsg, resultImages,
    submit, reset,
  }
})
