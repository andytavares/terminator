import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TrackerConnection } from '../../../../src/shared/types/index'

const api = {
  status: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  setMine: vi.fn(),
  linkGet: vi.fn(),
  linkSet: vi.fn(),
  linkClear: vi.fn(),
  listMine: vi.fn(),
  search: vi.fn(),
  onStatusChanged: vi.fn(() => () => {}),
  onLinkChanged: vi.fn(() => () => {}),
}

// A .spec.ts under tests/unit runs in the node project, which has no DOM — the
// store only ever touches window.electronAPI, so that is all it needs.
Object.defineProperty(globalThis, 'window', {
  value: { electronAPI: { integrations: api } },
  writable: true,
})

import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'

function connection(over: Partial<TrackerConnection> = {}): TrackerConnection {
  return {
    tracker: 'linear',
    connected: true,
    account: { name: 'Andrew', email: 'a@b.co' },
    site: null,
    mine: { kind: 'assignee', email: null },
    lastError: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.onStatusChanged.mockReturnValue(() => {})
  api.onLinkChanged.mockReturnValue(() => {})
  useIntegrationsStore.setState({
    connections: [],
    links: new Map(),
    issues: new Map(),
    loading: false,
    connectError: {},
  })
})

describe('integrations store — loading', () => {
  it('stores what the main process reports', async () => {
    api.status.mockResolvedValue({ connections: [connection()] })
    await useIntegrationsStore.getState().loadConnections()
    expect(useIntegrationsStore.getState().connections).toHaveLength(1)
    expect(useIntegrationsStore.getState().loading).toBe(false)
  })

  it('leaves the last known state alone when the call fails', async () => {
    api.status.mockResolvedValue({ connections: [connection()] })
    await useIntegrationsStore.getState().loadConnections()

    api.status.mockResolvedValue({ error: 'failed', message: 'nope' })
    await useIntegrationsStore.getState().loadConnections()

    // Better to show what we last knew than to blank the panel on a blip.
    expect(useIntegrationsStore.getState().connections).toHaveLength(1)
    expect(useIntegrationsStore.getState().loading).toBe(false)
  })
})

describe('integrations store — connect', () => {
  it('reloads connections and reports success', async () => {
    api.connect.mockResolvedValue({ connection: connection() })
    api.status.mockResolvedValue({ connections: [connection()] })

    const ok = await useIntegrationsStore.getState().connect({ tracker: 'linear', apiKey: 'k' })

    expect(ok).toBe(true)
    expect(api.status).toHaveBeenCalled()
    expect(useIntegrationsStore.getState().connectError.linear).toBeUndefined()
  })

  it('keeps the tracker message so the operator sees what the tracker said', async () => {
    api.connect.mockResolvedValue({ error: 'auth-failed', message: 'Authentication required' })

    const ok = await useIntegrationsStore.getState().connect({ tracker: 'linear', apiKey: 'bad' })

    expect(ok).toBe(false)
    expect(useIntegrationsStore.getState().connectError.linear).toBe('Authentication required')
    expect(api.status).not.toHaveBeenCalled()
  })

  it('falls back to a plain message when the error carries none', async () => {
    api.connect.mockResolvedValue({ error: 'failed' })
    await useIntegrationsStore
      .getState()
      .connect({ tracker: 'jira', site: 's', email: 'e', apiToken: 't', jql: 'q' })
    expect(useIntegrationsStore.getState().connectError.jira).toBe('Could not connect')
  })

  it('keeps each tracker error separate', async () => {
    api.connect.mockResolvedValue({ error: 'failed', message: 'linear broke' })
    await useIntegrationsStore.getState().connect({ tracker: 'linear', apiKey: 'x' })
    expect(useIntegrationsStore.getState().connectError.jira).toBeUndefined()
  })

  it('clears one tracker error without touching the other', async () => {
    api.connect.mockResolvedValue({ error: 'failed', message: 'boom' })
    await useIntegrationsStore.getState().connect({ tracker: 'linear', apiKey: 'x' })
    await useIntegrationsStore
      .getState()
      .connect({ tracker: 'jira', site: 's', email: 'e', apiToken: 't', jql: 'q' })

    useIntegrationsStore.getState().clearConnectError('linear')

    expect(useIntegrationsStore.getState().connectError.linear).toBeUndefined()
    expect(useIntegrationsStore.getState().connectError.jira).toBe('boom')
  })
})

describe('integrations store — disconnect and mine', () => {
  it('disconnects and reloads', async () => {
    api.disconnect.mockResolvedValue({ ok: true })
    api.status.mockResolvedValue({ connections: [] })
    await useIntegrationsStore.getState().disconnect('linear')
    expect(api.disconnect).toHaveBeenCalledWith({ tracker: 'linear' })
    expect(api.status).toHaveBeenCalled()
  })

  it('stores a mine selector and reloads', async () => {
    api.setMine.mockResolvedValue({ ok: true })
    api.status.mockResolvedValue({ connections: [connection()] })
    await useIntegrationsStore.getState().setMine('jira', { kind: 'query', jql: 'project = TAV' })
    expect(api.setMine).toHaveBeenCalledWith({
      tracker: 'jira',
      mine: { kind: 'query', jql: 'project = TAV' },
    })
  })
})

