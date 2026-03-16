import * as path from 'path'
import { API, BASE, createPerson, createAlbum, importToAlbum, navigateTo, waitForTestId, screenshot, getMediaByAlbum, cleanupPerson, sleep } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')

describe('T-MTYPE: 媒体类型筛选 [PRD §5.5]', () => {
  let personId: string
  let albumId: string

  beforeAll(async () => {
    const person = await createPerson('媒体类型测试_' + Date.now())
    personId = person.id
    const album = await createAlbum('类型筛选图集', personId)
    albumId = album.id
    const files = [
      path.join(FIXTURES, 'test_1.jpg'),
      path.join(FIXTURES, 'test_2.jpg'),
      path.join(FIXTURES, 'test_3.jpg'),
      path.join(FIXTURES, 'test_video.mp4'),
    ]
    await importToAlbum(albumId, files)
    await sleep(500)
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-MTYPE-01: API 无筛选返回全部媒体', async () => {
    const res = await fetch(`${API}/media/album/${albumId}`)
    const data = await res.json()
    expect(data.length).toBeGreaterThan(0)
    await screenshot('mtype-01-all-types')
  })

  it('T-MTYPE-02: media_type 筛选逻辑验证（image）', async () => {
    // Navigate to a page first so page.evaluate has a valid context
    await navigateTo('/')
    await sleep(300)

    // Use browser's fetch via Vite proxy to bypass node HTTP_PROXY
    const data: any[] = await page.evaluate(async (aid: string) => {
      const res = await fetch(`/api/media/album/${aid}?media_type=image`)
      return res.json()
    }, albumId)

    for (const m of data) {
      expect(m.media_type).toBe('image')
    }
    await screenshot('mtype-02-filter-image')
  })

  it('T-MTYPE-03: media_type 筛选逻辑验证（video）', async () => {
    const data: any[] = await page.evaluate(async (aid: string) => {
      const res = await fetch(`/api/media/album/${aid}?media_type=video`)
      return res.json()
    }, albumId)

    for (const m of data) {
      expect(m.media_type).toBe('video')
    }
    await screenshot('mtype-03-filter-video')
  })

  it('T-MTYPE-04: FilterBar 渲染筛选控件', async () => {
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    await sleep(500)

    const hasTriggers = await page.evaluate(() => {
      return document.querySelectorAll('button[role="combobox"]').length
    })
    expect(hasTriggers).toBeGreaterThan(0)
    await screenshot('mtype-04-filterbar-controls')
  })

  it('T-MTYPE-05: media_type 与 filter_rating 组合筛选', async () => {
    const media = await getMediaByAlbum(albumId)
    const image = media.find((m: any) => m.media_type === 'image')
    if (image) {
      await fetch(`${API}/media/${image.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 5 }),
      })

      const data: any[] = await page.evaluate(async (aid: string) => {
        const res = await fetch(`/api/media/album/${aid}?media_type=image&filter_rating=eq:5`)
        return res.json()
      }, albumId)

      expect(data.length).toBeGreaterThanOrEqual(1)
      for (const m of data) {
        expect(m.media_type).toBe('image')
        expect(m.rating).toBe(5)
      }
    } else {
      const res = await fetch(`${API}/media/album/${albumId}?media_type=image&filter_rating=eq:5`)
      expect(res.ok).toBe(true)
    }
    await screenshot('mtype-05-combo-filter')
  })
})
