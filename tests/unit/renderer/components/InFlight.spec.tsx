import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { InFlight } from '../../../../src/renderer/components/home/InFlight'
import { useDeskSelection } from '../../../../src/renderer/components/home/desk-selection'
import { useTaskStore } from '../../../../src/renderer/stores/task.store'
import { useParkedThreads } from '../../../../src/renderer/components/home/parked-threads'
import { useDismissedThreads } from '../../../../src/renderer/components/home/dismissed-threads'
import { useAddToTaskStore } from '../../../../src/renderer/components/tasks/add-to-task'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { ToastContainer } from '../../../../src/renderer/components/ToastContainer'
import { useHomeFeedStore } from '../../../../src/renderer/stores/home-feed.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { installElectronApi } from '../../../support/electron-api'
import { FACTS, REPO_ROOT, seedDesk, sendToAgentAsk } from '../home/desk-world'
import { task } from '../home/fixtures'

const spies = vi.hoisted(() => ({
  open: vi.fn(),
  resume: vi.fn(),
  saveDescription: vi.fn(),
  closeSession: vi.fn(),
  startInBranch: vi.fn(),
  facts: [] as unknown[],
}))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => spies.facts,
}))
vi.mock('../../../../src/renderer/components/session/session-actions', () => ({
  SESSION_ACTIONS: {
    onOpen: spies.open,
    onResume: spies.resume,
    onSaveDescription: spies.saveDescription,
    onCloseSession: spies.closeSession,
  },
}))

const linkStub = vi.hoisted(() => {
  function FakeLinkDialog({ onClose }: { facts: unknown; onClose: () => void }): React.JSX.Element {
    return (
      <div role="dialog" aria-label="Link a work item">
        <button onClick={onClose}>Close link dialog</button>
      </div>
    )
  }
  return { FakeLinkDialog }
})
vi.mock('../../../../src/renderer/components/session/SessionLinkDialog', () => ({
  SessionLinkDialog: linkStub.FakeLinkDialog,
}))
vi.mock('../../../../src/renderer/terminal/start-session', () => ({
  startAgentInBranch: spies.startInBranch,
}))

const deskFilter = vi.hoisted(() => ({ text: '', count: null as string | null }))
vi.mock('../../../../src/renderer/components/home/desk-filter', () => ({
  useDeskFilter: () => deskFilter,
}))

const summaryGet = vi.fn()
const usageGet = vi.fn()
const openExternal = vi.fn()

const usedTokens = {
  data: {
    sessions: [
      {
        sessionId: 'building',
        tokens: { input: 900_000, output: 300_000, cacheCreation: 0, cacheRead: 0 },
        costUsd: 3.1,
        costIsPartial: false,
        models: [],
      },
    ],
    totals: {},
  },
}

function resetDesk(): void {
  deskFilter.text = ''
  deskFilter.count = null
  localStorage.clear()
  spies.facts = FACTS
  seedDesk()
  useDeskSelection.setState({ selectedThreadKey: null, openThreadKey: null, groupBy: 'move' })
  useDeskSelection.setState({ expandedGroupIds: [] })
  useParkedThreads.setState({ keys: [] })
  useTaskStore.setState({ tasks: [] })
  useDismissedThreads.setState({ dismissed: {} })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDesk()
  summaryGet.mockResolvedValue({ text: 'Two agents are on this.', generatedAt: 'now' })
  usageGet.mockResolvedValue(usedTokens)
  installElectronApi({
    homeThreadSummary: { get: summaryGet },
    agentUsage: { get: usageGet },
    shell: { openExternal },
    git: { changeStats: vi.fn().mockResolvedValue({ added: 412, removed: 88, files: 3 }) },
  })
})

const inFlightRowNamed = (title: string) => screen.getByRole('button', { name: title })

