import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScratchSection } from '../../../../src/renderer/components/sidebar/ScratchSection'
import type { TerminalSession } from '../../../../src/shared/types/index'

const makeSession = (id: string, title = 'Scratch'): TerminalSession => ({
  id,
  projectId: 'scratch',
  tabTitle: title,
  status: 'active',
  type: 'human',
  scrollbackLimit: 1000,
  createdAt: '',
})

const mockOnSelectSession = vi.fn()
const mockOnNewScratch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ScratchSection', () => {
  it('renders a session row for each session', () => {
    render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha'), makeSession('s2', 'Beta')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('renders "New scratch terminal" add row', () => {
    render(
      <ScratchSection
        sessions={[]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    expect(screen.getByText(/new scratch terminal/i)).toBeTruthy()
  })

  it('calls onSelectSession with the session id when a row is clicked', () => {
    render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.click(screen.getByText('Alpha'))
    expect(mockOnSelectSession).toHaveBeenCalledWith('s1')
  })

  it('calls onNewScratch when the add row is clicked', () => {
    render(
      <ScratchSection
        sessions={[]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.click(screen.getByText(/new scratch terminal/i))
    expect(mockOnNewScratch).toHaveBeenCalledOnce()
  })

  it('applies active class to the active session row', () => {
    const { container } = render(
      <ScratchSection
        sessions={[makeSession('s1', 'Active'), makeSession('s2', 'Idle')]}
        activeSessionId="s1"
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    const activeRow = container.querySelector('.scratch-section__row--active')
    expect(activeRow).toBeTruthy()
    expect(activeRow?.textContent).toContain('Active')
  })
})
