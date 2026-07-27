import { describe, it, expect } from 'vitest'
import {
  parseWorkItemContract,
  CURRENT_CONTRACT_VERSION,
} from '../../../../../src/main/supervision/workitems/contract-schema.js'

function contract(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    contract_version: CURRENT_CONTRACT_VERSION,
    id: 'FLU-220',
    source: 'linear',
    title: 'Unify session identity',
    created_at: '2026-07-27T09:04:11Z',
    phase: 'implement',
    lanes: [{ ord: 1, repo: 'fluent', role: 'producer', branch: 'feat/session-ulid' }],
    ...over,
  })
}

describe('a well-formed contract', () => {
  it('parses', () => {
    const result = parseWorkItemContract(contract())
    expect(result.ok).toBe(true)
  })

  it('keeps the lanes as published', () => {
    const result = parseWorkItemContract(contract())
    expect(result.ok && result.item.lanes[0]).toMatchObject({ ord: 1, repo: 'fluent' })
  })

  it('defaults absent optional sections rather than dropping them', () => {
    const result = parseWorkItemContract(contract())
    expect(result.ok && result.item.artifacts).toEqual({})
    expect(result.ok && result.item.gates).toEqual({})
  })

  it('defaults a lane task list to empty', () => {
    const result = parseWorkItemContract(contract())
    expect(result.ok && result.item.lanes[0].task_ids).toEqual([])
  })

  it('reads gates', () => {
    const result = parseWorkItemContract(
      contract({ gates: { spec_approved_by_human: { ok: true, at: '2026-07-27T09:12:40Z' } } })
    )
    expect(result.ok && result.item.gates.spec_approved_by_human.ok).toBe(true)
  })

  it('reads the shared contract for a multi-repository item', () => {
    const result = parseWorkItemContract(
      contract({ contract: { summary: 'ULID', shared_files: ['proto/session.proto'] } })
    )
    expect(result.ok && result.item.contract?.shared_files).toEqual(['proto/session.proto'])
  })

  it('ignores fields it does not recognise, so a newer producer degrades gracefully', () => {
    const result = parseWorkItemContract(contract({ some_future_field: 'value' }))
    expect(result.ok).toBe(true)
  })
})

describe('per-item failure (FR-085)', () => {
  it('reports unparseable JSON as a partial write rather than throwing', () => {
    const result = parseWorkItemContract('{ "id": "FLU-220"')
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('partial write')
  })

  it('reports a missing contract version', () => {
    const result = parseWorkItemContract(JSON.stringify({ id: 'x' }))
    expect(result.ok === false && result.reason).toBe('no contract version')
  })

  it('rejects an unknown major version outright rather than parsing part of it', () => {
    const result = parseWorkItemContract(contract({ contract_version: 99 }))
    expect(result.ok === false && result.reason).toContain('version 99')
  })

  it('names the failing field on a schema violation', () => {
    const result = parseWorkItemContract(contract({ phase: 'not-a-phase' }))
    expect(result.ok === false && result.reason).toContain('phase')
  })

  it('rejects a contract with zero lanes', () => {
    const result = parseWorkItemContract(contract({ lanes: [] }))
    expect(result.ok === false && result.reason).toContain('lanes')
  })

  it('rejects a non-object payload', () => {
    expect(parseWorkItemContract('"just a string"')).toMatchObject({ ok: false })
    expect(parseWorkItemContract('null')).toMatchObject({ ok: false })
  })

  it('rejects a lane with no branch', () => {
    const result = parseWorkItemContract(
      contract({ lanes: [{ ord: 1, repo: 'x', role: 'producer' }] })
    )
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('branch')
  })

  it('rejects a lane with a zero or negative merge position', () => {
    const result = parseWorkItemContract(
      contract({ lanes: [{ ord: 0, repo: 'x', role: 'producer', branch: 'b' }] })
    )
    expect(result).toMatchObject({ ok: false })
  })
})

describe('session bindings are not in the contract (FR-075)', () => {
  it('does not carry a session id on a lane', () => {
    // The console binds sessions in its own storage. Accepting one here would
    // invite a producer to expect the console to write it back.
    const result = parseWorkItemContract(
      contract({
        lanes: [{ ord: 1, repo: 'fluent', role: 'producer', branch: 'feat/x', session_id: 'b1e2' }],
      })
    )
    expect(result.ok).toBe(true)
    expect(result.ok && 'session_id' in result.item.lanes[0]).toBe(false)
  })
})
