import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// This spec runs in the node project (see vitest.config.ts), so the browser
// storage the module uses is stubbed here, as session.store.spec.ts stubs window.
const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageStub,
  writable: true,
})

import {
  BUILT_IN_VIEWS,
  DEFAULT_VIEW_ID,
  VIEWS_STORAGE_KEY,
  loadViews,
  saveViews,
} from '../../../../src/renderer/sidebar/views'

const custom = {
  id: 'mine',
  name: 'Mine',
  groupBy: 'status' as const,
  sortBy: 'recent' as const,
  filters: { hideStale: true },
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  localStorage.clear()
})

describe('built-in views', () => {
  it('ships exactly the four required views', () => {
    expect(BUILT_IN_VIEWS.map((v) => v.id)).toEqual(['everything', 'needs-me', 'active', 'stale'])
  })

  it('defaults to the unfiltered Everything view', () => {
    expect(DEFAULT_VIEW_ID).toBe('everything')
    const everything = BUILT_IN_VIEWS.find((v) => v.id === 'everything')!
    expect(everything.filters).toEqual({})
    expect(everything.groupBy).toBe('project')
    expect(everything.sortBy).toBe('manual')
  })

  it('defines Needs me as awaiting-input, most recent first', () => {
    const v = BUILT_IN_VIEWS.find((x) => x.id === 'needs-me')!
    expect(v.filters.states).toEqual(['awaiting-input'])
    expect(v.sortBy).toBe('recent')
  })

  it('defines Active as working only', () => {
    expect(BUILT_IN_VIEWS.find((v) => v.id === 'active')!.filters.states).toEqual(['working'])
  })

  it('defines Stale as stale-only, oldest first', () => {
    const v = BUILT_IN_VIEWS.find((x) => x.id === 'stale')!
    expect(v.filters.staleOnly).toBe(true)
    expect(v.sortBy).toBe('oldest')
  })

  it('marks every built-in as builtIn so the UI cannot offer to delete one', () => {
    expect(BUILT_IN_VIEWS.every((v) => v.builtIn)).toBe(true)
  })

  it('never renders a hide-stale toggle on the Stale view — the two filters contradict', () => {
    const stale = BUILT_IN_VIEWS.find((v) => v.id === 'stale')!
    expect(stale.filters.hideStale).toBeUndefined()
  })
})

describe('loadViews', () => {
  it('returns the built-ins when nothing is stored', () => {
    expect(loadViews().map((v) => v.id)).toEqual(BUILT_IN_VIEWS.map((v) => v.id))
  })

  it('appends stored custom views after the built-ins', () => {
    localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ custom: [custom], overrides: {} }))
    expect(loadViews().map((v) => v.id)).toEqual([
      'everything',
      'needs-me',
      'active',
      'stale',
      'mine',
    ])
  })

  it('degrades to the built-ins on unparseable JSON rather than throwing', () => {
    localStorage.setItem(VIEWS_STORAGE_KEY, '{not json')
    expect(loadViews()).toEqual(BUILT_IN_VIEWS)
  })

  it('degrades to the built-ins when the stored value has neither shape', () => {
    localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ id: 'x' }))
    expect(loadViews()).toEqual(BUILT_IN_VIEWS)
  })

  it('drops stored entries that are not shaped like a view', () => {
    localStorage.setItem(
      VIEWS_STORAGE_KEY,
      JSON.stringify({ custom: [custom, { id: 'bad' }, null, 7], overrides: {} })
    )
    expect(loadViews().map((v) => v.id)).toEqual([
      'everything',
      'needs-me',
      'active',
      'stale',
      'mine',
    ])
  })

  it('ignores a stored view that squats on a built-in id', () => {
    const impostor = { ...custom, id: 'everything', name: 'Impostor' }
    localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ custom: [impostor], overrides: {} }))
    const loaded = loadViews()
    expect(loaded.filter((v) => v.id === 'everything')).toHaveLength(1)
    expect(loaded.find((v) => v.id === 'everything')!.name).toBe('Everything')
  })

  it('survives localStorage throwing on read', () => {
    vi.spyOn(localStorageStub, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadViews()).toEqual(BUILT_IN_VIEWS)
  })
})

describe('saveViews', () => {
  it('persists the custom views', () => {
    saveViews([...BUILT_IN_VIEWS, custom])
    expect(JSON.parse(localStorage.getItem(VIEWS_STORAGE_KEY)!).custom).toEqual([custom])
  })

  it('writes no override for a built-in the user has not changed', () => {
    saveViews([...BUILT_IN_VIEWS, custom])
    expect(JSON.parse(localStorage.getItem(VIEWS_STORAGE_KEY)!).overrides).toEqual({})
  })

  it("persists a built-in's changed grouping and sort (FR-014)", () => {
    const regrouped = BUILT_IN_VIEWS.map((v) =>
      v.id === 'everything' ? { ...v, groupBy: 'status' as const, sortBy: 'name' as const } : v
    )
    saveViews(regrouped)
    expect(loadViews().find((v) => v.id === 'everything')).toMatchObject({
      groupBy: 'status',
      sortBy: 'name',
      builtIn: true,
    })
  })

  it("persists a built-in's hide-stale choice", () => {
    const hidden = BUILT_IN_VIEWS.map((v) =>
      v.id === 'everything' ? { ...v, filters: { hideStale: true } } : v
    )
    saveViews(hidden)
    expect(loadViews().find((v) => v.id === 'everything')!.filters).toEqual({ hideStale: true })
  })

  it('an override can never rename or re-id a built-in', () => {
    localStorage.setItem(
      VIEWS_STORAGE_KEY,
      JSON.stringify({ custom: [], overrides: { everything: { id: 'hijacked', name: 'Nope' } } })
    )
    const everything = loadViews().find((v) => v.id === 'everything')!
    expect(everything.name).toBe('Nope')
    expect(everything.id).toBe('everything')
  })

  it('reads the legacy bare-array shape written before overrides existed', () => {
    localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify([custom]))
    expect(loadViews().map((v) => v.id)).toEqual([
      'everything',
      'needs-me',
      'active',
      'stale',
      'mine',
    ])
  })

  it('round-trips a custom view unchanged', () => {
    saveViews([...BUILT_IN_VIEWS, custom])
    expect(loadViews().find((v) => v.id === 'mine')).toEqual(custom)
  })

  it('writes an empty custom list when every view is a built-in', () => {
    saveViews(BUILT_IN_VIEWS)
    expect(JSON.parse(localStorage.getItem(VIEWS_STORAGE_KEY)!).custom).toEqual([])
  })

  it('swallows a storage write failure instead of breaking the sidebar', () => {
    vi.spyOn(localStorageStub, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveViews([...BUILT_IN_VIEWS, custom])).not.toThrow()
  })
})
