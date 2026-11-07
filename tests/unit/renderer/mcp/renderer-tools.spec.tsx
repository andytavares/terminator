import { describe, it, expect, vi, beforeEach } from 'vitest'
import { answerCall } from '../../../../src/renderer/mcp/renderer-tools'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { installElectronApi } from '../../../support/electron-api'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import type { McpAnswer, McpCall } from '../../../../src/shared/mcp/renderer-tools'
import type { QuickAction } from '../../../../src/renderer/quick-actions/types'
import {
  SCRATCH_PROJECT_ID,
  type Project,
  type TerminalSession,
  type Workspace,
} from '../../../../src/shared/types/index'

const startWork = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/components/home/start-work', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startWork,
}))
const startGlobalPrompt = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/start-session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startGlobalPrompt,
}))
const createTerminalSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/session-controller', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createTerminalSession,
}))
const revealSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/navigate-to-session', () => ({ revealSession }))
const breakOut = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/breakout', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  breakOut,
}))

const terminator = { id: 'ws-1', name: 'terminator', folderPath: '/repos/terminator' } as Workspace
const notes = { id: 'ws-2', name: 'notes', folderPath: '/repos/notes' } as Workspace
const mainCard = { id: 'p-main', workspaceId: 'ws-1' } as Project
const worktreeCard = {
  id: 'p-feat',
  workspaceId: 'ws-1',
  worktreePath: '/repos/terminator/.worktrees/feat',
} as Project
const session = { id: 's-1', projectId: 'p-main', status: 'active' } as TerminalSession

let answer: ReturnType<typeof vi.fn<(answer: McpAnswer) => Promise<void>>>
let executeCommand: ReturnType<typeof vi.fn<ElectronAPI['extension']['executeCommand']>>
let commands: Array<{
  key: string
  extensionId: string
  id: string
  label: string
  destructive?: boolean
}>
let registeredKeys: string[]

beforeEach(() => {
  vi.clearAllMocks()
  answer = vi.fn<(answer: McpAnswer) => Promise<void>>().mockResolvedValue(undefined)
  executeCommand = vi.fn<ElectronAPI['extension']['executeCommand']>()
  commands = []
  registeredKeys = []
  installElectronApi({
    mcp: { answer },
    extension: {
      getCommands: async () => ({ commands }),
      hasCommand: async (key: string) => registeredKeys.includes(key),
      executeCommand,
    },
  })
  useWorkspaceStore.setState({
    workspaces: [terminator, notes],
    projectsByWorkspaceId: new Map([['ws-1', [mainCard, worktreeCard]]]),
  })
  useSessionStore.setState({ sessions: new Map([['s-1', session]]) })
})

/** Runs one call and returns the answer the renderer sent back. */
async function call(tool: string, args: unknown, actions: QuickAction[] = []): Promise<McpAnswer> {
  await answerCall({ id: 'c-1', tool, args } as McpCall, actions)
  expect(answer).toHaveBeenCalledTimes(1)
  return answer.mock.calls[0][0]
}

describe('answerCall — the call itself', () => {
  it('answers an unknown tool with an error that names it', async () => {
    expect(await call('format_disk', {})).toEqual({
      id: 'c-1',
      error: 'Terminator has no tool named format_disk.',
    })
  })

  it('answers bad arguments in plain words that name the argument, not a Zod dump', async () => {
    const reply = await call('open_session', { sessionId: 7 })
    expect(reply).toEqual({ id: 'c-1', error: 'These arguments are missing or wrong: sessionId.' })
  })

  it('answers a tool that throws with its message', async () => {
    breakOut.mockImplementation(() => {
      throw new Error('The window could not open.')
    })
    expect(await call('open_in_window', { sessionId: 's-1' })).toEqual({
      id: 'c-1',
      error: 'The window could not open.',
    })
  })
})

describe('answerCall — open_session and open_in_window', () => {
  it('shows the session and answers its id', async () => {
    expect(await call('open_session', { sessionId: 's-1' })).toEqual({
      id: 'c-1',
      result: { sessionId: 's-1' },
    })
    expect(revealSession).toHaveBeenCalledWith('s-1')
  })

  it('refuses a session id that does not exist', async () => {
    expect(await call('open_session', { sessionId: 'nope' })).toEqual({
      id: 'c-1',
      error: 'No session has the id nope.',
    })
    expect(revealSession).not.toHaveBeenCalled()
  })

  it('moves the session into its own window', async () => {
    await call('open_in_window', { sessionId: 's-1' })
    expect(breakOut).toHaveBeenCalledWith('s-1')
  })

  it('refuses to move a session that does not exist', async () => {
    expect(await call('open_in_window', { sessionId: 'nope' })).toMatchObject({
      error: 'No session has the id nope.',
    })
    expect(breakOut).not.toHaveBeenCalled()
  })
})

