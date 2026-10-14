import React, { useState, useEffect, useRef } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Button, IconButton } from '@terminator/extension-ui'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { useReviewUiStore } from '../../stores/review-ui.store'
import { sortPrs } from '../../review/sort-prs'
import { SortSelect } from './SortSelect'
import type { ReviewQueuePR } from '../../schemas/pr-review.schema'
import { PrRow, shortAge, type MetaPart } from './DiffSize'
import { choose } from '../text'
import './review-dashboard.css'

interface Props {
  repoRoot: string
  onOpenPr: (pr: ReviewQueuePR) => void
  onRefresh: (options?: { search?: string }) => Promise<void>
  onDismissPr: (prNumber: number) => Promise<void>
}

type QueueStore = ReturnType<typeof usePrReviewStore.getState>

function searchOption(query: string): { search?: string } {
  return { search: query.trim() || undefined }
}

/** Refreshes 350ms after the search text stops changing; not on the first render. */
function useSearchRefresh(searchQuery: string, onRefresh: Props['onRefresh']): void {
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(false)
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true
      return
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      onRefresh(searchOption(searchQuery))
    }, 350)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchQuery, onRefresh])
}

function useQueueRefresh(onRefresh: Props['onRefresh']) {
  const [refreshing, setRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  useSearchRefresh(searchQuery, onRefresh)
  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh(searchOption(searchQuery))
    } finally {
      setRefreshing(false)
    }
  }
  return { refreshing, searchQuery, setSearchQuery, handleRefresh }
}

type QueueRefresh = ReturnType<typeof useQueueRefresh>

/** One line of triage, not four tiles: a label names a metric, and what to do about it belongs in
 *  the grouping below. Why: README.md, "Why the review screen works as it does". */
function TriageBand({ store, refresh }: { store: QueueStore; refresh: QueueRefresh }) {
  const { prQueue, totalPrCount } = store
  // Reading time is only knowable for the PRs actually loaded, so it is
  // stated as a floor rather than passed off as the total when more remain.
  const totalMinutes = prQueue.reduce((s, p) => s + p.estimatedMinutes, 0)
  const minutesArePartial = totalPrCount !== null && totalPrCount > prQueue.length
  const highRiskCount = prQueue.filter((p) => p.riskLevel === 'high').length
  const inProgressCount = prQueue.filter((p) => p.sessionStatus !== 'not-started').length
  return (
    <div className="rd-band">
      <span>
        <b>{totalPrCount ?? prQueue.length}</b> waiting on you
      </span>
      {highRiskCount > 0 && <span className="rd-warn">{highRiskCount} high risk</span>}
      {inProgressCount > 0 && <span>{inProgressCount} already started</span>}
      <span>
        {choose(minutesArePartial, 'At least ', 'About ')}
        <b>{totalMinutes} min</b> of reading
      </span>
      <span className="rd-sp" />
      <IconButton
        icon={RefreshCw}
        className={choose(refresh.refreshing, 'pr-refresh-btn--spinning', undefined)}
        onClick={refresh.handleRefresh}
        disabled={refresh.refreshing}
        label="Refresh pull requests"
      />
    </div>
  )
}

function SearchRow({ refresh }: { refresh: QueueRefresh }) {
  const { queueSort, setQueueSort } = useReviewUiStore()
  return (
    <div className="pr-search-row">
      <input
        aria-label="Search pull requests"
        className="pr-search-input"
        type="search"
        placeholder="Search open PRs · is:merged for merged"
        value={refresh.searchQuery}
        onChange={(e) => refresh.setSearchQuery(e.target.value)}
      />
      <SortSelect value={queueSort} onChange={setQueueSort} />
    </div>
  )
}

function QueueBanners({ store, refresh }: { store: QueueStore; refresh: QueueRefresh }) {
  return (
    <>
      {store.rateLimitState && (
        <div className="pr-rate-limit-banner">
          GitHub API rate limit reached. Some data may be incomplete. Resets soon.
        </div>
      )}
      {store.queueError && (
        <div className="pr-queue-error">
          Failed to load queue: {store.queueError}
          <Button
            size="sm"
            icon={RefreshCw}
            onClick={refresh.handleRefresh}
            disabled={refresh.refreshing}
          >
            Retry
          </Button>
        </div>
      )}
    </>
  )
}

interface QueueRowsProps {
  store: QueueStore
  searchQuery: string
  onOpenPr: Props['onOpenPr']
  onDismissPr: Props['onDismissPr']
}

