import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { createSensorChannels } from '../../src/ipc/sensor-channels.js'
import { createSignalStore } from '../../src/sensors/store.js'
import type { SignalStore } from '../../src/sensors/store.js'
import { createOrderStore } from '../../src/order/store.js'
import type { Signal } from '../../src/sensors/types.js'
import type { SensorDef } from '../../src/sensors/types.js'
import type { AvailableSensor } from '../../src/ipc/sensor-channels.js'
import type { CollectDeps } from '../../src/sensors/collect.js'

let root: string
let repo: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-sensor-channels-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-sensor-repo-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(repo, { recursive: true, force: true })
})

function sensorDef(overrides: Partial<SensorDef> = {}): SensorDef {
  return {
    id: 'ci-flake',
    description: 'CI failures',
    every: '15m',
    severity: 'medium',
    source: { kind: 'github-runs', branch: null, limit: 10 },
    ...overrides,
  }
}

async function seedSignal(store: SignalStore, overrides: Partial<Signal> = {}): Promise<Signal> {
  const signal: Signal = {
    id: 'sig-1',
    sensorId: 'ci-flake',
    key: 'workflow:ci',
    title: 'CI is flaky',
    evidence: [
      { kind: 'ci-run', title: 'run 1', url: 'https://x/1', at: '2026-01-01T00:00:00.000Z' },
    ],
    occurrences: 1,
    severity: 'medium',
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    status: 'open',
    dismissedAt: null,
    orderId: null,
    ...overrides,
  }
  await store.save([signal])
  return signal
}

function channels(sensors: readonly AvailableSensor[] = [{ def: sensorDef(), rung: 'data-root' }]) {
  const store = createSignalStore(root)
  const orderStore = createOrderStore(root)
  const collectDeps: CollectDeps = {
    exec: async () => ({ exitCode: 0, stdout: '[]', stderr: '', timedOut: false }),
    cwd: repo,
    issues: null,
    now: () => '2026-01-01T00:20:00.000Z',
  }
  const c = createSensorChannels({
    store,
    orderStore,
    availableSensors: () => sensors,
    collectDepsFor: () => collectDeps,
    now: () => '2026-01-01T00:20:00.000Z',
    newId: () => 'WO-0101-sig',
  })
  return { c, store, orderStore }
}

describe('foundry:signals.list', () => {
  it('ranks open signals and reports the count', async () => {
    const { c, store } = channels()
    await seedSignal(store, { id: 'sig-open', status: 'open' })
    await seedSignal(store, { id: 'sig-dismissed', status: 'dismissed', dismissedAt: 1 })

    const result = (await c.list({})) as { signals: Signal[]; counts: { open: number } }
    expect(result.signals.map((s) => s.id)).toEqual(['sig-open'])
    expect(result.counts.open).toBe(1)
  })

  it('rejects a malformed payload', async () => {
    const { c } = channels()
    expect(await c.list({ bogus: true })).toEqual({ error: 'Malformed request.' })
  })
})

describe('foundry:signals.dismiss', () => {
  it('dismisses a signal', async () => {
    const { c, store } = channels()
    await seedSignal(store)

    const result = (await c.dismiss({ id: 'sig-1' })) as { signal: Signal }
    expect(result.signal.status).toBe('dismissed')
    expect((await store.get('sig-1'))?.status).toBe('dismissed')
  })

  it('errors on an unknown signal', async () => {
    const { c } = channels()
    expect(await c.dismiss({ id: 'nope' })).toEqual({ error: 'No signal nope.' })
  })

  it('rejects a malformed payload', async () => {
    const { c } = channels()
    expect(await c.dismiss({})).toEqual({ error: 'Malformed request.' })
  })
})

describe('foundry:signals.promote', () => {
  it('seeds a draft order sourced from the signal, marks it promoted, and starts nothing', async () => {
    const { c, store, orderStore } = channels()
    await seedSignal(store)

    const result = (await c.promote({ id: 'sig-1', repoPaths: [repo] })) as {
      order: { id: string; status: string; source: { kind: string } }
    }
    expect(result.order.source.kind).toBe('signal')
    expect(result.order.status).toBe('draft')

    const promoted = await store.get('sig-1')
    expect(promoted?.status).toBe('promoted')
    expect(promoted?.orderId).toBe(result.order.id)

    const entries = await orderStore.entries(result.order.id)
    expect(entries.map((e) => e.action)).toContain('signal.promoted')
  })

  it('errors on an unknown signal', async () => {
    const { c } = channels()
    expect(await c.promote({ id: 'nope', repoPaths: [repo] })).toEqual({ error: 'No signal nope.' })
  })

  it('rejects a malformed payload', async () => {
    const { c } = channels()
    expect(await c.promote({ id: 'sig-1' })).toEqual({ error: 'Malformed request.' })
  })
})

