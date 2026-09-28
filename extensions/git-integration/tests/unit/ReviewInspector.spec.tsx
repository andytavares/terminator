import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReviewInspector } from '../../src/components/pr-review/ReviewInspector'
import type { RiskScore } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/components/pr-review/RiskBreakdownPanel', () => ({
  RiskBreakdownPanel: () => <div data-testid="risk-panel" />,
}))

function makeRiskScore(): RiskScore {
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
    },
  }
}

const baseFile = {
  path: 'src/foo.ts',
  riskScore: makeRiskScore(),
  repoRoot: '/repo',
}

describe('ReviewInspector', () => {
  it('shows only the Agent tab when file is null', () => {
    render(
      <ReviewInspector
        tab="agent"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={0}
        agent={<div data-testid="agent-body" />}
        file={null}
      />
    )
    expect(screen.getByRole('tab', { name: /Agent/ })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /File/ })).toBeNull()
  })

  it('shows only the File tab when agent is unavailable', () => {
    render(
      <ReviewInspector
        tab="file"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        agentAvailable={false}
        agentFindingCount={0}
        agent={<div data-testid="agent-body" />}
        file={baseFile}
      />
    )
    expect(screen.queryByRole('tab', { name: /Agent/ })).toBeNull()
    expect(screen.getByRole('tab', { name: /File/ })).toBeTruthy()
  })

  it('marks the active tab aria-selected and renders its panel', () => {
    render(
      <ReviewInspector
        tab="agent"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={0}
        agent={<div data-testid="agent-body">agent content</div>}
        file={baseFile}
      />
    )
    const agentTab = screen.getByRole('tab', { name: /Agent/ })
    const fileTab = screen.getByRole('tab', { name: /File/ })
    expect(agentTab.getAttribute('aria-selected')).toBe('true')
    expect(fileTab.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByTestId('agent-body')).toBeTruthy()
    expect(screen.queryByTestId('risk-panel')).toBeNull()
  })

  it('calls onTabChange when a tab is clicked', () => {
    const onTabChange = vi.fn()
    render(
      <ReviewInspector
        tab="agent"
        onTabChange={onTabChange}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={0}
        agent={<div data-testid="agent-body" />}
        file={baseFile}
      />
    )
    fireEvent.click(screen.getByRole('tab', { name: /File/ }))
    expect(onTabChange).toHaveBeenCalledWith('file')
  })

  it('calls onTabChange with "agent" when the Agent tab is clicked', () => {
    const onTabChange = vi.fn()
    render(
      <ReviewInspector
        tab="file"
        onTabChange={onTabChange}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={0}
        agent={<div data-testid="agent-body" />}
        file={baseFile}
      />
    )
    fireEvent.click(screen.getByRole('tab', { name: /Agent/ }))
    expect(onTabChange).toHaveBeenCalledWith('agent')
  })

  it('shows a count badge on the Agent tab when agentFindingCount > 0', () => {
    render(
      <ReviewInspector
        tab="agent"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={3}
        agent={<div data-testid="agent-body" />}
        file={baseFile}
      />
    )
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('does not show a count badge when agentFindingCount is 0', () => {
    render(
      <ReviewInspector
        tab="agent"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={0}
        agent={<div data-testid="agent-body" />}
        file={baseFile}
      />
    )
    expect(screen.queryByText('0')).toBeNull()
  })

  it('falls back to the available tab when the requested tab is unavailable', () => {
    render(
      <ReviewInspector
        tab="agent"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        agentAvailable={false}
        agentFindingCount={0}
        agent={<div data-testid="agent-body" />}
        file={baseFile}
      />
    )
    expect(screen.getByTestId('risk-panel')).toBeTruthy()
    const fileTab = screen.getByRole('tab', { name: /File/ })
    expect(fileTab.getAttribute('aria-selected')).toBe('true')
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <ReviewInspector
        tab="agent"
        onTabChange={vi.fn()}
        onClose={onClose}
        agentAvailable
        agentFindingCount={0}
        agent={<div data-testid="agent-body" />}
        file={baseFile}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders the File tab with the risk panel and the Health list rows', () => {
    render(
      <ReviewInspector
        tab="file"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={0}
        agent={<div data-testid="agent-body" />}
        file={{ ...baseFile, ciStatus: 'passing', lintStatus: 'pass' }}
      />
    )
    expect(screen.getByTestId('risk-panel')).toBeTruthy()
    expect(screen.getByText('Health')).toBeTruthy()
    expect(screen.getByRole('tabpanel')).toBeTruthy()
  })

  it('has an accessible tablist labelled Inspector', () => {
    render(
      <ReviewInspector
        tab="agent"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={0}
        agent={<div data-testid="agent-body" />}
        file={baseFile}
      />
    )
    expect(screen.getByRole('tablist', { name: 'Inspector' })).toBeTruthy()
  })
})
