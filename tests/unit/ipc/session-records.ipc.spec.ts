import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Issue, SessionRecord, SessionSnapshot } from '../../../src/shared/types/index'
import { RETENTION_MS } from '../../../src/shared/session-records/retention'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())

let userData: string

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))

// The trackers are the network; everything between the channel and the files is real.
const tracker = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../../src/main/integrations/index', () => ({
  getIssueService: () => tracker,
}))

const SNAP: SessionSnapshot = {
  sessionId: 's1',
  projectId: 'p1',
  workspaceName: null,
  projectName: null,
  branch: null,
  tabTitle: 'zsh',
  shell: null,
  startedAt: '2026-09-15T10:00:00.000Z',
}

const snap = (sessionId: string): SessionSnapshot => ({ ...SNAP, sessionId })

const NW_88: Issue = {
  tracker: 'linear',
  id: 'id-88',
  key: 'NW-88',
  title: 'Keep the session’s ticket',
  url: 'https://linear.app/nw/issue/NW-88',
  state: { name: 'In Progress', type: 'started' },
  assignee: null,
  description: 'Body',
  labels: [],
  branchName: null,
  completed: false,
  updatedAt: '2026-09-15T10:00:00.000Z',
  comments: [],
}

const conversation = (transcriptPath: string) => ({
  provider: 'claude' as const,
  sessionId: 'conv-1',
  transcriptPath,
  cwd: '/code/repo',
  capturedAt: SNAP.startedAt,
})

type Listing = SessionRecord & { resumable: boolean }

let records: typeof import('../../../src/main/sessions/session-record-store')
let sent: Array<{ channel: string; data: unknown }>
let window: unknown

const openWindow = () => ({
  isDestroyed: () => false,
  webContents: {
    isDestroyed: () => false,
    send: (channel: string, data: unknown) => sent.push({ channel, data }),
  },
})

async function register() {
  handlers.clear()
  const mod = await import('../../../src/main/ipc/session-records.ipc')
  mod.registerSessionRecordsHandlers(() => window as never)
}

async function invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  const handler = handlers.get(channel)
  if (handler === undefined) throw new Error(`no handler for ${channel}`)
  return (await handler({}, payload)) as T
}

const list = async () => (await invoke<{ data: Listing[] }>('session-records:list')).data

function contextFile(sessionId: string): string {
  return path.join(userData, 'integrations', 'session-context', `${sessionId}.json`)
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'session-records-ipc-'))
  sent = []
  window = openWindow()
  tracker.get.mockResolvedValue(NW_88)
  records = await import('../../../src/main/sessions/session-record-store')
  await register()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('session-records:list', () => {
  it('returns closed records newest first, then open ones', async () => {
    for (const id of ['open', 'older', 'recent']) await records.setDescription(snap(id), 'd')
    await records.markClosed('older', new Date(Date.now() - 60_000))
    await records.markClosed('recent', new Date(Date.now() - 1000))
    expect((await list()).map((r) => r.sessionId)).toEqual(['recent', 'older', 'open'])
  })

  it('keeps open records after closed ones whichever order they arrive in', async () => {
    for (const id of ['open-a', 'closed', 'open-b']) await records.setDescription(snap(id), 'd')
    await records.markClosed('closed', new Date(Date.now() - 1000))
    expect((await list()).map((r) => r.sessionId)).toEqual(['closed', 'open-a', 'open-b'])
  })

  // The store prunes when it writes; an application left open past retention
  // still has the record in memory, and the list must not show it.
  it('leaves out records that passed retention while the application was open', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await records.setDescription(SNAP, 'd')
    await records.markClosed('s1', new Date())
    vi.setSystemTime(Date.now() + RETENTION_MS + 1000)
    expect(await list()).toEqual([])
  })
})

describe('session-records:set-description', () => {
  it('writes the description and returns the record', async () => {
    const result = await invoke<{ data: Listing }>('session-records:set-description', {
      session: SNAP,
      description: 'why this terminal exists',
    })
    expect(result.data).toMatchObject({ ...SNAP, description: 'why this terminal exists' })
    expect((await list()).map((r) => r.description)).toEqual(['why this terminal exists'])
  })

  it('returns null data when the write removed the record', async () => {
    await records.setDescription(SNAP, 'd')
    const result = await invoke('session-records:set-description', {
      session: SNAP,
      description: null,
    })
    expect(result).toEqual({ data: null })
    expect(await list()).toEqual([])
  })

  it('reports a write to a closed record', async () => {
    await records.setDescription(SNAP, 'd')
    await records.markClosed('s1', new Date())
    const result = await invoke<{ error: string }>('session-records:set-description', {
      session: SNAP,
      description: 'later',
    })
    expect(result.error).toBe('RECORD_CLOSED')
  })

  // A file where the directory should be refuses the write whoever runs the test.
  it('reports a write the disk refused, with the reason', async () => {
    const blocker = path.join(userData, 'blocker')
    fs.writeFileSync(blocker, '')
    userData = path.join(blocker, 'user-data')
    const result = await invoke<{ error: string; message: string }>(
      'session-records:set-description',
      { session: SNAP, description: 'd' }
    )
    expect(result.error).toBe('ENOTDIR')
    expect(result.message).toContain('ENOTDIR')
  })
})

