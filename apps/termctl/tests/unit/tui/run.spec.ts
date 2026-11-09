import { describe, it, expect } from 'vitest'
import { PassThrough, Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import type { CliIo, ToolClient } from '../../../src/cli'
import { toCommands, type ToolInfo } from '../../../src/command-names'
import { runTui, type TuiClock, type TuiTerminal } from '../../../src/tui/run'
import { eventually } from '../../../../../packages/test-support/src/eventually'
import appToolsJson from '../../fixtures/app-tools.json'

// A JSON import types each schema by its literal shape; the app sends them as JSON Schema.
const commands = toCommands(appToolsJson as unknown as ToolInfo[])

const DOWN = '\u001B[B'
const TAB = '\t'
const ENTER = '\r'
const ESCAPE = '\u001B'

interface Call {
  name: string
  arguments: Record<string, unknown>
}

const TASKS = [
  { id: 't1', title: 'Rate limits across services', state: 'running', branch: 'rate-limits' },
  { id: 't2', title: 'Split core into packages', state: 'needs you', branch: 'core-split' },
]

function listResults(): Record<string, unknown> {
  return {
    get_app_info: { version: '0.1.197' },
    list_workspaces: { data: [{ id: 'w1', name: 'Terminator' }] },
    list_tasks: { data: TASKS },
    list_agents: { data: [{ id: 'a1', name: 'claude' }] },
    list_terminal_sessions: { data: [] },
    list_schedules: { data: [] },
    list_notifications: { data: [] },
  }
}

/** A client that answers each tool with `results[name]` and records every call. */
function fakeClient(results: Record<string, unknown>, calls: Call[] = []): ToolClient {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async (params) => {
      calls.push(params)
      const text = JSON.stringify(results[params.name] ?? { ok: true })
      return { content: [{ type: 'text', text }] }
    },
    close: async () => {},
  }
}

/** A clock whose time and timers the test moves. */
function fakeClock() {
  const timers: Array<{ ms: number; run: () => void }> = []
  const clock = { time: 1_000_000 }
  const tuiClock: TuiClock = {
    now: () => clock.time,
    every: (ms, run) => {
      const timer = { ms, run }
      timers.push(timer)
      return () => timers.splice(timers.indexOf(timer), 1)
    },
  }
  return { clock, timers, tuiClock }
}

/** A terminal Ink can draw in and read keys from, and a clock the test moves. */
function fakeTerminal() {
  const writes: string[] = []
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin })
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        writes.push(String(chunk))
        done()
      },
    }),
    { columns: 110, rows: 30 }
  )
  const { clock, timers, tuiClock } = fakeClock()
  const terminal: TuiTerminal = {
    stdin,
    stdout,
    cwd: '/Users/me/repos/terminator',
    home: '/Users/me',
    clock: tuiClock,
  }
  const lastFrame = () =>
    stripVTControlCharacters(writes.filter((text) => text.trim() !== '').at(-1) ?? '')
  const fire = (ms: number) =>
    timers.filter((timer) => timer.ms === ms).forEach((timer) => timer.run())
  const press = (...keys: string[]) => keys.forEach((key) => stdin.write(key))
  return { terminal, clock, lastFrame, fire, press }
}

function start(client: ToolClient) {
  const screen = fakeTerminal()
  const io: CliIo = {
    stdout: { write: () => true },
    stderr: { write: () => true },
    env: {},
    ask: null,
    terminal: screen.terminal,
    connect: async () => client,
  }
  const exit = runTui({ io, client, commands })
  return { ...screen, exit }
}

describe('runTui: the lists', () => {
  it('shows the header and the six lists with their row counts', async () => {
    const { lastFrame, press, exit } = start(fakeClient(listResults()))
    await eventually(() => expect(lastFrame()).toContain('Rate limits across services'))
    const frame = lastFrame()
    expect(frame).toContain('termctl · Terminator 0.1.197 · ~/repos/terminator')
    expect(frame).toMatch(/Workspaces\s+1/)
    expect(frame).toMatch(/Tasks\s+2/)
    expect(frame).toMatch(/Agents\s+1/)
    expect(frame).toMatch(/Terminals\s+0/)
    expect(frame).toMatch(/Schedules\s+0/)
    expect(frame).toMatch(/Notifications\s+0/)
    press('q')
    await exit
  })

  it('moves the row selection with ↓ in the rows pane, and the detail follows', async () => {
    const { lastFrame, press, exit } = start(fakeClient(listResults()))
    await eventually(() => expect(lastFrame()).toMatch(/branch\s+rate-limits/))
    press(TAB, DOWN)
    await eventually(() => expect(lastFrame()).toMatch(/branch\s+core-split/))
    expect(lastFrame()).toContain('▸ t2')
    press('q')
    await exit
  })
})

