import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

import { startAgentTab } from '../../../../src/renderer/terminal/agent-tab'
import { installElectronApi } from '../../../support/electron-api'

const REQUEST = { cwd: '/code/api', projectId: 'p1', title: 'Agent' }

function agentsStartAnswers(reply: unknown): void {
  installElectronApi({ agents: { start: vi.fn(async () => reply) } } as never)
}

describe('startAgentTab — usage', () => {
  beforeEach(() => recordUse.mockClear())

  it('counts a start under the agent it started', async () => {
    agentsStartAnswers({ data: { sessionId: 's1' } })
    await startAgentTab({ ...REQUEST, agentId: 'gemini' })
    expect(recordUse).toHaveBeenCalledWith(
      'core.agent.start.gemini',
      'click',
      expect.objectContaining({ failed: false })
    )
  })

  it('counts the default agent, and a start that failed', async () => {
    agentsStartAnswers({ error: 'SPAWN_FAILED' })
    await startAgentTab(REQUEST)
    expect(recordUse).toHaveBeenCalledWith(
      'core.agent.start.default',
      'click',
      expect.objectContaining({ failed: true })
    )
  })

  it('keeps only the characters a feature id allows from an agent name', async () => {
    agentsStartAnswers({ data: { sessionId: 's1' } })
    await startAgentTab({ ...REQUEST, agentId: 'My Agent_2' })
    expect(recordUse.mock.calls[0][0]).toBe('core.agent.start.my-agent-2')
  })
})

describe('startAgentTab — usage ids from agent names', () => {
  beforeEach(() => recordUse.mockClear())

  it('keeps a dotted name apart from a spaced one, and a long name within the label limit', async () => {
    agentsStartAnswers({ data: { sessionId: 's1' } })
    await startAgentTab({ ...REQUEST, agentId: 'my.agent' })
    await startAgentTab({ ...REQUEST, agentId: 'x'.repeat(200) })
    expect(recordUse.mock.calls[0][0]).toBe('core.agent.start.my.agent')
    expect(recordUse.mock.calls[1][2].declare.label).toHaveLength(120)
  })
})
