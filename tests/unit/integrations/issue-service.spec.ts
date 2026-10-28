import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createIssueService } from '../../../src/main/integrations/issue-service'
import { TrackerError } from '../../../src/main/integrations/tracker-error'
import type { TrackerProvider } from '../../../src/main/integrations/providers/provider'
import type { Issue, IssueSummary, TrackerId } from '../../../src/shared/types/index'

function summary(tracker: TrackerId, key: string): IssueSummary {
  return {
    tracker,
    id: `id-${key}`,
    key,
    title: `Title ${key}`,
    url: `https://example/${key}`,
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    branchName: null,
  }
}

function issue(tracker: TrackerId, key: string): Issue {
  return {
    ...summary(tracker, key),
    description: 'body',
    labels: [],
    branchName: null,
    completed: false,
    updatedAt: '2026-08-22T00:00:00.000Z',
    comments: [],
  }
}

function fakeProvider(id: TrackerId, over: Partial<TrackerProvider> = {}): TrackerProvider {
  return {
    id,
    verify: vi.fn().mockResolvedValue({ name: 'A', email: 'a@b.c' }),
    listMine: vi.fn().mockResolvedValue([summary(id, `${id.toUpperCase()}-1`)]),
    search: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(issue(id, 'TAV-42')),
    comment: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as TrackerProvider
}

interface Harness {
  linear: TrackerProvider
  connected: Set<TrackerId>
  now: { value: number }
}

function build(over: Partial<Harness> = {}) {
  const linear = over.linear ?? fakeProvider('linear')
  const connected = over.connected ?? new Set<TrackerId>(['linear'])
  const now = over.now ?? { value: 1_000_000 }
  const sleep = vi.fn().mockResolvedValue(undefined)

  const service = createIssueService({
    providers: { linear },
    getCredential: async (tracker) =>
      connected.has(tracker) ? { tracker: 'linear', apiKey: 'k' } : null,
    getMine: async () => ({ kind: 'assignee', email: null }),
    onTrackerError: () => {},
    now: () => now.value,
    ttlMs: 5 * 60 * 1000,
    sleep,
  })
  return { service, linear, connected, now, sleep }
}

beforeEach(() => vi.clearAllMocks())

describe('issue-service — cache', () => {
  it('serves a repeat get from cache without touching the provider', async () => {
    const { service, linear } = build()
    await service.get('linear', 'TAV-42')
    await service.get('linear', 'TAV-42')
    expect(linear.get).toHaveBeenCalledTimes(1)
  })

  it('refetches once the TTL has passed', async () => {
    const { service, linear, now } = build()
    await service.get('linear', 'TAV-42')
    now.value += 5 * 60 * 1000 + 1
    await service.get('linear', 'TAV-42')
    expect(linear.get).toHaveBeenCalledTimes(2)
  })

  it('bypasses the cache when refresh is asked for', async () => {
    const { service, linear } = build()
    await service.get('linear', 'TAV-42')
    await service.get('linear', 'TAV-42', { refresh: true })
    expect(linear.get).toHaveBeenCalledTimes(2)
  })
})

describe('issue-service — invalidation on comment', () => {
  it('drops the cached copy when the issue is commented on', async () => {
    const { service, linear } = build()
    await service.get('linear', 'TAV-42')
    await service.comment('linear', 'TAV-42', 'hi')
    await service.get('linear', 'TAV-42')
    expect(linear.get).toHaveBeenCalledTimes(2)
  })
})
describe('issue-service — single flight (SC-008)', () => {
  it('collapses concurrent gets for the same issue into one request', async () => {
    let resolve: ((value: Issue) => void) | undefined
    const linear = fakeProvider('linear', {
      get: vi.fn().mockReturnValue(
        new Promise<Issue>((r) => {
          resolve = r
        })
      ),
    })
    const { service } = build({ linear })

    const all = Promise.all([
      service.get('linear', 'TAV-42'),
      service.get('linear', 'TAV-42'),
      service.get('linear', 'TAV-42'),
      service.get('linear', 'TAV-42'),
      service.get('linear', 'TAV-42'),
    ])
    resolve?.(issue('linear', 'TAV-42'))
    const results = await all

    expect(linear.get).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r?.key === 'TAV-42')).toBe(true)
  })
})

describe('issue-service — single flight after a failure', () => {
  it('does not leave a failed request cached as in-flight', async () => {
    const linear = fakeProvider('linear', {
      get: vi
        .fn()
        .mockRejectedValueOnce(new TrackerError('unavailable', 'offline'))
        .mockResolvedValue(issue('linear', 'TAV-42')),
    })
    const { service } = build({ linear })

    await expect(service.get('linear', 'TAV-42')).rejects.toBeInstanceOf(TrackerError)
    await expect(service.get('linear', 'TAV-42')).resolves.toMatchObject({ key: 'TAV-42' })
    expect(linear.get).toHaveBeenCalledTimes(2)
  })
})

