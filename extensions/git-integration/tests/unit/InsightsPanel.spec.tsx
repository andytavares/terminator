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
  it('renders the header with PR number, overall risk chip and reading estimate', () => {
    const pr = buildPr()
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('Review brief · #211')).toBeTruthy()
    expect(screen.getByText('High risk')).toBeTruthy()
    expect(screen.getByText('~18 min')).toBeTruthy()
  })

  it('renders the complexity row with signed value, top-3 functions and meter width', () => {
    const pr = buildPr()
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('+23 branches')).toBeTruthy()
    const text = screen.getByText(/Up in 6 functions\. Largest:/)
    expect(text.textContent).toContain('selectSpecs')
    expect(text.textContent).toContain('+9')
    expect(text.textContent).toContain('shardByDuration')
    expect(text.textContent).toContain('+6')
    expect(text.textContent).toContain('loadTimings')
    expect(text.textContent).toContain('+4')
    expect(text.textContent).not.toContain('readBurnIn')
    expect(screen.getByText('tree-sitter · base vs head')).toBeTruthy()

    const meter = document.querySelector('.ib-meter i') as HTMLElement
    expect(meter).toBeTruthy()
    // min(100, 23 * 100 / 40) = 57.5%
    expect(meter.style.width).toBe('57.5%')
  })

  it('renders "No change" when branch delta is zero', () => {
    const pr = buildPr({
      insights: {
        ...baseInsights,
        complexity: { branchDelta: 0, functions: [], source: 'tree-sitter · base vs head' },
      },
    })
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('No change')).toBeTruthy()
    expect(screen.getByText('No function gained branches.')).toBeTruthy()
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
    expect(screen.getByText('No functions changed')).toBeTruthy()
    expect(
      screen.getByText('1 of 3 changed source files have a changed test beside them.')
    ).toBeTruthy()
    expect(screen.queryByText('Every changed function has a test.')).toBeNull()
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
    expect(screen.getByText('No source files changed.')).toBeTruthy()
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

  it('renders the risk row driven by the top two distinct file drivers', () => {
    const pr = buildPr()
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('78 / 100')).toBeTruthy()
    const text = screen.getByText(/Driven by/)
    expect(text.textContent).toContain('Wide blast radius — 41 importers')
    expect(text.textContent).toContain('playwright.config.ts')
    expect(text.textContent).toContain('High churn — 14 commits/90d')
    expect(text.textContent).toContain('scripts/e2e-shard.ts')
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
    expect(screen.getByText('Not measured')).toBeTruthy()
  })

  it('renders the test coverage row with untested functions and the CI percent aside', () => {
    const pr = buildPr()
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('5 of 7 functions tested')).toBeTruthy()
    const text = screen.getByText(/changed functions have no test/)
    expect(text.textContent).toContain('shardByDuration')
    expect(text.textContent).toContain('readBurnIn')
    expect(text.textContent).toContain('CI reports 84% of new lines covered.')

    const label = screen.getByText('Test coverage')
    const row = label.closest('.ib-score') as HTMLElement
    const meter = row.querySelector('.ib-meter i') as HTMLElement
    // 5 of 7 tested = 71.43%
    expect(meter.style.width).toBe('71.42857142857143%')
  })

  it('renders "Every changed function has a test." when nothing is untested', () => {
    const pr = buildPr({
      insights: {
        ...baseInsights,
        coverage: {
          changedFunctions: 4,
          testedFunctions: 4,
          untestedFunctions: [],
          patchPercent: null,
          source: 'CI check codecov/patch',
          changedSourceFiles: 5,
          changedSourceFilesWithTests: 4,
        },
      },
    })
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('4 of 4 functions tested')).toBeTruthy()
    expect(screen.getByText('Every changed function has a test.')).toBeTruthy()
  })

  it('renders "No functions changed" without a meter when nothing changed', () => {
    const pr = buildPr({
      insights: {
        ...baseInsights,
        coverage: {
          changedFunctions: 0,
          testedFunctions: 0,
          untestedFunctions: [],
          patchPercent: null,
          source: 'CI check codecov/patch',
          changedSourceFiles: 5,
          changedSourceFilesWithTests: 4,
        },
      },
    })
    render(<InsightsPanel pr={pr} />)
    const label = screen.getByText('Test coverage')
    const row = label.closest('.ib-score') as HTMLElement
    expect(row.querySelector('.ib-meter')).toBeNull()
    expect(screen.getByText('No functions changed')).toBeTruthy()
  })

  it('renders code health flags grouped by kind', () => {
    const pr = buildPr()
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('3 flags')).toBeTruthy()
    expect(
      screen.getByText(
        '1 function over 80 lines, 1 new eslint-disable, 1 block duplicated in 2 files.'
      )
    ).toBeTruthy()
  })

  it('renders "No flags" when there are none', () => {
    const pr = buildPr({
      insights: {
        ...baseInsights,
        health: { flags: [], source: 'tree-sitter · detectDryViolations' },
      },
    })
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('No flags')).toBeTruthy()
  })

  it('renders the understandability row and its meter', () => {
    const pr = buildPr()
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('Moderate')).toBeTruthy()
    expect(
      screen.getByText(
        '1,120 lines to read once formatting and lock files are set aside. 9 new exported symbols. Longest chain of definitions you must hold: 4.'
      )
    ).toBeTruthy()
    const label = screen.getByText('Understandability')
    const row = label.closest('.ib-score') as HTMLElement
    const meter = row.querySelector('.ib-meter i') as HTMLElement
    expect(meter.style.width).toBe('48%')
  })

  it('renders a single muted "Analysing this PR…" row when insights is null', () => {
    const pr = buildPr({ insights: null })
    render(<InsightsPanel pr={pr} />)
    expect(screen.getByText('Analysing this PR…')).toBeTruthy()
    expect(screen.queryByText('Complexity')).toBeNull()
    expect(screen.queryByText('Risk')).toBeNull()
    // Header chips (not fed by insights) still render.
    expect(screen.getByText('High risk')).toBeTruthy()
    expect(screen.getByText('~18 min')).toBeTruthy()
  })
})
