import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TabBar } from '../../../../src/renderer/components/terminal/TabBar'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useTaskStore } from '../../../../src/renderer/stores/task.store'
import type { Task } from '../../../../src/shared/schemas/tasks.schema'
import {
  projectFixture,
  terminalSessionOf,
  workspaceFixture,
} from '../../../support/renderer-stores'

const openAddToTask = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/components/tasks/add-to-task', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openAddToTask,
}))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => [],
}))

const backend = workspaceFixture({ id: 'ws-1', name: 'Backend', folderPath: '/b' })
const frontend = workspaceFixture({ id: 'ws-2', name: 'Frontend', folderPath: '/f' })
const apiLogin = projectFixture({
  id: 'p-api',
  workspaceId: 'ws-1',
  name: 'login',
  gitBranch: 'login',
})
const webLogin = projectFixture({
  id: 'p-web',
  workspaceId: 'ws-2',
  name: 'login',
  gitBranch: 'login',
})

function taskOf(lanes: Task['lanes']): Task {
  return {
    id: '6f1c2d34-0000-4000-8000-000000000001',
    title: 'Login rework',
    lanes,
    ticket: null,
    focus: false,
    doneAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    archivedAt: null,
  }
}

const TWO_LANES = [
  { repoRoot: '/b', branch: 'login' },
  { repoRoot: '/f', branch: 'login' },
]

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: { project: { list: vi.fn(async () => ({ projects: [] })) } },
  })
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [backend, frontend],
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'p-api',
    projectsByWorkspaceId: new Map([
      ['ws-1', [apiLogin]],
      ['ws-2', [webLogin]],
    ]),
  })
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
    sessions: new Map([
      ['s-api', terminalSessionOf({ id: 's-api', projectId: 'p-api', tabTitle: 'api-shell' })],
      ['s-web', terminalSessionOf({ id: 's-web', projectId: 'p-web', tabTitle: 'web-shell' })],
    ]),
  })
  useTaskStore.setState({ tasks: [taskOf(TWO_LANES)] })
})

function renderTabBar() {
  return render(
    <TabBar
      projectId="p-api"
      activeProjectTabId={null}
      projectTabs={[]}
      onSelectProjectTab={vi.fn()}
      onNewTab={vi.fn()}
    />
  )
}

describe('TabBar — lane switcher', () => {
  it('shows the task title and one button per lane for a task with two lanes', () => {
    renderTabBar()
    expect(screen.getByText('Login rework')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Backend' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Frontend' })).toBeTruthy()
  })

  it('shows nothing for a task with a single lane', () => {
    useTaskStore.setState({ tasks: [taskOf(TWO_LANES.slice(0, 1))] })
    renderTabBar()
    expect(screen.queryByText('Login rework')).toBeNull()
  })

  it('shows nothing for a branch in no task', () => {
    useTaskStore.setState({ tasks: [] })
    renderTabBar()
    expect(screen.queryByRole('button', { name: 'Frontend' })).toBeNull()
  })
})

describe('TabBar — lane switcher — switching', () => {
  it('selects the other lane’s branch when its button is clicked', () => {
    renderTabBar()
    fireEvent.click(screen.getByRole('button', { name: 'Frontend' }))
    expect(useWorkspaceStore.getState().activeProjectId).toBe('p-web')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2')
  })

  it('marks the lane the visible branch is on', () => {
    renderTabBar()
    expect(screen.getByRole('button', { name: 'Backend' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(screen.getByRole('button', { name: 'Frontend' }).getAttribute('aria-pressed')).toBe(
      'false'
    )
  })

  it('draws a needs-you glyph on a lane whose terminal is asking', () => {
    useSessionStore.setState({
      sessions: new Map([
        ['s-web', terminalSessionOf({ id: 's-web', projectId: 'p-web', bellCount: 1 })],
      ]),
    })
    renderTabBar()
    const lane = screen.getByRole('button', { name: /Frontend/ })
    expect(lane.querySelector('[aria-label="Needs you"]')).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Backend' }).querySelector('[aria-label="Needs you"]')
    ).toBeNull()
  })
})

describe('TabBar — Add to task…', () => {
  it('is on a tab’s menu and names the tab’s repo and branch', () => {
    renderTabBar()
    fireEvent.contextMenu(screen.getByText('api-shell'))
    fireEvent.click(screen.getByText('Add to task…'))
    expect(openAddToTask).toHaveBeenCalledWith({ repoRoot: '/b', branch: 'login' })
  })
})

describe('TabBar — lane switcher — one repo, two branches', () => {
  it('names the branch on each lane when two lanes share a repo', () => {
    const apiBilling = projectFixture({
      id: 'p-api-billing',
      workspaceId: 'ws-1',
      name: 'billing',
      gitBranch: 'billing',
    })
    useWorkspaceStore.setState({
      projectsByWorkspaceId: new Map([['ws-1', [apiLogin, apiBilling]]]),
    })
    useTaskStore.setState({
      tasks: [taskOf([TWO_LANES[0], { repoRoot: '/b', branch: 'billing' }])],
    })
    renderTabBar()
    expect(screen.getByRole('button', { name: 'Backend · login' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Backend · billing' })).toBeTruthy()
  })
})