describe('runTui: moving and filtering', () => {
  it('moves the list selection with ↓ in the lists pane', async () => {
    const { lastFrame, press, exit } = start(fakeClient(listResults()))
    await eventually(() => expect(lastFrame()).toContain('Rate limits across services'))
    press(DOWN)
    await eventually(() => expect(lastFrame()).toMatch(/name\s+claude/))
    expect(lastFrame()).not.toContain('Rate limits across services')
    press('q')
    await exit
  })

  it('filters the rows by the text typed after /, and Esc clears the filter', async () => {
    const { lastFrame, press, exit } = start(fakeClient(listResults()))
    await eventually(() => expect(lastFrame()).toContain('Split core into packages'))
    press('/', 's', 'p', 'l', 'i', 't')
    await eventually(() => expect(lastFrame()).not.toContain('Rate limits across services'))
    expect(lastFrame()).toContain('Split core into packages')
    press(ESCAPE)
    await eventually(() => expect(lastFrame()).toContain('Rate limits across services'))
    press('q')
    await exit
  })
})

describe('runTui: the palette', () => {
  it('runs a command from the palette with the arguments typed in its form', async () => {
    const calls: Call[] = []
    const results = { ...listResults(), create_worktree: { path: '/tmp/wt' } }
    const { lastFrame, press, exit } = start(fakeClient(results, calls))
    await eventually(() => expect(lastFrame()).toContain('Rate limits across services'))
    press(':', ...'worktree create')
    await eventually(() => expect(lastFrame()).toContain('▸ worktree create'))
    press(ENTER)
    await eventually(() => expect(lastFrame()).toContain('--repo-root (required)'))
    press(...'/repo', TAB, ...'/repo/wt', TAB, ...'wt', TAB, ...'true', ENTER)
    await eventually(() => expect(lastFrame()).toContain('/tmp/wt'))
    expect(calls).toContainEqual({
      name: 'create_worktree',
      arguments: { repoRoot: '/repo', worktreePath: '/repo/wt', branch: 'wt', isNewBranch: true },
    })
    press('q')
    await exit
  })
})

describe('runTui: form errors', () => {
  it('shows the error of a form the flags cannot parse, and does not call the tool', async () => {
    const calls: Call[] = []
    const { lastFrame, press, exit } = start(fakeClient(listResults(), calls))
    await eventually(() => expect(lastFrame()).toContain('Rate limits across services'))
    press(':', ...'worktree create')
    await eventually(() => expect(lastFrame()).toContain('▸ worktree create'))
    press(ENTER)
    await eventually(() => expect(lastFrame()).toContain('--repo-root (required)'))
    press(ENTER)
    await eventually(() => expect(lastFrame()).toContain('Missing required flag --repo-root'))
    expect(calls.map((call) => call.name)).not.toContain('create_worktree')
    press(ESCAPE)
    await eventually(() => expect(lastFrame()).not.toContain('--repo-root (required)'))
    press('q')
    await exit
  })
})

describe('runTui: destructive commands', () => {
  it('asks before a destructive command, and does not run it on n', async () => {
    const calls: Call[] = []
    const { lastFrame, press, exit } = start(fakeClient(listResults(), calls))
    await eventually(() => expect(lastFrame()).toContain('Rate limits across services'))
    press(':', ...'task delete')
    await eventually(() => expect(lastFrame()).toContain('▸ task delete'))
    press(ENTER)
    await eventually(() => expect(lastFrame()).toContain('--id (required)'))
    press(...'t1', ENTER)
    await eventually(() =>
      expect(lastFrame()).toContain('Delete task "Rate limits across services"? [y/N]')
    )
    press('n')
    await eventually(() => expect(lastFrame()).toContain('Cancelled.'))
    expect(calls.map((call) => call.name)).not.toContain('delete_task')
    press('q')
    await exit
  })
})

describe('runTui: refresh and quit', () => {
  it('reloads the lists when the refresh timer fires, and shows how long ago', async () => {
    const results = listResults()
    const { lastFrame, press, fire, clock, exit } = start(fakeClient(results))
    await eventually(() => expect(lastFrame()).toMatch(/Tasks\s+2/))
    results.list_tasks = { data: [...TASKS, { id: 't3', title: 'Docs' }] }
    fire(2000)
    await eventually(() => expect(lastFrame()).toMatch(/Tasks\s+3/))
    clock.time += 5000
    fire(1000)
    await eventually(() => expect(lastFrame()).toContain('refreshed 5s ago'))
    press('q')
    await exit
  })

  it('exits 0 on q', async () => {
    const { lastFrame, press, exit } = start(fakeClient(listResults()))
    await eventually(() => expect(lastFrame()).toContain('Rate limits across services'))
    press('q')
    expect(await exit).toBe(0)
  })
})
