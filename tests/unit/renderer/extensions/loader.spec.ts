import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ComponentType } from 'react'
import type { Extension } from '../../../../src/shared/types/index.js'

const mockList = vi.fn()
const mockRegisterGlobalTab = vi.fn()
const mockRegisterWorkspaceTab = vi.fn()
const mockRegisterProjectTab = vi.fn()
const mockRegisterSidebarPanel = vi.fn()
const mockRegisterWindowView = vi.fn()
const mockRegisterKeyboardShortcut = vi.fn()
const mockTogglePanel = vi.fn()

const mockRegistry = {
  registerGlobalTab: mockRegisterGlobalTab,
  registerWorkspaceTab: mockRegisterWorkspaceTab,
  registerProjectTab: mockRegisterProjectTab,
  registerSidebarPanel: mockRegisterSidebarPanel,
  registerWindowView: mockRegisterWindowView,
  registerKeyboardShortcut: mockRegisterKeyboardShortcut,
  togglePanel: mockTogglePanel,
}

vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: {
    getState: () => mockRegistry,
  },
}))

vi.mock('../../../../src/renderer/components/ExtensionPanelPortal', () => ({
  ExtensionPanelPortal: () => null,
}))

vi.mock('../../../../src/renderer/extensions/icon-from-name', () => ({
  iconFromName: (name: string) => name,
}))

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).window = {
    electronAPI: { extension: { list: mockList } },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).window
})

function makeExt(overrides: Partial<Extension> = {}): Extension {
  return {
    id: 'com.test.ext',
    name: 'Test',
    version: '1.0.0',
    description: 'desc',
    entryPoint: '/tmp/ext/main.cjs',
    status: 'enabled',
    installedAt: new Date().toISOString(),
    ...overrides,
  }
}

async function callInit(extensions: Partial<Extension>[]): Promise<void> {
  mockList.mockResolvedValue({ extensions: extensions.map((e) => makeExt(e)) })
  const { initExtensions } = await import('../../../../src/renderer/extensions/loader.js')
  return initExtensions()
}

describe('initExtensions — manifest-driven (contributes) registration', () => {
  it('calls list to get active extensions', async () => {
    await callInit([])
    expect(mockList).toHaveBeenCalledTimes(1)
  })

  it('registers globalTab via registerGlobalTab when contributes.globalTab is set', async () => {
    await callInit([
      {
        id: 'com.test.ext',
        contributes: { globalTab: { label: 'My Tool', icon: 'wrench', view: 'main' } },
      },
    ])
    expect(mockRegisterGlobalTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'com.test.ext', label: 'My Tool' })
    )
  })

  it('registers workspaceTab via registerWorkspaceTab when contributes.workspaceTab is set', async () => {
    await callInit([
      {
        id: 'com.test.ext',
        contributes: { workspaceTab: { label: 'WS Tab', view: 'workspace' } },
      },
    ])
    expect(mockRegisterWorkspaceTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'com.test.ext', label: 'WS Tab' })
    )
  })

  it('registers projectTab via registerProjectTab when contributes.projectTab is set', async () => {
    await callInit([
      {
        id: 'com.test.ext',
        contributes: { projectTab: { label: 'Proj Tab', view: 'project' } },
      },
    ])
    expect(mockRegisterProjectTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'com.test.ext', label: 'Proj Tab' })
    )
  })

  it('registers sidebarPanel via registerSidebarPanel when contributes.sidebarPanel is set', async () => {
    await callInit([
      {
        id: 'com.test.ext',
        contributes: { sidebarPanel: { label: 'Sidebar', defaultOpen: false, view: 'sidebar' } },
      },
    ])
    expect(mockRegisterSidebarPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'com.test.ext', label: 'Sidebar', defaultOpen: false })
    )
  })

  it('registers each windowView via registerWindowView', async () => {
    await callInit([
      {
        id: 'com.test.ext',
        contributes: {
          windowViews: [
            { id: 'view-a', view: 'detail' },
            { id: 'view-b', view: 'preview' },
          ],
        },
      },
    ])
    expect(mockRegisterWindowView).toHaveBeenCalledTimes(2)
    expect(mockRegisterWindowView).toHaveBeenCalledWith('view-a', expect.any(Function))
    expect(mockRegisterWindowView).toHaveBeenCalledWith('view-b', expect.any(Function))
  })

  it('does not call any registry method when extension has no contributes', async () => {
    await callInit([{ id: 'com.test.ext' }])
    expect(mockRegisterGlobalTab).not.toHaveBeenCalled()
    expect(mockRegisterWorkspaceTab).not.toHaveBeenCalled()
    expect(mockRegisterProjectTab).not.toHaveBeenCalled()
    expect(mockRegisterSidebarPanel).not.toHaveBeenCalled()
    expect(mockRegisterWindowView).not.toHaveBeenCalled()
  })

  it('skips disabled extensions', async () => {
    await callInit([
      { id: 'com.test.ext', status: 'disabled', contributes: { globalTab: { label: 'X' } } },
    ])
    expect(mockRegisterGlobalTab).not.toHaveBeenCalled()
  })
})

