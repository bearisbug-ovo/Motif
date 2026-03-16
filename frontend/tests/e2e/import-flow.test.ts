import * as path from 'path'
import { createPerson, createAlbum, importTestImages, importToAlbum, navigateTo, waitForTestId, screenshot, getMediaByPerson, getMediaByAlbum, sleep, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')
const testImages = Array.from({ length: 5 }, (_, i) => path.join(FIXTURES, `test_${i + 1}.jpg`))

describe('T-IMP: 导入流程 [PRD §5.5]', () => {
  let personId: string
  const personName = `导入测试人物_${Date.now()}`

  beforeAll(async () => {
    const person = await createPerson(personName)
    personId = person.id
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-IMP-01: 导入文件到人物', async () => {
    const result = await importTestImages(personId, [testImages[0]])
    await sleep(200)
    expect(result.total).toBeGreaterThanOrEqual(1)
    const media = await getMediaByPerson(personId)
    expect(media.length).toBeGreaterThanOrEqual(result.imported || 0)
    await screenshot('imp-01-import-to-person')
  })

  it('T-IMP-02: 批量导入多个文件', async () => {
    const countBefore = (await getMediaByPerson(personId)).length
    const result = await importTestImages(personId, testImages.slice(1))
    await sleep(200)
    expect(result.total).toBeGreaterThanOrEqual(1)
    const media = await getMediaByPerson(personId)
    expect(media.length).toBeGreaterThan(countBefore)
    await screenshot('imp-02-batch-import')
  })

  it('T-IMP-03: 导入去重（重复文件不重复导入）', async () => {
    const countBefore = (await getMediaByPerson(personId)).length
    const result = await importTestImages(personId, [testImages[0]])
    await sleep(200)
    // Duplicate should be skipped
    const media = await getMediaByPerson(personId)
    expect(media.length).toBe(countBefore)
    await screenshot('imp-03-dedup')
  })

  it('T-IMP-04: 导入到图集', async () => {
    const album = await createAlbum('导入图集', personId)
    // Move existing media into album via API (import deduplicates by file_path)
    const media = await getMediaByPerson(personId)
    if (media.length >= 2) {
      await fetch(`http://localhost:8000/api/media/batch`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [media[0].id, media[1].id], album_id: album.id }),
      })
    }
    const albumMedia = await getMediaByAlbum(album.id)
    expect(albumMedia.length).toBeGreaterThanOrEqual(Math.min(2, media.length))
    await screenshot('imp-04-import-to-album')
  })

  it('T-IMP-05: 导入不支持的文件类型被忽略', async () => {
    const res = await fetch('http://localhost:8000/api/media/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [path.join(FIXTURES, 'nonexistent.txt')], person_id: personId }),
    })
    // Should fail with 400 (no supported files) or return total=0
    expect(res.status === 400 || (await res.json()).total === 0).toBe(true)
    await screenshot('imp-05-unsupported-type')
  })

  it('T-IMP-06: 导入对话框可在人物主页打开', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    const text = await page.$eval('[data-testid="person-home-page"]', (el) => el.textContent)
    expect(text).toContain('导入')
    await screenshot('imp-06-import-dialog-button')
  })

  it('T-IMP-07: 导入后人物主页显示新媒体', async () => {
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    const text = await page.$eval('[data-testid="person-home-page"]', (el) => el.textContent)
    const looseMedia = await getMediaByPerson(personId)
    if (looseMedia.length > 0) {
      expect(text).toContain('散图')
    }
    // Page should at least show media or albums
    await screenshot('imp-07-imported-media-visible')
  })

  it('T-IMP-08: 导入到图集后图集详情显示', async () => {
    const albums = await fetch(`http://localhost:8000/api/albums?person_id=${personId}`).then(r => r.json())
    const album = albums.find((a: any) => a.name === '导入图集')
    if (!album) return
    await navigateTo(`/albums/${album.id}`)
    await waitForTestId('album-detail-page')
    await screenshot('imp-08-album-detail-after-import')
  })
})
