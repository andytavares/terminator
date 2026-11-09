import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspaceStore } from '../../../../src/stores/workspace.store'
import { useSessionStore } from '../../../../src/stores/session.store'
import { useTaskStore } from '../../../../src/stores/task.store'
import { useAddToTaskStore } from '../../../../src/components/tasks/add-to-task'
import { useExtensionRegistry } from '../../../../src/extensions/registry'
import { useSettingsStore } from '../../../../src/stores/settings.store'
import { UnifiedSidebar } from '../../../../src/components/sidebar/UnifiedSidebar'
import type { Task } from '../../../../../core-shared/src/schemas/tasks.schema'
import { projectFixture, workspaceFixture } from '../../../../../test-support/src/renderer-stores'

vi.mock('../../../../src/hooks/useBranchSync', () => ({ useBranchSync: vi.fn() }))
vi.mock('../../../../src/components/session/useSessionFacts', () => ({
  useSessionFacts: () => [],
}))
vi.mock('../../../../src/hooks/useTerminalSession', () => ({
  useTerminalSession: () => ({ createSession: vi.fn() }),
}))

const backend = workspaceFixture({ id: 'ws-1', name: 'Backend', folderPath: '/b' })
const frontend = workspaceFixture({ id: 'ws-2', name: 'Frontend', folderPath: '/f' })
const docs = workspaceFixture({ id: 'ws-3', name: 'Docs', folderPath: '/d' })

const projects = new Map([
  [
    'ws-1',
    [
      projectFixture({ id: 'p-main', workspaceId: 'ws-1', name: 'main', gitBranch: 'main' }),
      projectFixture({ id: 'p-login', workspaceId: 'ws-1', name: 'login', gitBranch: 'login' }),
    ],
  ],
  [
    'ws-2',
    [projectFixture({ id: 'p-web', workspaceId: 'ws-2', name: 'login', gitBranch: 'login' })],
  ],
  [
    'ws-3',
    [projectFixture({ id: 'p-doc', workspaceId: 'ws-3', name: 'login', gitBranch: 'login' })],
  ],
])

const loginTask: Task = {
  id: '6f1c2d34-0000-4000-8000-000000000001',
  title: 'Login rework',
  lanes: [
    { repoRoot: '/b', branch: 'login' },
    { repoRoot: '/f', branch: 'login' },
    { repoRoot: '/d', branch: 'login' },
  ],
  ticket: null,
  focus: false,
  doneAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  archivedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('electronAPI', { project: { list: vi.fn(async () => ({ projects: [] })) } })
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [backend, frontend, docs],
    activeWorkspaceId: 'ws-1',
    projectsByWorkspaceId: projects,
  })
  useSessionStore.setState(useSessionStore.getInitialState())
  useExtensionRegistry.setState(useExtensionRegistry.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useTaskStore.setState({ tasks: [loginTask] })
  useAddToTaskStore.getState().close()
})

function renderSidebar() {
  return render(
    <UnifiedSidebar
      activeWorkspaceTabId={null}
      onSelectWorkspaceTab={vi.fn()}
      onNewScratch={vi.fn()}
      activeScratchSessionId={null}
      onSelectScratchSession={vi.fn()}
      visible
    />
  )
}

async function groupByTask(): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Display' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Task' }))
}

/** A branch row is a button named "<branch> — <state>"; the Filter menu button's name can hold a dash too. */
const branchRows = () =>
  screen.queryAllByRole('button', {
    name: (label, element) => label.includes(' — ') && !element.hasAttribute('aria-haspopup'),
  })

const rowNames = () => branchRows().map((row) => row.getAttribute('aria-label')!.split(' — ')[0])

/** A group header's text is its name, then its branch count; a disclosure or menu button has a label. */
const headerNames = () =>
  screen
    .queryAllByRole('button', {
      name: (_, element) =>
        element.hasAttribute('aria-expanded') && !element.hasAttribute('aria-label'),
    })
    .map((header) => header.textContent!.replace(/\d+$/, ''))

describe('UnifiedSidebar — grouped by task', () => {
  it('shows the task with its three lanes, then the other branches under "Not in a task"', async () => {
    renderSidebar()
    await groupByTask()
    expect(screen.getByText('Login rework')).toBeTruthy()
    expect(screen.getByText('Not in a task')).toBeTruthy()
    expect(rowNames()).toEqual(['Backend · login', 'Frontend · login', 'Docs · login', 'main'])
  })

  it('draws no repo header for a repo whose only branch is in the task', async () => {
    renderSidebar()
    await groupByTask()
    expect(headerNames()).toEqual(['Login rework', 'Backend'])
  })
})

describe('UnifiedSidebar — grouped by task — the default', () => {
  it('leaves the default grouping by repo, with no task row', () => {
    renderSidebar()
    expect(screen.queryByText('Login rework')).toBeNull()
    expect(rowNames()).toEqual(['main', 'login', 'login', 'login'])
  })

  it('remembers the choice across a reload', async () => {
    const first = renderSidebar()
    await groupByTask()
    first.unmount()
    renderSidebar()
    expect(screen.getByText('Login rework')).toBeTruthy()
  })
})

describe('UnifiedSidebar — Add to task…', () => {
  it('is on a branch row’s menu and names that branch’s repo and branch', async () => {
    const user = userEvent.setup()
    renderSidebar()
    fireEvent.contextMenu(branchRows()[0])
    await user.click(screen.getByText('Add to task…'))
    expect(useAddToTaskStore.getState().lane).toEqual({ repoRoot: '/b', branch: 'main' })
  })
})

describe('UnifiedSidebar — grouped by task — the task’s state', () => {
  const header = () => screen.getByRole('button', { name: /Login rework/ })

  it('draws the task’s state glyph on its header', async () => {
    renderSidebar()
    await groupByTask()
    expect(within(header()).getByRole('img', { name: 'Quiet' })).toBeTruthy()
  })

  it('says Done once the task is marked done', async () => {
    useTaskStore.setState({ tasks: [{ ...loginTask, doneAt: '2026-10-20T00:00:00.000Z' }] })
    renderSidebar()
    await groupByTask()
    expect(within(header()).getByRole('img', { name: 'Done' })).toBeTruthy()
  })
})
