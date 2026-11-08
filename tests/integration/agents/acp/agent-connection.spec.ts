import { describe, it, expect } from 'vitest'
import { createConnector } from '../../../../src/main/agents/acp/agent-connection'
import type { AgentClient } from '../../../../src/main/agents/acp/agent-service'
import { partialFake } from '../../../support/fakes'

const missing = {
  default: 'missing',
  custom: [{ id: 'missing', label: 'Missing', command: '/no/such/agent', args: [] }],
}

describe('an agent command that cannot start', () => {
  it('reports an exit with no code, also to a listener added after it failed', async () => {
    const connect = createConnector(() => missing)
    const link = await connect({ agentId: 'missing', client: partialFake<AgentClient>({}) })
    const exitOf = () => new Promise((resolve) => link.onExit(resolve))
    expect(await exitOf()).toBeNull()
    expect(await exitOf()).toBeNull()
  })
})
