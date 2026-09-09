import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { Floor } from '../../src/components/Floor.js'

// Where you watch, not where you act — with one exception, which is getting
// into a running agent's terminal.
//
// The merge-order section is the multi-repository half: it only appears when
// there is more than one repository, and what it says about a hold is the
// rule's own sentence rather than a number the view reassembled.

const NODES = [
  {
    id: 'N-1',
    unitId: 'U-1',
    lane: 1,
    role: 'builder',
    kind: 'agent',
    state: 'running',
    sessionId: 's-1',
    attempts: 1,
    startedAt: null,
    endedAt: null,
    dependsOn: [],
    stepId: 'build',
  },
  {
    id: 'N-2',
    unitId: 'U-2',
    lane: 2,
    role: 'builder',
    kind: 'agent',
    state: 'waiting',
    sessionId: null,
    attempts: 0,
    startedAt: null,
    endedAt: null,
    dependsOn: ['N-1'],
    stepId: 'build',
  },
]

function reply(over: Record<string, unknown> = {}) {
  return {
    graph: { orderId: 'WO-1', recipe: 'standard', nodes: NODES },
    ready: ['N-1'],
    blocked: [],
    ...over,
  }
}

let invoke: ReturnType<typeof vi.fn>

function mount(view: Record<string, unknown>, live: Record<string, unknown> = {}) {
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:run.observe') return view
    if (channel === 'foundry:permissions-list') return { pending: live.pending ?? [] }
    if (channel === 'foundry:supervision-snapshot') {
      return { review: live.review ?? [], backpressure: live.backpressure }
    }
    if (channel === 'foundry:stalls-list') {
      return { firings: live.stalls ?? [], shadowMode: live.shadowMode ?? true }
    }
    if (channel === 'foundry:review-hunks') {
      return {
        files: live.hunks ?? [],
        complete: live.complete ?? true,
        fullReject: live.fullReject ?? false,
      }
    }
    if (channel === 'foundry:run.resume') return live.resume ?? { started: true, reclaimed: [] }
    if (channel === 'foundry:run.stop') return live.stop ?? { ok: true }
    if (channel === 'foundry:review-decide-hunk') return live.decideHunk ?? { ok: true }
    if (channel === 'foundry:permission-hand-back') return live.handBack ?? { ok: true }
    if (channel === 'foundry:run-terminal') return live.terminal ?? { ok: true }
    if (channel === 'foundry:review-apply') return live.apply ?? { ok: true, reverted: 0 }
    if (channel === 'foundry:review-done') return { ok: true }
    if (channel === 'foundry:review-intent') return { intent: live.intent ?? null }
    if (channel === 'foundry:review-advance') return { step: live.step ?? null }
    if (channel === 'foundry:feed-list') {
      return { entries: live.feed ?? [], mutes: live.mutes ?? [] }
    }
    if (channel === 'foundry:feed-unmute') return { mutes: [] }
    if (channel === 'foundry:feed-dismiss' || channel === 'foundry:feed-mute') return { ok: true }
    if (channel === 'foundry:run-transcript') return { lines: live.lines ?? [] }
    if (channel === 'foundry:permission-resolve') return live.resolve ?? { ok: true }
    if (
      channel === 'foundry:run-interrupt' ||
      channel === 'foundry:run-stop' ||
      channel === 'foundry:run-redirect'
    ) {
      return live.control ?? { ok: true }
    }
    return { terminalSessionId: 't-1', ok: true }
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  render(<Floor orderId="WO-1" />)
}

const TWO_LANES = [
  {
    ord: 1,
    repo: 'proto',
    role: 'producer',
    collisions: ['proto/session.proto'],
    blockedBy: [],
    hold: null,
  },
  {
    ord: 2,
    repo: 'cli-flow',
    role: 'consumer',
    collisions: ['proto/session.proto'],
    blockedBy: [1],
    hold: 'lane 1 (proto) must merge first — they share proto/session.proto',
  },
]

beforeEach(() => vi.clearAllMocks())

