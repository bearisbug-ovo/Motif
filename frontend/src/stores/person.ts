import { create } from 'zustand'
import { personsApi, Person, PersonSortField } from '@/api/persons'
import { getSortDefault, getFilterDefault, parseSortValue } from '@/lib/filterDefaults'

interface PersonStore {
  persons: Person[]
  currentPerson: Person | null
  loading: boolean
  sort: string
  filterRating: string | undefined
  filterTagIds: string[]
  fetchPersons: () => Promise<void>
  fetchPerson: (id: string) => Promise<void>
  createPerson: (name: string) => Promise<Person>
  updatePerson: (id: string, data: { name?: string; cover_media_id?: string; tag_ids?: string[] }) => Promise<void>
  deletePerson: (id: string, mode?: 'person_only' | 'person_and_albums' | 'all') => Promise<void>
  setSort: (sort: string) => void
  setFilterRating: (f: string | undefined) => void
  setFilterTagIds: (ids: string[]) => void
  resetFilters: () => void
}

export const usePersonStore = create<PersonStore>((set, get) => ({
  persons: [],
  currentPerson: null,
  loading: false,
  sort: 'created_at:desc',
  filterRating: undefined,
  filterTagIds: [],

  fetchPersons: async () => {
    set({ loading: true })
    try {
      const { sort, filterRating, filterTagIds } = get()
      const { field, dir } = parseSortValue(sort)
      const tagIds = filterTagIds.length > 0 ? filterTagIds.join(',') : undefined
      const persons = await personsApi.list(field as PersonSortField, filterRating, dir, tagIds)
      set({ persons, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchPerson: async (id) => {
    const p = await personsApi.get(id)
    set({ currentPerson: p })
  },

  createPerson: async (name) => {
    const p = await personsApi.create({ name })
    set((s) => ({ persons: [p, ...s.persons] }))
    return p
  },

  updatePerson: async (id, data) => {
    const p = await personsApi.update(id, data)
    set((s) => ({
      persons: s.persons.map((x) => (x.id === id ? p : x)),
      currentPerson: s.currentPerson?.id === id ? p : s.currentPerson,
    }))
  },

  deletePerson: async (id, mode = 'person_only') => {
    await personsApi.delete(id, mode)
    set((s) => ({
      persons: s.persons.filter((x) => x.id !== id),
      currentPerson: s.currentPerson?.id === id ? null : s.currentPerson,
    }))
  },

  setSort: (sort) => set({ sort }),
  setFilterRating: (filterRating) => set({ filterRating }),
  setFilterTagIds: (filterTagIds) => set({ filterTagIds }),
  resetFilters: () => set({
    sort: getSortDefault('media-library'),
    filterRating: getFilterDefault('filterRating') || undefined,
    filterTagIds: [],
  }),
}))
