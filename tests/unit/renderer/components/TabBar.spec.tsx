import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import { useBreakoutStore } from '../../../../src/renderer/stores/breakout.store'
import { useTabDragStore } from '../../../../src/renderer/terminal/tab-drag'
import { TabBar } from '../../../../src/renderer/components/terminal/TabBar'
import { projectFixture, seedStore, workspaceFixture } from '../../../support/renderer-stores'
import { partialFake } from '../../../support/fakes'

const records = {
  setDescription: vi.fn().mockResolvedValue(true),
  setLink: vi.fn().mockResolvedValue(true),
}
vi.mock('../../../../src/renderer/components/session/SessionLinkDialog', () => ({
  SessionLinkDialog: ({
    facts,
    onClose,
  }: {
    facts: { sessionId: string }
    onClose: () => void
  }) => (
    <div data-testid="session-link-dialog">
      {facts.sessionId}
      <button onClick={onClose}>close-session-link</button>
    </div>
  ),
}))
// The tab's description and work item come from the session's facts. Here
// every session the tab bar lists carries `description` and `workItem`
// fields directly, for the test.
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () =>
    (mockGetSessions() ?? []).map(
      (s: {
        id: string
        description?: string
        workItem?: { source: 'session' | 'project'; ref: { tracker: string; key: string } }
      }) => ({
        sessionId: s.id,
        description: s.description ?? null,
        workItem: s.workItem ?? null,
        snapshot: { sessionId: s.id },
      })
    ),
}))
vi.mock('../../../../src/renderer/components/sidebar/MoveSessionDialog', () => ({
  MoveSessionDialog: ({ onClose, onMoved }: { onClose: () => void; onMoved?: () => void }) => (
    <div data-testid="move-session-dialog">
      <button onClick={onClose}>Close Move Dialog</button>
      <button onClick={onMoved}>Trigger onMoved</button>
    </div>
  ),
}))

const breakOut = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/breakout', () => ({ breakOut }))
const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

const mockCloseSession = vi.fn()
const mockSetActive = vi.fn()
const mockRequestFocus = vi.fn()
const mockGetActive = vi.fn()
const mockGetSessions = vi.fn()
const mockGetBell = vi.fn()
const mockOnNewTab = vi.fn()
const mockRenameSession = vi.fn()
const mockReorderSessions = vi.fn()

/** Inside jsdom's window, which sits at 0,0 and is 1024x768. */
const IN_WINDOW = { x: 300, y: 20 }
const OUTSIDE_WINDOW = { x: 1500, y: 40 }

function pointerAt(type: string, at: { x: number; y: number }): void {
  act(() => {
    document.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 1, screenX: at.x, screenY: at.y })
    )
  })
}

/** Presses on the tab and moves the pointer far enough to make it a drag, over `over`. */
function startTabDrag(tab: Element, over: Element | null = null): void {
  document.elementFromPoint = () => over
  HTMLElement.prototype.setPointerCapture = vi.fn()
  fireEvent.pointerDown(tab, { button: 0, pointerId: 1, screenX: 290, screenY: 20 })
  pointerAt('pointermove', IN_WINDOW)
}

/** A whole drag of `tab`, let go at `to` over `over`. */
function dragTab(tab: Element, over: Element | null, to = IN_WINDOW): void {
  startTabDrag(tab, over)
  pointerAt('pointerup', to)
}

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
  seedStore(useSessionRecordsStore, records)
  seedStore(useBreakoutStore, { windows: new Map() })
  useTabDragStore.setState({ sessionId: null, overSessionId: null, overMainWindow: false })
  seedStore(useSessionStore, {
    getSessionsForProject: mockGetSessions,
    closeSession: mockCloseSession,
    setActiveSessionForProject: mockSetActive,
    getActiveSessionForProject: mockGetActive,
    getBellCountForSession: mockGetBell,
    isSessionBusy: vi.fn().mockReturnValue(false),
    renameSession: mockRenameSession,
    reorderSessions: mockReorderSessions,
    requestFocus: mockRequestFocus,
  })
  seedStore(useWorkspaceStore, {
    workspaces: [],
    activeWorkspaceId: null,
    projectsByWorkspaceId: new Map(),
  })
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
          component: () => null,
        },
      ],
    })
    expect(screen.getByText('Git')).toBeTruthy()
  })

  it('shows new tab button when Terminal is active', () => {
    renderTabBar()
    expect(screen.getByTitle('New tab (⌘T)')).toBeTruthy()
  })
})