describe('the merge order section', () => {
  it('lists the repositories in the order they land', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => expect(screen.getByText('Merge order')).toBeTruthy())
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(items[0]).toContain('proto')
    expect(items[1]).toContain('cli-flow')
  })

  it('says which lane produces the shared change', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    expect(screen.getByText('producer')).toBeTruthy()
    expect(screen.getByText('consumer')).toBeTruthy()
  })

  it('names the file the lanes share, on both of them', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    expect(screen.getAllByText(/shares proto\/session\.proto/)).toHaveLength(2)
  })

  it("gives the rule's own reason for a hold, not a lane number", async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    expect(screen.getByText(/must merge first/)).toBeTruthy()
  })

  it('says a lane is free to merge when nothing holds it', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    expect(screen.getByText('free to merge')).toBeTruthy()
  })

  it('shows nothing at all for a single-repository order (FR-068)', async () => {
    mount(reply({ lanes: [{ ...TWO_LANES[0], collisions: [], role: null }] }))
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText('Merge order')).toBeNull()
  })

  it('shows nothing when the run predates lane reporting', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText('Merge order')).toBeNull()
  })
})

describe('the units', () => {
  it('names each row by its repository rather than by a lane number', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    // Twice each: once in the merge order, once as the unit row heading.
    expect(screen.getAllByText('proto')).toHaveLength(2)
    expect(screen.getAllByText('cli-flow')).toHaveLength(2)
  })

  it('falls back to the lane number when the order names no repository', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.getByText('lane 1')).toBeTruthy()
  })

  it('offers a way into a running agent session, and only a running one', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    const buttons = screen.getAllByRole('button', { name: /^Attach to/ })
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Attach to N-1'])

    fireEvent.click(buttons[0])
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:session.attach', {
        orderId: 'WO-1',
        nodeId: 'N-1',
      })
    )
  })

  it('reports what is blocked and why', async () => {
    mount(reply({ blocked: [{ id: 'N-2', reason: 'N-1 has not passed' }] }))
    await waitFor(() => screen.getByText('Blocked'))
    expect(screen.getByText(/N-1 has not passed/)).toBeTruthy()
  })
})

describe('when there is no run', () => {
  it('says so rather than spinning', async () => {
    mount({ error: 'No run for WO-1.' })
    await waitFor(() => expect(screen.getByText('No run for WO-1.')).toBeTruthy())
  })
})

const ASK = {
  requestId: 'r-1',
  sessionId: 's-1',
  toolName: 'Write',
  summary: 'Write src/auth/session.ts',
  detail: '{ "file_path": "src/auth/session.ts" }',
  at: 1,
}

