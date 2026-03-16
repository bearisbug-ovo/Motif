import * as path from 'path'
import * as fs from 'fs'

const BASE = 'http://localhost:5173'
const API = 'http://localhost:8000/api'
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'screenshots')

export { BASE, API }

export async function screenshot(name: string) {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true })
}

export async function createPerson(name: string) {
  const res = await fetch(`${API}/persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return res.json()
}

export async function importTestImages(personId: string, paths: string[]) {
  const res = await fetch(`${API}/media/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, person_id: personId }),
  })
  return res.json()
}

export async function createAlbum(name: string, personId: string) {
  const res = await fetch(`${API}/albums`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, person_id: personId }),
  })
  return res.json()
}

export async function importToAlbum(albumId: string, paths: string[]) {
  const res = await fetch(`${API}/media/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, album_id: albumId }),
  })
  return res.json()
}

export async function createTask(params: { workflow_type: string; params: Record<string, any>; execution_mode?: string }) {
  const res = await fetch(`${API}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_type: params.workflow_type,
      params: params.params,
      execution_mode: params.execution_mode || 'queued',
    }),
  })
  return res.json()
}

export async function addToWorkspace(mediaId: string) {
  const res = await fetch(`${API}/workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_id: mediaId }),
  })
  return res.json()
}

export async function rateMedia(mediaId: string, rating: number) {
  const res = await fetch(`${API}/media/${mediaId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating }),
  })
  return res.json()
}

export async function softDeleteMedia(mediaId: string) {
  await fetch(`${API}/media/${mediaId}`, { method: 'DELETE' })
}

export async function waitForTestId(testId: string, timeout = 5000) {
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout })
}

export async function clickTestId(testId: string) {
  await page.click(`[data-testid="${testId}"]`)
}

export async function rightClick(selector: string) {
  await page.click(selector, { button: 'right' })
}

export async function getTextContent(selector: string): Promise<string> {
  return page.$eval(selector, (el) => el.textContent?.trim() || '')
}

export async function countElements(selector: string): Promise<number> {
  return page.$$eval(selector, (els) => els.length)
}

export async function getMediaByPerson(personId: string): Promise<any[]> {
  const res = await fetch(`${API}/media/person/${personId}/loose`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export async function getMediaByAlbum(albumId: string): Promise<any[]> {
  const res = await fetch(`${API}/media/album/${albumId}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export async function navigateTo(path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' })
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function getPersons(): Promise<any[]> {
  const res = await fetch(`${API}/persons`)
  return res.json()
}

export async function getAlbums(personId: string): Promise<any[]> {
  const res = await fetch(`${API}/albums?person_id=${personId}`)
  return res.json()
}

export async function getWorkspaceItems(): Promise<any[]> {
  const res = await fetch(`${API}/workspace`)
  return res.json()
}

export async function getTasks(status?: string): Promise<any[]> {
  const url = status ? `${API}/tasks?status=${status}` : `${API}/tasks`
  const res = await fetch(url)
  return res.json()
}

export async function deleteTask(taskId: string) {
  await fetch(`${API}/tasks/${taskId}`, { method: 'DELETE' })
}

export async function clearWorkspace() {
  await fetch(`${API}/workspace`, { method: 'DELETE' })
}

export async function updatePerson(personId: string, data: Record<string, any>) {
  const res = await fetch(`${API}/persons/${personId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function deletePerson(personId: string) {
  await fetch(`${API}/persons/${personId}`, { method: 'DELETE' })
}

export async function updateAlbum(albumId: string, data: Record<string, any>) {
  const res = await fetch(`${API}/albums/${albumId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function deleteAlbum(albumId: string) {
  await fetch(`${API}/albums/${albumId}`, { method: 'DELETE' })
}

export async function restoreMedia(mediaId: string) {
  const res = await fetch(`${API}/recycle-bin/${mediaId}/restore`, { method: 'POST' })
  return res.json()
}

export async function batchDeleteMedia(ids: string[]) {
  const res = await fetch(`${API}/media/batch-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  return res.json()
}

export async function cancelTask(taskId: string) {
  const res = await fetch(`${API}/tasks/${taskId}/cancel`, { method: 'POST' })
  return res.json()
}

export async function getRecycleBin(): Promise<any> {
  const res = await fetch(`${API}/recycle-bin`)
  return res.json()
}

export async function permanentDeleteMedia(mediaId: string) {
  await fetch(`${API}/recycle-bin/${mediaId}`, { method: 'DELETE' })
}

/** Clean up a person and all its albums/media (for test teardown) */
export async function cleanupPerson(personId: string) {
  // Delete all loose media (active)
  const loose = await getMediaByPerson(personId)
  for (const m of loose) {
    await softDeleteMedia(m.id)
    await permanentDeleteMedia(m.id)
  }
  // Delete all albums and their media (active)
  const albums = await getAlbums(personId)
  for (const a of albums) {
    const albumMedia = await getMediaByAlbum(a.id)
    for (const m of albumMedia) {
      await softDeleteMedia(m.id)
      await permanentDeleteMedia(m.id)
    }
    await deleteAlbum(a.id)
  }
  // Also clean up any media already in recycle bin for this person
  // (e.g. from tests that soft-delete as part of their test logic)
  const bin = await getRecycleBin()
  const binItems = Array.isArray(bin) ? bin : (bin.items || [])
  for (const m of binItems) {
    if (m.person_id === personId) {
      await permanentDeleteMedia(m.id)
    }
  }
  await deletePerson(personId)
}
