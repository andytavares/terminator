import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
const sent: Array<{ channel: string; data: unknown }> = []

vi.mock('../../../src/main/safe-send', () => ({
  sendToWindow: (_win: unknown, channel: string, data: unknown) => {
    sent.push({ channel, data })
  },
  sendToView: () => {},
}))

vi.mock('../../../src/main/ipc/channel-registrar', () => ({
  handleChannel: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
    handlers.set(channel, handler as never)
  },
  removeChannel: () => {},
}))

const store = vi.hoisted(() => ({
  records: [] as unknown[],
  forget: vi.fn(),
  change: null as null | ((id: string, record: unknown) => void),
  setDescription: vi.fn(),
  setLink: vi.fn(),
  transfer: vi.fn(),
}))

vi.mock('../../../src/main/sessions/session-record-store', () => ({
  listRecords: () => store.records,
  forget: store.forget,
  setDescription: store.setDescription,
  setLink: store.setLink,
  transfer: store.transfer,
  onRecordChange: (handler: (id: string, record: unknown) => void) => {
    store.change = handler
    return () => {}
  },
}))

const SNAP = {
  sessionId: 's1',
  projectId: 'p1',
  workspaceName: null,
  projectName: null,
  branch: null,
  tabTitle: 'zsh',
  shell: null,
  startedAt: '2026-09-15T10:00:00.000Z',
}

function base(id: string, closedAt?: string) {
  return {
    ...SNAP,
    sessionId: id,
    description: 'd',
    link: null,
    agent: null,
    updatedAt: SNAP.startedAt,
    ...(closedAt ? { closedAt } : {}),
  }
}

const conversation = (transcriptPath: string) => ({
  provider: 'claude' as const,
  sessionId: 'conv-1',
  transcriptPath,
  cwd: '/code/repo',
  capturedAt: SNAP.startedAt,
})

async function register() {
  handlers.clear()
  sent.length = 0
  const mod = await import('../../../src/main/ipc/session-records.ipc')
  mod.registerSessionRecordsHandlers(() => ({}) as never)
}

async function invoke(channel: string, payload?: unknown): Promise<unknown> {
  const handler = handlers.get(channel)
  if (handler === undefined) throw new Error(`no handler for ${channel}`)
  return handler({}, payload)
}

class CodedError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  store.records = []
  await register()
})

describe('session-records:list', () => {
  it('returns closed records newest first, then open ones', async () => {
    const recent = new Date(Date.now() - 1000).toISOString()
    const older = new Date(Date.now() - 60_000).toISOString()
    store.records = [base('open'), base('older', older), base('recent', recent)]
    const result = (await invoke('session-records:list')) as { data: Array<{ sessionId: string }> }
    expect(result.data.map((r) => r.sessionId)).toEqual(['recent', 'older', 'open'])
  })

  it('keeps open records after closed ones whichever order they arrive in', async () => {
    const closed = new Date(Date.now() - 1000).toISOString()
    store.records = [base('open-a'), base('closed', closed), base('open-b')]
    const result = (await invoke('session-records:list')) as { data: Array<{ sessionId: string }> }
    expect(result.data.map((r) => r.sessionId)).toEqual(['closed', 'open-a', 'open-b'])
  })

  it('leaves out records past retention', async () => {
    store.records = [base('stale', new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString())]
    const result = (await invoke('session-records:list')) as { data: unknown[] }
    expect(result.data).toEqual([])
  })
})

