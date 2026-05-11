import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { TabBar } from '../../../../src/renderer/components/terminal/TabBar'
import type { ComponentType } from 'react'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/terminal/NewTabDialog', () => ({
  NewTabDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="new-tab-dialog">
      <button onClick={onClose}>Close Dialog</button>
    </div>
  ),
}))

const mockCloseSession = vi.fn()
const mockSetActive = vi.fn()
const mockGetActive = vi.fn()
const mockGetSessions = vi.fn()
const mockGetBell = vi.fn()

beforeEach(() => {
  vi.mocked(useSessionStore).mockReturnValue({
    getSessionsForProject: mockGetSessions,
    closeSession: mockCloseSession,
    setActiveSessionForProject: mockSetActive,
    getActiveSessionForProject: mockGetActive,
    getBellCountForSession: mockGetBell,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useWorkspaceStore).mockReturnValue({
    workspaces: [],
    activeWorkspaceId: null,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  mockGetSessions.mockReturnValue([])
  mockGetActive.mockReturnValue(null)
  mockGetBell.mockReturnValue(0)
})

describe('TabBar', () => {
  it('renders Terminal primary tab', () => {
    render(
      <TabBar
        projectId="proj-1"
        activeProjectTabId={null}
        projectTabs={[]}
        onSelectProjectTab={vi.fn()}
      />
    )
    expect(screen.getByText('Terminal')).toBeTruthy()
  })

  it('renders extension-contributed tabs', () => {
    render(
      <TabBar
        projectId="proj-1"
        activeProjectTabId={null}
        projectTabs={[
          {
            id: 'git',
            label: 'Git',
            component: null as unknown as ComponentType<{ repoRoot: string | null }>,
          },
        ]}
        onSelectProjectTab={vi.fn()}
      />
    )
    expect(screen.getByText('Git')).toBeTruthy()
  })

  it('shows new tab button when Terminal is active', () => {
    render(
      <TabBar
        projectId="proj-1"
        activeProjectTabId={null}
        projectTabs={[]}
        onSelectProjectTab={vi.fn()}
      />
    )
    expect(screen.getByTitle('New tab (⌘T)')).toBeTruthy()
  })

  it('hides session sub-tab bar when extension tab is active', () => {
    render(
      <TabBar
        projectId="proj-1"
        activeProjectTabId="git"
        projectTabs={[
          {
            id: 'git',
            label: 'Git',
            component: null as unknown as ComponentType<{ repoRoot: string | null }>,
          },
        ]}
        onSelectProjectTab={vi.fn()}
      />
    )
    expect(screen.queryByTitle('New tab (⌘T)')).toBeNull()
  })

  it('renders sessions as tabs', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human' },
      { id: 'ses-2', tabTitle: 'Agent', type: 'agent' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    render(
      <TabBar
        projectId="proj-1"
        activeProjectTabId={null}
        projectTabs={[]}
        onSelectProjectTab={vi.fn()}
      />
    )
    expect(screen.getByText('bash')).toBeTruthy()
    expect(screen.getByText('Agent')).toBeTruthy()
    expect(screen.getByText('agent')).toBeTruthy()
  })

  it('calls closeSession when close button is clicked', () => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'bash', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    render(
      <TabBar
        projectId="proj-1"
        activeProjectTabId={null}
        projectTabs={[]}
        onSelectProjectTab={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTitle('Close tab'))
    expect(mockCloseSession).toHaveBeenCalledWith('ses-1')
  })

  it('opens new tab dialog when + button is clicked', () => {
    render(
      <TabBar
        projectId="proj-1"
        activeProjectTabId={null}
        projectTabs={[]}
        onSelectProjectTab={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTitle('New tab (⌘T)'))
    expect(screen.getByTestId('new-tab-dialog')).toBeTruthy()
  })

  it('calls setActiveSessionForProject when session tab is clicked', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human' },
      { id: 'ses-2', tabTitle: 'zsh', type: 'human' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    render(
      <TabBar
        projectId="proj-1"
        activeProjectTabId={null}
        projectTabs={[]}
        onSelectProjectTab={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('zsh'))
    expect(mockSetActive).toHaveBeenCalledWith('proj-1', 'ses-2')
  })
})
