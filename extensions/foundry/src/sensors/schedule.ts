import { everyMs } from './schema.js'
import { collect } from './collect.js'
import type { CollectDeps } from './collect.js'
import { mergeSensed } from './cluster.js'
import type { SensorDef } from './types.js'
import type { SensorState, SignalStore } from './store.js'

// The tick, and what one turn of it does to one sensor.
//
// `dueSensors` is pure over the state the store already holds — the caller
// hands it `now` rather than letting it read the clock, so a fake clock can
// drive the same decision a live 60-second interval makes. `runSensor` is the
// only place a sensor's collector actually runs, and it does the whole
// round trip: collect, fold into what is already stored, save, and remember
// when it ran and what went wrong, if anything did.

/** A sensor with nowhere to run, or turned off, is never due. */
export function dueSensors(
  defs: readonly SensorDef[],
  states: Readonly<Record<string, SensorState>>,
  now: string
): SensorDef[] {
  return defs.filter((def) => {
    const state = states[def.id]
    if (state === undefined) return false
    if (!state.enabled || state.repoPath === null) return false
    if (state.lastRunAt === null) return true
    return new Date(now).getTime() - new Date(state.lastRunAt).getTime() >= everyMs(def.every)
  })
}

export interface RunSensorDeps {
  readonly store: SignalStore
  readonly collectDeps: CollectDeps
  readonly now: () => string
  readonly newId: () => string
}

export interface RunSensorResult {
  readonly recorded: number
  readonly problem: string | null
}

/** One run of one sensor: collect, merge, save, remember. */
export async function runSensor(def: SensorDef, deps: RunSensorDeps): Promise<RunSensorResult> {
  const now = deps.now()
  const result = await collect(def.source, deps.collectDeps)
  const existing = await deps.store.list()
  const merged = mergeSensed(
    existing,
    { id: def.id, severity: def.severity },
    result.items,
    now,
    deps.newId
  )
  await deps.store.save(merged)
  await deps.store.setSensorState(def.id, { lastRunAt: now, lastProblem: result.problem })
  return { recorded: result.items.length, problem: result.problem }
}
