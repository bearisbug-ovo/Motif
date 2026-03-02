<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NSpin } from 'naive-ui'
import { useCharactersStore } from '@/stores/characters'
import { galleryApi, type ImageRecord } from '@/api/gallery'

const route  = useRoute()
const router = useRouter()
const charStore = useCharactersStore()

const charId  = computed(() => Number(route.params.charId))
const char    = computed(() => charStore.list.find(c => c.id === charId.value) ?? null)
const loading = ref(true)

const currentPhotoIdx  = ref(Number(route.params.photoIdx) || 0)
const generatedImages  = ref<ImageRecord[]>([])
const centerUrl        = ref<string | null>(null) // null = show current ref photo

// ── URL helpers ───────────────────────────────────────────────────────
function mediaUrl(path: string): string {
  if (!path) return ''
  if (/^[A-Za-z]:[\\/]/.test(path)) return `/api/files/serve?path=${encodeURIComponent(path)}`
  return path.startsWith('/') ? path : '/' + path
}

function thumbUrl(path: string, size = 400): string {
  if (!path) return ''
  if (/^[A-Za-z]:[\\/]/.test(path))
    return `/api/files/thumb?path=${encodeURIComponent(path)}&size=${size}`
  return path.startsWith('/') ? path : '/' + path
}

// ── Derived ───────────────────────────────────────────────────────────
const refPhotos  = computed(() => char.value?.reference_photos ?? [])
const displayUrl = computed(() => {
  if (centerUrl.value) return centerUrl.value
  const p = refPhotos.value[currentPhotoIdx.value]
  return p ? thumbUrl(p, 1600) : null
})

// ── Navigation ────────────────────────────────────────────────────────
function goPrev() {
  centerUrl.value = null
  zoom.value = 1
  const max = refPhotos.value.length - 1
  currentPhotoIdx.value = currentPhotoIdx.value > 0 ? currentPhotoIdx.value - 1 : max
}

function goNext() {
  centerUrl.value = null
  zoom.value = 1
  const max = refPhotos.value.length - 1
  currentPhotoIdx.value = currentPhotoIdx.value < max ? currentPhotoIdx.value + 1 : 0
}

function selectPhoto(idx: number) {
  currentPhotoIdx.value = idx
  centerUrl.value = null
  zoom.value = 1
}

function selectGenImage(img: ImageRecord) {
  centerUrl.value = mediaUrl(img.filepath)
  zoom.value = 1
}

// ── Zoom ─────────────────────────────────────────────────────────────
const zoom    = ref(1)
const originX = ref(50)  // % of container
const originY = ref(50)

const imgContainerEl = ref<HTMLElement | null>(null)
const NAV_ZONE = 80  // px from edge = navigation / prev-next zone

function updateOrigin(e: MouseEvent) {
  if (!imgContainerEl.value) return
  const rect = imgContainerEl.value.getBoundingClientRect()
  originX.value = ((e.clientX - rect.left) / rect.width)  * 100
  originY.value = ((e.clientY - rect.top)  / rect.height) * 100
}

function getZone(e: MouseEvent): 'left' | 'right' | 'center' {
  if (!imgContainerEl.value) return 'center'
  const rect = imgContainerEl.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  if (x < NAV_ZONE) return 'left'
  if (x > rect.width - NAV_ZONE) return 'right'
  return 'center'
}

// ── Cursor ────────────────────────────────────────────────────────────
const cursor = ref('zoom-in')

function onMouseMove(e: MouseEvent) {
  updateOrigin(e)
  if (zoom.value > 1) { cursor.value = 'zoom-out'; return }
  const zone = getZone(e)
  if (zone === 'left')  cursor.value = 'w-resize'
  else if (zone === 'right') cursor.value = 'e-resize'
  else cursor.value = 'zoom-in'
}

function onMouseLeave() { cursor.value = 'default' }

// ── Click & Wheel ─────────────────────────────────────────────────────
function onContainerClick(e: MouseEvent) {
  if (zoom.value > 1) { zoom.value = 1; return }
  const zone = getZone(e)
  if (zone === 'left')  { goPrev(); return }
  if (zone === 'right') { goNext(); return }
  updateOrigin(e)
  zoom.value = 2
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  if (zoom.value > 1) {
    const delta = e.deltaY < 0 ? 0.5 : -0.5
    zoom.value = Math.max(1, Math.min(8, zoom.value + delta))
  } else {
    if (e.deltaY > 0) goNext()
    else goPrev()
  }
}

// ── Keyboard ──────────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (zoom.value > 1) zoom.value = 1
    else router.push('/characters')
  } else if (e.key === 'ArrowRight') {
    goNext()
  } else if (e.key === 'ArrowLeft') {
    goPrev()
  }
}

// ── Filmstrip scroll into view ────────────────────────────────────────
const filmstripEl = ref<HTMLElement | null>(null)

watch(currentPhotoIdx, (idx) => {
  const container = filmstripEl.value
  if (!container) return
  const el = container.children[idx] as HTMLElement | undefined
  if (!el) return
  // Scroll only the filmstrip container horizontally — never the page
  const target = el.offsetLeft - (container.clientWidth - el.offsetWidth) / 2
  container.scrollTo({ left: target, behavior: 'smooth' })
})

