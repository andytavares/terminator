import { z } from 'zod'

export const ResolutionStrategySchema = z.enum([
  'ours',
  'theirs',
  'both-ours-first',
  'both-theirs-first',
  'manual',
])

export const GitAuthorSchema = z.object({
  name: z.string().min(1),
  commitHash: z.string().min(1),
  timestamp: z.string().min(1),
})

export const ConflictBlockSchema = z.object({
  blockId: z.string().min(1),
  index: z.number().int().min(0),
  oursText: z.string(),
  theirsText: z.string(),
  baseText: z.string(),
  contextBefore: z.array(z.string()),
  contextAfter: z.array(z.string()),
  originalConflictText: z.string(),
  isResolved: z.boolean(),
  resolvedText: z.string().optional(),
  strategy: ResolutionStrategySchema.optional(),
})

export const ConflictFileSchema = z.object({
  filePath: z.string().min(1),
  conflictCount: z.number().int().min(0),
  resolvedCount: z.number().int().min(0),
  blocks: z.array(ConflictBlockSchema),
  oursAuthor: GitAuthorSchema,
  theirsAuthor: GitAuthorSchema,
  conflictDescription: z.string(),
})

export const ConflictSessionSchema = z.object({
  repoRoot: z.string().min(1),
  files: z.array(ConflictFileSchema),
  totalConflicts: z.number().int().min(0),
  totalResolved: z.number().int().min(0),
  isRebase: z.boolean(),
  startedAt: z.string().min(1),
  oursBranch: z.string().optional(),
  theirsBranch: z.string().optional(),
})

export const ConflictResolutionSchema = z.object({
  blockId: z.string().min(1),
  resolvedText: z.string(),
  strategy: ResolutionStrategySchema,
})

export const ResolutionDecisionSchema = z.object({
  blockId: z.string().min(1),
  resolvedText: z.string(),
  strategy: ResolutionStrategySchema,
  originalConflictText: z.string(),
  decidedAt: z.string().min(1),
})

export type ResolutionStrategy = z.infer<typeof ResolutionStrategySchema>
export type GitAuthor = z.infer<typeof GitAuthorSchema>
export type ConflictBlock = z.infer<typeof ConflictBlockSchema>
export type ConflictFile = z.infer<typeof ConflictFileSchema>
export type ConflictSession = z.infer<typeof ConflictSessionSchema>
export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>
export type ResolutionDecision = z.infer<typeof ResolutionDecisionSchema>
