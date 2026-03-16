import * as path from 'path'
import { createPerson, importTestImages, navigateTo, waitForTestId, screenshot, getMediaByPerson, rateMedia, batchDeleteMedia, sleep, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-BATCH: 批量操作 [PRD §5.12]', () => {
  let personId: string
  const personName = `批量操作人物_${Date.now()}`

  beforeAll(async () => {
    const person = await createPerson(personName)
    personId = person.id
    await importTestImages(personId, testImages)
    await sleep(200)
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-BATCH-01: 批量删除 API', async () => {
    const media = await getMediaByPerson(personId)
    if (media.length < 2) return
    const countBefore = media.length
    const toDelete = media.slice(-2).map((m: any) => m.id)
    const result = await batchDeleteMedia(toDelete)
    expect(result.deleted.length).toBe(2)
    const after = await getMediaByPerson(personId)
    expect(after.length).toBe(countBefore - 2)
    await screenshot('batch-01-delete')
  })

  it('T-BATCH-02: 批量评分 API', async () => {
    const media = await getMediaByPerson(personId)
    if (media.length === 0) return
    const ids = media.map((m: any) => m.id)
    await fetch('http://localhost:8000/api/media/batch', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, rating: 4 }),
    })
    for (const id of ids) {
      const m = await fetch(`http://localhost:8000/api/media/${id}`).then(r => r.json())
      expect(m.rating).toBe(4)
    }
    await screenshot('batch-02-rate')
  })

  it('T-BATCH-03: 清理低分图 API', async () => {
    const media = await getMediaByPerson(personId)
    if (media.length === 0) return
    // Rate one as 1 star
    await rateMedia(media[0].id, 1)
    // Use explore to get all media, then batch delete low scores
    const allMedia = await fetch(`http://localhost:8000/api/media/explore?person_id=${personId}`).then(r => r.json())
    const lowScore = allMedia.filter((m: any) => m.rating !== null && m.rating <= 2)
    if (lowScore.length > 0) {
      await batchDeleteMedia(lowScore.map((m: any) => m.id))
    }
    const after = await getMediaByPerson(personId)
    expect(after.every((m: any) => m.rating === null || m.rating > 2)).toBe(true)
    await screenshot('batch-03-cleanup-low')
  })

  it('T-BATCH-04: 多选模式 UI', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    const text = await page.$eval('[data-testid="person-home-page"]', (el) => el.textContent)
    expect(text).toContain('多选')
    await screenshot('batch-04-multiselect-ui')
  })

  it('T-BATCH-05: 批量移动到图集 API', async () => {
    const { id: albumId } = await fetch('http://localhost:8000/api/albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '批量目标图集', person_id: personId }),
    }).then(r => r.json())
    const media = await getMediaByPerson(personId)
    if (media.length === 0) return
    const ids = [media[0].id]
    await fetch('http://localhost:8000/api/media/batch', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, album_id: albumId }),
    })
    const albumMedia = await fetch(`http://localhost:8000/api/media/album/${albumId}`).then(r => r.json())
    expect(albumMedia.some((m: any) => m.id === ids[0])).toBe(true)
    await screenshot('batch-05-move-to-album')
  })
})
