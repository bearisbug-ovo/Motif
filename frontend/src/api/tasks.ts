import http from './http'

export interface TaskItem {
  id: string
  workflow_type: string
  params: Record<string, any>
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  queue_order: number
  execution_mode: 'immediate' | 'queued'
  result_media_ids: string[]
  result_outputs: Record<string, any>
  error_message: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface TaskProgress {
  task_id: string
  value: number
  max: number
}

export interface TaskStats {
  running: number
  failed: number
  pending: number
  completed_since_last_view: number
  progress: TaskProgress | null
}

export interface QueueConfig {
  start_mode: 'manual' | 'auto' | 'cron' | 'delay'
  cron_expression: string | null
  delay_minutes: number | null
  is_paused: boolean
  updated_at: string
}

export interface TaskCreateBody {
  workflow_type: string
  params: Record<string, any>
  execution_mode?: 'immediate' | 'queued'
}

export interface BatchFaceSwapBody {
  album_id: string
  face_ref_media_id: string
  target_person_id?: string
  count?: number
  result_album_name?: string
}

export const tasksApi = {
  create: (body: TaskCreateBody) =>
    http.post<TaskItem>('/tasks', body).then(r => r.data),

  list: (status?: string) =>
    http.get<TaskItem[]>('/tasks', { params: status ? { status } : {} }).then(r => r.data),

  getStats: () =>
    http.get<TaskStats>('/tasks/stats').then(r => r.data),

  resetStats: () =>
    http.post('/tasks/stats/reset').then(r => r.data),

  get: (id: string) =>
    http.get<TaskItem>(`/tasks/${id}`).then(r => r.data),

  patch: (id: string, body: { params?: Record<string, any>; queue_order?: number }) =>
    http.patch<TaskItem>(`/tasks/${id}`, body).then(r => r.data),

  cancel: (id: string) =>
    http.post<TaskItem>(`/tasks/${id}/cancel`).then(r => r.data),

  retry: (id: string) =>
    http.post<TaskItem>(`/tasks/${id}/retry`).then(r => r.data),

  delete: (id: string) =>
    http.delete(`/tasks/${id}`),

  reorder: (taskIds: string[]) =>
    http.patch<{ ok: boolean }>('/tasks/reorder', { task_ids: taskIds }).then(r => r.data),

  batchFaceSwap: (body: BatchFaceSwapBody) =>
    http.post<{ result_album_id: string; tasks_created: number }>('/tasks/batch-faceswap', body).then(r => r.data),

  // Queue control
  startQueue: () =>
    http.post<{ ok: boolean; pending: number }>('/queue/start').then(r => r.data),

  getQueueConfig: () =>
    http.get<QueueConfig>('/queue/config').then(r => r.data),

  updateQueueConfig: (body: Partial<QueueConfig>) =>
    http.put<QueueConfig>('/queue/config', body).then(r => r.data),
}
