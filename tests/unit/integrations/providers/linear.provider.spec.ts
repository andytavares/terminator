import { describe, it, expect, vi } from 'vitest'
import { createLinearProvider } from '../../../../src/main/integrations/providers/linear.provider'
import { TrackerError } from '../../../../src/main/integrations/tracker-error'
import {
  DONE_ISSUE,
  FakeRatelimitedError,
  VIEWER,
  makeIssue,
} from '../../../fixtures/integrations/linear/index'
import type { StoredCredential } from '../../../../src/main/integrations/providers/provider'

const CRED: StoredCredential = { tracker: 'linear', apiKey: 'lin_api_key' }

function providerWith(client: Record<string, unknown>) {
  return createLinearProvider(() => client as never)
}

describe('linear provider — verify', () => {
  it('returns the account the key belongs to', async () => {
    const provider = providerWith({ viewer: Promise.resolve(VIEWER) })
    await expect(provider.verify(CRED)).resolves.toEqual({
      name: 'Andrew',
      email: 'andrew.tavares87@gmail.com',
    })
  })

  it('raises auth-failed when the key is rejected', async () => {
    const provider = providerWith({
      get viewer() {
        return Promise.reject(new Error('Authentication required, but no authentication provided'))
      },
    })
    await expect(provider.verify(CRED)).rejects.toMatchObject({ kind: 'auth-failed' })
  })
})

describe('linear provider — listMine', () => {
  it('filters by assignee email when one is configured', async () => {
    const issues = vi.fn().mockResolvedValue({ nodes: [makeIssue()] })
    const provider = providerWith({ issues })
    const result = await provider.listMine(CRED, { kind: 'assignee', email: 'a@b.c' }, 25)

    expect(issues).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { assignee: { email: { eq: 'a@b.c' } } }, first: 25 })
    )
    expect(result[0]).toMatchObject({ tracker: 'linear', key: 'TAV-42' })
  })

  it("falls back to the viewer's own assigned issues when no email is configured", async () => {
    const assignedIssues = vi.fn().mockResolvedValue({ nodes: [makeIssue()] })
    const provider = providerWith({ viewer: Promise.resolve({ ...VIEWER, assignedIssues }) })
    const result = await provider.listMine(CRED, { kind: 'assignee', email: null }, 10)

    expect(assignedIssues).toHaveBeenCalled()
    expect(result).toHaveLength(1)
  })

  it('normalises state type and carries the tracker label through', async () => {
    const provider = providerWith({ issues: vi.fn().mockResolvedValue({ nodes: [DONE_ISSUE] }) })
    const [issue] = await provider.listMine(CRED, { kind: 'assignee', email: 'a@b.c' }, 10)
    expect(issue.state).toEqual({ name: 'Done', type: 'completed' })
  })

  it("carries Linear's suggested branch name on the summary, for project prefill", async () => {
    const provider = providerWith({ issues: vi.fn().mockResolvedValue({ nodes: [makeIssue()] }) })
    const [issue] = await provider.listMine(CRED, { kind: 'assignee', email: 'a@b.c' }, 10)
    expect(issue.branchName).toBe('andrew/tav-42-unify-linear')
  })

  it('reports a null branch name when the issue has none', async () => {
    const provider = providerWith({
      issues: vi.fn().mockResolvedValue({ nodes: [makeIssue({ branchName: null })] }),
    })
    const [issue] = await provider.listMine(CRED, { kind: 'assignee', email: 'a@b.c' }, 10)
    expect(issue.branchName).toBeNull()
  })

  it('resolves the assignee relation rather than leaving a promise', async () => {
    const provider = providerWith({ issues: vi.fn().mockResolvedValue({ nodes: [makeIssue()] }) })
    const [issue] = await provider.listMine(CRED, { kind: 'assignee', email: 'a@b.c' }, 10)
    expect(issue.assignee).toEqual({ name: 'Andrew', email: 'andrew.tavares87@gmail.com' })
  })

  it('surfaces a rate limit as rate-limited carrying the stated wait', async () => {
    const provider = providerWith({
      issues: vi.fn().mockRejectedValue(new FakeRatelimitedError(45)),
    })
    await expect(
      provider.listMine(CRED, { kind: 'assignee', email: 'a@b.c' }, 10)
    ).rejects.toMatchObject({ kind: 'rate-limited', retryAfterMs: 45_000 })
  })
})

