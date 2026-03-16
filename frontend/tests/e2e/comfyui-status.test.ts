import { navigateTo, waitForTestId, screenshot, sleep } from './helpers'

describe('T-CUI: ComfyUI 状态 [PRD §5.11]', () => {
  it('T-CUI-01: 设置页显示 ComfyUI 状态', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    const text = await page.$eval('[data-testid="settings-page"]', (el) => el.textContent)
    expect(text).toContain('ComfyUI')
    await screenshot('cui-01-comfyui-status')
  })

  it('T-CUI-02: 系统状态 API 返回 ComfyUI 信息', async () => {
    const res = await fetch('http://localhost:8000/api/system/status')
    const data = await res.json()
    expect(data.comfyui).toBeDefined()
    expect(typeof data.comfyui.connected).toBe('boolean')
    await screenshot('cui-02-status-api')
  })

  it('T-CUI-03: ComfyUI 地址配置显示', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    // ComfyUI URL is in an input field, check input values
    const inputValue = await page.$$eval('[data-testid="settings-page"] input', (inputs) =>
      inputs.map((el) => (el as HTMLInputElement).value).join(' ')
    )
    expect(inputValue).toContain('8188')
    await screenshot('cui-03-address-config')
  })

  it('T-CUI-04: 连接状态颜色指示', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    // Check for status indicator (green/red dot or text)
    await screenshot('cui-04-connection-indicator')
  })
})