describe('a held tool call', () => {
  it('shows what is being asked, and which tool is asking', async () => {
    mount(reply(), { pending: [ASK] })
    await waitFor(() => expect(screen.getByText('Waiting on you — 1')).toBeTruthy())
    expect(screen.getByText('Write src/auth/session.ts')).toBeTruthy()
    expect(screen.getByText('Write')).toBeTruthy()
  })

  it('shows the ask in full, not only its one-line summary', async () => {
    mount(reply(), { pending: [ASK] })
    await waitFor(() => screen.getByText('Waiting on you — 1'))
    expect(screen.getByText(/file_path/)).toBeTruthy()
  })

  it('can be answered without leaving the surface', async () => {
    mount(reply(), { pending: [ASK] })
    await waitFor(() => screen.getByText('Waiting on you — 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:permission-resolve', {
        requestId: 'r-1',
        decision: 'allow',
      })
    )
  })

  it('can be refused', async () => {
    mount(reply(), { pending: [ASK] })
    await waitFor(() => screen.getByText('Waiting on you — 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:permission-resolve', {
        requestId: 'r-1',
        decision: 'deny',
      })
    )
  })

  it('says why a click did nothing, rather than looking answered', async () => {
    mount(reply(), {
      pending: [ASK],
      resolve: { ok: false, reason: 'that request is no longer waiting' },
    })
    await waitFor(() => screen.getByText('Waiting on you — 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(screen.getByText(/no longer waiting/)).toBeTruthy())
  })

  it('hands one back to the terminal and goes there', async () => {
    mount(reply(), { pending: [ASK] })
    await waitFor(() => screen.getByText('Waiting on you — 1'))
    fireEvent.click(screen.getByRole('button', { name: /In the terminal/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:permission-hand-back', { requestId: 'r-1' })
    )
    expect(invoke).toHaveBeenCalledWith('foundry:run-terminal', { sessionId: 's-1' })
  })

  it('shows no panel when nothing is waiting', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText(/Waiting on you/)).toBeNull()
  })
})

describe('watching a run', () => {
  it('shows nothing until a unit is chosen', async () => {
    mount(reply(), { lines: ['reading src/auth/session.ts'] })
    await waitFor(() => screen.getByText(/WO-1/))
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:run-transcript')).toHaveLength(0)
  })

  it('shows what the agent has been saying', async () => {
    mount(reply(), { lines: ['reading src/auth/session.ts'] })
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Watch N-1' }))
    await waitFor(() => expect(screen.getByText(/reading src\/auth/)).toBeTruthy())
  })

  it('says so when there is nothing yet, rather than showing an empty box', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Watch N-1' }))
    await waitFor(() => expect(screen.getByText('Nothing yet.')).toBeTruthy())
  })

  it('redirects it', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Watch N-1' }))
    await waitFor(() => screen.getByLabelText('Tell it what to do instead'))

    fireEvent.change(screen.getByLabelText('Tell it what to do instead'), {
      target: { value: 'use the existing helper' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Redirect/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-redirect', {
        sessionId: 's-1',
        message: 'use the existing helper',
      })
    )
  })

  it('interrupts it', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Watch N-1' }))
    await waitFor(() => screen.getByRole('button', { name: 'Interrupt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-interrupt', { sessionId: 's-1' })
    )
  })

  it('stops it, saying why', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Watch N-1' }))
    await waitFor(() => screen.getByRole('button', { name: 'Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-stop', {
        sessionId: 's-1',
        reason: 'stopped from the floor',
      })
    )
  })

  it('says so when the run is already over', async () => {
    mount(reply(), { control: { ok: false } })
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Watch N-1' }))
    await waitFor(() => screen.getByRole('button', { name: 'Interrupt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    await waitFor(() => expect(screen.getByText('that run is no longer live')).toBeTruthy())
  })

  it('offers neither control for a unit with no session', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByRole('button', { name: 'Watch N-2' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Attach to N-2' })).toBeNull()
  })
})

const REVIEW = {
  sessionId: 's-1',
  branch: 'foundry/wo-1',
  grade: 'P0',
  gradeTrigger: 'touches authentication',
  diffSummary: { files: 2, added: 40, removed: 3 },
  step: 'intent',
}

const HUNKS = [
  {
    file: 'src/auth/session.ts',
    hunks: [
      { id: 'h-1', newStart: 10, lines: ['+  if (expired) return null'], decision: null },
      { id: 'h-2', newStart: 40, lines: ['+  console.log(token)'], decision: null },
    ],
  },
]

describe('finished work nobody has looked at', () => {
  it('lists it worst risk first, with the reason for the grade', async () => {
    mount(reply(), { review: [REVIEW] })
    await waitFor(() => expect(screen.getByText('To review — 1')).toBeTruthy())
    expect(screen.getByText('P0')).toBeTruthy()
    expect(screen.getByText(/touches authentication/)).toBeTruthy()
    expect(screen.getByText(/2 files/)).toBeTruthy()
  })

  it('shows nothing when nothing is waiting', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText(/To review/)).toBeNull()
  })

  it('opens the diff hunk by hunk, because one file holds both changes', async () => {
    mount(reply(), { review: [REVIEW], hunks: HUNKS })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))

    await waitFor(() => expect(screen.getByText('src/auth/session.ts')).toBeTruthy())
    expect(screen.getByText(/if \(expired\) return null/)).toBeTruthy()
    expect(screen.getByText(/console\.log\(token\)/)).toBeTruthy()
  })

  it('accepts and rejects one at a time', async () => {
    mount(reply(), { review: [REVIEW], hunks: HUNKS })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => screen.getByText('src/auth/session.ts'))

    fireEvent.click(screen.getByRole('button', { name: 'Accept h-1' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:review-decide-hunk', {
        sessionId: 's-1',
        hunkId: 'h-1',
        decision: 'accept',
      })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reject h-2' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:review-decide-hunk', {
        sessionId: 's-1',
        hunkId: 'h-2',
        decision: 'reject',
      })
    )
  })

  it('applies what was decided, which is what makes a rejection mean anything', async () => {
    mount(reply(), { review: [REVIEW], hunks: HUNKS })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => screen.getByText('src/auth/session.ts'))

    fireEvent.click(screen.getByRole('button', { name: /Apply what I decided/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:review-apply', { sessionId: 's-1' })
    )
    expect(invoke).toHaveBeenCalledWith('foundry:review-done', { sessionId: 's-1' })
  })

  it('says why it could not apply them, rather than closing as though it had', async () => {
    mount(reply(), {
      review: [REVIEW],
      hunks: HUNKS,
      apply: { ok: false, error: 'the worktree moved under it' },
    })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => screen.getByText('src/auth/session.ts'))

    fireEvent.click(screen.getByRole('button', { name: /Apply what I decided/ }))
    await waitFor(() => expect(screen.getByText(/worktree moved under it/)).toBeTruthy())
    expect(screen.getByText('src/auth/session.ts')).toBeTruthy()
  })

  it('tells a runtime that never started apart from a change that touched nothing', async () => {
    mount(reply(), { review: [REVIEW], hunks: null })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => expect(screen.getByText(/supervision runtime is not running/)).toBeTruthy())
  })

  it('says a run that changed nothing changed nothing', async () => {
    mount(reply(), { review: [REVIEW], hunks: [] })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => expect(screen.getByText('This run changed nothing.')).toBeTruthy())
  })
})

