<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  NSelect, NButton, NSpin, NEmpty, NModal,
  NRate, NTag, NPopconfirm, useMessage,
} from 'naive-ui'
import { galleryApi, type ImageRecord } from '@/api/gallery'
import { useCharactersStore } from '@/stores/characters'

const message = useMessage()
const router = useRouter()
const charStore = useCharactersStore()

onMounted(() => {
  charStore.fetchAll()
  loadImages()
})

// ── 数据 ─────────────────────────────────────
const images = ref<ImageRecord[]>([])
const loading = ref(false)
const page = ref(1)
const hasMore = ref(true)

// ── 筛选 ─────────────────────────────────────
const filterChar = ref<number | null>(null)
const filterModel = ref<string | null>(null)
const filterMinRating = ref<number | null>(null)

const charOptions = computed(() =>
  charStore.list.map(c => ({ label: c.name, value: c.id }))
)
const modelOptions = [
  { label: 'Turbo', value: 'turbo' },
  { label: 'Base', value: 'base' },
]

async function loadImages(reset = false) {
  if (reset) { page.value = 1; images.value = []; hasMore.value = true }
  if (!hasMore.value || loading.value) return
  loading.value = true
  try {
    const { data } = await galleryApi.list({
      page: page.value,
      page_size: 30,
      character_id: filterChar.value ?? undefined,
      model: filterModel.value ?? undefined,
      min_rating: filterMinRating.value ?? undefined,
    })
    if (data.length < 30) hasMore.value = false
    if (reset) images.value = data
    else images.value.push(...data)
    page.value++
  } finally {
    loading.value = false
  }
}

function applyFilter() { loadImages(true) }

// ── 详情弹窗 ─────────────────────────────────
const showDetail = ref(false)
const detailImg = ref<ImageRecord | null>(null)

function openDetail(img: ImageRecord) {
  detailImg.value = img
  showDetail.value = true
}

async function handleRate(id: number, rating: number) {
  await galleryApi.rate(id, rating)
  const idx = images.value.findIndex(i => i.id === id)
  if (idx >= 0) images.value[idx].rating = rating
  if (detailImg.value?.id === id) detailImg.value.rating = rating
}

async function handleDelete(id: number) {
  await galleryApi.remove(id)
  images.value = images.value.filter(i => i.id !== id)
  showDetail.value = false
  message.success('已删除')
}

function mediaUrl(path: string) {
  return path.startsWith('/') ? path : '/' + path
}

function charName(id: number | null) {
  if (!id) return '—'
  return charStore.list.find(c => c.id === id)?.name ?? `#${id}`
}

