import { describe, it, expect } from 'vitest'
import {
  planCustomAction,
  MAX_TYPED_LINE_BYTES,
} from '../../../../src/renderer/quick-actions/custom-actions'
import type { CustomAction } from '../../../../src/shared/types'

function shellAction(overrides: Partial<CustomAction> = {}): CustomAction {
  return {
    id: 'custom-1',
    label: 'Echo',
    kind: 'shell',
    target: 'focused',
    body: 'echo hi',
    ...overrides,
  }
}

function promptAction(overrides: Partial<CustomAction> = {}): CustomAction {
  return {
    id: 'custom-2',
    label: 'Ask',
    kind: 'prompt',
    target: 'agent',
    body: 'do the thing',
    ...overrides,
  }
}

describe('planCustomAction — variable expansion', () => {
  it('fails with the variable reason when expansion fails', () => {
    const plan = planCustomAction(shellAction({ body: 'cd {cwd}' }), {
      focused: { sessionId: 's1', isAgent: false, agentState: 'idle' },
      projectId: 'p1',
      vars: {},
    })
    expect(plan).toEqual({ ok: false, reason: 'No working directory' })
  })
})

describe('planCustomAction — prompt actions', () => {
  it('refuses a prompt targeting the focused terminal when nothing is focused', () => {
    const plan = planCustomAction(promptAction({ target: 'focused' }), {
      focused: null,
      projectId: null,
      vars: {},
    })
    expect(plan).toEqual({ ok: false, reason: 'Focused terminal is not a Claude session' })
  })

  it('refuses a prompt when the focused terminal is not an agent', () => {
    const plan = planCustomAction(promptAction({ target: 'focused' }), {
      focused: { sessionId: 's1', isAgent: false, agentState: 'idle' },
      projectId: null,
      vars: {},
    })
    expect(plan).toEqual({ ok: false, reason: 'Focused terminal is not a Claude session' })
  })

  it('refuses a prompt when the agent is mid-turn', () => {
    const plan = planCustomAction(promptAction({ target: 'agent' }), {
      focused: { sessionId: 's1', isAgent: true, agentState: 'working' },
      projectId: null,
      vars: {},
    })
    expect(plan).toEqual({ ok: false, reason: 'Claude is mid-turn' })
  })

  it('plans an input with bracketed paste and enter when the agent is idle', () => {
    const plan = planCustomAction(promptAction({ body: 'hello {branch}' }), {
      focused: { sessionId: 's1', isAgent: true, agentState: 'idle' },
      projectId: null,
      vars: { branch: 'main' },
    })
    expect(plan).toEqual({
      ok: true,
      kind: 'input',
      sessionId: 's1',
      data: '\x1b[200~hello main\x1b[201~\r',
    })
  })

  it('places no byte cap on prompts', () => {
    const long = 'x'.repeat(MAX_TYPED_LINE_BYTES + 500)
    const plan = planCustomAction(promptAction({ body: long }), {
      focused: { sessionId: 's1', isAgent: true, agentState: 'idle' },
      projectId: null,
      vars: {},
    })
    expect(plan.ok).toBe(true)
  })
})

describe('planCustomAction — shell actions', () => {
  it('refuses a shell action targeting the agent', () => {
    const plan = planCustomAction(shellAction({ target: 'agent' }), {
      focused: { sessionId: 's1', isAgent: true, agentState: 'idle' },
      projectId: null,
      vars: {},
    })
    expect(plan).toEqual({ ok: false, reason: 'Shell actions cannot target a Claude session' })
  })

  it('refuses a shell action targeting focused with no session focused', () => {
    const plan = planCustomAction(shellAction({ target: 'focused' }), {
      focused: null,
      projectId: null,
      vars: {},
    })
    expect(plan).toEqual({ ok: false, reason: 'No terminal focused' })
  })

  it('refuses a shell action targeting a focused agent session', () => {
    const plan = planCustomAction(shellAction({ target: 'focused' }), {
      focused: { sessionId: 's1', isAgent: true, agentState: 'idle' },
      projectId: null,
      vars: {},
    })
    expect(plan).toEqual({
      ok: false,
      reason: 'Focused terminal is running Claude, use a new tab',
    })
  })

  it('plans an input on the focused non-agent terminal', () => {
    const plan = planCustomAction(shellAction({ target: 'focused', body: 'ls' }), {
      focused: { sessionId: 's1', isAgent: false, agentState: 'idle' },
      projectId: null,
      vars: {},
    })
    expect(plan).toEqual({ ok: true, kind: 'input', sessionId: 's1', data: 'ls\r' })
  })

  it('refuses a new-tab shell action with no branch focused', () => {
    const plan = planCustomAction(shellAction({ target: 'new-tab' }), {
      focused: null,
      projectId: null,
      vars: {},
    })
    expect(plan).toEqual({ ok: false, reason: 'No branch focused' })
  })

  it('plans a new-tab shell action', () => {
    const plan = planCustomAction(shellAction({ target: 'new-tab', body: 'echo {branch}' }), {
      focused: null,
      projectId: 'p1',
      vars: { branch: 'feat/x' },
    })
    expect(plan).toEqual({ ok: true, kind: 'new-tab', projectId: 'p1', data: 'echo feat/x\r' })
  })

  it('refuses a shell body over 1024 bytes after expansion', () => {
    const long = 'x'.repeat(MAX_TYPED_LINE_BYTES + 1)
    const plan = planCustomAction(shellAction({ target: 'new-tab', body: long }), {
      focused: null,
      projectId: 'p1',
      vars: {},
    })
    expect(plan).toEqual({ ok: false, reason: 'Command is longer than 1024 bytes' })
  })

  it('accepts a shell body of exactly 1024 bytes', () => {
    const exact = 'x'.repeat(MAX_TYPED_LINE_BYTES)
    const plan = planCustomAction(shellAction({ target: 'new-tab', body: exact }), {
      focused: null,
      projectId: 'p1',
      vars: {},
    })
    expect(plan.ok).toBe(true)
  })

  it('counts multi-byte characters correctly: under 1024 chars but over 1024 bytes is refused', () => {
    // Each '€' is 3 bytes in UTF-8. 400 of them is 400 chars but 1200 bytes.
    const body = '€'.repeat(400)
    expect(body.length).toBeLessThan(MAX_TYPED_LINE_BYTES)
    const plan = planCustomAction(shellAction({ target: 'new-tab', body }), {
      focused: null,
      projectId: 'p1',
      vars: {},
    })
    expect(plan).toEqual({ ok: false, reason: 'Command is longer than 1024 bytes' })
  })
})