describe('TabBar — hides session sub-tab bar when extension tab is active', () => {
  it('hides session sub-tab bar when extension tab is active', () => {
    renderTabBar({
      activeProjectTabId: 'git',
      projectTabs: [
        {
          id: 'git',
          label: 'Git',
          component: () => null,
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
})

describe('TabBar — calls closeSession when close button is clicked', () => {
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
    seedStore(useWorkspaceStore, {
      workspaces: [
        workspaceFixture({ id: 'ws-1', color: '#ff0000', name: 'Test', folderPath: '/', tags: [] }),
      ],
      activeWorkspaceId: 'ws-1',
      projectsByWorkspaceId: new Map(),
    })
    const { container } = renderTabBar()
    const tabBarStack = container.querySelector('.tab-bar-stack') as HTMLElement
    expect(tabBarStack.style.getPropertyValue('--ws-color')).toBe('#ff0000')
  })
})

describe('TabBar — calls onSelectProjectTab(null) when Terminal tab is clicked', () => {
  it('calls onSelectProjectTab(null) when Terminal tab is clicked', () => {
    const onSelectProjectTab = vi.fn()
    renderTabBar({
      activeProjectTabId: 'git',
      projectTabs: [
        {
          id: 'git',
          label: 'Git',
          component: () => null,
        },
      ],
      onSelectProjectTab,
    })
    fireEvent.click(screen.getByText('Terminal'))
    expect(onSelectProjectTab).toHaveBeenCalledWith(null)
  })
})

describe('TabBar — calls onSelectProjectTab with tab id when extension tab is clicked', () => {
  it('calls onSelectProjectTab with tab id when extension tab is clicked', () => {
    const onSelectProjectTab = vi.fn()
    renderTabBar({
      projectTabs: [
        {
          id: 'git',
          label: 'Git',
          component: () => null,
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
    expect(mockRequestFocus).toHaveBeenCalledWith('ses-2')
  })
})

describe('TabBar — double-click on session title shows rename input', () => {
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
})

describe('TabBar — Escape in rename input cancels the rename', () => {
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
})

describe('TabBar — close button is hidden while renaming', () => {
  it('close button is hidden while renaming', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    fireEvent.doubleClick(screen.getByTitle('Double-click to rename'))
    expect(screen.queryByTitle('Close tab')).toBeNull()
  })
})

describe('TabBar — tab reordering', () => {
  it('calls reorderSessions on drop', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'Tab 1', type: 'human', agentState: 'idle' },
      { id: 'ses-2', tabTitle: 'Tab 2', type: 'human', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    const tabs = document.querySelectorAll('.tab-bar__tab--session')
    dragTab(tabs[0], tabs[1])
    expect(mockReorderSessions).toHaveBeenCalledWith('proj-1', ['ses-2', 'ses-1'])
  })

  it('does not reorder when dropping on the same index', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'Tab 1', type: 'human', agentState: 'idle' },
      { id: 'ses-2', tabTitle: 'Tab 2', type: 'human', agentState: 'idle' },
    ])
    renderTabBar()
    const tabs = document.querySelectorAll('.tab-bar__tab--session')
    dragTab(tabs[0], tabs[0])
    expect(mockReorderSessions).not.toHaveBeenCalled()
  })
})

describe('TabBar — context menu', () => {
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
})

describe('TabBar — context menu — closes context menu on global click', () => {
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
})

describe('TabBar — context menu — opens rename inline via context menu Rename option', () => {
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

describe('TabBar — session work item', () => {
  it('draws a key chip for a session with its own link', () => {
    mockGetSessions.mockReturnValue([
      {
        id: 'ses-1',
        tabTitle: 'bash',
        type: 'human',
        agentState: 'idle',
        workItem: { source: 'session', ref: { tracker: 'linear', key: 'ENG-4' } },
      },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    expect(screen.getByText('ENG-4')).toBeTruthy()
  })

  it('offers only "Link issue…" when the tab has no own link', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    const tab = screen.getByTitle('Double-click to rename').closest('.tab-bar__tab--session')!
    fireEvent.contextMenu(tab)
    expect(screen.getByText('Link issue…')).toBeTruthy()
    expect(screen.queryByText('Remove session link')).toBeNull()
    fireEvent.click(screen.getByText('Link issue…'))
    expect(screen.getByTestId('session-link-dialog')).toBeTruthy()
  })
})

describe('TabBar — session work item — offers change and remove, and removes via the records store, when the tab has its own link', () => {
  it('offers change and remove, and removes via the records store, when the tab has its own link', () => {
    mockGetSessions.mockReturnValue([
      {
        id: 'ses-1',
        tabTitle: 'bash',
        type: 'human',
        agentState: 'idle',
        workItem: { source: 'session', ref: { tracker: 'linear', key: 'ENG-4' } },
      },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    const tab = screen.getByTitle('Double-click to rename').closest('.tab-bar__tab--session')!
    fireEvent.contextMenu(tab)
    expect(screen.getByText('Change linked issue…')).toBeTruthy()
    fireEvent.click(screen.getByText('Remove session link'))
    expect(records.setLink).toHaveBeenCalledWith({ sessionId: 'ses-1' }, null)
  })
})

describe('TabBar — MoveSessionDialog onMoved callback', () => {
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

/** The hooks every "TabBar — the session bar states whose terminals it shows (US3, FR-013)" describe registers. */
function setUpTabBarTheSessionBar(): void {
  beforeEach(() => {
    seedStore(useWorkspaceStore, {
      workspaces: [workspaceFixture({ id: 'ws-1', name: 'Terminator' })],
      activeWorkspaceId: 'ws-1',
      projectsByWorkspaceId: new Map([
        [
          'ws-1',
          [projectFixture({ id: 'proj-1', workspaceId: 'ws-1', name: 'main', gitBranch: 'main' })],
        ],
      ]),
    })
    mockGetSessions.mockReturnValue([
      { id: 's1', projectId: 'proj-1', tabTitle: 'tests', status: 'active', agentState: 'idle' },
    ])
    mockGetActive.mockReturnValue('s1')
  })
}

describe('TabBar — the session bar states whose terminals it shows (US3, FR-013)', () => {
  setUpTabBarTheSessionBar()

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

// A session's state is never stored: it is derived from these signals, so a
// tab is seeded with the signal, not with a stored `agentState` nothing sets.
const EACH_STATE = [
  session('a', { bellCount: 1 }),
  session('b', { busy: true }),
  session('c'),
  session('d', { status: 'closed' }),
]

describe('TabBar — the terminals the sidebar stopped listing (US3)', () => {
  // FR-021. The sidebar no longer carries per-terminal state, so the tab must.
  it('gives every tab its own state glyph', () => {
    mockGetSessions.mockReturnValue(EACH_STATE)
    const { container } = renderTabBar()
    const states = tabs(container).map((t) =>
      t.querySelector('.tab-bar__state svg')?.getAttribute('data-state')
    )
    expect(states).toEqual(['awaiting-input', 'working', 'idle', 'exited'])
  })

  it('distinguishes the four states by shape, not by colour', () => {
    mockGetSessions.mockReturnValue(EACH_STATE)
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
    mockGetSessions.mockReturnValue([session('a', { bellCount: 1 })])
    const { container } = renderTabBar()
    expect(container.querySelector('.tab-bar__state')!.getAttribute('aria-label')).toBe(
      'Waiting on you'
    )
  })
})

describe('TabBar — the terminals the sidebar stopped listing (US3) — shows the unread bell count', () => {
  // FR-022.
  it('shows the unread bell count', () => {
    mockGetSessions.mockReturnValue([session('a'), session('b')])
    mockGetActive.mockReturnValue('a')
    mockGetBell.mockImplementation((id: string) => (id === 'b' ? 4 : 0))
    const { container } = renderTabBar()
    expect(container.textContent).toContain('4')
  })

  // FR-023 as amended. The description is reachable, and drawn nowhere.
  it("carries a terminal's description as a tooltip and never as text", () => {
    mockGetSessions.mockReturnValue([session('a', { description: 'rebasing onto main' })])
    const { container } = renderTabBar()
    const tab = tabs(container)[0]
    expect(tab.getAttribute('title')).toContain('rebasing onto main')
    expect(tab.textContent).not.toContain('rebasing onto main')
  })

  it('falls back to the rename hint when there is no description', () => {
    mockGetSessions.mockReturnValue([session('a')])
    const { container } = renderTabBar()
    expect(tabs(container)[0].getAttribute('title')).toMatch(/rename/i)
  })
})

describe('TabBar — the terminals the sidebar stopped listing (US3) — draws no more than four elements on a tab', () => {
  // The cap that stops this repeating what 032 did to the 24px row.
  it('draws no more than four elements on a tab', () => {
    mockGetSessions.mockReturnValue([
      session('a', { agentState: 'awaiting-input', description: 'x' }),
    ])
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
})

describe('TabBar — the terminals the sidebar stopped listing (US3) — still renames, closes and moves from the tab', () => {
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

const noted = (patch: Record<string, unknown> = {}) => ({
  id: 'ses-1',
  projectId: 'proj-1',
  tabTitle: 'claude',
  status: 'active',
  type: 'human',
  agentState: 'idle',
  ...patch,
})

/** The hooks every "TabBar — the description, edited from the tab (054 FR-006)" describe registers. */
function setUpTabBarTheDescriptionEdited(): void {
  beforeEach(() => {
    seedStore(useSessionStore, {
      getSessionsForProject: mockGetSessions,
      closeSession: mockCloseSession,
      setActiveSessionForProject: mockSetActive,
      getActiveSessionForProject: mockGetActive,
      getBellCountForSession: mockGetBell,
      isSessionBusy: vi.fn().mockReturnValue(false),
      renameSession: mockRenameSession,
      reorderSessions: mockReorderSessions,
      requestFocus: mockRequestFocus,
    })
    mockGetSessions.mockReturnValue([noted()])
    mockGetActive.mockReturnValue('ses-1')
  })
}

describe('TabBar — the description, edited from the tab (054 FR-006)', () => {
  setUpTabBarTheDescriptionEdited()

  it('opens the editor when the shortcut names a terminal', () => {
    const { container } = renderTabBar({ editNoteSessionId: 'ses-1' })
    expect(container.querySelector('.tab-bar__note-input')).toBeTruthy()
  })

  it('opens with the description already there, so editing is not retyping', () => {
    mockGetSessions.mockReturnValue([noted({ description: 'rebasing' })])
    const { container } = renderTabBar({ editNoteSessionId: 'ses-1' })
    expect(container.querySelector<HTMLInputElement>('.tab-bar__note-input')!.value).toBe(
      'rebasing'
    )
  })

  it('ignores a shortcut naming a terminal that is not here', () => {
    const { container } = renderTabBar({ editNoteSessionId: 'gone' })
    expect(container.querySelector('.tab-bar__note-input')).toBeNull()
  })

  it('opens nothing when the shortcut names no terminal', () => {
    const { container } = renderTabBar({ editNoteSessionId: null })
    expect(container.querySelector('.tab-bar__note-input')).toBeNull()
  })
})

describe('TabBar — the description, edited from the tab (054 FR-006) — saves on Enter', () => {
  setUpTabBarTheDescriptionEdited()

  it('saves on Enter', () => {
    const { container } = renderTabBar({ editNoteSessionId: 'ses-1' })
    const input = container.querySelector<HTMLInputElement>('.tab-bar__note-input')!
    fireEvent.change(input, { target: { value: 'rebasing onto main' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(records.setDescription).toHaveBeenCalledWith(
      { sessionId: 'ses-1' },
      'rebasing onto main'
    )
    expect(container.querySelector('.tab-bar__note-input')).toBeNull()
  })

  it('saves on blur', () => {
    const { container } = renderTabBar({ editNoteSessionId: 'ses-1' })
    const input = container.querySelector<HTMLInputElement>('.tab-bar__note-input')!
    fireEvent.change(input, { target: { value: 'blurred' } })
    fireEvent.blur(input)
    expect(records.setDescription).toHaveBeenCalledWith({ sessionId: 'ses-1' }, 'blurred')
  })

  it('abandons on Escape', () => {
    const { container } = renderTabBar({ editNoteSessionId: 'ses-1' })
    const input = container.querySelector<HTMLInputElement>('.tab-bar__note-input')!
    fireEvent.change(input, { target: { value: 'nope' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(records.setDescription).not.toHaveBeenCalled()
    expect(container.querySelector('.tab-bar__note-input')).toBeNull()
  })
})

describe('TabBar — the description, edited from the tab (054 FR-006) — does not switch terminal while typing in the editor', () => {
  setUpTabBarTheDescriptionEdited()

  it('does not switch terminal while typing in the editor', () => {
    const { container } = renderTabBar({ editNoteSessionId: 'ses-1' })
    fireEvent.click(container.querySelector('.tab-bar__note-input')!)
    expect(mockSetActive).not.toHaveBeenCalled()
  })

  it('bounds the description at the length a record keeps', () => {
    const { container } = renderTabBar({ editNoteSessionId: 'ses-1' })
    expect(container.querySelector('.tab-bar__note-input')!.getAttribute('maxLength')).toBe('500')
  })

  it('clears the description when saved empty', () => {
    mockGetSessions.mockReturnValue([noted({ description: 'rebasing' })])
    const { container } = renderTabBar({ editNoteSessionId: 'ses-1' })
    const input = container.querySelector<HTMLInputElement>('.tab-bar__note-input')!
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(records.setDescription).toHaveBeenCalledWith({ sessionId: 'ses-1' }, null)
  })

  it('does not write when an empty editor is left empty', () => {
    const { container } = renderTabBar({ editNoteSessionId: 'ses-1' })
    fireEvent.blur(container.querySelector('.tab-bar__note-input')!)
    expect(records.setDescription).not.toHaveBeenCalled()
  })
})

describe('TabBar — the description, edited from the tab (054 FR-006) — offers adding a description from the tab menu', () => {
  setUpTabBarTheDescriptionEdited()

  it('offers adding a description from the tab menu', () => {
    const { container } = renderTabBar()
    fireEvent.contextMenu(container.querySelector('.tab-bar__tab--session')!)
    fireEvent.click(screen.getByText('Add description…'))
    expect(container.querySelector('.tab-bar__note-input')).toBeTruthy()
  })

  it('offers editing an existing description instead', () => {
    mockGetSessions.mockReturnValue([noted({ description: 'rebasing' })])
    const { container } = renderTabBar()
    fireEvent.contextMenu(container.querySelector('.tab-bar__tab--session')!)
    expect(screen.getByText('Edit description…')).toBeTruthy()
  })
})

describe('TabBar — the drop target', () => {
  const twoTabs = () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'Tab 1', type: 'human', agentState: 'idle' },
      { id: 'ses-2', tabTitle: 'Tab 2', type: 'human', agentState: 'idle' },
    ])
    renderTabBar()
    return document.querySelectorAll('.tab-bar__tab--session')
  }

  it('marks the tab a drag is over, and unmarks it when the pointer moves off it', () => {
    const tabs = twoTabs()
    startTabDrag(tabs[0], tabs[1])
    expect(tabs[1].classList.contains('tab-bar__tab--dnd-over')).toBe(true)
    expect(tabs[0].classList.contains('tab-bar__tab--dragging')).toBe(true)
    document.elementFromPoint = () => null
    pointerAt('pointermove', { x: 600, y: 300 })
    expect(tabs[1].classList.contains('tab-bar__tab--dnd-over')).toBe(false)
  })

  it('unmarks it, and moves nothing, when Escape cancels the drag', () => {
    const tabs = twoTabs()
    startTabDrag(tabs[0], tabs[1])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(tabs[1].classList.contains('tab-bar__tab--dnd-over')).toBe(false)
    pointerAt('pointerup', IN_WINDOW)
    expect(mockReorderSessions).not.toHaveBeenCalled()
  })
})

const threeTabs = [
  { id: 'ses-1', tabTitle: 'Tab 1', type: 'human', agentState: 'idle' },
  { id: 'ses-2', tabTitle: 'Tab 2', type: 'human', agentState: 'idle' },
  { id: 'ses-3', tabTitle: 'Tab 3', type: 'human', agentState: 'idle' },
]

function tabTitles(): string[] {
  return [...document.querySelectorAll('.tab-bar__tab--session .tab-bar__title')].map(
    (title) => title.textContent ?? ''
  )
}

describe('TabBar — a terminal in its own window', () => {
  beforeEach(() => mockGetSessions.mockReturnValue(threeTabs))

  it('draws no tab for it and keeps the order of the others', () => {
    seedStore(useBreakoutStore, { windows: new Map([['ses-2', window]]) })
    renderTabBar()
    expect(tabTitles()).toEqual(['Tab 1', 'Tab 3'])
  })

  it('draws the tab back in its slot once it is docked', () => {
    seedStore(useBreakoutStore, { windows: new Map([['ses-2', window]]) })
    renderTabBar()
    act(() => useBreakoutStore.setState({ windows: new Map() }))
    expect(tabTitles()).toEqual(['Tab 1', 'Tab 2', 'Tab 3'])
  })

  it('keeps its slot in the saved order when the visible tabs are reordered', () => {
    seedStore(useBreakoutStore, { windows: new Map([['ses-2', window]]) })
    renderTabBar()
    const tabs = document.querySelectorAll('.tab-bar__tab--session')
    dragTab(tabs[0], tabs[1])
    expect(mockReorderSessions).toHaveBeenCalledWith('proj-1', ['ses-3', 'ses-2', 'ses-1'])
  })
})

describe('TabBar — dragging a tab out', () => {
  beforeEach(() => mockGetSessions.mockReturnValue(threeTabs))

  it('opens its own window where it is let go, the moment it is let go outside every window', () => {
    renderTabBar()
    dragTab(document.querySelectorAll('.tab-bar__tab--session')[0], null, OUTSIDE_WINDOW)
    expect(breakOut).toHaveBeenCalledWith('ses-1', OUTSIDE_WINDOW)
  })

  it('counts a drag out as a break-out, and a drop inside the window as nothing', () => {
    recordUse.mockClear()
    renderTabBar()
    const tab = document.querySelectorAll('.tab-bar__tab--session')[0]
    dragTab(tab, null, { x: 600, y: 500 })
    expect(recordUse).not.toHaveBeenCalled()
    dragTab(tab, null, OUTSIDE_WINDOW)
    expect(recordUse).toHaveBeenCalledWith('core.break-out', 'click', expect.anything())
  })

  it('stays put when let go inside the window but not on a tab', () => {
    renderTabBar()
    dragTab(document.querySelectorAll('.tab-bar__tab--session')[0], null, { x: 600, y: 500 })
    expect(breakOut).not.toHaveBeenCalled()
    expect(mockReorderSessions).not.toHaveBeenCalled()
  })
})

describe('TabBar — a tab let go somewhere it does not leave from', () => {
  beforeEach(() => mockGetSessions.mockReturnValue(threeTabs))

  it('stays put when let go over a terminal that is already in its own window', () => {
    const own = partialFake<Window>({
      screenX: 1400,
      screenY: 0,
      outerWidth: 600,
      outerHeight: 400,
    })
    seedStore(useBreakoutStore, { windows: new Map([['ses-3', own]]) })
    renderTabBar()
    dragTab(document.querySelectorAll('.tab-bar__tab--session')[0], null, OUTSIDE_WINDOW)
    expect(breakOut).not.toHaveBeenCalled()
  })

  it('is not a click on the tab: the dragged tab is not selected', () => {
    renderTabBar()
    const tab = document.querySelectorAll('.tab-bar__tab--session')[1]
    dragTab(tab, null, OUTSIDE_WINDOW)
    fireEvent.click(tab)
    expect(mockSetActive).not.toHaveBeenCalled()
  })
})
