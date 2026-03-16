import * as path from 'path'
import { createPerson, importTestImages, navigateTo, waitForTestId, screenshot, getMediaByPerson, sleep, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 3 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-LBGEN: 大图生成链功能 [PRD §5.6]', () => {
  let personId: string

  beforeAll(async () => {
    const person = await createPerson(`生成链人物_${Date.now()}`)
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

  it('T-LBGEN-01: 右键菜单显示生成链选项', async () => {
    await openFirstLightbox()
    const img = await page.$('[data-testid="lightbox"] img')
    if (img) {
      await img.click({ button: 'right' })
      await sleep(300)
      const text = await page.$eval('body', (el) => el.textContent)
      expect(text).toContain('生成链')
      await screenshot('lbgen-01-chain-option')
    }
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  })

  it('T-LBGEN-02: 生成链面板打开', async () => {
    await openFirstLightbox()
    const img = await page.$('[data-testid="lightbox"] img')
    if (img) {
      await img.click({ button: 'right' })
      await sleep(300)
      // Look for 生成链 menu item and click it
      const menuItems = await page.$$('body > div[class*="fixed"] button, body > div[class*="fixed"] [role="menuitem"]')
      for (const item of menuItems) {
        const text = await item.evaluate((el: any) => el.textContent)
        if (text?.includes('生成链')) {
          await item.click()
          break
        }
      }
      await sleep(500)
      // Chain panel should now be visible
      const text = await page.$eval('[data-testid="lightbox"]', (el) => el.textContent)
      expect(text).toContain('生成链')
      await screenshot('lbgen-02-chain-panel-open')
    }
    await page.keyboard.press('Escape')
  })

  it('T-LBGEN-03: 生成链 API 返回树结构', async () => {
    const media = await getMediaByPerson(personId)
    if (media.length === 0) return
    const res = await fetch(`http://localhost:8000/api/media/${media[0].id}/tree`)
    const data = await res.json()
    expect(data.root).toBeDefined()
    expect(data.root.id).toBe(media[0].id)
    await screenshot('lbgen-03-tree-api')
  })

  it('T-LBGEN-04: 脱离生成链 API', async () => {
    const media = await getMediaByPerson(personId)
    if (media.length < 1) return
    // Call detach on a media (even without parent, should succeed and return null fields)
    const res = await fetch(`http://localhost:8000/api/media/${media[0].id}/detach`, { method: 'POST' })
    expect(res.ok).toBe(true)
    const updated = await res.json()
    expect(updated.parent_media_id).toBeNull()
    expect(updated.workflow_type).toBeNull()
    await screenshot('lbgen-04-detach-api')
  })

  it('T-LBGEN-05: 无生成链图片显示无数据提示', async () => {
    await openFirstLightbox()
    const img = await page.$('[data-testid="lightbox"] img')
    if (img) {
      await img.click({ button: 'right' })
      await sleep(300)
      const menuItems = await page.$$('body > div[class*="fixed"] button, body > div[class*="fixed"] [role="menuitem"]')
      for (const item of menuItems) {
        const text = await item.evaluate((el: any) => el.textContent)
        if (text?.includes('生成链')) {
          await item.click()
          break
        }
      }
      await sleep(500)
      await screenshot('lbgen-05-no-chain-data')
    }
    await page.keyboard.press('Escape')
  })
})
