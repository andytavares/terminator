import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { installVaultBridge, eventually, indexedProject, task } from './helpers/bridge'
import { invalidateSmartInputCache } from '../../src/components/SmartTaskInput'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'
import { ProjectsBrowser } from '../../src/components/ProjectsBrowser'

let bridge: ReturnType<typeof installVaultBridge>
const listSessions = vi.fn()

const LAUNCH = indexedProject('Launch', {
  area: 'Work',
  deadline: '2026-03-01',
  nextActionCount: 2,
})
const GARDEN = indexedProject('Garden', { isStale: true, nextActionCount: 0 })
const BOAT = indexedProject('Boat', { status: 'someday', isStale: true, nextActionCount: 1 })
const OLD = indexedProject('Old', { status: 'archived' })

beforeEach(() => {
  invalidateSmartInputCache()
  listSessions.mockResolvedValue([
    { sessionId: 'sess-12345678', projectId: 'pr1', tabTitle: 'zsh' },
  ])
  bridge = installVaultBridge({
    extension: { getSettingsValues: vi.fn().mockResolvedValue({ values: {} }) },
    terminal: { listSessions },
    workspace: { list: vi.fn().mockResolvedValue({ workspaces: [{ id: 'w1', name: 'Home' }] }) },
    project: { list: vi.fn().mockResolvedValue({ projects: [{ id: 'pr1', name: 'terminator' }] }) },
  })
  bridge.responses['task-vault:projects:list'] = (payload: unknown) => {
    const status = (payload as { status: string[] }).status
    if (status.length === 3) return { projects: [LAUNCH, GARDEN, BOAT, OLD] }
    if (status[0] === 'archived') return { projects: [OLD] }
    return { projects: [LAUNCH, GARDEN, BOAT] }
  }
  bridge.responses['task-vault:vault:list-areas'] = { areas: [{ name: 'Work', filePath: 'Work' }] }
  bridge.responses['task-vault:projects:get-tasks'] = {
    tasks: [
      task('t1', 'Write brief', { area: 'Work', filePath: 'projects/Launch.md' }),
      task('t2', 'Kickoff', { status: 'done' }),
    ],
  }
  useVaultNavStore.setState({ selectedProjectName: 'Launch', selectedAreaName: null })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const projectCardNamed = (name: string) =>
  screen
    .getByText(name, { selector: '.projects-browser__name' })
    .closest('.projects-browser__card') as HTMLElement

async function renderBrowser() {
  render(<ProjectsBrowser />)
  await screen.findByText('Launch', { selector: '.projects-browser__name' })
}

describe('ProjectsBrowser list', projectListTests)
describe('ProjectsBrowser creating', projectCreateTests)
describe('ProjectsBrowser renaming and deadlines', renameTests)
describe('ProjectsBrowser areas and links', areaTests)
describe('ProjectsBrowser tasks', taskTests)

function projectListTests() {
  describe('marks stale someday', listMarksStaleSomedayTests)
  describe('archives a project', listArchivesAProjectTests)
}

function listMarksStaleSomedayTests() {
  it('marks stale, someday and selected projects and counts next actions', async () => {
    await renderBrowser()
    expect(projectCardNamed('Launch').className).toContain('--selected')
    expect(projectCardNamed('Launch').textContent).toContain('2 next actions')
    expect(within(projectCardNamed('Garden')).getByText('no next action')).toBeTruthy()
    expect(within(projectCardNamed('Boat')).getByText('someday')).toBeTruthy()
    fireEvent.click(
      within(projectCardNamed('Boat')).getByRole('button', { name: 'Promote to active' })
    )
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:update-project-status')).toEqual([
        { projectFilePath: 'Boat', status: 'active' },
      ])
    )
  })
}