describe('issue-service — listMine', () => {
  it('lists the issues of every connected tracker', async () => {
    const { service } = build()
    const result = await service.listMine()
    expect(result.issues.map((i) => i.tracker)).toEqual(['linear'])
    expect(result.failures).toEqual([])
  })

  it('reports a failing tracker without failing the call', async () => {
    const linear = fakeProvider('linear', {
      listMine: vi.fn().mockRejectedValue(new TrackerError('auth-failed', 'revoked')),
    })
    const { service } = build({ linear })
    const result = await service.listMine()

    expect(result.issues).toEqual([])
    expect(result.failures).toEqual([{ tracker: 'linear', error: 'auth-failed' }])
  })
})

describe('issue-service — listMine when no tracker is connected', () => {
  it('reports not-connected when nothing is connected — not an empty result (FR-032)', async () => {
    const { service, linear } = build({ connected: new Set<TrackerId>() })
    const result = await service.listMine()
    expect(linear.listMine).not.toHaveBeenCalled()
    expect(result.issues).toEqual([])
    expect(result.failures).toEqual([{ tracker: 'linear', error: 'not-connected' }])
  })
})
describe('issue-service — listMine limit', () => {
  it('asks for every open issue (the 250 cap) when no limit is passed', async () => {
    const { service, linear } = build()
    await service.listMine({ tracker: 'linear' })
    expect(linear.listMine).toHaveBeenCalledWith(expect.anything(), expect.anything(), 250)
  })

  it('passes a caller limit through', async () => {
    const { service, linear } = build()
    await service.listMine({ tracker: 'linear', limit: 10 })
    expect(linear.listMine).toHaveBeenCalledWith(expect.anything(), expect.anything(), 10)
  })
})

describe('issue-service — search', () => {
  it('resolves an exact key directly and sorts it first', async () => {
    const linear = fakeProvider('linear', {
      search: vi.fn().mockResolvedValue([summary('linear', 'TAV-9')]),
      get: vi.fn().mockResolvedValue(issue('linear', 'TAV-42')),
    })
    const { service } = build({ linear })
    const result = await service.search('TAV-42')
    expect(result.issues[0].key).toBe('TAV-42')
  })

  it('does not duplicate the exact match when search also returns it', async () => {
    const linear = fakeProvider('linear', {
      search: vi.fn().mockResolvedValue([summary('linear', 'TAV-42')]),
      get: vi.fn().mockResolvedValue(issue('linear', 'TAV-42')),
    })
    const { service } = build({ linear, connected: new Set<TrackerId>(['linear']) })
    const result = await service.search('TAV-42')
    expect(result.issues.filter((i) => i.tracker === 'linear' && i.key === 'TAV-42')).toHaveLength(
      1
    )
  })
})

describe('issue-service — search by text', () => {
  it('falls back to text search when the term is not a key', async () => {
    const { service, linear } = build()
    await service.search('sidebar')
    expect(linear.search).toHaveBeenCalledWith(expect.anything(), 'sidebar', expect.any(Number))
    expect(linear.get).not.toHaveBeenCalled()
  })
})

describe('issue-service — search edge cases', () => {
  it('returns the text results unchanged when no tracker has the exact key', async () => {
    const { service } = build({
      linear: fakeProvider('linear', {
        get: vi.fn().mockResolvedValue(null),
        search: vi.fn().mockResolvedValue([summary('linear', 'TAV-9')]),
      }),
    })
    const result = await service.search('TAV-42')
    expect(result.issues.map((i) => i.key)).toEqual(['TAV-9'])
  })
})

describe('issue-service — waiting without an injected sleep', () => {
  afterEach(() => vi.useRealTimers())

  it('waits the stated period on a real timer before retrying', async () => {
    vi.useFakeTimers()
    const get = vi
      .fn()
      .mockRejectedValueOnce(new TrackerError('rate-limited', 'slow down', { retryAfterMs: 2000 }))
      .mockResolvedValue(issue('linear', 'TAV-42'))
    const service = createIssueService({
      providers: { linear: fakeProvider('linear', { get }) },
      getCredential: async () => ({ tracker: 'linear', apiKey: 'k' }),
      getMine: async () => ({ kind: 'assignee', email: null }),
      onTrackerError: () => {},
    })
    const pending = service.get('linear', 'TAV-42')
    await vi.advanceTimersByTimeAsync(1999)
    expect(get).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toMatchObject({ key: 'TAV-42' })
  })
})

