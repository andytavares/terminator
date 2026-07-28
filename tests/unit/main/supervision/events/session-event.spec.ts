import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  SESSION_EVENT_KINDS,
  isSessionEvent,
  type SessionEvent,
} from '../../../../../src/main/supervision/events/session-event.js'

// The SessionEvent union is the contract every downstream consumer is written
// against (FR-003). Two things are asserted here: that each documented kind
// exists, and that the module stays free of agent-runtime types. The second is
// what makes SC-007 achievable — if an SDK type leaks into this file, a runtime
// upgrade stops being a one-module change.

const SOURCE_PATH = resolve(
  __dirname,
  '../../../../../src/main/supervision/events/session-event.ts'
)

describe('SessionEvent kinds (data-model.md §1)', () => {
  it('declares exactly the documented set of kinds', () => {
    expect([...SESSION_EVENT_KINDS].sort()).toEqual([
      'branch_merged',
      'diff_measured',
      'permission_requested',
      'permission_resolved',
      'session_ended',
      'session_started',
      'setup_finished',
      'tool_finished',
      'tool_started',
      'turn_finished',
    ])
  })
})

describe('isSessionEvent', () => {
  const started: SessionEvent = {
    kind: 'session_started',
    sessionId: 's1',
    transcriptPath: '/tmp/s1.jsonl',
    cwd: '/repo',
    at: 1_000,
  }

  it('accepts a well-formed event', () => {
    expect(isSessionEvent(started)).toBe(true)
  })

  it('rejects an unknown kind', () => {
    expect(isSessionEvent({ ...started, kind: 'not_a_kind' })).toBe(false)
  })

  it('rejects a missing sessionId', () => {
    expect(isSessionEvent({ ...started, sessionId: undefined })).toBe(false)
  })

  it('rejects a non-numeric timestamp, since every consumer is a function of (events, now)', () => {
    expect(isSessionEvent({ ...started, at: '1000' })).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(isSessionEvent(null)).toBe(false)
    expect(isSessionEvent('session_started')).toBe(false)
  })
})

describe('shell tool tracking (FR-015 — the long-running-command exemption)', () => {
  it('carries callId and isShell on tool_started so an in-flight command can be paired and excluded', () => {
    const e: SessionEvent = {
      kind: 'tool_started',
      sessionId: 's1',
      toolName: 'Bash',
      isShell: true,
      callId: 'c1',
      at: 2_000,
    }
    expect(isSessionEvent(e)).toBe(true)
    expect(e.callId).toBe('c1')
    expect(e.isShell).toBe(true)
  })

  it('carries the matching callId on tool_finished so the interval can be closed', () => {
    const e: SessionEvent = {
      kind: 'tool_finished',
      sessionId: 's1',
      callId: 'c1',
      ok: true,
      at: 3_000,
    }
    expect(isSessionEvent(e)).toBe(true)
    expect(e.callId).toBe('c1')
  })
})

describe('the neutral shape stays neutral (FR-002 – FR-004, SC-007)', () => {
  it('does not reference the agent SDK', () => {
    const source = readFileSync(SOURCE_PATH, 'utf-8')
    expect(source).not.toContain('@anthropic-ai')
  })

  it('imports nothing at all, so no runtime type can reach it transitively', () => {
    const source = readFileSync(SOURCE_PATH, 'utf-8')
    const imports = source.match(/^\s*import\s.+$/gm) ?? []
    expect(imports).toEqual([])
  })
})