function listArchivesAProjectTests() {
  it('archives a project, and deletes an archived one after confirming', async () => {
    await renderBrowser()
    fireEvent.click(
      within(projectCardNamed('Garden')).getByRole('button', { name: 'Archive project' })
    )
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:update-project-status')).toHaveLength(1)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    await screen.findByText('archived')
    fireEvent.click(within(projectCardNamed('Old')).getByRole('button', { name: 'Delete project' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:delete')).toEqual([{ projectFilePath: 'Old' }])
    )
  })

  it('shows every status under All, empty states, and reloads on index changes', async () => {
    await renderBrowser()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await screen.findByText('Old', { selector: '.projects-browser__name' })
    bridge.responses['task-vault:projects:list'] = { projects: [] }
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    expect(await screen.findByText('No projects found.')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Active' }))
    expect(await screen.findByText('No active projects.')).toBeTruthy()
  })
}

function projectCreateTests() {
  describe('creates a project', createCreatesAProjectTests)
  describe('picks an existing', createPicksAnExistingTests)
}

function createCreatesAProjectTests() {
  it('creates a project in a new area through the combobox', async () => {
    await renderBrowser()
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }))
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: ' Move ' } })
    fireEvent.change(screen.getByPlaceholderText('What does done look like?'), {
      target: { value: 'Boxes gone' },
    })
    const area = screen.getByPlaceholderText('e.g. work')
    fireEvent.change(area, { target: { value: 'Home' } })
    fireEvent.keyDown(area, { key: 'ArrowDown' })
    fireEvent.keyDown(area, { key: 'ArrowUp' })
    fireEvent.keyDown(area, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:create')).toEqual([
        { name: 'Move', area: 'Home', deadline: undefined, outcome: 'Boxes gone' },
      ])
    )
    expect(bridge.calls('task-vault:vault:create-area')).toEqual([{ name: 'Home' }])
    await eventually(() => expect(screen.queryByPlaceholderText('Project name')).toBeNull())
  })
}

function createPicksAnExistingTests() {
  describe('picks an existing', createPicksAnExistingPicksAnExistingTests)
  describe('closes the area', createPicksAnExistingClosesTheAreaTests)
}

function createPicksAnExistingPicksAnExistingTests() {
  it('picks an existing area with the mouse, and reports a taken name', async () => {
    bridge.responses['task-vault:projects:create'] = { error: 'PROJECT_EXISTS' }
    await renderBrowser()
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }))
    const area = screen.getByPlaceholderText('e.g. work')
    fireEvent.focus(area)
    fireEvent.mouseEnter(await screen.findByText('Work', { selector: 'li' }))
    fireEvent.mouseDown(await screen.findByText('Work', { selector: 'li' }))
    expect((area as HTMLInputElement).value).toBe('Work')
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'Launch' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Project name'), { key: 'Enter' })
    expect(await screen.findByText('A project with that name already exists.')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:create-area')).toEqual([])
  })
}

function createPicksAnExistingClosesTheAreaTests() {
  it('closes the area list with Escape, and the form with Cancel', async () => {
    await renderBrowser()
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }))
    const area = screen.getByPlaceholderText('e.g. work')
    fireEvent.change(area, { target: { value: 'W' } })
    fireEvent.keyDown(area, { key: 'Escape' })
    expect(document.querySelector('.area-combobox__dropdown')).toBeNull()
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(document.querySelector('.area-combobox__dropdown')).not.toBeNull()
    fireEvent.keyDown(area, { key: 'Escape' })
    expect(document.querySelector('.area-combobox__dropdown')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByPlaceholderText('Project name')).toBeNull()
  })
}

function renameTests() {
  describe('renames a project', renameRenamesAProjectTests)
  describe('saves a new', renameSavesANewTests)
}

