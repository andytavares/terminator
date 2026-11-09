import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewMenu, type FileFilters } from '../../src/components/pr-review/ViewMenu'
import { useReviewUiStore } from '../../src/stores/review-ui.store'

vi.mock('@terminator/extension-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@terminator/extension-ui')>()),
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
    groupBy: 'all',
  })
}

function fileFilters(over: Partial<FileFilters> = {}): FileFilters {
  return {
    focusMode: false,
    onToggleFocusMode: vi.fn(),
    ownedCount: 0,
    ownedOnly: false,
    onToggleOwnedOnly: vi.fn(),
    ...over,
  }
}

function renderMenu(over: Partial<FileFilters> = {}) {
  const filters = fileFilters(over)
  render(<ViewMenu filters={filters} />)
  return filters
}

beforeEach(() => {
  localStorage.clear()
  resetStore()
})

describe('ViewMenu', () => {
  it('opens the popover and shows the default state with no dot', async () => {
    renderMenu()
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(screen.getByRole('radiogroup', { name: 'Comment visibility' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: 'Agent notes' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: 'Diff view mode' })).toBeTruthy()
  })

  it.each([
    { radioName: 'Unresolved', visibility: 'unresolved' },
    { radioName: 'Hidden', visibility: 'hidden' },
  ])(
    'sets comment visibility to $visibility from the $radioName radio',
    async ({ radioName, visibility }) => {
      renderMenu()
      await userEvent.click(screen.getByRole('button', { name: 'View' }))
      const radio = screen.getByRole('radio', { name: radioName })
      await userEvent.click(radio)
      expect(radio.getAttribute('aria-checked')).toBe('true')
      expect(useReviewUiStore.getState().commentVisibility).toBe(visibility)
    }
  )

  it('shows a dot and "View (changed)" accessible name when a setting is non-default', async () => {
    useReviewUiStore.getState().setAgentNotesOn(false)
    renderMenu()
    expect(screen.getByRole('button', { name: 'View (changed)' })).toBeTruthy()
  })
})

describe('ViewMenu — says comments are hidden in the button name, not as separate text', () => {
  it('says comments are hidden in the button name, not as separate text', () => {
    useReviewUiStore.getState().setCommentVisibility('hidden')
    renderMenu()
    expect(screen.queryByText('Comments hidden')).toBeNull()
    const button = screen.getByRole('button', { name: 'View · comments hidden' })
    expect(button.getAttribute('title')).toBe('View · comments hidden')
    expect(within(button).getByTestId('vm-dot')).toBeTruthy()
  })

  it.each([
    { startOn: true, menuName: 'View', radioName: 'Off', expectedOn: false },
    { startOn: false, menuName: 'View (changed)', radioName: 'On', expectedOn: true },
  ])(
    'sets agent notes on to $expectedOn from the $radioName radio',
    async ({ startOn, menuName, radioName, expectedOn }) => {
      useReviewUiStore.getState().setAgentNotesOn(startOn)
      renderMenu()
      await userEvent.click(screen.getByRole('button', { name: menuName }))
      await userEvent.click(screen.getByRole('radio', { name: radioName }))
      expect(useReviewUiStore.getState().agentNotesOn).toBe(expectedOn)
    }
  )
})

describe('ViewMenu — diff view mode', () => {
  it('switches diff view mode to Split and back to Unified', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Split' }))
    expect(useReviewUiStore.getState().diffViewMode).toBe('split')
    await userEvent.click(screen.getByRole('radio', { name: 'Unified' }))
    expect(useReviewUiStore.getState().diffViewMode).toBe('unified')
  })
})

describe('ViewMenu — hide-formatting-hunks switch', () => {
  it('toggles hide-formatting-hunks via the switch', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    const toggle = screen.getByRole('switch', { name: /Hide formatting-only hunks/ })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await userEvent.click(toggle)
    expect(useReviewUiStore.getState().hideFormattingHunks).toBe(false)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })
})

describe('ViewMenu — files group', () => {
  it('groups the file list by chapters from the saved File list setting', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Chapters' }))
    expect(useReviewUiStore.getState().groupBy).toBe('chapters')
  })

  it('hides the file list from the Show file list switch', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    const toggle = screen.getByRole('switch', { name: /Show file list/ })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await userEvent.click(toggle)
    expect(useReviewUiStore.getState().fileListHidden).toBe(true)
  })

  it('turns on focus mode and only my files from their switches', async () => {
    const filters = renderMenu({ ownedCount: 3 })
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    await userEvent.click(screen.getByRole('switch', { name: /Focus mode/ }))
    await userEvent.click(screen.getByRole('switch', { name: /Only my files/ }))
    expect(filters.onToggleFocusMode).toHaveBeenCalledTimes(1)
    expect(filters.onToggleOwnedOnly).toHaveBeenCalledTimes(1)
  })

  it('disables Only my files and says none owned when the viewer owns no changed file', async () => {
    renderMenu({ ownedCount: 0 })
    await userEvent.click(screen.getByRole('button', { name: 'View' }))
    const toggle = screen.getByRole('switch', { name: /Only my files.*none owned/ })
    expect(toggle.hasAttribute('disabled')).toBe(true)
  })
})
