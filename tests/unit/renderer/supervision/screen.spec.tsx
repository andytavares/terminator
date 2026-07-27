import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  SupervisionScreen,
  type SupervisionScreenProps,
} from '../../../../src/renderer/components/supervision/SupervisionScreen.js'

// The screen exists so every surface is reachable. Components that nothing
// renders are dead code, however well tested they are in isolation.

function props(over: Partial<SupervisionScreenProps> = {}): SupervisionScreenProps {
  return {
    now: 10_000,
    loaded: true,
    attention: [],
    workingCount: 0,
    onApprove: vi.fn(),
    onDeny: vi.fn(),
    onOpenSession: vi.fn(),
    review: [],
    activeReview: null,
    decisionFor: () => null,
    onDecideHunk: vi.fn(),
    onAdvanceReview: vi.fn(),
    unattendedMerges: [],
    workItems: [],
    unreadable: [],
    conflicts: [],
    canAct: true,
    onOpenWorkItem: vi.fn(),
    onApproveGate: vi.fn(),
    onRejectGate: vi.fn(),
    onSendBack: vi.fn(),
    onAdvancePhase: vi.fn(),
    actionError: null,
    onDismissActionError: vi.fn(),
    lanes: [],
    mergedOrds: [],
    staleOrds: [],
    blockedReasons: {},
    onMergeLane: vi.fn(),
    feed: [],
    digest: null,
    digestWindowMinutes: 60,
    onRefreshDigest: () => {},
    mutedSessions: [],
    onReply: vi.fn(),
    onToggleMute: vi.fn(),
    shadowMode: true,
    firings: [],
    precision: { total: 0, judged: 0, incorrect: 0, incorrectRate: null },
    onSetShadowMode: vi.fn(),
    onJudge: vi.fn(),
    onAskWhatIsWrong: vi.fn(),
    onShowActivity: vi.fn(),
    onInterrupt: vi.fn(),
    onDiscard: vi.fn(),
    entities: [],
    onChooseEntity: vi.fn(),
    backpressure: null,
    onOverrideBackpressure: vi.fn(),
    onCancelAssign: vi.fn(),
    autonomy: 'edit',
    onAutonomyChange: vi.fn(),
    assigning: false,
    assignResult: null,
    onAssign: vi.fn(),
    repos: [{ path: '/repos/fluent', label: 'fluent' }],
    branches: ['main', 'feat/x'],
    currentBranch: 'main',
    onRepoChange: vi.fn(),
    intakeResult: null,
    onIntake: vi.fn(),
    selectedWorkItemId: null,
    selectedLaneOrd: null,
    reclaimable: [],
    reclaimBusy: null,
    reclaimError: null,
    onReclaim: () => {},
    onReclaimAll: () => {},
    onRefreshReclaimable: () => {},
    provisioning: null,
    onOpenInEditor: vi.fn(),
    lastViewedAt: null,
    failure: null,
    sinceEntries: [],
    sinceStateChanges: [],
    sinceDiffDelta: null,
    ...over,
  }
}

describe('every concept is reachable', () => {
  it('offers a tab for every surface', () => {
    render(<SupervisionScreen {...props()} />)
    const labels = [
      'Needs you',
      'Review',
      'Work items',
      'Lanes',
      'Feed',
      'Stalls',
      'Worktrees',
      'Find',
    ]
    for (const label of labels) {
      expect(screen.getByText(label)).toBeDefined()
    }
  })

  it('opens on the attention queue, which is the sit-down triage case', () => {
    render(<SupervisionScreen {...props()} />)
    expect(screen.getByText(/Nothing needs you/)).toBeDefined()
  })

  it('reaches the review inbox', () => {
    render(<SupervisionScreen {...props()} />)
    fireEvent.click(screen.getByText('Review'))
    expect(screen.getByText(/Nothing is waiting for review/)).toBeDefined()
  })

  it('reaches the work item board', () => {
    render(<SupervisionScreen {...props()} />)
    fireEvent.click(screen.getByText('Work items'))
    expect(screen.getByText(/Sessions still run as ad-hoc work/)).toBeDefined()
  })

  it('reaches the standup feed', () => {
    render(<SupervisionScreen {...props()} />)
    fireEvent.click(screen.getByText('Feed'))
    expect(screen.getByText(/Nothing has happened yet/)).toBeDefined()
  })

  it('reaches the stall controls — the only way to turn shadow mode off', () => {
    render(<SupervisionScreen {...props()} />)
    fireEvent.click(screen.getByText('Stalls'))
    expect(screen.getByText('Turn shadow mode off')).toBeDefined()
  })

  it('turns shadow mode off from the UI', () => {
    const onSetShadowMode = vi.fn()
    render(<SupervisionScreen {...props({ onSetShadowMode })} />)
    fireEvent.click(screen.getByText('Stalls'))
    fireEvent.click(screen.getByText('Turn shadow mode off'))
    expect(onSetShadowMode).toHaveBeenCalledWith(false)
  })

  it('reaches the palette over every entity kind', () => {
    render(<SupervisionScreen {...props()} />)
    fireEvent.click(screen.getByText('Find'))
    expect(
      screen.getByLabelText(/Search sessions, work items, repositories, worktrees and commands/)
    ).toBeDefined()
  })

  it('reaches the lane view, and a single lane carries no multi-repo ceremony', () => {
    render(
      <SupervisionScreen
        {...props({
          lanes: [
            {
              lane: {
                ord: 1,
                repo: 'fluent',
                role: 'producer',
                branch: 'feat/x',
                task_ids: [],
                blocks: [],
                blocked_by: [],
              },
              collisions: [],
              blockedBy: [],
            },
          ],
        })}
      />
    )
    fireEvent.click(screen.getByText('Lanes'))
    expect(screen.getByText('fluent')).toBeDefined()
    // FR-089: one lane renders as one row, with no "N repositories" header.
    expect(screen.queryByText(/repositories/)).toBeNull()
  })

  it('offers the autonomy picker where an agent is assigned', () => {
    render(<SupervisionScreen {...props()} />)
    expect(screen.getByText(/How much can it do without asking/)).toBeDefined()
  })
})

