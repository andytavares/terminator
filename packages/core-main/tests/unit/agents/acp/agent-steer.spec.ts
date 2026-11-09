import { describe, it, expect, vi } from 'vitest'
import type { PromptRequest } from '@agentclientprotocol/sdk/unstable'
import { createAgentService } from '../../../../src/agents/acp/agent-service'
import { createAgentLog } from '../../../../src/agents/acp/agent-log'
import { makeTempDir } from '../../../../../test-support/src/temp-dir'
import { eventually } from '../../../../../test-support/src/eventually'
import { fakeConnector, type Advertised } from './fake-agent'

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }))
vi.mock('../../../../src/logger', () => ({ makeLogger: () => log }))
vi.mock('../../../../src/agents/agent-turns', () => ({ setTurn: vi.fn(), clearTurn: vi.fn() }))
vi.mock('../../../../src/agents/ask-watcher', () => ({ raiseAsk: vi.fn(), clearAsk: vi.fn() }))

async function started(advertised: Advertised) {
  const fakes = fakeConnector({}, advertised)
  const service = createAgentService({
    connect: fakes.connect,
    listAgents: () => [{ id: 'claude', label: 'Claude Code' }],
    defaultAgentId: () => 'claude',
    log: createAgentLog({ directory: makeTempDir('agent-steer-'), now: () => 1 }),
    scratchDirectory: makeTempDir('agent-steer-scratch-'),
    scrollbackLimit: () => 5000,
    broadcast: vi.fn(),
    recordTab: vi.fn(),
    now: () => 0,
  })
  const result = await service.start({ cwd: '/work' })
  if (!result) throw new Error('the fake agent did not start')
  const agent = fakes.agents[0]
  // The first prompt stays open until `release`; later ones end at once.
  let release: () => void = () => undefined
  const texts: string[] = []
  const held = new Promise<void>((resolve) => (release = resolve))
  agent.onPrompt = async (params: PromptRequest) => {
    texts.push((params.prompt[0] as { text: string }).text)
    if (texts.length === 1) await held
    return { stopReason: texts.length === 1 ? 'cancelled' : 'end_turn' }
  }
  const methods = () => agent.calls.map((call) => call.method)
  return { service, agent, sessionId: result.sessionId, texts, release, methods }
}

describe('steer with steering advertised', () => {
  it('sends _session/steering into the running turn, with no cancel', async () => {
    const { service, agent, sessionId, texts, release, methods } = await started({
      image: true,
      steering: true,
    })
    const running = service.prompt(sessionId, 'first')
    await eventually(() => expect(texts).toEqual(['first']))
    await service.steer(sessionId, 'actually, do this')
    expect(agent.calls.find((call) => call.method === '_session/steering')?.params).toEqual({
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'actually, do this' }],
      _meta: { steering: { idleBehavior: 'promptRequired' } },
    })
    expect(methods()).not.toContain('cancel')
    expect(texts).toEqual(['first'])
    release()
    await running
  })
})

describe('steer into an idle session', () => {
  it('falls back to a prompt when the agent answers promptRequired', async () => {
    const { service, agent, sessionId, texts, release } = await started({
      image: true,
      steering: true,
    })
    agent.onSteer = async () => ({ outcome: 'promptRequired' })
    release()
    await service.steer(sessionId, 'now')
    await eventually(() => expect(texts).toEqual(['now']))
  })
})

describe('a steering request that fails', () => {
  it('cancels the running turn, then prompts, rather than sending a second prompt beside it', async () => {
    const { service, agent, sessionId, texts, release, methods } = await started({
      image: true,
      steering: true,
    })
    agent.onSteer = async () => {
      throw new Error('steering broke')
    }
    const running = service.prompt(sessionId, 'first')
    await eventually(() => expect(texts).toEqual(['first']))
    await service.steer(sessionId, 'instead')
    await eventually(() => expect(methods()).toContain('cancel'))
    expect(texts).toEqual(['first'])
    release()
    await running
    await eventually(() => expect(texts).toEqual(['first', 'instead']))
  })
})

describe('steer without steering advertised', () => {
  it('cancels, then prompts, when the agent does not advertise steering', async () => {
    const { service, agent, sessionId, texts, release, methods } = await started({
      image: true,
      steering: false,
    })
    const running = service.prompt(sessionId, 'first')
    await eventually(() => expect(texts).toEqual(['first']))
    await service.steer(sessionId, 'instead')
    await eventually(() => expect(methods()).toContain('cancel'))
    expect(methods()).not.toContain('_session/steering')
    expect(texts).toEqual(['first'])
    release()
    await running
    await eventually(() => expect(texts).toEqual(['first', 'instead']))
    expect(agent.calls.filter((call) => call.method === 'prompt')).toHaveLength(2)
  })
})
