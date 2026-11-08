import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const projectCardNamed = (name: string) => screen.getByRole('group', { name })

async function renderBrowser() {
  const user = userEvent.setup()
  render(<ProjectsBrowser />)
  await screen.findByText('Launch', { selector: '.projects-browser__name' })
  return user
}

const cardButton = (card: string, name: string) =>
  within(projectCardNamed(card)).getByRole('button', { name })

describe('ProjectsBrowser usage', () => {
  it('counts one view of the projects as it opens', async () => {
    await renderBrowser()
    expect(bridge.recordUsage.mock.calls).toEqual([['view-projects']])
  })
})

describe('ProjectsBrowser list', () => {
  describe('cards', listCardTests)
  describe('status changes', listStatusTests)
  describe('filters', listFilterTests)
  describe('empty states', listEmptyTests)
})
describe('ProjectsBrowser creating', () => {
  describe('the form', createFormTests)
  describe('the area list', createAreaListTests)
  describe('cancelling', createCancelTests)
})
describe('ProjectsBrowser renaming', () => {
  describe('errors', renameErrorTests)
  describe('saving and cancelling', renameSaveTests)
})
describe('ProjectsBrowser deadlines', () => {
  describe('clearing and setting', deadlineSetTests)
  describe('cancelling', deadlineCancelTests)
})
describe('ProjectsBrowser areas', () => {
  describe('going and changing', areaChangeTests)
  describe('assigning and cancelling', areaAssignTests)
})
describe('ProjectsBrowser terminal links', linkTests)
describe('ProjectsBrowser tasks', () => {
  describe('listing', taskListTests)
  describe('completing', taskCompleteTests)
  describe('adding and editing', taskAddTests)
  describe('hiding', taskHideTests)
})

function listCardTests() {
  it('marks stale, someday and selected projects and counts next actions', async () => {
    await renderBrowser()
    expect(projectCardNamed('Launch').className).toContain('--selected')
    expect(projectCardNamed('Launch').textContent).toContain('2 next actions')
    expect(within(projectCardNamed('Garden')).getByText('no next action')).toBeTruthy()
    expect(within(projectCardNamed('Boat')).getByText('someday')).toBeTruthy()
  })

  it('promotes a someday project to active', async () => {
    const user = await renderBrowser()
    await user.click(cardButton('Boat', 'Promote to active'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:update-project-status')).toEqual([
        { projectFilePath: 'Boat', status: 'active' },
      ])
    )
  })
}

function listStatusTests() {
  it('archives a project', async () => {
    const user = await renderBrowser()
    await user.click(cardButton('Garden', 'Archive project'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:update-project-status')).toEqual([
        { projectFilePath: 'Garden', status: 'archived' },
      ])
    )
  })

  it('deletes an archived project after confirming', async () => {
    const user = await renderBrowser()
    await user.click(screen.getByRole('button', { name: 'Archived' }))
    await screen.findByText('archived')
    await user.click(cardButton('Old', 'Delete project'))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:delete')).toEqual([{ projectFilePath: 'Old' }])
    )
  })
}

function listFilterTests() {
  it('shows every status under All', async () => {
    const user = await renderBrowser()
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(await screen.findByText('Old', { selector: '.projects-browser__name' })).toBeTruthy()
  })
}

function listEmptyTests() {
  it('reloads under All on an index change and says when no projects are found', async () => {
    const user = await renderBrowser()
    await user.click(screen.getByRole('button', { name: 'All' }))
    await screen.findByText('Old', { selector: '.projects-browser__name' })
    bridge.responses['task-vault:projects:list'] = { projects: [] }
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    expect(await screen.findByText('No projects found.')).toBeTruthy()
  })

  it('says when the Active filter, the default, has no projects', async () => {
    bridge.responses['task-vault:projects:list'] = { projects: [] }
    render(<ProjectsBrowser />)
    expect(await screen.findByText('No active projects.')).toBeTruthy()
  })
}

async function openCreateForm() {
  const user = await renderBrowser()
  await user.click(screen.getByRole('button', { name: '+ New project' }))
  return user
}

function createFormTests() {
  it('creates a project in a new area through the combobox keys', async () => {
    const user = await openCreateForm()
    await user.type(screen.getByPlaceholderText('Project name'), ' Move ')
    await user.type(screen.getByPlaceholderText('What does done look like?'), 'Boxes gone')
    await user.type(screen.getByPlaceholderText('e.g. work'), 'Home')
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:create')).toEqual([
        { name: 'Move', area: 'Home', deadline: undefined, outcome: 'Boxes gone' },
      ])
    )
    expect(bridge.calls('task-vault:vault:create-area')).toEqual([{ name: 'Home' }])
    await eventually(() => expect(screen.queryByPlaceholderText('Project name')).toBeNull())
  })

  it('reports a project name that is taken', async () => {
    bridge.responses['task-vault:projects:create'] = { error: 'PROJECT_EXISTS' }
    const user = await openCreateForm()
    await user.type(screen.getByPlaceholderText('Project name'), 'Launch{Enter}')
    expect(await screen.findByText('A project with that name already exists.')).toBeTruthy()
  })
}

