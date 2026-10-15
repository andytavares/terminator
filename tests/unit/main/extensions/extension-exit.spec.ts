import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import {
  routeExtensionExitRequest,
  type ExtensionExitDeps,
  type ExtensionSurface,
} from '../../../../src/main/extensions/extension-exit.js'
import type { Extension } from '../../../../src/shared/types/index.js'

function makeExt(overrides: Partial<Extension> = {}): Extension {
  return {
    id: 'com.test.ext',
    name: 'Test',
    version: '1.0.0',
    status: 'enabled',
    installedAt: '2026-01-01',
    contributes: {},
    ...overrides,
  } as Extension
}

let send: Mock<ExtensionExitDeps['send']>
let focusMainRenderer: Mock<ExtensionExitDeps['focusMainRenderer']>
let listExtensions: Mock<ExtensionExitDeps['listExtensions']>
let surface: ExtensionSurface

function route(): boolean {
  return routeExtensionExitRequest(surface, {
    listExtensions,
    focusMainRenderer,
    send,
  })
}

function useExitDeps(): void {
  beforeEach(() => {
    send = vi.fn()
    focusMainRenderer = vi.fn()
    listExtensions = vi.fn(() => [makeExt()])
    surface = { extensionId: 'com.test.ext', viewParam: 'main' }
  })
}

describe('routeExtensionExitRequest', () => {
  useExitDeps()

  it('tells the renderer to exit to the terminal', () => {
    expect(route()).toBe(true)
    expect(send).toHaveBeenCalledWith('extension:exit-to-terminal', {
      extensionId: 'com.test.ext',
      sidebarPanelId: null,
    })
  })

  it('moves keyboard focus back to the main renderer', () => {
    route()
    expect(focusMainRenderer).toHaveBeenCalled()
  })
})

describe('routeExtensionExitRequest — sidebar views', () => {
  useExitDeps()

  it('names the sidebar panel when the request came from a sidebar view', () => {
    surface = { extensionId: 'com.test.ext', viewParam: 'sidebar' }
    listExtensions.mockReturnValue([
      makeExt({ contributes: { sidebarPanel: { label: 'Git', view: 'sidebar' } } }),
    ])

    route()

    expect(send).toHaveBeenCalledWith('extension:exit-to-terminal', {
      extensionId: 'com.test.ext',
      sidebarPanelId: 'com.test.ext',
    })
  })

  it('treats the default sidebar view name as a sidebar surface', () => {
    surface = { extensionId: 'com.test.ext', viewParam: 'sidebar' }
    listExtensions.mockReturnValue([makeExt({ contributes: { sidebarPanel: { label: 'Git' } } })])

    route()

    expect(send).toHaveBeenCalledWith(
      'extension:exit-to-terminal',
      expect.objectContaining({ sidebarPanelId: 'com.test.ext' })
    )
  })
})

describe('routeExtensionExitRequest — full-screen views', () => {
  useExitDeps()

  it('does not treat a full-screen view of a panel-owning extension as a sidebar exit', () => {
    surface = { extensionId: 'com.test.ext', viewParam: 'main' }
    listExtensions.mockReturnValue([
      makeExt({
        contributes: {
          globalTab: { label: 'Vault', view: 'main' },
          sidebarPanel: { label: 'Calendar', view: 'calendar' },
        },
      }),
    ])

    route()

    expect(send).toHaveBeenCalledWith(
      'extension:exit-to-terminal',
      expect.objectContaining({ sidebarPanelId: null })
    )
  })
})

describe('routeExtensionExitRequest — removed extensions', () => {
  useExitDeps()

  it('still exits when the extension is no longer installed', () => {
    listExtensions.mockReturnValue([])

    expect(route()).toBe(true)
    expect(send).toHaveBeenCalledWith(
      'extension:exit-to-terminal',
      expect.objectContaining({ sidebarPanelId: null })
    )
  })
})
