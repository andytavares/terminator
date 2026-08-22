import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { SessionRow } from '../../../../src/renderer/components/sidebar/SessionRow'
import type { TerminalSession } from '../../../../src/shared/types/index'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))

vi.mock('../../../../src/renderer/components/sidebar/MoveSessionDialog', () => ({
  MoveSessionDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="move-session-dialog">
      <button onClick={onClose}>Cancel</button>
    </div>
  ),
}))

const mockSessionStore = {
  closeSession: vi.fn().mockResolvedValue(undefined),
  renameSession: vi.fn(),
}

Object.assign(useSessionStore, {
  getState: vi.fn().mockReturnValue(mockSessionStore),
})

const makeSession = (overrides: Partial<TerminalSession> = {}): TerminalSession => ({
  id: 'sess-1',
  projectId: 'proj-1',
  tabTitle: 'my shell',
  status: 'active',
  type: 'human',
  scrollbackLimit: 1000,
  createdAt: '',
  lastActivityAt: 0,
  agentState: 'idle',
  ...overrides,
})

const defaultProps = {
  isActive: false,
  isBusy: false,
  bellCount: 0,
  workspaceColor: '#5c6bc0',
  onSelect: vi.fn(),
  onRename: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSessionStore).mockReturnValue(
    mockSessionStore as unknown as ReturnType<typeof useSessionStore>
  )
  Object.assign(useSessionStore, {
    getState: vi.fn().mockReturnValue(mockSessionStore),
  })
})

