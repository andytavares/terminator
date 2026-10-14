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

/** Which review, and which of its steps, an action belongs to. */
export interface ReviewStep {
  reviewId: string | null
  step: number
}

/** The project fields a review records. */
export interface ReviewedProject {
  id: string
  name: string
  filePath: string
}

/** Sets a project's status during a review and records it on the review. */
export async function setProjectStatusInReview(
  at: ReviewStep,
  project: ReviewedProject,
  status: string
): Promise<void> {
  await window.electronAPI.extensionBridge.invoke('task-vault:vault:update-project-status', {
    projectFilePath: project.filePath,
    status,
  })
  logReviewAction(at.reviewId, {
    step: at.step,
    action: 'project-status',
    entityType: 'project',
    entityId: project.id,
    entityLabel: project.name,
    detail: status,
  })
}
