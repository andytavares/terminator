import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { type WorkThread } from '../../../../src/renderer/home/work-threads'
import type { TaskState } from '../../../../src/renderer/home/task-state'
import { fact } from '../sidebar/fixtures/facts'

const state = vi.hoisted(() => ({ threads: [] as unknown[] }))
const revealBranch = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/renderer/components/home/useWorkThreads', async () => {
  const work = await import('../../../../src/renderer/home/work-threads')
  return {
    useWorkThreads: () => ({
      threads: state.threads,
      groups: work.groupThreads(state.threads as WorkThread[]),
      allThreads: state.threads,
    }),
  }
})
vi.mock('../../../../src/renderer/terminal/reveal-branch', () => ({ revealBranch }))

import { TaskSwitcher } from '../../../../src/renderer/components/task-switcher/TaskSwitcher'
import { useTaskSwitcher } from '../../../../src/renderer/components/task-switcher/task-switcher.store'
import { useDeskSelection } from '../../../../src/renderer/components/home/desk-selection'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'

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
})

const options = () =>
  screen.getAllByRole('option').map((o) => within(o).getByText(/^[A-Z]/).textContent)

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
    expect(within(first).getByText('api · web')).toBeTruthy()
  })

  it('narrows the list as you type', () => {
    render(<TaskSwitcher />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Switch task' }), {
      target: { value: 'check' },
    })
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
  it('opens the most recently active lane’s terminal on Enter, and closes', () => {
    render(<TaskSwitcher />)
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(revealBranch).toHaveBeenCalledWith('login-new-branch')
    expect(useTaskSwitcher.getState().open).toBe(false)
  })

  it('moves the choice with the arrow keys', () => {
    render(<TaskSwitcher />)
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(revealBranch).toHaveBeenCalledWith('checkout-new-branch')
  })

  it('opens Home with the task’s drawer on ⌘Enter', () => {
    render(<TaskSwitcher />)
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true })
    expect(useDeskSelection.getState().openThreadKey).toBe('login')
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
    expect(revealBranch).not.toHaveBeenCalled()
  })
})

describe('TaskSwitcher — choosing otherwise', () => {
  it('opens a task on a click', () => {
    render(<TaskSwitcher />)
    fireEvent.click(screen.getByText('Checkout'))
    expect(revealBranch).toHaveBeenCalledWith('checkout-new-branch')
  })

  it('closes on Escape without choosing', () => {
    render(<TaskSwitcher />)
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(useTaskSwitcher.getState().open).toBe(false)
    expect(revealBranch).not.toHaveBeenCalled()
  })
})
