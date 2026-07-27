import { describe, it, expect, vi } from 'vitest'
import {
  mayBeginImplementation,
  gateIsReviewable,
} from '../../../../../src/main/supervision/workitems/gates.js'
import { createProducerRegistry } from '../../../../../src/main/supervision/workitems/producer-commands.js'
import type { WorkItemContract } from '../../../../../src/main/supervision/workitems/contract-schema.js'

function item(over: Partial<WorkItemContract> = {}): WorkItemContract {
  return {
    contract_version: 1,
    id: 'FLU-220',
    source: 'local',
    title: 't',
    created_at: '2026-07-27T09:04:11Z',
    phase: 'plan',
    artifacts: {},
    gates: {},
    lanes: [
      {
        ord: 1,
        repo: 'r',
        role: 'producer',
        branch: 'b',
        task_ids: [],
        blocks: [],
        blocked_by: [],
      },
    ],
    ...over,
  } as WorkItemContract
}

const approved = { ok: true, at: '2026-07-27T09:12:40Z' }

describe('gates (FR-083)', () => {
  it('refuses implementation with no gates approved, naming both', () => {
    const decision = mayBeginImplementation(item())
    expect(decision.allowed).toBe(false)
    expect(decision.missing).toEqual(['spec_approved_by_human', 'plan_approved_by_human'])
    expect(decision.reason).toContain('specification')
    expect(decision.reason).toContain('plan')
  })

  it('refuses with only the specification approved, naming the plan', () => {
    const decision = mayBeginImplementation(item({ gates: { spec_approved_by_human: approved } }))
    expect(decision.allowed).toBe(false)
    expect(decision.missing).toEqual(['plan_approved_by_human'])
    expect(decision.reason).toContain('the plan has not been approved')
  })

  it('allows implementation once both are approved', () => {
    const decision = mayBeginImplementation(
      item({ gates: { spec_approved_by_human: approved, plan_approved_by_human: approved } })
    )
    expect(decision).toMatchObject({ allowed: true, missing: [] })
  })

  it('treats an explicitly unapproved gate as missing', () => {
    const decision = mayBeginImplementation(
      item({ gates: { spec_approved_by_human: { ok: false }, plan_approved_by_human: approved } })
    )
    expect(decision.missing).toEqual(['spec_approved_by_human'])
  })

  it('ignores gates that are not required for implementation', () => {
    const decision = mayBeginImplementation(
      item({
        gates: {
          spec_approved_by_human: approved,
          plan_approved_by_human: approved,
          analyze_clean: { ok: false, findings: 2 },
        },
      })
    )
    // Analyze findings are worth surfacing, but they do not gate implementation.
    expect(decision.allowed).toBe(true)
  })
})

describe('gate reviewability', () => {
  it('reports a gate reviewable once its artefact exists', () => {
    const withSpec = item({ artifacts: { spec: 'specs/x/spec.md' } })
    expect(gateIsReviewable(withSpec, 'spec_approved_by_human')).toBe(true)
    expect(gateIsReviewable(withSpec, 'plan_approved_by_human')).toBe(false)
  })

  it('reports a gate unreviewable when there is nothing to read', () => {
    expect(gateIsReviewable(item(), 'spec_approved_by_human')).toBe(false)
  })
})

describe('producer commands (FR-077)', () => {
  it('invokes a registered handler with the arguments given', async () => {
    const registry = createProducerRegistry()
    const approveGate = vi.fn().mockResolvedValue(undefined)
    registry.register('speckit-pilot', { approveGate })
    await expect(
      registry.invoke('speckit-pilot', 'approveGate', ['FLU-220', 'spec_approved_by_human'])
    ).resolves.toMatchObject({ ok: true })
    expect(approveGate).toHaveBeenCalledWith('FLU-220', 'spec_approved_by_human')
  })

  it('reports which actions a producer supports', () => {
    const registry = createProducerRegistry()
    registry.register('p', { approveGate: vi.fn() })
    expect(registry.supports('p', 'approveGate')).toBe(true)
    expect(registry.supports('p', 'sendBack')).toBe(false)
  })
})

describe('unregistered actions degrade to read-only (FR-078)', () => {
  it('states the action is unavailable rather than failing', async () => {
    const registry = createProducerRegistry()
    registry.register('p', { approveGate: vi.fn() })
    const result = await registry.invoke('p', 'sendBack', ['FLU-220', 'specify', 'notes'])
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('sending work back')
  })

  it('states when no producer is registered at all', async () => {
    const result = await createProducerRegistry().invoke('nobody', 'approveGate', ['x', 'y'])
    expect(result).toMatchObject({ ok: false })
    expect(result.reason).toContain('nobody')
  })

  it('reports a producer that throws, without letting it escape', async () => {
    const registry = createProducerRegistry()
    registry.register('p', { advancePhase: vi.fn().mockRejectedValue(new Error('pipeline broke')) })
    await expect(registry.invoke('p', 'advancePhase', ['FLU-220'])).resolves.toMatchObject({
      ok: false,
      reason: 'pipeline broke',
    })
  })

  it('forgets a producer once unregistered', async () => {
    const registry = createProducerRegistry()
    registry.register('p', { approveGate: vi.fn() })
    registry.unregister('p')
    expect(registry.supports('p', 'approveGate')).toBe(false)
  })
})