describe('the request against what the agent says it did', () => {
  it('names what was touched without being asked', async () => {
    mount(reply(), {
      review: [REVIEW],
      hunks: HUNKS,
      intent: {
        unexpectedFiles: ['src/config/timeouts.ts'],
        untouchedFiles: [],
        hasScopeConcern: true,
      },
    })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() =>
      expect(
        screen.getByText(/Touched without being asked: src\/config\/timeouts\.ts/)
      ).toBeTruthy()
    )
  })

  it('names what was asked for and never touched, which often means it was not done', async () => {
    mount(reply(), {
      review: [REVIEW],
      hunks: HUNKS,
      intent: {
        unexpectedFiles: [],
        untouchedFiles: ['src/auth/refresh.ts'],
        hasScopeConcern: true,
      },
    })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() =>
      expect(screen.getByText(/never touched: src\/auth\/refresh\.ts/)).toBeTruthy()
    )
  })

  it('says nothing when the change was what was asked for', async () => {
    mount(reply(), {
      review: [REVIEW],
      hunks: HUNKS,
      intent: { unexpectedFiles: [], untouchedFiles: [], hasScopeConcern: false },
    })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => screen.getByText('src/auth/session.ts'))
    expect(screen.queryByText(/Touched without being asked/)).toBeNull()
  })
})

describe('what happened while you were away', () => {
  const ENTRY = {
    id: 'f-1',
    at: 1,
    sessionId: 's-1',
    author: 'agent',
    summary: 'edited session.ts',
  }

  it('lists it, newest first', async () => {
    mount(reply(), { feed: [ENTRY, { ...ENTRY, id: 'f-2', summary: 'ran the tests' }] })
    await waitFor(() => expect(screen.getByText('Activity')).toBeTruthy())
    const rows = screen.getAllByText(/edited session|ran the tests/).map((e) => e.textContent)
    expect(rows[0]).toBe('ran the tests')
  })

  it('clears one line without hiding the rest', async () => {
    mount(reply(), { feed: [ENTRY] })
    await waitFor(() => screen.getByText('Activity'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss f-1' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:feed-dismiss', { id: 'f-1', sessionId: 's-1' })
    )
  })

  it('mutes a run that keeps interrupting, without hiding what it does', async () => {
    mount(reply(), { feed: [ENTRY] })
    await waitFor(() => screen.getByText('Activity'))
    fireEvent.click(screen.getByRole('button', { name: 'Mute s-1' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:feed-mute', { id: 'f-1', sessionId: 's-1' })
    )
  })

  it('shows no section when nothing has happened', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText('Activity')).toBeNull()
  })
})

