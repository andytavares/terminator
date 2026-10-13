import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { EditWorkspaceDialog } from '../../../../src/renderer/components/sidebar/EditWorkspaceDialog'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { UpdateWorkspaceInputSchema } from '../../../../src/shared/schemas/workspace.schema'
import { workspaceOf } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'

const mockOpenDirectory = vi.fn<ElectronAPI['dialog']['openDirectory']>()
/** The main process's answer to an update: the workspace as written. */
const mockUpdateWorkspace = vi.fn<ElectronAPI['workspace']['update']>(async (payload) => ({
  workspace: { ...ws, ...UpdateWorkspaceInputSchema.parse(payload) },
}))

const WS_ID = '00000000-0000-4000-8000-000000000001'
const ws = workspaceOf({
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

describe('EditWorkspaceDialog', () => {
  it('renders with workspace name pre-filled', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('My Work')).toBeTruthy()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<EditWorkspaceDialog workspace={ws} onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows Name is required when name is cleared', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const nameInput = screen.getByDisplayValue('My Work')
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.blur(nameInput)
    expect(screen.getByText('Name is required')).toBeTruthy()
  })

  it('saves the new name to the workspace', async () => {
    const onClose = vi.fn()
    render(<EditWorkspaceDialog workspace={ws} onClose={onClose} />)
    fireEvent.change(screen.getByDisplayValue('My Work'), { target: { value: 'New Name' } })
    fireEvent.click(screen.getByText('Save'))
    await vi.waitFor(() =>
      expect(useWorkspaceStore.getState().workspaces).toEqual([
        expect.objectContaining({ id: WS_ID, name: 'New Name', folderPath: '/home/work' }),
      ])
    )
  })

  it('renders folder path field', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('/home/work')).toBeTruthy()
  })

  it('calls openDirectory when Browse is clicked and updates folder path', async () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Browse'))
    await vi.waitFor(() => expect(screen.getByDisplayValue('/new/path')).toBeTruthy())
    expect(mockOpenDirectory).toHaveBeenCalled()
  })

  it('does not update folder path when Browse is cancelled', async () => {
    mockOpenDirectory.mockResolvedValue({ cancelled: true })
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Browse'))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByDisplayValue('/home/work')).toBeTruthy()
  })

  it('updates folder path input when typed', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const folderInput = screen.getByDisplayValue('/home/work')
    fireEvent.change(folderInput, { target: { value: '/changed/path' } })
    expect(screen.getByDisplayValue('/changed/path')).toBeTruthy()
  })

  it('selects a color swatch on click', () => {
    const { container } = render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const swatches = container.querySelectorAll('.dialog__color-swatch')
    fireEvent.click(swatches[1])
    expect(swatches[1].classList.contains('dialog__color-swatch--selected')).toBe(true)
  })

  it('updates tags input when typed', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const tagsInput = screen.getByDisplayValue('tag1')
    fireEvent.change(tagsInput, { target: { value: 'tag1, tag2' } })
    expect(screen.getByDisplayValue('tag1, tag2')).toBeTruthy()
  })

  it('clears nameError when name input changes', () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const nameInput = screen.getByDisplayValue('My Work')
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.blur(nameInput)
    expect(screen.getByText('Name is required')).toBeTruthy()
    fireEvent.change(nameInput, { target: { value: 'Fixed' } })
    expect(screen.queryByText('Name is required')).toBeNull()
  })

  it('shows error when duplicate name on blur', () => {
    useWorkspaceStore.setState({ workspaces: [ws, workspaceOf({ id: 'ws-2', name: 'Other' })] })
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    const nameInput = screen.getByDisplayValue('My Work')
    fireEvent.change(nameInput, { target: { value: 'Other' } })
    fireEvent.blur(nameInput)
    expect(screen.getByText('A workspace with this name already exists')).toBeTruthy()
  })

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn()
    render(<EditWorkspaceDialog workspace={ws} onClose={onClose} />)
    fireEvent.click(screen.getByText('Edit Workspace').closest('.tmui-dialog__scrim')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes after successful save', async () => {
    const onClose = vi.fn()
    render(<EditWorkspaceDialog workspace={ws} onClose={onClose} />)
    fireEvent.click(screen.getByText('Save'))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('does not call updateWorkspace when submitted with an empty name', async () => {
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('My Work'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('Name is required')
    expect(mockUpdateWorkspace).not.toHaveBeenCalled()
  })

  it('surfaces a name error when updateWorkspace reports DUPLICATE_NAME', async () => {
    mockUpdateWorkspace.mockResolvedValueOnce({ error: 'DUPLICATE_NAME' })
    const onClose = vi.fn()
    render(<EditWorkspaceDialog workspace={ws} onClose={onClose} />)
    fireEvent.change(screen.getByDisplayValue('My Work'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('A workspace with this name already exists')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('surfaces a generic error when updateWorkspace fails for another reason', async () => {
    mockUpdateWorkspace.mockResolvedValueOnce({ error: 'BACKEND_DOWN' })
    render(<EditWorkspaceDialog workspace={ws} onClose={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('My Work'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('Failed to update workspace')
  })
})
