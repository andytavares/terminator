import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { SettingsPanel } from '../../../../src/renderer/components/settings/SettingsPanel'
import { extensionOf, seedStore } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'
import { pressOutside } from '../../../support/modal'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { eventually } from '../../../support/eventually'

const { mockDispatchNotification } = vi.hoisted(() => ({ mockDispatchNotification: vi.fn() }))
vi.mock('../../../../src/renderer/lib/notifications', () => ({
  dispatchNotification: mockDispatchNotification,
}))
vi.mock('../../../../src/renderer/components/settings/GlobalSettings', () => ({
  GlobalSettings: () => <div data-testid="global-settings">GlobalSettings</div>,
}))
vi.mock('../../../../src/renderer/components/settings/WorkspaceSettings', () => ({
  WorkspaceSettings: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="workspace-settings">WorkspaceSettings {workspaceId}</div>
  ),
}))

type ExtensionApi = ElectronAPI['extension']

/** The main process as the Settings panel reaches it. */
function fakeApi() {
  return {
    extension: {
      list: vi.fn<ExtensionApi['list']>(async () => ({ extensions: [] })),
      install: vi.fn<ExtensionApi['install']>(),
      toggle: vi.fn<ExtensionApi['toggle']>(),
      uninstall: vi.fn<ExtensionApi['uninstall']>(async () => ({ ok: true })),
      reload: vi.fn<ExtensionApi['reload']>(async (id) => ({ extension: extensionOf({ id }) })),
      getSettingsSchemas: vi.fn<ExtensionApi['getSettingsSchemas']>(async () => ({ schemas: [] })),
      getSettingsValues: vi.fn<ExtensionApi['getSettingsValues']>(async () => ({ values: {} })),
      updateSetting: vi.fn<ExtensionApi['updateSetting']>(async () => ({ ok: true })),
      onListChanged: vi.fn<ExtensionApi['onListChanged']>(() => () => {}),
    },
    dialog: { openDirectory: vi.fn<ElectronAPI['dialog']['openDirectory']>() },
    extensionBridge: {
      invoke: vi.fn<ElectronAPI['extensionBridge']['invoke']>(async () => ({ data: { ok: true } })),
    },
  }
}

let api: ReturnType<typeof fakeApi>

beforeEach(() => {
  vi.clearAllMocks()
  seedStore(useWorkspaceStore, { activeWorkspaceId: null })
  api = fakeApi()
  installElectronApi(api)
})

describe('SettingsPanel', () => {
  // Opened as a native modal dialog, it takes focus from the terminal: tests/e2e/settings.spec.ts.
  it('is a modal shell named Settings', () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Settings' }).tagName).toBe('DIALOG')
  })

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
})

