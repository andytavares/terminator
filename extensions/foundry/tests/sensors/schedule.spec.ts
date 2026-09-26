import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { dueSensors, runSensor } from '../../src/sensors/schedule.js'
import { createSignalStore } from '../../src/sensors/store.js'
import type { SensorState } from '../../src/sensors/store.js'
import type { SensorDef } from '../../src/sensors/types.js'
import type { CollectDeps } from '../../src/sensors/collect.js'

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-sensor-schedule-'))
}

function sensor(overrides: Partial<SensorDef> = {}): SensorDef {
  return {
    id: 'ci-flake',
    description: 'CI failures',
    every: '15m',
    severity: 'medium',
    source: { kind: 'github-runs', branch: null, limit: 10 },
    ...overrides,
  }
}

function state(overrides: Partial<SensorState> = {}): SensorState {
  return { enabled: true, repoPath: '/repo', lastRunAt: null, lastProblem: null, ...overrides }
}

describe('dueSensors', () => {
  it('is due when it has never run', () => {
    const defs = [sensor()]
    expect(dueSensors(defs, { 'ci-flake': state() }, '2026-01-01T00:20:00.000Z')).toEqual(defs)
  })

  it('is due once its interval has elapsed', () => {
    const defs = [sensor({ every: '15m' })]
    const states = { 'ci-flake': state({ lastRunAt: '2026-01-01T00:00:00.000Z' }) }
    expect(dueSensors(defs, states, '2026-01-01T00:15:00.000Z')).toEqual(defs)
  })

  it('is not due before its interval has elapsed', () => {
    const defs = [sensor({ every: '15m' })]
    const states = { 'ci-flake': state({ lastRunAt: '2026-01-01T00:00:00.000Z' }) }
    expect(dueSensors(defs, states, '2026-01-01T00:10:00.000Z')).toEqual([])
  })

  it('is never due when disabled', () => {
    const defs = [sensor()]
    const states = { 'ci-flake': state({ enabled: false }) }
    expect(dueSensors(defs, states, '2026-01-01T00:20:00.000Z')).toEqual([])
  })

  it('is never due without a repository', () => {
    const defs = [sensor()]
    const states = { 'ci-flake': state({ repoPath: null }) }
    expect(dueSensors(defs, states, '2026-01-01T00:20:00.000Z')).toEqual([])
  })

  it('is never due when no state was ever recorded for it', () => {
    const defs = [sensor()]
    expect(dueSensors(defs, {}, '2026-01-01T00:20:00.000Z')).toEqual([])
  })
})

describe('runSensor', () => {
  function fakeCollectDeps(over: Partial<CollectDeps> = {}): CollectDeps {
    return {
      exec: async () => ({ exitCode: 0, stdout: '[]', stderr: '', timedOut: false }),
      cwd: '/repo',
      issues: null,
      now: () => '2026-01-01T00:20:00.000Z',
      ...over,
    }
  }

  it('records a signal collected this run and remembers when it ran', async () => {
    const root = tempRoot()
    const store = createSignalStore(root)
    const def = sensor({ source: { kind: 'github-issues', label: 'bug', limit: 5 } })

    const collectDeps = fakeCollectDeps({
      exec: async () => ({
        exitCode: 0,
        stdout: JSON.stringify([
          { title: 'Login crashes', url: 'https://x/1', updatedAt: '2026-01-01T00:00:00.000Z' },
        ]),
        stderr: '',
        timedOut: false,
      }),
    })

    const result = await runSensor(def, {
      store,
      collectDeps,
      now: () => '2026-01-01T00:20:00.000Z',
      newId: () => 'sig-1',
    })

    expect(result).toEqual({ recorded: 1, problem: null })

    const signals = await store.list()
    expect(signals).toHaveLength(1)
    expect(signals[0].sensorId).toBe('ci-flake')

    const states = await store.sensorState()
    expect(states['ci-flake']).toEqual({
      lastRunAt: '2026-01-01T00:20:00.000Z',
      lastProblem: null,
    })
  })

  it('stores the problem and records nothing when the collector fails', async () => {
    const root = tempRoot()
    const store = createSignalStore(root)
    const def = sensor({ source: { kind: 'github-issues', label: 'bug', limit: 5 } })

    const collectDeps = fakeCollectDeps({
      exec: async () => ({ exitCode: 1, stdout: '', stderr: 'boom', timedOut: false }),
    })

    const result = await runSensor(def, {
      store,
      collectDeps,
      now: () => '2026-01-01T00:20:00.000Z',
      newId: () => 'sig-1',
    })

    expect(result.recorded).toBe(0)
    expect(result.problem).toMatch(/gh issue list failed/)

    const states = await store.sensorState()
    expect(states['ci-flake'].lastProblem).toMatch(/gh issue list failed/)
  })
})
