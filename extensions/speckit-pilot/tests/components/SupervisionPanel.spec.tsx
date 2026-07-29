import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// The supervision layer had nine working channels and nothing rendering them.
// These are the assertions that this is no longer true: every section reads its
// channel, and every action the panel offers reaches one.

const api = {
  supervisionSnapshot: vi.fn(),
  stallsList: vi.fn(),
  feedList: vi.fn(),
  reviewHunks: vi.fn(),
  reviewDecideHunk: vi.fn(),
  reviewDone: vi.fn(),
  runTerminal: vi.fn(),
  runTranscript: vi.fn(),
  runInterrupt: vi.fn(),
  runRedirect: vi.fn(),
  runStop: vi.fn(),
  runDiscard: vi.fn(),
  feedDigest: vi.fn(),
  reviewAdvance: vi.fn(),
  reviewIntent: vi.fn(),
  unattendedMerges: vi.fn(),
}

vi.mock('../../src/types/electron.js', () => ({ getSpeckitAPI: () => api }))

import { SupervisionPanel, elapsed } from '../../src/components/SupervisionPanel.js'
import type { RunView, StallFiringView } from '../../src/types/electron.js'

const run = (over: Partial<RunView> = {}): RunView => ({
  sessionId: 'session-1',
  featureDir: '/repo/specs/021-thing',
  phase: 'implement',
  branch: 'feat/thing',
  worktreePath: '/wt/thing',
  terminalSessionId: 'terminal-1',
  state: 'working',
  stateSince: 1_000,
  turns: 3,
  asked: 0,
  diff: { files: 0, added: 0, removed: 0 },
  ...over,
})

const firing = (): StallFiringView => ({
  featureDir: '/repo/specs/021-thing',
  shadow: true,
  firing: {
    sessionId: 'session-1',
    signal: 'no tool calls',
    firedAt: 5_000,
    inputs: { toolSilenceMs: 600_000, diffSilenceMs: 600_000, shellInFlight: false },
  },
})

function panel(over: Partial<React.ComponentProps<typeof SupervisionPanel>> = {}) {
  const props = { workspacePath: '/repo', ...over }
  render(<SupervisionPanel {...props} />)
  return props
}

beforeEach(() => {
  vi.clearAllMocks()
  api.supervisionSnapshot.mockResolvedValue({
    runs: [],
    review: [],
    backpressure: { allowed: true, unreviewed: 0, limit: 3 },
  })
  api.stallsList.mockResolvedValue({ firings: [], shadowMode: true })
  api.feedList.mockResolvedValue({ entries: [] })
  api.reviewHunks.mockResolvedValue({ files: [], complete: false, fullReject: false })
  api.reviewDecideHunk.mockResolvedValue({ ok: true })
  api.reviewDone.mockResolvedValue({ ok: true })
  api.runTerminal.mockResolvedValue({ terminalSessionId: 'terminal-1' })
  api.runTranscript.mockResolvedValue({ lines: [] })
  api.runInterrupt.mockResolvedValue({ ok: true })
  api.runRedirect.mockResolvedValue({ ok: true })
  api.runStop.mockResolvedValue({ ok: true })
  api.runDiscard.mockResolvedValue({ ok: true })
  api.feedDigest.mockResolvedValue({
    from: 0,
    to: 0,
    entryCount: 0,
    sessionCount: 0,
    bySession: [],
  })
  api.reviewAdvance.mockResolvedValue({ step: 'risk' })
  api.reviewIntent.mockResolvedValue({ intent: null })
  api.unattendedMerges.mockResolvedValue({ merges: [] })
  window.localStorage.clear()
})

describe('saying that everything is fine', () => {
  it('says nothing is running rather than rendering an empty box', async () => {
    // A surface that is empty because it failed to load looks exactly like one
    // that is empty because all is well, and only one of those is fine.
    panel()
    expect(await screen.findByText('Nothing is running.')).toBeDefined()
  })

  it('reads every channel on mount, not just the one on screen', async () => {
    // The counts on the other tabs are what tells you to look at them.
    panel()
    await waitFor(() => expect(api.supervisionSnapshot).toHaveBeenCalled())
    expect(api.stallsList).toHaveBeenCalled()
    expect(api.feedList).toHaveBeenCalled()
  })
})