describe('a mute you can find again', () => {
  it('shows what is silenced', async () => {
    mount(reply(), { mutes: [{ sessionId: 's-1' }] })
    await waitFor(() => expect(screen.getByText(/Silenced/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Unmute s-1' })).toBeTruthy()
  })

  it('puts it back', async () => {
    mount(reply(), { mutes: [{ sessionId: 's-1' }] })
    await waitFor(() => screen.getByText(/Silenced/))
    fireEvent.click(screen.getByRole('button', { name: 'Unmute s-1' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:feed-unmute', { sessionId: 's-1' })
    )
  })

  it('shows the panel for a mute even when the feed is empty', async () => {
    mount(reply(), { mutes: [{ author: 'agent' }] })
    await waitFor(() => expect(screen.getByText('Activity')).toBeTruthy())
  })
})

describe('why a new run would be refused', () => {
  it('says so, with the queue depth', async () => {
    mount(reply(), {
      backpressure: { allowed: false, unreviewed: 3, limit: 3, reason: '3 diffs are unreviewed' },
    })
    await waitFor(() => expect(screen.getByText(/3 diffs are unreviewed/)).toBeTruthy())
    expect(screen.getByText(/A new run is refused/)).toBeTruthy()
  })

  it('says nothing while runs are allowed', async () => {
    mount(reply(), { backpressure: { allowed: true, unreviewed: 0, limit: 3, reason: null } })
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText(/A new run is refused/)).toBeNull()
  })
})

describe('work that stopped making progress', () => {
  // The detector's own shape. `signal` is 'silence' or 'loop' and nothing else
  // — a fixture that put a readable sentence in it meant this panel was only
  // ever tested rendering words production could never send it, and what it
  // actually drew was "s-1 — silence".
  const FIRING = {
    firing: {
      sessionId: 's-1',
      signal: 'silence',
      firedAt: 1,
      inputs: {
        toolSilenceMs: 8 * 60_000,
        diffSilenceMs: 8 * 60_000,
        distinctFiles: 1,
        netChange: 0,
        shellInFlight: false,
      },
    },
    featureDir: '/d',
    shadow: true,
  }

  it('shows it — the failure nobody instruments looks exactly like work', async () => {
    mount(reply(), { stalls: [FIRING] })
    await waitFor(() => expect(screen.getByText(/Stopped making progress/)).toBeTruthy())
    expect(screen.getByText(/no tool call for 8 minutes/)).toBeTruthy()
  })

  it('names the step, not the session id nobody chose', async () => {
    mount(reply({ labels: { 'N-1': 'builder · U-1 the first bit' } }), { stalls: [FIRING] })
    const heading = await screen.findByText(/Stopped making progress/)
    const panel = heading.closest('section') as HTMLElement
    expect(within(panel).getByText(/builder · U-1/)).toBeTruthy()
    expect(within(panel).queryByText('s-1')).toBeNull()
  })

  it('says what going round in circles is, rather than printing "loop"', async () => {
    mount(reply(), {
      stalls: [{ ...FIRING, firing: { ...FIRING.firing, signal: 'loop' } }],
    })
    await waitFor(() => screen.getByText(/Stopped making progress/))
    expect(screen.getByText(/round in circles/)).toBeTruthy()
  })

  // A panel that names a stall and offers nothing is a wall. These are the
  // three things you actually do about one.
  it('offers reading what it was saying', async () => {
    mount(reply(), { stalls: [FIRING] })
    await waitFor(() => screen.getByText(/Stopped making progress/))
    fireEvent.click(screen.getByRole('button', { name: /Read what it was saying/ }))
    await waitFor(() =>
      expect(invoke.mock.calls.some((c) => c[0] === 'foundry:run-transcript')).toBe(true)
    )
  })

  it('offers taking it over in its own terminal', async () => {
    mount(reply(), { stalls: [FIRING] })
    await waitFor(() => screen.getByText(/Stopped making progress/))
    fireEvent.click(screen.getByRole('button', { name: /Take it over/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-terminal', { sessionId: 's-1' })
    )
  })

  it('offers ending it, which is the answer when it is not coming back', async () => {
    mount(reply(), { stalls: [FIRING] })
    await waitFor(() => screen.getByText(/Stopped making progress/))
    fireEvent.click(screen.getByRole('button', { name: /End this agent/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'foundry:run-stop',
        expect.objectContaining({
          sessionId: 's-1',
        })
      )
    )
  })

  it('says when it is only recording, so a quiet list is not read as a clean run', async () => {
    mount(reply(), { stalls: [FIRING], shadowMode: true })
    await waitFor(() => screen.getByText(/Stopped making progress/))
    expect(screen.getByText(/recorded, not acted on/)).toBeTruthy()
  })

  it('drops the caveat once shadow mode is off', async () => {
    mount(reply(), { stalls: [FIRING], shadowMode: false })
    await waitFor(() => screen.getByText(/Stopped making progress/))
    expect(screen.queryByText(/recorded, not acted on/)).toBeNull()
  })

  it('shows nothing when nothing stalled', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText(/Stopped making progress/)).toBeNull()
  })
})

describe('half a review is not a review', () => {
  it('refuses to apply until every hunk is decided', async () => {
    mount(reply(), { review: [REVIEW], hunks: HUNKS, complete: false })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => screen.getByText('src/auth/session.ts'))

    const apply = screen.getByRole('button', { name: /Decide every hunk first/ })
    expect(apply.hasAttribute('disabled')).toBe(true)
  })

  it('allows it once they are', async () => {
    mount(reply(), { review: [REVIEW], hunks: HUNKS, complete: true })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Apply what I decided/ }).hasAttribute('disabled')
      ).toBe(false)
    )
  })

  it('warns before applying a full rejection', async () => {
    mount(reply(), { review: [REVIEW], hunks: HUNKS, complete: true, fullReject: true })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => expect(screen.getByText(/takes the whole change back out/)).toBeTruthy())
  })

  it('says how much came back out, so "applied" is not read as "nothing happened"', async () => {
    mount(reply(), {
      review: [REVIEW],
      hunks: HUNKS,
      complete: true,
      apply: { ok: true, reverted: 2 },
    })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => screen.getByRole('button', { name: /Apply what I decided/ }))
    fireEvent.click(screen.getByRole('button', { name: /Apply what I decided/ }))
    await waitFor(() => expect(screen.getByText(/2 hunks reverted/)).toBeTruthy())
  })

  it('says so when nothing was reverted', async () => {
    mount(reply(), {
      review: [REVIEW],
      hunks: HUNKS,
      complete: true,
      apply: { ok: true, reverted: 0 },
    })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => screen.getByRole('button', { name: /Apply what I decided/ }))
    fireEvent.click(screen.getByRole('button', { name: /Apply what I decided/ }))
    await waitFor(() => expect(screen.getByText(/Nothing was reverted/)).toBeTruthy())
  })
})

