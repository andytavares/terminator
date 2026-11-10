import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSessionStore } from '../../../../src/stores/session.store'
import { useWorkspaceStore } from '../../../../src/stores/workspace.store'
import { useSessionRecordsStore } from '../../../../src/stores/session-records.store'
import { useBreakoutStore } from '../../../../src/stores/breakout.store'
import { useTabDragStore } from '../../../../src/terminal/tab-drag'
import { TabBar } from '../../../../src/components/terminal/TabBar'
import type { ElectronAPI } from '../../../../../core-shared/src/electron-api/api-type'
import type {
  SessionRecordListing,
  TerminalSession,
} from '../../../../../core-shared/src/types/index'
import {
  projectFixture,
  resetStore,
  seedStore,
  sessionRecordOf,
  terminalSessionOf,
  workspaceFixture,
} from '../../../../../test-support/src/renderer-stores'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import { partialFake } from '../../../../../test-support/src/fakes'
import { eventually } from '../../../../../test-support/src/eventually'

vi.mock('../../../../src/components/session/SessionLinkDialog', () => ({
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
vi.mock('../../../../src/components/sidebar/MoveSessionDialog', () => ({
  MoveSessionDialog: ({ onClose, onMoved }: { onClose: () => void; onMoved?: () => void }) => (
    <div data-testid="move-session-dialog">
      <button onClick={onClose}>Close Move Dialog</button>
      <button onClick={onMoved}>Trigger onMoved</button>
    </div>
  ),
}))

const breakOut = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/terminal/breakout', () => ({ breakOut }))
const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/usage/record', () => ({ recordUse }))
const attachSessions = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/stores/attached-context.store', () => ({ attachSessions }))

const mockOnNewTab = vi.fn()

/** Main's side of the IPC the tab bar's stores write through. */
const terminalClose = vi.fn<ElectronAPI['terminal']['close']>(async () => ({ success: true }))
const setDescription = vi.fn<ElectronAPI['sessionRecords']['setDescription']>(
  async ({ session, description }) => ({ data: sessionRecordOf(session, { description }) })
)
const setLink = vi.fn<ElectronAPI['sessionRecords']['setLink']>(async ({ session, link }) => ({
  data: sessionRecordOf(session, { link }),
}))

/** Inside jsdom's window, which sits at 0,0 and is 1024x768. */
const IN_WINDOW = { x: 300, y: 20 }
const OUTSIDE_WINDOW = { x: 1500, y: 40 }

/** A terminal on the branch the tab bar shows, titled with its id unless `patch` says. */
const session = (id: string, patch: Partial<TerminalSession> = {}): TerminalSession =>
  terminalSessionOf({ id, projectId: 'proj-1', ...patch })

/** Puts `sessions` in the real session store, with `activeSessionId` the branch's shown tab. */
function seedSessions(sessions: TerminalSession[], activeSessionId?: string): void {
  resetStore(useSessionStore, {
    sessions: new Map(sessions.map((s) => [s.id, s])),
    projectViews: activeSessionId ? new Map([['proj-1', { activeSessionId }]]) : new Map(),
  })
}

/** The record main keeps for a session on this branch, with `overrides` on top. */
function recordOf(
  sessionId: string,
  overrides: Partial<SessionRecordListing> = {}
): SessionRecordListing {
  const snapshot = {
    sessionId,
    projectId: 'proj-1',
    workspaceName: null,
    projectName: null,
    branch: null,
    tabTitle: sessionId,
    shell: null,
    startedAt: '',
  }
  return sessionRecordOf(snapshot, overrides)
}

function seedRecords(...records: SessionRecordListing[]): void {
  resetStore(useSessionRecordsStore, { records: new Map(records.map((r) => [r.sessionId, r])) })
}

const sessionTabs = () => screen.queryAllByRole('tab')
const isActive = (tab: Element) => tab.getAttribute('aria-selected') === 'true'
const savedOrder = () => useSessionStore.getState().projectViews.get('proj-1')?.order

function tabTitles(): string[] {
  return sessionTabs().map((tab) => tab.getAttribute('aria-label') ?? '')
}

function pointerAt(
  type: string,
  at: { x: number; y: number },
  target: EventTarget = document
): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 1, screenX: at.x, screenY: at.y })
    )
  })
}

