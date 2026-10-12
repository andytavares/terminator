import { z } from 'zod'
import { seedOrder } from '../forge/intake-source.js'
import { dismiss, promote, ranked } from '../sensors/cluster.js'
import { everyMs } from '../sensors/schema.js'
import { runSensor } from '../sensors/schedule.js'
import type { SignalStore, SensorState } from '../sensors/store.js'
import type { SensorDef } from '../sensors/types.js'
import type { CollectDeps } from '../sensors/collect.js'
import type { OrderStore } from '../order/store.js'
import type { ChannelSpec } from '@terminator/extension-sdk'
import { foundryChannel } from './channel.js'

// The sensor surface (ADR-066): what the operator sees of a signal, and the
// two moves they have over one — dismiss it, or promote it into a draft the
// Forge still has to converge. Nothing here starts a run; promoting seeds an
// order exactly the way a typed idea or a tracker issue does.

const EmptyPayload = z.strictObject({})
const IdPayload = z.object({ id: z.string() })
const PromotePayload = z.object({ id: z.string(), repoPaths: z.array(z.string()) })
const SetPayload = z.object({
  id: z.string(),
  enabled: z.boolean().optional(),
  repoPath: z.string().nullable().optional(),
})

/** What a sensor with nothing on record yet looks like: off, watching nothing. */
const DEFAULT_STATE: SensorState = {
  enabled: false,
  repoPath: null,
  lastRunAt: null,
  lastProblem: null,
}

export interface AvailableSensor {
  readonly def: SensorDef
  readonly rung: string
}

export interface SensorChannelDeps {
  readonly store: SignalStore
  readonly orderStore: OrderStore
  readonly availableSensors: () => readonly AvailableSensor[]
  /** A sensor's own `CollectDeps`, once it is known which repository it watches. */
  readonly collectDepsFor: (repoPath: string) => CollectDeps
  readonly now: () => string
  readonly newId: () => string
}

export interface SensorChannels {
  list(): Promise<unknown>
  dismiss(payload: z.infer<typeof IdPayload>): Promise<unknown>
  promote(payload: z.infer<typeof PromotePayload>): Promise<unknown>
  sensorsList(): Promise<unknown>
  sensorsSet(payload: z.infer<typeof SetPayload>): Promise<unknown>
  sensorsRunNow(payload: z.infer<typeof IdPayload>): Promise<unknown>
}

function nextDueAt(state: SensorState, def: SensorDef, now: string): string | null {
  if (!state.enabled || state.repoPath === null) return null
  if (state.lastRunAt === null) return now
  return new Date(new Date(state.lastRunAt).getTime() + everyMs(def.every)).toISOString()
}

export function createSensorChannels(deps: SensorChannelDeps): SensorChannels {
  async function list(): Promise<unknown> {
    const signals = ranked(await deps.store.list())
    return { signals, counts: { open: signals.length } }
  }

  async function dismissSignal(payload: z.infer<typeof IdPayload>): Promise<unknown> {
    const signal = await deps.store.get(payload.id)
    if (signal === null) return { error: `No signal ${payload.id}.` }

    const dismissed = dismiss(signal)
    await deps.store.save([dismissed])
    return { signal: dismissed }
  }

  async function promoteSignal(payload: z.infer<typeof PromotePayload>): Promise<unknown> {
    const { id, repoPaths } = payload

    const signal = await deps.store.get(id)
    if (signal === null) return { error: `No signal ${id}.` }

    const seeded = await seedOrder(
      { kind: 'signal', signalId: id, repoPaths },
      {
        now: deps.now,
        newId: deps.newId,
        readSignal: async (signalId) => deps.store.get(signalId),
      }
    )
    if ('error' in seeded) return seeded
    if ('existing' in seeded) return seeded

    // The order is a draft, nothing more: the Forge still has to converge it.
    await deps.orderStore.save(seeded.order)
    await deps.store.save([promote(signal, seeded.order.id)])
    await deps.orderStore.record({
      at: deps.now(),
      orderId: seeded.order.id,
      actor: 'operator',
      action: 'signal.promoted',
      subject: id,
      reason: `promoted from signal ${id}`,
      evidence: [],
    })

    return { order: seeded.order }
  }

  async function sensorsList(): Promise<unknown> {
    const states = await deps.store.sensorState()
    const now = deps.now()
    return {
      sensors: deps.availableSensors().map(({ def, rung }) => {
        const state = states[def.id] ?? DEFAULT_STATE
        return { def, rung, state, nextDueAt: nextDueAt(state, def, now) }
      }),
    }
  }

  async function sensorsSet(payload: z.infer<typeof SetPayload>): Promise<unknown> {
    const { id, enabled, repoPath } = payload

    const states = await deps.store.sensorState()
    // The store keeps only what was ever patched — an id absent from
    // `state.json` is absent, not defaulted (see store.ts). Merged against the
    // default here, once, so what gets written is always a whole state and a
    // later reader never has to apply the default itself.
    const current: SensorState = { ...DEFAULT_STATE, ...states[id] }
    const next: SensorState = {
      ...current,
      enabled: enabled ?? current.enabled,
      repoPath: repoPath === undefined ? current.repoPath : repoPath,
    }

    if (next.enabled && next.repoPath === null) {
      return { error: 'A sensor needs a repository before it can be enabled.' }
    }

    const updated = await deps.store.setSensorState(id, next)
    return { state: updated[id] }
  }

  async function sensorsRunNow(payload: z.infer<typeof IdPayload>): Promise<unknown> {
    const found = deps.availableSensors().find(({ def }) => def.id === payload.id)
    if (found === undefined) return { error: `No sensor ${payload.id}.` }

    const states = await deps.store.sensorState()
    const state = states[found.def.id] ?? DEFAULT_STATE
    if (state.repoPath === null) return { error: 'This sensor has no repository set.' }

    return runSensor(found.def, {
      store: deps.store,
      collectDeps: deps.collectDepsFor(state.repoPath),
      now: deps.now,
      newId: deps.newId,
    })
  }

  return {
    list,
    dismiss: dismissSignal,
    promote: promoteSignal,
    sensorsList,
    sensorsSet,
    sensorsRunNow,
  }
}

/** The sensor surface's channels, each with the schema its payload is parsed with (ADR 096). */
export function sensorChannelSpecs(sensors: SensorChannels): ChannelSpec[] {
  return [
    foundryChannel('foundry:signals.list', EmptyPayload, sensors.list),
    foundryChannel('foundry:signals.dismiss', IdPayload, sensors.dismiss),
    foundryChannel('foundry:signals.promote', PromotePayload, sensors.promote),
    foundryChannel('foundry:sensors.list', EmptyPayload, sensors.sensorsList),
    foundryChannel('foundry:sensors.set', SetPayload, sensors.sensorsSet),
    foundryChannel('foundry:sensors.run-now', IdPayload, sensors.sensorsRunNow),
  ]
}
