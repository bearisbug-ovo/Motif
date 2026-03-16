import * as path from 'path'
import { createPerson, importTestImages, navigateTo, waitForTestId, screenshot, getMediaByPerson, sleep, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-KB: 键盘快捷键 [PRD §5.13]', () => {
  let personId: string
  const personName = `键盘快捷键人物_${Date.now()}`

  beforeAll(async () => {
    const person = await createPerson(personName)
    personId = person.id
    await importTestImages(personId, testImages)
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  const openFirstLightbox = async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await sleep(500)
    const cards = await page.$$('[data-testid="media-card"]')
    if (cards.length > 0) {
      await cards[0].click()
      await sleep(300)
    }
  }

  it('T-KB-01: 右箭头前进', async () => {
    await openFirstLightbox()
    const before = await page.$eval('[data-testid="lightbox"]', (el) => el.textContent)
    expect(before).toContain('1 /')
    await page.keyboard.press('ArrowRight')
    await sleep(200)
    const after = await page.$eval('[data-testid="lightbox"]', (el) => el.textContent)
    expect(after).toContain('2 /')
    await screenshot('kb-01-arrow-right')
    await page.keyboard.press('Escape')
  })

  it('T-KB-02: 左箭头后退', async () => {
    await openFirstLightbox()
    await page.keyboard.press('ArrowRight')
    await sleep(100)
    await page.keyboard.press('ArrowLeft')
    await sleep(200)
    const text = await page.$eval('[data-testid="lightbox"]', (el) => el.textContent)
    expect(text).toContain('1 /')
    await screenshot('kb-02-arrow-left')
    await page.keyboard.press('Escape')
  })

  it('T-KB-03: ESC 关闭大图', async () => {
    await openFirstLightbox()
    const lb = await page.$('[data-testid="lightbox"]')
    expect(lb).not.toBeNull()
    await page.keyboard.press('Escape')
    await sleep(300)
    const lb2 = await page.$('[data-testid="lightbox"]')
    expect(lb2).toBeNull()
    await screenshot('kb-03-escape')
  })

  it('T-KB-04: 数字键 1-5 评分', async () => {
    await openFirstLightbox()
    for (let i = 1; i <= 5; i++) {
      await page.keyboard.press(`${i}`)
      await sleep(100)
    }
    // Last press was 5
    const media = await getMediaByPerson(personId)
    const rated5 = media.filter((m: any) => m.rating === 5)
    expect(rated5.length).toBeGreaterThanOrEqual(1)
    await screenshot('kb-04-number-rating')
    await page.keyboard.press('Escape')
  })

  it('T-KB-05: 数字键 0 清除评分', async () => {
    await openFirstLightbox()
    await page.keyboard.press('5') // Set to 5
    await sleep(100)
    await page.keyboard.press('0') // Clear
    await sleep(200)
    await screenshot('kb-05-clear-rating')
    await page.keyboard.press('Escape')
  })
})