/** Presses on the tab and moves the pointer far enough to make it a drag, over `over`. */
function startTabDrag(tab: Element, over: Element | null = null): void {
  document.elementFromPoint = () => over
  HTMLElement.prototype.setPointerCapture = vi.fn()
  // The drag measures from screenX/screenY, like the moves pointerAt sends after the press.
  pointerAt('pointerdown', { x: 290, y: 20 }, tab)
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

afterEach(() => {
  // A drag listens on the document until it ends, so end any drag a failed test left open.
  act(() => {
    document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }))
  })
  // jsdom has neither; startTabDrag adds them.
  Reflect.deleteProperty(document, 'elementFromPoint')
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
})

beforeEach(() => {
  vi.clearAllMocks()
  installElectronApi({
    terminal: { close: terminalClose },
    sessionRecords: {
      // Main holds the records the mirror was seeded with; the tab bar reloads them on mount.
      list: async () => ({ data: [...useSessionRecordsStore.getState().records.values()] }),
      setDescription,
      setLink,
    },
  })
  seedRecords()
  seedSessions([])
  seedStore(useBreakoutStore, { windows: new Map() })
  useTabDragStore.setState({
    sessionId: null,
    overSessionId: null,
    overMainWindow: false,
    overContextDrop: null,
  })
  seedStore(useWorkspaceStore, {
    workspaces: [],
    activeWorkspaceId: null,
    projectsByWorkspaceId: new Map(),
  })
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
    seedSessions(
      [session('ses-1', { tabTitle: 'bash' }), session('ses-2', { tabTitle: 'Agent' })],
      'ses-1'
    )
    renderTabBar()
    expect(screen.getByText('bash')).toBeTruthy()
    expect(screen.getByText('Agent')).toBeTruthy()
    expect(screen.queryByText('agent')).toBeNull()
  })
})

describe('TabBar — the close button', () => {
  it('closes the terminal and removes its tab when the close button is clicked', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    await user.click(screen.getByTitle('Close tab'))
    expect(terminalClose).toHaveBeenCalledWith('ses-1')
    await eventually(() => expect(screen.queryByText('bash')).toBeNull())
  })

  it('calls onNewTab when + button is clicked', async () => {
    const user = userEvent.setup()
    renderTabBar()
    await user.click(screen.getByTitle('New tab (⌘T)'))
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
    // eslint-disable-next-line testing-library/no-node-access -- the tint is a CSS variable on the row's wrapper, which has no role
    const tabBarStack = container.querySelector('.tab-bar-stack') as HTMLElement
    expect(tabBarStack.style.getPropertyValue('--ws-color')).toBe('#ff0000')
  })
})

describe('TabBar — calls onSelectProjectTab(null) when Terminal tab is clicked', () => {
  it('calls onSelectProjectTab(null) when Terminal tab is clicked', async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByText('Terminal'))
    expect(onSelectProjectTab).toHaveBeenCalledWith(null)
  })
})

describe('TabBar — calls onSelectProjectTab with tab id when extension tab is clicked', () => {
  it('calls onSelectProjectTab with tab id when extension tab is clicked', async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByText('Git'))
    expect(onSelectProjectTab).toHaveBeenCalledWith('git')
  })

  it('makes a clicked session tab the active one and gives it the keyboard', async () => {
    const user = userEvent.setup()
    seedSessions(
      [session('ses-1', { tabTitle: 'bash' }), session('ses-2', { tabTitle: 'zsh' })],
      'ses-1'
    )
    renderTabBar()
    await user.click(screen.getByText('zsh'))
    expect(sessionTabs().map(isActive)).toEqual([false, true])
    expect(useSessionStore.getState().focusRequest?.sessionId).toBe('ses-2')
  })
})

