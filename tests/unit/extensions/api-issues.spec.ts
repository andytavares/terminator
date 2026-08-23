import { describe, it, expect, beforeEach, vi } from 'vitest'

// The facade and the stores have their own tests; here the question is only
// whether the extension surface delegates to them, exposes nothing it should
// not, and never hands out a credential.
const service = vi.hoisted(() => ({
  listMine: vi.fn(),
  search: vi.fn(),
  get: vi.fn(),
  comment: vi.fn(),
}))
const store = vi.hoisted(() => ({
  listConnections: vi.fn(),
  getLink: vi.fn(),
  onLinkChange: vi.fn(() => () => {}),
  setLink: vi.fn(),
}))

vi.mock('../../../src/main/integrations/index', () => ({ getIssueService: () => service }))
vi.mock('../../../src/main/integrations/tracker-store', () => ({
  listConnections: store.listConnections,
}))
vi.mock('../../../src/main/integrations/issue-link-store', () => ({
  getLink: store.getLink,
  onLinkChange: store.onLinkChange,
  setLink: store.setLink,
}))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  globalShortcut: { register: vi.fn(), unregister: vi.fn() },
  app: { getPath: () => '/tmp', getVersion: () => '0.1.0' },
}))

const LINK = {
  projectId: 'p1',
  tracker: 'linear' as const,
  key: 'TAV-42',
  injectContext: true,
  linkedAt: '2026-08-22T00:00:00.000Z',
}

async function makeApi() {
  const { createExtensionAPI } = await import('../../../src/main/extensions/api')
  return createExtensionAPI('test-extension')
}

beforeEach(() => {
  vi.clearAllMocks()
  store.setLink.mockResolvedValue(LINK)
  store.onLinkChange.mockReturnValue(() => {})
})

describe('api.issues — delegation', () => {
  it('lists connections without exposing a secret', async () => {
    store.listConnections.mockResolvedValue([
      { tracker: 'linear', connected: true, account: { name: 'A', email: 'a@b.co' } },
    ])
    const api = await makeApi()
    const result = await api.issues.connections()

    expect(JSON.stringify(result)).not.toMatch(/apiKey|apiToken|secret/)
    expect(result[0]).toMatchObject({ tracker: 'linear', connected: true })
  })

  it('delegates listMine, search and get to the one service', async () => {
    service.listMine.mockResolvedValue({ issues: [], failures: [] })
    service.search.mockResolvedValue({ issues: [], failures: [] })
    service.get.mockResolvedValue(null)
    const api = await makeApi()

    await api.issues.listMine({ tracker: 'linear' })
    await api.issues.search('sidebar', { limit: 5 })
    await api.issues.get('jira', 'TAV-7', { refresh: true })

    expect(service.listMine).toHaveBeenCalledWith({ tracker: 'linear' })
    expect(service.search).toHaveBeenCalledWith('sidebar', { limit: 5 })
    expect(service.get).toHaveBeenCalledWith('jira', 'TAV-7', { refresh: true })
  })

  it('rejects a failed comment rather than swallowing it (FR-034a)', async () => {
    service.comment.mockRejectedValue(new Error('no permission'))
    const api = await makeApi()
    await expect(api.issues.comment('linear', 'TAV-42', 'hi')).rejects.toThrow('no permission')
  })

  it('reads a project link synchronously', async () => {
    store.getLink.mockReturnValue(LINK)
    const api = await makeApi()
    expect(api.issues.linkFor('p1')).toMatchObject({ key: 'TAV-42' })
  })

  it('subscribes to link changes and disposes cleanly', async () => {
    const unsub = vi.fn()
    store.onLinkChange.mockReturnValue(unsub)
    const api = await makeApi()

    const subscription = api.issues.onLinkChange(() => {})
    subscription.dispose()
    expect(unsub).toHaveBeenCalled()
  })
})

describe('api.issues — the surface itself (FR-034)', () => {
  it('exposes exactly the sanctioned operations', async () => {
    const api = await makeApi()
    expect(Object.keys(api.issues).sort()).toEqual(
      ['comment', 'connections', 'get', 'linkFor', 'listMine', 'onLinkChange', 'search'].sort()
    )
  })

  it('offers no way to create, edit or transition an issue', async () => {
    const api = await makeApi()
    const forbidden = /^(create|update|set|assign|transition|close|move|delete|archive)/i
    for (const method of Object.keys(api.issues)) {
      // linkFor/listMine/onLinkChange are reads or subscriptions; nothing here
      // may write to a tracker except comment.
      expect(forbidden.test(method), `api.issues.${method} looks like a mutation`).toBe(false)
    }
  })
})

describe('api.workspace.createProject — attaching an issue (v2.2.0)', () => {
  it('attaches the issue the caller said the project is for', async () => {
    const workspaceStore = await import('../../../src/main/storage/workspace-store')
    vi.spyOn(workspaceStore, 'listProjects').mockReturnValue([])
    vi.spyOn(workspaceStore, 'createProject').mockReturnValue({
      project: { id: 'p-new', workspaceId: 'w1', name: 'n' },
    } as never)

    const api = await makeApi()
    api.workspace.createProject({
      workspaceId: 'w1',
      name: 'n',
      worktreePath: '/wt/a',
      issue: { tracker: 'linear', key: 'TAV-42' },
    })

    expect(store.setLink).toHaveBeenCalledWith({
      projectId: 'p-new',
      tracker: 'linear',
      key: 'TAV-42',
    })
  })

  it('attaches to the existing project when one already covers that path', async () => {
    const workspaceStore = await import('../../../src/main/storage/workspace-store')
    vi.spyOn(workspaceStore, 'listProjects').mockReturnValue([
      { id: 'p-existing', workspaceId: 'w1', name: 'n', worktreePath: '/wt/a' },
    ] as never)

    const api = await makeApi()
    const result = api.workspace.createProject({
      workspaceId: 'w1',
      name: 'n',
      worktreePath: '/wt/a',
      issue: { tracker: 'jira', key: 'TAV-7' },
    })

    expect(result?.id).toBe('p-existing')
    expect(store.setLink).toHaveBeenCalledWith({
      projectId: 'p-existing',
      tracker: 'jira',
      key: 'TAV-7',
    })
  })

  it('attaches nothing when no issue was named', async () => {
    const workspaceStore = await import('../../../src/main/storage/workspace-store')
    vi.spyOn(workspaceStore, 'listProjects').mockReturnValue([])
    vi.spyOn(workspaceStore, 'createProject').mockReturnValue({
      project: { id: 'p-new', workspaceId: 'w1', name: 'n' },
    } as never)

    const api = await makeApi()
    api.workspace.createProject({ workspaceId: 'w1', name: 'n', worktreePath: '/wt/b' })
    expect(store.setLink).not.toHaveBeenCalled()
  })

  it('still returns the project when the link cannot be written', async () => {
    const workspaceStore = await import('../../../src/main/storage/workspace-store')
    vi.spyOn(workspaceStore, 'listProjects').mockReturnValue([])
    vi.spyOn(workspaceStore, 'createProject').mockReturnValue({
      project: { id: 'p-new', workspaceId: 'w1', name: 'n' },
    } as never)
    store.setLink.mockRejectedValue(new Error('read-only'))

    const api = await makeApi()
    const result = api.workspace.createProject({
      workspaceId: 'w1',
      name: 'n',
      worktreePath: '/wt/c',
      issue: { tracker: 'linear', key: 'TAV-42' },
    })

    // The expensive part — provisioning the checkout — already happened.
    // Losing it because a link file could not be written would be worse.
    expect(result?.id).toBe('p-new')
  })
})
