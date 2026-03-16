import { create } from 'zustand'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export type DeleteChoice = 'cascade' | 'reparent' | null

interface DeleteChoiceState {
  open: boolean
  count: number  // 0 = batch/unknown, >0 = specific count
  resolve: ((value: DeleteChoice) => void) | null
}

interface DeleteChoiceStore extends DeleteChoiceState {
  ask: (descendantsCount: number) => Promise<DeleteChoice>
  close: (value: DeleteChoice) => void
}

const useDeleteChoiceStore = create<DeleteChoiceStore>((set, get) => ({
  open: false,
  count: 0,
  resolve: null,

  ask: (descendantsCount) => {
    return new Promise<DeleteChoice>((resolve) => {
      set({ open: true, count: descendantsCount, resolve })
    })
  },

  close: (value) => {
    const { resolve } = get()
    resolve?.(value)
    set({ open: false, resolve: null })
  },
}))

/** Ask user how to handle descendants before deleting media with children. */
export const askDeleteChoice = useDeleteChoiceStore.getState().ask

export function DeleteChoiceDialog() {
  const { open, count, close } = useDeleteChoiceStore()

  const title = count > 0
    ? `该图片有 ${count} 张子图`
    : '选中的图片可能包含子图'

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(null) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            请选择删除方式
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          <Button
            variant="destructive"
            className="w-full justify-start"
            onClick={() => close('cascade')}
          >
            一并删除所有子图
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => close('reparent')}
          >
            保留子图（子图归属到父节点）
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(null)}>取消</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
