import { API, createPerson, deletePerson, navigateTo, waitForTestId, screenshot, sleep } from './helpers'

describe('T-ERR: 异常处理 [PRD §13]', () => {
  it('T-ERR-01: ComfyUI 状态在设置页可见', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    await sleep(500)

    const text = await page.$eval('[data-testid="settings-page"]', (el) => el.textContent)
    expect(text).toContain('ComfyUI')
    await screenshot('err-01-comfyui-status')
  })

  it('T-ERR-02: system/status API 返回结构化状态', async () => {
    const res = await fetch(`${API}/system/status`)
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.comfyui).toBeDefined()
    expect(typeof data.comfyui.connected).toBe('boolean')
    expect(data.disk).toBeDefined()
    await screenshot('err-02-system-status-api')
  })

  it('T-ERR-03: 不存在的人物返回 404', async () => {
    const res = await fetch(`${API}/persons/nonexistent-uuid-12345`)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.detail).toBeTruthy()
    expect(data.detail).toContain('not found')
    await screenshot('err-03-person-404')
  })

  it('T-ERR-04: 不存在的图集返回 404', async () => {
    const res = await fetch(`${API}/albums/nonexistent-uuid-12345`)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.detail).toBeTruthy()
    expect(data.detail).toContain('not found')
    await screenshot('err-04-album-404')
  })

  it('T-ERR-05: API 404 响应格式一致', async () => {
    // Test multiple endpoints for consistent 404 format
    const endpoints = [
      `${API}/persons/nonexistent-id-999`,
      `${API}/albums/nonexistent-id-999`,
      `${API}/media/nonexistent-id-999`,
    ]
    for (const url of endpoints) {
      const res = await fetch(url)
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.detail).toBeTruthy()
    }
    await screenshot('err-05-api-404-consistent')
  })

  it('T-ERR-06: 空名称创建人物后可删除', async () => {
    const res = await fetch(`${API}/persons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    const person = await res.json()
    expect(person.id).toBeTruthy()

    await deletePerson(person.id)
    const checkRes = await fetch(`${API}/persons/${person.id}`)
    expect(checkRes.status).toBe(404)
    await screenshot('err-06-empty-name-cleanup')
  })

  it('T-ERR-07: 无效媒体 ID 的 PATCH 返回 404', async () => {
    const res = await fetch(`${API}/media/nonexistent-media-999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5 }),
    })
    expect(res.status).toBe(404)
    await screenshot('err-07-media-404')
  })
})
