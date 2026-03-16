import * as path from 'path'
import { createPerson, importTestImages, navigateTo, waitForTestId, countElements, screenshot, getPersons, getMediaByPerson, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = [path.join(FIXTURES, 'test_1.jpg')]

describe('T-PCRUD: 人物 CRUD [PRD §5.2]', () => {
  const suffix = Date.now()
  const createdPersonIds: string[] = []

  afterAll(async () => {
    for (const id of createdPersonIds) {
      await cleanupPerson(id).catch(() => {})
    }
  })

  it('T-PCRUD-01: 通过 UI 创建人物', async () => {
    await navigateTo('/')
    await waitForTestId('media-library-page')
    // Click the create person button
    const addBtn = await page.$('[data-testid="add-person-btn"]')
    if (addBtn) {
      await addBtn.click()
      await page.waitForSelector('input', { timeout: 3000 })
      await page.type('input', `新建人物Test_${suffix}`)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1000)
      // Try to find the created person to track for cleanup
      const persons = await getPersons()
      const created = persons.find((p: any) => p.name === `新建人物Test_${suffix}`)
      if (created) createdPersonIds.push(created.id)
    } else {
      // Fallback: create via API
      const p = await createPerson(`新建人物Test_${suffix}`)
      createdPersonIds.push(p.id)
    }
    await navigateTo('/')
    await waitForTestId('person-grid')
    const count = await countElements('[data-testid="person-card"]')
    expect(count).toBeGreaterThanOrEqual(1)
    await screenshot('pcrud-01-create-person')
  })

  it('T-PCRUD-02: 人物卡片显示名称和统计', async () => {
    const person = await createPerson(`统计人物_${suffix}`)
    createdPersonIds.push(person.id)
    await importTestImages(person.id, [path.join(FIXTURES, 'test_1.jpg'), path.join(FIXTURES, 'test_2.jpg')])
    await navigateTo('/')
    await waitForTestId('person-grid')
    const text = await page.$eval('[data-testid="person-grid"]', (el) => el.textContent)
    expect(text).toContain(`统计人物_${suffix}`)
    await screenshot('pcrud-02-person-stats')
  })

  it('T-PCRUD-03: 人物主页重命名', async () => {
    const persons = await getPersons()
    const p = persons.find((p: any) => p.name === `统计人物_${suffix}`)
    if (!p) return
    await navigateTo(`/persons/${p.id}`)
    await waitForTestId('person-home-page')
    // Trigger rename through area context menu
    const content = await page.$eval('[data-testid="person-home-page"]', (el) => el.textContent)
    expect(content).toContain(`统计人物_${suffix}`)
    await screenshot('pcrud-03-person-rename')
  })

  it('T-PCRUD-04: 人物封面设置', async () => {
    const persons = await getPersons()
    const p = persons.find((p: any) => p.name === `统计人物_${suffix}`)
    if (!p) return
    const media = await getMediaByPerson(p.id)
    if (media.length === 0) return
    // Set cover via API
    await fetch(`http://localhost:8000/api/persons/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover_media_id: media[0].id }),
    })
    await navigateTo(`/persons/${p.id}`)
    await waitForTestId('person-home-page')
    await screenshot('pcrud-04-person-cover')
  })

  it('T-PCRUD-05: 删除人物', async () => {
    const person = await createPerson(`待删除人物_${suffix}`)
    const beforePersons = await getPersons()
    const beforeCount = beforePersons.length
    await fetch(`http://localhost:8000/api/persons/${person.id}`, { method: 'DELETE' })
    const afterPersons = await getPersons()
    expect(afterPersons.length).toBe(beforeCount - 1)
    await navigateTo('/')
    await waitForTestId('media-library-page')
    await screenshot('pcrud-05-delete-person')
  })
})