function renameRenamesAProjectTests() {
  it('renames a project, reporting a taken name, and cancels', async () => {
    await renderBrowser()
    fireEvent.click(
      within(projectCardNamed('Launch')).getByRole('button', { name: 'Rename project' })
    )
    const input = screen.getByDisplayValue('Launch')
    bridge.responses['task-vault:projects:rename'] = { error: 'PROJECT_EXISTS' }
    fireEvent.change(input, { target: { value: 'Garden' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('A project with that name already exists.')).toBeTruthy()
    bridge.responses['task-vault:projects:rename'] = () => {
      throw new Error('boom')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Error: boom')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByDisplayValue('Garden')).toBeNull()
  })
}

function renameSavesANewTests() {
  describe('saves a new', renameSavesANewSavesANewTests)
  describe('edits clears and', renameSavesANewEditsClearsAndTests)
}

function renameSavesANewSavesANewTests() {
  it('saves a new name and closes the editor', async () => {
    await renderBrowser()
    fireEvent.click(
      within(projectCardNamed('Garden')).getByRole('button', { name: 'Rename project' })
    )
    fireEvent.change(screen.getByDisplayValue('Garden'), { target: { value: 'Yard' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:rename')).toEqual([
        { projectFilePath: 'Garden', newName: 'Yard' },
      ])
    )
    fireEvent.click(
      within(projectCardNamed('Launch')).getByRole('button', { name: 'Rename project' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel rename' }))
    expect(screen.queryByRole('button', { name: 'Cancel rename' })).toBeNull()
  })
}

function renameSavesANewEditsClearsAndTests() {
  it('edits, clears and sets deadlines', async () => {
    await renderBrowser()
    fireEvent.click(screen.getByText('due: 2026-03-01'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:update-deadline')).toEqual([
        { projectFilePath: 'Launch', deadline: null },
      ])
    )
    fireEvent.click(within(projectCardNamed('Garden')).getByTitle('Set deadline'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:update-deadline')).toHaveLength(2)
    )
    await eventually(() => within(projectCardNamed('Garden')).getByTitle('Set deadline'))
    fireEvent.click(within(projectCardNamed('Garden')).getByTitle('Set deadline'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deadline edit' }))
    expect(screen.queryByRole('button', { name: 'Cancel deadline edit' })).toBeNull()
  })
}

function areaTests() {
  describe('goes to a', areaGoesToATests)
  describe('links a project', areaLinksAProjectTests)
}

function areaGoesToATests() {
  describe('goes to a', areaGoesToAGoesToATests)
  describe('cancels an area', areaGoesToACancelsAnAreaTests)
}

function areaGoesToAGoesToATests() {
  it('goes to a project area, changes it, and assigns one', async () => {
    await renderBrowser()
    fireEvent.click(screen.getByTitle('Go to Work area'))
    expect(useVaultNavStore.getState().selectedAreaName).toBe('Work')
    fireEvent.click(within(projectCardNamed('Launch')).getByRole('button', { name: 'Change area' }))
    fireEvent.change(await screen.findByDisplayValue('Work'), { target: { value: 'Ops' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Save area' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:update-area')).toEqual([
        { projectFilePath: 'Launch', area: 'Ops' },
      ])
    )
    expect(bridge.calls('task-vault:vault:create-area')).toEqual([{ name: 'Ops' }])
    fireEvent.click(within(projectCardNamed('Garden')).getByTitle('Assign to area'))
    fireEvent.click(screen.getByRole('button', { name: 'Save area' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:update-area')[1]).toEqual({
        projectFilePath: 'Garden',
        area: null,
      })
    )
  })
}

function areaGoesToACancelsAnAreaTests() {
  it('cancels an area change', async () => {
    await renderBrowser()
    fireEvent.click(within(projectCardNamed('Garden')).getByTitle('Assign to area'))
    fireEvent.click(within(projectCardNamed('Garden')).getByRole('button', { name: 'Cancel' }))
    expect(within(projectCardNamed('Garden')).getByTitle('Assign to area')).toBeTruthy()
  })
}

function areaLinksAProjectTests() {
  it('links a project to a terminal session named by workspace and project', async () => {
    await renderBrowser()
    fireEvent.click(within(projectCardNamed('Launch')).getByTitle('Link to terminal session'))
    const option = await screen.findByRole('option', { name: 'Home › terminator › zsh' })
    fireEvent.change(option.closest('select')!, { target: { value: 'sess-12345678' } })
    await eventually(() =>
      expect(bridge.calls('task-vault:links:create')).toEqual([
        { projectFilePath: 'Launch', targetId: 'sess-12345678' },
      ])
    )
    expect(await within(projectCardNamed('Launch')).findByTitle('Linked')).toBeTruthy()
  })

  it('says when there is no session to link, and closes the picker', async () => {
    listSessions.mockResolvedValue([])
    await renderBrowser()
    fireEvent.click(within(projectCardNamed('Garden')).getByTitle('Link to terminal session'))
    expect(await screen.findByText('No active sessions')).toBeTruthy()
    fireEvent.click(within(projectCardNamed('Garden')).getByRole('button', { name: 'Close' }))
    expect(within(projectCardNamed('Garden')).getByTitle('Link to terminal session')).toBeTruthy()
  })
}

async function openTasks(name = 'Launch') {
  await renderBrowser()
  fireEvent.click(
    within(projectCardNamed(name)).getByRole('button', { name: `Show tasks tagged @${name}` })
  )
  await within(projectCardNamed(name)).findByText(/tagged @/, { selector: 'span' })
}

function taskTests() {
  describe('lists open and', taskListsOpenAndTests)
  describe('adds a task', taskAddsATaskTests)
}

function taskListsOpenAndTests() {
  it('lists open and finished tasks, completes and reopens them', async () => {
    await openTasks()
    expect(within(projectCardNamed('Launch')).getByText('2 tasks tagged @Launch')).toBeTruthy()
    expect(
      within(projectCardNamed('Launch')).getByText('Launch', {
        selector: '.projects-browser__task-file',
      })
    ).toBeTruthy()
    fireEvent.click(within(projectCardNamed('Launch')).getByTitle('Complete'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:complete-task')).toEqual([{ taskId: 't1' }])
    )
    fireEvent.click(within(projectCardNamed('Launch')).getByTitle("Reopen on today's log"))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:restore-task')).toEqual([{ taskId: 't2' }])
    )
  })
}

function taskAddsATaskTests() {
  describe('adds a task', taskAddsATaskAddsATaskTests)
  describe('hides the list', taskAddsATaskHidesTheListTests)
}

function taskAddsATaskAddsATaskTests() {
  it('adds a task tagged with the project, and edits one', async () => {
    await openTasks()
    const field = within(projectCardNamed('Launch')).getByPlaceholderText('Add task to @Launch…')
    fireEvent.change(field, { target: { value: 'email team' } })
    fireEvent.click(within(projectCardNamed('Launch')).getByRole('button', { name: 'Add' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:add-task')).toEqual([
        { filePath: 'projects/Launch.md', text: 'email team @Launch' },
      ])
    )
    fireEvent.doubleClick(within(projectCardNamed('Launch')).getByText('Write brief'))
    const edit = within(projectCardNamed('Launch')).getByDisplayValue('Write brief #Work')
    fireEvent.change(edit, { target: { value: 'Write the brief' } })
    fireEvent.click(within(projectCardNamed('Launch')).getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:edit-task')).toEqual([
        { taskId: 't1', text: 'Write the brief' },
      ])
    )
  })
}

function taskAddsATaskHidesTheListTests() {
  it('hides the list, shows the count after, and an empty project', async () => {
    bridge.responses['task-vault:projects:get-tasks'] = { tasks: [] }
    await openTasks('Garden')
    expect(within(projectCardNamed('Garden')).getByText('No tasks tagged @Garden.')).toBeTruthy()
    fireEvent.click(within(projectCardNamed('Garden')).getByRole('button', { name: 'Hide tasks' }))
    expect(
      within(projectCardNamed('Garden')).getByRole('button', { name: '0 tasks tagged @Garden' })
    ).toBeTruthy()
  })
}