describe('what is running', () => {
  it('names the card rather than the branch, when it can', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [run()],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
    })
    panel({ cardLabel: () => 'Unify session identity' })
    expect(await screen.findByText('Unify session identity')).toBeDefined()
  })

  it('says what state it is in, in words', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [run({ state: 'stalled' })],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
    })
    panel()
    expect(await screen.findByText('not making progress')).toBeDefined()
  })

  it('does not list a run that has finished', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [run({ state: 'finished' })],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
    })
    panel()
    expect(await screen.findByText('Nothing is running.')).toBeDefined()
  })
})

describe('acting on a run', () => {
  beforeEach(() => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [run()],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
    })
  })

  it('interrupts it', async () => {
    panel()
    fireEvent.click(await screen.findByText('Interrupt'))
    await waitFor(() => expect(api.runInterrupt).toHaveBeenCalledWith({ sessionId: 'session-1' }))
  })

  it('stops it', async () => {
    panel()
    fireEvent.click(await screen.findByText('Stop'))
    await waitFor(() => expect(api.runStop).toHaveBeenCalledWith({ sessionId: 'session-1' }))
  })

  it('redirects it with what you typed', async () => {
    panel()
    fireEvent.click(await screen.findByText('Redirect'))
    const input = screen.getByLabelText('Redirect feat/thing')
    fireEvent.change(input, { target: { value: 'stop rewriting the tests' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(api.runRedirect).toHaveBeenCalledWith({
        sessionId: 'session-1',
        message: 'stop rewriting the tests',
      })
    )
  })

  it('does not send an empty redirect', async () => {
    // Enter on a blank field would end the turn for nothing.
    panel()
    fireEvent.click(await screen.findByText('Redirect'))
    fireEvent.keyDown(screen.getByLabelText('Redirect feat/thing'), { key: 'Enter' })
    expect(api.runRedirect).not.toHaveBeenCalled()
  })

  it('discards it against the repository it belongs to', async () => {
    panel()
    fireEvent.click(await screen.findByText('Discard'))
    await waitFor(() =>
      expect(api.runDiscard).toHaveBeenCalledWith({
        sessionId: 'session-1',
        workspacePath: '/repo',
      })
    )
  })

  it('offers no discard when there is no repository to discard from', async () => {
    // Better absent than present and silently doing nothing.
    panel({ workspacePath: undefined })
    await screen.findByText('Interrupt')
    expect(screen.queryByText('Discard')).toBeNull()
  })

  it('shows what it was doing, in its own words', async () => {
    api.runTranscript.mockResolvedValue({
      lines: [{ role: 'assistant', text: 'retrying the same edit', at: 1_000 }],
    })
    panel()
    fireEvent.click(await screen.findByText('Transcript'))
    expect(await screen.findByText('retrying the same edit')).toBeDefined()
  })

  it('resolves the terminal when asked rather than assuming one', async () => {
    // A stall is recorded with a session id and nothing else.
    const onOpenTerminal = vi.fn()
    panel({ onOpenTerminal })
    fireEvent.click(await screen.findByText('Terminal'))
    await waitFor(() => expect(onOpenTerminal).toHaveBeenCalledWith('terminal-1'))
  })

  it('goes nowhere when the run has no terminal any more', async () => {
    api.runTerminal.mockResolvedValue({ terminalSessionId: null })
    const onOpenTerminal = vi.fn()
    panel({ onOpenTerminal })
    fireEvent.click(await screen.findByText('Terminal'))
    await waitFor(() => expect(api.runTerminal).toHaveBeenCalled())
    expect(onOpenTerminal).not.toHaveBeenCalled()
  })
})

describe('what stopped making progress', () => {
  it('says it is only recording while shadow mode is on', async () => {
    // A detector that cries wolf gets turned off, and then the real stalls go
    // unreported too. Saying which mode it is in is the whole point.
    panel()
    fireEvent.click(await screen.findByText(/stalls/))
    expect(await screen.findByText(/Shadow mode/)).toBeDefined()
  })

  it('shows the numbers that justified the firing', async () => {
    api.stallsList.mockResolvedValue({ firings: [firing()], shadowMode: false })
    panel()
    fireEvent.click(await screen.findByText(/stalls/))
    expect(await screen.findByText(/quiet for 10m/)).toBeDefined()
    expect(screen.getByText(/nothing was running/)).toBeDefined()
  })

  it('offers the same actions, since a stall you cannot act on is a notification', async () => {
    api.stallsList.mockResolvedValue({ firings: [firing()], shadowMode: false })
    panel()
    fireEvent.click(await screen.findByText(/stalls/))
    fireEvent.click(await screen.findByText('Interrupt'))
    await waitFor(() => expect(api.runInterrupt).toHaveBeenCalledWith({ sessionId: 'session-1' }))
  })
})

