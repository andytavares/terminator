import type { ExtensionDB } from '../../../../src/main/extensions/api'
import { randomUUID } from './db'

// Persistence for the weekly review. Before this existed the review left no
// trace beyond a single inbox task holding the reflection text as a sentence,
// so there was no way to look back at what was promoted, archived, or dropped.

export type ReviewStatus = 'in_progress' | 'completed'

export type ReviewActionKind =
  | 'captured'
  | 'inbox-processed'
  | 'project-status'
  | 'task-promoted'
  | 'task-backlogged'
  | 'task-archived'
  | 'task-deleted'
  | 'task-kept'

export type ReviewEntityType = 'task' | 'project'

export interface WeeklyReviewAction {
  id: string
  reviewId: string
  step: number
  action: ReviewActionKind
  entityType: ReviewEntityType
  entityId: string | null
  entityLabel: string
  detail: string | null
  createdAt: string
}

export interface WeeklyReview {
  id: string
  startedAt: string
  completedAt: string | null
  status: ReviewStatus
  worked: string | null
  didntWork: string | null
  tryNext: string | null
}

export interface WeeklyReviewSummary extends WeeklyReview {
  actionCount: number
}

export interface WeeklyReviewDetail extends WeeklyReview {
  actions: WeeklyReviewAction[]
}

interface ReviewRow {
  id: string
  started_at: string
  completed_at: string | null
  status: string
  worked: string | null
  didnt_work: string | null
  try_next: string | null
}

interface ActionRow {
  id: string
  review_id: string
  step: string | number
  action: string
  entity_type: string
  entity_id: string | null
  entity_label: string
  detail: string | null
  created_at: string
}

export function rowToReview(row: ReviewRow): WeeklyReview {
  return {
    id: row.id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status === 'completed' ? 'completed' : 'in_progress',
    worked: row.worked,
    didntWork: row.didnt_work,
    tryNext: row.try_next,
  }
}

export function rowToAction(row: ActionRow): WeeklyReviewAction {
  return {
    id: row.id,
    reviewId: row.review_id,
    step: Number(row.step),
    action: row.action as ReviewActionKind,
    entityType: row.entity_type as ReviewEntityType,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    detail: row.detail,
    createdAt: row.created_at,
  }
}

/**
 * Returns the review to record against: the most recent unfinished one if the
 * user is resuming, otherwise a fresh row. Resuming matters because the wizard
 * already restores its step from sessionStorage, so a reload mid-review must
 * not fork the record in two.
 */
export async function startOrResumeReview(
  db: ExtensionDB,
  now = new Date().toISOString()
): Promise<{ review: WeeklyReview; resumed: boolean }> {
  const existing = await db.get<ReviewRow>(
    `SELECT * FROM weekly_reviews WHERE status='in_progress' ORDER BY started_at DESC LIMIT 1`
  )
  if (existing) return { review: rowToReview(existing), resumed: true }

  const id = randomUUID()
  await db.run(`INSERT INTO weekly_reviews (id, started_at, status) VALUES (?, ?, 'in_progress')`, [
    id,
    now,
  ])
  return {
    review: {
      id,
      startedAt: now,
      completedAt: null,
      status: 'in_progress',
      worked: null,
      didntWork: null,
      tryNext: null,
    },
    resumed: false,
  }
}

export interface LogActionInput {
  reviewId: string
  step: number
  action: ReviewActionKind
  entityType: ReviewEntityType
  entityId?: string | null
  entityLabel: string
  detail?: string | null
}

