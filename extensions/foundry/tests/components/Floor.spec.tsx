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
    reworks: 0,
    feedback: [],
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
    reworks: 0,
    feedback: [],
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
let openExternal: ReturnType<typeof vi.fn>
let runCommand: ReturnType<typeof vi.fn>
let hasCommand: ReturnType<typeof vi.fn>

function mount(view: Record<string, unknown>, live: Record<string, unknown> = {}) {
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:run.observe') return view
    if (channel === 'foundry:permissions-list') return { pending: live.pending ?? [] }
    if (channel === 'foundry:supervision-snapshot') {
      return { backpressure: live.backpressure }
    }
    if (channel === 'foundry:stalls-list') {
      return { firings: live.stalls ?? [], shadowMode: live.shadowMode ?? true }
    }
    if (channel === 'foundry:run.resume') return live.resume ?? { started: true, reclaimed: [] }
    if (channel === 'foundry:inbox.decide') return live.decide ?? { ok: true }
    if (channel === 'foundry:run.stop') return live.stop ?? { ok: true }
    if (channel === 'foundry:permission-hand-back') return live.handBack ?? { ok: true }
    if (channel === 'foundry:run-terminal') return live.terminal ?? { ok: true }
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
    if (channel === 'foundry:session.attach') return live.attach ?? { terminalSessionId: 't-1' }
    return { terminalSessionId: 't-1', ok: true }
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    shell: { openExternal },
    extension: { runCommand, hasCommand },
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

beforeEach(() => {
  vi.clearAllMocks()
  openExternal = vi.fn(async () => ({ ok: true }))
  runCommand = vi.fn(async () => ({ ok: true }))
  hasCommand = vi.fn(async () => true)
})

describe('the refinery queue', () => {
  it('says the position and what it is behind, with the shared-file count', async () => {
    mount(
      reply({
        queue: {
          position: 2,
          behind: [{ orderId: 'WO-2', title: 'The other order', files: ['src/a.ts', 'src/b.ts'] }],
        },
      })
    )
    await waitFor(() => expect(screen.getByLabelText('Refinery queue')).toBeTruthy())
    expect(screen.getByText('Queued 2nd, behind The other order (2 shared files)')).toBeTruthy()
  })

  it('singularises one shared file', async () => {
    mount(
      reply({
        queue: {
          position: 1,
          behind: [{ orderId: 'WO-2', title: 'The other order', files: ['src/a.ts'] }],
        },
      })
    )
    await waitFor(() => expect(screen.getByLabelText('Refinery queue')).toBeTruthy())
    expect(screen.getByText('Queued 1st, behind The other order (1 shared file)')).toBeTruthy()
  })

  it('says nothing when it is not queued behind anything', async () => {
    mount(reply({ queue: null }))
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByLabelText('Refinery queue')).toBeNull()
  })

  it('says nothing when the run predates queue reporting', async () => {
    mount(reply({}))
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByLabelText('Refinery queue')).toBeNull()
  })
})

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