describe('SessionRow', () => {
  it('renders Terminal icon prefix for human sessions', () => {
    const { container } = render(
      <SessionRow session={makeSession({ type: 'human' })} {...defaultProps} />
    )
    expect(container.querySelector('.session-row__prefix svg')).toBeTruthy()
  })

  it('renders Bot icon prefix for agent sessions', () => {
    const { container } = render(
      <SessionRow session={makeSession({ type: 'agent' })} {...defaultProps} />
    )
    expect(container.querySelector('.session-row__prefix svg')).toBeTruthy()
  })

  it('renders the session tabTitle', () => {
    render(<SessionRow session={makeSession({ tabTitle: 'my shell' })} {...defaultProps} />)
    expect(screen.getByText('my shell')).toBeTruthy()
  })

  it('applies session-row--active class when isActive is true', () => {
    const { container } = render(<SessionRow session={makeSession()} {...defaultProps} isActive />)
    expect(container.querySelector('.session-row--active')).toBeTruthy()
  })

  it('does not apply session-row--active class when isActive is false', () => {
    const { container } = render(
      <SessionRow session={makeSession()} {...defaultProps} isActive={false} />
    )
    expect(container.querySelector('.session-row--active')).toBeNull()
  })

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    render(<SessionRow session={makeSession()} {...defaultProps} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('my shell'))
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('renders busy spinner element when isBusy is true', () => {
    const { container } = render(<SessionRow session={makeSession()} {...defaultProps} isBusy />)
    expect(container.querySelector('.session-row__spinner')).toBeTruthy()
  })

  it('does not render spinner when isBusy is false', () => {
    const { container } = render(
      <SessionRow session={makeSession()} {...defaultProps} isBusy={false} />
    )
    expect(container.querySelector('.session-row__spinner')).toBeNull()
  })

  it('renders bell badge with count when bellCount > 0', () => {
    const { container } = render(
      <SessionRow session={makeSession()} {...defaultProps} bellCount={3} />
    )
    expect(container.querySelector('.session-row__bell')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('does not render bell badge when bellCount is 0', () => {
    const { container } = render(
      <SessionRow session={makeSession()} {...defaultProps} bellCount={0} />
    )
    expect(container.querySelector('.session-row__bell')).toBeNull()
  })

  it('renders dim dot when not active, not busy, and no bell', () => {
    const { container } = render(
      <SessionRow
        session={makeSession()}
        {...defaultProps}
        isActive={false}
        isBusy={false}
        bellCount={0}
      />
    )
    expect(container.querySelector('.session-row__dot--dim')).toBeTruthy()
  })

  it('renders active dot when active and not busy', () => {
    const { container } = render(
      <SessionRow session={makeSession()} {...defaultProps} isActive isBusy={false} />
    )
    expect(container.querySelector('.session-row__dot--active')).toBeTruthy()
  })

  it('activates inline rename on double-click and calls onRename on blur', () => {
    const onRename = vi.fn()
    render(
      <SessionRow
        session={makeSession({ tabTitle: 'old name' })}
        {...defaultProps}
        onRename={onRename}
      />
    )
    const titleEl = screen.getByText('old name')
    fireEvent.dblClick(titleEl)
    const input = screen.getByDisplayValue('old name')
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: 'new name' } })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledWith('new name')
  })

  it('cancels rename on Escape key without calling onRename', () => {
    const onRename = vi.fn()
    render(
      <SessionRow
        session={makeSession({ tabTitle: 'title' })}
        {...defaultProps}
        onRename={onRename}
      />
    )
    fireEvent.dblClick(screen.getByText('title'))
    const input = screen.getByDisplayValue('title')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByText('title')).toBeTruthy()
  })

  it('commits rename on Enter key', () => {
    const onRename = vi.fn()
    render(
      <SessionRow
        session={makeSession({ tabTitle: 'original' })}
        {...defaultProps}
        onRename={onRename}
      />
    )
    fireEvent.dblClick(screen.getByText('original'))
    const input = screen.getByDisplayValue('original')
    fireEvent.change(input, { target: { value: 'renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('renamed')
  })

  describe('context menu (T029)', () => {
    it('shows context menu on right-click', () => {
      const { container } = render(<SessionRow session={makeSession()} {...defaultProps} />)
      fireEvent.contextMenu(container.querySelector('.session-row')!)
      expect(document.querySelector('.ctx-menu')).toBeTruthy()
    })

    it('context menu has Rename, Move to project, and Close options', () => {
      const { container } = render(<SessionRow session={makeSession()} {...defaultProps} />)
      fireEvent.contextMenu(container.querySelector('.session-row')!)
      const menu = document.querySelector('.ctx-menu')!
      expect(menu.textContent).toContain('Rename')
      expect(menu.textContent).toContain('Move to project')
      expect(menu.textContent).toContain('Close')
    })

    it('Rename menu item starts inline rename', () => {
      const { container } = render(
        <SessionRow session={makeSession({ tabTitle: 'shell' })} {...defaultProps} />
      )
      fireEvent.contextMenu(container.querySelector('.session-row')!)
      const renameBtn = Array.from(document.querySelectorAll('.ctx-menu__item')).find(
        (el) => el.textContent === 'Rename'
      ) as HTMLElement
      fireEvent.click(renameBtn)
      expect(screen.getByDisplayValue('shell')).toBeTruthy()
    })

    it('Close menu item calls closeSession', () => {
      const closeSession = vi.fn().mockResolvedValue(undefined)
      Object.assign(useSessionStore, {
        getState: vi.fn().mockReturnValue({ ...mockSessionStore, closeSession }),
      })
      const { container } = render(
        <SessionRow session={makeSession({ id: 'sess-99' })} {...defaultProps} />
      )
      fireEvent.contextMenu(container.querySelector('.session-row')!)
      const closeBtn = Array.from(document.querySelectorAll('.ctx-menu__item')).find((el) =>
        el.textContent?.includes('Close')
      ) as HTMLElement
      fireEvent.click(closeBtn)
      expect(closeSession).toHaveBeenCalledWith('sess-99')
    })

    it('Move to project menu item opens MoveSessionDialog', () => {
      const { container } = render(<SessionRow session={makeSession()} {...defaultProps} />)
      fireEvent.contextMenu(container.querySelector('.session-row')!)
      const moveBtn = Array.from(document.querySelectorAll('.ctx-menu__item')).find((el) =>
        el.textContent?.includes('Move')
      ) as HTMLElement
      fireEvent.click(moveBtn)
      expect(screen.getByTestId('move-session-dialog')).toBeTruthy()
    })

    it('context menu closes on outside click', () => {
      const { container } = render(<SessionRow session={makeSession()} {...defaultProps} />)
      fireEvent.contextMenu(container.querySelector('.session-row')!)
      expect(document.querySelector('.ctx-menu')).toBeTruthy()
      fireEvent.click(window)
      expect(document.querySelector('.ctx-menu')).toBeNull()
    })
  })

  describe('rename input and move dialog lifecycle', () => {
    it('does not select the row when the rename input itself is clicked', () => {
      const onSelect = vi.fn()
      const { container } = render(
        <SessionRow session={makeSession()} {...defaultProps} onSelect={onSelect} />
      )
      fireEvent.doubleClick(container.querySelector('.session-row__title')!)
      onSelect.mockClear()
      fireEvent.click(container.querySelector('.session-row__rename-input')!)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('closes the move dialog when it asks to close', () => {
      const { container } = render(<SessionRow session={makeSession()} {...defaultProps} />)
      fireEvent.contextMenu(container.querySelector('.session-row')!)
      const moveBtn = Array.from(document.querySelectorAll('.ctx-menu__item')).find((el) =>
        el.textContent?.includes('Move')
      ) as HTMLElement
      fireEvent.click(moveBtn)
      fireEvent.click(screen.getByText('Cancel'))
      expect(screen.queryByTestId('move-session-dialog')).toBeNull()
    })
  })

  describe('row anatomy for the flat list (US1)', () => {
    const NOW = 1_000_000_000

    it('shows a relative last-activity label', () => {
      render(
        <SessionRow
          session={makeSession({ lastActivityAt: NOW - 5 * 60_000 })}
          {...defaultProps}
          now={NOW}
        />
      )
      expect(screen.getByText('5m')).toBeTruthy()
    })

    it('omits the activity label when no clock is supplied', () => {
      const { container } = render(<SessionRow session={makeSession()} {...defaultProps} />)
      expect(container.querySelector('.session-row__activity')).toBeNull()
    })

    it('shows the project badge when the grouping does not already say it', () => {
      render(<SessionRow session={makeSession()} {...defaultProps} projectBadge="API" />)
      expect(screen.getByText('API')).toBeTruthy()
    })

    it('omits the project badge when the group header already names the project', () => {
      const { container } = render(<SessionRow session={makeSession()} {...defaultProps} />)
      expect(container.querySelector('.session-row__project-badge')).toBeNull()
    })

    it('opens the scope menu from the badge without selecting the row', () => {
      const onScopeClick = vi.fn()
      const onSelect = vi.fn()
      render(
        <SessionRow
          session={makeSession()}
          {...defaultProps}
          onSelect={onSelect}
          projectBadge="API"
          onScopeClick={onScopeClick}
        />
      )
      fireEvent.click(screen.getByText('API'))
      expect(onScopeClick).toHaveBeenCalledOnce()
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('marks awaiting-input with an edge bar and a text pill, not colour alone', () => {
      const { container } = render(
        <SessionRow session={makeSession({ agentState: 'awaiting-input' })} {...defaultProps} />
      )
      expect(container.querySelector('.session-row--needs-you')).toBeTruthy()
      expect(screen.getByText('needs you')).toBeTruthy()
    })

    it('does not mark a session that is not awaiting input', () => {
      const { container } = render(<SessionRow session={makeSession()} {...defaultProps} />)
      expect(container.querySelector('.session-row--needs-you')).toBeNull()
      expect(screen.queryByText('needs you')).toBeNull()
    })

    it('dims the dot for an exited session', () => {
      const { container } = render(
        <SessionRow session={makeSession({ agentState: 'exited' })} {...defaultProps} />
      )
      expect(container.querySelector('.session-row__dot--exited')).toBeTruthy()
    })

    it('shows the busy spinner ahead of any dot', () => {
      const { container } = render(
        <SessionRow session={makeSession({ agentState: 'working' })} {...defaultProps} isBusy />
      )
      expect(container.querySelector('.session-row__spinner')).toBeTruthy()
      expect(container.querySelector('.session-row__dot')).toBeNull()
    })
  })
})
