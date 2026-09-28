import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewMenu } from '../../src/components/pr-review/ViewMenu'
import { useReviewUiStore } from '../../src/stores/review-ui.store'

vi.mock('@terminator/extension-ui', () => ({
  Popover: ({
    label,
    children,
  }: {
    label: string
    onDismiss: () => void
    children: React.ReactNode
    className?: string
  }) => (
    <div data-testid="popover" aria-label={label} role="group">
      {children}
    </div>
  ),
}))

function resetStore() {
  useReviewUiStore.setState({
    commentVisibility: 'all',
    agentNotesOn: true,
    diffRange: 'since',
    fileListHidden: false,
    diffViewMode: 'unified',
    hideFormattingHunks: true,
  })
}

describe('ViewMenu', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStore()
  })

  it('opens the popover and shows the default state with no dot', async () => {
    render(<ViewMenu />)
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(screen.getByRole('group', { name: 'Comment visibility' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Agent notes' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Diff view mode' })).toBeTruthy()
  })

  it('changes comment visibility and reflects aria-pressed plus the store', async () => {
    render(<ViewMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    const unresolved = screen.getByRole('button', { name: 'Unresolved' })
    await userEvent.click(unresolved)
    expect(unresolved.getAttribute('aria-pressed')).toBe('true')
    expect(useReviewUiStore.getState().commentVisibility).toBe('unresolved')
  })

  it('shows a dot and "View (changed)" accessible name when a setting is non-default', async () => {
    useReviewUiStore.getState().setAgentNotesOn(false)
    render(<ViewMenu />)
    expect(screen.getByRole('button', { name: 'View (changed)' })).toBeTruthy()
  })

  it('shows "Comments hidden" text when commentVisibility is hidden', () => {
    useReviewUiStore.getState().setCommentVisibility('hidden')
    render(<ViewMenu />)
    expect(screen.getByText('Comments hidden')).toBeTruthy()
  })

  it('toggles agent notes off via the Off button', async () => {
    render(<ViewMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(useReviewUiStore.getState().agentNotesOn).toBe(false)
  })

  it('switches diff view mode to Split and back to Unified', async () => {
    render(<ViewMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(screen.getByRole('button', { name: 'Split' }))
    expect(useReviewUiStore.getState().diffViewMode).toBe('split')
    await userEvent.click(screen.getByRole('button', { name: 'Unified' }))
    expect(useReviewUiStore.getState().diffViewMode).toBe('unified')
  })

  it('turns agent notes back on via the On button', async () => {
    useReviewUiStore.getState().setAgentNotesOn(false)
    render(<ViewMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'View (changed)' }))
    await userEvent.click(screen.getByRole('button', { name: 'On' }))
    expect(useReviewUiStore.getState().agentNotesOn).toBe(true)
  })

  it('selects Hidden from the Comments group', async () => {
    render(<ViewMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(screen.getByRole('button', { name: 'Hidden' }))
    expect(useReviewUiStore.getState().commentVisibility).toBe('hidden')
  })

  it('toggles hide-formatting-hunks via the switch', async () => {
    render(<ViewMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    const toggle = screen.getByRole('switch', { name: /Hide formatting-only hunks/ })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await userEvent.click(toggle)
    expect(useReviewUiStore.getState().hideFormattingHunks).toBe(false)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('renders the sinceNote when provided', async () => {
    render(<ViewMenu sinceNote="Showing a1b2… head" />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(screen.getByText('Showing a1b2… head')).toBeTruthy()
  })

  it('renders no sinceNote text when the prop is absent', async () => {
    render(<ViewMenu />)
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(screen.queryByText(/Showing/)).toBeNull()
  })
})