describe('In flight rows', () => {
  it('counts the work and groups it by state', () => {
    render(<InFlight />)
    expect(screen.getByText('4 work items')).toBeTruthy()
    expect(screen.getByText('Needs you · 1')).toBeTruthy()
    expect(screen.getByText('Running · 1')).toBeTruthy()
    expect(screen.getByText('Waiting on others · 1')).toBeTruthy()
    expect(screen.getByText('Quiet · 1')).toBeTruthy()
  })

  it('shows the state, branch, what is happening now and the pull request chip', () => {
    render(<InFlight />)
    const asking = within(inFlightRowNamed('Reproduce staging 429s before release'))
    expect(asking.getByText('Needs you')).toBeTruthy()
    expect(asking.getByText('TAV-31')).toBeTruthy()
    expect(asking.getByText('1 asking')).toBeTruthy()
    expect(asking.getByText('no pull request')).toBeTruthy()
    const building = within(inFlightRowNamed('PR overview shows status before story'))
    expect(building.getByText('#275 checks failing')).toBeTruthy()
    expect(building.getByText('Writing ReviewHeader tests')).toBeTruthy()
    expect(building.getByText('tav-20')).toBeTruthy()
    expect(building.getByText('Running')).toBeTruthy()
    const waiting = within(inFlightRowNamed('Make all text in the app scale with settings'))
    expect(waiting.getByText('Waiting on others · 1 day')).toBeTruthy()
    expect(waiting.getByText('1 d')).toBeTruthy()
  })
})

describe('In flight rows — grouping', () => {
  it('lists a scratch terminal under Quiet, not hidden away', () => {
    render(<InFlight />)
    expect(screen.getByRole('button', { name: 'Scratch shell' })).toBeTruthy()
    expect(screen.queryByText(/Parked/)).toBeNull()
  })

  it('groups by repo from the Group menu', () => {
    render(<InFlight />)
    fireEvent.click(screen.getByRole('button', { name: 'Group: state' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'repo' }))
    expect(screen.getByText('terminator · 3')).toBeTruthy()
    expect(screen.queryByText(/Running · /)).toBeNull()
  })

  it('names the grouping chosen on the Tasks layout, including none', () => {
    useDeskSelection.setState({ groupBy: 'none' })
    render(<InFlight />)
    expect(screen.getByRole('button', { name: 'Group: none' })).toBeTruthy()
  })

  it('marks the selected row', () => {
    useDeskSelection.getState().select('linear:TAV-31')
    render(<InFlight />)
    expect(
      inFlightRowNamed('Reproduce staging 429s before release').getAttribute('aria-current')
    ).toBe('true')
  })
})

/** The drawer is its own chunk, so it is there once the lazy import has resolved. */
const openBuilding = () => {
  render(<InFlight />)
  fireEvent.click(inFlightRowNamed('PR overview shows status before story'))
  return screen.findByRole('dialog', { name: 'PR overview shows status before story' })
}

describe('the work-thread drawer', () => {
  it('opens from a click with the title, state, agents and pull request checks', async () => {
    const drawer = within(await openBuilding())
    expect(drawer.getByRole('heading', { level: 4 }).textContent).toContain('TAV-20')
    expect(drawer.getByText('Running')).toBeTruthy()
    expect(drawer.getByText('AGENTS AND TERMINALS · 1')).toBeTruthy()
    expect(drawer.getByText('PULL REQUEST #275')).toBeTruthy()
    expect(drawer.getByText('End-to-end tests')).toBeTruthy()
    expect((await drawer.findAllByText(/\+412 −88/)).length).toBeGreaterThan(0)
    expect(await drawer.findByText(/1\.2M tokens · \$3\.10/)).toBeTruthy()
    expect(drawer.getByText('Keep the existing risk chip.')).toBeTruthy()
  })

  it('opens on Enter and returns focus to the row on Escape', async () => {
    render(<InFlight />)
    const target = inFlightRowNamed('PR overview shows status before story')
    target.focus()
    fireEvent.keyDown(target, { key: 'Enter' })
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(target)
  })
})

