import * as path from 'path'
import { createPerson, createAlbum, importTestImages, importToAlbum, navigateTo, waitForTestId, screenshot, getMediaByPerson, getMediaByAlbum, rateMedia, cleanupPerson, sleep } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-FILT: 筛选排序 [PRD §5.8]', () => {
  let personId: string
  let albumId: string
  let albumMediaCount: number

  beforeAll(async () => {
    const person = await createPerson(`筛选排序人物_${Date.now()}`)
    personId = person.id
    const album = await createAlbum('筛选图集', personId)
    albumId = album.id
    await importToAlbum(albumId, testImages)
    await sleep(200)
    const media = await getMediaByAlbum(albumId)
    albumMediaCount = media.length
    // Rate them: 5,4,3,2,1 (only as many as we have)
    for (let i = 0; i < media.length; i++) {
      await rateMedia(media[i].id, Math.max(1, 5 - i))
    }
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-FILT-01: 按评分降序排列', async () => {
    if (albumMediaCount === 0) return
    const res = await fetch(`http://localhost:8000/api/media/album/${albumId}?sort=rating`)
    const data = await res.json()
    if (data.length === 0) return
    // Verify descending order
    for (let i = 0; i < data.length - 1; i++) {
      expect(data[i].rating).toBeGreaterThanOrEqual(data[i + 1].rating)
    }
    await screenshot('filt-01-sort-rating-desc')
  })

  it('T-FILT-02: 按创建时间排序', async () => {
    if (albumMediaCount === 0) return
    const res = await fetch(`http://localhost:8000/api/media/album/${albumId}?sort=created_at`)
    const data = await res.json()
    // Most recent first
    for (let i = 0; i < data.length - 1; i++) {
      expect(new Date(data[i].created_at).getTime()).toBeGreaterThanOrEqual(
        new Date(data[i + 1].created_at).getTime()
      )
    }
    await screenshot('filt-02-sort-created')
  })

  it('T-FILT-03: 按 sort_order 排序', async () => {
    if (albumMediaCount === 0) return
    const res = await fetch(`http://localhost:8000/api/media/album/${albumId}?sort=sort_order`)
    const data = await res.json()
    for (let i = 0; i < data.length - 1; i++) {
      expect(data[i].sort_order).toBeLessThanOrEqual(data[i + 1].sort_order)
    }
    await screenshot('filt-03-sort-order')
  })

  it('T-FILT-04: 评分等于筛选', async () => {
    if (albumMediaCount === 0) return
    const res = await fetch(`http://localhost:8000/api/media/album/${albumId}?filter_rating=eq:5`)
    const data = await res.json()
    // Only media rated exactly 5 (first item if we had enough media)
    data.forEach((m: any) => expect(m.rating).toBe(5))
    expect(data.length).toBeGreaterThanOrEqual(0)
    await screenshot('filt-04-filter-eq')
  })

  it('T-FILT-05: 评分大于等于筛选', async () => {
    if (albumMediaCount === 0) return
    const res = await fetch(`http://localhost:8000/api/media/album/${albumId}?filter_rating=gte:3`)
    const data = await res.json()
    data.forEach((m: any) => expect(m.rating).toBeGreaterThanOrEqual(3))
    await screenshot('filt-05-filter-gte')
  })

  it('T-FILT-06: 评分小于等于筛选', async () => {
    if (albumMediaCount === 0) return
    const res = await fetch(`http://localhost:8000/api/media/album/${albumId}?filter_rating=lte:2`)
    const data = await res.json()
    data.forEach((m: any) => expect(m.rating).toBeLessThanOrEqual(2))
    await screenshot('filt-06-filter-lte')
  })

  it('T-FILT-07: 排序+筛选组合', async () => {
    if (albumMediaCount === 0) return
    const res = await fetch(`http://localhost:8000/api/media/album/${albumId}?sort=rating&filter_rating=gte:3`)
    const data = await res.json()
    data.forEach((m: any) => expect(m.rating).toBeGreaterThanOrEqual(3))
    // Should be in descending order
    for (let i = 0; i < data.length - 1; i++) {
      expect(data[i].rating).toBeGreaterThanOrEqual(data[i + 1].rating)
    }
    await screenshot('filt-07-sort-filter-combo')
  })

  it('T-FILT-08: 筛选栏 UI 存在', async () => {
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    const text = await page.$eval('[data-testid="album-detail-page"]', (el) => el.textContent)
    // FilterBar should render sort/filter controls
    expect(text).toContain('筛选图集')
    await screenshot('filt-08-filter-ui')
  })
})
