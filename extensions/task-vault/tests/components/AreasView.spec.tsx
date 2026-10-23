import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { installVaultBridge, eventually, task } from './helpers/bridge'
import { invalidateSmartInputCache } from '../../src/components/SmartTaskInput'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'
import { AreasView } from '../../src/components/AreasView'

let bridge: ReturnType<typeof installVaultBridge>

function areaProject(name: string, open: number, total = 4) {
  return {
    id: `p-${name}`,
    filePath: name,
    name,
    status: 'active',
    nextActionCount: open,
    totalTaskCount: total,
    doneTaskCount: total - open,
  }
}

const WORK = {
  filePath: 'Work',
  name: 'Work',
  status: 'active',
  taskCount: 4,
  openTaskCount: 1,
  tasks: [
    task('w1', 'Plan sprint', {
      project: 'Launch',
      context: 'desk',
      dueDate: '2026-02-01',
      area: 'Work',
    }),
    task('w2', 'Old thing', { status: 'done' }),
  ],
  projects: ['Alpha', 'Beta', 'Gamma', 'Delta'].map((n, i) => areaProject(n, i)),
}
const HOME = {
  filePath: 'Home',
  name: 'Home',
  status: 'active',
  taskCount: 0,
  openTaskCount: 0,
  tasks: [],
}
const OLD = {
  filePath: 'Old',
  name: 'Old',
  status: 'archived',
  taskCount: 1,
  openTaskCount: 0,
  tasks: [],
}

