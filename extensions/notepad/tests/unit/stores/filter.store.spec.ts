import { describe, it, expect, beforeEach } from 'vitest'
import { useFilterStore } from '../../../src/stores/filter.store'

beforeEach(() => {
  useFilterStore.setState({
    searchQuery: '',
    activeTagIds: [],
    includeArchived: false,
  })
})

describe('useFilterStore', () => {
  it('initializes with empty query, no active tags, archived off', () => {
    const state = useFilterStore.getState()
    expect(state.searchQuery).toBe('')
    expect(state.activeTagIds).toEqual([])
    expect(state.includeArchived).toBe(false)
  })

  it('setQuery updates searchQuery', () => {
    useFilterStore.getState().setQuery('rust lang')
    expect(useFilterStore.getState().searchQuery).toBe('rust lang')
  })

  it('toggleTag adds a tag id', () => {
    useFilterStore.getState().toggleTag('tag-abc')
    expect(useFilterStore.getState().activeTagIds).toEqual(['tag-abc'])
  })

  it('toggleTag removes a tag id that is already active', () => {
    useFilterStore.getState().toggleTag('tag-abc')
    useFilterStore.getState().toggleTag('tag-abc')
    expect(useFilterStore.getState().activeTagIds).toEqual([])
  })

  it('toggleTag supports multiple active tags', () => {
    useFilterStore.getState().toggleTag('tag-abc')
    useFilterStore.getState().toggleTag('tag-xyz')
    expect(useFilterStore.getState().activeTagIds).toEqual(['tag-abc', 'tag-xyz'])
  })

  it('clearTags empties activeTagIds', () => {
    useFilterStore.getState().toggleTag('tag-abc')
    useFilterStore.getState().toggleTag('tag-xyz')
    useFilterStore.getState().clearTags()
    expect(useFilterStore.getState().activeTagIds).toEqual([])
  })

  it('toggleArchived flips includeArchived', () => {
    expect(useFilterStore.getState().includeArchived).toBe(false)
    useFilterStore.getState().toggleArchived()
    expect(useFilterStore.getState().includeArchived).toBe(true)
    useFilterStore.getState().toggleArchived()
    expect(useFilterStore.getState().includeArchived).toBe(false)
  })
})