describe('linear provider — search', () => {
  it('uses full-text search and maps to summaries', async () => {
    const searchIssues = vi.fn().mockResolvedValue({ nodes: [makeIssue()] })
    const provider = providerWith({ searchIssues })
    const result = await provider.search(CRED, 'sidebar', 15)

    expect(searchIssues).toHaveBeenCalledWith(
      expect.objectContaining({ term: 'sidebar', first: 15 })
    )
    expect(result[0].key).toBe('TAV-42')
  })
})

describe('linear provider — get', () => {
  it('returns a full issue with markdown description, labels and comments', async () => {
    const provider = providerWith({ issue: vi.fn().mockResolvedValue(makeIssue()) })
    const issue = await provider.get(CRED, 'TAV-42')

    expect(issue).toMatchObject({
      tracker: 'linear',
      id: '11111111-2222-3333-4444-555555555555',
      key: 'TAV-42',
      description: '## Summary\n\nLinear is reached from three places today.',
      labels: ['Improvement'],
      branchName: 'andrew/tav-42-unify-linear',
      completed: false,
    })
    expect(issue?.comments[0]).toMatchObject({ author: 'andrew' })
  })

  it('marks an issue complete from its state type', async () => {
    const provider = providerWith({ issue: vi.fn().mockResolvedValue(DONE_ISSUE) })
    await expect(provider.get(CRED, 'TAV-38')).resolves.toMatchObject({ completed: true })
  })

  it('returns null rather than throwing when the issue is gone', async () => {
    const provider = providerWith({
      issue: vi.fn().mockRejectedValue(new TrackerError('not-found', 'Entity not found')),
    })
    await expect(provider.get(CRED, 'TAV-999')).resolves.toBeNull()
  })

  it('bounds comments to the five most recent', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      body: `c${i}`,
      createdAt: `2026-08-2${i}T00:00:00.000Z`,
      user: Promise.resolve({ name: 'andrew' }),
    }))
    const provider = providerWith({
      issue: vi
        .fn()
        .mockResolvedValue(makeIssue({ comments: () => Promise.resolve({ nodes: many }) })),
    })
    const issue = await provider.get(CRED, 'TAV-42')
    expect(issue?.comments).toHaveLength(5)
  })

  it('never leaves description undefined', async () => {
    const provider = providerWith({
      issue: vi.fn().mockResolvedValue(makeIssue({ description: null })),
    })
    await expect(provider.get(CRED, 'TAV-42')).resolves.toMatchObject({ description: '' })
  })
})

