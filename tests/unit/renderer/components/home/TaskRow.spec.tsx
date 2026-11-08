import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { makeTempDir } from '../../../../support/temp-dir'
import { wireMainTaskStore } from '../../../../support/main-task-store'
import { TaskRow } from '../../../../../src/renderer/components/home/TaskRow'
import { useToastStore } from '../../../../../src/renderer/stores/toast.store'
import { SESSION_DRAG_TYPE } from '../../../../../src/renderer/components/agent/session-drag'
import type { WorkThread } from '../../../../../src/renderer/home/work-threads'
import type { TaskLane } from '../../../../../src/shared/schemas/tasks.schema'

let userData: string
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const api = { repoRoot: '/code/api', branch: 'rate-limits' }
const web = { repoRoot: '/code/web', branch: 'rate-limits' }
let main: Awaited<ReturnType<typeof wireMainTaskStore>>

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

async function twoRows() {
  const rate = await main.createTask({ title: 'Rate limits', lanes: [api] })
  const webSide = await main.createTask({ title: 'Web side', lanes: [web] })
  render(
    <>
      <TaskRow thread={rowThread('Rate limits', api, rate.id)} now={Date.now()} selected={false} />
      <TaskRow thread={rowThread('Web side', web, webSide.id)} now={Date.now()} selected={false} />
    </>
  )
  return {
    rate: screen.getByRole('button', { name: 'Rate limits' }),
    webSide: screen.getByRole('button', { name: 'Web side' }),
  }
}

beforeEach(async () => {
  userData = makeTempDir('task-row-merge-')
  main = await wireMainTaskStore()
  useToastStore.setState({ toasts: [] })
})

describe('TaskRow — drop one row on another to merge', () => {
  it('merges the dragged task into the row it is dropped on, and says so with Undo', async () => {
    const { rate, webSide } = await twoRows()
    fireEvent.dragStart(webSide, { dataTransfer: dataTransfer() })
    fireEvent.dragOver(rate, { dataTransfer: dataTransfer() })
    expect(rate.className).toContain('task-row--drop')
    fireEvent.drop(rate, { dataTransfer: dataTransfer() })
    await waitFor(() => expect(main.listTasks()).toHaveLength(1))
    expect(main.listTasks()[0]).toMatchObject({ title: 'Rate limits', lanes: [api, web] })
    // The toast follows the merge's own promise, which can settle after the store shows the merge.
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    const [toast] = useToastStore.getState().toasts
    expect(toast).toMatchObject({ message: 'Moved "Web side" into "Rate limits"' })
    expect(toast.action?.label).toBe('Undo')
  })

  it('does not take a row dropped on itself', async () => {
    const { webSide } = await twoRows()
    fireEvent.dragStart(webSide, { dataTransfer: dataTransfer() })
    fireEvent.dragOver(webSide, { dataTransfer: dataTransfer() })
    expect(webSide.className).not.toContain('task-row--drop')
    fireEvent.drop(webSide, { dataTransfer: dataTransfer() })
    fireEvent.dragEnd(webSide)
    expect(main.listTasks()).toHaveLength(2)
    expect(useToastStore.getState().toasts).toEqual([])
  })
})

describe('TaskRow — drag feedback', () => {
  it('stays marked as the drop target while the pointer moves onto one of its own chips', async () => {
    const { rate, webSide } = await twoRows()
    fireEvent.dragStart(webSide, { dataTransfer: dataTransfer() })
    fireEvent.dragOver(rate, { dataTransfer: dataTransfer() })
    const chip = rate.querySelector('.task-lane') as HTMLElement
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
    const chips = Array.from(document.querySelectorAll('.task-lane')).map((c) => c.textContent)
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
  it('carries every session of every lane, and still merges when dropped on a row', async () => {
    const rate = await main.createTask({ title: 'Rate limits', lanes: [api] })
    const webSide = await main.createTask({ title: 'Web side', lanes: [web] })
    render(
      <>
        <TaskRow
          thread={rowThread('Rate limits', api, rate.id)}
          now={Date.now()}
          selected={false}
        />
        <TaskRow thread={threadWithSessions(webSide.id)} now={Date.now()} selected={false} />
      </>
    )
    const transfer = dataTransfer()
    fireEvent.dragStart(screen.getByRole('button', { name: 'Web side' }), {
      dataTransfer: transfer,
    })
    expect(transfer.setData).toHaveBeenCalledWith(SESSION_DRAG_TYPE, 's1\ns2\ns3')
    expect(transfer.effectAllowed).toBe('copyMove')
    fireEvent.drop(screen.getByRole('button', { name: 'Rate limits' }), {
      dataTransfer: dataTransfer(),
    })
    await waitFor(() => expect(main.listTasks()).toHaveLength(1))
  })
})

describe('TaskRow — the age and the actions button each have their own space', () => {
  it("puts the age and then the button side by side in the row's last cell", async () => {
    const created = await main.createTask({ title: 'Rate limits', lanes: [api] })
    render(
      <TaskRow
        thread={rowThread('Rate limits', api, created.id)}
        now={Date.now()}
        selected={false}
      />
    )
    const end = screen.getByRole('button', { name: 'Rate limits' }).querySelector('.task-row__end')
    const age = end?.querySelector('.task-row__last')
    const actions = screen.getByRole('button', { name: 'Work actions' })
    expect(age?.textContent).toBe('now')
    expect(end?.contains(actions)).toBe(true)
    expect(age!.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