describe('TabBar — double-click on session title shows rename input', () => {
  it('double-click on session title shows rename input', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    await user.dblClick(screen.getByTitle('Double-click to rename'))
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('shows the new title on the tab when Enter commits the rename', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    await user.dblClick(screen.getByTitle('Double-click to rename'))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'my-shell{Enter}')
    expect(tabTitles()).toEqual(['my-shell'])
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('TabBar — Escape in rename input cancels the rename', () => {
  it('keeps the old title when Escape cancels the rename', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.type(screen.getByRole('textbox'), '-edited')
    expect(screen.getByRole('textbox').matches(':focus')).toBe(true)
    await user.keyboard('{Escape}')
    expect(tabTitles()).toEqual(['bash'])
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows the new title on the tab when leaving the rename input commits it', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    await user.dblClick(screen.getByTitle('Double-click to rename'))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'renamed')
    await user.tab()
    expect(tabTitles()).toEqual(['renamed'])
  })
})

describe('TabBar — close button is hidden while renaming', () => {
  it('close button is hidden while renaming', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    await user.dblClick(screen.getByTitle('Double-click to rename'))
    expect(screen.queryByTitle('Close tab')).toBeNull()
  })
})

describe('TabBar — tab reordering', () => {
  const twoTabs = [session('ses-1', { tabTitle: 'Tab 1' }), session('ses-2', { tabTitle: 'Tab 2' })]

  it('moves a tab dropped on another into that tab’s place, and shifts the tabs between', () => {
    seedSessions([...twoTabs, session('ses-3', { tabTitle: 'Tab 3' })], 'ses-1')
    renderTabBar()
    dragTab(sessionTabs()[2], sessionTabs()[0])
    expect(tabTitles()).toEqual(['Tab 3', 'Tab 1', 'Tab 2'])
  })

  it('saves no order when a tab is dropped on itself', () => {
    seedSessions(twoTabs)
    renderTabBar()
    dragTab(sessionTabs()[0], sessionTabs()[0])
    expect(tabTitles()).toEqual(['Tab 1', 'Tab 2'])
    expect(savedOrder()).toBeUndefined()
  })
})

describe('TabBar — context menu', () => {
  it('shows context menu on right-click of a session tab', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    const tab = screen.getByRole('tab', { name: 'bash' })
    await user.pointer({ keys: '[MouseRight]', target: tab })
    expect(screen.getByText('Rename')).toBeTruthy()
    expect(screen.getByText('Move to branch…')).toBeTruthy()
    expect(screen.queryByText(/Move to project/i)).toBeNull()
    expect(screen.getByText('Close tab')).toBeTruthy()
  })

  it('opens MoveSessionDialog when Move to project is clicked', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    const tab = screen.getByRole('tab', { name: 'bash' })
    await user.pointer({ keys: '[MouseRight]', target: tab })
    await user.click(screen.getByText('Move to branch…'))
    expect(screen.getByTestId('move-session-dialog')).toBeTruthy()
  })
})

describe('TabBar — context menu — closes context menu on global click', () => {
  it('closes context menu on global click', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    const tab = screen.getByRole('tab', { name: 'bash' })
    await user.pointer({ keys: '[MouseRight]', target: tab })
    expect(screen.getByText('Rename')).toBeTruthy()
    await user.click(document.body)
    expect(screen.queryByText('Rename')).toBeNull()
  })

  it('closes the terminal and removes its tab from the menu’s Close tab', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    const tab = screen.getByRole('tab', { name: 'bash' })
    await user.pointer({ keys: '[MouseRight]', target: tab })
    await user.click(screen.getByText('Close tab'))
    expect(terminalClose).toHaveBeenCalledWith('ses-1')
    await eventually(() => expect(screen.queryByText('bash')).toBeNull())
  })
})

describe('TabBar — context menu — opens rename inline via context menu Rename option', () => {
  it('opens rename inline via context menu Rename option', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    const tab = screen.getByRole('tab', { name: 'bash' })
    await user.pointer({ keys: '[MouseRight]', target: tab })
    await user.click(screen.getByText('Rename'))
    expect(screen.getByRole('textbox')).toBeTruthy()
  })
})

const ENG_4 = { tracker: 'linear', key: 'ENG-4' } as const

