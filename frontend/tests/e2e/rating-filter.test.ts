import * as path from 'path'
import { API, createPerson, importTestImages, getMediaByPerson, navigateTo, waitForTestId, countElements, screenshot, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-RATE + T-FILT: 评分与筛选 [PRD §8.1, §8.2]', () => {
  let personId: string
  let mediaIds: string[]
  const personName = '评分测试_' + Date.now()

  beforeAll(async () => {
    const person = await createPerson(personName)
    personId = person.id
    await importTestImages(personId, testImages)
    const media = await getMediaByPerson(personId)
    mediaIds = media.map((m: any) => m.id)

    // Rate some images via API
    if (mediaIds.length >= 3) {
      await fetch(`${API}/media/${mediaIds[0]}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 5 }),
      })
      await fetch(`${API}/media/${mediaIds[1]}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 3 }),
      })
      await fetch(`${API}/media/${mediaIds[2]}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 1 }),
      })
    }
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-RATE-01: 评分后图片显示评分徽章', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await page.waitForSelector('[data-testid="media-card"]', { timeout: 5000 })

    // Check that at least one card has a rating badge (★)
    const badges = await page.$$eval('[data-testid="media-card"]', (cards) =>
      cards.filter((c) => c.textContent?.includes('★')).length
    )
    expect(badges).toBeGreaterThanOrEqual(3)
    await screenshot('rate-01-rating-badges')
  })

  it('T-RATE-02: 人物平均评分显示', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    // Person header should show avg rating info
    const text = await page.$eval('[data-testid="person-home-page"]', (el) => el.textContent)
    // UI shows avg rating like "2.8 (3)" meaning avg 2.8, 3 rated
    expect(text).toMatch(/\d+\.\d+\s*\(\d+\)/)
    await screenshot('rate-02-avg-rating')
  })

  it('T-RATE-03: 多星级 API 筛选组合', async () => {
    // gte:3 should return 2 items (5 and 3)
    const res = await fetch(`${API}/media/person/${personId}/loose?filter_rating=gte:3`)
    const data = await res.json()
    expect(data.length).toBe(2)
    await screenshot('rate-03-multi-filter')
  })

  it('T-RATE-04: 清除筛选恢复全部', async () => {
    const all = await fetch(`${API}/media/person/${personId}/loose`).then(r => r.json())
    expect(all.length).toBe(5) // All items without filter
    await screenshot('rate-04-clear-filter')
  })

  it('T-RATE-05: 筛选与排序联动', async () => {
    const res = await fetch(`${API}/media/person/${personId}/loose?sort=rating&filter_rating=gte:1`)
    const data = await res.json()
    expect(data.length).toBe(3) // Only rated items
    // First should be highest
    expect(data[0].rating).toBe(5)
    await screenshot('rate-05-filter-sort-combo')
  })
})