describe('answerCall — open_terminal', () => {
  beforeEach(() => {
    createTerminalSession.mockResolvedValue('t-1')
  })

  it('opens the tab on the card whose folder holds cwd, runs the command and shows it', async () => {
    const reply = await call('open_terminal', {
      cwd: '/repos/terminator/.worktrees/feat/src',
      command: 'claude --resume abc',
    })
    expect(reply).toEqual({ id: 'c-1', result: { sessionId: 't-1' } })
    expect(createTerminalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p-feat',
        cwd: '/repos/terminator/.worktrees/feat/src',
        initialCommand: 'claude --resume abc',
      })
    )
    expect(revealSession).toHaveBeenCalledWith('t-1')
  })
})

describe('answerCall — open_terminal, in Scratch', () => {
  beforeEach(() => {
    createTerminalSession.mockResolvedValue('t-1')
  })

  it('opens a folder that no workspace holds in Scratch', async () => {
    await call('open_terminal', { cwd: '/tmp/elsewhere' })
    expect(createTerminalSession).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: SCRATCH_PROJECT_ID, cwd: '/tmp/elsewhere' })
    )
  })

  it('does not count a sibling folder that shares a prefix as inside the workspace', async () => {
    await call('open_terminal', { cwd: '/repos/terminator-old' })
    expect(createTerminalSession).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: SCRATCH_PROJECT_ID })
    )
  })
})

describe('answerCall — open_terminal, refusals', () => {
  it('refuses an unknown workspace and names the known ones', async () => {
    expect(await call('open_terminal', { cwd: '/repos/notes', workspace: 'work' })).toMatchObject({
      error: 'No workspace is named work. The workspaces are: terminator, notes.',
    })
    expect(createTerminalSession).not.toHaveBeenCalled()
  })

  it('answers in plain words when the terminal does not open', async () => {
    createTerminalSession.mockImplementation(async () => {
      throw new Error('pty spawn EACCES')
    })
    expect(await call('open_terminal', { cwd: '/tmp' })).toMatchObject({
      error: 'The terminal could not be opened.',
    })
  })
})

describe('answerCall — start_work, with no workspace', () => {
  it('starts a prompt with no workspace in Scratch and answers the new session id', async () => {
    startGlobalPrompt.mockResolvedValue('g-1')
    expect(await call('start_work', { prompt: 'Sum up the PRs' })).toEqual({
      id: 'c-1',
      result: { sessionId: 'g-1' },
    })
    expect(startGlobalPrompt).toHaveBeenCalledWith({ text: 'Sum up the PRs', runAs: 'agent' })
  })
})

describe('answerCall — start_work', () => {
  it('starts in the workspace named, on the branch given, and answers the session it opened', async () => {
    startWork.mockImplementation(async () => {
      const sessions = new Map(useSessionStore.getState().sessions)
      sessions.set('s-2', { ...session, id: 's-2' })
      useSessionStore.setState({ sessions })
      return null
    })
    const reply = await call('start_work', {
      prompt: 'Fix the bug',
      workspace: 'terminator',
      runAs: 'claude-terminal',
      branch: 'fix/bug',
    })
    expect(reply).toEqual({ id: 'c-1', result: { sessionId: 's-2' } })
    expect(startWork).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'prompt',
        text: 'Fix the bug',
        workspace: terminator,
        runAs: 'claude-terminal',
        newWorktree: true,
        branch: 'fix/bug',
      })
    )
  })
})

describe('answerCall — start_work, in a workspace', () => {
  it('finds the workspace by id too', async () => {
    startWork.mockResolvedValue(null)
    await call('start_work', { prompt: 'Tidy', workspace: 'ws-2' })
    expect(startWork).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: notes, newWorktree: false })
    )
  })

  it('answers why Start work refused', async () => {
    startWork.mockResolvedValue('The agent could not be started.')
    expect(await call('start_work', { prompt: 'x', workspace: 'notes' })).toMatchObject({
      error: 'The agent could not be started.',
    })
  })

  it('refuses an unknown workspace and names the known ones', async () => {
    expect(await call('start_work', { prompt: 'x', workspace: 'work' })).toMatchObject({
      error: 'No workspace is named work. The workspaces are: terminator, notes.',
    })
    expect(startWork).not.toHaveBeenCalled()
  })
})

function action(overrides: Partial<QuickAction> = {}): QuickAction {
  return { id: 'core.new-tab', label: 'New tab', group: 'terminal', run: vi.fn(), ...overrides }
}

