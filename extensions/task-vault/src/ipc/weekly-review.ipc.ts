import { dialog } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { ExtensionAPI, ExtensionDB } from '../../../../src/main/extensions/api'
import { createIpcRegistrar } from './register'
import {
  completeReview,
  formatReviewMarkdown,
  getReview,
  listReviews,
  logReviewAction,
  startOrResumeReview,
  type ReviewActionKind,
  type ReviewEntityType,
} from '../vault/weekly-review-repository'

const ACTION_KINDS = [
  'captured',
  'inbox-processed',
  'project-status',
  'task-promoted',
  'task-backlogged',
  'task-archived',
  'task-deleted',
  'task-kept',
] as const

const logSchema = z.object({
  reviewId: z.string().min(1),
  step: z.number().int().min(1).max(6),
  action: z.enum(ACTION_KINDS),
  entityType: z.enum(['task', 'project']),
  entityId: z.string().nullable().optional(),
  entityLabel: z.string(),
  detail: z.string().nullable().optional(),
})

const completeSchema = z.object({
  reviewId: z.string().min(1),
  worked: z.string().optional(),
  didntWork: z.string().optional(),
  tryNext: z.string().optional(),
})

const idSchema = z.object({ reviewId: z.string().min(1) })

const listSchema = z.object({ limit: z.number().int().positive().max(500).optional() })

export function registerWeeklyReviewIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const registrar = createIpcRegistrar(api)

  function handle(channel: string, fn: (payload: unknown) => Promise<unknown>) {
    registrar.handle(channel, async (payload) => {
      try {
        return await fn(payload)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })
  }

  handle('task-vault:review:start', async () => {
    return await startOrResumeReview(db)
  })

  handle('task-vault:review:log', async (payload) => {
    const parsed = logSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    return { action: await logReviewAction(db, parsed.data) }
  })

  handle('task-vault:review:complete', async (payload) => {
    const parsed = completeSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    await completeReview(db, parsed.data)
    return { ok: true }
  })

  handle('task-vault:review:list', async (payload) => {
    const parsed = listSchema.safeParse(payload ?? {})
    const limit = parsed.success ? parsed.data.limit : undefined
    return { reviews: await listReviews(db, limit) }
  })

  handle('task-vault:review:get', async (payload) => {
    const parsed = idSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const review = await getReview(db, parsed.data.reviewId)
    if (!review) return { error: 'REVIEW_NOT_FOUND' }
    return { review }
  })

  handle('task-vault:review:export', async (payload) => {
    const parsed = idSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const review = await getReview(db, parsed.data.reviewId)
    if (!review) return { error: 'REVIEW_NOT_FOUND' }

    const result = await dialog.showSaveDialog({
      title: 'Export weekly review',
      defaultPath: `weekly-review-${review.startedAt.slice(0, 10)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }

    fs.mkdirSync(path.dirname(result.filePath), { recursive: true })
    fs.writeFileSync(result.filePath, formatReviewMarkdown(review), 'utf8')
    return { filePath: result.filePath }
  })

  return registrar.cleanup
}

export type { ReviewActionKind, ReviewEntityType }
