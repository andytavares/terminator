import { appendFileSync, existsSync, symlinkSync, utimesSync } from 'node:fs'
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

  it('skips a line a crash left half written', () => {
    const directory = makeTempDir('agent-log-')
    const log = createAgentLog({ directory, now: () => 0 })
    log.append('s1', { sessionUpdate: 'plan' })
    appendFileSync(join(directory, 's1.jsonl'), '{"at":1,"upd')
    expect(log.readHistory('s1')).toEqual([{ sessionUpdate: 'plan' }])
  })
})

describe('agent log pruning', () => {
  it('prunes the logs nobody has written to within the age given', () => {
    const directory = makeTempDir('agent-log-')
    const day = 24 * 60 * 60 * 1000
    const log = createAgentLog({ directory, now: () => 40 * day })
    log.append('old', { sessionUpdate: 'plan' })
    log.append('recent', { sessionUpdate: 'plan' })
    utimesSync(join(directory, 'old.jsonl'), 1, 1)
    utimesSync(join(directory, 'recent.jsonl'), 35 * 24 * 3600, 35 * 24 * 3600)
    log.prune(30 * day)
    expect(existsSync(join(directory, 'old.jsonl'))).toBe(false)
    expect(log.readHistory('recent')).toEqual([{ sessionUpdate: 'plan' }])
  })

  it('prunes nothing when the folder does not exist yet', () => {
    const log = createAgentLog({ directory: join(makeTempDir('agent-log-'), 'none'), now: () => 0 })
    expect(() => log.prune(1)).not.toThrow()
  })

  it('prunes the rest when one log cannot be read, as one removed meanwhile', () => {
    const directory = makeTempDir('agent-log-')
    const log = createAgentLog({ directory, now: () => 10_000_000 })
    log.append('old', { sessionUpdate: 'plan' })
    utimesSync(join(directory, 'old.jsonl'), 1, 1)
    symlinkSync(join(directory, 'gone'), join(directory, 'dangling.jsonl'))
    expect(() => log.prune(1)).not.toThrow()
    expect(existsSync(join(directory, 'old.jsonl'))).toBe(false)
  })
})
