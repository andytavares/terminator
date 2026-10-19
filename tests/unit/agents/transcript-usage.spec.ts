import { it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../support/temp-dir'
import {
  readTranscriptUsage,
  forgetTranscriptCache,
} from '../../../src/main/agents/transcript-usage'

const FIXTURE = path.resolve(__dirname, '../../fixtures/transcripts/sample-transcript.jsonl')

let dir: string
beforeEach(() => {
  dir = makeTempDir('usage-')
  forgetTranscriptCache()
})

function copyFixture(): string {
  const target = path.join(dir, 't.jsonl')
  fs.copyFileSync(FIXTURE, target)
  return target
}

function assistantLine(id: string | undefined, text: string, output: number): string {
  return (
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-10-07T00:00:00.000Z',
      message: {
        id,
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text }],
        usage: { input_tokens: 1, output_tokens: output },
      },
    }) + '\n'
  )
}

it('sums tokens per model and counts a repeated message id once', async () => {
  const usage = await readTranscriptUsage(copyFixture())
  expect(usage.byModel['claude-opus-5-5-20261001']).toEqual({
    input: 10,
    output: 100,
    cacheCreation: 1000,
    cacheRead: 2000,
  })
  expect(usage.byModel['claude-haiku-5-5'].output).toBe(50)
  expect(usage.byModel['mystery-model-1'].input).toBe(7)
})

it('returns the first user prompt, skipping tool results, and the assistant texts in order', async () => {
  const usage = await readTranscriptUsage(copyFixture())
  expect(usage.firstUserPrompt).toBe(
    'Please add a retry to the upload client so flaky networks stop failing the build.'
  )
  expect(usage.lastAssistantTexts).toEqual([
    'I will start with the upload client.',
    'The retry is in and the tests pass.',
    'Done.',
  ])
  expect(usage.firstTimestamp).toBe('2026-10-06T10:00:00.000Z')
  expect(usage.lastTimestamp).toBe('2026-10-06T10:00:11.000Z')
})

it('trims the prompt to 200 characters and each text to 600, keeping the last five', async () => {
  const file = path.join(dir, 'long.jsonl')
  const prompt = JSON.stringify({ type: 'user', message: { content: 'p'.repeat(300) } }) + '\n'
  const texts = Array.from({ length: 7 }, (_, i) => assistantLine(`m${i}`, `${i}`.repeat(700), 1))
  fs.writeFileSync(file, prompt + texts.join(''))
  const usage = await readTranscriptUsage(file)
  expect(usage.firstUserPrompt).toHaveLength(200)
  expect(usage.lastAssistantTexts).toHaveLength(5)
  expect(usage.lastAssistantTexts[0]).toBe('2'.repeat(600))
})

it('reads only the appended tail when the file grew, without double counting', async () => {
  const file = copyFixture()
  const before = await readTranscriptUsage(file)
  fs.appendFileSync(file, assistantLine('msg_new', 'More work.', 40))
  const after = await readTranscriptUsage(file)
  expect(after.byModel['claude-sonnet-5'].output).toBe(40)
  expect(after.byModel['claude-haiku-5-5']).toEqual(before.byModel['claude-haiku-5-5'])
  expect(after.lastAssistantTexts.at(-1)).toBe('More work.')
})

it('gives overlapping reads of a grown file the totals of one read', async () => {
  const file = copyFixture()
  await readTranscriptUsage(file)
  fs.appendFileSync(file, assistantLine(undefined, 'No id on this one.', 40))
  const [first, second] = await Promise.all([readTranscriptUsage(file), readTranscriptUsage(file)])
  expect(first.byModel['claude-sonnet-5'].output).toBe(40)
  expect(second.byModel['claude-sonnet-5'].output).toBe(40)
  expect(second.lastAssistantTexts.filter((t) => t === 'No id on this one.')).toHaveLength(1)
})

it('does not read an unchanged file again', async () => {
  const file = copyFixture()
  const first = await readTranscriptUsage(file)
  expect(await readTranscriptUsage(file)).toBe(first)
})

it('starts over when the file shrank', async () => {
  const file = copyFixture()
  await readTranscriptUsage(file)
  fs.writeFileSync(file, assistantLine('only', 'Fresh.', 9))
  const usage = await readTranscriptUsage(file)
  expect(Object.keys(usage.byModel)).toEqual(['claude-sonnet-5'])
  expect(usage.firstUserPrompt).toBeNull()
})

it('waits for a line still being written and ignores lines that are not JSON', async () => {
  const file = path.join(dir, 'partial.jsonl')
  const line = assistantLine('m1', 'Hello.', 5)
  fs.writeFileSync(file, 'not json\n' + line.slice(0, 40))
  expect((await readTranscriptUsage(file)).byModel).toEqual({})
  fs.appendFileSync(file, line.slice(40))
  expect((await readTranscriptUsage(file)).byModel['claude-sonnet-5'].output).toBe(5)
})

it('rejects when the file is missing', async () => {
  await expect(readTranscriptUsage(path.join(dir, 'gone.jsonl'))).rejects.toThrow()
})
