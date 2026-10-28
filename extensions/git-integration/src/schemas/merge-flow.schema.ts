import { z } from 'zod'

export const ResolutionStrategySchema = z.enum([
  'ours',
  'theirs',
  'both-ours-first',
  'both-theirs-first',
  'manual',
])

export type ResolutionStrategy = z.infer<typeof ResolutionStrategySchema>
export interface GitAuthor {
  name: string
  commitHash: string
  timestamp: string
}
export interface ConflictBlock {
  blockId: string
  index: number
  oursText: string
  theirsText: string
  baseText: string
  contextBefore: string[]
  contextAfter: string[]
  originalConflictText: string
  isResolved: boolean
  resolvedText?: string
  strategy?: ResolutionStrategy
}
export interface ConflictFile {
  filePath: string
  conflictCount: number
  resolvedCount: number
  blocks: ConflictBlock[]
  oursAuthor: GitAuthor
  theirsAuthor: GitAuthor
  conflictDescription: string
}
export interface ConflictSession {
  repoRoot: string
  files: ConflictFile[]
  totalConflicts: number
  totalResolved: number
  isRebase: boolean
  startedAt: string
  oursBranch?: string
  theirsBranch?: string
}
export interface ConflictResolution {
  blockId: string
  resolvedText: string
  strategy: ResolutionStrategy
}
export interface ResolutionDecision extends ConflictResolution {
  originalConflictText: string
  decidedAt: string
}
