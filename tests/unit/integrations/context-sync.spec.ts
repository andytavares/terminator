import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Issue } from '../../../src/shared/types/index'

let userData: string
let projectDir: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const workspace = vi.hoisted(() => ({
  project: undefined as unknown,
  workspaces: [] as unknown[],
}))

vi.mock('../../../src/main/storage/workspace-store', () => ({
  getProjectById: () => workspace.project,
  listWorkspaces: () => workspace.workspaces,
}))

const link = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('../../../src/main/integrations/issue-link-store', () => ({
  getLink: () => link.current,
}))

const P = '11111111-1111-4111-8111-111111111111'

function issue(over: Partial<Issue> = {}): Issue {
  return {
    tracker: 'linear',
    id: 'id-1',
    key: 'TAV-42',
    title: 'Unify Linear connections',
    url: 'https://linear.app/tav/issue/TAV-42',
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    description: 'Body',
    labels: [],
    branchName: null,
    completed: false,
    updatedAt: '2026-08-22T00:00:00Z',
    comments: [],
    ...over,
  }
}

function service(get = vi.fn().mockResolvedValue(issue())) {
  return { get } as never
}

async function load() {
  vi.resetModules()
  return import('../../../src/main/integrations/context-sync')
}

function contextFile(): string {
  return path.join(userData, 'integrations', 'context', `${P}.json`)
}

function settingsFile(): string {
  return path.join(projectDir, '.claude', 'settings.local.json')
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'context-sync-ud-'))
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-sync-proj-'))
  workspace.project = { id: P, workspaceId: 'w1', worktreePath: projectDir }
  workspace.workspaces = [{ id: 'w1', folderPath: '/does/not/matter' }]
  link.current = { projectId: P, tracker: 'linear', key: 'TAV-42', injectContext: true }
})

describe('projectDirectory', () => {
  it('prefers a project’s own worktree', async () => {
    const mod = await load()
    expect(mod.projectDirectory(P)).toBe(projectDir)
  })

  it('falls back to the workspace folder for a plain project', async () => {
    workspace.project = { id: P, workspaceId: 'w1' }
    workspace.workspaces = [{ id: 'w1', folderPath: '/repo/root' }]
    const mod = await load()
    expect(mod.projectDirectory(P)).toBe('/repo/root')
  })

  it('is null for a project that no longer exists', async () => {
    workspace.project = undefined
    const mod = await load()
    expect(mod.projectDirectory(P)).toBeNull()
  })

  it('is null when the workspace is gone too', async () => {
    workspace.project = { id: P, workspaceId: 'missing' }
    const mod = await load()
    expect(mod.projectDirectory(P)).toBeNull()
  })
})

describe('syncProjectContext — linked and injecting', () => {
  it('writes the context file the hook will read', async () => {
    const mod = await load()
    await mod.syncProjectContext(P, service())

    expect(fs.existsSync(contextFile())).toBe(true)
    const written = JSON.parse(fs.readFileSync(contextFile(), 'utf8'))
    expect(written.markdown).toContain('TAV-42')
    expect(written.projectId).toBe(P)
  })

  it('registers the hook in the project’s own settings', async () => {
    const mod = await load()
    await mod.syncProjectContext(P, service())

    const settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    expect(settings.hooks.SessionStart).toHaveLength(1)
    expect(JSON.stringify(settings)).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(JSON.stringify(settings)).toContain(P)
  })

  it('returns the context so a caller can report its size', async () => {
    const mod = await load()
    const context = await mod.syncProjectContext(P, service())
    expect(context?.chars).toBeGreaterThan(0)
  })

  it('is idempotent', async () => {
    const mod = await load()
    await mod.syncProjectContext(P, service())
    await mod.syncProjectContext(P, service())

    const settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    expect(settings.hooks.SessionStart).toHaveLength(1)
  })

  it('keeps the previous context when the tracker cannot be reached', async () => {
    const mod = await load()
    await mod.syncProjectContext(P, service())
    const before = fs.readFileSync(contextFile(), 'utf8')

    await mod.syncProjectContext(P, service(vi.fn().mockRejectedValue(new Error('offline'))))

    // A tracker outage must not cost the operator the context they had.
    expect(fs.readFileSync(contextFile(), 'utf8')).toBe(before)
  })

  it('writes nothing when the issue simply does not exist', async () => {
    const mod = await load()
    const context = await mod.syncProjectContext(P, service(vi.fn().mockResolvedValue(null)))
    expect(context).toBeNull()
    expect(fs.existsSync(contextFile())).toBe(false)
  })
})

