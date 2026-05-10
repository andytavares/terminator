import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { SettingsPanel } from '../../../../src/renderer/components/settings/SettingsPanel'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/toast.store', () => ({
  useToastStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/settings/GlobalSettings', () => ({
  GlobalSettings: () => <div data-testid="global-settings">GlobalSettings</div>,
}))
vi.mock('../../../../src/renderer/components/settings/WorkspaceSettings', () => ({
  WorkspaceSettings: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="workspace-settings">WorkspaceSettings {workspaceId}</div>
  ),
}))

const mockAddToast = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useWorkspaceStore).mockReturnValue({ activeWorkspaceId: null } as any)
  vi.mocked(useToastStore).mockReturnValue({ addToast: mockAddToast } as any)
  ;(globalThis as any).electronAPI = {
    extension: {
      list: vi.fn().mockResolvedValue({ extensions: [] }),
      install: vi.fn(),
      toggle: vi.fn(),
    },
    dialog: {
      openDirectory: vi.fn(),
    },
  }
})

afterEach(() => {
  delete (globalThis as any).electronAPI
})

describe('SettingsPanel', () => {
  it('renders Settings title', () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('shows GlobalSettings by default', () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    expect(screen.getByTestId('global-settings')).toBeTruthy()
  })

  it('shows Extensions nav item', () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    expect(screen.getByText('Extensions')).toBeTruthy()
  })

  it('hides Workspace Settings nav when no active workspace', () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    expect(screen.queryByText('Workspace Settings')).toBeNull()
  })

  it('shows Workspace Settings nav when a workspace is active', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({ activeWorkspaceId: 'ws-1' } as any)
    render(<SettingsPanel onClose={vi.fn()} />)
    expect(screen.getByText('Workspace Settings')).toBeTruthy()
  })

  it('switches to workspace section when Workspace Settings is clicked', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({ activeWorkspaceId: 'ws-1' } as any)
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Workspace Settings'))
    expect(screen.getByTestId('workspace-settings')).toBeTruthy()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<SettingsPanel onClose={onClose} />)
    fireEvent.click(screen.getByText('✕'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn()
    render(<SettingsPanel onClose={onClose} />)
    fireEvent.click(screen.getByText('Settings').closest('.settings-overlay')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    render(<SettingsPanel onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('ExtensionsSection', () => {
  beforeEach(() => {
    ;(globalThis as any).electronAPI.extension.list.mockResolvedValue({ extensions: [] })
  })

  it('shows empty message when no extensions', async () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => expect(screen.getByText('No extensions installed.')).toBeTruthy())
  })

  it('renders installed extensions list', async () => {
    const ext = { id: 'com.test', name: 'Test Extension', version: '1.0.0', status: 'enabled' }
    ;(globalThis as any).electronAPI.extension.list.mockResolvedValue({ extensions: [ext] })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => expect(screen.getByText('Test Extension')).toBeTruthy())
    expect(screen.getByText('v1.0.0')).toBeTruthy()
    expect(screen.getByText('enabled')).toBeTruthy()
  })

  it('shows Disable button for enabled extensions', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    ;(globalThis as any).electronAPI.extension.list.mockResolvedValue({ extensions: [ext] })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => expect(screen.getByText('Disable')).toBeTruthy())
  })

  it('shows Enable button for disabled extensions', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'disabled' }
    ;(globalThis as any).electronAPI.extension.list.mockResolvedValue({ extensions: [ext] })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => expect(screen.getByText('Enable')).toBeTruthy())
  })

  it('shows Install from Directory button', async () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => expect(screen.getByText('Install from Directory')).toBeTruthy())
  })

  it('calls openDirectory when install button is clicked', async () => {
    ;(globalThis as any).electronAPI.dialog.openDirectory.mockResolvedValue({ cancelled: true })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Install from Directory'))
    fireEvent.click(screen.getByText('Install from Directory'))
    await waitFor(() =>
      expect((globalThis as any).electronAPI.dialog.openDirectory).toHaveBeenCalled()
    )
  })

  it('installs extension and shows it in list', async () => {
    const newExt = { id: 'com.new', name: 'New Ext', version: '2.0.0', status: 'enabled' }
    ;(globalThis as any).electronAPI.dialog.openDirectory.mockResolvedValue({
      filePath: '/path/to/ext',
    })
    ;(globalThis as any).electronAPI.extension.install.mockResolvedValue({ extension: newExt })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Install from Directory'))
    fireEvent.click(screen.getByText('Install from Directory'))
    await waitFor(() => expect(screen.getByText('New Ext')).toBeTruthy())
  })

  it('shows toast on install error', async () => {
    ;(globalThis as any).electronAPI.dialog.openDirectory.mockResolvedValue({ filePath: '/path' })
    ;(globalThis as any).electronAPI.extension.install.mockResolvedValue({
      error: 'INVALID_MANIFEST',
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Install from Directory'))
    fireEvent.click(screen.getByText('Install from Directory'))
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
  })

  it('toggles extension enable/disable', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    ;(globalThis as any).electronAPI.extension.list.mockResolvedValue({ extensions: [ext] })
    ;(globalThis as any).electronAPI.extension.toggle.mockResolvedValue({
      extension: { ...ext, status: 'disabled' },
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Disable'))
    fireEvent.click(screen.getByText('Disable'))
    await waitFor(() =>
      expect((globalThis as any).electronAPI.extension.toggle).toHaveBeenCalledWith(
        'com.test',
        false
      )
    )
  })
})
