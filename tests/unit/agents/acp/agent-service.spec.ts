import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentPermissionAsk, AgentUpdate, StartAgentInput } from '@terminator/extension-sdk'
import {
  createAgentService,
  type AgentLink,
  type AgentServiceDeps,
} from '../../../../src/main/agents/acp/agent-service'
import { partialFake } from '../../../support/fakes'
import { createAgentLog } from '../../../../src/main/agents/acp/agent-log'
import { makeTempDir } from '../../../support/temp-dir'
import { fakeConnector, SESSION_ID, type FakeAgent } from './fake-agent'

const turns = vi.hoisted(() => ({ setTurn: vi.fn(), clearTurn: vi.fn() }))
const asks = vi.hoisted(() => ({ raiseAsk: vi.fn(), clearAsk: vi.fn() }))
vi.mock('../../../../src/main/logger', () => ({
  makeLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../../../../src/main/agents/agent-turns', () => turns)
vi.mock('../../../../src/main/agents/ask-watcher', () => asks)

const OPTIONS = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' as const },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' as const },
]

const recordTab = vi.fn()

function serviceWith(connect: AgentServiceDeps['connect'], broadcast = vi.fn()) {
  return createAgentService({
    startTimeoutMs: 50,
    connect,
    listAgents: () => [{ id: 'claude', label: 'Claude Code' }],
    defaultAgentId: () => 'claude',
    agentMeta: async ({ meta }) => meta ?? {},
    log: createAgentLog({ directory: makeTempDir('agent-service-'), now: () => 1 }),
    scratchDirectory: makeTempDir('agent-scratch-'),
    scrollbackLimit: () => 5000,
    broadcast,
    recordTab,
    now: () => 0,
  })
}

function setup() {
  const fakes = fakeConnector()
  const broadcast = vi.fn()
  return { ...fakes, broadcast, service: serviceWith(fakes.connect, broadcast) }
}

async function started(input: StartAgentInput = { cwd: '/work' }) {
  const context = setup()
  const result = await context.service.start(input)
  if (!result) throw new Error('the fake agent did not start')
  return { ...context, sessionId: result.sessionId, agent: context.agents[0], result }
}

type Started = Awaited<ReturnType<typeof started>>

/** The agent asks to write a file; resolves with the ask the service raised and the outcome. */
async function askedOf({ service, agent, sessionId }: Started) {
  const raised = new Promise<AgentPermissionAsk>((resolve) =>
    service.onPermission(sessionId, resolve)
  )
  const outcome = agent.toClient.requestPermission({
    sessionId: SESSION_ID,
    options: OPTIONS,
    toolCall: { toolCallId: 't1', title: 'Write a.txt', kind: 'edit', rawInput: { file: 'a.txt' } },
  })
  return { ask: await raised, outcome }
}

function chunk(agent: FakeAgent, text: string) {
  return agent.toClient.sessionUpdate({
    sessionId: SESSION_ID,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  })
}

beforeEach(() => vi.clearAllMocks())

describe('start', () => {
  it('returns the select options with the mode applied', async () => {
    const { result, agent } = await started({ cwd: '/work', mode: 'default' })
    expect(result.configOptions.map((option) => option.id)).toEqual(['mode', 'model'])
    expect(result.configOptions[0].currentValue).toBe('default')
    expect(agent.calls.find((call) => call.method === 'setSessionMode')?.params).toEqual({
      sessionId: SESSION_ID,
      modeId: 'default',
    })
  })

  it('flattens grouped choices', async () => {
    const { result } = await started()
    expect(result.configOptions[1].options).toEqual([
      { value: 'opus', name: 'Opus' },
      { value: 'haiku', name: 'Haiku' },
    ])
  })

  it('sends the agent meta with the new session', async () => {
    const meta = { claudeCode: { options: { model: 'haiku' } } }
    const { agent } = await started({ cwd: '/work', agentMeta: meta })
    expect(agent.calls.find((call) => call.method === 'newSession')?.params).toMatchObject({
      cwd: '/work',
      _meta: meta,
    })
  })
})

describe('start with a resume or a tab', () => {
  it('loads the session to resume it', async () => {
    const { agent, sessionId } = await started({ cwd: '/work', resume: 'old-session' })
    const methods = agent.calls.map((call) => call.method)
    expect(sessionId).toBe('old-session')
    expect(methods).toContain('loadSession')
    expect(methods).not.toContain('newSession')
  })

  it('opens a tab named by the session when asked', async () => {
    const tab = { projectId: 'p1', title: 'Fix' }
    const { broadcast } = await started({ cwd: '/work', tab })
    expect(broadcast).toHaveBeenCalledWith('terminal:adopt', {
      sessionId: SESSION_ID,
      projectId: 'p1',
      tabTitle: 'Fix',
      scrollbackLimit: 5000,
      surface: 'agent',
    })
  })
})

describe('start — recording a tab', () => {
  it('records the conversation of a session that has a tab', async () => {
    const tab = { projectId: 'p1', title: 'Fix' }
    await started({ cwd: '/work', tab })
    expect(recordTab).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      agentId: 'claude',
      cwd: '/work',
      tab,
    })
  })

  it('records nothing for a session without a tab', async () => {
    recordTab.mockClear()
    await started({ cwd: '/work' })
    expect(recordTab).not.toHaveBeenCalled()
  })

  it('returns null when the agent cannot start', async () => {
    const service = serviceWith(() => Promise.reject(new Error('no such file')))
    expect(await service.start({ cwd: '/work' })).toBeNull()
  })
})

