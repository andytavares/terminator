import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the toast store before importing notify
vi.mock('../../src/stores/extension-toast.store', () => ({
  addExtensionToast: vi.fn(),
}))

const mockCreate = vi.fn().mockResolvedValue({ id: 'notif-1' })

Object.defineProperty(globalThis, 'window', {
  value: {
    electronAPI: {
      notifications: { create: mockCreate },
    },
  },
  writable: true,
  configurable: true,
})

import { notify } from '../../src/utils/notify'
import { addExtensionToast } from '../../src/stores/extension-toast.store'

const mockAddToast = vi.mocked(addExtensionToast)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('notify', () => {
  it('adds a local toast with the correct type and message', () => {
    notify('success', 'Task done', 'taskCompleted')
    expect(mockAddToast).toHaveBeenCalledWith('success', 'Task done', { onClick: undefined })
  })

  it('forwards all toast types to the local store', () => {
    const types = ['success', 'error', 'warning', 'info'] as const
    types.forEach((type) => notify(type, type, 'testKey'))
    types.forEach((type, i) => {
      expect(mockAddToast.mock.calls[i][0]).toBe(type)
    })
  })

  it('passes onClick through to the toast store', () => {
    const onClick = vi.fn()
    notify('info', 'Hello', 'testKey', { onClick })
    expect(mockAddToast).toHaveBeenCalledWith('info', 'Hello', { onClick })
  })

  it('does not throw when called without options', () => {
    expect(() => notify('error', 'Oops', 'testKey')).not.toThrow()
  })

  it('routes through the shared dispatcher tagged with this extension source and key', () => {
    notify('warning', 'Task overdue', 'dueTaskReminder')
    expect(mockCreate).toHaveBeenCalledWith({
      type: 'warning',
      title: 'Task overdue',
      source: 'terminator.task-vault',
      key: 'dueTaskReminder',
    })
  })

  it('does not throw when electronAPI.notifications is unavailable', () => {
    const orig = window.electronAPI
    ;(window as unknown as Record<string, unknown>).electronAPI = undefined
    expect(() => notify('info', 'Oops', 'testKey')).not.toThrow()
    ;(window as unknown as Record<string, unknown>).electronAPI = orig
  })
})