describe('what is waiting to be reviewed', () => {
  const item = {
    sessionId: 'session-1',
    branch: 'feat/thing',
    grade: 'P0' as const,
    gradeTrigger: 'touches auth',
    queuedAt: 2_000,
    diffSummary: { files: 2, added: 40, removed: 3 },
  }

  it('says why it graded that way, not just the letter', async () => {
    // A grade with no reason is a number you learn to ignore.
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [item],
      backpressure: { allowed: true, unreviewed: 1, limit: 3 },
    })
    panel()
    fireEvent.click(await screen.findByText(/review/))
    expect(await screen.findByText(/touches auth/)).toBeDefined()
  })

  it('says out loud that the gate is closed, and how deep', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [item],
      backpressure: { allowed: false, unreviewed: 3, limit: 3, reason: '3 diffs are waiting' },
    })
    panel()
    fireEvent.click(await screen.findByText(/review/))
    expect(await screen.findByText('3 diffs are waiting')).toBeDefined()
  })

  it('opens the diff hunk by hunk', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [item],
      backpressure: { allowed: true, unreviewed: 1, limit: 3 },
    })
    api.reviewHunks.mockResolvedValue({
      files: [
        {
          file: 'src/auth.ts',
          hunks: [{ id: 'h1', newStart: 10, lines: ['-old', '+new'], decision: null }],
        },
      ],
      complete: false,
      fullReject: false,
    })
    panel()
    fireEvent.click(await screen.findByText(/review/))
    fireEvent.click(await screen.findByText('Review'))
    expect(await screen.findByText('src/auth.ts')).toBeDefined()
    expect(screen.getByText(/\+new/)).toBeDefined()
  })

  it('decides one hunk without deciding the file', async () => {
    // One file routinely holds both the change you asked for and the one you
    // did not, and accepting the file wholesale is how the second one ships.
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [item],
      backpressure: { allowed: true, unreviewed: 1, limit: 3 },
    })
    api.reviewHunks.mockResolvedValue({
      files: [
        {
          file: 'src/auth.ts',
          hunks: [
            { id: 'h1', newStart: 10, lines: ['+asked for'], decision: null },
            { id: 'h2', newStart: 40, lines: ['+never asked for'], decision: null },
          ],
        },
      ],
      complete: false,
      fullReject: false,
    })
    panel()
    fireEvent.click(await screen.findByText(/review/))
    fireEvent.click(await screen.findByText('Review'))
    await screen.findByText(/never asked for/)
    fireEvent.click(screen.getAllByText('Reject')[1])
    await waitFor(() =>
      expect(api.reviewDecideHunk).toHaveBeenCalledWith({
        sessionId: 'session-1',
        hunkId: 'h2',
        decision: 'reject',
      })
    )
  })

  it('will not finish a review with a hunk still undecided', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [item],
      backpressure: { allowed: true, unreviewed: 1, limit: 3 },
    })
    api.reviewHunks.mockResolvedValue({
      files: [
        {
          file: 'src/auth.ts',
          hunks: [{ id: 'h1', newStart: 10, lines: ['+x'], decision: null }],
        },
      ],
      complete: false,
      fullReject: false,
    })
    panel()
    fireEvent.click(await screen.findByText(/review/))
    fireEvent.click(await screen.findByText('Review'))
    const finish = await screen.findByText('Decide every hunk to finish')
    fireEvent.click(finish)
    expect(api.reviewDone).not.toHaveBeenCalled()
  })

  it('says when a fully rejected branch keeps nothing', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [item],
      backpressure: { allowed: true, unreviewed: 1, limit: 3 },
    })
    api.reviewHunks.mockResolvedValue({
      files: [
        {
          file: 'src/auth.ts',
          hunks: [{ id: 'h1', newStart: 10, lines: ['+x'], decision: 'reject' as const }],
        },
      ],
      complete: true,
      fullReject: true,
    })
    panel()
    fireEvent.click(await screen.findByText(/review/))
    fireEvent.click(await screen.findByText('Review'))
    expect(await screen.findByText(/this branch keeps nothing/)).toBeDefined()
  })

  it('takes it off the queue once every hunk is decided', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [item],
      backpressure: { allowed: true, unreviewed: 1, limit: 3 },
    })
    api.reviewHunks.mockResolvedValue({
      files: [
        {
          file: 'src/auth.ts',
          hunks: [{ id: 'h1', newStart: 10, lines: ['+x'], decision: 'accept' as const }],
        },
      ],
      complete: true,
      fullReject: false,
    })
    panel()
    fireEvent.click(await screen.findByText(/review/))
    fireEvent.click(await screen.findByText('Review'))
    fireEvent.click(await screen.findByText('Finish review'))
    await waitFor(() => expect(api.reviewDone).toHaveBeenCalledWith({ sessionId: 'session-1' }))
  })
})

