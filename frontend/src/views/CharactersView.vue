<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton, NModal, NInput, NCheckbox, NPopconfirm, NSpin, NEmpty, useMessage,
} from 'naive-ui'
import { useCharactersStore } from '@/stores/characters'
import { characterApi, type FolderScanResult, type Character } from '@/api/characters'
import http from '@/api/http'

const router = useRouter()
const message = useMessage()
const store = useCharactersStore()

onMounted(() => store.fetchAll())

// ── URL 处理 ──────────────────────────────────────────────────────────
/** 缩略图 URL：仅对原生绝对路径走 /api/files/thumb，媒体目录图走原路径。 */
function thumbUrl(path: string, size = 400): string {
  if (!path) return ''
  if (/^[A-Za-z]:[\\/]/.test(path))
    return `/api/files/thumb?path=${encodeURIComponent(path)}&size=${size}`
  return path.startsWith('/') ? path : '/' + path
}

function coverUrl(char: Character): string | null {
  if (char.face_crop_nobg) return thumbUrl(char.face_crop_nobg, 400)
  if (char.reference_photos.length > 0) return thumbUrl(char.reference_photos[0], 400)
  return null
}

// ── 两级浏览 ──────────────────────────────────────────────────────────
// null = 顶层文件夹列表；non-null = 已打开某个人物的图片文件夹
const openChar = ref<Character | null>(null)

function enterFolder(char: Character) { openChar.value = char }
function exitFolder()                 { openChar.value = null }

// ── 重命名 / 删除（在文件夹内部操作） ─────────────────────────────────
const showEdit  = ref(false)
const editName  = ref('')
const saving    = ref(false)

function openEdit() {
  if (!openChar.value) return
  editName.value = openChar.value.name
  showEdit.value = true
}

async function handleSave() {
  if (!editName.value.trim() || !openChar.value) return
  saving.value = true
  try {
    const updated = await store.update(openChar.value.id, { name: editName.value.trim() })
    openChar.value = updated
    showEdit.value = false
    message.success('已保存')
  } finally {
    saving.value = false
  }
}

async function handleDelete() {
  if (!openChar.value) return
  await store.remove(openChar.value.id)
  exitFolder()
  message.success('已删除')
}

// ── 扫描导入 ──────────────────────────────────────────────────────────
const showScan        = ref(false)
const scanPath        = ref('')
const scanning        = ref(false)
const browsing        = ref(false)
const scanResults     = ref<FolderScanResult[]>([])
const selectedFolders = ref<Set<string>>(new Set())
const editedNames     = ref<Record<string, string>>({})
const importing       = ref(false)

async function handleBrowse() {
  browsing.value = true
  try {
    const { data } = await http.get<{ path: string }>('/files/pick-folder')
    if (data.path) scanPath.value = data.path
  } catch {
    message.error('无法打开文件夹选择器')
  } finally {
    browsing.value = false
  }
}

async function handleScan() {
  if (!scanPath.value.trim()) return
  scanning.value = true
  scanResults.value = []
  selectedFolders.value = new Set()
  editedNames.value = {}
  try {
    const { data } = await characterApi.scanFolder(scanPath.value.trim())
    scanResults.value = data
    for (const r of data) {
      if (!r.already_imported) selectedFolders.value.add(r.folder_path)
      editedNames.value[r.folder_path] = r.folder_name
    }
    if (data.length === 0) message.info('该目录下没有子文件夹')
  } catch (e: any) {
    message.error(e?.response?.data?.detail ?? '扫描失败')
  } finally {
    scanning.value = false
  }
}

function toggleFolder(path: string) {
  if (selectedFolders.value.has(path)) selectedFolders.value.delete(path)
  else selectedFolders.value.add(path)
}

function openPhoto(photoIdx: number) {
  if (!openChar.value) return
  router.push(`/viewer/${openChar.value.id}/${photoIdx}`)
}

function closeScan() {
  showScan.value = false
  scanPath.value = ''
  scanResults.value = []
}

