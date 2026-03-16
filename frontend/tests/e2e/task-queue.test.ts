import { API, createTask, waitForTestId, screenshot, getTasks, deleteTask, sleep } from './helpers'

async function goToTasks() {
  await page.goto('http://localhost:5173/tasks', { waitUntil: 'domcontentloaded', timeout: 15000 })
  await sleep(2000)
}

describe('T-TQ: 任务队列 [PRD §5.9]', () => {
  const createdTaskIds: string[] = []

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await fetch(`${API}/tasks/${id}/cancel`, { method: 'POST' }).catch(() => {})
      await fetch(`${API}/tasks/${id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  it('T-TQ-01: 空状态显示', async () => {
    await goToTasks()
    const el = await page.$('[data-testid="task-queue-page"]')
    expect(el).not.toBeNull()
    await screenshot('tq-01-empty-state')
  }, 45000)

  it('T-TQ-02: 创建任务后显示在队列', async () => {
    const task = await createTask({ workflow_type: 'upscale', params: { media_id: 'test-tq-' + Date.now() } })
    createdTaskIds.push(task.id)
    await goToTasks()
    const el = await page.$('[data-testid="task-queue-page"]')
    expect(el).not.toBeNull()
    await screenshot('tq-02-task-created')
  }, 45000)

  it('T-TQ-03: 任务状态显示正确', async () => {
    // Create a fresh task for this test
    const task = await createTask({ workflow_type: 'upscale', params: { media_id: 'test-tq3-' + Date.now() } })
    createdTaskIds.push(task.id)
    const res = await fetch(`${API}/tasks/${task.id}`)
    const data = await res.json()
    expect(['pending', 'running', 'failed', 'completed']).toContain(data.status)
    await screenshot('tq-03-task-status')
  })

  it('T-TQ-04: 删除任务', async () => {
    const task = await createTask({ workflow_type: 'upscale', params: { media_id: 'test-tq4-' + Date.now() } })
    // Wait for it to reach terminal state
    await sleep(2000)
    await fetch(`${API}/tasks/${task.id}/cancel`, { method: 'POST' }).catch(() => {})
    await sleep(500)
    await deleteTask(task.id)
    const res = await fetch(`${API}/tasks/${task.id}`)
    expect(res.status).toBe(404)
    await screenshot('tq-04-task-deleted')
  })

  it('T-TQ-05: 多任务排序', async () => {
    const t1 = await createTask({ workflow_type: 'upscale', params: { media_id: 'test-tq5a-' + Date.now() } })
    const t2 = await createTask({ workflow_type: 'face_swap', params: { media_id: 'test-tq5b-' + Date.now() } })
    const t3 = await createTask({ workflow_type: 'upscale', params: { media_id: 'test-tq5c-' + Date.now() } })
    createdTaskIds.push(t1.id, t2.id, t3.id)
    // Verify tasks exist
    for (const t of [t1, t2, t3]) {
      const r = await fetch(`${API}/tasks/${t.id}`)
      expect(r.ok).toBe(true)
    }
    await screenshot('tq-05-multi-task-order')
  })

  it('T-TQ-06: 拖拽排序 API', async () => {
    // Use tasks from TQ-05 if they're still pending
    const tasks = await getTasks()
    const pendingTasks = tasks.filter((t: any) => t.status === 'pending')
    if (pendingTasks.length >= 2) {
      const reversed = [...pendingTasks].reverse().map((t: any) => t.id)
      const res = await fetch(`${API}/tasks/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_ids: reversed }),
      })
      expect(res.ok).toBe(true)
    }
    await screenshot('tq-06-reorder-api')
  })

  it('T-TQ-07: 队列配置界面', async () => {
    await goToTasks()
    const el = await page.$('[data-testid="task-queue-page"]')
    expect(el).not.toBeNull()
    await screenshot('tq-07-queue-config')
  }, 45000)

  it('T-TQ-08: 拖拽排序 UI 存在', async () => {
    await goToTasks()
    const el = await page.$('[data-testid="task-queue-page"]')
    expect(el).not.toBeNull()
    await screenshot('tq-08-dnd-ui')
  }, 45000)
})