describe('the work-thread drawer — summary', () => {
  it('shows Writing a summary, then the model text with its source', async () => {
    let answer: (value: { text: string; generatedAt: string }) => void = () => {}
    summaryGet.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const drawer = within(await openBuilding())
    expect(drawer.getByText('Writing a summary…')).toBeTruthy()
    answer({ text: 'Two agents are on this.', generatedAt: 'now' })
    expect(await drawer.findByText(/Two agents are on this\./)).toBeTruthy()
    expect(drawer.getByText(/From the agents' latest messages and the pull request\./)).toBeTruthy()
    expect(summaryGet.mock.calls[0][0]).toMatchObject({
      title: 'PR overview shows status before story',
      ticketKey: 'TAV-20',
      pullRequest: { number: 275, isDraft: false },
    })
  })

  it('says a failed summary in plain words and asks again on Retry', async () => {
    summaryGet.mockResolvedValueOnce({ error: 'model unavailable' })
    const drawer = within(await openBuilding())
    expect(await drawer.findByText(/Could not write a summary/)).toBeTruthy()
    fireEvent.click(drawer.getByRole('button', { name: 'Retry' }))
    expect(await drawer.findByText(/Two agents are on this\./)).toBeTruthy()
    expect(summaryGet).toHaveBeenCalledTimes(2)
  })
})

describe('the work-thread drawer — checks', () => {
  it('sends a failed check to an agent through the extension that published it', async () => {
    const runAction = vi.fn().mockResolvedValue(true)
    useHomeFeedStore.setState({
      runAction,
      asks: [sendToAgentAsk],
    })
    const drawer = within(await openBuilding())
    fireEvent.click(drawer.getByRole('button', { name: 'Send to agent' }))
    await waitFor(() =>
      expect(runAction).toHaveBeenCalledWith('git-integration', 'fix:o/r#275', 'send-to-agent')
    )
  })

  it('offers no Send to agent when no extension published one', async () => {
    const drawer = within(await openBuilding())
    expect(drawer.queryByRole('button', { name: 'Send to agent' })).toBeNull()
  })
})

describe('the work-thread drawer — actions', () => {
  it('opens the terminal, the pull request and the ticket, and archives the work', async () => {
    const drawer = within(await openBuilding())
    fireEvent.click(drawer.getByRole('button', { name: 'Open terminal' }))
    expect(spies.open).toHaveBeenCalledWith('building')
    fireEvent.click(drawer.getByRole('button', { name: 'Open pull request #275' }))
    expect(openExternal).toHaveBeenCalledWith('https://github.com/o/r/pull/275')
    fireEvent.click(drawer.getByRole('button', { name: 'Open in Linear' }))
    expect(openExternal).toHaveBeenCalledWith('https://linear.app/t/issue/TAV-20')
    fireEvent.click(drawer.getByRole('button', { name: 'Archive' }))
    expect(useParkedThreads.getState().keys).toEqual(['linear:TAV-20'])
    expect(drawer.getByRole('button', { name: 'Restore' })).toBeTruthy()
  })

  it("starts an agent tab on the thread's branch", async () => {
    const drawer = within(await openBuilding())
    fireEvent.click(drawer.getByRole('button', { name: 'New agent on this branch' }))
    expect(spies.startInBranch).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p20', prompt: expect.stringContaining('Work on') })
    )
  })

  it('opens a session from its row', async () => {
    const drawer = within(await openBuilding())
    fireEvent.click(drawer.getByRole('button', { name: 'Open Writing ReviewHeader tests' }))
    expect(spies.open).toHaveBeenCalledWith('building')
  })
})

describe('joining by work-folder paths', () => {
  it('joins a pull request keyed by repo root and branch to the session on that branch', () => {
    render(<InFlight />)
    const building = within(inFlightRowNamed('PR overview shows status before story'))
    expect(building.getByText('#275 checks failing')).toBeTruthy()
    expect(screen.getByText('4 work items')).toBeTruthy()
  })
})

describe('filtering from the Desk header', () => {
  beforeEach(() => {
    deskFilter.text = ''
    deskFilter.count = null
  })

  it('keeps rows whose title, key, branch or now line match the text', () => {
    deskFilter.text = 'tav-31'
    render(<InFlight />)
    expect(screen.getByText('1 work item')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Reproduce staging 429s before release' })
    ).toBeTruthy()
  })

  it.each([
    ['your-move', 1],
    ['agents', 1],
    ['others', 1],
    ['failing', 1],
  ])('shows only the %s threads', (count, rows) => {
    deskFilter.count = count
    render(<InFlight />)
    expect(
      screen.getAllByRole('button', { name: /./ }).filter((b) => b.dataset.threadKey)
    ).toHaveLength(rows)
  })
})

const rightClickRow = (title: string) => {
  const row = inFlightRowNamed(title)
  fireEvent.contextMenu(within(row).getByRole('button', { name: 'Work actions' }))
  return row
}

const openScratchRow = () => rightClickRow('Scratch shell')

const contextMenuItemNames = () =>
  within(document.body)
    .getAllByRole('menuitem')
    .map((item) => item.textContent)

const openMenuItem = (name: string) => within(document.body).getByRole('menuitem', { name })

const TICKETED_MENU = [
  'Open terminal',
  'Rename…',
  'Add to task…',
  'Archive',
  'Dismiss',
  'Close sessions',
  'Remove worktree…',
]
const SCRATCH_MENU = [
  'Open terminal',
  'Rename…',
  'Link ticket…',
  'Archive',
  'Dismiss',
  'Close sessions',
]

describe('the row menu — which items', () => {
  it('opens on right click with the actions for a ticketed thread with sessions', () => {
    render(<InFlight />)
    rightClickRow('PR overview shows status before story')
    expect(contextMenuItemNames()).toEqual(TICKETED_MENU)
  })

  it('omits ticket-only actions for a scratch terminal and worktree removal for its session', () => {
    render(<InFlight />)
    openScratchRow()
    expect(contextMenuItemNames()).toEqual(SCRATCH_MENU)
  })

  it('opens from the row’s ⋯ button without opening the drawer', () => {
    render(<InFlight />)
    const row = inFlightRowNamed('Make all text in the app scale with settings')
    fireEvent.click(within(row).getByRole('button', { name: 'Work actions' }))
    expect(contextMenuItemNames()).toEqual(['Add to task…', 'Archive', 'Dismiss'])
    expect(
      screen.queryByRole('dialog', { name: 'Make all text in the app scale with settings' })
    ).toBeNull()
  })
})

const openRenameField = (title: string, text: string, key: string): HTMLElement => {
  rightClickRow(title)
  fireEvent.click(openMenuItem('Rename…'))
  const field = screen.getByDisplayValue(title)
  fireEvent.change(field, { target: { value: text } })
  fireEvent.keyDown(field, { key })
  return field
}

describe('the row menu — Add to task', () => {
  it('opens the picker for the one branch the row is on', () => {
    useAddToTaskStore.setState({ lane: null })
    render(<InFlight />)
    rightClickRow('PR overview shows status before story')
    fireEvent.click(openMenuItem('Add to task…'))
    expect(useAddToTaskStore.getState().lane).toEqual({ repoRoot: REPO_ROOT, branch: 'tav-20' })
  })
})

describe('the row menu — Open terminal and Close sessions', () => {
  it('Open terminal reveals the thread’s lead session', () => {
    render(<InFlight />)
    rightClickRow('PR overview shows status before story')
    fireEvent.click(openMenuItem('Open terminal'))
    expect(spies.open).toHaveBeenCalledWith('building')
  })

  it('Close sessions closes each open session in the thread', () => {
    render(<InFlight />)
    rightClickRow('PR overview shows status before story')
    fireEvent.click(openMenuItem('Close sessions'))
    expect(spies.closeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'building' })
    )
  })
})

