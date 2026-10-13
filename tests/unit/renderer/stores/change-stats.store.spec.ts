import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  useChangeStatsStore,
  CHANGE_STATS_TTL_MS,
} from '../../../../src/renderer/stores/change-stats.store'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { electronApiOf } from '../../../support/electron-api'

const changeStats = vi.fn<ElectronAPI['git']['changeStats']>()

beforeEach(() => {
  vi.clearAllMocks()
  changeStats.mockResolvedValue({ added: 10, removed: 2, files: 1 })
  vi.stubGlobal('window', { electronAPI: electronApiOf({ git: { changeStats } }) })
  useChangeStatsStore.setState({ entries: new Map() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const store = () => useChangeStatsStore.getState()
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('change-stats store — lazy, cached, never awaited by render', () => {
  it('returns nothing for a branch that was never requested', () => {
    expect(store().statsFor('b1')).toBeUndefined()
  })

  it('fetches on first ensure and records the result', async () => {
    store().ensure('b1', '/repo', 1000)
    await flush()
    expect(changeStats).toHaveBeenCalledWith('/repo')
    expect(store().statsFor('b1')).toMatchObject({
      state: 'ready',
      stats: { added: 10, removed: 2, files: 1 },
      fetchedAt: 1000,
    })
  })

  it('serves from cache inside the TTL without touching git', async () => {
    store().ensure('b1', '/repo', 1000)
    await flush()
    store().ensure('b1', '/repo', 1000 + CHANGE_STATS_TTL_MS - 1)
    await flush()
    expect(changeStats).toHaveBeenCalledTimes(1)
  })

  it('still serves from cache exactly at the TTL boundary', async () => {
    store().ensure('b1', '/repo', 1000)
    await flush()
    store().ensure('b1', '/repo', 1000 + CHANGE_STATS_TTL_MS)
    await flush()
    expect(changeStats).toHaveBeenCalledTimes(1)
  })
})

describe('change-stats store — lazy, cached, never awaited by render — refetches one millisecond past the TTL', () => {
  it('refetches one millisecond past the TTL', async () => {
    store().ensure('b1', '/repo', 1000)
    await flush()
    store().ensure('b1', '/repo', 1000 + CHANGE_STATS_TTL_MS + 1)
    await flush()
    expect(changeStats).toHaveBeenCalledTimes(2)
  })

  it('collapses concurrent requests for the same branch into one', async () => {
    store().ensure('b1', '/repo', 1000)
    store().ensure('b1', '/repo', 1000)
    store().ensure('b1', '/repo', 1000)
    await flush()
    expect(changeStats).toHaveBeenCalledTimes(1)
  })

  it('keeps branches independent', async () => {
    store().ensure('b1', '/repo-a', 1000)
    store().ensure('b2', '/repo-b', 1000)
    await flush()
    expect(changeStats).toHaveBeenCalledWith('/repo-a')
    expect(changeStats).toHaveBeenCalledWith('/repo-b')
    expect(store().statsFor('b1')?.state).toBe('ready')
    expect(store().statsFor('b2')?.state).toBe('ready')
  })
})

describe('change-stats store — lazy, cached, never awaited by render — records an error envelope as an error with no stats', () => {
  it('records an error envelope as an error with no stats', async () => {
    changeStats.mockResolvedValue({ error: 'not a git repository' })
    store().ensure('b1', '/tmp', 1000)
    await flush()
    expect(store().statsFor('b1')).toMatchObject({ state: 'error', stats: null })
  })

  it('records a rejected call as an error rather than throwing', async () => {
    changeStats.mockRejectedValue(new Error('boom'))
    store().ensure('b1', '/tmp', 1000)
    await flush()
    expect(store().statsFor('b1')).toMatchObject({ state: 'error', stats: null })
  })

  it('throttles retries after a failure, so a broken repo is not hammered', async () => {
    changeStats.mockResolvedValue({ error: 'nope' })
    store().ensure('b1', '/tmp', 1000)
    await flush()
    store().ensure('b1', '/tmp', 1000 + CHANGE_STATS_TTL_MS - 1)
    await flush()
    expect(changeStats).toHaveBeenCalledTimes(1)
  })
})

describe('change-stats store — lazy, cached, never awaited by render — refetches after invalidate, even inside the TTL', () => {
  it('refetches after invalidate, even inside the TTL', async () => {
    store().ensure('b1', '/repo', 1000)
    await flush()
    store().invalidate('b1')
    store().ensure('b1', '/repo', 1001)
    await flush()
    expect(changeStats).toHaveBeenCalledTimes(2)
  })

  it('drops only the branch it is asked to invalidate', async () => {
    store().ensure('b1', '/a', 1000)
    store().ensure('b2', '/b', 1000)
    await flush()
    store().invalidate('b1')
    expect(store().statsFor('b1')).toBeUndefined()
    expect(store().statsFor('b2')?.state).toBe('ready')
  })

  it('invalidates everything at once when the window regains focus', async () => {
    store().ensure('b1', '/a', 1000)
    store().ensure('b2', '/b', 1000)
    await flush()
    store().invalidateAll()
    expect(store().statsFor('b1')).toBeUndefined()
    expect(store().statsFor('b2')).toBeUndefined()
  })
})

describe('change-stats store — lazy, cached, never awaited by render — records unavailable rather than throwing when the git API is absent', () => {
  it('records unavailable rather than throwing when the git API is absent', async () => {
    vi.stubGlobal('window', {})
    store().ensure('b1', '/repo', 1000)
    await flush()
    expect(store().statsFor('b1')).toMatchObject({ state: 'error', stats: null })
  })
})
