import http from './http'

export interface GenerateRequest {
  character_id?: number | null
  prompt: string
  model: 'turbo' | 'base'
  width?: number
  height?: number
  seed?: number
  faceswap?: boolean
  upscale?: boolean
}

export interface TaskStatus {
  task_id: string
  stage: 'pending' | 'preprocessing' | 'generating' | 'faceswapping' | 'upscaling' | 'done' | 'error'
  progress: number
  image_url: string | null
  error: string | null
}

export interface TaskMeta extends TaskStatus {
  character_id: number | null
  character_name: string | null
  prompt: string
  model: string
  faceswap: boolean
  upscale: boolean
  created_at: string
}

export const generateApi = {
  submit: (data: GenerateRequest) => http.post<{ task_id: string }>('/generate', data),
  list: () => http.get<TaskMeta[]>('/generate'),
  getStatus: (taskId: string) => http.get<TaskStatus>(`/generate/${taskId}`),
  remove: (taskId: string) => http.delete(`/generate/${taskId}`),
}
