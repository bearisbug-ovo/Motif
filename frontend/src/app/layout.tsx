import { useState, useEffect, useCallback } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { BottomNav } from '@/components/BottomNav'
import { ClipboardImportDialog } from '@/components/ClipboardImportDialog'
import { Toaster } from '@/components/ui/toaster'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DeleteChoiceDialog } from '@/components/DeleteChoiceDialog'
import { useDevice } from '@/hooks/useDevice'

export function Layout() {
  const [clipboardBlob, setClipboardBlob] = useState<Blob | null>(null)
  const [clipboardOpen, setClipboardOpen] = useState(false)
  const { isMobile } = useDevice()

  // Global paste handler for clipboard image import
  const handlePaste = useCallback((e: ClipboardEvent) => {
    // Don't intercept if user is typing in an input
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile()
        if (blob) {
          e.preventDefault()
          setClipboardBlob(blob)
          setClipboardOpen(true)
        }
        break
      }
    }
  }, [])

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {!isMobile && <Sidebar />}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
      {isMobile && <BottomNav />}
      <Toaster />
      <ConfirmDialog />
      <DeleteChoiceDialog />
      <ClipboardImportDialog
        open={clipboardOpen}
        onOpenChange={setClipboardOpen}
        imageBlob={clipboardBlob}
      />
    </div>
  )
}
