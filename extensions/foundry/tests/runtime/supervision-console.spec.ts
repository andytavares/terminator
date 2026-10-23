/**
 * The supervision console, through `activate`: what is held, what stalled, the
 * feed, answering a held call, and the actions on one run.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, temporaryDirectory, type FoundryHost } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate, settleFoundryWork } from '../helpers/foundry-activation.js'
import { orderStoreAt } from '../../src/state/live-index.js'
import { draftOrder } from '../../src/order/draft.js'
import { orderDir } from '../../src/data-root.js'
import { theRunner } from '../helpers/supervision-mocks.js'
import { ledgerActions } from '../helpers/order-ledger.js'
import { eventually } from '../../../../tests/support/eventually'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

const { runtime, stallFirings } = await import('../../src/runtime/runtime-state.ts')
const { startPaletteRefresh, stopPaletteRefresh } = await import(
  '../../src/runtime/palette-commands.ts'
)
const { notePending, noteResolved } = await import('../../src/runtime/held-calls.ts')

let dataDir = ''
let host: FoundryHost

beforeAll(async () => {
  vi.stubEnv('HOME', temporaryDirectory('fdry-home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

// Each test's proofs and runs end before the next test, or the spec's folder, goes.
afterEach(settleFoundryWork)

afterAll(async () => {
  await deactivate()
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  dataDir = temporaryDirectory('fdry-console')
  await orderStoreAt(dataDir).save(
    draftOrder({
      id: 'WO-1',
      title: 'Make it red',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/app'],
      now: '2026-10-12T10:00:00.000Z',
    })
  )
  host.broadcast.mockClear()
  host.showToast.mockClear()
  host.createNotification.mockClear()
  theRunner.resolve.mockReset().mockReturnValue(true)
  theRunner.terminalFor.mockReset().mockReturnValue(null)
})

function heldCall(requestId: string, questions?: Array<{ question: string; options: string[] }>) {
  return {
    sessionId: 'builder-1',
    requestId,
    toolName: 'Bash',
    summary: 'rm -rf build',
    detail: null,
    questions,
    at: Date.now(),
    featureDir: orderDir(dataDir, 'WO-1'),
  }
}

describe('a held tool call', () => {
  describe('listing and answering', listingAndAnsweringTests)
  describe('questions and words', questionsAndWordsTests)
  describe('let go and unheld', letGoAndUnheldTests)
  describe('handing back', handingBackTests)
})

function registerRun(sessionId: string, transcriptPath = '/nowhere.jsonl'): void {
  runtime.supervision?.runs.add({
    sessionId,
    featureDir: orderDir(dataDir, 'WO-1'),
    phase: 'builder',
    worktreePath: '/repos/app',
    branch: 'foundry/WO-1',
    baseBranch: 'main',
    terminalSessionId: `term-${sessionId}`,
    transcriptPath,
    startedAt: Date.now(),
  })
}

function listingAndAnsweringTests() {
  it('is listed, interrupts with Allow and Deny, and answering it takes the notification away', async () => {
    const dispose = vi.fn()
    host.createNotification.mockReturnValueOnce({ dispose })
    notePending(host.api, heldCall('req-1'))

    expect(await host.call('foundry:permissions-list')).toEqual({
      pending: [expect.objectContaining({ requestId: 'req-1', sessionId: 'builder-1' })],
    })
    const raised = host.createNotification.mock.calls[0][0] as {
      title: string
      actions: Array<{ id: string; handler: () => void }>
    }
    expect(raised.title).toBe('WO-1 is asking: rm -rf build')
    raised.actions.find((action) => action.id === 'deny')?.handler()
    expect(theRunner.resolve).toHaveBeenCalledWith('builder-1', 'req-1', { allow: false })

    noteResolved('req-1')
    expect(dispose).toHaveBeenCalled()
    expect(await host.call('foundry:permissions-list')).toEqual({ pending: [] })
  })
}

function questionsAndWordsTests() {
  it('asked as a question during a run is recorded against the order as an intake defect', async () => {
    notePending(host.api, heldCall('req-2', [{ question: 'Which colour?', options: ['red'] }]), {
      id: 'WO-1',
      root: dataDir,
    })
    await eventually(async () => expect(await ledgerActions(dataDir)).toContain('intake.defect'))
    noteResolved('req-2')
  })

  it('is answered through the console with the operator’s own words', async () => {
    notePending(host.api, heldCall('req-3'))
    expect(
      await host.call('foundry:permission-resolve', {
        requestId: 'req-3',
        decision: 'allow',
        answer: '  red  ',
      })
    ).toEqual({ ok: true })
    expect(theRunner.resolve).toHaveBeenCalledWith('builder-1', 'req-3', {
      allow: true,
      answer: '  red  ',
    })
    noteResolved('req-3')
  })
}

function letGoAndUnheldTests() {
  it('that the bridge already let go is cleared from the list and reported as no longer waiting', async () => {
    notePending(host.api, heldCall('req-4'))
    theRunner.resolve.mockReturnValueOnce(false)
    expect(
      await host.call('foundry:permission-resolve', { requestId: 'req-4', decision: 'allow' })
    ).toEqual({ ok: false, reason: 'that request is no longer waiting' })
    expect(await host.call('foundry:permissions-list')).toEqual({ pending: [] })
  })

  it('that nobody is holding any more cannot be answered or handed back', async () => {
    expect(
      await host.call('foundry:permission-resolve', { requestId: 'gone', decision: 'deny' })
    ).toEqual({ ok: false, reason: 'that request is no longer waiting' })
    expect(await host.call('foundry:permission-hand-back', { requestId: 'gone' })).toEqual({
      ok: false,
    })
  })
}

function handingBackTests() {
  it('is handed back to the terminal when the operator asks', async () => {
    notePending(host.api, heldCall('req-5'))
    expect(await host.call('foundry:permission-hand-back', { requestId: 'req-5' })).toEqual({
      ok: true,
    })
    expect(theRunner.handBackToTerminal).toHaveBeenCalledWith('builder-1', 'req-5')
    noteResolved('req-5')
  })
}

describe('the actions on one run', () => {
  describe('the terminal', theTerminalTests)
  describe('the transcript', supervisionConsoleTheTranscriptTests)
  describe('redirecting and interrupting', redirectingAndInterruptingTests)
  describe('stopping', supervisionConsoleStoppingTests)
})

function theTerminalTests() {
  it('takes the operator to the terminal the run is in, and refuses when it has none', async () => {
    expect(await host.call('foundry:run-terminal', { sessionId: 'builder-1' })).toEqual({
      ok: false,
    })
    theRunner.terminalFor.mockReturnValue({ terminalSessionId: 'tab-7', projectId: 'p-1' })
    expect(await host.call('foundry:run-terminal', { sessionId: 'builder-1' })).toEqual({
      ok: true,
    })
    expect(host.broadcast).toHaveBeenCalledWith('terminal:navigate-to-session', {
      sessionId: 'tab-7',
      projectId: 'p-1',
    })
  })
}

function supervisionConsoleTheTranscriptTests() {
  it('reads what the agent was doing from its transcript, and nothing for a run it does not know', async () => {
    const transcript = path.join(dataDir, 'transcript.jsonl')
    fs.writeFileSync(
      transcript,
      `${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-10-12T10:00:00.000Z',
        message: { content: [{ type: 'text', text: 'Reading the colour tokens' }] },
      })}\n`
    )
    registerRun('reader-1', transcript)
    const read = (await host.call('foundry:run-transcript', { sessionId: 'reader-1' })) as {
      lines: Array<{ text: string }>
    }
    expect(read.lines.map((line) => line.text)).toContain('Reading the colour tokens')
    expect(await host.call('foundry:run-transcript', { sessionId: 'nobody' })).toEqual({
      lines: [],
    })
  })
}

function redirectingAndInterruptingTests() {
  it('redirects a run: interrupts it, sends the message, and says so in the feed', async () => {
    registerRun('redirected-1')
    expect(
      await host.call('foundry:run-redirect', { sessionId: 'redirected-1', message: 'use tokens' })
    ).toEqual({ ok: true })
    expect(theRunner.interrupt).toHaveBeenCalledWith('redirected-1')
    expect(theRunner.send).toHaveBeenCalledWith('redirected-1', 'use tokens')
    expect(runtime.supervision?.runs.get('redirected-1')?.state).toBe('working')
    const feed = (await host.call('foundry:feed-list')) as { entries: Array<{ summary: string }> }
    expect(feed.entries.map((entry) => entry.summary)).toContain('redirected: use tokens')
  })

  it('interrupts a turn and keeps the session', async () => {
    expect(await host.call('foundry:run-interrupt', { sessionId: 'builder-1' })).toEqual({
      ok: true,
    })
    expect(theRunner.interrupt).toHaveBeenCalledWith('builder-1')
  })
}

function supervisionConsoleStoppingTests() {
  it('stops a run and keeps it in the history as stopped', async () => {
    registerRun('stopped-1')
    expect(
      await host.call('foundry:run-stop', { sessionId: 'stopped-1', reason: 'wrong file' })
    ).toEqual({ ok: true })
    expect(theRunner.stop).toHaveBeenCalledWith('stopped-1', 'wrong file')
    expect(runtime.supervision?.snapshot().history[0]).toMatchObject({
      sessionId: 'stopped-1',
      outcome: 'stopped',
    })
  })
}

describe('the feed', () => {
  it('drops a line the operator dismissed', async () => {
    const entry = runtime.supervision?.feed.post({
      at: Date.now(),
      sessionId: 'builder-1',
      author: 'agent',
      summary: 'noise',
    })
    await host.call('foundry:feed-dismiss', { id: entry?.id })
    const feed = (await host.call('foundry:feed-list')) as { entries: Array<{ id: string }> }
    expect(feed.entries.map((e) => e.id)).not.toContain(entry?.id)
  })

  it('mutes and unmutes a run', async () => {
    expect(await host.call('foundry:feed-mute', { sessionId: 'noisy-1' })).toEqual({
      mutes: [{ sessionId: 'noisy-1' }],
    })
    expect((await host.call('foundry:feed-list')) as { mutes: unknown[] }).toMatchObject({
      mutes: [{ sessionId: 'noisy-1' }],
    })
    expect(await host.call('foundry:feed-unmute', { sessionId: 'noisy-1' })).toEqual({
      mutes: [],
    })
  })
})

function watchStalledRun(sessionId: string): void {
  theRunner.watchable.mockReturnValue([
    {
      sessionId,
      featureDir: orderDir(dataDir, 'WO-1'),
      transcriptPath: path.join(dataDir, `${sessionId}.jsonl`),
      startedAt: Date.now() - 3 * 60 * 60 * 1000,
      isWaiting: false,
    },
  ] as never)
  runtime.stallWatcher?.tick()
}

describe('a run that stops making progress', () => {
  describe('shadow mode', shadowModeTests)
  describe('indications', indicationsTests)
  describe('outside an order', outsideAnOrderTests)
})

function shadowModeTests() {
  it('in shadow mode is recorded on the order and listed, and interrupts nobody', async () => {
    watchStalledRun('quiet-1')
    await eventually(async () => expect(await ledgerActions(dataDir)).toContain('run.stalled'))
    const listed = (await host.call('foundry:stalls-list')) as {
      firings: Array<{ firing: { sessionId: string; signal: string }; shadow: boolean }>
      shadowMode: boolean
    }
    expect(listed.shadowMode).toBe(true)
    expect(listed.firings[0]).toMatchObject({
      firing: { sessionId: 'quiet-1', signal: 'silence' },
      shadow: true,
    })
    expect(host.broadcast).toHaveBeenCalledWith(
      'foundry:stall-fired',
      expect.objectContaining({ shadow: true })
    )
    expect(host.showToast).not.toHaveBeenCalled()
  })
}

function indicationsTests() {
  it('with shadow mode off raises an indication that takes the operator to the run', async () => {
    host.settings.set('terminator.foundry.stallShadowMode', false)
    try {
      watchStalledRun('quiet-2')
      expect(host.showToast).toHaveBeenCalledWith(
        'warning',
        'A run stopped making progress (silence)',
        'foundry.stalled.quiet-2'
      )
    } finally {
      host.settings.delete('terminator.foundry.stallShadowMode')
    }
  })

  it('with shadow mode off stays quiet for a run the operator muted', async () => {
    host.settings.set('terminator.foundry.stallShadowMode', false)
    await host.call('foundry:feed-mute', { sessionId: 'quiet-3' })
    try {
      watchStalledRun('quiet-3')
      expect(stallFirings[0].firing.sessionId).toBe('quiet-3')
      expect(host.showToast).not.toHaveBeenCalled()
    } finally {
      host.settings.delete('terminator.foundry.stallShadowMode')
      await host.call('foundry:feed-unmute', { sessionId: 'quiet-3' })
    }
  })
}

function outsideAnOrderTests() {
  it('outside any order records nothing on a ledger', async () => {
    theRunner.watchable.mockReturnValue([
      {
        sessionId: 'loose-1',
        featureDir: path.join(dataDir, 'scratch'),
        transcriptPath: path.join(dataDir, 'loose.jsonl'),
        startedAt: Date.now() - 3 * 60 * 60 * 1000,
        isWaiting: false,
      },
    ] as never)
    runtime.stallWatcher?.tick()
    expect(stallFirings[0].firing.sessionId).toBe('loose-1')
    expect(await ledgerActions(dataDir)).not.toContain('run.stalled')
  })
}

/** A builder run on WO-1 that is waiting on the operator. */
function addWaitingRun(sessionId: string): void {
  runtime.supervision?.runs.add({
    sessionId,
    featureDir: orderDir(dataDir, 'WO-1'),
    phase: 'builder',
    worktreePath: '/repos/app',
    branch: 'foundry/WO-1',
    baseBranch: 'main',
    terminalSessionId: 'term-w',
    transcriptPath: '/nowhere.jsonl',
    startedAt: Date.now(),
  })
  runtime.supervision?.runs.setState(sessionId, 'waiting', Date.now())
}

describe('the palette', () => {
  it('lists a run waiting on the operator first, and going to it opens the run when it has no terminal', async () => {
    addWaitingRun('waiting-1')
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      stopPaletteRefresh()
      startPaletteRefresh(host.api)
      const go = host.commands.get('run.waiting-1')
      expect(go).toBeDefined()
      go?.()
      expect(host.broadcast).toHaveBeenCalledWith('foundry:palette-goto', {
        kind: 'run',
        sessionId: 'waiting-1',
      })
      runtime.supervision?.runs.forget('waiting-1')
      vi.advanceTimersByTime(5_000)
      expect(host.commands.has('run.waiting-1')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
