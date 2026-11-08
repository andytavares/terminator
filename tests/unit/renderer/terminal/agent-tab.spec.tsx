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

  it('counts a start with no agent named under the default agent', async () => {
    agentsStartAnswers({ data: { sessionId: 's1' } })
    await startAgentTab(REQUEST)
    expect(recordUse).toHaveBeenCalledWith('core.agent.start.default', 'click', expect.anything())
  })
})

describe('startAgentTab — usage of a failed start', () => {
  beforeEach(() => recordUse.mockClear())

  it('counts a start that failed as failed', async () => {
    agentsStartAnswers({ error: 'SPAWN_FAILED' })
    await startAgentTab({ ...REQUEST, agentId: 'gemini' })
    expect(recordUse).toHaveBeenCalledWith(
      'core.agent.start.gemini',
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

  it.each([
    ['my.agent', 'core.agent.start.my.agent'],
    ['my agent', 'core.agent.start.my-agent'],
  ])('counts agent %s under %s', async (agentId, featureId) => {
    agentsStartAnswers({ data: { sessionId: 's1' } })
    await startAgentTab({ ...REQUEST, agentId })
    expect(recordUse).toHaveBeenCalledWith(featureId, 'click', expect.anything())
  })

  it('caps a long agent name at the 120-character label limit', async () => {
    agentsStartAnswers({ data: { sessionId: 's1' } })
    await startAgentTab({ ...REQUEST, agentId: 'x'.repeat(200) })
    const label = `Start ${'x'.repeat(114)}`
    expect(recordUse).toHaveBeenCalledWith(
      expect.any(String),
      'click',
      expect.objectContaining({ declare: expect.objectContaining({ label }) })
    )
  })
})
