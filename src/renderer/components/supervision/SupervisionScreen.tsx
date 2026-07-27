import React, { useState } from 'react'
import {
  Inbox,
  ClipboardCheck,
  LayoutGrid,
  GitBranch,
  MessageSquare,
  PauseCircle,
  Search,
} from 'lucide-react'
import { AttentionQueue } from './AttentionQueue.js'
import { ReviewInbox, ReviewFlow } from './ReviewInbox.js'
import { WorkItemBoard, type BoardItem } from './WorkItemBoard.js'
import { LaneView } from './LaneView.js'
import { StandupFeed } from './StandupFeed.js'
import { DigestPanel } from './DigestPanel.js'
import { StallControls, StallActions } from './StallControls.js'
import { SupervisionPalette, type PaletteEntity } from './SupervisionPalette.js'
import { MergeAudit, HunkReview } from './MergeAudit.js'
import { SinceYouLastLooked } from './SinceYouLastLooked.js'
import {
  AutonomyPicker,
  BackpressureDialog,
  ProvisioningStatus,
  AssignPanel,
  IntakePanel,
  type RepoChoice,
} from './AssignControls.js'
import type { AttentionItem } from '../../../shared/supervision/rank-attention.js'
import type { AutonomyLevel, RuntimeState } from '../../../shared/types/supervision.js'
import type {
  ReviewItem,
  IntentReview,
  FeedEntry,
  LaneViewModel,
  RecordedFiring,
  Digest,
  PrecisionReport,
  UnattendedMergeRecord,
  Hunk,
  HunkDecision,
  BackpressureDecision,
  ScriptResult,
} from '../../../shared/supervision/view-types.js'
import './supervision.css'

// Every supervision surface, reachable. Without this screen the components
// exist and are tested but nothing renders them — which is the difference
// between a library and a feature.

export type SupervisionTab = 'attention' | 'review' | 'items' | 'lanes' | 'feed' | 'stalls' | 'find'

export interface SupervisionScreenProps {
  now: number
  loaded: boolean

  attention: readonly AttentionItem[]
  workingCount: number
  onApprove(sessionId: string, requestId: string): void
  onDeny(sessionId: string, requestId: string): void
  /** Answers a request that is a question rather than a yes/no. */
  onAnswer(sessionId: string, requestId: string, answer: string): void
  onOpenSession(sessionId: string): void

  review: readonly ReviewItem[]
  activeReview: { item: ReviewItem; intent: IntentReview | null; hunks: readonly Hunk[] } | null
  decisionFor(hunkId: string): HunkDecision | null
  onDecideHunk(hunkId: string, decision: HunkDecision): void
  onAdvanceReview(): void
  unattendedMerges: readonly UnattendedMergeRecord[]

  workItems: readonly BoardItem[]
  unreadable: ReadonlyArray<{ filePath: string; reason: string }>
  conflicts: ReadonlyArray<{ workItemId: string; producers: string[] }>
  canAct: boolean
  onOpenWorkItem(workItemId: string): void
  /** Prefills the assign panel when a work-item lane is selected. */
  selectedWorkItemId: string | null
  selectedLaneOrd: number | null
  onApproveGate(workItemId: string, gate: string): void
  onRejectGate(workItemId: string, gate: string, notes: string): void
  onSendBack(workItemId: string, phase: string, notes: string): void
  onAdvancePhase(workItemId: string): void
  /** A producer refused, or provides no such command (FR-078). */
  actionError: string | null
  onDismissActionError(): void

  lanes: readonly LaneViewModel[]
  mergedOrds: readonly number[]
  staleOrds: readonly number[]
  blockedReasons: Readonly<Record<number, string>>
  onMergeLane(ord: number): void

  feed: readonly FeedEntry[]
  /** Routine progress, batched rather than delivered as it happens (FR-028). */
  digest: Digest | null
  digestWindowMinutes: number
  onRefreshDigest(): void
  mutedSessions: readonly string[]
  onReply(sessionId: string, message: string): void
  onToggleMute(sessionId: string): void

