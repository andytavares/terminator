import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockIpcOn, mockWriteFromRenderer } = vi.hoisted(() => ({
  mockIpcOn: vi.fn(),
  mockWriteFromRenderer: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { on: mockIpcOn, handle: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp') },
}))

vi.mock('../../../src/logger.js', () => ({
  writeFromRenderer: mockWriteFromRenderer,
}))

import { registerLogHandlers } from '../../../src/ipc/log.ipc.js'

describe('registerLogHandlers()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls writeFromRenderer with valid payload', () => {
    registerLogHandlers()
    const handler = mockIpcOn.mock.calls[0][1]
    handler({}, { level: 'info', namespace: 'app', message: 'hello' })
    expect(mockWriteFromRenderer).toHaveBeenCalledWith('info', 'app', 'hello')
  })

  it.each([
    ['a missing level', { namespace: 'app', message: 'hello' }],
    ['a missing namespace', { level: 'info', message: 'hello' }],
    ['a non-string message', { level: 'info', namespace: 'app', message: 42 }],
    ['a null payload', null],
  ])('ignores %s', (_case, payload) => {
    registerLogHandlers()
    const handler = mockIpcOn.mock.calls[0][1]
    handler({}, payload)
    expect(mockWriteFromRenderer).not.toHaveBeenCalled()
  })
})
