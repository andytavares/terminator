import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { TaskRow } from '../../../../../src/renderer/components/home/TaskRow'
import { useToastStore } from '../../../../../src/renderer/stores/toast.store'
import { SESSION_DRAG_TYPE } from '../../../../../src/renderer/components/agent/session-drag'
import type { WorkThread } from '../../../../../src/renderer/home/work-threads'
import type { TaskLane } from '../../../../../src/shared/schemas/tasks.schema'
import { useTaskStore } from '../../../../../src/renderer/stores/task.store'
import { installElectronApi } from '../../../../support/electron-api'
import { task } from '../../home/fixtures'

const api = { repoRoot: '/code/api', branch: 'rate-limits' }
const web = { repoRoot: '/code/web', branch: 'rate-limits' }
const rateTask = task({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Rate limits',
  lanes: [api],
})
const webTask = task({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  title: 'Web side',
  lanes: [web],
})
// Main's answer to a merge: the target task holding both tasks' lanes.
const merge = vi.fn(async () => ({ data: { ...rateTask, lanes: [api, web] } }))
const storedTitles = () => useTaskStore.getState().tasks.map((t) => t.title)

function rowThread(title: string, lane: TaskLane, taskId: string): WorkThread {
  return {
    key: `task:${taskId}`,
    title,
    taskId,
    lanes: [{ ...lane, repoName: lane.repoRoot, repoColor: null, state: 'quiet', sessionIds: [] }],
    sessions: [],
    facets: [],
    links: [],
    state: 'quiet',
    inferred: false,
    focus: false,
    doneAt: null,
    nowLine: '',
    agentsLabel: '',
    prChip: null,
    changes: null,
    lastActivity: Date.now(),
    startedAt: Date.now(),
    archived: false,
    closed: false,
  }
}

const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: '', dropEffect: '' })

function twoRows() {
  render(
    <>
      <TaskRow
        thread={rowThread('Rate limits', api, rateTask.id)}
        now={Date.now()}
        selected={false}
      />
      <TaskRow thread={rowThread('Web side', web, webTask.id)} now={Date.now()} selected={false} />
    </>
  )
  return {
    rate: screen.getByRole('button', { name: 'Rate limits' }),
    webSide: screen.getByRole('button', { name: 'Web side' }),
  }
}

beforeEach(() => {
  merge.mockClear()
  installElectronApi({ tasks: { merge } })
  useTaskStore.setState({ tasks: [rateTask, webTask] })
  useToastStore.setState({ toasts: [] })
})

describe('TaskRow — drop one row on another to merge', () => {
  it('merges the dragged task into the row it is dropped on, and says so with Undo', async () => {
    const { rate, webSide } = twoRows()
    fireEvent.dragStart(webSide, { dataTransfer: dataTransfer() })
    fireEvent.dragOver(rate, { dataTransfer: dataTransfer() })
    expect(rate.className).toContain('task-row--drop')
    fireEvent.drop(rate, { dataTransfer: dataTransfer() })
    await waitFor(() => expect(storedTitles()).toEqual(['Rate limits']))
    expect(merge).toHaveBeenCalledWith({ from: webTask.id, into: rateTask.id })
    // The toast follows the merge's own promise, which can settle after the store shows the merge.
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    const [toast] = useToastStore.getState().toasts
    expect(toast).toMatchObject({ message: 'Moved "Web side" into "Rate limits"' })
    expect(toast.action?.label).toBe('Undo')
  })

  it('does not take a row dropped on itself', async () => {
    const { webSide } = twoRows()
    fireEvent.dragStart(webSide, { dataTransfer: dataTransfer() })
    fireEvent.dragOver(webSide, { dataTransfer: dataTransfer() })
    expect(webSide.className).not.toContain('task-row--drop')
    fireEvent.drop(webSide, { dataTransfer: dataTransfer() })
    fireEvent.dragEnd(webSide)
    expect(merge).not.toHaveBeenCalled()
    expect(storedTitles()).toEqual(['Rate limits', 'Web side'])
    expect(useToastStore.getState().toasts).toEqual([])
  })
})

describe('TaskRow — drag feedback', () => {
  it('stays marked as the drop target while the pointer moves onto one of its own chips', async () => {
    const { rate, webSide } = twoRows()
    fireEvent.dragStart(webSide, { dataTransfer: dataTransfer() })
    fireEvent.dragOver(rate, { dataTransfer: dataTransfer() })
    const [chip] = within(rate).getAllByTitle(/./)
    // jsdom has no DragEvent, so the leave is a mouse event of that type, which carries relatedTarget.
    const leaveTo = (to: Element) =>
      act(() => {
        rate.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: to }))
      })
    leaveTo(chip)
    expect(rate.className).toContain('task-row--drop')
    leaveTo(document.body)
    expect(rate.className).not.toContain('task-row--drop')
  })
})

describe('TaskRow — lane chips', () => {
  it('names two lanes in one repo by their branches, so they read apart', async () => {
    const usage = { repoRoot: '/code/web', branch: 'usage-page' }
    const thread = rowThread('Rate limits', api, 'x')
    const lane = (l: TaskLane, repoName: string) => ({
      ...l,
      repoName,
      repoColor: null,
      state: 'quiet' as const,
      sessionIds: [],
    })
    thread.lanes = [lane(api, 'api'), lane(web, 'web'), lane(usage, 'web')]
    render(<TaskRow thread={thread} now={Date.now()} selected={false} />)
    // Each lane chip carries its label as its tooltip; the actions button has a tooltip of its own.
    const chips = screen.getAllByTitle(/^(api|web · .+)$/).map((chip) => chip.textContent)
    expect(chips).toEqual(['api', 'web · rate-limits', 'web · usage-page'])
  })
})

/** A Home row whose two lanes hold sessions s1, s2 and s3. */
function threadWithSessions(taskId: string): WorkThread {
  const thread = rowThread('Web side', web, taskId)
  const [lane] = thread.lanes
  return {
    ...thread,
    lanes: [
      { ...lane, sessionIds: ['s1', 's2'] },
      { ...lane, sessionIds: ['s3'] },
    ],
  }
}

describe('TaskRow — dragging it to an agent tab', () => {
  it('carries every session of every lane', () => {
    render(<TaskRow thread={threadWithSessions(webTask.id)} now={Date.now()} selected={false} />)
    const transfer = dataTransfer()
    fireEvent.dragStart(screen.getByRole('button', { name: 'Web side' }), {
      dataTransfer: transfer,
    })
    expect(transfer.setData).toHaveBeenCalledWith(SESSION_DRAG_TYPE, 's1\ns2\ns3')
    expect(transfer.effectAllowed).toBe('copyMove')
  })
})

describe('TaskRow — the age and the actions button each have their own space', () => {
  it("puts the age and then the button side by side in the row's last cell", () => {
    render(
      <TaskRow
        thread={rowThread('Rate limits', api, rateTask.id)}
        now={Date.now()}
        selected={false}
      />
    )
    const age = within(screen.getByRole('button', { name: 'Rate limits' })).getByText('now')
    const actions = screen.getByRole('button', { name: 'Work actions' })
    // eslint-disable-next-line testing-library/no-node-access -- sharing one cell is the layout under test; the cell has no role
    expect(age.parentElement!.contains(actions)).toBe(true)
    expect(age.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