describe('the row menu — Rename', () => {
  it('Escape cancels; Enter saves the typed title as the lead session’s description', () => {
    render(<InFlight />)
    openRenameField('PR overview shows status before story', 'PR overview', 'Escape')
    expect(spies.saveDescription).not.toHaveBeenCalled()
    openRenameField('PR overview shows status before story', 'PR overview', 'Enter')
    expect(spies.saveDescription).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'building' }),
      'PR overview'
    )
  })
})

describe('the row menu — Link ticket', () => {
  it('opens the link dialog for the scratch session', () => {
    render(<InFlight />)
    openScratchRow()
    fireEvent.click(openMenuItem('Link ticket…'))
    expect(screen.getByRole('dialog', { name: 'Link a work item' })).toBeTruthy()
  })
})

const parkViaMenu = (title: string, item: string): void => {
  rightClickRow(title)
  fireEvent.click(openMenuItem(item))
}

describe('the row menu — Archive and Dismiss', () => {
  it('Archive takes work with no stored task out of the lists', () => {
    render(<InFlight />)
    parkViaMenu('Reproduce staging 429s before release', 'Archive')
    expect(useParkedThreads.getState().keys).toEqual(['linear:TAV-31'])
    expect(
      screen.queryByRole('button', { name: 'Reproduce staging 429s before release' })
    ).toBeNull()
  })

  it('Archive on a stored task archives it through the task store', () => {
    const archive = vi.fn().mockResolvedValue(true)
    const stored = task({
      title: 'Rate limits',
      lanes: [{ repoRoot: REPO_ROOT, branch: 'tav-31' }],
    })
    useTaskStore.setState({ tasks: [stored], archive })
    render(<InFlight />)
    parkViaMenu('Rate limits', 'Archive')
    expect(archive).toHaveBeenCalledWith(stored.id, true)
    expect(useParkedThreads.getState().keys).toEqual([])
  })

  it('Dismiss hides the row and keeps it hidden while nothing new happens', () => {
    render(<InFlight />)
    parkViaMenu('Reproduce staging 429s before release', 'Dismiss')
    expect(
      screen.queryByRole('button', { name: 'Reproduce staging 429s before release' })
    ).toBeNull()
    expect(useDismissedThreads.getState().dismissed['linear:TAV-31']).toBeDefined()
  })
})

