import { describe, it, expect, beforeEach } from 'vitest'
import { useFilterStore } from '../../../src/stores/filter.store'

beforeEach(() => {
  useFilterStore.setState({
    searchQuery: '',
    activeTagIds: [],
    includeArchived: false,
  })
})

describe('useFilterStore', useFilterStoreTests)

function useFilterStoreTests() {
  describe('query', useFilterStoreQueryTests)
  describe('tags', useFilterStoreTagsTests)
  describe('archived', useFilterStoreArchivedTests)
}

function useFilterStoreQueryTests() {
  it('setQuery updates searchQuery', () => {
    useFilterStore.getState().setQuery('rust lang')
    expect(useFilterStore.getState().searchQuery).toBe('rust lang')
  })
}

function useFilterStoreTagsTests() {
  it('toggleTag adds each tag id, keeping the earlier ones active', () => {
    useFilterStore.getState().toggleTag('tag-abc')
    useFilterStore.getState().toggleTag('tag-xyz')
    expect(useFilterStore.getState().activeTagIds).toEqual(['tag-abc', 'tag-xyz'])
  })

  it('toggleTag removes a tag id that is already active', () => {
    useFilterStore.getState().toggleTag('tag-abc')
    useFilterStore.getState().toggleTag('tag-abc')
    expect(useFilterStore.getState().activeTagIds).toEqual([])
  })

  it('clearTags empties activeTagIds', () => {
    useFilterStore.getState().toggleTag('tag-abc')
    useFilterStore.getState().toggleTag('tag-xyz')
    useFilterStore.getState().clearTags()
    expect(useFilterStore.getState().activeTagIds).toEqual([])
  })
}

function useFilterStoreArchivedTests() {
  it('toggleArchived flips includeArchived', () => {
    expect(useFilterStore.getState().includeArchived).toBe(false)
    useFilterStore.getState().toggleArchived()
    expect(useFilterStore.getState().includeArchived).toBe(true)
    useFilterStore.getState().toggleArchived()
    expect(useFilterStore.getState().includeArchived).toBe(false)
  })
}
