import React from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InFlight } from '../../../../src/components/home/InFlight'
import { useDeskSelection } from '../../../../src/components/home/desk-selection'
import { useTaskStore } from '../../../../src/stores/task.store'
import { useParkedThreads } from '../../../../src/components/home/parked-threads'
import { useWorkMarks } from '../../../../src/home/work-marks'
import { useAddToTaskStore } from '../../../../src/components/tasks/add-to-task'
import { useToastStore } from '../../../../src/stores/toast.store'
import { ToastContainer } from '../../../../src/components/ToastContainer'
import { useHomeFeedStore } from '../../../../src/stores/home-feed.store'
import { useChangeStatsStore } from '../../../../src/stores/change-stats.store'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import {
  FACTS,
  REPO_ROOT,
  SHOW_ORDER,
  extensionCommands,
  seedDesk,
  seedFoundryOrder,
  sendToAgentAsk,
  ticket,
} from '../home/desk-world'
import { fact } from '../sidebar/fixtures/facts'
import { task } from '../home/fixtures'

const spies = vi.hoisted(() => ({
  open: vi.fn(),
  resume: vi.fn(),
  saveDescription: vi.fn(),
  closeSession: vi.fn(),
  startInBranch: vi.fn(),
  facts: [] as unknown[],
}))
vi.mock('../../../../src/components/session/useSessionFacts', () => ({
  useSessionFacts: () => spies.facts,
}))
vi.mock('../../../../src/components/session/session-actions', () => ({
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
      <div role="dialog" aria-label="Link a ticket">
        <button onClick={onClose}>Close link dialog</button>
      </div>
    )
  }
  return { FakeLinkDialog }
})
vi.mock('../../../../src/components/session/SessionLinkDialog', () => ({
  SessionLinkDialog: linkStub.FakeLinkDialog,
}))
vi.mock('../../../../src/terminal/start-session', () => ({
  startAgentInBranch: spies.startInBranch,
}))

const deskFilter = vi.hoisted(() => ({ text: '', count: null as string | null }))
vi.mock('../../../../src/components/home/desk-filter', () => ({
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
  useWorkMarks.setState({ settled: {}, pinned: {}, snoozed: {} })
  // Change stats are cached per project; a test that mocks other stats must not leak them.
  useChangeStatsStore.setState({ entries: new Map() })
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
    extension: extensionCommands,
  })
})

type User = ReturnType<typeof userEvent.setup>

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
    expect(waiting.getByText('Waiting on others · 23 hours')).toBeTruthy()
    expect(waiting.getByText('23 h')).toBeTruthy()
  })
})