  shadowMode: boolean
  firings: readonly RecordedFiring[]
  precision: PrecisionReport
  onSetShadowMode(value: boolean): void
  onJudge(firingId: string, judgement: 'correct' | 'incorrect'): void
  /** FR-029: what a stall lets you actually do about it. */
  onAskWhatIsWrong(sessionId: string): void
  onShowActivity(sessionId: string): void
  onInterrupt(sessionId: string, redirect?: string): void
  onDiscard(sessionId: string): void

  entities: readonly PaletteEntity[]
  onChooseEntity(entity: PaletteEntity): void

  /** Present only while an assignment is being refused (FR-053). */
  backpressure: BackpressureDecision | null
  onOverrideBackpressure(): void
  onCancelAssign(): void
  autonomy: AutonomyLevel
  onAutonomyChange(level: AutonomyLevel): void

  /** Starting a supervised session — the front door (FR-030, FR-041). */
  assigning: boolean
  assignResult: { ok: boolean; reason?: string; worktreePath?: string } | null
  /** Repositories the app already knows about, and the chosen one's branches. */
  repos: readonly RepoChoice[]
  branches: readonly string[]
  currentBranch: string | null
  onRepoChange(repoPath: string): void
  onAssign(request: {
    repoPath: string
    branch: string
    isNewBranch?: boolean
    instruction?: string
    workItemId?: string
    laneOrd?: number
  }): void
  /** Stage 1: a ticket URL or a local document becomes a queued item (FR-068). */
  intakeResult: { ok: boolean; reason?: string; id?: string } | null
  onIntake(input: { url?: string; filePath?: string }): void

  provisioning: {
    worktreePath: string | null
    ports: { portBase: number; portSpan: number } | null
    setup: ScriptResult | null
    skipped: ReadonlyArray<{ path: string; reason: string }>
  } | null
  onOpenInEditor(): void

  lastViewedAt: number | null
  sinceEntries: readonly FeedEntry[]
  /** FR-036: two of this panel's three answers were permanently empty. */
  sinceStateChanges: ReadonlyArray<{ to: RuntimeState; at: number }>
  sinceDiffDelta: { files: number; added: number; removed: number } | null
}

const TABS: Array<{ id: SupervisionTab; label: string; icon: JSX.Element }> = [
  { id: 'attention', label: 'Needs you', icon: <Inbox aria-hidden="true" /> },
  { id: 'review', label: 'Review', icon: <ClipboardCheck aria-hidden="true" /> },
  { id: 'items', label: 'Work items', icon: <LayoutGrid aria-hidden="true" /> },
  { id: 'lanes', label: 'Lanes', icon: <GitBranch aria-hidden="true" /> },
  { id: 'feed', label: 'Feed', icon: <MessageSquare aria-hidden="true" /> },
  { id: 'stalls', label: 'Stalls', icon: <PauseCircle aria-hidden="true" /> },
  { id: 'find', label: 'Find', icon: <Search aria-hidden="true" /> },
]

