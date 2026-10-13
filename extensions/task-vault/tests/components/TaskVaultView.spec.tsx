import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { installBridge, eventually, task } from './helpers/bridge'

/** The props each stubbed view was last rendered with. */
const seen: Record<string, Record<string, unknown>> = {}
function stub(name: string) {
  return (props: Record<string, unknown>) => {
    seen[name] = props
    return <div data-testid={name} />
  }
}
vi.mock('../../src/components/DailyLog', () => ({ DailyLog: stub('daily') }))
vi.mock('../../src/components/CalendarDrawer', () => ({ CalendarDrawer: stub('calendar') }))
vi.mock('../../src/components/KanbanBoard', () => ({ KanbanBoard: stub('kanban') }))
vi.mock('../../src/components/InboxView', () => ({ InboxView: stub('inbox') }))
vi.mock('../../src/components/ProjectsBrowser', () => ({ ProjectsBrowser: stub('projects') }))
vi.mock('../../src/components/AreasView', () => ({ AreasView: stub('areas') }))
vi.mock('../../src/components/ArchiveView', () => ({ ArchiveView: stub('archive') }))
vi.mock('../../src/components/WeeklyReview', () => ({ WeeklyReview: stub('review') }))
vi.mock('../../src/components/DatabaseAdmin', () => ({ DatabaseAdmin: stub('admin') }))
vi.mock('../../src/components/TaskDetailPanel', () => ({ TaskDetailPanel: stub('detail') }))
vi.mock('../../src/utils/notify', () => ({ notify: vi.fn() }))

import { TaskVaultView, CaptureModal } from '../../src/components/TaskVaultView'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'
import { useVaultDataStore } from '../../src/stores/vault-data.store'
import { useVaultFilterStore } from '../../src/stores/vault-filter.store'
import { notify } from '../../src/utils/notify'
import { partialFake } from '../../../../tests/support/fakes'

vi.setConfig({ testTimeout: 30_000 })

let bridge: ReturnType<typeof installBridge>

