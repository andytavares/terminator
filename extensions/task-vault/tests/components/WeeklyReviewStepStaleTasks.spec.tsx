import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const mockInvoke = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: {
    extensionBridge: {
      invoke: mockInvoke,
      on: vi.fn(() => vi.fn()),
    },
  },
  writable: true,
  configurable: true,
})

import { WeeklyReviewStepStaleTasks } from '../../src/components/WeeklyReviewStepStaleTasks'
import type { IndexedTask } from '../../src/vault/types'

function makeTask(overrides: Partial<IndexedTask> = {}): IndexedTask {
  return {
    id: `task-${Math.random()}`,
    filePath: 'daily/2024-01-01.md',
    line: 0,
    status: 'open',
    text: 'A stale task',
    terminatorLinks: [],
    todaySince: '2024-01-01',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  mockInvoke.mockResolvedValue({ success: true })
})

describe('WeeklyReviewStepStaleTasks', () => {
  it('shows "no stale tasks" when list is empty', () => {
    const onComplete = vi.fn()
    render(
      <WeeklyReviewStepStaleTasks staleTasks={[]} staleDaysThreshold={7} onComplete={onComplete} />
    )
    expect(screen.getByText(/no stale tasks/i)).toBeTruthy()
  })

  it('renders stale tasks with text', () => {
    const task = makeTask({ text: 'Fix the thing', todaySince: '2024-01-01' })
    render(
      <WeeklyReviewStepStaleTasks staleTasks={[task]} staleDaysThreshold={7} onComplete={vi.fn()} />
    )
    expect(screen.getByText('Fix the thing')).toBeTruthy()
    expect(screen.getByText(/since 2024-01-01/i)).toBeTruthy()
  })

  it('shows threshold in description', () => {
    render(
      <WeeklyReviewStepStaleTasks staleTasks={[]} staleDaysThreshold={14} onComplete={vi.fn()} />
    )
    expect(screen.getByText(/14 days/i)).toBeTruthy()
  })

  it('backlog action removes task from list and calls process-inbox-item', async () => {
    const task = makeTask({ id: 'task-abc', text: 'Stale backlog test' })
    render(
      <WeeklyReviewStepStaleTasks staleTasks={[task]} staleDaysThreshold={7} onComplete={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: /backlog/i }))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'task-vault:vault:process-inbox-item',
        expect.objectContaining({ taskId: 'task-abc', action: 'someday' })
      )
    })
    expect(screen.queryByText('Stale backlog test')).toBeNull()
  })

  it('delete action removes task from list and calls cancel-task', async () => {
    const task = makeTask({ id: 'task-del', text: 'Stale delete test' })
    render(
      <WeeklyReviewStepStaleTasks staleTasks={[task]} staleDaysThreshold={7} onComplete={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('task-vault:vault:cancel-task', {
        taskId: 'task-del',
      })
    })
    expect(screen.queryByText('Stale delete test')).toBeNull()
  })

  it('keep action removes task from list and calls reset-today-since', async () => {
    const task = makeTask({ id: 'task-keep', text: 'Stale keep test' })
    render(
      <WeeklyReviewStepStaleTasks staleTasks={[task]} staleDaysThreshold={7} onComplete={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: /keep/i }))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('task-vault:vault:reset-today-since', {
        taskId: 'task-keep',
      })
    })
    expect(screen.queryByText('Stale keep test')).toBeNull()
  })

  it('calls onComplete when Next button is clicked', () => {
    const onComplete = vi.fn()
    render(
      <WeeklyReviewStepStaleTasks staleTasks={[]} staleDaysThreshold={7} onComplete={onComplete} />
    )
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(onComplete).toHaveBeenCalled()
  })
})
