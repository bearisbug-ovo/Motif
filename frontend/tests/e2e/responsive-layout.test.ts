import * as path from 'path'
import { createPerson, importTestImages, navigateTo, waitForTestId, screenshot, sleep, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 3 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-RESP: 响应式布局 [PRD §5.14]', () => {
  let personId: string
  const personName = `响应式测试人物_${Date.now()}`

  beforeAll(async () => {
    const person = await createPerson(personName)
    personId = person.id
    await importTestImages(personId, testImages)
  })

  afterAll(async () => {
    // Reset viewport to default
    await page.setViewport({ width: 1280, height: 800 })
    await cleanupPerson(personId)
  })

  it('T-RESP-01: 桌面宽屏布局 (1920px)', async () => {
    await page.setViewport({ width: 1920, height: 1080 })
    await navigateTo('/')
    await waitForTestId('media-library-page')
    await screenshot('resp-01-desktop-wide')
  })

  it('T-RESP-02: 标准桌面布局 (1280px)', async () => {
    await page.setViewport({ width: 1280, height: 800 })
    await navigateTo('/')
    await waitForTestId('media-library-page')
    await screenshot('resp-02-desktop-standard')
  })

  it('T-RESP-03: 平板布局 (768px)', async () => {
    await page.setViewport({ width: 768, height: 1024 })
    await navigateTo('/')
    await waitForTestId('media-library-page')
    await screenshot('resp-03-tablet')
  })

  it('T-RESP-04: 手机布局 (375px)', async () => {
    await page.setViewport({ width: 375, height: 812 })
    await navigateTo('/')
    await waitForTestId('media-library-page')
    await screenshot('resp-04-mobile')
  })
})
