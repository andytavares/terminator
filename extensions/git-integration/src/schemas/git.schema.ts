import { z } from 'zod'

type FileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'
  | 'ignored'

export interface GitFileStatus {
  path: string
  originalPath?: string
  status: FileStatus
  staged: boolean
  isBinary: boolean
}

const DiffLineSchema = z.object({
  type: z.enum(['add', 'remove', 'context']),
  content: z.string(),
  oldLineNumber: z.number().nullable(),
  newLineNumber: z.number().nullable(),
})

const DiffHunkSchema = z.object({
  header: z.string(),
  lines: z.array(DiffLineSchema),
})

export const FileDiffSchema = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  hunks: z.array(DiffHunkSchema),
  isBinary: z.boolean(),
  truncated: z.boolean().default(false),
})

export interface GitStatus {
  branch: string
  files: GitFileStatus[]
  hasConflicts: boolean
  truncated: boolean
}
export type DiffLine = z.infer<typeof DiffLineSchema>
export type DiffHunk = z.infer<typeof DiffHunkSchema>
export type FileDiff = z.infer<typeof FileDiffSchema>
export interface PullRequest {
  number: number
  title: string
  body: string
  url: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  baseRefName: string
  headRefName: string
}
