import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createIssueService } from '../../../src/main/integrations/issue-service'
import { createJiraProvider } from '../../../src/main/integrations/providers/jira.provider'
import type {
  TrackerProvider,
  TrackerStateOption,
} from '../../../src/main/integrations/providers/provider'
import type { Issue, TrackerId } from '../../../src/shared/types/index'

// The facade over an optional capability.
//
// The point of `supportsTransitions` is that a caller asks before it needs to
// know. Everything below is about keeping the two answers apart: a tracker
// that will never move an issue is not a tracker that failed to.

const OPTIONS: TrackerStateOption[] = [
  { id: 'st-progress', name: 'In Progress', intent: 'started', available: true },
  { id: 'st-review', name: 'In Review', intent: 'in_review', available: true },
  { id: 'st-done', name: 'Done', intent: 'done', available: true },
]

function issue(tracker: TrackerId, key: string): Issue {
  return {
    tracker,
    id: `id-${key}`,
    key,
    title: `Title ${key}`,
    url: `https://example/${key}`,
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
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
    listMine: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(issue(id, 'TAV-42')),
    comment: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as TrackerProvider
}

function build(over: { linear?: TrackerProvider; jira?: TrackerProvider } = {}) {
  const linear =
    over.linear ??
    fakeProvider('linear', {
      states: vi.fn().mockResolvedValue(OPTIONS),
      transition: vi.fn().mockResolvedValue(undefined),
      teams: vi.fn().mockResolvedValue([{ id: 't1', key: 'TAV', name: 'Team' }]),
      create: vi.fn().mockResolvedValue(issue('linear', 'TAV-7')),
    })
  // Jira omits both, exactly as the shipped provider does.
  const jira = over.jira ?? fakeProvider('jira')
  const service = createIssueService({
    providers: { linear, jira },
    getCredential: async (tracker) =>
      tracker === 'linear'
        ? { tracker: 'linear', apiKey: 'k' }
        : { tracker: 'jira', site: 's', email: 'e@x.c', apiToken: 't' },
    getMine: async () => ({ kind: 'assignee', email: null }),
    now: () => 1_000_000,
  })
  return { service, linear, jira }
}

beforeEach(() => vi.clearAllMocks())

describe('supportsTransitions', () => {
  it('is true for a provider that implements the capability', () => {
    expect(build().service.supportsTransitions('linear')).toBe(true)
  })

  it('is false for one that omits it', () => {
    expect(build().service.supportsTransitions('jira')).toBe(false)
  })

  it('is false for the Jira provider the application actually ships', () => {
    const { service } = build({ jira: createJiraProvider() })
    expect(service.supportsTransitions('jira')).toBe(false)
  })

  it('answers without a credential, because it is a fact about the provider', () => {
    const service = createIssueService({
      providers: { linear: fakeProvider('linear'), jira: fakeProvider('jira') },
      getCredential: async () => null,
      getMine: async () => ({ kind: 'assignee', email: null }),
    })
    expect(service.supportsTransitions('linear')).toBe(false)
  })
})

describe('states', () => {
  it('delegates to the provider with the resolved credential', async () => {
    const { service, linear } = build()
    await expect(service.states('linear', 'TAV-42')).resolves.toEqual(OPTIONS)
    expect(linear.states).toHaveBeenCalledWith({ tracker: 'linear', apiKey: 'k' }, 'TAV-42')
  })

  it('rejects with unsupported — not a generic failure — where the provider omits it', async () => {
    const { service } = build()
    await expect(service.states('jira', 'TAV-42')).rejects.toMatchObject({ kind: 'unsupported' })
  })
})

describe('transition', () => {
  it('delegates the intent and the operator override', async () => {
    const { service, linear } = build()
    await service.transition('linear', 'TAV-42', 'in_review', 'st-progress')
    expect(linear.transition).toHaveBeenCalledWith(
      { tracker: 'linear', apiKey: 'k' },
      'TAV-42',
      'in_review',
      'st-progress'
    )
  })

  it('rejects with unsupported where the provider omits it', async () => {
    const { service } = build()
    await expect(service.transition('jira', 'TAV-42', 'done')).rejects.toMatchObject({
      kind: 'unsupported',
    })
  })

  it('names the tracker in the unsupported message, so the record is readable', async () => {
    const { service } = build()
    await expect(service.transition('jira', 'TAV-42', 'done')).rejects.toThrow(/jira/)
  })

  it('invalidates the cached issue on success, since its state just changed', async () => {
    const { service, linear } = build()
    await service.get('linear', 'TAV-42')
    await service.transition('linear', 'TAV-42', 'done')
    await service.get('linear', 'TAV-42')
    expect(linear.get).toHaveBeenCalledTimes(2)
  })

  it('leaves the cache alone when the move fails', async () => {
    const linear = fakeProvider('linear', {
      states: vi.fn().mockResolvedValue(OPTIONS),
      transition: vi.fn().mockRejectedValue(new Error('nope')),
    })
    const { service } = build({ linear })
    await service.get('linear', 'TAV-42')
    await expect(service.transition('linear', 'TAV-42', 'done')).rejects.toThrow()
    await service.get('linear', 'TAV-42')
    expect(linear.get).toHaveBeenCalledTimes(1)
  })

  it('leaves another issue cached copy alone', async () => {
    const { service, linear } = build()
    await service.get('linear', 'TAV-42')
    await service.transition('linear', 'TAV-7', 'done')
    await service.get('linear', 'TAV-42')
    expect(linear.get).toHaveBeenCalledTimes(1)
  })
})

describe('the Jira provider is untouched by this feature', () => {
  it('omits both optional methods', () => {
    const jira = createJiraProvider() as TrackerProvider
    expect(jira.states).toBeUndefined()
    expect(jira.transition).toBeUndefined()
  })

  it('still exposes the five it always had', () => {
    const jira = createJiraProvider() as unknown as Record<string, unknown>
    for (const method of ['verify', 'listMine', 'search', 'get', 'comment']) {
      expect(typeof jira[method]).toBe('function')
    }
  })
})

describe('create (ADR-061)', () => {
  it('is supported where the provider implements it, and not for Jira', () => {
    const { service } = build()
    expect(service.supportsCreate('linear')).toBe(true)
    expect(service.supportsCreate('jira')).toBe(false)
  })

  it('delegates the input with the resolved credential and returns the issue', async () => {
    const { service, linear } = build()
    const input = { teamId: 't1', title: 'Only open tickets', description: 'body' }
    await expect(service.create('linear', input)).resolves.toMatchObject({ key: 'TAV-7' })
    expect(linear.create).toHaveBeenCalledWith({ tracker: 'linear', apiKey: 'k' }, input)
  })

  it('serves the created issue from cache rather than fetching it again', async () => {
    const { service, linear } = build()
    await service.create('linear', { teamId: 't1', title: 'x', description: '' })
    await service.get('linear', 'TAV-7')
    expect(linear.get).not.toHaveBeenCalled()
  })

  it('lists teams through the provider', async () => {
    const { service } = build()
    await expect(service.teams('linear')).resolves.toEqual([{ id: 't1', key: 'TAV', name: 'Team' }])
  })

  it('rejects with unsupported where the provider omits it', async () => {
    const { service } = build()
    await expect(
      service.create('jira', { teamId: 't', title: 'x', description: '' })
    ).rejects.toMatchObject({ kind: 'unsupported' })
    await expect(service.teams('jira')).rejects.toMatchObject({ kind: 'unsupported' })
  })
})
