import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { ScratchSection } from '../../../../src/renderer/components/sidebar/ScratchSection'
import type { TerminalSession } from '../../../../src/shared/types/index'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))

vi.mock('../../../../src/renderer/components/sidebar/MoveSessionDialog', () => ({
  MoveSessionDialog: ({ onClose }: { sessionId: string; onClose: () => void }) => (
    <div data-testid="move-session-dialog">
      <button onClick={onClose}>close-move</button>
    </div>
  ),
}))

const mockRenameSession = vi.fn()

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
  vi.mocked(useSessionStore).mockReturnValue({
    renameSession: mockRenameSession,
  } as unknown as ReturnType<typeof useSessionStore>)
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

  it('right-click on a session row shows context menu with Rename and Move to project', () => {
    render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.contextMenu(screen.getByText('Alpha'))
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
    expect(document.querySelector('.ctx-menu')?.textContent).toContain('Rename')
    expect(document.querySelector('.ctx-menu')?.textContent).toContain('Move to project')
  })

  it('clicking Rename in context menu starts inline rename and hides menu', () => {
    const { container } = render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.contextMenu(screen.getByText('Alpha'))
    const renameBtn = Array.from(document.querySelectorAll('.ctx-menu__item')).find(
      (b) => b.textContent === 'Rename'
    ) as HTMLElement
    fireEvent.click(renameBtn)
    expect(document.querySelector('.ctx-menu')).toBeNull()
    expect(container.querySelector('.scratch-section__rename-input')).toBeTruthy()
  })

  it('clicking Move to project in context menu opens MoveSessionDialog', () => {
    render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.contextMenu(screen.getByText('Alpha'))
    const moveBtn = Array.from(document.querySelectorAll('.ctx-menu__item')).find(
      (b) => b.textContent === 'Move to project…'
    ) as HTMLElement
    fireEvent.click(moveBtn)
    expect(screen.getByTestId('move-session-dialog')).toBeTruthy()
  })

  it('closing MoveSessionDialog hides it', () => {
    render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.contextMenu(screen.getByText('Alpha'))
    const moveBtn = Array.from(document.querySelectorAll('.ctx-menu__item')).find(
      (b) => b.textContent === 'Move to project…'
    ) as HTMLElement
    fireEvent.click(moveBtn)
    fireEvent.click(screen.getByText('close-move'))
    expect(screen.queryByTestId('move-session-dialog')).toBeNull()
  })

  it('double-click on a session row starts inline rename', () => {
    const { container } = render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.doubleClick(screen.getByText('Alpha'))
    expect(container.querySelector('.scratch-section__rename-input')).toBeTruthy()
  })

  it('Enter key in rename input commits the rename', () => {
    const { container } = render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.doubleClick(screen.getByText('Alpha'))
    const input = container.querySelector('.scratch-section__rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Beta' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockRenameSession).toHaveBeenCalledWith('s1', 'Beta')
    expect(container.querySelector('.scratch-section__rename-input')).toBeNull()
  })

  it('Escape key in rename input cancels without renaming', () => {
    const { container } = render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.doubleClick(screen.getByText('Alpha'))
    const input = container.querySelector('.scratch-section__rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Beta' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(mockRenameSession).not.toHaveBeenCalled()
    expect(container.querySelector('.scratch-section__rename-input')).toBeNull()
  })

  it('blur on rename input commits the rename', () => {
    const { container } = render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.doubleClick(screen.getByText('Alpha'))
    const input = container.querySelector('.scratch-section__rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.blur(input)
    expect(mockRenameSession).toHaveBeenCalledWith('s1', 'Renamed')
  })

  it('window click closes the context menu', () => {
    render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.contextMenu(screen.getByText('Alpha'))
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
    fireEvent.click(window)
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })

  it('close-context-menus custom event closes the menu', () => {
    render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.contextMenu(screen.getByText('Alpha'))
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
    act(() => {
      window.dispatchEvent(new CustomEvent('close-context-menus'))
    })
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })

  it('rename does not call renameSession when value is empty', () => {
    const { container } = render(
      <ScratchSection
        sessions={[makeSession('s1', 'Alpha')]}
        activeSessionId={null}
        onSelectSession={mockOnSelectSession}
        onNewScratch={mockOnNewScratch}
      />
    )
    fireEvent.doubleClick(screen.getByText('Alpha'))
    const input = container.querySelector('.scratch-section__rename-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockRenameSession).not.toHaveBeenCalled()
  })
})
