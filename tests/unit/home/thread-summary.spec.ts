import { it, expect, vi } from 'vitest'
import {
  createThreadSummarizer,
  summaryArgs,
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

function setup(stdout = 'It is waiting on review.') {
  let clock = 1_000_000
  const run = vi.fn(async () => ({
    exitCode: 0,
    stdout,
    stderr: '',
    timedOut: false,
    exceededMaxBuffer: false,
  }))
  const summarize = createThreadSummarizer({
    run,
    env: () => ({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_BRIDGE_SESSION_ID: 'x', HOME: '/h' }),
    now: () => clock,
    ready: async () => {},
  })
  return { run, summarize, advance: (ms: number) => (clock += ms) }
}

it('runs haiku with no tools, the instruction as system prompt and the thread on stdin', async () => {
  const { run, summarize } = setup()
  const result = await summarize(THREAD)
  expect(result).toEqual({ text: 'It is waiting on review.', generatedAt: expect.any(String) })
  const [input] = run.mock.calls[0] as unknown as [
    { args: string[]; input: string; timeoutMs: number },
  ]
  expect(input.args).toEqual(summaryArgs())
  expect(input.args).toContain('claude-haiku-5-5')
  expect(
    input.args.slice(input.args.indexOf('--tools'), input.args.indexOf('--tools') + 2)
  ).toEqual(['--tools', ''])
  expect(input.timeoutMs).toBe(SUMMARY_TIMEOUT_MS)
  expect(input.input).toContain('Pull request #7 (draft): 2 of 3 checks passing')
  expect(input.input).toContain('Said: Tests pass.')
})

it('strips the parent Claude session variables and keeps the rest', async () => {
  const { run, summarize } = setup()
  await summarize(THREAD)
  expect(run.mock.calls[0][1]).toEqual({ PATH: '/bin', HOME: '/h' })
})

it('answers the same inputs from the cache', async () => {
  const { run, summarize } = setup()
  const first = await summarize(THREAD)
  expect(await summarize(THREAD)).toBe(first)
  expect(run).toHaveBeenCalledTimes(1)
})

it('shares one run between simultaneous requests for the same inputs', async () => {
  const { run, summarize } = setup()
  const [a, b] = await Promise.all([summarize(THREAD), summarize(THREAD)])
  expect(a).toBe(b)
  expect(run).toHaveBeenCalledTimes(1)
})

it('keeps the latest summary for a thread until the cooldown ends, then writes a new one', async () => {
  const { run, summarize, advance } = setup()
  const changed = { ...THREAD, title: 'Retry uploads, again', ticketKey: 'TER-12' }
  const first = await summarize(THREAD)
  advance(SUMMARY_COOLDOWN_MS - 1)
  expect(await summarize(changed)).toBe(first)
  expect(run).toHaveBeenCalledTimes(1)
  advance(2)
  await summarize(changed)
  expect(run).toHaveBeenCalledTimes(2)
})

it('does not hold different threads to one cooldown', async () => {
  const { run, summarize } = setup()
  await summarize(THREAD)
  await summarize({ ...THREAD, ticketKey: 'TER-99' })
  expect(run).toHaveBeenCalledTimes(2)
})

it.each([
  [
    { timedOut: true, exitCode: 124, stderr: '' },
    'Could not write a summary: Claude Code took too long to answer',
  ],
  [
    { exitCode: 1, stderr: 'spawn claude ENOENT' },
    'Could not write a summary: Claude Code is not installed',
  ],
  [{ exitCode: 1, stderr: 'boom' }, 'Could not write a summary: Claude Code stopped with an error'],
  [{ exitCode: 0, stdout: '  ' }, 'Could not write a summary: Claude Code stopped with an error'],
])('says in plain words when it fails (%o), and retries next time', async (failure, message) => {
  const { run, summarize } = setup()
  run.mockResolvedValueOnce({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    exceededMaxBuffer: false,
    ...failure,
  })
  expect(await summarize(THREAD)).toEqual({ error: message })
  expect('text' in (await summarize(THREAD))).toBe(true)
  expect(run).toHaveBeenCalledTimes(2)
})

it('leaves out absent parts of the thread', () => {
  const prompt = summaryPrompt({ title: 'Solo', sessions: [] })
  expect(prompt).toBe('Work: Solo')
})
