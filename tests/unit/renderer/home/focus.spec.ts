// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  carriedOver,
  focusDone,
  localDateKey,
  type FocusItem,
} from '../../../../src/renderer/home/focus'
import { buildWorkThreads } from '../../../../src/renderer/home/work-threads'
import { facet } from './fixtures'

const NOW = Date.parse('2026-10-18T12:00:00.000Z')
const focusItem = (patch: Partial<FocusItem> = {}): FocusItem => ({
  id: 'f1',
  title: 'Ship limits',
  doneByHand: false,
  ...patch,
})
const shipped = facet({ stage: 'shipped', closedAt: 'x', updatedAt: '2026-10-18T10:00:00.000Z' })

function threadsOf(facets: ReturnType<typeof facet>[]) {
  return buildWorkThreads({
    facts: [],
    facets,
    issues: [],
    changeStats: new Map(),
    repoRoots: new Map(),
    now: NOW,
  })
}

describe('focusDone', () => {
  it('is done by hand', () => {
    expect(focusDone(focusItem({ doneByHand: true }), [], [])).toBe(true)
  })
  it('is done when its candidate says so', () => {
    expect(focusDone(focusItem(), [], [{ id: 'f1', title: 't', workKey: null, done: true }])).toBe(
      true
    )
    expect(focusDone(focusItem(), [], [{ id: 'f1', title: 't', workKey: null, done: false }])).toBe(
      false
    )
  })
  it('is done when the thread it points at has shipped', () => {
    const key = { repoRoot: '/repos/terminator', branch: 'tav-31' }
    const open = threadsOf([facet({ stage: 'shipped' })])
    expect(focusDone(focusItem({ workKey: key }), open, [])).toBe(true)
    expect(focusDone(focusItem({ workKey: { ...key, branch: 'other' } }), open, [])).toBe(false)
    expect(shipped.closedAt).not.toBeNull()
  })
  it('is not done with no evidence', () => {
    expect(focusDone(focusItem(), threadsOf([facet()]), [])).toBe(false)
  })
})

describe('carriedOver', () => {
  it('returns only what yesterday left undone', () => {
    const left = focusItem({ id: 'a' })
    expect(carriedOver([left, focusItem({ id: 'b', doneByHand: true })])).toEqual([left])
  })
})

describe('localDateKey', () => {
  it('pads month and day', () => {
    expect(localDateKey(new Date(2026, 0, 5, 12).getTime())).toBe('2026-01-05')
  })
})

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 18, 12))
})
const load = async () => (await import('../../../../src/renderer/home/focus-store')).useFocusStore
const today = '2026-10-18'

describe('focus store', () => {
  it('picks up to three, ignores a duplicate and a fourth, and persists', async () => {
    const store = await load()
    for (const id of ['a', 'b', 'c', 'd', 'a']) store.getState().pickFocus({ id, title: id })
    expect(store.getState().days[today].map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(
      (
        await (async () => {
          vi.resetModules()
          return load()
        })()
      ).getState().days[today]
    ).toHaveLength(3)
  })

  it('removes, toggles done by hand, and remembers when you left Home', async () => {
    const store = await load()
    store.getState().pickFocus({ id: 'a', title: 'a' })
    store.getState().pickFocus({ id: 'b', title: 'b' })
    store.getState().removeFocus('a')
    store.getState().toggleDone('b')
    expect(store.getState().days[today]).toEqual([{ id: 'b', title: 'b', doneByHand: true }])
    store.getState().toggleDone('b')
    expect(store.getState().days[today][0].doneByHand).toBe(false)
    store.getState().markLeftHome(123)
    expect(store.getState().lastLeftHomeAt).toBe(123)
  })
})

describe('focus store: storage', () => {
  it('keeps only the newest seven days', async () => {
    const days = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [`2026-10-0${d}`, []]))
    localStorage.setItem('terminator.home.focus', JSON.stringify({ days, lastLeftHomeAt: null }))
    const store = await load()
    store.getState().pickFocus({ id: 'a', title: 'a' })
    expect(Object.keys(store.getState().days)).toHaveLength(7)
    expect(store.getState().days['2026-10-01']).toBeUndefined()
  })

  it('survives storage that throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    const store = await load()
    expect(() => store.getState().pickFocus({ id: 'a', title: 'a' })).not.toThrow()
    expect(store.getState().days[today]).toHaveLength(1)
  })
})
