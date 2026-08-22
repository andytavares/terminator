import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageStub, writable: true })

import {
  COLLAPSE_STORAGE_KEY,
  loadCollapseState,
  saveCollapseState,
  isCollapsed,
  toggleCollapsed,
} from '../../../../src/renderer/sidebar/collapse-state'

beforeEach(() => {
  store.clear()
  vi.restoreAllMocks()
})

describe('loadCollapseState', () => {
  it('starts empty, which means every group is expanded (FR-008)', () => {
    expect(loadCollapseState()).toEqual({})
  })

  it('reads back what was saved', () => {
    saveCollapseState({ project: ['p1'] })
    expect(loadCollapseState()).toEqual({ project: ['p1'] })
  })

  it('degrades to empty on unparseable JSON rather than throwing', () => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, '{nope')
    expect(loadCollapseState()).toEqual({})
  })

  it('degrades to empty when the stored value is not an object', () => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(['p1']))
    expect(loadCollapseState()).toEqual({})
  })

  it('ignores entries whose value is not a list of strings', () => {
    localStorage.setItem(
      COLLAPSE_STORAGE_KEY,
      JSON.stringify({ project: ['p1'], status: 'nope', branch: [1, 2] })
    )
    expect(loadCollapseState()).toEqual({ project: ['p1'] })
  })

  it('survives storage throwing on read', () => {
    vi.spyOn(localStorageStub, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadCollapseState()).toEqual({})
  })
})

describe('saveCollapseState', () => {
  it('swallows a write failure instead of breaking the sidebar', () => {
    vi.spyOn(localStorageStub, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveCollapseState({ project: ['p1'] })).not.toThrow()
  })
})

describe('isCollapsed', () => {
  it('reports expanded when nothing is stored', () => {
    expect(isCollapsed({}, 'project', 'p1')).toBe(false)
  })

  it('reports collapsed for a stored key', () => {
    expect(isCollapsed({ project: ['p1'] }, 'project', 'p1')).toBe(true)
  })

  it('keeps grouping modes isolated — collapsing a project does not collapse a status group', () => {
    const state = { project: ['p1'] }
    expect(isCollapsed(state, 'status', 'p1')).toBe(false)
  })
})

describe('toggleCollapsed', () => {
  it('collapses an expanded group', () => {
    expect(toggleCollapsed({}, 'project', 'p1')).toEqual({ project: ['p1'] })
  })

  it('expands a collapsed group', () => {
    expect(toggleCollapsed({ project: ['p1'] }, 'project', 'p1')).toEqual({ project: [] })
  })

  it('leaves other groups in the same mode alone', () => {
    expect(toggleCollapsed({ project: ['p1', 'p2'] }, 'project', 'p1')).toEqual({ project: ['p2'] })
  })

  it('leaves other grouping modes alone', () => {
    const next = toggleCollapsed({ status: ['idle'] }, 'project', 'p1')
    expect(next).toEqual({ status: ['idle'], project: ['p1'] })
  })

  it('does not mutate the state it was given', () => {
    const state = { project: ['p1'] }
    toggleCollapsed(state, 'project', 'p2')
    expect(state).toEqual({ project: ['p1'] })
  })
})
