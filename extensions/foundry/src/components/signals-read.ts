import { foundryInvoke } from '../renderer/foundry-invoke.js'
import type { Signal } from '../sensors/types.js'

/** A sensor as `sensors.list` answers it — enough to label a signal and offer
 *  the sensor's own repository as the default a promotion asks for. */
export interface SensorRow {
  readonly def: { readonly id: string; readonly description: string }
  readonly state: { readonly repoPath: string | null }
}

export interface SignalsRead {
  readonly signals: Signal[]
  readonly sensors: SensorRow[]
}

/** The sensors' signals and the sensors themselves, as the Inbox and the
 *  factory's front door both poll them (sensors announce nothing). */
export async function readSignals(): Promise<SignalsRead> {
  const [sig, sen] = await Promise.all([
    foundryInvoke('foundry:signals.list'),
    foundryInvoke('foundry:sensors.list'),
  ])
  return { signals: sig.signals ?? [], sensors: sen.sensors ?? [] }
}
