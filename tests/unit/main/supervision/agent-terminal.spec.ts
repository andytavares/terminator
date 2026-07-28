import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LaunchSpec } from '../../../../src/main/supervision/agent-runtime/claude-launch.js'
import type { TerminalPlacement } from '../../../../src/main/supervision/agent-runtime/driver-contract.js'

// What turns a supervised session into something the operator can see: a
// project in their workspace and a terminal in it. Asserted through the two
// collaborators it has — the pty manager and the window — because "the agent is
// visible" means exactly "a PTY was spawned and the renderer was told".

const projects: Array<{
  id: string
  workspaceId: string
  name: string
  worktreePath?: string
  isWorktree: boolean
}> = []

vi.mock('../../../../src/main/storage/workspace-store.js', () => ({
  listProjects: (workspaceId: string) => projects.filter((p) => p.workspaceId === workspaceId),
  createProject: (input: {
    workspaceId: string
    name: string
    worktreePath?: string
    gitBranch?: string
  }) => {
    const project = {
      id: `project-${projects.length + 1}`,
      workspaceId: input.workspaceId,
      name: input.name,
      worktreePath: input.worktreePath,
      isWorktree: true,
    }
    projects.push(project)
    return { project }
  },
}))

const { createAgentTerminal } = await import('../../../../src/main/supervision/agent-terminal.js')

interface Spawned {
  sessionId: string
  cwd: string
  type: string
  projectId?: string
  tabTitle?: string
}

let spawned: Spawned[]
let killed: string[]
let written: Array<{ sessionId: string; data: string }>
let sent: Array<{ channel: string; payload: Record<string, unknown> }>
let spawnThrows: boolean
let hasWindow: boolean
let windowDestroyed: boolean
let dataListener: ((data: string) => void) | null
let exitListener: ((exitCode: number) => void) | null

function build() {
  const ptyManager = {
    spawnSession: (options: Spawned) => {
      if (spawnThrows) throw new Error('no such directory')
      spawned.push(options)
      return options
    },
    onData: (_sessionId: string, listener: (data: string) => void) => {
      dataListener = listener
      return () => {}
    },
    onExit: (_sessionId: string, listener: (exitCode: number) => void) => {
      exitListener = listener
      return () => {}
    },
    write: (sessionId: string, data: string) => written.push({ sessionId, data }),
    kill: (sessionId: string) => killed.push(sessionId),
  }

  const window = {
    isDestroyed: () => windowDestroyed,
    webContents: {
      send: (channel: string, payload: Record<string, unknown>) => sent.push({ channel, payload }),
    },
  }

  return createAgentTerminal({
    ptyManager: ptyManager as never,
    getWindow: () => (hasWindow ? (window as never) : null),
    defaultShell: () => '/bin/zsh',
    scrollbackLimit: () => 5_000,
  })
}

const spec: LaunchSpec = {
  sessionId: 'session-1',
  cwd: '/tmp/wt/FLU-220-fluent',
  command: 'claude --session-id session-1',
  settingsPath: '/tmp/settings.json',
  transcriptPath: '/tmp/transcript.jsonl',
}

const placement: TerminalPlacement = {
  workspaceId: 'workspace-1',
  branch: 'feat/session-ulid',
  repoPath: '/repos/fluent',
}

beforeEach(() => {
  projects.length = 0
  spawned = []
  killed = []
  written = []
  sent = []
  spawnThrows = false
  hasWindow = true
  windowDestroyed = false
  dataListener = null
  exitListener = null
})

const openedEvent = () => sent.find((entry) => entry.channel === 'supervision:terminalOpened')

