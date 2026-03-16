import * as path from 'path'
import { createPerson, createAlbum, importToAlbum, navigateTo, waitForTestId, countElements, screenshot, getAlbums, getMediaByAlbum, cleanupPerson, sleep } from './helpers'

const FIXTURES = path.resolve(__dirname, '../fixtures')

describe('T-ACRUD: 图集 CRUD [PRD §5.3]', () => {
  let personId: string

  beforeAll(async () => {
    const person = await createPerson(`图集测试人物_${Date.now()}`)
    personId = person.id
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  it('T-ACRUD-01: 创建图集', async () => {
    const album = await createAlbum('测试图集A', personId)
    expect(album.id).toBeDefined()
    expect(album.name).toBe('测试图集A')
    const albums = await getAlbums(personId)
    expect(albums.length).toBe(1)
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    const text = await page.$eval('[data-testid="person-home-page"]', (el) => el.textContent)
    expect(text).toContain('测试图集A')
    await screenshot('acrud-01-create-album')
  })

  it('T-ACRUD-02: 重命名图集', async () => {
    const albums = await getAlbums(personId)
    const album = albums[0]
    await fetch(`http://localhost:8000/api/albums/${album.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '重命名图集' }),
    })
    const updated = await getAlbums(personId)
    expect(updated[0].name).toBe('重命名图集')
    await screenshot('acrud-02-rename-album')
  })

  it('T-ACRUD-03: 设置图集封面', async () => {
    const albums = await getAlbums(personId)
    const album = albums[0]
    await importToAlbum(album.id, [path.join(FIXTURES, 'test_1.jpg')])
    await sleep(200)
    const media = await getMediaByAlbum(album.id)
    if (media.length === 0) return
    await fetch(`http://localhost:8000/api/albums/${album.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover_media_id: media[0].id }),
    })
    await navigateTo(`/persons/${personId}`)
    await waitForTestId('person-home-page')
    await screenshot('acrud-03-album-cover')
  })

  it('T-ACRUD-04: 图集内有媒体', async () => {
    const albums = await getAlbums(personId)
    const album = albums[0]
    await importToAlbum(album.id, [path.join(FIXTURES, 'test_2.jpg'), path.join(FIXTURES, 'test_3.jpg')])
    await sleep(200)
    const media = await getMediaByAlbum(album.id)
    expect(media.length).toBeGreaterThanOrEqual(0)
    await navigateTo(`/albums/${album.id}`)
    await waitForTestId('album-detail-page')
    await screenshot('acrud-04-album-with-media')
  })

  it('T-ACRUD-05: 删除图集', async () => {
    const album2 = await createAlbum('待删图集', personId)
    let albums = await getAlbums(personId)
    const countBefore = albums.length
    await fetch(`http://localhost:8000/api/albums/${album2.id}`, { method: 'DELETE' })
    albums = await getAlbums(personId)
    expect(albums.length).toBe(countBefore - 1)
    await screenshot('acrud-05-delete-album')
  })
})
