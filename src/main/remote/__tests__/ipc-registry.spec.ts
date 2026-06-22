import { describe, it, expect, beforeEach } from 'vitest'
import { ipcInvokeRegistry, ipcSendRegistry, type IpcRegistryEntry } from '../ipc-registry.js'

describe('ipcInvokeRegistry', () => {
  beforeEach(() => {
    ipcInvokeRegistry.clear()
    ipcSendRegistry.clear()
  })

  it('stores IpcRegistryEntry with handler and remoteAccessible flag', () => {
    const handler = () => 'result'
    const entry: IpcRegistryEntry = { handler: handler as never, remoteAccessible: true }
    ipcInvokeRegistry.set('test:channel', entry)
    const stored = ipcInvokeRegistry.get('test:channel')
    expect(stored?.handler).toBe(handler)
    expect(stored?.remoteAccessible).toBe(true)
  })

  it('defaults remoteAccessible to false when not specified', () => {
    const handler = () => 'result'
    ipcInvokeRegistry.set('internal:channel', {
      handler: handler as never,
      remoteAccessible: false,
    })
    expect(ipcInvokeRegistry.get('internal:channel')?.remoteAccessible).toBe(false)
  })

  it('stores multiple channels independently', () => {
    const h1 = () => 'a'
    const h2 = () => 'b'
    ipcInvokeRegistry.set('ch:one', { handler: h1 as never, remoteAccessible: false })
    ipcInvokeRegistry.set('ch:two', { handler: h2 as never, remoteAccessible: true })
    expect(ipcInvokeRegistry.get('ch:one')?.remoteAccessible).toBe(false)
    expect(ipcInvokeRegistry.get('ch:two')?.remoteAccessible).toBe(true)
  })

  it('allows deletion via delete()', () => {
    ipcInvokeRegistry.set('del:me', { handler: (() => {}) as never, remoteAccessible: false })
    ipcInvokeRegistry.delete('del:me')
    expect(ipcInvokeRegistry.has('del:me')).toBe(false)
  })
})

describe('ipcSendRegistry', () => {
  beforeEach(() => {
    ipcSendRegistry.clear()
  })

  it('stores send handlers', () => {
    const handler = () => {}
    ipcSendRegistry.set('send:channel', handler as never)
    expect(ipcSendRegistry.get('send:channel')).toBe(handler)
  })
})
