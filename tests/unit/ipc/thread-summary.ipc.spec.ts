import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThreadSummaryInputSchema } from '../../../src/shared/schemas/agent-usage.schema'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const summarize = vi.hoisted(() => vi.fn())
const runOnce = vi.hoisted(() => vi.fn())
const summarizerDeps = vi.hoisted(() => [] as Array<{ runOnce: (input: object) => unknown }>)
const records = vi.hoisted(() => [] as unknown[])

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('../../../src/main/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('../../../src/main/home/thread-summary', () => ({
  createThreadSummarizer: (deps: { runOnce: (input: object) => unknown }) => {
    summarizerDeps.push(deps)
    return summarize
  },
}))
vi.mock('../../../src/main/agents/acp/agent-service-instance', () => ({
  agentService: () => ({ runOnce }),
}))
vi.mock('../../../src/main/shell/login-shell-path', () => ({ loginShellPathReady: vi.fn() }))
vi.mock('../../../src/main/sessions/session-record-store', () => ({ listRecords: () => records }))

const TRANSCRIPT = path.resolve(__dirname, '../../fixtures/transcripts/sample-transcript.jsonl')
const recordOf = (sessionId: string, transcriptPath: string) => ({
  sessionId,
  agent: { provider: 'claude', sessionId: 'c1', transcriptPath, cwd: '/', capturedAt: '' },
})

async function summarizeWith(
  sessions: Array<{ sessionId?: string; lastAssistantTexts: string[] }>
) {
  vi.resetModules()
  const ipc = await import('../../../src/main/ipc/thread-summary.ipc')
  ipc.registerThreadSummaryHandler()
  const input = {
    title: 'Retry uploads',
    sessions: sessions.map((s) => ({ state: 'working', firstUserPrompt: 'given', ...s })),
  }
  await handlers.get('home:thread-summary')!({}, input)
  return summarize.mock.calls[0][0].sessions as Array<{
    firstUserPrompt: string | null
    lastAssistantTexts: string[]
  }>
}

beforeEach(() => {
  summarize.mockReset().mockResolvedValue({ summary: 'ok' })
  records.length = 0
})

describe('thread summary input', () => {
  it('accepts a session id on a session', () => {
    const parsed = ThreadSummaryInputSchema.parse({
      title: 't',
      sessions: [
        { sessionId: 's1', state: 'working', lastAssistantTexts: [], firstUserPrompt: null },
      ],
    })
    expect(parsed.sessions[0].sessionId).toBe('s1')
  })

  it('refuses more than twenty sessions', () => {
    const session = { state: 'idle', lastAssistantTexts: [], firstUserPrompt: null }
    const sessionsOf = (count: number) => ({ title: 't', sessions: Array(count).fill(session) })
    expect(ThreadSummaryInputSchema.safeParse(sessionsOf(20)).success).toBe(true)
    expect(ThreadSummaryInputSchema.safeParse(sessionsOf(21)).success).toBe(false)
  })
})

describe('home:thread-summary agent', () => {
  it('summarizes through the agent service', async () => {
    vi.resetModules()
    summarizerDeps.length = 0
    await import('../../../src/main/ipc/thread-summary.ipc')
    runOnce.mockResolvedValue({ text: 'ok', stopReason: 'end_turn', sessionId: 's' })
    await expect(summarizerDeps[0].runOnce({ prompt: 'p' })).resolves.toMatchObject({ text: 'ok' })
    expect(runOnce).toHaveBeenCalledWith({ prompt: 'p' })
  })
})

describe('home:thread-summary', () => {
  it('fills the opening prompt and last words from the session record transcript', async () => {
    records.push(recordOf('s1', TRANSCRIPT))
    const [session] = await summarizeWith([
      { sessionId: 's1', lastAssistantTexts: ['latest line'] },
    ])
    expect(session.firstUserPrompt).toContain('add a retry to the upload client')
    expect(session.lastAssistantTexts).toEqual([
      'I will start with the upload client.',
      'The retry is in and the tests pass.',
      'Done.',
    ])
  })

  it('keeps the given texts without a record, a transcript or a readable file', async () => {
    records.push(recordOf('s3', '/no/such/transcript.jsonl'))
    const sessions = await summarizeWith([
      { lastAssistantTexts: ['no id'] },
      { sessionId: 's2', lastAssistantTexts: ['no record'] },
      { sessionId: 's3', lastAssistantTexts: ['unreadable'] },
    ])
    expect(sessions.map((s) => [s.firstUserPrompt, s.lastAssistantTexts])).toEqual([
      ['given', ['no id']],
      ['given', ['no record']],
      ['given', ['unreadable']],
    ])
  })
})
