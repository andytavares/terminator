import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}))

vi.mock('../../../src/main/extensions/api', () => ({
  globalRegistry: {
    sidebarItems: new Map(),
    contextMenuItems: new Map(),
  },
}))

import { globalRegistry } from '../../../src/main/extensions/api'
import { registerExtensionHandlers } from '../../../src/main/ipc/extension.ipc'

const mockExtensionHost = {
  listExtensions: vi.fn(),
  load: vi.fn(),
  toggle: vi.fn(),
}

function captureHandle(channel: string): (event: unknown, payload?: unknown) => unknown {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const match = calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No handler registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

function captureOn(channel: string): (event: unknown, payload?: unknown) => unknown {
  const calls = vi.mocked(ipcMain.on).mock.calls
  const match = calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No listener registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

describe('extension IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalRegistry.sidebarItems as Map<string, unknown>).clear()
    ;(globalRegistry.contextMenuItems as Map<string, unknown>).clear()
    registerExtensionHandlers(mockExtensionHost as Parameters<typeof registerExtensionHandlers>[0])
  })

  describe('extension:list', () => {
    it('returns extensions from host', () => {
      const extensions = [{ id: 'com.test', name: 'Test' }]
      mockExtensionHost.listExtensions.mockReturnValue(extensions)
      const handler = captureHandle('extension:list')
      const result = handler({}) as { extensions: unknown[] }
      expect(result.extensions).toEqual(extensions)
    })
  })

  describe('extension:install', () => {
    it('calls load with directoryPath and returns result', async () => {
      const ext = { extension: { id: 'com.new', name: 'New' } }
      mockExtensionHost.load.mockResolvedValue(ext)
      const handler = captureHandle('extension:install')
      const result = await handler({}, { directoryPath: '/extensions/new' })
      expect(mockExtensionHost.load).toHaveBeenCalledWith('/extensions/new')
      expect(result).toEqual(ext)
    })
  })

  describe('extension:toggle', () => {
    it('returns extension on successful toggle', async () => {
      const ext = { id: 'com.test', status: 'disabled' }
      mockExtensionHost.toggle.mockResolvedValue(ext)
      const handler = captureHandle('extension:toggle')
      const result = (await handler({}, { id: 'com.test', enabled: false })) as {
        extension: unknown
      }
      expect(mockExtensionHost.toggle).toHaveBeenCalledWith('com.test', false)
      expect(result.extension).toEqual(ext)
    })

    it('returns NOT_FOUND error when toggle returns null', async () => {
      mockExtensionHost.toggle.mockResolvedValue(null)
      const handler = captureHandle('extension:toggle')
      const result = (await handler({}, { id: 'missing', enabled: true })) as { error: string }
      expect(result.error).toBe('NOT_FOUND')
    })
  })

  describe('extension:get-sidebar-items', () => {
    it('returns empty items when registry has none', () => {
      const handler = captureHandle('extension:get-sidebar-items')
      const result = handler({}) as { items: unknown[] }
      expect(result.items).toEqual([])
    })

    it('returns mapped sidebar items from registry', () => {
      ;(globalRegistry.sidebarItems as Map<string, unknown>).set('item1', {
        id: 'sidebar-1',
        label: 'Git',
        tooltip: 'Git panel',
      })
      const handler = captureHandle('extension:get-sidebar-items')
      const result = handler({}) as { items: { id: string; label: string; tooltip?: string }[] }
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({ id: 'sidebar-1', label: 'Git', tooltip: 'Git panel' })
    })
  })

  describe('extension:get-context-menu-items', () => {
    it('returns empty items when no items match target', () => {
      const handler = captureHandle('extension:get-context-menu-items')
      const result = handler({}, { target: 'project' }) as { items: unknown[] }
      expect(result.items).toEqual([])
    })

    it('returns only items matching the given target', () => {
      ;(globalRegistry.contextMenuItems as Map<string, unknown>).set('ext1.open', {
        target: 'file',
        item: { id: 'open', label: 'Open in editor' },
      })
      ;(globalRegistry.contextMenuItems as Map<string, unknown>).set('ext1.delete', {
        target: 'project',
        item: { id: 'delete', label: 'Delete project' },
      })
      const handler = captureHandle('extension:get-context-menu-items')
      const result = handler({}, { target: 'file' }) as { items: { id: string; label: string }[] }
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({ id: 'open', label: 'Open in editor' })
    })
  })

  describe('extension:context-menu-click', () => {
    it('calls onClick for the matching context menu item', () => {
      const onClick = vi.fn()
      ;(globalRegistry.contextMenuItems as Map<string, unknown>).set('ext1.open', {
        target: 'file',
        item: { id: 'open', label: 'Open', onClick },
      })
      const listener = captureOn('extension:context-menu-click')
      listener({}, { target: 'file', itemId: 'open', targetId: 'file-123' })
      expect(onClick).toHaveBeenCalledWith('file-123')
    })

    it('does not call onClick when target does not match', () => {
      const onClick = vi.fn()
      ;(globalRegistry.contextMenuItems as Map<string, unknown>).set('ext1.open', {
        target: 'file',
        item: { id: 'open', label: 'Open', onClick },
      })
      const listener = captureOn('extension:context-menu-click')
      listener({}, { target: 'project', itemId: 'open', targetId: 'proj-1' })
      expect(onClick).not.toHaveBeenCalled()
    })

    it('does not crash when no matching item exists', () => {
      const listener = captureOn('extension:context-menu-click')
      expect(() =>
        listener({}, { target: 'file', itemId: 'nonexistent', targetId: 'file-1' })
      ).not.toThrow()
    })
  })
})
