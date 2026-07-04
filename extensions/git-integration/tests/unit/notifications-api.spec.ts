// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true })

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).window = globalThis
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke: mockInvoke },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('notificationsAPI bridge', () => {
  it('notify calls the git:notify channel with type, title, key, and message', async () => {
    const { notificationsAPI } = await import('../../src/api/notifications')
    await notificationsAPI.notify('error', 'Commit failed', 'commitFailed', 'hook rejected')
    expect(mockInvoke).toHaveBeenCalledWith('git:notify', {
      type: 'error',
      title: 'Commit failed',
      key: 'commitFailed',
      message: 'hook rejected',
    })
  })

  it('notify works without a message', async () => {
    const { notificationsAPI } = await import('../../src/api/notifications')
    await notificationsAPI.notify('info', 'No merge conflicts found.', 'noConflictsFound')
    expect(mockInvoke).toHaveBeenCalledWith('git:notify', {
      type: 'info',
      title: 'No merge conflicts found.',
      key: 'noConflictsFound',
      message: undefined,
    })
  })
})
