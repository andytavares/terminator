import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installVaultBridge, eventually, task, dayFromToday } from './helpers/bridge'
import { setLocalClock } from '../support/clock'

/** The props each stubbed view was last rendered with. */
const seen: Record<string, Record<string, unknown>> = {}
function stubComponent(name: string) {
  return (props: Record<string, unknown>) => {
    seen[name] = props
    return <div data-testid={name} />
  }
}
vi.mock('../../src/components/DailyLog', () => ({ DailyLog: stubComponent('daily') }))
vi.mock('../../src/components/CalendarDrawer', () => ({
  CalendarDrawer: stubComponent('calendar'),
}))
vi.mock('../../src/components/InboxView', () => ({ InboxView: stubComponent('inbox') }))
vi.mock('../../src/components/ProjectsBrowser', () => ({
  ProjectsBrowser: stubComponent('projects'),
}))
vi.mock('../../src/components/AreasView', () => ({ AreasView: stubComponent('areas') }))
vi.mock('../../src/components/ArchiveView', () => ({ ArchiveView: stubComponent('archive') }))
vi.mock('../../src/components/DatabaseAdmin', () => ({ DatabaseAdmin: stubComponent('admin') }))
vi.mock('../../src/components/TaskDetailPanel', () => ({
  TaskDetailPanel: stubComponent('detail'),
}))
vi.mock('../../src/utils/notify', () => ({ notify: vi.fn() }))

import { TaskVaultView, CaptureModal } from '../../src/components/TaskVaultView'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'
import { useVaultDataStore } from '../../src/stores/vault-data.store'
import { useVaultFilterStore } from '../../src/stores/vault-filter.store'
import { notify } from '../../src/utils/notify'

let bridge: ReturnType<typeof installVaultBridge>

const LOG = {
  date: '2026-01-15',
  filePath: 'daily',
  tasks: [task('t1', 'Write'), task('t2', 'Read')],
  exists: true,
}

