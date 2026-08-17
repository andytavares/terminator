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
  reviewApply: vi.fn(),
  feedDismiss: vi.fn(),
  feedMute: vi.fn(),
  feedUnmute: vi.fn(),
}

vi.mock('../../src/types/electron.js', () => ({ getSpeckitAPI: () => api }))

import { SupervisionPanel, elapsed } from '../../src/components/SupervisionPanel.js'
import type { RunHistoryView, RunView, StallFiringView } from '../../src/types/electron.js'

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
    signal: 'silence',
    firedAt: 5_000,
    inputs: {
      toolSilenceMs: 600_000,
      diffSilenceMs: 600_000,
      distinctFiles: 1,
      netChange: 0,
      reverts: 0,
      shellInFlight: false,
    },
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
  api.feedList.mockResolvedValue({ entries: [], mutes: [] })
  api.feedDismiss.mockResolvedValue({ ok: true })
  api.feedMute.mockResolvedValue({ mutes: [] })
  api.feedUnmute.mockResolvedValue({ mutes: [] })
  api.reviewHunks.mockResolvedValue({ files: [], complete: false, fullReject: false })
  api.reviewDecideHunk.mockResolvedValue({ ok: true })
  api.reviewDone.mockResolvedValue({ ok: true })
  api.runTerminal.mockResolvedValue({ ok: true })
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
  api.reviewApply.mockResolvedValue({ ok: true, reverted: 0, error: null })
  window.localStorage.clear()
})

describe('saying that everything is fine', () => {
  it('says nothing is running rather than rendering an empty box', async () => {
    // A surface that is empty because it failed to load looks exactly like one
    // that is empty because all is well, and only one of those is fine.
    panel()
    expect(await screen.findByText('Nothing is running.')).toBeDefined()
  })

  it('reads what the tab counts are made of, not only the section on screen', async () => {
    // Both are in-memory, and the counts on the other tabs are what tells you
    // to look at them.
    panel()
    await waitFor(() => expect(api.supervisionSnapshot).toHaveBeenCalled())
    expect(api.stallsList).toHaveBeenCalled()
  })

  it('leaves the feed alone until it is on screen', async () => {
    // It re-reads a file that grows for the life of the workspace; fetching it
    // every five seconds to render nothing is invisible until the log is long.
    panel()
    await waitFor(() => expect(api.supervisionSnapshot).toHaveBeenCalled())
    expect(api.feedList).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByText(/feed/))
    await waitFor(() => expect(api.feedList).toHaveBeenCalled())
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

  it('discards it against the repository it belongs to, once confirmed', async () => {
    // It deletes the worktree and the branch, uncommitted work included.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    panel()
    fireEvent.click(await screen.findByText('Discard'))
    await waitFor(() =>
      expect(api.runDiscard).toHaveBeenCalledWith({
        sessionId: 'session-1',
        workspacePath: '/repo',
      })
    )
  })

  it('does not discard when the confirmation is declined', async () => {
    // A misclick must not take everything the agent has not committed.
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    panel()
    fireEvent.click(await screen.findByText('Discard'))
    expect(api.runDiscard).not.toHaveBeenCalled()
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

  it('asks the main process to take you there', async () => {
    // This UI is a separate renderer process and cannot select a tab in the
    // window itself; the jump happens where the window is.
    panel()
    fireEvent.click(await screen.findByText('Terminal'))
    await waitFor(() => expect(api.runTerminal).toHaveBeenCalledWith({ sessionId: 'session-1' }))
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

  it('says what finishing will do to the working copy before it does it', async () => {
    // Reverting is not undoable from here, and a button that quietly rewrites
    // the working copy is not one you can trust twice.
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
            { id: 'h1', newStart: 1, lines: ['+kept'], decision: 'accept' as const },
            { id: 'h2', newStart: 9, lines: ['+unwanted'], decision: 'reject' as const },
          ],
        },
      ],
      complete: true,
      fullReject: false,
    })
    panel()
    fireEvent.click(await screen.findByText(/review/))
    fireEvent.click(await screen.findByText('Review'))
    expect(await screen.findByText('Finish review — revert 1 hunk')).toBeDefined()
  })

  it('says so when finishing changes nothing', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [item],
      backpressure: { allowed: true, unreviewed: 1, limit: 3 },
    })
    api.reviewHunks.mockResolvedValue({
      files: [
        {
          file: 'src/auth.ts',
          hunks: [{ id: 'h1', newStart: 1, lines: ['+kept'], decision: 'accept' as const }],
        },
      ],
      complete: true,
      fullReject: false,
    })
    panel()
    fireEvent.click(await screen.findByText(/review/))
    fireEvent.click(await screen.findByText('Review'))
    expect(await screen.findByText('Finish review — keep everything')).toBeDefined()
  })

  it('keeps the review open, and says why, when git refuses the revert', async () => {
    // The decisions are still there to retry, and closing would lose them
    // along with the reason.
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [item],
      backpressure: { allowed: true, unreviewed: 1, limit: 3 },
    })
    api.reviewHunks.mockResolvedValue({
      files: [
        {
          file: 'src/auth.ts',
          hunks: [{ id: 'h1', newStart: 1, lines: ['+x'], decision: 'reject' as const }],
        },
      ],
      complete: true,
      fullReject: true,
    })
    api.reviewApply.mockResolvedValue({
      ok: false,
      reverted: 0,
      error: 'error: patch does not apply',
    })
    panel()
    fireEvent.click(await screen.findByText(/review/))
    fireEvent.click(await screen.findByText('Review'))
    fireEvent.click(await screen.findByText(/Finish review/))
    expect(await screen.findByText(/patch does not apply/)).toBeDefined()
    expect(api.reviewDone).not.toHaveBeenCalled()
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
    fireEvent.click(await screen.findByText(/Finish review/))
    // Applied first: a queue entry removed without the rejections landing is a
    // review that changed nothing while saying it did.
    await waitFor(() => expect(api.reviewApply).toHaveBeenCalledWith({ sessionId: 'session-1' }))
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
      mutes: [],
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
    api.feedList.mockResolvedValue({ entries: [entry], mutes: [] })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    await screen.findByText('ready to review')
    expect(api.feedDigest).not.toHaveBeenCalled()
  })

  it('asks from when you last looked', async () => {
    window.localStorage.setItem('speckit.feed.lastLookedAt', '1000')
    api.feedList.mockResolvedValue({ entries: [entry], mutes: [] })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    await waitFor(() => expect(api.feedDigest).toHaveBeenCalledWith({ from: 1000 }))
  })

  it('rolls it up rather than replaying it line by line', async () => {
    window.localStorage.setItem('speckit.feed.lastLookedAt', String(Date.now() - 60_000))
    api.feedList.mockResolvedValue({ entries: [entry], mutes: [] })
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
    api.feedList.mockResolvedValue({ entries: [entry], mutes: [] })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    await screen.findByText('ready to review')
    expect(screen.queryByText(/Since you last looked/)).toBeNull()
  })
})