describe('the CI band', () => {
  it('shows nothing when the run has no CI state', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText('CI')).toBeNull()
  })

  it('says a green run is green, and its round', async () => {
    mount(
      reply({
        ci: {
          round: 2,
          max: 3,
          status: 'green',
          pulls: [{ url: 'https://github.com/x/y/pull/1', checks: [] }],
          reason: '',
          at: '2026-09-06T10:00:00.000Z',
        },
      })
    )
    await waitFor(() => screen.getByText('CI'))
    expect(screen.getByText('Passed')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Round \d of \d/)
  })

  it('says why CI is not measured', async () => {
    mount(
      reply({
        ci: {
          round: 1,
          max: 3,
          status: 'not_measured',
          pulls: [],
          reason: 'no checks were reported',
          at: '2026-09-06T10:00:00.000Z',
        },
      })
    )
    await waitFor(() => screen.getByText('CI'))
    expect(screen.getByText(/Not measured: no checks were reported/)).toBeTruthy()
  })

  describe('while it is still running', () => {
    const CHECKS = [
      {
        name: 'lint',
        bucket: 'pass',
        link: 'https://github.com/x/y/actions/runs/1',
        workflow: 'CI',
      },
      {
        name: 'test',
        bucket: 'pending',
        link: 'https://github.com/x/y/actions/runs/2',
        workflow: 'CI',
      },
    ]

    function watching(over: Record<string, unknown> = {}) {
      return reply({
        ci: {
          round: 0,
          max: 2,
          status: 'watching',
          pulls: [{ url: 'https://github.com/x/y/pull/233', checks: CHECKS }],
          reason: '',
          at: '2026-09-06T10:00:00.000Z',
          ...over,
        },
      })
    }

    it('says what round it is in words, and how many fixes are allowed', async () => {
      mount(watching())
      await waitFor(() => screen.getByText('CI'))
      expect(screen.getByText('First run · up to 2 fixes')).toBeTruthy()
    })

    it('shows a spinner while it watches, and says what it is for', async () => {
      mount(watching())
      await waitFor(() => screen.getByText('CI'))
      expect(screen.getByRole('status', { name: 'Checks are running' })).toBeTruthy()
    })

    it('keeps spinning while it sends the failures back', async () => {
      mount(watching({ status: 'reworking', round: 1 }))
      await waitFor(() => screen.getByText('CI'))
      expect(screen.getByText('Fixing: round 1 of 2')).toBeTruthy()
      expect(screen.getByRole('status', { name: 'Checks are running' })).toBeTruthy()
    })

    it('stops spinning once there is an answer', async () => {
      mount(watching({ status: 'green' }))
      await waitFor(() => screen.getByText('CI'))
      expect(screen.queryByRole('status', { name: 'Checks are running' })).toBeNull()
    })

    it('counts the checks that have finished out of those that have arrived', async () => {
      mount(watching())
      await waitFor(() => screen.getByText('CI'))
      expect(screen.getByText('1 of 2 checks done')).toBeTruthy()
      expect(screen.getByText('lint')).toBeTruthy()
      expect(screen.getByText('test')).toBeTruthy()
    })

    it('links the pull request', async () => {
      mount(watching())
      await waitFor(() => screen.getByText('CI'))
      fireEvent.click(screen.getByRole('link', { name: 'Pull request #233' }))
      expect(openExternal).toHaveBeenCalledWith('https://github.com/x/y/pull/233')
    })

    it('opens a check outside the application, with no window of its own', async () => {
      mount(watching())
      await waitFor(() => screen.getByText('CI'))
      const link = screen.getByRole('link', { name: /lint/ })
      expect(link.getAttribute('target')).toBeNull()
      fireEvent.click(link)
      expect(openExternal).toHaveBeenCalledWith('https://github.com/x/y/actions/runs/1')
    })
  })

  it('lists each check by name, bucket and a link to it', async () => {
    mount(
      reply({
        ci: {
          round: 1,
          max: 3,
          status: 'red',
          pulls: [
            {
              url: 'https://github.com/x/y/pull/1',
              checks: [
                {
                  name: 'test',
                  bucket: 'fail',
                  link: 'https://github.com/x/y/actions/runs/1',
                  workflow: 'CI',
                },
              ],
            },
          ],
          reason: '',
          at: '2026-09-06T10:00:00.000Z',
        },
      })
    )
    await waitFor(() => screen.getByText('CI'))
    expect(screen.getByText('test')).toBeTruthy()
    expect(screen.getByText('fail')).toBeTruthy()
    const link = screen.getByRole('link', { name: /test/i })
    expect(link.getAttribute('href')).toBe('https://github.com/x/y/actions/runs/1')
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
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Attach to builder'])

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

describe('a rework', () => {
  const REWORKED_NODES = NODES.map((n) =>
    n.id === 'N-2'
      ? {
          ...n,
          reworks: 2,
          feedback: [
            {
              from: 'N-1',
              attempt: 1,
              source: 'check',
              command: 'npm test',
              exitCode: 1,
              excerpt: 'FAIL: expected 2 got 3',
              logPath: null,
            },
          ],
        }
      : n
  )

  it('shows a chip counting how many times a node has been sent back', async () => {
    mount(reply({ graph: { orderId: 'WO-1', recipe: 'standard', nodes: REWORKED_NODES } }))
    await waitFor(() => screen.getByText(/Sent back 2×/))
  })

  it('does not show the chip for a node with no reworks', async () => {
    mount(reply())
    await waitFor(() => expect(document.querySelector('[title="N-1"]')).toBeTruthy())
    expect(screen.queryByText(/Sent back/)).toBeNull()
  })

  it('discloses each feedback entry’s command, exit status and excerpt', async () => {
    mount(reply({ graph: { orderId: 'WO-1', recipe: 'standard', nodes: REWORKED_NODES } }))
    await waitFor(() => screen.getByText('Why it was sent back'))
    fireEvent.click(screen.getByText('Why it was sent back'))
    expect(screen.getByText('npm test')).toBeTruthy()
    expect(screen.getByText(/exit/)).toBeTruthy()
    expect(screen.getByText('FAIL: expected 2 got 3')).toBeTruthy()
  })

  it('has no disclosure for a node with no feedback', async () => {
    mount(reply())
    await waitFor(() => expect(document.querySelector('[title="N-1"]')).toBeTruthy())
    expect(screen.queryByText('Why it was sent back')).toBeNull()
  })
})

describe('a node with skills', () => {
  it('shows which skills that node gets', async () => {
    mount(reply({ skills: { 'N-1': ['ci-fix'] } }))
    await waitFor(() => expect(document.querySelector('[title="N-1"]')).toBeTruthy())
    expect(screen.getByText(/Skills: ci-fix/)).toBeTruthy()
  })

  it('omits the line for a node with no skills', async () => {
    mount(reply({ skills: { 'N-1': ['ci-fix'] } }))
    await waitFor(() => expect(document.querySelector('[title="N-2"]')).toBeTruthy())
    const n2 = document.querySelector('[title="N-2"]')?.closest('span')
    expect(n2?.textContent).not.toContain('Skills:')
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

/** A transcript line as `foundry:run-transcript` returns it, not as a string. */
function said(text: string, secondsAgo = 5) {
  return { role: 'assistant', kind: 'text', text, at: Date.now() - secondsAgo * 1000 }
}

describe('watching a run', () => {
  it('opens no watch panel until a unit is chosen', async () => {
    mount(reply(), { lines: [said('reading src/auth/session.ts')] })
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByLabelText('Tell it what to do instead')).toBeNull()
  })

  // The channel returns lines as objects; the panel joined them as strings
  // and printed "[object Object]" — the fixture was a string array.
  it('shows what the agent has been saying', async () => {
    mount(reply(), { lines: [said('reading src/auth/session.ts')] })
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }))
    const panel = await screen.findByRole('region', { name: 'builder' })
    await waitFor(() => expect(within(panel).getByText(/reading src\/auth/)).toBeTruthy())
    expect(panel.textContent).not.toContain('[object Object]')
  })

  // One message now arrives as a line per block; the panel still prints it as
  // the single block of text it printed before.
  it('prints a message with text and tool calls exactly as it did as one line', async () => {
    const at = Date.now() - 5000
    const block = (kind: string, text: string) => ({ role: 'assistant', kind, text, at })
    mount(reply(), {
      lines: [
        block('text', 'checking'),
        block('tool', 'Read: /repo/a.ts'),
        block('tool', 'Bash: npm test'),
      ],
    })
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }))
    const panel = await screen.findByRole('region', { name: 'builder' })
    await waitFor(() => expect(panel.querySelector('pre.fdry-transcript')).not.toBeNull())
    expect(panel.querySelector('pre.fdry-transcript')?.textContent).toBe(
      'checking\nRead: /repo/a.ts\nBash: npm test'
    )
  })

  it('says so when there is nothing yet, rather than showing an empty box', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }))
    await waitFor(() => expect(screen.getByText('Nothing yet.')).toBeTruthy())
  })

  it('redirects it', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }))
    await waitFor(() => screen.getByRole('button', { name: 'Interrupt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-interrupt', { sessionId: 's-1' })
    )
  })

  it('stops it, saying why', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }))
    await waitFor(() => screen.getByRole('button', { name: 'Interrupt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    await waitFor(() => expect(screen.getByText('that run is no longer live')).toBeTruthy())
  })

  it('offers neither control for a unit with no session', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    // One chip has an agent behind it, so exactly one of each control exists.
    expect(screen.getAllByRole('button', { name: 'Transcript' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^Attach to/ })).toHaveLength(1)
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
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: edited session.ts' }))
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
        screen.getByRole('button', { name: /Attach to builder · U-1 refresh the token on a 401/ })
      ).toBeTruthy()
    )
  })

  it('falls back to the role when nothing supplied a label', async () => {
    mount(reply())
    await waitFor(() => expect(screen.getAllByText('builder').length).toBeGreaterThan(0))
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
              reworks: 0,
              feedback: [],
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

describe('a run whose agents are gone', () => {
  // It is the standing band that says this now, rather than a second panel
  // underneath saying the same thing in a different voice.
  const ORPHANED = reply({
    orphaned: ['N-1'],
    labels: { 'N-1': 'builder · U-1 the first bit' },
    standing: {
      kind: 'adrift',
      turn: 'you',
      label: 'nothing running it',
      headline: 'Nothing is running this',
      detail:
        "1 step was still working when the application last closed, and an agent's terminal does not outlive it.",
      done: 0,
      total: 2,
      gateId: null,
    },
  })

  it('says so at the top, across the width, before anything only there to be read', async () => {
    mount(ORPHANED)
    await waitFor(() => expect(screen.getByText(/Nothing is running this/)).toBeTruthy())
    const band = document.querySelector('.fdry-standing')
    expect(band?.textContent).toMatch(/Nothing is running this/)
  })

  it('names the steps that stopped, as a person would read them', async () => {
    mount(ORPHANED)
    const heading = await screen.findByText(/Nothing is running this/)
    const band = heading.closest('section') as HTMLElement
    expect(within(band).getByText(/builder · U-1/)).toBeTruthy()
  })

  it('does not list an orphaned step as an agent starting up', async () => {
    mount(ORPHANED)
    await screen.findByText(/Nothing is running this/)
    expect(screen.queryByText(/Starting — nothing yet/)).toBeNull()
    expect(invoke.mock.calls.some((c) => c[0] === 'foundry:run-transcript')).toBe(false)
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
    // Both the transcript and the Attach control: one reads a transcript that
    // has stopped growing, the other navigates to a tab that no longer exists.
    expect(screen.queryByRole('button', { name: /Attach to/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Transcript' })).toBeNull()
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

// What to do next.
//
// This screen used to open with an order id, a recipe name and a wall of grey
// chips. A run halted two hours earlier at an undecided gate looked exactly
// like a run mid-build, the gate holding it was named nowhere on the screen,
// and the list that sent you here said the same order was "ready to hand off".
describe('the standing band', () => {
  function standing(over: Record<string, unknown> = {}) {
    return {
      kind: 'working',
      turn: 'foundry',
      label: 'building 0/6',
      headline: 'Building',
      detail: '1 agent is working — 0 of 6 steps done.',
      done: 0,
      total: 6,
      gateId: null,
      ...over,
    }
  }

  const GATE = {
    id: 'WO-1-budget.exceeded-1',
    rule: 'budget.exceeded',
    orderId: 'WO-1',
    nodeId: null,
    summary: 'Make all text red has gone past its wall clock budget',
    why: 'The order budgets 90 and this run is at 90.',
    evidence: [],
    options: [
      { id: 'raise', label: 'Raise the budget', consequence: 'Work continues with more room.' },
      { id: 'stop', label: 'Stop here', consequence: 'The order is cancelled and reconciled.' },
      { id: 'hold', label: 'Hold', consequence: 'Nothing proceeds until you come back to it.' },
    ],
    defaultIfIgnored: 'hold',
    deadline: null,
    blockedUnits: 5,
    riskGrade: 'P2',
    raisedAt: '2026-09-09T18:12:21.514Z',
    decision: null,
  }

  it('opens with where the run stands and what the order is called', async () => {
    mount(reply({ standing: standing(), title: 'Make all text in the application red' }))
    await waitFor(() => expect(screen.getByText('Building')).toBeTruthy())
    expect(screen.getByText('Make all text in the application red')).toBeTruthy()
    expect(screen.getByText('1 agent is working — 0 of 6 steps done.')).toBeTruthy()
  })

  // Reported: "the status is basically always blank". A single build step
  // runs for many minutes at 0 of 3, and the band said nothing else.
  it('shows what each running agent is doing, without choosing one to watch', async () => {
    mount(reply({ standing: standing() }), {
      lines: [said('Read: src/forge/intake.ts', 40), said('Bash: npm test', 3)],
    })
    const band = await screen.findByRole('region', { name: 'Building' })
    await waitFor(() => expect(within(band).getByText('Bash: npm test')).toBeTruthy())
    expect(within(band).getByText('Read: src/forge/intake.ts')).toBeTruthy()
    expect(within(band).getByText('builder')).toBeTruthy()
    expect(within(band).getByText(/\d+s ago/)).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith(
      'foundry:run-transcript',
      expect.objectContaining({ sessionId: 's-1' })
    )
  })

  it('shows one row per message in the live band, the first line of it', async () => {
    const at = Date.now() - 3000
    mount(reply({ standing: standing() }), {
      lines: [
        { role: 'assistant', kind: 'text', text: 'checking', at },
        { role: 'assistant', kind: 'tool', text: 'Bash: npm test', at },
      ],
    })
    const band = await screen.findByRole('region', { name: 'Building' })
    await waitFor(() => expect(within(band).getByText('checking')).toBeTruthy())
    expect(within(band).queryByText('Bash: npm test')).toBeNull()
  })

  it('says a running agent has not said anything yet, rather than nothing', async () => {
    mount(reply({ standing: standing() }))
    const band = await screen.findByRole('region', { name: 'Building' })
    await waitFor(() => expect(within(band).getByText(/Starting — nothing yet/)).toBeTruthy())
  })

  it('asks only about agents that are running', async () => {
    mount(reply({ standing: standing() }))
    await screen.findByRole('region', { name: 'Building' })
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-transcript', expect.anything())
    )
    const asked = invoke.mock.calls
      .filter((c) => c[0] === 'foundry:run-transcript')
      .map((c) => (c[1] as { sessionId: string }).sessionId)
    expect(new Set(asked)).toEqual(new Set(['s-1']))
  })

  it('says how far along the run is', async () => {
    mount(reply({ standing: standing({ done: 2, total: 6 }) }))
    await waitFor(() => expect(screen.getByText('2 of 6')).toBeTruthy())
  })

  // The whole point of the band. A screen that names a blocker and offers no
  // control is a wall, and this one did not even name it.
  it('offers the gate own options when the line is halted', async () => {
    mount(
      reply({
        standing: standing({ kind: 'halted', turn: 'you', headline: 'Halted — your move' }),
        waiting: [GATE],
      })
    )
    await waitFor(() => expect(screen.getByText('Halted — your move')).toBeTruthy())
    expect(screen.getByText(GATE.summary)).toBeTruthy()
    // One line until it is opened.
    expect(screen.queryByText(GATE.why)).toBeNull()
    fireEvent.click(screen.getByText(GATE.summary))
    expect(screen.getByText(GATE.why)).toBeTruthy()
    for (const option of GATE.options) {
      expect(screen.getByRole('button', { name: new RegExp(option.label) })).toBeTruthy()
    }
  })

  it('answers the gate through the same channel the inbox answers it with', async () => {
    mount(
      reply({
        standing: standing({ kind: 'halted', turn: 'you', headline: 'Halted — your move' }),
        waiting: [GATE],
      })
    )
    await waitFor(() => expect(screen.getByText(GATE.summary)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Raise the budget/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', {
        gateId: 'WO-1-budget.exceeded-1',
        option: 'raise',
      })
    )
  })

  // "Raise the budget" resumed with the same budget and stopped again. A gate
  // that knows which budget it stopped at asks for the new limit first.
  describe('raising the budget it stopped at', () => {
    const RECORDED = {
      ...GATE,
      summary: 'Make all text red has gone past its wall clock budget',
      why: 'The order budgets 10 minutes and this run is at 47.',
      breach: { kind: 'wall_clock', limit: 10, actual: 47 },
    }

    function halted() {
      mount(
        reply({
          standing: standing({ kind: 'halted', turn: 'you', headline: 'Halted — your move' }),
          waiting: [RECORDED],
        })
      )
    }

    it('asks for the new limit instead of deciding', async () => {
      halted()
      await waitFor(() => expect(screen.getByText(RECORDED.summary)).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /Raise the budget/ }))
      const field = screen.getByRole('spinbutton', { name: 'Minutes' }) as HTMLInputElement
      expect(Number(field.value)).toBeGreaterThanOrEqual(47)
      expect(screen.getByText('At least 47.')).toBeTruthy()
      expect(invoke).not.toHaveBeenCalledWith('foundry:inbox.decide', expect.anything())
    })

    it('sends the limit the operator chose with the decision', async () => {
      halted()
      await waitFor(() => expect(screen.getByText(RECORDED.summary)).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /Raise the budget/ }))
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Minutes' }), {
        target: { value: '80' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Raise and resume' }))
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', {
          gateId: RECORDED.id,
          option: 'raise',
          limit: 80,
        })
      )
    })

    it('sends no limit', async () => {
      halted()
      await waitFor(() => expect(screen.getByText(RECORDED.summary)).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /Raise the budget/ }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'No limit on minutes' }))
      fireEvent.click(screen.getByRole('button', { name: 'Raise and resume' }))
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', {
          gateId: RECORDED.id,
          option: 'raise',
          limit: null,
        })
      )
    })

    it('goes back to the options on cancel', async () => {
      halted()
      await waitFor(() => expect(screen.getByText(RECORDED.summary)).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /Raise the budget/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('spinbutton', { name: 'Minutes' })).toBeNull()
      expect(screen.getByRole('button', { name: /Stop here/ })).toBeTruthy()
    })
  })

  it('says what happens to each option, and what happens if you do nothing', async () => {
    mount(
      reply({
        standing: standing({ kind: 'halted', turn: 'you', headline: 'Halted — your move' }),
        waiting: [GATE],
      })
    )
    await waitFor(() => expect(screen.getByText(GATE.summary)).toBeTruthy())
    expect(screen.getByText(/If nobody answers: Hold/)).toBeTruthy()
    fireEvent.click(screen.getByText(GATE.summary))
    expect(screen.getByText('Work continues with more room.')).toBeTruthy()
  })

  it('marks the band as yours when the move is yours', async () => {
    mount(reply({ standing: standing({ turn: 'you' }) }))
    await waitFor(() => expect(document.querySelector('.fdry-standing.is-yours')).not.toBeNull())
  })

  it('leaves the band quiet while Foundry is the one working', async () => {
    mount(reply({ standing: standing({ turn: 'foundry' }) }))
    await waitFor(() => expect(screen.getByText('Building')).toBeTruthy())
    expect(document.querySelector('.fdry-standing.is-yours')).toBeNull()
  })

  // The graph half of this screen was fetched once, on mount, and never again
  // — so a state chip was a snapshot of whenever the panel happened to open.
  it('refetches the graph while it is on screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mount(reply({ standing: standing() }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('foundry:run.observe', { id: 'WO-1' }))
    const before = invoke.mock.calls.filter((c) => c[0] === 'foundry:run.observe').length
    await vi.advanceTimersByTimeAsync(2100)
    const after = invoke.mock.calls.filter((c) => c[0] === 'foundry:run.observe').length
    expect(after).toBeGreaterThan(before)
    vi.useRealTimers()
  })

  // The failure the whole band came out of: a tool call nobody answered was
  // handed back to the terminal's own prompt, the agent stopped there, and the
  // screen went on drawing a working build over it for two hours.
  it('offers the terminal an agent was handed back to', async () => {
    mount(
      reply({
        standing: standing({
          kind: 'stranded',
          turn: 'you',
          headline: 'An agent is waiting at its terminal',
          detail:
            "Nobody answered in time, so Foundry handed the question back to the terminal's own prompt.",
        }),
        stranded: ['s-1'],
      })
    )
    await waitFor(() =>
      expect(screen.getByText('An agent is waiting at its terminal')).toBeTruthy()
    )
    fireEvent.click(screen.getByRole('button', { name: /Go to its terminal/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-terminal', { sessionId: 's-1' })
    )
  })

  // A host part way through an upgrade answers without one. The panel has to
  // render the run anyway rather than blank.
  it('renders the run when the host sends no standing', async () => {
    mount(reply())
    await waitFor(() => expect(screen.getByText('Stop the run')).toBeTruthy())
    expect(document.querySelector('.fdry-standing')).toBeNull()
  })

  // Every step passed and the run still never opened its pull request — the
  // one move left is to have Foundry check the work again and try.
  it('offers to try again when a finished run never shipped', async () => {
    mount(
      reply({
        standing: standing({
          kind: 'stopped',
          turn: 'you',
          label: 'not shipped',
          headline: 'Finished, but not shipped',
          detail: 'Opening the pull request for terminator failed: exit code 1',
          done: 3,
          total: 3,
        }),
      })
    )
    await waitFor(() => expect(screen.getByText('Finished, but not shipped')).toBeTruthy())
    expect(
      screen.getByText('Opening the pull request for terminator failed: exit code 1')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('foundry:run.resume', { id: 'WO-1' }))
  })

  it('offers no way to try again while the run is still working', async () => {
    mount(reply({ standing: standing() }))
    await waitFor(() => expect(screen.getByText('Building')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})

// An agent's own words are markdown and shown as markdown; a command it wants
// to run is shown literally, because rendering it would eat its `*`s.
describe('agent text on the Floor', () => {
  it("renders an agent's question as markdown", async () => {
    mount(reply(), {
      pending: [
        {
          ...ASK,
          toolName: 'AskUserQuestion',
          summary: 'Asks: which?',
          detail: 'Hide **done** tickets?\n\n- Hide\n- Grey',
        },
      ],
    })
    await waitFor(() => screen.getByText('done'))
    expect(screen.getByText('done').tagName).toBe('STRONG')
    expect(screen.getByText('Grey').tagName).toBe('LI')
  })

  it('keeps a command literal', async () => {
    mount(reply(), {
      pending: [{ ...ASK, toolName: 'Bash', detail: 'rm **/*.tmp' }],
    })
    await waitFor(() => screen.getByText('rm **/*.tmp'))
    expect(screen.getByText('rm **/*.tmp').tagName).toBe('PRE')
  })

  it('renders an activity line as markdown', async () => {
    mount(reply(), {
      feed: [{ id: 'f-9', at: 1, sessionId: 's-1', author: 'agent', summary: 'edited `a.ts`' }],
    })
    await waitFor(() => screen.getByText('a.ts'))
    expect(screen.getByText('a.ts').tagName).toBe('CODE')
  })
})

const PULL = {
  repo: 'proto',
  url: 'https://github.com/x/proto/pull/233',
  number: 233,
  cwd: '/work/proto-lane-1',
}
const TICKET = { key: 'TAV-15', url: 'https://linear.app/t/issue/TAV-15' }

describe('where the order lives', () => {
  it('links the pull request and the ticket, and opens them outside the application', async () => {
    mount(reply({ pulls: [PULL], source: TICKET }))
    const pull = await screen.findByRole('link', { name: '#233' })
    fireEvent.click(pull)
    expect(openExternal).toHaveBeenCalledWith(PULL.url)
    fireEvent.click(screen.getByRole('link', { name: 'TAV-15' }))
    expect(openExternal).toHaveBeenCalledWith(TICKET.url)
    expect(pull.getAttribute('target')).toBeNull()
  })

  it('shows neither for an order with no pull request and no ticket', async () => {
    mount(reply({ pulls: [], source: null }))
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button', { name: /Review|Open on GitHub/ })).toBeNull()
  })

  it('shows neither when the host sends neither', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('reviewing the pull request', () => {
  const COMMAND = 'terminator.git-integration.command.review-pull-request'

  it('hands the pull request to the git extension’s review, against the lane checkout', async () => {
    mount(reply({ pulls: [PULL] }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await waitFor(() =>
      expect(runCommand).toHaveBeenCalledWith(COMMAND, { repoRoot: PULL.cwd, number: 233 })
    )
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('falls back to opening it on GitHub when the review is not installed', async () => {
    runCommand.mockResolvedValue({ ok: false, reason: 'not-registered' })
    hasCommand.mockResolvedValue(true)
    mount(reply({ pulls: [PULL] }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(PULL.url))
    expect(await screen.findByRole('button', { name: 'Open on GitHub' })).toBeTruthy()
  })

  it('says Open on GitHub from the start when the review is not there', async () => {
    hasCommand.mockResolvedValue(false)
    mount(reply({ pulls: [PULL] }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open on GitHub' }))
    expect(openExternal).toHaveBeenCalledWith(PULL.url)
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('says why when the review refused, rather than looking like it did nothing', async () => {
    runCommand.mockResolvedValue({ ok: false, reason: 'invalid-args: number' })
    mount(reply({ pulls: [PULL] }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    expect(await screen.findByText(/invalid-args: number/)).toBeTruthy()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('names the pull request on each button when there is more than one', async () => {
    mount(reply({ pulls: [PULL, { ...PULL, repo: 'cli', number: 41, url: 'https://x/pull/41' }] }))
    expect(await screen.findByRole('button', { name: 'Review #233' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review #41' })).toBeTruthy()
  })

  it('no longer carries the per-hunk review that nothing could use', async () => {
    mount(reply({ pulls: [PULL] }))
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText(/To review/)).toBeNull()
    expect(invoke.mock.calls.some((c) => String(c[0]).startsWith('foundry:review-'))).toBe(false)
  })
})

describe('a gate on the Floor', () => {
  it('links the pull request and the ticket on its line', async () => {
    const gate = {
      id: 'G-1',
      rule: 'ready-for-review',
      orderId: 'WO-1',
      nodeId: null,
      summary: 'Ready for you to look at',
      why: 'Every step passed.',
      evidence: [],
      options: [{ id: 'approve', label: 'Approve', consequence: 'It ships.' }],
      defaultIfIgnored: 'hold',
      deadline: null,
      blockedUnits: 0,
      riskGrade: 'P2',
      raisedAt: '2026-09-09T18:12:21.514Z',
      decision: null,
    }
    mount(
      reply({
        pulls: [PULL],
        source: TICKET,
        waiting: [gate],
        standing: {
          kind: 'halted',
          turn: 'you',
          label: 'x',
          headline: 'Halted — your move',
          detail: 'd',
          done: 0,
          total: 0,
          gateId: 'G-1',
          waitingOn: null,
        },
      })
    )
    await screen.findByText('Ready for you to look at')
    const line = screen
      .getByText('Ready for you to look at')
      .closest('.fdry-gate-card') as HTMLElement
    fireEvent.click(within(line).getByRole('link', { name: /#233/ }))
    expect(openExternal).toHaveBeenCalledWith(PULL.url)
    fireEvent.click(within(line).getByRole('link', { name: /TAV-15/ }))
    expect(openExternal).toHaveBeenCalledWith(TICKET.url)
  })
})

describe('the step chips', () => {
  function node(over: Record<string, unknown>) {
    return { ...NODES[0], ...over }
  }

  function chipOf(label: string): HTMLElement {
    return screen.getAllByText(label)[0].closest('.fdry-unit') as HTMLElement
  }

  it('reads done for a step that passed, whatever the step was', async () => {
    mount(
      reply({
        graph: {
          orderId: 'WO-1',
          recipe: 'standard',
          nodes: [node({ id: 'N-1', state: 'passed', sessionId: null, role: 'scout' })],
        },
      })
    )
    await waitFor(() => screen.getByText('scout'))
    expect(chipOf('scout').textContent).toContain('done')
    expect(document.body.textContent).not.toContain('verified')
  })

  it('says why a skipped step was skipped, as a tooltip and as a description', async () => {
    const reason = 'runs only when risk triggers fire; this order has none'
    mount(
      reply({
        graph: {
          orderId: 'WO-1',
          recipe: 'standard',
          nodes: [
            node({
              id: 'N-1',
              state: 'skipped',
              sessionId: null,
              role: 'architect',
              skipReason: reason,
            }),
          ],
        },
      })
    )
    await waitFor(() => screen.getByText('architect'))
    const chip = chipOf('architect')
    expect(chip.getAttribute('title')).toBe(`Skipped: ${reason}`)
    const described = chip.getAttribute('aria-describedby')
    expect(described).not.toBeNull()
    expect(document.getElementById(described as string)?.textContent).toBe(`Skipped: ${reason}`)
  })

  it('keeps the id as the tooltip for a step that was not skipped', async () => {
    mount(reply())
    await waitFor(() => screen.getAllByText('builder'))
    expect(chipOf('builder').getAttribute('title')).toBe('N-1')
    expect(chipOf('builder').getAttribute('aria-describedby')).toBeNull()
  })

  it('offers the terminal only while the step is running', async () => {
    mount(
      reply({
        graph: {
          orderId: 'WO-1',
          recipe: 'standard',
          nodes: [node({ id: 'N-1', state: 'passed', sessionId: 's-1', role: 'builder' })],
        },
      })
    )
    await waitFor(() => screen.getAllByText('builder'))
    expect(screen.queryByRole('button', { name: /^Attach to/ })).toBeNull()
    // What it said is still there to read.
    expect(screen.getByRole('button', { name: 'Transcript' })).toBeTruthy()
  })

  it('opens the transcript directly under the row of the step it belongs to', async () => {
    mount(
      reply({
        graph: {
          orderId: 'WO-1',
          recipe: 'standard',
          nodes: [
            node({ id: 'N-1', lane: 1, sessionId: 's-1', role: 'builder' }),
            node({ id: 'N-3', lane: 2, sessionId: 's-3', role: 'verifier' }),
          ],
        },
      })
    )
    await waitFor(() => screen.getByText('verifier'))
    fireEvent.click(within(chipOf('verifier')).getByRole('button', { name: 'Transcript' }))
    const panel = await screen.findByRole('region', { name: 'verifier' })
    expect(panel.closest('.fdry-lane')).toBe(chipOf('verifier').closest('.fdry-lane'))
    expect(chipOf('builder').closest('.fdry-lane')?.contains(panel)).toBe(false)
  })

  it('shows an attach refusal beside the step that caused it, not at the foot', async () => {
    mount(reply(), { attach: { error: 'builder finished at 09:41; its agent has closed.' } })
    await waitFor(() => screen.getAllByText('builder'))
    fireEvent.click(screen.getByRole('button', { name: /^Attach to/ }))
    const message = await screen.findByText('builder finished at 09:41; its agent has closed.')
    expect(message.closest('.fdry-problem')).toBeNull()
    expect(message.closest('.fdry-lane')).toBe(chipOf('builder').closest('.fdry-lane'))
    expect(chipOf('builder').nextElementSibling).toBe(message)
  })

  it('shows a refusal to open the terminal beside its step as well', async () => {
    mount(reply(), { terminal: { ok: false } })
    await waitFor(() => screen.getAllByText('builder'))
    fireEvent.click(screen.getByRole('button', { name: /^Attach to/ }))
    const message = await screen.findByText('That agent is no longer in a terminal.')
    expect(chipOf('builder').nextElementSibling).toBe(message)
  })
})
