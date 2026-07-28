import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  StateIndicator,
  formatElapsed,
  STATE_LABELS,
} from '../../../../src/renderer/components/supervision/StateIndicator.js'
import { AttentionQueue } from '../../../../src/renderer/components/supervision/AttentionQueue.js'
import { StatusBar } from '../../../../src/renderer/components/supervision/StatusBar.js'
import {
  ReviewInbox,
  ReviewFlow,
} from '../../../../src/renderer/components/supervision/ReviewInbox.js'
import { StandupFeed } from '../../../../src/renderer/components/supervision/StandupFeed.js'
import {
  MergeAudit,
  HunkReview,
} from '../../../../src/renderer/components/supervision/MergeAudit.js'
import { LaneView } from '../../../../src/renderer/components/supervision/LaneView.js'
import { WorkItemBoard } from '../../../../src/renderer/components/supervision/WorkItemBoard.js'
import { SinceYouLastLooked } from '../../../../src/renderer/components/supervision/SinceYouLastLooked.js'
import {
  rankEntities,
  SupervisionPalette,
} from '../../../../src/renderer/components/supervision/SupervisionPalette.js'
import { RUNTIME_STATES } from '../../../../src/shared/types/supervision.js'
import type { AttentionItem } from '../../../../src/shared/supervision/rank-attention.js'

describe('StateIndicator (Constitution XII)', () => {
  it.each(RUNTIME_STATES)('renders %s with a label', (state) => {
    render(<StateIndicator state={state} />)
    expect(screen.getByText(STATE_LABELS[state])).toBeDefined()
  })

  it('calls the unknown state unknown, rather than something reassuring', () => {
    expect(STATE_LABELS.unknown).toBe('State unknown')
  })

  it('renders elapsed time when given', () => {
    render(<StateIndicator state="working" sinceMs={125_000} />)
    expect(screen.getByText('2m')).toBeDefined()
  })

  it('formats elapsed time in seconds, minutes and hours', () => {
    expect(formatElapsed(5_000)).toBe('5s')
    expect(formatElapsed(120_000)).toBe('2m')
    expect(formatElapsed(7_200_000)).toBe('2h')
  })
})

function attention(over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    sessionId: 's1',
    repoPath: '/repos/fluent',
    branch: 'feat/x',
    reason: 'needs_input',
    waitingMs: 65_000,
    pendingPermission: {
      requestId: 'r1',
      toolName: 'Bash',
      summary: 'redis-cli -h prod-cache-01',
      targetHost: 'prod-cache-01',
      requestedAt: 1_000,
    },
    failure: null,
    ...over,
  }
}