describe('foundry:sensors.list', () => {
  it('lists every available sensor with a defaulted state', async () => {
    const { c } = channels()
    const result = (await c.sensorsList({})) as {
      sensors: { def: SensorDef; state: unknown; nextDueAt: string | null }[]
    }
    expect(result.sensors).toHaveLength(1)
    expect(result.sensors[0].def.id).toBe('ci-flake')
    expect(result.sensors[0].state).toEqual({
      enabled: false,
      repoPath: null,
      lastRunAt: null,
      lastProblem: null,
    })
    expect(result.sensors[0].nextDueAt).toBeNull()
  })

  it('rejects a malformed payload', async () => {
    const { c } = channels()
    expect(await c.sensorsList({ bogus: true })).toEqual({ error: 'Malformed request.' })
  })

  it('is due now for an enabled sensor that has never run', async () => {
    const { c } = channels()
    await c.sensorsSet({ id: 'ci-flake', repoPath: repo, enabled: true })

    const result = (await c.sensorsList({})) as { sensors: { nextDueAt: string | null }[] }
    expect(result.sensors[0].nextDueAt).toBe('2026-01-01T00:20:00.000Z')
  })

  it('is due one interval after its last run, once it has run', async () => {
    const { c } = channels()
    await c.sensorsSet({ id: 'ci-flake', repoPath: repo, enabled: true })
    await c.sensorsRunNow({ id: 'ci-flake' })

    const result = (await c.sensorsList({})) as { sensors: { nextDueAt: string | null }[] }
    expect(result.sensors[0].nextDueAt).toBe('2026-01-01T00:35:00.000Z')
  })
})

describe('foundry:sensors.set', () => {
  it('refuses to enable a sensor with no repository', async () => {
    const { c } = channels()
    expect(await c.sensorsSet({ id: 'ci-flake', enabled: true })).toEqual({
      error: 'A sensor needs a repository before it can be enabled.',
    })
  })

  it('enables a sensor once it has a repository', async () => {
    const { c } = channels()
    await c.sensorsSet({ id: 'ci-flake', repoPath: repo })
    const result = (await c.sensorsSet({ id: 'ci-flake', enabled: true })) as {
      state: { enabled: boolean; repoPath: string | null }
    }
    expect(result.state).toEqual({
      enabled: true,
      repoPath: repo,
      lastRunAt: null,
      lastProblem: null,
    })
  })

  it('disables a sensor without needing a repository', async () => {
    const { c } = channels()
    await c.sensorsSet({ id: 'ci-flake', repoPath: repo, enabled: true })
    const result = (await c.sensorsSet({ id: 'ci-flake', enabled: false })) as {
      state: { enabled: boolean; repoPath: string | null }
    }
    expect(result.state.enabled).toBe(false)
    expect(result.state.repoPath).toBe(repo)
  })

  it('clears the repository of a sensor that was never configured', async () => {
    const { c } = channels()
    const result = (await c.sensorsSet({ id: 'ci-flake', repoPath: null })) as {
      state: { enabled: boolean; repoPath: string | null }
    }
    expect(result.state).toEqual({
      enabled: false,
      repoPath: null,
      lastRunAt: null,
      lastProblem: null,
    })
  })

  it('rejects a malformed payload', async () => {
    const { c } = channels()
    expect(await c.sensorsSet({ enabled: true })).toEqual({ error: 'Malformed request.' })
  })
})

describe('foundry:sensors.run-now', () => {
  it('runs the sensor once and reports what it recorded', async () => {
    const { c } = channels()
    await c.sensorsSet({ id: 'ci-flake', repoPath: repo, enabled: true })

    const result = await c.sensorsRunNow({ id: 'ci-flake' })
    expect(result).toEqual({ recorded: 0, problem: null })
  })

  it('errors on a sensor with no repository set', async () => {
    const { c } = channels()
    expect(await c.sensorsRunNow({ id: 'ci-flake' })).toEqual({
      error: 'This sensor has no repository set.',
    })
  })

  it('errors on an unknown sensor', async () => {
    const { c } = channels()
    expect(await c.sensorsRunNow({ id: 'nope' })).toEqual({ error: 'No sensor nope.' })
  })

  it('rejects a malformed payload', async () => {
    const { c } = channels()
    expect(await c.sensorsRunNow({})).toEqual({ error: 'Malformed request.' })
  })
})
