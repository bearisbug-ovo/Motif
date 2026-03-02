import { defineStore } from 'pinia'
import { ref } from 'vue'
import { characterApi, type Character } from '@/api/characters'

export const useCharactersStore = defineStore('characters', () => {
  const list = ref<Character[]>([])
  const loading = ref(false)

  async function fetchAll() {
    loading.value = true
    try {
      const { data } = await characterApi.list()
      list.value = data
    } finally {
      loading.value = false
    }
  }

  async function update(id: number, payload: { name?: string }) {
    const { data } = await characterApi.update(id, payload)
    const idx = list.value.findIndex(c => c.id === id)
    if (idx >= 0) list.value[idx] = data
    return data
  }

  async function remove(id: number) {
    await characterApi.remove(id)
    list.value = list.value.filter(c => c.id !== id)
  }

  // Refresh a single character (e.g. after preprocessing completes)
  async function refresh(id: number) {
    const { data } = await characterApi.get(id)
    const idx = list.value.findIndex(c => c.id === id)
    if (idx >= 0) list.value[idx] = data
    return data
  }

  return { list, loading, fetchAll, update, remove, refresh }
})