describe('which of the four questions the reviewer is on', () => {
  it('says it, rather than leaving a queue with steps invisible', async () => {
    mount(reply(), { review: [REVIEW], hunks: HUNKS, step: 'risk' })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => expect(screen.getByText(/What does it put at risk/)).toBeTruthy())
  })

  it("falls back to the item's own step when the queue has no next one", async () => {
    mount(reply(), { review: [REVIEW], hunks: HUNKS, step: null })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => expect(screen.getByText(/Is this what was asked for/)).toBeTruthy())
  })
})

// Watching a run means knowing what is being built. `N-1` is the handle the
// graph and the ledger use, and on its own it says nothing.
describe('what a node is called on the Floor', () => {
  const LABELS = { 'N-1': 'builder · U-1 refresh the token on a 401', 'N-2': 'verifier · U-2' }

  it('shows what the node is, not the id the graph uses', async () => {
    mount(reply({ labels: LABELS }))
    await waitFor(() =>
      expect(screen.getByText(/builder · U-1 refresh the token on a 401/)).toBeTruthy()
    )
    expect(screen.queryByText('N-1')).toBeNull()
  })

  it('keeps the id reachable, because it is what the record calls this node', async () => {
    mount(reply({ labels: LABELS }))
    const chip = await waitFor(() =>
      screen.getByText(/builder · U-1 refresh/).closest('.fdry-unit')
    )
    expect(chip?.getAttribute('title')).toBe('N-1')
  })

  it('names the node in the controls that act on it', async () => {
    mount(reply({ labels: LABELS }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Watch builder · U-1 refresh the token on a 401/ })
      ).toBeTruthy()
    )
  })

  it('falls back to the id when nothing supplied a label', async () => {
    mount(reply())
    await waitFor(() => expect(screen.getByText('N-1')).toBeTruthy())
  })

  it('names a blocked node the same way the chips do', async () => {
    mount(
      reply({
        labels: LABELS,
        blocked: [{ id: 'N-2', reason: 'waiting on builder · U-1 refresh the token on a 401' }],
      })
    )
    await waitFor(() => expect(screen.getByText('Blocked')).toBeTruthy())
    // Once as a chip, once in the Blocked panel — the same name in both, which
    // is the point.
    expect(screen.getAllByText('verifier · U-2')).toHaveLength(2)
    expect(screen.getByText(/waiting on builder · U-1 refresh the token on a 401/)).toBeTruthy()
  })
})

