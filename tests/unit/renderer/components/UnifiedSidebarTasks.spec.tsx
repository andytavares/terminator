import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useTaskStore } from '../../../../src/renderer/stores/task.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { UnifiedSidebar } from '../../../../src/renderer/components/sidebar/UnifiedSidebar'
import type { Task } from '../../../../src/shared/schemas/tasks.schema'
import { projectFixture, workspaceFixture } from '../../../support/renderer-stores'

const openAddToTask = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/components/tasks/add-to-task', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openAddToTask,
}))
vi.mock('../../../../src/renderer/hooks/useBranchSync', () => ({ useBranchSync: vi.fn() }))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => [],
}))
vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
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
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: { project: { list: vi.fn(async () => ({ projects: [] })) } },
  })
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

function groupByTask(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Display' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Task' }))
}

const rowNames = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.branch-row__name')).map((r) => r.textContent)

describe('UnifiedSidebar — grouped by task', () => {
  it('shows the task with its three lanes, then the other branches under "Not in a task"', () => {
    const { container } = renderSidebar()
    groupByTask()
    expect(screen.getByText('Login rework')).toBeTruthy()
    expect(screen.getByText('Not in a task')).toBeTruthy()
    expect(rowNames(container)).toEqual([
      'Backend · login',
      'Frontend · login',
      'Docs · login',
      'main',
    ])
  })

  it('draws no repo header for a repo whose only branch is in the task', () => {
    const { container } = renderSidebar()
    groupByTask()
    const headers = Array.from(container.querySelectorAll('.repo-header__name')).map(
      (h) => h.textContent
    )
    expect(headers).toEqual(['Login rework', 'Backend'])
  })
})

describe('UnifiedSidebar — grouped by task — the default', () => {
  it('leaves the default grouping by repo, with no task row', () => {
    const { container } = renderSidebar()
    expect(screen.queryByText('Login rework')).toBeNull()
    expect(rowNames(container)).toEqual(['main', 'login', 'login', 'login'])
  })

  it('remembers the choice across a reload', () => {
    const first = renderSidebar()
    groupByTask()
    first.unmount()
    renderSidebar()
    expect(screen.getByText('Login rework')).toBeTruthy()
  })
})

describe('UnifiedSidebar — Add to task…', () => {
  it('is on a branch row’s menu and names that branch’s repo and branch', () => {
    const { container } = renderSidebar()
    fireEvent.contextMenu(container.querySelectorAll('.branch-row')[0])
    fireEvent.click(screen.getByText('Add to task…'))
    expect(openAddToTask).toHaveBeenCalledWith({ repoRoot: '/b', branch: 'main' })
  })
})

describe('UnifiedSidebar — grouped by task — the task’s state', () => {
  const header = () => screen.getByText('Login rework').closest('.repo-header') as HTMLElement

  it('draws the task’s state glyph on its header', () => {
    renderSidebar()
    groupByTask()
    expect(within(header()).getByRole('img', { name: 'Quiet' })).toBeTruthy()
  })

  it('says Done once the task is marked done', () => {
    useTaskStore.setState({ tasks: [{ ...loginTask, doneAt: '2026-10-20T00:00:00.000Z' }] })
    renderSidebar()
    groupByTask()
    expect(within(header()).getByRole('img', { name: 'Done' })).toBeTruthy()
  })
})
