import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WhyThisFile } from '../../src/components/pr-review/WhyThisFile'
import type { RiskScore } from '../../src/schemas/pr-review.schema'
import { makeRiskScore } from './risk-score-fixtures'

const openPath = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { electronAPI: { shell: { openPath } } })
})

afterEach(() => {
  vi.clearAllMocks()
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

/** The shared low-risk score, made high risk: busy, widely used, no coverage reported. */
function riskyScore(
  overrides: Partial<RiskScore> = {},
  metrics: Partial<RiskScore['metrics']> = {}
) {
  const base = makeRiskScore()
  return {
    ...base,
    level: 'high' as const,
    topImporters: ['src/store.ts', 'src/api.ts'],
    importerCount: 2,
    ...overrides,
    metrics: {
      ...base.metrics,
      changeSize: 159,
      churn90d: 31,
      blastRadius: 2,
      patchCoverage: null,
      ...metrics,
    },
  }
}

function renderFile(riskScore: RiskScore = riskyScore()) {
  render(<WhyThisFile file={{ path: 'src/foo.ts', riskScore, repoRoot: '/repo' }} />)
}

describe('WhyThisFile — the lead line', () => {
  it('names the level and the top factors in words', () => {
    renderFile()
    expect(screen.getByText('High risk')).toBeTruthy()
    expect(screen.getByText(/because it changes often/)).toBeTruthy()
  })

  it('says so when no factor stands out', () => {
    renderFile(riskyScore({ level: 'low' }, { churn90d: 2, changeSize: 10 }))
    expect(screen.getByText('Low risk')).toBeTruthy()
    expect(screen.getByText(/because no single factor stands out/)).toBeTruthy()
  })
})

describe('WhyThisFile — only level-setting factors are named', () => {
  it('does not say a low-risk file is low risk because it has no test', () => {
    renderFile(
      riskyScore({ level: 'low' }, { churn90d: 2, changeSize: 10, testFilePresent: false })
    )
    expect(screen.getByText('Low risk')).toBeTruthy()
    expect(screen.queryByText(/has no test/)).toBeNull()
    expect(screen.getByText(/because no single factor stands out/)).toBeTruthy()
    expect(screen.getByText('No test file alongside it')).toBeTruthy()
  })
})

describe('WhyThisFile — used by agrees with the level', () => {
  it('counts a file with no measured importers as used by none, as the level does', () => {
    renderFile(riskyScore({ importerCount: 25, topImporters: [] }, { blastRadius: null }))
    expect(screen.getByText('Used by 0 files')).toBeTruthy()
  })
})

describe('WhyThisFile — the factor rows', () => {
  it('writes each measured value in words with the threshold it crossed', () => {
    renderFile()
    expect(screen.getByText('Changes often')).toBeTruthy()
    expect(screen.getByText('31 commits in the last 90 days')).toBeTruthy()
    expect(screen.getByText('20 or more')).toBeTruthy()
    expect(screen.getByText('159 lines changed')).toBeTruthy()
    expect(screen.getByText('Used by 2 files')).toBeTruthy()
    expect(screen.getByText('Has a test')).toBeTruthy()
  })

  it('says a single commit and a missing test plainly', () => {
    renderFile(riskyScore({}, { churn90d: 1, testFilePresent: false }))
    expect(screen.getByText('1 commit in the last 90 days')).toBeTruthy()
    expect(screen.getByText('No test file alongside it')).toBeTruthy()
  })

  it('says CI did not report patch coverage when it is null', () => {
    renderFile()
    expect(screen.getByText('CI did not report it')).toBeTruthy()
  })

  it('gives the patch coverage percentage when CI reported it', () => {
    renderFile(riskyScore({}, { patchCoverage: 85 }))
    expect(screen.getByText('85% of the changed lines are covered')).toBeTruthy()
  })
})

describe('WhyThisFile — what it leaves out', () => {
  it('does not draw a composite score or uppercase labels', () => {
    renderFile()
    expect(screen.queryByText(/\/ 100/)).toBeNull()
    expect(screen.queryByText('HIGH')).toBeNull()
  })

  it('explains where the levels come from', () => {
    renderFile()
    expect(screen.getByText(/Levels come from fixed thresholds/)).toBeTruthy()
  })
})

describe('WhyThisFile — importers', () => {
  it('draws importer buttons that submit nothing and icons hidden from assistive technology', () => {
    renderFile()
    expect(screen.getByRole('button', { name: 'store.ts' }).getAttribute('type')).toBe('button')
    expect(document.querySelectorAll('.ri-factor-icon[aria-hidden="true"]')).toHaveLength(5)
  })

  it('classes each factor by its severity in words', () => {
    renderFile(riskyScore({}, { churn90d: 60 }))
    expect(document.querySelector('.ri-factor--high')).toBeTruthy()
    expect(document.querySelector('.ri-factor--hi')).toBeNull()
  })

  it('lists importers as buttons under an Importers heading', () => {
    renderFile()
    expect(screen.getByText('Importers (2)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'store.ts' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'api.ts' })).toBeTruthy()
  })

  it('opens an importer from the repository root', () => {
    renderFile()
    fireEvent.click(screen.getByRole('button', { name: 'store.ts' }))
    expect(openPath).toHaveBeenCalledWith('/repo/src/store.ts')
  })

  it('shows no Importers heading when nothing imports the file', () => {
    renderFile(riskyScore({ topImporters: [], importerCount: 0 }))
    expect(screen.queryByText(/Importers/)).toBeNull()
  })
})

describe('WhyThisFile — thresholds are floors', () => {
  it('says a value that equals the floor reaches it', () => {
    renderFile(riskyScore({}, { churn90d: 20 }))
    expect(screen.getByText('20 or more')).toBeTruthy()
  })

  it('says a value just under the floor is under it', () => {
    renderFile(riskyScore({}, { churn90d: 19 }))
    expect(screen.getByText('under 20')).toBeTruthy()
  })
})

describe('WhyThisFile — a factor under its floor does not claim it', () => {
  it('titles low churn as how often it changes, not "Changes often"', () => {
    renderFile(riskyScore({ level: 'low' }, { churn90d: 2 }))
    expect(screen.getByText('How often it changes')).toBeTruthy()
    expect(screen.queryByText('Changes often')).toBeNull()
  })
})
