import { describe, it, expect } from 'vitest'
import {
  planCustomAction,
  MAX_TYPED_LINE_BYTES,
  type CustomRunEnv,
} from '../../../../src/quick-actions/custom-actions'
import type { CustomAction } from '../../../../../core-shared/src/types'

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

describe('planCustomAction — prompt actions — plans an input with bracketed paste and enter when the agent is idle', () => {
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

describe('planCustomAction — prompt actions on an agent tab', () => {
  const tab = { sessionId: 'tab1', isAgent: true, isAgentTab: true }

  it('plans a message for the agent, not typed keys', () => {
    const plan = planCustomAction(promptAction({ body: 'review {branch}' }), {
      focused: { ...tab, agentState: 'idle' },
      projectId: null,
      vars: { branch: 'main' },
    })
    expect(plan).toEqual({
      ok: true,
      kind: 'agent-prompt',
      sessionId: 'tab1',
      text: 'review main',
    })
  })
})

const idle = { sessionId: 's1', isAgent: true, agentState: 'idle' } as const

const REFUSALS: { refused: string; action: CustomAction; env: CustomRunEnv; reason: string }[] = [
  {
    refused: 'a prompt for the focused terminal with nothing focused',
    action: promptAction({ target: 'focused' }),
    env: { focused: null, projectId: null, vars: {} },
    reason: 'Focused terminal is not an agent session',
  },
  {
    refused: 'a prompt for a focused terminal that is not an agent',
    action: promptAction({ target: 'focused' }),
    env: { focused: { ...idle, isAgent: false }, projectId: null, vars: {} },
    reason: 'Focused terminal is not an agent session',
  },
  {
    refused: 'a prompt while the agent is mid-turn',
    action: promptAction({ target: 'agent' }),
    env: { focused: { ...idle, agentState: 'working' }, projectId: null, vars: {} },
    reason: 'The agent is mid-turn',
  },
  {
    refused: 'a prompt while the agent tab is mid-turn',
    action: promptAction(),
    env: {
      focused: { sessionId: 'tab1', isAgent: true, isAgentTab: true, agentState: 'working' },
      projectId: null,
      vars: {},
    },
    reason: 'The agent is mid-turn',
  },
  {
    refused: 'a shell action for the agent',
    action: shellAction({ target: 'agent' }),
    env: { focused: idle, projectId: null, vars: {} },
    reason: 'Shell actions cannot target an agent session',
  },
  {
    refused: 'a shell action for the focused terminal with nothing focused',
    action: shellAction({ target: 'focused' }),
    env: { focused: null, projectId: null, vars: {} },
    reason: 'No terminal focused',
  },
  {
    refused: 'a shell action for a focused agent session',
    action: shellAction({ target: 'focused' }),
    env: { focused: idle, projectId: null, vars: {} },
    reason: 'Focused terminal is running an agent, use a new tab',
  },
  {
    refused: 'a new-tab shell action with no branch focused',
    action: shellAction({ target: 'new-tab' }),
    env: { focused: null, projectId: null, vars: {} },
    reason: 'No branch focused',
  },
  {
    refused: 'a shell body over 1024 bytes after expansion',
    action: shellAction({ target: 'new-tab', body: 'x'.repeat(1025) }),
    env: { focused: null, projectId: 'p1', vars: {} },
    reason: 'Command is longer than 1024 bytes',
  },
]

describe('planCustomAction — refusals', () => {
  it.each(REFUSALS)('refuses $refused', ({ action, env, reason }) => {
    expect(planCustomAction(action, env)).toEqual({ ok: false, reason })
  })
})

describe('planCustomAction — shell actions — plans an input on the focused non-agent terminal', () => {
  it('plans an input on the focused non-agent terminal', () => {
    const plan = planCustomAction(shellAction({ target: 'focused', body: 'ls' }), {
      focused: { sessionId: 's1', isAgent: false, agentState: 'idle' },
      projectId: null,
      vars: {},
    })
    expect(plan).toEqual({ ok: true, kind: 'input', sessionId: 's1', data: 'ls\r' })
  })

  it('plans a new-tab shell action', () => {
    const plan = planCustomAction(shellAction({ target: 'new-tab', body: 'echo {branch}' }), {
      focused: null,
      projectId: 'p1',
      vars: { branch: 'feat/x' },
    })
    expect(plan).toEqual({ ok: true, kind: 'new-tab', projectId: 'p1', data: 'echo feat/x\r' })
  })
})

describe('planCustomAction — shell actions — accepts a shell body of exactly 1024 bytes', () => {
  it('accepts a shell body of exactly 1024 bytes', () => {
    const exact = 'x'.repeat(MAX_TYPED_LINE_BYTES)
    const plan = planCustomAction(shellAction({ target: 'new-tab', body: exact }), {
      focused: null,
      projectId: 'p1',
      vars: {},
    })
    expect(plan.ok).toBe(true)
  })
})

describe('planCustomAction — shell actions — counts multi-byte characters correctly: under 1024 chars but over 1024 bytes is refused', () => {
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
