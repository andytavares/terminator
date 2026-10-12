import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let userData: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const store = vi.hoisted(() => ({ setAgent: vi.fn().mockResolvedValue(null) }))
vi.mock('../../../src/main/sessions/session-record-store', () => ({ setAgent: store.setAgent }))

async function load() {
  vi.resetModules()
  return import('../../../src/main/agents/agent-session-watcher')
}

const snapshot = (sessionId: string) => ({
  sessionId,
  projectId: 'p1',
  workspaceName: 'Repo',
  projectName: 'main',
  branch: 'main',
  tabTitle: 'claude',
  shell: '/bin/zsh',
  startedAt: '2026-09-15T10:00:00.000Z',
})

const report = (terminal: string, sessionId: string) => ({
  terminal,
  provider: 'claude',
  sessionId,
  transcriptPath: '/transcripts/x.jsonl',
  cwd: '/code/repo',
  source: 'startup',
  at: '2026-09-15T18:00:00.000Z',
})

let stop: (() => void) | undefined
let dir: string

beforeEach(() => {
  vi.clearAllMocks()
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-watch-'))
  dir = path.join(userData, 'agent-sessions')
})

afterEach(() => stop?.())

async function write(terminal: string, sessionId: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${terminal}.json`), JSON.stringify(report(terminal, sessionId)))
}

/** Waits for the watcher to have folded something in, rather than for a fixed time. */
async function folded(times = 1): Promise<void> {
  await vi.waitFor(() => expect(store.setAgent).toHaveBeenCalledTimes(times), {
    timeout: 4000,
    interval: 20,
  })
}

/** Long enough for a watch event to have arrived, for asserting one did not. */
async function quiet(): Promise<void> {
  await new Promise((r) => setTimeout(r, 400))
}

describe('the agent session watcher', () => {
  it('records a conversation reported for a session it can place', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    await write('sess-1', 'conv-1')
    await folded()
    expect(store.setAgent).toHaveBeenCalledWith(
      snapshot('sess-1'),
      expect.objectContaining({ provider: 'claude', sessionId: 'conv-1' })
    )
  })

  it('reads what is already there when it starts', async () => {
    await write('sess-1', 'conv-0')
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    await folded()
    await quiet()
    expect(store.setAgent).toHaveBeenCalledTimes(1)
  })

  it('follows a second conversation in the same terminal', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    await write('sess-1', 'conv-1')
    await folded()
    await write('sess-1', 'conv-2')
    await folded(2)
    expect(store.setAgent).toHaveBeenLastCalledWith(
      snapshot('sess-1'),
      expect.objectContaining({ sessionId: 'conv-2' })
    )
  })

  // Two agents on one branch is the ordinary case, not an edge: the reports
  // are keyed by terminal, so each conversation lands on its own session and
  // neither takes the other's.
  it('keeps two terminals on one branch apart', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    await write('sess-1', 'conv-1')
    await write('sess-2', 'conv-2')
    await folded(2)
    expect(store.setAgent).toHaveBeenCalledWith(
      snapshot('sess-1'),
      expect.objectContaining({ sessionId: 'conv-1' })
    )
    expect(store.setAgent).toHaveBeenCalledWith(
      snapshot('sess-2'),
      expect.objectContaining({ sessionId: 'conv-2' })
    )
  })

  it('ignores a report for a session it cannot place', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: () => null })
    await write('gone', 'conv-1')
    await quiet()
    expect(store.setAgent).not.toHaveBeenCalled()
  })

  it('ignores a file it cannot read, and keeps watching', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'sess-1.json'), 'not json')
    await quiet()
    expect(store.setAgent).not.toHaveBeenCalled()
    await write('sess-2', 'conv-2')
    await folded()
  })

  it('stops watching when told to', async () => {
    const mod = await load()
    const off = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    off()
    stop = undefined
    await write('sess-1', 'conv-1')
    await quiet()
    expect(store.setAgent).not.toHaveBeenCalled()
  })

  it('ignores anything in the directory that is not a report', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello')
    await quiet()
    expect(store.setAgent).not.toHaveBeenCalled()
  })

  it('deletes a report once it has been recorded', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    await write('sess-1', 'conv-1')
    await folded()
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('deletes a report it cannot place instead of keeping it for later', async () => {
    await write('gone', 'conv-1')
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: () => null })
    expect(fs.readdirSync(dir)).toEqual([])
    expect(store.setAgent).not.toHaveBeenCalled()
  })

  it('records a report found at startup once, and deletes it', async () => {
    await write('sess-1', 'conv-0')
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    await quiet()
    expect(store.setAgent).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('keeps a file that is not a report, so nothing but reports is ever deleted', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello')
    await quiet()
    expect(fs.readdirSync(dir)).toEqual(['notes.txt'])
  })

  it('does not sweep on a timer', async () => {
    vi.useFakeTimers()
    try {
      const mod = await load()
      stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