describe('the step every diff viewer skips', () => {
  const item = {
    sessionId: 'session-1',
    branch: 'feat/thing',
    grade: 'P1' as const,
    gradeTrigger: 'alters a schema',
    queuedAt: 1,
    diffSummary: { files: 1, added: 1, removed: 0 },
  }

  beforeEach(() => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [item],
      backpressure: { allowed: true, unreviewed: 1, limit: 3 },
    })
    api.reviewHunks.mockResolvedValue({
      files: [
        { file: 'src/a.ts', hunks: [{ id: 'h1', newStart: 1, lines: ['+x'], decision: null }] },
      ],
      complete: false,
      fullReject: false,
    })
  })

  async function openReview(): Promise<void> {
    panel()
    fireEvent.click(await screen.findByText(/review/))
    fireEvent.click(await screen.findByText('Review'))
    await screen.findByText('src/a.ts')
  }

  it('reads the diff against what the agent said it did', async () => {
    api.runTranscript.mockResolvedValue({
      lines: [{ role: 'assistant', text: 'also shortened the idle timeout', at: 1 }],
    })
    await openReview()
    await waitFor(() =>
      expect(api.reviewIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          agentAccount: 'also shortened the idle timeout',
        })
      )
    )
  })

  it('names what was changed without being asked', async () => {
    api.reviewIntent.mockResolvedValue({
      intent: {
        request: 'add validation',
        agentAccount: 'done',
        unexpectedFiles: ['src/session-timeout.ts'],
        untouchedFiles: [],
        hasScopeConcern: true,
      },
    })
    await openReview()
    expect(await screen.findByText(/src\/session-timeout.ts/)).toBeDefined()
  })

  it('names what was asked for and never touched', async () => {
    api.reviewIntent.mockResolvedValue({
      intent: {
        request: 'add validation to src/api.ts',
        agentAccount: 'done',
        unexpectedFiles: [],
        untouchedFiles: ['src/api.ts'],
        hasScopeConcern: false,
      },
    })
    await openReview()
    expect(await screen.findByText(/never touched: src\/api.ts/)).toBeDefined()
  })

  it('says so when the change is exactly what was asked for', async () => {
    api.reviewIntent.mockResolvedValue({
      intent: {
        request: 'add validation',
        agentAccount: 'done',
        unexpectedFiles: [],
        untouchedFiles: [],
        hasScopeConcern: false,
      },
    })
    await openReview()
    expect(await screen.findByText(/Everything it changed was asked for/)).toBeDefined()
  })

  it('walks the four steps, and knows when they are done', async () => {
    await openReview()
    fireEvent.click(screen.getByText('Next step'))
    await waitFor(() => expect(api.reviewAdvance).toHaveBeenCalledWith({ sessionId: 'session-1' }))
    expect(await screen.findByText(/Step: risk/)).toBeDefined()

    api.reviewAdvance.mockResolvedValue({ step: null })
    fireEvent.click(screen.getByText('Next step'))
    expect(await screen.findByText(/every step taken/)).toBeDefined()
  })
})

describe('what merged with nobody looking', () => {
  it('shows nothing when nothing has', async () => {
    panel()
    fireEvent.click(await screen.findByText(/review/))
    await screen.findByText(/Nothing is waiting to be reviewed/)
    expect(screen.queryByText(/Merged without review/)).toBeNull()
  })

  it('records it next to the queue it bypassed', async () => {
    api.unattendedMerges.mockResolvedValue({
      merges: [
        {
          sessionId: 'session-9',
          repoPath: '/repo/.worktrees/deps',
          mergedAt: 1,
          gradeTrigger: 'lockfile, formatting or dependency bump with green checks',
          checkState: 'passing',
          diffSummary: { files: 1, added: 4, removed: 4 },
        },
      ],
    })
    panel()
    fireEvent.click(await screen.findByText(/review/))
    expect(await screen.findByText(/Merged without review: 1/)).toBeDefined()
  })
})

