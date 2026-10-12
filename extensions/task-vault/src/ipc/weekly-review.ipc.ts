import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { noPayload } from '@terminator/extension-sdk'
import { localRoute, registerRoutes, route, type IpcContext } from './register'
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

const listSchema = z.object({ limit: z.number().int().positive().max(500).optional() }).default({})

function start({ db }: IpcContext) {
  return startOrResumeReview(db)
}

async function log({ db }: IpcContext, args: z.infer<typeof logSchema>) {
  return { action: await logReviewAction(db, args) }
}

async function complete({ db }: IpcContext, args: z.infer<typeof completeSchema>) {
  await completeReview(db, args)
  return { ok: true }
}

async function list({ db }: IpcContext, args: z.infer<typeof listSchema>) {
  return { reviews: await listReviews(db, args.limit) }
}

async function get({ db }: IpcContext, args: z.infer<typeof idSchema>) {
  const review = await getReview(db, args.reviewId)
  if (!review) return { error: 'REVIEW_NOT_FOUND' }
  return { review }
}

/** Asks where to save a review as Markdown, then writes it there. */
async function exportReview({ api, db }: IpcContext, args: z.infer<typeof idSchema>) {
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
}

const REVIEW_ROUTES = [
  route('task-vault:review:start', noPayload, start),
  route('task-vault:review:log', logSchema, log),
  route('task-vault:review:complete', completeSchema, complete),
  route('task-vault:review:list', listSchema, list),
  route('task-vault:review:get', idSchema, get),
  localRoute('task-vault:review:export', idSchema, exportReview),
]

export function registerWeeklyReviewIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  return registerRoutes({ api, db }, REVIEW_ROUTES)
}

export type { ReviewActionKind, ReviewEntityType }
