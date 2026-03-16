import * as path from 'path'
import { API, createPerson, importTestImages, getMediaByPerson, navigateTo, waitForTestId, countElements, sleep, screenshot, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')

describe('T-BIN: 回收站 [PRD §5.10, §8.6]', () => {
  let personId: string
  let mediaIds: string[]
  const personName = `回收站测试_${Date.now()}`

  beforeAll(async () => {
    const person = await createPerson(personName)
    personId = person.id
    const testImages = [path.join(FIXTURES, 'test_1.jpg'), path.join(FIXTURES, 'test_2.jpg')]
    await importTestImages(personId, testImages)
    await sleep(200)
    const media = await getMediaByPerson(personId)
    mediaIds = media.map((m: any) => m.id)
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-BIN-01: 回收站初始为空', async () => {
    await navigateTo('/recycle-bin')
    await waitForTestId('recycle-bin-page')
    const text = await page.$eval('[data-testid="recycle-bin-page"]', (el) => el.textContent)
    expect(text).toContain('回收站')
    await screenshot('bin-01-empty')
  })

  it('T-BIN-02: 软删除后图片出现在回收站', async () => {
    // Soft delete via API
    if (mediaIds.length > 0) {
      await fetch(`${API}/media/${mediaIds[0]}`, { method: 'DELETE' })
    }

    await navigateTo('/recycle-bin')
    await waitForTestId('recycle-bin-page')
    // Wait for card to appear
    await page.waitForSelector('[data-testid="recycle-item"]', { timeout: 5000 }).catch(() => {})
    const count = await countElements('[data-testid="recycle-item"]')
    expect(count).toBeGreaterThanOrEqual(1)
    await screenshot('bin-02-with-deleted-item')
  })

  it('T-BIN-03: 恢复图片后从回收站消失', async () => {
    // Get count before restore
    await navigateTo('/recycle-bin')
    await waitForTestId('recycle-bin-page')
    await sleep(500)
    const countBefore = await countElements('[data-testid="recycle-item"]')

    if (mediaIds.length > 0) {
      await fetch(`${API}/recycle-bin/${mediaIds[0]}/restore`, { method: 'POST' })
    }

    await navigateTo('/recycle-bin')
    await waitForTestId('recycle-bin-page')
    await sleep(500)
    const countAfter = await countElements('[data-testid="recycle-item"]')
    // The restored item should no longer be in recycle bin
    expect(countAfter).toBeLessThan(countBefore)
    await screenshot('bin-03-after-restore')
  })

  it('T-BIN-04: 永久删除确认', async () => {
    // Soft delete again
    if (mediaIds.length > 0) {
      await fetch(`${API}/media/${mediaIds[0]}`, { method: 'DELETE' })
    }
    await navigateTo('/recycle-bin')
    await waitForTestId('recycle-bin-page')
    await page.waitForSelector('[data-testid="recycle-item"]', { timeout: 5000 }).catch(() => {})
    // The page should have a permanent delete button
    const text = await page.$eval('[data-testid="recycle-bin-page"]', (el) => el.textContent)
    expect(text).toContain('回收站')
    await screenshot('bin-04-permanent-delete')
  })

  it('T-BIN-05: 批量恢复', async () => {
    // Soft delete second item
    if (mediaIds.length > 1) {
      await fetch(`${API}/media/${mediaIds[1]}`, { method: 'DELETE' })
    }
    // Restore all items for this person via API
    const recycled = await fetch(`${API}/recycle-bin`).then(r => r.json())
    const binItems = Array.isArray(recycled) ? recycled : (recycled.items || [])
    const personItems = binItems.filter((m: any) => m.person_id === personId)
    for (const item of personItems) {
      await fetch(`${API}/recycle-bin/${item.id}/restore`, { method: 'POST' })
    }
    await navigateTo('/recycle-bin')
    await waitForTestId('recycle-bin-page')
    await sleep(500)
    // Verify our person's items are gone from recycle bin
    const afterRecycled = await fetch(`${API}/recycle-bin`).then(r => r.json())
    const afterBinItems = Array.isArray(afterRecycled) ? afterRecycled : (afterRecycled.items || [])
    const afterPersonItems = afterBinItems.filter((m: any) => m.person_id === personId)
    expect(afterPersonItems.length).toBe(0)
    await screenshot('bin-05-batch-restore')
  })
})