describe('integrations store — subscription', () => {
  it('applies a pushed connection list', () => {
    let push: ((payload: unknown) => void) | undefined
    api.onStatusChanged.mockImplementation((handler: (payload: unknown) => void) => {
      push = handler
      return () => {}
    })

    useIntegrationsStore.getState().subscribe()
    push?.({ connections: [connection({ tracker: 'jira' })] })

    expect(useIntegrationsStore.getState().connections[0].tracker).toBe('jira')
  })

  it('ignores a malformed push rather than blanking the panel', () => {
    let push: ((payload: unknown) => void) | undefined
    api.onStatusChanged.mockImplementation((handler: (payload: unknown) => void) => {
      push = handler
      return () => {}
    })
    useIntegrationsStore.setState({ connections: [connection()] })

    useIntegrationsStore.getState().subscribe()
    push?.(undefined)
    push?.({ nonsense: true })

    expect(useIntegrationsStore.getState().connections).toHaveLength(1)
  })

  it('unsubscribes from both channels at once', () => {
    const offStatus = vi.fn()
    const offLink = vi.fn()
    api.onStatusChanged.mockReturnValue(offStatus)
    api.onLinkChanged.mockReturnValue(offLink)

    useIntegrationsStore.getState().subscribe()()

    expect(offStatus).toHaveBeenCalled()
    expect(offLink).toHaveBeenCalled()
  })
})

describe('integrations store — selectors', () => {
  it('finds a connection by tracker', () => {
    useIntegrationsStore.setState({ connections: [connection(), connection({ tracker: 'jira' })] })
    expect(useIntegrationsStore.getState().connectionFor('jira')?.tracker).toBe('jira')
    expect(useIntegrationsStore.getState().connectionFor('linear')?.tracker).toBe('linear')
  })

  it('reports whether anything at all is connected', () => {
    expect(useIntegrationsStore.getState().isAnyConnected()).toBe(false)
    useIntegrationsStore.setState({ connections: [connection({ connected: false })] })
    expect(useIntegrationsStore.getState().isAnyConnected()).toBe(false)
    useIntegrationsStore.setState({ connections: [connection({ connected: true })] })
    expect(useIntegrationsStore.getState().isAnyConnected()).toBe(true)
  })
})

