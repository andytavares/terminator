import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { invoke, mountExtension } from '@terminator/extension-sdk/renderer'

describe('invoke', () => {
  const bridgeInvoke = vi.fn()

  beforeEach(() => {
    bridgeInvoke.mockReset().mockResolvedValue({ ok: true })
    window.electronAPI = { extensionBridge: { invoke: bridgeInvoke } } as never
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
