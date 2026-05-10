import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../../../src/main/fs/fs-watcher', () => ({
  fsWatcherService: {
    addHandler: vi.fn(),
    watchStart: vi.fn(),
    watchStop: vi.fn(),
  },
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}))

import fs from 'node:fs/promises'
import { fsWatcherService } from '../../../src/main/fs/fs-watcher'
import { registerFsHandlers } from '../../../src/main/ipc/fs.ipc'

function captureHandler(channel: string): (event: unknown, payload?: unknown) => unknown {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const match = calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No handler registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

describe('fs IPC handlers', () => {
  const mockGetMainWindow = vi.fn(() => ({
    webContents: { send: vi.fn() },
  })) as any

  beforeEach(() => {
    vi.clearAllMocks()
    registerFsHandlers(mockGetMainWindow)
  })

  describe('fs:watch-start', () => {
    it('calls watchStart and returns ok for valid payload', () => {
      const handler = captureHandler('fs:watch-start')
      const result = handler({}, { projectRoot: '/my/project' }) as { ok: boolean }
      expect(fsWatcherService.watchStart).toHaveBeenCalledWith('/my/project')
      expect(result.ok).toBe(true)
    })

    it('returns VALIDATION_ERROR when projectRoot is missing', () => {
      const handler = captureHandler('fs:watch-start')
      const result = handler({}, {}) as { error: string }
      expect(result.error).toBe('VALIDATION_ERROR')
      expect(fsWatcherService.watchStart).not.toHaveBeenCalled()
    })

    it('returns VALIDATION_ERROR when projectRoot is an empty string', () => {
      const handler = captureHandler('fs:watch-start')
      const result = handler({}, { projectRoot: '' }) as { error: string }
      expect(result.error).toBe('VALIDATION_ERROR')
    })
  })

  describe('fs:watch-stop', () => {
    it('calls watchStop and returns ok', () => {
      const handler = captureHandler('fs:watch-stop')
      const result = handler({}) as { ok: boolean }
      expect(fsWatcherService.watchStop).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })
  })

  describe('fs:read-file', () => {
    it('reads file and returns content', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('file contents' as any)
      const handler = captureHandler('fs:read-file')
      const result = (await handler({}, { filePath: '/my/file.ts' })) as { content: string }
      expect(result.content).toBe('file contents')
    })

    it('returns VALIDATION_ERROR when filePath is missing', async () => {
      const handler = captureHandler('fs:read-file')
      const result = (await handler({}, {})) as { error: string }
      expect(result.error).toBe('VALIDATION_ERROR')
    })

    it('returns VALIDATION_ERROR when filePath is empty string', async () => {
      const handler = captureHandler('fs:read-file')
      const result = (await handler({}, { filePath: '' })) as { error: string }
      expect(result.error).toBe('VALIDATION_ERROR')
    })

    it('returns FILE_NOT_FOUND when readFile rejects', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'))
      const handler = captureHandler('fs:read-file')
      const result = (await handler({}, { filePath: '/no/such/file.ts' })) as { error: string }
      expect(result.error).toBe('FILE_NOT_FOUND')
    })
  })

  describe('fs watcher event forwarding', () => {
    it('registers a watcher handler that sends fs:changed events to the window', () => {
      const handlerCapture = vi.mocked(fsWatcherService.addHandler).mock.calls[0][0]
      const mockSend = vi.fn()
      mockGetMainWindow.mockReturnValueOnce({ webContents: { send: mockSend } })
      const event = { type: 'change', path: '/my/file.ts' }
      handlerCapture(event as any)
      expect(mockSend).toHaveBeenCalledWith('fs:changed', event)
    })

    it('does not crash when main window is null', () => {
      const handlerCapture = vi.mocked(fsWatcherService.addHandler).mock.calls[0][0]
      mockGetMainWindow.mockReturnValueOnce(null)
      expect(() => handlerCapture({ type: 'change', path: '/file.ts' } as any)).not.toThrow()
    })
  })
})
