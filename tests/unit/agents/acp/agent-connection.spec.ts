import { describe, it, expect } from 'vitest'
import type { Client } from '@agentclientprotocol/sdk'
import { createConnector, keepTail } from '../../../../src/main/agents/acp/agent-connection'
import { partialFake } from '../../../support/fakes'

const missing = {
  default: 'missing',
  custom: [{ id: 'missing', label: 'Missing', command: '/no/such/agent', args: [] }],
}

describe('an agent command that cannot start', () => {
  it('reports an exit with no code, also to a listener added after it failed', async () => {
    const connect = createConnector(() => missing)
    const link = await connect({ agentId: 'missing', client: partialFake<Client>({}) })
    const exitOf = () => new Promise((resolve) => link.onExit(resolve))
    expect(await exitOf()).toBeNull()
    expect(await exitOf()).toBeNull()
  })
})

describe('keepTail', () => {
  it('keeps the whole text when it fits', () => {
    expect(keepTail('abc', 5)).toBe('abc')
  })

  it('keeps only the last characters when it does not', () => {
    expect(keepTail('abcdef', 4)).toBe('cdef')
  })
})
