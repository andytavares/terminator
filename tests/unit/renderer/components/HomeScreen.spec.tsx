import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { fact } from '../sidebar/fixtures/facts'
import type { SessionFacts } from '../../../../src/renderer/sidebar/session-facts'

const state = vi.hoisted(() => ({ facts: [] as SessionFacts[] }))
const navigate = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => state.facts,
  useIssue: () => undefined,
  useIssueTitles: () => new Map(),
}))
vi.mock('../../../../src/renderer/components/session/LivePreview', () => ({
  LivePreview: () => <div />,
}))
vi.mock('../../../../src/renderer/terminal/close-session', () => ({
  closeSessionFromFacts: closeSession,
}))
const started = vi.hoisted(() => ({ inBranch: vi.fn(), scratch: vi.fn(), resume: vi.fn() }))
const closeSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/start-session', () => ({
  startSessionInBranch: started.inBranch,
  startScratchSession: started.scratch,
  resumeSession: started.resume,
}))
vi.mock('../../../../src/renderer/terminal/navigate-to-session', () => ({
  revealSession: navigate,
}))

interface FakePortalProps {
  extensionId: string
  viewParam?: string
  fitContent?: boolean
}

/** Each fake portal's way to say its height is ready, as the real frame does. */
const readyNotices = vi.hoisted(() => new Map<string, () => void>())

/** Stands in for the real frame portal, which mounts an extension iframe. */
function FakeExtensionPortal(props: FakePortalProps): JSX.Element {
  const notifyReady = React.useContext(FrameHeightReadyContext)
  readyNotices.set(props.extensionId, () => notifyReady(props.extensionId))
  return (
    <div
      data-testid={`portal-${props.extensionId}`}
      data-view-param={props.viewParam}
      data-fit-content={String(Boolean(props.fitContent))}
    />
  )
}

function fakePortalModule(): { ExtensionPanelPortal: typeof FakeExtensionPortal } {
  return { ExtensionPanelPortal: FakeExtensionPortal }
}

vi.mock('../../../../src/renderer/components/ExtensionPanelPortal', fakePortalModule)

vi.mock('../../../../src/renderer/components/session/SessionLinkDialog', () => ({
  SessionLinkDialog: ({ facts, onClose }: { facts: { name: string }; onClose: () => void }) => (
    <div role="dialog" aria-label={`Link ${facts.name}`}>
      <button type="button" onClick={onClose}>
        Close link
      </button>
    </div>
  ),
}))

import { HomeScreen } from '../../../../src/renderer/components/home/HomeScreen'
import { ExtensionPanelPortal } from '../../../../src/renderer/components/ExtensionPanelPortal'
import { FrameHeightReadyContext } from '../../../../src/renderer/components/fit-content-height'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import {
  issueSummaryOf,
  projectFixture,
  seedStore,
  trackerConnectionOf,
  workspaceFixture,
  type SeededStore,
} from '../../../support/renderer-stores'

let records: SeededStore<typeof useSessionRecordsStore>

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  records = seedStore(useSessionRecordsStore)
  records.setDescription.mockResolvedValue(true)
  records.setLink.mockResolvedValue(true)
  // The real getters (isAnyConnected, issueFor) read this state; only the
  // tracker call is replaced. One function for every render, as a real
  // store's actions are: a fresh one per render would re-run its effects.
  useIntegrationsStore.setState({
    ...useIntegrationsStore.getInitialState(),
    connections: [trackerConnectionOf()],
    listMine: vi.fn().mockResolvedValue({
      issues: [
        issueSummaryOf({ key: 'NW-84', title: '429s', state: { name: 'Todo', type: 'unstarted' } }),
      ],
      failures: [],
    }),
  })
  seedStore(useWorkspaceStore, {
    workspaces: [workspaceFixture({ id: 'w1', name: 'terminator' })],
    projectsByWorkspaceId: new Map([
      ['w1', [projectFixture({ id: 'p1', workspaceId: 'w1', name: 'main' })]],
    ]),
  })
  useExtensionRegistry.setState(useExtensionRegistry.getInitialState(), true)
  state.facts = [
    fact({ sessionId: 'a', name: 'claude', state: 'awaiting-input' }),
    fact({ sessionId: 'b', name: 'zsh', description: 'Checking bundle size' }),
  ]
})

