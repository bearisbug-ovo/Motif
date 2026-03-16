import * as path from 'path'
import { createPerson, createAlbum, importTestImages, importToAlbum, navigateTo, waitForTestId, screenshot, getMediaByPerson, getMediaByAlbum, rateMedia, softDeleteMedia, cleanupPerson, sleep } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-MCRUD: 媒体操作 [PRD §5.7]', () => {
  let personId: string
  let albumId: string
  const personName = `媒体操作人物_${Date.now()}`

  beforeAll(async () => {
    const person = await createPerson(personName)
    personId = person.id
    await importTestImages(personId, testImages)
    await sleep(200)
    const album = await createAlbum('媒体图集', personId)
    albumId = album.id
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-MCRUD-01: 评分持久化', async () => {
    const media = await getMediaByPerson(personId)
    if (media.length === 0) return
    await rateMedia(media[0].id, 4)
    // Re-fetch to verify
    const updated = await fetch(`http://localhost:8000/api/media/${media[0].id}`).then(r => r.json())
    expect(updated.rating).toBe(4)
    await screenshot('mcrud-01-rating-persist')
  })

  it('T-MCRUD-02: 清除评分', async () => {
    const media = await getMediaByPerson(personId)
    if (media.length === 0) return
    await rateMedia(media[0].id, 0) // 0 = clear
    const updated = await fetch(`http://localhost:8000/api/media/${media[0].id}`).then(r => r.json())
    expect(updated.rating).toBeNull()
    await screenshot('mcrud-02-clear-rating')
  })

  it('T-MCRUD-03: 软删除', async () => {
    const media = await getMediaByPerson(personId)
    if (media.length === 0) return
    const countBefore = media.length
    await softDeleteMedia(media[media.length - 1].id)
    const after = await getMediaByPerson(personId)
    expect(after.length).toBe(countBefore - 1)
    await screenshot('mcrud-03-soft-delete')
  })

  it('T-MCRUD-04: 批量删除', async () => {
    const media = await getMediaByPerson(personId)
    if (media.length < 2) return
    const countBefore = media.length
    const toDelete = media.slice(-2).map((m: any) => m.id)
    await fetch('http://localhost:8000/api/media/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: toDelete }),
    })
    const after = await getMediaByPerson(personId)
    expect(after.length).toBe(countBefore - 2)
    await screenshot('mcrud-04-batch-delete')
  })

  it('T-MCRUD-05: 移动到图集', async () => {
    const media = await getMediaByPerson(personId)
    if (media.length === 0) return
    await fetch(`http://localhost:8000/api/media/${media[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ album_id: albumId }),
    })
    const albumMedia = await getMediaByAlbum(albumId)
    expect(albumMedia.some((m: any) => m.id === media[0].id)).toBe(true)
    await screenshot('mcrud-05-move-to-album')
  })

  it('T-MCRUD-06: 批量评分', async () => {
    const media = await getMediaByPerson(personId)
    const ids = media.slice(0, 2).map((m: any) => m.id)
    if (ids.length < 2) return
    await fetch('http://localhost:8000/api/media/batch', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, rating: 3 }),
    })
    for (const id of ids) {
      const m = await fetch(`http://localhost:8000/api/media/${id}`).then(r => r.json())
      expect(m.rating).toBe(3)
    }
    await screenshot('mcrud-06-batch-rate')
  })
})