describe('updates', () => {
  it('reach listeners, windows and the log', async () => {
    const { service, agent, broadcast, sessionId } = await started()
    const heard: AgentUpdate[] = []
    service.onUpdate(sessionId, (update) => heard.push(update))
    await chunk(agent, 'hi')
    const update = heard[0]
    expect(update.sessionUpdate).toBe('agent_message_chunk')
    expect(broadcast).toHaveBeenCalledWith('agents:update', { sessionId, update })
    expect(service.readHistory(sessionId)).toEqual([update])
  })

  it('stop reaching a listener once it is disposed', async () => {
    const { service, agent, sessionId } = await started()
    const heard: AgentUpdate[] = []
    const dispose = service.onUpdate(sessionId, (update) => heard.push(update))
    await chunk(agent, 'one')
    dispose()
    await chunk(agent, 'two')
    expect(heard).toHaveLength(1)
  })
})

describe('permission', () => {
  it('goes to the listener, the windows and the ask watcher', async () => {
    const context = await started()
    const { ask } = await askedOf(context)
    expect(ask).toMatchObject({ title: 'Write a.txt', kind: 'edit', rawInput: { file: 'a.txt' } })
    expect(context.broadcast).toHaveBeenCalledWith('agents:permission', {
      sessionId: context.sessionId,
      ask,
    })
    expect(asks.raiseAsk).toHaveBeenCalledWith(
      context.sessionId,
      expect.objectContaining({ message: 'Write a.txt' })
    )
    expect(context.service.openAsks()).toEqual([ask])
  })
})

describe('permission ask fields', () => {
  const meta = { claudeCode: { toolName: 'Write' } }

  it('carries the tool call id and the _meta its tool_call reported', async () => {
    const context = await started()
    await context.agent.toClient.sessionUpdate({
      sessionId: SESSION_ID,
      update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Write', _meta: meta },
    })
    const { ask } = await askedOf(context)
    expect(ask).toMatchObject({ toolCallId: 't1', toolCallMeta: meta })
  })

  it('has no _meta for a tool call that reported none', async () => {
    const { ask } = await askedOf(await started())
    expect(ask).toMatchObject({ toolCallId: 't1', toolCallMeta: null })
  })
})

