// Linear response fixtures.
//
// The SDK returns relations lazily — `issue.state` and `issue.assignee` are
// promises, `issue.labels()` returns a connection. The fakes below reproduce
// that shape rather than a flattened one, because a provider that forgets to
// await a relation passes against flat fixtures and returns `[object Promise]`
// against the real API.

export interface FakeLinearIssue {
  id: string
  identifier: string
  title: string
  url: string
  description?: string | null
  branchName?: string | null
  completedAt?: string | null
  updatedAt?: string
  state: Promise<{ name: string; type: string }>
  assignee: Promise<{ name: string; email: string } | null>
  labels: () => Promise<{ nodes: { name: string }[] }>
  comments: () => Promise<{ nodes: FakeLinearComment[] }>
}

export interface FakeLinearComment {
  body: string
  createdAt: string
  user: Promise<{ name: string } | null>
}

export const VIEWER = { name: 'Andrew', email: 'andrew.tavares87@gmail.com' }

export function makeComment(over: Partial<FakeLinearComment> = {}): FakeLinearComment {
  return {
    body: 'Fold the credential migration into P0.',
    createdAt: '2026-08-22T10:00:00.000Z',
    user: Promise.resolve({ name: 'andrew' }),
    ...over,
  }
}

export function makeIssue(over: Partial<FakeLinearIssue> = {}): FakeLinearIssue {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    identifier: 'TAV-42',
    title: 'Unify Linear connections behind one core service',
    url: 'https://linear.app/tav/issue/TAV-42',
    description: '## Summary\n\nLinear is reached from three places today.',
    branchName: 'andrew/tav-42-unify-linear',
    completedAt: null,
    updatedAt: '2026-08-22T12:00:00.000Z',
    state: Promise.resolve({ name: 'In Progress', type: 'started' }),
    assignee: Promise.resolve({ name: 'Andrew', email: 'andrew.tavares87@gmail.com' }),
    labels: () => Promise.resolve({ nodes: [{ name: 'Improvement' }] }),
    comments: () => Promise.resolve({ nodes: [makeComment()] }),
    ...over,
  }
}

export const DONE_ISSUE = makeIssue({
  id: '99999999-8888-7777-6666-555555555555',
  identifier: 'TAV-38',
  title: 'Themed form controls everywhere',
  url: 'https://linear.app/tav/issue/TAV-38',
  completedAt: '2026-08-20T09:00:00.000Z',
  state: Promise.resolve({ name: 'Done', type: 'completed' }),
  branchName: null,
})

/** What the SDK raises when the request budget is spent. */
export class FakeRatelimitedError extends Error {
  readonly type = 'Ratelimited'
  constructor(readonly retryAfter: number) {
    super('Rate limited')
    this.name = 'RatelimitedLinearError'
  }
}