function localToday(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const LOG = {
  date: localToday(),
  filePath: 'daily',
  tasks: [task('t1', 'Write'), task('t2', 'Read')],
  exists: true,
}

beforeEach(() => {
  vi.mocked(notify).mockClear()
  for (const key of Object.keys(seen)) delete seen[key]
  bridge = installBridge({
    extension: { getSettingsValues: vi.fn().mockResolvedValue({ values: {} }) },
  })
  bridge.responses['task-vault:vault:get-today'] = LOG
  bridge.responses['task-vault:vault:get-daily'] = (p: unknown) => ({
    ...LOG,
    date: (p as { date: string }).date,
  })
  bridge.responses['task-vault:vault:get-inbox'] = { tasks: [task('i1', 'idea')] }
  bridge.responses['task-vault:vault:list-someday'] = { tasks: [task('s1', 'Someday thing')] }
  bridge.responses['task-vault:kanban:list-contexts'] = { contexts: ['home', 'desk'] }
  bridge.responses['task-vault:kanban:get-config'] = {
    lanes: [{ id: 'l', label: 'L', taskStatuses: [] }],
  }
  bridge.responses['task-vault:pop-pending-navigation'] = null
  useVaultNavStore.setState({
    activeView: 'daily',
    viewingDate: null,
    pendingTaskId: null,
    skipNextVisibilityReset: false,
    showCaptureModal: false,
  })
  useVaultDataStore.setState({ todayLog: null, isLoading: false, error: null })
  useVaultFilterStore.setState({ viewMode: 'list', selectedContexts: [] })
})

afterEach(() => cleanup())

async function renderView() {
  render(<TaskVaultView />)
  await screen.findByTestId('daily')
  return seen.daily
}

const daily = () => seen.daily as Record<string, (...args: unknown[]) => unknown>

describe('TaskVaultView loading', loadingTests)
describe('TaskVaultView views', viewSwitchTests)
describe('TaskVaultView daily handlers', dailyTests)
describe('TaskVaultView days and selection', daySelectionTests)
describe('TaskVaultView navigation', navigationTests)
describe('TaskVaultView pending navigation', pendingNavigationTests)
describe('TaskVaultView toolbar', toolbarTests)
describe('TaskVaultView data tools', dataToolsTests)
describe('TaskVaultView import', importTests)
describe('CaptureModal', captureTests)

function loadingTests() {
  it('loads today, the inbox count, contexts, someday tasks and lanes', async () => {
    await renderView()
    expect(useVaultDataStore.getState().inboxCount).toBe(1)
    expect(useVaultDataStore.getState().kanbanLanes).toHaveLength(1)
    expect(seen.daily.isToday).toBe(true)
    expect(screen.getByTestId('calendar')).toBeTruthy()
  })

  it('loads the viewed date instead of today, and reloads on pushes', async () => {
    useVaultNavStore.setState({ viewingDate: '2026-01-02' })
    await renderView()
    expect(bridge.calls('task-vault:vault:get-daily')).toEqual([{ date: '2026-01-02' }])
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    await act(async () => bridge.push('task-vault:push:file-changed-externally', {}))
    await act(async () => bridge.push('task-vault:recurrence-spawned', {}))
    await eventually(() => expect(bridge.calls('task-vault:vault:get-daily').length).toBe(4))
  })
}

function viewSwitchTests() {
  it('shows the load error, and the other views by sidebar', async () => {
    await renderView()
    act(() => useVaultDataStore.setState({ error: 'nope' }))
    expect(screen.getByText('nope')).toBeTruthy()
    for (const [label, id] of [
      ['Inbox', 'inbox'],
      ['Projects', 'projects'],
      ['Areas', 'areas'],
      ['History', 'archive'],
      ['Weekly review', 'review'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
      expect(screen.getByTestId(id)).toBeTruthy()
    }
  })
}

function dailyTests() {
  it('completes a task with a notification that leads back to it', async () => {
    await renderView()
    await act(async () => daily().onTaskComplete('t1'))
    expect(bridge.calls('task-vault:vault:complete-task')).toEqual([{ taskId: 't1' }])
    const [, message, options] = vi.mocked(notify).mock.calls.at(-1)!
    expect(message).toBe('Completed: Write')
    ;(options as { onClick: () => void }).onClick()
    expect(useVaultNavStore.getState().pendingTaskId).toBe('t1')
  })

  it('migrates a task unless the vault says nothing changed', async () => {
    await renderView()
    bridge.responses['task-vault:vault:migrate-task'] = { noop: true }
    await act(async () => daily().onTaskMigrate('t2', '2026-09-09'))
    expect(notify).not.toHaveBeenCalled()
    bridge.responses['task-vault:vault:migrate-task'] = { newTaskId: 'x' }
    await act(async () => daily().onTaskMigrate('zz', '2026-09-09'))
    expect(vi.mocked(notify).mock.calls.at(-1)?.[1]).toBe('Task migrated')
  })

  it('picks up and deletes backlog tasks, and refreshes', async () => {
    await renderView()
    await act(async () => daily().onPickUpToday('s1'))
    await act(async () => daily().onDeleteBacklogTask('s1'))
    await act(async () => daily().onRefresh())
    expect(bridge.calls('task-vault:vault:someday-to-today')).toEqual([{ taskId: 's1' }])
    expect(bridge.calls('task-vault:vault:delete-task')).toEqual([{ taskId: 's1' }])
  })
}

function daySelectionTests() {
  it('moves between days and back to today', async () => {
    await renderView()
    act(() => daily().onPrevDay())
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:get-daily')).toEqual([{ date: localToday(-1) }])
    )
    await eventually(() => expect(seen.daily.isToday).toBe(false))
    await act(async () => daily().onRefresh())
    act(() => daily().onNextDay())
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:get-daily').at(-1)).toEqual({ date: localToday() })
    )
  })

  it('selects a task into the detail panel, toggles it, and closes on Escape or backdrop', async () => {
    await renderView()
    act(() => daily().onSelectTask('t1'))
    expect(seen.detail.taskText).toBe('Write')
    act(() => daily().onSelectTask('t1'))
    expect(screen.queryByTestId('detail')).toBeNull()
    act(() => daily().onSelectTask('s1'))
    expect(seen.detail.taskText).toBe('Someday thing')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('detail')).toBeNull()
    act(() => daily().onSelectTask('t2'))
    fireEvent.click(document.querySelector('.tv-detail-panel__backdrop')!)
    expect(screen.queryByTestId('detail')).toBeNull()
  })
}

function navigationTests() {
  it('opens a task it is told to navigate to, and an explicit view', async () => {
    await renderView()
    await act(async () => bridge.push('task-vault:navigate', { taskId: 't2' }))
    await eventually(() => expect(seen.detail?.taskText).toBe('Read'))
    expect(useVaultNavStore.getState().pendingTaskId).toBeNull()
    await act(async () =>
      bridge.push('task-vault:navigate', { date: '2026-02-02', view: 'review' })
    )
    expect(useVaultNavStore.getState().activeView).toBe('review')
    expect(bridge.calls('task-vault:vault:get-daily')).toContainEqual({ date: '2026-02-02' })
  })

  it('clears a pending task the log does not have once loaded', async () => {
    await renderView()
    act(() => useVaultNavStore.setState({ pendingTaskId: 'ghost' }))
    await eventually(() => expect(useVaultNavStore.getState().pendingTaskId).toBeNull())
  })
}