describe('In flight rows — grouping', () => {
  it('lists a scratch terminal under Quiet, not hidden away', () => {
    render(<InFlight />)
    expect(screen.getByRole('button', { name: 'Scratch shell' })).toBeTruthy()
    expect(screen.queryByText(/Parked/)).toBeNull()
  })

  it('groups by repo from the Group menu', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    await user.click(screen.getByRole('button', { name: 'Group: state' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'repo' }))
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
const openBuilding = async (user: User) => {
  render(<InFlight />)
  await user.click(inFlightRowNamed('PR overview shows status before story'))
  return screen.findByRole('dialog', { name: 'PR overview shows status before story' })
}

describe('the work-thread drawer', () => {
  it('opens from a click with the title, state, agents and pull request checks', async () => {
    const user = userEvent.setup()
    const drawer = within(await openBuilding(user))
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
    const user = userEvent.setup()
    render(<InFlight />)
    const target = inFlightRowNamed('PR overview shows status before story')
    target.focus()
    expect(target.matches(':focus')).toBe(true)
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(target.matches(':focus')).toBe(true)
  })
})

describe('the work-thread drawer — summary', () => {
  it('shows Writing a summary, then the model text with its source', async () => {
    const user = userEvent.setup()
    let answer: (value: { text: string; generatedAt: string }) => void = () => {}
    summaryGet.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const drawer = within(await openBuilding(user))
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
    const user = userEvent.setup()
    summaryGet.mockResolvedValueOnce({ error: 'model unavailable' })
    const drawer = within(await openBuilding(user))
    expect(await drawer.findByText(/Could not write a summary/)).toBeTruthy()
    await user.click(drawer.getByRole('button', { name: 'Retry' }))
    expect(await drawer.findByText(/Two agents are on this\./)).toBeTruthy()
    expect(summaryGet).toHaveBeenCalledTimes(2)
  })
})

describe('the work-thread drawer — checks', () => {
  it('sends a failed check to an agent through the extension that published it', async () => {
    const user = userEvent.setup()
    const runAction = vi.fn().mockResolvedValue(true)
    useHomeFeedStore.setState({
      runAction,
      asks: [sendToAgentAsk],
    })
    const drawer = within(await openBuilding(user))
    await user.click(drawer.getByRole('button', { name: 'Send to agent' }))
    await waitFor(() =>
      expect(runAction).toHaveBeenCalledWith('git-integration', 'fix:o/r#275', 'send-to-agent')
    )
  })

  it('offers no Send to agent when no extension published one', async () => {
    const user = userEvent.setup()
    const drawer = within(await openBuilding(user))
    expect(drawer.queryByRole('button', { name: 'Send to agent' })).toBeNull()
  })
})

describe('the work-thread drawer — Open in Foundry', () => {
  it('opens the order in the extension that owns the work', async () => {
    const user = userEvent.setup()
    seedFoundryOrder()
    const drawer = within(await openBuilding(user))
    await user.click(drawer.getByRole('button', { name: 'Open in Foundry' }))
    await waitFor(() =>
      expect(extensionCommands.executeCommand).toHaveBeenCalledWith(...SHOW_ORDER)
    )
  })

  it('offers none when no extension can open the work', async () => {
    const user = userEvent.setup()
    const drawer = within(await openBuilding(user))
    expect(drawer.queryByRole('button', { name: /^Open in Foundry/ })).toBeNull()
  })
})

describe('the work-thread drawer — actions', () => {
  it('opens the terminal', async () => {
    const user = userEvent.setup()
    const drawer = within(await openBuilding(user))
    await user.click(drawer.getByRole('button', { name: 'Open terminal' }))
    expect(spies.open).toHaveBeenCalledWith('building')
  })

  it.each([
    ['Open pull request #275', 'https://github.com/o/r/pull/275'],
    ['Open in Linear', 'https://linear.app/t/issue/TAV-20'],
  ])('"%s" opens %s in the browser', async (button, url) => {
    const user = userEvent.setup()
    const drawer = within(await openBuilding(user))
    await user.click(drawer.getByRole('button', { name: button }))
    expect(openExternal).toHaveBeenCalledWith(url)
  })

  it('archives the work and offers Restore', async () => {
    const user = userEvent.setup()
    const drawer = within(await openBuilding(user))
    await user.click(drawer.getByRole('button', { name: 'Archive' }))
    expect(useParkedThreads.getState().keys).toEqual(['linear:TAV-20'])
    expect(drawer.getByRole('button', { name: 'Restore' })).toBeTruthy()
  })
})

describe('the work-thread drawer — agents and sessions', () => {
  it("starts an agent tab on the thread's branch", async () => {
    const user = userEvent.setup()
    const drawer = within(await openBuilding(user))
    await user.click(drawer.getByRole('button', { name: 'New agent on this branch' }))
    expect(spies.startInBranch).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p20', prompt: expect.stringContaining('Work on') })
    )
  })

  it('opens a session from its row', async () => {
    const user = userEvent.setup()
    const drawer = within(await openBuilding(user))
    await user.click(drawer.getByRole('button', { name: 'Open Writing ReviewHeader tests' }))
    expect(spies.open).toHaveBeenCalledWith('building')
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

const rightClickRow = async (user: User, title: string) => {
  const row = inFlightRowNamed(title)
  await user.pointer({
    keys: '[MouseRight]',
    target: within(row).getByRole('button', { name: 'Work actions' }),
  })
  return row
}

const openScratchRow = (user: User) => rightClickRow(user, 'Scratch shell')

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
  'Settle',
  'Close sessions',
  'Remove worktree…',
]
const SCRATCH_MENU = [
  'Open terminal',
  'Rename…',
  'Link ticket…',
  'Archive',
  'Settle',
  'Close sessions',
]

describe('the row menu — which items', () => {
  it('opens on right click with the actions for a ticketed thread with sessions', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    await rightClickRow(user, 'PR overview shows status before story')
    expect(contextMenuItemNames()).toEqual(TICKETED_MENU)
  })

  it('omits ticket-only actions for a scratch terminal and worktree removal for its session', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    await openScratchRow(user)
    expect(contextMenuItemNames()).toEqual(SCRATCH_MENU)
  })

  it('opens from the row’s ⋯ button without opening the drawer', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    const row = inFlightRowNamed('Make all text in the app scale with settings')
    await user.click(within(row).getByRole('button', { name: 'Work actions' }))
    expect(contextMenuItemNames()).toEqual(['Add to task…', 'Archive', 'Settle'])
    expect(
      screen.queryByRole('dialog', { name: 'Make all text in the app scale with settings' })
    ).toBeNull()
  })
})

const RENAMED_ROW = 'PR overview shows status before story'

const openRenameField = async (user: User, text: string, key: string) => {
  await rightClickRow(user, RENAMED_ROW)
  await user.click(openMenuItem('Rename…'))
  const field = screen.getByDisplayValue(RENAMED_ROW)
  await user.clear(field)
  await user.type(field, `${text}{${key}}`)
}

describe('the row menu — Add to task', () => {
  it('opens the picker for the one branch the row is on', async () => {
    const user = userEvent.setup()
    useAddToTaskStore.setState({ lane: null })
    render(<InFlight />)
    await rightClickRow(user, 'PR overview shows status before story')
    await user.click(openMenuItem('Add to task…'))
    expect(useAddToTaskStore.getState().lane).toEqual({ repoRoot: REPO_ROOT, branch: 'tav-20' })
  })
})

describe('the row menu — Open in Foundry', () => {
  it('opens the order in the extension that owns the work', async () => {
    const user = userEvent.setup()
    seedFoundryOrder()
    render(<InFlight />)
    await rightClickRow(user, 'PR overview shows status before story')
    await user.click(openMenuItem('Open in Foundry'))
    await waitFor(() =>
      expect(extensionCommands.executeCommand).toHaveBeenCalledWith(...SHOW_ORDER)
    )
  })

  it('is absent when no extension can open the work', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    await rightClickRow(user, 'PR overview shows status before story')
    expect(within(document.body).queryByRole('menuitem', { name: /^Open in / })).toBeNull()
  })
})

describe('the row menu — Open terminal and Close sessions', () => {
  it('Open terminal reveals the thread’s lead session', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    await rightClickRow(user, 'PR overview shows status before story')
    await user.click(openMenuItem('Open terminal'))
    expect(spies.open).toHaveBeenCalledWith('building')
  })

  it('Close sessions closes each open session in the thread', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    await rightClickRow(user, 'PR overview shows status before story')
    await user.click(openMenuItem('Close sessions'))
    expect(spies.closeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'building' })
    )
  })
})

