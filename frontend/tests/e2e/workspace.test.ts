import * as path from 'path'
import { createPerson, importTestImages, addToWorkspace, navigateTo, waitForTestId, screenshot, getMediaByPerson, getWorkspaceItems, clearWorkspace, sleep, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-WS: 工作区 [PRD §5.10]', () => {
  let personId: string
  let mediaIds: string[]
  const personName = `工作区人物_${Date.now()}`

  beforeAll(async () => {
    const person = await createPerson(personName)
    personId = person.id
    await importTestImages(personId, testImages)
    await sleep(200)
    const media = await getMediaByPerson(personId)
    mediaIds = media.map((m: any) => m.id)
  })

  afterAll(async () => {
    await clearWorkspace()
    await cleanupPerson(personId)
  })

  it('T-WS-01: 工作区空状态', async () => {
    await navigateTo('/workspace')
    await waitForTestId('workspace-page')
    const text = await page.$eval('[data-testid="workspace-page"]', (el) => el.textContent)
    expect(text).toContain('工作区为空')
    await screenshot('ws-01-empty')
  })

  it('T-WS-02: 添加到工作区', async () => {
    if (mediaIds.length === 0) return
    await addToWorkspace(mediaIds[0])
    const items = await getWorkspaceItems()
    expect(items.length).toBe(1)
    await navigateTo('/workspace')
    await waitForTestId('workspace-page')
    const text = await page.$eval('[data-testid="workspace-page"]', (el) => el.textContent)
    expect(text).toContain('1/100')
    await screenshot('ws-02-added')
  })

  it('T-WS-03: 批量添加到工作区', async () => {
    if (mediaIds.length <= 1) return
    const res = await fetch('http://localhost:8000/api/workspace/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_ids: mediaIds.slice(1) }),
    })
    const data = await res.json()
    const items = await getWorkspaceItems()
    expect(items.length).toBe(mediaIds.length) // All imported media
    await screenshot('ws-03-batch-add')
  })

  it('T-WS-04: 去重添加', async () => {
    if (mediaIds.length === 0) return
    const beforeItems = await getWorkspaceItems()
    await addToWorkspace(mediaIds[0]) // Already added
    const items = await getWorkspaceItems()
    expect(items.length).toBe(beforeItems.length) // Same count (dedup)
    await screenshot('ws-04-dedup')
  })

  it('T-WS-05: 移除单个', async () => {
    const items = await getWorkspaceItems()
    if (items.length === 0) return
    const countBefore = items.length
    await fetch(`http://localhost:8000/api/workspace/${items[0].id}`, { method: 'DELETE' })
    const after = await getWorkspaceItems()
    expect(after.length).toBe(countBefore - 1)
    await screenshot('ws-05-remove-single')
  })

  it('T-WS-06: 拖拽排序 API', async () => {
    const items = await getWorkspaceItems()
    if (items.length < 2) return
    const reversed = [...items].reverse().map((i: any) => i.id)
    const res = await fetch('http://localhost:8000/api/workspace/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: reversed }),
    })
    expect(res.ok).toBe(true)
    const after = await getWorkspaceItems()
    expect(after[0].id).toBe(reversed[0])
    await screenshot('ws-06-reorder')
  })

  it('T-WS-07: 清空工作区', async () => {
    await clearWorkspace()
    const items = await getWorkspaceItems()
    expect(items.length).toBe(0)
    await navigateTo('/workspace')
    await waitForTestId('workspace-page')
    const text = await page.$eval('[data-testid="workspace-page"]', (el) => el.textContent)
    expect(text).toContain('工作区为空')
    await screenshot('ws-07-cleared')
  })
})
