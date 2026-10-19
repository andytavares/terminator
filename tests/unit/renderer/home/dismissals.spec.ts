// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

const DAY = 24 * 60 * 60 * 1000
const KEY = 'terminator.home.dismissals'

async function freshStore() {
  vi.resetModules()
  return (await import('../../../../src/renderer/home/dismissals')).useDismissalsStore
}

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('dismissals store', () => {
  it('persists done across a reload', async () => {
    const store = await freshStore()
    store.getState().markDone('core:answer:s1:1')
    const reloaded = await freshStore()
    expect(reloaded.getState().entries['core:answer:s1:1']).toMatchObject({ kind: 'done' })
  })

  it('keeps a snooze with the signature it was made against', async () => {
    const store = await freshStore()
    store.getState().snooze('a', 5000, 'sig')
    expect(store.getState().entries.a).toMatchObject({
      kind: 'snoozed',
      until: 5000,
      signature: 'sig',
    })
  })

  it('counts only items done on the same local day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 17, 12))
    const store = await freshStore()
    store.getState().markDone('yesterday')
    vi.setSystemTime(new Date(2026, 9, 18, 12))
    store.getState().markDone('today-1')
    store.getState().markDone('today-2')
    expect(store.getState().doneToday(Date.now())).toBe(2)
  })
})

describe('dismissals store: storage', () => {
  it('forgets entries after seven days', async () => {
    const old = Date.now() - 8 * DAY
    localStorage.setItem(KEY, JSON.stringify({ stale: { kind: 'done', at: old } }))
    const store = await freshStore()
    expect(store.getState().entries).toEqual({})
  })

  it('does not crash when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full')
    })
    const store = await freshStore()
    expect(() => store.getState().markDone('a')).not.toThrow()
    expect(store.getState().entries.a).toMatchObject({ kind: 'done' })
  })

  it('starts empty when the stored value is corrupt', async () => {
    localStorage.setItem(KEY, '{not json')
    const store = await freshStore()
    expect(store.getState().entries).toEqual({})
  })
})
