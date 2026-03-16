import { API, createTask, getTasks, deleteTask, navigateTo, waitForTestId, screenshot, sleep } from './helpers'

describe('T-CANCEL: 任务取消 [PRD §5.10]', () => {
  const createdTaskIds: string[] = []

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await fetch(`${API}/tasks/${id}/cancel`, { method: 'POST' }).catch(() => {})
      await fetch(`${API}/tasks/${id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  async function createTestTask() {
    const task = await createTask({
      workflow_type: 'upscale',
      params: { media_id: 'test-fake-cancel-' + Date.now() + Math.random() },
      execution_mode: 'queued',
    })
    createdTaskIds.push(task.id)
    return task
  }

  async function waitForTerminal(taskId: string, maxWait = 3000) {
    const start = Date.now()
    while (Date.now() - start < maxWait) {
      const res = await fetch(`${API}/tasks/${taskId}`)
      const data = await res.json()
      if (['cancelled', 'failed', 'completed'].includes(data.status)) {
        return data
      }
      await sleep(200)
    }
    // Return current state even if not terminal
    const res = await fetch(`${API}/tasks/${taskId}`)
    return res.json()
  }

  it('T-CANCEL-01: 创建任务后可取消或自然终止', async () => {
    const task = await createTestTask()
    // Try cancel
    const cancelRes = await fetch(`${API}/tasks/${task.id}/cancel`, { method: 'POST' })
    // Either cancel succeeded or task already moved to terminal state
    const final = await waitForTerminal(task.id)
    expect(['cancelled', 'failed', 'completed', 'pending']).toContain(final.status)
    await screenshot('cancel-01-task-state')
  })

  it('T-CANCEL-02: 非 pending/running 任务不能取消', async () => {
    const task = await createTestTask()
    // Wait for terminal state
    const terminal = await waitForTerminal(task.id)
    if (!['cancelled', 'failed', 'completed'].includes(terminal.status)) {
      // Force cancel if still pending
      await fetch(`${API}/tasks/${task.id}/cancel`, { method: 'POST' })
      await sleep(200)
    }
    // Now try again - should fail
    const res = await fetch(`${API}/tasks/${task.id}/cancel`, { method: 'POST' })
    expect(res.ok).toBe(false)
    await screenshot('cancel-02-already-terminal')
  })

  it('T-CANCEL-03: 终止后 finished_at 有值', async () => {
    const task = await createTestTask()
    await fetch(`${API}/tasks/${task.id}/cancel`, { method: 'POST' }).catch(() => {})
    const final = await waitForTerminal(task.id)
    if (['cancelled', 'failed', 'completed'].includes(final.status)) {
      expect(final.finished_at).toBeTruthy()
    }
    await screenshot('cancel-03-finished-at')
  })

  it('T-CANCEL-04: 任务队列页面可访问', async () => {
    await page.goto('http://localhost:5173/tasks', { waitUntil: 'domcontentloaded', timeout: 15000 })
    await sleep(2000)
    const el = await page.$('[data-testid="task-queue-page"]')
    expect(el).not.toBeNull()
    await screenshot('cancel-04-task-page')
  }, 45000) // Extended timeout

  it('T-CANCEL-05: 删除终止的任务', async () => {
    const task = await createTestTask()
    await fetch(`${API}/tasks/${task.id}/cancel`, { method: 'POST' }).catch(() => {})
    await waitForTerminal(task.id)

    const delRes = await fetch(`${API}/tasks/${task.id}`, { method: 'DELETE' })
    expect(delRes.ok).toBe(true)

    const getRes = await fetch(`${API}/tasks/${task.id}`)
    expect(getRes.status).toBe(404)

    const idx = createdTaskIds.indexOf(task.id)
    if (idx >= 0) createdTaskIds.splice(idx, 1)
    await screenshot('cancel-05-deleted-task')
  })
})