describe('the row menu — a dismissed thread stays gone', () => {
  const TITLE = 'Reproduce staging 429s before release'
  const rowShown = (): boolean => screen.queryByRole('button', { name: TITLE }) !== null

  it('stays hidden when its activity moves on, and Undo on the toast brings it back', () => {
    useToastStore.setState({ toasts: [] })
    const { rerender } = render(
      <>
        <InFlight />
        <ToastContainer />
      </>
    )
    parkViaMenu(TITLE, 'Dismiss')
    expect(rowShown()).toBe(false)
    expect(screen.getByRole('status').textContent).toContain(`Dismissed "${TITLE}"`)
    spies.facts = FACTS.map((f: { sessionId: string }) =>
      f.sessionId === 'asking' ? { ...f, lastActivityAt: Date.now() + 60_000 } : f
    )
    rerender(
      <>
        <InFlight />
        <ToastContainer />
      </>
    )
    expect(rowShown()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(rowShown()).toBe(true)
  })
})

const confirmRemoveWorktree = async (deleteProject: () => void): Promise<void> => {
  rightClickRow('PR overview shows status before story')
  fireEvent.click(openMenuItem('Remove worktree…'))
  fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
  expect(deleteProject).toHaveBeenCalledWith('p20')
}

describe('the row menu — Remove worktree', () => {
  it('asks first, then deletes the lead project', async () => {
    const deleteProject = vi.fn()
    useWorkspaceStore.setState({ deleteProject })
    render(<InFlight />)
    rightClickRow('PR overview shows status before story')
    fireEvent.click(openMenuItem('Remove worktree…'))
    const confirm = await screen.findByRole('dialog', {
      name: 'Remove worktree for "PR overview shows status before story"?',
    })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(deleteProject).not.toHaveBeenCalled()
    await confirmRemoveWorktree(deleteProject)
  })
})

describe('the row menu — Remove worktree with open terminals', () => {
  it('says the removal also closes the terminals open in the worktree', async () => {
    useWorkspaceStore.setState({ deleteProject: vi.fn() })
    render(<InFlight />)
    rightClickRow('PR overview shows status before story')
    fireEvent.click(openMenuItem('Remove worktree…'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/This also closes \d+ open terminals?\./)).toBeTruthy()
  })
})

describe('the row grid', () => {
  it('starts every cell on the row’s first line', () => {
    const css = readFileSync(
      resolve(__dirname, '../../../../src/renderer/components/home/InFlight.css'),
      'utf8'
    )
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 150px 112px 124px 40px')
    const rowBlock = css.slice(css.indexOf('.desk-tr {\n  position: relative;'))
    expect(rowBlock.slice(0, rowBlock.indexOf('\n}'))).toContain('align-items: start')
  })
})
