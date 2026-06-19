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
  vi.mocked(useWorkspaceStore).mockReturnValue({ activeWorkspaceId: null } as unknown as ReturnType<
    typeof useWorkspaceStore
  >)
  vi.mocked(useToastStore).mockReturnValue({ addToast: mockAddToast } as unknown as ReturnType<
    typeof useWorkspaceStore
  >)
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extension: {
      list: vi.fn().mockResolvedValue({ extensions: [] }),
      install: vi.fn(),
      toggle: vi.fn(),
      uninstall: vi.fn().mockResolvedValue({ ok: true }),
      reload: vi.fn().mockResolvedValue({ extension: {} }),
      getSettingsSchemas: vi.fn().mockResolvedValue({ schemas: [] }),
      getSettingsValues: vi.fn().mockResolvedValue({ values: {} }),
      updateSetting: vi.fn().mockResolvedValue({ ok: true }),
    },
    dialog: {
      openDirectory: vi.fn(),
    },
    extensionBridge: {
      invoke: vi.fn().mockResolvedValue({ data: { ok: true } }),
    },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
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
    vi.mocked(useWorkspaceStore).mockReturnValue({
      activeWorkspaceId: 'ws-1',
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<SettingsPanel onClose={vi.fn()} />)
    expect(screen.getByText('Workspace Settings')).toBeTruthy()
  })

  it('switches to workspace section when Workspace Settings is clicked', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      activeWorkspaceId: 'ws-1',
    } as unknown as ReturnType<typeof useWorkspaceStore>)
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
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [] })
  })

  it('shows empty message when no extensions', async () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => expect(screen.getByText('No extensions installed.')).toBeTruthy())
  })

  it('renders installed extensions list', async () => {
    const ext = { id: 'com.test', name: 'Test Extension', version: '1.0.0', status: 'enabled' }
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => expect(screen.getByText('Test Extension')).toBeTruthy())
    expect(screen.getByText('v1.0.0')).toBeTruthy()
    expect(screen.getByText('enabled')).toBeTruthy()
  })

  it('shows Disable button for enabled extensions', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => expect(screen.getByText('Disable')).toBeTruthy())
  })

  it('shows Enable button for disabled extensions', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'disabled' }
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
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
    ;(
      window.electronAPI as unknown as { dialog: { openDirectory: ReturnType<typeof vi.fn> } }
    ).dialog.openDirectory.mockResolvedValue({ cancelled: true })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Install from Directory'))
    fireEvent.click(screen.getByText('Install from Directory'))
    await waitFor(() =>
      expect(
        (window.electronAPI as unknown as { dialog: { openDirectory: ReturnType<typeof vi.fn> } })
          .dialog.openDirectory
      ).toHaveBeenCalled()
    )
  })

  it('installs extension and shows it in list', async () => {
    const newExt = { id: 'com.new', name: 'New Ext', version: '2.0.0', status: 'enabled' }
    ;(
      window.electronAPI as unknown as { dialog: { openDirectory: ReturnType<typeof vi.fn> } }
    ).dialog.openDirectory.mockResolvedValue({
      filePath: '/path/to/ext',
    })
    ;(
      window.electronAPI as unknown as { extension: { install: ReturnType<typeof vi.fn> } }
    ).extension.install.mockResolvedValue({ extension: newExt })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Install from Directory'))
    fireEvent.click(screen.getByText('Install from Directory'))
    await waitFor(() => expect(screen.getByText('New Ext')).toBeTruthy())
  })

  it('shows toast on install error', async () => {
    ;(
      window.electronAPI as unknown as { dialog: { openDirectory: ReturnType<typeof vi.fn> } }
    ).dialog.openDirectory.mockResolvedValue({ filePath: '/path' })
    ;(
      window.electronAPI as unknown as { extension: { install: ReturnType<typeof vi.fn> } }
    ).extension.install.mockResolvedValue({
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
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
    ;(
      window.electronAPI as unknown as { extension: { toggle: ReturnType<typeof vi.fn> } }
    ).extension.toggle.mockResolvedValue({
      extension: { ...ext, status: 'disabled' },
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Disable'))
    fireEvent.click(screen.getByText('Disable'))
    await waitFor(() =>
      expect(
        (window.electronAPI as unknown as { extension: { toggle: ReturnType<typeof vi.fn> } })
          .extension.toggle
      ).toHaveBeenCalledWith('com.test', false)
    )
  })

  it('reloads extension and shows toast', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
    ;(
      window.electronAPI as unknown as { extension: { reload: ReturnType<typeof vi.fn> } }
    ).extension.reload.mockResolvedValue({ extension: { ...ext, version: '1.0.1' } })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Reload'))
    fireEvent.click(screen.getByText('Reload'))
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
    )
  })

  it('shows toast when reload fails', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
    ;(
      window.electronAPI as unknown as { extension: { reload: ReturnType<typeof vi.fn> } }
    ).extension.reload.mockResolvedValue({ error: 'RELOAD_FAILED' })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Reload'))
    fireEvent.click(screen.getByText('Reload'))
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
  })

  it('uninstalls extension when confirm is accepted', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Uninstall'))
    fireEvent.click(screen.getByText('Uninstall'))
    await waitFor(() =>
      expect(
        (window.electronAPI as unknown as { extension: { uninstall: ReturnType<typeof vi.fn> } })
          .extension.uninstall
      ).toHaveBeenCalledWith('com.test')
    )
    vi.unstubAllGlobals()
  })

  it('does not uninstall when confirm is declined', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Uninstall'))
    fireEvent.click(screen.getByText('Uninstall'))
    await new Promise((r) => setTimeout(r, 50))
    expect(
      (window.electronAPI as unknown as { extension: { uninstall: ReturnType<typeof vi.fn> } })
        .extension.uninstall
    ).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('upgrades extension via Browse + install', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    const upgraded = { ...ext, version: '2.0.0' }
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
    ;(
      window.electronAPI as unknown as { dialog: { openDirectory: ReturnType<typeof vi.fn> } }
    ).dialog.openDirectory.mockResolvedValue({ filePath: '/path/to/upgrade' })
    ;(
      window.electronAPI as unknown as { extension: { uninstall: ReturnType<typeof vi.fn> } }
    ).extension.uninstall.mockResolvedValue({ ok: true })
    ;(
      window.electronAPI as unknown as { extension: { install: ReturnType<typeof vi.fn> } }
    ).extension.install.mockResolvedValue({ extension: upgraded })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Upgrade'))
    fireEvent.click(screen.getByText('Upgrade'))
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
    )
  })

  it('shows error toast when upgrade install step fails', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
    ;(
      window.electronAPI as unknown as { dialog: { openDirectory: ReturnType<typeof vi.fn> } }
    ).dialog.openDirectory.mockResolvedValue({ filePath: '/path/to/upgrade' })
    ;(
      window.electronAPI as unknown as { extension: { uninstall: ReturnType<typeof vi.fn> } }
    ).extension.uninstall.mockResolvedValue({ ok: true })
    ;(
      window.electronAPI as unknown as { extension: { install: ReturnType<typeof vi.fn> } }
    ).extension.install.mockResolvedValue({ error: 'INVALID_MANIFEST' })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Upgrade'))
    fireEvent.click(screen.getByText('Upgrade'))
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
  })

  it('shows error toast when upgrade uninstall step fails', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
    ;(
      window.electronAPI as unknown as { dialog: { openDirectory: ReturnType<typeof vi.fn> } }
    ).dialog.openDirectory.mockResolvedValue({ filePath: '/path/to/upgrade' })
    ;(
      window.electronAPI as unknown as { extension: { uninstall: ReturnType<typeof vi.fn> } }
    ).extension.uninstall.mockResolvedValue({ error: 'UNINSTALL_FAILED' })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Upgrade'))
    fireEvent.click(screen.getByText('Upgrade'))
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
  })

  it('skips upgrade when directory dialog is cancelled', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    ;(
      window.electronAPI as unknown as { extension: { list: ReturnType<typeof vi.fn> } }
    ).extension.list.mockResolvedValue({ extensions: [ext] })
    ;(
      window.electronAPI as unknown as { dialog: { openDirectory: ReturnType<typeof vi.fn> } }
    ).dialog.openDirectory.mockResolvedValue({ cancelled: true })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByText('Upgrade'))
    fireEvent.click(screen.getByText('Upgrade'))
    await new Promise((r) => setTimeout(r, 50))
    expect(
      (window.electronAPI as unknown as { extension: { uninstall: ReturnType<typeof vi.fn> } })
        .extension.uninstall
    ).not.toHaveBeenCalled()
  })

  it('renders ExtensionSettingRow for extension with schema', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    const extAPI = window.electronAPI as unknown as {
      extension: {
        list: ReturnType<typeof vi.fn>
        getSettingsSchemas: ReturnType<typeof vi.fn>
      }
    }
    extAPI.extension.list.mockResolvedValue({ extensions: [ext] })
    extAPI.extension.getSettingsSchemas.mockResolvedValue({
      schemas: [
        {
          extensionId: 'com.test',
          label: 'Test Extension',
          properties: {
            'com.test.myKey': {
              type: 'string',
              label: 'My Setting',
              description: 'A test setting',
              default: 'hello',
            },
          },
        },
      ],
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByTitle('Configure'))
    fireEvent.click(screen.getByTitle('Configure'))
    await waitFor(() => expect(screen.getByText('My Setting')).toBeTruthy())
  })

  it('ExtensionSettingRow calls updateSetting after debounce', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    const extAPI = window.electronAPI as unknown as {
      extension: {
        list: ReturnType<typeof vi.fn>
        getSettingsSchemas: ReturnType<typeof vi.fn>
        updateSetting: ReturnType<typeof vi.fn>
      }
    }
    extAPI.extension.list.mockResolvedValue({ extensions: [ext] })
    extAPI.extension.getSettingsSchemas.mockResolvedValue({
      schemas: [
        {
          extensionId: 'com.test',
          label: 'Test Extension',
          properties: {
            'com.test.myKey': {
              type: 'string',
              label: 'My Setting',
              default: 'hello',
            },
          },
        },
      ],
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByTitle('Configure'))
    fireEvent.click(screen.getByTitle('Configure'))
    await waitFor(() => screen.getByDisplayValue('hello'))
    fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: 'world' } })
    // Wait for debounce timer (400ms) to fire
    await waitFor(
      () => expect(extAPI.extension.updateSetting).toHaveBeenCalledWith('com.test.myKey', 'world'),
      { timeout: 2000 }
    )
  })

  it('ExtensionSettingRow renders boolean select', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    const extAPI = window.electronAPI as unknown as {
      extension: {
        list: ReturnType<typeof vi.fn>
        getSettingsSchemas: ReturnType<typeof vi.fn>
      }
    }
    extAPI.extension.list.mockResolvedValue({ extensions: [ext] })
    extAPI.extension.getSettingsSchemas.mockResolvedValue({
      schemas: [
        {
          extensionId: 'com.test',
          label: 'Test Extension',
          properties: {
            'com.test.toggle': {
              type: 'boolean',
              label: 'Enable Feature',
              default: true,
            },
          },
        },
      ],
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByTitle('Configure'))
    fireEvent.click(screen.getByTitle('Configure'))
    await waitFor(() => expect(screen.getByText('Enable Feature')).toBeTruthy())
    // The boolean setting renders as a toggle switch (role="switch")
    expect(screen.getByRole('switch', { name: 'Enable Feature' })).toBeTruthy()
  })

  it('ExtensionSettingRow renders enum select', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    const extAPI = window.electronAPI as unknown as {
      extension: {
        list: ReturnType<typeof vi.fn>
        getSettingsSchemas: ReturnType<typeof vi.fn>
      }
    }
    extAPI.extension.list.mockResolvedValue({ extensions: [ext] })
    extAPI.extension.getSettingsSchemas.mockResolvedValue({
      schemas: [
        {
          extensionId: 'com.test',
          label: 'Test Extension',
          properties: {
            'com.test.mode': {
              type: 'enum',
              label: 'Mode',
              options: ['fast', 'slow', 'auto'],
              default: 'auto',
            },
          },
        },
      ],
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByTitle('Configure'))
    fireEvent.click(screen.getByTitle('Configure'))
    await waitFor(() => expect(screen.getByText('Mode')).toBeTruthy())
    // Enum options are capitalized in the segmented control
    expect(screen.getByText('Fast')).toBeTruthy()
    expect(screen.getByText('Slow')).toBeTruthy()
    expect(screen.getByText('Auto')).toBeTruthy()
  })

  it('toggleSettingsExpand collapses panel when clicked again', async () => {
    const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
    const extAPI = window.electronAPI as unknown as {
      extension: {
        list: ReturnType<typeof vi.fn>
        getSettingsSchemas: ReturnType<typeof vi.fn>
      }
    }
    extAPI.extension.list.mockResolvedValue({ extensions: [ext] })
    extAPI.extension.getSettingsSchemas.mockResolvedValue({
      schemas: [
        {
          extensionId: 'com.test',
          label: 'Test Extension',
          properties: {
            'com.test.key': { type: 'string', label: 'Key', default: 'val' },
          },
        },
      ],
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await waitFor(() => screen.getByTitle('Configure'))
    const gearBtn = screen.getByTitle('Configure')
    fireEvent.click(gearBtn)
    await waitFor(() => expect(screen.getByText('Key')).toBeTruthy())
    fireEvent.click(gearBtn)
    await waitFor(() => expect(screen.queryByText('Key')).toBeNull())
  })

  it('switches to global section when Appearance & Terminal is clicked', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      activeWorkspaceId: 'ws-1',
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    fireEvent.click(screen.getByText('Appearance & Terminal'))
    expect(screen.getByTestId('global-settings')).toBeTruthy()
  })

  describe('ActionSettingRow', () => {
    function setupExtWithAction(
      opts: {
        danger?: boolean
        confirmMessage?: string
      } = {}
    ) {
      const ext = { id: 'com.test', name: 'Test Ext', version: '1.0.0', status: 'enabled' }
      const extAPI = window.electronAPI as unknown as {
        extension: {
          list: ReturnType<typeof vi.fn>
          getSettingsSchemas: ReturnType<typeof vi.fn>
        }
        extensionBridge: { invoke: ReturnType<typeof vi.fn> }
      }
      extAPI.extension.list.mockResolvedValue({ extensions: [ext] })
      extAPI.extension.getSettingsSchemas.mockResolvedValue({
        schemas: [
          {
            extensionId: 'com.test',
            label: 'Test Extension',
            properties: {
              'com.test.action': {
                type: 'action',
                label: 'Do Thing',
                description: 'Does the thing',
                channel: 'com.test:do-thing',
                default: null,
                ...opts,
              },
            },
          },
        ],
      })
      return extAPI
    }

    async function openSettings() {
      render(<SettingsPanel onClose={vi.fn()} />)
      fireEvent.click(screen.getByText('Extensions'))
      await waitFor(() => screen.getByTitle('Configure'))
      fireEvent.click(screen.getByTitle('Configure'))
      await waitFor(() => screen.getByText('Do Thing'))
    }

    beforeEach(() => {
      ;(window.electronAPI as unknown as Record<string, unknown>).extensionBridge = {
        invoke: vi.fn().mockResolvedValue({ data: { ok: true } }),
      }
    })

    it('renders action button with label and description', async () => {
      setupExtWithAction()
      await openSettings()
      expect(screen.getByText('Do Thing')).toBeTruthy()
      expect(screen.getByText('Does the thing')).toBeTruthy()
    })

    it('shows success toast when action resolves without error', async () => {
      setupExtWithAction()
      await openSettings()
      fireEvent.click(screen.getByText('Do Thing'))
      await waitFor(() =>
        expect(mockAddToast).toHaveBeenCalledWith({ type: 'success', message: 'Do Thing: done' })
      )
    })

    it('shows error toast when result contains { error }', async () => {
      const extAPI = setupExtWithAction()
      extAPI.extensionBridge.invoke.mockResolvedValue({ error: 'DB locked' })
      await openSettings()
      fireEvent.click(screen.getByText('Do Thing'))
      await waitFor(() =>
        expect(mockAddToast).toHaveBeenCalledWith({
          type: 'error',
          message: 'Do Thing: DB locked',
        })
      )
    })

    it('shows error toast when invoke rejects', async () => {
      const extAPI = setupExtWithAction()
      extAPI.extensionBridge.invoke.mockRejectedValue(new Error('IPC failed'))
      await openSettings()
      fireEvent.click(screen.getByText('Do Thing'))
      await waitFor(() =>
        expect(mockAddToast).toHaveBeenCalledWith({
          type: 'error',
          message: 'Do Thing: IPC failed',
        })
      )
    })

    it('danger button has danger CSS class', async () => {
      setupExtWithAction({ danger: true })
      await openSettings()
      const btn = screen.getByText('Do Thing')
      expect(btn.className).toContain('ext-btn--danger')
    })

    it('cancels action when confirm dialog is rejected', async () => {
      const extAPI = setupExtWithAction({
        confirmMessage: 'Are you sure?',
        danger: true,
      })
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      await openSettings()
      fireEvent.click(screen.getByText('Do Thing'))
      await new Promise((r) => setTimeout(r, 50))
      expect(extAPI.extensionBridge.invoke).not.toHaveBeenCalled()
      vi.restoreAllMocks()
    })

    it('proceeds when confirm dialog is accepted', async () => {
      const extAPI = setupExtWithAction({
        confirmMessage: 'Are you sure?',
        danger: true,
      })
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      await openSettings()
      fireEvent.click(screen.getByText('Do Thing'))
      await waitFor(() => expect(extAPI.extensionBridge.invoke).toHaveBeenCalled())
      vi.restoreAllMocks()
    })
  })
})
