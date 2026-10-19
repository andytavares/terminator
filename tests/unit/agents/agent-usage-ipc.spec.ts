import { it, expect, beforeEach } from 'vitest'
import * as path from 'node:path'
import { collectAgentUsage } from '../../../src/main/ipc/agent-usage.ipc'
import { forgetTranscriptCache } from '../../../src/main/agents/transcript-usage'
import type { SessionRecord } from '../../../src/shared/types'

const FIXTURE = path.resolve(__dirname, '../../fixtures/transcripts/sample-transcript.jsonl')

function record(sessionId: string, transcriptPath: string | null): SessionRecord {
  return {
    sessionId,
    agent: transcriptPath && {
      provider: 'claude',
      sessionId: `agent-${sessionId}`,
      transcriptPath,
      cwd: '/',
      capturedAt: '2026-10-06T10:00:00.000Z',
    },
  } as unknown as SessionRecord
}

beforeEach(forgetTranscriptCache)

const records = [
  record('a', FIXTURE),
  record('b', FIXTURE),
  record('none', null),
  record('gone', '/no/such.jsonl'),
]

it('reports each session with an agent transcript it can read, with totals', async () => {
  const usage = await collectAgentUsage(records, {})
  expect(usage.sessions.map((s) => s.sessionId)).toEqual(['a', 'b'])
  const [a] = usage.sessions
  expect(a.tokens).toEqual({ input: 22, output: 153, cacheCreation: 1000, cacheRead: 2500 })
  expect(a.models).toEqual(['claude-opus-5-5-20261001', 'claude-haiku-5-5', 'mystery-model-1'])
  expect(a.costIsPartial).toBe(true)
  // opus 5.5: 10*4 + 100*20 + 1000*4*1.25 + 2000*0.2 ; haiku 5.5: 5*0.1 + 50*0.5 + 500*0.01 (per million)
  expect(a.costUsd).toBeCloseTo((40 + 2000 + 5000 + 400 + 0.5 + 25 + 5) / 1_000_000, 9)
  expect(usage.totals.tokens.output).toBe(306)
  expect(usage.totals.costUsd).toBeCloseTo(a.costUsd * 2, 9)
  expect(usage.totals.costIsPartial).toBe(true)
})

it('narrows to the sessions asked for', async () => {
  const usage = await collectAgentUsage(records, { sessionIds: ['b'] })
  expect(usage.sessions.map((s) => s.sessionId)).toEqual(['b'])
})

it('keeps a session only when its conversation overlaps the range', async () => {
  const during = await collectAgentUsage(records, {
    from: '2026-10-06T10:00:10.000Z',
    to: '2026-10-06T11:00:00.000Z',
  })
  expect(during.sessions).toHaveLength(2)
  const after = await collectAgentUsage(records, { from: '2026-10-07T00:00:00.000Z' })
  expect(after.sessions).toEqual([])
  const before = await collectAgentUsage(records, { to: '2026-10-06T09:00:00.000Z' })
  expect(before.sessions).toEqual([])
})