beforeEach(() => {
  setLocalClock('UTC', '2026-01-15T12:00:00.000Z')
  vi.mocked(notify).mockClear()
  for (const key of Object.keys(seen)) delete seen[key]
  bridge = installVaultBridge({
    extension: { getSettingsValues: vi.fn().mockResolvedValue({ values: {} }) },
  })
  bridge.responses['task-vault:vault:get-today'] = LOG
  bridge.responses['task-vault:vault:get-daily'] = (p: unknown) => ({
    ...LOG,
    date: (p as { date: string }).date,
  })
  bridge.responses['task-vault:vault:get-inbox'] = { tasks: [task('i1', 'idea')] }
  bridge.responses['task-vault:vault:list-someday'] = { tasks: [task('s1', 'Someday thing')] }
  bridge.responses['task-vault:vault:list-contexts'] = { contexts: ['home', 'desk'] }
  bridge.responses['task-vault:pop-pending-navigation'] = null
  useVaultNavStore.setState({
    activeView: 'daily',
    viewingDate: null,
    pendingTaskId: null,
    skipNextVisibilityReset: false,
    showCaptureModal: false,
  })
  useVaultDataStore.setState({ todayLog: null, isLoading: false, error: null })
  useVaultFilterStore.setState({ selectedContexts: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function renderVaultView() {
  render(<TaskVaultView />)
  await screen.findByTestId('daily')
  return seen.daily
}

const dailyLogProps = () => seen.daily as Record<string, (...args: unknown[]) => unknown>

describe('TaskVaultView loading', viewLoadingTests)
describe('TaskVaultView views', viewSwitchTests)
describe('TaskVaultView daily handlers', dailyTests)
describe('TaskVaultView days and selection', daySelectionTests)
describe('TaskVaultView detail panel closing', detailClosingTests)
describe('TaskVaultView navigation', navigationTests)
describe('TaskVaultView pending navigation', pendingNavigationTests)
describe('TaskVaultView toolbar', toolbarTests)
describe('TaskVaultView data tools', dataToolsTests)
describe('TaskVaultView import', importTests)
describe('CaptureModal', captureTests)

function viewLoadingTests() {
  it('loads today, the inbox count, contexts, and someday tasks', async () => {
    await renderVaultView()
    expect(useVaultDataStore.getState().inboxCount).toBe(1)
    expect(seen.daily.isToday).toBe(true)
    expect(screen.getByTestId('calendar')).toBeTruthy()
  })

  it('loads the viewed date instead of today, and reloads on pushes', async () => {
    useVaultNavStore.setState({ viewingDate: '2026-01-02' })
    await renderVaultView()
    expect(bridge.calls('task-vault:vault:get-daily')).toEqual([{ date: '2026-01-02' }])
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    await act(async () => bridge.push('task-vault:push:file-changed-externally', {}))
    await act(async () => bridge.push('task-vault:recurrence-spawned', {}))
    await eventually(() => expect(bridge.calls('task-vault:vault:get-daily').length).toBe(4))
  })
}

function viewSwitchTests() {
  it('shows the load error', async () => {
    await renderVaultView()
    act(() => useVaultDataStore.setState({ error: 'nope' }))
    expect(screen.getByText('nope')).toBeTruthy()
  })

  it.each([
    ['Inbox', 'inbox'],
    ['Projects', 'projects'],
    ['Areas', 'areas'],
    ['History', 'archive'],
  ])('shows the %s view when its sidebar button is pressed', async (label, id) => {
    const user = userEvent.setup()
    await renderVaultView()
    await user.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
    expect(screen.getByTestId(id)).toBeTruthy()
  })
}

function dailyTests() {
  it('completes a task with a notification that leads back to it', async () => {
    await renderVaultView()
    await act(async () => dailyLogProps().onTaskComplete('t1'))
    expect(bridge.calls('task-vault:vault:complete-task')).toEqual([{ taskId: 't1' }])
    const [, message, options] = vi.mocked(notify).mock.calls.at(-1)!
    expect(message).toBe('Completed: Write')
    ;(options as { onClick: () => void }).onClick()
    expect(useVaultNavStore.getState().pendingTaskId).toBe('t1')
  })

  it('migrates a task unless the vault says nothing changed', async () => {
    await renderVaultView()
    bridge.responses['task-vault:vault:migrate-task'] = { noop: true }
    await act(async () => dailyLogProps().onTaskMigrate('t2', '2026-09-09'))
    expect(notify).not.toHaveBeenCalled()
    bridge.responses['task-vault:vault:migrate-task'] = { newTaskId: 'x' }
    await act(async () => dailyLogProps().onTaskMigrate('zz', '2026-09-09'))
    expect(vi.mocked(notify).mock.calls.at(-1)?.[1]).toBe('Task migrated')
  })

  it('picks up and deletes backlog tasks, and refreshes', async () => {
    await renderVaultView()
    await act(async () => dailyLogProps().onPickUpToday('s1'))
    await act(async () => dailyLogProps().onDeleteBacklogTask('s1'))
    await act(async () => dailyLogProps().onRefresh())
    expect(bridge.calls('task-vault:vault:someday-to-today')).toEqual([{ taskId: 's1' }])
    expect(bridge.calls('task-vault:vault:delete-task')).toEqual([{ taskId: 's1' }])
  })
}

function daySelectionTests() {
  it('moves between days and back to today', async () => {
    await renderVaultView()
    act(() => void dailyLogProps().onPrevDay())
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:get-daily')).toEqual([{ date: dayFromToday(-1) }])
    )
    await eventually(() => expect(seen.daily.isToday).toBe(false))
    await act(async () => dailyLogProps().onRefresh())
    act(() => void dailyLogProps().onNextDay())
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:get-daily').at(-1)).toEqual({ date: dayFromToday() })
    )
  })

  it('selects a task into the detail panel, and closes it when the task is selected again', async () => {
    await renderVaultView()
    act(() => void dailyLogProps().onSelectTask('t1'))
    expect(seen.detail.taskText).toBe('Write')
    act(() => void dailyLogProps().onSelectTask('t1'))
    expect(screen.queryByTestId('detail')).toBeNull()
  })

  it('shows a backlog task in the detail panel', async () => {
    await renderVaultView()
    act(() => void dailyLogProps().onSelectTask('s1'))
    expect(seen.detail.taskText).toBe('Someday thing')
  })
}

function detailClosingTests() {
  it('closes the detail panel on Escape', async () => {
    const user = userEvent.setup()
    await renderVaultView()
    act(() => void dailyLogProps().onSelectTask('s1'))
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('detail')).toBeNull()
  })

  it('closes the detail panel when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    await renderVaultView()
    act(() => void dailyLogProps().onSelectTask('t2'))
    await user.click(document.querySelector('.tv-detail-panel__backdrop')!)
    expect(screen.queryByTestId('detail')).toBeNull()
  })
}