describe('SettingsPanel — shows Workspace Settings nav when a workspace is active', () => {
  it('shows Workspace Settings nav when a workspace is active', () => {
    seedStore(useWorkspaceStore, {
      activeWorkspaceId: 'ws-1',
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    expect(screen.getByText('Workspace Settings')).toBeTruthy()
  })

  it('switches to workspace section when Workspace Settings is clicked', () => {
    seedStore(useWorkspaceStore, {
      activeWorkspaceId: 'ws-1',
    })
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
    pressOutside(screen.getByRole('dialog', { name: 'Settings' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('SettingsPanel — calls onClose on Escape key', () => {
  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    render(<SettingsPanel onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close on non-Escape key', () => {
    const onClose = vi.fn()
    render(<SettingsPanel onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

/** The hooks every "ExtensionsSection" describe registers. */
function setUpExtensionsSection(): void {
  beforeEach(() => {
    api.extension.list.mockResolvedValue({ extensions: [] })
  })
}

describe('ExtensionsSection', () => {
  setUpExtensionsSection()

  it('shows empty message when no extensions', async () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    expect(await screen.findByText('No extensions installed.')).toBeTruthy()
  })

  it('renders installed extensions list', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Extension',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    expect(await screen.findByText('Test Extension')).toBeTruthy()
    expect(screen.getByText('v1.0.0')).toBeTruthy()
    expect(screen.getByText('enabled')).toBeTruthy()
  })
})

describe('ExtensionsSection — shows a failed extension as error, with why on its status', () => {
  setUpExtensionsSection()

  it('shows a failed extension as error, with why on its status', async () => {
    const ext = extensionOf({
      id: 'com.lost',
      name: 'Lost Ext',
      version: '1.0.0',
      status: 'error',
      errorMessage: 'Extension host exited with code 134',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    const status = await screen.findByText('error')
    expect(status.getAttribute('title')).toBe('Extension host exited with code 134')
    expect(screen.getByText('Enable')).toBeTruthy()
  })
})

describe('ExtensionsSection — reads the list again when main says it changed', () => {
  setUpExtensionsSection()

  // The host can fail, or a backend come back, while this panel is open.
  it('reads the list again when main says it changed', async () => {
    const extension = api.extension
    const running = extensionOf({
      id: 'com.lost',
      name: 'Lost Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    extension.list.mockResolvedValue({ extensions: [running] })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('enabled')

    const failed = extensionOf({
      ...running,
      status: 'error',
      errorMessage: 'Extension host exited',
    })
    extension.list.mockResolvedValue({ extensions: [failed] })
    const announce = extension.onListChanged.mock.calls[0][0] as () => void
    act(() => announce())

    const status = await screen.findByText('error')
    expect(status.getAttribute('title')).toBe('Extension host exited')
  })
})

describe('ExtensionsSection — stops listening for list changes when it closes', () => {
  setUpExtensionsSection()

  it('stops listening for list changes when it closes', async () => {
    const unsubscribe = vi.fn()
    const extension = api.extension
    extension.onListChanged.mockReturnValue(unsubscribe)
    const { unmount } = render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('No extensions installed.')

    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('shows Disable button for enabled extensions', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    expect(await screen.findByText('Disable')).toBeTruthy()
  })
})

describe('ExtensionsSection — shows Enable button for disabled extensions', () => {
  setUpExtensionsSection()

  it('shows Enable button for disabled extensions', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'disabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    expect(await screen.findByText('Enable')).toBeTruthy()
  })

  it('shows Install from Directory button', async () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    expect(await screen.findByText('Install from Directory')).toBeTruthy()
  })

  it('calls openDirectory when install button is clicked', async () => {
    api.dialog.openDirectory.mockResolvedValue({ cancelled: true })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Install from Directory')
    fireEvent.click(screen.getByText('Install from Directory'))
    await waitFor(() => expect(api.dialog.openDirectory).toHaveBeenCalled())
  })
})

describe('ExtensionsSection — installs extension and shows it in list', () => {
  setUpExtensionsSection()

  it('installs extension and shows it in list', async () => {
    const newExt = extensionOf({
      id: 'com.new',
      name: 'New Ext',
      version: '2.0.0',
      status: 'enabled',
    })
    api.dialog.openDirectory.mockResolvedValue({
      filePath: '/path/to/ext',
    })
    api.extension.install.mockResolvedValue({ extension: newExt })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Install from Directory')
    fireEvent.click(screen.getByText('Install from Directory'))
    expect(await screen.findByText('New Ext')).toBeTruthy()
  })
})

describe('ExtensionsSection — lists an installed extension once when the list was re-read first', () => {
  setUpExtensionsSection()

  // Main announces the changed list while the install is answering, so the
  // re-read can already hold the new extension: it must be listed once.
  it('lists an installed extension once when the list was re-read first', async () => {
    const newExt = extensionOf({ id: 'com.new', name: 'New Ext', version: '2.0.0' })
    api.dialog.openDirectory.mockResolvedValue({ filePath: '/path/to/ext' })
    api.extension.install.mockImplementation(async () => {
      api.extension.list.mockResolvedValue({ extensions: [newExt] })
      const readsBefore = api.extension.list.mock.calls.length
      const announce = api.extension.onListChanged.mock.calls[0][0] as () => void
      announce()
      await waitFor(() => expect(api.extension.list.mock.calls.length).toBeGreaterThan(readsBefore))
      return { extension: newExt }
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    fireEvent.click(await screen.findByText('Install from Directory'))
    await waitFor(() => expect(mockDispatchNotification).toHaveBeenCalled())
    expect(screen.getAllByText('New Ext')).toHaveLength(1)
  })
})

describe('ExtensionsSection — shows toast on install error', () => {
  setUpExtensionsSection()

  it('shows toast on install error', async () => {
    api.dialog.openDirectory.mockResolvedValue({ filePath: '/path' })
    api.extension.install.mockResolvedValue({
      error: 'INVALID_MANIFEST',
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Install from Directory')
    fireEvent.click(screen.getByText('Install from Directory'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' })
      )
    )
  })
})

describe('ExtensionsSection — toggles extension enable/disable', () => {
  setUpExtensionsSection()

  it('toggles extension enable/disable', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    api.extension.toggle.mockResolvedValue({
      extension: { ...ext, status: 'disabled' },
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Disable')
    fireEvent.click(screen.getByText('Disable'))
    await waitFor(() => expect(api.extension.toggle).toHaveBeenCalledWith('com.test', false))
  })
})

describe('ExtensionsSection — reloads extension and shows toast', () => {
  setUpExtensionsSection()

  it('reloads extension and shows toast', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    api.extension.reload.mockResolvedValue({ extension: { ...ext, version: '1.0.1' } })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Reload')
    fireEvent.click(screen.getByText('Reload'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info' })
      )
    )
  })
})

describe('ExtensionsSection — shows toast when reload fails', () => {
  setUpExtensionsSection()

  it('shows toast when reload fails', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    api.extension.reload.mockResolvedValue({ error: 'RELOAD_FAILED' })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Reload')
    fireEvent.click(screen.getByText('Reload'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' })
      )
    )
  })
})

describe('ExtensionsSection — uninstalls extension when confirm is accepted', () => {
  setUpExtensionsSection()

  it('uninstalls extension when confirm is accepted', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Uninstall')
    fireEvent.click(screen.getByText('Uninstall'))
    await waitFor(() => expect(api.extension.uninstall).toHaveBeenCalledWith('com.test'))
    vi.unstubAllGlobals()
  })
})

describe('ExtensionsSection — does not uninstall when confirm is declined', () => {
  setUpExtensionsSection()

  it('does not uninstall when confirm is declined', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    const declined = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', declined)
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Uninstall')
    fireEvent.click(screen.getByText('Uninstall'))
    // The handler asks before its first await, so the refusal has already been acted on.
    expect(declined).toHaveBeenCalledTimes(1)
    expect(api.extension.uninstall).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('ExtensionsSection — upgrades extension via Browse + install', () => {
  setUpExtensionsSection()

  it('upgrades extension via Browse + install', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    const upgraded = { ...ext, version: '2.0.0' }
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    api.dialog.openDirectory.mockResolvedValue({ filePath: '/path/to/upgrade' })
    api.extension.uninstall.mockResolvedValue({ ok: true })
    api.extension.install.mockResolvedValue({ extension: upgraded })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Upgrade')
    fireEvent.click(screen.getByText('Upgrade'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info' })
      )
    )
  })
})

describe('ExtensionsSection — shows error toast when upgrade install step fails', () => {
  setUpExtensionsSection()

  it('shows error toast when upgrade install step fails', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    api.dialog.openDirectory.mockResolvedValue({ filePath: '/path/to/upgrade' })
    api.extension.uninstall.mockResolvedValue({ ok: true })
    api.extension.install.mockResolvedValue({ error: 'INVALID_MANIFEST' })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Upgrade')
    fireEvent.click(screen.getByText('Upgrade'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' })
      )
    )
  })
})

describe('ExtensionsSection — shows error toast when upgrade uninstall step fails', () => {
  setUpExtensionsSection()

  it('shows error toast when upgrade uninstall step fails', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    api.dialog.openDirectory.mockResolvedValue({ filePath: '/path/to/upgrade' })
    api.extension.uninstall.mockResolvedValue({ error: 'UNINSTALL_FAILED' })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Upgrade')
    fireEvent.click(screen.getByText('Upgrade'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' })
      )
    )
  })
})

describe('ExtensionsSection — skips upgrade when directory dialog is cancelled', () => {
  setUpExtensionsSection()

  it('skips upgrade when directory dialog is cancelled', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    api.dialog.openDirectory.mockResolvedValue({ cancelled: true })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Upgrade')
    fireEvent.click(screen.getByText('Upgrade'))
    await waitFor(() => expect(api.dialog.openDirectory).toHaveBeenCalledTimes(1))
    await act(async () => {
      await api.dialog.openDirectory.mock.results[0].value
    })
    expect(api.extension.uninstall).not.toHaveBeenCalled()
  })
})

describe('ExtensionsSection — renders ExtensionSettingRow for extension with schema', () => {
  setUpExtensionsSection()

  it('renders ExtensionSettingRow for extension with schema', async () => {
    await openSettingsOf({
      'com.test.myKey': {
        type: 'string',
        label: 'My Setting',
        description: 'A test setting',
        default: 'hello',
      },
    })
    expect(await screen.findByText('My Setting')).toBeTruthy()
  })
})

describe('ExtensionsSection — ExtensionSettingRow calls updateSetting after debounce', () => {
  setUpExtensionsSection()

  it('ExtensionSettingRow calls updateSetting after debounce', async () => {
    await openSettingsOf({
      'com.test.myKey': {
        type: 'string',
        label: 'My Setting',
        default: 'hello',
      },
    })
    await screen.findByDisplayValue('hello')
    fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: 'world' } })
    // Wait for debounce timer (400ms) to fire
    await eventually(() =>
      expect(api.extension.updateSetting).toHaveBeenCalledWith('com.test.myKey', 'world')
    )
  })
})

describe('ExtensionsSection — ExtensionSettingRow renders boolean select', () => {
  setUpExtensionsSection()

  it('ExtensionSettingRow renders boolean select', async () => {
    await openSettingsOf({
      'com.test.toggle': {
        type: 'boolean',
        label: 'Enable Feature',
        default: true,
      },
    })
    expect(await screen.findByText('Enable Feature')).toBeTruthy()
    // The boolean setting renders as a toggle switch (role="switch")
    expect(screen.getByRole('switch', { name: 'Enable Feature' })).toBeTruthy()
  })
})

describe('ExtensionsSection — groups per-notification-kind boolean settings into a 4-column table instead of individual switches', () => {
  setUpExtensionsSection()

  it('groups per-notification-kind boolean settings into a 4-column table instead of individual switches', async () => {
    const booleanSetting = (label: string) => ({ type: 'boolean', label, default: true })
    await openSettingsOf({
      'com.test.notify.taskCompleted.system': booleanSetting(
        'Task completed → System notification'
      ),
      'com.test.notify.taskCompleted.center': booleanSetting(
        'Task completed → In-app notification center'
      ),
      'com.test.notify.taskCompleted.toast': booleanSetting('Task completed → Toast'),
    })

    // One row for the notification kind, not three separate switch rows
    expect(await screen.findByText('Task completed')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    fireEvent.click(checkboxes[0])
    await waitFor(() =>
      expect(api.extension.updateSetting).toHaveBeenCalledWith(
        'com.test.notify.taskCompleted.system',
        false
      )
    )
  })
})

describe('ExtensionsSection — ExtensionSettingRow renders enum select', () => {
  setUpExtensionsSection()

  it('ExtensionSettingRow renders enum select', async () => {
    await openSettingsOf({
      'com.test.mode': {
        type: 'enum',
        label: 'Mode',
        options: ['fast', 'slow', 'auto'],
        default: 'auto',
      },
    })
    expect(await screen.findByText('Mode')).toBeTruthy()
    // Enum options are capitalized in the segmented control
    expect(screen.getByText('Fast')).toBeTruthy()
    expect(screen.getByText('Slow')).toBeTruthy()
    expect(screen.getByText('Auto')).toBeTruthy()
  })
})

describe('ExtensionsSection — toggleSettingsExpand collapses panel when clicked again', () => {
  setUpExtensionsSection()

  it('toggleSettingsExpand collapses panel when clicked again', async () => {
    await openSettingsOf({ 'com.test.key': { type: 'string', label: 'Key', default: 'val' } })
    expect(await screen.findByText('Key')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Configure'))
    await waitFor(() => expect(screen.queryByText('Key')).toBeNull())
  })
})

describe('ExtensionsSection — switches to global section when Appearance & Terminal is clicked', () => {
  setUpExtensionsSection()

  it('switches to global section when Appearance & Terminal is clicked', () => {
    seedStore(useWorkspaceStore, {
      activeWorkspaceId: 'ws-1',
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    fireEvent.click(screen.getByText('Appearance & Terminal'))
    expect(screen.getByTestId('global-settings')).toBeTruthy()
  })
})

/** The hooks every "ExtensionsSection — ActionSettingRow" describe registers. */
function setUpExtensionsSectionActionSettingRow(): void {
  setUpExtensionsSection()

  beforeEach(() => {
    api.extensionBridge.invoke.mockResolvedValue({ data: { ok: true } })
  })
}

describe('ExtensionsSection — ActionSettingRow', () => {
  setUpExtensionsSectionActionSettingRow()

  it('renders action button with label and description', async () => {
    await openActionSettings()
    expect(screen.getByText('Do Thing')).toBeTruthy()
    expect(screen.getByText('Does the thing')).toBeTruthy()
  })

  it('shows success toast when action resolves without error', async () => {
    await openActionSettings()
    fireEvent.click(screen.getByText('Do Thing'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith({
        type: 'success',
        title: 'Do Thing',
        message: 'Done',
        key: 'extensionSettingAction',
      })
    )
  })
})

describe('ExtensionsSection — ActionSettingRow — shows error toast when result contains { error }', () => {
  setUpExtensionsSectionActionSettingRow()

  it('shows error toast when result contains { error }', async () => {
    api.extensionBridge.invoke.mockResolvedValue({ error: 'DB locked' })
    await openActionSettings()
    fireEvent.click(screen.getByText('Do Thing'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith({
        type: 'error',
        title: 'Do Thing',
        message: 'DB locked',
        key: 'extensionSettingAction',
      })
    )
  })

  it('shows error toast when invoke rejects', async () => {
    api.extensionBridge.invoke.mockRejectedValue(new Error('IPC failed'))
    await openActionSettings()
    fireEvent.click(screen.getByText('Do Thing'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith({
        type: 'error',
        title: 'Do Thing',
        message: 'IPC failed',
        key: 'extensionSettingAction',
      })
    )
  })
})

describe('ExtensionsSection — ActionSettingRow — danger button has danger CSS class', () => {
  setUpExtensionsSectionActionSettingRow()

  it('danger button has danger CSS class', async () => {
    await openActionSettings({ danger: true })
    const btn = screen.getByText('Do Thing')
    expect(btn.className).toContain('ext-btn--danger')
  })

  it('shows warning toast when repair result has non-ok integrity', async () => {
    api.extensionBridge.invoke.mockResolvedValue({ data: { integrity: 'corruption found' } })
    await openActionSettings()
    fireEvent.click(screen.getByText('Do Thing'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith({
        type: 'warning',
        title: 'Do Thing',
        message: 'Integrity issues — corruption found',
        key: 'extensionSettingAction',
      })
    )
  })
})

describe('ExtensionsSection — ActionSettingRow — shows success toast when repair result integrity is ok', () => {
  setUpExtensionsSectionActionSettingRow()

  it('shows success toast when repair result integrity is ok', async () => {
    api.extensionBridge.invoke.mockResolvedValue({ data: { integrity: 'ok' } })
    await openActionSettings()
    fireEvent.click(screen.getByText('Do Thing'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith({
        type: 'success',
        title: 'Do Thing',
        message: 'Done',
        key: 'extensionSettingAction',
      })
    )
  })

  it('cancels action when confirm dialog is rejected', async () => {
    const declined = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await openActionSettings({
      confirmMessage: 'Are you sure?',
      danger: true,
    })
    fireEvent.click(screen.getByText('Do Thing'))
    // The handler asks before its first await, so the refusal has already been acted on.
    expect(declined).toHaveBeenCalledWith('Are you sure?')
    expect(api.extensionBridge.invoke).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe('ExtensionsSection — ActionSettingRow — proceeds when confirm dialog is accepted', () => {
  setUpExtensionsSectionActionSettingRow()

  it('proceeds when confirm dialog is accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await openActionSettings({
      confirmMessage: 'Are you sure?',
      danger: true,
    })
    fireEvent.click(screen.getByText('Do Thing'))
    await waitFor(() => expect(api.extensionBridge.invoke).toHaveBeenCalled())
    vi.restoreAllMocks()
  })
})

describe('ExtensionsSection — shows schema description when present', () => {
  setUpExtensionsSection()

  it('shows schema description when present', async () => {
    await openSettingsOf(
      {
        'com.test.key': { type: 'string', label: 'Key', default: 'val' },
      },
      {},
      'This extension does stuff'
    )
    expect(await screen.findByText('This extension does stuff')).toBeTruthy()
  })
})

describe('ExtensionsSection — renders folder-type setting with Choose button and updates value when folder picked', () => {
  setUpExtensionsSection()

  it('renders folder-type setting with Choose button and updates value when folder picked', async () => {
    api.dialog.openDirectory.mockResolvedValue({ filePath: '/my/path' })
    await openSettingsOf({
      'com.test.folder': { type: 'folder', label: 'Export Path', default: '' },
    })
    await screen.findByText('Choose…')
    fireEvent.click(screen.getByText('Choose…'))
    // Wait for the debounce timer (400ms) to fire so saveTimer is cleared before unmount
    await eventually(() =>
      expect(api.extension.updateSetting).toHaveBeenCalledWith('com.test.folder', '/my/path')
    )
  })
})

describe('ExtensionsSection — renders number-type setting as number input', () => {
  setUpExtensionsSection()

  it('renders number-type setting as number input', async () => {
    await openSettingsOf({
      'com.test.num': { type: 'number', label: 'Count', default: 5, min: 1, max: 100 },
    })
    await screen.findByText('Count')
    const input = screen.getByDisplayValue('5') as HTMLInputElement
    expect(input.type).toBe('number')
  })
})

describe('ExtensionsSection — toggle with error response calls toggle API', () => {
  setUpExtensionsSection()

  it('toggle with error response calls toggle API', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    api.extension.toggle.mockResolvedValue({ error: 'TOGGLE_FAILED' })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Disable')
    fireEvent.click(screen.getByText('Disable'))
    await waitFor(() => expect(api.extension.toggle).toHaveBeenCalledWith('com.test', false))
  })
})

describe('ExtensionsSection — uninstall with error response shows error toast', () => {
  setUpExtensionsSection()

  it('uninstall with error response shows error toast', async () => {
    const ext = extensionOf({
      id: 'com.test',
      name: 'Test Ext',
      version: '1.0.0',
      status: 'enabled',
    })
    api.extension.list.mockResolvedValue({ extensions: [ext] })
    api.extension.uninstall.mockResolvedValue({ error: 'PERM_DENIED' })
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Uninstall')
    fireEvent.click(screen.getByText('Uninstall'))
    await waitFor(() =>
      expect(mockDispatchNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' })
      )
    )
    vi.unstubAllGlobals()
  })
})

describe('ExtensionsSection — folder-type setting shows Not set placeholder when value is empty', () => {
  setUpExtensionsSection()

  it('folder-type setting shows Not set placeholder when value is empty', async () => {
    api.extension.getSettingsValues.mockResolvedValue({ values: { 'com.test.folder': '' } })
    await openSettingsOf({
      'com.test.folder': { type: 'folder', label: 'Export Path', default: '' },
    })
    expect(await screen.findByText('Not set')).toBeTruthy()
  })
})

type SettingDefs = Awaited<
  ReturnType<ExtensionApi['getSettingsSchemas']>
>['schemas'][number]['properties']

/** Opens Extensions with one extension whose settings are `properties`, and expands them. */
async function openSettingsOf(
  properties: SettingDefs,
  values: Record<string, unknown> = {},
  description?: string
) {
  api.extension.list.mockResolvedValue({
    extensions: [extensionOf({ id: 'com.test', name: 'Test Ext', status: 'enabled' })],
  })
  api.extension.getSettingsSchemas.mockResolvedValue({
    schemas: [{ extensionId: 'com.test', label: 'Test Extension', description, properties }],
  })
  api.extension.getSettingsValues.mockResolvedValue({ values })
  const view = render(<SettingsPanel onClose={vi.fn()} />)
  fireEvent.click(screen.getByText('Extensions'))
  fireEvent.click(await screen.findByTitle('Configure'))
  return view
}

const savedSetting = (key: string, value: unknown) =>
  eventually(() => expect(api.extension.updateSetting).toHaveBeenCalledWith(key, value))

describe('ExtensionsSection — editing each kind of setting', () => {
  setUpExtensionsSection()

  it('saves a switched boolean as a boolean', async () => {
    await openSettingsOf({ 'com.test.on': { type: 'boolean', label: 'On', default: true } })
    fireEvent.click(screen.getByRole('switch', { name: 'On' }))
    await savedSetting('com.test.on', false)
  })

  it('saves the option picked from an enum', async () => {
    await openSettingsOf({
      'com.test.mode': { type: 'enum', label: 'Mode', default: 'fast', options: ['fast', 'safe'] },
    })
    fireEvent.click(screen.getByText('Safe'))
    await savedSetting('com.test.mode', 'safe')
  })

  it('masks a secret setting', async () => {
    await openSettingsOf({
      'com.test.token': { type: 'string', label: 'Token', default: 'abc', secret: true },
    })
    expect(screen.getByDisplayValue('abc').getAttribute('type')).toBe('password')
  })

  it('saves a number as a number, and only the last of quick edits', async () => {
    await openSettingsOf({ 'com.test.n': { type: 'number', label: 'N', default: 1 } })
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } })
    fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '3' } })
    await savedSetting('com.test.n', 3)
    expect(api.extension.updateSetting).toHaveBeenCalledTimes(1)
  })
})

describe('ExtensionsSection — a list setting', () => {
  setUpExtensionsSection()

  const LIST = { 'com.test.paths': { type: 'list', label: 'Paths', default: [] } }

  it('is edited in a multi-line box, one item per line', async () => {
    await openSettingsOf(LIST, { 'com.test.paths': ['src/auth/**', 'migrations/**'] })
    const box = screen.getByRole('textbox', { name: 'Paths' }) as HTMLTextAreaElement
    expect(box.tagName).toBe('TEXTAREA')
    expect(box.value).toBe('src/auth/**\nmigrations/**')
  })

  it('is saved as a list of the lines typed, blank ones dropped', async () => {
    await openSettingsOf(LIST)
    fireEvent.change(screen.getByRole('textbox', { name: 'Paths' }), {
      target: { value: 'src/auth/**\n\n  docs/** ' },
    })
    await savedSetting('com.test.paths', ['src/auth/**', 'docs/**'])
  })
})

describe('ExtensionsSection — settings at the edges', () => {
  setUpExtensionsSection()

  it('saves an edit still waiting when the panel closes', async () => {
    const view = await openSettingsOf({
      'com.test.on': { type: 'boolean', label: 'On', default: false },
    })
    fireEvent.click(screen.getByRole('switch', { name: 'On' }))
    view.unmount()
    expect(api.extension.updateSetting).toHaveBeenCalledWith('com.test.on', true)
  })

  it('shows an empty field for a setting with no value and no default', async () => {
    await openSettingsOf({ 'com.test.s': { type: 'string', label: 'S', default: undefined } })
    expect(screen.getByRole('textbox')).toHaveProperty('value', '')
  })

  it('keeps a folder when the picker is cancelled', async () => {
    api.dialog.openDirectory.mockResolvedValue({ cancelled: true })
    await openSettingsOf(
      { 'com.test.dir': { type: 'folder', label: 'Dir', default: '/a' } },
      {
        'com.test.dir': '/a',
      }
    )
    fireEvent.click(screen.getByText('Choose…'))
    await waitFor(() => expect(api.dialog.openDirectory).toHaveBeenCalled())
    expect(screen.getByText('/a')).toBeTruthy()
    expect(api.extension.updateSetting).not.toHaveBeenCalled()
  })
})

describe('ExtensionsSection — partial answers from main', () => {
  setUpExtensionsSection()

  it('still lists the extensions when their settings cannot be read', async () => {
    api.extension.list.mockResolvedValue({
      extensions: [extensionOf({ id: 'com.test', name: 'Test Ext' })],
    })
    api.extension.getSettingsSchemas.mockRejectedValue(new Error('no'))
    api.extension.getSettingsValues.mockRejectedValue(new Error('no'))
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    expect(await screen.findByText('Test Ext')).toBeTruthy()
    expect(screen.queryByTitle('Configure')).toBeNull()
  })
})

describe('ExtensionsSection — partial answers from main — replaces only the extension reloaded or upgraded', () => {
  setUpExtensionsSection()

  it('replaces only the extension reloaded or upgraded', async () => {
    api.extension.list.mockResolvedValue({
      extensions: [
        extensionOf({ id: 'a', name: 'Alpha', version: '1.0.0' }),
        extensionOf({ id: 'b', name: 'Beta', version: '1.0.0' }),
      ],
    })
    api.extension.reload.mockResolvedValue({
      extension: extensionOf({ id: 'a', name: 'Alpha', version: '1.1.0' }),
    })
    api.dialog.openDirectory.mockResolvedValue({ filePath: '/new' })
    api.extension.install.mockResolvedValue({
      extension: extensionOf({ id: 'b', name: 'Beta', version: '2.0.0' }),
    })
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Extensions'))
    await screen.findByText('Alpha')
    fireEvent.click(screen.getAllByText('Reload')[0])
    await screen.findByText('v1.1.0')
    fireEvent.click(screen.getAllByText('Upgrade')[1])
    await screen.findByText('v2.0.0')
    expect(screen.getAllByText(/^v/).map((el) => el.textContent)).toEqual(['v1.1.0', 'v2.0.0'])
  })
})

describe('SettingsPanel — the Integrations section', () => {
  it('opens Integrations from its nav item', () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Integrations'))
    expect(screen.getByText('Integrations', { selector: 'h3' })).toBeTruthy()
  })
})

/** Opens the settings of an extension whose one setting is the "Do Thing" action. */
async function openActionSettings(opts: { danger?: boolean; confirmMessage?: string } = {}) {
  await openSettingsOf({
    'com.test.action': {
      type: 'action',
      label: 'Do Thing',
      description: 'Does the thing',
      channel: 'com.test:do-thing',
      default: null,
      ...opts,
    },
  })
  await screen.findByText('Do Thing')
}