describe('linear provider — comment', () => {
  it('addresses the issue by UUID, never by the human key', async () => {
    const createComment = vi.fn().mockResolvedValue({ success: true })
    const issue = vi.fn().mockResolvedValue(makeIssue())
    const provider = providerWith({ issue, createComment })

    await provider.comment(CRED, 'TAV-42', 'PR opened')

    expect(issue).toHaveBeenCalledWith('TAV-42')
    expect(createComment).toHaveBeenCalledWith({
      issueId: '11111111-2222-3333-4444-555555555555',
      body: 'PR opened',
    })
  })

  it('rejects when the issue cannot be resolved — never silently succeeds', async () => {
    const provider = providerWith({
      issue: vi.fn().mockResolvedValue(null),
      createComment: vi.fn(),
    })
    await expect(provider.comment(CRED, 'TAV-999', 'hi')).rejects.toMatchObject({
      kind: 'not-found',
    })
  })

  it('never passes a human key to the Linear API as an issue id', async () => {
    const createComment = vi.fn().mockResolvedValue({ success: true })
    const provider = providerWith({ issue: vi.fn().mockResolvedValue(makeIssue()), createComment })

    await provider.comment(CRED, 'TAV-42', 'x')

    // One addressing mechanism, everywhere. A key reaching the API here is the
    // ambiguity this design exists to remove.
    const [{ issueId }] = createComment.mock.calls[0]
    expect(issueId).not.toMatch(/^[A-Z]+-\d+$/)
    expect(issueId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects when the tracker refuses the comment', async () => {
    const provider = providerWith({
      issue: vi.fn().mockResolvedValue(makeIssue()),
      createComment: vi.fn().mockResolvedValue({ success: false }),
    })
    await expect(provider.comment(CRED, 'TAV-42', 'hi')).rejects.toBeInstanceOf(TrackerError)
  })
})

describe('linear provider — credential guard', () => {
  it('refuses a credential belonging to another tracker', async () => {
    const provider = providerWith({})
    await expect(
      provider.verify({ tracker: 'jira', site: 's', email: 'e@x.c', apiToken: 't' })
    ).rejects.toBeInstanceOf(TrackerError)
  })
})

describe('linear provider — hostile and incomplete responses', () => {
  it('survives an issue with no labels or comments accessors', async () => {
    const bare = {
      id: 'i1',
      identifier: 'TAV-1',
      title: 'Bare',
      url: 'https://x/TAV-1',
      state: Promise.resolve({ name: 'Todo', type: 'unstarted' }),
      assignee: Promise.resolve(null),
    }
    const provider = providerWith({ issue: vi.fn().mockResolvedValue(bare) })
    await expect(provider.get(CRED, 'TAV-1')).resolves.toMatchObject({
      labels: [],
      comments: [],
      assignee: null,
      branchName: null,
    })
  })

  it('falls back to backlog for a state type Linear adds later', async () => {
    const provider = providerWith({
      issue: vi
        .fn()
        .mockResolvedValue(
          makeIssue({ state: Promise.resolve({ name: 'Triage', type: 'brand-new' }) })
        ),
    })
    await expect(provider.get(CRED, 'TAV-42')).resolves.toMatchObject({
      state: { name: 'Triage', type: 'backlog' },
    })
  })

  it('names an unknown state rather than rendering undefined', async () => {
    const provider = providerWith({
      issue: vi.fn().mockResolvedValue(makeIssue({ state: Promise.resolve(null) as never })),
    })
    await expect(provider.get(CRED, 'TAV-42')).resolves.toMatchObject({
      state: { name: 'Unknown', type: 'backlog' },
    })
  })

  it('handles a comment whose author relation is empty', async () => {
    const provider = providerWith({
      issue: vi.fn().mockResolvedValue(
        makeIssue({
          comments: () =>
            Promise.resolve({
              nodes: [
                {
                  body: 'orphan',
                  createdAt: '2026-01-01T00:00:00.000Z',
                  user: Promise.resolve(null),
                },
              ],
            }),
        })
      ),
    })
    const issue = await provider.get(CRED, 'TAV-42')
    expect(issue?.comments[0]).toMatchObject({ author: 'Unknown', body: 'orphan' })
  })

  it('returns an empty list when a connection has no nodes', async () => {
    const provider = providerWith({ issues: vi.fn().mockResolvedValue(null) })
    await expect(
      provider.listMine(CRED, { kind: 'assignee', email: 'a@b.c' }, 10)
    ).resolves.toEqual([])
  })

  it('returns an empty list when the viewer has no assignedIssues accessor', async () => {
    const provider = providerWith({ viewer: Promise.resolve({ ...VIEWER }) })
    await expect(provider.listMine(CRED, { kind: 'assignee', email: null }, 10)).resolves.toEqual(
      []
    )
  })

  it('returns null from get when the SDK yields nothing', async () => {
    const provider = providerWith({ issue: vi.fn().mockResolvedValue(null) })
    await expect(provider.get(CRED, 'TAV-42')).resolves.toBeNull()
  })
})

describe('linear provider — error mapping', () => {
  it.each([
    ['Authentication required', 'auth-failed'],
    ['Entity not found: Issue', 'not-found'],
    ['fetch failed', 'unavailable'],
    ['Rate limit exceeded', 'rate-limited'],
    ['something else entirely', 'failed'],
  ])('maps %s to %s', async (message, kind) => {
    const provider = providerWith({
      searchIssues: vi.fn().mockRejectedValue(new Error(message)),
    })
    await expect(provider.search(CRED, 'x', 5)).rejects.toMatchObject({ kind })
  })

  it.each([
    ['AuthenticationError', 'auth-failed'],
    ['FeatureNotAccessible', 'not-found'],
    ['NetworkError', 'unavailable'],
  ])('maps an SDK error typed %s to %s', async (type, kind) => {
    const provider = providerWith({
      searchIssues: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { type })),
    })
    await expect(provider.search(CRED, 'x', 5)).rejects.toMatchObject({ kind })
  })

  it('rate-limits without a stated period still map, carrying no wait', async () => {
    const provider = providerWith({
      searchIssues: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('x'), { type: 'Ratelimited' })),
    })
    const error = await provider.search(CRED, 'x', 5).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'rate-limited' })
    // No period stated, so none is invented — the facade uses its own default.
    expect((error as { retryAfterMs?: number }).retryAfterMs).toBeUndefined()
  })

  it('rethrows a get failure that is not not-found', async () => {
    const provider = providerWith({
      issue: vi.fn().mockRejectedValue(new Error('Rate limit exceeded')),
    })
    await expect(provider.get(CRED, 'TAV-42')).rejects.toMatchObject({ kind: 'rate-limited' })
  })
})
