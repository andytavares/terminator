import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const { mockHandle } = vi.hoisted(() => ({ mockHandle: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, on: vi.fn(), removeHandler: vi.fn() },
}))

import { defineChannel } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from '../../../src/main/ipc/invoke-table.js'

function capturedHandler(channel: string) {
  return mockHandle.mock.calls.find(([ch]) => ch === channel)![1] as (
    event: unknown,
    payload?: unknown
  ) => Promise<unknown>
}

describe('registerInvokeTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers one channel per row', () => {
    registerInvokeTable([
      defineChannel({ channel: 'a:one', schema: z.object({}), invalid: null, run: () => 'one' }),
      defineChannel({ channel: 'a:two', schema: z.object({}), invalid: null, run: () => 'two' }),
    ])
    expect(mockHandle).toHaveBeenCalledWith('a:one', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('a:two', expect.any(Function))
  })

  it('dispatches valid payloads to run() and returns its response', async () => {
    registerInvokeTable([
      defineChannel({
        channel: 'a:echo',
        schema: z.object({ name: z.string() }),
        invalid: { error: 'VALIDATION_ERROR' },
        run: ({ name }) => ({ hello: name }),
      }),
    ])
    await expect(capturedHandler('a:echo')({}, { name: 'x' })).resolves.toEqual({ hello: 'x' })
  })
})

describe('registerInvokeTable — invalid payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the static invalid response when validation fails', async () => {
    registerInvokeTable([
      defineChannel({
        channel: 'a:strict',
        schema: z.object({ id: z.string().min(1) }),
        invalid: { error: 'VALIDATION_ERROR' },
        run: () => ({ ok: true }),
      }),
    ])
    await expect(capturedHandler('a:strict')({}, { id: '' })).resolves.toEqual({
      error: 'VALIDATION_ERROR',
    })
  })
})

describe('registerInvokeTable — functional invalid responses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the zod error to a functional invalid response', async () => {
    registerInvokeTable([
      defineChannel({
        channel: 'a:detail',
        schema: z.object({ id: z.string() }),
        invalid: (err: z.ZodError) => ({ error: 'VALIDATION_ERROR', message: err.message }),
        run: () => ({ ok: true }),
      }),
    ])
    const { error } = z.object({ id: z.string() }).safeParse({})
    expect(await capturedHandler('a:detail')({}, {})).toEqual({
      error: 'VALIDATION_ERROR',
      message: error!.message,
    })
  })
})

describe('registerInvokeTable — errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps thrown errors through onError', async () => {
    registerInvokeTable([
      defineChannel({
        channel: 'a:boom',
        schema: z.object({}),
        invalid: null,
        run: () => {
          throw new Error('kaput')
        },
        onError: (e) => ({ error: String(e) }),
      }),
    ])
    await expect(capturedHandler('a:boom')({}, {})).resolves.toEqual({
      error: 'Error: kaput',
    })
  })
})

describe('registerInvokeTable — errors without onError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets errors propagate when no onError is declared', async () => {
    registerInvokeTable([
      defineChannel({
        channel: 'a:throws',
        schema: z.object({}),
        invalid: null,
        run: () => {
          throw new Error('unhandled')
        },
      }),
    ])
    await expect(capturedHandler('a:throws')({}, {})).rejects.toThrow('unhandled')
  })
})

describe('noPayload', () => {
  it('accepts what the desktop renderer sends (nothing) and what the bridge sends ({})', () => {
    expect(noPayload.safeParse(undefined).success).toBe(true)
    expect(noPayload.safeParse({}).success).toBe(true)
  })
})
