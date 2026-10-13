import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { noPayload } from '@terminator/extension-sdk'
import { createIpcRegistrar, errorResult } from './register'
import {
  completeReview,
  formatReviewMarkdown,
  getReview,
  listReviews,
  logReviewAction,
  startOrResumeReview,
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

const listSchema = z.object({ limit: z.number().int().positive().max(500).optional() }).default({})

export function registerWeeklyReviewIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handle, handleRemote, cleanup } = createIpcRegistrar(api, errorResult)

  handleRemote('task-vault:review:start', noPayload, async () => {
    return await startOrResumeReview(db)
  })

  handleRemote('task-vault:review:log', logSchema, async (args) => {
    return { action: await logReviewAction(db, args) }
  })

  handleRemote('task-vault:review:complete', completeSchema, async (args) => {
    await completeReview(db, args)
    return { ok: true }
  })

  handleRemote('task-vault:review:list', listSchema, async ({ limit }) => {
    return { reviews: await listReviews(db, limit) }
  })

  handleRemote('task-vault:review:get', idSchema, async (args) => {
    const review = await getReview(db, args.reviewId)
    if (!review) return { error: 'REVIEW_NOT_FOUND' }
    return { review }
  })

  handle('task-vault:review:export', idSchema, async (args) => {
    const review = await getReview(db, args.reviewId)
    if (!review) return { error: 'REVIEW_NOT_FOUND' }

    const result = await api.dialog.showSaveDialog({
      title: 'Export weekly review',
      defaultPath: `weekly-review-${review.startedAt.slice(0, 10)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }

    fs.mkdirSync(path.dirname(result.filePath), { recursive: true })
    fs.writeFileSync(result.filePath, formatReviewMarkdown(review), 'utf8')
    return { filePath: result.filePath }
  })

  return cleanup
}
