import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockIpcOn, mockWriteFromRenderer } = vi.hoisted(() => ({
  mockIpcOn: vi.fn(),
  mockWriteFromRenderer: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { on: mockIpcOn, handle: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp') },
}))

vi.mock('../../../src/main/logger.js', () => ({
  writeFromRenderer: mockWriteFromRenderer,
}))

import { registerLogHandlers } from '../../../src/main/ipc/log.ipc.js'

describe('registerLogHandlers()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers log:write IPC listener', () => {
    registerLogHandlers()
    expect(mockIpcOn).toHaveBeenCalledWith('log:write', expect.any(Function))
  })

  it('calls writeFromRenderer with valid payload', () => {
    registerLogHandlers()
    const handler = mockIpcOn.mock.calls[0][1]
    handler({}, { level: 'info', namespace: 'app', message: 'hello' })
    expect(mockWriteFromRenderer).toHaveBeenCalledWith('info', 'app', 'hello')
  })

  it('ignores payload with missing level', () => {
    registerLogHandlers()
    const handler = mockIpcOn.mock.calls[0][1]
    handler({}, { namespace: 'app', message: 'hello' })
    expect(mockWriteFromRenderer).not.toHaveBeenCalled()
  })

  it('ignores payload with missing namespace', () => {
    registerLogHandlers()
    const handler = mockIpcOn.mock.calls[0][1]
    handler({}, { level: 'info', message: 'hello' })
    expect(mockWriteFromRenderer).not.toHaveBeenCalled()
  })

  it('ignores payload with non-string message', () => {
    registerLogHandlers()
    const handler = mockIpcOn.mock.calls[0][1]
    handler({}, { level: 'info', namespace: 'app', message: 42 })
    expect(mockWriteFromRenderer).not.toHaveBeenCalled()
  })

  it('ignores null payload', () => {
    registerLogHandlers()
    const handler = mockIpcOn.mock.calls[0][1]
    handler({}, null)
    expect(mockWriteFromRenderer).not.toHaveBeenCalled()
  })
})