// ── Lifecycle ─────────────────────────────────────────────────────────
onMounted(async () => {
  if (charStore.list.length === 0) await charStore.fetchAll()
  try {
    const { data } = await galleryApi.list({ character_id: charId.value, page_size: 100 })
    generatedImages.value = data
  } catch { /* silently ignore */ }
  loading.value = false
  window.addEventListener('keydown', onKeydown)
  // passive:false is required so e.preventDefault() actually stops page scroll
  imgContainerEl.value?.addEventListener('wheel', onWheel, { passive: false })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  imgContainerEl.value?.removeEventListener('wheel', onWheel)
})
</script>

<template>
  <div class="flex h-screen w-full overflow-hidden select-none" style="background:#080812;">

    <!-- ══ Loading ══════════════════════════════════════════════════════ -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <NSpin size="large" />
    </div>

    <template v-else>
      <!-- ══ Left + Bottom (main area) ══════════════════════════════════ -->
      <div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;overflow:hidden;">

        <!-- Center image — explicit flex item so height is always definite -->
        <div
          ref="imgContainerEl"
          style="flex:1 1 0;min-height:0;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;"
          :style="{ cursor }"
          @mousemove="onMouseMove"
          @mouseleave="onMouseLeave"
          @click="onContainerClick"
        >
          <!-- Back button -->
          <button
            class="absolute top-4 left-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-300 hover:text-white transition-colors"
            style="background:rgba(0,0,0,0.55); backdrop-filter:blur(6px);"
            @click.stop="router.push('/characters')"
          >
            ← 返回
          </button>

          <!-- Info badge -->
          <div
            v-if="char"
            class="absolute top-4 left-1/2 -translate-x-1/2 z-20 text-[11px] text-gray-400 px-3 py-1 rounded-full pointer-events-none"
            style="background:rgba(0,0,0,0.55);"
          >
            {{ char.name }} · {{ currentPhotoIdx + 1 }}&thinsp;/&thinsp;{{ refPhotos.length }}
          </div>

          <!-- Image — sits directly in the flex centering container -->
          <img
            v-if="displayUrl"
            :src="displayUrl"
            :style="{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              transform: `scale(${zoom})`,
              transformOrigin: `${originX}% ${originY}%`,
              transition: zoom === 1 ? 'transform 0.18s ease' : 'none',
              pointerEvents: 'none',
              userSelect: 'none',
              display: 'block',
            }"
            draggable="false"
            alt=""
          />
          <span v-else class="text-sm text-gray-600">无图片</span>

          <!-- Nav hint zones -->
          <div
            v-if="zoom === 1 && refPhotos.length > 1"
            class="absolute inset-y-0 left-0 flex items-center pl-2 pointer-events-none"
            style="width:72px;"
          >
            <span class="text-2xl text-white/20">‹</span>
          </div>
          <div
            v-if="zoom === 1 && refPhotos.length > 1"
            class="absolute inset-y-0 right-0 flex items-center justify-end pr-2 pointer-events-none"
            style="width:72px;"
          >
            <span class="text-2xl text-white/20">›</span>
          </div>
        </div>

        <!-- Filmstrip -->
        <div
          ref="filmstripEl"
          class="flex gap-1.5 px-3 py-2 shrink-0 overflow-x-auto"
          style="background:#0d0d1f; border-top:1px solid #1a1a30; height:92px; scrollbar-width:thin;"
        >
          <div
            v-for="(photo, i) in refPhotos"
            :key="i"
            class="shrink-0 cursor-pointer rounded overflow-hidden"
            :style="{
              width: '68px', height: '68px',
              outline: (i === currentPhotoIdx && !centerUrl)
                ? '2px solid #818cf8'
                : '2px solid transparent',
              opacity: (i === currentPhotoIdx && !centerUrl) ? 1 : 0.55,
              transition: 'opacity 0.15s, outline-color 0.15s',
            }"
            @click.stop="selectPhoto(i)"
          >
            <img
              :src="thumbUrl(photo, 140)"
              class="w-full h-full object-cover"
              loading="lazy"
              width="68"
              height="68"
              draggable="false"
            />
          </div>
        </div>
      </div>

      <!-- ══ Right panel: generated images ══════════════════════════════ -->
      <div
        class="flex flex-col shrink-0"
        style="width:136px; background:#0d0d1f; border-left:1px solid #1a1a30;"
      >
        <div
          class="shrink-0 text-[10px] text-gray-500 px-3 py-2"
          style="border-bottom:1px solid #1a1a30;"
        >
          生成图（{{ generatedImages.length }}）
        </div>

        <div class="flex flex-col gap-1.5 overflow-y-auto p-1.5" style="scrollbar-width:thin;">
          <div
            v-for="img in generatedImages"
            :key="img.id"
            class="shrink-0 cursor-pointer rounded overflow-hidden"
            :style="{
              width: '116px', height: '116px',
              outline: centerUrl === mediaUrl(img.filepath)
                ? '2px solid #818cf8'
                : '2px solid transparent',
              opacity: centerUrl === mediaUrl(img.filepath) ? 1 : 0.65,
              transition: 'opacity 0.15s',
            }"
            @click.stop="selectGenImage(img)"
          >
            <img
              :src="mediaUrl(img.filepath)"
              class="w-full h-full object-cover hover:opacity-90 transition-opacity"
              loading="lazy"
              width="116"
              height="116"
              draggable="false"
            />
          </div>

          <p v-if="generatedImages.length === 0" class="text-[10px] text-gray-600 text-center px-2 pt-4 leading-relaxed">
            暂无生成图
          </p>
        </div>
      </div>
    </template>

  </div>
</template>
