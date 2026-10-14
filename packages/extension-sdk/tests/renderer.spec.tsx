import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { invoke, mountExtension, openInBrowser } from '@terminator/extension-sdk/renderer'
import type { ElectronAPI } from '../types/renderer'

describe('invoke', () => {
  const bridgeInvoke = vi.fn()

  beforeEach(() => {
    bridgeInvoke.mockReset().mockResolvedValue({ ok: true })
    // Only the bridge's invoke, with its real type; the rest of the API is absent.
    const extensionBridge: Partial<ElectronAPI['extensionBridge']> = { invoke: bridgeInvoke }
    Object.defineProperty(window, 'electronAPI', {
      value: { extensionBridge },
      configurable: true,
      writable: true,
    })
  })

  it('sends the payload to the channel and resolves with the reply', async () => {
    await expect(invoke('notes:get', { id: 'a' })).resolves.toEqual({ ok: true })
    expect(bridgeInvoke).toHaveBeenCalledWith('notes:get', { id: 'a' })
  })

  it('sends an empty object when the call has no payload', async () => {
    await invoke('notes:list')
    expect(bridgeInvoke).toHaveBeenCalledWith('notes:list', {})
  })
})

describe('mountExtension', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the view into #app', async () => {
    document.body.innerHTML = '<div id="app"></div>'
    await act(async () => mountExtension(<p>hello</p>))
    expect(document.getElementById('app')?.textContent).toBe('hello')
  })

  it('refuses a page without #app', () => {
    expect(() => mountExtension(<p>hello</p>)).toThrow('No #app element')
  })
})

describe('openInBrowser', () => {
  function shellOpening(openExternal: ElectronAPI['shell']['openExternal']): void {
    const shell: Partial<ElectronAPI['shell']> = { openExternal }
    Object.defineProperty(window, 'electronAPI', {
      value: { shell },
      configurable: true,
      writable: true,
    })
  }

  it("hands the address to the person's browser", () => {
    const opened = vi.fn().mockResolvedValue(undefined)
    shellOpening(opened)

    openInBrowser('https://example.com/pull/7')

    expect(opened).toHaveBeenCalledWith('https://example.com/pull/7')
  })

  it('leaves no unhandled rejection when the address cannot be opened', async () => {
    const unhandled = vi.fn()
    process.once('unhandledRejection', unhandled)
    shellOpening(() => Promise.reject(new Error('no browser')))

    openInBrowser('https://example.com')
    await new Promise((resolve) => setImmediate(resolve))

    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })
})
