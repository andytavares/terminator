import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { NewTabDialog } from '../../../../src/renderer/components/terminal/NewTabDialog'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: vi.fn(),
}))

const mockCreateSession = vi.fn()

vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: () => ({ createSession: mockCreateSession }),
}))

const defaultWsStore = {
  workspaces: [{ id: 'ws-1', name: 'Main', folderPath: '/home' }],
  activeWorkspaceId: 'ws-1',
  projectsByWorkspaceId: new Map([
    ['ws-1', [{ id: 'proj-1', name: 'App', worktreePath: '/repo' }]],
  ]),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateSession.mockResolvedValue(undefined)
  vi.mocked(useWorkspaceStore).mockReturnValue(defaultWsStore as any)
  vi.mocked(useSettingsStore).mockReturnValue({
    resolveSettings: vi.fn().mockReturnValue({ terminal: { scrollbackLimit: 1000 } }),
  } as any)
})

describe('NewTabDialog', () => {
  it('renders title and form fields', () => {
    render(<NewTabDialog projectId="proj-1" onClose={vi.fn()} />)
    expect(screen.getByText('New Tab')).toBeTruthy()
    expect(screen.getByPlaceholderText('Terminal')).toBeTruthy()
    expect(screen.getByText('Human')).toBeTruthy()
    expect(screen.getByText('Agent')).toBeTruthy()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<NewTabDialog projectId="proj-1" onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('submits with default title when empty', async () => {
    const onClose = vi.fn()
    render(<NewTabDialog projectId="proj-1" onClose={onClose} />)
    fireEvent.click(screen.getByText('Open'))
    await vi.waitFor(() => expect(mockCreateSession).toHaveBeenCalled())
    const [projId, type, title] = mockCreateSession.mock.calls[0]
    expect(projId).toBe('proj-1')
    expect(type).toBe('human')
    expect(title).toBe('Terminal')
  })

  it('submits with custom title', async () => {
    render(<NewTabDialog projectId="proj-1" onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Terminal'), { target: { value: 'My Term' } })
    fireEvent.click(screen.getByText('Open'))
    await vi.waitFor(() => expect(mockCreateSession).toHaveBeenCalled())
    expect(mockCreateSession.mock.calls[0][2]).toBe('My Term')
  })

  it('uses Agent as default title for agent type', async () => {
    render(<NewTabDialog projectId="proj-1" onClose={vi.fn()} />)
    const radios = screen.getAllByRole('radio')
    fireEvent.click(radios[1]) // agent radio
    fireEvent.click(screen.getByText('Open'))
    await vi.waitFor(() => expect(mockCreateSession).toHaveBeenCalled())
    expect(mockCreateSession.mock.calls[0][1]).toBe('agent')
    expect(mockCreateSession.mock.calls[0][2]).toBe('Agent')
  })

  it('uses worktree path when project has worktreePath', async () => {
    render(<NewTabDialog projectId="proj-1" onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Open'))
    await vi.waitFor(() => expect(mockCreateSession).toHaveBeenCalled())
    expect(mockCreateSession.mock.calls[0][3]).toBe('/repo')
  })

  it('uses workspace folderPath when project has no worktreePath', async () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [{ id: 'ws-1', name: 'Main', folderPath: '/home' }],
      activeWorkspaceId: 'ws-1',
      projectsByWorkspaceId: new Map([['ws-1', [{ id: 'proj-1', name: 'App' }]]]),
    } as any)
    render(<NewTabDialog projectId="proj-1" onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Open'))
    await vi.waitFor(() => expect(mockCreateSession).toHaveBeenCalled())
    expect(mockCreateSession.mock.calls[0][3]).toBe('/home')
  })
})
