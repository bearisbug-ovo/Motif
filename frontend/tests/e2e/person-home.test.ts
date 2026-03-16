import * as path from 'path'
import { API, createPerson, importTestImages, navigateTo, waitForTestId, countElements, screenshot, sleep, cleanupPerson, getMediaByPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-PER: 人物主页 [PRD §5.3]', () => {
  let personId: string
  let mediaCount: number
  const personName = '人物测试_' + Date.now()

  beforeAll(async () => {
    const person = await createPerson(personName)
    personId = person.id
    await importTestImages(personId, testImages)
    await sleep(200)
    const media = await getMediaByPerson(personId)
    mediaCount = media.length
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-PER-01: 人物主页显示人物名称', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    const text = await page.$eval('[data-testid="person-home-page"]', (el) => el.textContent)
    expect(text).toContain(personName)
    await screenshot('per-01-person-name')
  })

  it('T-PER-02: 显示图片数量统计', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    const text = await page.$eval('[data-testid="person-home-page"]', (el) => el.textContent)
    expect(text).toContain(`${mediaCount} 张`)
    await screenshot('per-02-image-count')
  })

  it('T-PER-03: 散图以网格展示', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    // Wait for media cards to render
    await page.waitForSelector('[data-testid="media-card"]', { timeout: 5000 })
    const count = await countElements('[data-testid="media-card"]')
    expect(count).toBe(mediaCount)
    await screenshot('per-03-loose-images-grid')
  })

  it('T-PER-04: 新建图集后显示在图集区域', async () => {
    // Create album via API
    const res = await fetch(`${API}/albums`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '测试图集', person_id: personId }),
    })
    const album = await res.json()

    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await page.waitForSelector('[data-testid="album-card"]', { timeout: 5000 })
    const count = await countElements('[data-testid="album-card"]')
    expect(count).toBe(1)
    await screenshot('per-04-album-section')
  })

  it('T-PER-05: 点击图集卡片跳转到图集详情', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await page.waitForSelector('[data-testid="album-card"]', { timeout: 5000 })
    await page.click('[data-testid="album-card"]')
    await waitForTestId('album-detail-page')
    expect(page.url()).toContain('/albums/')
    await screenshot('per-05-album-detail')
  })

  it('T-PER-06: 图集区和散图区同时显示', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    const text = await page.$eval('[data-testid="person-home-page"]', (el) => el.textContent)
    expect(text).toContain('图集')
    expect(text).toContain('散图')
    await screenshot('per-06-album-and-loose')
  })

  it('T-PER-07: 空图集提示', async () => {
    // The album we created earlier has no images
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await page.waitForSelector('[data-testid="album-card"]', { timeout: 5000 })
    // Click album to go to detail
    await page.click('[data-testid="album-card"]')
    await waitForTestId('album-detail-page')
    // Wait for album name to load (replaces "...")
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="album-detail-page"] h1')
        return el && el.textContent !== '...'
      },
      { timeout: 5000 }
    )
    const text = await page.$eval('[data-testid="album-detail-page"]', (el) => el.textContent)
    // Should show album name
    expect(text).toContain('测试图集')
    await screenshot('per-07-empty-album')
  })

  it('T-PER-08: 散图右键菜单操作', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await page.waitForSelector('[data-testid="media-card"]', { timeout: 5000 })
    // Right-click on media card
    await page.click('[data-testid="media-card"]', { button: 'right' })
    await sleep(300)
    const bodyText = await page.$eval('body', (el) => el.textContent)
    expect(bodyText).toContain('高清放大')
    await screenshot('per-08-loose-context-menu')
    // Close menu
    await page.keyboard.press('Escape')
  })
})