describe('the row menu — Rename', () => {
  it('Escape cancels; Enter saves the typed title as the lead session’s description', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    await openRenameField(user, 'PR overview', 'Escape')
    expect(spies.saveDescription).not.toHaveBeenCalled()
    await openRenameField(user, 'PR overview', 'Enter')
    expect(spies.saveDescription).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'building' }),
      'PR overview'
    )
  })
})

describe('the row menu — Link ticket', () => {
  it('opens the link dialog for the scratch session', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    await openScratchRow(user)
    await user.click(openMenuItem('Link ticket…'))
    expect(screen.getByRole('dialog', { name: 'Link a ticket' })).toBeTruthy()
  })
})

const parkViaMenu = async (user: User, title: string, item: string): Promise<void> => {
  await rightClickRow(user, title)
  await user.click(openMenuItem(item))
}

describe('the row menu — Archive and Settle', () => {
  it('Archive takes work with no stored task out of the lists', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    await parkViaMenu(user, 'Reproduce staging 429s before release', 'Archive')
    expect(useParkedThreads.getState().keys).toEqual(['linear:TAV-31'])
    expect(
      screen.queryByRole('button', { name: 'Reproduce staging 429s before release' })
    ).toBeNull()
  })

  it('Archive on a stored task asks main to archive it and keeps the archived task', async () => {
    const user = userEvent.setup()
    const stored = task({
      title: 'Rate limits',
      lanes: [{ repoRoot: REPO_ROOT, branch: 'tav-31' }],
    })
    const archivedAt = '2026-11-07T09:00:00.000Z'
    const archive = vi.fn(async () => ({ data: { ...stored, archivedAt } }))
    installElectronApi({ tasks: { archive } })
    useTaskStore.setState({ tasks: [stored] })
    render(<InFlight />)
    await parkViaMenu(user, 'Rate limits', 'Archive')
    expect(archive).toHaveBeenCalledWith({ id: stored.id, archived: true })
    await waitFor(() => expect(useTaskStore.getState().tasks[0].archivedAt).toBe(archivedAt))
    expect(useParkedThreads.getState().keys).toEqual([])
  })
})