describe('TabBar — session work item', () => {
  it('draws a key chip for a session with its own link', () => {
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    seedRecords(recordOf('ses-1', { link: ENG_4 }))
    renderTabBar()
    expect(screen.getByText('ENG-4')).toBeTruthy()
  })

  it('offers only "Link ticket…" when the tab has no own link', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    const tab = screen.getByRole('tab', { name: 'bash' })
    await user.pointer({ keys: '[MouseRight]', target: tab })
    expect(screen.getByText('Link ticket…')).toBeTruthy()
    expect(screen.queryByText('Remove session link')).toBeNull()
    await user.click(screen.getByText('Link ticket…'))
    expect(screen.getByTestId('session-link-dialog')).toBeTruthy()
  })
})

describe('TabBar — session work item — offers change and remove, and removes the chip, when the tab has its own link', () => {
  it('offers change and remove, and removes the chip, when the tab has its own link', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    seedRecords(recordOf('ses-1', { link: ENG_4 }))
    renderTabBar()
    const tab = screen.getByRole('tab', { name: 'bash' })
    await user.pointer({ keys: '[MouseRight]', target: tab })
    expect(screen.getByText('Change linked ticket…')).toBeTruthy()
    await user.click(screen.getByText('Remove session link'))
    await eventually(() => expect(screen.queryByText('ENG-4')).toBeNull())
  })
})

describe('TabBar — MoveSessionDialog onMoved callback', () => {
  it('closes MoveSessionDialog when onMoved fires without onScratchDeactivate', async () => {
    const user = userEvent.setup()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar()
    const tab = screen.getByRole('tab', { name: 'bash' })
    await user.pointer({ keys: '[MouseRight]', target: tab })
    await userEvent.click(screen.getByText('Move to branch…'))
    expect(screen.getByTestId('move-session-dialog')).toBeTruthy()
    await userEvent.click(screen.getByText('Close Move Dialog'))
    expect(screen.queryByTestId('move-session-dialog')).toBeNull()
  })
})

describe('TabBar — MoveSessionDialog onMoved callback — onScratchDeactivate', () => {
  it('calls onScratchDeactivate when MoveSessionDialog onMoved fires', async () => {
    const user = userEvent.setup()
    const onScratchDeactivate = vi.fn()
    seedSessions([session('ses-1', { tabTitle: 'bash' })], 'ses-1')
    renderTabBar({ onScratchDeactivate })
    const tab = screen.getByRole('tab', { name: 'bash' })
    await user.pointer({ keys: '[MouseRight]', target: tab })
    await userEvent.click(screen.getByText('Move to branch…'))
    expect(screen.getByTestId('move-session-dialog')).toBeTruthy()
    await userEvent.click(screen.getByText('Trigger onMoved'))
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
    seedSessions([session('s1', { tabTitle: 'tests' })], 's1')
  })
}

describe('TabBar — the session bar states whose terminals it shows (US3, FR-013)', () => {
  setUpTabBarTheSessionBar()

  it('names the branch that owns the tabs', () => {
    renderTabBar()
    expect(screen.getByText(/main/).textContent).toContain('main')
  })
})

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
    seedSessions(EACH_STATE)
    renderTabBar()
    const states = sessionTabs().map((tab) => within(tab).getByRole('img').innerHTML)
    expect(states.map((glyph) => glyph.match(/data-state="([^"]*)"/)?.[1])).toEqual([
      'awaiting-input',
      'working',
      'idle',
      'exited',
    ])
  })

  it('distinguishes the four states by shape, not by colour', () => {
    seedSessions(EACH_STATE)
    renderTabBar()
    const glyphs = sessionTabs().map((tab) => within(tab).getByRole('img').innerHTML)
    expect(new Set(glyphs).size).toBe(4)
    expect(glyphs.filter((svg) => svg.includes('style='))).toEqual([])
    expect(glyphs.map((svg) => svg.match(/stroke="([^"]*)"/)?.[1])).toEqual(
      Array(4).fill('currentColor')
    )
  })

  it('names the state for a reader, since a shape says nothing aloud', () => {
    seedSessions([session('a', { bellCount: 1 })])
    renderTabBar()
    expect(within(sessionTabs()[0]).getByRole('img', { name: 'Waiting on you' })).toBeTruthy()
  })
})

