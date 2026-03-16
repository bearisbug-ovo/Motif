import { BASE, waitForTestId, navigateTo, screenshot } from './helpers'

describe('T-NAV: 左侧导航栏 [PRD §5.1]', () => {
  it('T-NAV-01: 导航栏默认收起状态', async () => {
    await navigateTo('/')
    await waitForTestId('sidebar')
    const width = await page.$eval('[data-testid="sidebar"]', (el) => (el as HTMLElement).offsetWidth)
    expect(width).toBeLessThanOrEqual(80) // w-16 = 64px, allow some tolerance
    await screenshot('nav-01-sidebar-collapsed')
  })

  it('T-NAV-02: 导航项可点击跳转', async () => {
    await navigateTo('/')
    await waitForTestId('sidebar')

    // Click 回收站
    await page.click('[data-testid="nav-回收站"]')
    await waitForTestId('recycle-bin-page')
    expect(page.url()).toContain('/recycle-bin')
    await screenshot('nav-02-recycle-bin')

    // Click 设置
    await page.click('[data-testid="nav-设置"]')
    await waitForTestId('settings-page')
    expect(page.url()).toContain('/settings')
    await screenshot('nav-02-settings')

    // Click 人物库 (back to home)
    await page.click('[data-testid="nav-人物库"]')
    await waitForTestId('media-library-page')
    expect(page.url()).toBe(BASE + '/')
    await screenshot('nav-02-media-library')
  })

  it('T-NAV-03: 所有导航项存在', async () => {
    await navigateTo('/')
    await waitForTestId('sidebar')
    const labels = ['人物库', '任务队列', '工作区', '回收站', '设置']
    for (const label of labels) {
      const el = await page.$(`[data-testid="nav-${label}"]`)
      expect(el).not.toBeNull()
    }
    await screenshot('nav-03-all-items')
  })
})
