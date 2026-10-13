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
import type { SessionView } from '../../../../src/renderer/sidebar/view-model'
import { buildBranchRows } from '../../../../src/renderer/sidebar/branch-rows'
import type {
  AgentState,
  Project,
  TerminalSession,
  Workspace,
} from '../../../../src/shared/types/index'
import { terminalSessionOf } from '../../../support/renderer-stores'

const custom: SessionView = {
  id: 'mine',
  name: 'Mine',
  groupBy: 'none',
  sortBy: 'recent',
  filters: { hideStale: true },
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  localStorage.clear()
})

const NOW = 10_000_000

const STALE_AFTER = 60_000

const repo: Workspace = {
  id: 'w1',
  name: 'repo',
  folderPath: '/repo',
  color: '#111',
  tags: [],
  createdAt: '',
  updatedAt: '',
}

const branch = (id: string): Project => ({
  id,
  workspaceId: 'w1',
  name: id,
  gitBranch: id,
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
})

const terminal = (projectId: string, agentState: AgentState, lastActivityAt = NOW) =>
  terminalSessionOf({ id: `s-${projectId}`, projectId, agentState, lastActivityAt })

const sessions: TerminalSession[] = [
  terminal('working', 'working'),
  terminal('waiting', 'awaiting-input'),
  terminal('idle', 'idle'),
  terminal('quiet', 'idle', NOW - STALE_AFTER - 1),
]

const projects = ['working', 'waiting', 'idle', 'quiet'].map(branch)

const shownBy = (id: string): string[] => {
  const view = BUILT_IN_VIEWS.find((v) => v.id === id)!
  const { groups } = buildBranchRows(sessions, projects, [repo], view, NOW, STALE_AFTER)
  return groups.flatMap((g) => g.branches.map((b) => b.projectId)).sort()
}

describe('built-in views', () => {
  it.each([
    ['everything', ['idle', 'quiet', 'waiting', 'working']],
    ['needs-me', ['waiting']],
    ['active', ['working']],
    ['stale', ['quiet']],
  ])('the %s view shows %j', (id, expected) => {
    expect(shownBy(id)).toEqual(expected)
  })

  it('opens on the Everything view', () => {
    expect(BUILT_IN_VIEWS.find((v) => v.id === DEFAULT_VIEW_ID)!.name).toBe('Everything')
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
})

describe('loadViews — drops stored entries that are not shaped like a view', () => {
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
      v.id === 'everything' ? { ...v, groupBy: 'none' as const, sortBy: 'name' as const } : v
    )
    saveViews(regrouped)
    expect(loadViews().find((v) => v.id === 'everything')).toMatchObject({
      groupBy: 'none',
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
})

describe('saveViews — an override can never rename or re-id a built-in', () => {
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
})

describe('saveViews — swallows a storage write failure instead of breaking the sidebar', () => {
  it('swallows a storage write failure instead of breaking the sidebar', () => {
    vi.spyOn(localStorageStub, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveViews([...BUILT_IN_VIEWS, custom])).not.toThrow()
  })
})

/** The hooks every "a preference naming a retired option (VW-1)" describe registers. */
function setUpAPreferenceNamingA(): void {
  // The grouping options narrowed when the list became one of branches. A
  // preference written before that names a key which no longer exists, and it
  // must degrade to the built-in's own default rather than empty the sidebar —
  // the same treatment loadViews already gives corrupt storage.
  beforeEach(() => localStorage.clear())
}

describe('a preference naming a retired option (VW-1)', () => {
  setUpAPreferenceNamingA()

  it.each(['status', 'project', 'branch'])(
    'falls back to the built-in default when the stored grouping is %s',
    (retired) => {
      localStorage.setItem(
        VIEWS_STORAGE_KEY,
        JSON.stringify({ custom: [], overrides: { everything: { groupBy: retired } } })
      )
      const everything = loadViews().find((v) => v.id === 'everything')!
      expect(everything.groupBy).toBe('workspace')
    }
  )

  it('keeps the rest of a preference that also names a retired grouping', () => {
    localStorage.setItem(
      VIEWS_STORAGE_KEY,
      JSON.stringify({
        custom: [],
        overrides: { everything: { groupBy: 'status', sortBy: 'name' } },
      })
    )
    const everything = loadViews().find((v) => v.id === 'everything')!
    expect(everything.groupBy).toBe('workspace')
    expect(everything.sortBy).toBe('name')
  })
})

describe('a preference naming a retired option (VW-1) — falls back when the stored sort is one that no longer exists', () => {
  setUpAPreferenceNamingA()

  it('falls back when the stored sort is one that no longer exists', () => {
    localStorage.setItem(
      VIEWS_STORAGE_KEY,
      JSON.stringify({ custom: [], overrides: { everything: { sortBy: 'nonsense' } } })
    )
    expect(loadViews().find((v) => v.id === 'everything')!.sortBy).toBe('manual')
  })

  it('leaves a valid preference alone', () => {
    localStorage.setItem(
      VIEWS_STORAGE_KEY,
      JSON.stringify({ custom: [], overrides: { everything: { groupBy: 'none' } } })
    )
    expect(loadViews().find((v) => v.id === 'everything')!.groupBy).toBe('none')
  })
})
