import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RiskBreakdownPanel } from '../../src/components/pr-review/RiskBreakdownPanel'
import type { RiskScore } from '../../src/schemas/pr-review.schema'

const mockOpenPath = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    shell: { openPath: mockOpenPath },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

function makeRiskScore(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    score: 60,
    level: 'medium',
    composite: 60,
    dominantDriver: 'High churn rate',
    topImporters: [],
    importerCount: 0,
    metrics: {
      linesChanged: 50,
      filesChanged: 1,
      testFilePresent: true,
      complexityDelta: 2,
      churn90d: 10,
      blastRadius: 5,
      patchCoverage: 75,
      changeSize: 50,
    },
    ...overrides,
  }
}

describe('RiskBreakdownPanel', () => {
  it('renders the risk level in heading', () => {
    render(
      <RiskBreakdownPanel filePath="src/foo.ts" riskScore={makeRiskScore()} repoRoot="/repo" />
    )
    expect(screen.getByText('MEDIUM')).toBeTruthy()
  })

  it('renders the dominant driver text', () => {
    render(
      <RiskBreakdownPanel filePath="src/foo.ts" riskScore={makeRiskScore()} repoRoot="/repo" />
    )
    expect(screen.getByText('High churn rate')).toBeTruthy()
  })

  it('renders composite score', () => {
    const { container } = render(
      <RiskBreakdownPanel
        filePath="src/foo.ts"
        riskScore={makeRiskScore({ composite: 60 })}
        repoRoot="/repo"
      />
    )
    expect(container.querySelector('.risk-composite-score')?.textContent).toBe('60')
    expect(container.querySelector('.risk-composite-max')?.textContent).toBe(' / 100')
  })

  it('does not render composite score when null', () => {
    render(
      <RiskBreakdownPanel
        filePath="src/foo.ts"
        riskScore={makeRiskScore({ composite: undefined })}
        repoRoot="/repo"
      />
    )
    expect(screen.queryByText(' / 100')).toBeNull()
  })

  it('renders metric row labels', () => {
    render(
      <RiskBreakdownPanel filePath="src/foo.ts" riskScore={makeRiskScore()} repoRoot="/repo" />
    )
    expect(screen.getByText('Change size')).toBeTruthy()
    expect(screen.getByText('Churn 90d')).toBeTruthy()
    expect(screen.getByText('Blast radius')).toBeTruthy()
    expect(screen.getByText('Complexity delta')).toBeTruthy()
    expect(screen.getByText('Patch coverage')).toBeTruthy()
    expect(screen.getByText('Test file')).toBeTruthy()
  })

  it('shows "?" for unknown metric values', () => {
    const riskScore = makeRiskScore()
    riskScore.metrics.churn90d = null
    render(<RiskBreakdownPanel filePath="src/foo.ts" riskScore={riskScore} repoRoot="/repo" />)
    const questionMarks = screen.getAllByText('?')
    expect(questionMarks.length).toBeGreaterThan(0)
  })

  it('renders file path at bottom', () => {
    render(
      <RiskBreakdownPanel filePath="src/foo.ts" riskScore={makeRiskScore()} repoRoot="/repo" />
    )
    expect(screen.getByText('src/foo.ts')).toBeTruthy()
  })

  it('renders importers list when topImporters is not empty', () => {
    const riskScore = makeRiskScore({
      topImporters: ['src/bar.ts', 'src/baz.ts'],
      importerCount: 2,
    })
    render(<RiskBreakdownPanel filePath="src/foo.ts" riskScore={riskScore} repoRoot="/repo" />)
    expect(screen.getByText('Importers (2)')).toBeTruthy()
    expect(screen.getByText('bar.ts')).toBeTruthy()
    expect(screen.getByText('baz.ts')).toBeTruthy()
  })

  it('calls openPath when importer is clicked', () => {
    const riskScore = makeRiskScore({ topImporters: ['src/bar.ts'], importerCount: 1 })
    render(<RiskBreakdownPanel filePath="src/foo.ts" riskScore={riskScore} repoRoot="/repo" />)
    fireEvent.click(screen.getByText('bar.ts'))
    expect(mockOpenPath).toHaveBeenCalledWith('/repo/src/bar.ts')
  })

  it('shows "Show N more" when importers exceed initial limit', () => {
    const importers = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts']
    const riskScore = makeRiskScore({ topImporters: importers, importerCount: 6 })
    render(<RiskBreakdownPanel filePath="src/foo.ts" riskScore={riskScore} repoRoot="/repo" />)
    expect(screen.getByText('Show 1 more…')).toBeTruthy()
  })

  it('expands all importers when "Show more" is clicked', () => {
    const importers = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts']
    const riskScore = makeRiskScore({ topImporters: importers, importerCount: 6 })
    render(<RiskBreakdownPanel filePath="src/foo.ts" riskScore={riskScore} repoRoot="/repo" />)
    fireEvent.click(screen.getByText('Show 1 more…'))
    expect(screen.getByText('f.ts')).toBeTruthy()
    expect(screen.getByText('Collapse')).toBeTruthy()
  })

  it('shows test file as present when testFilePresent is true', () => {
    render(
      <RiskBreakdownPanel filePath="src/foo.ts" riskScore={makeRiskScore()} repoRoot="/repo" />
    )
    expect(screen.getByText('present')).toBeTruthy()
  })

  it('shows test file as missing when testFilePresent is false', () => {
    const riskScore = makeRiskScore()
    riskScore.metrics.testFilePresent = false
    render(<RiskBreakdownPanel filePath="src/foo.ts" riskScore={riskScore} repoRoot="/repo" />)
    expect(screen.getByText('missing')).toBeTruthy()
  })

  it('renders as accessible aside', () => {
    render(
      <RiskBreakdownPanel filePath="src/foo.ts" riskScore={makeRiskScore()} repoRoot="/repo" />
    )
    expect(screen.getByRole('complementary')).toBeTruthy()
  })
})
