import { navigateTo, waitForTestId, screenshot, countElements } from './helpers'

describe('T-SIDE: 侧边栏 [PRD §5.1]', () => {
  it('T-SIDE-01: 侧边栏存在所有导航项', async () => {
    await navigateTo('/')
    await waitForTestId('sidebar')
    const labels = ['人物库', '任务队列', '工作区', '回收站', '设置']
    for (const label of labels) {
      const el = await page.$(`[data-testid="nav-${label}"]`)
      expect(el).not.toBeNull()
    }
    await screenshot('side-01-all-nav-items')
  })

  it('T-SIDE-02: 当前页面对应导航项高亮', async () => {
    await navigateTo('/settings')
    await waitForTestId('settings-page')
    // Check that settings nav item has active styling
    const classes = await page.$eval('[data-testid="nav-设置"]', (el) => el.className)
    expect(classes).toContain('bg-')
    await screenshot('side-02-active-highlight')
  })

  it('T-SIDE-03: 点击导航项跳转对应页面', async () => {
    await navigateTo('/')
    await waitForTestId('sidebar')

    await page.click('[data-testid="nav-任务队列"]')
    await waitForTestId('task-queue-page')
    expect(page.url()).toContain('/tasks')

    await page.click('[data-testid="nav-工作区"]')
    await waitForTestId('workspace-page')
    expect(page.url()).toContain('/workspace')

    await screenshot('side-03-navigation')
  })

  it('T-SIDE-04: 侧边栏默认收起状态', async () => {
    await navigateTo('/')
    await waitForTestId('sidebar')
    const width = await page.$eval('[data-testid="sidebar"]', (el) => (el as HTMLElement).offsetWidth)
    expect(width).toBeLessThanOrEqual(80)
    await screenshot('side-04-collapsed')
  })

  it('T-SIDE-05: 侧边栏图标可见', async () => {
    await navigateTo('/')
    await waitForTestId('sidebar')
    const svgCount = await page.$$eval('[data-testid="sidebar"] svg', (els) => els.length)
    expect(svgCount).toBeGreaterThanOrEqual(5) // At least one icon per nav item
    await screenshot('side-05-icons-visible')
  })
})
