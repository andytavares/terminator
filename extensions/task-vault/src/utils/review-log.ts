// Thin renderer-side helper for recording what a weekly review did.
//
// Logging is deliberately best-effort: a failed log line must never block the
// user from promoting, archiving, or deleting during the review itself.

export type ReviewActionKind =
  | 'captured'
  | 'inbox-processed'
  | 'project-status'
  | 'task-promoted'
  | 'task-backlogged'
  | 'task-archived'
  | 'task-deleted'
  | 'task-kept'

export interface ReviewActionInput {
  step: number
  action: ReviewActionKind
  entityType: 'task' | 'project'
  entityId?: string | null
  entityLabel: string
  detail?: string | null
}

export function logReviewAction(reviewId: string | null, input: ReviewActionInput): void {
  if (!reviewId) return
  void window.electronAPI.extensionBridge
    .invoke('task-vault:review:log', { reviewId, ...input })
    .catch((err) => console.error('[task-vault] failed to record review action', err))
}
