import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  const user = userEvent.setup()
  render(<AreasView />)
  await user.click(await screen.findByText('Work'))
  await screen.findByRole('button', { name: 'Rename area' })
  return user
}

async function openCreateForm() {
  const user = userEvent.setup()
  render(<AreasView />)
  await user.click(await screen.findByRole('button', { name: '+ New area' }))
  return { user, input: screen.getByPlaceholderText('Area name (e.g. health, finances, work)') }
}

describe('AreasView usage', () => {
  it('counts one view of the areas as it opens', async () => {
    render(<AreasView />)
    await screen.findByText('Work')
    expect(bridge.recordUsage.mock.calls).toEqual([['view-areas']])
  })
})

describe('AreasView list', areaListTests)
describe('AreasView creating and archiving', areaCreateTests)
describe('AreaDetail tasks', detailTaskTests)
describe('AreaDetail renaming and projects', detailRenameTests)

function areaListTests() {
  describe('shows each area', listShowsEachAreaTests)
  describe('lists archived areas', listArchivedAreasTests)
  describe('reloads', listReloadTests)
  describe('opens an area', listOpensAnAreaTests)
}

function listShowsEachAreaTests() {
  it('shows each area with its counts, progress and first three projects', async () => {
    render(<AreasView />)
    await screen.findByText('Work')
    const card = screen.getByRole('button', { name: /^Work/ })
    expect(card.textContent).toContain('1/ 4 tasks')
    expect(card.textContent).toContain('· 4 projects')
    const progress = (area: HTMLElement) => within(area).getByRole('progressbar')
    expect(progress(card).getAttribute('aria-valuenow')).toBe('75')
    expect(within(card).getAllByText(/^@/)).toHaveLength(3)
    expect(card.textContent).toContain('+1')
    const home = screen.getByRole('button', { name: /^Home/ })
    expect(progress(home).getAttribute('aria-valuenow')).toBe('0')
  })

  it('says there are no areas when the list is empty', async () => {
    bridge.responses['task-vault:vault:list-areas'] = { areas: [] }
    render(<AreasView />)
    expect(await screen.findByText('No areas yet.')).toBeTruthy()
  })
}

