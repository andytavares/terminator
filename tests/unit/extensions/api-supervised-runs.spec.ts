import { describe, it, expect, beforeEach, vi } from 'vitest'

// What an extension needs before it can own an agent run: somewhere to put a
// provisioned worktree, and a terminal the operator can actually see and type
// into. Without these an extension can create a checkout nothing displays and
// spawn a process nobody can watch — which is the whole failure this closes.

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.1.0' },
  globalShortcut: { register: vi.fn(), unregister: vi.fn(), isRegistered: vi.fn(() => false) },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))
vi.mock('../../../src/main/storage/extension-settings-store', () => ({
  getExtensionSetting: () => undefined,
  setExtensionSetting: vi.fn(),
  getAllExtensionSettings: () => ({}),
}))
vi.mock('../../../src/main/shell/shell-executor', () => ({
  execShell: vi.fn(),
  assertCommandAllowed: vi.fn(),
}))
vi.mock('../../../src/main/logger', () => ({
  makeLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('../../../src/main/storage/settings-store', () => ({
  getGlobalSettings: () => ({ terminal: { defaultShell: '/bin/zsh', scrollbackLimit: 5000 } }),
  getWorkspaceSettings: () => ({}),
}))

const projects: Array<{
  id: string
  workspaceId: string
  name: string
  worktreePath?: string
  gitBranch?: string
  isWorktree?: boolean
}> = []

/** What the store answers the next createProject with, instead of creating it. */
const refusals: Array<{ error: string }> = []

vi.mock('../../../src/main/storage/workspace-store', () => ({
  listWorkspaces: () => [{ id: 'ws-1', name: 'Alpha', folderPath: '/projects/alpha' }],
  listProjects: (workspaceId: string) => projects.filter((p) => p.workspaceId === workspaceId),
  getProjectById: (id: string) => projects.find((p) => p.id === id),
  deleteProject: vi.fn(),
  createProject: (input: Record<string, unknown>) => {
    const refusal = refusals.shift()
    if (refusal !== undefined) return refusal
    const project = { id: `proj-${projects.length + 1}`, ...input } as (typeof projects)[number]
    projects.push(project)
    return { project }
  },
}))

import { createExtensionAPI } from '../../../src/main/extensions/api'
import { onProjectDelete } from '../../../src/main/extensions/workspace-events'

interface Spawned {
  sessionId: string
  cwd: string
  type: string
  projectId?: string
  tabTitle?: string
  holdOutput?: boolean
}

let spawned: Spawned[]
let broadcasts: Array<{ channel: string; payload: Record<string, unknown> }>
let subscribedToPty: string[]
let relayed: string[]
let killed: string[]

function build(withWindow = true) {
  spawned = []
  broadcasts = []
  subscribedToPty = []
  relayed = []
  killed = []
  const ptyManager = {
    kill: (id: string) => killed.push(id),
    spawnSession: (options: Spawned) => {
      spawned.push(options)
      return options
    },
    onData: (id: string) => {
      subscribedToPty.push(id)
      return () => {}
    },
    onExit: (id: string) => {
      subscribedToPty.push(id)
      return () => {}
    },
  }
  return createExtensionAPI('test.pilot', {
    ptyManager: ptyManager as never,
    terminalRelay: { startRelaying: (id: string) => relayed.push(id) } as never,
    broadcastToWindows: withWindow
      ? (channel: string, payload: unknown) =>
          broadcasts.push({ channel, payload: payload as Record<string, unknown> })
      : undefined,
  } as never)
}

beforeEach(() => {
  projects.length = 0
  refusals.length = 0
})

describe('workspace.addProject when the store refuses', () => {
  it('names the project after its directory when the store refuses the name', async () => {
    refusals.push({ error: 'DUPLICATE_NAME' })
    const project = await build().workspace.addProject({
      workspaceId: 'ws-1',
      name: 'fix/login',
      worktreePath: '/wt/two',
    })
    expect(project).toMatchObject({ name: 'fix/login (two)' })
  })

  it('answers null when the store refuses the project for another reason', async () => {
    refusals.push({ error: 'VALIDATION_ERROR' })
    const api = build()
    const project = await api.workspace.addProject({
      workspaceId: 'ws-1',
      name: 'a',
      worktreePath: '/wt/a',
    })
    expect(project).toBeNull()
    expect(broadcasts).toEqual([])
  })
})

describe('workspace.addProject', () => {
  it('registers the directory so it appears in the sidebar', async () => {
    const api = build()
    const project = await api.workspace.addProject({
      workspaceId: 'ws-1',
      name: 'feat/session-ulid',
      worktreePath: '/wt/feat-session-ulid',
      gitBranch: 'feat/session-ulid',
    })
    expect(project).toMatchObject({ workspaceId: 'ws-1', name: 'feat/session-ulid' })
    expect(projects[0]).toMatchObject({
      worktreePath: '/wt/feat-session-ulid',
      gitBranch: 'feat/session-ulid',
      isWorktree: true,
    })
  })

  it('treats the directory as a worktree unless told otherwise', () => {
    build().workspace.addProject({ workspaceId: 'ws-1', name: 'a', worktreePath: '/wt/a' })
    expect(projects[0].isWorktree).toBe(true)
  })
})

describe('workspace.addProject — the same directory twice', () => {
  it('reuses the project already pointing at that directory', async () => {
    // Provisioning the same branch twice should land in the project you were
    // already looking at, not beside it.
    const api = build()
    const first = await api.workspace.addProject({
      workspaceId: 'ws-1',
      name: 'feat/x',
      worktreePath: '/wt/x',
    })
    const second = await api.workspace.addProject({
      workspaceId: 'ws-1',
      name: 'renamed',
      worktreePath: '/wt/x',
    })
    expect(second?.id).toBe(first?.id)
    expect(projects).toHaveLength(1)
  })
})

describe('workspace.addProject — worktrees that share a name', () => {
  it('does not merge two worktrees that happen to share a name', async () => {
    // Matching on the name as well meant two cards whose branches were called
    // the same thing got one project, pointing at whichever was registered
    // first — and the snapshot handed back described a directory the caller
    // had not asked for.
    const api = build()
    const first = await api.workspace.addProject({
      workspaceId: 'ws-1',
      name: 'fix/login',
      worktreePath: '/wt/one',
    })
    const second = await api.workspace.addProject({
      workspaceId: 'ws-1',
      name: 'fix/login',
      worktreePath: '/wt/two',
    })
    expect(second?.id).not.toBe(first?.id)
    expect(projects).toHaveLength(2)
  })

  it('tells the sidebar, which otherwise only learns on a reload', async () => {
    const api = build()
    await api.workspace.addProject({ workspaceId: 'ws-1', name: 'a', worktreePath: '/wt/a' })
    expect(broadcasts.map((b) => b.channel)).toContain('workspace:project-added')
  })
})

// v2.5.0 — an extension that registered a worktree can find and remove it
// again when the worktree goes (ADR-061).
describe('workspace.listProjects and deleteProject', () => {
  it('says which directory each project points at', async () => {
    const api = build()
    await api.workspace.addProject({ workspaceId: 'ws-1', name: 'a', worktreePath: '/wt/a' })
    expect(api.workspace.listProjects('ws-1')).toEqual([
      expect.objectContaining({ name: 'a', worktreePath: '/wt/a' }),
    ])
  })

  it('announces the deletion, so what hangs off the project is cleaned up too', () => {
    const api = build()
    const heard = vi.fn()
    const off = onProjectDelete(heard)
    api.workspace.deleteProject('proj-1')
    off()
    expect(heard).toHaveBeenCalledWith('proj-1')
  })

  it('tells the sidebar a deleted project is gone', () => {
    const api = build()
    api.workspace.deleteProject('proj-1')
    expect(broadcasts).toContainEqual({
      channel: 'workspace:project-removed',
      payload: { id: 'proj-1' },
    })
  })
})

const openInput = { projectId: 'proj-1', cwd: '/wt/a', tabTitle: 'feat/x' }

describe('pty.openTerminal', () => {
  it('spawns in the directory it was given', () => {
    build().pty.openTerminal(openInput)
    expect(spawned[0]).toMatchObject({ cwd: '/wt/a', projectId: 'proj-1', tabTitle: 'feat/x' })
  })

  it('marks it an agent terminal by default, though a person can still type in it', () => {
    build().pty.openTerminal(openInput)
    expect(spawned[0].type).toBe('agent')
  })

  it('holds output until a tab is mounted to receive it', () => {
    // The renderer has to be told, adopt it, render and mount an xterm first.
    // Delivered live, everything in that window goes to nobody.
    build().pty.openTerminal(openInput)
    expect(spawned[0].holdOutput).toBe(true)
  })

  it('tells the renderer to adopt it, or the process runs with no tab showing it', async () => {
    const api = build()
    const sessionId = await api.pty.openTerminal(openInput)
    expect(broadcasts).toContainEqual({
      channel: 'terminal:adopt',
      payload: { sessionId, projectId: 'proj-1', tabTitle: 'feat/x', scrollbackLimit: 5000 },
    })
  })
})

describe('pty.openTerminal — what it hands back and sends', () => {
  it('returns the session id, so the caller can write to it', async () => {
    expect(await build().pty.openTerminal(openInput)).toEqual(expect.any(String))
  })

  it('sends its output and exit through the shared batched, flow-controlled relay', async () => {
    const sessionId = await build().pty.openTerminal(openInput)
    expect(relayed).toEqual([sessionId])
  })

  it('does not broadcast its output or exit to every window and view', () => {
    // Each chunk used to go to every window and extension view, unbatched and
    // unacknowledged, so a chatty agent cost every one of them a message per chunk.
    build().pty.openTerminal(openInput)
    expect(subscribedToPty).toEqual([])
    expect(broadcasts.map((b) => b.channel)).toEqual(['terminal:adopt'])
  })

  it('uses the shell and scrollback it is given over the defaults', async () => {
    const api = build()
    await api.pty.openTerminal({ ...openInput, shell: '/bin/bash', scrollbackLimit: 99 })
    expect(spawned[0]).toMatchObject({ shell: '/bin/bash' })
    const adopt = broadcasts.find((b) => b.channel === 'terminal:adopt')
    expect(adopt?.payload.scrollbackLimit).toBe(99)
  })

  it('opens nothing when there is no window to show it in', async () => {
    // A terminal nobody can see is the thing this exists to prevent.
    expect(await build(false).pty.openTerminal(openInput)).toBeNull()
    expect(spawned).toEqual([])
  })
})

describe('pty.closeTerminalTab', () => {
  it('tells the renderer to close the tab, which ends the process and its record', async () => {
    const api = build()
    const sessionId = await api.pty.openTerminal({
      projectId: 'proj-1',
      cwd: '/wt/a',
      tabTitle: 'Architect',
    })
    api.pty.closeTerminalTab(sessionId as string)
    expect(broadcasts).toContainEqual({ channel: 'terminal:close-tab', payload: { sessionId } })
  })

  it('still ends the process when there is no window to close a tab in', () => {
    build(false).pty.closeTerminalTab('s-1')
    expect(killed).toEqual(['s-1'])
  })
})
