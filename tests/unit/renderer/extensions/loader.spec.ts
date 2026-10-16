// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Extension } from '../../../../src/shared/types/index.js'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import {
  initExtensions,
  registerWebviewExtension,
} from '../../../../src/renderer/extensions/loader'
import { resetStore } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'
import { registryState } from '../../../support/store-state'

// The real portal mounts a WebContentsView through IPC. This one shows what it
// was asked to host.
vi.mock('../../../../src/renderer/components/ExtensionPanelPortal', () => ({
  ExtensionPanelPortal: ({ extensionId, viewParam }: { extensionId: string; viewParam: string }) =>
    React.createElement('div', { 'data-testid': 'portal' }, `${extensionId}:${viewParam}`),
}))

beforeEach(() => {
  resetStore(useExtensionRegistry)
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

/** Starts the loader with `extensions` as the main process lists them. */
async function callInit(extensions: Partial<Extension>[]): Promise<void> {
  installElectronApi({
    extension: { list: async () => ({ extensions: extensions.map((e) => makeExt(e)) }) },
  })
  return initExtensions()
}

/** What the surface's component puts on screen: the portal for its extension and view. */
function portalOf<Props extends object>(
  component: React.ComponentType<Props>,
  props: Props
): string | null {
  render(React.createElement(component, props))
  return screen.getByTestId('portal').textContent
}

describe('initExtensions — manifest-driven (contributes) registration', () => {
  it('registers globalTab via registerGlobalTab when contributes.globalTab is set', async () => {
    await callInit([
      {
        id: 'com.test.ext',
        contributes: { globalTab: { label: 'My Tool', icon: 'wrench', view: 'main' } },
      },
    ])
    const tab = registryState().globalTabs.get('com.test.ext')
    expect(tab).toMatchObject({ label: 'My Tool', view: 'main', sortOrder: 1 })
    expect(React.isValidElement(tab?.icon)).toBe(true)
  })

  it('registers workspaceTab via registerWorkspaceTab when contributes.workspaceTab is set', async () => {
    await callInit([
      { id: 'com.test.ext', contributes: { workspaceTab: { label: 'WS Tab', view: 'workspace' } } },
    ])
    expect(registryState().workspaceTabs.get('com.test.ext')).toMatchObject({ label: 'WS Tab' })
  })

  it('registers projectTab via registerProjectTab when contributes.projectTab is set', async () => {
    await callInit([
      { id: 'com.test.ext', contributes: { projectTab: { label: 'Proj Tab', view: 'project' } } },
    ])
    expect(registryState().projectTabs.get('com.test.ext')).toMatchObject({ label: 'Proj Tab' })
  })
})

describe('initExtensions — manifest-driven (contributes) registration — registers sidebarPanel via registerSidebarPanel when contributes.sidebarPanel is set', () => {
  it('registers sidebarPanel via registerSidebarPanel when contributes.sidebarPanel is set', async () => {
    await callInit([
      {
        id: 'com.test.ext',
        contributes: { sidebarPanel: { label: 'Sidebar', defaultOpen: true, view: 'sidebar' } },
      },
    ])
    expect(registryState().sidebarPanels.get('com.test.ext')).toMatchObject({ label: 'Sidebar' })
    expect(registryState().openPanels.has('com.test.ext')).toBe(true)
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
    expect([...registryState().windowViews.keys()]).toEqual(['view-a', 'view-b'])
    expect(portalOf(registryState().windowViews.get('view-b')!, { repoRoot: null })).toBe(
      'com.test.ext:preview'
    )
  })
})

describe('initExtensions — manifest-driven (contributes) registration — does not call any registry method when extension has no contributes', () => {
  it('does not call any registry method when extension has no contributes', async () => {
    await callInit([{ id: 'com.test.ext' }])
    const { globalTabs, workspaceTabs, projectTabs, sidebarPanels, windowViews, homeSections } =
      registryState()
    for (const surfaces of [
      globalTabs,
      workspaceTabs,
      projectTabs,
      sidebarPanels,
      windowViews,
      homeSections,
    ]) {
      expect(surfaces.size).toBe(0)
    }
  })

  it('skips disabled extensions', async () => {
    await callInit([
      { id: 'com.test.ext', status: 'disabled', contributes: { globalTab: { label: 'X' } } },
    ])
    expect(registryState().globalTabs.size).toBe(0)
  })
})

describe('registerWebviewExtension — default view params', () => {
  const registerContributions = (contributes: Extension['contributes']) =>
    registerWebviewExtension(makeExt({ contributes }), registryState())

  it('hosts the "main" view in a global tab that names none, with no icon', () => {
    registerContributions({ globalTab: { label: 'X' } })
    const tab = registryState().globalTabs.get('com.test.ext')!
    expect(tab).toMatchObject({ view: 'main', icon: undefined })
    expect(portalOf(tab.component, {})).toBe('com.test.ext:main')
  })

  it('hosts the "workspace" view in a workspace tab that names none, with no icon', () => {
    registerContributions({ workspaceTab: { label: 'WS' } })
    const tab = registryState().workspaceTabs.get('com.test.ext')!
    expect(tab).toMatchObject({ view: 'workspace', icon: undefined })
    expect(portalOf(tab.component, {})).toBe('com.test.ext:workspace')
  })

  it('hosts the "project" view in a project tab that names none', () => {
    registerContributions({ projectTab: { label: 'Proj' } })
    const tab = registryState().projectTabs.get('com.test.ext')!
    expect(tab.view).toBe('project')
    expect(portalOf(tab.component, { repoRoot: null })).toBe('com.test.ext:project')
  })

  it('hosts the "sidebar" view in a sidebar panel that names none', () => {
    registerContributions({ sidebarPanel: { label: 'Panel' } })
    const panel = registryState().sidebarPanels.get('com.test.ext')!
    expect(panel.view).toBe('sidebar')
    expect(portalOf(panel.component, { repoRoot: null, onClose: () => {} })).toBe(
      'com.test.ext:sidebar'
    )
  })
})

describe('registerWebviewExtension — home section', () => {
  const registerContributions = (contributes: Extension['contributes']) =>
    registerWebviewExtension(makeExt({ contributes }), registryState())

  it('hosts the "home" view in a home section that names none', () => {
    registerContributions({ homeSection: { label: 'Pull requests' } })
    const section = registryState().homeSections.get('com.test.ext')!
    expect(section).toMatchObject({ label: 'Pull requests', view: 'home' })
    expect(portalOf(section.component, {})).toBe('com.test.ext:home')
  })
})

describe('registerWebviewExtension — commands / keyboard shortcuts', () => {
  it("binds a command's shortcut to toggling the extension's sidebar panel", () => {
    registerWebviewExtension(
      makeExt({
        contributes: {
          sidebarPanel: { label: 'Panel', view: 'sidebar' },
          commands: [{ id: 'ext:toggle', label: 'Toggle', shortcut: 'CmdOrCtrl+Shift+G' }],
        },
      }),
      registryState()
    )
    const [shortcut] = registryState().keyboardShortcuts
    expect(shortcut.accelerator).toBe('CmdOrCtrl+Shift+G')
    shortcut.action()
    expect(registryState().openPanels.has('com.test.ext')).toBe(true)
  })

  it('does not register a keyboard shortcut when the command has no shortcut', () => {
    registerWebviewExtension(
      makeExt({
        contributes: {
          sidebarPanel: { label: 'Panel' },
          commands: [{ id: 'ext:action', label: 'Action' }],
        },
      }),
      registryState()
    )
    expect(registryState().keyboardShortcuts).toEqual([])
  })
})

describe('registerWebviewExtension — commands / keyboard shortcuts — does not register a keyboard shortcut when there is no sidebarPanel', () => {
  it('does not register a keyboard shortcut when there is no sidebarPanel', () => {
    registerWebviewExtension(
      makeExt({
        contributes: {
          globalTab: { label: 'Tab' },
          commands: [{ id: 'ext:action', label: 'Action', shortcut: 'CmdOrCtrl+X' }],
        },
      }),
      registryState()
    )
    expect(registryState().keyboardShortcuts).toEqual([])
  })
})

describe('initExtensions — no __terminatorRegistry global', () => {
  it('does not set __terminatorRegistry on window', async () => {
    await callInit([{ id: 'com.test.ext', contributes: { globalTab: { label: 'X' } } }])
    expect('__terminatorRegistry' in window).toBe(false)
  })
})

describe('Quick Actions group allocation at init', () => {
  it('allocates groups from contributes.quickActions.group, in load order', async () => {
    await callInit([
      {
        id: 'git-integration',
        contributes: { quickActions: { group: { mnemonic: 'g', label: 'Git' } } },
      },
      {
        id: 'notepad',
        contributes: { quickActions: { group: { mnemonic: 'n', label: 'Notes' } } },
      },
    ])
    expect(registryState().quickActionGroups).toEqual([
      { id: 'ext:git-integration', mnemonic: 'g', label: 'Git', owner: 'git-integration' },
      { id: 'ext:notepad', mnemonic: 'n', label: 'Notes', owner: 'notepad' },
    ])
  })

  it('sets an empty list when no extension declares a quickActions group', async () => {
    resetStore(useExtensionRegistry, {
      quickActionGroups: [{ id: 'ext:gone', mnemonic: 'x', label: 'Gone', owner: 'gone' }],
    })
    await callInit([{ id: 'com.test.ext' }])
    expect(registryState().quickActionGroups).toEqual([])
  })
})

describe('Quick Actions group allocation at init — reassigns a colliding mnemonic rather than dropping the group', () => {
  it('reassigns a colliding mnemonic rather than dropping the group', async () => {
    await callInit([
      { id: 'one', contributes: { quickActions: { group: { mnemonic: 'g', label: 'One' } } } },
      { id: 'two', contributes: { quickActions: { group: { mnemonic: 'g', label: 'Two' } } } },
    ])
    const groups = registryState().quickActionGroups
    expect(groups).toHaveLength(2)
    expect(groups[1].mnemonic).not.toBe('g')
  })
})
