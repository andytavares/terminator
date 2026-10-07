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

// ─── PR approval ─────────────────────────────────────────────────────────────

export const PrApprovalSchema = z.object({
  author: z.string(),
  authorAvatarUrl: z.string(),
  submittedAt: z.string(),
})

// ─── Issue references ─────────────────────────────────────────────────────────

export const IssueRefSchema = z.object({
  type: z.enum(['github', 'linear', 'jira']),
  ref: z.string(),
  url: z.string().optional(),
  /**
   * Filled in from the application's tracker connection when there is one
   * (ExtensionAPI v2.2.0). A bare key tells a reviewer nothing; the title and
   * state are the reason the reference is worth showing at all.
   */
  title: z.string().optional(),
  state: z.string().optional(),
})

// ─── DRY violations ───────────────────────────────────────────────────────────

export const DryViolationSchema = z.object({
  files: z.array(z.string()),
  fingerprint: z.string(),
  lineCount: z.number(),
})

// ─── Reading order (R3) ─────────────────────────────────────────────────────────

export const SymbolUseSchema = z.object({
  symbol: z.string(),
  /** 1-based step that defines it, when a file in this PR defines it. */
  definedInStep: z.number().nullable(),
  definedInPath: z.string().nullable(),
})

export const ReadingStepSchema = z.object({
  step: z.number(),
  path: z.string(),
  /** The main symbol this step changes, shown after the file name. */
  symbol: z.string().nullable(),
  /** One line saying why it sits here, e.g. "Uses RiskScore (step 1)". */
  reason: z.string(),
  uses: z.array(SymbolUseSchema),
})

// ─── Moved blocks (S4) ────────────────────────────────────────────────────────

export const MovedBlockSchema = z.object({
  fromPath: z.string(),
  fromLine: z.number(),
  toPath: z.string(),
  toLine: z.number(),
  lineCount: z.number(),
  symbol: z.string().nullable(),
})

// ─── Insights (R4) ────────────────────────────────────────────────────────────

export const InsightSourceSchema = z.string()

export const FunctionComplexitySchema = z.object({
  path: z.string(),
  name: z.string(),
  /** New-side line of the function's declaration, when it is in the diff. */
  line: z.number().nullable(),
  branchDelta: z.number(),
})

export const PrInsightsSchema = z.object({
  complexity: z.object({
    branchDelta: z.number(),
    functions: z.array(FunctionComplexitySchema),
    source: InsightSourceSchema,
  }),
  coverage: z.object({
    /**
     * The primary question is "does this changed block have a test", not a
     * percentage: a changed function counts as tested when a test file (in the
     * PR or already in the repo) references it.
     */
    changedFunctions: z.number(),
    testedFunctions: z.number(),
    untestedFunctions: z.array(z.string()),
    /** Percent of new lines covered, from CI, when CI publishes it. Secondary. */
    patchPercent: z.number().nullable(),
    source: InsightSourceSchema,
    changedSourceFiles: z.number(),
    changedSourceFilesWithTests: z.number(),
  }),
  health: z.object({
    flags: z.array(z.object({ kind: z.string(), label: z.string(), path: z.string() })),
    source: InsightSourceSchema,
  }),
  understandability: z.object({
    level: z.enum(['easy', 'moderate', 'hard']),
    linesToRead: z.number(),
    newExports: z.number(),
    longestChain: z.number(),
    crossChapterRefs: z.number(),
    source: InsightSourceSchema,
  }),
})

// ─── PR review detail ─────────────────────────────────────────────────────────

