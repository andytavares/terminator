import { describe, it, expect, beforeEach } from 'vitest'
import { createFoundryStore } from '../../../src/state/foundry.store.js'
import type { Run, HarnessHealthEvent } from '../../../src/types/foundry.types.js'

function makeRun(id: string): Run {
  return {
    id,
    mode: 'spec-to-code',
    providerId: 'p1',
    model: 'claude-sonnet',
    status: 'running',
    createdAt: new Date().toISOString(),
    workspaceRoot: '/ws',
    currentIteration: 1,
    iterationLimit: 3,
    iterations: [],
    fileChanges: [],
  }
}

describe('foundry store', () => {
  let store: ReturnType<typeof createFoundryStore>

  beforeEach(() => {
    store = createFoundryStore()
  })

  it('initializes with empty runs map', () => {
    expect(store.getState().runs.size).toBe(0)
  })

  it('addRun stores a run by id', () => {
    const run = makeRun('r1')
    store.getState().addRun(run)
    expect(store.getState().runs.get('r1')).toEqual(run)
  })

  it('updateRun merges partial update', () => {
    store.getState().addRun(makeRun('r1'))
    store.getState().updateRun('r1', { status: 'gate' })
    expect(store.getState().runs.get('r1')?.status).toBe('gate')
  })

  it('removeRun deletes from map', () => {
    store.getState().addRun(makeRun('r1'))
    store.getState().removeRun('r1')
    expect(store.getState().runs.has('r1')).toBe(false)
  })

  it('setActiveRunId updates activeRunId', () => {
    store.getState().setActiveRunId('r1')
    expect(store.getState().activeRunId).toBe('r1')
  })

  it('addHealthEvent appends to healthEvents', () => {
    const evt: HarnessHealthEvent = {
      kind: 'sensor-failure',
      sensorName: 'lint',
      consecutiveCount: 3,
      lastOccurredAt: new Date().toISOString(),
    }
    store.getState().addHealthEvent(evt)
    expect(store.getState().healthEvents).toHaveLength(1)
  })

  it('resolveHealthEvent removes matching event', () => {
    const evt: HarnessHealthEvent = {
      kind: 'sensor-failure',
      sensorName: 'lint',
      consecutiveCount: 3,
      lastOccurredAt: new Date().toISOString(),
    }
    store.getState().addHealthEvent(evt)
    store.getState().resolveHealthEvent('sensor-failure', 'lint')
    expect(store.getState().healthEvents).toHaveLength(0)
  })

  it('setHarness updates harness state', () => {
    store.getState().setHarness({
      version: 1,
      sensors: [{ name: 'lint', command: 'npm run lint' }],
      gateDefaults: {
        requireGateAfterEachIteration: true,
        sensorsMustPassBeforeGate: true,
        autoCheckpointBeforeRun: true,
        requireCleanWorkingTree: true,
      },
      providerRef: null,
      iterationLimit: 3,
      agentsMdPath: 'AGENTS.md',
    })
    expect(store.getState().harness?.sensors).toHaveLength(1)
  })
})
