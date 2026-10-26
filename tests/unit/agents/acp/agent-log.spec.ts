import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { createAgentLog } from '../../../../src/main/agents/acp/agent-log'
import { makeTempDir } from '../../../support/temp-dir'

describe('agent log', () => {
  it('returns the updates of a session in the order they were appended', () => {
    const log = createAgentLog({
      directory: join(makeTempDir('agent-log-'), 'nested'),
      now: () => 7,
    })
    log.append('s1', { sessionUpdate: 'agent_message_chunk', n: 1 })
    log.append('s2', { sessionUpdate: 'plan' })
    log.append('s1', { sessionUpdate: 'usage_update', n: 2 })
    expect(log.readHistory('s1')).toEqual([
      { sessionUpdate: 'agent_message_chunk', n: 1 },
      { sessionUpdate: 'usage_update', n: 2 },
    ])
  })

  it('returns nothing for a session that was never logged', () => {
    const log = createAgentLog({ directory: makeTempDir('agent-log-'), now: () => 0 })
    expect(log.readHistory('missing')).toEqual([])
  })
})
