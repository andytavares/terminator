import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Issue } from '../../../src/shared/types/index'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())

let userData: string
let projectDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^enc:/, ''),
  },
}))
vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)

// The trackers are the network, so the providers and the issue service built
// on them are stand-ins. The stores and the agent-context files are real.
const verify = vi.hoisted(() => ({ linear: vi.fn(), jira: vi.fn() }))

vi.mock('../../../src/main/integrations/providers/linear.provider', () => ({
  createLinearProvider: () => ({ id: 'linear', verify: verify.linear }),
}))
vi.mock('../../../src/main/integrations/providers/jira.provider', () => ({
  createJiraProvider: () => ({ id: 'jira', verify: verify.jira }),
}))

const service = vi.hoisted(() => ({
  listMine: vi.fn(),
  search: vi.fn(),
  get: vi.fn(),
  comment: vi.fn(),
}))

vi.mock('../../../src/main/integrations/index', () => ({
  getIssueService: () => service,
  resetIssueService: () => {},
}))

const TAV_42: Issue = {
  tracker: 'linear',
  id: 'id-42',
  key: 'TAV-42',
  title: 'A thing',
  url: 'https://linear.app/tav/issue/TAV-42',
  state: { name: 'In Progress', type: 'started' },
  assignee: null,
  description: 'Body',
  labels: [],
  branchName: null,
  completed: false,
  updatedAt: '2026-08-22T00:00:00Z',
  comments: [],
}

let trackers: typeof import('../../../src/main/integrations/tracker-store')
let links: typeof import('../../../src/main/integrations/issue-link-store')
let sent: Array<{ channel: string; data: unknown }>
let P: string

const window = {
  isDestroyed: () => false,
  webContents: {
    isDestroyed: () => false,
    send: (channel: string, data: unknown) => sent.push({ channel, data }),
  },
}

async function addProject(): Promise<string> {
  const workspaces = await import('../../../src/main/storage/workspace-store')
  const created = workspaces.createWorkspace({
    name: 'repo',
    folderPath: '/repo/root',
    color: '#4A90E2',
    tags: [],
  })
  if (!('workspace' in created)) throw new Error(created.error)
  const added = workspaces.createProject({
    workspaceId: created.workspace.id,
    name: 'main',
    worktreePath: projectDir,
    isWorktree: false,
  })
  if (!('project' in added)) throw new Error(added.error)
  return added.project.id
}

async function register() {
  handlers.clear()
  const mod = await import('../../../src/main/ipc/integrations.ipc')
  mod.registerIntegrationsHandlers(() => window as never)
}

async function invoke<T = unknown>(channel: string, payload: unknown): Promise<T> {
  const handler = handlers.get(channel)
  if (handler === undefined) throw new Error(`no handler for ${channel}`)
  return (await handler({}, payload)) as T
}

const connection = async (tracker: string) =>
  (await trackers.listConnections()).find((c) => c.tracker === tracker)

const contextFile = () => path.join(userData, 'integrations', 'context', `${P}.json`)
const projectSettings = () => path.join(projectDir, '.claude', 'settings.local.json')

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'integrations-ipc-ud-'))
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integrations-ipc-proj-'))
  sent = []
  verify.linear.mockResolvedValue({ name: 'Andrew', email: 'a@b.c' })
  verify.jira.mockResolvedValue({ name: 'Andrew', email: 'a@b.c', site: 's.atlassian.net' })
  service.get.mockResolvedValue(TAV_42)
  trackers = await import('../../../src/main/integrations/tracker-store')
  links = await import('../../../src/main/integrations/issue-link-store')
  P = await addProject()
  await trackers.setCredential({ tracker: 'linear', apiKey: 'stored-key' })
  await register()
})

describe('integrations:status', () => {
  it('returns every tracker and never a secret', async () => {
    const result = await invoke<{ connections: Array<{ tracker: string; connected: boolean }> }>(
      'integrations:status',
      {}
    )
    expect(result.connections.map((c) => [c.tracker, c.connected])).toEqual([
      ['linear', true],
      ['jira', false],
    ])
    expect(JSON.stringify(result)).not.toMatch(/stored-key|secret/)
  })

  it('can be narrowed to one tracker', async () => {
    const result = (await invoke('integrations:status', { tracker: 'jira' })) as {
      connections: { tracker: string }[]
    }
    expect(result.connections.map((c) => c.tracker)).toEqual(['jira'])
  })
})

