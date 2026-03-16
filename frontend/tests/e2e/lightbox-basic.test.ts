import * as path from 'path'
import { createPerson, importTestImages, navigateTo, waitForTestId, screenshot, getMediaByPerson, sleep, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-LB: 大图浏览基础 [PRD §5.6]', () => {
  let personId: string

  beforeAll(async () => {
    const person = await createPerson(`大图测试人物_${Date.now()}`)
    personId = person.id
    await importTestImages(personId, testImages)
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-LB-01: 点击卡片打开大图', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await sleep(500)
    const cards = await page.$$('[data-testid="media-card"]')
    expect(cards.length).toBeGreaterThan(0)
    await cards[0].click()
    await sleep(300)
    const lightbox = await page.$('[data-testid="lightbox"]')
    expect(lightbox).not.toBeNull()
    await screenshot('lb-01-lightbox-open')
  })

  it('T-LB-02: ESC 关闭大图', async () => {
    await page.keyboard.press('Escape')
    await sleep(300)
    const lightbox = await page.$('[data-testid="lightbox"]')
    expect(lightbox).toBeNull()
    await screenshot('lb-02-lightbox-closed')
  })

  it('T-LB-03: 左右箭头切换图片', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await sleep(500)
    const cards = await page.$$('[data-testid="media-card"]')
    await cards[0].click()
    await sleep(300)
    // Check counter shows "1 /"
    let counter = await page.$eval('[data-testid="lightbox"]', (el) => el.textContent)
    expect(counter).toContain('1 /')
    // Press right arrow
    await page.keyboard.press('ArrowRight')
    await sleep(200)
    counter = await page.$eval('[data-testid="lightbox"]', (el) => el.textContent)
    expect(counter).toContain('2 /')
    // Press left arrow
    await page.keyboard.press('ArrowLeft')
    await sleep(200)
    counter = await page.$eval('[data-testid="lightbox"]', (el) => el.textContent)
    expect(counter).toContain('1 /')
    await screenshot('lb-03-arrow-navigation')
    await page.keyboard.press('Escape')
  })

  it('T-LB-04: 大图显示图片计数器', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await sleep(500)
    const cards = await page.$$('[data-testid="media-card"]')
    await cards[0].click()
    await sleep(300)
    const text = await page.$eval('[data-testid="lightbox"]', (el) => el.textContent)
    expect(text).toMatch(/\d+ \/ \d+/)
    await screenshot('lb-04-counter')
    await page.keyboard.press('Escape')
  })

  it('T-LB-05: 大图顶部工具栏可见', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await sleep(500)
    const cards = await page.$$('[data-testid="media-card"]')
    await cards[0].click()
    await sleep(300)
    // Check that top bar with buttons exists
    const buttons = await page.$$('[data-testid="lightbox"] button')
    expect(buttons.length).toBeGreaterThan(0)
    await screenshot('lb-05-top-toolbar')
    await page.keyboard.press('Escape')
  })

  it('T-LB-06: 大图缩略图条可见', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await sleep(500)
    const cards = await page.$$('[data-testid="media-card"]')
    await cards[0].click()
    await sleep(300)
    // Thumbnail strip should exist when >1 items
    const strip = await page.$('[data-testid="lightbox"] .overflow-x-auto')
    expect(strip).not.toBeNull()
    await screenshot('lb-06-thumbnail-strip')
    await page.keyboard.press('Escape')
  })

  it('T-LB-07: 大图图片正确加载', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await sleep(500)
    const cards = await page.$$('[data-testid="media-card"]')
    await cards[0].click()
    await sleep(500)
    // Check that main image loaded
    const imgSrc = await page.$eval('[data-testid="lightbox"] img', (el) => (el as HTMLImageElement).src)
    expect(imgSrc).toContain('/api/files/serve')
    await screenshot('lb-07-image-loaded')
    await page.keyboard.press('Escape')
  })
})