async function handleImport() {
  const items = [...selectedFolders.value].map(path => ({
    folder_path: path,
    name: editedNames.value[path] || '',
  }))
  if (!items.length) return
  importing.value = true
  try {
    await characterApi.importFolders(items)
    await store.fetchAll()
    showScan.value = false
    scanPath.value = ''
    scanResults.value = []
    message.success(`已导入 ${items.length} 个人物`)
  } catch (e: any) {
    message.error(e?.response?.data?.detail ?? '导入失败')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">

    <!-- ══ 顶层：文件夹列表 ══════════════════════════════════════════ -->
    <template v-if="!openChar">
      <!-- 工具栏 -->
      <div
        class="flex items-center justify-between px-5 py-3 shrink-0"
        style="background:#111127; border-bottom:1px solid #2a2a4a;"
      >
        <span class="text-sm font-semibold text-white">人物</span>
        <NButton size="small" type="primary" @click="showScan = true">+ 扫描文件夹</NButton>
      </div>

      <!-- 内容 -->
      <div class="flex-1 overflow-y-auto p-4">
        <div v-if="store.loading" class="flex items-center justify-center h-full">
          <NSpin size="large" />
        </div>
        <NEmpty v-else-if="store.list.length === 0" description="还没有人物，点击「扫描文件夹」导入图包" class="mt-20" />
        <div
          v-else
          class="grid gap-3"
          style="grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));"
        >
          <div
            v-for="char in store.list"
            :key="char.id"
            class="rounded-xl overflow-hidden cursor-pointer group transition-all hover:scale-[1.02]"
            style="background:#1a1a32; border:1px solid #2a2a4a;"
            @click="enterFolder(char)"
          >
            <!-- 封面 -->
            <div class="aspect-square overflow-hidden relative" style="background:#111127;">
              <img
                v-if="coverUrl(char)"
                :src="coverUrl(char)!"
                class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                :alt="char.name"
                loading="lazy"
                width="400"
                height="400"
              />
              <div v-else class="w-full h-full flex items-center justify-center text-5xl select-none">
                📁
              </div>
            </div>
            <!-- 名称 + 数量 -->
            <div class="px-2 py-2">
              <p class="text-sm font-medium text-white truncate leading-snug">{{ char.name }}</p>
              <p class="text-[10px] text-gray-500 mt-0.5">{{ char.reference_photos.length }} 张</p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ══ 二级：文件夹内图片 ══════════════════════════════════════════ -->
    <template v-else>
      <!-- 顶部导航 -->
      <div
        class="flex items-center gap-3 px-4 py-3 shrink-0"
        style="background:#111127; border-bottom:1px solid #2a2a4a;"
      >
        <!-- 返回 -->
        <button
          class="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
          @click="exitFolder"
        >
          ← 人物
        </button>
        <span class="text-gray-600">/</span>
        <span class="text-sm font-semibold text-white">{{ openChar.name }}</span>
        <span class="text-[10px] text-gray-500">{{ openChar.reference_photos.length }} 张</span>

        <!-- 右侧操作 -->
        <div class="ml-auto flex items-center gap-2">
          <NButton
            size="small"
            type="primary"
            @click="router.push({ path: '/generate', query: { char: openChar.id } })"
          >
            生成写真
          </NButton>
          <NButton size="small" ghost @click="openEdit">重命名</NButton>
          <NPopconfirm @positive-click="handleDelete">
            <template #trigger>
              <NButton size="small" type="error" ghost>删除</NButton>
            </template>
            确认删除「{{ openChar.name }}」及所有记录？
          </NPopconfirm>
        </div>
      </div>

      <!-- 图片网格 -->
      <div class="flex-1 overflow-y-auto p-4">
        <NEmpty
          v-if="openChar.reference_photos.length === 0"
          description="该人物文件夹中没有图片"
          class="mt-20"
        />
        <div
          v-else
          class="grid gap-2"
          style="grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));"
        >
          <div
            v-for="(photoPath, i) in openChar.reference_photos"
            :key="i"
            class="aspect-square rounded-lg overflow-hidden cursor-pointer group"
            style="background:#111127;"
            @click="openPhoto(i)"
          >
            <img
              :src="thumbUrl(photoPath, 320)"
              class="w-full h-full object-cover group-hover:brightness-110 transition-all duration-200"
              loading="lazy"
              :alt="`图片 ${i + 1}`"
              width="320"
              height="320"
            />
          </div>
        </div>
      </div>
    </template>

  </div>

  <!-- ── 重命名弹窗 ────────────────────────────────────────────────── -->
  <NModal v-model:show="showEdit" style="width:360px;" preset="card" title="重命名人物">
    <NInput
      v-model:value="editName"
      placeholder="人物名称"
      size="small"
      @keyup.enter="handleSave"
    />
    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton size="small" @click="showEdit = false">取消</NButton>
        <NButton size="small" type="primary" :loading="saving" @click="handleSave">保存</NButton>
      </div>
    </template>
  </NModal>

  <!-- ── 扫描导入弹窗 ──────────────────────────────────────────────── -->
  <NModal
    v-model:show="showScan"
    style="width:520px;"
    preset="card"
    title="扫描文件夹"
    @mask-click="closeScan"
  >
    <div class="flex gap-2 mb-4">
      <NInput
        v-model:value="scanPath"
        placeholder="例如：D:\images\characters"
        size="small"
        class="flex-1"
        @keyup.enter="handleScan"
      />
      <NButton size="small" :loading="browsing" @click="handleBrowse">浏览…</NButton>
      <NButton size="small" type="primary" :loading="scanning" @click="handleScan">扫描</NButton>
    </div>

    <div v-if="scanResults.length > 0">
      <p class="text-xs text-gray-400 mb-2">
        发现 {{ scanResults.length }} 个子文件夹，已选中 {{ selectedFolders.size }} 个
      </p>
      <div class="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
        <div
          v-for="r in scanResults"
          :key="r.folder_path"
          class="flex items-center gap-3 p-2 rounded"
          style="background:#111127;"
        >
          <NCheckbox
            :checked="selectedFolders.has(r.folder_path)"
            :disabled="r.already_imported"
            @update:checked="toggleFolder(r.folder_path)"
          />
          <NInput
            v-model:value="editedNames[r.folder_path]"
            size="tiny"
            :disabled="r.already_imported"
            class="flex-1"
          />
          <span class="text-[10px] text-gray-500 shrink-0">{{ r.photo_count }} 张</span>
          <span v-if="r.already_imported" class="text-[10px] shrink-0" style="color:#34d399;">已导入</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton size="small" @click="closeScan">取消</NButton>
        <NButton
          v-if="scanResults.length > 0"
          size="small"
          type="primary"
          :loading="importing"
          :disabled="selectedFolders.size === 0"
          @click="handleImport"
        >导入选中 ({{ selectedFolders.size }})</NButton>
      </div>
    </template>
  </NModal>
</template>
