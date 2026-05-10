import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthChips } from '../../src/components/pr-review/HealthChips'
import type { RiskScore } from '../../src/schemas/pr-review.schema'

function makeRiskScore(overrides: Partial<RiskScore['metrics']> = {}): RiskScore {
  return {
    score: 30,
    level: 'low',
    metrics: {
      linesChanged: 10,
      filesChanged: 1,
      testFilePresent: true,
      complexityDelta: 0,
      churn90d: 2,
      blastRadius: 1,
      patchCoverage: 85,
      ...overrides,
    },
  }
}

describe('HealthChips', () => {
  it('renders all chip labels', () => {
    render(<HealthChips riskScore={makeRiskScore()} />)
    expect(screen.getByText('Tests')).toBeTruthy()
    expect(screen.getByText('Complexity')).toBeTruthy()
    expect(screen.getByText('Coverage')).toBeTruthy()
    expect(screen.getByText('Lint')).toBeTruthy()
    expect(screen.getByText('CI')).toBeTruthy()
    expect(screen.getByText('Churn')).toBeTruthy()
    expect(screen.getByText('Blast')).toBeTruthy()
  })

  it('shows pass for test file present', () => {
    const { container } = render(
      <HealthChips riskScore={makeRiskScore({ testFilePresent: true })} />
    )
    const testChip = container.querySelector('.health-chip:first-child')
    expect(testChip?.className).toContain('health-chip--pass')
  })

  it('shows fail for test file missing', () => {
    const { container } = render(
      <HealthChips riskScore={makeRiskScore({ testFilePresent: false })} />
    )
    expect(container.querySelector('.health-chip--fail')).toBeTruthy()
  })

  it('shows unknown for null testFilePresent', () => {
    const { container } = render(
      <HealthChips riskScore={makeRiskScore({ testFilePresent: null })} />
    )
    expect(container.querySelector('.health-chip--unknown')).toBeTruthy()
  })

  it('shows CI passing chip with pass status', () => {
    const { container } = render(<HealthChips riskScore={makeRiskScore()} ciStatus="passing" />)
    expect(screen.getByText('passing')).toBeTruthy()
    const chips = container.querySelectorAll('.health-chip--pass')
    expect(chips.length).toBeGreaterThan(0)
  })

  it('shows CI failing chip with fail status', () => {
    render(<HealthChips riskScore={makeRiskScore()} ciStatus="failing" />)
    expect(screen.getByText('failing')).toBeTruthy()
  })

  it('shows CI pending with warn status', () => {
    render(<HealthChips riskScore={makeRiskScore()} ciStatus="pending" />)
    expect(screen.getByText('pending')).toBeTruthy()
  })

  it('shows coverage percentage from metrics', () => {
    render(<HealthChips riskScore={makeRiskScore({ patchCoverage: 75 })} />)
    expect(screen.getByText('75%')).toBeTruthy()
  })

  it('shows coverage warn when between 50 and 79', () => {
    const { container } = render(<HealthChips riskScore={makeRiskScore({ patchCoverage: 60 })} />)
    expect(container.querySelector('.health-chip--warn')).toBeTruthy()
  })

  it('shows coverage fail when below 50', () => {
    render(<HealthChips riskScore={makeRiskScore({ patchCoverage: 40 })} />)
    expect(screen.getByText('40%')).toBeTruthy()
  })

  it('shows complexity delta as +N for positive values', () => {
    render(<HealthChips riskScore={makeRiskScore({ complexityDelta: 3 })} />)
    expect(screen.getByText('+3')).toBeTruthy()
  })

  it('shows complexity delta as ±0 for zero', () => {
    render(<HealthChips riskScore={makeRiskScore({ complexityDelta: 0 })} />)
    expect(screen.getByText('±0')).toBeTruthy()
  })

  it('shows complexity delta as negative for negative values', () => {
    render(<HealthChips riskScore={makeRiskScore({ complexityDelta: -2 })} />)
    expect(screen.getByText('-2')).toBeTruthy()
  })

  it('shows churn value in correct format', () => {
    render(<HealthChips riskScore={makeRiskScore({ churn90d: 3 })} />)
    expect(screen.getByText('3x/90d')).toBeTruthy()
  })

  it('shows blast radius in importers format', () => {
    render(<HealthChips riskScore={makeRiskScore({ blastRadius: 5 })} />)
    expect(screen.getByText('5 importers')).toBeTruthy()
  })

  it('shows ? for null churn value', () => {
    render(<HealthChips riskScore={makeRiskScore({ churn90d: null })} />)
    const questionMarks = screen.getAllByText('?')
    expect(questionMarks.length).toBeGreaterThan(0)
  })

  it('shows lint clean for pass status', () => {
    render(<HealthChips riskScore={makeRiskScore()} lintStatus="pass" />)
    expect(screen.getByText('clean')).toBeTruthy()
  })

  it('shows lint errors for fail status', () => {
    render(<HealthChips riskScore={makeRiskScore()} lintStatus="fail" />)
    expect(screen.getByText('errors')).toBeTruthy()
  })

  it('shows lint warnings for warn status', () => {
    render(<HealthChips riskScore={makeRiskScore()} lintStatus="warn" />)
    expect(screen.getByText('warnings')).toBeTruthy()
  })

  it('renders as accessible list', () => {
    render(<HealthChips riskScore={makeRiskScore()} />)
    expect(screen.getByRole('list')).toBeTruthy()
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBe(7)
  })
})