describe('integrations store — links', () => {
  const P = '11111111-1111-4111-8111-111111111111'
  const LINK = {
    projectId: P,
    tracker: 'linear' as const,
    key: 'TAV-42',
    injectContext: true,
    linkedAt: '2026-08-22T00:00:00.000Z',
  }
  const ISSUE = { tracker: 'linear', key: 'TAV-42', title: 'A thing' }

  it('loads a link and its issue', async () => {
    api.linkGet.mockResolvedValue({ link: LINK, issue: ISSUE })
    await useIntegrationsStore.getState().loadLink(P)

    expect(useIntegrationsStore.getState().linkFor(P)?.key).toBe('TAV-42')
    expect(useIntegrationsStore.getState().issueFor(P)?.title).toBe('A thing')
  })

  it('keeps a link whose issue could not be read', async () => {
    api.linkGet.mockResolvedValue({ link: LINK, issue: null, issueError: 'unavailable' })
    await useIntegrationsStore.getState().loadLink(P)

    // The badge draws from the link and renders unavailable; it must not vanish.
    expect(useIntegrationsStore.getState().linkFor(P)?.key).toBe('TAV-42')
    expect(useIntegrationsStore.getState().issueFor(P)).toBeNull()
  })

  it('reports no link for an unlinked project', async () => {
    api.linkGet.mockResolvedValue({ link: null, issue: null })
    await useIntegrationsStore.getState().loadLink(P)
    expect(useIntegrationsStore.getState().linkFor(P)).toBeNull()
  })

  it('leaves state alone when the call fails', async () => {
    api.linkGet.mockResolvedValue({ link: LINK, issue: ISSUE })
    await useIntegrationsStore.getState().loadLink(P)
    api.linkGet.mockResolvedValue({ error: 'failed' })
    await useIntegrationsStore.getState().loadLink(P)
    expect(useIntegrationsStore.getState().linkFor(P)?.key).toBe('TAV-42')
  })

  it('links and reads back, so the badge gets the issue state', async () => {
    api.linkSet.mockResolvedValue({ link: LINK })
    api.linkGet.mockResolvedValue({ link: LINK, issue: ISSUE })

    const ok = await useIntegrationsStore.getState().linkIssue(P, 'linear', 'TAV-42')

    expect(ok).toBe(true)
    expect(api.linkGet).toHaveBeenCalledWith({ projectId: P })
    expect(useIntegrationsStore.getState().issueFor(P)?.title).toBe('A thing')
  })

  it('reports a link failure without touching state', async () => {
    api.linkSet.mockResolvedValue({ error: 'failed', message: 'read-only' })
    const ok = await useIntegrationsStore.getState().linkIssue(P, 'linear', 'TAV-42')
    expect(ok).toBe(false)
    expect(api.linkGet).not.toHaveBeenCalled()
    expect(useIntegrationsStore.getState().linkFor(P)).toBeNull()
  })

  it('unlinks and drops both the link and the issue', async () => {
    api.linkGet.mockResolvedValue({ link: LINK, issue: ISSUE })
    await useIntegrationsStore.getState().loadLink(P)

    api.linkClear.mockResolvedValue({ ok: true })
    await useIntegrationsStore.getState().unlinkIssue(P)

    expect(useIntegrationsStore.getState().linkFor(P)).toBeNull()
    expect(useIntegrationsStore.getState().issueFor(P)).toBeNull()
  })

  it('applies a link pushed from elsewhere', () => {
    let push: ((payload: unknown) => void) | undefined
    api.onLinkChanged.mockImplementation((handler: (payload: unknown) => void) => {
      push = handler
      return () => {}
    })
    api.linkGet.mockResolvedValue({ link: LINK, issue: ISSUE })

    useIntegrationsStore.getState().subscribe()
    push?.({ projectId: P, link: LINK })

    expect(useIntegrationsStore.getState().linkFor(P)?.key).toBe('TAV-42')
  })

  it('drops the badge when a link is cleared elsewhere', () => {
    let push: ((payload: unknown) => void) | undefined
    api.onLinkChanged.mockImplementation((handler: (payload: unknown) => void) => {
      push = handler
      return () => {}
    })
    useIntegrationsStore.setState({ links: new Map([[P, LINK]]) })

    useIntegrationsStore.getState().subscribe()
    push?.({ projectId: P, link: null })

    expect(useIntegrationsStore.getState().linkFor(P)).toBeNull()
  })

  it('ignores a malformed link push', () => {
    let push: ((payload: unknown) => void) | undefined
    api.onLinkChanged.mockImplementation((handler: (payload: unknown) => void) => {
      push = handler
      return () => {}
    })
    useIntegrationsStore.setState({ links: new Map([[P, LINK]]) })

    useIntegrationsStore.getState().subscribe()
    push?.(undefined)
    push?.({ link: LINK })

    expect(useIntegrationsStore.getState().linkFor(P)?.key).toBe('TAV-42')
  })

  it('returns an empty result rather than throwing when listing fails', async () => {
    api.listMine.mockResolvedValue({ error: 'not-connected' })
    await expect(useIntegrationsStore.getState().listMine()).resolves.toEqual({
      issues: [],
      failures: [],
    })
  })

  it('passes search terms through and returns what came back', async () => {
    api.search.mockResolvedValue({ issues: [ISSUE], failures: [] })
    const result = await useIntegrationsStore.getState().searchIssues('sidebar')
    expect(api.search).toHaveBeenCalledWith({ term: 'sidebar' })
    expect(result.issues).toHaveLength(1)
  })
})

describe('integrations store — partial transports', () => {
  const P = '11111111-1111-4111-8111-111111111111'

  /** The remote /app/ shim deliberately omits connect and disconnect. */
  function withoutCredentialWrites(): void {
    Object.defineProperty(globalThis, 'window', {
      value: {
        electronAPI: {
          integrations: {
            status: api.status,
            linkGet: api.linkGet,
            onStatusChanged: api.onStatusChanged,
          },
        },
      },
      writable: true,
    })
  }

  function withNoIntegrationsAtAll(): void {
    Object.defineProperty(globalThis, 'window', {
      value: { electronAPI: {} },
      writable: true,
    })
  }

  function restore(): void {
    Object.defineProperty(globalThis, 'window', {
      value: { electronAPI: { integrations: api } },
      writable: true,
    })
  }

  it('reports failure rather than crashing when connect is not carried', async () => {
    withoutCredentialWrites()
    const ok = await useIntegrationsStore.getState().connect({ tracker: 'linear', apiKey: 'k' })
    expect(ok).toBe(false)
    expect(useIntegrationsStore.getState().connectError.linear).toBe('Could not connect')
    restore()
  })

  it('does nothing when disconnect is not carried', async () => {
    withoutCredentialWrites()
    await expect(useIntegrationsStore.getState().disconnect('linear')).resolves.toBeUndefined()
    restore()
  })

  it('subscribes to what the transport has and ignores what it does not', () => {
    withoutCredentialWrites()
    expect(() => useIntegrationsStore.getState().subscribe()()).not.toThrow()
    expect(api.onStatusChanged).toHaveBeenCalled()
    restore()
  })

  it('survives an electronAPI with no integrations surface at all', async () => {
    withNoIntegrationsAtAll()
    await expect(useIntegrationsStore.getState().loadConnections()).resolves.toBeUndefined()
    await expect(useIntegrationsStore.getState().loadLink(P)).resolves.toBeUndefined()
    await expect(useIntegrationsStore.getState().listMine()).resolves.toEqual({
      issues: [],
      failures: [],
    })
    expect(() => useIntegrationsStore.getState().subscribe()()).not.toThrow()
    restore()
  })
})