describe('being jumped to from the palette', () => {
  it('opens the section the thing lives in, not whichever tab was last used', async () => {
    // A jump that lands on the wrong tab reads as having done nothing.
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [
        {
          sessionId: 'session-1',
          branch: 'feat/thing',
          grade: 'P1',
          gradeTrigger: 'shared contract file',
          queuedAt: 1,
          diffSummary: { files: 1, added: 1, removed: 0 },
        },
      ],
      backpressure: { allowed: true, unreviewed: 1, limit: 3 },
    })
    panel({ focus: { kind: 'review', sessionId: 'session-1' } })
    expect(await screen.findByText(/shared contract file/)).toBeDefined()
  })

  it('opens the diff of the one it was pointed at', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [
        {
          sessionId: 'session-1',
          branch: 'feat/thing',
          grade: 'P1',
          gradeTrigger: 'shared contract file',
          queuedAt: 1,
          diffSummary: { files: 1, added: 1, removed: 0 },
        },
      ],
      backpressure: { allowed: true, unreviewed: 1, limit: 3 },
    })
    api.reviewHunks.mockResolvedValue({
      files: [{ file: 'proto/session.proto', hunks: [] }],
      complete: false,
      fullReject: false,
    })
    panel({ focus: { kind: 'review', sessionId: 'session-1' } })
    expect(await screen.findByText('proto/session.proto')).toBeDefined()
  })
})

describe('what happened while you were away', () => {
  it('attributes an entry the pilot wrote rather than blurring it with the agent', async () => {
    // A feed that blurs the two is one you stop trusting.
    api.feedList.mockResolvedValue({
      entries: [
        {
          id: 'e1',
          at: Date.now(),
          sessionId: 'session-1',
          author: 'console',
          summary: 'stopped making progress',
          replyable: false,
        },
      ],
    })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    expect(await screen.findByText('Pilot')).toBeDefined()
  })
})

describe('since you last looked', () => {
  const entry = {
    id: 'e1',
    at: Date.now(),
    sessionId: 'session-1',
    author: 'agent' as const,
    summary: 'ready to review',
    replyable: false,
  }

  it('asks nothing of a first visit — there is no "last" yet', async () => {
    api.feedList.mockResolvedValue({ entries: [entry] })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    await screen.findByText('ready to review')
    expect(api.feedDigest).not.toHaveBeenCalled()
  })

  it('asks from when you last looked', async () => {
    window.localStorage.setItem('speckit.feed.lastLookedAt', '1000')
    api.feedList.mockResolvedValue({ entries: [entry] })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    await waitFor(() => expect(api.feedDigest).toHaveBeenCalledWith({ from: 1000 }))
  })

  it('rolls it up rather than replaying it line by line', async () => {
    window.localStorage.setItem('speckit.feed.lastLookedAt', String(Date.now() - 60_000))
    api.feedList.mockResolvedValue({ entries: [entry] })
    api.feedDigest.mockResolvedValue({
      from: Date.now() - 60_000,
      to: Date.now(),
      entryCount: 7,
      sessionCount: 2,
      bySession: [],
    })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    expect(await screen.findByText(/7 things across 2 runs/)).toBeDefined()
  })

  it('says nothing when nothing happened while you were away', async () => {
    // A heading that reads "0 things" is noise you learn to skip past.
    window.localStorage.setItem('speckit.feed.lastLookedAt', '1000')
    api.feedList.mockResolvedValue({ entries: [entry] })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    await screen.findByText('ready to review')
    expect(screen.queryByText(/Since you last looked/)).toBeNull()
  })
})

describe('saying how long', () => {
  it.each([
    [45_000, '45s'],
    [600_000, '10m'],
    [7_200_000, '2.0h'],
  ])('says %i as %s', (ms, said) => {
    // 29753435m was on screen for a week, because minutes were the only unit.
    expect(elapsed(ms)).toBe(said)
  })

  it('never says a negative age', () => {
    expect(elapsed(-5_000)).toBe('0s')
  })
})
