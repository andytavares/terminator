import { describe, it, expect, vi } from 'vitest'
import type { AgentUpdate } from '@terminator/extension-sdk'
import { createStallWatcher, factsFrom, type WatchedRun } from '../../src/runtime/stall-watcher.js'
import type { StallFiring } from '../../src/runtime/evaluate-stall.js'
import type { ToolActivity } from '../../src/runtime/transcript-tailer.js'
import { trackToolActivity } from '../../src/runtime/tool-activity.js'

// A run that is blocked tells you: it raises a permission request and the board
// lights up. A run that has simply gone quiet tells you nothing, and looks
// exactly like one that is working. That is the failure this notices.

const MIN = 60_000

/** The tool calls a run made, as the tracker would have kept them from its ACP updates. */
function transcript(
  entries: Array<{ tool?: string; callId?: string; result?: string; file?: string; at: number }>
): ToolActivity[] {
  return entries.map((entry) =>
    entry.result !== undefined
      ? {
          kind: 'tool_finished',
          toolName: '',
          callId: entry.result,
          isShell: false,
          path: null,
          at: entry.at,
        }
      : {
          kind: 'tool_started',
          toolName: entry.tool ?? '',
          callId: entry.callId ?? '',
          isShell: entry.tool === 'Bash',
          path: entry.file ?? null,
          at: entry.at,
        }
  )
}

const run = (over: Partial<WatchedRun> = {}): WatchedRun => ({
  sessionId: 'session-1',
  featureDir: '/repo/specs/021-thing',
  activity: [],
  startedAt: 0,
  isWaiting: false,
  ...over,
})

function watch(runs: WatchedRun[], now: number) {
  const fired: Array<{ firing: StallFiring; featureDir: string }> = []
  const watcher = createStallWatcher({
    runs: () => runs,
    onFiring: (firing, featureDir) => fired.push({ firing, featureDir }),
    now: () => now,
  })
  watcher.tick()
  return { fired, watcher }
}

/** A tool call that names no file. */
const toolCall = (call: Omit<ToolActivity, 'path'>): ToolActivity => ({ ...call, path: null })

describe('reading what a run has been doing', () => {
  it('takes the last tool call as its most recent activity', () => {
    const activity = [
      toolCall({ kind: 'tool_started', toolName: 'Read', callId: 'a', isShell: false, at: 1_000 }),
      toolCall({ kind: 'tool_started', toolName: 'Edit', callId: 'b', isShell: false, at: 5_000 }),
    ]
    expect(factsFrom(run(), activity).lastToolActivityAt).toBe(5_000)
  })

  it('reports no activity for a run that has not called a tool yet', () => {
    expect(factsFrom(run(), []).lastToolActivityAt).toBeNull()
  })

  it('notices a shell call still in flight', () => {
    const activity = [
      toolCall({ kind: 'tool_started', toolName: 'Bash', callId: 'a', isShell: true, at: 1_000 }),
    ]
    expect(factsFrom(run(), activity).openShellStartedAt).toBe(1_000)
  })

  it('clears it once the command finishes', () => {
    const activity = [
      toolCall({ kind: 'tool_started', toolName: 'Bash', callId: 'a', isShell: true, at: 1_000 }),
      toolCall({ kind: 'tool_finished', toolName: '', callId: 'a', isShell: false, at: 2_000 }),
    ]
    expect(factsFrom(run(), activity).openShellStartedAt).toBeNull()
  })

  it('treats a run waiting on a person as unable to stall', () => {
    expect(factsFrom(run({ isWaiting: true }), []).canStall).toBe(false)
  })
})

describe('what the watcher fires on', () => {
  describe('firing', firingTests)
  describe('long commands and waiting runs', longCommandsAndWaitingRunsTests)
  describe('runs that did nothing', runsThatDidNothingTests)
  describe('once per run', oncePerRunTests)
  describe('afresh', afreshTests)
  describe('every run and the numbers', everyRunAndTheNumbersTests)
})

const INTERVAL_MS = 1_000
/** A watcher on a fake clock that counts how often it looks at the runs. */
function countingWatcher() {
  let looks = 0
  const watcher = createStallWatcher({
    runs: () => {
      looks++
      return []
    },
    onFiring: () => undefined,
    now: () => 0,
    intervalMs: INTERVAL_MS,
  })
  return { watcher, looks: () => looks }
}

