import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { once } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SessionRecord } from '../../../src/shared/types/index'
import { makeTempDir } from '../../support/temp-dir'
import { eventually } from '../../support/eventually'

// Every watch the code under test opens, so a test can wait for one to close.
const watchers = vi.hoisted(() => [] as import('node:fs').FSWatcher[])
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  const watch = ((...args: Parameters<typeof real.watch>) => {
    const watcher = real.watch(...args)
    watchers.push(watcher)
    return watcher
  }) as typeof real.watch
  return { ...real, default: { ...real, watch }, watch }
})

let userData: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

/** Every record the real store announced, in order. */
let recorded: SessionRecord[]

async function load() {
  vi.resetModules()
  const records = await import('../../../src/main/sessions/session-record-store')
  records.onRecordChange((_id, record) => {
    if (record !== null) recorded.push(record)
  })
  return import('../../../src/main/agents/agent-session-watcher')
}

/** The conversation each recorded session holds, as the store announced it. */
const conversations = () => recorded.map((r) => [r.sessionId, r.agent?.sessionId])

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
  recorded = []
  userData = makeTempDir('agent-watch-')
  dir = path.join(userData, 'agent-sessions')
})

afterEach(() => stop?.())

async function write(terminal: string, sessionId: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${terminal}.json`), JSON.stringify(report(terminal, sessionId)))
}

/** Waits for the watcher to have folded something in, rather than for a fixed time. */
async function folded(times = 1): Promise<void> {
  await eventually(() => expect(recorded).toHaveLength(times))
}

/** Waits until the watcher has passed over everything written so far, for asserting it did not
 * record something: a placeable report written last is recorded only after the pass that read the
 * files written before it, and a pass runs to its end before the next record can be observed. */
async function drained(): Promise<void> {
  await write('sentinel', 'conv-sentinel')
  await folded(recorded.length + 1)
}

const SENTINEL = ['sentinel', 'conv-sentinel']

/** Places every terminal but `gone`. */
const placeAllBut = (unplaced: string) => (id: string) => (id === unplaced ? null : snapshot(id))

describe('the agent session watcher', () => {
  it('records a conversation reported for a session it can place', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    await write('sess-1', 'conv-1')
    await folded()
    expect(recorded[0]).toMatchObject({
      ...snapshot('sess-1'),
      agent: {
        agentId: 'claude',
        transport: 'tui',
        sessionId: 'conv-1',
        capturedAt: '2026-09-15T18:00:00.000Z',
      },
    })
  })

  it('reads what is already there when it starts', async () => {
    await write('sess-1', 'conv-0')
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    await folded()
    await drained()
    expect(conversations()).toEqual([['sess-1', 'conv-0'], SENTINEL])
  })
})

describe('the agent session watcher — several conversations and terminals', () => {
  it('follows a second conversation in the same terminal', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    await write('sess-1', 'conv-1')
    await folded()
    await write('sess-1', 'conv-2')
    await folded(2)
    expect(conversations()).toEqual([
      ['sess-1', 'conv-1'],
      ['sess-1', 'conv-2'],
    ])
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
    expect(conversations()).toEqual(
      expect.arrayContaining([
        ['sess-1', 'conv-1'],
        ['sess-2', 'conv-2'],
      ])
    )
  })
})

describe('the agent session watcher — unplaceable reports and stopping', () => {
  it('ignores a report for a session it cannot place', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: placeAllBut('gone') })
    await write('gone', 'conv-1')
    await drained()
    expect(conversations()).toEqual([SENTINEL])
  })

  it('ignores a file it cannot read, and keeps watching', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'sess-1.json'), 'not json')
    await drained()
    expect(conversations()).toEqual([SENTINEL])
    await write('sess-2', 'conv-2')
    await folded(2)
  })
})

describe('the agent session watcher — stopping', () => {
  it('stops watching when told to', async () => {
    const mod = await load()
    watchers.length = 0
    const off = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    // A closed watch delivers nothing more: its own close event is the signal, not time.
    const closed = watchers.map((watcher) => once(watcher, 'close'))
    off()
    stop = undefined
    await Promise.all(closed)
    await write('sess-1', 'conv-1')
    expect(closed.length).toBeGreaterThan(0)
    expect(recorded).toEqual([])
    expect(fs.readdirSync(dir)).toEqual(['sess-1.json'])
  })
})

describe('the agent session watcher — deleting reports', () => {
  it('ignores anything in the directory that is not a report', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello')
    await drained()
    expect(conversations()).toEqual([SENTINEL])
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
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.json'))).toEqual([])
    expect(recorded).toEqual([])
  })
})

describe('the agent session watcher — startup and other files', () => {
  it('records a report found at startup once, and deletes it', async () => {
    await write('sess-1', 'conv-0')
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    await folded()
    await drained()
    expect(conversations()).toEqual([['sess-1', 'conv-0'], SENTINEL])
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('keeps a file that is not a report, so nothing but reports is ever deleted', async () => {
    const mod = await load()
    stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello')
    await drained()
    expect(fs.readdirSync(dir)).toEqual(['notes.txt'])
  })

  it('keeps no timer once it has stopped probing for an armed watch', async () => {
    vi.useFakeTimers()
    try {
      const mod = await load()
      stop = mod.startAgentSessionWatcher({ snapshotFor: (id) => snapshot(id) })
      vi.advanceTimersByTime(2_000)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