describe('answerCall — list_quick_actions', () => {
  it('lists each action with its mark and why it is disabled', async () => {
    const clear = { id: 'core.clear', label: 'Clear', destructive: true as const }
    const actions = [
      action({ description: 'A shell' }),
      action({ ...clear, disabledReason: 'No terminal' }),
    ]
    const { result } = (await call('list_quick_actions', {}, actions)) as { result: unknown[] }
    const shown = { group: 'terminal', description: undefined, disabledReason: undefined }
    expect(result).toEqual([
      {
        ...shown,
        id: 'core.new-tab',
        label: 'New tab',
        description: 'A shell',
        destructive: false,
      },
      { ...shown, ...clear, disabledReason: 'No terminal' },
    ])
  })
})

describe('answerCall — quick actions', () => {
  it('runs a plain action by id', async () => {
    const newTab = action()
    expect(await call('run_quick_action', { id: 'core.new-tab' }, [newTab])).toEqual({
      id: 'c-1',
      result: { ran: 'core.new-tab' },
    })
    expect(newTab.run).toHaveBeenCalled()
  })

  it('refuses a destructive action on the plain tool and names the destructive one', async () => {
    const clear = action({ id: 'core.clear', label: 'Clear', destructive: true })
    expect(await call('run_quick_action', { id: 'core.clear' }, [clear])).toMatchObject({
      error: 'Clear closes or deletes something. Run it with run_destructive_quick_action.',
    })
    expect(clear.run).not.toHaveBeenCalled()
  })

  it('runs a destructive action on the destructive tool', async () => {
    const clear = action({ id: 'core.clear', label: 'Clear', destructive: true })
    await call('run_destructive_quick_action', { id: 'core.clear' }, [clear])
    expect(clear.run).toHaveBeenCalled()
  })
})

describe('answerCall — quick actions, refusals', () => {
  it('refuses a plain action on the destructive tool, so the marks stay honest', async () => {
    const newTab = action()
    expect(
      await call('run_destructive_quick_action', { id: 'core.new-tab' }, [newTab])
    ).toMatchObject({
      error: 'New tab does not close or delete anything. Run it with run_quick_action.',
    })
    expect(newTab.run).not.toHaveBeenCalled()
  })

  it('refuses a disabled action with its reason', async () => {
    const newTab = action({ disabledReason: 'No project focused' })
    expect(await call('run_quick_action', { id: 'core.new-tab' }, [newTab])).toMatchObject({
      error: 'New tab cannot run now: No project focused.',
    })
    expect(newTab.run).not.toHaveBeenCalled()
  })

  it('refuses an id that is not a quick action', async () => {
    expect(await call('run_quick_action', { id: 'core.nope' }, [action()])).toMatchObject({
      error: 'No quick action has the id core.nope. list_quick_actions lists them.',
    })
  })
})

const PUSH = 'git.command.push'
const DISCARD = 'git.command.discard'

/** Push and Discard listed, and Foundry's start-order, which takes args, registered only. */
function registerCommands(): void {
  registeredKeys = [PUSH, DISCARD, 'foundry.command.start-order']
  commands = [
    { key: PUSH, extensionId: 'git', id: 'push', label: 'Push' },
    { key: DISCARD, extensionId: 'git', id: 'discard', label: 'Discard', destructive: true },
  ]
}

describe('answerCall — extension commands', () => {
  beforeEach(registerCommands)

  it('runs a plain command with its args', async () => {
    const reply = await call('run_extension_command', { command: PUSH, args: { force: false } })
    expect(reply).toEqual({ id: 'c-1', result: { ran: PUSH } })
    expect(executeCommand).toHaveBeenCalledWith(
      PUSH,
      { projectId: null, sessionId: null, repoRoot: null },
      { force: false }
    )
  })

  it('runs a command that takes args, which no list carries', async () => {
    await call('run_extension_command', { command: 'foundry.command.start-order' })
    expect(executeCommand).toHaveBeenCalledWith(
      'foundry.command.start-order',
      expect.anything(),
      undefined
    )
  })

  it('refuses a destructive command on the plain tool and names the destructive one', async () => {
    expect(await call('run_extension_command', { command: DISCARD })).toMatchObject({
      error: 'Discard closes or deletes something. Run it with run_destructive_extension_command.',
    })
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('runs a destructive command on the destructive tool', async () => {
    await call('run_destructive_extension_command', { command: DISCARD })
    expect(executeCommand).toHaveBeenCalledWith(DISCARD, expect.anything(), undefined)
  })
})

describe('answerCall — extension commands, refusals', () => {
  beforeEach(registerCommands)

  it('refuses a plain command on the destructive tool', async () => {
    expect(await call('run_destructive_extension_command', { command: PUSH })).toMatchObject({
      error: 'Push does not close or delete anything. Run it with run_extension_command.',
    })
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('refuses a command that no running extension registered', async () => {
    expect(await call('run_extension_command', { command: 'git.command.nope' })).toMatchObject({
      error:
        'No running extension has the command git.command.nope. list_extension_commands lists them.',
    })
  })
})
