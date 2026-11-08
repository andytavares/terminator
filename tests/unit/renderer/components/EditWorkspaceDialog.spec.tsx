import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { EditWorkspaceDialog } from '../../../../src/renderer/components/sidebar/EditWorkspaceDialog'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { UpdateWorkspaceInputSchema } from '../../../../src/shared/schemas/workspace.schema'
import { workspaceFixture } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'
import { eventually } from '../../../support/eventually'

const mockOpenDirectory = vi.fn<ElectronAPI['dialog']['openDirectory']>()
/** The main process's answer to an update: the workspace as written. */
const mockUpdateWorkspace = vi.fn<ElectronAPI['workspace']['update']>(async (payload) => ({
  workspace: { ...ws, ...UpdateWorkspaceInputSchema.parse(payload) },
}))

const WS_ID = '00000000-0000-4000-8000-000000000001'
const ws = workspaceFixture({
  id: WS_ID,
  name: 'My Work',
  folderPath: '/home/work',
  tags: ['tag1'],
})

beforeEach(() => {
  vi.clearAllMocks()
  mockOpenDirectory.mockResolvedValue({ filePath: '/new/path' })
  installElectronApi({
    dialog: { openDirectory: mockOpenDirectory },
    workspace: { update: mockUpdateWorkspace },
  })
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), workspaces: [ws] })
})

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('EditWorkspaceDialog', () => {
  it("pre-fills the workspace's values", () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('My Work')).toBeTruthy()
    expect(screen.getByDisplayValue('/home/work')).toBeTruthy()
    expect(screen.getByDisplayValue('tag1')).toBeTruthy()
  })

  it('saves the new name to the workspace', async () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('My Work'), { target: { value: 'New Name' } })
    fireEvent.click(screen.getByText('Save'))
    await eventually(() =>
      expect(useWorkspaceStore.getState().workspaces).toEqual([
        expect.objectContaining({ id: WS_ID, name: 'New Name', folderPath: '/home/work' }),
      ])
    )
  })

  it('shows error when duplicate name on blur', () => {
    useWorkspaceStore.setState({
      workspaces: [ws, workspaceFixture({ id: 'ws-2', name: 'Other' })],
    })
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const nameInput = screen.getByDisplayValue('My Work')
    fireEvent.change(nameInput, { target: { value: 'Other' } })
    fireEvent.blur(nameInput)
    expect(screen.getByText('A workspace with this name already exists')).toBeTruthy()
  })
})

describe('EditWorkspaceDialog — closes after successful save', () => {
  it('closes after successful save', async () => {
    const onClose = vi.fn()
    render(<EditWorkspaceDialog workspace={ws} onClose={onClose} />)
    fireEvent.click(screen.getByText('Save'))
    await eventually(() => expect(onClose).toHaveBeenCalled())
    expect(recordUse).toHaveBeenCalledWith('core.sidebar.workspace-edit')
  })

  it('does not call updateWorkspace when submitted with an empty name', async () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('My Work'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('Name is required')
    expect(mockUpdateWorkspace).not.toHaveBeenCalled()
  })
})

describe('EditWorkspaceDialog — surfaces a generic error when updateWorkspace fails for another reason', () => {
  it('surfaces a generic error when updateWorkspace fails for another reason', async () => {
    mockUpdateWorkspace.mockResolvedValueOnce({ error: 'BACKEND_DOWN' })
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('My Work'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('Failed to update workspace')
  })
})
