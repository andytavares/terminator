import { describe, it, expect } from 'vitest'
import { pruneRecords, RETENTION_MS } from '../../../../src/shared/session-records/retention'
import type { SessionRecord } from '../../../../src/shared/types/index'

const NOW = Date.parse('2026-09-15T12:00:00.000Z')

function record(sessionId: string, closedAt?: number): SessionRecord {
  return {
    sessionId,
    projectId: 'p',
    workspaceName: 'Personal',
    projectName: 'terminator',
    branch: 'main',
    tabTitle: 'zsh',
    shell: '/bin/zsh',
    description: 'why',
    agent: null,
    link: null,
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...(closedAt === undefined ? {} : { closedAt: new Date(closedAt).toISOString() }),
  }
}

describe('pruneRecords', () => {
  it('keeps a record that is still open, however old', () => {
    const open = { ...record('a'), updatedAt: '2020-01-01T00:00:00.000Z' }
    expect(pruneRecords([open], NOW, RETENTION_MS)).toEqual([open])
  })

  it('keeps a record closed exactly 30 days ago', () => {
    const edge = record('a', NOW - RETENTION_MS)
    expect(pruneRecords([edge], NOW, RETENTION_MS)).toEqual([edge])
  })

  it('drops a record closed 30 days and 1ms ago', () => {
    expect(pruneRecords([record('a', NOW - RETENTION_MS - 1)], NOW, RETENTION_MS)).toEqual([])
  })

  it('keeps survivors in their original order', () => {
    const records = [
      record('c', NOW - 1000),
      record('gone', NOW - RETENTION_MS - 1),
      record('a'),
      record('b', NOW - 5),
    ]
    expect(pruneRecords(records, NOW, RETENTION_MS).map((r) => r.sessionId)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('drops a closed record whose close time cannot be read', () => {
    const broken = { ...record('a'), closedAt: 'not a date' }
    expect(pruneRecords([broken], NOW, RETENTION_MS)).toEqual([])
  })
})

describe('pruneRecords — the retention it is given', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('keeps a record closed exactly one retention ago and drops one closed a moment earlier', () => {
    const edge = record('edge', NOW - DAY)
    const gone = record('gone', NOW - DAY - 1)
    expect(pruneRecords([edge, gone], NOW, DAY)).toEqual([edge])
  })

  it('keeps an open record whatever the retention', () => {
    const open = record('open')
    expect(pruneRecords([open], NOW, 1)).toEqual([open])
  })
})