describe('HomeScreen', () => {
  it('lists every session in the Ledger and counts them', () => {
    render(<HomeScreen />)
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy()
    expect(screen.getByText('2 sessions')).toBeTruthy()
    const grid = screen.getByRole('grid', { name: 'Sessions' })
    expect(within(grid).getAllByRole('row', { name: /claude|zsh/ })).toHaveLength(2)
  })

  it('counts one session in the singular', () => {
    state.facts = [fact()]
    render(<HomeScreen />)
    expect(screen.getByText('1 session')).toBeTruthy()
  })

  it('selects a row, and a second click on it keeps it selected', () => {
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('row', { name: 'zsh' }))
    expect(screen.getByRole('row', { name: 'zsh' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('region', { name: 'Preview of zsh' })).toBeTruthy()
  })

  it('opens a session in its terminal', () => {
    render(<HomeScreen />)
    fireEvent.keyDown(screen.getByRole('row', { name: 'claude' }), { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith('a')
  })
})

describe('HomeScreen — writes a description to the session record', () => {
  it('writes a description to the session record', async () => {
    render(<HomeScreen />)
    const box = within(screen.getByRole('row', { name: 'claude' })).getByRole('textbox', {
      name: 'What is this session doing?',
    })
    fireEvent.change(box, { target: { value: 'Session home view' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(records.setDescription).toHaveBeenCalledWith(
      state.facts[0].snapshot,
      'Session home view'
    )
  })

  it('narrows the list as the filter is typed', () => {
    render(<HomeScreen />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter sessions' }), {
      target: { value: 'bundle' },
    })
    expect(screen.queryByRole('row', { name: 'claude' })).toBeNull()
    expect(screen.getByRole('row', { name: 'zsh' })).toBeTruthy()
  })
})

describe('HomeScreen — says when nothing matches and clears the filter on request', () => {
  it('says when nothing matches and clears the filter on request', () => {
    render(<HomeScreen />)
    const search = screen.getByRole('searchbox', { name: 'Filter sessions' }) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'no such thing' } })
    expect(screen.getByText('No sessions match')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(search.value).toBe('')
    expect(screen.getByRole('row', { name: 'claude' })).toBeTruthy()
  })

  it('says no terminals are open, and offers the way to them', () => {
    state.facts = []
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
    render(<HomeScreen />)
    expect(screen.getByText('No terminals are open')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go to terminals' }))
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBeNull()
  })

  // Both ends of a session's life are on the row it is drawn on.
  it('ends a session from its row', () => {
    render(<HomeScreen />)
    fireEvent.click(screen.getAllByRole('button', { name: /^Close / })[0])
    expect(closeSession).toHaveBeenCalled()
  })
})

/** A registered home section whose component is the (mocked) portal for `id`. */
function registerSection(id: string, label: string): void {
  const SectionPortal = (): JSX.Element =>
    React.createElement(ExtensionPanelPortal, {
      extensionId: id,
      viewParam: 'home',
      isActive: true,
      fitContent: true,
    })
  useExtensionRegistry.getState().registerHomeSection({
    id,
    label,
    view: 'home',
    component: SectionPortal,
  })
}

describe('HomeScreen — contributed home sections', () => {
  it('renders one labelled section per registration, above the sessions list', () => {
    registerSection('com.test.one', 'Pull requests')
    registerSection('com.test.two', 'Deployments')
    const { container } = render(<HomeScreen />)
    const body = container.querySelector('.home__body') as HTMLElement
    expect(within(body).getByRole('region', { name: 'Pull requests' })).toBeTruthy()
    expect(within(body).getByRole('region', { name: 'Deployments' })).toBeTruthy()
    expect(screen.getByTestId('portal-com.test.one').dataset.fitContent).toBe('true')
    const grid = screen.getByRole('grid', { name: 'Sessions' })
    expect(
      screen.getByRole('region', { name: 'Pull requests' }).compareDocumentPosition(grid) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('renders no section when nothing is registered', () => {
    const { container } = render(<HomeScreen />)
    expect(container.querySelector('[data-fit-content]')).toBeNull()
  })

  it('keeps the empty state below the sections', () => {
    state.facts = []
    registerSection('com.test.one', 'Pull requests')
    render(<HomeScreen />)
    expect(screen.getByRole('region', { name: 'Pull requests' })).toBeTruthy()
    expect(screen.getByText('No terminals are open')).toBeTruthy()
  })
})

function sayReady(extensionId: string): void {
  act(() => readyNotices.get(extensionId)?.())
}

describe('HomeScreen — holds its body until each section has a height', () => {
  it('holds the body while a section has no height to show', () => {
    registerSection('com.test.one', 'Pull requests')
    registerSection('com.test.two', 'Deployments')
    const { container } = render(<HomeScreen />)
    const body = container.querySelector('.home__body') as HTMLElement
    expect(body.dataset.holding).toBe('true')
    sayReady('com.test.one')
    expect(body.dataset.holding).toBe('true')
    sayReady('com.test.two')
    expect(body.dataset.holding).toBeUndefined()
  })

  it('does not hold the body with no sections', () => {
    const { container } = render(<HomeScreen />)
    expect((container.querySelector('.home__body') as HTMLElement).dataset.holding).toBeUndefined()
  })
})

describe('HomeScreen — removes a closed session from the list', () => {
  it('removes a closed session from the list', () => {
    state.facts = [
      fact({
        sessionId: 'c',
        name: 'old',
        isClosed: true,
        state: 'exited',
        closedAt: '2026-09-15T00:00:00.000Z',
      }),
    ]
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove old from the list' }))
    expect(records.forget).toHaveBeenCalledWith('c')
  })
})

describe('HomeScreen — still shows closed history when no terminal is open', () => {
  it('still shows closed history when no terminal is open', () => {
    state.facts = [
      fact({
        sessionId: 'c',
        name: 'old',
        isClosed: true,
        state: 'exited',
        closedAt: '2026-09-15T00:00:00.000Z',
      }),
    ]
    render(<HomeScreen />)
    expect(screen.getByText('No terminals are open')).toBeTruthy()
    expect(screen.getByRole('rowgroup', { name: 'Closed' })).toBeTruthy()
  })

  it('switches to the Logbook, and remembers the choice', () => {
    const { unmount } = render(<HomeScreen />)
    const layouts = screen.getByRole('radiogroup', { name: 'Layout' })
    expect(
      within(layouts).getByRole('radio', { name: 'Ledger' }).getAttribute('aria-checked')
    ).toBe('true')
    fireEvent.click(within(layouts).getByRole('radio', { name: 'Logbook' }))
    expect(screen.getByRole('listbox', { name: 'Sessions' })).toBeTruthy()
    unmount()
    render(<HomeScreen />)
    expect(screen.getByRole('listbox', { name: 'Sessions' })).toBeTruthy()
  })
})

describe('HomeScreen — keeps the selection when switching layout', () => {
  it('keeps the selection when switching layout', () => {
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('row', { name: 'zsh' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Logbook' }))
    expect(
      within(screen.getByRole('region', { name: 'Session details' })).getByRole('button', {
        name: 'Open zsh',
      })
    ).toBeTruthy()
  })

  it('links a suggested ticket to the selected session', async () => {
    localStorage.setItem('terminator.home.prefs', JSON.stringify({ layout: 'logbook' }))
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('option', { name: /Checking bundle size/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'NW-84 429s' }))
    expect(records.setLink).toHaveBeenCalledWith(state.facts[1].snapshot, {
      tracker: 'linear',
      key: 'NW-84',
    })
  })
})

describe('HomeScreen — says when nothing matches in the Logbook too', () => {
  it('says when nothing matches in the Logbook too', () => {
    localStorage.setItem('terminator.home.prefs', JSON.stringify({ layout: 'logbook' }))
    render(<HomeScreen />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter sessions' }), {
      target: { value: 'no such thing' },
    })
    expect(screen.getByText('No sessions match')).toBeTruthy()
  })

  it('opens the link dialog for a session, and closes it', () => {
    render(<HomeScreen />)
    const host = screen.getByRole('row', { name: 'claude' })
    fireEvent.click(within(host).getByRole('button', { name: 'Link a work item' }))
    expect(screen.getByRole('dialog', { name: 'Link claude' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close link' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows only sessions that need you while that filter is on, in either layout', () => {
    render(<HomeScreen />)
    const toggle = screen.getByRole('button', { name: /Needs you/ })
    expect(toggle.textContent).toContain('1')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('row', { name: 'zsh' })).toBeNull()
    expect(screen.getByRole('row', { name: 'claude' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Logbook' }))
    expect(screen.queryByRole('option', { name: /Checking bundle size/ })).toBeNull()
  })
})

describe('HomeScreen — does not remember the Needs you filter', () => {
  it('does not remember the Needs you filter', () => {
    const { unmount } = render(<HomeScreen />)
    fireEvent.click(screen.getByRole('button', { name: /Needs you/ }))
    unmount()
    render(<HomeScreen />)
    expect(screen.getByRole('button', { name: /Needs you/ }).getAttribute('aria-pressed')).toBe(
      'false'
    )
  })

  it('clears both filters when nothing matches', () => {
    state.facts = [fact({ sessionId: 'b', name: 'zsh' })]
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('button', { name: /Needs you/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('row', { name: 'zsh' })).toBeTruthy()
  })
})

describe('HomeScreen — arranges the Ledger from the Display menu, and remembers it', () => {
  it('arranges the Ledger from the Display menu, and remembers it', () => {
    const { unmount } = render(<HomeScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Display' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Latest output' }))
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).not.toContain(
      'Latest output'
    )
    unmount()
    render(<HomeScreen />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).not.toContain(
      'Latest output'
    )
  })

  it('offers the Display menu only for the Ledger', () => {
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('radio', { name: 'Logbook' }))
    expect(screen.queryByRole('button', { name: 'Display' })).toBeNull()
  })

  it('starts a terminal on a branch from Home', () => {
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New terminal in terminator / main' }))
    expect(started.inBranch).toHaveBeenCalledWith('p1')
  })
})

describe('HomeScreen — starts a scratch terminal from Home', () => {
  it('starts a scratch terminal from Home', () => {
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New scratch terminal' }))
    expect(started.scratch).toHaveBeenCalled()
  })

  it('offers a way to start one when nothing is open', () => {
    state.facts = []
    render(<HomeScreen />)
    expect(screen.getAllByRole('button', { name: 'New terminal' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'New terminal' })[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'New scratch terminal' }))
    expect(started.scratch).toHaveBeenCalled()
  })

  it('hides the quick actions hint when no handler is given', () => {
    render(<HomeScreen />)
    expect(screen.queryByRole('button', { name: 'Quick actions (⌘P)' })).toBeNull()
  })

  it('offers the quick actions hint and calls the handler on click', () => {
    const onOpenQuickActions = vi.fn()
    render(<HomeScreen onOpenQuickActions={onOpenQuickActions} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quick actions (⌘P)' }))
    expect(onOpenQuickActions).toHaveBeenCalledOnce()
  })
})

/** A stopped session whose conversation can be picked up again. */
const resumable = (): SessionFacts =>
  fact({
    sessionId: 'r',
    name: 'claude',
    state: 'exited',
    agent: {
      provider: 'claude',
      sessionId: 'conv-1',
      transcriptPath: '/t/c.jsonl',
      cwd: '/code/repo',
      capturedAt: '2026-09-15T18:00:00.000Z',
    },
    resumable: true,
  })

const closedOld = (): SessionFacts =>
  fact({
    sessionId: 'c',
    name: 'old',
    isClosed: true,
    state: 'exited',
    closedAt: '2026-09-15T00:00:00.000Z',
  })

const inLogbook = (): void =>
  localStorage.setItem('terminator.home.prefs', JSON.stringify({ layout: 'logbook' }))

describe('HomeScreen — starting and resuming', () => {
  it('starts a terminal on a branch from the empty state', () => {
    state.facts = []
    render(<HomeScreen />)
    fireEvent.click(screen.getAllByRole('button', { name: 'New terminal' })[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'New terminal in terminator / main' }))
    expect(started.inBranch).toHaveBeenCalledWith('p1')
  })

  it('resumes a stopped session from its Ledger row', () => {
    state.facts = [resumable()]
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume claude' }))
    expect(started.resume).toHaveBeenCalledWith(state.facts[0])
  })
})

describe('HomeScreen — a session’s life from the Logbook', () => {
  it('resumes a stopped session', () => {
    inLogbook()
    state.facts = [resumable()]
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('option'))
    fireEvent.click(screen.getByRole('button', { name: 'Resume claude' }))
    expect(started.resume).toHaveBeenCalledWith(state.facts[0])
  })

  it('ends a running session', () => {
    inLogbook()
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('option', { name: /Checking bundle size/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Close zsh' }))
    expect(closeSession).toHaveBeenCalledWith(state.facts[1])
  })

  it('removes a closed session from the list', () => {
    inLogbook()
    state.facts = [closedOld()]
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('option'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove old from the list' }))
    expect(records.forget).toHaveBeenCalledWith('c')
  })
})