describe('TabBar — the terminals the sidebar stopped listing (US3) — shows the unread bell count', () => {
  // FR-022.
  it('shows the unread bell count', () => {
    seedSessions([session('a'), session('b', { bellCount: 4 })], 'a')
    renderTabBar()
    expect(within(sessionTabs()[1]).getByLabelText('4 alerts').textContent).toBe('4')
  })

  // FR-023 as amended. The description is reachable, and drawn nowhere.
  it("carries a terminal's description as a tooltip and never as text", () => {
    seedSessions([session('a')])
    seedRecords(recordOf('a', { description: 'rebasing onto main' }))
    renderTabBar()
    const tab = sessionTabs()[0]
    expect(tab.getAttribute('title')).toContain('rebasing onto main')
    expect(tab.textContent).not.toContain('rebasing onto main')
  })

  it('falls back to the rename hint when there is no description', () => {
    seedSessions([session('a')])
    renderTabBar()
    expect(sessionTabs()[0].getAttribute('title')).toMatch(/rename/i)
  })
})

describe('TabBar — the terminals the sidebar stopped listing (US3) — draws no more than four elements on a tab', () => {
  // The cap that stops this repeating what 032 did to the 24px row.
  it('draws no more than four elements on a tab', () => {
    seedSessions([session('a', { bellCount: 9 })], 'a')
    seedRecords(recordOf('a', { description: 'x' }))
    renderTabBar()
    expect(sessionTabs()[0].children.length).toBeLessThanOrEqual(4)
  })

  it('offers close on the active tab only', () => {
    seedSessions([session('a'), session('b')], 'a')
    renderTabBar()
    const [a, b] = sessionTabs()
    expect(within(a).getByTitle('Close tab')).toBeTruthy()
    expect(within(b).queryByTitle('Close tab')).toBeNull()
  })
})

describe('TabBar — the terminals the sidebar stopped listing (US3) — marks the row overflowed so the hidden tabs are discoverable', () => {
  it('marks the row overflowed so the hidden tabs are discoverable', () => {
    seedSessions(Array.from({ length: 12 }, (_, i) => session(`s${i}`)))
    renderTabBar()
    expect(screen.getByRole('tablist').className).toMatch(/tab-bar--scrollable/)
  })
})

const noted = session('ses-1', { tabTitle: 'claude' })
const noteInput = () =>
  screen.queryByPlaceholderText<HTMLInputElement>('What is this session doing?')

/** The hooks every "TabBar — the description, edited from the tab (054 FR-006)" describe registers. */
function setUpTabBarTheDescriptionEdited(): void {
  beforeEach(() => seedSessions([noted], 'ses-1'))
}

describe('TabBar — the description, edited from the tab (054 FR-006)', () => {
  setUpTabBarTheDescriptionEdited()

  it('opens the editor when the shortcut names a terminal', () => {
    renderTabBar({ editNoteSessionId: 'ses-1' })
    expect(noteInput()).toBeTruthy()
  })

  it('opens with the description already there, so editing is not retyping', () => {
    seedRecords(recordOf('ses-1', { description: 'rebasing' }))
    renderTabBar({ editNoteSessionId: 'ses-1' })
    expect(noteInput()!.value).toBe('rebasing')
  })

  it('ignores a shortcut naming a terminal that is not here', () => {
    renderTabBar({ editNoteSessionId: 'gone' })
    expect(noteInput()).toBeNull()
  })

  it('opens nothing when the shortcut names no terminal', () => {
    renderTabBar({ editNoteSessionId: null })
    expect(noteInput()).toBeNull()
  })

  it('bounds the description at the length a record keeps', () => {
    renderTabBar({ editNoteSessionId: 'ses-1' })
    expect(noteInput()!.getAttribute('maxLength')).toBe('500')
  })
})

