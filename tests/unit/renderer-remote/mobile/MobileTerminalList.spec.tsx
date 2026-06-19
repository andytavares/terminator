import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import type { Workspace } from '../../../../src/renderer-remote/api/remote-client'
import type { TerminalSession } from '../../../../src/renderer-remote/api/remote-client'

const mockOnSelectTerminal = vi.fn()
const mockOnCreateTerminal = vi.fn()

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
      />
    )
    expect(container).toBeTruthy()
  })
})
