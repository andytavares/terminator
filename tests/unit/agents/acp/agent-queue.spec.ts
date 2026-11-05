import { describe, it, expect, vi } from 'vitest'
import type { PromptRequest } from '@agentclientprotocol/sdk'
import { createAgentService } from '../../../../src/main/agents/acp/agent-service'
import { createAgentLog } from '../../../../src/main/agents/acp/agent-log'
import { makeTempDir } from '../../../support/temp-dir'
import { eventually } from '../../../support/eventually'
import { fakeConnector, type FakeAgent } from './fake-agent'

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }))
vi.mock('../../../../src/main/logger', () => ({ makeLogger: () => log }))
vi.mock('../../../../src/main/agents/agent-turns', () => ({ setTurn: vi.fn(), clearTurn: vi.fn() }))
vi.mock('../../../../src/main/agents/ask-watcher', () => ({ raiseAsk: vi.fn(), clearAsk: vi.fn() }))

const textOf = (params: PromptRequest) => (params.prompt[0] as { text: string }).text

/** An agent whose turns each end with the next stop reason given, in order. */
function scriptedAgent(agent: FakeAgent, stopReasons: Array<'end_turn' | 'cancelled'>) {
  const texts: string[] = []
  agent.onPrompt = async (params) => {
    texts.push(textOf(params))
    return { stopReason: stopReasons.shift() ?? 'end_turn' }
  }
  return texts
}

async function started() {
  const fakes = fakeConnector()
  const broadcast = vi.fn()
  const service = createAgentService({
    connect: fakes.connect,
    listAgents: () => [{ id: 'claude', label: 'Claude Code' }],
    defaultAgentId: () => 'claude',
    log: createAgentLog({ directory: makeTempDir('agent-queue-'), now: () => 1 }),
    scratchDirectory: makeTempDir('agent-queue-scratch-'),
    scrollbackLimit: () => 5000,
    broadcast,
    recordTab: vi.fn(),
    now: () => 0,
  })
  const result = await service.start({ cwd: '/work' })
  if (!result) throw new Error('the fake agent did not start')
  return { service, broadcast, agent: fakes.agents[0], sessionId: result.sessionId }
}

describe('the follow-up queue', () => {
  it('sends the queued messages in order, each after the turn before it ended', async () => {
    const { service, agent, sessionId } = await started()
    const texts = scriptedAgent(agent, [])
    service.queueSet(sessionId, ['second', 'third'])
    await service.prompt(sessionId, 'first')
    await eventually(() => expect(texts).toEqual(['first', 'second', 'third']))
  })

  it('publishes each change of the queue', async () => {
    const { service, agent, broadcast, sessionId } = await started()
    scriptedAgent(agent, [])
    service.queueSet(sessionId, ['second'])
    await service.prompt(sessionId, 'first')
    await eventually(() =>
      expect(broadcast).toHaveBeenLastCalledWith('agents:queue', { sessionId, messages: [] })
    )
    expect(broadcast).toHaveBeenCalledWith('agents:queue', { sessionId, messages: ['second'] })
  })

  it('keeps the queue and sends nothing when Stop ends the turn', async () => {
    const { service, agent, broadcast, sessionId } = await started()
    const texts = scriptedAgent(agent, ['cancelled'])
    service.queueSet(sessionId, ['second'])
    expect(await service.prompt(sessionId, 'first')).toEqual({ stopReason: 'cancelled' })
    // The queue is read in the turn's own settle step, which ran before this await returned.
    expect(texts).toEqual(['first'])
    expect(broadcast).not.toHaveBeenCalledWith('agents:queue', { sessionId, messages: [] })
  })
})