function QueueRows(props: QueueRowsProps) {
  const { store } = props
  const { prQueue } = store
  const { queueSort } = useReviewUiStore()
  if (store.queueLoading) return <div className="pr-queue-loading">Loading pull requests…</div>
  if (prQueue.length === 0) {
    const text = choose(props.searchQuery, 'No matching pull requests.', 'No open pull requests.')
    return <div className="pr-queue-empty">{text}</div>
  }
  return (
    <div className="rd-rows">
      <h3 className="rd-grp">
        <span>Open pull requests</span>
        <span className="rd-ct">{store.totalPrCount ?? prQueue.length}</span>
      </h3>
      {sortPrs(prQueue, queueSort, (pr) => pr).map((pr) => (
        <QueueRow
          key={pr.number}
          pr={pr}
          onOpen={props.onOpenPr}
          onDismiss={props.onDismissPr}
          currentUserLogin={store.currentUserLogin}
        />
      ))}
    </div>
  )
}

export function ReviewQueue({ onOpenPr, onRefresh, onDismissPr }: Props) {
  const store = usePrReviewStore()
  const refresh = useQueueRefresh(onRefresh)
  const { searchQuery } = refresh
  return (
    <div className="pr-review-queue">
      <QueueBanners store={store} refresh={refresh} />
      <TriageBand store={store} refresh={refresh} />
      <SearchRow refresh={refresh} />
      <div className="pr-sections">
        <QueueRows
          store={store}
          searchQuery={searchQuery}
          onOpenPr={onOpenPr}
          onDismissPr={onDismissPr}
        />
      </div>
      {/* Pages arrive on their own; this only says so while one is in flight. */}
      {store.loadingMorePrs && !searchQuery && <p className="pr-loading-rest">Loading the rest…</p>}
    </div>
  )
}

interface QueueRowProps {
  pr: ReviewQueuePR
  onOpen: (pr: ReviewQueuePR) => void
  onDismiss?: (prNumber: number) => Promise<void>
  currentUserLogin: string | null
}

const ACTION_LABEL: Record<string, string> = { paused: 'Resume', 'in-progress': 'Continue' }

/** True when the viewer was asked to review the PR or is assigned to it. */
function isMine(pr: ReviewQueuePR, login: string | null): boolean {
  if (login === null) return false
  return pr.requestedReviewers.includes(login) || pr.assigneeLogins.includes(login)
}

/** The row's states: only those that need attention, plus who opened it and when. */
function rowMetaParts(pr: ReviewQueuePR, mine: boolean): (MetaPart | null | false)[] {
  return [
    pr.state === 'merged' && { text: 'Merged' },
    pr.state === 'closed' && { text: 'Closed' },
    pr.isDraft && { text: 'Draft' },
    pr.mergeStateStatus === 'dirty' && {
      text: 'Conflicts',
      tone: 'warning',
      title: 'This PR has merge conflicts',
    },
    { text: pr.author },
    { text: shortAge(pr.openedAt) },
    pr.approvalCount > 0 && {
      text: `${pr.approvalCount} approved`,
      title: `Approved by: ${pr.approvedBy.join(', ')}`,
    },
    pr.riskLevel === 'high' && { text: 'High risk', tone: 'danger' },
    pr.ciStatus === 'failing' && { text: 'CI failing', tone: 'danger' },
    mine && { text: 'Your review requested' },
    pr.sessionStatus !== 'not-started' && {
      text: `${pr.viewedFileCount} of ${pr.fileCount} viewed`,
    },
  ]
}

function DismissButton(props: {
  prNumber: number
  onDismiss: (prNumber: number) => Promise<void>
}) {
  return (
    <IconButton
      icon={X}
      size="sm"
      onClick={(e) => {
        e.stopPropagation()
        void props.onDismiss(props.prNumber)
      }}
      label={`Dismiss PR #${props.prNumber} from in-progress`}
    />
  )
}

function QueueRow(props: QueueRowProps) {
  const { pr, onDismiss } = props
  const isSession = pr.sessionStatus === 'paused' || pr.sessionStatus === 'in-progress'
  // A control says what happens when it is used: every one of these opens the diff.
  const label = ACTION_LABEL[pr.sessionStatus] ?? 'Review'
  return (
    <PrRow
      pr={pr}
      onOpen={() => props.onOpen(pr)}
      meta={rowMetaParts(pr, isMine(pr, props.currentUserLogin))}
      action={{ label, primary: isSession, always: isSession }}
    >
      {onDismiss && pr.sessionStatus !== 'not-started' && (
        <DismissButton prNumber={pr.number} onDismiss={onDismiss} />
      )}
    </PrRow>
  )
}
