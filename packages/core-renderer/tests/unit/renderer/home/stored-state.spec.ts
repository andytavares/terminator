// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FOCUS_KEY } from '../../../../src/home/focus-store'
import { PARKED_THREADS_KEY } from '../../../../src/components/home/parked-threads'

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

async function loadFocusStore() {
  return (await import('../../../../src/home/focus-store')).useFocusStore
}

async function loadParkedThreads() {
  return (await import('../../../../src/components/home/parked-threads')).useParkedThreads
}

describe('the focus store reading what was stored', () => {
  it.each([
    ['days of the wrong shape', '{"days":{"2026-10-17":"x"},"planDismissedOn":null}'],
    ['text that is not JSON', 'not json'],
  ])('starts empty when storage holds %s', async (_label, stored) => {
    localStorage.setItem(FOCUS_KEY, stored)
    const state = (await loadFocusStore()).getState()
    expect(state.days).toEqual({})
    expect(state.planDismissedOn).toBeNull()
    expect(state.planCollapsed).toBe(false)
  })
})

describe('parked threads', () => {
  it('still reads the keys-only list the first version stored', async () => {
    localStorage.setItem(PARKED_THREADS_KEY, '["linear:TAV-20"]')
    expect((await loadParkedThreads()).getState().keys).toEqual(['linear:TAV-20'])
  })

  it('forgets a key parked over 30 days ago whose thread is gone, and keeps the rest', async () => {
    const now = Date.now()
    localStorage.setItem(
      PARKED_THREADS_KEY,
      JSON.stringify({ old: now - 31 * DAY, oldButLive: now - 31 * DAY, recent: now - 2 * DAY })
    )
    const store = await loadParkedThreads()
    store.getState().forgetGone(new Set(['oldButLive']), now)
    expect(store.getState().keys).toEqual(['oldButLive', 'recent'])
    expect(JSON.parse(localStorage.getItem(PARKED_THREADS_KEY) as string)).toEqual({
      oldButLive: now - 31 * DAY,
      recent: now - 2 * DAY,
    })
  })
})