describe('session-records:set-description', () => {
  it('writes through the store and returns the record', async () => {
    store.setDescription.mockResolvedValue(base('s1'))
    const result = await invoke('session-records:set-description', {
      session: SNAP,
      description: 'd',
    })
    expect(store.setDescription).toHaveBeenCalledWith(SNAP, 'd')
    expect(result).toEqual({ data: { ...base('s1'), resumable: false } })
  })

  it('returns null data when the write removed the record', async () => {
    store.setDescription.mockResolvedValue(null)
    const result = await invoke('session-records:set-description', {
      session: SNAP,
      description: null,
    })
    expect(result).toEqual({ data: null })
  })

  it('refuses a payload without a session', async () => {
    const result = (await invoke('session-records:set-description', { description: 'd' })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
    expect(store.setDescription).not.toHaveBeenCalled()
  })

  it('refuses a description longer than 500 characters', async () => {
    const result = (await invoke('session-records:set-description', {
      session: SNAP,
      description: 'x'.repeat(501),
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('reports a write to a closed record', async () => {
    store.setDescription.mockRejectedValue(new CodedError('RECORD_CLOSED'))
    const result = (await invoke('session-records:set-description', {
      session: SNAP,
      description: 'd',
    })) as { error: string }
    expect(result.error).toBe('RECORD_CLOSED')
  })
})

describe('failures without a code', () => {
  it('reports an uncoded error as failed, with its message', async () => {
    store.setDescription.mockRejectedValue(new Error('disk full'))
    const result = await invoke('session-records:set-description', {
      session: SNAP,
      description: 'd',
    })
    expect(result).toEqual({ error: 'failed', message: 'disk full' })
  })

  it('reports a thrown non-error as failed', async () => {
    store.setLink.mockRejectedValue('nope')
    const result = await invoke('session-records:set-link', { session: SNAP, link: null })
    expect(result).toEqual({ error: 'failed', message: 'nope' })
  })
})

describe('registering without a window', () => {
  it('drops change events rather than throwing', async () => {
    handlers.clear()
    const mod = await import('../../../src/main/ipc/session-records.ipc')
    mod.registerSessionRecordsHandlers()
    expect(() => store.change?.('s1', null)).not.toThrow()
  })
})

describe('session-records:set-link', () => {
  it('writes a link through the store', async () => {
    store.setLink.mockResolvedValue(base('s1'))
    await invoke('session-records:set-link', {
      session: SNAP,
      link: { tracker: 'linear', key: 'NW-88' },
    })
    expect(store.setLink).toHaveBeenCalledWith(SNAP, { tracker: 'linear', key: 'NW-88' })
  })

  it('removes the session link with null', async () => {
    store.setLink.mockResolvedValue(null)
    const result = await invoke('session-records:set-link', { session: SNAP, link: null })
    expect(store.setLink).toHaveBeenCalledWith(SNAP, null)
    expect(result).toEqual({ data: null })
  })

  it('refuses an unknown tracker', async () => {
    const result = (await invoke('session-records:set-link', {
      session: SNAP,
      link: { tracker: 'asana', key: 'A-1' },
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('reports a write to a closed record', async () => {
    store.setLink.mockRejectedValue(new CodedError('RECORD_CLOSED'))
    const result = (await invoke('session-records:set-link', { session: SNAP, link: null })) as {
      error: string
    }
    expect(result.error).toBe('RECORD_CLOSED')
  })
})

describe('session-records:changed', () => {
  it('forwards every store change to the window', () => {
    store.change?.('s1', base('s1'))
    store.change?.('s1', null)
    expect(sent).toEqual([
      {
        channel: 'session-records:changed',
        data: { sessionId: 's1', record: { ...base('s1'), resumable: false } },
      },
      { channel: 'session-records:changed', data: { sessionId: 's1', record: null } },
    ])
  })
})

describe('whether a conversation can still be resumed', () => {
  let transcript: string

  beforeEach(() => {
    transcript = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-transcript-')), 'c.jsonl')
    fs.writeFileSync(transcript, '{}')
  })

  it('is resumable while the transcript is there', async () => {
    store.records = [{ ...base('s1'), agent: conversation(transcript) }]
    const result = (await invoke('session-records:list')) as {
      data: Array<{ resumable: boolean }>
    }
    expect(result.data[0].resumable).toBe(true)
  })

  it('is not resumable once the transcript has gone', async () => {
    store.records = [{ ...base('s1'), agent: conversation(transcript) }]
    fs.rmSync(transcript)
    const result = (await invoke('session-records:list')) as {
      data: Array<{ resumable: boolean }>
    }
    expect(result.data[0].resumable).toBe(false)
  })

  // The transcript belongs to the agent: it can go at any moment, including
  // between two looks at Home. The answer has to follow the file system rather
  // than whatever the first list happened to say.
  it('stops being resumable between one list and the next', async () => {
    store.records = [{ ...base('s1'), agent: conversation(transcript) }]
    const list = async () =>
      ((await invoke('session-records:list')) as { data: Array<{ resumable: boolean }> }).data[0]
        .resumable
    expect(await list()).toBe(true)
    fs.rmSync(transcript)
    expect(await list()).toBe(false)
  })

  it('is not resumable when there was never a conversation', async () => {
    store.records = [base('s1')]
    const result = (await invoke('session-records:list')) as {
      data: Array<{ resumable: boolean }>
    }
    expect(result.data[0].resumable).toBe(false)
  })

  it('says so on a pushed change too', () => {
    store.change?.('s1', { ...base('s1'), agent: conversation(transcript) })
    const pushed = sent.at(-1)?.data as { record: { resumable: boolean } }
    expect(pushed.record.resumable).toBe(true)
  })

  it('says nothing extra when a record is pushed as gone', () => {
    store.change?.('s1', null)
    expect(sent.at(-1)?.data).toEqual({ sessionId: 's1', record: null })
  })
})

describe('session-records:transfer', () => {
  it('moves a record to the resumed session', async () => {
    store.transfer.mockResolvedValue(base('s2'))
    const result = await invoke('session-records:transfer', {
      fromSessionId: 's1',
      session: { ...SNAP, sessionId: 's2' },
    })
    expect(store.transfer).toHaveBeenCalledWith('s1', { ...SNAP, sessionId: 's2' })
    expect(result).toEqual({ data: { ...base('s2'), resumable: false } })
  })

  it('returns nothing when the old session had no record', async () => {
    store.transfer.mockResolvedValue(null)
    expect(
      await invoke('session-records:transfer', { fromSessionId: 's1', session: SNAP })
    ).toEqual({
      data: null,
    })
  })

  it('refuses a payload with no session to transfer to', async () => {
    const result = (await invoke('session-records:transfer', { fromSessionId: 's1' })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
    expect(store.transfer).not.toHaveBeenCalled()
  })

  it('forgets a record the operator removed from the list', async () => {
    store.forget.mockResolvedValue(true)
    expect(await invoke('session-records:forget', { sessionId: 's1' })).toEqual({ data: true })
    expect(store.forget).toHaveBeenCalledWith('s1')
  })

  it('says so when there was nothing to forget', async () => {
    store.forget.mockResolvedValue(false)
    expect(await invoke('session-records:forget', { sessionId: 'nope' })).toEqual({ data: false })
  })

  it('refuses a forget with no session', async () => {
    expect(await invoke('session-records:forget', { sessionId: '' })).toMatchObject({
      error: 'VALIDATION_ERROR',
    })
  })
})