function createAreaListTests() {
  it('picks an existing area with the mouse and creates no new area', async () => {
    const user = await openCreateForm()
    const area = screen.getByPlaceholderText('e.g. work') as HTMLInputElement
    await user.click(area)
    await user.hover(await screen.findByText('Work', { selector: 'li' }))
    await user.click(screen.getByText('Work', { selector: 'li' }))
    expect(area.value).toBe('Work')
    await user.type(screen.getByPlaceholderText('Project name'), 'Move{Enter}')
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:create')).toEqual([
        expect.objectContaining({ name: 'Move', area: 'Work' }),
      ])
    )
    expect(bridge.calls('task-vault:vault:create-area')).toEqual([])
  })

  it('closes the area list with Escape and opens it again with Enter', async () => {
    const user = await openCreateForm()
    await user.type(screen.getByPlaceholderText('e.g. work'), 'W{Escape}')
    expect(screen.queryByRole('listbox', { name: 'Areas' })).toBeNull()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('listbox', { name: 'Areas' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox', { name: 'Areas' })).toBeNull()
  })
}

function createCancelTests() {
  it('closes the form with Cancel', async () => {
    const user = await openCreateForm()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByPlaceholderText('Project name')).toBeNull()
  })
}

async function startRename(name: string, newName: string) {
  const user = await renderBrowser()
  await user.click(cardButton(name, 'Rename project'))
  const input = screen.getByDisplayValue(name)
  await user.clear(input)
  await user.type(input, newName)
  return user
}

function renameErrorTests() {
  it('reports a project name that is taken', async () => {
    bridge.responses['task-vault:projects:rename'] = { error: 'PROJECT_EXISTS' }
    const user = await startRename('Launch', 'Garden')
    await user.keyboard('{Enter}')
    expect(await screen.findByText('A project with that name already exists.')).toBeTruthy()
  })

  it('shows a thrown rename failure', async () => {
    bridge.responses['task-vault:projects:rename'] = () => {
      throw new Error('boom')
    }
    const user = await startRename('Launch', 'Garden')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Error: boom')).toBeTruthy()
  })
}

function renameSaveTests() {
  it('saves a new name and closes the editor', async () => {
    const user = await startRename('Garden', 'Yard')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:rename')).toEqual([
        { projectFilePath: 'Garden', newName: 'Yard' },
      ])
    )
    await eventually(() => expect(screen.queryByDisplayValue('Yard')).toBeNull())
  })

  it('cancels a rename with Escape or the cancel button without saving', async () => {
    const user = await startRename('Launch', 'Garden')
    await user.keyboard('{Escape}')
    expect(screen.queryByDisplayValue('Garden')).toBeNull()
    await user.click(cardButton('Launch', 'Rename project'))
    await user.click(screen.getByRole('button', { name: 'Cancel rename' }))
    expect(screen.queryByRole('button', { name: 'Cancel rename' })).toBeNull()
    expect(bridge.calls('task-vault:projects:rename')).toEqual([])
  })
}

function deadlineSetTests() {
  it('clears a deadline', async () => {
    const user = await renderBrowser()
    await user.click(screen.getByText('due: 2026-03-01'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:update-deadline')).toEqual([
        { projectFilePath: 'Launch', deadline: null },
      ])
    )
  })

  it('saves a deadline for a project without one', async () => {
    const user = await renderBrowser()
    await user.click(within(projectCardNamed('Garden')).getByTitle('Set deadline'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:update-deadline')).toEqual([
        expect.objectContaining({ projectFilePath: 'Garden' }),
      ])
    )
  })
}

function deadlineCancelTests() {
  it('cancels a deadline edit without saving', async () => {
    const user = await renderBrowser()
    await user.click(within(projectCardNamed('Garden')).getByTitle('Set deadline'))
    await user.click(screen.getByRole('button', { name: 'Cancel deadline edit' }))
    expect(screen.queryByRole('button', { name: 'Cancel deadline edit' })).toBeNull()
    expect(bridge.calls('task-vault:projects:update-deadline')).toEqual([])
  })
}

function areaChangeTests() {
  it('goes to the area of a project', async () => {
    const user = await renderBrowser()
    await user.click(screen.getByTitle('Go to Work area'))
    expect(useVaultNavStore.getState().selectedAreaName).toBe('Work')
  })

  it('changes the area of a project, creating the new area', async () => {
    const user = await renderBrowser()
    await user.click(cardButton('Launch', 'Change area'))
    const field = await screen.findByDisplayValue('Work')
    await user.clear(field)
    await user.type(field, 'Ops')
    await user.click(await screen.findByRole('button', { name: 'Save area' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:update-area')).toEqual([
        { projectFilePath: 'Launch', area: 'Ops' },
      ])
    )
    expect(bridge.calls('task-vault:vault:create-area')).toEqual([{ name: 'Ops' }])
  })
}