function formatDate(s: string) {
  return new Date(s).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- 筛选栏 -->
    <div
      class="flex items-center gap-3 px-5 py-3 shrink-0 flex-wrap"
      style="background:#111127; border-bottom:1px solid #2a2a4a;"
    >
      <span class="text-sm font-semibold text-white mr-2">图库</span>
      <NSelect v-model:value="filterChar" :options="charOptions" placeholder="全部人物" clearable size="small" style="width:120px;" />
      <NSelect v-model:value="filterModel" :options="modelOptions" placeholder="全部模型" clearable size="small" style="width:100px;" />
      <NSelect
        v-model:value="filterMinRating"
        :options="[{label:'★ 1+',value:1},{label:'★★ 2+',value:2},{label:'★★★ 3+',value:3},{label:'★★★★ 4+',value:4},{label:'★★★★★ 5',value:5}]"
        placeholder="全部评分"
        clearable
        size="small"
        style="width:100px;"
      />
      <NButton size="small" type="primary" ghost @click="applyFilter">筛选</NButton>
      <span class="text-xs text-gray-500 ml-auto">{{ images.length }} 张</span>
    </div>

    <!-- 图片网格 -->
    <div class="flex-1 overflow-y-auto p-4">
      <div v-if="loading && images.length === 0" class="flex items-center justify-center h-full">
        <NSpin size="large" />
      </div>
      <NEmpty v-else-if="images.length === 0" description="暂无图片" class="mt-20" />
      <div v-else>
        <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));">
          <div
            v-for="img in images"
            :key="img.id"
            class="rounded-xl overflow-hidden cursor-pointer group transition-all"
            style="background:#1a1a32; border:1px solid #2a2a4a;"
            @click="openDetail(img)"
          >
            <div class="aspect-square overflow-hidden" style="background:#111127;">
              <img
                :src="mediaUrl(img.filepath)"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                :alt="`图片${img.id}`"
                loading="lazy"
              />
            </div>
            <div class="px-2 py-1.5 flex items-center justify-between">
              <div class="flex gap-1 flex-wrap">
                <NTag size="tiny" :bordered="false" style="background:#2a2a4a; font-size:10px;">
                  {{ img.model === 'turbo' ? 'T' : 'B' }}
                </NTag>
                <NTag v-if="img.faceswapped" size="tiny" :bordered="false" style="background:#312e81; font-size:10px;">换脸</NTag>
                <NTag v-if="img.upscaled" size="tiny" :bordered="false" style="background:#14532d; font-size:10px;">放大</NTag>
              </div>
              <span v-if="img.rating" class="text-yellow-400 text-xs">{{ '★'.repeat(img.rating) }}</span>
            </div>
          </div>
        </div>

        <div v-if="hasMore" class="flex justify-center mt-4">
          <NButton size="small" :loading="loading" @click="loadImages()">加载更多</NButton>
        </div>
      </div>
    </div>
  </div>

  <!-- 详情弹窗 -->
  <NModal v-model:show="showDetail" style="width:680px; max-width:95vw;" preset="card" title="图片详情">
    <div v-if="detailImg" class="flex gap-4">
      <div class="flex-1 min-w-0">
        <img
          :src="mediaUrl(detailImg.filepath)"
          class="w-full rounded-lg object-contain"
          style="max-height:480px;"
          :alt="`图片${detailImg.id}`"
        />
      </div>
      <div class="flex flex-col gap-3" style="width:180px; min-width:180px;">
        <div>
          <p class="text-xs text-gray-400 mb-1">评分</p>
          <NRate
            :value="detailImg.rating ?? 0"
            @update:value="v => handleRate(detailImg!.id, v)"
          />
        </div>

        <div class="flex flex-col gap-2 text-xs">
          <div><span class="text-gray-500">模型：</span><span class="text-gray-200">{{ detailImg.model === 'turbo' ? 'Turbo' : 'Base' }}</span></div>
          <div><span class="text-gray-500">人物：</span><span class="text-gray-200">{{ charName(detailImg.character_id) }}</span></div>
          <div><span class="text-gray-500">种子：</span><span class="text-gray-200">{{ detailImg.seed }}</span></div>
          <div><span class="text-gray-500">时间：</span><span class="text-gray-200">{{ formatDate(detailImg.created_at) }}</span></div>
          <div class="flex gap-1 flex-wrap mt-1">
            <NTag v-if="detailImg.faceswapped" size="small" :bordered="false" style="background:#312e81;">换脸</NTag>
            <NTag v-if="detailImg.upscaled" size="small" :bordered="false" style="background:#14532d;">高清放大</NTag>
            <NTag v-if="detailImg.inpainted" size="small" :bordered="false" style="background:#1e3a5f;">重绘</NTag>
          </div>
        </div>

        <div>
          <p class="text-xs text-gray-400 mb-1">提示词</p>
          <p class="text-xs text-gray-300 break-words" style="line-height:1.6;">{{ detailImg.prompt || '—' }}</p>
        </div>

        <div class="mt-auto flex flex-col gap-2">
          <NButton size="small" tag="a" :href="mediaUrl(detailImg.filepath)" target="_blank">
            查看原图
          </NButton>
          <NButton
            size="small"
            @click="() => { showDetail = false; router.push(`/inpaint/${detailImg!.id}`) }"
          >
            局部重绘
          </NButton>
          <NPopconfirm @positive-click="handleDelete(detailImg!.id)">
            <template #trigger>
              <NButton size="small" type="error" ghost>删除</NButton>
            </template>
            确认删除此图片？
          </NPopconfirm>
        </div>
      </div>
    </div>
  </NModal>
</template>