describe('registerWebviewExtension — default view params', () => {
  it('uses "main" as default view for globalTab when view is not set', async () => {
    const { registerWebviewExtension } = await import(
      '../../../../src/renderer/extensions/loader.js'
    )
    registerWebviewExtension(
      makeExt({ contributes: { globalTab: { label: 'X' } } }),
      mockRegistry as never
    )
    expect(mockRegisterGlobalTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'com.test.ext' })
    )
  })

  it('passes undefined icon when globalTab.icon is not set', async () => {
    const { registerWebviewExtension } = await import(
      '../../../../src/renderer/extensions/loader.js'
    )
    registerWebviewExtension(
      makeExt({ contributes: { globalTab: { label: 'X' } } }),
      mockRegistry as never
    )
    expect(mockRegisterGlobalTab).toHaveBeenCalledWith(expect.objectContaining({ icon: undefined }))
  })

  it('uses "workspace" as default view for workspaceTab when view is not set', async () => {
    const { registerWebviewExtension } = await import(
      '../../../../src/renderer/extensions/loader.js'
    )
    registerWebviewExtension(
      makeExt({ contributes: { workspaceTab: { label: 'WS' } } }),
      mockRegistry as never
    )
    expect(mockRegisterWorkspaceTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'com.test.ext' })
    )
  })

  it('passes undefined icon when workspaceTab.icon is not set', async () => {
    const { registerWebviewExtension } = await import(
      '../../../../src/renderer/extensions/loader.js'
    )
    registerWebviewExtension(
      makeExt({ contributes: { workspaceTab: { label: 'WS' } } }),
      mockRegistry as never
    )
    expect(mockRegisterWorkspaceTab).toHaveBeenCalledWith(
      expect.objectContaining({ icon: undefined })
    )
  })

  it('uses "project" as default view for projectTab when view is not set', async () => {
    const { registerWebviewExtension } = await import(
      '../../../../src/renderer/extensions/loader.js'
    )
    registerWebviewExtension(
      makeExt({ contributes: { projectTab: { label: 'Proj' } } }),
      mockRegistry as never
    )
    expect(mockRegisterProjectTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'com.test.ext' })
    )
  })

  it('uses "sidebar" as default view for sidebarPanel when view is not set', async () => {
    const { registerWebviewExtension } = await import(
      '../../../../src/renderer/extensions/loader.js'
    )
    registerWebviewExtension(
      makeExt({ contributes: { sidebarPanel: { label: 'Panel' } } }),
      mockRegistry as never
    )
    expect(mockRegisterSidebarPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'com.test.ext' })
    )
  })
})

describe('registerWebviewExtension — commands / keyboard shortcuts', () => {
  it('registers a keyboard shortcut when contributes.commands has a shortcut and a sidebarPanel', async () => {
    const { registerWebviewExtension } = await import(
      '../../../../src/renderer/extensions/loader.js'
    )
    registerWebviewExtension(
      makeExt({
        id: 'com.test.ext',
        contributes: {
          sidebarPanel: { label: 'Panel', view: 'sidebar' },
          commands: [{ id: 'ext:toggle', label: 'Toggle', shortcut: 'CmdOrCtrl+Shift+G' }],
        },
      }),
      mockRegistry as never
    )
    expect(mockRegisterKeyboardShortcut).toHaveBeenCalledWith(
      expect.objectContaining({ accelerator: 'CmdOrCtrl+Shift+G' })
    )
  })

  it('does not register a keyboard shortcut when the command has no shortcut', async () => {
    const { registerWebviewExtension } = await import(
      '../../../../src/renderer/extensions/loader.js'
    )
    registerWebviewExtension(
      makeExt({
        contributes: {
          sidebarPanel: { label: 'Panel' },
          commands: [{ id: 'ext:action', label: 'Action' }],
        },
      }),
      mockRegistry as never
    )
    expect(mockRegisterKeyboardShortcut).not.toHaveBeenCalled()
  })

  it('does not register a keyboard shortcut when there is no sidebarPanel', async () => {
    const { registerWebviewExtension } = await import(
      '../../../../src/renderer/extensions/loader.js'
    )
    registerWebviewExtension(
      makeExt({
        contributes: {
          globalTab: { label: 'Tab' },
          commands: [{ id: 'ext:action', label: 'Action', shortcut: 'CmdOrCtrl+X' }],
        },
      }),
      mockRegistry as never
    )
    expect(mockRegisterKeyboardShortcut).not.toHaveBeenCalled()
  })
})

describe('registerWebviewExtension — exported function', () => {
  it('is exported and callable', async () => {
    const { registerWebviewExtension } = await import(
      '../../../../src/renderer/extensions/loader.js'
    )
    expect(typeof registerWebviewExtension).toBe('function')
  })

  it('component factory produces a renderable React component', async () => {
    const { registerWebviewExtension } = await import(
      '../../../../src/renderer/extensions/loader.js'
    )
    registerWebviewExtension(
      makeExt({ id: 'com.test.ext', contributes: { globalTab: { label: 'X', view: 'main' } } }),
      mockRegistry as never
    )
    const { component } = mockRegisterGlobalTab.mock.calls[0][0] as { component: ComponentType }
    const element = (component as () => React.ReactElement)()
    expect(React.isValidElement(element)).toBe(true)
  })
})

describe('initExtensions — no __terminatorRegistry global', () => {
  it('does not set __terminatorRegistry on window', async () => {
    const fakeWindow: Record<string, unknown> = {
      electronAPI: { extension: { list: vi.fn().mockResolvedValue({ extensions: [] }) } },
    }
    ;(globalThis as unknown as { window: unknown }).window = fakeWindow
    vi.resetModules()
    await import('../../../../src/renderer/extensions/loader.js')
    expect(fakeWindow.__terminatorRegistry).toBeUndefined()
    delete (globalThis as unknown as { window?: unknown }).window
    vi.resetModules()
  })
})