describe('AttentionQueue (FR-022 – FR-024)', () => {
  const noop = () => {}

  it('states that everything is fine rather than rendering blank (FR-024)', () => {
    render(
      <AttentionQueue
        items={[]}
        loaded
        workingCount={3}
        onApprove={noop}
        onDeny={noop}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={noop}
      />
    )
    expect(screen.getByText(/Nothing needs you/)).toBeDefined()
    expect(screen.getByText(/3 sessions are working/)).toBeDefined()
  })

  it('does not claim all-clear before the first load has completed', () => {
    render(
      <AttentionQueue
        items={[]}
        loaded={false}
        workingCount={0}
        onApprove={noop}
        onDeny={noop}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={noop}
      />
    )
    expect(screen.queryByText(/Nothing needs you/)).toBeNull()
  })

  it('shows what a blocked session is asking for', () => {
    render(
      <AttentionQueue
        items={[attention()]}
        loaded
        workingCount={0}
        onApprove={noop}
        onDeny={noop}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={noop}
      />
    )
    expect(screen.getByText('redis-cli -h prod-cache-01')).toBeDefined()
  })

  it('answers a permission request inline, without opening the session (FR-023)', () => {
    const onApprove = vi.fn()
    const onOpen = vi.fn()
    render(
      <AttentionQueue
        items={[attention()]}
        loaded
        workingCount={0}
        onApprove={onApprove}
        onDeny={noop}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={onOpen}
      />
    )
    fireEvent.click(screen.getByText('Allow'))
    expect(onApprove).toHaveBeenCalledWith('s1', 'r1')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('offers deny as well as allow', () => {
    const onDeny = vi.fn()
    render(
      <AttentionQueue
        items={[attention()]}
        loaded
        workingCount={0}
        onApprove={noop}
        onDeny={onDeny}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={noop}
      />
    )
    fireEvent.click(screen.getByText('Deny'))
    expect(onDeny).toHaveBeenCalledWith('s1', 'r1')
  })

  it('offers no permission buttons for an item that is not blocked on one', () => {
    render(
      <AttentionQueue
        items={[attention({ reason: 'stalled', pendingPermission: null })]}
        loaded
        workingCount={0}
        onApprove={noop}
        onDeny={noop}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={noop}
      />
    )
    expect(screen.queryByText('Allow')).toBeNull()
  })

  it('renders items in the order given, which is the ranked order', () => {
    render(
      <AttentionQueue
        items={[
          attention({ sessionId: 'first' }),
          attention({ sessionId: 'second', reason: 'ready', pendingPermission: null }),
        ]}
        loaded
        workingCount={0}
        onApprove={noop}
        onDeny={noop}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={noop}
      />
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('StatusBar (FR-025)', () => {
  const summary = {
    needsInput: 2,
    working: 6,
    awaitingReview: 4,
    failed: 1,
    oldestBlockedMs: 1_320_000,
  }

  it('shows every count the spec names', () => {
    render(<StatusBar summary={summary} />)
    expect(screen.getByText(/2 need you/)).toBeDefined()
    expect(screen.getByText(/6 working/)).toBeDefined()
    expect(screen.getByText(/4 to review/)).toBeDefined()
    expect(screen.getByText(/1 failed/)).toBeDefined()
  })

  it('shows the age of the oldest blocked session', () => {
    render(<StatusBar summary={summary} />)
    expect(screen.getByText(/oldest blocked 22m/)).toBeDefined()
  })

  it('asserts all clear rather than simply omitting the badges', () => {
    render(
      <StatusBar
        summary={{ needsInput: 0, working: 2, awaitingReview: 0, failed: 0, oldestBlockedMs: null }}
      />
    )
    expect(screen.getByText('all clear')).toBeDefined()
  })
})

const reviewItem = {
  sessionId: 's1',
  repoPath: '/repos/fluent',
  branch: 'feat/session-ulid',
  grade: 'P0' as const,
  gradeTrigger: 'touches authentication: src/auth/login.ts',
  queuedAt: 1_000,
  diffSummary: { files: 5, added: 142, removed: 96 },
  step: 'intent' as const,
}

describe('ReviewInbox (FR-046, FR-050)', () => {
  it('shows the grade and the specific trigger, not just the letter', () => {
    render(<ReviewInbox items={[reviewItem]} now={61_000} onOpen={() => {}} />)
    expect(screen.getByText('P0')).toBeDefined()
    expect(screen.getByText(/touches authentication/)).toBeDefined()
  })

  it('renders items in the order given, which is worst-first', () => {
    render(
      <ReviewInbox
        items={[
          reviewItem,
          { ...reviewItem, sessionId: 's2', grade: 'P3', gradeTrigger: 'lockfile' },
        ]}
        now={61_000}
        onOpen={() => {}}
      />
    )
    const grades = screen.getAllByText(/^P[0-3]$/).map((el) => el.textContent)
    expect(grades).toEqual(['P0', 'P3'])
  })

  it('says so when nothing is waiting', () => {
    render(<ReviewInbox items={[]} now={0} onOpen={() => {}} />)
    expect(screen.getByText(/Nothing is waiting for review/)).toBeDefined()
  })
})

describe('ReviewFlow (FR-051)', () => {
  const intent = {
    request: 'Add ULID session ids',
    agentAccount: 'Added ULID generation',
    unexpectedFiles: ['src/config/timeouts.ts'],
    untouchedFiles: [],
    hasScopeConcern: true,
  }

  it('starts at intent, before risk, structure or tests', () => {
    render(<ReviewFlow step="intent" intent={intent} onAdvance={() => {}} />)
    expect(screen.getByText('Intent').getAttribute('aria-current')).toBe('step')
  })

  it('shows the request beside the agent account', () => {
    render(<ReviewFlow step="intent" intent={intent} onAdvance={() => {}} />)
    expect(screen.getByText('Add ULID session ids')).toBeDefined()
    expect(screen.getByText('Added ULID generation')).toBeDefined()
  })

  it('calls out work the request never asked for', () => {
    render(<ReviewFlow step="intent" intent={intent} onAdvance={() => {}} />)
    expect(screen.getByText(/Touched without being asked/)).toBeDefined()
  })

  it('confirms when the scope matches, rather than staying silent', () => {
    render(
      <ReviewFlow
        step="intent"
        intent={{ ...intent, unexpectedFiles: [], hasScopeConcern: false }}
        onAdvance={() => {}}
      />
    )
    expect(screen.getByText(/Scope matches the request/)).toBeDefined()
  })

  it('advances to the next step', () => {
    const onAdvance = vi.fn()
    render(<ReviewFlow step="intent" intent={intent} onAdvance={onAdvance} />)
    fireEvent.click(screen.getByText('Next'))
    expect(onAdvance).toHaveBeenCalled()
  })
})

describe('StandupFeed (FR-091 – FR-093)', () => {
  const entries = [
    {
      id: 'e1',
      at: 1_000,
      sessionId: 's1',
      author: 'agent' as const,
      summary: 'Ran the tests',
      replyable: true,
    },
    {
      id: 'e2',
      at: 2_000,
      sessionId: 's1',
      author: 'console' as const,
      summary: 'Terminator: this session has recorded no tool activity',
      replyable: false,
    },
  ]

  it('attributes a console entry to Terminator, not the agent (FR-092)', () => {
    render(
      <StandupFeed
        entries={entries}
        mutedSessions={[]}
        onReply={() => {}}
        onToggleMute={() => {}}
      />
    )
    expect(screen.getByText('Terminator')).toBeDefined()
    expect(screen.getByText('agent')).toBeDefined()
  })

  it('offers reply only on an agent entry — replying to the console goes nowhere', () => {
    render(
      <StandupFeed
        entries={entries}
        mutedSessions={[]}
        onReply={() => {}}
        onToggleMute={() => {}}
      />
    )
    expect(screen.getAllByText('Reply')).toHaveLength(1)
  })

  it('delivers a reply to the originating session (FR-093)', () => {
    const onReply = vi.fn()
    render(
      <StandupFeed entries={entries} mutedSessions={[]} onReply={onReply} onToggleMute={() => {}} />
    )
    fireEvent.click(screen.getByText('Reply'))
    fireEvent.change(screen.getByLabelText('Reply to s1'), {
      target: { value: 'try the other approach' },
    })
    fireEvent.click(screen.getByText('Send'))
    expect(onReply).toHaveBeenCalledWith('s1', 'try the other approach')
  })

  it('shows a muted session as muted while still listing its entries (FR-029)', () => {
    render(
      <StandupFeed
        entries={entries}
        mutedSessions={['s1']}
        onReply={() => {}}
        onToggleMute={() => {}}
      />
    )
    expect(screen.getAllByText(/muted/).length).toBeGreaterThan(0)
    expect(screen.getByText('Ran the tests')).toBeDefined()
  })

  it('says so when nothing has happened', () => {
    render(
      <StandupFeed entries={[]} mutedSessions={[]} onReply={() => {}} onToggleMute={() => {}} />
    )
    expect(screen.getByText(/Nothing has happened yet/)).toBeDefined()
  })
})

describe('MergeAudit and HunkReview (FR-052, FR-061)', () => {
  const merge = {
    sessionId: 's1',
    repoPath: '/repos/fluent',
    branch: 'feat/x',
    mergedAt: 1_700_000_000_000,
    gradeTrigger: 'lockfile only',
    checkState: 'passing' as const,
    diffSummary: { files: 1, added: 4, removed: 2 },
  }

  it('lists what merged without the operator, with enough to review it', () => {
    render(<MergeAudit merges={[merge]} />)
    expect(screen.getByText('lockfile only')).toBeDefined()
    expect(screen.getByText(/checks passing/)).toBeDefined()
  })

  it('says so when nothing merged unattended', () => {
    render(<MergeAudit merges={[]} />)
    expect(screen.getByText(/Nothing has merged unattended/)).toBeDefined()
  })

  const hunks = [
    { id: 'h1', file: 'src/a.ts', newStart: 10, lines: ['+ asked for'] },
    { id: 'h2', file: 'src/a.ts', newStart: 40, lines: ['+ not asked for'] },
  ]

  it('offers a decision per hunk, so one file can be split', () => {
    const onDecide = vi.fn()
    render(<HunkReview hunks={hunks} decisionFor={() => null} onDecide={onDecide} />)
    expect(screen.getAllByText('Keep')).toHaveLength(2)
    fireEvent.click(screen.getAllByText('Drop')[1])
    expect(onDecide).toHaveBeenCalledWith('h2', 'reject')
  })

  it('reflects a decision already made', () => {
    render(
      <HunkReview
        hunks={hunks}
        decisionFor={(id) => (id === 'h1' ? 'accept' : null)}
        onDecide={() => {}}
      />
    )
    expect(screen.getAllByText('Keep')[0].closest('button')?.getAttribute('aria-pressed')).toBe(
      'true'
    )
  })
})

describe('LaneView (FR-087 – FR-089)', () => {
  const lane = (ord: number, repo: string, collisions: string[] = []) => ({
    lane: {
      ord,
      repo,
      role: 'producer' as const,
      branch: 'feat/x',
      task_ids: [],
      blocks: [],
      blocked_by: [],
    },
    collisions,
    blockedBy: [],
  })

  it('renders a single-lane item without multi-repository ceremony (FR-089)', () => {
    render(
      <LaneView
        lanes={[lane(1, 'fluent')]}
        mergedOrds={[]}
        staleOrds={[]}
        blockedReasons={{}}
        onMerge={() => {}}
      />
    )
    expect(screen.queryByText(/repositories/)).toBeNull()
  })

  it('flags a predicted collision on the lane that touches it', () => {
    render(
      <LaneView
        lanes={[
          lane(1, 'fluent', ['proto/session.proto']),
          lane(2, 'forge', ['proto/session.proto']),
        ]}
        mergedOrds={[]}
        staleOrds={[]}
        blockedReasons={{}}
        onMerge={() => {}}
      />
    )
    expect(screen.getAllByText(/Predicted collision/)).toHaveLength(2)
  })

  it('disables merge and states why when a lane is blocked', () => {
    render(
      <LaneView
        lanes={[lane(2, 'forge')]}
        mergedOrds={[]}
        staleOrds={[]}
        blockedReasons={{ 2: 'lane 1 (fluent) must merge first' }}
        onMerge={() => {}}
      />
    )
    expect(screen.getByText(/lane 1 \(fluent\) must merge first/)).toBeDefined()
    expect(screen.getByText('Merge').closest('button')?.hasAttribute('disabled')).toBe(true)
  })

  it('flags a downstream lane that needs re-running', () => {
    render(
      <LaneView
        lanes={[lane(2, 'forge')]}
        mergedOrds={[]}
        staleOrds={[2]}
        blockedReasons={{}}
        onMerge={() => {}}
      />
    )
    expect(screen.getByText(/rebase or re-run/)).toBeDefined()
  })
})

// Every action the board offers is a producer command; none of them is
// optional, because the gate they satisfy is what makes implementation legal.
const boardActions = {
  queued: [],
  onRemoveQueued: () => {},
  onApproveGate: () => {},
  onRejectGate: () => {},
  onSendBack: () => {},
  onAdvancePhase: () => {},
  actionError: null,
  onDismissActionError: () => {},
}

describe('WorkItemBoard (FR-074, FR-080 – FR-082)', () => {
  const item = {
    producerId: 'speckit-pilot',
    item: {
      contract_version: 1,
      id: 'FLU-220',
      source: 'linear' as const,
      title: 'Unify session identity',
      created_at: '2026-07-27T09:04:11Z',
      phase: 'implement' as const,
      artifacts: { spec: 'specs/x/spec.md' },
      gates: { spec_approved_by_human: { ok: true } },
      lanes: [
        {
          ord: 1,
          repo: 'fluent',
          role: 'producer' as const,
          branch: 'b',
          task_ids: [],
          blocks: [],
          blocked_by: [],
        },
      ],
    },
  }

  it('renders an item with its artefact and gate chips (FR-082)', () => {
    render(
      <WorkItemBoard
        {...boardActions}
        items={[item]}
        unreadable={[]}
        conflicts={[]}
        canAct
        onOpen={() => {}}
      />
    )
    expect(screen.getByText('Unify session identity')).toBeDefined()
    expect(screen.getByText('spec approved')).toBeDefined()
  })

  it('reports a duplicate id from two producers rather than picking one (FR-074)', () => {
    render(
      <WorkItemBoard
        {...boardActions}
        items={[item]}
        unreadable={[]}
        conflicts={[{ workItemId: 'FLU-220', producers: ['a', 'b'] }]}
        canAct
        onOpen={() => {}}
      />
    )
    expect(screen.getByText(/published by a and b/)).toBeDefined()
  })

  it('reports an unreadable item with its reason (FR-085)', () => {
    render(
      <WorkItemBoard
        {...boardActions}
        items={[]}
        unreadable={[{ filePath: '/x.json', reason: 'no contract version' }]}
        conflicts={[]}
        canAct
        onOpen={() => {}}
      />
    )
    expect(screen.getByText(/no contract version/)).toBeDefined()
  })

  it('states the board is read-only when no producer provides actions (FR-078)', () => {
    render(
      <WorkItemBoard
        {...boardActions}
        items={[item]}
        unreadable={[]}
        conflicts={[]}
        canAct={false}
        onOpen={() => {}}
      />
    )
    expect(screen.getByText(/read-only: no producer provides actions/)).toBeDefined()
  })

  it('says ad-hoc work still runs when nothing is published (FR-081)', () => {
    render(
      <WorkItemBoard
        {...boardActions}
        items={[]}
        unreadable={[]}
        conflicts={[]}
        canAct
        onOpen={() => {}}
      />
    )
    expect(screen.getByText(/Sessions still run as ad-hoc work/)).toBeDefined()
  })
})

describe('SinceYouLastLooked (FR-027)', () => {
  const entry = {
    id: 'e1',
    at: 5_000,
    sessionId: 's1',
    author: 'agent' as const,
    summary: 'Edited the schema',
    replyable: true,
  }

  it('renders nothing when the session has never been viewed', () => {
    const { container } = render(
      <SinceYouLastLooked
        lastViewedAt={null}
        now={9_000}
        entries={[]}
        stateChanges={[]}
        diffDelta={null}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('says nothing changed rather than showing an empty panel', () => {
    render(
      <SinceYouLastLooked
        lastViewedAt={1_000}
        now={61_000}
        entries={[]}
        stateChanges={[]}
        diffDelta={null}
      />
    )
    expect(screen.getByText(/Nothing has changed/)).toBeDefined()
  })

  it('summarises what happened since', () => {
    render(
      <SinceYouLastLooked
        lastViewedAt={1_000}
        now={61_000}
        entries={[entry]}
        stateChanges={[{ to: 'needs_input', at: 6_000 }]}
        diffDelta={{ files: 2, added: 9, removed: 1 }}
      />
    )
    expect(screen.getByText('Edited the schema')).toBeDefined()
    expect(screen.getByText('needs_input')).toBeDefined()
    expect(screen.getByText(/2 files/)).toBeDefined()
  })

  it('excludes entries from before the last view', () => {
    render(
      <SinceYouLastLooked
        lastViewedAt={9_000}
        now={61_000}
        entries={[entry]}
        stateChanges={[]}
        diffDelta={null}
      />
    )
    expect(screen.queryByText('Edited the schema')).toBeNull()
  })
})

describe('SupervisionPalette (FR-026)', () => {
  const entities = [
    { id: 's1', kind: 'session' as const, label: 'feat/session-ulid', detail: 'fluent' },
    { id: 'w1', kind: 'workItem' as const, label: 'FLU-220', detail: 'Unify session identity' },
    { id: 'r1', kind: 'repository' as const, label: 'fluent' },
    { id: 't1', kind: 'worktree' as const, label: 'FLU-220-fluent' },
    { id: 'c1', kind: 'command' as const, label: 'Toggle shadow mode' },
  ]

  it('returns all five entity kinds in one ranked list', () => {
    const kinds = new Set(rankEntities(entities, '').map((e) => e.kind))
    expect(kinds.size).toBe(5)
  })

  it('ranks a prefix match above a substring match', () => {
    const results = rankEntities(entities, 'flu')
    expect(results[0].label).toBe('FLU-220')
  })

  it('matches on the detail as well as the label', () => {
    expect(rankEntities(entities, 'Unify').map((e) => e.id)).toEqual(['w1'])
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(rankEntities(entities, 'zzzz')).toEqual([])
  })

  it('renders results across kinds and reports them chosen', () => {
    const onChoose = vi.fn()
    render(
      <SupervisionPalette
        entities={entities}
        query="flu"
        onQueryChange={() => {}}
        onChoose={onChoose}
      />
    )
    fireEvent.click(screen.getByText('FLU-220'))
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1' }))
  })

  it('says nothing matched rather than rendering an empty list', () => {
    render(
      <SupervisionPalette
        entities={entities}
        query="zzzz"
        onQueryChange={() => {}}
        onChoose={() => {}}
      />
    )
    expect(screen.getByText(/Nothing matches/)).toBeDefined()
  })
})

describe('LaneView merge affordance', () => {
  const laneWith = (over: Record<string, unknown> = {}) => ({
    lane: {
      ord: 1,
      repo: 'fluent',
      role: 'producer' as const,
      branch: 'feat/x',
      task_ids: ['T001', 'T002'],
      blocks: [],
      blocked_by: [],
      ...over,
    },
    collisions: [],
    blockedBy: [],
  })

  it('shows the lane task ids, so you can see what it was asked to do', () => {
    render(
      <LaneView
        lanes={[laneWith()]}
        mergedOrds={[]}
        staleOrds={[]}
        blockedReasons={{}}
        onMerge={() => {}}
      />
    )
    expect(screen.getByText(/T001, T002/)).toBeDefined()
  })

  it('merges the lane it was clicked on', () => {
    const onMerge = vi.fn()
    render(
      <LaneView
        lanes={[laneWith({ ord: 3 })]}
        mergedOrds={[]}
        staleOrds={[]}
        blockedReasons={{}}
        onMerge={onMerge}
      />
    )
    fireEvent.click(screen.getByText('Merge'))
    expect(onMerge).toHaveBeenCalledWith(3)
  })

  it('offers no merge button for a lane that already merged (FR-088)', () => {
    render(
      <LaneView
        lanes={[laneWith()]}
        mergedOrds={[1]}
        staleOrds={[]}
        blockedReasons={{}}
        onMerge={() => {}}
      />
    )
    expect(screen.queryByText('Merge')).toBeNull()
    expect(screen.getByText(/merged/)).toBeDefined()
  })
})

describe('HunkReview decisions', () => {
  const hunk = { id: 'h1', file: 'src/auth/token.ts', newStart: 12, lines: ['+const x = 1'] }

  it('says so when a change has no hunks, rather than rendering an empty box', () => {
    render(<HunkReview hunks={[]} decisionFor={() => null} onDecide={() => {}} />)
    expect(screen.getByText(/no hunks to review/)).toBeDefined()
  })

  it('drops a hunk, which is the decision a file-level review cannot express', () => {
    const onDecide = vi.fn()
    render(<HunkReview hunks={[hunk]} decisionFor={() => null} onDecide={onDecide} />)
    fireEvent.click(screen.getByText('Drop'))
    expect(onDecide).toHaveBeenCalledWith('h1', 'reject')
  })

  it('shows which way a hunk was already decided', () => {
    render(<HunkReview hunks={[hunk]} decisionFor={() => 'reject'} onDecide={() => {}} />)
    expect(screen.getByText('Drop').closest('button')?.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Keep').closest('button')?.getAttribute('aria-pressed')).toBe('false')
  })
})

describe('StandupFeed replies', () => {
  const agentEntry = {
    id: 'e1',
    at: 1_000,
    sessionId: 's1',
    author: 'agent' as const,
    summary: 'ran the tests',
    replyable: true,
  }

  it('opens a reply box only for the entry whose Reply was clicked', () => {
    render(
      <StandupFeed
        entries={[agentEntry]}
        mutedSessions={[]}
        onReply={() => {}}
        onToggleMute={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Reply'))
    expect(screen.getByLabelText('Reply to s1')).toBeDefined()
  })

  it('sends the reply on Enter, so answering never needs the mouse', () => {
    const onReply = vi.fn()
    render(
      <StandupFeed
        entries={[agentEntry]}
        mutedSessions={[]}
        onReply={onReply}
        onToggleMute={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Reply'))
    const input = screen.getByLabelText('Reply to s1')
    fireEvent.change(input, { target: { value: 'what is blocking you?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onReply).toHaveBeenCalledWith('s1', 'what is blocking you?')
  })

  it('ignores other keys', () => {
    const onReply = vi.fn()
    render(
      <StandupFeed
        entries={[agentEntry]}
        mutedSessions={[]}
        onReply={onReply}
        onToggleMute={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Reply'))
    const input = screen.getByLabelText('Reply to s1')
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.keyDown(input, { key: 'a' })
    expect(onReply).not.toHaveBeenCalled()
  })

  it('refuses to send an empty reply', () => {
    const onReply = vi.fn()
    render(
      <StandupFeed
        entries={[agentEntry]}
        mutedSessions={[]}
        onReply={onReply}
        onToggleMute={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Reply'))
    fireEvent.change(screen.getByLabelText('Reply to s1'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Send'))
    expect(onReply).not.toHaveBeenCalled()
  })

  it('closes the reply box once the reply is sent', () => {
    render(
      <StandupFeed
        entries={[agentEntry]}
        mutedSessions={[]}
        onReply={() => {}}
        onToggleMute={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Reply'))
    fireEvent.change(screen.getByLabelText('Reply to s1'), { target: { value: 'ok' } })
    fireEvent.click(screen.getByText('Send'))
    expect(screen.queryByLabelText('Reply to s1')).toBeNull()
  })
})

// The gate controls. Implementation cannot begin until a human approves the
// spec and the plan (FR-083); before these existed there was no way to satisfy
// that gate from the console at all, so nothing bound to a work item could run.
describe('WorkItemBoard gate actions (FR-083, FR-084)', () => {
  const unapproved = {
    producerId: 'speckit-pilot',
    item: {
      contract_version: 1,
      id: 'FLU-220',
      source: 'linear' as const,
      title: 'Unify session identity',
      created_at: '2026-07-27T09:04:11Z',
      phase: 'specify' as const,
      artifacts: { spec: 'specs/x/spec.md', plan: 'specs/x/plan.md' },
      gates: {},
      lanes: [
        {
          ord: 1,
          repo: 'fluent',
          role: 'producer' as const,
          branch: 'b',
          task_ids: [],
          blocks: [],
          blocked_by: [],
        },
      ],
    },
  }

  const board = (over: Record<string, unknown> = {}) =>
    render(
      <WorkItemBoard
        {...boardActions}
        items={[unapproved]}
        unreadable={[]}
        conflicts={[]}
        canAct
        onOpen={() => {}}
        {...over}
      />
    )

  it('approves the spec gate', () => {
    const onApproveGate = vi.fn()
    board({ onApproveGate })
    fireEvent.click(screen.getByText(/Approve spec/))
    expect(onApproveGate).toHaveBeenCalledWith('FLU-220', 'spec_approved_by_human')
  })

  it('approves the plan gate', () => {
    const onApproveGate = vi.fn()
    board({ onApproveGate })
    fireEvent.click(screen.getByText(/Approve plan/))
    expect(onApproveGate).toHaveBeenCalledWith('FLU-220', 'plan_approved_by_human')
  })

  it('offers no approval for a gate already approved', () => {
    const approved = {
      ...unapproved,
      item: { ...unapproved.item, gates: { spec_approved_by_human: { ok: true } } },
    }
    board({ items: [approved] })
    expect(screen.queryByText(/Approve spec/)).toBeNull()
    expect(screen.getByText(/Approve plan/)).toBeDefined()
  })

  it('requires notes before it will send work back (FR-084)', () => {
    const onRejectGate = vi.fn()
    const onSendBack = vi.fn()
    board({ onRejectGate, onSendBack })
    fireEvent.click(screen.getByText(/Reject spec/))
    fireEvent.click(screen.getByText('Send back'))
    // Sending work back without saying why is what produced the unbounded-scope
    // failures this gate exists to prevent.
    expect(onRejectGate).not.toHaveBeenCalled()
    expect(onSendBack).not.toHaveBeenCalled()
  })

  it('rejects with notes and returns the item to the phase that produced it', () => {
    const onRejectGate = vi.fn()
    const onSendBack = vi.fn()
    board({ onRejectGate, onSendBack })
    fireEvent.click(screen.getByText(/Reject spec/))
    fireEvent.change(screen.getByLabelText(/Why are you rejecting the spec/), {
      target: { value: 'scope is unbounded' },
    })
    fireEvent.click(screen.getByText('Send back'))
    expect(onRejectGate).toHaveBeenCalledWith(
      'FLU-220',
      'spec_approved_by_human',
      'scope is unbounded'
    )
    expect(onSendBack).toHaveBeenCalledWith('FLU-220', 'specify', 'scope is unbounded')
  })

  it('sends the rejection on Enter', () => {
    const onRejectGate = vi.fn()
    board({ onRejectGate })
    fireEvent.click(screen.getByText(/Reject plan/))
    const input = screen.getByLabelText(/Why are you rejecting the plan/)
    fireEvent.change(input, { target: { value: 'no rollback story' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRejectGate).toHaveBeenCalledWith(
      'FLU-220',
      'plan_approved_by_human',
      'no rollback story'
    )
  })

  it('ignores other keys in the notes box', () => {
    const onRejectGate = vi.fn()
    board({ onRejectGate })
    fireEvent.click(screen.getByText(/Reject plan/))
    const input = screen.getByLabelText(/Why are you rejecting the plan/)
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRejectGate).not.toHaveBeenCalled()
  })

  it('offers no approval for a gate whose artefact does not exist yet', () => {
    // "Approve plan" on an item with no plan is a button that cannot mean
    // anything.
    const specOnly = {
      ...unapproved,
      item: { ...unapproved.item, artifacts: { spec: 'specs/x/spec.md' } },
    }
    board({ items: [specOnly] })
    expect(screen.getByText(/Approve spec/)).toBeDefined()
    expect(screen.queryByText(/Approve plan/)).toBeNull()
  })

  it('advances the phase', () => {
    const onAdvancePhase = vi.fn()
    board({ onAdvancePhase })
    fireEvent.click(screen.getByText(/Advance phase/))
    expect(onAdvancePhase).toHaveBeenCalledWith('FLU-220')
  })

  it('offers no actions at all when no producer provides them (FR-078)', () => {
    board({ canAct: false })
    expect(screen.queryByText(/Approve spec/)).toBeNull()
    expect(screen.queryByText(/Advance phase/)).toBeNull()
  })

  it('reports a producer that refused, with a way to dismiss it', () => {
    const onDismissActionError = vi.fn()
    board({ actionError: 'speckit-pilot does not provide sending work back', onDismissActionError })
    expect(screen.getByText(/does not provide sending work back/)).toBeDefined()
    fireEvent.click(screen.getByText('Dismiss'))
    expect(onDismissActionError).toHaveBeenCalled()
  })

  it('still opens the item when the card is clicked', () => {
    const onOpen = vi.fn()
    board({ onOpen })
    fireEvent.click(screen.getByText('Unify session identity'))
    expect(onOpen).toHaveBeenCalledWith('FLU-220')
  })
})

describe('a failed session says why on the queue itself (FR-034)', () => {
  const failed = {
    sessionId: 's1',
    repoPath: '/repos/fluent',
    branch: 'feat/x',
    reason: 'failed' as const,
    waitingMs: 60_000,
    pendingPermission: null,
    failure: { step: 'setup' as const, exitCode: 3, output: 'lockfile is out of date' },
  }

  it('shows the step, the exit code and the output without opening anything', () => {
    render(
      <AttentionQueue
        items={[failed]}
        loaded
        workingCount={0}
        onApprove={() => {}}
        onDeny={() => {}}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={() => {}}
      />
    )
    expect(screen.getByText(/setup exited 3 — lockfile is out of date/)).toBeDefined()
  })

  it('shows nothing extra for a session that did not fail', () => {
    render(
      <AttentionQueue
        items={[{ ...failed, reason: 'needs_input' as const, failure: null }]}
        loaded
        workingCount={0}
        onApprove={() => {}}
        onDeny={() => {}}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={() => {}}
      />
    )
    expect(screen.queryByText(/exited/)).toBeNull()
  })

  it('omits an exit code it does not have', () => {
    render(
      <AttentionQueue
        items={[{ ...failed, failure: { step: 'agent', exitCode: null, output: 'model refused' } }]}
        loaded
        workingCount={0}
        onApprove={() => {}}
        onDeny={() => {}}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={() => {}}
      />
    )
    expect(screen.getByText(/agent — model refused/)).toBeDefined()
  })

  it('says only the step when there was no output at all', () => {
    render(
      <AttentionQueue
        items={[{ ...failed, failure: { step: 'setup', exitCode: 1, output: '   ' } }]}
        loaded
        workingCount={0}
        onApprove={() => {}}
        onDeny={() => {}}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={() => {}}
      />
    )
    expect(screen.getByText(/setup exited 1/)).toBeDefined()
  })
})

describe('the ask is readable on the queue (FR-007)', () => {
  const blocked = {
    sessionId: 's1',
    repoPath: '/repos/fluent',
    branch: 'feat/x',
    reason: 'needs_input' as const,
    waitingMs: 29_000,
    failure: null,
    pendingPermission: {
      requestId: 'r1',
      toolName: 'AskUserQuestion',
      summary: 'Which database should the worker write to?',
      detail: 'Which database should the worker write to?\n  Postgres\n  SQLite',
      questions: undefined,
      requestedAt: 1_000,
    },
  }

  const queue = (over: Record<string, unknown> = {}) =>
    render(
      <AttentionQueue
        items={[{ ...blocked, ...over }]}
        loaded
        workingCount={0}
        onApprove={() => {}}
        onDeny={() => {}}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={() => {}}
      />
    )

  it('shows the question, not the tool name', () => {
    queue()
    expect(
      screen.getAllByText(/Which database should the worker write to\?/).length
    ).toBeGreaterThan(0)
  })

  it('shows the options, so the decision can actually be made', () => {
    queue()
    expect(screen.getByText(/Postgres/)).toBeDefined()
    expect(screen.getByText(/SQLite/)).toBeDefined()
  })

  it('shows nothing extra when there is no detail', () => {
    queue({ pendingPermission: { ...blocked.pendingPermission, detail: null } })
    expect(screen.queryByText(/Postgres/)).toBeNull()
  })

  it('shows nothing extra for a detail that is only whitespace', () => {
    queue({ pendingPermission: { ...blocked.pendingPermission, detail: '   ' } })
    expect(document.querySelector('.sv-queue__detail')).toBeNull()
  })

  it('offers the options as answers, because a question is not a yes or no', () => {
    queue({
      pendingPermission: {
        ...blocked.pendingPermission,
        questions: [
          { question: 'Which scope?', options: ['App-wide UI text', 'Terminal output only'] },
        ],
      },
    })
    expect(screen.getByRole('button', { name: 'App-wide UI text' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Terminal output only' })).toBeDefined()
    expect(screen.queryByText('Allow')).toBeNull()
  })
})

describe('answering a question rather than approving it (FR-007)', () => {
  const asked = {
    sessionId: 's1',
    repoPath: '/repos/terminator',
    branch: 'feat/x',
    reason: 'needs_input' as const,
    waitingMs: 35_000,
    failure: null,
    pendingPermission: {
      requestId: 'r1',
      toolName: 'AskUserQuestion',
      summary: 'What scope do you actually want turned red?',
      detail: 'What scope do you actually want turned red?',
      questions: [
        {
          question: 'What scope do you actually want turned red?',
          options: ['App-wide UI text', 'Terminal output only', 'One specific view'],
        },
      ],
      requestedAt: 1_000,
    },
  }

  const queue = (over: Record<string, unknown> = {}, handlers: Record<string, unknown> = {}) =>
    render(
      <AttentionQueue
        items={[{ ...asked, ...over }]}
        loaded
        workingCount={0}
        onApprove={() => {}}
        onDeny={() => {}}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={() => {}}
        {...handlers}
      />
    )

  it('answers with the option that was clicked', () => {
    const onAnswer = vi.fn()
    queue({}, { onAnswer })
    fireEvent.click(screen.getByRole('button', { name: 'Terminal output only' }))
    expect(onAnswer).toHaveBeenCalledWith('s1', 'r1', 'Terminal output only')
  })

  it('answers in your own words, because the useful answer is often not offered', () => {
    const onAnswer = vi.fn()
    queue({}, { onAnswer })
    fireEvent.change(screen.getByLabelText('Answer'), {
      target: { value: 'just the diff viewer, and keep it behind a flag' },
    })
    fireEvent.click(screen.getByText('Send'))
    expect(onAnswer).toHaveBeenCalledWith(
      's1',
      'r1',
      'just the diff viewer, and keep it behind a flag'
    )
  })

  it('answers on Enter', () => {
    const onAnswer = vi.fn()
    queue({}, { onAnswer })
    const box = screen.getByLabelText('Answer')
    fireEvent.change(box, { target: { value: 'terminal only' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onAnswer).toHaveBeenCalledWith('s1', 'r1', 'terminal only')
  })

  it('will not send an empty answer', () => {
    const onAnswer = vi.fn()
    queue({}, { onAnswer })
    fireEvent.change(screen.getByLabelText('Answer'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Send'))
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('treats a question tool with no options as a question all the same', () => {
    queue({ pendingPermission: { ...asked.pendingPermission, questions: undefined } })
    expect(screen.getByLabelText('Answer')).toBeDefined()
    expect(screen.queryByText('Allow')).toBeNull()
  })

  it('keeps allow and deny for a request that really is a yes or no', () => {
    queue({
      pendingPermission: {
        requestId: 'r2',
        toolName: 'Bash',
        summary: 'rm -rf build',
        requestedAt: 1_000,
      },
    })
    expect(screen.getByText('Allow')).toBeDefined()
    expect(screen.getByText('Deny')).toBeDefined()
  })

  it('lets you refuse a yes/no with a reason, which is worth more than a bare no', () => {
    const onAnswer = vi.fn()
    queue(
      {
        pendingPermission: {
          requestId: 'r2',
          toolName: 'Bash',
          summary: 'rm -rf build',
          requestedAt: 1_000,
        },
      },
      { onAnswer }
    )
    fireEvent.change(screen.getByLabelText('Answer'), {
      target: { value: 'not that directory — use dist/' },
    })
    fireEvent.click(screen.getByText('Send'))
    expect(onAnswer).toHaveBeenCalledWith('s1', 'r2', 'not that directory — use dist/')
  })
})

describe('two questions in one ask', () => {
  const both = {
    sessionId: 's1',
    repoPath: '/repos/terminator',
    branch: 'feat/x',
    reason: 'needs_input' as const,
    waitingMs: 6_000,
    failure: null,
    pendingPermission: {
      requestId: 'r1',
      toolName: 'AskUserQuestion',
      summary: 'What scope do you actually want turned red?',
      detail: 'the full text of both questions',
      questions: [
        { question: 'What scope?', options: ['UI chrome only', 'Terminal output only'] },
        { question: 'Permanent or throwaway?', options: ['Throwaway', 'Real change'] },
      ],
      requestedAt: 1_000,
    },
  }

  const queue = (handlers: Record<string, unknown> = {}) =>
    render(
      <AttentionQueue
        items={[both]}
        loaded
        workingCount={0}
        onApprove={() => {}}
        onDeny={() => {}}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={() => {}}
        {...handlers}
      />
    )

  it('labels each question, so its options are not one anonymous pile', () => {
    queue()
    expect(screen.getByText('What scope?')).toBeDefined()
    expect(screen.getByText('Permanent or throwaway?')).toBeDefined()
  })

  it('says which question an answer answers', () => {
    const onAnswer = vi.fn()
    queue({ onAnswer })
    fireEvent.click(screen.getByRole('button', { name: 'Throwaway' }))
    // The agent gets only the text: a bare "Throwaway" would be ambiguous.
    expect(onAnswer).toHaveBeenCalledWith('s1', 'r1', 'Permanent or throwaway? — Throwaway')
  })

  it('sends a bare label when there is only one question to answer', () => {
    const onAnswer = vi.fn()
    render(
      <AttentionQueue
        items={[
          {
            ...both,
            pendingPermission: {
              ...both.pendingPermission,
              questions: [{ question: 'What scope?', options: ['UI chrome only'] }],
            },
          },
        ]}
        loaded
        workingCount={0}
        onApprove={() => {}}
        onDeny={() => {}}
        onAnswer={onAnswer}
        onDiscard={() => {}}
        onOpen={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'UI chrome only' }))
    expect(onAnswer).toHaveBeenCalledWith('s1', 'r1', 'UI chrome only')
  })

  it('does not repeat the ask as text when every part of it is a button', () => {
    queue()
    expect(screen.queryByText('the full text of both questions')).toBeNull()
  })

  it('keeps the text when a question offers no buttons to answer with', () => {
    render(
      <AttentionQueue
        items={[
          {
            ...both,
            pendingPermission: {
              ...both.pendingPermission,
              questions: [{ question: 'Why did you choose that?', options: [] }],
            },
          },
        ]}
        loaded
        workingCount={0}
        onApprove={() => {}}
        onDeny={() => {}}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={() => {}}
      />
    )
    expect(screen.getByText('the full text of both questions')).toBeDefined()
  })
})

describe('a session that is over, or lost (FR-029)', () => {
  const lost = {
    sessionId: 's1',
    repoPath: '/Users/you/repos/terminator',
    branch: 'feat/session-ulid',
    reason: 'unknown' as const,
    waitingMs: 60_000,
    pendingPermission: null,
    failure: null,
  }

  const queue = (over: Record<string, unknown> = {}, handlers: Record<string, unknown> = {}) =>
    render(
      <AttentionQueue
        items={[{ ...lost, ...over }]}
        loaded
        workingCount={0}
        onApprove={() => {}}
        onDeny={() => {}}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={() => {}}
        {...handlers}
      />
    )

  it('is identified by its branch, not by the state repeated twice', () => {
    // Three rows all reading "State unknown" are indistinguishable.
    queue()
    expect(screen.getByText('feat/session-ulid')).toBeDefined()
  })

  it('explains what an unknown state means and what happens next', () => {
    queue()
    expect(screen.getByText(/did not survive/)).toBeDefined()
  })

  it('can be discarded, so it does not sit on the queue forever', () => {
    const onDiscard = vi.fn()
    queue({}, { onDiscard })
    fireEvent.click(screen.getByText('Discard'))
    expect(onDiscard).toHaveBeenCalledWith('s1')
  })

  it('offers the same way out of a failed session', () => {
    const onDiscard = vi.fn()
    queue(
      {
        reason: 'failed' as const,
        failure: { step: 'setup' as const, exitCode: 3, output: 'lockfile is out of date' },
      },
      { onDiscard }
    )
    fireEvent.click(screen.getByText('Discard'))
    expect(onDiscard).toHaveBeenCalledWith('s1')
  })

  it('offers no discard for work that is merely waiting to be reviewed', () => {
    // Its diff is unreviewed; discarding it would throw the work away.
    queue({ reason: 'ready' as const })
    expect(screen.queryByText('Discard')).toBeNull()
  })

  it('offers no discard while a session is blocked on a permission request', () => {
    queue({
      reason: 'needs_input' as const,
      pendingPermission: {
        requestId: 'r1',
        toolName: 'Bash',
        summary: 'ls',
        requestedAt: 1_000,
      },
    })
    expect(screen.queryByText('Discard')).toBeNull()
  })
})

describe('seeing what the agent is actually about to run (FR-007)', () => {
  const asking = {
    sessionId: 's1',
    repoPath: '/Users/you/repos/terminator',
    branch: 'testing-12',
    reason: 'needs_input' as const,
    waitingMs: 24_000,
    failure: null,
    pendingPermission: {
      requestId: 'r1',
      toolName: 'Bash',
      summary: 'cd /Users/you/Library/Application Support/@a/terminator/worktrees/08e9 && open .',
      detail:
        'command: cd /Users/you/Library/Application Support/@a/terminator/worktrees/08e9 && open .\ndescription: Inspect global styles',
      requestedAt: 1_000,
    },
  }

  const queue = () =>
    render(
      <AttentionQueue
        items={[asking]}
        loaded
        workingCount={0}
        onApprove={() => {}}
        onDeny={() => {}}
        onAnswer={() => {}}
        onDiscard={() => {}}
        onOpen={() => {}}
      />
    )

  it('names the tool, since a command and a file write read alike', () => {
    queue()
    expect(screen.getByText('Bash')).toBeDefined()
  })

  it('shows the command itself, not only the agent’s description of it', () => {
    queue()
    const detail = document.querySelector('.sv-queue__detail')?.textContent ?? ''
    expect(detail).toContain('&& open .')
    expect(detail).toContain('description: Inspect global styles')
  })

  it('does not elide the command in the block, whatever the title does', () => {
    queue()
    const detail = document.querySelector('.sv-queue__detail')?.textContent ?? ''
    expect(detail).not.toContain('…')
  })
})