describe('the group that is not a lane', () => {
  it('says the nodes with no lane belong to the whole order', async () => {
    mount(
      reply({
        graph: {
          orderId: 'WO-1',
          recipe: 'direct',
          nodes: [
            {
              id: 'N-9',
              unitId: null,
              lane: null,
              role: null,
              kind: 'gate',
              state: 'waiting',
              sessionId: null,
              attempts: 0,
              startedAt: null,
              endedAt: null,
              dependsOn: [],
              stepId: 'ship',
            },
          ],
        },
        labels: { 'N-9': 'ship' },
      })
    )
    await waitFor(() => expect(screen.getByText('the whole order')).toBeTruthy())
  })
})

// Two clicks that used to fail in silence. Both reply `{ ok: false }`, and
// both replies were thrown away.
describe('the refusals a click used to swallow', () => {
  const ASK = {
    requestId: 'r-1',
    sessionId: 's-1',
    toolName: 'Bash',
    summary: 'rm -rf build',
    at: Date.now(),
  }

  it('says so when the request is no longer waiting to be handed back', async () => {
    mount(reply(), { pending: [ASK], handBack: { ok: false } })
    await waitFor(() => screen.getByRole('button', { name: /In the terminal/i }))
    fireEvent.click(screen.getByRole('button', { name: /In the terminal/i }))
    await waitFor(() => expect(screen.getByText(/no longer waiting/)).toBeTruthy())
  })

  it('says so when it handed back but there is no terminal to open', async () => {
    mount(reply(), { pending: [ASK], handBack: { ok: true }, terminal: { ok: false } })
    await waitFor(() => screen.getByRole('button', { name: /In the terminal/i }))
    fireEvent.click(screen.getByRole('button', { name: /In the terminal/i }))
    await waitFor(() => expect(screen.getByText(/no longer has a terminal/)).toBeTruthy())
  })
})

describe('a hunk decision the review refused', () => {
  it('says the review is gone rather than looking like it stuck', async () => {
    mount(reply(), { review: [REVIEW], hunks: HUNKS, complete: false, decideHunk: { ok: false } })
    await waitFor(() => screen.getByText('To review — 1'))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    await waitFor(() => screen.getByText('src/auth/session.ts'))
    fireEvent.click(screen.getByRole('button', { name: 'Reject h-1' }))
    await waitFor(() => expect(screen.getByText(/no longer open/)).toBeTruthy())
  })
})

// ── A run nothing is running ────────────────────────────────────────────
//
// The graph on disk says `running` and every agent's terminal died with the
// application that started it. Before this the Floor drew the same chips it
// draws for working agents, so the only way to find out was to come back later
// and notice nothing had moved.

