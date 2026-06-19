import { describe, it, expect, beforeEach } from 'vitest'
import { useFilterStore } from '../../../src/stores/filter.store'

beforeEach(() => {
  useFilterStore.setState({
    searchQuery: '',
    activeTagId: null,
    includeArchived: false,
  })
})

describe('useFilterStore', () => {
  it('initializes with empty query, no active tag, archived off', () => {
    const state = useFilterStore.getState()
    expect(state.searchQuery).toBe('')
    expect(state.activeTagId).toBeNull()
    expect(state.includeArchived).toBe(false)
  })

  it('setQuery updates searchQuery', () => {
    useFilterStore.getState().setQuery('rust lang')
    expect(useFilterStore.getState().searchQuery).toBe('rust lang')
  })

  it('setTag updates activeTagId', () => {
    useFilterStore.getState().setTag('tag-abc')
    expect(useFilterStore.getState().activeTagId).toBe('tag-abc')
  })

  it('setTag with null clears activeTagId', () => {
    useFilterStore.getState().setTag('tag-abc')
    useFilterStore.getState().setTag(null)
    expect(useFilterStore.getState().activeTagId).toBeNull()
  })

  it('toggleArchived flips includeArchived', () => {
    expect(useFilterStore.getState().includeArchived).toBe(false)
    useFilterStore.getState().toggleArchived()
    expect(useFilterStore.getState().includeArchived).toBe(true)
    useFilterStore.getState().toggleArchived()
    expect(useFilterStore.getState().includeArchived).toBe(false)
  })
})
