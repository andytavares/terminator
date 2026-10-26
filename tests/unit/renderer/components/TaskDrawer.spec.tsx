import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ThreadDrawer } from '../../../../src/renderer/components/home/ThreadDrawer'
import { useDeskSelection } from '../../../../src/renderer/components/home/desk-selection'
import { useTaskStore } from '../../../../src/renderer/stores/task.store'
import { useParkedThreads } from '../../../../src/renderer/components/home/parked-threads'
import { useDismissedThreads } from '../../../../src/renderer/components/home/dismissed-threads'
import { installElectronApi } from '../../../support/electron-api'
import { FACTS, REPO_ROOT, seedDesk } from '../home/desk-world'
import { task } from '../home/fixtures'
import type { TaskUpdateInput } from '../../../../src/shared/schemas/tasks.schema'

const spies = vi.hoisted(() => ({ open: vi.fn(), facts: [] as unknown[] }))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => spies.facts,
}))
vi.mock('../../../../src/renderer/components/session/session-actions', () => ({
  SESSION_ACTIONS: { onOpen: spies.open, onResume: vi.fn(), onSaveDescription: vi.fn() },
}))
vi.mock('../../../../src/renderer/components/session/SessionLinkDialog', () => ({
  SessionLinkDialog: () => <div role="dialog" aria-label="Link a work item" />,
}))

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const TWO_LANES = [
  { repoRoot: REPO_ROOT, branch: 'tav-20' },
  { repoRoot: REPO_ROOT, branch: 'tav-31' },
]

function openTask(patch: Partial<ReturnType<typeof task>> = {}) {
  useTaskStore.setState({
    tasks: [task({ id: TASK_ID, title: 'Rate limits', lanes: TWO_LANES, ...patch })],
    update: vi.fn(async (input: TaskUpdateInput) => {
      useTaskStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === input.id
            ? { ...t, doneAt: input.done === undefined ? t.doneAt : input.done ? 'now' : null }
            : t
        ),
      }))
      return true
    }),
  })
  useDeskSelection.getState().openThread(`task:${TASK_ID}`)
  render(<ThreadDrawer />)
  return screen.getByRole('dialog', { name: 'Rate limits' })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  spies.facts = FACTS
  seedDesk()
  useDeskSelection.setState({ selectedThreadKey: null, openThreadKey: null, groupBy: 'move' })
  useParkedThreads.setState({ keys: [] })
  useDismissedThreads.setState({ dismissed: {} })
  installElectronApi({
    homeThreadSummary: {
      get: vi.fn().mockResolvedValue({ text: 'Two agents.', generatedAt: 'now' }),
    },
    agentUsage: { get: vi.fn().mockResolvedValue({ data: { sessions: [], totals: {} } }) },
    git: { changeStats: vi.fn().mockResolvedValue({ added: 5, removed: 1, files: 1 }) },
  })
})

const laneRow = (drawer: HTMLElement, branch: string) =>
  within(within(drawer).getByRole('list', { name: 'Lanes' })).getByRole('listitem', {
    name: new RegExp(`${branch} lane`),
  })

describe('the task drawer — lanes', () => {
  it('lists one row per lane with its repo, branch and state', () => {
    const drawer = openTask()
    const asking = within(laneRow(drawer, 'tav-31'))
    expect(asking.getByText('terminator')).toBeTruthy()
    expect(asking.getByRole('img', { name: 'Needs you' })).toBeTruthy()
    expect(asking.getByText(/Run the migration against staging\?/)).toBeTruthy()
    expect(within(laneRow(drawer, 'tav-20')).getByRole('img', { name: 'Running' })).toBeTruthy()
  })

  it('shows a pull request line only for the lane that has one', () => {
    const drawer = openTask()
    expect(within(laneRow(drawer, 'tav-20')).getByText('#275 checks failing')).toBeTruthy()
    expect(within(laneRow(drawer, 'tav-31')).queryByText(/pull request|#\d+/i)).toBeNull()
  })

  it('answers the asking lane and opens the running one', () => {
    const drawer = openTask()
    fireEvent.click(within(laneRow(drawer, 'tav-31')).getByRole('button', { name: 'Answer' }))
    expect(spies.open).toHaveBeenCalledWith('asking')
    fireEvent.click(within(laneRow(drawer, 'tav-20')).getByRole('button', { name: 'Open' }))
    expect(spies.open).toHaveBeenCalledWith('building')
  })

  it('says what the task is and counts what is going on, with no stage bar', () => {
    const drawer = within(openTask())
    expect(drawer.getByText(/1 repo · 2 branches · started/)).toBeTruthy()
    expect(drawer.getByText('1 asking · 1 running · 1 pull request')).toBeTruthy()
    expect(drawer.queryByText(/Building|In review|Shipped/)).toBeNull()
  })
})

describe('the task drawer — task actions', () => {
  it('offers the task actions', () => {
    const drawer = within(openTask())
    for (const name of ['Open all lanes', 'Link a ticket', 'Rename', 'Mark done', 'Archive']) {
      expect(drawer.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('opens every lane that has a terminal', () => {
    const drawer = within(openTask())
    fireEvent.click(drawer.getByRole('button', { name: 'Open all lanes' }))
    expect(spies.open.mock.calls.map(([id]) => id).sort()).toEqual(['asking', 'building'])
  })

  it('swaps Mark done for Undo done once the task is done', async () => {
    const drawer = within(openTask())
    fireEvent.click(drawer.getByRole('button', { name: 'Mark done' }))
    await drawer.findByRole('button', { name: 'Undo done' })
    expect(drawer.queryByRole('button', { name: 'Mark done' })).toBeNull()
  })
})