describe('permission settled', () => {
  it('tells a listener when an ask is settled', async () => {
    const context = await started()
    const settled: string[] = []
    context.service.onPermissionSettled(context.sessionId, (id) => settled.push(id))
    const { ask } = await askedOf(context)
    await context.service.answer(context.sessionId, ask.requestId, 'allow')
    expect(settled).toEqual([ask.requestId])
  })

  it('stops telling a listener that was disposed', async () => {
    const context = await started()
    const settled: string[] = []
    const dispose = context.service.onPermissionSettled(context.sessionId, (id) => settled.push(id))
    dispose()
    const { ask } = await askedOf(context)
    await context.service.answer(context.sessionId, ask.requestId, 'allow')
    expect(settled).toEqual([])
  })
})

describe('permission answers', () => {
  it('is settled by the first answer only', async () => {
    const context = await started()
    const { service, sessionId, broadcast } = context
    const { ask, outcome } = await askedOf(context)
    expect(await service.answer(sessionId, ask.requestId, 'reject')).toBe(true)
    expect(await service.answer(sessionId, ask.requestId, 'allow')).toBe(false)
    expect(await outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } })
    expect(broadcast).toHaveBeenCalledWith('agents:permission-settled', {
      sessionId,
      requestId: ask.requestId,
    })
    expect(asks.clearAsk).toHaveBeenCalledWith(sessionId)
  })

  it('refuses an option it does not offer, and a null answer cancels', async () => {
    const context = await started()
    const { ask, outcome } = await askedOf(context)
    const { service, sessionId } = context
    expect(await service.answer(sessionId, ask.requestId, 'bogus')).toBe(false)
    expect(await service.answer(sessionId, ask.requestId, null)).toBe(true)
    expect(await outcome).toEqual({ outcome: { outcome: 'cancelled' } })
  })
})

describe('prompt', () => {
  it('marks the turn while it runs', async () => {
    const { service, agent, sessionId } = await started()
    agent.onPrompt = async () => {
      expect(turns.setTurn).toHaveBeenLastCalledWith(sessionId, true)
      return { stopReason: 'end_turn' }
    }
    expect(await service.prompt(sessionId, 'hello')).toEqual({ stopReason: 'end_turn' })
    expect(turns.setTurn).toHaveBeenLastCalledWith(sessionId, false)
  })

  it('answers error for an unknown session', async () => {
    expect(await setup().service.prompt('nope', 'hello')).toEqual({ stopReason: 'error' })
  })

  it('answers error when the agent fails', async () => {
    const { service, agent, sessionId } = await started()
    agent.onPrompt = () => Promise.reject(new Error('boom'))
    expect(await service.prompt(sessionId, 'hello')).toEqual({ stopReason: 'error' })
  })
})

describe('cancel, setConfig and models', () => {
  it('cancel tells the agent and cancels the open asks', async () => {
    const context = await started()
    const { outcome } = await askedOf(context)
    context.service.cancel(context.sessionId)
    expect(await outcome).toEqual({ outcome: { outcome: 'cancelled' } })
    await context.agent.cancelled
  })

  it('sets a known option and refuses an unknown one', async () => {
    const { service, agent, sessionId } = await started()
    expect(await service.setConfig(sessionId, 'model', 'haiku')).toBe(true)
    expect(await service.setConfig(sessionId, 'nope', 'x')).toBe(false)
    expect(agent.calls.filter((call) => call.method === 'setSessionConfigOption')).toHaveLength(1)
  })

  it('reads the model option once per agent from a throwaway session', async () => {
    const { service, agents } = setup()
    expect((await service.models())?.id).toBe('model')
    await service.models('claude')
    expect(agents).toHaveLength(1)
    expect(agents[0].killed).toBe(true)
  })
})