describe('opening a terminal for a session', () => {
  it('registers the working copy as a project in the operator’s workspace', async () => {
    await build().open(spec, placement)
    expect(projects).toEqual([
      expect.objectContaining({
        workspaceId: 'workspace-1',
        name: 'feat/session-ulid',
        worktreePath: '/tmp/wt/FLU-220-fluent',
        isWorktree: true,
      }),
    ])
  })

  it('names the project after the branch, which is what the operator called the work', async () => {
    await build().open(spec, placement)
    expect(projects[0].name).toBe('feat/session-ulid')
  })

  it('reuses the project when one already points at the same working copy', async () => {
    projects.push({
      id: 'existing',
      workspaceId: 'workspace-1',
      name: 'something else',
      worktreePath: '/tmp/wt/FLU-220-fluent',
      isWorktree: true,
    })
    const opened = await build().open(spec, placement)
    expect(projects).toHaveLength(1)
    expect(opened?.projectId).toBe('existing')
  })

  it('spawns the terminal in the working copy', async () => {
    await build().open(spec, placement)
    expect(spawned[0]).toMatchObject({ cwd: '/tmp/wt/FLU-220-fluent' })
  })

  it('marks it an agent’s terminal, even though a person can type in it', async () => {
    await build().open(spec, placement)
    expect(spawned[0].type).toBe('agent')
  })

  it('puts the terminal in the project it just registered', async () => {
    const opened = await build().open(spec, placement)
    expect(spawned[0].projectId).toBe(opened?.projectId)
  })

  it('tells the renderer to adopt it, or the terminal runs with no tab showing it', async () => {
    const opened = await build().open(spec, placement)
    expect(openedEvent()?.payload).toMatchObject({
      sessionId: 'session-1',
      terminalSessionId: opened?.terminalSessionId,
      projectId: opened?.projectId,
      workspaceId: 'workspace-1',
      tabTitle: 'feat/session-ulid',
      scrollbackLimit: 5_000,
    })
  })

  it('says where the terminal ended up', async () => {
    const opened = await build().open(spec, placement)
    expect(opened?.terminalSessionId).toEqual(expect.any(String))
    expect(opened?.projectId).toBe('project-1')
  })
})

describe('when there is no workspace to file it under', () => {
  it('still opens the terminal — an unfiled agent beats an invisible one', async () => {
    const opened = await build().open(spec, { ...placement, workspaceId: null })
    expect(opened?.terminalSessionId).toEqual(expect.any(String))
    expect(opened?.projectId).toBeNull()
  })

  it('creates no project', async () => {
    await build().open(spec, { ...placement, workspaceId: null })
    expect(projects).toEqual([])
  })

  it('falls back to the working copy’s own name when there is no placement at all', async () => {
    await build().open(spec)
    expect(spawned[0].tabTitle).toBe('FLU-220-fluent')
  })
})

describe('when the terminal cannot be opened', () => {
  it('reports that rather than pretending a session started', async () => {
    spawnThrows = true
    expect(await build().open(spec, placement)).toBeNull()
  })

  it('tells the renderer nothing, because nothing was opened', async () => {
    spawnThrows = true
    await build().open(spec, placement)
    expect(openedEvent()).toBeUndefined()
  })
})

describe('with no window to tell', () => {
  it('still opens the terminal', async () => {
    hasWindow = false
    expect(await build().open(spec, placement)).not.toBeNull()
  })

  it('closes without blowing up', async () => {
    hasWindow = false
    expect(() => build().close('terminal-1')).not.toThrow()
  })
})

describe('typing and closing', () => {
  it('types into the terminal', () => {
    build().write('terminal-1', 'claude\r')
    expect(written).toEqual([{ sessionId: 'terminal-1', data: 'claude\r' }])
  })

  it('kills the terminal when the session is discarded', () => {
    build().close('terminal-1')
    expect(killed).toEqual(['terminal-1'])
  })

  it('tells the renderer to drop the tab, whose working copy is about to go', () => {
    build().close('terminal-1')
    expect(sent).toContainEqual({
      channel: 'supervision:terminalClosed',
      payload: { terminalSessionId: 'terminal-1' },
    })
  })
})

describe('relaying what the terminal does', () => {
  it('sends its output to the renderer, or the tab shows an empty terminal', async () => {
    await build().open(spec, placement)
    dataListener?.('hello from claude')
    expect(sent).toContainEqual({
      channel: 'terminal:output',
      payload: { sessionId: spawned[0].sessionId, data: 'hello from claude' },
    })
  })

  it('sends its exit to the renderer', async () => {
    await build().open(spec, placement)
    exitListener?.(1)
    expect(sent).toContainEqual({
      channel: 'terminal:process-exit',
      payload: { sessionId: spawned[0].sessionId, exitCode: 1 },
    })
  })

  it('says nothing to a window that has gone away', async () => {
    await build().open(spec, placement)
    windowDestroyed = true
    sent.length = 0
    dataListener?.('output after close')
    exitListener?.(0)
    expect(sent).toEqual([])
  })

  it('opens without telling a window that has gone away', async () => {
    windowDestroyed = true
    expect(await build().open(spec, placement)).not.toBeNull()
    expect(openedEvent()).toBeUndefined()
  })

  it('closes without telling a window that has gone away', () => {
    windowDestroyed = true
    build().close('terminal-1')
    expect(killed).toEqual(['terminal-1'])
    expect(sent).toEqual([])
  })
})
