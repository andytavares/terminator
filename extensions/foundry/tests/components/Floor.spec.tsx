import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
    if (channel === 'foundry:supervision-snapshot') return { review: live.review ?? [] }
    if (channel === 'foundry:review-hunks') return { files: live.hunks ?? [] }
    if (channel === 'foundry:review-decide-hunk') return { ok: true }
    if (channel === 'foundry:review-apply') return live.apply ?? { ok: true, reverted: 0 }
    if (channel === 'foundry:review-done') return { ok: true }
    if (channel === 'foundry:review-intent') return { intent: live.intent ?? null }
    if (channel === 'foundry:review-advance') return { step: null }
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
    await waitFor(() => screen.getByRole('button', { name: /Stop/ }))
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
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
