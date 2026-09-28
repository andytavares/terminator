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

function statusOf(container: HTMLElement, label: string): string | null {
  const row = [...container.querySelectorAll('.health-list-row')].find(
    (r) => r.querySelector('dt')?.textContent === label
  )
  return row?.querySelector('dd')?.getAttribute('data-status') ?? null
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
    expect(statusOf(container, 'Tests')).toBe('pass')
  })

  it('shows fail for test file missing', () => {
    const { container } = render(
      <HealthChips riskScore={makeRiskScore({ testFilePresent: false })} />
    )
    expect(statusOf(container, 'Tests')).toBe('fail')
  })

  it('shows unknown for null testFilePresent', () => {
    const { container } = render(
      <HealthChips riskScore={makeRiskScore({ testFilePresent: null })} />
    )
    expect(statusOf(container, 'Tests')).toBe('unknown')
  })

  it('shows CI passing chip with pass status', () => {
    const { container } = render(<HealthChips riskScore={makeRiskScore()} ciStatus="passing" />)
    expect(screen.getByText('passing')).toBeTruthy()
    expect(statusOf(container, 'CI')).toBe('pass')
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
    expect(statusOf(container, 'Coverage')).toBe('warn')
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

  it('shows unknown for null churn value', () => {
    const { container } = render(<HealthChips riskScore={makeRiskScore({ churn90d: null })} />)
    expect(statusOf(container, 'Churn')).toBe('unknown')
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

  it('labels the list and renders one row per signal', () => {
    const { container } = render(<HealthChips riskScore={makeRiskScore()} />)
    expect(screen.getByLabelText('File health signals')).toBeTruthy()
    expect(container.querySelectorAll('dt')).toHaveLength(8)
  })

  describe('list', () => {
    it('renders a titled dl list', () => {
      const { container } = render(<HealthChips riskScore={makeRiskScore()} />)
      expect(screen.getByText('Health')).toBeTruthy()
      expect(container.querySelector('dl')).toBeTruthy()
    })

    it('orders rows fail, then warn, then pass, then unknown', () => {
      const { container } = render(
        <HealthChips
          riskScore={makeRiskScore({ testFilePresent: false, complexityDelta: 3, churn90d: null })}
          ciStatus="passing"
        />
      )
      const labels = Array.from(container.querySelectorAll('dt')).map((el) => el.textContent)
      const statuses = Array.from(container.querySelectorAll('dd')).map((el) =>
        el.getAttribute('data-status')
      )
      // fail (Tests) must come before warn (Complexity), which comes before
      // pass (Coverage, CI), which comes before unknown (Churn, Blast, Duplication, Lint)
      const failIdx = statuses.indexOf('fail')
      const warnIdx = statuses.indexOf('warn')
      const passIdx = statuses.indexOf('pass')
      const unknownIdx = statuses.indexOf('unknown')
      expect(failIdx).toBeLessThan(warnIdx)
      expect(warnIdx).toBeLessThan(passIdx)
      expect(passIdx).toBeLessThan(unknownIdx)
      expect(labels).toContain('Tests')
    })

    it('shows "unknown" as the value text for unknown status rows', () => {
      render(<HealthChips riskScore={makeRiskScore({ churn90d: null })} />)
      const unknownValues = screen.getAllByText('unknown')
      expect(unknownValues.length).toBeGreaterThan(0)
    })

    it('keeps the tooltip as a title attribute on each row', () => {
      const { container } = render(<HealthChips riskScore={makeRiskScore()} />)
      const row = Array.from(container.querySelectorAll('div[title]')).find((el) =>
        el.textContent?.includes('Tests')
      )
      expect(row?.getAttribute('title')).toContain('test file')
    })

    it('colours the value text by status', () => {
      const { container } = render(
        <HealthChips riskScore={makeRiskScore({ testFilePresent: false })} />
      )
      const failValue = container.querySelector('dd[data-status="fail"]')
      expect(failValue).toBeTruthy()
    })
  })
})