describe('syncProjectContext — not injecting', () => {
  it('removes everything when injection is off', async () => {
    const mod = await load()
    await mod.syncProjectContext(P, service())
    expect(fs.existsSync(contextFile())).toBe(true)

    link.current = { projectId: P, tracker: 'linear', key: 'TAV-42', injectContext: false }
    await mod.syncProjectContext(P, service())

    expect(fs.existsSync(contextFile())).toBe(false)
    expect(fs.existsSync(settingsFile())).toBe(false)
  })

  it('removes everything when the link is gone', async () => {
    const mod = await load()
    await mod.syncProjectContext(P, service())

    link.current = null
    await mod.syncProjectContext(P, service())

    expect(fs.existsSync(contextFile())).toBe(false)
    expect(fs.readdirSync(projectDir)).toEqual([])
  })

  it('does not call the tracker at all when injection is off', async () => {
    link.current = { projectId: P, tracker: 'linear', key: 'TAV-42', injectContext: false }
    const get = vi.fn()
    const mod = await load()
    await mod.syncProjectContext(P, service(get))
    expect(get).not.toHaveBeenCalled()
  })
})

describe('syncProjectContext — unwritable project (FR-026)', () => {
  it('rejects rather than pretending it worked', async () => {
    fs.chmodSync(projectDir, 0o500)
    const mod = await load()
    await expect(mod.syncProjectContext(P, service())).rejects.toThrow()
    fs.chmodSync(projectDir, 0o700)
  })
})

describe('clearProjectContext', () => {
  it('leaves the project directory exactly as it found it (SC-010)', async () => {
    const before = fs.readdirSync(projectDir)
    const mod = await load()
    await mod.syncProjectContext(P, service())
    await mod.clearProjectContext(P)

    expect(fs.readdirSync(projectDir)).toEqual(before)
    expect(fs.existsSync(contextFile())).toBe(false)
  })

  it('is harmless for a project that was never linked', async () => {
    const mod = await load()
    await expect(mod.clearProjectContext(P)).resolves.toBeUndefined()
  })

  it('copes with a project whose directory has gone', async () => {
    const mod = await load()
    await mod.syncProjectContext(P, service())
    workspace.project = undefined
    await expect(mod.clearProjectContext(P)).resolves.toBeUndefined()
    expect(fs.existsSync(contextFile())).toBe(false)
  })
})

describe('previewProjectContext (FR-023)', () => {
  it('returns what a session would receive, without writing anything', async () => {
    const mod = await load()
    const preview = await mod.previewProjectContext(P, service())

    expect(preview?.markdown).toContain('TAV-42')
    expect(fs.existsSync(contextFile())).toBe(false)
    expect(fs.existsSync(settingsFile())).toBe(false)
  })

  it('matches the file that sync writes, character for character', async () => {
    const mod = await load()
    const preview = await mod.previewProjectContext(P, service())
    await mod.syncProjectContext(P, service())
    const written = JSON.parse(fs.readFileSync(contextFile(), 'utf8'))

    expect(preview?.markdown).toBe(written.markdown)
    expect(preview?.chars).toBe(written.chars)
  })

  it('is null for an unlinked project', async () => {
    link.current = null
    const mod = await load()
    await expect(mod.previewProjectContext(P, service())).resolves.toBeNull()
  })

  it('surfaces a tracker failure rather than showing a stale preview', async () => {
    const mod = await load()
    await expect(
      mod.previewProjectContext(P, service(vi.fn().mockRejectedValue(new Error('offline'))))
    ).rejects.toThrow()
  })
})

describe('ensureHookScript', () => {
  it('writes the script once and reuses the path', async () => {
    const mod = await load()
    const first = await mod.ensureHookScript()
    const second = await mod.ensureHookScript()

    expect(first).toBe(second)
    expect(fs.existsSync(first)).toBe(true)
    expect(fs.readFileSync(first, 'utf8')).toContain('SessionStart')
  })
})