function firingTests() {
  it('fires when a run has gone quiet past the threshold', () => {
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    const { fired } = watch([run({ activity: path })], 9 * MIN)
    expect(fired).toHaveLength(1)
    expect(fired[0].firing.signal).toBe('silence')
  })

  it('names the card, so the firing points somewhere', () => {
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    const { fired } = watch([run({ activity: path })], 9 * MIN)
    expect(fired[0].featureDir).toBe('/repo/specs/021-thing')
  })

  it('does not fire below the threshold', () => {
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    expect(watch([run({ activity: path })], 7 * MIN).fired).toEqual([])
  })
}

function longCommandsAndWaitingRunsTests() {
  it('does NOT fire while a shell command has been running for twelve minutes', () => {
    // The exemption, and the gate on shipping this at all: a run blocked inside
    // one long command it started is working, not stuck. Without this every test
    // suite longer than the threshold reads as a stall.
    const path = transcript([{ tool: 'Bash', callId: 'a', at: 0 }])
    expect(watch([run({ activity: path })], 12 * MIN).fired).toEqual([])
  })

  it('fires once that command finishes and the run stays quiet', () => {
    const path = transcript([
      { tool: 'Bash', callId: 'a', at: 0 },
      { result: 'a', at: 1_000 },
    ])
    expect(watch([run({ activity: path })], 12 * MIN).fired).toHaveLength(1)
  })

  it('does not fire on a run that is waiting on a person', () => {
    // Blocked is not stuck, and reporting it as stuck is how a detector earns
    // the reputation that gets it turned off.
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    expect(watch([run({ activity: path, isWaiting: true })], 9 * MIN).fired).toEqual([])
  })
}

function runsThatDidNothingTests() {
  it('measures a run that has done nothing yet from when it started', () => {
    // Not from the epoch — that reported fifty-six years of silence and stalled
    // every run the instant it began.
    const justStarted = run({ startedAt: 9 * MIN })
    expect(watch([justStarted], 9 * MIN + 30_000).fired).toEqual([])
  })

  it('fires on a run that has still called nothing well after starting', () => {
    expect(watch([run({ startedAt: 0 })], 9 * MIN).fired).toHaveLength(1)
  })
}

function oncePerRunTests() {
  it('fires once per run, not on every tick', () => {
    // A detector that reports the same stall every thirty seconds is one you
    // mute, and muting it loses the next real one.
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    const runs = [run({ activity: path })]
    const fired: StallFiring[] = []
    const watcher = createStallWatcher({
      runs: () => runs,
      onFiring: (firing) => fired.push(firing),
      now: () => 9 * MIN,
    })
    watcher.tick()
    watcher.tick()
    watcher.tick()
    expect(fired).toHaveLength(1)
  })
}

function afreshTests() {
  it('can fire again for a run that ended and started afresh', () => {
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    let runs = [run({ activity: path })]
    const fired: StallFiring[] = []
    const watcher = createStallWatcher({
      runs: () => runs,
      onFiring: (firing) => fired.push(firing),
      now: () => 9 * MIN,
    })
    watcher.tick()
    runs = []
    watcher.tick()
    runs = [run({ activity: path })]
    watcher.tick()
    expect(fired).toHaveLength(2)
  })
}

function everyRunAndTheNumbersTests() {
  it('looks at every run, not only the first', () => {
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    const { fired } = watch(
      [
        run({ sessionId: 'one', activity: path }),
        run({ sessionId: 'two', activity: path, featureDir: '/repo/specs/022-other' }),
      ],
      9 * MIN
    )
    expect(fired).toHaveLength(2)
  })

  it('carries the numbers that justified it, so a firing can be judged later', () => {
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    const { fired } = watch([run({ activity: path })], 9 * MIN)
    expect(fired[0].firing.inputs.toolSilenceMs).toBe(9 * MIN)
    expect(fired[0].firing.inputs.shellInFlight).toBe(false)
  })
}

describe('starting and stopping', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  describe('the timer', theTimerTests)
})

function theTimerTests() {
  it('looks at the runs once every interval after it starts', () => {
    const { watcher, looks } = countingWatcher()
    watcher.start()
    vi.advanceTimersByTime(3 * INTERVAL_MS)
    watcher.stop()
    expect(looks()).toBe(3)
  })

  it('looks no more after it is stopped, and stopping twice is harmless', () => {
    const { watcher, looks } = countingWatcher()
    watcher.start()
    vi.advanceTimersByTime(INTERVAL_MS)
    watcher.stop()
    watcher.stop()
    vi.advanceTimersByTime(5 * INTERVAL_MS)
    expect(looks()).toBe(1)
  })

  it('starting twice does not run two timers', () => {
    const { watcher, looks } = countingWatcher()
    watcher.start()
    watcher.start()
    vi.advanceTimersByTime(3 * INTERVAL_MS)
    watcher.stop()
    expect(looks()).toBe(3)
  })
}

