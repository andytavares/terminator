import { describe, it, expect, vi } from 'vitest'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { activate, deactivate } from '../../src/index.ts'

// "Enable Git Integration" lives on Git Integration's own settings page. Switched
// off, the extension registers nothing else, so the page must still be there:
// it is the only way to switch it back on.
describe('activate with Git Integration switched off', () => {
  it('registers its settings page and nothing else', () => {
    const disposable = { dispose: () => {} }
    const register = vi.fn(() => disposable)
    const registerHandler = vi.fn(() => disposable)
    const api = {
      settings: {
        get: (key: string) =>
          key === 'terminator.git-integration.git.enabled' ? false : undefined,
        register,
      },
      ipc: { registerHandler },
    } as unknown as ExtensionAPI

    activate(api)
    deactivate()

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ label: 'Git Integration' }))
    expect(registerHandler).not.toHaveBeenCalled()
  })
})
