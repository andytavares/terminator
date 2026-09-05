import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { TabBar } from '../../../../src/renderer/components/terminal/TabBar'
import type { ComponentType } from 'react'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/sidebar/MoveSessionDialog', () => ({
  MoveSessionDialog: ({ onClose, onMoved }: { onClose: () => void; onMoved?: () => void }) => (
    <div data-testid="move-session-dialog">
      <button onClick={onClose}>Close Move Dialog</button>
      <button onClick={onMoved}>Trigger onMoved</button>
    </div>
  ),
}))

const mockCloseSession = vi.fn()
const mockSetActive = vi.fn()
const mockGetActive = vi.fn()
const mockGetSessions = vi.fn()
const mockGetBell = vi.fn()
const mockOnNewTab = vi.fn()
const mockRenameSession = vi.fn()
const mockReorderSessions = vi.fn()

function renderTabBar(overrides: Partial<React.ComponentProps<typeof TabBar>> = {}) {
  return render(
    <TabBar
      projectId="proj-1"
      activeProjectTabId={null}
      projectTabs={[]}
      onSelectProjectTab={vi.fn()}
      onNewTab={mockOnNewTab}
      {...overrides}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSessionStore).mockReturnValue({
    getSessionsForProject: mockGetSessions,
    closeSession: mockCloseSession,
    setActiveSessionForProject: mockSetActive,
    getActiveSessionForProject: mockGetActive,
    getBellCountForSession: mockGetBell,
    isSessionBusy: vi.fn().mockReturnValue(false),
    renameSession: mockRenameSession,
    reorderSessions: mockReorderSessions,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useWorkspaceStore).mockReturnValue({
    workspaces: [],
    activeWorkspaceId: null,
    projectsByWorkspaceId: new Map(),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  mockGetSessions.mockReturnValue([])
  mockGetActive.mockReturnValue(null)
  mockGetBell.mockReturnValue(0)
})

describe('TabBar', () => {
  it('renders Terminal primary tab', () => {
    renderTabBar()
    expect(screen.getByText('Terminal')).toBeTruthy()
  })

  it('renders extension-contributed tabs', () => {
    renderTabBar({
      projectTabs: [
        {
          id: 'git',
          label: 'Git',
          component: null as unknown as ComponentType<{ repoRoot: string | null }>,
        },
      ],
    })
    expect(screen.getByText('Git')).toBeTruthy()
  })

  it('shows new tab button when Terminal is active', () => {
    renderTabBar()
    expect(screen.getByTitle('New tab (⌘T)')).toBeTruthy()
  })

  it('hides session sub-tab bar when extension tab is active', () => {
    renderTabBar({
      activeProjectTabId: 'git',
      projectTabs: [
        {
          id: 'git',
          label: 'Git',
          component: null as unknown as ComponentType<{ repoRoot: string | null }>,
        },
      ],
    })
    expect(screen.queryByTitle('New tab (⌘T)')).toBeNull()
  })

  it('renders sessions as tabs without agent badge', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
      { id: 'ses-2', tabTitle: 'Agent', type: 'human', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    expect(screen.getByText('bash')).toBeTruthy()
    expect(screen.getByText('Agent')).toBeTruthy()
    expect(screen.queryByText('agent')).toBeNull()
  })

  it('calls closeSession when close button is clicked', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    fireEvent.click(screen.getByTitle('Close tab'))
    expect(mockCloseSession).toHaveBeenCalledWith('ses-1')
  })

  it('calls onNewTab when + button is clicked', () => {
    renderTabBar()
    fireEvent.click(screen.getByTitle('New tab (⌘T)'))
    expect(mockOnNewTab).toHaveBeenCalled()
  })

  it('applies workspace color css variable when workspace matches', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [{ id: 'ws-1', color: '#ff0000', name: 'Test', folderPath: '/', tags: [] }],
      activeWorkspaceId: 'ws-1',
      projectsByWorkspaceId: new Map(),
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    const { container } = renderTabBar()
    const tabBarStack = container.querySelector('.tab-bar-stack') as HTMLElement
    expect(tabBarStack.style.getPropertyValue('--ws-color')).toBe('#ff0000')
  })

  it('calls onSelectProjectTab(null) when Terminal tab is clicked', () => {
    const onSelectProjectTab = vi.fn()
    renderTabBar({
      activeProjectTabId: 'git',
      projectTabs: [
        {
          id: 'git',
          label: 'Git',
          component: null as unknown as ComponentType<{ repoRoot: string | null }>,
        },
      ],
      onSelectProjectTab,
    })
    fireEvent.click(screen.getByText('Terminal'))
    expect(onSelectProjectTab).toHaveBeenCalledWith(null)
  })

  it('calls onSelectProjectTab with tab id when extension tab is clicked', () => {
    const onSelectProjectTab = vi.fn()
    renderTabBar({
      projectTabs: [
        {
          id: 'git',
          label: 'Git',
          component: null as unknown as ComponentType<{ repoRoot: string | null }>,
        },
      ],
      onSelectProjectTab,
    })
    fireEvent.click(screen.getByText('Git'))
    expect(onSelectProjectTab).toHaveBeenCalledWith('git')
  })

  it('calls setActiveSessionForProject when session tab is clicked', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
      { id: 'ses-2', tabTitle: 'zsh', type: 'human', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    fireEvent.click(screen.getByText('zsh'))
    expect(mockSetActive).toHaveBeenCalledWith('proj-1', 'ses-2')
  })

  it('double-click on session title shows rename input', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    fireEvent.doubleClick(screen.getByTitle('Double-click to rename'))
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('Enter in rename input commits the rename', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    fireEvent.doubleClick(screen.getByTitle('Double-click to rename'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'my-shell' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockRenameSession).toHaveBeenCalledWith('ses-1', 'my-shell')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('Escape in rename input cancels the rename', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    fireEvent.doubleClick(screen.getByTitle('Double-click to rename'))
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(mockRenameSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('blur on rename input commits the rename', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    fireEvent.doubleClick(screen.getByTitle('Double-click to rename'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'renamed' } })
    fireEvent.blur(input)
    expect(mockRenameSession).toHaveBeenCalledWith('ses-1', 'renamed')
  })

  it('close button is hidden while renaming', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    fireEvent.doubleClick(screen.getByTitle('Double-click to rename'))
    expect(screen.queryByTitle('Close tab')).toBeNull()
  })

  describe('tab reordering', () => {
    it('calls reorderSessions on drop', () => {
      mockGetSessions.mockReturnValue([
        { id: 'ses-1', tabTitle: 'Tab 1', type: 'human', agentState: 'idle' },
        { id: 'ses-2', tabTitle: 'Tab 2', type: 'human', agentState: 'idle' },
      ])
      mockGetActive.mockReturnValue('ses-1')
      renderTabBar()
      const tabs = document.querySelectorAll('.tab-bar__tab--session')
      fireEvent.dragStart(tabs[0])
      fireEvent.dragOver(tabs[1], { preventDefault: () => {} })
      fireEvent.drop(tabs[1])
      expect(mockReorderSessions).toHaveBeenCalledWith('proj-1', ['ses-2', 'ses-1'])
    })

    it('does not reorder when dropping on the same index', () => {
      mockGetSessions.mockReturnValue([
        { id: 'ses-1', tabTitle: 'Tab 1', type: 'human', agentState: 'idle' },
        { id: 'ses-2', tabTitle: 'Tab 2', type: 'human', agentState: 'idle' },
      ])
      renderTabBar()
      const tabs = document.querySelectorAll('.tab-bar__tab--session')
      fireEvent.dragStart(tabs[0])
      fireEvent.drop(tabs[0])
      expect(mockReorderSessions).not.toHaveBeenCalled()
    })
  })

  describe('context menu', () => {
    it('shows context menu on right-click of a session tab', () => {
      mockGetSessions.mockReturnValue([
        { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
      ])
      mockGetActive.mockReturnValue('ses-1')
      renderTabBar()
      const tab = screen.getByTitle('Double-click to rename').closest('.tab-bar__tab--session')!
      fireEvent.contextMenu(tab)
      expect(screen.getByText('Rename')).toBeTruthy()
      expect(screen.getByText('Move to branch…')).toBeTruthy()
      expect(screen.getByText('Close tab')).toBeTruthy()
    })

    it('opens MoveSessionDialog when Move to project is clicked', () => {
      mockGetSessions.mockReturnValue([
        { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
      ])
      mockGetActive.mockReturnValue('ses-1')
      renderTabBar()
      const tab = screen.getByTitle('Double-click to rename').closest('.tab-bar__tab--session')!
      fireEvent.contextMenu(tab)
      fireEvent.click(screen.getByText('Move to branch…'))
      expect(screen.getByTestId('move-session-dialog')).toBeTruthy()
    })

    it('closes context menu on global click', () => {
      mockGetSessions.mockReturnValue([
        { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
      ])
      mockGetActive.mockReturnValue('ses-1')
      renderTabBar()
      const tab = screen.getByTitle('Double-click to rename').closest('.tab-bar__tab--session')!
      fireEvent.contextMenu(tab)
      expect(screen.getByText('Rename')).toBeTruthy()
      fireEvent.click(window)
      expect(screen.queryByText('Rename')).toBeNull()
    })

    it('closes tab via context menu Close tab option calls closeSession', () => {
      mockGetSessions.mockReturnValue([
        { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
      ])
      mockGetActive.mockReturnValue('ses-1')
      renderTabBar()
      const tab = screen.getByTitle('Double-click to rename').closest('.tab-bar__tab--session')!
      fireEvent.contextMenu(tab)
      fireEvent.click(screen.getByText('Close tab'))
      expect(mockCloseSession).toHaveBeenCalledWith('ses-1')
    })

    it('opens rename inline via context menu Rename option', () => {
      mockGetSessions.mockReturnValue([
        { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
      ])
      mockGetActive.mockReturnValue('ses-1')
      renderTabBar()
      const tab = screen.getByTitle('Double-click to rename').closest('.tab-bar__tab--session')!
      fireEvent.contextMenu(tab)
      fireEvent.click(screen.getByText('Rename'))
      expect(screen.getByRole('textbox')).toBeTruthy()
    })
  })

  describe('MoveSessionDialog onMoved callback', () => {
    it('closes MoveSessionDialog when onMoved fires without onScratchDeactivate', () => {
      mockGetSessions.mockReturnValue([
        { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
      ])
      mockGetActive.mockReturnValue('ses-1')
      renderTabBar()
      const tab = screen.getByTitle('Double-click to rename').closest('.tab-bar__tab--session')!
      fireEvent.contextMenu(tab)
      fireEvent.click(screen.getByText('Move to branch…'))
      expect(screen.getByTestId('move-session-dialog')).toBeTruthy()
      fireEvent.click(screen.getByText('Close Move Dialog'))
      expect(screen.queryByTestId('move-session-dialog')).toBeNull()
    })

    it('calls onScratchDeactivate when MoveSessionDialog onMoved fires', () => {
      const onScratchDeactivate = vi.fn()
      mockGetSessions.mockReturnValue([
        { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
      ])
      mockGetActive.mockReturnValue('ses-1')
      renderTabBar({ onScratchDeactivate })
      const tab = screen.getByTitle('Double-click to rename').closest('.tab-bar__tab--session')!
      fireEvent.contextMenu(tab)
      fireEvent.click(screen.getByText('Move to branch…'))
      expect(screen.getByTestId('move-session-dialog')).toBeTruthy()
      fireEvent.click(screen.getByText('Trigger onMoved'))
      expect(onScratchDeactivate).toHaveBeenCalled()
      expect(screen.queryByTestId('move-session-dialog')).toBeNull()
    })
  })
})

describe('TabBar — the session bar states whose terminals it shows (US3, FR-013)', () => {
  beforeEach(() => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [{ id: 'ws-1', name: 'Terminator' }],
      activeWorkspaceId: 'ws-1',
      projectsByWorkspaceId: new Map([
        ['ws-1', [{ id: 'proj-1', workspaceId: 'ws-1', name: 'main', gitBranch: 'main' }]],
      ]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    mockGetSessions.mockReturnValue([
      { id: 's1', projectId: 'proj-1', tabTitle: 'tests', status: 'active', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('s1')
  })

  it('names the branch that owns the tabs', () => {
    const { container } = renderTabBar()
    const scope = container.querySelector('.tab-bar__scope')
    expect(scope).toBeTruthy()
    expect(scope!.textContent).toContain('main')
  })

  it('says branch, not project, in the session context menu', () => {
    const { container } = renderTabBar()
    const tab = container.querySelector('.tab-bar__tab--session')!
    fireEvent.contextMenu(tab)
    expect(screen.queryByText(/Move to project/i)).toBeNull()
    expect(screen.getByText(/Move to branch/i)).toBeTruthy()
  })
})

describe('TabBar — the terminals the sidebar stopped listing (US3)', () => {
  const session = (id: string, patch: Record<string, unknown> = {}) => ({
    id,
    projectId: 'proj-1',
    tabTitle: id,
    status: 'active',
    type: 'agent',
    scrollbackLimit: 10000,
    createdAt: '',
    lastActivityAt: 0,
    agentState: 'idle',
    ...patch,
  })

  const tabs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.tab-bar__tab--session'))

  // FR-021. The sidebar no longer carries per-terminal state, so the tab must.
  it('gives every tab its own state glyph', () => {
    mockGetSessions.mockReturnValue([
      session('a', { agentState: 'awaiting-input' }),
      session('b', { agentState: 'working' }),
      session('c', { agentState: 'idle' }),
      session('d', { agentState: 'exited' }),
    ])
    const { container } = renderTabBar()
    const states = tabs(container).map((t) =>
      t.querySelector('.tab-bar__state svg')?.getAttribute('data-state')
    )
    expect(states).toEqual(['awaiting-input', 'working', 'idle', 'exited'])
  })

  it('distinguishes the four states by shape, not by colour', () => {
    mockGetSessions.mockReturnValue([
      session('a', { agentState: 'awaiting-input' }),
      session('b', { agentState: 'working' }),
      session('c', { agentState: 'idle' }),
      session('d', { agentState: 'exited' }),
    ])
    const { container } = renderTabBar()
    const shapes = tabs(container).map((t) => t.querySelector('.tab-bar__state svg')?.innerHTML)
    expect(new Set(shapes).size).toBe(4)
    for (const t of tabs(container)) {
      const svg = t.querySelector<SVGElement>('.tab-bar__state svg')!
      expect(svg.getAttribute('style')).toBeNull()
      expect(svg.getAttribute('stroke')).toBe('currentColor')
    }
  })

  it('names the state for a reader, since a shape says nothing aloud', () => {
    mockGetSessions.mockReturnValue([session('a', { agentState: 'awaiting-input' })])
    const { container } = renderTabBar()
    expect(container.querySelector('.tab-bar__state')!.getAttribute('aria-label')).toBe(
      'Waiting on you'
    )
  })

  // FR-022.
  it('shows the unread bell count', () => {
    mockGetSessions.mockReturnValue([session('a'), session('b')])
    mockGetActive.mockReturnValue('a')
    mockGetBell.mockImplementation((id: string) => (id === 'b' ? 4 : 0))
    const { container } = renderTabBar()
    expect(container.textContent).toContain('4')
  })

  // FR-023 as amended. The note is reachable, and drawn nowhere.
  it('carries a terminal note as a tooltip and never as text', () => {
    mockGetSessions.mockReturnValue([session('a', { note: 'rebasing onto main' })])
    const { container } = renderTabBar()
    const tab = tabs(container)[0]
    expect(tab.getAttribute('title')).toContain('rebasing onto main')
    expect(tab.textContent).not.toContain('rebasing onto main')
  })

  it('falls back to the rename hint when there is no note', () => {
    mockGetSessions.mockReturnValue([session('a')])
    const { container } = renderTabBar()
    expect(tabs(container)[0].getAttribute('title')).toMatch(/rename/i)
  })

  // The cap that stops this repeating what 032 did to the 24px row.
  it('draws no more than four elements on a tab', () => {
    mockGetSessions.mockReturnValue([session('a', { agentState: 'awaiting-input', note: 'x' })])
    mockGetActive.mockReturnValue('a')
    mockGetBell.mockReturnValue(9)
    const { container } = renderTabBar()
    expect(tabs(container)[0].children.length).toBeLessThanOrEqual(4)
  })

  it('offers close on the active tab only', () => {
    mockGetSessions.mockReturnValue([session('a'), session('b')])
    mockGetActive.mockReturnValue('a')
    const { container } = renderTabBar()
    const [a, b] = tabs(container)
    expect(a.querySelector('.tab-bar__close')).toBeTruthy()
    expect(b.querySelector('.tab-bar__close')).toBeNull()
  })

  // FR-024. Everything the sidebar row could do, the tab still can.
  it('still renames, closes and moves from the tab', () => {
    mockGetSessions.mockReturnValue([session('a')])
    mockGetActive.mockReturnValue('a')
    const { container } = renderTabBar()
    const tab = tabs(container)[0]

    fireEvent.click(tab.querySelector('.tab-bar__close')!)
    expect(mockCloseSession).toHaveBeenCalledWith('a')

    fireEvent.contextMenu(tab)
    expect(screen.getByText(/Move to branch/i)).toBeTruthy()
    expect(screen.getByText(/Rename/i)).toBeTruthy()
  })

  it('marks the row overflowed so the hidden tabs are discoverable', () => {
    mockGetSessions.mockReturnValue(Array.from({ length: 12 }, (_, i) => session(`s${i}`)))
    const { container } = renderTabBar()
    expect(container.querySelector('.tab-bar--sessions')!.classList.toString()).toMatch(
      /tab-bar--scrollable/
    )
  })
})
