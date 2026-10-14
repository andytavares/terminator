import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  createIpcRegistrar,
  dispatchChannel,
  plural,
  validationError,
  type ChannelSpec,
  type ExtensionAPI,
} from '@terminator/extension-sdk'
import { partialFake } from '../../../tests/support/fakes'

describe('plural', () => {
  it('keeps the word for one and adds an s for any other count', () => {
    expect([0, 1, 2].map((count) => plural(count, 'file'))).toEqual(['files', 'file', 'files'])
  })

  it('uses the plural it is given', () => {
    expect(plural(3, 'entry', 'entries')).toBe('entries')
  })
})

describe('validationError', () => {
  it("answers VALIDATION_ERROR with the schema's own message", () => {
    const rejected = z.object({ id: z.string() }).safeParse({ id: 7 })
    if (rejected.success) throw new Error('the payload should have been rejected')

    expect(validationError(rejected.error)).toEqual({
      error: 'VALIDATION_ERROR',
      message: rejected.error.message,
    })
  })
})

interface Registered {
  spec: ChannelSpec
  remoteAccessible: boolean | undefined
  dispose: ReturnType<typeof vi.fn>
}

function recordingApi(): { api: ExtensionAPI; registered: Registered[] } {
  const registered: Registered[] = []
  const recordHandler: ExtensionAPI['ipc']['registerHandler'] = (spec, options) => {
    const dispose = vi.fn()
    registered.push({ spec, remoteAccessible: options?.remoteAccessible, dispose })
    return { dispose }
  }
  const channels = partialFake<ExtensionAPI['ipc']>({ registerHandler: recordHandler })
  return { api: partialFake<ExtensionAPI>({ ipc: channels }), registered }
}

const answerWithTheError = (e: unknown): { error: string } => ({ error: String(e) })

function throwDiskFull(): never {
  throw new Error('disk full')
}

const NoteId = z.object({ id: z.string() })

describe('createIpcRegistrar', () => {
  it('registers a local channel and a remote one, each with its schema', async () => {
    const { api, registered } = recordingApi()
    const { handle, handleRemote } = createIpcRegistrar(api)

    handle('notes:rename', NoteId, ({ id }) => `renamed ${id}`)
    handleRemote('notes:get', NoteId, ({ id }) => `note ${id}`)

    expect(registered.map((r) => [r.spec.channel, r.remoteAccessible])).toEqual([
      ['notes:rename', false],
      ['notes:get', true],
    ])
    await expect(dispatchChannel(registered[1].spec, { id: 'a' })).resolves.toBe('note a')
  })

  it('answers a rejected payload with validationError unless told otherwise', async () => {
    const { api, registered } = recordingApi()
    createIpcRegistrar(api).handle('notes:get', NoteId, () => 'never')
    createIpcRegistrar(api, { invalid: { error: 'BAD' } }).handle(
      'notes:get',
      NoteId,
      () => 'never'
    )

    const answers = await Promise.all(registered.map((r) => dispatchChannel(r.spec, { id: 7 })))

    expect(answers[0]).toMatchObject({ error: 'VALIDATION_ERROR', message: expect.any(String) })
    expect(answers[1]).toEqual({ error: 'BAD' })
  })
})

describe('createIpcRegistrar when a channel throws, and on cleanup', () => {
  it('answers a throwing channel with onError when it has one, and rejects without', async () => {
    const { api, registered } = recordingApi()
    createIpcRegistrar(api, { onError: answerWithTheError }).handle('a', NoteId, throwDiskFull)
    createIpcRegistrar(api).handle('b', NoteId, throwDiskFull)

    await expect(dispatchChannel(registered[0].spec, { id: 'a' })).resolves.toEqual({
      error: 'Error: disk full',
    })
    await expect(dispatchChannel(registered[1].spec, { id: 'a' })).rejects.toThrow('disk full')
  })

  it('unregisters every channel on cleanup', () => {
    const { api, registered } = recordingApi()
    const { handle, handleRemote, cleanup } = createIpcRegistrar(api)
    handle('a', NoteId, () => null)
    handleRemote('b', NoteId, () => null)

    cleanup()

    expect(registered.map((r) => r.dispose.mock.calls.length)).toEqual([1, 1])
  })
})
