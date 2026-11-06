import { describe, it, expect, vi } from 'vitest'
import type { AgentConversation } from '../../../../src/shared/types/index'
import { createAgentService } from '../../../../src/main/agents/acp/agent-service'
import { createAgentLog } from '../../../../src/main/agents/acp/agent-log'
import { makeTempDir } from '../../../support/temp-dir'
import { fakeConnector, type Advertised } from './fake-agent'

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }))
vi.mock('../../../../src/main/logger', () => ({ makeLogger: () => log }))
vi.mock('../../../../src/main/agents/agent-turns', () => ({ setTurn: vi.fn(), clearTurn: vi.fn() }))
vi.mock('../../../../src/main/agents/ask-watcher', () => ({ raiseAsk: vi.fn(), clearAsk: vi.fn() }))

const PICTURE = { mimeType: 'image/png', data: 'aGVsbG8=' }

function serviceOver(advertised: Advertised, conversations: AgentConversation[] = []) {
  const fakes = fakeConnector({}, advertised)
  const service = createAgentService({
    connect: fakes.connect,
    listAgents: () => [{ id: 'claude', label: 'Claude Code' }],
    defaultAgentId: () => 'claude',
    log: createAgentLog({ directory: makeTempDir('agent-images-'), now: () => 1 }),
    scratchDirectory: makeTempDir('agent-images-scratch-'),
    scrollbackLimit: () => 5000,
    broadcast: vi.fn(),
    recordTab: vi.fn(),
    now: () => 0,
    conversations: () => conversations,
  })
  return { service, agents: fakes.agents }
}

const conversation = (sessionId: string, cwd: string, capturedAt: string): AgentConversation => ({
  agentId: 'claude',
  transport: 'acp',
  sessionId,
  transcriptPath: null,
  cwd,
  capturedAt,
})

describe('image prompts', () => {
  it('adds an image block when the agent advertises images', async () => {
    const { service, agents } = serviceOver({ image: true, steering: false })
    const started = await service.start({ cwd: '/work' })
    await service.prompt(started!.sessionId, 'look', [PICTURE])
    const sent = agents[0].calls.find((call) => call.method === 'prompt')
    expect((sent!.params as { prompt: unknown[] }).prompt).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', ...PICTURE },
    ])
  })

  it('sends nothing and says so in the conversation when the agent has no image support', async () => {
    const { service, agents } = serviceOver({ image: false, steering: false })
    const started = await service.start({ cwd: '/work' })
    const heard: unknown[] = []
    service.onUpdate(started!.sessionId, (update) => heard.push(update))
    expect(await service.prompt(started!.sessionId, 'look', [PICTURE])).toEqual({
      stopReason: 'error',
    })
    expect(agents[0].calls.map((call) => call.method)).not.toContain('prompt')
    expect(JSON.stringify(heard)).toContain('cannot read images')
  })
})

describe('sessionsIn', () => {
  it('lists the open sessions in the folder and the last conversation recorded for it', async () => {
    const { service } = serviceOver({ image: true, steering: false }, [
      conversation('old', '/work', '2026-01-01T00:00:00Z'),
      conversation('new', '/work', '2026-02-01T00:00:00Z'),
      conversation('elsewhere', '/other', '2026-03-01T00:00:00Z'),
    ])
    const here = await service.start({ cwd: '/work' })
    expect(await service.sessionsIn('/work')).toEqual({ live: [here!.sessionId], resumable: 'new' })
    expect(await service.sessionsIn('/other')).toEqual({ live: [], resumable: 'elsewhere' })
  })

  it('has nothing live and nothing resumable for an unknown folder', async () => {
    const { service } = serviceOver({ image: true, steering: false })
    expect(await service.sessionsIn('/nowhere')).toEqual({ live: [], resumable: null })
  })
})
