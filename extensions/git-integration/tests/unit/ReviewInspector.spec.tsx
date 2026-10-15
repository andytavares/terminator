import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReviewInspector } from '../../src/components/pr-review/ReviewInspector'
import { makeRiskScore } from './risk-score-fixtures'

vi.mock('../../src/components/pr-review/WhyThisFile', () => ({
  WhyThisFile: () => <div data-testid="why-panel" />,
}))

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
    expect(screen.queryByRole('tab', { name: /Why this file/ })).toBeNull()
  })
})

describe('ReviewInspector — shows only the File tab when agent is unavailable', () => {
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
    expect(screen.getByRole('tab', { name: /Why this file/ })).toBeTruthy()
  })
})

describe('ReviewInspector — marks the active tab aria-selected and renders its panel', () => {
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
    const fileTab = screen.getByRole('tab', { name: /Why this file/ })
    expect(agentTab.getAttribute('aria-selected')).toBe('true')
    expect(fileTab.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByTestId('agent-body')).toBeTruthy()
    expect(screen.queryByTestId('why-panel')).toBeNull()
  })
})

describe('ReviewInspector — calls onTabChange when a tab is clicked', () => {
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
    fireEvent.click(screen.getByRole('tab', { name: /Why this file/ }))
    expect(onTabChange).toHaveBeenCalledWith('file')
  })
})

describe('ReviewInspector — calls onTabChange with agent when the Agent tab is clicked', () => {
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
})

describe('ReviewInspector — shows a count badge on the Agent tab when agentFindingCount > 0', () => {
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
})

describe('ReviewInspector — does not show a count badge when agentFindingCount is 0', () => {
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
})

describe('ReviewInspector — falls back to the available tab when the requested tab is unavailable', () => {
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
    expect(screen.getByTestId('why-panel')).toBeTruthy()
    const fileTab = screen.getByRole('tab', { name: /Why this file/ })
    expect(fileTab.getAttribute('aria-selected')).toBe('true')
  })
})

describe('ReviewInspector — calls onClose when the close button is clicked', () => {
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
})

describe('ReviewInspector — renders the Why this file tab with its panel', () => {
  it('renders the Why this file tab with its panel', () => {
    render(
      <ReviewInspector
        tab="file"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={0}
        agent={<div data-testid="agent-body" />}
        file={baseFile}
      />
    )
    expect(screen.getByTestId('why-panel')).toBeTruthy()
    expect(screen.getByRole('tabpanel')).toBeTruthy()
  })
})

describe('ReviewInspector — has an accessible tablist labelled Inspector', () => {
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

describe('ReviewInspector — moves to the File tab with the arrow keys', () => {
  it('moves to the File tab with the arrow keys', () => {
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
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Agent' }), { key: 'ArrowRight' })
    expect(onTabChange).toHaveBeenCalledWith('file')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Why this file' }))
  })
})

describe('ReviewInspector — names the Agent tab with its finding count and ties the panel to it', () => {
  it('names the Agent tab with its finding count and ties the panel to it', () => {
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
    const agentTab = screen.getByRole('tab', { name: 'Agent, 3' })
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(agentTab.id)
    expect(agentTab.getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id)
  })
})

describe('ReviewInspector — names its two tabs Why this file and Agent', () => {
  it('names its two tabs Why this file and Agent', () => {
    render(
      <ReviewInspector
        tab="agent"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={0}
        agent={<div />}
        file={baseFile}
      />
    )
    const names = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(names).toEqual(['Agent', 'Why this file'])
  })
})

function DrawerHarness() {
  const [open, setOpen] = React.useState(true)
  if (!open) return null
  return (
    <ReviewInspector
      tab="agent"
      onTabChange={vi.fn()}
      onClose={() => setOpen(false)}
      agentAvailable
      agentFindingCount={0}
      agent={<div />}
      file={baseFile}
    />
  )
}

describe('ReviewInspector — closes on Escape', () => {
  it('leaves the DOM when Escape is pressed', () => {
    render(<DrawerHarness />)
    expect(screen.getByRole('tablist', { name: 'Inspector' })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('tablist', { name: 'Inspector' })).toBeNull()
  })
})
