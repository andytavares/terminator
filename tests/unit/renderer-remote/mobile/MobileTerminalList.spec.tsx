import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'
import type { Workspace } from '../../../../src/renderer-remote/api/remote-client'
import type { TerminalSession } from '../../../../src/renderer-remote/api/remote-client'

const mockOnSelectTerminal = vi.fn()
const mockOnCreateTerminal = vi.fn()
const mockOnAssignWorkspace = vi.fn()

const workspace: Workspace = {
  id: 'w1',
  name: 'My Workspace',
  folderPath: '/Users/me/projects',
  color: 'blue',
  tags: [],
}

describe('MobileTerminalList', () => {
  it('renders workspace names', async () => {
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    expect(screen.getByText('My Workspace')).toBeTruthy()
  })

  it('renders terminal items with cwd label', async () => {
    const terminal: TerminalSession = {
      sessionId: 's1',
      cwd: '/Users/me/projects/myapp',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[terminal]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    expect(screen.getByText('myapp')).toBeTruthy()
  })

  it('calls onSelectTerminal with correct sessionId and cwd when terminal is tapped', async () => {
    const terminal: TerminalSession = {
      sessionId: 's1',
      cwd: '/tmp/myapp',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[terminal]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    fireEvent.click(screen.getByText('myapp'))
    expect(mockOnSelectTerminal).toHaveBeenCalledWith({ sessionId: 's1', cwd: '/tmp/myapp' })
  })

  it('shows "New Terminal" button per workspace', async () => {
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    expect(screen.getByRole('button', { name: /new terminal/i })).toBeTruthy()
  })

  it('calls onCreateTerminal with workspaceId and folderPath when "New Terminal" is clicked', async () => {
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /new terminal/i }))
    expect(mockOnCreateTerminal).toHaveBeenCalledWith('w1', '/Users/me/projects')
  })

  it('renders gracefully with empty terminals list', async () => {
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    const { container } = render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    expect(container).toBeTruthy()
  })

  it('shows terminal under matching workspace by cwd prefix', async () => {
    const terminal: TerminalSession = {
      sessionId: 's-ws',
      cwd: '/Users/me/projects/myapp',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[terminal]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    // appears exactly once (under the workspace, not duplicated)
    expect(screen.getAllByText('myapp')).toHaveLength(1)
  })

  it('does not assign a terminal to workspace when cwd only shares a prefix without a path separator', async () => {
    // workspace.folderPath = '/Users/me/projects'
    // a cwd of '/Users/me/projects-extra' must NOT match
    const terminal: TerminalSession = {
      sessionId: 's-prefix-trap',
      cwd: '/Users/me/projects-extra/thing',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[terminal]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    // Should appear in the fallback section, not under the workspace
    expect(screen.getByText('thing')).toBeTruthy()
    // Only one occurrence — not duplicated
    expect(screen.getAllByText('thing')).toHaveLength(1)
  })

  it('shows unmatched terminal in fallback section outside any workspace', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-global',
      cwd: '/tmp/scratch',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[unmatched]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    expect(screen.getByText('scratch')).toBeTruthy()
    fireEvent.click(screen.getByText('scratch'))
    expect(mockOnSelectTerminal).toHaveBeenCalledWith({
      sessionId: 's-global',
      cwd: '/tmp/scratch',
    })
  })

  it('triggers onSelectTerminal via Enter key on workspace terminal', async () => {
    const terminal: TerminalSession = {
      sessionId: 's-enter-ws',
      cwd: '/Users/me/projects/myapp',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[terminal]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    fireEvent.keyDown(screen.getByText('myapp'), { key: 'Enter' })
    expect(mockOnSelectTerminal).toHaveBeenCalledWith({
      sessionId: 's-enter-ws',
      cwd: '/Users/me/projects/myapp',
    })
  })

  it('triggers onSelectTerminal via Enter key on fallback terminal', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-enter-global',
      cwd: '/tmp/enter-scratch',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[unmatched]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    fireEvent.keyDown(screen.getByText('enter-scratch'), { key: 'Enter' })
    expect(mockOnSelectTerminal).toHaveBeenCalledWith({
      sessionId: 's-enter-global',
      cwd: '/tmp/enter-scratch',
    })
  })

  it('places a terminal with workspaceId override under the matching workspace regardless of cwd', async () => {
    const terminal: TerminalSession = {
      sessionId: 's-override',
      cwd: '/tmp/random',
      createdAt: '2026-06-19T10:00:00.000Z',
      workspaceId: 'w1',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[terminal]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    // Should appear under the workspace (not in fallback)
    expect(screen.getByText('random')).toBeTruthy()
    expect(screen.getAllByText('random')).toHaveLength(1)
  })

  it('shows context menu with workspace options on right-click of fallback terminal', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-ctx',
      cwd: '/tmp/ctx-scratch',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[unmatched]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    fireEvent.contextMenu(screen.getByText('ctx-scratch'))
    expect(screen.getAllByText('My Workspace').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Move to workspace')).toBeTruthy()
  })

  it('long-press (touchStart → 500ms) opens context menu on scratch terminal', async () => {
    vi.useFakeTimers()
    const unmatched: TerminalSession = {
      sessionId: 's-longpress',
      cwd: '/tmp/longpress',
      createdAt: '2026-06-20T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[unmatched]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    const btn = screen.getByText('longpress').closest('button')!
    fireEvent.touchStart(btn, { touches: [{ clientX: 50, clientY: 100 }] })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.getByText('Move to workspace')).toBeTruthy()
    vi.useRealTimers()
  })

  it('touchEnd before 500ms cancels long-press and no context menu appears', async () => {
    vi.useFakeTimers()
    const unmatched: TerminalSession = {
      sessionId: 's-touchend',
      cwd: '/tmp/touchend',
      createdAt: '2026-06-20T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[unmatched]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    const btn = screen.getByText('touchend').closest('button')!
    fireEvent.touchStart(btn, { touches: [{ clientX: 50, clientY: 100 }] })
    fireEvent.touchEnd(btn)
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByText('Move to workspace')).toBeNull()
    vi.useRealTimers()
  })

  it('touchMove before 500ms cancels long-press and no context menu appears', async () => {
    vi.useFakeTimers()
    const unmatched: TerminalSession = {
      sessionId: 's-touchmove',
      cwd: '/tmp/touchmove',
      createdAt: '2026-06-20T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[unmatched]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    const btn = screen.getByText('touchmove').closest('button')!
    fireEvent.touchStart(btn, { touches: [{ clientX: 50, clientY: 100 }] })
    fireEvent.touchMove(btn)
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByText('Move to workspace')).toBeNull()
    vi.useRealTimers()
  })

  it('shows "No workspaces" message in context menu when workspace list is empty', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-noworkspace',
      cwd: '/tmp/noworkspace',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[]}
        terminals={[unmatched]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    fireEvent.contextMenu(screen.getByText('noworkspace'))
    expect(screen.getByText('No workspaces')).toBeTruthy()
  })

  it('calls onAssignWorkspace when a workspace is chosen from context menu', async () => {
    const unmatched: TerminalSession = {
      sessionId: 's-assign',
      cwd: '/tmp/assign-scratch',
      createdAt: '2026-06-19T10:00:00.000Z',
    }
    const { MobileTerminalList } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalList'
    )
    render(
      <MobileTerminalList
        workspaces={[workspace]}
        terminals={[unmatched]}
        onSelectTerminal={mockOnSelectTerminal}
        onCreateTerminal={mockOnCreateTerminal}
        onAssignWorkspace={mockOnAssignWorkspace}
      />
    )
    fireEvent.contextMenu(screen.getByText('assign-scratch'))
    // Click the workspace option in the context menu
    const menuItems = screen.getAllByText('My Workspace')
    fireEvent.click(menuItems[menuItems.length - 1])
    expect(mockOnAssignWorkspace).toHaveBeenCalledWith('s-assign', 'w1')
  })
})
