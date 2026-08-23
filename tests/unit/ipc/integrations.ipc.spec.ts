import { describe, it, expect, beforeEach, vi } from 'vitest'

// The channel registrar is the seam: registering captures handlers here, and a
// test invokes them exactly as the renderer would.
const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
const sent: Array<{ channel: string; data: unknown }> = []

vi.mock('../../../src/main/safe-send', () => ({
  sendToWindow: (_win: unknown, channel: string, data: unknown) => {
    sent.push({ channel, data })
  },
  sendToView: () => {},
}))

vi.mock('../../../src/main/ipc/channel-registrar', () => ({
  handleChannel: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
    handlers.set(channel, handler as never)
  },
  removeChannel: () => {},
}))

const store = vi.hoisted(() => ({
  connections: [] as unknown[],
  setCredential: vi.fn().mockResolvedValue(undefined),
  clearCredential: vi.fn().mockResolvedValue(undefined),
  setAccount: vi.fn().mockResolvedValue(undefined),
  setMine: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../src/main/integrations/tracker-store', () => ({
  listConnections: async () => store.connections,
  setCredential: store.setCredential,
  clearCredential: store.clearCredential,
  setAccount: store.setAccount,
  setMine: store.setMine,
  getCredential: async () => null,
  getMine: async () => ({ kind: 'assignee', email: null }),
}))

const verify = vi.hoisted(() => ({ linear: vi.fn(), jira: vi.fn() }))

vi.mock('../../../src/main/integrations/providers/linear.provider', () => ({
  createLinearProvider: () => ({ id: 'linear', verify: verify.linear }),
}))
vi.mock('../../../src/main/integrations/providers/jira.provider', () => ({
  createJiraProvider: () => ({ id: 'jira', verify: verify.jira }),
}))

const linkStore = vi.hoisted(() => ({
  links: new Map<string, unknown>(),
  setLink: vi.fn(),
  getLink: vi.fn(),
  clearLink: vi.fn(),
  setInjectContext: vi.fn(),
}))

vi.mock('../../../src/main/integrations/issue-link-store', () => ({
  setLink: linkStore.setLink,
  getLink: linkStore.getLink,
  clearLink: linkStore.clearLink,
  setInjectContext: linkStore.setInjectContext,
}))

const service = vi.hoisted(() => ({
  listMine: vi.fn(),
  search: vi.fn(),
  get: vi.fn(),
  comment: vi.fn(),
}))

vi.mock('../../../src/main/integrations/index', () => ({
  getIssueService: () => service,
  resetIssueService: vi.fn(),
}))

