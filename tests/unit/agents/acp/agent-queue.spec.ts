import { describe, it, expect, vi } from 'vitest'
import type { PromptRequest } from '@agentclientprotocol/sdk/unstable'
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

/** An agent whose first turn waits for `release`; later turns end at once. `overlapped` turns
 *  true when a prompt reaches it while the first turn is still running. */
function gatedAgent(agent: FakeAgent) {
  const texts: string[] = []
  const state = { overlapped: false, firstRunning: false }
  let release = (): void => undefined
  const gate = new Promise<void>((resolve) => (release = resolve))
  agent.onPrompt = async (params) => {
    texts.push(textOf(params))
    if (texts.length > 1) state.overlapped ||= state.firstRunning
    if (texts.length === 1) {
      state.firstRunning = true
      await gate
      state.firstRunning = false
    }
    return { stopReason: 'end_turn' }
  }
  return { texts, state, release: () => release() }
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
    const { texts, release } = gatedAgent(agent)
    const first = service.prompt(sessionId, 'first')
    await eventually(() => expect(texts).toEqual(['first']))
    service.queueSet(sessionId, ['second', 'third'])
    release()
    await first
    await eventually(() => expect(texts).toEqual(['first', 'second', 'third']))
  })

  it('publishes each change of the queue', async () => {
    const { service, agent, broadcast, sessionId } = await started()
    const { texts, release } = gatedAgent(agent)
    const first = service.prompt(sessionId, 'first')
    await eventually(() => expect(texts).toEqual(['first']))
    service.queueSet(sessionId, ['second'])
    release()
    await first
    await eventually(() =>
      expect(broadcast).toHaveBeenLastCalledWith('agents:queue', { sessionId, messages: [] })
    )
    expect(broadcast).toHaveBeenCalledWith('agents:queue', { sessionId, messages: ['second'] })
  })
})

describe('the follow-up queue while idle or reopened', () => {
  it('sends a message queued while no turn runs at once', async () => {
    const { service, agent, sessionId } = await started()
    const texts = scriptedAgent(agent, [])
    service.queueSet(sessionId, ['now'])
    await eventually(() => expect(texts).toEqual(['now']))
  })

  it('gives the current queue to a tab that opens later', async () => {
    const { service, agent, sessionId } = await started()
    const { texts, release } = gatedAgent(agent)
    const first = service.prompt(sessionId, 'first')
    await eventually(() => expect(texts).toEqual(['first']))
    service.queueSet(sessionId, ['later'])
    expect(service.queueOf(sessionId)).toEqual(['later'])
    release()
    await first
  })
})

describe('one turn at a time', () => {
  it('holds a prompt asked during a running turn until that turn ends', async () => {
    const { service, agent, sessionId } = await started()
    const { texts, state, release } = gatedAgent(agent)
    const first = service.prompt(sessionId, 'first')
    await eventually(() => expect(texts).toEqual(['first']))
    vi.useFakeTimers()
    const second = service.prompt(sessionId, 'second')
    // Settles every pending step: a prompt sent beside the first turn would reach the agent now.
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    release()
    await Promise.all([first, second])
    expect(texts).toEqual(['first', 'second'])
    expect(state.overlapped).toBe(false)
  })
})

describe('Stop', () => {
  it('keeps the queue and sends nothing when Stop ends the turn', async () => {
    const { service, agent, broadcast, sessionId } = await started()
    const texts: string[] = []
    let stop = (): void => undefined
    agent.onPrompt = async (params) => {
      texts.push(textOf(params))
      await new Promise<void>((resolve) => (stop = resolve))
      return { stopReason: 'cancelled' }
    }
    const first = service.prompt(sessionId, 'first')
    await eventually(() => expect(texts).toEqual(['first']))
    service.queueSet(sessionId, ['second'])
    stop()
    expect(await first).toEqual({ stopReason: 'cancelled' })
    expect(texts).toEqual(['first'])
    expect(broadcast).not.toHaveBeenCalledWith('agents:queue', { sessionId, messages: [] })
  })
})