export async function logReviewAction(
  db: ExtensionDB,
  input: LogActionInput,
  now = new Date().toISOString()
): Promise<WeeklyReviewAction> {
  const id = randomUUID()
  await db.run(
    `INSERT INTO weekly_review_actions
       (id, review_id, step, action, entity_type, entity_id, entity_label, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.reviewId,
      input.step,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.entityLabel,
      input.detail ?? null,
      now,
    ]
  )
  return {
    id,
    reviewId: input.reviewId,
    step: input.step,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityLabel: input.entityLabel,
    detail: input.detail ?? null,
    createdAt: now,
  }
}

export async function completeReview(
  db: ExtensionDB,
  input: { reviewId: string; worked?: string; didntWork?: string; tryNext?: string },
  now = new Date().toISOString()
): Promise<void> {
  await db.run(
    `UPDATE weekly_reviews
       SET status='completed', completed_at=?, worked=?, didnt_work=?, try_next=?
     WHERE id=?`,
    [
      now,
      input.worked?.trim() || null,
      input.didntWork?.trim() || null,
      input.tryNext?.trim() || null,
      input.reviewId,
    ]
  )
}

export async function listReviews(db: ExtensionDB, limit = 50): Promise<WeeklyReviewSummary[]> {
  const rows = await db.query<ReviewRow & { action_count: string }>(
    `SELECT r.*, COUNT(a.id) AS action_count
       FROM weekly_reviews r
       LEFT JOIN weekly_review_actions a ON a.review_id = r.id
      GROUP BY r.id
      ORDER BY r.started_at DESC
      LIMIT ?`,
    [limit]
  )
  return rows.map((row) => ({ ...rowToReview(row), actionCount: Number(row.action_count ?? 0) }))
}

export async function getReview(
  db: ExtensionDB,
  reviewId: string
): Promise<WeeklyReviewDetail | null> {
  const row = await db.get<ReviewRow>(`SELECT * FROM weekly_reviews WHERE id=?`, [reviewId])
  if (!row) return null
  const actionRows = await db.query<ActionRow>(
    `SELECT * FROM weekly_review_actions WHERE review_id=? ORDER BY created_at ASC, step ASC`,
    [reviewId]
  )
  return { ...rowToReview(row), actions: actionRows.map(rowToAction) }
}

/** Date of the most recent completed review, for the review's own header. */
export async function lastCompletedReviewDate(db: ExtensionDB): Promise<string | null> {
  const row = await db.get<{ completed_at: string }>(
    `SELECT completed_at FROM weekly_reviews
      WHERE status='completed' AND completed_at IS NOT NULL
      ORDER BY completed_at DESC LIMIT 1`
  )
  return row?.completed_at ?? null
}

// ── Export ────────────────────────────────────────────────────────

const ACTION_HEADINGS: Record<ReviewActionKind, string> = {
  captured: 'Captured',
  'inbox-processed': 'Inbox processed',
  'project-status': 'Project status changes',
  'task-promoted': 'Promoted to today',
  'task-backlogged': 'Moved to backlog',
  'task-archived': 'Archived',
  'task-deleted': 'Deleted',
  'task-kept': 'Kept as-is',
}

/** Order sections by the flow of the review rather than alphabetically. */
const ACTION_ORDER: ReviewActionKind[] = [
  'captured',
  'inbox-processed',
  'project-status',
  'task-promoted',
  'task-kept',
  'task-backlogged',
  'task-archived',
  'task-deleted',
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

export function formatReviewMarkdown(review: WeeklyReviewDetail): string {
  const lines: string[] = [
    `# Weekly Review — ${formatDate(review.startedAt)}`,
    '',
    `- Started: ${review.startedAt}`,
    `- Completed: ${review.completedAt ?? 'not completed'}`,
    `- Actions recorded: ${review.actions.length}`,
    '',
  ]

  for (const kind of ACTION_ORDER) {
    const matching = review.actions.filter((a) => a.action === kind)
    if (matching.length === 0) continue
    lines.push(`## ${ACTION_HEADINGS[kind]}`, '')
    for (const action of matching) {
      lines.push(`- ${action.entityLabel}${action.detail ? ` — ${action.detail}` : ''}`)
    }
    lines.push('')
  }

  if (review.worked || review.didntWork || review.tryNext) {
    lines.push('## Reflection', '')
    lines.push(`**What worked well?**`, '', review.worked || '—', '')
    lines.push(`**What didn't work?**`, '', review.didntWork || '—', '')
    lines.push(`**What will you try next week?**`, '', review.tryNext || '—', '')
  }

  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}
