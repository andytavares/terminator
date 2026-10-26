import { tmpdir } from 'node:os'
import { it, expect, vi } from 'vitest'
import {
  createThreadSummarizer,
  SUMMARY_INSTRUCTION,
  type ThreadSummaryDeps,
  summaryPrompt,
  SUMMARY_COOLDOWN_MS,
  SUMMARY_TIMEOUT_MS,
} from '../../../src/main/home/thread-summary'
import type { ThreadSummaryInput } from '../../../src/shared/schemas/agent-usage.schema'

const THREAD: ThreadSummaryInput = {
  title: 'Retry uploads',
  ticketKey: 'TER-12',
  sessions: [
    {
      state: 'waiting for you',
      lastAssistantTexts: ['Tests pass.'],
      firstUserPrompt: 'Add a retry',
    },
  ],
  pullRequest: { number: 7, isDraft: true, checksLine: '2 of 3 checks passing' },
}

type RunOnce = ThreadSummaryDeps['runOnce']
const answered = (text: string): Awaited<ReturnType<RunOnce>> => ({
  text,
  stopReason: 'end_turn',
  sessionId: 's1',
})

function setup(text = 'It is waiting on review.') {
  let clock = 1_000_000
  const runOnce = vi.fn<RunOnce>(async () => answered(text))
  const summarize = createThreadSummarizer({
    runOnce,
    now: () => clock,
    ready: async () => {},
  })
  return { runOnce, summarize, advance: (ms: number) => (clock += ms) }
}

it('asks haiku with no tools, the instruction as system prompt and the thread as the prompt', async () => {
  const { runOnce, summarize } = setup()
  const result = await summarize(THREAD)
  expect(result).toEqual({ text: 'It is waiting on review.', generatedAt: expect.any(String) })
  expect(runOnce).toHaveBeenCalledWith({
    cwd: tmpdir(),
    prompt: expect.stringContaining('Pull request #7 (draft): 2 of 3 checks passing'),
    mode: 'default',
    agentMeta: {
      claudeCode: {
        options: {
          model: 'claude-haiku-5-5',
          tools: [],
          systemPrompt: SUMMARY_INSTRUCTION,
          persistSession: false,
        },
      },
    },
    timeoutMs: SUMMARY_TIMEOUT_MS,
  })
  expect(runOnce.mock.calls[0][0].prompt).toContain('Said: Tests pass.')
})

it('starts the prompt with the instruction, for an agent that ignores the system prompt', async () => {
  const { runOnce, summarize } = setup()
  await summarize(THREAD)
  expect(runOnce.mock.calls[0][0].prompt.startsWith(SUMMARY_INSTRUCTION)).toBe(true)
})

it('answers the same inputs from the cache', async () => {
  const { runOnce, summarize } = setup()
  const first = await summarize(THREAD)
  expect(await summarize(THREAD)).toBe(first)
  expect(runOnce).toHaveBeenCalledTimes(1)
})

it('shares one run between simultaneous requests for the same inputs', async () => {
  const { runOnce, summarize } = setup()
  const [a, b] = await Promise.all([summarize(THREAD), summarize(THREAD)])
  expect(a).toBe(b)
  expect(runOnce).toHaveBeenCalledTimes(1)
})

it('keeps the latest summary for a thread until the cooldown ends, then writes a new one', async () => {
  const { runOnce, summarize, advance } = setup()
  const changed = { ...THREAD, title: 'Retry uploads, again', ticketKey: 'TER-12' }
  const first = await summarize(THREAD)
  advance(SUMMARY_COOLDOWN_MS - 1)
  expect(await summarize(changed)).toBe(first)
  expect(runOnce).toHaveBeenCalledTimes(1)
  advance(2)
  await summarize(changed)
  expect(runOnce).toHaveBeenCalledTimes(2)
})

it('does not hold different threads to one cooldown', async () => {
  const { runOnce, summarize } = setup()
  await summarize(THREAD)
  await summarize({ ...THREAD, ticketKey: 'TER-99' })
  expect(runOnce).toHaveBeenCalledTimes(2)
})

it.each([
  [
    { error: 'TIMEOUT', message: 'raw' },
    'Could not write a summary: the agent took too long to answer',
  ],
  [
    { error: 'AGENT_UNAVAILABLE', message: 'raw' },
    'Could not write a summary: the agent is not installed or did not start',
  ],
  [
    { error: 'OTHER', message: 'raw' },
    'Could not write a summary: the agent stopped with an error',
  ],
  [answered('  '), 'Could not write a summary: the agent stopped with an error'],
])('says in plain words when it fails (%o), and retries next time', async (failure, message) => {
  const { runOnce, summarize } = setup()
  runOnce.mockResolvedValueOnce(failure)
  expect(await summarize(THREAD)).toEqual({ error: message })
  expect('text' in (await summarize(THREAD))).toBe(true)
  expect(runOnce).toHaveBeenCalledTimes(2)
})

it('leaves out absent parts of the thread', () => {
  const prompt = summaryPrompt({ title: 'Solo', sessions: [] })
  expect(prompt).toBe(`${SUMMARY_INSTRUCTION}\n\nWork: Solo`)
})
