import { describe, it, expect, vi } from 'vitest'
import { buildCustomQuickActions } from '../../../../src/renderer/quick-actions/custom-runtime'
import type { CustomAction } from '../../../../src/shared/types'
import type { CustomRunEnv } from '../../../../src/renderer/quick-actions/custom-actions'
import { MAX_TYPED_LINE_BYTES } from '../../../../src/renderer/quick-actions/custom-actions'

function shellAction(overrides: Partial<CustomAction> = {}): CustomAction {
  return {
    id: 'a1',
    label: 'Run tests',
    mnemonic: 't',
    kind: 'shell',
    target: 'new-tab',
    body: 'npx vitest run',
    ...overrides,
  }
}

function promptAction(overrides: Partial<CustomAction> = {}): CustomAction {
  return {
    id: 'a2',
    label: 'Ask Claude',
    mnemonic: 'r',
    kind: 'prompt',
    target: 'agent',
    body: 'review this',
    ...overrides,
  }
}

function makeDeps() {
  return {
    input: vi.fn(),
    openTab: vi.fn().mockResolvedValue('new-session-id'),
    notify: vi.fn(),
  }
}

function makeEnv(overrides: Partial<CustomRunEnv> = {}): CustomRunEnv {
  return {
    focused: { sessionId: 's1', isAgent: true, agentState: 'idle' },
    projectId: 'p1',
    vars: { branch: 'main' },
    ...overrides,
  }
}

describe('buildCustomQuickActions', () => {
  it('builds a QuickAction per custom action with id, group and description', () => {
    const actions = buildCustomQuickActions([shellAction()], makeEnv(), makeDeps())
    expect(actions).toHaveLength(1)
    expect(actions[0].id).toBe('custom:a1')
    expect(actions[0].group).toBe('custom')
    expect(actions[0].mnemonic).toBe('t')
    expect(actions[0].description).toBe('shell · new tab')
  })

  it('describes a prompt targeting the agent', () => {
    const actions = buildCustomQuickActions([promptAction()], makeEnv(), makeDeps())
    expect(actions[0].description).toBe('prompt · Claude')
  })

  it('precomputes a disabledReason when the plan is not ok', () => {
    const env = makeEnv({ focused: null, projectId: null })
    const actions = buildCustomQuickActions([shellAction({ target: 'new-tab' })], env, makeDeps())
    expect(actions[0].disabledReason).toBe('No branch focused')
  })

  it('leaves disabledReason unset when the plan is ok', () => {
    const actions = buildCustomQuickActions([shellAction()], makeEnv(), makeDeps())
    expect(actions[0].disabledReason).toBeUndefined()
  })

  it('re-plans at run time and refuses when state changed since the panel opened', () => {
    const deps = makeDeps()
    const env = makeEnv({ focused: { sessionId: 's1', isAgent: true, agentState: 'idle' } })
    const actions = buildCustomQuickActions([promptAction({ target: 'agent' })], env, deps)

    // Agent became 'working' after the panel opened, before Enter was pressed.
    env.focused = { sessionId: 's1', isAgent: true, agentState: 'working' }
    void actions[0].run()

    expect(deps.notify).toHaveBeenCalledWith('Claude is mid-turn')
    expect(deps.input).not.toHaveBeenCalled()
  })

  it('runs an input plan by calling deps.input', async () => {
    const deps = makeDeps()
    const env = makeEnv({ focused: { sessionId: 's1', isAgent: false, agentState: 'idle' } })
    const actions = buildCustomQuickActions(
      [shellAction({ target: 'focused', body: 'ls' })],
      env,
      deps
    )
    await actions[0].run()
    expect(deps.input).toHaveBeenCalledWith('s1', 'ls\r')
  })

  it('runs a new-tab plan by opening a tab then writing to its session', async () => {
    const deps = makeDeps()
    const env = makeEnv({ focused: null, projectId: 'p1' })
    const actions = buildCustomQuickActions(
      [shellAction({ target: 'new-tab', body: 'echo {branch}' })],
      env,
      deps
    )
    await actions[0].run()
    expect(deps.openTab).toHaveBeenCalledWith('p1')
    expect(deps.input).toHaveBeenCalledWith('new-session-id', 'echo main\r')
  })

  it('never calls input for a shell body over 1024 bytes', async () => {
    const deps = makeDeps()
    const env = makeEnv({ focused: null, projectId: 'p1' })
    const long = 'x'.repeat(MAX_TYPED_LINE_BYTES + 1)
    const actions = buildCustomQuickActions(
      [shellAction({ target: 'new-tab', body: long })],
      env,
      deps
    )
    expect(actions[0].disabledReason).toBe(`Command is longer than ${MAX_TYPED_LINE_BYTES} bytes`)
    await actions[0].run()
    expect(deps.input).not.toHaveBeenCalled()
    expect(deps.openTab).not.toHaveBeenCalled()
    expect(deps.notify).toHaveBeenCalledWith(`Command is longer than ${MAX_TYPED_LINE_BYTES} bytes`)
  })

  it('sends bracketed-paste bytes for a prompt', async () => {
    const deps = makeDeps()
    const env = makeEnv({ focused: { sessionId: 's1', isAgent: true, agentState: 'idle' } })
    const actions = buildCustomQuickActions(
      [promptAction({ target: 'agent', body: 'hi {branch}' })],
      env,
      deps
    )
    await actions[0].run()
    expect(deps.input).toHaveBeenCalledWith('s1', '\x1b[200~hi main\x1b[201~\r')
  })

  it('orders global actions before workspace ones, in the order given by the caller', () => {
    const global = shellAction({ id: 'g1', label: 'Global' })
    const workspace = shellAction({ id: 'w1', label: 'Workspace' })
    const actions = buildCustomQuickActions([global, workspace], makeEnv(), makeDeps())
    expect(actions.map((a) => a.id)).toEqual(['custom:g1', 'custom:w1'])
  })
})
