import { z } from 'zod'
import { TrackerIdSchema } from './integrations.schema.js'

// What an extension publishes for Home to draw (ADR 117). Mirrors HomeFeed in
// packages/extension-sdk/types/api.d.ts.

export const WorkKeySchema = z.union([
  z.object({ tracker: TrackerIdSchema, key: z.string().min(1) }),
  z.object({ repoRoot: z.string().min(1), branch: z.string().min(1) }),
])

export const HomeAskSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['answer', 'fix', 'review', 'decide', 'finished', 'task']),
  title: z.string(),
  detail: z.string(),
  /** Where it comes from, e.g. "terminator · TAV-20 · pull request #275". */
  where: z.string().optional(),
  facts: z.array(z.string()),
  workKey: WorkKeySchema.nullable(),
  since: z.string(),
  actions: z.array(
    z.object({ id: z.string().min(1), label: z.string(), primary: z.boolean().optional() })
  ),
  open: z.object({ command: z.string().min(1), args: z.unknown().optional() }),
})

export const ThreadFacetSchema = z.object({
  workKey: WorkKeySchema,
  kind: z.enum(['pull-request', 'order', 'task']),
  stage: z.enum(['shaping', 'building', 'in-review', 'merging', 'shipped']),
  whoseMove: z.enum(['you', 'agents', 'others']),
  title: z.string().optional(),
  line: z.string(),
  tone: z.enum(['neutral', 'good', 'bad', 'waiting']),
  url: z.string().optional(),
  closedAt: z.string().nullable(),
  checks: z
    .array(
      z.object({
        name: z.string(),
        state: z.enum(['passed', 'failed', 'running']),
        detail: z.string().optional(),
      })
    )
    .optional(),
  /** What a merged pull request's timeline measured (ISO times; minutes for checks). */
  openedAt: z.string().optional(),
  readyAt: z.string().optional(),
  firstReviewAt: z.string().nullable().optional(),
  checksMinutes: z.number().nullable().optional(),
  updatedAt: z.string(),
})

export const HomeMeasureSchema = z.object({
  id: z.string().min(1),
  question: z.string(),
  value: z.number(),
  unit: z.enum(['count', 'minutes', 'days', 'percent']),
  window: z.enum(['week', '30d', 'quarter', 'year']),
  series: z.array(z.number()),
  previous: z.number().optional(),
  detail: z.string().optional(),
})

export const HomeFocusCandidateSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  detail: z.string().optional(),
  workKey: WorkKeySchema.nullable(),
  done: z.boolean(),
})

export const HomeFeedSchema = z.object({
  asks: z.array(HomeAskSchema),
  facets: z.array(ThreadFacetSchema),
  measures: z.array(HomeMeasureSchema),
  focus: z.array(HomeFocusCandidateSchema).optional(),
})

export const HomeFeedActionInputSchema = z.object({
  source: z.string().min(1),
  itemId: z.string().min(1),
  actionId: z.string().min(1),
})

export type WorkKey = z.infer<typeof WorkKeySchema>
export type HomeAsk = z.infer<typeof HomeAskSchema>
export type ThreadFacet = z.infer<typeof ThreadFacetSchema>
export type HomeMeasure = z.infer<typeof HomeMeasureSchema>
export type HomeFocusCandidate = z.infer<typeof HomeFocusCandidateSchema>
export type HomeFeed = z.infer<typeof HomeFeedSchema>

/** Every extension's feed together, each item tagged with the extension that published it. */
export type Sourced<Item> = Item & { source: string }
export interface MergedHomeFeed {
  asks: Sourced<HomeAsk>[]
  facets: Sourced<ThreadFacet>[]
  measures: Sourced<HomeMeasure>[]
  focus: Sourced<HomeFocusCandidate>[]
}
