import { describe, it, expect } from 'vitest'
import { parseHookReport } from '../../../../src/shared/agent-sessions/report'

const FULL = {
  terminal: 'sess-1',
  provider: 'claude',
  sessionId: 'b610a882-41f3-4833-a6a3-dc3a33aea060',
  transcriptPath: '/Users/me/.claude/projects/slug/b610a882.jsonl',
  cwd: '/Users/me/code/repo',
  source: 'startup',
  at: '2026-09-15T18:00:00.000Z',
}

describe('parseHookReport', () => {
  it('reads a report the hook wrote', () => {
    expect(parseHookReport(FULL)).toEqual(FULL)
  })

  it.each([
    ['terminal', { ...FULL, terminal: undefined }],
    ['conversation id', { ...FULL, sessionId: '' }],
    ['transcript path', { ...FULL, transcriptPath: undefined }],
    ['folder', { ...FULL, cwd: null }],
  ])('refuses a report with no %s', (_field, payload) => {
    expect(parseHookReport(payload)).toBeNull()
  })

  it('refuses an agent whose conversations this cannot resume', () => {
    expect(parseHookReport({ ...FULL, provider: 'some-other-agent' })).toBeNull()
  })

  it.each([[null], [undefined], ['a string'], [42], [[]]])('refuses %s', (payload) => {
    expect(parseHookReport(payload)).toBeNull()
  })

  it('carries whether the conversation was started or resumed', () => {
    expect(parseHookReport({ ...FULL, source: 'resume' })?.source).toBe('resume')
  })

  it('records a source it does not recognise rather than refusing the report', () => {
    expect(parseHookReport({ ...FULL, source: 'clear' })?.source).toBe('clear')
  })

  it('stamps a report that arrived without a time', () => {
    const report = parseHookReport({ ...FULL, at: undefined })
    expect(Date.parse(report?.at ?? '')).not.toBeNaN()
  })
})
