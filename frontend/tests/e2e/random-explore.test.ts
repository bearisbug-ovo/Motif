import * as path from 'path'
import { API, createPerson, createAlbum, importTestImages, importToAlbum, navigateTo, waitForTestId, screenshot, getMediaByPerson, getMediaByAlbum, cleanupPerson, sleep } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')

describe('T-EXP: 随机探索 [PRD §8.8]', () => {
  let personId: string
  let person2Id: string
  let albumId: string
  let personMediaCount: number

  beforeAll(async () => {
    const ts = Date.now()
    const person = await createPerson('探索测试人物A_' + ts)
    personId = person.id
    await importTestImages(personId, [
      path.join(FIXTURES, 'test_1.jpg'),
      path.join(FIXTURES, 'test_2.jpg'),
      path.join(FIXTURES, 'test_3.jpg'),
    ])
    const album = await createAlbum('探索图集', personId)
    albumId = album.id
    await importToAlbum(albumId, [
      path.join(FIXTURES, 'test_4.jpg'),
      path.join(FIXTURES, 'test_5.jpg'),
    ])

    const person2 = await createPerson('探索测试人物B_' + ts)
    person2Id = person2.id
    await importTestImages(person2Id, [path.join(FIXTURES, 'test_1.jpg')])

    // Calculate actual media count for person A (may be less due to dedup)
    const loose = await getMediaByPerson(personId)
    const albumMedia = await getMediaByAlbum(albumId)
    personMediaCount = loose.length + albumMedia.length
  })

  afterAll(async () => {
    await cleanupPerson(personId)
    await cleanupPerson(person2Id)
  })

  it('T-EXP-01: explore API 返回媒体', async () => {
    const res = await fetch(`${API}/media/explore`)
    const data = await res.json()
    expect(data.length).toBeGreaterThan(0)
    await screenshot('exp-01-explore-api')
  })

  it('T-EXP-02: explore API 限定人物范围', async () => {
    const res = await fetch(`${API}/media/explore?person_id=${personId}`)
    const data = await res.json()
    expect(data.length).toBe(personMediaCount)
    for (const m of data) {
      expect(m.person_id).toBe(personId)
    }
    await screenshot('exp-02-explore-person-scope')
  })

  it('T-EXP-03: 人物主页随机按钮存在', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await sleep(500)

    // Look for shuffle button (Shuffle icon or "随机" text)
    const found = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button')
      for (const btn of buttons) {
        if (btn.textContent?.includes('随机') || btn.querySelector('.lucide-shuffle')) {
          return true
        }
      }
      return false
    })
    expect(found).toBe(true)
    await screenshot('exp-03-shuffle-button')
  })

  it('T-EXP-04: 图集详情页随机按钮存在', async () => {
    await navigateTo(`/albums/${albumId}`)
    await waitForTestId('album-detail-page')
    await sleep(500)

    const found = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button')
      for (const btn of buttons) {
        if (btn.textContent?.includes('随机') || btn.querySelector('.lucide-shuffle')) {
          return true
        }
      }
      return false
    })
    expect(found).toBe(true)
    await screenshot('exp-04-album-shuffle-button')
  })

  it('T-EXP-05: explore API 支持筛选参数', async () => {
    const res = await fetch(`${API}/media/explore?person_id=${personId}&media_type=image`)
    expect(res.ok).toBe(true)
    const data = await res.json()
    for (const m of data) {
      expect(m.media_type).toBe('image')
    }
    await screenshot('exp-05-explore-with-filter')
  })
})
