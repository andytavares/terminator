import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStallWatcher, factsFrom, type WatchedRun } from '../../src/runtime/stall-watcher.js'
import type { StallFiring } from '../../src/runtime/evaluate-stall.js'
import { readTranscript, type ToolActivity } from '../../src/runtime/transcript-tailer.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'

// A run that is blocked tells you: it raises a permission request and the board
// lights up. A run that has simply gone quiet tells you nothing, and looks
// exactly like one that is working. That is the failure this notices.

const MIN = 60_000

let dir: string

beforeEach(() => {
  dir = makeTempDir('stall-watcher-')
})

afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

/** Writes a transcript the tailer can read, with the tool calls given. */
function transcript(
  entries: Array<{ tool?: string; callId?: string; result?: string; file?: string; at: number }>
): string {
  const path = join(dir, `${Math.random().toString(16).slice(2)}.jsonl`)
  const lines = entries.map((entry) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date(entry.at).toISOString(),
      message: {
        content: [
          entry.result !== undefined
            ? { type: 'tool_result', tool_use_id: entry.result }
            : {
                type: 'tool_use',
                id: entry.callId,
                name: entry.tool,
                input: entry.file === undefined ? {} : { file_path: entry.file },
              },
        ],
      },
    })
  )
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

const run = (over: Partial<WatchedRun> = {}): WatchedRun => ({
  sessionId: 'session-1',
  featureDir: '/repo/specs/021-thing',
  transcriptPath: join(dir, 'missing.jsonl'),
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
    const { fired } = watch([run({ transcriptPath: path })], 9 * MIN)
    expect(fired).toHaveLength(1)
    expect(fired[0].firing.signal).toBe('silence')
  })

  it('names the card, so the firing points somewhere', () => {
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    const { fired } = watch([run({ transcriptPath: path })], 9 * MIN)
    expect(fired[0].featureDir).toBe('/repo/specs/021-thing')
  })

  it('does not fire below the threshold', () => {
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    expect(watch([run({ transcriptPath: path })], 7 * MIN).fired).toEqual([])
  })
}

function longCommandsAndWaitingRunsTests() {
  it('does NOT fire while a shell command has been running for twelve minutes', () => {
    // The exemption, and the gate on shipping this at all: a run blocked inside
    // one long command it started is working, not stuck. Without this every test
    // suite longer than the threshold reads as a stall.
    const path = transcript([{ tool: 'Bash', callId: 'a', at: 0 }])
    expect(watch([run({ transcriptPath: path })], 12 * MIN).fired).toEqual([])
  })

  it('fires once that command finishes and the run stays quiet', () => {
    const path = transcript([
      { tool: 'Bash', callId: 'a', at: 0 },
      { result: 'a', at: 1_000 },
    ])
    expect(watch([run({ transcriptPath: path })], 12 * MIN).fired).toHaveLength(1)
  })

  it('does not fire on a run that is waiting on a person', () => {
    // Blocked is not stuck, and reporting it as stuck is how a detector earns
    // the reputation that gets it turned off.
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    expect(watch([run({ transcriptPath: path, isWaiting: true })], 9 * MIN).fired).toEqual([])
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
    const runs = [run({ transcriptPath: path })]
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
    let runs = [run({ transcriptPath: path })]
    const fired: StallFiring[] = []
    const watcher = createStallWatcher({
      runs: () => runs,
      onFiring: (firing) => fired.push(firing),
      now: () => 9 * MIN,
    })
    watcher.tick()
    runs = []
    watcher.tick()
    runs = [run({ transcriptPath: path })]
    watcher.tick()
    expect(fired).toHaveLength(2)
  })
}

function everyRunAndTheNumbersTests() {
  it('looks at every run, not only the first', () => {
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    const { fired } = watch(
      [
        run({ sessionId: 'one', transcriptPath: path }),
        run({ sessionId: 'two', transcriptPath: path, featureDir: '/repo/specs/022-other' }),
      ],
      9 * MIN
    )
    expect(fired).toHaveLength(2)
  })

  it('carries the numbers that justified it, so a firing can be judged later', () => {
    const path = transcript([{ tool: 'Read', callId: 'a', at: 0 }])
    const { fired } = watch([run({ transcriptPath: path })], 9 * MIN)
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
  // `recentToolPaths` was hardcoded empty and `recentNetChange` hardcoded to 1,
  // so `loop` could never fire however long an agent went round in circles.

  it('reads which files the recent calls touched', () => {
    const path = transcript([
      { tool: 'Edit', callId: 'a', file: '/wt/a.ts', at: 1_000 },
      { tool: 'Edit', callId: 'b', file: '/wt/a.ts', at: 2_000 },
    ])
    expect(factsFrom(run({ transcriptPath: path }), readTranscript(path)).recentToolPaths).toEqual([
      '/wt/a.ts',
      '/wt/a.ts',
    ])
  })

  it('takes the growth it is given, so circling is distinguishable from working', () => {
    const path = transcript([{ tool: 'Edit', callId: 'a', file: '/wt/a.ts', at: 1_000 }])
    expect(factsFrom(run({ transcriptPath: path }), readTranscript(path), 0).recentNetChange).toBe(
      0
    )
  })

  it('reports growth when nothing measured it, so the signal stays quiet', () => {
    const path = transcript([{ tool: 'Edit', callId: 'a', file: '/wt/a.ts', at: 1_000 }])
    expect(factsFrom(run({ transcriptPath: path }), readTranscript(path)).recentNetChange).toBe(1)
  })
})

describe('handing on what it read', () => {
  it('passes each run’s transcript activity to onActivity on every tick, fired or not', () => {
    const path = transcript([
      { tool: 'Read', callId: 'c1', file: 'a.ts', at: 1000 },
      { result: 'c1', at: 2000 },
    ])
    const seen: Array<{ sessionId: string; calls: string[] }> = []
    const watcher = createStallWatcher({
      runs: () => [run({ transcriptPath: path })],
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