function listArchivedAreasTests() {
  it('lists the archived areas when the Archived filter is chosen', async () => {
    const user = userEvent.setup()
    render(<AreasView />)
    await screen.findByText('Work')
    await user.click(screen.getByRole('button', { name: 'Archived' }))
    expect(await screen.findByText('Old')).toBeTruthy()
    expect(screen.queryByText('Work')).toBeNull()
  })

  it('deletes an archived area from its card', async () => {
    const user = userEvent.setup()
    render(<AreasView />)
    await user.click(await screen.findByRole('button', { name: 'Archived' }))
    await user.click(await screen.findByRole('button', { name: 'Delete area permanently' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:delete-area')).toEqual([{ areaFilePath: 'Old' }])
    )
  })
}

function listReloadTests() {
  it('reloads the list quietly when the index changes', async () => {
    render(<AreasView />)
    await screen.findByText('Work')
    bridge.responses['task-vault:vault:list-areas'] = { areas: [HOME] }
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    await eventually(() => expect(screen.queryByText('Work')).toBeNull())
    expect(screen.getByText('Home')).toBeTruthy()
  })

  it('shows the error a reload throws', async () => {
    render(<AreasView />)
    await screen.findByText('Work')
    bridge.responses['task-vault:vault:list-areas'] = () => {
      throw new Error('gone')
    }
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    expect(await screen.findByText('Error: gone')).toBeTruthy()
  })
}

function listOpensAnAreaTests() {
  it('opens the area named in the store', async () => {
    useVaultNavStore.setState({ selectedAreaName: 'Home' })
    render(<AreasView />)
    expect(await screen.findByText('No tasks in this area.')).toBeTruthy()
  })

  it('opens a focused card with Enter', async () => {
    const user = userEvent.setup()
    render(<AreasView />)
    const card = await screen.findByRole('button', { name: /^Work/ })
    act(() => card.focus())
    expect(card.matches(':focus')).toBe(true)
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Plan sprint')).toBeTruthy()
  })

  it('goes back to the list from an open area', async () => {
    const user = await openWorkArea()
    await user.click(screen.getByRole('button', { name: 'Areas' }))
    expect(await screen.findByText('Home')).toBeTruthy()
  })
}

function areaCreateTests() {
  describe('creates an area', createCreatesAnAreaTests)
  describe('closes the create form', createClosesTheFormTests)
  describe('archives an area', createArchivesAnAreaTests)
}

function createCreatesAnAreaTests() {
  it('creates an area from the trimmed name and closes the form', async () => {
    const { user, input } = await openCreateForm()
    await user.type(input, ' Garden ')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await eventually(() => expect(screen.queryByPlaceholderText(/Area name/)).toBeNull())
    expect(bridge.calls('task-vault:vault:create-area')).toEqual([{ name: 'Garden' }])
  })

  it('says when the area name is taken', async () => {
    bridge.responses['task-vault:vault:create-area'] = { error: 'AREA_EXISTS' }
    const { user, input } = await openCreateForm()
    await user.type(input, 'Work{Enter}')
    expect(await screen.findByText('An area with that name already exists.')).toBeTruthy()
  })

  it('shows any other create failure as its text', async () => {
    bridge.responses['task-vault:vault:create-area'] = { error: 'other' }
    const { user, input } = await openCreateForm()
    await user.type(input, 'Garden')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('other')).toBeTruthy()
  })
}

function createClosesTheFormTests() {
  it('closes the create form with Cancel', async () => {
    const { user } = await openCreateForm()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByPlaceholderText(/Area name/)).toBeNull()
  })

  it('closes the create form with Escape', async () => {
    const { user, input } = await openCreateForm()
    expect(input.matches(':focus')).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.queryByPlaceholderText(/Area name/)).toBeNull()
  })
}

function createArchivesAnAreaTests() {
  it('archives an area from its card after confirming', async () => {
    const user = userEvent.setup()
    render(<AreasView />)
    await screen.findByText('Work')
    await user.click(screen.getAllByRole('button', { name: 'Archive area' })[0])
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:archive-area')).toEqual([{ areaName: 'Work' }])
    )
  })

  it('keeps an area when the archive is not confirmed', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const user = userEvent.setup()
    render(<AreasView />)
    await screen.findByText('Work')
    await user.click(screen.getAllByRole('button', { name: 'Archive area' })[0])
    expect(window.confirm).toHaveBeenCalled()
    expect(bridge.calls('task-vault:vault:archive-area')).toEqual([])
  })
}

function detailTaskTests() {
  describe('adds a task', detailTaskAddsATaskTests)
  describe('completes and restores', detailTaskCompletesTests)
  describe('edits a task', detailTaskEditsTests)
}

function detailTaskAddsATaskTests() {
  it('adds a task tagged with the area', async () => {
    const user = await openWorkArea()
    await user.type(screen.getByPlaceholderText('Add task to this area…'), 'call bob')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:add-task')).toEqual([
        { filePath: 'areas/Work.md', text: 'call bob #Work' },
      ])
    )
  })

  it('adds a task as typed when it already carries the area tag', async () => {
    const user = await openWorkArea()
    await user.type(screen.getByPlaceholderText('Add task to this area…'), 'pay #work')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:add-task')).toEqual([
        { filePath: 'areas/Work.md', text: 'pay #work' },
      ])
    )
  })
}