beforeEach(() => {
  invalidateSmartInputCache()
  bridge = installVaultBridge({
    extension: { getSettingsValues: vi.fn().mockResolvedValue({ values: {} }) },
  })
  bridge.responses['task-vault:vault:list-areas'] = (payload: unknown) => {
    const status = (payload as { status?: string } | undefined)?.status
    return { areas: status === 'archived' ? [OLD] : [WORK, HOME] }
  }
  bridge.responses['task-vault:projects:list'] = { projects: [] }
  useVaultNavStore.setState({
    selectedAreaName: null,
    selectedProjectName: null,
    activeView: 'areas',
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openWorkArea() {
  render(<AreasView />)
  fireEvent.click(await screen.findByText('Work'))
  await screen.findByRole('button', { name: 'Rename area' })
}

describe('AreasView list', areaListTests)
describe('AreasView creating and archiving', areaCreateTests)
describe('AreaDetail tasks', detailTaskTests)
describe('AreaDetail renaming and projects', detailRenameTests)

function areaListTests() {
  describe('shows each area', listShowsEachAreaTests)
  describe('shows an error', listShowsAnErrorTests)
}

function listShowsEachAreaTests() {
  describe('shows each area', listShowsEachAreaShowsEachAreaTests)
  describe('lists archived areas', listShowsEachAreaListsArchivedAreasTests)
}

function listShowsEachAreaShowsEachAreaTests() {
  it('shows each area with its counts, progress and first three projects', async () => {
    render(<AreasView />)
    await screen.findByText('Work')
    const card = screen.getByText('Work').closest('.areas-view__card') as HTMLElement
    expect(card.textContent).toContain('1/ 4 tasks')
    expect(card.textContent).toContain('· 4 projects')
    expect((card.querySelector('.areas-view__card-progress-fill') as HTMLElement).style.width).toBe(
      '75%'
    )
    expect(card.querySelectorAll('.areas-view__card-project-chip')).toHaveLength(4)
    expect(card.textContent).toContain('+1')
    const home = screen.getByText('Home').closest('.areas-view__card') as HTMLElement
    expect((home.querySelector('.areas-view__card-progress-fill') as HTMLElement).style.width).toBe(
      '0%'
    )
  })
}

function listShowsEachAreaListsArchivedAreasTests() {
  it('lists archived areas with a delete button, and an empty state', async () => {
    render(<AreasView />)
    await screen.findByText('Work')
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    expect(await screen.findByText('Old')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete area permanently' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:delete-area')).toEqual([{ areaFilePath: 'Old' }])
    )
    bridge.responses['task-vault:vault:list-areas'] = { areas: [] }
    fireEvent.click(screen.getByRole('button', { name: 'Active' }))
    expect(await screen.findByText('No areas yet.')).toBeTruthy()
  })
}

function listShowsAnErrorTests() {
  it('shows an error, and reloads quietly when the index changes', async () => {
    render(<AreasView />)
    await screen.findByText('Work')
    bridge.responses['task-vault:vault:list-areas'] = { areas: [HOME] }
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    await eventually(() => expect(screen.queryByText('Work')).toBeNull())
    bridge.responses['task-vault:vault:list-areas'] = () => {
      throw new Error('gone')
    }
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    expect(await screen.findByText('Error: gone')).toBeTruthy()
  })

  it('opens the area named in the store', async () => {
    useVaultNavStore.setState({ selectedAreaName: 'Home' })
    render(<AreasView />)
    expect(await screen.findByText('No tasks in this area.')).toBeTruthy()
  })

  it('opens a card with Enter and goes back to the list', async () => {
    render(<AreasView />)
    fireEvent.keyDown(await screen.findByText('Work'), { key: 'Enter' })
    expect(await screen.findByText('Plan sprint')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Areas' }))
    expect(await screen.findByText('Home')).toBeTruthy()
  })
}

function areaCreateTests() {
  describe('creates an area', createCreatesAnAreaTests)
  describe('cancels creating with', createCancelsCreatingWithTests)
}

function createCreatesAnAreaTests() {
  it('creates an area, and says when the name is taken', async () => {
    render(<AreasView />)
    fireEvent.click(await screen.findByRole('button', { name: '+ New area' }))
    const input = screen.getByPlaceholderText('Area name (e.g. health, finances, work)')
    bridge.responses['task-vault:vault:create-area'] = { error: 'AREA_EXISTS' }
    fireEvent.change(input, { target: { value: 'Work' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('An area with that name already exists.')).toBeTruthy()
    bridge.responses['task-vault:vault:create-area'] = { error: 'other' }
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('other')).toBeTruthy()
    bridge.responses['task-vault:vault:create-area'] = { success: true }
    fireEvent.change(input, { target: { value: ' Garden ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await eventually(() => expect(screen.queryByPlaceholderText(/Area name/)).toBeNull())
    expect(bridge.calls('task-vault:vault:create-area').at(-1)).toEqual({ name: 'Garden' })
  })
}

function createCancelsCreatingWithTests() {
  it('cancels creating with the button or Escape', async () => {
    render(<AreasView />)
    fireEvent.click(await screen.findByRole('button', { name: '+ New area' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: '+ New area' }))
    fireEvent.keyDown(screen.getByPlaceholderText(/Area name/), { key: 'Escape' })
    expect(screen.queryByPlaceholderText(/Area name/)).toBeNull()
  })

  it('archives an area from its card after confirming, or not', async () => {
    render(<AreasView />)
    await screen.findByText('Work')
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive area' })[0])
    expect(bridge.calls('task-vault:vault:archive-area')).toEqual([])
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive area' })[0])
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:archive-area')).toEqual([{ areaName: 'Work' }])
    )
  })
}

function detailTaskTests() {
  describe('adds a task', detailTaskAddsATaskTests)
  describe('completes an open', detailTaskCompletesAnOpenTests)
}

function detailTaskAddsATaskTests() {
  it('adds a task tagged with the area, unless already tagged', async () => {
    await openWorkArea()
    const input = screen.getAllByRole('textbox')[0]
    fireEvent.change(input, { target: { value: 'call bob' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:add-task')[0]).toEqual({
        filePath: 'areas/Work.md',
        text: 'call bob #Work',
      })
    )
    const addField = () => screen.getAllByRole('textbox')[0] as HTMLInputElement
    await eventually(() => expect(addField().disabled).toBe(false))
    const again = addField()
    fireEvent.change(again, { target: { value: 'pay #work' } })
    fireEvent.keyDown(again, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:add-task')[1]).toMatchObject({ text: 'pay #work' })
    )
  })
}

function detailTaskCompletesAnOpenTests() {
  it('completes an open task and restores a finished one', async () => {
    await openWorkArea()
    fireEvent.click(screen.getByTitle('Complete'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:complete-task')).toEqual([{ taskId: 'w1' }])
    )
    fireEvent.click(screen.getByTitle('Restore'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:restore-task')).toEqual([{ taskId: 'w2' }])
    )
  })

  it('edits an open task from its tagged text, and cancels an edit', async () => {
    await openWorkArea()
    fireEvent.doubleClick(screen.getByText('Plan sprint'))
    const field = screen.getAllByRole('textbox')[1] as HTMLInputElement
    expect(field.value).toBe('Plan sprint @Launch +desk #Work due:2026-02-01')
    fireEvent.change(field, { target: { value: 'Plan sprint 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:edit-task')).toEqual([
        { taskId: 'w1', text: 'Plan sprint 2' },
      ])
    )
    await eventually(() => expect(screen.getAllByRole('textbox')).toHaveLength(1))
    fireEvent.doubleClick(screen.getByText('Old thing'))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })
}

function detailRenameTests() {
  describe('renames the area', detailRenameRenamesTheAreaTests)
  describe('closes the rename', detailRenameClosesTheRenameTests)
}

function detailRenameRenamesTheAreaTests() {
  it('renames the area, showing a failure, and cancels with Escape', async () => {
    await openWorkArea()
    fireEvent.click(screen.getByRole('button', { name: 'Rename area' }))
    const input = screen.getByDisplayValue('Work')
    bridge.responses['task-vault:vault:rename-area'] = { error: 'AREA_EXISTS' }
    fireEvent.change(input, { target: { value: 'Job' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('AREA_EXISTS')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByDisplayValue('Job')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rename area' }))
    bridge.responses['task-vault:vault:rename-area'] = { success: true }
    fireEvent.change(screen.getByDisplayValue('Work'), { target: { value: 'Job' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:rename-area').at(-1)).toEqual({
        areaFilePath: 'Work',
        newName: 'Job',
      })
    )
  })
}

function detailRenameClosesTheRenameTests() {
  it('closes the rename without a call when the name is unchanged, or cancelled', async () => {
    await openWorkArea()
    fireEvent.click(screen.getByRole('button', { name: 'Rename area' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename area' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel rename' }))
    expect(bridge.calls('task-vault:vault:rename-area')).toEqual([])
  })

  it('opens a project, and archives the area from its header', async () => {
    await openWorkArea()
    expect(screen.getByText('Projects (4)')).toBeTruthy()
    expect(screen.getByText('2 open · 50% done')).toBeTruthy()
    fireEvent.click(screen.getByText('@Beta'))
    expect(useVaultNavStore.getState().selectedProjectName).toBe('Beta')
    fireEvent.click(screen.getByTitle('Archive area'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:archive-area')).toEqual([{ areaName: 'Work' }])
    )
  })
}