describe('registering without a window', () => {
  it('drops change events rather than throwing', async () => {
    window = null
    await expect(records.setDescription(SNAP, 'd')).resolves.not.toBeNull()
    expect(sent).toEqual([])
  })
})

describe('session-records:set-link', () => {
  it('writes a link to the session’s record', async () => {
    await invoke('session-records:set-link', {
      session: SNAP,
      link: { tracker: 'linear', key: 'NW-88' },
    })
    expect((await list())[0].link).toEqual({ tracker: 'linear', key: 'NW-88' })
  })

  it('removes the session link with null', async () => {
    await records.setLink(SNAP, { tracker: 'linear', key: 'NW-88' })
    const result = await invoke('session-records:set-link', { session: SNAP, link: null })
    expect(result).toEqual({ data: null })
    expect(await list()).toEqual([])
  })

  it('writes the session’s own agent context for the linked issue', async () => {
    await invoke('session-records:set-link', {
      session: SNAP,
      link: { tracker: 'linear', key: 'NW-88' },
    })
    expect(tracker.get).toHaveBeenCalledWith('linear', 'NW-88')
    expect(JSON.parse(fs.readFileSync(contextFile('s1'), 'utf8')).markdown).toContain('NW-88')
  })

  it('deletes the session’s agent context when the link is cleared', async () => {
    await invoke('session-records:set-link', {
      session: SNAP,
      link: { tracker: 'linear', key: 'NW-88' },
    })
    await invoke('session-records:set-link', { session: SNAP, link: null })
    expect(fs.existsSync(contextFile('s1'))).toBe(false)
  })

  it('reports a write to a closed record', async () => {
    await records.setDescription(SNAP, 'd')
    await records.markClosed('s1', new Date())
    const result = await invoke<{ error: string }>('session-records:set-link', {
      session: SNAP,
      link: null,
    })
    expect(result.error).toBe('RECORD_CLOSED')
  })
})

describe('session-records:changed', () => {
  it('forwards every store change to the window', async () => {
    const record = await records.setDescription(SNAP, 'd')
    await records.setDescription(SNAP, null)
    expect(sent).toEqual([
      {
        channel: 'session-records:changed',
        data: { sessionId: 's1', record: { ...record, resumable: false } },
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
    await records.setAgent(SNAP, conversation(transcript))
    expect((await list())[0].resumable).toBe(true)
  })

  it('is not resumable once the transcript has gone', async () => {
    await records.setAgent(SNAP, conversation(transcript))
    fs.rmSync(transcript)
    expect((await list())[0].resumable).toBe(false)
  })

  // The transcript belongs to the agent: it can go at any moment, including
  // between two looks at Home. The answer has to follow the file system rather
  // than whatever the first list happened to say.
  it('stops being resumable between one list and the next', async () => {
    await records.setAgent(SNAP, conversation(transcript))
    expect((await list())[0].resumable).toBe(true)
    fs.rmSync(transcript)
    expect((await list())[0].resumable).toBe(false)
  })

  it('is not resumable when there was never a conversation', async () => {
    await records.setDescription(SNAP, 'd')
    expect((await list())[0].resumable).toBe(false)
  })

  it('says so on a pushed change too', async () => {
    await records.setAgent(SNAP, conversation(transcript))
    const pushed = sent.at(-1)?.data as { record: { resumable: boolean } }
    expect(pushed.record.resumable).toBe(true)
  })

  it('says nothing extra when a record is pushed as gone', async () => {
    await records.setAgent(SNAP, conversation(transcript))
    await records.setAgent(SNAP, null)
    expect(sent.at(-1)?.data).toEqual({ sessionId: 's1', record: null })
  })
})

describe('session-records:transfer', () => {
  it('moves a record to the resumed session', async () => {
    await records.setDescription(SNAP, 'd')
    const result = await invoke<{ data: Listing }>('session-records:transfer', {
      fromSessionId: 's1',
      session: snap('s2'),
    })
    expect(result.data).toMatchObject({ sessionId: 's2', description: 'd', resumable: false })
    expect((await list()).map((r) => r.sessionId)).toEqual(['s2'])
  })

  it('returns nothing when the old session had no record', async () => {
    expect(
      await invoke('session-records:transfer', { fromSessionId: 's1', session: snap('s2') })
    ).toEqual({ data: null })
  })
})

describe('session-records:forget', () => {
  it('forgets a record the operator removed from the list', async () => {
    await records.setDescription(SNAP, 'd')
    await records.markClosed('s1', new Date())
    expect(await invoke('session-records:forget', { sessionId: 's1' })).toEqual({ data: true })
    expect(await list()).toEqual([])
  })

  it('says so when there was nothing to forget', async () => {
    expect(await invoke('session-records:forget', { sessionId: 'nope' })).toEqual({ data: false })
  })
})
