import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewInspector } from '../../src/components/pr-review/ReviewInspector'

describe('ReviewInspector', () => {
  it('shows the agent under an Agent heading', () => {
    render(
      <ReviewInspector
        onClose={vi.fn()}
        agentFindingCount={0}
        agent={<div data-testid="agent-body">agent content</div>}
      />
    )
    expect(screen.getByRole('heading', { name: 'Agent' })).toBeTruthy()
    expect(screen.getByTestId('agent-body').textContent).toBe('agent content')
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('shows the open finding count beside the heading', () => {
    render(<ReviewInspector onClose={vi.fn()} agentFindingCount={3} agent={<div />} />)
    expect(screen.getByRole('heading').textContent).toBe('Agent3')
  })

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ReviewInspector onClose={onClose} agentFindingCount={0} agent={<div />} />)
    await user.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

function DrawerHarness() {
  const [open, setOpen] = React.useState(true)
  if (!open) return null
  return <ReviewInspector onClose={() => setOpen(false)} agentFindingCount={0} agent={<div />} />
}

describe('ReviewInspector — closes on Escape', () => {
  it('leaves the DOM when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(<DrawerHarness />)
    expect(screen.getByRole('heading', { name: 'Agent' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('heading', { name: 'Agent' })).toBeNull()
  })
})
