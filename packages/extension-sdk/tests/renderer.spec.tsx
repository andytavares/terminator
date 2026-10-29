import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import {
  invoke,
  mountExtension,
  openInBrowser,
  recordUsage,
} from '@terminator/extension-sdk/renderer'
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

  it("hands the address to the person's browser", async () => {
    const opened = vi.fn().mockResolvedValue(undefined)
    shellOpening(opened)

    await openInBrowser('https://example.com/pull/7')

    expect(opened).toHaveBeenCalledWith('https://example.com/pull/7')
  })

  it('leaves no unhandled rejection when the address cannot be opened', async () => {
    const unhandled = vi.fn()
    process.once('unhandledRejection', unhandled)
    shellOpening(() => Promise.reject(new Error('no browser')))

    await openInBrowser('https://example.com')

    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })
})

describe('recordUsage', () => {
  it("hands the id and its outcome to the view's usage API", () => {
    const record = vi.fn()
    const usage: ElectronAPI['usage'] = { record }
    Object.defineProperty(window, 'electronAPI', {
      value: { usage },
      configurable: true,
      writable: true,
    })

    recordUsage('export')
    recordUsage('export', { failed: true })

    expect(record.mock.calls).toEqual([['export'], ['export', { failed: true }]])
  })
})

describe('recordUsage in a window of its own', () => {
  it('does nothing, and never throws, where the view API has no usage record', () => {
    const usage = { recordUse: vi.fn() }
    Object.defineProperty(window, 'electronAPI', {
      value: { usage },
      configurable: true,
      writable: true,
    })

    expect(() => recordUsage('review-comment')).not.toThrow()
    expect(usage.recordUse).not.toHaveBeenCalled()
  })
})
