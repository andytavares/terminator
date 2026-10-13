import { useCallback, useState } from 'react'
import { usePolling } from '@terminator/extension-ui'
import { invoke } from '@terminator/extension-sdk/renderer'
import type { Signal } from '../sensors/types.js'
import { readSignals, type SensorRow, type SignalsRead } from '../components/signals-read.js'

// The sensors' signals as the Inbox and the factory's front door both show
// them, and promoting one into a draft order from either.

/**
 * The signals and the sensors that raised them, read every `pollMs`. Sensors
 * record signals on their own tick and tell nobody, so this is asked for on a
 * timer — and not while the view is hidden.
 */
export function useSignalFeed(pollMs: number) {
  const [signals, setSignals] = useState<Signal[]>([])
  const [sensors, setSensors] = useState<SensorRow[]>([])
  const showSignals = useCallback((read: SignalsRead): void => {
    setSignals(read.signals)
    setSensors(read.sensors)
  }, [])
  const refreshSignals = useCallback(() => readSignals().then(showSignals), [showSignals])
  usePolling(readSignals, showSignals, pollMs)
  return { signals, sensors, refreshSignals }
}

/** Promoting a signal: which one is open, the repository typed for it, and what it said. */
interface Promotion {
  readonly promoting: string | null
  readonly repoDraft: string
  readonly signalProblem: string | null
  readonly promoted: string | null
}

const NO_PROMOTION: Promotion = {
  promoting: null,
  repoDraft: '',
  signalProblem: null,
  promoted: null,
}

async function promoteSignal(
  id: string,
  repoPath: string
): Promise<{ order?: { id: string }; error?: string }> {
  return (await invoke('foundry:signals.promote', { id, repoPaths: [repoPath] })) as {
    order?: { id: string }
    error?: string
  }
}

/**
 * Promoting a signal into a draft: opened with the sensor's own repository
 * as the default, confirmed into an order, and the signals read again.
 */
export function usePromotion(sensors: readonly SensorRow[], refreshSignals: () => Promise<void>) {
  const [state, setState] = useState<Promotion>(NO_PROMOTION)
  const patch = (next: Partial<Promotion>): void => setState((current) => ({ ...current, ...next }))
  const startPromote = (signal: Signal) => {
    const sensor = sensors.find((s) => s.def.id === signal.sensorId)
    patch({
      signalProblem: null,
      promoted: null,
      repoDraft: sensor?.state.repoPath ?? '',
      promoting: signal.id,
    })
  }
  const confirmPromote = async (id: string) => {
    patch({ signalProblem: null })
    const result = await promoteSignal(id, state.repoDraft)
    if (result.error !== undefined) {
      patch({ signalProblem: result.error })
      return
    }
    patch({
      promoting: null,
      promoted: `Draft ${result.order?.id ?? ''} created — open it in the Forge`,
    })
    await refreshSignals()
  }
  const setPromoting = (promoting: string | null): void => patch({ promoting })
  const setRepoDraft = (repoDraft: string): void => patch({ repoDraft })
  return { ...state, setPromoting, setRepoDraft, startPromote, confirmPromote }
}
