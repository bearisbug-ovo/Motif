/**
 * Video thumbnail E2E tests.
 * Covers all 4 verification scenarios with screenshots at each step:
 *   1. Grid/row display: video shows first-frame thumbnail + play icon
 *   2. LightBox screenshot → video cover switches to screenshot
 *   3. Delete screenshot → video cover reverts to first frame
 *   4. LightBox thumbnail strip shows video thumbnails correctly
 */
import * as path from 'path'
import * as fs from 'fs'
import { createPerson, createAlbum, navigateTo, sleep, API, screenshot, cleanupPerson } from './helpers'

const FIXTURES = path.resolve(__dirname, '..', 'fixtures')

async function importMedia(personId: string, albumId: string, paths: string[]) {
  const res = await fetch(`${API}/media/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, person_id: personId, album_id: albumId }),
  })
  return res.json()
}

async function listAlbumMedia(albumId: string) {
  const res = await fetch(`${API}/media/album/${albumId}`)
  return res.json()
}

async function getMedia(mediaId: string) {
  const res = await fetch(`${API}/media/${mediaId}`)
  return res.json()
}

async function softDeleteMedia(mediaId: string) {
  await fetch(`${API}/media/${mediaId}`, { method: 'DELETE' })
}

describe('Video Thumbnail — Full Verification', () => {
  let personId: string
  let albumId: string
  let videoMediaId: string
  const personName = `Video Test_${Date.now()}`

  beforeAll(async () => {
    const person = await createPerson(personName)
    personId = person.id
    const album = await createAlbum('Video Album', personId)
    albumId = album.id

    // Import 2 images + 1 video
    const files = [
      path.join(FIXTURES, 'test_1.jpg'),
      path.join(FIXTURES, 'test_2.jpg'),
      path.join(FIXTURES, 'test_video.mp4'),
    ]
    await importMedia(personId, albumId, files)

    const media = await listAlbumMedia(albumId)
    const video = media.find((m: any) => m.media_type === 'video')
    videoMediaId = video.id
    console.log('Video media ID:', videoMediaId)
  })

  afterAll(async () => {
    await cleanupPerson(personId)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 1: Video card shows first-frame thumbnail + play icon
  // ═══════════════════════════════════════════════════════════════════════════

  it('S1-API: Video thumb endpoint returns JPEG', async () => {
    const media = await listAlbumMedia(albumId)
    const video = media.find((m: any) => m.media_type === 'video')

    const thumbRes = await fetch(
      `http://localhost:8000/api/files/thumb?path=${encodeURIComponent(video.file_path)}&size=400`
    )
    console.log('Thumb API:', thumbRes.status, thumbRes.headers.get('content-type'))

    expect(thumbRes.status).toBe(200)
    expect(thumbRes.headers.get('content-type')).toBe('image/jpeg')
  })

  it('S1-Row: Row layout renders video thumbnail + play icon', async () => {
    await navigateTo(`/albums/${albumId}`)
    await sleep(3000)

    await screenshot('vid-01-s1-row-layout')

    // All 3 images should load in row layout
    const imgStates = await page.$$eval('.flex.flex-wrap img', (imgs) =>
      imgs.map((img: HTMLImageElement) => ({
        src: img.src.includes('/api/') ? img.src.substring(img.src.indexOf('/api/'), img.src.indexOf('/api/') + 60) + '...' : img.src,
        loaded: img.naturalWidth > 0,
      }))
    )
    console.log('Row images:', JSON.stringify(imgStates))
    expect(imgStates.length).toBe(3)
    expect(imgStates.every((s: any) => s.loaded)).toBe(true)

    // Play icon should exist on video card
    const playIconCount = await page.$$eval('.flex.flex-wrap .rounded-full.bg-black\\/60', (els) => els.length)
    console.log('Row play icons:', playIconCount)
    expect(playIconCount).toBeGreaterThanOrEqual(1)
  })

  it('S1-Grid: Grid layout renders video thumbnail + play icon', async () => {
    // Switch to grid
    await page.click('button[title="方块网格"]')
    await sleep(2000)

    await screenshot('vid-02-s1-grid-layout')

    const cardStates = await page.$$eval('[data-testid="media-card"]', (cards) =>
      cards.map((card) => {
        const img = card.querySelector('img') as HTMLImageElement | null
        const playIcon = card.querySelector('.rounded-full')
        return {
          mediaId: card.getAttribute('data-media-id'),
          imgLoaded: img ? img.naturalWidth > 0 : false,
          hasError: !!card.querySelector('[class*="text-red"]'),
          hasPlayIcon: !!playIcon,
        }
      })
    )
    console.log('Grid cards:', JSON.stringify(cardStates))
    expect(cardStates.length).toBe(3)
    expect(cardStates.every((c: any) => c.imgLoaded)).toBe(true)
    expect(cardStates.every((c: any) => !c.hasError)).toBe(true)
    expect(cardStates.some((c: any) => c.hasPlayIcon)).toBe(true)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 4: LightBox thumbnail strip shows video thumbnails
  // (Test before screenshot scenarios since they change state)
  // ═══════════════════════════════════════════════════════════════════════════

  it('S4: LightBox thumbnail strip shows video item correctly', async () => {
    // Open lightbox by clicking first card in row layout
    await page.click('button[title="等高行布局"]')
    await sleep(1000)

    // Click the first image in row layout to open lightbox
    await page.click('.flex.flex-wrap .group')
    await sleep(1500)

    // Verify lightbox is open
    const lightboxVisible = await page.$('[data-testid="lightbox"]')
    expect(lightboxVisible).toBeTruthy()

    await screenshot('vid-03-s4-lightbox-open')

    // Check thumbnail strip images
    const stripImgs = await page.$$eval('[data-testid="lightbox"] .h-16.w-16 img', (imgs) =>
      imgs.map((img: HTMLImageElement) => ({
        src: img.src.includes('/api/') ? img.src.substring(img.src.indexOf('/api/'), img.src.indexOf('/api/') + 80) + '...' : img.src,
        loaded: img.naturalWidth > 0,
      }))
    )
    console.log('Lightbox strip images:', JSON.stringify(stripImgs))
    expect(stripImgs.length).toBe(3)
    // All strip thumbnails should load, including the video one
    expect(stripImgs.every((s: any) => s.loaded)).toBe(true)

    // Navigate to the video item in lightbox (it's the 3rd one, index 2)
    await page.keyboard.press('ArrowRight') // → item 2
    await sleep(500)
    await page.keyboard.press('ArrowRight') // → item 3 (video)
    await sleep(1500)

    await screenshot('vid-04-s4-lightbox-video')

    // Verify video element is shown (not img) in the main area
    const hasVideo = await page.$('[data-testid="lightbox"] video')
    console.log('LightBox shows <video> element:', !!hasVideo)
    expect(hasVideo).toBeTruthy()

    // Close lightbox
    await page.keyboard.press('Escape')
    await sleep(500)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 2: Screenshot capture → video cover switches to screenshot
  // ═══════════════════════════════════════════════════════════════════════════

  it('S2: Screenshot sets video thumbnail_path via API', async () => {
    // Before: video has no thumbnail_path
    const videoBefore = await getMedia(videoMediaId)
    console.log('Before screenshot — thumbnail_path:', videoBefore.thumbnail_path)
    expect(videoBefore.thumbnail_path).toBeNull()

    // Capture a screenshot via API (simulate what LightBox does)
    // Use a real JPEG fixture so the backend can generate a valid thumbnail
    const screenshotBytes = fs.readFileSync(path.join(FIXTURES, 'test_1.jpg'))
    const formData = new FormData()
    const blob = new Blob([screenshotBytes], { type: 'image/jpeg' })
    formData.append('file', blob, 'screenshot.jpg')

    const screenshotRes = await fetch(`${API}/media/${videoMediaId}/screenshot`, {
      method: 'POST',
      body: formData,
    })
    expect(screenshotRes.status).toBe(200)
    const screenshotMedia = await screenshotRes.json()
    console.log('Screenshot created:', screenshotMedia.id, screenshotMedia.file_path)

    // After: video's thumbnail_path should be set to the screenshot
    const videoAfter = await getMedia(videoMediaId)
    console.log('After screenshot — thumbnail_path:', videoAfter.thumbnail_path)
    expect(videoAfter.thumbnail_path).toBe(screenshotMedia.file_path)
  })

  it('S2-Visual: Grid shows screenshot as video cover after capture', async () => {
    // Use domcontentloaded instead of networkidle0 — the screenshot thumbnail
    // may not be cached yet, and networkidle0 can stall waiting for lazy loads.
    await page.goto(`http://localhost:5173/albums/${albumId}`, { waitUntil: 'domcontentloaded' })
    await sleep(2000)
    await page.click('button[title="方块网格"]')
    await sleep(4000)

    await screenshot('vid-05-s2-grid-after-screenshot')

    // Verify media card for video now uses thumbnail_path in its img src
    const videoCard = await page.$$eval('[data-testid="media-card"]', (cards) => {
      return cards.map((card) => {
        const img = card.querySelector('img') as HTMLImageElement | null
        return {
          mediaId: card.getAttribute('data-media-id'),
          imgSrc: img?.src || '',
          imgLoaded: img ? img.naturalWidth > 0 : false,
        }
      })
    })
    console.log('Cards after screenshot:', JSON.stringify(videoCard))

    // The video card's image should now point to the screenshot path (generated/screenshot/...)
    const videoCardData = videoCard.find((c: any) => c.mediaId === videoMediaId)
    expect(videoCardData).toBeDefined()
    expect(videoCardData!.imgLoaded).toBe(true)
    // The URL should contain the screenshot path (in generated/screenshot dir), not the .mp4 path
    console.log('Video card img src:', videoCardData!.imgSrc.substring(videoCardData!.imgSrc.indexOf('/api/')))
    expect(videoCardData!.imgSrc).toContain('screenshot')
  }, 60000)

  // ═══════════════════════════════════════════════════════════════════════════
  // Scenario 3: Delete screenshot → video cover reverts to first frame
  // ═══════════════════════════════════════════════════════════════════════════

  it('S3: Delete screenshot clears video thumbnail_path via API', async () => {
    // Find the screenshot media
    const media = await listAlbumMedia(albumId)
    const screenshot = media.find((m: any) => m.source_type === 'screenshot')
    expect(screenshot).toBeDefined()
    console.log('Screenshot to delete:', screenshot.id)

    // Before delete: video has thumbnail_path
    const videoBefore = await getMedia(videoMediaId)
    expect(videoBefore.thumbnail_path).not.toBeNull()
    console.log('Before delete — thumbnail_path:', videoBefore.thumbnail_path)

    // Soft-delete the screenshot
    await softDeleteMedia(screenshot.id)

    // After: video's thumbnail_path should be cleared (no other screenshots)
    const videoAfter = await getMedia(videoMediaId)
    console.log('After delete — thumbnail_path:', videoAfter.thumbnail_path)
    expect(videoAfter.thumbnail_path).toBeNull()
  })

  it('S3-Visual: Grid shows first-frame again after screenshot deleted', async () => {
    await navigateTo(`/albums/${albumId}`)
    await sleep(1000)
    await page.click('button[title="方块网格"]')
    await sleep(3000)

    await screenshot('vid-06-s3-grid-after-delete')

    // Video card should still load (now from first frame again)
    const videoCard = await page.$$eval('[data-testid="media-card"]', (cards) => {
      return cards.map((card) => {
        const img = card.querySelector('img') as HTMLImageElement | null
        return {
          mediaId: card.getAttribute('data-media-id'),
          imgSrc: img?.src || '',
          imgLoaded: img ? img.naturalWidth > 0 : false,
        }
      })
    })
    console.log('Cards after delete:', JSON.stringify(videoCard))

    const videoCardData = videoCard.find((c: any) => c.mediaId === videoMediaId)
    expect(videoCardData).toBeDefined()
    expect(videoCardData!.imgLoaded).toBe(true)
    // Should be back to the .mp4 path (first frame extraction)
    expect(videoCardData!.imgSrc).toContain('test_video.mp4')
    console.log('Video card reverted to:', videoCardData!.imgSrc.substring(videoCardData!.imgSrc.indexOf('/api/')))
  })
})