describe('TabBar — the description, edited from the tab (054 FR-006) — saves on Enter', () => {
  setUpTabBarTheDescriptionEdited()

  it('shows the saved description on the tab when Enter saves it', async () => {
    const user = userEvent.setup()
    renderTabBar({ editNoteSessionId: 'ses-1' })
    await user.clear(noteInput()!)
    await user.type(noteInput()!, 'rebasing onto main{Enter}')
    expect(noteInput()).toBeNull()
    await eventually(() =>
      expect(sessionTabs()[0].getAttribute('title')).toContain('rebasing onto main')
    )
  })

  it('shows the saved description on the tab when leaving the editor saves it', async () => {
    const user = userEvent.setup()
    renderTabBar({ editNoteSessionId: 'ses-1' })
    await user.clear(noteInput()!)
    await user.type(noteInput()!, 'blurred')
    await user.tab()
    await eventually(() => expect(sessionTabs()[0].getAttribute('title')).toContain('blurred'))
  })
})

describe('TabBar — the description, edited from the tab (054 FR-006) — saves on Enter — abandons on Escape', () => {
  setUpTabBarTheDescriptionEdited()

  it('writes nothing and closes the editor when Escape abandons it', async () => {
    const user = userEvent.setup()
    renderTabBar({ editNoteSessionId: 'ses-1' })
    await user.clear(noteInput()!)
    await user.type(noteInput()!, 'nope{Escape}')
    expect(noteInput()).toBeNull()
    expect(setDescription).not.toHaveBeenCalled()
    expect(sessionTabs()[0].getAttribute('title')).not.toContain('nope')
  })
})

describe('TabBar — the description, edited from the tab (054 FR-006) — does not switch terminal while typing in the editor', () => {
  setUpTabBarTheDescriptionEdited()

  it('keeps the shown terminal active when the editor on another tab is clicked', async () => {
    const user = userEvent.setup()
    seedSessions([noted, session('ses-2')], 'ses-2')
    renderTabBar({ editNoteSessionId: 'ses-1' })
    await user.click(noteInput()!)
    expect(sessionTabs().map(isActive)).toEqual([false, true])
    expect(useSessionStore.getState().focusRequest).toBeNull()
  })

  it('clears the description when saved empty', async () => {
    const user = userEvent.setup()
    seedRecords(recordOf('ses-1', { description: 'rebasing' }))
    renderTabBar({ editNoteSessionId: 'ses-1' })
    await user.clear(noteInput()!)
    await user.type(noteInput()!, '   {Enter}')
    await eventually(() => expect(sessionTabs()[0].getAttribute('title')).toMatch(/rename/i))
    expect(useSessionRecordsStore.getState().records.get('ses-1')?.description).toBeNull()
  })

  it('does not write when an empty editor is left empty', async () => {
    const user = userEvent.setup()
    renderTabBar({ editNoteSessionId: 'ses-1' })
    await user.click(noteInput()!)
    await user.tab()
    expect(setDescription).not.toHaveBeenCalled()
  })
})

describe('TabBar — the description, edited from the tab (054 FR-006) — offers adding a description from the tab menu', () => {
  setUpTabBarTheDescriptionEdited()

  it('offers adding a description from the tab menu', async () => {
    const user = userEvent.setup()
    renderTabBar()
    await user.pointer({ keys: '[MouseRight]', target: sessionTabs()[0] })
    await user.click(screen.getByText('Add description…'))
    expect(noteInput()).toBeTruthy()
  })

  it('offers editing an existing description instead', async () => {
    const user = userEvent.setup()
    seedRecords(recordOf('ses-1', { description: 'rebasing' }))
    renderTabBar()
    await user.pointer({ keys: '[MouseRight]', target: sessionTabs()[0] })
    expect(screen.getByText('Edit description…')).toBeTruthy()
  })
})