export function SupervisionScreen(props: SupervisionScreenProps): JSX.Element {
  const [tab, setTab] = useState<SupervisionTab>('attention')
  const [query, setQuery] = useState('')

  const counts: Partial<Record<SupervisionTab, number>> = {
    attention: props.attention.length,
    review: props.review.length,
    items: props.workItems.length,
    feed: props.feed.length,
    stalls: props.firings.length,
  }

  return (
    <div className="sv-screen">
      <div className="sv-tabs" role="tablist" aria-label="Supervision">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className="sv-tab"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.icon}
            {entry.label}
            {(counts[entry.id] ?? 0) > 0 && (
              <span className="sv-tab__count">{counts[entry.id]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Refusals interrupt whatever tab is open — being told why you cannot
          start another agent is the whole mechanism (FR-053). */}
      {props.backpressure !== null && (
        <BackpressureDialog
          decision={props.backpressure}
          onOverride={props.onOverrideBackpressure}
          onCancel={props.onCancelAssign}
          onReviewNow={() => setTab('review')}
        />
      )}

      <div className="sv-tabpanel">
        {tab === 'attention' && (
          <>
            <SinceYouLastLooked
              lastViewedAt={props.lastViewedAt}
              now={props.now}
              entries={props.sinceEntries}
              stateChanges={props.sinceStateChanges}
              diffDelta={props.sinceDiffDelta}
            />
            <AttentionQueue
              items={props.attention}
              loaded={props.loaded}
              workingCount={props.workingCount}
              onApprove={props.onApprove}
              onDeny={props.onDeny}
              onAnswer={props.onAnswer}
              onOpen={props.onOpenSession}
            />
            <AutonomyPicker value={props.autonomy} onChange={props.onAutonomyChange} />
            <AssignPanel
              autonomy={props.autonomy}
              workItemId={props.selectedWorkItemId}
              laneOrd={props.selectedLaneOrd}
              repos={props.repos}
              branches={props.branches}
              currentBranch={props.currentBranch}
              onRepoChange={props.onRepoChange}
              onAssign={props.onAssign}
              lastResult={props.assignResult}
              busy={props.assigning}
            />
            {props.provisioning !== null && (
              <ProvisioningStatus
                worktreePath={props.provisioning.worktreePath}
                ports={props.provisioning.ports}
                setup={props.provisioning.setup}
                skipped={props.provisioning.skipped}
                onOpenInEditor={props.onOpenInEditor}
              />
            )}
          </>
        )}

        {tab === 'review' && (
          <>
            <ReviewInbox items={props.review} now={props.now} onOpen={props.onOpenSession} />
            {props.activeReview !== null && (
              <>
                <ReviewFlow
                  step={props.activeReview.item.step}
                  intent={props.activeReview.intent}
                  onAdvance={props.onAdvanceReview}
                />
                <HunkReview
                  hunks={props.activeReview.hunks}
                  decisionFor={props.decisionFor}
                  onDecide={props.onDecideHunk}
                />
              </>
            )}
            <MergeAudit merges={props.unattendedMerges} />
          </>
        )}

        {tab === 'items' && (
          <>
            <IntakePanel onIntake={props.onIntake} result={props.intakeResult} />
            <WorkItemBoard
              items={props.workItems}
              unreadable={props.unreadable}
              conflicts={props.conflicts}
              canAct={props.canAct}
              onOpen={props.onOpenWorkItem}
              onApproveGate={props.onApproveGate}
              onRejectGate={props.onRejectGate}
              onSendBack={props.onSendBack}
              onAdvancePhase={props.onAdvancePhase}
              actionError={props.actionError}
              onDismissActionError={props.onDismissActionError}
            />
          </>
        )}

        {tab === 'lanes' && (
          <LaneView
            lanes={props.lanes}
            mergedOrds={props.mergedOrds}
            staleOrds={props.staleOrds}
            blockedReasons={props.blockedReasons}
            onMerge={props.onMergeLane}
          />
        )}

        {tab === 'feed' && (
          <>
            <DigestPanel
              digest={props.digest}
              windowMinutes={props.digestWindowMinutes}
              onRefresh={props.onRefreshDigest}
            />
            <StandupFeed
              entries={props.feed}
              mutedSessions={props.mutedSessions}
              onReply={props.onReply}
              onToggleMute={props.onToggleMute}
            />
          </>
        )}

        {tab === 'stalls' && (
          <>
            <StallControls
              shadowMode={props.shadowMode}
              firings={props.firings}
              precision={props.precision}
              onSetShadowMode={props.onSetShadowMode}
              onJudge={props.onJudge}
            />
            {/* Every session currently stalled, with something to do about it —
              a stall that only reports itself is half the feature (FR-029). */}
            {props.attention
              .filter((item) => item.reason === 'stalled')
              .map((item) => (
                <div className="sv-row" key={item.sessionId}>
                  <span className="sv-row__main">
                    <div className="sv-queue__title">{item.repoPath.split('/').pop()}</div>
                    <StallActions
                      sessionId={item.sessionId}
                      onAsk={props.onAskWhatIsWrong}
                      onShowTranscript={props.onShowActivity}
                      onInterrupt={props.onInterrupt}
                      onDiscard={props.onDiscard}
                    />
                  </span>
                </div>
              ))}
          </>
        )}

        {tab === 'find' && (
          <SupervisionPalette
            entities={props.entities}
            query={query}
            onQueryChange={setQuery}
            onChoose={props.onChooseEntity}
          />
        )}
      </div>
    </div>
  )
}
