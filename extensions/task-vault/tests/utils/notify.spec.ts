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
    notify('success', 'Task done')
    expect(mockAddToast).toHaveBeenCalledWith('success', 'Task done', { onClick: undefined })
  })

  it('forwards all toast types to the local store', () => {
    const types = ['success', 'error', 'warning', 'info'] as const
    types.forEach((type) => notify(type, type))
    types.forEach((type, i) => {
      expect(mockAddToast.mock.calls[i][0]).toBe(type)
    })
  })

  it('passes onClick through to the toast store', () => {
    const onClick = vi.fn()
    notify('info', 'Hello', { onClick })
    expect(mockAddToast).toHaveBeenCalledWith('info', 'Hello', { onClick })
  })

  it('does not throw when called without options', () => {
    expect(() => notify('error', 'Oops')).not.toThrow()
  })

  it('creates a notification center + system notification via electronAPI', () => {
    notify('warning', 'Task overdue')
    expect(mockCreate).toHaveBeenCalledWith({
      type: 'warning',
      title: 'Task overdue',
      targets: ['center', 'system'],
    })
  })

  it('does not throw when electronAPI.notifications is unavailable', () => {
    const orig = window.electronAPI
    ;(window as unknown as Record<string, unknown>).electronAPI = undefined
    expect(() => notify('info', 'Oops')).not.toThrow()
    ;(window as unknown as Record<string, unknown>).electronAPI = orig
  })
})
