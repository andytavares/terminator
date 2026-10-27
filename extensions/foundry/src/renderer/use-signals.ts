import { useCallback, useState } from 'react'
import { invoke } from '@terminator/extension-sdk/renderer'
import type { Signal } from '../sensors/types.js'
import { readSignals, type SensorRow } from '../components/signals-read.js'
import { useFoundryQuery } from './foundry-query.js'

// The sensors' signals as the Inbox and the factory's front door both show
// them, and promoting one into a draft order from either.

const NO_SIGNALS: Signal[] = []
const NO_SENSORS: SensorRow[] = []

// The signals and the sensors that raised them: one query, shared by every view of it,
// read again when Foundry announces `signals` (the sensor tick and every signal write do).
export function useSignalFeed() {
  const { data, refetch } = useFoundryQuery({ key: ['signals'], kinds: ['signals'] }, readSignals)
  const refreshSignals = useCallback(async (): Promise<void> => {
    await refetch()
  }, [refetch])
  return {
    signals: data?.signals ?? NO_SIGNALS,
    sensors: data?.sensors ?? NO_SENSORS,
    refreshSignals,
  }
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

async function requestPromotion(
  id: string,
  repoPath: string
): Promise<{ order?: { id: string }; error?: string }> {
  return (await invoke('foundry:signals.promote', { id, repoPaths: [repoPath] })) as {
    order?: { id: string }
    error?: string
  }
}

// Promoting a signal into a draft: opened with the sensor's repository as the
// default, confirmed into an order, then the signals read again.
export function usePromotion(sensors: readonly SensorRow[], refreshSignals: () => Promise<void>) {
  const [state, setState] = useState<Promotion>(NO_PROMOTION)
  const patchPromotion = (next: Partial<Promotion>): void =>
    setState((current) => ({ ...current, ...next }))
  const startPromote = (signal: Signal) => {
    const sensor = sensors.find((s) => s.def.id === signal.sensorId)
    patchPromotion({
      signalProblem: null,
      promoted: null,
      repoDraft: sensor?.state.repoPath ?? '',
      promoting: signal.id,
    })
  }
  const confirmPromote = async (id: string) => {
    patchPromotion({ signalProblem: null })
    const result = await requestPromotion(id, state.repoDraft)
    if (result.error !== undefined) {
      patchPromotion({ signalProblem: result.error })
      return
    }
    patchPromotion({
      promoting: null,
      promoted: `Draft ${result.order?.id ?? ''} created — open it in the Forge`,
    })
    await refreshSignals()
  }
  const setPromoting = (promoting: string | null): void => patchPromotion({ promoting })
  const setRepoDraft = (repoDraft: string): void => patchPromotion({ repoDraft })
  return { ...state, setPromoting, setRepoDraft, startPromote, confirmPromote }
}