function areaAssignTests() {
  it('saves no area for a project when none is typed', async () => {
    const user = await renderBrowser()
    await user.click(within(projectCardNamed('Garden')).getByTitle('Assign to area'))
    await user.click(screen.getByRole('button', { name: 'Save area' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:update-area')).toEqual([
        { projectFilePath: 'Garden', area: null },
      ])
    )
  })

  it('cancels an area change', async () => {
    const user = await renderBrowser()
    await user.click(within(projectCardNamed('Garden')).getByTitle('Assign to area'))
    await user.click(cardButton('Garden', 'Cancel'))
    expect(within(projectCardNamed('Garden')).getByTitle('Assign to area')).toBeTruthy()
  })
}

function linkTests() {
  it('links a project to a terminal session named by workspace and project', async () => {
    const user = await renderBrowser()
    await user.click(within(projectCardNamed('Launch')).getByTitle('Link to terminal session'))
    const select = await screen.findByRole('combobox', { name: 'Terminal session' })
    await user.selectOptions(select, 'Home › terminator › zsh')
    await eventually(() =>
      expect(bridge.calls('task-vault:links:create')).toEqual([
        { projectFilePath: 'Launch', targetId: 'sess-12345678' },
      ])
    )
    expect(await within(projectCardNamed('Launch')).findByTitle('Linked')).toBeTruthy()
  })

  it('says when there is no session to link', async () => {
    listSessions.mockResolvedValue([])
    const user = await renderBrowser()
    await user.click(within(projectCardNamed('Garden')).getByTitle('Link to terminal session'))
    expect(await screen.findByText('No active sessions')).toBeTruthy()
  })

  it('closes the session picker', async () => {
    listSessions.mockResolvedValue([])
    const user = await renderBrowser()
    await user.click(within(projectCardNamed('Garden')).getByTitle('Link to terminal session'))
    await user.click(
      await within(projectCardNamed('Garden')).findByRole('button', { name: 'Close' })
    )
    expect(within(projectCardNamed('Garden')).getByTitle('Link to terminal session')).toBeTruthy()
  })
}

async function openTasks(name = 'Launch') {
  const user = await renderBrowser()
  await user.click(cardButton(name, `Show tasks tagged @${name}`))
  await within(projectCardNamed(name)).findByText(/tagged @/, { selector: 'span' })
  return user
}

function taskListTests() {
  it('lists the tasks tagged with the project and the file each comes from', async () => {
    await openTasks()
    expect(within(projectCardNamed('Launch')).getByText('2 tasks tagged @Launch')).toBeTruthy()
    expect(
      within(projectCardNamed('Launch')).getByText('Launch', {
        selector: '.projects-browser__task-file',
      })
    ).toBeTruthy()
  })
}

function taskCompleteTests() {
  it('completes an open task', async () => {
    const user = await openTasks()
    await user.click(within(projectCardNamed('Launch')).getByTitle('Complete'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:complete-task')).toEqual([{ taskId: 't1' }])
    )
  })

  it("reopens a finished task on today's log", async () => {
    const user = await openTasks()
    await user.click(within(projectCardNamed('Launch')).getByTitle("Reopen on today's log"))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:restore-task')).toEqual([{ taskId: 't2' }])
    )
  })
}

function taskAddTests() {
  it('adds a task tagged with the project', async () => {
    const user = await openTasks()
    const card = within(projectCardNamed('Launch'))
    await user.type(card.getByPlaceholderText('Add task to @Launch…'), 'email team')
    await user.click(card.getByRole('button', { name: 'Add' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:add-task')).toEqual([
        { filePath: 'projects/Launch.md', text: 'email team @Launch' },
      ])
    )
  })

  it('edits a task from its raw tagged text on double-click', async () => {
    const user = await openTasks()
    const card = within(projectCardNamed('Launch'))
    await user.dblClick(card.getByText('Write brief'))
    const edit = card.getByDisplayValue('Write brief #Work')
    await user.clear(edit)
    await user.type(edit, 'Write the brief')
    await user.click(card.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:edit-task')).toEqual([
        { taskId: 't1', text: 'Write the brief' },
      ])
    )
  })
}

function taskHideTests() {
  it('says when no task is tagged with the project', async () => {
    bridge.responses['task-vault:projects:get-tasks'] = { tasks: [] }
    await openTasks('Garden')
    expect(within(projectCardNamed('Garden')).getByText('No tasks tagged @Garden.')).toBeTruthy()
  })

  it('hides the task list and shows the task count on its toggle', async () => {
    bridge.responses['task-vault:projects:get-tasks'] = { tasks: [] }
    const user = await openTasks('Garden')
    await user.click(cardButton('Garden', 'Hide tasks'))
    expect(cardButton('Garden', '0 tasks tagged @Garden')).toBeTruthy()
  })
}