describe('TabBar — the drop target', () => {
  const twoTabs = () => {
    seedSessions([session('ses-1', { tabTitle: 'Tab 1' }), session('ses-2', { tabTitle: 'Tab 2' })])
    renderTabBar()
    return sessionTabs()
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

  it('unmarks it, and moves nothing, when Escape cancels the drag', async () => {
    const tabs = twoTabs()
    startTabDrag(tabs[0], tabs[1])
    await userEvent.setup().keyboard('{Escape}')
    expect(tabs[1].classList.contains('tab-bar__tab--dnd-over')).toBe(false)
    pointerAt('pointerup', IN_WINDOW)
    expect(tabTitles()).toEqual(['Tab 1', 'Tab 2'])
    expect(savedOrder()).toBeUndefined()
  })
})

const threeTabs = [
  session('ses-1', { tabTitle: 'Tab 1' }),
  session('ses-2', { tabTitle: 'Tab 2' }),
  session('ses-3', { tabTitle: 'Tab 3' }),
]

describe('TabBar — a terminal in its own window', () => {
  beforeEach(() => seedSessions(threeTabs))

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
    dragTab(sessionTabs()[0], sessionTabs()[1])
    expect(tabTitles()).toEqual(['Tab 3', 'Tab 1'])
    expect(savedOrder()).toEqual(['ses-3', 'ses-2', 'ses-1'])
  })
})

describe('TabBar — dragging a tab out', () => {
  beforeEach(() => seedSessions(threeTabs))

  it('opens its own window where it is let go, the moment it is let go outside every window', () => {
    renderTabBar()
    dragTab(sessionTabs()[0], null, OUTSIDE_WINDOW)
    expect(breakOut).toHaveBeenCalledWith('ses-1', OUTSIDE_WINDOW)
  })

  it('counts a drag out as a break-out, and a drop inside the window as nothing', () => {
    recordUse.mockClear()
    renderTabBar()
    const tab = sessionTabs()[0]
    dragTab(tab, null, { x: 600, y: 500 })
    expect(recordUse).not.toHaveBeenCalled()
    dragTab(tab, null, OUTSIDE_WINDOW)
    expect(recordUse).toHaveBeenCalledWith('core.break-out', 'click', expect.anything())
  })

  it('stays put when let go inside the window but not on a tab', () => {
    renderTabBar()
    dragTab(sessionTabs()[0], null, { x: 600, y: 500 })
    expect(breakOut).not.toHaveBeenCalled()
    expect(tabTitles()).toEqual(['Tab 1', 'Tab 2', 'Tab 3'])
    expect(savedOrder()).toBeUndefined()
  })
})

describe('TabBar — a tab let go somewhere it does not leave from', () => {
  beforeEach(() => seedSessions(threeTabs))

  it('stays put when let go over a terminal that is already in its own window', () => {
    const own = partialFake<Window>({
      screenX: 1400,
      screenY: 0,
      outerWidth: 600,
      outerHeight: 400,
    })
    seedStore(useBreakoutStore, { windows: new Map([['ses-3', own]]) })
    renderTabBar()
    dragTab(sessionTabs()[0], null, OUTSIDE_WINDOW)
    expect(breakOut).not.toHaveBeenCalled()
  })

  it('is not a click on the tab: the dragged tab is not selected', () => {
    renderTabBar()
    const tab = sessionTabs()[1]
    dragTab(tab, null, OUTSIDE_WINDOW)
    // The click a browser fires after a drag; a user-event press would start a new gesture.
    // eslint-disable-next-line testing-library/prefer-user-event
    fireEvent.click(tab)
    expect(isActive(tab)).toBe(false)
    expect(useSessionStore.getState().focusRequest).toBeNull()
  })
})

describe('TabBar — a tab let go on an agent composer', () => {
  beforeEach(() => seedSessions(threeTabs))

  it('attaches its session to that agent tab, and neither reorders nor breaks out', async () => {
    renderTabBar()
    const composer = document.createElement('div')
    composer.dataset.contextDrop = 'agent-1'
    document.body.append(composer)
    onTestFinished(() => composer.remove())
    dragTab(sessionTabs()[1], composer)
    await eventually(() => expect(attachSessions).toHaveBeenCalledWith('agent-1', ['ses-2']))
    expect(tabTitles()).toEqual(['Tab 1', 'Tab 2', 'Tab 3'])
    expect(breakOut).not.toHaveBeenCalled()
  })
})