/** The view is shown again after being hidden. */
function showAgain() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function pendingNavigationTests() {
  it('follows a navigation that arrived before the view existed', async () => {
    bridge.responses['task-vault:pop-pending-navigation'] = {
      date: '2026-03-03',
      taskId: 't1',
      view: 'daily',
    }
    await renderView()
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:get-daily')).toContainEqual({ date: '2026-03-03' })
    )
    expect(useVaultNavStore.getState().skipNextVisibilityReset).toBe(true)
  })

  it('returns to today when shown again, unless a navigation asked otherwise', async () => {
    await renderView()
    useVaultNavStore.setState({
      activeView: 'inbox',
      viewingDate: '2026-01-01',
      skipNextVisibilityReset: true,
    })
    showAgain()
    expect(useVaultNavStore.getState().activeView).toBe('inbox')
    showAgain()
    expect(useVaultNavStore.getState().activeView).toBe('daily')
    expect(useVaultNavStore.getState().viewingDate).toBeNull()
  })
}

function toolbarTests() {
  it('switches between list and board views', async () => {
    await renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Board view' }))
    expect(screen.getByTestId('kanban')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(screen.getByTestId('daily')).toBeTruthy()
  })

  it('filters by contexts and labels the filter by what is chosen', async () => {
    await renderView()
    const filter = screen.getByRole('button', { name: 'Filter by context' })
    fireEvent.click(filter)
    fireEvent.click(await screen.findByLabelText('+home'))
    expect(filter.textContent).toContain('+home')
    fireEvent.click(screen.getByLabelText('+desk'))
    expect(filter.textContent).toContain('2 contexts')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(filter.textContent).toContain('Filter')
  })

  it('hides the calendar, and says when there are no contexts', async () => {
    bridge.responses['task-vault:kanban:list-contexts'] = { contexts: [] }
    await renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))
    expect(screen.queryByTestId('calendar')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Filter by context' }))
    expect(screen.getByText('No contexts found')).toBeTruthy()
  })
}

async function openDataTools() {
  await renderView()
  fireEvent.click(screen.getByRole('button', { name: 'Data tools (export / import)' }))
}

function dataToolsTests() {
  it('exports the vault as a dated JSON download, or reports a failure', async () => {
    const createObjectURL = vi.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    bridge.responses['task-vault:vault:export-json'] = { version: 1 }
    await openDataTools()
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))
    expect(await screen.findByText('Exported successfully.')).toBeTruthy()
    expect(click).toHaveBeenCalled()
    bridge.responses['task-vault:vault:export-json'] = { error: 'locked' }
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))
    expect(await screen.findByText('Export failed: locked')).toBeTruthy()
    click.mockRestore()
  })
}

function importTests() {
  it('imports a chosen JSON file, reporting the count or the failure', async () => {
    await openDataTools()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = (text: string) => partialFake<File>({ text: async () => text })
    bridge.responses['task-vault:vault:import-json'] = { success: true, imported: 3 }
    fireEvent.click(screen.getByRole('button', { name: 'Import JSON' }))
    fireEvent.change(input, { target: { files: [file('{"tasks":[]}')] } })
    expect(await screen.findByText('Imported 3 records successfully.')).toBeTruthy()
    bridge.responses['task-vault:vault:import-json'] = { error: 'bad' }
    fireEvent.change(input, { target: { files: [file('{}')] } })
    expect(await screen.findByText('Import failed: bad')).toBeTruthy()
    fireEvent.change(input, { target: { files: [file('not json')] } })
    expect(await screen.findByText(/Import failed: SyntaxError/)).toBeTruthy()
    fireEvent.change(input, { target: { files: [] } })
  })

  it('shows the database console, which reloads after a write', async () => {
    await openDataTools()
    fireEvent.click(screen.getByRole('tab', { name: 'Database' }))
    act(() => (seen.admin.onWrite as () => void)())
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:get-today').length).toBeGreaterThan(1)
    )
  })
}

function captureTests() {
  it('captures to the inbox and closes', async () => {
    useVaultNavStore.setState({ showCaptureModal: true })
    render(<CaptureModal />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' remember milk ' } })
    fireEvent.click(screen.getByRole('button', { name: /Capture/ }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:capture')).toEqual([{ text: 'remember milk' }])
    )
    await eventually(() => expect(useVaultNavStore.getState().showCaptureModal).toBe(false))
  })

  it('closes on Escape without capturing, and renders nothing when hidden', () => {
    useVaultNavStore.setState({ showCaptureModal: true })
    render(<CaptureModal />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useVaultNavStore.getState().showCaptureModal).toBe(false)
    expect(bridge.calls('task-vault:vault:capture')).toEqual([])
    expect(screen.queryByRole('textbox')).toBeNull()
  })
}
