import { useState } from 'react'
import { MoreHorizontal, Edit2, Trash2, FolderOpen } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Album } from '@/api/albums'
import { mediaApi } from '@/api/media'
import { StarRating } from './StarRating'
import { useAlbumStore } from '@/stores/album'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface AlbumCardProps {
  album: Album
}

export function AlbumCard({ album }: AlbumCardProps) {
  const navigate = useNavigate()
  const { updateAlbum, deleteAlbum } = useAlbumStore()
  const [renameOpen, setRenameOpen] = useState(false)
  const [newName, setNewName] = useState(album.name)

  const handleRename = async () => {
    if (newName.trim()) {
      await updateAlbum(album.id, { name: newName.trim() })
      setRenameOpen(false)
    }
  }

  const handleDelete = async () => {
    if (confirm(`确定要删除图集"${album.name}"吗？图片将保留但会移入回收站。`)) {
      await deleteAlbum(album.id)
    }
  }

  return (
    <>
      <div
        className="group relative rounded-lg overflow-hidden bg-card border border-border cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => navigate(`/albums/${album.id}`)}
      >
        {/* Cover */}
        <div className="aspect-video overflow-hidden bg-muted flex items-center justify-center">
          {album.cover_file_path ? (
            <img
              src={mediaApi.thumbUrl(album.cover_file_path, 400)}
              alt={album.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <FolderOpen className="w-12 h-12 text-muted-foreground opacity-30" />
          )}
        </div>

        {/* Info */}
        <div className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-medium text-sm truncate">{album.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{album.media_count} 张</p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => { setNewName(album.name); setRenameOpen(true) }}>
                  <Edit2 className="w-4 h-4 mr-2" />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  删除图集
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {album.avg_rating !== null && (
            <div className="mt-2 flex items-center gap-1.5">
              <StarRating value={Math.round(album.avg_rating)} readonly />
              <span className="text-xs text-muted-foreground">
                {album.avg_rating.toFixed(1)} ({album.rated_count})
              </span>
            </div>
          )}
        </div>
      </div>

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
    </>
  )
}