// Context sync reaches the filesystem and Electron's app paths; those have
// their own tests. Here the question is only whether the handlers call it, and
// what they do when it fails.
const contextSync = vi.hoisted(() => ({
  syncProjectContext: vi.fn().mockResolvedValue(null),
  clearProjectContext: vi.fn().mockResolvedValue(undefined),
  previewProjectContext: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../../src/main/integrations/context-sync', () => contextSync)

async function register() {
  handlers.clear()
  sent.length = 0
  contextSync.syncProjectContext.mockResolvedValue(null)
  contextSync.clearProjectContext.mockResolvedValue(undefined)
  contextSync.previewProjectContext.mockResolvedValue(null)
  linkStore.setInjectContext.mockResolvedValue(undefined)
  const mod = await import('../../../src/main/ipc/integrations.ipc')
  mod.registerIntegrationsHandlers(() => ({}) as never)
}

async function invoke(channel: string, payload: unknown): Promise<unknown> {
  const handler = handlers.get(channel)
  if (handler === undefined) throw new Error(`no handler for ${channel}`)
  return handler({}, payload)
}

const LINEAR_CONNECTED = {
  tracker: 'linear',
  connected: true,
  account: { name: 'Andrew', email: 'a@b.c' },
  site: null,
  mine: { kind: 'assignee', email: null },
  lastError: null,
}
const JIRA_DISCONNECTED = {
  tracker: 'jira',
  connected: false,
  account: null,
  site: null,
  mine: { kind: 'query', jql: 'x' },
  lastError: null,
}

beforeEach(async () => {
  vi.clearAllMocks()
  store.connections = [LINEAR_CONNECTED, JIRA_DISCONNECTED]
  verify.linear.mockResolvedValue({ name: 'Andrew', email: 'a@b.c' })
  verify.jira.mockResolvedValue({ name: 'Andrew', email: 'a@b.c', site: 's.atlassian.net' })
  await register()
})

describe('integrations:status', () => {
  it('returns every tracker and never a secret', async () => {
    const result = (await invoke('integrations:status', {})) as { connections: unknown[] }
    expect(result.connections).toHaveLength(2)
    expect(JSON.stringify(result)).not.toMatch(/apiKey|apiToken|secret/)
  })

  it('can be narrowed to one tracker', async () => {
    const result = (await invoke('integrations:status', { tracker: 'jira' })) as {
      connections: { tracker: string }[]
    }
    expect(result.connections.map((c) => c.tracker)).toEqual(['jira'])
  })

  it('rejects an unknown tracker rather than guessing', async () => {
    await expect(invoke('integrations:status', { tracker: 'asana' })).resolves.toMatchObject({
      error: 'failed',
    })
  })
})

describe('integrations:connect', () => {
  it('verifies before storing', async () => {
    await invoke('integrations:connect', { tracker: 'linear', apiKey: 'lin_key' })

    expect(verify.linear).toHaveBeenCalled()
    const verifyOrder = verify.linear.mock.invocationCallOrder[0]
    const storeOrder = store.setCredential.mock.invocationCallOrder[0]
    expect(verifyOrder).toBeLessThan(storeOrder)
  })

  it('stores nothing when the credential is rejected', async () => {
    verify.linear.mockRejectedValue(
      Object.assign(new Error('Authentication required'), { kind: 'auth-failed' })
    )
    const result = await invoke('integrations:connect', { tracker: 'linear', apiKey: 'bad' })

    expect(result).toMatchObject({ error: expect.any(String) })
    expect(store.setCredential).not.toHaveBeenCalled()
    expect(store.setAccount).not.toHaveBeenCalled()
  })

  it('records the account the credential proved to belong to', async () => {
    await invoke('integrations:connect', { tracker: 'linear', apiKey: 'k' })
    expect(store.setAccount).toHaveBeenCalledWith('linear', { name: 'Andrew', email: 'a@b.c' })
  })

  it('stores the Jira query as its mine selector', async () => {
    await invoke('integrations:connect', {
      tracker: 'jira',
      site: 's.atlassian.net',
      email: 'a@b.c',
      apiToken: 't',
      jql: 'assignee = currentUser()',
    })
    expect(store.setMine).toHaveBeenCalledWith('jira', {
      kind: 'query',
      jql: 'assignee = currentUser()',
    })
  })

  it('refuses a Jira payload missing its site — a credential that cannot work', async () => {
    const result = await invoke('integrations:connect', {
      tracker: 'jira',
      email: 'a@b.c',
      apiToken: 't',
      jql: 'x',
    })
    expect(result).toMatchObject({ error: 'failed' })
    expect(store.setCredential).not.toHaveBeenCalled()
  })

  it('never echoes the credential back', async () => {
    const result = await invoke('integrations:connect', {
      tracker: 'linear',
      apiKey: 'super-secret',
    })
    expect(JSON.stringify(result)).not.toContain('super-secret')
  })
})

describe('integrations:disconnect', () => {
  it('destroys that tracker only', async () => {
    await invoke('integrations:disconnect', { tracker: 'linear' })
    expect(store.clearCredential).toHaveBeenCalledWith('linear')
    expect(store.clearCredential).toHaveBeenCalledTimes(1)
  })
})

describe('integrations:issue-list-mine', () => {
  it('passes results and failures through unchanged', async () => {
    service.listMine.mockResolvedValue({
      issues: [{ tracker: 'linear', key: 'TAV-42' }],
      failures: [{ tracker: 'jira', error: 'not-connected' }],
    })
    await expect(invoke('integrations:issue-list-mine', {})).resolves.toMatchObject({
      issues: [{ key: 'TAV-42' }],
      failures: [{ tracker: 'jira', error: 'not-connected' }],
    })
  })

  it('returns a typed error envelope rather than throwing', async () => {
    service.listMine.mockRejectedValue(new Error('boom'))
    await expect(invoke('integrations:issue-list-mine', {})).resolves.toMatchObject({
      error: 'failed',
      message: 'boom',
    })
  })
})

describe('integrations:issue-search', () => {
  it('requires a term', async () => {
    await expect(invoke('integrations:issue-search', { term: '' })).resolves.toMatchObject({
      error: 'failed',
    })
    expect(service.search).not.toHaveBeenCalled()
  })

  it('forwards the term and limit', async () => {
    service.search.mockResolvedValue({ issues: [], failures: [] })
    await invoke('integrations:issue-search', { term: 'sidebar', limit: 10 })
    expect(service.search).toHaveBeenCalledWith('sidebar', { tracker: undefined, limit: 10 })
  })
})

describe('integrations:issue-get', () => {
  it('returns the issue', async () => {
    service.get.mockResolvedValue({ tracker: 'linear', key: 'TAV-42' })
    await expect(
      invoke('integrations:issue-get', { tracker: 'linear', key: 'TAV-42' })
    ).resolves.toMatchObject({ issue: { key: 'TAV-42' } })
  })

  it('passes refresh through so the cache can be bypassed', async () => {
    service.get.mockResolvedValue(null)
    await invoke('integrations:issue-get', { tracker: 'linear', key: 'TAV-42', refresh: true })
    expect(service.get).toHaveBeenCalledWith('linear', 'TAV-42', { refresh: true })
  })

  it('surfaces the error kind rather than throwing', async () => {
    service.get.mockRejectedValue(
      Object.assign(new Error('offline'), { code: 'ENOTFOUND', name: 'TypeError' })
    )
    await expect(
      invoke('integrations:issue-get', { tracker: 'linear', key: 'TAV-42' })
    ).resolves.toMatchObject({ error: 'unavailable' })
  })
})

describe('integrations:issue-comment', () => {
  it('posts the comment', async () => {
    service.comment.mockResolvedValue(undefined)
    await expect(
      invoke('integrations:issue-comment', { tracker: 'linear', key: 'TAV-42', body: 'hi' })
    ).resolves.toEqual({ ok: true })
  })

  it('returns the failure instead of swallowing it (FR-034a)', async () => {
    service.comment.mockRejectedValue(new Error('no permission'))
    await expect(
      invoke('integrations:issue-comment', { tracker: 'linear', key: 'TAV-42', body: 'hi' })
    ).resolves.toMatchObject({ error: 'failed', message: 'no permission' })
  })

  it('refuses an empty body', async () => {
    await expect(
      invoke('integrations:issue-comment', { tracker: 'linear', key: 'TAV-42', body: '' })
    ).resolves.toMatchObject({ error: 'failed' })
    expect(service.comment).not.toHaveBeenCalled()
  })
})

describe('integrations:set-mine', () => {
  it('stores the selector', async () => {
    await invoke('integrations:set-mine', {
      tracker: 'linear',
      mine: { kind: 'assignee', email: 'me@x.c' },
    })
    expect(store.setMine).toHaveBeenCalledWith('linear', { kind: 'assignee', email: 'me@x.c' })
  })

  it('rejects a selector shape that does not exist', async () => {
    await expect(
      invoke('integrations:set-mine', { tracker: 'linear', mine: { kind: 'nonsense' } })
    ).resolves.toMatchObject({ error: 'failed' })
  })
})

describe('integrations:status-changed', () => {
  it('announces after a connect, so every open surface learns about it', async () => {
    await invoke('integrations:connect', { tracker: 'linear', apiKey: 'k' })
    expect(sent.map((s) => s.channel)).toContain('integrations:status-changed')
  })

  it('announces after a disconnect', async () => {
    await invoke('integrations:disconnect', { tracker: 'linear' })
    expect(sent.map((s) => s.channel)).toContain('integrations:status-changed')
  })

  it('announces after the mine selector changes', async () => {
    await invoke('integrations:set-mine', {
      tracker: 'linear',
      mine: { kind: 'assignee', email: 'me@x.co' },
    })
    expect(sent.map((s) => s.channel)).toContain('integrations:status-changed')
  })

  it('carries connections and never a secret', async () => {
    await invoke('integrations:connect', { tracker: 'linear', apiKey: 'super-secret' })
    const announcement = sent.find((s) => s.channel === 'integrations:status-changed')
    expect(announcement?.data).toMatchObject({ connections: expect.any(Array) })
    expect(JSON.stringify(announcement?.data)).not.toContain('super-secret')
  })

  it('says nothing when a connect is rejected', async () => {
    verify.linear.mockRejectedValue(new Error('Authentication required'))
    await invoke('integrations:connect', { tracker: 'linear', apiKey: 'bad' })
    expect(sent).toHaveLength(0)
  })
})

const LINK = {
  projectId: '11111111-1111-4111-8111-111111111111',
  tracker: 'linear' as const,
  key: 'TAV-42',
  injectContext: true,
  linkedAt: '2026-08-22T00:00:00.000Z',
}

describe('integrations:link-set', () => {
  it('stores the link and announces it', async () => {
    linkStore.setLink.mockResolvedValue(LINK)
    linkStore.getLink.mockReturnValue(LINK)

    const result = await invoke('integrations:link-set', {
      projectId: LINK.projectId,
      tracker: 'linear',
      key: 'TAV-42',
    })

    expect(linkStore.setLink).toHaveBeenCalledWith({
      projectId: LINK.projectId,
      tracker: 'linear',
      key: 'TAV-42',
      injectContext: undefined,
    })
    expect(result).toMatchObject({ link: { key: 'TAV-42' } })
    expect(sent.map((s) => s.channel)).toContain('integrations:link-changed')
  })

  it('passes the injection choice through when one is made', async () => {
    linkStore.setLink.mockResolvedValue({ ...LINK, injectContext: false })
    linkStore.getLink.mockReturnValue(LINK)
    await invoke('integrations:link-set', {
      projectId: LINK.projectId,
      tracker: 'linear',
      key: 'TAV-42',
      injectContext: false,
    })
    expect(linkStore.setLink).toHaveBeenCalledWith(
      expect.objectContaining({ injectContext: false })
    )
  })

  it('refuses a project id that is not a project id', async () => {
    await expect(
      invoke('integrations:link-set', { projectId: 'nope', tracker: 'linear', key: 'TAV-42' })
    ).resolves.toMatchObject({ error: 'failed' })
    expect(linkStore.setLink).not.toHaveBeenCalled()
  })

  it('reports a store failure rather than claiming success', async () => {
    linkStore.setLink.mockRejectedValue(new Error('read-only directory'))
    await expect(
      invoke('integrations:link-set', {
        projectId: LINK.projectId,
        tracker: 'linear',
        key: 'TAV-42',
      })
    ).resolves.toMatchObject({ error: 'failed', message: 'read-only directory' })
  })
})

describe('integrations:link-get', () => {
  it('returns nothing for an unlinked project', async () => {
    linkStore.getLink.mockReturnValue(null)
    await expect(invoke('integrations:link-get', { projectId: LINK.projectId })).resolves.toEqual({
      link: null,
      issue: null,
    })
    expect(service.get).not.toHaveBeenCalled()
  })

  it('returns the link and its issue', async () => {
    linkStore.getLink.mockReturnValue(LINK)
    service.get.mockResolvedValue({ tracker: 'linear', key: 'TAV-42', title: 'A thing' })
    await expect(
      invoke('integrations:link-get', { projectId: LINK.projectId })
    ).resolves.toMatchObject({ link: { key: 'TAV-42' }, issue: { title: 'A thing' } })
  })

  it('keeps the link when the issue cannot be read, and says why', async () => {
    linkStore.getLink.mockReturnValue(LINK)
    service.get.mockRejectedValue(
      Object.assign(new Error('offline'), { code: 'ENOTFOUND', name: 'TypeError' })
    )
    await expect(
      invoke('integrations:link-get', { projectId: LINK.projectId })
    ).resolves.toMatchObject({ link: { key: 'TAV-42' }, issue: null, issueError: 'unavailable' })
  })
})

describe('integrations:link-clear', () => {
  it('clears and announces', async () => {
    linkStore.clearLink.mockResolvedValue(undefined)
    linkStore.getLink.mockReturnValue(null)

    await expect(invoke('integrations:link-clear', { projectId: LINK.projectId })).resolves.toEqual(
      {
        ok: true,
      }
    )
    expect(linkStore.clearLink).toHaveBeenCalledWith(LINK.projectId)
    const announcement = sent.find((s) => s.channel === 'integrations:link-changed')
    expect(announcement?.data).toMatchObject({ projectId: LINK.projectId, link: null })
  })
})

describe('integrations — agent context', () => {
  const P = '11111111-1111-4111-8111-111111111111'

  it('brings the context up to date when a link is made', async () => {
    linkStore.setLink.mockResolvedValue({ projectId: P, tracker: 'linear', key: 'TAV-42' })
    linkStore.getLink.mockReturnValue({ projectId: P, tracker: 'linear', key: 'TAV-42' })

    await invoke('integrations:link-set', { projectId: P, tracker: 'linear', key: 'TAV-42' })
    expect(contextSync.syncProjectContext).toHaveBeenCalledWith(P, expect.anything())
  })

  it('undoes the link when the project directory cannot be written (FR-026)', async () => {
    linkStore.setLink.mockResolvedValue({ projectId: P, tracker: 'linear', key: 'TAV-42' })
    linkStore.getLink.mockReturnValue(null)
    contextSync.syncProjectContext.mockRejectedValue(new Error('EACCES: permission denied'))

    const result = await invoke('integrations:link-set', {
      projectId: P,
      tracker: 'linear',
      key: 'TAV-42',
    })

    // A link that looks attached and silently feeds nothing is worse than none.
    expect(result).toMatchObject({ error: 'failed', message: expect.stringContaining('EACCES') })
    expect(linkStore.clearLink).toHaveBeenCalledWith(P)
  })

  it('removes what it wrote when a link is cleared', async () => {
    linkStore.clearLink.mockResolvedValue(undefined)
    linkStore.getLink.mockReturnValue(null)
    await invoke('integrations:link-clear', { projectId: P })
    expect(contextSync.clearProjectContext).toHaveBeenCalledWith(P)
  })

  it('previews exactly what a session would receive', async () => {
    contextSync.previewProjectContext.mockResolvedValue({ markdown: '# TAV-42', chars: 8 })
    await expect(invoke('integrations:context-preview', { projectId: P })).resolves.toMatchObject({
      context: { markdown: '# TAV-42' },
    })
  })

  it('re-syncs when injection is turned on or off', async () => {
    linkStore.getLink.mockReturnValue({ projectId: P, tracker: 'linear', key: 'TAV-42' })
    await invoke('integrations:set-inject-context', { projectId: P, injectContext: false })

    expect(linkStore.setInjectContext).toHaveBeenCalledWith(P, false)
    expect(contextSync.syncProjectContext).toHaveBeenCalledWith(P, expect.anything())
    expect(sent.map((s) => s.channel)).toContain('integrations:link-changed')
  })

  it('refuses a malformed injection toggle', async () => {
    await expect(
      invoke('integrations:set-inject-context', { projectId: P, injectContext: 'yes' })
    ).resolves.toMatchObject({ error: 'failed' })
    expect(linkStore.setInjectContext).not.toHaveBeenCalled()
  })
})
