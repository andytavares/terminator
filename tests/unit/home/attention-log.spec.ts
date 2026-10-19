import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../support/temp-dir'

let userData: string
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

async function load() {
  vi.resetModules()
  return import('../../../src/main/home/attention-log')
}

const report = (state: string, at: string, sessionId = 's1') =>
  ({ sessionId, projectId: 'p1', branch: 'main', workKey: 'TAV-1', state, at }) as never

beforeEach(() => {
  userData = makeTempDir('attention-log-')
})

const file = () => path.join(userData, 'attention-log.json')

describe('the attention log', () => {
  it('turns transitions into intervals, closing each with where it went', async () => {
    const log = await load()
    await log.recordState(report('working', '2026-10-18T09:00:00.000Z'))
    await log.recordState(report('awaiting-input', '2026-10-18T09:10:00.000Z'))
    await log.recordState(report('working', '2026-10-18T09:15:00.000Z'))
    await log.recordState(report('idle', '2026-10-18T09:30:00.000Z'))
    expect(log.listIntervals().map((i) => [i.state, i.start, i.end, i.next])).toEqual([
      ['working', '2026-10-18T09:00:00.000Z', '2026-10-18T09:10:00.000Z', 'awaiting-input'],
      ['awaiting-input', '2026-10-18T09:10:00.000Z', '2026-10-18T09:15:00.000Z', 'working'],
      ['working', '2026-10-18T09:15:00.000Z', '2026-10-18T09:30:00.000Z', 'idle'],
    ])
    expect(log.listIntervals()[0]).toMatchObject({
      projectId: 'p1',
      branch: 'main',
      workKey: 'TAV-1',
    })
  })

  it('ignores a repeat of the state a session is already in, and an idle with nothing open', async () => {
    const log = await load()
    await log.recordState(report('idle', '2026-10-18T08:00:00.000Z'))
    await log.recordState(report('working', '2026-10-18T09:00:00.000Z'))
    await log.recordState(report('working', '2026-10-18T09:05:00.000Z'))
    expect(log.listIntervals()).toHaveLength(1)
    expect(log.listIntervals()[0].end).toBeNull()
  })
})

describe('the attention log — sessions apart', () => {
  it('keeps sessions apart', async () => {
    const log = await load()
    await log.recordState(report('working', '2026-10-18T09:00:00.000Z', 'a'))
    await log.recordState(report('working', '2026-10-18T09:01:00.000Z', 'b'))
    await log.recordState(report('exited', '2026-10-18T09:02:00.000Z', 'a'))
    expect(log.listIntervals().map((i) => [i.sessionId, i.next])).toEqual([
      ['a', 'exited'],
      ['b', null],
    ])
  })
})

describe('the attention log — across restarts', () => {
  it('survives a restart, closing what was open at the last write', async () => {
    const log = await load()
    await log.recordState(report('awaiting-input', '2026-10-18T09:00:00.000Z'))
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'))
    expect(saved.intervals).toHaveLength(1)
    const again = await load()
    await again.loadAttentionLog()
    expect(again.listIntervals()).toEqual([
      expect.objectContaining({ state: 'awaiting-input', end: saved.savedAt, next: 'exited' }),
    ])
  })
})

describe('the attention log — retention', () => {
  it('drops intervals older than ninety days when it loads', async () => {
    const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
    const storedInterval = (sessionId: string, endDaysAgo: number) => ({
      sessionId,
      projectId: null,
      branch: null,
      workKey: null,
      state: 'working',
      start: daysAgoIso(endDaysAgo + 1),
      end: daysAgoIso(endDaysAgo),
      next: 'idle',
    })
    fs.writeFileSync(
      file(),
      JSON.stringify({
        savedAt: daysAgoIso(0),
        intervals: [storedInterval('old', 91), storedInterval('new', 89), { junk: 1 }],
      })
    )
    const log = await load()
    await log.loadAttentionLog()
    expect(log.listIntervals().map((i) => i.sessionId)).toEqual(['new'])
  })
})

describe('the attention log — unreadable file', () => {
  it('starts empty when the file is missing or garbled', async () => {
    fs.writeFileSync(file(), '{ nope')
    const log = await load()
    await log.loadAttentionLog()
    expect(log.listIntervals()).toEqual([])
  })
})
