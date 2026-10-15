import type { PrReviewDetail, PrInsights } from '../../src/schemas/pr-review.schema'

interface Risk {
  level: 'low' | 'medium' | 'high'
  composite: number | null
  dominantDriver: string
}

const insightRiskScore = ({ level, composite, dominantDriver }: Risk) => ({
  level,
  composite,
  metrics: {
    changeSize: 15,
    churn90d: 5,
    blastRadius: 2,
    testFilePresent: true,
    complexityDelta: 0,
    patchCoverage: null,
  },
  dominantDriver,
  topImporters: [],
  importerCount: 0,
})

export const makeFile = (path: string, risk: Risk, estimatedMinutes = 6) => ({
  path,
  oldPath: undefined,
  changeType: 'modified' as const,
  additions: 10,
  deletions: 5,
  isBinary: false,
  tier: 1 as const,
  whyHere: 'test',
  riskScore: insightRiskScore(risk),
  estimatedMinutes,
})

export const baseInsights: PrInsights = {
  complexity: {
    branchDelta: 23,
    functions: [
      { path: 'scripts/e2e-shard.ts', name: 'selectSpecs', line: 12, branchDelta: 9 },
      { path: 'scripts/e2e-shard.ts', name: 'shardByDuration', line: 44, branchDelta: 6 },
      { path: 'scripts/e2e-shard.ts', name: 'loadTimings', line: 80, branchDelta: 4 },
      { path: 'scripts/e2e-shard.ts', name: 'readBurnIn', line: 100, branchDelta: 2 },
      { path: 'playwright.config.ts', name: 'defineShards', line: 20, branchDelta: 1 },
      { path: 'playwright.config.ts', name: 'buildConfig', line: 5, branchDelta: 1 },
    ],
    source: 'tree-sitter · base vs head',
  },
  coverage: {
    changedFunctions: 7,
    testedFunctions: 5,
    untestedFunctions: ['shardByDuration', 'readBurnIn'],
    patchPercent: 84,
    source: 'CI check codecov/patch',
    changedSourceFiles: 5,
    changedSourceFilesWithTests: 4,
  },
  health: {
    flags: [
      { kind: 'long-function', label: 'function over 80 lines', path: 'scripts/e2e-shard.ts' },
      { kind: 'eslint-disable', label: 'new eslint-disable', path: 'scripts/e2e-shard.ts' },
      {
        kind: 'duplicate',
        label: 'block duplicated in 2 files',
        path: 'scripts/e2e-shard.ts',
      },
    ],
    source: 'tree-sitter · detectDryViolations',
  },
  understandability: {
    level: 'moderate',
    linesToRead: 1120,
    newExports: 9,
    longestChain: 4,
    crossChapterRefs: 2,
    source: 'reading-order graph',
  },
}

const prHeader = () => ({
  number: 211,
  title: 'Shard e2e specs by duration',
  body: '',
  author: 'alice',
  authorAvatarUrl: '',
  openedAt: new Date().toISOString(),
  headRefName: 'feature/e2e-sharding',
  baseRefName: 'main',
  headSHA: 'abc123',
  isDraft: false,
  mergeStateStatus: 'clean' as const,
  ciStatus: 'passing' as const,
  lintStatus: 'pass' as const,
  coverageStatus: 'pass' as const,
  statusChecks: [],
  approvals: [],
  requestedReviewers: [],
  assigneeLogins: [],
})

export const shardingChapter = () => ({
  id: 'ch1',
  name: 'Sharding',
  estimatedMinutes: 18,
  status: 'not-started' as const,
  files: [
    makeFile(
      'playwright.config.ts',
      { level: 'high', composite: 78, dominantDriver: 'Wide blast radius — 41 importers' },
      12
    ),
    makeFile(
      'scripts/e2e-shard.ts',
      { level: 'medium', composite: 50, dominantDriver: 'High churn — 14 commits/90d' },
      6
    ),
  ],
})

export const buildPr = (overrides: Partial<PrReviewDetail> = {}): PrReviewDetail => ({
  ...prHeader(),
  chapters: [shardingChapter()],
  issueRefs: [],
  dryViolations: [],
  readingOrder: [],
  movedBlocks: [],
  insights: baseInsights,
  ...overrides,
})

export const secondChapter = () => ({
  id: 'ch2',
  name: 'Docs',
  estimatedMinutes: 5,
  status: 'not-started' as const,
  files: [
    makeFile('docs/sharding.md', { level: 'low', composite: 8, dominantDriver: 'Small change' }, 3),
    makeFile('src/util/timing.ts', { level: 'low', composite: 12, dominantDriver: 'Small' }, 4),
  ],
})
