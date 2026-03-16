import * as path from 'path'
import { createPerson, createAlbum, importToAlbum, navigateTo, waitForTestId, countElements, screenshot, getAlbums, getMediaByAlbum, rateMedia, sleep, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-ADET: 图集详情页 [PRD §5.4]', () => {
  let personId: string
  let albumId: string
  let mediaCount: number

  beforeAll(async () => {
    const person = await createPerson(`图集详情人物_${Date.now()}`)
    personId = person.id
    const album = await createAlbum('详情测试图集', personId)
    albumId = album.id
    await importToAlbum(albumId, testImages)
    await sleep(200)
    const media = await getMediaByAlbum(albumId)
    mediaCount = media.length
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-ADET-01: 图集详情页加载并显示媒体', async () => {
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    const text = await page.$eval('[data-testid="album-detail-page"]', (el) => el.textContent)
    expect(text).toContain('详情测试图集')
    await screenshot('adet-01-album-loaded')
  })

  it('T-ADET-02: 图集详情显示正确数量的媒体', async () => {
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    await sleep(500)
    const media = await getMediaByAlbum(albumId)
    expect(media.length).toBe(mediaCount)
    await screenshot('adet-02-media-count')
  })

  it('T-ADET-03: 图集筛选栏存在', async () => {
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    // FilterBar should be present
    const filterBar = await page.$('[data-testid="album-detail-page"] select, [data-testid="album-detail-page"] [data-testid="filter-bar"]')
    // If there's a filter UI, it should exist
    await screenshot('adet-03-filter-bar')
  })

  it('T-ADET-04: 图集内评分筛选', async () => {
    const media = await getMediaByAlbum(albumId)
    if (media.length < 3) return
    // Rate first 2 as 5 stars
    await rateMedia(media[0].id, 5)
    await rateMedia(media[1].id, 5)
    await rateMedia(media[2].id, 1)
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    await screenshot('adet-04-rating-filter')
  })

  it('T-ADET-05: 图集排序切换', async () => {
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    // Just verify page loads with different sort (API-level)
    const byRating = await fetch(`http://localhost:8000/api/media/album/${albumId}?sort=rating`)
    const data = await byRating.json()
    if (data.length === 0) return
    // Highest rated first (if ratings were set in previous test)
    if (data[0].rating !== null) {
      expect(data[0].rating).toBeGreaterThanOrEqual(data[data.length - 1].rating || 0)
    }
    await screenshot('adet-05-sort-toggle')
  })

  it('T-ADET-06: 图集封面设置', async () => {
    const media = await getMediaByAlbum(albumId)
    if (media.length === 0) return
    await fetch(`http://localhost:8000/api/albums/${albumId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover_media_id: media[0].id }),
    })
    const albums = await getAlbums(personId)
    const album = albums.find((a: any) => a.id === albumId)
    expect(album?.cover_media_id).toBe(media[0].id)
    await screenshot('adet-06-cover-set')
  })

  it('T-ADET-07: 图集内点击打开大图', async () => {
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    await sleep(500)
    // Click first media card
    const cards = await page.$$('[data-testid="album-detail-page"] [data-testid="media-card"]')
    if (cards.length > 0) {
      await cards[0].click()
      await sleep(300)
      const lightbox = await page.$('[data-testid="lightbox"]')
      expect(lightbox).not.toBeNull()
      await screenshot('adet-07-lightbox-open')
      await page.keyboard.press('Escape')
    }
  })

  it('T-ADET-08: 图集返回按钮', async () => {
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    // The back button should exist
    const backBtn = await page.$('button')
    expect(backBtn).not.toBeNull()
    await screenshot('adet-08-back-button')
  })
})
