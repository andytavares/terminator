import { describe, it, expect } from 'vitest'
import {
  askChangeOf,
  isFocusReport,
  parseAskReport,
  turnChangeOf,
} from '../../../../src/shared/agent-sessions/ask'

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

  it('accepts a prompt, which a UserPromptSubmit hook writes', () => {
    expect(report({ event: 'prompt', notificationType: undefined }).event).toBe('prompt')
  })

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

describe('a prompt', () => {
  it('lifts the ask: the operator just answered', () => {
    expect(askChangeOf(report({ event: 'prompt' }))).toEqual({ kind: 'clear' })
  })
})

describe('turnChangeOf', () => {
  it('starts a turn on a prompt, ends it on a stop, and leaves it on a notification', () => {
    expect(turnChangeOf(report({ event: 'prompt' }))).toBe(true)
    expect(turnChangeOf(report({ event: 'stop' }))).toBe(false)
    expect(turnChangeOf(report())).toBeNull()
  })
})

describe('isFocusReport', () => {
  it('is true for the terminal reporting focus in or out, false for a keystroke', () => {
    expect(isFocusReport('\x1b[I')).toBe(true)
    expect(isFocusReport('\x1b[O')).toBe(true)
    expect(isFocusReport('y')).toBe(false)
  })
})
