import type { PrReviewDetail, PrInsights } from '../../src/schemas/pr-review.schema'

export const makeFile = (path: string) => ({
  path,
  oldPath: undefined,
  changeType: 'modified' as const,
  additions: 10,
  deletions: 5,
  isBinary: false,
  whyHere: 'test',
  churn90d: 5,
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
  health: {
    flags: [
      { kind: 'long-function', label: 'function over 80 lines', path: 'scripts/e2e-shard.ts' },
      { kind: 'todo', label: 'New TODO/FIXME', path: 'scripts/e2e-shard.ts' },
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
  statusChecks: [],
  approvals: [],
  requestedReviewers: [],
  assigneeLogins: [],
})

export const shardingChapter = () => ({
  id: 'ch1',
  name: 'Sharding',
  status: 'not-started' as const,
  files: [makeFile('playwright.config.ts'), makeFile('scripts/e2e-shard.ts')],
})

export const buildPr = (overrides: Partial<PrReviewDetail> = {}): PrReviewDetail => ({
  ...prHeader(),
  chapters: [shardingChapter()],
  issueRefs: [],
  dryViolations: [],
  readingOrder: [],
  movedBlocks: [],
  insights: baseInsights,
  ownedPaths: [],
  ...overrides,
})

export const secondChapter = () => ({
  id: 'ch2',
  name: 'Docs',
  status: 'not-started' as const,
  files: [makeFile('docs/sharding.md'), makeFile('src/util/timing.ts')],
})