function navigationTests() {
  it('opens a task it is told to navigate to, and a day', async () => {
    await renderVaultView()
    await act(async () => bridge.push('task-vault:navigate', { taskId: 't2' }))
    await eventually(() => expect(seen.detail?.taskText).toBe('Read'))
    expect(useVaultNavStore.getState().pendingTaskId).toBeNull()
    await act(async () => bridge.push('task-vault:navigate', { date: '2026-02-02' }))
    expect(bridge.calls('task-vault:vault:get-daily')).toContainEqual({ date: '2026-02-02' })
  })

  it('clears a pending task the log does not have once loaded', async () => {
    await renderVaultView()
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
    }
    await renderVaultView()
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:get-daily')).toContainEqual({ date: '2026-03-03' })
    )
    expect(useVaultNavStore.getState().skipNextVisibilityReset).toBe(true)
  })

  it('returns to today when shown again, unless a navigation asked otherwise', async () => {
    await renderVaultView()
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
  it('filters by contexts and labels the filter by what is chosen', async () => {
    const user = userEvent.setup()
    await renderVaultView()
    const filter = screen.getByRole('button', { name: 'Filter by context' })
    await user.click(filter)
    await user.click(await screen.findByLabelText('+home'))
    expect(filter.textContent).toContain('+home')
    await user.click(screen.getByLabelText('+desk'))
    expect(filter.textContent).toContain('2 contexts')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(filter.textContent).toContain('Filter')
  })

  it('hides the calendar when its toolbar button is pressed', async () => {
    const user = userEvent.setup()
    await renderVaultView()
    await user.click(screen.getByRole('button', { name: 'Calendar' }))
    expect(screen.queryByTestId('calendar')).toBeNull()
  })

  it('says when there are no contexts to filter by', async () => {
    const user = userEvent.setup()
    bridge.responses['task-vault:vault:list-contexts'] = { contexts: [] }
    await renderVaultView()
    await user.click(screen.getByRole('button', { name: 'Filter by context' }))
    expect(screen.getByText('No contexts found')).toBeTruthy()
  })
}

async function openDataToolsMenu() {
  const user = userEvent.setup()
  await renderVaultView()
  await user.click(screen.getByRole('button', { name: 'Data tools (export / import)' }))
  return user
}

function stubDownload() {
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
}

function dataToolsTests() {
  it('exports the vault as a JSON download', async () => {
    const click = stubDownload()
    bridge.responses['task-vault:vault:export-json'] = { version: 1 }
    const user = await openDataToolsMenu()
    await user.click(screen.getByRole('button', { name: 'Export JSON' }))
    expect(await screen.findByText('Exported successfully.')).toBeTruthy()
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('reports an export failure without downloading', async () => {
    const click = stubDownload()
    bridge.responses['task-vault:vault:export-json'] = { error: 'locked' }
    const user = await openDataToolsMenu()
    await user.click(screen.getByRole('button', { name: 'Export JSON' }))
    expect(await screen.findByText('Export failed: locked')).toBeTruthy()
    expect(click).not.toHaveBeenCalled()
  })
}

const jsonFile = (text: string) => new File([text], 'vault.json', { type: 'application/json' })
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement

function importTests() {
  it('imports a chosen JSON file and reports the count', async () => {
    bridge.responses['task-vault:vault:import-json'] = { success: true, imported: 3 }
    const user = await openDataToolsMenu()
    await user.upload(fileInput(), jsonFile('{"tasks":[]}'))
    expect(await screen.findByText('Imported 3 records successfully.')).toBeTruthy()
  })

  it('reports the failure the vault returns for an import', async () => {
    bridge.responses['task-vault:vault:import-json'] = { error: 'bad' }
    const user = await openDataToolsMenu()
    await user.upload(fileInput(), jsonFile('{}'))
    expect(await screen.findByText('Import failed: bad')).toBeTruthy()
  })

  it('reports a file that is not JSON', async () => {
    const user = await openDataToolsMenu()
    await user.upload(fileInput(), jsonFile('not json'))
    expect(await screen.findByText(/Import failed: SyntaxError/)).toBeTruthy()
    expect(bridge.calls('task-vault:vault:import-json')).toEqual([])
  })

  it('shows the database console, which reloads after a write', async () => {
    const user = await openDataToolsMenu()
    await user.click(screen.getByRole('tab', { name: 'Database' }))
    act(() => (seen.admin.onWrite as () => void)())
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:get-today').length).toBeGreaterThan(1)
    )
  })
}

function captureTests() {
  it('captures the trimmed text to the inbox and closes', async () => {
    const user = userEvent.setup()
    useVaultNavStore.setState({ showCaptureModal: true })
    render(<CaptureModal />)
    await user.type(screen.getByRole('textbox'), ' remember milk ')
    await user.click(screen.getByRole('button', { name: /Capture/ }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:capture')).toEqual([{ text: 'remember milk' }])
    )
    await eventually(() => expect(useVaultNavStore.getState().showCaptureModal).toBe(false))
  })

  it('closes on Escape without capturing', async () => {
    const user = userEvent.setup()
    useVaultNavStore.setState({ showCaptureModal: true })
    render(<CaptureModal />)
    await user.keyboard('{Escape}')
    expect(useVaultNavStore.getState().showCaptureModal).toBe(false)
    expect(bridge.calls('task-vault:vault:capture')).toEqual([])
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('renders nothing while the capture modal is hidden', () => {
    render(<CaptureModal />)
    expect(screen.queryByRole('textbox')).toBeNull()
  })
}