describe('issue-service — rate limits (FR-031)', () => {
  it('waits the period the tracker stated, then retries', async () => {
    const linear = fakeProvider('linear', {
      get: vi
        .fn()
        .mockRejectedValueOnce(
          new TrackerError('rate-limited', 'slow down', { retryAfterMs: 30_000 })
        )
        .mockResolvedValue(issue('linear', 'TAV-42')),
    })
    const { service, sleep } = build({ linear })

    await expect(service.get('linear', 'TAV-42')).resolves.toMatchObject({ key: 'TAV-42' })
    expect(sleep).toHaveBeenCalledWith(30_000)
    expect(linear.get).toHaveBeenCalledTimes(2)
  })

  it('gives up rather than retrying forever', async () => {
    const linear = fakeProvider('linear', {
      get: vi
        .fn()
        .mockRejectedValue(new TrackerError('rate-limited', 'slow down', { retryAfterMs: 1000 })),
    })
    const { service, sleep } = build({ linear })

    await expect(service.get('linear', 'TAV-42')).rejects.toMatchObject({ kind: 'rate-limited' })
    // One wait and one retry, then the limit is reported.
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(linear.get).toHaveBeenCalledTimes(2)
  })
})

describe('issue-service — rate limits that are not retried', () => {
  it('does not retry an auth failure — a bad credential will not fix itself', async () => {
    const linear = fakeProvider('linear', {
      get: vi.fn().mockRejectedValue(new TrackerError('auth-failed', 'revoked')),
    })
    const { service, sleep } = build({ linear })

    await expect(service.get('linear', 'TAV-42')).rejects.toMatchObject({ kind: 'auth-failed' })
    expect(sleep).not.toHaveBeenCalled()
    expect(linear.get).toHaveBeenCalledTimes(1)
  })
})

describe('issue-service — not connected', () => {
  it('raises not-connected rather than calling a provider without a credential', async () => {
    const { service, linear } = build({ connected: new Set<TrackerId>() })
    await expect(service.get('linear', 'TAV-42')).rejects.toMatchObject({ kind: 'not-connected' })
    expect(linear.get).not.toHaveBeenCalled()
  })

  it('raises not-connected for a comment too', async () => {
    const { service } = build({ connected: new Set<TrackerId>() })
    await expect(service.comment('linear', 'TAV-42', 'hi')).rejects.toMatchObject({
      kind: 'not-connected',
    })
  })
})

describe('issue-service — invalidate', () => {
  it('drops every cached copy when no tracker is named', async () => {
    const { service, linear } = build()
    await service.get('linear', 'TAV-42')
    service.invalidate()
    await service.get('linear', 'TAV-42')
    expect(linear.get).toHaveBeenCalledTimes(2)
  })

  it('drops the named tracker', async () => {
    const { service, linear } = build()
    await service.get('linear', 'TAV-42')
    service.invalidate('linear')
    await service.get('linear', 'TAV-42')
    expect(linear.get).toHaveBeenCalledTimes(2)
  })
})
describe('issue-service — error reporting to settings', () => {
  it('reports an auth failure so it can be shown against the connection', async () => {
    const onTrackerError = vi.fn()
    const linear = fakeProvider('linear', {
      get: vi.fn().mockRejectedValue(new TrackerError('auth-failed', 'revoked')),
    })
    const service = createIssueService({
      providers: { linear },
      getCredential: async () => ({ tracker: 'linear', apiKey: 'k' }),
      getMine: async () => ({ kind: 'assignee', email: null }),
      onTrackerError,
    })

    await expect(service.get('linear', 'TAV-42')).rejects.toBeInstanceOf(TrackerError)
    expect(onTrackerError).toHaveBeenCalledWith('linear', 'auth-failed')
  })

  it('clears the reported error once a call succeeds', async () => {
    const onTrackerError = vi.fn()
    const service = createIssueService({
      providers: { linear: fakeProvider('linear') },
      getCredential: async () => ({ tracker: 'linear', apiKey: 'k' }),
      getMine: async () => ({ kind: 'assignee', email: null }),
      onTrackerError,
    })

    await service.get('linear', 'TAV-42')
    expect(onTrackerError).toHaveBeenCalledWith('linear', null)
  })
})

describe('issue-service — errors and default waits', () => {
  it('wraps a non-TrackerError into the taxonomy rather than letting it escape', async () => {
    const linear = fakeProvider('linear', { get: vi.fn().mockRejectedValue('a bare string') })
    const { service } = build({ linear })
    await expect(service.get('linear', 'TAV-42')).rejects.toMatchObject({ kind: 'failed' })
  })

  it('waits a default period when a rate limit states none', async () => {
    const linear = fakeProvider('linear', {
      get: vi
        .fn()
        .mockRejectedValueOnce(new TrackerError('rate-limited', 'slow down'))
        .mockResolvedValue(issue('linear', 'TAV-42')),
    })
    const { service, sleep } = build({ linear })
    await service.get('linear', 'TAV-42')
    expect(sleep).toHaveBeenCalledWith(5000)
  })
})
