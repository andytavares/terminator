import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  SupervisionProvider,
  SupervisionTab,
} from '../../../../src/renderer/components/supervision/SupervisionTab.js'
import type { SupervisionScreenProps } from '../../../../src/renderer/components/supervision/SupervisionScreen.js'

// The console is registered as a global tab, so the shell renders it with no
// props. They come from the provider App wraps the tree in — one hook
// instance, because the hook behind them polls and holds subscriptions.

const props = (): SupervisionScreenProps =>
  ({
    now: 10_000,
    loaded: true,
    attention: [],
    workingCount: 0,
    onApprove: () => {},
    onDeny: () => {},
    onAnswer: () => {},
    onOpenSession: () => {},
    sessions: [],
    onStop: () => {},
    onAttach: () => {},
    review: [],
    activeReview: null,
    decisionFor: () => null,
    onDecideHunk: () => {},
    onAdvanceReview: () => {},
    unattendedMerges: [],
    workItems: [],
    unreadable: [],
    conflicts: [],
    canAct: false,
    onOpenWorkItem: () => {},
    selectedWorkItemId: null,
    selectedLaneOrd: null,
    onApproveGate: () => {},
    onRejectGate: () => {},
    onSendBack: () => {},
    onAdvancePhase: () => {},
    actionError: null,
    onDismissActionError: () => {},
    lanes: [],
    mergedOrds: [],
    staleOrds: [],
    blockedReasons: {},
    onMergeLane: () => {},
    feed: [],
    digest: null,
    digestWindowMinutes: 60,
    onRefreshDigest: () => {},
    mutedSessions: [],
    onReply: () => {},
    onToggleMute: () => {},
    onRemoveFeedEntry: () => {},
    shadowMode: true,
    firings: [],
    precision: { total: 0, judged: 0, incorrect: 0, incorrectRate: null },
    onSetShadowMode: () => {},
    onJudge: () => {},
    onRemoveFiring: () => {},
    onAskWhatIsWrong: () => {},
    onShowActivity: () => {},
    onInterrupt: () => {},
    onDiscard: () => {},
    entities: [],
    onChooseEntity: () => {},
    backpressure: null,
    onOverrideBackpressure: () => {},
    onCancelAssign: () => {},
    autonomy: 'edit',
    onAutonomyChange: () => {},
    assigning: false,
    assignResult: null,
    onAssign: () => {},
    intakeResult: null,
    queuedIntake: [],
    pulling: false,
    onRemoveIntake: () => {},
    onPullFromLinear: () => {},
    onIntake: () => {},
    repos: [],
    branches: [],
    currentBranch: null,
    onRepoChange: () => {},
    reclaimable: [],
    reclaimBusy: null,
    reclaimError: null,
    onReclaim: () => {},
    onReclaimAll: () => {},
    onRefreshReclaimable: () => {},
    provisioning: null,
    onOpenInEditor: () => {},
    lastViewedAt: null,
    terminalSessionId: null,
    projectId: null,
    sinceEntries: [],
    sinceStateChanges: [],
    sinceDiffDelta: null,
  }) as SupervisionScreenProps

describe('the supervision global tab', () => {
  it('renders the console from the provider', () => {
    render(
      <SupervisionProvider value={props()}>
        <SupervisionTab />
      </SupervisionProvider>
    )
    expect(screen.getByRole('tablist', { name: 'Supervision' })).toBeDefined()
  })

  it('says so rather than rendering blank when it is outside the app shell', () => {
    // Reachable only as a wiring mistake, which is exactly when a blank screen
    // is least useful.
    render(<SupervisionTab />)
    expect(screen.getByText(/not available in this window/)).toBeDefined()
  })

  it('passes the props straight through', () => {
    render(
      <SupervisionProvider value={{ ...props(), workingCount: 3 }}>
        <SupervisionTab />
      </SupervisionProvider>
    )
    expect(screen.getByText(/3 sessions are working/)).toBeDefined()
  })
})
