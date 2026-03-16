import { useState, useCallback } from 'react'
import { MoreHorizontal, Edit2, Trash2, FolderOpen, ArrowRightLeft, Download, Sparkles, ZoomIn, Repeat, Image, ScanSearch } from 'lucide-react'
import { AiBatchSubMenu } from './AiContextMenu'
import { TagEditorSubMenu, TagEditorDialog } from './TagEditor'
import { useNavigate } from 'react-router-dom'
import { Album, albumsApi } from '@/api/albums'
import { mediaApi } from '@/api/media'
import { personsApi, Person as PersonItem } from '@/api/persons'
import { ContextMenuPortal, MenuItem, MenuSeparator } from './ContextMenuPortal'
import { useAlbumStore } from '@/stores/album'
import { useTagStore } from '@/stores/tag'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface AlbumCardProps {
  album: Album
  compact?: boolean
  animIndex?: number
  onImport?: () => void
  onBatchAi?: (category: string) => void
}

export function AlbumCard({ album, compact, animIndex, onImport, onBatchAi }: AlbumCardProps) {
  const navigate = useNavigate()
  const { updateAlbum, deleteAlbum } = useAlbumStore()
  const [renameOpen, setRenameOpen] = useState(false)
  const [newName, setNewName] = useState(album.name)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [persons, setPersons] = useState<PersonItem[]>([])
  const [moveLoading, setMoveLoading] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteMode, setDeleteMode] = useState<'album_only' | 'album_and_media' | 'move_to_album'>('album_only')
  const [targetAlbumId, setTargetAlbumId] = useState('')
  const [siblingAlbums, setSiblingAlbums] = useState<Album[]>([])
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 768

  const selectedTagIds = (album.tags || []).map(t => t.id)
  const handleTagToggle = useCallback(async (tagId: string, selected: boolean) => {
    const currentIds = (album.tags || []).map(t => t.id)
    const newIds = selected ? [...currentIds, tagId] : currentIds.filter(id => id !== tagId)
    await updateAlbum(album.id, { tag_ids: newIds })
    useTagStore.getState().fetchTags()
  }, [album.id, album.tags, updateAlbum])

  const handleRename = async () => {
    if (newName.trim()) {
      await updateAlbum(album.id, { name: newName.trim() })
      setRenameOpen(false)
    }
  }

  const handleOpenMove = async () => {
    setMoveOpen(true)
    try {
      const list = await personsApi.list('name')
      setPersons(list.filter(p => p.id !== album.person_id))
    } catch {}
  }

  const handleMove = async (targetPersonId: string) => {
    setMoveLoading(true)
    try {
      await updateAlbum(album.id, { person_id: targetPersonId })
      setMoveOpen(false)
    } catch {}
    setMoveLoading(false)
  }

  const openDeleteDialog = async () => {
    setDeleteMode('album_only')
    setTargetAlbumId('')
    setDeleteOpen(true)
    // Load sibling albums for "move to album" option
    if (album.person_id) {
      try {
        const list = await albumsApi.listByPerson(album.person_id)
        setSiblingAlbums(list.filter(a => a.id !== album.id))
      } catch { setSiblingAlbums([]) }
    } else {
      setSiblingAlbums([])
    }
  }

  const handleDelete = async () => {
    if (deleteMode === 'move_to_album' && !targetAlbumId) return
    setDeleteLoading(true)
    try {
      await deleteAlbum(album.id, deleteMode, deleteMode === 'move_to_album' ? targetAlbumId : undefined)
      setDeleteOpen(false)
    } catch {}
    setDeleteLoading(false)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div
        data-testid="album-card"
        data-album-id={album.id}
        className="group relative rounded-none sm:rounded-lg overflow-hidden bg-card border border-border cursor-pointer hover:border-primary/50 transition-all duration-200 hover:shadow-lg hover:shadow-black/30 animate-fade-in-up"
        style={animIndex != null ? { animationDelay: `${Math.min(animIndex * 30, 600)}ms` } : undefined}
        onClick={() => navigate(`/albums/${album.id}`)}
        onContextMenu={handleContextMenu}
      >
        {/* Square cover */}
        <div className="aspect-square overflow-hidden bg-muted flex items-center justify-center relative">
          {album.cover_file_path ? (
            <img
              src={mediaApi.thumbUrl(album.cover_file_path, 400)}
              alt={album.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <FolderOpen className="w-12 h-12 text-muted-foreground opacity-30" />
          )}

          {/* Rating badge — top left, hidden on mobile & compact */}
          {!compact && album.avg_rating != null && (
            <div className="absolute top-1.5 left-1.5 bg-black/60 rounded px-1.5 py-0.5 hidden sm:block">
              <span className="text-xs text-white font-medium">★{album.avg_rating.toFixed(1)}</span>
            </div>
          )}

          {/* Dropdown menu — top right, hover only, hidden on mobile (use long-press context menu instead) */}
          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 hidden sm:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 bg-black/40 hover:bg-black/60 text-white"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => { setNewName(album.name); setRenameOpen(true) }}>
                  <Edit2 className="w-4 h-4 mr-2" />
                  重命名
                </DropdownMenuItem>
                {onImport && (
                  <DropdownMenuItem onClick={onImport}>
                    <Download className="w-4 h-4 mr-2" />
                    导入
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleOpenMove}>
                  <ArrowRightLeft className="w-4 h-4 mr-2" />
                  移动到其他人物
                </DropdownMenuItem>
                {onBatchAi && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Sparkles className="w-4 h-4 mr-2" />
                      AI 批量
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => onBatchAi('upscale')}>
                          <ZoomIn className="w-4 h-4 mr-2" />批量高清放大
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onBatchAi('face_swap')}>
                          <Repeat className="w-4 h-4 mr-2" />批量换脸
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onBatchAi('image_to_image')}>
                          <Image className="w-4 h-4 mr-2" />批量图生图
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onBatchAi('preprocess')}>
                          <ScanSearch className="w-4 h-4 mr-2" />批量预处理
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={openDeleteDialog}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  删除图集
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Bottom gradient overlay with info — hidden when compact (tiny cards) */}
          {!compact && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-2 pb-1.5 pt-6">
              <h3 className="text-white font-medium truncate text-sm">{album.name}</h3>
              <p className="text-xs text-white/70 truncate">{album.media_count} 张</p>
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenuPortal position={contextMenu} onClose={() => setContextMenu(null)}>
          <MenuItem
            icon={<Edit2 className="w-3.5 h-3.5" />}
            label="重命名图集"
            onClick={() => { setContextMenu(null); setNewName(album.name); setRenameOpen(true) }}
          />
          {isMobileDevice ? (
            <MenuItem
              icon={<AlbumTagIcon />}
              label="管理标签"
              onClick={() => { setContextMenu(null); setTagDialogOpen(true) }}
            />
          ) : (
            <TagEditorSubMenu selectedTagIds={selectedTagIds} onToggle={handleTagToggle} />
          )}
          {onImport && (
            <MenuItem icon={<Download className="w-3.5 h-3.5" />} label="导入" onClick={() => { setContextMenu(null); onImport() }} />
          )}
          <MenuItem
            icon={<ArrowRightLeft className="w-3.5 h-3.5" />}
            label="移动到其他人物"
            onClick={() => { setContextMenu(null); handleOpenMove() }}
          />
          {onBatchAi && (
            <AiBatchSubMenu onBatchAi={(cat) => { setContextMenu(null); onBatchAi(cat) }} />
          )}
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label="删除图集"
            onClick={() => { setContextMenu(null); openDeleteDialog() }}
            destructive
          />
        </ContextMenuPortal>
      )}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>重命名图集</DialogTitle></DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>取消</Button>
            <Button onClick={handleRename}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>移动到其他人物</DialogTitle></DialogHeader>
          <div className="max-h-64 overflow-auto space-y-1">
            {persons.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">没有其他人物</p>}
            {persons.map(p => (
              <button
                key={p.id}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted text-left transition-colors"
                onClick={() => handleMove(p.id)}
                disabled={moveLoading}
              >
                <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                  {p.cover_file_path && <img src={mediaApi.thumbUrl(p.cover_file_path, 100)} alt="" className="w-full h-full object-cover" />}
                </div>
                <span className="text-sm truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>删除图集「{album.name}」</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">图集将被删除，请选择如何处理其中的 {album.media_count} 个媒体：</p>
            <div className="space-y-2">
              <label className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${deleteMode === 'album_only' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                <input type="radio" name="deleteMode" className="mt-0.5 accent-primary" checked={deleteMode === 'album_only'} onChange={() => setDeleteMode('album_only')} />
                <div>
                  <div className="text-sm font-medium">转为未分类</div>
                  <div className="text-xs text-muted-foreground">媒体保留在人物下，不再归属任何图集</div>
                </div>
              </label>
              {siblingAlbums.length > 0 && (
                <label className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${deleteMode === 'move_to_album' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                  <input type="radio" name="deleteMode" className="mt-0.5 accent-primary" checked={deleteMode === 'move_to_album'} onChange={() => setDeleteMode('move_to_album')} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">移到其他图集</div>
                    {deleteMode === 'move_to_album' && (
                      <select className="mt-1.5 w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                        value={targetAlbumId} onChange={(e) => setTargetAlbumId(e.target.value)}>
                        <option value="">选择目标图集...</option>
                        {siblingAlbums.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    )}
                  </div>
                </label>
              )}
              <label className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${deleteMode === 'album_and_media' ? 'border-destructive bg-destructive/5' : 'border-border hover:bg-muted/50'}`}>
                <input type="radio" name="deleteMode" className="mt-0.5 accent-primary" checked={deleteMode === 'album_and_media'} onChange={() => setDeleteMode('album_and_media')} />
                <div>
                  <div className="text-sm font-medium text-destructive">连同媒体一起删除</div>
                  <div className="text-xs text-muted-foreground">媒体将移入回收站</div>
                </div>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading || (deleteMode === 'move_to_album' && !targetAlbumId)}>
              {deleteLoading ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TagEditorDialog open={tagDialogOpen} onOpenChange={setTagDialogOpen} selectedTagIds={selectedTagIds} onToggle={handleTagToggle} />
    </>
  )
}

function AlbumTagIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  )
}
