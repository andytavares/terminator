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
vi.mock('../../../src/main/fs/fs-watcher', () => ({
  fsWatcherService: { addHandler: vi.fn(), removeHandler: vi.fn() },
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

vi.mock('../../../src/main/storage/workspace-store', () => ({
  listWorkspaces: () => [{ id: 'ws-1', name: 'Alpha', folderPath: '/projects/alpha' }],
  listProjects: (workspaceId: string) => projects.filter((p) => p.workspaceId === workspaceId),
  deleteProject: vi.fn(),
  createProject: (input: Record<string, unknown>) => {
    const project = { id: `proj-${projects.length + 1}`, ...input } as (typeof projects)[number]
    projects.push(project)
    return { project }
  },
}))

import { createExtensionAPI } from '../../../src/main/extensions/api'

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
let dataListener: ((data: string) => void) | null
let exitListener: ((code: number) => void) | null

function build(withWindow = true) {
  spawned = []
  broadcasts = []
  dataListener = null
  exitListener = null
  const ptyManager = {
    spawnSession: (options: Spawned) => {
      spawned.push(options)
      return options
    },
    onData: (_id: string, l: (d: string) => void) => {
      dataListener = l
      return () => {}
    },
    onExit: (_id: string, l: (c: number) => void) => {
      exitListener = l
      return () => {}
    },
  }
  return createExtensionAPI('test.pilot', '0.1.0', {
    ptyManager: ptyManager as never,
    broadcastToWindows: withWindow
      ? (channel: string, payload: unknown) =>
          broadcasts.push({ channel, payload: payload as Record<string, unknown> })
      : undefined,
  } as never)
}

beforeEach(() => {
  projects.length = 0
})

describe('workspace.createProject', () => {
  it('registers the directory so it appears in the sidebar', () => {
    const api = build()
    const project = api.workspace.createProject({
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
    build().workspace.createProject({ workspaceId: 'ws-1', name: 'a', worktreePath: '/wt/a' })
    expect(projects[0].isWorktree).toBe(true)
  })

  it('reuses the project already pointing at that directory', () => {
    // Provisioning the same branch twice should land in the project you were
    // already looking at, not beside it.
    const api = build()
    const first = api.workspace.createProject({
      workspaceId: 'ws-1',
      name: 'feat/x',
      worktreePath: '/wt/x',
    })
    const second = api.workspace.createProject({
      workspaceId: 'ws-1',
      name: 'renamed',
      worktreePath: '/wt/x',
    })
    expect(second?.id).toBe(first?.id)
    expect(projects).toHaveLength(1)
  })

  it('tells the sidebar, which otherwise only learns on a reload', () => {
    const api = build()
    api.workspace.createProject({ workspaceId: 'ws-1', name: 'a', worktreePath: '/wt/a' })
    expect(broadcasts.map((b) => b.channel)).toContain('workspace:project-added')
  })
})

describe('pty.openTerminalTab', () => {
  const input = { projectId: 'proj-1', cwd: '/wt/a', tabTitle: 'feat/x' }

  it('spawns in the directory it was given', () => {
    build().pty.openTerminalTab(input)
    expect(spawned[0]).toMatchObject({ cwd: '/wt/a', projectId: 'proj-1', tabTitle: 'feat/x' })
  })

  it('marks it an agent terminal by default, though a person can still type in it', () => {
    build().pty.openTerminalTab(input)
    expect(spawned[0].type).toBe('agent')
  })

  it('holds output until a tab is mounted to receive it', () => {
    // The renderer has to be told, adopt it, render and mount an xterm first.
    // Delivered live, everything in that window goes to nobody.
    build().pty.openTerminalTab(input)
    expect(spawned[0].holdOutput).toBe(true)
  })

  it('tells the renderer to adopt it, or the process runs with no tab showing it', () => {
    const api = build()
    const sessionId = api.pty.openTerminalTab(input)
    expect(broadcasts).toContainEqual({
      channel: 'terminal:adopt',
      payload: { sessionId, projectId: 'proj-1', tabTitle: 'feat/x', scrollbackLimit: 5000 },
    })
  })

  it('returns the session id, so the caller can write to it', () => {
    expect(build().pty.openTerminalTab(input)).toEqual(expect.any(String))
  })

  it('relays output to the renderer', () => {
    const api = build()
    const sessionId = api.pty.openTerminalTab(input)
    dataListener?.('hello')
    expect(broadcasts).toContainEqual({
      channel: 'terminal:output',
      payload: { sessionId, data: 'hello' },
    })
  })

  it('relays exit to the renderer', () => {
    const api = build()
    const sessionId = api.pty.openTerminalTab(input)
    exitListener?.(1)
    expect(broadcasts).toContainEqual({
      channel: 'terminal:process-exit',
      payload: { sessionId, exitCode: 1 },
    })
  })

  it('uses the shell and scrollback it is given over the defaults', () => {
    const api = build()
    api.pty.openTerminalTab({ ...input, shell: '/bin/bash', scrollbackLimit: 99 })
    expect(spawned[0]).toMatchObject({ shell: '/bin/bash' })
    const adopt = broadcasts.find((b) => b.channel === 'terminal:adopt')
    expect(adopt?.payload.scrollbackLimit).toBe(99)
  })

  it('opens nothing when there is no window to show it in', () => {
    // A terminal nobody can see is the thing this exists to prevent.
    expect(build(false).pty.openTerminalTab(input)).toBeNull()
    expect(spawned).toEqual([])
  })
})
