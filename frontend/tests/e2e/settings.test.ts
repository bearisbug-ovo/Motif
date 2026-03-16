import { navigateTo, waitForTestId, screenshot } from './helpers'

describe('T-SET: 设置页 [PRD §5.11]', () => {
  it('T-SET-01: 设置页可访问', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    const text = await page.$eval('[data-testid="settings-page"]', (el) => el.textContent)
    expect(text).toContain('设置')
    await screenshot('set-01-settings-page')
  })

  it('T-SET-02: 显示 ComfyUI 配置区域', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    const text = await page.$eval('[data-testid="settings-page"]', (el) => el.textContent)
    expect(text).toContain('ComfyUI')
    await screenshot('set-02-comfyui-section')
  })

  it('T-SET-03: 显示回收站配置', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    const text = await page.$eval('[data-testid="settings-page"]', (el) => el.textContent)
    expect(text).toContain('回收站')
    await screenshot('set-03-recycle-bin-settings')
  })

  it('T-SET-04: ComfyUI 地址修改', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    // ComfyUI URL is in an input field, not visible text
    const inputValue = await page.$$eval('[data-testid="settings-page"] input', (inputs) =>
      inputs.map((el) => (el as HTMLInputElement).value).join(' ')
    )
    expect(inputValue).toContain('8188')
    await screenshot('set-04-comfyui-address')
  })

  it('T-SET-05: AppData 路径配置', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    // AppData path is in an input field
    const inputValue = await page.$$eval('[data-testid="settings-page"] input', (inputs) =>
      inputs.map((el) => (el as HTMLInputElement).value).join(' ')
    )
    const text = await page.$eval('[data-testid="settings-page"]', (el) => el.textContent)
    expect(inputValue.toLowerCase().includes('appdata') || text!.includes('AppData')).toBe(true)
    await screenshot('set-05-appdata-path')
  })
})
