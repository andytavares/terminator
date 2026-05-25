import { z } from 'zod'

// ─── Signal dots ─────────────────────────────────────────────────────────────

const SignalValueSchema = z.enum(['pass', 'warn', 'fail', 'unknown'])

export const SignalDotsSchema = z.object({
  tests: SignalValueSchema,
  coverage: SignalValueSchema,
  ci: SignalValueSchema,
  lint: SignalValueSchema,
  churn: SignalValueSchema,
  blast: SignalValueSchema,
})

// ─── Risk score ───────────────────────────────────────────────────────────────

export const RiskScoreSchema = z.object({
  level: z.enum(['low', 'medium', 'high']),
  composite: z.number().nullable(),
  metrics: z.object({
    changeSize: z.number().nullable(),
    churn90d: z.number().nullable(),
    blastRadius: z.number().nullable(),
    testFilePresent: z.boolean().nullable(),
    complexityDelta: z.number().nullable(),
    patchCoverage: z.number().nullable(),
  }),
  dominantDriver: z.string(),
  topImporters: z.array(z.string()),
  importerCount: z.number(),
})

// ─── File metrics (raw input to computeRiskScore) ────────────────────────────

export const FileMetricsSchema = z.object({
  path: z.string(),
  additions: z.number(),
  deletions: z.number(),
  churn90d: z.number().nullable(),
  blastRadius: z.number().nullable(),
  testFilePresent: z.boolean(),
  complexityDelta: z.number().nullable(),
  patchCoverage: z.number().nullable(),
  topImporters: z.array(z.string()),
  importerCount: z.number(),
})

// ─── Changed file ─────────────────────────────────────────────────────────────

export const PrChangedFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  changeType: z.enum(['added', 'modified', 'deleted', 'renamed']),
  additions: z.number(),
  deletions: z.number(),
  isBinary: z.boolean(),
  tier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  whyHere: z.string(),
  riskScore: RiskScoreSchema,
  estimatedMinutes: z.number(),
})

// ─── Chapter ──────────────────────────────────────────────────────────────────

export const ChapterSchema = z.object({
  id: z.string(),
  name: z.string(),
  files: z.array(PrChangedFileSchema),
  estimatedMinutes: z.number(),
  status: z.enum(['not-started', 'in-progress', 'complete']),
})

// ─── Individual status check ──────────────────────────────────────────────────

const StatusCheckStateSchema = z.enum(['pass', 'fail', 'pending', 'skipped', 'unknown'])

const StatusCheckSchema = z.object({
  name: z.string(),
  state: StatusCheckStateSchema,
  url: z.string().optional(),
})

// ─── PR review detail ─────────────────────────────────────────────────────────

export const PrReviewDetailSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  author: z.string(),
  authorAvatarUrl: z.string(),
  openedAt: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headSHA: z.string(),
  isDraft: z.boolean().default(false),
  ciStatus: z.enum(['passing', 'failing', 'pending', 'none']),
  lintStatus: SignalValueSchema.default('unknown'),
  coverageStatus: SignalValueSchema.default('unknown'),
  statusChecks: z.array(StatusCheckSchema).default([]),
  chapters: z.array(ChapterSchema),
})

// ─── Review queue PR (lightweight summary) ────────────────────────────────────

export const ReviewQueuePRSchema = z.object({
  number: z.number(),
  title: z.string(),
  author: z.string(),
  authorAvatarUrl: z.string(),
  openedAt: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  isDraft: z.boolean(),
  ciStatus: z.enum(['passing', 'failing', 'pending', 'none']),
  fileCount: z.number(),
  additions: z.number(),
  deletions: z.number(),
  estimatedMinutes: z.number(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  signalDots: SignalDotsSchema,
  sessionStatus: z.enum(['not-started', 'in-progress', 'paused']),
  viewedFileCount: z.number().default(0),
  resumeChapter: z.number().optional(),
  resumeChapterTotal: z.number().optional(),
})

// ─── PR issue (conversation) comments ────────────────────────────────────────

export const IssueCommentSchema = z.object({
  id: z.number(),
  author: z.string(),
  authorAvatarUrl: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// ─── Inline comments ─────────────────────────────────────────────────────────

export const InlineCommentSchema = z.object({
  id: z.number(),
  author: z.string(),
  authorAvatarUrl: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  path: z.string(),
  line: z.number(),
  startLine: z.number().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  diffHunk: z.string(),
  outdated: z.boolean(),
  threadId: z.string(),
  isReply: z.boolean(),
  parentId: z.number().nullable(),
})

export const ThreadSchema = z.object({
  id: z.string(),
  path: z.string(),
  line: z.number(),
  startLine: z.number().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  outdated: z.boolean(),
  comments: z.array(InlineCommentSchema),
  collapsed: z.boolean(),
})

// ─── Review session (persisted to electron-store) ────────────────────────────
// viewedFiles is serialised as string[] to survive JSON round-trip;
// the store converts it to/from Set<string>.

export const ReviewSessionSchema = z.object({
  repoRoot: z.string(),
  prNumber: z.number(),
  headSHA: z.string(),
  currentChapterId: z.string().nullable(),
  currentFilePath: z.string().nullable(),
  viewedFiles: z.array(z.string()),
  fileOrderOverrides: z.record(z.string(), z.array(z.string())),
  scrollPosition: z.number().nullable(),
  pausedAt: z.string().nullable(),
  lastAccessedAt: z.string(),
})

// ─── Type exports ─────────────────────────────────────────────────────────────

export type SignalValue = z.infer<typeof SignalValueSchema>
export type SignalDots = z.infer<typeof SignalDotsSchema>
export type RiskScore = z.infer<typeof RiskScoreSchema>
export type FileMetrics = z.infer<typeof FileMetricsSchema>
export type PrChangedFile = z.infer<typeof PrChangedFileSchema>
export type Chapter = z.infer<typeof ChapterSchema>
export type PrReviewDetail = z.infer<typeof PrReviewDetailSchema>
export type ReviewQueuePR = z.infer<typeof ReviewQueuePRSchema>
export type StatusCheck = z.infer<typeof StatusCheckSchema>
export type IssueComment = z.infer<typeof IssueCommentSchema>
export type InlineComment = z.infer<typeof InlineCommentSchema>
export type Thread = z.infer<typeof ThreadSchema>
export type ReviewSession = z.infer<typeof ReviewSessionSchema>