describe('which runs may interrupt you', () => {
  const entry = {
    id: 'e1',
    at: Date.now(),
    sessionId: 'session-1',
    author: 'agent' as const,
    summary: 'ready to review',
    replyable: true,
  }

  it('mutes one run rather than turning notifications off wholesale', async () => {
    api.feedList.mockResolvedValue({ entries: [entry], mutes: [] })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    fireEvent.click(await screen.findByText('Mute'))
    await waitFor(() => expect(api.feedMute).toHaveBeenCalledWith({ sessionId: 'session-1' }))
  })

  it('offers to unmute one that is muted', async () => {
    api.feedList.mockResolvedValue({ entries: [entry], mutes: [{ sessionId: 'session-1' }] })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    fireEvent.click(await screen.findByText('Unmute'))
    await waitFor(() => expect(api.feedUnmute).toHaveBeenCalledWith({ sessionId: 'session-1' }))
  })

  it('still shows what a muted run did — muting hides the toast, not the record', async () => {
    api.feedList.mockResolvedValue({ entries: [entry], mutes: [{ sessionId: 'session-1' }] })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    expect(await screen.findByText('ready to review')).toBeDefined()
  })

  it('drops one line, because a list you cannot clear is one you stop reading', async () => {
    api.feedList.mockResolvedValue({ entries: [entry], mutes: [] })
    panel()
    fireEvent.click(await screen.findByText(/feed/))
    fireEvent.click(await screen.findByLabelText('Dismiss ready to review'))
    await waitFor(() => expect(api.feedDismiss).toHaveBeenCalledWith({ id: 'e1' }))
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

const past = (over: Partial<RunHistoryView> = {}): RunHistoryView => ({
  sessionId: 'session-1',
  featureDir: '/repo/specs/021-thing',
  phase: 'specify',
  branch: 'feat/thing',
  outcome: 'approved',
  startedAt: 1_000,
  endedAt: 5_000,
  turns: 4,
  diff: { files: 2, added: 40, removed: 1 },
  asked: 3,
  ...over,
})

describe('what is over', () => {
  it('is somewhere to look, so the live list does not have to be the record too', async () => {
    // Every approved phase used to stay in the run list forever, which made
    // "what is happening right now" unreadable by the third card.
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
      history: [past()],
    })
    render(<SupervisionPanel />)
    fireEvent.click(await screen.findByText(/history/))
    expect(await screen.findByText('approved')).toBeTruthy()
  })

  it('says what the phase actually did, not just that it happened', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
      history: [past()],
    })
    render(<SupervisionPanel />)
    fireEvent.click(await screen.findByText(/history/))
    const meta = await screen.findByText(/specify/)
    expect(meta.textContent).toContain('4 turns')
    expect(meta.textContent).toContain('2 files')
    expect(meta.textContent).toContain('asked 3')
  })

  it('names the card rather than the branch, when it can', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
      history: [past()],
    })
    render(<SupervisionPanel cardLabel={() => 'Make all text red'} />)
    fireEvent.click(await screen.findByText(/history/))
    expect(await screen.findByText('Make all text red')).toBeTruthy()
  })

  it('says so plainly when nothing has finished yet', async () => {
    render(<SupervisionPanel />)
    fireEvent.click(await screen.findByText(/history/))
    expect(await screen.findByText('Nothing has finished yet.')).toBeTruthy()
  })

  it('copes with a main process that does not report history at all', async () => {
    render(<SupervisionPanel />)
    fireEvent.click(await screen.findByText(/history/))
    expect(await screen.findByText('Nothing has finished yet.')).toBeTruthy()
  })

  it('wears no count, since a number that only grows reads as work waiting', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
      history: [past(), past({ phase: 'plan' })],
    })
    render(<SupervisionPanel />)
    const tab = await screen.findByText(/history/)
    await waitFor(() => expect(tab.textContent?.trim()).toBe('history'))
  })

  it('offers no actions, because there is nothing left to do to it', async () => {
    api.supervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
      history: [past()],
    })
    render(<SupervisionPanel workspacePath="/repo" />)
    fireEvent.click(await screen.findByText(/history/))
    await screen.findByText('approved')
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull()
  })
})
