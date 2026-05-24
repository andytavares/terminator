import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type {
  TerminalSession,
  Workspace,
  Project,
  ProcessMetrics,
} from '../../../../src/shared/types/index'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))

vi.mock('../../../../src/renderer/components/ActivitySpinner', () => ({
  ActivitySpinner: () => <div data-testid="spinner" />,
}))

import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { SessionTile } from '../../../../src/renderer/components/overview/SessionTile'

function makeInstance(mountPreviewReturn: (() => void) | null = null) {
  return {
    mountPreview: vi.fn(() => mountPreviewReturn),
  }
}

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    tabTitle: 'Terminal',
    status: 'active',
    type: 'human',
    bellCount: 0,
    ...overrides,
  }
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'My Workspace',
    path: '/home/user',
    color: '#4a9eff',
    theme: 'dark',
    tags: [],
    ...overrides,
  }
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'My Project',
    activeSessionId: 'sess-1',
    ...overrides,
  }
}

function makeMetrics(overrides: Partial<ProcessMetrics> = {}): ProcessMetrics {
  return {
    pid: 1234,
    cpuPercent: 5.3,
    rssBytes: 50 * 1024 * 1024,
    ...overrides,
  }
}

const mockGetTerminalInstance = vi.fn()
const mockIsSessionBusy = vi.fn(() => false)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetTerminalInstance.mockReturnValue(undefined)
  mockIsSessionBusy.mockReturnValue(false)
  vi.mocked(useSessionStore).mockReturnValue({
    getTerminalInstance: mockGetTerminalInstance,
    isSessionBusy: mockIsSessionBusy,
  } as unknown as ReturnType<typeof useSessionStore>)
})

describe('SessionTile', () => {
  it('renders a preview container', () => {
    const { container } = render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    expect(container.querySelector('.session-tile__preview')).toBeTruthy()
  })

  it('calls mountPreview with the preview container when instance is available', () => {
    const instance = makeInstance()
    mockGetTerminalInstance.mockReturnValue(instance)
    render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    expect(instance.mountPreview).toHaveBeenCalled()
  })

  it('calls the cleanup function returned by mountPreview on unmount', () => {
    const cleanup = vi.fn()
    const instance = makeInstance(cleanup)
    mockGetTerminalInstance.mockReturnValue(instance)
    const { unmount } = render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    unmount()
    expect(cleanup).toHaveBeenCalled()
  })

  it('does not throw when no terminal instance', () => {
    mockGetTerminalInstance.mockReturnValue(undefined)
    expect(() =>
      render(
        <SessionTile
          session={makeSession()}
          workspace={makeWorkspace()}
          project={makeProject()}
          processMetrics={null}
          tileIndex={0}
          onNavigate={vi.fn()}
        />
      )
    ).not.toThrow()
  })

  it('shows workspace name, project name and tab title', () => {
    render(
      <SessionTile
        session={makeSession({ tabTitle: 'bash' })}
        workspace={makeWorkspace({ name: 'Personal' })}
        project={makeProject({ name: 'Frontend' })}
        processMetrics={null}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByText('Personal')).toBeTruthy()
    expect(screen.getByText('Frontend')).toBeTruthy()
    expect(screen.getByText('bash')).toBeTruthy()
  })

  it('renders workspace name with the workspace CSS class', () => {
    const { container } = render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace({ name: 'Work' })}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    expect(container.querySelector('.session-tile__workspace')?.textContent).toBe('Work')
  })

  it('shows CPU and memory when processMetrics provided', () => {
    render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={makeMetrics({ cpuPercent: 12.5, rssBytes: 50 * 1024 * 1024 })}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByText(/CPU 12\.5%/)).toBeTruthy()
    expect(screen.getByText(/50 MB/)).toBeTruthy()
  })

  it('hides metrics section when processMetrics is null', () => {
    const { container } = render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    expect(container.querySelector('.session-tile__metrics')).toBeNull()
  })

  it('shows spinner when session is busy', () => {
    mockIsSessionBusy.mockReturnValue(true)
    render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByTestId('spinner')).toBeTruthy()
  })

  it('hides spinner when session is idle', () => {
    mockIsSessionBusy.mockReturnValue(false)
    render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.queryByTestId('spinner')).toBeNull()
  })

  it('calls onNavigate when clicked', () => {
    const onNavigate = vi.fn()
    render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={onNavigate}
      />
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('calls onNavigate on Enter key', () => {
    const onNavigate = vi.fn()
    render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={onNavigate}
      />
    )
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('calls onNavigate on Space key', () => {
    const onNavigate = vi.fn()
    render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={onNavigate}
      />
    )
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' })
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('does not call onNavigate on unrelated key', () => {
    const onNavigate = vi.fn()
    render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={onNavigate}
      />
    )
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Tab' })
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('applies workspace color as CSS custom property', () => {
    const { container } = render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace({ color: '#ff0000' })}
        project={makeProject()}
        processMetrics={null}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    const tile = container.querySelector('.session-tile') as HTMLElement
    expect(tile.style.getPropertyValue('--tile-ws-color')).toBe('#ff0000')
  })

  it('formats GB correctly for large rss', () => {
    render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={makeMetrics({ rssBytes: 2 * 1024 ** 3 })}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByText(/2\.0 GB/)).toBeTruthy()
  })

  it('formats KB correctly for small rss', () => {
    render(
      <SessionTile
        session={makeSession()}
        workspace={makeWorkspace()}
        project={makeProject()}
        processMetrics={makeMetrics({ rssBytes: 512 * 1024 })}
        tileIndex={0}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByText(/512 KB/)).toBeTruthy()
  })
})