describe('the row menu — Settle', () => {
  it('Settle hides the row and keeps it hidden while nothing new happens', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    await parkViaMenu(user, 'Reproduce staging 429s before release', 'Settle')
    expect(
      screen.queryByRole('button', { name: 'Reproduce staging 429s before release' })
    ).toBeNull()
    expect(useWorkMarks.getState().settled['linear:TAV-31']).toBeDefined()
  })
})

describe('the row menu — a dismissed thread stays gone', () => {
  const TITLE = 'Reproduce staging 429s before release'
  const rowShown = (): boolean => screen.queryByRole('button', { name: TITLE }) !== null

  it('stays hidden when its activity moves on, and Undo on the toast brings it back', async () => {
    const user = userEvent.setup()
    useToastStore.setState({ toasts: [] })
    const { rerender } = render(
      <>
        <InFlight />
        <ToastContainer />
      </>
    )
    await parkViaMenu(user, TITLE, 'Settle')
    expect(rowShown()).toBe(false)
    expect(screen.getByRole('status').textContent).toContain(`Settled "${TITLE}"`)
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
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(rowShown()).toBe(true)
  })
})

describe('the row menu — Settle keeps the sessions it holds', () => {
  const TITLE = 'Reproduce staging 429s before release'
  const endedOnTav31 = fact({
    sessionId: 'ended-31',
    isClosed: true,
    state: 'exited',
    projectId: null,
    branch: 'tav-31',
    workItem: ticket('TAV-31'),
    snapshot: { ...fact().snapshot, projectId: 'p31' },
  })

  it('hides the row and deletes no session record; the retention setting handles ended ones', async () => {
    const user = userEvent.setup()
    const forget = vi.fn().mockResolvedValue({ data: true })
    installElectronApi({
      homeThreadSummary: { get: summaryGet },
      agentUsage: { get: usageGet },
      shell: { openExternal },
      git: { changeStats: vi.fn().mockResolvedValue({ added: 0, removed: 0, files: 0 }) },
      sessionRecords: { forget },
    })
    spies.facts = [...FACTS, endedOnTav31]
    render(<InFlight />)
    expect(forget).not.toHaveBeenCalled()
    await parkViaMenu(user, TITLE, 'Settle')
    expect(screen.queryByRole('button', { name: TITLE })).toBeNull()
    expect(forget).not.toHaveBeenCalled()
  })
})

const confirmRemoveWorktree = async (user: User, deleteProject: Mock): Promise<void> => {
  await rightClickRow(user, 'PR overview shows status before story')
  await user.click(openMenuItem('Remove worktree…'))
  await user.click(await screen.findByRole('button', { name: 'Remove' }))
  expect(deleteProject).toHaveBeenCalledWith('p20')
}

describe('the row menu — Remove worktree', () => {
  it('asks first, then deletes the lead project', async () => {
    const user = userEvent.setup()
    const deleteProject = vi.fn(async () => ({ success: true }))
    installElectronApi({ project: { delete: deleteProject } })
    render(<InFlight />)
    await rightClickRow(user, 'PR overview shows status before story')
    await user.click(openMenuItem('Remove worktree…'))
    const confirm = await screen.findByRole('dialog', {
      name: 'Remove worktree for "PR overview shows status before story"?',
    })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(deleteProject).not.toHaveBeenCalled()
    await confirmRemoveWorktree(user, deleteProject)
  })
})

describe('the row menu — Remove worktree with open terminals', () => {
  it('says the removal also closes the terminals open in the worktree', async () => {
    const user = userEvent.setup()
    render(<InFlight />)
    await rightClickRow(user, 'PR overview shows status before story')
    await user.click(openMenuItem('Remove worktree…'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/This also closes \d+ open terminals?\./)).toBeTruthy()
  })
})
