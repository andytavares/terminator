import { z } from 'zod'

const FileStatusSchema = z.enum([
  'modified',
  'added',
  'deleted',
  'renamed',
  'untracked',
  'conflicted',
  'ignored',
])

const GitFileStatusSchema = z.object({
  path: z.string().min(1),
  originalPath: z.string().optional(),
  status: FileStatusSchema,
  staged: z.boolean(),
  isBinary: z.boolean().default(false),
})

const GitStatusSchema = z.object({
  branch: z.string(),
  files: z.array(GitFileStatusSchema),
  hasConflicts: z.boolean(),
  truncated: z.boolean().default(false),
})

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

const PullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  url: z.string().url(),
  state: z.enum(['open', 'closed', 'merged']),
  isDraft: z.boolean(),
  baseRefName: z.string(),
  headRefName: z.string(),
})

export type GitFileStatus = z.infer<typeof GitFileStatusSchema>
export type GitStatus = z.infer<typeof GitStatusSchema>
export type DiffLine = z.infer<typeof DiffLineSchema>
export type DiffHunk = z.infer<typeof DiffHunkSchema>
export type FileDiff = z.infer<typeof FileDiffSchema>
export type PullRequest = z.infer<typeof PullRequestSchema>
