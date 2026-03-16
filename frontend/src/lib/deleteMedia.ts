import { mediaApi } from '@/api/media'
import { confirm } from '@/components/ConfirmDialog'
import { askDeleteChoice, type DeleteChoice } from '@/components/DeleteChoiceDialog'

/**
 * Prompt user and delete a single media item, handling generation chain descendants.
 * Returns the chosen mode if deletion proceeded, or null if cancelled.
 */
export async function confirmAndDelete(
  id: string,
  softDelete: (id: string, mode?: 'cascade' | 'reparent') => Promise<void>,
): Promise<DeleteChoice> {
  // Check for descendants
  let count = 0
  try {
    const res = await mediaApi.getDescendantsCount(id)
    count = res.count
  } catch {
    // If the check fails, fall back to simple confirm
  }

  if (count > 0) {
    const choice = await askDeleteChoice(count)
    if (!choice) return null
    await softDelete(id, choice)
    return choice
  }

  // No descendants — simple confirm
  if (!await confirm({ title: '确定要删除这张图片吗？' })) return null
  await softDelete(id)
  return 'cascade'
}
