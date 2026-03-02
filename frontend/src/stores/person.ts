import { create } from 'zustand'
import { personsApi, Person, PersonSortField } from '@/api/persons'

interface PersonStore {
  persons: Person[]
  currentPerson: Person | null
  loading: boolean
  sort: PersonSortField
  filterRating: string | undefined
  fetchPersons: () => Promise<void>
  fetchPerson: (id: string) => Promise<void>
  createPerson: (name: string) => Promise<Person>
  updatePerson: (id: string, data: { name?: string; cover_media_id?: string }) => Promise<void>
  deletePerson: (id: string, mode?: 'person_only' | 'person_and_albums' | 'all') => Promise<void>
  setSort: (sort: PersonSortField) => void
  setFilterRating: (f: string | undefined) => void
}

export const usePersonStore = create<PersonStore>((set, get) => ({
  persons: [],
  currentPerson: null,
  loading: false,
  sort: 'created_at',
  filterRating: undefined,

  fetchPersons: async () => {
    set({ loading: true })
    try {
      const { sort, filterRating } = get()
      const persons = await personsApi.list(sort, filterRating)
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

  setSort: (sort) => {
    set({ sort })
    get().fetchPersons()
  },

  setFilterRating: (filterRating) => {
    set({ filterRating })
    get().fetchPersons()
  },
}))