describe('counts and refusals', () => {
  it('badges a tab with its count', () => {
    render(
      <SupervisionScreen
        {...props({
          feed: [
            { id: 'e1', at: 1, sessionId: 's1', author: 'agent', summary: 'x', replyable: true },
          ],
        })}
      />
    )
    expect(screen.getByText('1')).toBeDefined()
  })

  it('shows a backpressure refusal over whatever tab is open (FR-053)', () => {
    render(
      <SupervisionScreen
        {...props({
          backpressure: {
            allowed: false,
            unreviewed: 3,
            limit: 3,
            reason: '3 finished sessions are waiting for review, and the limit is 3.',
          },
        })}
      />
    )
    expect(screen.getByText(/waiting for review, and the limit is 3/)).toBeDefined()
  })

  it('sends the operator to the review tab from the refusal', () => {
    render(
      <SupervisionScreen
        {...props({
          backpressure: { allowed: false, unreviewed: 3, limit: 3, reason: 'full' },
        })}
      />
    )
    fireEvent.click(screen.getByText('Review something'))
    expect(screen.getByText(/Nothing is waiting for review/)).toBeDefined()
  })

  it('shows provisioning output where it can be read without opening a session', () => {
    render(
      <SupervisionScreen
        {...props({
          provisioning: {
            worktreePath: '/wt/x',
            ports: { portBase: 4000, portSpan: 10 },
            setup: { exitCode: 3, output: 'pnpm install failed', durationMs: 5 },
            skipped: [],
          },
        })}
      />
    )
    expect(screen.getByText('pnpm install failed')).toBeDefined()
  })
})

describe('the feed tab carries both deliveries', () => {
  it('shows the progress digest above the chronological feed (FR-028)', () => {
    render(<SupervisionScreen {...props()} />)
    fireEvent.click(screen.getByText('Feed'))
    // Routine progress never interrupts, so this is the only place it lands.
    expect(screen.getByText(/Progress digest/)).toBeDefined()
    expect(screen.getByText(/Nothing has happened yet/)).toBeDefined()
  })
})

describe('a stalled session offers something to do about it (FR-029)', () => {
  const stalled = {
    sessionId: 's1',
    repoPath: '/repos/fluent',
    branch: 'feat/x',
    reason: 'stalled' as const,
    waitingMs: 600_000,
    pendingPermission: null,
    failure: null,
  }

  it('offers all four actions', () => {
    render(<SupervisionScreen {...props({ attention: [stalled] })} />)
    fireEvent.click(screen.getByText('Stalls'))
    expect(screen.getByText(/Ask what is wrong/)).toBeDefined()
    expect(screen.getByText(/Show activity/)).toBeDefined()
    expect(screen.getByText(/Interrupt and redirect/)).toBeDefined()
    expect(screen.getByText(/Discard session and worktree/)).toBeDefined()
  })

  it('asks the session what is wrong', () => {
    const onAskWhatIsWrong = vi.fn()
    render(<SupervisionScreen {...props({ attention: [stalled], onAskWhatIsWrong })} />)
    fireEvent.click(screen.getByText('Stalls'))
    fireEvent.click(screen.getByText(/Ask what is wrong/))
    expect(onAskWhatIsWrong).toHaveBeenCalledWith('s1')
  })

  it('discards the session and its worktree', () => {
    const onDiscard = vi.fn()
    render(<SupervisionScreen {...props({ attention: [stalled], onDiscard })} />)
    fireEvent.click(screen.getByText('Stalls'))
    fireEvent.click(screen.getByText(/Discard session and worktree/))
    expect(onDiscard).toHaveBeenCalledWith('s1')
  })

  it('offers nothing for a session that is merely waiting on you', () => {
    const needsInput = { ...stalled, reason: 'needs_input' as const }
    render(<SupervisionScreen {...props({ attention: [needsInput] })} />)
    fireEvent.click(screen.getByText('Stalls'))
    expect(screen.queryByText(/Discard session and worktree/)).toBeNull()
  })
})
