import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dispatchNotification } from '../../../../src/renderer/lib/notifications'

const mockCreate = vi.fn()

beforeEach(() => {
  mockCreate.mockReset()
  ;(globalThis as unknown as Record<string, unknown>).window = {
    electronAPI: { notifications: { create: mockCreate } },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).window
})

describe('dispatchNotification', () => {
  it('forwards the notification and key to window.electronAPI.notifications.create', () => {
    dispatchNotification({ type: 'info', title: 'Hello', message: 'World', key: 'helloKey' })
    expect(mockCreate).toHaveBeenCalledWith({
      type: 'info',
      title: 'Hello',
      message: 'World',
      key: 'helloKey',
    })
  })

  it('does not include a source or targets — those are resolved main-side', () => {
    dispatchNotification({ type: 'error', title: 'Oops', key: 'oopsKey' })
    expect(mockCreate).toHaveBeenCalledWith({ type: 'error', title: 'Oops', key: 'oopsKey' })
  })
})
