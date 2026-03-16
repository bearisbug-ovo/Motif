import { useState, useEffect, useRef, useMemo } from 'react'
import { FolderOpen, FileImage, Loader2, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { mediaApi } from '@/api/media'
import { albumsApi } from '@/api/albums'
import { systemApi } from '@/api/system'
import { usePersonStore } from '@/stores/person'
import { useAlbumStore } from '@/stores/album'
import { toast } from '@/hooks/use-toast'
import { isTouch } from '@/hooks/useDevice'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  defaultPersonId?: string
  defaultAlbumId?: string
  onComplete?: () => void
}

type PersonMode = 'none' | 'existing' | 'new'
type AlbumMode = 'none' | 'existing' | 'new'

interface MediaFileConfig {
  path: string
  name: string
  media_type: string
  existing: boolean
  enabled: boolean
  personMode: PersonMode
  selectedPersonId: string
  newPersonName: string
  albumMode: AlbumMode
  selectedAlbumId: string
  newAlbumName: string
}

interface SubfolderConfig {
  name: string
  path: string
  mediaCount: number
  existingCount: number
  enabled: boolean
  personMode: PersonMode
  selectedPersonId: string
  newPersonName: string
  albumMode: AlbumMode
  selectedAlbumId: string
  newAlbumName: string
  mediaFiles?: MediaFileConfig[]  // per-media configs when drilled into
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatImportResult(imported: number, skipped: number): string {
  const parts: string[] = []
  if (imported > 0) parts.push(`${imported} 个文件已导入`)
  if (skipped > 0) parts.push(`${skipped} 个已存在已跳过`)
  if (parts.length === 0) return '没有新文件需要导入'
  return parts.join('，')
}

export function ImportDialog({ open, onOpenChange, defaultPersonId, defaultAlbumId, onComplete }: ImportDialogProps) {
  const { persons, fetchPersons, createPerson } = usePersonStore()
  const { albums, fetchAlbumsByPerson, createAlbum } = useAlbumStore()

  const isMobile = isTouch

  const [selectedPath, setSelectedPath] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [personMode, setPersonMode] = useState<PersonMode>('new')
  const [selectedPersonId, setSelectedPersonId] = useState(defaultPersonId || '')
  const [newPersonName, setNewPersonName] = useState('')
  const [albumMode, setAlbumMode] = useState<AlbumMode>('new')
  const [selectedAlbumId, setSelectedAlbumId] = useState(defaultAlbumId || '')
  const [newAlbumName, setNewAlbumName] = useState('')

  // Mobile file upload
  const [mobileFiles, setMobileFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Subfolder mode
  const [subfolders, setSubfolders] = useState<SubfolderConfig[]>([])
  const [hasSubfolders, setHasSubfolders] = useState(false)
  const [checkingSubfolders, setCheckingSubfolders] = useState(false)

  // Import mode: unified | per-folder | per-media
  type ImportMode = 'unified' | 'per-folder' | 'per-media'
  const [importMode, setImportMode] = useState<ImportMode>('unified')

  // Scan info for single folder/file mode
  const [scanInfo, setScanInfo] = useState<{ total: number; existing: number } | null>(null)

  // Per-media table
  const [mediaFiles, setMediaFiles] = useState<MediaFileConfig[]>([])
  const [loadingMediaFiles, setLoadingMediaFiles] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [perMediaSubfolderIdx, setPerMediaSubfolderIdx] = useState<number | null>(null)  // which subfolder is drilled into

  // Import progress
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, current: '' })
  const [activeToken, setActiveToken] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      fetchPersons()
      setSelectedPath('')
      setSelectedFiles([])
      setMobileFiles([])
      if (defaultPersonId) {
        setPersonMode('existing')
        setSelectedPersonId(defaultPersonId)
      } else {
        setPersonMode('new')
        setSelectedPersonId('')
      }
      setNewPersonName('')
      if (defaultAlbumId) {
        setAlbumMode('existing')
        setSelectedAlbumId(defaultAlbumId)
      } else if (defaultPersonId) {
        // Importing from a person page without a specific album → default to loose media
        setAlbumMode('none')
        setSelectedAlbumId('')
      } else {
        setAlbumMode('new')
        setSelectedAlbumId('')
      }
      setNewAlbumName('')
      setSubfolders([])
      setHasSubfolders(false)
      setImportMode('unified')
      setMediaFiles([])
      setLoadingMediaFiles(false)
      setPreviewPath(null)
      setPerMediaSubfolderIdx(null)
      setScanInfo(null)
      setImporting(false)
      setImportProgress({ done: 0, total: 0, current: '' })
      newlyCreatedAlbumIds.current.clear()
    }
  }, [open, defaultPersonId, defaultAlbumId, fetchPersons])

  useEffect(() => {
    const pid = personMode === 'existing' ? selectedPersonId : ''
    if (pid) fetchAlbumsByPerson(pid)
  }, [selectedPersonId, personMode, fetchAlbumsByPerson])

  const getFolderName = (p: string) => {
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts[parts.length - 1] || ''
  }

  const getRelativePath = (fullPath: string) => {
    if (!selectedPath) return fullPath
    const root = selectedPath.replace(/\\/g, '/').replace(/\/$/, '')
    const full = fullPath.replace(/\\/g, '/').replace(/\/$/, '')
    if (full === root) return '.'
    if (full.startsWith(root + '/')) {
      return full.slice(root.length + 1)
    }
    return full
  }

  const isRootEntry = (sfPath: string) => {
    if (!selectedPath) return false
    const root = selectedPath.replace(/\\/g, '/').replace(/\/$/, '')
    const full = sfPath.replace(/\\/g, '/').replace(/\/$/, '')
    return full === root
  }

  /** Split a folder name by the first separator (_, -, or space) into [personName, albumName].
   *  If no separator found, both default to the full name. */
  const splitFolderName = (name: string): { personName: string; albumName: string } => {
    const match = name.match(/^([^_\- ]+)[_\- ](.+)$/)
    if (match) {
      return { personName: match[1].trim(), albumName: match[2].trim() }
    }
    return { personName: name, albumName: name }
  }

  const handlePickFolder = async () => {
    try {
      const { path } = await systemApi.pickFolder()
      if (path) await applySelectedPath(path)
    } catch {
      toast({ title: '无法打开文件夹选择器', variant: 'destructive' })
    }
  }

  const handlePickFiles = async () => {
    try {
      const { paths } = await systemApi.pickFiles()
      if (paths.length > 0) {
        setSelectedFiles(paths)
        setSelectedPath('')
        setSubfolders([])
        setHasSubfolders(false)
        setImportMode('unified')
        setMediaFiles([])
        setPerMediaSubfolderIdx(null)
        setScanInfo(null)
        // Scan selected files for duplicates
        mediaApi.scanPaths(paths, false).then(({ results }) => {
          const summary = results.find(r => r.path === '_total')
          if (summary) {
            setScanInfo({ total: summary.total, existing: summary.existing })
          } else if (results.length === 1) {
            setScanInfo(results[0])
          }
        }).catch(() => {})
        const firstPath = paths[0].replace(/\\/g, '/')
        const parentFolder = firstPath.split('/').slice(0, -1).pop() || ''
        const { personName: splitPerson, albumName: splitAlbum } = splitFolderName(parentFolder)
        if (!defaultPersonId) {
          const currentPersons = usePersonStore.getState().persons
          const matchedPerson = currentPersons.find((p) => p.name.toLowerCase() === splitPerson.toLowerCase())
          if (matchedPerson) {
            setPersonMode('existing')
            setSelectedPersonId(matchedPerson.id)
          } else if (personMode === 'new') {
            setNewPersonName(splitPerson)
          }
        }
        if (!defaultAlbumId && !defaultPersonId && albumMode === 'new') {
          setNewAlbumName(splitAlbum)
        }
      }
    } catch {
      toast({ title: '无法打开文件选择器', variant: 'destructive' })
    }
  }

  const handleMobileFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      setMobileFiles(files)
      setSelectedPath('')
      setSelectedFiles([])
      setSubfolders([])
      setHasSubfolders(false)
    }
    // Reset input so re-selecting the same files works
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const mobileFilesInfo = useMemo(() => {
    if (mobileFiles.length === 0) return null
    const totalSize = mobileFiles.reduce((sum, f) => sum + f.size, 0)
    return { count: mobileFiles.length, totalSize }
  }, [mobileFiles])

  const applySelectedPath = async (path: string) => {
    setSelectedPath(path)
    setSelectedFiles([])
    setMobileFiles([])
    setSubfolders([])
    setHasSubfolders(false)
    setMediaFiles([])
    setPerMediaSubfolderIdx(null)

    const folderName = getFolderName(path)
    const { personName: splitPerson, albumName: splitAlbum } = splitFolderName(folderName)
    if (!defaultPersonId) {
      // Auto-match existing person by name
      const currentPersons = usePersonStore.getState().persons
      const matchedPerson = currentPersons.find((p) => p.name.toLowerCase() === splitPerson.toLowerCase())
      if (matchedPerson) {
        setPersonMode('existing')
        setSelectedPersonId(matchedPerson.id)
      } else if (personMode === 'new') {
        setNewPersonName(splitPerson)
      }
    }
    if (!defaultAlbumId && !defaultPersonId && albumMode === 'new') {
      setNewAlbumName(splitAlbum)
    }

    setCheckingSubfolders(true)
    setScanInfo(null)
    try {
      const { subfolders: subs } = await systemApi.listSubfolders(path)
      // If more than 1 entry (or 1 entry that's not the root itself), use subfolder mode
      const rootPath = path.replace(/\\/g, '/').replace(/\/$/, '')
      const nonRootSubs = subs.filter(s => s.path.replace(/\\/g, '/').replace(/\/$/, '') !== rootPath)
      // Always run a unified (recursive) scan for total counts
      mediaApi.scanPaths([path], true).then(({ results }) => {
        if (results.length > 0) setScanInfo(results[0])
      }).catch(() => {})

      if (nonRootSubs.length > 0) {
        setHasSubfolders(true)
        setImportMode('per-folder')
        const currentPersons = usePersonStore.getState().persons
        const initialConfigs = subs.map((s) => {
          const { personName, albumName } = splitFolderName(s.name)
          const matchedPerson = !defaultPersonId
            ? currentPersons.find((p) => p.name.toLowerCase() === personName.toLowerCase())
            : undefined
          return {
            name: s.name,
            path: s.path,
            mediaCount: s.media_count,
            existingCount: 0,
            enabled: true,
            personMode: defaultPersonId ? 'existing' as PersonMode
              : matchedPerson ? 'existing' as PersonMode
              : 'new' as PersonMode,
            selectedPersonId: defaultPersonId || matchedPerson?.id || '',
            newPersonName: personName,
            albumMode: 'new' as AlbumMode,
            selectedAlbumId: '',
            newAlbumName: albumName,
          }
        })
        setSubfolders(initialConfigs)
        // Scan per-folder duplicates in background (for per-folder mode)
        mediaApi.scanPaths(subs.map(s => s.path), false).then(({ results }) => {
          setSubfolders(prev => prev.map(sf => {
            const scan = results.find(r => r.path === sf.path)
            if (!scan) return sf
            // Auto-disable subfolders where all media are already imported
            const allExisting = scan.existing >= scan.total && scan.total > 0
            return { ...sf, mediaCount: scan.total, existingCount: scan.existing, enabled: allExisting ? false : sf.enabled }
          }))
        }).catch(() => {})
      } else {
        setHasSubfolders(false)
        setImportMode('unified')
      }
    } catch {
      // ignore
    } finally {
      setCheckingSubfolders(false)
    }
  }

  const updateSubfolder = (idx: number, patch: Partial<SubfolderConfig>) => {
    setSubfolders((prev) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  // Track newly created album IDs so we can clean up empty ones after import
  const newlyCreatedAlbumIds = useRef<Set<string>>(new Set())

  /** Find an existing person whose name matches (case-insensitive) */
  const findPersonByName = (name: string) => {
    const key = name.trim().toLowerCase()
    if (!key) return undefined
    return persons.find(p => p.name.toLowerCase() === key)
  }

  /** Inline hint shown when new person name matches an existing person */
  const PersonMatchHint = ({ name }: { name: string }) => {
    const match = findPersonByName(name)
    if (!match) return null
    return <p className="text-xs text-amber-500 mt-0.5">同名人物已存在，将自动关联</p>
  }

  const resolvePersonAlbum = async (
    pMode: PersonMode, pId: string, pName: string,
    aMode: AlbumMode, aId: string, aName: string,
  ) => {
    // Resolve person: 'new' with empty name → treat as 'none'
    // If a person with the same name already exists, reuse it
    let personId = ''
    if (pMode === 'new' && pName.trim()) {
      const existing = findPersonByName(pName)
      if (existing) {
        personId = existing.id
      } else {
        const p = await createPerson(pName.trim())
        personId = p.id
      }
    } else if (pMode === 'existing' && pId) {
      personId = pId
    }

    // Resolve album: 'new' with empty name → treat as 'none'
    let albumId = ''
    if (aMode === 'new' && aName.trim()) {
      const a = await createAlbum({ name: aName.trim(), person_id: personId || undefined })
      albumId = a.id
      newlyCreatedAlbumIds.current.add(albumId)
    } else if (aMode === 'existing' && aId) {
      albumId = aId
    }

    return { personId: personId || undefined, albumId: albumId || undefined }
  }

  /** After import, delete any newly created album that ended up empty */
  const cleanupEmptyNewAlbums = async () => {
    const ids = [...newlyCreatedAlbumIds.current]
    newlyCreatedAlbumIds.current.clear()
    for (const id of ids) {
      try {
        const album = await albumsApi.get(id)
        if (album.media_count === 0) {
          await albumsApi.delete(id)
        }
      } catch { /* album may already be gone */ }
    }
  }

  const pollUntilDone = (token: string, onProgress: (done: number, total: number) => void) => {
    setActiveToken(token)
    return new Promise<{ skipped: number }>((resolve, reject) => {
      const iv = setInterval(async () => {
        try {
          const status = await mediaApi.getImportStatus(token)
          onProgress(status.done, status.total)
          if (status.status === 'done' || status.status === 'cancelled') {
            clearInterval(iv)
            setActiveToken(null)
            resolve({ skipped: status.skipped || 0 })
          }
        } catch (e) { clearInterval(iv); setActiveToken(null); reject(e) }
      }, 1000)
    })
  }

  const handleCancel = async () => {
    if (activeToken) {
      try {
        await mediaApi.cancelImport(activeToken)
        toast({ title: '正在取消导入...' })
      } catch {}
    }
  }

  // --- Per-media table mode ---
  const switchToPerMedia = async () => {
    // If already loaded, just switch view
    if (mediaFiles.length > 0 && perMediaSubfolderIdx === null) {
      setImportMode('per-media')
      return
    }
    setPerMediaSubfolderIdx(null)
    const paths = selectedFiles.length > 0 ? selectedFiles : [selectedPath]
    const recursive = selectedFiles.length > 0 ? false : true
    setLoadingMediaFiles(true)
    try {
      const { files } = await mediaApi.listFiles(paths, recursive)
      if (files.length === 0) { toast({ title: '未找到媒体文件' }); return }
      setMediaFiles(files.map(f => ({
        ...f,
        enabled: !f.existing,
        personMode: personMode,
        selectedPersonId: selectedPersonId,
        newPersonName: newPersonName,
        albumMode: albumMode,
        selectedAlbumId: selectedAlbumId,
        newAlbumName: newAlbumName,
      })))
      setImportMode('per-media')
    } catch (err: any) {
      toast({ title: '读取文件列表失败', description: err.message, variant: 'destructive' })
    } finally {
      setLoadingMediaFiles(false)
    }
  }

  const enterSubfolderPerMedia = async (sfIdx: number) => {
    const sf = subfolders[sfIdx]
    // If already loaded, just switch view
    if (sf.mediaFiles) {
      setMediaFiles(sf.mediaFiles)
      setPerMediaSubfolderIdx(sfIdx)
      return
    }
    try {
      const { files } = await mediaApi.listFiles([sf.path], false)
      if (files.length === 0) { toast({ title: '未找到媒体文件' }); return }
      const configs = files.map(f => ({
        ...f,
        enabled: !f.existing,
        personMode: sf.personMode,
        selectedPersonId: sf.selectedPersonId,
        newPersonName: sf.newPersonName,
        albumMode: sf.albumMode,
        selectedAlbumId: sf.selectedAlbumId,
        newAlbumName: sf.newAlbumName,
      }))
      updateSubfolder(sfIdx, { mediaFiles: configs })
      setMediaFiles(configs)
      setPerMediaSubfolderIdx(sfIdx)
    } catch (err: any) {
      toast({ title: '读取文件列表失败', description: err.message, variant: 'destructive' })
    }
  }

  const updateMediaFile = (idx: number, patch: Partial<MediaFileConfig>) => {
    setMediaFiles(prev => {
      const next = prev.map((f, i) => i === idx ? { ...f, ...patch } : f)
      // Sync back to subfolder if in drill-down mode
      if (perMediaSubfolderIdx !== null) {
        setSubfolders(sfs => sfs.map((sf, i) => i === perMediaSubfolderIdx ? { ...sf, mediaFiles: next } : sf))
      }
      return next
    })
  }

  const handlePerMediaImport = async () => {
    setImporting(true)
    try {
      const enabledFiles = mediaFiles.filter(f => f.enabled)
      const createdPersons = new Map<string, string>()
      const createdAlbums = new Map<string, string>() // "personId|albumName" → id
      let totalImported = 0
      let totalSkipped = 0
      for (let i = 0; i < enabledFiles.length; i++) {
        const mf = enabledFiles[i]
        setImportProgress({ done: i, total: enabledFiles.length, current: mf.name })
        let effectivePersonMode = mf.personMode
        let effectivePersonId = mf.selectedPersonId
        if (mf.personMode === 'new' && mf.newPersonName.trim()) {
          const key = mf.newPersonName.trim().toLowerCase()
          const existingId = createdPersons.get(key)
          if (existingId) {
            effectivePersonMode = 'existing'
            effectivePersonId = existingId
          }
        }
        let effectiveAlbumMode = mf.albumMode
        let effectiveAlbumId = mf.selectedAlbumId
        if (mf.albumMode === 'new' && mf.newAlbumName.trim()) {
          // Resolve effective person first for album dedup key
          const pid = effectivePersonMode === 'existing' ? effectivePersonId
            : effectivePersonMode === 'new' ? (createdPersons.get(mf.newPersonName.trim().toLowerCase()) || '')
            : ''
          const albumKey = `${pid}|${mf.newAlbumName.trim().toLowerCase()}`
          const existingAlbumId = createdAlbums.get(albumKey)
          if (existingAlbumId) {
            effectiveAlbumMode = 'existing'
            effectiveAlbumId = existingAlbumId
          }
        }
        const { personId, albumId } = await resolvePersonAlbum(
          effectivePersonMode, effectivePersonId, mf.newPersonName,
          effectiveAlbumMode, effectiveAlbumId, mf.newAlbumName,
        )
        if (mf.personMode === 'new' && personId && mf.newPersonName.trim()) {
          createdPersons.set(mf.newPersonName.trim().toLowerCase(), personId)
        }
        if (mf.albumMode === 'new' && albumId && mf.newAlbumName.trim()) {
          const pid = personId || ''
          createdAlbums.set(`${pid}|${mf.newAlbumName.trim().toLowerCase()}`, albumId)
        }
        const result = await mediaApi.importMedia({ paths: [mf.path], person_id: personId, album_id: albumId, recursive: false })
        if (result.mode === 'background') {
          const { skipped } = await pollUntilDone(result.token, () => {})
          totalSkipped += skipped
          totalImported += (result.total || 0) - skipped
        } else {
          totalSkipped += result.skipped || 0
          totalImported += (result.done || 0) - (result.skipped || 0)
        }
      }
      setImportProgress({ done: enabledFiles.length, total: enabledFiles.length, current: '' })
      await cleanupEmptyNewAlbums()
      toast({ title: formatImportResult(totalImported, totalSkipped) })
      onOpenChange(false)
      onComplete?.()
    } catch (err: any) {
      toast({ title: '导入失败', description: err.message, variant: 'destructive' })
      await cleanupEmptyNewAlbums()
    } finally {
      setImporting(false)
    }
  }

  const handleImport = async () => {
    // Mobile upload path
    if (isMobile && mobileFiles.length > 0) {
      setImporting(true)
      try {
        const { personId, albumId } = await resolvePersonAlbum(
          personMode, selectedPersonId, newPersonName,
          albumMode, selectedAlbumId, newAlbumName,
        )
        setImportProgress({ done: 0, total: mobileFiles.length, current: '上传中...' })
        const result = await mediaApi.uploadFiles(mobileFiles, personId, albumId)
        await cleanupEmptyNewAlbums()
        toast({ title: `导入完成：${result.imported} 个文件` })
        onOpenChange(false)
        onComplete?.()
      } catch (err: any) {
        toast({ title: '上传失败', description: err.message, variant: 'destructive' })
      } finally {
        setImporting(false)
      }
      return
    }

    // Desktop path
    if (!selectedPath && selectedFiles.length === 0) {
      toast({ title: '请先选择文件夹或文件', variant: 'destructive' })
      return
    }

    setImporting(true)

    try {
      if (importMode === 'per-folder' && subfolders.length > 0) {
        // Per-folder mode: import each subfolder with its own person/album config
        const enabledSubfolders = subfolders.filter(sf => sf.enabled)
        const createdPersons = new Map<string, string>() // lowercase name → id
        const createdAlbums = new Map<string, string>() // "personId|albumName" → id
        let totalSkipped = 0
        let totalImported = 0
        for (let i = 0; i < enabledSubfolders.length; i++) {
          const sf = enabledSubfolders[i]
          setImportProgress({ done: i, total: enabledSubfolders.length, current: sf.name })

          if (sf.mediaFiles && sf.mediaFiles.length > 0) {
            // Per-media import for this subfolder
            const enabledMedia = sf.mediaFiles.filter(f => f.enabled)
            for (const mf of enabledMedia) {
              let effectivePersonMode = mf.personMode
              let effectivePersonId = mf.selectedPersonId
              if (mf.personMode === 'new' && mf.newPersonName.trim()) {
                const key = mf.newPersonName.trim().toLowerCase()
                const existingId = createdPersons.get(key)
                if (existingId) {
                  effectivePersonMode = 'existing'
                  effectivePersonId = existingId
                }
              }
              let effectiveAlbumMode = mf.albumMode
              let effectiveAlbumId = mf.selectedAlbumId
              if (mf.albumMode === 'new' && mf.newAlbumName.trim()) {
                const pid = effectivePersonMode === 'existing' ? effectivePersonId
                  : effectivePersonMode === 'new' ? (createdPersons.get(mf.newPersonName.trim().toLowerCase()) || '')
                  : ''
                const albumKey = `${pid}|${mf.newAlbumName.trim().toLowerCase()}`
                const existingAlbumId = createdAlbums.get(albumKey)
                if (existingAlbumId) {
                  effectiveAlbumMode = 'existing'
                  effectiveAlbumId = existingAlbumId
                }
              }
              const { personId, albumId } = await resolvePersonAlbum(
                effectivePersonMode, effectivePersonId, mf.newPersonName,
                effectiveAlbumMode, effectiveAlbumId, mf.newAlbumName,
              )
              if (mf.personMode === 'new' && personId && mf.newPersonName.trim()) {
                createdPersons.set(mf.newPersonName.trim().toLowerCase(), personId)
              }
              if (mf.albumMode === 'new' && albumId && mf.newAlbumName.trim()) {
                createdAlbums.set(`${personId || ''}|${mf.newAlbumName.trim().toLowerCase()}`, albumId)
              }
              const result = await mediaApi.importMedia({ paths: [mf.path], person_id: personId, album_id: albumId, recursive: false })
              if (result.mode === 'background') {
                const { skipped } = await pollUntilDone(result.token, () => {})
                totalSkipped += skipped
                totalImported += (result.total || 0) - skipped
              } else {
                totalSkipped += result.skipped || 0
                totalImported += (result.done || 0) - (result.skipped || 0)
              }
            }
          } else {
            // Folder-level import
            let effectivePersonMode = sf.personMode
            let effectivePersonId = sf.selectedPersonId
            if (sf.personMode === 'new' && sf.newPersonName.trim()) {
              const key = sf.newPersonName.trim().toLowerCase()
              const existingId = createdPersons.get(key)
              if (existingId) {
                effectivePersonMode = 'existing'
                effectivePersonId = existingId
              }
            }
            let effectiveAlbumMode = sf.albumMode
            let effectiveAlbumId = sf.selectedAlbumId
            if (sf.albumMode === 'new' && sf.newAlbumName.trim()) {
              const pid = effectivePersonMode === 'existing' ? effectivePersonId
                : effectivePersonMode === 'new' ? (createdPersons.get(sf.newPersonName.trim().toLowerCase()) || '')
                : ''
              const albumKey = `${pid}|${sf.newAlbumName.trim().toLowerCase()}`
              const existingAlbumId = createdAlbums.get(albumKey)
              if (existingAlbumId) {
                effectiveAlbumMode = 'existing'
                effectiveAlbumId = existingAlbumId
              }
            }
            const { personId, albumId } = await resolvePersonAlbum(
              effectivePersonMode, effectivePersonId, sf.newPersonName,
              effectiveAlbumMode, effectiveAlbumId, sf.newAlbumName,
            )
            if (sf.personMode === 'new' && personId && sf.newPersonName.trim()) {
              createdPersons.set(sf.newPersonName.trim().toLowerCase(), personId)
            }
            if (sf.albumMode === 'new' && albumId && sf.newAlbumName.trim()) {
              createdAlbums.set(`${personId || ''}|${sf.newAlbumName.trim().toLowerCase()}`, albumId)
            }
            const result = await mediaApi.importMedia({ paths: [sf.path], person_id: personId, album_id: albumId, recursive: false })
            if (result.mode === 'background') {
              const { skipped } = await pollUntilDone(result.token, () => {})
              totalSkipped += skipped
              totalImported += (result.total || 0) - skipped
            } else {
              totalSkipped += result.skipped || 0
              totalImported += (result.done || 0) - (result.skipped || 0)
            }
          }
        }
        setImportProgress({ done: enabledSubfolders.length, total: enabledSubfolders.length, current: '' })
        toast({ title: formatImportResult(totalImported, totalSkipped) })
      } else {
        // Unified mode: import entire folder recursively with one person/album
        const importPaths = selectedFiles.length > 0 ? selectedFiles : [selectedPath]
        setImportProgress({ done: 0, total: 1, current: selectedPath || `${selectedFiles.length} 个文件` })
        const { personId, albumId } = await resolvePersonAlbum(
          personMode, selectedPersonId, newPersonName,
          albumMode, selectedAlbumId, newAlbumName,
        )
        const result = await mediaApi.importMedia({ paths: importPaths, person_id: personId, album_id: albumId })
        if (result.mode === 'background') {
          const { skipped } = await pollUntilDone(result.token, (done, total) => {
            setImportProgress({ done, total, current: selectedPath })
          })
          const imported = (result.total || 0) - skipped
          toast({ title: formatImportResult(imported, skipped) })
        } else {
          const skipped = result.skipped || 0
          const imported = (result.done || 0) - skipped
          toast({ title: formatImportResult(imported, skipped) })
        }
      }

      // Clean up any newly created albums that ended up empty (all files were skipped)
      await cleanupEmptyNewAlbums()

      onOpenChange(false)
      onComplete?.()
    } catch (err: any) {
      toast({ title: '导入失败', description: err.message, variant: 'destructive' })
      await cleanupEmptyNewAlbums()
    } finally {
      setImporting(false)
    }
  }

  const hasSelection = selectedPath || selectedFiles.length > 0 || mobileFiles.length > 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && importing) return; onOpenChange(o) }}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col" onInteractOutside={(e) => { if (importing) e.preventDefault() }} onEscapeKeyDown={(e) => { if (importing) e.preventDefault() }}>
        <DialogHeader>
          <DialogTitle>导入媒体</DialogTitle>
        </DialogHeader>

        {importing ? (
          <div className="py-8 flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            {importProgress.current && (
              <p className="text-sm text-muted-foreground truncate max-w-xs">
                正在导入：{importProgress.current}
              </p>
            )}
            {importProgress.total > 0 && (
              <>
                <p className="text-sm text-muted-foreground">
                  {importProgress.done} / {importProgress.total}
                </p>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary rounded-full h-2 transition-all"
                    style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }}
                  />
                </div>
                {activeToken && (
                  <Button variant="outline" size="sm" onClick={handleCancel}>取消导入</Button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-5 pr-1">
            {/* Source selection */}
            <div>
              <label className="text-sm font-medium mb-2 block">选择来源</label>
              {isMobile ? (
                /* Mobile: HTML file input */
                <div className="space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    onChange={handleMobileFileSelect}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    className="w-full h-12"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-5 h-5 mr-2" />
                    选择图片或视频
                  </Button>
                  {mobileFilesInfo && (
                    <div className="p-3 rounded-md bg-muted/50 space-y-2">
                      <p className="text-sm">
                        已选择 <span className="font-medium">{mobileFilesInfo.count}</span> 个文件，
                        共 <span className="font-medium">{formatFileSize(mobileFilesInfo.totalSize)}</span>
                      </p>
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                        {mobileFiles.slice(0, 20).map((f, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded bg-background border border-border truncate max-w-[140px]">
                            {f.name}
                          </span>
                        ))}
                        {mobileFiles.length > 20 && (
                          <span className="text-xs text-muted-foreground px-2 py-0.5">
                            +{mobileFiles.length - 20} 个文件
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Desktop: tkinter file picker */
                <div className="flex gap-2">
                  <Input
                    value={selectedFiles.length > 0 ? `已选择 ${selectedFiles.length} 个文件` : selectedPath}
                    readOnly={selectedFiles.length > 0}
                    onChange={(e) => applySelectedPath(e.target.value)}
                    placeholder="文件夹路径或选择文件..."
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={handlePickFolder} disabled={checkingSubfolders} title="选择文件夹">
                    {checkingSubfolders ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
                  </Button>
                  <Button variant="outline" onClick={handlePickFiles} title="选择文件">
                    <FileImage className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>

            {/* Scan info — shown for unified mode */}
            {!isMobile && scanInfo && importMode === 'unified' && (
              <div className="p-3 rounded-md bg-muted/50 text-sm">
                共 <span className="font-medium">{scanInfo.total}</span> 个媒体文件
                {hasSubfolders && <span className="text-muted-foreground">（含 {subfolders.length} 个子文件夹）</span>}
                {scanInfo.existing > 0 && (
                  <span className="text-amber-500">
                    ，其中 <span className="font-medium">{scanInfo.existing}</span> 个已存在将跳过
                  </span>
                )}
                {scanInfo.existing === 0 && scanInfo.total > 0 && (
                  <span className="text-muted-foreground">，全部为新文件</span>
                )}
              </div>
            )}

            {/* Mode toggle tabs — always shown when there's a desktop selection */}
            {!isMobile && hasSelection && (
              <div className="flex items-center gap-2">
                <button
                  className={`text-xs px-2.5 py-1 rounded ${importMode === 'unified' ? 'bg-primary/20 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setImportMode('unified')}
                >
                  统一导入
                </button>
                {hasSubfolders && (
                  <button
                    className={`text-xs px-2.5 py-1 rounded ${importMode === 'per-folder' ? 'bg-primary/20 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => { setImportMode('per-folder'); setPerMediaSubfolderIdx(null) }}
                  >
                    逐文件夹配置
                  </button>
                )}
                <button
                  className={`text-xs px-2.5 py-1 rounded ${importMode === 'per-media' ? 'bg-primary/20 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={switchToPerMedia}
                  disabled={loadingMediaFiles}
                >
                  {loadingMediaFiles ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                  逐个配置
                </button>
              </div>
            )}

            {/* === Per-folder: subfolder drill-down (per-media for one subfolder) === */}
            {importMode === 'per-folder' && perMediaSubfolderIdx !== null && mediaFiles.length > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">
                    {subfolders[perMediaSubfolderIdx]?.name} — {mediaFiles.filter(f => f.enabled).length}/{mediaFiles.length} 个文件
                  </label>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => {
                    setMediaFiles([])
                    setPerMediaSubfolderIdx(null)
                  }}>
                    返回文件夹列表
                  </Button>
                </div>
                {/* Reuse per-media table */}
                <div className="overflow-x-auto max-h-[50vh]">
                <div className="min-w-[600px]">
                <div className="grid grid-cols-[24px_40px_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-xs text-muted-foreground font-medium border-b border-border sticky top-0 bg-background z-10">
                  <span>
                    <input type="checkbox" className="accent-primary"
                      checked={mediaFiles.length > 0 && mediaFiles.filter(f => !f.existing).every(f => f.enabled)}
                      ref={el => { if (el) el.indeterminate = mediaFiles.filter(f => !f.existing).some(f => f.enabled) && !mediaFiles.filter(f => !f.existing).every(f => f.enabled) }}
                      onChange={(e) => setMediaFiles(prev => {
                        const next = prev.map(f => f.existing ? f : { ...f, enabled: e.target.checked })
                        if (perMediaSubfolderIdx !== null) {
                          setSubfolders(sfs => sfs.map((sf, i) => i === perMediaSubfolderIdx ? { ...sf, mediaFiles: next } : sf))
                        }
                        return next
                      })}
                    />
                  </span>
                  <span></span>
                  <span>文件</span>
                  <span>人物</span>
                  <span>图集</span>
                </div>
                <div>
                  {mediaFiles.map((mf, idx) => (
                    <div key={mf.path} className={`grid grid-cols-[24px_40px_1fr_1fr_1fr] gap-2 px-3 py-1.5 border-b border-border/50 items-center hover:bg-accent/30${!mf.enabled ? ' opacity-40' : ''}`}>
                      <input type="checkbox" className="accent-primary" checked={mf.enabled} disabled={mf.existing}
                        onChange={(e) => updateMediaFile(idx, { enabled: e.target.checked })} />
                      <button className="w-9 h-9 rounded overflow-hidden bg-muted shrink-0 cursor-pointer hover:ring-2 ring-primary"
                        onClick={() => setPreviewPath(mf.path)} title="点击预览">
                        <img src={mediaApi.thumbUrl(mf.path, 80)} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="text-sm truncate" title={mf.name}>{mf.name}</p>
                          {mf.existing && <span className="text-amber-500 text-xs shrink-0">已导入</span>}
                        </div>
                      </div>
                      <div className="min-w-0">
                        {mf.personMode === 'new' ? (
                          <>
                            <Input className="h-7 text-xs" placeholder="新建人物..." value={mf.newPersonName}
                              onChange={(e) => updateMediaFile(idx, { newPersonName: e.target.value })} />
                            <PersonMatchHint name={mf.newPersonName} />
                          </>
                        ) : mf.personMode === 'existing' ? (
                          <select className="w-full h-7 rounded border border-input bg-background px-1.5 text-xs"
                            value={mf.selectedPersonId} onChange={(e) => updateMediaFile(idx, { selectedPersonId: e.target.value })}>
                            <option value="">选择...</option>
                            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                        <div className="flex gap-1 mt-0.5">
                          {(['new', 'existing', 'none'] as PersonMode[]).map((m) => (
                            <button key={m} className={`text-[10px] px-1 py-0.5 rounded ${mf.personMode === m ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                              onClick={() => updateMediaFile(idx, { personMode: m, selectedPersonId: '', newPersonName: m === 'new' ? '' : '' })}>
                              {m === 'new' ? '新建' : m === 'existing' ? '已有' : '无'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="min-w-0">
                        {mf.albumMode === 'new' ? (
                          <Input className="h-7 text-xs" placeholder="新建图集..." value={mf.newAlbumName}
                            onChange={(e) => updateMediaFile(idx, { newAlbumName: e.target.value })} />
                        ) : mf.albumMode === 'existing' ? (
                          <select className="w-full h-7 rounded border border-input bg-background px-1.5 text-xs"
                            value={mf.selectedAlbumId} onChange={(e) => updateMediaFile(idx, { selectedAlbumId: e.target.value })}>
                            <option value="">选择...</option>
                            {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                        <div className="flex gap-1 mt-0.5">
                          {(['new', 'existing', 'none'] as AlbumMode[]).map((m) => (
                            <button key={m} className={`text-[10px] px-1 py-0.5 rounded ${mf.albumMode === m ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                              onClick={() => updateMediaFile(idx, { albumMode: m, selectedAlbumId: '', newAlbumName: m === 'new' ? '' : '' })}>
                              {m === 'new' ? '新建' : m === 'existing' ? '已有' : '无'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                </div>
                </div>
              </div>

            /* === Per-folder table === */
            ) : importMode === 'per-folder' && !isMobile && subfolders.length > 0 ? (
              <div>
                <div className="overflow-x-auto max-h-[50vh]">
                <div className="min-w-[700px]">
                <div className="grid grid-cols-[24px_1fr_1fr_1fr_minmax(120px,1fr)_auto] gap-2 px-3 py-1.5 text-xs text-muted-foreground font-medium border-b border-border sticky top-0 bg-background z-10">
                  <span>
                    <input type="checkbox"
                      className="accent-primary"
                      checked={subfolders.length > 0 && subfolders.every(sf => sf.enabled)}
                      ref={el => { if (el) el.indeterminate = subfolders.some(sf => sf.enabled) && !subfolders.every(sf => sf.enabled) }}
                      onChange={(e) => setSubfolders(prev => prev.map(sf => ({ ...sf, enabled: e.target.checked })))}
                    />
                  </span>
                  <span>文件夹</span>
                  <span>人物</span>
                  <span>图集</span>
                  <span>路径</span>
                  <span></span>
                </div>
                <div>
                  {subfolders
                    .map((sf, idx) => ({ sf, idx }))
                    .sort((a, b) => {
                      const aAllExist = a.sf.existingCount >= a.sf.mediaCount && a.sf.mediaCount > 0
                      const bAllExist = b.sf.existingCount >= b.sf.mediaCount && b.sf.mediaCount > 0
                      if (aAllExist !== bAllExist) return aAllExist ? 1 : -1
                      return 0
                    })
                    .map(({ sf, idx }) => (
                    <div key={sf.path} className={`grid grid-cols-[24px_1fr_1fr_1fr_minmax(120px,1fr)_auto] gap-2 px-3 py-2 border-b border-border/50 items-center hover:bg-accent/30${!sf.enabled ? ' opacity-40' : sf.existingCount >= sf.mediaCount && sf.mediaCount > 0 ? ' opacity-50' : ''}`}>
                      <input type="checkbox" className="accent-primary" checked={sf.enabled}
                        onChange={(e) => updateSubfolder(idx, { enabled: e.target.checked })} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" title={sf.name}>
                          {sf.name}
                          {isRootEntry(sf.path) && <span className="text-xs text-muted-foreground ml-1">(当前文件夹)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {sf.mediaCount} 张
                          {sf.existingCount > 0 && (
                            <span className="text-amber-500">（{sf.existingCount} 已存在）</span>
                          )}
                          {sf.mediaFiles && <span className="text-primary ml-1">· 逐个</span>}
                        </p>
                      </div>
                      <div className="min-w-0">
                        {sf.personMode === 'new' ? (
                          <>
                            <Input className="h-8 text-sm" placeholder="新建人物名..." value={sf.newPersonName}
                              onChange={(e) => updateSubfolder(idx, { newPersonName: e.target.value })} />
                            <PersonMatchHint name={sf.newPersonName} />
                          </>
                        ) : sf.personMode === 'existing' ? (
                          <select className="w-full h-8 rounded border border-input bg-background px-2 text-sm"
                            value={sf.selectedPersonId} onChange={(e) => updateSubfolder(idx, { selectedPersonId: e.target.value })}>
                            <option value="">选择人物...</option>
                            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        <div className="flex gap-1 mt-1">
                          {(['new', 'existing', 'none'] as PersonMode[]).map((m) => (
                            <button key={m}
                              className={`text-xs px-1.5 py-0.5 rounded ${sf.personMode === m ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                              onClick={() => updateSubfolder(idx, { personMode: m, selectedPersonId: '', newPersonName: m === 'new' ? sf.name : '' })}>
                              {m === 'new' ? '新建' : m === 'existing' ? '已有' : '无'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="min-w-0">
                        {sf.albumMode === 'new' ? (
                          <Input className="h-8 text-sm" placeholder="新建图集名..." value={sf.newAlbumName}
                            onChange={(e) => updateSubfolder(idx, { newAlbumName: e.target.value })} />
                        ) : sf.albumMode === 'existing' ? (
                          <select className="w-full h-8 rounded border border-input bg-background px-2 text-sm"
                            value={sf.selectedAlbumId} onChange={(e) => updateSubfolder(idx, { selectedAlbumId: e.target.value })}>
                            <option value="">选择图集...</option>
                            {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        <div className="flex gap-1 mt-1">
                          {(['new', 'existing', 'none'] as AlbumMode[]).map((m) => (
                            <button key={m}
                              className={`text-xs px-1.5 py-0.5 rounded ${sf.albumMode === m ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                              onClick={() => updateSubfolder(idx, { albumMode: m, newAlbumName: m === 'new' ? sf.name : '' })}>
                              {m === 'new' ? '新建' : m === 'existing' ? '已有' : '无'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="min-w-0 overflow-x-auto">
                        <p className="text-xs text-muted-foreground whitespace-nowrap pr-2" title={getRelativePath(sf.path)}>
                          {getRelativePath(sf.path)}
                        </p>
                      </div>
                      <div className="shrink-0">
                        <button
                          className="text-xs px-2 py-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 whitespace-nowrap"
                          onClick={() => enterSubfolderPerMedia(idx)}
                          title="逐个配置此文件夹的媒体"
                        >
                          <FileImage className="w-3.5 h-3.5 inline mr-0.5" />逐个
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                </div>
                </div>
              </div>

            /* === Per-media table (global) === */
            ) : importMode === 'per-media' && mediaFiles.length > 0 ? (
              <div>
                <div className="text-sm text-muted-foreground mb-2">
                  {mediaFiles.filter(f => f.enabled).length}/{mediaFiles.length} 个媒体文件已勾选
                </div>
                <div className="overflow-x-auto max-h-[50vh]">
                <div className="min-w-[600px]">
                <div className="grid grid-cols-[24px_40px_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-xs text-muted-foreground font-medium border-b border-border sticky top-0 bg-background z-10">
                  <span>
                    <input type="checkbox" className="accent-primary"
                      checked={mediaFiles.length > 0 && mediaFiles.filter(f => !f.existing).every(f => f.enabled)}
                      ref={el => { if (el) el.indeterminate = mediaFiles.filter(f => !f.existing).some(f => f.enabled) && !mediaFiles.filter(f => !f.existing).every(f => f.enabled) }}
                      onChange={(e) => setMediaFiles(prev => prev.map(f => f.existing ? f : { ...f, enabled: e.target.checked }))}
                    />
                  </span>
                  <span></span>
                  <span>文件</span>
                  <span>人物</span>
                  <span>图集</span>
                </div>
                <div>
                  {mediaFiles.map((mf, idx) => (
                    <div key={mf.path} className={`grid grid-cols-[24px_40px_1fr_1fr_1fr] gap-2 px-3 py-1.5 border-b border-border/50 items-center hover:bg-accent/30${!mf.enabled ? ' opacity-40' : ''}`}>
                      <input type="checkbox" className="accent-primary" checked={mf.enabled} disabled={mf.existing}
                        onChange={(e) => updateMediaFile(idx, { enabled: e.target.checked })} />
                      <button className="w-9 h-9 rounded overflow-hidden bg-muted shrink-0 cursor-pointer hover:ring-2 ring-primary"
                        onClick={() => setPreviewPath(mf.path)} title="点击预览">
                        <img src={mediaApi.thumbUrl(mf.path, 80)} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="text-sm truncate" title={mf.name}>{mf.name}</p>
                          {mf.existing && <span className="text-amber-500 text-xs shrink-0">已导入</span>}
                        </div>
                      </div>
                      <div className="min-w-0">
                        {mf.personMode === 'new' ? (
                          <>
                            <Input className="h-7 text-xs" placeholder="新建人物..." value={mf.newPersonName}
                              onChange={(e) => updateMediaFile(idx, { newPersonName: e.target.value })} />
                            <PersonMatchHint name={mf.newPersonName} />
                          </>
                        ) : mf.personMode === 'existing' ? (
                          <select className="w-full h-7 rounded border border-input bg-background px-1.5 text-xs"
                            value={mf.selectedPersonId} onChange={(e) => updateMediaFile(idx, { selectedPersonId: e.target.value })}>
                            <option value="">选择...</option>
                            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                        <div className="flex gap-1 mt-0.5">
                          {(['new', 'existing', 'none'] as PersonMode[]).map((m) => (
                            <button key={m} className={`text-[10px] px-1 py-0.5 rounded ${mf.personMode === m ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                              onClick={() => updateMediaFile(idx, { personMode: m, selectedPersonId: '', newPersonName: m === 'new' ? '' : '' })}>
                              {m === 'new' ? '新建' : m === 'existing' ? '已有' : '无'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="min-w-0">
                        {mf.albumMode === 'new' ? (
                          <Input className="h-7 text-xs" placeholder="新建图集..." value={mf.newAlbumName}
                            onChange={(e) => updateMediaFile(idx, { newAlbumName: e.target.value })} />
                        ) : mf.albumMode === 'existing' ? (
                          <select className="w-full h-7 rounded border border-input bg-background px-1.5 text-xs"
                            value={mf.selectedAlbumId} onChange={(e) => updateMediaFile(idx, { selectedAlbumId: e.target.value })}>
                            <option value="">选择...</option>
                            {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                        <div className="flex gap-1 mt-0.5">
                          {(['new', 'existing', 'none'] as AlbumMode[]).map((m) => (
                            <button key={m} className={`text-[10px] px-1 py-0.5 rounded ${mf.albumMode === m ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                              onClick={() => updateMediaFile(idx, { albumMode: m, selectedAlbumId: '', newAlbumName: m === 'new' ? '' : '' })}>
                              {m === 'new' ? '新建' : m === 'existing' ? '已有' : '无'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                </div>
                </div>
              </div>

            /* === Unified mode === */
            ) : (importMode === 'unified' || importMode === 'per-media') && hasSelection ? (
              <>
                <div>
                  <label className="text-sm font-medium mb-2 block">关联人物</label>
                  <div className="flex gap-2 mb-2">
                    {(['none', 'existing', 'new'] as PersonMode[]).map((m) => (
                      <Button key={m} variant={personMode === m ? 'default' : 'outline'} size="sm"
                        onClick={() => { setPersonMode(m); if (m !== 'existing') setSelectedPersonId('') }}>
                        {m === 'none' ? '不关联' : m === 'existing' ? '已有人物' : '新建人物'}
                      </Button>
                    ))}
                  </div>
                  {personMode === 'existing' && (
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={selectedPersonId} onChange={(e) => setSelectedPersonId(e.target.value)}>
                      <option value="">选择人物...</option>
                      {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                  {personMode === 'new' && (
                    <>
                      <Input placeholder="人物姓名..." value={newPersonName}
                        onChange={(e) => setNewPersonName(e.target.value)} />
                      <PersonMatchHint name={newPersonName} />
                    </>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">关联图集</label>
                  <div className="flex gap-2 mb-2">
                    {(['none', 'existing', 'new'] as AlbumMode[]).map((m) => (
                      <Button key={m} variant={albumMode === m ? 'default' : 'outline'} size="sm"
                        onClick={() => { setAlbumMode(m); if (m !== 'existing') setSelectedAlbumId('') }}>
                        {m === 'none' ? '不关联' : m === 'existing' ? '已有图集' : '新建图集'}
                      </Button>
                    ))}
                  </div>
                  {albumMode === 'existing' && (
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={selectedAlbumId} onChange={(e) => setSelectedAlbumId(e.target.value)}>
                      <option value="">选择图集...</option>
                      {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )}
                  {albumMode === 'new' && (
                    <Input placeholder="图集名称..." value={newAlbumName}
                      onChange={(e) => setNewAlbumName(e.target.value)} />
                  )}
                </div>
              </>
            ) : null}

            {/* Thumbnail preview overlay */}
            {previewPath && (
              <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={() => setPreviewPath(null)}>
                <img src={mediaApi.thumbUrl(previewPath, 800)} alt="" className="max-w-[80vw] max-h-[80vh] object-contain rounded-lg shadow-2xl" />
              </div>
            )}
          </div>
        )}

        {!importing && (
          <DialogFooter className="pt-4 border-t border-border">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              onClick={importMode === 'per-media' ? handlePerMediaImport
                : (importMode === 'per-folder' && perMediaSubfolderIdx !== null) ? handlePerMediaImport
                : handleImport}
              disabled={importMode === 'per-media' ? mediaFiles.filter(f => f.enabled).length === 0
                : (importMode === 'per-folder' && perMediaSubfolderIdx !== null) ? mediaFiles.filter(f => f.enabled).length === 0
                : importMode === 'per-folder' ? subfolders.filter(sf => sf.enabled).length === 0
                : (!hasSelection || checkingSubfolders)}
            >
              开始导入{importMode === 'per-media'
                ? ` (${mediaFiles.filter(f => f.enabled).length}/${mediaFiles.length})`
                : (importMode === 'per-folder' && perMediaSubfolderIdx !== null)
                  ? ` (${mediaFiles.filter(f => f.enabled).length}/${mediaFiles.length})`
                : importMode === 'per-folder'
                  ? ` (${subfolders.filter(sf => sf.enabled).length}/${subfolders.length})`
                  : ''}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
