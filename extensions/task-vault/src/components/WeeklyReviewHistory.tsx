import React, { useEffect, useState } from 'react'
import { Download, ChevronRight, ChevronDown } from 'lucide-react'
import { notify } from '../utils/notify'
import { IconButton } from '@terminator/extension-ui'

export interface ReviewAction {
  id: string
  step: number
  action: string
  entityType: 'task' | 'project'
  entityId: string | null
  entityLabel: string
  detail: string | null
  createdAt: string
}

interface ReviewSummary {
  id: string
  startedAt: string
  completedAt: string | null
  status: 'in_progress' | 'completed'
  actionCount: number
}

interface ReviewDetail extends ReviewSummary {
  worked: string | null
  didntWork: string | null
  tryNext: string | null
  actions: ReviewAction[]
}

// Labels mirror weekly-review-repository's ACTION_HEADINGS; the renderer cannot
// import from the extension's main-process modules.
const ACTION_LABELS: Record<string, string> = {
  captured: 'Captured',
  'inbox-processed': 'Inbox processed',
  'project-status': 'Project status',
  'task-promoted': 'Promoted to today',
  'task-backlogged': 'Moved to backlog',
  'task-archived': 'Archived',
  'task-deleted': 'Deleted',
  'task-kept': 'Kept as-is',
}

const ACTION_ORDER = [
  'captured',
  'inbox-processed',
  'project-status',
  'task-promoted',
  'task-kept',
  'task-backlogged',
  'task-archived',
  'task-deleted',
]

export function formatReviewDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Groups a review's actions into the sections the detail view renders. */
export function groupActions(actions: ReviewAction[]): { kind: string; items: ReviewAction[] }[] {
  return ACTION_ORDER.map((kind) => ({
    kind,
    items: actions.filter((a) => a.action === kind),
  })).filter((group) => group.items.length > 0)
}

function ActionGroups({ actions }: { actions: ReviewAction[] }): React.JSX.Element {
  return (
    <>
      {groupActions(actions).map((group) => (
        <div key={group.kind} className="wr-history__group">
          <h4 className="wr-history__group-title">{ACTION_LABELS[group.kind] ?? group.kind}</h4>
          <ul className="wr-history__actions">
            {group.items.map((item) => (
              <li key={item.id}>
                {item.entityLabel}
                {item.detail && <span className="wr-history__action-detail"> — {item.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

function Reflection({ detail }: { detail: ReviewDetail }): React.JSX.Element | null {
  if (!detail.worked && !detail.didntWork && !detail.tryNext) return null
  return (
    <div className="wr-history__group">
      <h4 className="wr-history__group-title">Reflection</h4>
      <dl className="wr-history__reflection">
        <dt>What worked well?</dt>
        <dd>{detail.worked || '—'}</dd>
        <dt>What didn&apos;t work?</dt>
        <dd>{detail.didntWork || '—'}</dd>
        <dt>What will you try next week?</dt>
        <dd>{detail.tryNext || '—'}</dd>
      </dl>
    </div>
  )
}

function ReviewDetailView({ detail }: { detail: ReviewDetail | null }): React.JSX.Element {
  return (
    <div className="wr-history__detail">
      {!detail && <p className="wr-history__loading">Loading…</p>}
      {detail && detail.actions.length === 0 && (
        <p className="wr-history__none">Nothing was recorded during this review.</p>
      )}
      {detail && <ActionGroups actions={detail.actions} />}
      {detail && <Reflection detail={detail} />}
    </div>
  )
}

interface RowProps {
  review: ReviewSummary
  expanded: boolean
  onToggle: (id: string) => void
}

function ReviewToggle({ review, expanded, onToggle }: RowProps): React.JSX.Element {
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <button
      aria-expanded={expanded}
      className="wr-history__toggle"
      onClick={() => onToggle(review.id)}
    >
      <Chevron className="tm-icon" />
      <span className="wr-history__date">{formatReviewDate(review.startedAt)}</span>
      {review.status === 'in_progress' && <span className="wr-history__badge">in progress</span>}
      <span className="wr-history__count">
        {review.actionCount} action{review.actionCount === 1 ? '' : 's'}
      </span>
    </button>
  )
}

async function exportReview(id: string) {
  const result = (await window.electronAPI.extensionBridge.invoke('task-vault:review:export', {
    reviewId: id,
  })) as { filePath?: string; canceled?: boolean; error?: string }
  if (result?.error) {
    notify('error', `Could not export review: ${result.error}`, 'reviewExportFailed')
    return
  }
  if (result?.filePath) {
    notify('success', `Review exported to ${result.filePath}`, 'reviewExported')
  }
}

interface ItemProps extends RowProps {
  detail: ReviewDetail | null
}

function ReviewItem(props: ItemProps): React.JSX.Element {
  const { review, expanded, detail } = props
  return (
    <li className="wr-history__item">
      <div className="wr-history__row">
        <ReviewToggle review={review} expanded={expanded} onToggle={props.onToggle} />
        <IconButton
          icon={Download}
          label={`Export review from ${formatReviewDate(review.startedAt)}`}
          size="sm"
          onClick={() => void exportReview(review.id)}
        />
      </div>
      {expanded && <ReviewDetailView detail={detail} />}
    </li>
  )
}

function useReviewList() {
  const [reviews, setReviews] = useState<ReviewSummary[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    async function load() {
      try {
        const result = (await window.electronAPI.extensionBridge.invoke(
          'task-vault:review:list',
          {}
        )) as { reviews?: ReviewSummary[] }
        setReviews(result?.reviews ?? [])
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])
  return { reviews, loading }
}

/** Which review is open, and its detail once loaded. */
function useExpandedReview() {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReviewDetail | null>(null)

  async function toggle(id: string) {
    setDetail(null)
    if (expandedId === id) return setExpandedId(null)
    setExpandedId(id)
    const result = (await window.electronAPI.extensionBridge.invoke('task-vault:review:get', {
      reviewId: id,
    })) as { review?: ReviewDetail }
    if (result?.review) setDetail(result.review)
  }

  return { expandedId, detail, toggle }
}

export function WeeklyReviewHistory(): React.JSX.Element {
  const { reviews, loading } = useReviewList()
  const { expandedId, detail, toggle } = useExpandedReview()
  if (loading) return <div className="wr-history wr-history--loading">Loading past reviews…</div>
  if (reviews.length === 0) {
    return (
      <div className="wr-history wr-history--empty">
        <p>No reviews recorded yet. Finish a weekly review and it will show up here.</p>
      </div>
    )
  }
  return (
    <div className="wr-history">
      <ul className="wr-history__list">
        {reviews.map((review) => (
          <ReviewItem
            key={review.id}
            review={review}
            expanded={expandedId === review.id}
            detail={detail}
            onToggle={(id) => void toggle(id)}
          />
        ))}
      </ul>
    </div>
  )
}
