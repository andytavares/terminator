import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type WorkThread } from '../../../../src/home/work-threads'
import type { TaskState } from '../../../../src/home/task-state'
import { fact } from '../sidebar/fixtures/facts'

const state = vi.hoisted(() => ({ threads: [] as unknown[] }))

vi.mock('../../../../src/components/home/useWorkThreads', async () => {
  const work = await import('../../../../src/home/work-threads')
  return {
    useWorkThreads: () => ({
      threads: state.threads,
      groups: work.groupThreads(state.threads as WorkThread[]),
      allThreads: state.threads,
      settledThreads: [],
    }),
  }
})

import { TaskSwitcher } from '../../../../src/components/task-switcher/TaskSwitcher'
import { useTaskSwitcher } from '../../../../src/components/task-switcher/task-switcher.store'
import { useDeskSelection } from '../../../../src/components/home/desk-selection'
import { useExtensionRegistry } from '../../../../src/extensions/registry'
import { useWorkspaceStore } from '../../../../src/stores/workspace.store'
import { useSessionStore } from '../../../../src/stores/session.store'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import { projectFixture } from '../../../../../test-support/src/renderer-stores'

// Each thread's branches, as projects of one workspace, so `revealBranch` can select them.
const projects = ['checkout', 'login'].flatMap((key) => [
  projectFixture({ id: `${key}-old-branch`, workspaceId: 'ws-1' }),
  projectFixture({ id: `${key}-new-branch`, workspaceId: 'ws-1' }),
])
const activeProjectId = () => useWorkspaceStore.getState().activeProjectId

function threadOf(key: string, title: string, patch: { state: TaskState; archived?: boolean }) {
  const lane = {
    repoRoot: '/api',
    repoName: 'api',
    repoColor: null,
    branch: key,
    state: patch.state,
  }
  return {
    key,
    title,
    taskId: key,
    lanes: [lane, { ...lane, repoRoot: '/web', repoName: 'web' }],
    sessions: [
      fact({ sessionId: `${key}-old`, projectId: `${key}-old-branch`, lastActivityAt: 1 }),
      fact({ sessionId: `${key}-new`, projectId: `${key}-new-branch`, lastActivityAt: 9 }),
    ],
    inferred: false,
    focus: false,
    archived: false,
    startedAt: 1,
    ...patch,
  } as unknown as WorkThread
}

beforeEach(() => {
  vi.clearAllMocks()
  state.threads = [
    threadOf('checkout', 'Checkout', { state: 'running' }),
    threadOf('login', 'Login rework', { state: 'needs-you' }),
    threadOf('old', 'Retired', { state: 'quiet', archived: true }),
  ]
  useTaskSwitcher.setState({ open: true })
  useDeskSelection.setState({ openThreadKey: null, selectedThreadKey: null })
  useExtensionRegistry.setState(useExtensionRegistry.getInitialState(), true)
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  installElectronApi({ project: { list: vi.fn(async () => ({ projects })) } })
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    projectsByWorkspaceId: new Map([['ws-1', projects]]),
  })
})

const options = () =>
  screen.getAllByRole('option').map((o) => within(o).getByText(/^[A-Z]/).textContent)

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/usage/record', () => ({ recordUse }))

describe('TaskSwitcher — what it lists', () => {
  it('lists tasks grouped in state order, needs you first, leaving archived ones out', () => {
    render(<TaskSwitcher />)
    expect(options()).toEqual(['Login rework', 'Checkout'])
    expect(screen.queryByText('Retired')).toBeNull()
  })

  it('names each task’s lanes and draws its state glyph', () => {
    render(<TaskSwitcher />)
    const first = screen.getAllByRole('option')[0]
    expect(within(first).getByRole('img', { name: 'Needs you' })).toBeTruthy()
    expect(within(first).getByText('api, web')).toBeTruthy()
  })

  it('narrows the list as you type', async () => {
    const user = userEvent.setup()
    render(<TaskSwitcher />)
    await user.type(screen.getByRole('combobox', { name: 'Switch task' }), 'check')
    expect(options()).toEqual(['Checkout'])
  })

  it('draws nothing while closed', () => {
    useTaskSwitcher.setState({ open: false })
    render(<TaskSwitcher />)
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})

const field = () => screen.getByRole('combobox', { name: 'Switch task' })

describe('TaskSwitcher — choosing with the keyboard', () => {
  it('opens the most recently active lane’s terminal on Enter, and closes', async () => {
    const user = userEvent.setup()
    render(<TaskSwitcher />)
    await user.type(field(), '{Enter}')
    expect(activeProjectId()).toBe('login-new-branch')
    expect(useTaskSwitcher.getState().open).toBe(false)
  })

  it('moves the choice with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<TaskSwitcher />)
    await user.type(field(), '{ArrowDown}')
    await user.keyboard('{Enter}')
    expect(activeProjectId()).toBe('checkout-new-branch')
  })

  it('opens Home with the task’s drawer on ⌘Enter', async () => {
    const user = userEvent.setup()
    render(<TaskSwitcher />)
    await user.type(field(), '{Meta>}{Enter}{/Meta}')
    expect(useDeskSelection.getState().openThreadKey).toBe('login')
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
    expect(activeProjectId()).toBeNull()
  })
})

describe('TaskSwitcher — choosing otherwise', () => {
  it('opens a task on a click', async () => {
    const user = userEvent.setup()
    render(<TaskSwitcher />)
    await user.click(screen.getByText('Checkout'))
    expect(activeProjectId()).toBe('checkout-new-branch')
  })

  it('closes on Escape without choosing', async () => {
    const user = userEvent.setup()
    render(<TaskSwitcher />)
    await user.type(field(), '{Escape}')
    expect(useTaskSwitcher.getState().open).toBe(false)
    expect(activeProjectId()).toBeNull()
  })
})
