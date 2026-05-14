import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CommandPalette } from '../../../../src/renderer/components/CommandPalette'
import type { CommandRegistration } from '../../../../src/renderer/extensions/registry'

vi.mock('../../../../src/renderer/components/CommandPalette.css', () => ({}))

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn()

const mockExecuteCommand = vi.fn()
const mockGetCommands = vi.fn().mockResolvedValue({ commands: [] })

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extension: {
      getCommands: mockGetCommands,
      executeCommand: mockExecuteCommand,
    },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

const sampleCommands: CommandRegistration[] = [
  {
    id: 'core.open-settings',
    label: 'Open Settings',
    shortcut: '⌘,',
    category: 'App',
    action: vi.fn(),
  },
  {
    id: 'core.toggle-log',
    label: 'Toggle Log Window',
    shortcut: '⌘⇧L',
    category: 'App',
    action: vi.fn(),
  },
  {
    id: 'core.new-tab',
    label: 'New Terminal Tab',
    shortcut: '⌘T',
    category: 'Terminal',
    action: vi.fn(),
  },
]

describe('CommandPalette', () => {
  it('renders the input and all commands', async () => {
    render(<CommandPalette commands={sampleCommands} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByPlaceholderText('Type a command…')).toBeTruthy())
    expect(screen.getByText('Open Settings')).toBeTruthy()
    expect(screen.getByText('Toggle Log Window')).toBeTruthy()
    expect(screen.getByText('New Terminal Tab')).toBeTruthy()
  })

  it('filters commands as user types', async () => {
    render(<CommandPalette commands={sampleCommands} onClose={vi.fn()} />)
    await waitFor(() => screen.getByPlaceholderText('Type a command…'))
    fireEvent.change(screen.getByPlaceholderText('Type a command…'), { target: { value: 'log' } })
    expect(screen.getByText('Toggle Log Window')).toBeTruthy()
    expect(screen.queryByText('Open Settings')).toBeNull()
    expect(screen.queryByText('New Terminal Tab')).toBeNull()
  })

  it('shows empty message when no commands match', async () => {
    render(<CommandPalette commands={sampleCommands} onClose={vi.fn()} />)
    await waitFor(() => screen.getByPlaceholderText('Type a command…'))
    fireEvent.change(screen.getByPlaceholderText('Type a command…'), {
      target: { value: 'zzznomatch' },
    })
    expect(screen.getByText(/No commands match/)).toBeTruthy()
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(<CommandPalette commands={sampleCommands} onClose={onClose} />)
    await waitFor(() => screen.getByPlaceholderText('Type a command…'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('calls action and onClose when Enter is pressed on active item', async () => {
    const action = vi.fn()
    const onClose = vi.fn()
    const cmds: CommandRegistration[] = [{ id: 'test.cmd', label: 'Test Command', action }]
    render(<CommandPalette commands={cmds} onClose={onClose} />)
    await waitFor(() => screen.getByPlaceholderText('Type a command…'))
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(action).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('navigates list with ArrowDown and ArrowUp', async () => {
    const onClose = vi.fn()
    render(<CommandPalette commands={sampleCommands} onClose={onClose} />)
    await waitFor(() => screen.getByPlaceholderText('Type a command…'))
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    // Should not throw; verify list items still visible
    expect(screen.getByText('Toggle Log Window')).toBeTruthy()
  })

  it('calls action and onClose when item is clicked', async () => {
    const action = vi.fn()
    const onClose = vi.fn()
    const cmds: CommandRegistration[] = [{ id: 'test.cmd', label: 'Clickable Command', action }]
    render(<CommandPalette commands={cmds} onClose={onClose} />)
    await waitFor(() => screen.getByText('Clickable Command'))
    fireEvent.mouseDown(screen.getByText('Clickable Command'))
    expect(action).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay is clicked', async () => {
    const onClose = vi.fn()
    render(<CommandPalette commands={[]} onClose={onClose} />)
    await waitFor(() => screen.getByPlaceholderText('Type a command…'))
    const overlay = document.querySelector('.cmd-palette-overlay')
    if (overlay) fireEvent.mouseDown(overlay)
    expect(onClose).toHaveBeenCalled()
  })

  it('renders extension commands from IPC', async () => {
    mockGetCommands.mockResolvedValue({
      commands: [{ key: 'ext-cmd', id: 'ext-cmd', label: 'Extension Command', category: 'Ext' }],
    })
    render(<CommandPalette commands={[]} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Extension Command')).toBeTruthy())
  })

  it('executes extension command via IPC', async () => {
    mockGetCommands.mockResolvedValue({
      commands: [{ key: 'ext-cmd', id: 'ext-cmd', label: 'Run Ext', category: 'Ext' }],
    })
    const onClose = vi.fn()
    render(<CommandPalette commands={[]} onClose={onClose} />)
    await waitFor(() => screen.getByText('Run Ext'))
    fireEvent.mouseDown(screen.getByText('Run Ext'))
    expect(mockExecuteCommand).toHaveBeenCalledWith('ext-cmd')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders shortcut hints for commands that have them', async () => {
    render(<CommandPalette commands={sampleCommands} onClose={vi.fn()} />)
    await waitFor(() => screen.getByPlaceholderText('Type a command…'))
    expect(screen.getByText('⌘,')).toBeTruthy()
  })

  it('renders category badges', async () => {
    render(<CommandPalette commands={sampleCommands} onClose={vi.fn()} />)
    await waitFor(() => screen.getByPlaceholderText('Type a command…'))
    expect(screen.getAllByText('App').length).toBeGreaterThan(0)
  })
})
