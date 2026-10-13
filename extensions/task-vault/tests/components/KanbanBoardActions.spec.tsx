import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { installBridge, eventually } from './helpers/bridge'

vi.mock('../../src/utils/open-in-browser', () => ({ openInBrowser: vi.fn() }))

const store = {
  selectedContexts: [] as string[],
  setKanbanLanes: vi.fn(),
  loadToday: vi.fn().mockResolvedValue(undefined),
  tickCalendar: vi.fn(),
}
vi.mock('../../src/stores/vault.store', () => ({ useVaultStore: () => store }))

import { KanbanBoard } from '../../src/components/KanbanBoard'

vi.setConfig({ testTimeout: 30_000 })

class TestDragEvent extends MouseEvent {
  dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => {}, getData: () => '' }
}
Object.defineProperty(window, 'DragEvent', { value: TestDragEvent, configurable: true })

const CONFIG = {
  viewMode: 'kanban',
  lanes: [
    { id: 'todo', label: 'Todo', taskStatuses: ['open'] },
    { id: 'done', label: 'Done', taskStatuses: ['done'] },
    { id: 'empty', label: 'Parked', taskStatuses: [] },
  ],
  swimlaneGrouping: 'none',
}

const TASKS = [
  {
    id: 't1',
    text: 'Write',
    status: 'open',
    area: 'Work',
    dueDate: '2026-02-02',
    description: 'see [x](https://x.y)',
  },
  { id: 't2', text: 'Ship', status: 'done', area: 'Home' },
  { id: 't3', text: 'Loose', status: 'open' },
]

let bridge: ReturnType<typeof installBridge>

beforeEach(() => {
  bridge = installBridge()
  bridge.responses['task-vault:kanban:get-config'] = CONFIG
  bridge.responses['task-vault:kanban:list-tasks'] = { tasks: TASKS }
  bridge.responses['task-vault:vault:get-task-detail'] = {
    description: '',
    acceptanceCriteria: '',
    devHints: '',
  }
  vi.clearAllMocks()
})

afterEach(() => cleanup())

const card = (text: string) =>
  screen
    .getByText(text, { selector: '.tv-kanban__card-text' })
    .closest('.tv-kanban__card') as HTMLElement
const lane = (label: string) =>
  screen.getAllByText(label)[0].closest('.tv-kanban__lane') as HTMLElement

describe('KanbanBoard dragging', dragTests)
describe('KanbanBoard cards and config', cardTests)

function dragTests() {
  describe('moving', dragMovingTests)
  describe('ignoring', dragIgnoringTests)
}

function dragMovingTests() {
  it('moves a card to the first status of the lane it is dropped on', async () => {
    const onConfigChange = vi.fn()
    render(<KanbanBoard onConfigChange={onConfigChange} />)
    await screen.findByText('Write')
    fireEvent.dragStart(card('Write'))
    fireEvent.dragOver(lane('Done'))
    expect(lane('Done').className).toContain('dragover')
    fireEvent.dragLeave(lane('Done'))
    expect(lane('Done').className).not.toContain('dragover')
    fireEvent.drop(lane('Done'))
    await eventually(() =>
      expect(bridge.calls('task-vault:kanban:move-task')).toEqual([
        { taskId: 't1', toStatus: 'done' },
      ])
    )
    await eventually(() => expect(store.tickCalendar).toHaveBeenCalled())
    expect(store.loadToday).toHaveBeenCalled()
  })
}

function dragIgnoringTests() {
  it('ignores a drop on a lane with no statuses, or with nothing dragged', async () => {
    render(<KanbanBoard />)
    await screen.findByText('Write')
    fireEvent.drop(lane('Done'))
    fireEvent.dragStart(card('Write'))
    fireEvent.drop(lane('Parked'))
    fireEvent.dragStart(card('Ship'))
    fireEvent.dragEnd(card('Ship'))
    fireEvent.drop(lane('Done'))
    expect(bridge.calls('task-vault:kanban:move-task')).toEqual([])
  })
}

function cardTests() {
  describe('selecting', cardSelectingTests)
  describe('grouping', cardGroupingTests)
  describe('lanes and reloads', cardLanesAndReloadsTests)
}

function cardSelectingTests() {
  it('opens a card in the detail panel and closes it again', async () => {
    render(<KanbanBoard />)
    fireEvent.click(await screen.findByText('Write'))
    expect(card('Write').className).toContain('--selected')
    expect(await screen.findByRole('button', { name: 'Close detail panel' })).toBeTruthy()
    fireEvent.click(card('Write'))
    expect(screen.queryByRole('button', { name: 'Close detail panel' })).toBeNull()
    fireEvent.click(card('Ship'))
    fireEvent.click(await screen.findByRole('button', { name: 'Close detail panel' }))
    expect(screen.queryByRole('button', { name: 'Close detail panel' })).toBeNull()
  })

  it('opens a link in a description without selecting the card, and shows tags', async () => {
    render(<KanbanBoard />)
    fireEvent.click(await screen.findByText('x'))
    expect(card('Write').className).not.toContain('--selected')
    expect(screen.getByText('due:2026-02-02')).toBeTruthy()
  })
}

function cardGroupingTests() {
  it('groups by area with unfiled cards last, and saves the choice', async () => {
    const onConfigChange = vi.fn()
    render(<KanbanBoard onConfigChange={onConfigChange} />)
    await screen.findByText('Write')
    fireEvent.click(screen.getByRole('button', { name: 'Area' }))
    const headers = Array.from(document.querySelectorAll('.tv-kanban__swimlane-header')).map(
      (h) => h.textContent
    )
    expect(headers).toEqual(['Home', 'Work', '(none)'])
    expect(onConfigChange).toHaveBeenCalledWith({ ...CONFIG, swimlaneGrouping: 'area' })
    expect(bridge.calls('task-vault:kanban:save-config')).toEqual([
      { ...CONFIG, swimlaneGrouping: 'area' },
    ])
  })
}

function cardLanesAndReloadsTests() {
  it('saves lanes from the lane editor', async () => {
    render(<KanbanBoard />)
    await screen.findByText('Write')
    fireEvent.click(screen.getByTitle('Edit lanes'))
    fireEvent.click(screen.getByRole('button', { name: 'Save lanes' }))
    await eventually(() => expect(bridge.calls('task-vault:kanban:save-config')).toHaveLength(1))
    expect(screen.queryByRole('button', { name: 'Save lanes' })).toBeNull()
    expect(store.setKanbanLanes).toHaveBeenCalledWith(CONFIG.lanes)
  })

  it('reloads the cards when the index changes, and shows a thrown failure', async () => {
    render(<KanbanBoard />)
    await screen.findByText('Write')
    bridge.responses['task-vault:kanban:list-tasks'] = () => {
      throw new Error('gone')
    }
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    expect(await screen.findByText('Error: gone')).toBeTruthy()
  })
}