export const PrReviewDetailSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  author: z.string(),
  authorAvatarUrl: z.string(),
  openedAt: z.string(),
  state: z.enum(['open', 'closed', 'merged']).default('open'),
  headRefName: z.string(),
  baseRefName: z.string(),
  headSHA: z.string(),
  /** GraphQL node id; lets viewed-file mutations skip the lookup. */
  nodeId: z.string().optional(),
  isDraft: z.boolean().default(false),
  mergeStateStatus: z.enum(['behind', 'dirty', 'clean', 'unknown']).default('unknown'),
  ciStatus: z.enum(['passing', 'failing', 'pending', 'none']),
  lintStatus: SignalValueSchema.default('unknown'),
  coverageStatus: SignalValueSchema.default('unknown'),
  statusChecks: z.array(StatusCheckSchema).default([]),
  approvals: z.array(PrApprovalSchema).default([]),
  requestedReviewers: z.array(z.string()).default([]),
  assigneeLogins: z.array(z.string()).default([]),
  chapters: z.array(ChapterSchema),
  issueRefs: z.array(IssueRefSchema).default([]),
  dryViolations: z.array(DryViolationSchema).default([]),
  readingOrder: z.array(ReadingStepSchema).default([]),
  movedBlocks: z.array(MovedBlockSchema).default([]),
  insights: PrInsightsSchema.nullable().default(null),
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
  approvalCount: z.number().default(0),
  approvedBy: z.array(z.string()).default([]),
  requestedReviewers: z.array(z.string()).default([]),
  assigneeLogins: z.array(z.string()).default([]),
  resumeChapter: z.number().optional(),
  resumeChapterTotal: z.number().optional(),
  mergeStateStatus: z.enum(['behind', 'dirty', 'clean', 'unknown']).default('unknown'),
})

// ─── Review dashboard (R1) ─────────────────────────────────────────────────────

export const DashboardSectionSchema = z.enum(['re-review', 'requested', 'team', 'mine', 'involved'])

export const DashboardPRSchema = z.object({
  /** owner/name */
  repo: z.string(),
  /** Local checkout whose origin is this repo, when there is one. */
  localRepoRoot: z.string().nullable(),
  section: DashboardSectionSchema,
  number: z.number(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  isDraft: z.boolean(),
  createdAt: z.string(),
  additions: z.number(),
  deletions: z.number(),
  fileCount: z.number(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  estimatedMinutes: z.number(),
  ciStatus: z.enum(['passing', 'failing', 'pending', 'none']),
  reviewDecision: z.enum(['approved', 'changes-requested', 'review-required', 'none']),
  unresolvedThreads: z.number(),
  /** Re-review only: commits after your latest review. */
  commitsSinceMyReview: z.number(),
  reviewerCount: z.number(),
  sessionStatus: z.enum(['not-started', 'in-progress', 'paused']).default('not-started'),
  viewedFileCount: z.number().default(0),
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
  resolved: z.boolean().default(false),
})

// ─── Notes and draft comments (S2, S5) ─────────────────────────────────────────

export const ReviewNoteSchema = z.object({
  id: z.string(),
  path: z.string(),
  line: z.number(),
  side: z.enum(['LEFT', 'RIGHT']).default('RIGHT'),
  body: z.string(),
  createdAt: z.string(),
})

export const DraftCommentSchema = z.object({
  id: z.string(),
  path: z.string(),
  line: z.number(),
  startLine: z.number().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  body: z.string(),
  /** Set when the draft started from an agent finding. */
  fromFindingId: z.string().nullable().default(null),
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
  /** v2: head SHA each file was marked viewed at (S1). */
  viewedAt: z.record(z.string(), z.string()).default({}),
  /** v2: private notes (S2). A note containing "??" is a question. */
  notes: z.array(ReviewNoteSchema).default([]),
  /** v2: draft comments, sent together on submit (S5). */
  drafts: z.array(DraftCommentSchema).default([]),
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
export type PrApproval = z.infer<typeof PrApprovalSchema>
export type IssueComment = z.infer<typeof IssueCommentSchema>
export type InlineComment = z.infer<typeof InlineCommentSchema>
export type Thread = z.infer<typeof ThreadSchema>
export type ReviewSession = z.infer<typeof ReviewSessionSchema>
export type IssueRef = z.infer<typeof IssueRefSchema>
export type DryViolation = z.infer<typeof DryViolationSchema>
export type SymbolUse = z.infer<typeof SymbolUseSchema>
export type ReadingStep = z.infer<typeof ReadingStepSchema>
export type MovedBlock = z.infer<typeof MovedBlockSchema>
export type FunctionComplexity = z.infer<typeof FunctionComplexitySchema>
export type PrInsights = z.infer<typeof PrInsightsSchema>
export type DashboardSection = z.infer<typeof DashboardSectionSchema>
export type DashboardPR = z.infer<typeof DashboardPRSchema>
export type ReviewNote = z.infer<typeof ReviewNoteSchema>
export type DraftComment = z.infer<typeof DraftCommentSchema>