describe('close', () => {
  it('kills the process and closes the tab', async () => {
    const tab = { projectId: 'p', title: 't' }
    const { service, agent, broadcast, sessionId } = await started({ cwd: '/w', tab })
    await service.close(sessionId)
    expect(agent.killed).toBe(true)
    expect(broadcast).toHaveBeenCalledWith('terminal:close-tab', { sessionId })
    expect(turns.clearTurn).toHaveBeenCalledWith(sessionId)
  })

  it('closes no tab for a session without one', async () => {
    const { service, broadcast, sessionId } = await started()
    await service.close(sessionId)
    expect(broadcast).not.toHaveBeenCalledWith('terminal:close-tab', expect.anything())
  })

  it('disposeAll ends every agent', async () => {
    const { service, agent } = await started()
    await service.disposeAll()
    expect(agent.killed).toBe(true)
  })
})

describe('process exit', () => {
  it('tells listeners and the windows, and ends the turn', async () => {
    const { service, agent, broadcast, sessionId } = await started()
    const ended = new Promise<number | null>((resolve) => service.onEnd(sessionId, resolve))
    agent.exit(3)
    expect(await ended).toBe(3)
    expect(broadcast).toHaveBeenCalledWith('agents:end', { sessionId, exitCode: 3 })
    expect(turns.clearTurn).toHaveBeenCalledWith(sessionId)
    expect(await service.prompt(sessionId, 'again')).toEqual({ stopReason: 'error' })
  })

  it('rejects the open asks', async () => {
    const context = await started()
    const { ask, outcome } = await askedOf(context)
    context.agent.exit(1)
    expect(await outcome).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(asks.clearAsk).toHaveBeenCalledWith(context.sessionId)
    expect(await context.service.answer(context.sessionId, ask.requestId, 'allow')).toBe(false)
  })
})

describe('runOnce', () => {
  it('rejects every ask and returns the text of the reply', async () => {
    const { service, firstAgent } = setup()
    const run = service.runOnce({ cwd: '/w', prompt: 'say hi' })
    const agent = await firstAgent
    agent.onPrompt = async () => {
      const outcome = await askedOutcome(agent)
      expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } })
      await chunk(agent, 'Hel')
      await chunk(agent, 'lo')
      return { stopReason: 'end_turn' }
    }
    expect(await run).toEqual({ text: 'Hello', stopReason: 'end_turn', sessionId: SESSION_ID })
    expect(agent.killed).toBe(true)
  })

  it('cancels, closes and reports a time out', async () => {
    const { service, firstAgent } = setup()
    const run = service.runOnce({ cwd: '/w', prompt: 'slow', timeoutMs: 1 })
    const agent = await firstAgent
    agent.onPrompt = async () => {
      await agent.cancelled
      return { stopReason: 'cancelled' }
    }
    expect(await run).toMatchObject({ error: 'TIMEOUT' })
    expect(agent.killed).toBe(true)
  })
})

describe('runOnce cancelled by its caller', () => {
  it('names the session once it exists, so a cancel reaches the agent', async () => {
    const { service, firstAgent } = setup()
    const onStarted = vi.fn((sessionId: string) => service.cancel(sessionId))
    const run = service.runOnce({ cwd: '/w', prompt: 'slow', onStarted })
    const agent = await firstAgent
    agent.onPrompt = async () => {
      await agent.cancelled
      return { stopReason: 'cancelled' }
    }
    expect(await run).toMatchObject({ stopReason: 'cancelled', sessionId: SESSION_ID })
    expect(onStarted).toHaveBeenCalledWith(SESSION_ID)
    expect(agent.killed).toBe(true)
  })
})

describe('an agent that never answers', () => {
  it('is killed and reported unavailable once the start time runs out', async () => {
    const link = {
      agent: partialFake<AgentLink['agent']>({ initialize: () => new Promise(() => undefined) }),
      onExit: () => undefined,
      kill: vi.fn(),
    }
    const service = serviceWith(async () => link)
    expect(await service.runOnce({ cwd: '/w', prompt: 'x' })).toMatchObject({
      error: 'AGENT_UNAVAILABLE',
    })
    expect(link.kill).toHaveBeenCalled()
  })
})