describe('integrations:connect', () => {
  it('verifies the credential it is given, then stores it', async () => {
    await invoke('integrations:connect', { tracker: 'linear', apiKey: 'lin_key' })
    expect(verify.linear).toHaveBeenCalledWith({ tracker: 'linear', apiKey: 'lin_key' })
    expect(await trackers.getCredential('linear')).toEqual({ tracker: 'linear', apiKey: 'lin_key' })
  })

  it('stores nothing when the credential is rejected', async () => {
    verify.jira.mockRejectedValue(
      Object.assign(new Error('Authentication required'), { kind: 'auth-failed' })
    )
    const result = await invoke('integrations:connect', {
      tracker: 'jira',
      site: 's.atlassian.net',
      email: 'a@b.c',
      apiToken: 'bad',
      jql: 'x',
    })

    expect(result).toMatchObject({ error: expect.any(String) })
    expect(await connection('jira')).toMatchObject({ connected: false, account: null })
  })

  it('records the account the credential proved to belong to', async () => {
    await invoke('integrations:connect', { tracker: 'linear', apiKey: 'k' })
    expect((await connection('linear'))?.account).toEqual({ name: 'Andrew', email: 'a@b.c' })
  })

  it('stores the Jira query as its mine selector', async () => {
    await invoke('integrations:connect', {
      tracker: 'jira',
      site: 's.atlassian.net',
      email: 'a@b.c',
      apiToken: 't',
      jql: 'assignee = currentUser()',
    })
    expect(await trackers.getMine('jira')).toEqual({
      kind: 'query',
      jql: 'assignee = currentUser()',
    })
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
    await trackers.setCredential({
      tracker: 'jira',
      site: 's.atlassian.net',
      email: 'a@b.c',
      apiToken: 't',
    })
    await invoke('integrations:disconnect', { tracker: 'linear' })
    expect(await trackers.getCredential('linear')).toBeNull()
    expect(await connection('jira')).toMatchObject({ connected: true })
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
})

describe('integrations:set-mine', () => {
  it('stores the selector', async () => {
    await invoke('integrations:set-mine', {
      tracker: 'linear',
      mine: { kind: 'assignee', email: 'me@x.c' },
    })
    expect(await trackers.getMine('linear')).toEqual({ kind: 'assignee', email: 'me@x.c' })
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
    expect(announcement?.data).toMatchObject({
      connections: [{ tracker: 'linear', account: { name: 'Andrew' } }, { tracker: 'jira' }],
    })
    expect(JSON.stringify(announcement?.data)).not.toContain('super-secret')
  })

  it('says nothing when a connect is rejected', async () => {
    verify.linear.mockRejectedValue(new Error('Authentication required'))
    await invoke('integrations:connect', { tracker: 'linear', apiKey: 'bad' })
    expect(sent).toHaveLength(0)
  })
})

describe('integrations:link-set', () => {
  it('stores the link and announces it', async () => {
    const result = await invoke('integrations:link-set', {
      projectId: P,
      tracker: 'linear',
      key: 'TAV-42',
    })

    expect(result).toMatchObject({ link: { key: 'TAV-42', injectContext: true } })
    expect(links.getLink(P)).toMatchObject({ tracker: 'linear', key: 'TAV-42' })
    const announcement = sent.find((s) => s.channel === 'integrations:link-changed')
    expect(announcement?.data).toMatchObject({ projectId: P, link: { key: 'TAV-42' } })
  })

  it('keeps the injection choice when one is made', async () => {
    await invoke('integrations:link-set', {
      projectId: P,
      tracker: 'linear',
      key: 'TAV-42',
      injectContext: false,
    })
    expect(links.getLink(P)?.injectContext).toBe(false)
  })

  // A file where the directory should be refuses the write whoever runs the test.
  it('reports a store failure rather than claiming success', async () => {
    const blocker = path.join(userData, 'blocker')
    fs.writeFileSync(blocker, '')
    userData = path.join(blocker, 'user-data')
    await expect(
      invoke('integrations:link-set', { projectId: P, tracker: 'linear', key: 'TAV-42' })
    ).resolves.toMatchObject({ error: 'failed', message: expect.stringContaining('ENOTDIR') })
  })
})

describe('integrations:link-get', () => {
  it('returns nothing for an unlinked project', async () => {
    await expect(invoke('integrations:link-get', { projectId: P })).resolves.toEqual({
      link: null,
      issue: null,
    })
    expect(service.get).not.toHaveBeenCalled()
  })

  it('returns the link and its issue', async () => {
    await links.setLink({ projectId: P, tracker: 'linear', key: 'TAV-42' })
    await expect(invoke('integrations:link-get', { projectId: P })).resolves.toMatchObject({
      link: { key: 'TAV-42' },
      issue: { title: 'A thing' },
    })
  })

  it('keeps the link when the issue cannot be read, and says why', async () => {
    await links.setLink({ projectId: P, tracker: 'linear', key: 'TAV-42' })
    service.get.mockRejectedValue(
      Object.assign(new Error('offline'), { code: 'ENOTFOUND', name: 'TypeError' })
    )
    await expect(invoke('integrations:link-get', { projectId: P })).resolves.toMatchObject({
      link: { key: 'TAV-42' },
      issue: null,
      issueError: 'unavailable',
    })
  })
})

describe('integrations:link-clear', () => {
  it('clears and announces', async () => {
    await links.setLink({ projectId: P, tracker: 'linear', key: 'TAV-42' })

    await expect(invoke('integrations:link-clear', { projectId: P })).resolves.toEqual({
      ok: true,
    })
    expect(links.getLink(P)).toBeNull()
    const announcement = sent.find((s) => s.channel === 'integrations:link-changed')
    expect(announcement?.data).toMatchObject({ projectId: P, link: null })
  })
})

describe('integrations — agent context', () => {
  it('writes the context and the project hook when a link is made', async () => {
    await invoke('integrations:link-set', { projectId: P, tracker: 'linear', key: 'TAV-42' })
    expect(JSON.parse(fs.readFileSync(contextFile(), 'utf8')).markdown).toContain('TAV-42')
    expect(fs.existsSync(projectSettings())).toBe(true)
  })

  it('undoes the link when the project directory cannot be written (FR-026)', async () => {
    // A file where `.claude` should be: no one can write the hook into it.
    fs.writeFileSync(path.join(projectDir, '.claude'), '')
    const result = await invoke('integrations:link-set', {
      projectId: P,
      tracker: 'linear',
      key: 'TAV-42',
    })

    // A link that looks attached and silently feeds nothing is worse than none.
    expect(result).toMatchObject({ error: 'failed', message: expect.any(String) })
    expect(links.getLink(P)).toBeNull()
  })

  it('removes what it wrote when a link is cleared', async () => {
    const before = fs.readdirSync(projectDir)
    await invoke('integrations:link-set', { projectId: P, tracker: 'linear', key: 'TAV-42' })
    await invoke('integrations:link-clear', { projectId: P })
    expect(fs.existsSync(contextFile())).toBe(false)
    expect(fs.readdirSync(projectDir)).toEqual(before)
  })

  it('previews exactly what a session would receive', async () => {
    await links.setLink({ projectId: P, tracker: 'linear', key: 'TAV-42' })
    const result = await invoke<{ context: { markdown: string } }>('integrations:context-preview', {
      projectId: P,
    })
    expect(result.context.markdown).toContain('TAV-42')
    expect(fs.existsSync(contextFile())).toBe(false)
  })

  it('removes the context when injection is turned off, and announces it', async () => {
    await invoke('integrations:link-set', { projectId: P, tracker: 'linear', key: 'TAV-42' })
    sent = []
    await invoke('integrations:set-inject-context', { projectId: P, injectContext: false })

    expect(links.getLink(P)?.injectContext).toBe(false)
    expect(fs.existsSync(contextFile())).toBe(false)
    expect(fs.existsSync(projectSettings())).toBe(false)
    expect(sent.find((s) => s.channel === 'integrations:link-changed')?.data).toMatchObject({
      link: { injectContext: false },
    })
  })
})
