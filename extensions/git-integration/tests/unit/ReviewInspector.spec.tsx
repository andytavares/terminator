import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it.each([
    {
      tab: 'agent' as const,
      selected: ['true', 'false'],
      shown: 'agent-body',
      hidden: 'why-panel',
    },
    { tab: 'file' as const, selected: ['false', 'true'], shown: 'why-panel', hidden: 'agent-body' },
  ])('selects the $tab tab and renders only its panel', ({ tab, selected, shown, hidden }) => {
    render(
      <ReviewInspector
        tab={tab}
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={0}
        agent={<div data-testid="agent-body">agent content</div>}
        file={baseFile}
      />
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((element) => element.getAttribute('aria-selected'))).toEqual(selected)
    expect(screen.getByRole('tabpanel').contains(screen.getByTestId(shown))).toBe(true)
    expect(screen.queryByTestId(hidden)).toBeNull()
  })
})

describe('ReviewInspector — calls onTabChange when a tab is clicked', () => {
  it.each([
    { tab: 'agent' as const, click: /Why this file/, expected: 'file' },
    { tab: 'file' as const, click: /Agent/, expected: 'agent' },
  ])('calls onTabChange with $expected from the $tab tab', async ({ tab, click, expected }) => {
    const onTabChange = vi.fn()
    render(
      <ReviewInspector
        tab={tab}
        onTabChange={onTabChange}
        onClose={vi.fn()}
        agentAvailable
        agentFindingCount={0}
        agent={<div data-testid="agent-body" />}
        file={baseFile}
      />
    )
    await userEvent.click(screen.getByRole('tab', { name: click }))
    expect(onTabChange).toHaveBeenCalledWith(expected)
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
  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ReviewInspector — moves to the File tab with the arrow keys', () => {
  it('moves to the File tab with the arrow keys', async () => {
    const user = userEvent.setup()
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
    const agentTab = screen.getByRole('tab', { name: 'Agent' })
    act(() => agentTab.focus())
    expect(document.activeElement).toBe(agentTab)

    await user.keyboard('{ArrowRight}')

    expect(onTabChange).toHaveBeenCalledWith('file')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Why this file' }))
  })
})

describe('ReviewInspector — names the Agent tab with its finding count and ties the panel to it', () => {
  it('shows the finding count badge, names the Agent tab with it and ties the panel to it', () => {
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
    expect(agentTab.textContent).toBe('Agent3')
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
  it('leaves the DOM when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(<DrawerHarness />)
    expect(screen.getByRole('tablist', { name: 'Inspector' })).toBeTruthy()
    expect(document.activeElement).toBe(document.body)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tablist', { name: 'Inspector' })).toBeNull()
  })
})
