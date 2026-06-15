import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAddToast = vi.fn()
const mockAddNotification = vi.fn()
const mockInvoke = vi.fn().mockResolvedValue({ ok: true })

vi.mock('../../../../src/renderer/stores/toast.store', () => ({
  useToastStore: {
    getState: () => ({ addToast: mockAddToast }),
  },
}))

vi.mock('../../../../src/renderer/stores/notification.store', () => ({
  useNotificationStore: {
    getState: () => ({ addNotification: mockAddNotification }),
  },
}))

vi.stubGlobal('window', {
  electronAPI: {
    extensionBridge: { invoke: mockInvoke },
  },
})

import { notify } from '../../src/utils/notify'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notify', () => {
  it('calls addToast with type and message', () => {
    notify('success', 'Task done')
    expect(mockAddToast).toHaveBeenCalledWith({
      type: 'success',
      message: 'Task done',
      onClick: undefined,
    })
  })

  it('passes onClick to addToast when provided', () => {
    const onClick = vi.fn()
    notify('info', 'Hello', { onClick })
    expect(mockAddToast).toHaveBeenCalledWith({ type: 'info', message: 'Hello', onClick })
  })

  it('calls addNotification with correct shape', () => {
    notify('success', 'Task done')
    expect(mockAddNotification).toHaveBeenCalledOnce()
    const arg = mockAddNotification.mock.calls[0][0]
    expect(arg.type).toBe('success')
    expect(arg.title).toBe('Task Vault')
    expect(arg.message).toBe('Task done')
    expect(arg.source).toBe('task-vault')
    expect(typeof arg.id).toBe('string')
    expect(typeof arg.timestamp).toBe('number')
    expect(arg.onClick).toBeUndefined()
  })

  it('passes onClick to addNotification when provided', () => {
    const onClick = vi.fn()
    notify('error', 'Failed', { onClick })
    const arg = mockAddNotification.mock.calls[0][0]
    expect(arg.onClick).toBe(onClick)
  })

  it('generates unique ids across calls', () => {
    notify('info', 'A')
    notify('info', 'B')
    const id1 = mockAddNotification.mock.calls[0][0].id
    const id2 = mockAddNotification.mock.calls[1][0].id
    expect(id1).not.toBe(id2)
  })

  it('invokes system-notify IPC with title and body', () => {
    notify('warning', 'Blocked task')
    expect(mockInvoke).toHaveBeenCalledWith('task-vault:system-notify', {
      title: 'Task Vault',
      body: 'Blocked task',
    })
  })

  it('swallows IPC errors silently', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('IPC failure'))
    expect(() => notify('error', 'Oops')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })

  it('forwards all toast types to addNotification', () => {
    const types = ['success', 'error', 'warning', 'info'] as const
    types.forEach((type) => notify(type, type))
    types.forEach((type, i) => {
      expect(mockAddNotification.mock.calls[i][0].type).toBe(type)
    })
  })
})