describe('the facts the loop signal is made of', () => {
  it('reads which files the recent calls touched', () => {
    const activity = transcript([
      { tool: 'Edit', callId: 'a', file: '/wt/a.ts', at: 1_000 },
      { tool: 'Edit', callId: 'b', file: '/wt/a.ts', at: 2_000 },
    ])
    expect(factsFrom(run({ activity }), activity).recentToolPaths).toEqual(['/wt/a.ts', '/wt/a.ts'])
  })

  it('leaves the net change unmeasured, so circling on one file never reads as a loop', () => {
    const activity = transcript(
      Array.from({ length: 8 }, (_, n) => ({
        tool: 'Edit',
        callId: `c${n}`,
        file: '/wt/a.ts',
        at: n,
      }))
    )
    const facts = factsFrom(run({ activity }), activity)
    expect(facts.lastNetChangeAt).toBeNull()
    expect(facts.recentNetChange).toBe(1)
    expect(watch([run({ activity })], 30 * MIN).fired.map((f) => f.firing.signal)).toEqual([
      'silence',
    ])
  })
})

describe('learning a run’s tool calls from its ACP updates', learningFromUpdatesTests)

/** A fake `api.agents.onUpdate` the test drives; there is no file to read. */
function driven() {
  let listener: (update: AgentUpdate) => void = () => {}
  const stop = vi.fn()
  let clock = 0
  const tracker = trackToolActivity(
    {
      onUpdate: (_id, next) => {
        listener = next
        return stop
      },
    },
    'session-1',
    () => clock
  )
  return {
    tracker,
    stop,
    send: (update: AgentUpdate, at: number) => {
      clock = at
      listener(update)
    },
  }
}
const call = (id: string, name: string, rawInput: unknown = {}): AgentUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: id,
  status: 'pending',
  rawInput,
  _meta: { claudeCode: { toolName: name } },
})
const update = (id: string, status: string): AgentUpdate => ({
  sessionUpdate: 'tool_call_update',
  toolCallId: id,
  status,
})

function learningFromUpdatesTests() {
  it('takes the last tool update as the run’s latest activity', () => {
    const { tracker, send } = driven()
    send(call('a', 'Read'), 1_000)
    send(update('a', 'completed'), 5_000)
    expect(factsFrom(run(), tracker.activity()).lastToolActivityAt).toBe(5_000)
  })

  it('keeps the file a call named and whether it was a shell call', () => {
    const { tracker, send } = driven()
    send(call('a', 'Edit', { file_path: '/wt/a.ts' }), 1_000)
    send(call('b', 'Bash'), 2_000)
    expect(tracker.activity()).toMatchObject([
      { kind: 'tool_started', toolName: 'Edit', path: '/wt/a.ts', isShell: false },
      { kind: 'tool_started', toolName: 'Bash', path: null, isShell: true },
    ])
    expect(factsFrom(run(), tracker.activity()).openShellStartedAt).toBe(2_000)
  })
}

function finishingCallsTests() {
  it('closes a call when it completes or fails, and ignores progress updates', () => {
    const { tracker, send } = driven()
    send(call('a', 'Bash'), 1_000)
    send(update('a', 'in_progress'), 2_000)
    expect(tracker.activity()).toHaveLength(1)
    send(update('a', 'failed'), 3_000)
    expect(tracker.activity()[1]).toMatchObject({
      kind: 'tool_finished',
      callId: 'a',
      toolName: 'Bash',
      isShell: true,
    })
  })

  it('stops listening when told', () => {
    const { tracker, stop } = driven()
    tracker.stop()
    expect(stop).toHaveBeenCalled()
  })
}

describe('finishing calls', finishingCallsTests)

describe('handing on what it read', () => {
  it('passes each run’s transcript activity to onActivity on every tick, fired or not', () => {
    const path = transcript([
      { tool: 'Read', callId: 'c1', file: 'a.ts', at: 1000 },
      { result: 'c1', at: 2000 },
    ])
    const seen: Array<{ sessionId: string; calls: string[] }> = []
    const watcher = createStallWatcher({
      runs: () => [run({ activity: path })],
      onFiring: () => {},
      onActivity: (watched, activity) =>
        seen.push({
          sessionId: watched.sessionId,
          calls: activity.map((a) => `${a.callId}:${a.kind}`),
        }),
      now: () => 3000,
    })
    watcher.tick()
    watcher.tick()
    expect(seen).toEqual([
      { sessionId: 'session-1', calls: ['c1:tool_started', 'c1:tool_finished'] },
      { sessionId: 'session-1', calls: ['c1:tool_started', 'c1:tool_finished'] },
    ])
  })
})
