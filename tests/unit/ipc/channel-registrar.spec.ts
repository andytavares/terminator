import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, mockOn, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockOn: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, on: mockOn, removeHandler: mockRemoveHandler },
}))

import { handleChannel, onChannel, removeChannel } from '../../../src/main/ipc/channel-registrar.js'
import { ipcInvokeRegistry, ipcSendRegistry } from '../../../src/main/remote/ipc-registry.js'
import { REMOTE_ACCESSIBLE_CHANNELS } from '../../../src/main/remote/remote-accessible-channels.js'

describe('handleChannel()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcInvokeRegistry.clear()
    ipcSendRegistry.clear()
  })

  it('wires the handler into ipcMain.handle', () => {
    const fn = vi.fn()
    handleChannel('test:channel', fn)
    expect(mockHandle).toHaveBeenCalledWith('test:channel', fn)
  })

  it('records the handler in the bridge invoke registry', () => {
    const fn = vi.fn()
    handleChannel('test:channel', fn)
    expect(ipcInvokeRegistry.get('test:channel')?.handler).toBe(fn)
  })

  it('defaults remoteAccessible from the core allowlist — allowlisted channel', () => {
    const allowlisted = [...REMOTE_ACCESSIBLE_CHANNELS][0]
    handleChannel(allowlisted, vi.fn())
    expect(ipcInvokeRegistry.get(allowlisted)?.remoteAccessible).toBe(true)
  })

  it('defaults remoteAccessible from the core allowlist — unlisted channel', () => {
    handleChannel('internal:not-allowlisted', vi.fn())
    expect(ipcInvokeRegistry.get('internal:not-allowlisted')?.remoteAccessible).toBe(false)
  })

  it('lets an explicit remoteAccessible: true override the allowlist default', () => {
    handleChannel('internal:opted-in', vi.fn(), { remoteAccessible: true })
    expect(ipcInvokeRegistry.get('internal:opted-in')?.remoteAccessible).toBe(true)
  })

  it('lets an explicit remoteAccessible: false override the allowlist default', () => {
    const allowlisted = [...REMOTE_ACCESSIBLE_CHANNELS][0]
    handleChannel(allowlisted, vi.fn(), { remoteAccessible: false })
    expect(ipcInvokeRegistry.get(allowlisted)?.remoteAccessible).toBe(false)
  })
})

describe('onChannel()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcSendRegistry.clear()
  })

  it('wires the listener into ipcMain.on', () => {
    const fn = vi.fn()
    onChannel('fire:channel', fn)
    expect(mockOn).toHaveBeenCalledWith('fire:channel', fn)
  })

  it('records the listener in the bridge send registry', () => {
    const fn = vi.fn()
    onChannel('fire:channel', fn)
    expect(ipcSendRegistry.get('fire:channel')).toBe(fn)
  })
})

describe('removeChannel()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcInvokeRegistry.clear()
  })

  it('removes the handler from ipcMain and the bridge registry', () => {
    handleChannel('gone:channel', vi.fn())
    removeChannel('gone:channel')
    expect(mockRemoveHandler).toHaveBeenCalledWith('gone:channel')
    expect(ipcInvokeRegistry.has('gone:channel')).toBe(false)
  })
})
