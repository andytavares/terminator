import { describe, it, expect, beforeEach, vi } from 'vitest'

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
  change: null as null | ((id: string, record: unknown) => void),
  setDescription: vi.fn(),
  setLink: vi.fn(),
}))

vi.mock('../../../src/main/sessions/session-record-store', () => ({
  listRecords: () => store.records,
  setDescription: store.setDescription,
  setLink: store.setLink,
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
    updatedAt: SNAP.startedAt,
    ...(closedAt ? { closedAt } : {}),
  }
}

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
    expect(result).toEqual({ data: base('s1') })
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
      { channel: 'session-records:changed', data: { sessionId: 's1', record: base('s1') } },
      { channel: 'session-records:changed', data: { sessionId: 's1', record: null } },
    ])
  })
})
