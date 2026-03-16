import http from './http'

export interface MediaItemPreview {
  url: string
  type: 'image' | 'video'
  thumb_url?: string | null
}

export interface ExistingAccount {
  id: string
  person_id?: string | null
  person_name?: string | null
}

export interface ExistingDownload {
  record_id: string
  album_id?: string | null
  media_count: number
  downloaded_at: string
}

export interface ParseResult {
  platform: string
  source_url: string
  username: string
  display_name: string
  title: string
  published_at?: string | null
  media_items: MediaItemPreview[]
  media_count: number
  existing_account?: ExistingAccount | null
  existing_download?: ExistingDownload | null
  extra?: Record<string, string> | null
}

export interface ConfirmRequest {
  platform: string
  source_url: string
  username: string
  display_name: string
  title: string
  published_at?: string | null
  media_items: MediaItemPreview[]
  person_id?: string | null
  create_person_name?: string | null
  album_mode: 'new' | 'existing' | 'loose'
  album_name?: string | null
  existing_album_id?: string | null
  remember_account: boolean
}

export interface ConfirmResponse {
  album_id?: string | null
  person_id?: string | null
  media_count: number
  record_id: string
}

export interface DownloadRecord {
  id: string
  source_url: string
  platform: string
  title?: string | null
  published_at?: string | null
  media_count: number
  album_id?: string | null
  downloaded_at: string
  status: string
  error_message?: string | null
  account_username?: string | null
}

export interface PlatformAccount {
  id: string
  platform: string
  username: string
  display_name?: string | null
  person_id?: string | null
  person_name?: string | null
  created_at: string
}

export interface DownloadInfo {
  source_url: string
  platform: string
  title?: string | null
  published_at?: string | null
  display_name?: string | null
  username?: string | null
  downloaded_at: string
}

// ── Batch scan types ─────────────────────────────────────────────────────────

export interface ScanJobStatus {
  job_id: string
  status: 'scanning' | 'scan_complete' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  platform: string
  username: string
  display_name: string
  total_notes: number
  skipped_notes: number
  total_media: number
  completed_notes: number
  failed_notes: number
  downloaded_media: number
  notes?: NotePreview[] | null
  error?: string | null
}

export interface NotePreview {
  note_id: string
  url: string
  title: string
  media_count: number
  cover_url?: string | null
  published_at?: string | null
  note_type: string
}

export interface BatchConfirmRequest {
  job_id: string
  person_id?: string | null
  create_person_name?: string | null
  album_mode: 'per_note' | 'loose'
  remember_account: boolean
}

export const downloadApi = {
  parse: (raw_text: string) =>
    http.post<ParseResult>('/download/parse', { raw_text }, { timeout: 120000 }).then(r => r.data),

  confirm: (body: ConfirmRequest) =>
    http.post<ConfirmResponse>('/download/confirm', body, { timeout: 120000 }).then(r => r.data),

  listRecords: (page = 1, pageSize = 20, platform?: string) =>
    http.get<DownloadRecord[]>('/download/records', {
      params: { page, page_size: pageSize, platform },
    }).then(r => r.data),

  retryRecord: (id: string) =>
    http.post<{ status: string; media_count: number }>(`/download/records/${id}/retry`).then(r => r.data),

  listAccounts: () =>
    http.get<PlatformAccount[]>('/download/platform-accounts').then(r => r.data),

  updateAccount: (id: string, person_id: string | null) =>
    http.patch(`/download/platform-accounts/${id}`, { person_id }),

  deleteAccount: (id: string) =>
    http.delete(`/download/platform-accounts/${id}`),

  getInfoByAlbum: (albumId: string) =>
    http.get<DownloadInfo | null>(`/download/info-by-album/${albumId}`).then(r => r.data),

  // ── Batch scan & download ────────────────────────────────────────────────

  scanAccount: (platform: string, username: string, display_name?: string) =>
    http.post<{ job_id: string }>('/download/scan-account', { platform, username, display_name }).then(r => r.data),

  getScanJob: (jobId: string) =>
    http.get<ScanJobStatus>(`/download/scan-jobs/${jobId}`).then(r => r.data),

  batchConfirm: (body: BatchConfirmRequest) =>
    http.post<{ job_id: string; status: string }>('/download/batch-confirm', body).then(r => r.data),

  cancelScanJob: (jobId: string) =>
    http.post(`/download/scan-jobs/${jobId}/cancel`).then(r => r.data),
}
