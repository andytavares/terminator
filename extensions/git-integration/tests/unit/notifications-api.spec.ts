// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true })

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { window: globalThis })
  Object.assign(globalThis, {
    electronAPI: {
      extensionBridge: { invoke: mockInvoke },
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

describe('notificationsAPI bridge', () => {
  it('notify calls the git:notify channel with type, title, key, and message', async () => {
    const { notificationsAPI } = await import('../../src/api/notifications')
    await notificationsAPI.notify({
      type: 'error',
      title: 'Commit failed',
      key: 'commitFailed',
      message: 'hook rejected',
    })
    expect(mockInvoke).toHaveBeenCalledWith('git:notify', {
      type: 'error',
      title: 'Commit failed',
      key: 'commitFailed',
      message: 'hook rejected',
    })
  })
})

describe('notificationsAPI bridge — notify works without a message', () => {
  it('notify works without a message', async () => {
    const { notificationsAPI } = await import('../../src/api/notifications')
    await notificationsAPI.notify({
      type: 'info',
      title: 'No merge conflicts found.',
      key: 'noConflictsFound',
    })
    expect(mockInvoke).toHaveBeenCalledWith('git:notify', {
      type: 'info',
      title: 'No merge conflicts found.',
      key: 'noConflictsFound',
      message: undefined,
    })
  })
})
