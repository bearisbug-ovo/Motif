import http from './http'

export interface InpaintTask {
  task_id: string
  stage: string
  progress: number
  image_url: string | null
  error: string | null
}

export const inpaintApi = {
  submit: (form: FormData) =>
    http.post<{ task_id: string }>('/inpaint', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  status: (taskId: string) =>
    http.get<InpaintTask>(`/inpaint/${taskId}`),
}
