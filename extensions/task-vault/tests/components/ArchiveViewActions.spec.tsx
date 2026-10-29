import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { installVaultBridge, eventually, indexedProject, task } from './helpers/bridge'
import { ArchiveView } from '../../src/components/ArchiveView'

let bridge: ReturnType<typeof installVaultBridge>

const ARCHIVE = {
  tasks: [
    task('d1', 'filed taxes', { status: 'done', project: 'Home', area: 'Life' }),
    task('c1', 'old idea', { status: 'cancelled' }),
    task('m1', 'moved on', { status: 'migrated' }),
  ],
  projects: [indexedProject('Old launch', { status: 'archived', area: 'Work' })],
  areas: [{ id: 'a1', name: 'Hobbies', updatedAt: '2026-01-01T00:00:00Z' }],
}

beforeEach(() => {
  bridge = installVaultBridge()
  bridge.responses['task-vault:vault:list-archive'] = ARCHIVE
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openArchiveTab(name: RegExp) {
  render(<ArchiveView />)
  fireEvent.click(await screen.findByRole('tab', { name }))
}

describe('ArchiveView usage', () => {
  it('counts one view of the archive as it opens', async () => {
    await openArchiveTab(/projects/i)
    expect(bridge.recordUsage.mock.calls).toEqual([['view-archive']])
  })
})

describe('ArchiveView tasks', archiveTasksTests)
describe('ArchiveView projects and areas', archiveProjectsAndAreasTests)
describe('ArchiveView loading', archiveLoadingTests)

function archiveTasksTests() {
  describe('grouping', archiveTasksGroupingTests)
  describe('restoring and deleting', archiveTasksRestoringAndDeletingTests)
}

function archiveTasksGroupingTests() {
  it('groups tasks by how they ended, with their tags and file', async () => {
    render(<ArchiveView />)
    expect(await screen.findByText('Completed (1)')).toBeTruthy()
    expect(screen.getByText('Cancelled (1)')).toBeTruthy()
    expect(screen.getByText('Migrated (1)')).toBeTruthy()
    expect(screen.getByText('@Home')).toBeTruthy()
    expect(screen.getByText('#Life')).toBeTruthy()
    expect(screen.getAllByText('2026-01-05').length).toBe(3)
  })
}

function archiveTasksRestoringAndDeletingTests() {
  it('restores a task', async () => {
    render(<ArchiveView />)
    await screen.findByText('Completed (1)')
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore to open' })[0])
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:restore-task')).toEqual([{ taskId: 'd1' }])
    )
  })

  it('deletes a task after confirming', async () => {
    render(<ArchiveView />)
    await screen.findByText('Completed (1)')
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete permanently' })[1])
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:delete-task')).toEqual([{ taskId: 'c1' }])
    )
    expect(window.confirm).toHaveBeenCalledWith('Delete task: "old idea"?')
  })

  it('keeps a task when the delete is not confirmed', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    render(<ArchiveView />)
    await screen.findByText('Completed (1)')
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete permanently' })[0])
    expect(bridge.calls('task-vault:vault:delete-task')).toEqual([])
  })
}

function archiveProjectsAndAreasTests() {
  describe('projects', archiveProjectsAndAreasProjectsTests)
  describe('areas', archiveProjectsAndAreasAreasTests)
}

function archiveProjectsAndAreasProjectsTests() {
  it('restores and deletes an archived project', async () => {
    await openArchiveTab(/Archived projects/)
    expect(screen.getByText('#Work')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore to active' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:update-project-status')).toEqual([
        { projectFilePath: 'Old launch', status: 'active' },
      ])
    )
    fireEvent.click(await screen.findByRole('tab', { name: /Archived projects/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:projects:delete')).toEqual([
        { projectFilePath: 'Old launch' },
      ])
    )
  })
}

function archiveProjectsAndAreasAreasTests() {
  it('restores and deletes an archived area', async () => {
    await openArchiveTab(/Archived areas/)
    fireEvent.click(screen.getByRole('button', { name: 'Restore to active' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:restore-area')).toEqual([{ areaName: 'Hobbies' }])
    )
    fireEvent.click(await screen.findByRole('tab', { name: /Archived areas/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:delete-area')).toEqual([{ areaFilePath: 'Hobbies' }])
    )
  })

  it('says when there is nothing archived', async () => {
    bridge.responses['task-vault:vault:list-archive'] = {}
    render(<ArchiveView />)
    expect(await screen.findByText('No completed tasks in the last 30 days.')).toBeTruthy()
    fireEvent.click(await screen.findByRole('tab', { name: /Archived projects/ }))
    expect(screen.getByText('No archived projects.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Archived areas/ }))
    expect(screen.getByText('No archived areas.')).toBeTruthy()
  })
}

function archiveLoadingTests() {
  it('shows the error the archive answered with', async () => {
    bridge.responses['task-vault:vault:list-archive'] = { error: 'db locked' }
    render(<ArchiveView />)
    expect(await screen.findByText('db locked')).toBeTruthy()
  })

  it('shows a thrown failure as text', async () => {
    bridge.responses['task-vault:vault:list-archive'] = () => {
      throw new Error('gone')
    }
    render(<ArchiveView />)
    expect(await screen.findByText('Error: gone')).toBeTruthy()
  })

  it('reloads when the index changes', async () => {
    render(<ArchiveView />)
    await screen.findByText('Completed (1)')
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    await eventually(() => expect(bridge.calls('task-vault:vault:list-archive').length).toBe(2))
    expect(bridge.calls('task-vault:vault:list-archive')[1]).toEqual({ days: 30 })
  })
}
