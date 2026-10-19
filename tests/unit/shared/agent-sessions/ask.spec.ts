import { describe, it, expect } from 'vitest'
import { askChangeOf, parseAskReport } from '../../../../src/shared/agent-sessions/ask'

const report = (over: Record<string, unknown> = {}) =>
  parseAskReport({
    terminal: 't1',
    event: 'notification',
    message: 'Claude needs your permission to use Bash',
    notificationType: 'permission_prompt',
    at: '2026-10-18T10:00:00.000Z',
    ...over,
  })!

describe('parseAskReport', () => {
  it.each([[null], ['x'], [[]], [{}], [{ terminal: 't', event: 'other' }], [{ event: 'stop' }]])(
    'rejects %j',
    (value) => expect(parseAskReport(value)).toBeNull()
  )

  it('keeps a notification without a type', () => {
    expect(report({ notificationType: undefined }).notificationType).toBeNull()
  })
})

describe('askChangeOf', () => {
  it('raises an ask for a permission prompt, with its message and time', () => {
    expect(askChangeOf(report())).toEqual({
      kind: 'set',
      ask: {
        message: 'Claude needs your permission to use Bash',
        since: '2026-10-18T10:00:00.000Z',
      },
    })
  })

  it('raises an ask for an elicitation dialog and for an unknown or missing type', () => {
    for (const notificationType of ['elicitation_dialog', 'brand_new_kind', undefined]) {
      expect(askChangeOf(report({ notificationType })).kind).toBe('set')
    }
  })

  it('ignores idle, completed and auth notifications, and asks for agent_needs_input', () => {
    expect(askChangeOf(report({ notificationType: 'agent_completed' })).kind).toBe('ignore')
    expect(askChangeOf(report({ notificationType: 'agent_needs_input' })).kind).toBe('set')
    expect(askChangeOf(report({ notificationType: 'idle_prompt' })).kind).toBe('ignore')
    expect(askChangeOf(report({ notificationType: 'auth_success' })).kind).toBe('ignore')
  })

  it('lifts the ask on stop and on an answered elicitation', () => {
    expect(askChangeOf(report({ event: 'stop', notificationType: undefined }))).toEqual({
      kind: 'clear',
    })
    expect(askChangeOf(report({ notificationType: 'elicitation_response' })).kind).toBe('clear')
  })
})
