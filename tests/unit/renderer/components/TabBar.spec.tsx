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

const mockCloseSession = vi.fn()
const mockSetActive = vi.fn()
const mockGetActive = vi.fn()
const mockGetSessions = vi.fn()
const mockGetBell = vi.fn()
const mockOnNewTab = vi.fn()

function renderTabBar(overrides: Partial<React.ComponentProps<typeof TabBar>> = {}) {
  return render(
    <TabBar
      projectId="proj-1"
      activeProjectTabId={null}
      projectTabs={[]}
      onSelectProjectTab={vi.fn()}
      onNewTab={mockOnNewTab}
      {...overrides}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
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
    renderTabBar()
    expect(screen.getByText('Terminal')).toBeTruthy()
  })

  it('renders extension-contributed tabs', () => {
    renderTabBar({
      projectTabs: [
        {
          id: 'git',
          label: 'Git',
          component: null as unknown as ComponentType<{ repoRoot: string | null }>,
        },
      ],
    })
    expect(screen.getByText('Git')).toBeTruthy()
  })

  it('shows new tab button when Terminal is active', () => {
    renderTabBar()
    expect(screen.getByTitle('New tab (⌘T)')).toBeTruthy()
  })

  it('hides session sub-tab bar when extension tab is active', () => {
    renderTabBar({
      activeProjectTabId: 'git',
      projectTabs: [
        {
          id: 'git',
          label: 'Git',
          component: null as unknown as ComponentType<{ repoRoot: string | null }>,
        },
      ],
    })
    expect(screen.queryByTitle('New tab (⌘T)')).toBeNull()
  })

  it('renders sessions as tabs without agent badge', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human' },
      { id: 'ses-2', tabTitle: 'Agent', type: 'human' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    expect(screen.getByText('bash')).toBeTruthy()
    expect(screen.getByText('Agent')).toBeTruthy()
    expect(screen.queryByText('agent')).toBeNull()
  })

  it('calls closeSession when close button is clicked', () => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'bash', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    fireEvent.click(screen.getByTitle('Close tab'))
    expect(mockCloseSession).toHaveBeenCalledWith('ses-1')
  })

  it('calls onNewTab when + button is clicked', () => {
    renderTabBar()
    fireEvent.click(screen.getByTitle('New tab (⌘T)'))
    expect(mockOnNewTab).toHaveBeenCalled()
  })

  it('applies workspace color css variable when workspace matches', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [{ id: 'ws-1', color: '#ff0000', name: 'Test', folderPath: '/', tags: [] }],
      activeWorkspaceId: 'ws-1',
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    const { container } = renderTabBar()
    const tabBarStack = container.querySelector('.tab-bar-stack') as HTMLElement
    expect(tabBarStack.style.getPropertyValue('--ws-color')).toBe('#ff0000')
  })

  it('calls onSelectProjectTab(null) when Terminal tab is clicked', () => {
    const onSelectProjectTab = vi.fn()
    renderTabBar({
      activeProjectTabId: 'git',
      projectTabs: [
        {
          id: 'git',
          label: 'Git',
          component: null as unknown as ComponentType<{ repoRoot: string | null }>,
        },
      ],
      onSelectProjectTab,
    })
    fireEvent.click(screen.getByText('Terminal'))
    expect(onSelectProjectTab).toHaveBeenCalledWith(null)
  })

  it('calls onSelectProjectTab with tab id when extension tab is clicked', () => {
    const onSelectProjectTab = vi.fn()
    renderTabBar({
      projectTabs: [
        {
          id: 'git',
          label: 'Git',
          component: null as unknown as ComponentType<{ repoRoot: string | null }>,
        },
      ],
      onSelectProjectTab,
    })
    fireEvent.click(screen.getByText('Git'))
    expect(onSelectProjectTab).toHaveBeenCalledWith('git')
  })

  it('calls setActiveSessionForProject when session tab is clicked', () => {
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'bash', type: 'human' },
      { id: 'ses-2', tabTitle: 'zsh', type: 'human' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    renderTabBar()
    fireEvent.click(screen.getByText('zsh'))
    expect(mockSetActive).toHaveBeenCalledWith('proj-1', 'ses-2')
  })
})
