import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { mediaApi } from '@/api/media'
import { usePersonStore } from '@/stores/person'
import { useAlbumStore } from '@/stores/album'
import { toast } from '@/hooks/use-toast'

interface ClipboardImportDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  imageBlob: Blob | null
  onComplete?: () => void
}

export function ClipboardImportDialog({ open, onOpenChange, imageBlob, onComplete }: ClipboardImportDialogProps) {
  const { persons, fetchPersons } = usePersonStore()
  const { albums, fetchAlbumsByPerson } = useAlbumStore()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [personId, setPersonId] = useState('')
  const [albumId, setAlbumId] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      fetchPersons()
      setPersonId('')
      setAlbumId('')
    }
  }, [open, fetchPersons])

  useEffect(() => {
    if (imageBlob) {
      const url = URL.createObjectURL(imageBlob)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setPreviewUrl(null)
  }, [imageBlob])

  useEffect(() => {
    if (personId) fetchAlbumsByPerson(personId)
  }, [personId, fetchAlbumsByPerson])

  const handleImport = async () => {
    if (!imageBlob) return
    setLoading(true)
    try {
      await mediaApi.importClipboard(imageBlob, personId || undefined, albumId || undefined)
      toast({ title: '剪贴板图片已导入' })
      onOpenChange(false)
      onComplete?.()
    } catch {
      toast({ title: '导入失败', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>导入剪贴板图片</DialogTitle>
        </DialogHeader>

        {previewUrl && (
          <div className="rounded-md overflow-hidden border border-border max-h-60">
            <img src={previewUrl} alt="剪贴板图片" className="w-full h-full object-contain" />
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium mb-1 block">关联人物</label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={personId}
              onChange={(e) => { setPersonId(e.target.value); setAlbumId('') }}
            >
              <option value="">不关联</option>
              {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {personId && albums.length > 0 && (
            <div>
              <label className="text-sm font-medium mb-1 block">关联图集</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={albumId}
                onChange={(e) => setAlbumId(e.target.value)}
              >
                <option value="">不关联</option>
                {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleImport} disabled={loading || !imageBlob}>导入</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
