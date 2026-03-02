import { useState, useEffect } from 'react'
import { FolderOpen, FileImage, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { mediaApi } from '@/api/media'
import { systemApi } from '@/api/system'
import { usePersonStore } from '@/stores/person'
import { useAlbumStore } from '@/stores/album'
import { toast } from '@/hooks/use-toast'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  defaultPersonId?: string
  defaultAlbumId?: string
  onComplete?: () => void
}

type PersonMode = 'none' | 'existing' | 'new'
type AlbumMode = 'none' | 'existing' | 'new'

interface SubfolderConfig {
  name: string
  path: string
  mediaCount: number
  personMode: PersonMode
  selectedPersonId: string
  newPersonName: string
  albumMode: AlbumMode
  selectedAlbumId: string
  newAlbumName: string
}

export function ImportDialog({ open, onOpenChange, defaultPersonId, defaultAlbumId, onComplete }: ImportDialogProps) {
  const { persons, fetchPersons, createPerson } = usePersonStore()
  const { albums, fetchAlbumsByPerson, createAlbum } = useAlbumStore()

  const [selectedPath, setSelectedPath] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [personMode, setPersonMode] = useState<PersonMode>('new')
  const [selectedPersonId, setSelectedPersonId] = useState(defaultPersonId || '')
  const [newPersonName, setNewPersonName] = useState('')
  const [albumMode, setAlbumMode] = useState<AlbumMode>('new')
  const [selectedAlbumId, setSelectedAlbumId] = useState(defaultAlbumId || '')
  const [newAlbumName, setNewAlbumName] = useState('')

  // Subfolder mode
  const [subfolders, setSubfolders] = useState<SubfolderConfig[]>([])
  const [hasSubfolders, setHasSubfolders] = useState(false)
  const [checkingSubfolders, setCheckingSubfolders] = useState(false)

  // Import progress
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, current: '' })

  useEffect(() => {
    if (open) {
      fetchPersons()
      setSelectedPath('')
      setSelectedFiles([])
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
      } else {
        setAlbumMode('new')
        setSelectedAlbumId('')
      }
      setNewAlbumName('')
      setSubfolders([])
      setHasSubfolders(false)
      setImporting(false)
      setImportProgress({ done: 0, total: 0, current: '' })
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
        const firstPath = paths[0].replace(/\\/g, '/')
        const parentFolder = firstPath.split('/').slice(0, -1).pop() || ''
        if (!defaultPersonId && personMode === 'new') {
          setNewPersonName(parentFolder)
        }
        if (!defaultAlbumId && albumMode === 'new') {
          setNewAlbumName(parentFolder)
        }
      }
    } catch {
      toast({ title: '无法打开文件选择器', variant: 'destructive' })
    }
  }

  const applySelectedPath = async (path: string) => {
    setSelectedPath(path)
    setSelectedFiles([])
    setSubfolders([])
    setHasSubfolders(false)

    const folderName = getFolderName(path)
    if (!defaultPersonId && personMode === 'new') {
      setNewPersonName(folderName)
    }
    if (!defaultAlbumId && albumMode === 'new') {
      setNewAlbumName(folderName)
    }

    setCheckingSubfolders(true)
    try {
      const { subfolders: subs } = await systemApi.listSubfolders(path)
      // If more than 1 entry (or 1 entry that's not the root itself), use subfolder mode
      const rootPath = path.replace(/\\/g, '/').replace(/\/$/, '')
      const nonRootSubs = subs.filter(s => s.path.replace(/\\/g, '/').replace(/\/$/, '') !== rootPath)
      if (nonRootSubs.length > 0) {
        setHasSubfolders(true)
        setSubfolders(subs.map((s) => ({
          name: s.name,
          path: s.path,
          mediaCount: s.media_count,
          personMode: defaultPersonId ? 'existing' as PersonMode : 'new' as PersonMode,
          selectedPersonId: defaultPersonId || '',
          newPersonName: s.name,
          albumMode: 'new' as AlbumMode,
          selectedAlbumId: '',
          newAlbumName: s.name,
        })))
      } else {
        // Single folder with images — no subfolder mode
        setHasSubfolders(false)
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

  const resolvePersonAlbum = async (
    pMode: PersonMode, pId: string, pName: string,
    aMode: AlbumMode, aId: string, aName: string,
  ) => {
    let personId = pId
    if (pMode === 'new' && pName.trim()) {
      const p = await createPerson(pName.trim())
      personId = p.id
    } else if (pMode === 'none') {
      personId = ''
    }

    let albumId = aId
    if (aMode === 'new' && aName.trim()) {
      const a = await createAlbum({ name: aName.trim(), person_id: personId || undefined })
      albumId = a.id
    } else if (aMode === 'none') {
      albumId = ''
    }

    return { personId: personId || undefined, albumId: albumId || undefined }
  }

  const pollUntilDone = (token: string, onProgress: (done: number, total: number) => void) =>
    new Promise<void>((resolve, reject) => {
      const iv = setInterval(async () => {
        try {
          const status = await mediaApi.getImportStatus(token)
          onProgress(status.done, status.total)
          if (status.status === 'done') { clearInterval(iv); resolve() }
        } catch (e) { clearInterval(iv); reject(e) }
      }, 1000)
    })

  const handleImport = async () => {
    if (!selectedPath && selectedFiles.length === 0) {
      toast({ title: '请先选择文件夹或文件', variant: 'destructive' })
      return
    }

    setImporting(true)

    try {
      if (hasSubfolders && subfolders.length > 0) {
        for (let i = 0; i < subfolders.length; i++) {
          const sf = subfolders[i]
          setImportProgress({ done: i, total: subfolders.length, current: sf.name })
          const { personId, albumId } = await resolvePersonAlbum(
            sf.personMode, sf.selectedPersonId, sf.newPersonName,
            sf.albumMode, sf.selectedAlbumId, sf.newAlbumName,
          )
          // Import only direct files in this folder (not recursive)
          const result = await mediaApi.importMedia({ paths: [sf.path], person_id: personId, album_id: albumId, recursive: false })
          if (result.mode === 'background') {
            await pollUntilDone(result.token, () => {})
          }
        }
        setImportProgress({ done: subfolders.length, total: subfolders.length, current: '' })
        toast({ title: `导入完成：${subfolders.length} 个文件夹` })
      } else {
        const importPaths = selectedFiles.length > 0 ? selectedFiles : [selectedPath]
        setImportProgress({ done: 0, total: 1, current: selectedPath || `${selectedFiles.length} 个文件` })
        const { personId, albumId } = await resolvePersonAlbum(
          personMode, selectedPersonId, newPersonName,
          albumMode, selectedAlbumId, newAlbumName,
        )
        const result = await mediaApi.importMedia({ paths: importPaths, person_id: personId, album_id: albumId })
        if (result.mode === 'background') {
          await pollUntilDone(result.token, (done, total) => {
            setImportProgress({ done, total, current: selectedPath })
          })
          toast({ title: '导入完成' })
        } else {
          toast({ title: `导入完成：${result.done} 张图片` })
        }
      }

      onOpenChange(false)
      onComplete?.()
    } catch (err: any) {
      toast({ title: '导入失败', description: err.message, variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  const hasSelection = selectedPath || selectedFiles.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>导入图片</DialogTitle>
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
              </>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-5 pr-1">
            {/* Source selection */}
            <div>
              <label className="text-sm font-medium mb-2 block">选择来源</label>
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
            </div>

            {/* Subfolder mode — 3-column table layout */}
            {hasSubfolders ? (
              <div>
                <label className="text-sm font-medium mb-2 block">
                  检测到 {subfolders.length} 个含图片的文件夹：
                </label>
                {/* Table header */}
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-1.5 text-xs text-muted-foreground font-medium border-b border-border">
                  <span>文件夹</span>
                  <span>人物</span>
                  <span>图集</span>
                </div>
                {/* Table rows */}
                <div className="max-h-[45vh] overflow-y-auto">
                  {subfolders.map((sf, idx) => (
                    <div key={sf.path} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-2 border-b border-border/50 items-center hover:bg-accent/30">
                      {/* Column 1: Folder name + count */}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" title={sf.path}>{sf.name}</p>
                        <p className="text-xs text-muted-foreground">{sf.mediaCount} 张</p>
                      </div>
                      {/* Column 2: Person */}
                      <div className="min-w-0">
                        {sf.personMode === 'new' ? (
                          <Input
                            className="h-8 text-sm"
                            placeholder="新建人物名..."
                            value={sf.newPersonName}
                            onChange={(e) => updateSubfolder(idx, { newPersonName: e.target.value })}
                          />
                        ) : sf.personMode === 'existing' ? (
                          <select
                            className="w-full h-8 rounded border border-input bg-background px-2 text-sm"
                            value={sf.selectedPersonId}
                            onChange={(e) => updateSubfolder(idx, { selectedPersonId: e.target.value })}
                          >
                            <option value="">选择人物...</option>
                            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        <div className="flex gap-1 mt-1">
                          {(['new', 'existing', 'none'] as PersonMode[]).map((m) => (
                            <button
                              key={m}
                              className={`text-xs px-1.5 py-0.5 rounded ${sf.personMode === m ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                              onClick={() => updateSubfolder(idx, { personMode: m, selectedPersonId: '', newPersonName: m === 'new' ? sf.name : '' })}
                            >
                              {m === 'new' ? '新建' : m === 'existing' ? '已有' : '无'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Column 3: Album */}
                      <div className="min-w-0">
                        {sf.albumMode === 'new' ? (
                          <Input
                            className="h-8 text-sm"
                            placeholder="新建图集名..."
                            value={sf.newAlbumName}
                            onChange={(e) => updateSubfolder(idx, { newAlbumName: e.target.value })}
                          />
                        ) : sf.albumMode === 'existing' ? (
                          <select
                            className="w-full h-8 rounded border border-input bg-background px-2 text-sm"
                            value={sf.selectedAlbumId}
                            onChange={(e) => updateSubfolder(idx, { selectedAlbumId: e.target.value })}
                          >
                            <option value="">选择图集...</option>
                            {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        <div className="flex gap-1 mt-1">
                          {(['new', 'existing', 'none'] as AlbumMode[]).map((m) => (
                            <button
                              key={m}
                              className={`text-xs px-1.5 py-0.5 rounded ${sf.albumMode === m ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                              onClick={() => updateSubfolder(idx, { albumMode: m, newAlbumName: m === 'new' ? sf.name : '' })}
                            >
                              {m === 'new' ? '新建' : m === 'existing' ? '已有' : '无'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : hasSelection ? (
              /* Single folder / file mode */
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
                    <Input placeholder="人物姓名..." value={newPersonName}
                      onChange={(e) => setNewPersonName(e.target.value)} />
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">关联图集</label>
                  <div className="flex gap-2 mb-2">
                    {(['none', 'existing', 'new'] as AlbumMode[]).map((m) => (
                      <Button key={m} variant={albumMode === m ? 'default' : 'outline'} size="sm"
                        onClick={() => setAlbumMode(m)}>
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
          </div>
        )}

        {!importing && (
          <DialogFooter className="pt-4 border-t border-border">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={handleImport} disabled={!hasSelection || checkingSubfolders}>
              开始导入
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