describe('a run whose agents are gone', () => {
  const ORPHANED = reply({
    orphaned: ['N-1'],
    labels: { 'N-1': 'builder · U-1 the first bit' },
  })

  it('says so at the top, across the width, before anything only there to be read', async () => {
    mount(ORPHANED)
    await waitFor(() => expect(screen.getByText(/Nothing is running this/)).toBeTruthy())
    const band = document.querySelector('.fdry-needs-you')
    expect(band?.textContent).toMatch(/Nothing is running this/)
  })

  it('names the steps that stopped, as a person would read them', async () => {
    mount(ORPHANED)
    const heading = await screen.findByText(/Nothing is running this/)
    const band = heading.closest('section') as HTMLElement
    expect(within(band).getByText(/builder · U-1/)).toBeTruthy()
  })

  it('says why, so it does not read as a bug in the surface', async () => {
    mount(ORPHANED)
    await waitFor(() => screen.getByText(/Nothing is running this/))
    expect(screen.getByText(/does not outlive/)).toBeTruthy()
  })

  it('picks the run back up', async () => {
    mount(ORPHANED)
    await waitFor(() => screen.getByText(/Nothing is running this/))
    fireEvent.click(screen.getByRole('button', { name: /Pick it back up/ }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('foundry:run.resume', { id: 'WO-1' }))
  })

  it('stops it, for a run that is not worth restarting', async () => {
    mount(ORPHANED)
    await waitFor(() => screen.getByText(/Nothing is running this/))
    fireEvent.click(screen.getByRole('button', { name: 'Stop the run' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop it' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'foundry:run.stop',
        expect.objectContaining({
          id: 'WO-1',
        })
      )
    )
  })

  // Both order-level controls used to live inside the "nothing is running
  // this" band, so a live run — or one halted at a gate — had no way out on
  // this screen, and `order.cancel` refuses a running order and points back at
  // the gate. Three orders for one ask, all cancelled, is what that cost.
  it('offers a way out of a run that is not orphaned at all', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText(/Nothing is running this/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Stop the run' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy()
  })

  it('says what starting over destroys before it destroys it', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.getByText(/destroys the checkout, the branch/)).toBeTruthy()
    expect(invoke).not.toHaveBeenCalledWith('foundry:run.reset', expect.anything())
  })

  it('starts the same order over, rather than making a fourth one for the same ask', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    fireEvent.click(screen.getByRole('button', { name: 'Destroy it and start over' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'foundry:run.reset',
        expect.objectContaining({ id: 'WO-1' })
      )
    )
  })

  it('reports a refusal rather than looking like it worked', async () => {
    mount(ORPHANED, { resume: { error: 'No order WO-1.' } })
    await waitFor(() => screen.getByText(/Nothing is running this/))
    fireEvent.click(screen.getByRole('button', { name: /Pick it back up/ }))
    await waitFor(() => expect(screen.getByText('No order WO-1.')).toBeTruthy())
  })

  it('stops the chip claiming to be building, which the band has just denied', async () => {
    mount(ORPHANED)
    await screen.findByText(/Nothing is running this/)
    // The chip and the band read the same graph. Left alone it drew "building"
    // under a band saying nothing was running it, and the two together are
    // worse than either — one of them is lying and the surface will not say
    // which.
    const chip = document.querySelector('.fdry-unit') as HTMLElement
    expect(chip.textContent).toContain('stopped')
    expect(chip.className).toContain('is-orphaned')
  })

  it('leaves a genuinely running chip alone', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    const chip = document.querySelector('.fdry-unit') as HTMLElement
    expect(chip.textContent).toContain('building')
    expect(chip.className).not.toContain('is-orphaned')
  })

  it('offers no way into a terminal that is gone', async () => {
    mount(ORPHANED)
    await screen.findByText(/Nothing is running this/)
    // Both the Watch and the Attach control: one reads a transcript that has
    // stopped growing, the other navigates to a tab that no longer exists.
    expect(screen.queryByRole('button', { name: /Attach to/ })).toBeNull()
  })

  it('says nothing when every agent is where it should be', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText(/Nothing is running this/)).toBeNull()
  })
})

describe('getting into a running agent’s terminal', () => {
  it('actually goes there, rather than resolving an id and dropping it', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: /Attach to/ }))
    // The terminal session the attach channel resolved, not the node's own —
    // an agent's claude session and the tab it runs in are different ids.
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-terminal', { sessionId: 't-1' })
    )
  })
})
