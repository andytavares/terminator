import { describe, it, expect, vi, beforeEach } from 'vitest'
import { routeExtensionExitRequest } from '../../../../src/main/extensions/extension-exit.js'
import type { Extension } from '../../../../src/shared/types/index.js'

const SENDER = { id: 'sender' } as never

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

describe('routeExtensionExitRequest', () => {
  let send: ReturnType<typeof vi.fn>
  let focusMainRenderer: ReturnType<typeof vi.fn>
  let findViewByWebContents: ReturnType<typeof vi.fn>
  let listExtensions: ReturnType<typeof vi.fn>

  function route(): boolean {
    return routeExtensionExitRequest(SENDER, {
      findViewByWebContents,
      listExtensions,
      focusMainRenderer,
      send,
    })
  }

  beforeEach(() => {
    send = vi.fn()
    focusMainRenderer = vi.fn()
    findViewByWebContents = vi
      .fn()
      .mockReturnValue({ extensionId: 'com.test.ext', viewParam: 'main' })
    listExtensions = vi.fn().mockReturnValue([makeExt()])
  })

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

  it('names the sidebar panel when the request came from a sidebar view', () => {
    findViewByWebContents.mockReturnValue({ extensionId: 'com.test.ext', viewParam: 'sidebar' })
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
    findViewByWebContents.mockReturnValue({ extensionId: 'com.test.ext', viewParam: 'sidebar' })
    listExtensions.mockReturnValue([makeExt({ contributes: { sidebarPanel: { label: 'Git' } } })])

    route()

    expect(send).toHaveBeenCalledWith(
      'extension:exit-to-terminal',
      expect.objectContaining({ sidebarPanelId: 'com.test.ext' })
    )
  })

  it('does not treat a full-screen view of a panel-owning extension as a sidebar exit', () => {
    findViewByWebContents.mockReturnValue({ extensionId: 'com.test.ext', viewParam: 'main' })
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

  it('ignores a request from webContents that is not an extension view', () => {
    findViewByWebContents.mockReturnValue(null)

    expect(route()).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(focusMainRenderer).not.toHaveBeenCalled()
  })

  it('still exits when the extension is no longer installed', () => {
    listExtensions.mockReturnValue([])

    expect(route()).toBe(true)
    expect(send).toHaveBeenCalledWith(
      'extension:exit-to-terminal',
      expect.objectContaining({ sidebarPanelId: null })
    )
  })
})
