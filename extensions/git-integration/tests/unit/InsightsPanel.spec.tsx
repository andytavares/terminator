import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InsightsPanel } from '../../src/components/pr-review/InsightsPanel'
import type { PrReviewDetail, PrInsights } from '../../src/schemas/pr-review.schema'

const makeFile = (
  path: string,
  level: 'low' | 'medium' | 'high',
  composite: number | null,
  dominantDriver: string,
  estimatedMinutes = 6
) => ({
  path,
  oldPath: undefined,
  changeType: 'modified' as const,
  additions: 10,
  deletions: 5,
  isBinary: false,
  tier: 1 as const,
  whyHere: 'test',
  riskScore: {
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
  },
  estimatedMinutes,
})

const baseInsights: PrInsights = {
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

const buildPr = (overrides: Partial<PrReviewDetail> = {}): PrReviewDetail => ({
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
  mergeStateStatus: 'clean',
  ciStatus: 'passing',
  lintStatus: 'pass',
  coverageStatus: 'pass',
  statusChecks: [],
  approvals: [],
  requestedReviewers: [],
  assigneeLogins: [],
  chapters: [
    {
      id: 'ch1',
      name: 'Sharding',
      estimatedMinutes: 18,
      status: 'not-started',
      files: [
        makeFile('playwright.config.ts', 'high', 78, 'Wide blast radius — 41 importers', 12),
        makeFile('scripts/e2e-shard.ts', 'medium', 50, 'High churn — 14 commits/90d', 6),
      ],
    },
  ],
  issueRefs: [],
  dryViolations: [],
  readingOrder: [],
  movedBlocks: [],
  insights: baseInsights,
  ...overrides,
})

describe('InsightsPanel', () => {
  it('puts risk, time and size on one header line', () => {
    render(<InsightsPanel pr={buildPr()} />)
    expect(screen.getByText('What to look at')).toBeTruthy()
    expect(screen.getByText('High risk')).toBeTruthy()
    expect(screen.getByText(/about 18 min · 2 files, \+20 −10/)).toBeTruthy()
  })

  it('has no per-row bars and no provenance text', () => {
    const { container } = render(<InsightsPanel pr={buildPr()} />)
    expect(container.querySelector('.ib-meter')).toBeNull()
    expect(container.querySelector('.ib-src')).toBeNull()
    expect(screen.queryByText('tree-sitter · base vs head')).toBeNull()
  })

  it('carries provenance as the row tooltip', () => {
    render(<InsightsPanel pr={buildPr()} />)
    expect(screen.getByTitle('tree-sitter · base vs head')).toBeTruthy()
    expect(screen.getByTitle('CI check codecov/patch')).toBeTruthy()
    expect(screen.getByTitle('computeRiskScore · git log, git grep')).toBeTruthy()
  })

  it('renders the complexity sentence with signed value and top-3 functions', () => {
    render(<InsightsPanel pr={buildPr()} />)
    const text = screen.getByText(/\+23 branches\./)
    expect(text.textContent).toContain('Up in 6 functions. Largest:')
    expect(text.textContent).toContain('selectSpecs +9')
    expect(text.textContent).toContain('shardByDuration +6')
    expect(text.textContent).toContain('loadTimings +4')
    expect(text.textContent).not.toContain('readBurnIn')
  })

  it('renders "No change" when branch delta is zero', () => {
    const pr = buildPr({
      insights: {
        ...baseInsights,
        complexity: { branchDelta: 0, functions: [], source: 'tree-sitter · base vs head' },
      },
    })
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('No change. No function gained branches.')).toBeTruthy()
  })

  it('describes test files, not functions, when no function changed', () => {
    const pr = buildPr({
      insights: {
        ...baseInsights,
        coverage: {
          ...baseInsights.coverage,
          changedFunctions: 0,
          testedFunctions: 0,
          untestedFunctions: [],
          patchPercent: null,
          changedSourceFiles: 3,
          changedSourceFilesWithTests: 1,
        },
      },
    })
    render(<InsightsPanel pr={pr} />)
    expect(
      screen.getByText(
        'No functions changed. 1 of 3 changed source files have a changed test beside them.'
      )
    ).toBeTruthy()
  })

  it('says no source files changed for a config-only PR', () => {
    const pr = buildPr({
      insights: {
        ...baseInsights,
        coverage: {
          ...baseInsights.coverage,
          changedFunctions: 0,
          testedFunctions: 0,
          untestedFunctions: [],
          patchPercent: null,
          changedSourceFiles: 0,
          changedSourceFilesWithTests: 0,
        },
      },
    })
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('No functions changed. No source files changed.')).toBeTruthy()
  })

  it('uses a singular verb for one untested function', () => {
    const pr = buildPr({
      insights: {
        ...baseInsights,
        coverage: { ...baseInsights.coverage, untestedFunctions: ['shardByDuration'] },
      },
    })
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText(/1 changed function has/)).toBeTruthy()
  })

  it('names hotspot files with their drivers in the risk row', () => {
    render(<InsightsPanel pr={buildPr()} />)
    const row = screen.getByText('Risk').closest('.ib-score') as HTMLElement
    expect(row.textContent).toContain('Highest score 78 / 100.')
    expect(row.textContent).toContain('playwright.config.ts (Wide blast radius — 41 importers)')
    expect(row.textContent).toContain('scripts/e2e-shard.ts (High churn — 14 commits/90d)')
  })

  it('leaves low risk files out of the hotspots', () => {
    const pr = buildPr({
      chapters: [
        {
          id: 'ch1',
          name: 'Sharding',
          estimatedMinutes: 6,
          status: 'not-started',
          files: [makeFile('a/b/c/quiet.ts', 'low', 10, 'No dominant risk signal', 6)],
        },
      ],
    })
    render(<InsightsPanel pr={pr} />)
    const row = screen.getByText('Risk').closest('.ib-score') as HTMLElement
    expect(row.textContent).toContain('No file stands out.')
    expect(row.textContent).not.toContain('quiet.ts')
  })

  it('shows "Not measured" for risk when no file has a composite score', () => {
    const pr = buildPr({
      chapters: [
        {
          id: 'ch1',
          name: 'Sharding',
          estimatedMinutes: 18,
          status: 'not-started',
          files: [makeFile('scripts/e2e-shard.ts', 'low', null, 'No dominant risk signal', 6)],
        },
      ],
    })
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText(/Not measured\./)).toBeTruthy()
  })

  it('renders the test coverage sentence with untested functions and the CI percent aside', () => {
    render(<InsightsPanel pr={buildPr()} />)
    const text = screen.getByText(/5 of 7 functions tested\./)
    expect(text.textContent).toContain(
      '2 changed functions have no test: shardByDuration, readBurnIn'
    )
    expect(text.textContent).toContain('CI reports 84% of new lines covered.')
  })

  it('renders "Every changed function has a test." when nothing is untested', () => {
    const pr = buildPr({
      insights: {
        ...baseInsights,
        coverage: { ...baseInsights.coverage, testedFunctions: 7, untestedFunctions: [] },
      },
    })
    render(<InsightsPanel pr={pr} />)
    expect(
      screen.getByText(/7 of 7 functions tested\. Every changed function has a test\./)
    ).toBeTruthy()
  })

  it('renders code health flags grouped by kind', () => {
    render(<InsightsPanel pr={buildPr()} />)
    expect(
      screen.getByText(
        '3 flags: 1 function over 80 lines, 1 new eslint-disable, 1 block duplicated in 2 files.'
      )
    ).toBeTruthy()
  })

  it('renders "No flags raised." when there are none', () => {
    const pr = buildPr({
      insights: {
        ...baseInsights,
        health: { flags: [], source: 'tree-sitter · detectDryViolations' },
      },
    })
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('No flags raised.')).toBeTruthy()
  })

  it('renders the understandability sentence', () => {
    render(<InsightsPanel pr={buildPr()} />)
    expect(
      screen.getByText(
        'Moderate. 1,120 lines to read once formatting and lock files are set aside. 9 new exported symbols. Longest chain of definitions you must hold: 4.'
      )
    ).toBeTruthy()
  })

  it('renders a muted "Analysing this PR…" row when insights is null, keeping risk', () => {
    render(<InsightsPanel pr={buildPr({ insights: null })} />)
    expect(screen.getByText('Analysing this PR…')).toBeTruthy()
    expect(screen.queryByText('Complexity')).toBeNull()
    expect(screen.getByText('Risk')).toBeTruthy()
    expect(screen.getByText('High risk')).toBeTruthy()
  })
})
