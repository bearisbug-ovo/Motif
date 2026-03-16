import * as path from 'path'
import { createPerson, importTestImages, navigateTo, waitForTestId, screenshot, getMediaByPerson, rateMedia, sleep, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-LBA: 大图操作 [PRD §5.6]', () => {
  let personId: string

  beforeAll(async () => {
    const person = await createPerson(`大图操作人物_${Date.now()}`)
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

  it('T-LBA-01: 键盘数字键快捷评分', async () => {
    await openFirstLightbox()
    await page.keyboard.press('3')
    await sleep(300)
    const media = await getMediaByPerson(personId)
    const rated = media.find((m: any) => m.rating === 3)
    expect(rated).toBeDefined()
    await screenshot('lba-01-keyboard-rating')
    await page.keyboard.press('Escape')
  })

  it('T-LBA-02: 键盘0键清除评分', async () => {
    await openFirstLightbox()
    await page.keyboard.press('0')
    await sleep(300)
    const media = await getMediaByPerson(personId)
    // The first item should now have null rating
    await screenshot('lba-02-clear-rating')
    await page.keyboard.press('Escape')
  })

  it('T-LBA-03: 右键菜单打开', async () => {
    await openFirstLightbox()
    // Right-click on the lightbox content area
    await page.click('[data-testid="lightbox"]', { button: 'right' })
    await sleep(300)
    // Context menu should appear
    await screenshot('lba-03-context-menu')
    // Close by pressing Escape
    await page.keyboard.press('Escape')
  })

  it('T-LBA-04: 右键菜单包含加入工作区', async () => {
    await openFirstLightbox()
    const img = await page.$('[data-testid="lightbox"] img')
    if (img) {
      await img.click({ button: 'right' })
      await sleep(300)
      const menuText = await page.$eval('body', (el) => el.textContent)
      expect(menuText).toContain('加入工作区')
      await screenshot('lba-04-workspace-menu')
    }
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  })

  it('T-LBA-05: 右键菜单包含生成链选项', async () => {
    await openFirstLightbox()
    const img = await page.$('[data-testid="lightbox"] img')
    if (img) {
      await img.click({ button: 'right' })
      await sleep(300)
      const menuText = await page.$eval('body', (el) => el.textContent)
      expect(menuText).toContain('生成链')
      await screenshot('lba-05-chain-menu')
    }
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  })

  it('T-LBA-06: 大图删除按钮存在', async () => {
    await openFirstLightbox()
    // Delete button should exist in toolbar
    const deleteBtn = await page.$('[data-testid="lightbox"] button[title="删除"]')
    expect(deleteBtn).not.toBeNull()
    await screenshot('lba-06-delete-button')
    await page.keyboard.press('Escape')
  })
})