function detailTaskCompletesTests() {
  it('completes an open task', async () => {
    const user = await openWorkArea()
    await user.click(screen.getByTitle('Mark done'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:complete-task')).toEqual([{ taskId: 'w1' }])
    )
  })

  it('takes a completed task off the area, which lists what the vault answers', async () => {
    const user = await openWorkArea()
    bridge.responses['task-vault:vault:list-areas'] = { areas: [{ ...WORK, tasks: [] }, HOME] }
    await user.click(screen.getByTitle('Mark done'))
    await eventually(() => expect(screen.queryByText('Plan sprint')).toBeNull())
  })

  it('restores a finished task', async () => {
    const user = await openWorkArea()
    await user.click(screen.getByTitle('Restore'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:restore-task')).toEqual([{ taskId: 'w2' }])
    )
  })
}

function detailTaskEditsTests() {
  it('edits an open task from its tagged text', async () => {
    const user = await openWorkArea()
    await user.dblClick(screen.getByText('Plan sprint'))
    const field = screen.getByDisplayValue('Plan sprint @Launch +desk #Work due:2026-02-01')
    await user.clear(field)
    await user.type(field, 'Plan sprint 2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:edit-task')).toEqual([
        { taskId: 'w1', text: 'Plan sprint 2' },
      ])
    )
    await eventually(() => expect(screen.getAllByRole('textbox')).toHaveLength(1))
  })

  it('opens no editor for a finished task', async () => {
    const user = await openWorkArea()
    await user.dblClick(screen.getByText('Old thing'))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })
}

function detailRenameTests() {
  describe('renames the area', detailRenameRenamesTheAreaTests)
  describe('closes the rename', detailRenameClosesTheRenameTests)
  describe('projects and archiving', detailProjectsTests)
}

function detailRenameRenamesTheAreaTests() {
  it('renames the area', async () => {
    const user = await openWorkArea()
    await user.click(screen.getByRole('button', { name: 'Rename area' }))
    const input = screen.getByDisplayValue('Work')
    await user.clear(input)
    await user.type(input, 'Job')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:rename-area')).toEqual([
        { areaFilePath: 'Work', newName: 'Job' },
      ])
    )
  })

  it('shows why a rename failed', async () => {
    bridge.responses['task-vault:vault:rename-area'] = { error: 'AREA_EXISTS' }
    const user = await openWorkArea()
    await user.click(screen.getByRole('button', { name: 'Rename area' }))
    await user.type(screen.getByDisplayValue('Work'), '2{Enter}')
    expect(await screen.findByText('AREA_EXISTS')).toBeTruthy()
  })
}

function detailRenameClosesTheRenameTests() {
  it('drops a typed name with Escape', async () => {
    const user = await openWorkArea()
    await user.click(screen.getByRole('button', { name: 'Rename area' }))
    await user.type(screen.getByDisplayValue('Work'), '2{Escape}')
    expect(screen.queryByDisplayValue('Work2')).toBeNull()
    expect(bridge.calls('task-vault:vault:rename-area')).toEqual([])
  })

  it.each(['Save', 'Cancel rename'])(
    'closes the rename without a call when %s is pressed on the unchanged name',
    async (button) => {
      const user = await openWorkArea()
      await user.click(screen.getByRole('button', { name: 'Rename area' }))
      await user.click(screen.getByRole('button', { name: button }))
      expect(screen.queryByDisplayValue('Work')).toBeNull()
      expect(bridge.calls('task-vault:vault:rename-area')).toEqual([])
    }
  )
}

function detailProjectsTests() {
  it('lists the area projects with their progress', async () => {
    await openWorkArea()
    expect(screen.getByText('Projects (4)')).toBeTruthy()
    expect(screen.getByText('2 open · 50% done')).toBeTruthy()
  })

  it('opens a project from the area', async () => {
    const user = await openWorkArea()
    await user.click(screen.getByText('@Beta'))
    expect(useVaultNavStore.getState().selectedProjectName).toBe('Beta')
  })

  it('archives the area from its header', async () => {
    const user = await openWorkArea()
    await user.click(screen.getByTitle('Archive area'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:archive-area')).toEqual([{ areaName: 'Work' }])
    )
  })
}
