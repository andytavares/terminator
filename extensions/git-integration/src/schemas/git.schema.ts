import { z } from 'zod'

export const FileStatusSchema = z.enum([
  'modified',
  'added',
  'deleted',
  'renamed',
  'untracked',
  'conflicted',
  'ignored',
])

export const GitFileStatusSchema = z.object({
  path: z.string().min(1),
  originalPath: z.string().optional(),
  status: FileStatusSchema,
  staged: z.boolean(),
  isBinary: z.boolean().default(false),
})

export const GitStatusSchema = z.object({
  branch: z.string(),
  files: z.array(GitFileStatusSchema),
  hasConflicts: z.boolean(),
  truncated: z.boolean().default(false),
})

export const DiffLineSchema = z.object({
  type: z.enum(['add', 'remove', 'context']),
  content: z.string(),
  oldLineNumber: z.number().nullable(),
  newLineNumber: z.number().nullable(),
})

export const DiffHunkSchema = z.object({
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

export const CommitPayloadSchema = z.object({
  repoRoot: z.string().min(1),
  message: z.string().min(1),
  signOff: z.boolean().default(false),
})

export const PullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  url: z.string().url(),
  state: z.enum(['open', 'closed', 'merged']),
  isDraft: z.boolean(),
  baseRefName: z.string(),
  headRefName: z.string(),
})

export const PrCreatePayloadSchema = z.object({
  repoRoot: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  base: z.string().min(1),
  isDraft: z.boolean().default(false),
})

export type FileStatus = z.infer<typeof FileStatusSchema>
export type GitFileStatus = z.infer<typeof GitFileStatusSchema>
export type GitStatus = z.infer<typeof GitStatusSchema>
export type DiffLine = z.infer<typeof DiffLineSchema>
export type DiffHunk = z.infer<typeof DiffHunkSchema>
export type FileDiff = z.infer<typeof FileDiffSchema>
export type CommitPayload = z.infer<typeof CommitPayloadSchema>
export type PullRequest = z.infer<typeof PullRequestSchema>
export type PrCreatePayload = z.infer<typeof PrCreatePayloadSchema>
