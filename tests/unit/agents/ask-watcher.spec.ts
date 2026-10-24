import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../support/temp-dir'
import { eventually } from '../../support/eventually'

let userData: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

type Change = [string, { message: string; since: string } | null]
let changes: Change[]
let turns: Array<[string, boolean]>
let stop: (() => void) | undefined
let asksDir: string

async function load() {
  vi.resetModules()
  const mod = await import('../../../src/main/agents/ask-watcher')
  mod.onAskChange((id, ask) => changes.push([id, ask]))
  const agentTurns = await import('../../../src/main/agents/agent-turns')
  agentTurns.onTurnChange((id, inTurn) => turns.push([id, inTurn]))
  return { ...mod, ...agentTurns }
}

beforeEach(() => {
  changes = []
  turns = []
  userData = makeTempDir('ask-watch-')
  asksDir = path.join(userData, 'agent-sessions', 'asks')
})
afterEach(() => stop?.())

let written = 0

// Named as the hook names them: the time it wrote, then a tie-breaker.
function write(terminal: string, report: Record<string, unknown>, name?: string): void {
  fs.mkdirSync(asksDir, { recursive: true })
  written += 1
  fs.writeFileSync(
    path.join(asksDir, name ?? `${String(1_000_000 + written)}-${terminal}.json`),
    JSON.stringify({ terminal, at: '2026-10-18T10:00:00.000Z', message: '', ...report })
  )
}

const seen = (count: number) => eventually(() => expect(changes).toHaveLength(count))

describe('the ask watcher', () => {
  it('raises an ask from a notification, and lifts it on stop', async () => {
    const mod = await load()
    stop = mod.startAskWatcher()
    write('s1', {
      event: 'notification',
      message: 'Allow Bash?',
      notificationType: 'permission_prompt',
    })
    await seen(1)
    expect(changes[0]).toEqual([
      's1',
      { message: 'Allow Bash?', since: '2026-10-18T10:00:00.000Z' },
    ])
    expect(mod.currentAsks()).toHaveLength(1)
    write('s1', { event: 'stop' })
    await seen(2)
    expect(changes[1]).toEqual(['s1', null])
    expect(mod.currentAsks()).toEqual([])
  })

  it('does not raise an ask for an idle prompt', async () => {
    const mod = await load()
    stop = mod.startAskWatcher()
    write('s1', { event: 'notification', notificationType: 'idle_prompt' })
    write('s2', { event: 'notification', message: 'Q?', notificationType: 'elicitation_dialog' })
    // One pass over the directory handles both files, so s2 announced means s1 was passed over.
    await seen(1)
    expect(changes.map((c) => c[0])).toEqual(['s2'])
  })
})

describe('the ask watcher — answers and leftovers', () => {
  it('lifts the ask when the operator types, but not on a focus report', async () => {
    const mod = await load()
    stop = mod.startAskWatcher()
    write('s1', { event: 'notification', message: 'Allow?' })
    await seen(1)
    mod.noteTerminalInput('s1', '\x1b[I')
    expect(mod.currentAsks()).toHaveLength(1)
    mod.noteTerminalInput('s1', 'y')
    expect(changes[1]).toEqual(['s1', null])
    mod.noteTerminalInput('s1', 'y')
    expect(changes).toHaveLength(2)
  })

  it('discards a file left by an earlier run and a file that is not a report', async () => {
    write('old', { event: 'notification', message: 'stale' })
    const mod = await load()
    stop = mod.startAskWatcher()
    fs.writeFileSync(path.join(asksDir, 'junk.json'), 'not json')
    write('s1', { event: 'notification', message: 'Q?', notificationType: 'elicitation_dialog' })
    // s1 is a real ask written after the junk: once it is announced the pass has seen both.
    await seen(1)
    expect(changes.map((c) => c[0])).toEqual(['s1'])
    expect(fs.readdirSync(asksDir)).toEqual([])
  })
})

describe('the ask watcher — turns', () => {
  it('puts a turn on at a prompt and off at a stop, and a notification leaves it alone', async () => {
    const mod = await load()
    stop = mod.startAskWatcher()
    write('s1', { event: 'prompt' })
    await eventually(() => expect(turns).toEqual([['s1', true]]))
    write('s1', { event: 'notification', message: 'Allow?' })
    await seen(1)
    expect(turns).toEqual([['s1', true]])
    expect(mod.currentTurns()).toEqual([{ sessionId: 's1', inTurn: true }])
    write('s1', { event: 'stop' })
    await eventually(() =>
      expect(turns).toEqual([
        ['s1', true],
        ['s1', false],
      ])
    )
    expect(mod.currentTurns()).toEqual([{ sessionId: 's1', inTurn: false }])
  })

  it('lifts the ask at a prompt: the operator just answered', async () => {
    const mod = await load()
    stop = mod.startAskWatcher()
    write('s1', { event: 'notification', message: 'Allow?' })
    await seen(1)
    write('s1', { event: 'prompt' })
    await seen(2)
    expect(changes[1]).toEqual(['s1', null])
    expect(mod.currentAsks()).toEqual([])
  })
})

describe('the ask watcher — events in a row', () => {
  it('applies the events it finds together oldest first, whatever order they were listed in', async () => {
    const mod = await load()
    stop = mod.startAskWatcher()
    write('s1', { event: 'stop' }, '1761300000002-41.json')
    write('s1', { event: 'notification', message: 'Allow?' }, '1761300000001-40.json')
    await seen(2)
    expect(changes.map((c) => c[1] && c[1].message)).toEqual(['Allow?', null])
    expect(mod.currentAsks()).toEqual([])
  })
})

describe('the ask watcher — interrupts', () => {
  it('ends the turn when the operator presses Esc or Ctrl+C, which send no Stop', async () => {
    const mod = await load()
    stop = mod.startAskWatcher()
    write('s1', { event: 'prompt' })
    await eventually(() => expect(turns).toEqual([['s1', true]]))
    mod.noteTerminalInput('s1', 'more context')
    expect(mod.currentTurns()).toEqual([{ sessionId: 's1', inTurn: true }])
    mod.noteTerminalInput('s1', '\x1b')
    expect(mod.currentTurns()).toEqual([{ sessionId: 's1', inTurn: false }])
    write('s1', { event: 'prompt' })
    await eventually(() => expect(mod.currentTurns()).toEqual([{ sessionId: 's1', inTurn: true }]))
    mod.noteTerminalInput('s1', '\x03')
    expect(mod.currentTurns()).toEqual([{ sessionId: 's1', inTurn: false }])
  })
})
