import { create } from 'zustand'
import { downloadApi, ParseResult, DownloadRecord, PlatformAccount, ConfirmRequest, ScanJobStatus, BatchConfirmRequest } from '@/api/downloads'

interface DownloadStore {
  parseResult: ParseResult | null
  parsing: boolean
  parseError: string | null
  downloading: boolean
  records: DownloadRecord[]
  accounts: PlatformAccount[]
  recordsLoading: boolean

  // Batch scan state
  scanJob: ScanJobStatus | null
  scanning: boolean

  parseUrl: (text: string) => Promise<void>
  clearParseResult: () => void
  confirmDownload: (body: ConfirmRequest) => Promise<{ album_id?: string | null; person_id?: string | null; media_count: number }>
  fetchRecords: (page?: number) => Promise<void>
  retryRecord: (id: string) => Promise<void>
  fetchAccounts: () => Promise<void>

  // Batch scan actions
  startScan: (platform: string, username: string, displayName?: string) => Promise<void>
  pollScanJob: (jobId: string) => Promise<void>
  confirmBatch: (body: BatchConfirmRequest) => Promise<void>
  cancelScan: () => Promise<void>
  clearScanJob: () => void
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  parseResult: null,
  parsing: false,
  parseError: null,
  downloading: false,
  records: [],
  accounts: [],
  recordsLoading: false,
  scanJob: null,
  scanning: false,

  parseUrl: async (text: string) => {
    set({ parsing: true, parseError: null, parseResult: null })
    try {
      const result = await downloadApi.parse(text)
      set({ parseResult: result, parsing: false })
    } catch (e: any) {
      set({ parsing: false, parseError: e.message || '解析失败' })
      throw e
    }
  },

  clearParseResult: () => set({ parseResult: null, parseError: null }),

  confirmDownload: async (body: ConfirmRequest) => {
    set({ downloading: true })
    try {
      const result = await downloadApi.confirm(body)
      set({ downloading: false, parseResult: null })
      return result
    } catch (e) {
      set({ downloading: false })
      throw e
    }
  },

  fetchRecords: async (page = 1) => {
    set({ recordsLoading: true })
    try {
      const records = await downloadApi.listRecords(page)
      set({ records, recordsLoading: false })
    } catch {
      set({ recordsLoading: false })
    }
  },

  retryRecord: async (id: string) => {
    await downloadApi.retryRecord(id)
    await get().fetchRecords()
  },

  fetchAccounts: async () => {
    const accounts = await downloadApi.listAccounts()
    set({ accounts })
  },

  startScan: async (platform, username, displayName) => {
    set({ scanning: true, scanJob: null })
    try {
      const { job_id } = await downloadApi.scanAccount(platform, username, displayName)
      // Start polling
      get().pollScanJob(job_id)
    } catch (e: any) {
      set({ scanning: false })
      throw e
    }
  },

  pollScanJob: async (jobId: string) => {
    const poll = async () => {
      try {
        const job = await downloadApi.getScanJob(jobId)
        set({ scanJob: job })

        if (job.status === 'scanning' || job.status === 'downloading') {
          setTimeout(poll, 2000)
        } else {
          set({ scanning: false })
        }
      } catch {
        set({ scanning: false })
      }
    }
    poll()
  },

  confirmBatch: async (body: BatchConfirmRequest) => {
    const { job_id } = await downloadApi.batchConfirm(body)
    set({ scanning: true })
    get().pollScanJob(job_id)
  },

  cancelScan: async () => {
    const job = get().scanJob
    if (job) {
      await downloadApi.cancelScanJob(job.job_id)
      set({ scanning: false, scanJob: null })
    }
  },

  clearScanJob: () => set({ scanJob: null, scanning: false }),
}))
