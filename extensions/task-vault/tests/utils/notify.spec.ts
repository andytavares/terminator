import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true })

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
  it('invokes system-notify IPC with type, title, and body', () => {
    notify('success', 'Task done')
    expect(mockInvoke).toHaveBeenCalledWith('task-vault:system-notify', {
      type: 'success',
      title: 'Task Vault',
      body: 'Task done',
    })
  })

  it('forwards all toast types through IPC', () => {
    const types = ['success', 'error', 'warning', 'info'] as const
    types.forEach((type) => notify(type, type))
    types.forEach((type, i) => {
      expect(mockInvoke.mock.calls[i][1]).toMatchObject({ type })
    })
  })

  it('accepts onClick option without throwing (ignored cross-process)', () => {
    const onClick = vi.fn()
    expect(() => notify('info', 'Hello', { onClick })).not.toThrow()
    expect(mockInvoke).toHaveBeenCalledWith('task-vault:system-notify', {
      type: 'info',
      title: 'Task Vault',
      body: 'Hello',
    })
  })

  it('swallows IPC errors silently', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('IPC failure'))
    expect(() => notify('error', 'Oops')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })
})
