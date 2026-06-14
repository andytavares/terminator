import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAddToast = vi.fn()
const mockInvoke = vi.fn().mockResolvedValue({ ok: true })

vi.mock('../../../../src/renderer/stores/toast.store', () => ({
  useToastStore: {
    getState: () => ({ addToast: mockAddToast }),
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
    // let the rejected promise settle without an unhandled rejection
    await new Promise((r) => setTimeout(r, 0))
  })
})
