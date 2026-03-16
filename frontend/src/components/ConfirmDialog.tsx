import { create } from 'zustand'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmState {
  open: boolean
  title: string
  description?: string
  confirmText: string
  cancelText: string
  variant: 'default' | 'destructive'
  resolve: ((value: boolean) => void) | null
}

interface ConfirmStore extends ConfirmState {
  confirm: (opts: {
    title: string
    description?: string
    confirmText?: string
    cancelText?: string
    variant?: 'default' | 'destructive'
  }) => Promise<boolean>
  close: (value: boolean) => void
}

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  open: false,
  title: '',
  description: undefined,
  confirmText: '确定',
  cancelText: '取消',
  variant: 'destructive',
  resolve: null,

  confirm: (opts) => {
    return new Promise<boolean>((resolve) => {
      set({
        open: true,
        title: opts.title,
        description: opts.description,
        confirmText: opts.confirmText ?? '确定',
        cancelText: opts.cancelText ?? '取消',
        variant: opts.variant ?? 'destructive',
        resolve,
      })
    })
  },

  close: (value) => {
    const { resolve } = get()
    resolve?.(value)
    set({ open: false, resolve: null })
  },
}))

/** Shortcut: await confirm({ title: '...' }) */
export const confirm = useConfirmStore.getState().confirm

export function ConfirmDialog() {
  const { open, title, description, confirmText, cancelText, variant, close } = useConfirmStore()

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(false) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => close(false)}>{cancelText}</Button>
          <Button variant={variant} onClick={() => close(true)}>{confirmText}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