describe('resuming a session that still runs', () => {
  it('takes it over: the old agent is closed, and its run cannot close the new one', async () => {
    const { service, firstAgent, agents } = setup()
    let started: (sessionId: string) => void = () => undefined
    const running = new Promise<string>((resolve) => (started = resolve))
    const run = service.runOnce({ cwd: '/w', prompt: 'slow', timeoutMs: 50, onStarted: started })
    const old = await firstAgent
    old.onPrompt = () => new Promise(() => undefined)
    await service.start({ cwd: '/w', resume: await running })
    expect(old.killed).toBe(true)
    expect(await run).toMatchObject({ error: 'TIMEOUT' })
    expect(agents[1].killed).toBe(false)
    expect(await service.prompt(SESSION_ID, 'still there?')).toEqual({ stopReason: 'end_turn' })
  })
})

describe('runOnce keeps no log', () => {
  it('writes nothing to the agent log for a session nobody can open', async () => {
    const { service, firstAgent } = setup()
    const run = service.runOnce({ cwd: '/w', prompt: 'say hi' })
    const agent = await firstAgent
    agent.onPrompt = async () => {
      await chunk(agent, 'hi')
      return { stopReason: 'end_turn' }
    }
    expect(await run).toMatchObject({ text: 'hi' })
    expect(service.readHistory(SESSION_ID)).toEqual([])
  })
})

describe('runOnce without an agent', () => {
  it('reports an agent that cannot start in plain words', async () => {
    const service = serviceWith(() => Promise.reject(new Error('spawn ENOENT')))
    expect(await service.runOnce({ cwd: '/w', prompt: 'x' })).toMatchObject({
      error: 'AGENT_UNAVAILABLE',
    })
  })
})

function askedOutcome(agent: FakeAgent) {
  return agent.toClient.requestPermission({
    sessionId: SESSION_ID,
    options: OPTIONS,
    toolCall: { toolCallId: 't2', title: 'Run ls', kind: 'execute' },
  })
}

describe('an agent that ignores a cancel', () => {
  it('still reports a time out and is killed', async () => {
    const { service, firstAgent } = setup()
    const run = service.runOnce({ cwd: '/w', prompt: 'stuck', timeoutMs: 1 })
    const agent = await firstAgent
    agent.onPrompt = () => new Promise(() => undefined)
    expect(await run).toMatchObject({ error: 'TIMEOUT' })
    expect(agent.killed).toBe(true)
  })
})

describe('an agent that never answers the mode', () => {
  it('is killed and reported not started once the start time runs out', async () => {
    const link = {
      agent: partialFake<AgentLink['agent']>({
        initialize: async () => ({}),
        newSession: async () => ({ sessionId: SESSION_ID }),
        setSessionMode: () => new Promise(() => undefined),
      }),
      onExit: () => undefined,
      kill: vi.fn(),
    }
    const service = serviceWith(async () => link)
    expect(await service.start({ cwd: '/w', mode: 'default' })).toBeNull()
    expect(link.kill).toHaveBeenCalled()
  })
})

describe('an agent that exits before its session opens', () => {
  it('is reported unavailable without waiting for the start time', async () => {
    const link = {
      agent: partialFake<AgentLink['agent']>({ initialize: () => new Promise(() => undefined) }),
      onExit: (listener: (code: number | null) => void) => listener(127),
      kill: vi.fn(),
    }
    const service = createAgentService({
      ...partialFake<AgentServiceDeps>({}),
      connect: async () => link,
      defaultAgentId: () => 'claude',
      startTimeoutMs: 60_000,
    })
    expect(await service.runOnce({ cwd: '/w', prompt: 'x' })).toMatchObject({
      error: 'AGENT_UNAVAILABLE',
    })
  })
})
