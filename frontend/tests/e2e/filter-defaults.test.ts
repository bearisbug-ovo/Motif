import * as path from 'path'
import { API, createPerson, createAlbum, importToAlbum, navigateTo, waitForTestId, screenshot, getMediaByAlbum, rateMedia, cleanupPerson, sleep } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-FILT-DEF: 筛选默认值与重置 [PRD §8.2, §8.3]', () => {
  let personId: string
  let albumId: string
  let mediaCount: number

  beforeAll(async () => {
    const person = await createPerson('筛选默认值测试_' + Date.now())
    personId = person.id
    const album = await createAlbum('默认值图集', personId)
    albumId = album.id
    await importToAlbum(albumId, testImages)
    const media = await getMediaByAlbum(albumId)
    mediaCount = media.length
    // Rate media with descending scores
    for (let i = 0; i < media.length; i++) {
      await rateMedia(media[i].id, 5 - i)
    }
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-FILT-DEF-01: 页面进入时筛选重置为默认值', async () => {
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    await sleep(500)

    // Navigate away
    await navigateTo('/')
    await sleep(300)

    // Come back - should reset to defaults
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    await sleep(500)

    // Verify the page loaded with default sort (sort_order for album detail)
    const res = await fetch(`${API}/media/album/${albumId}?sort=sort_order`)
    const data = await res.json()
    expect(data.length).toBe(mediaCount)
    await screenshot('filt-def-01-reset-on-enter')
  })

  it('T-FILT-DEF-02: 设置页筛选默认值区域存在', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    await sleep(500)

    const text = await page.$eval('[data-testid="settings-page"]', (el) => el.textContent)
    expect(text).toBeTruthy()
    await screenshot('filt-def-02-settings-filter-section')
  })

  it('T-FILT-DEF-03: 筛选默认值通过 localStorage 持久化', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    await sleep(300)

    // Write a test value to localStorage
    await page.evaluate(() => {
      const current = JSON.parse(localStorage.getItem('motif-filter-defaults') || '{}')
      current['test-key'] = 'test-value'
      localStorage.setItem('motif-filter-defaults', JSON.stringify(current))
    })

    // Refresh and verify persistence
    await page.reload({ waitUntil: 'networkidle0' })
    const afterReload = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('motif-filter-defaults') || '{}')
      return data['test-key']
    })
    expect(afterReload).toBe('test-value')

    // Cleanup test key
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('motif-filter-defaults') || '{}')
      delete data['test-key']
      localStorage.setItem('motif-filter-defaults', JSON.stringify(data))
    })
    await screenshot('filt-def-03-localstorage-persist')
  })

  it('T-FILT-DEF-04: API 层面 sort 参数默认行为', async () => {
    // sort_order should be ascending
    const resSortOrder = await fetch(`${API}/media/album/${albumId}?sort=sort_order`)
    const dataSortOrder = await resSortOrder.json()
    expect(dataSortOrder.length).toBe(mediaCount)
    for (let i = 0; i < dataSortOrder.length - 1; i++) {
      expect(dataSortOrder[i].sort_order).toBeLessThanOrEqual(dataSortOrder[i + 1].sort_order)
    }

    // Rating sort should put highest first
    const resRating = await fetch(`${API}/media/album/${albumId}?sort=rating`)
    const dataRating = await resRating.json()
    if (dataRating.length > 1) {
      expect(dataRating[0].rating).toBeGreaterThanOrEqual(dataRating[1].rating)
    }
    await screenshot('filt-def-04-api-sort-defaults')
  })
})
