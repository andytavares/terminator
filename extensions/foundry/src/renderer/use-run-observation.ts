import { useCallback } from 'react'
import { useFoundryQuery, ANY_RECORD } from './foundry-query.js'
import { foundryInvoke } from './foundry-invoke.js'
import type { FoundryApi } from '../ipc/foundry-api.js'

/** What the Floor draws of a run: `foundry:run.observe` answered without an error. */
export type FloorView = Exclude<FoundryApi['foundry:run.observe']['answer'], { error: string }>

/** A tool call an agent is holding at, waiting for an answer. */
export type PendingAsk = FoundryApi['foundry:permissions-list']['answer']['pending'][number]

async function readPending(): Promise<PendingAsk[]> {
  return (await foundryInvoke('foundry:permissions-list')).pending ?? []
}

// A refused observation throws, so the view last drawn stays up beside the problem.
async function readObservation(orderId: string): Promise<FloorView> {
  const answer = await foundryInvoke('foundry:run.observe', { id: orderId })
  if ('error' in answer) throw new Error(answer.error)
  return answer
}

export interface UseRunObservation {
  view: FloorView | null
  problem: string | null
  pending: PendingAsk[]
  refresh: () => Promise<void>
}

/**
 * The Floor's run observation, read again whenever Foundry says this order's
 * records or live state changed rather than fetched once.
 *
 * A single call on mount left every state chip a snapshot of whenever the
 * panel happened to open: a run that halted, failed or finished while you
 * were looking at it went on drawing `building` until you navigated away and
 * back.
 */
export function useRunObservation(orderId: string): UseRunObservation {
  const observation = useFoundryQuery(
    { key: ['observe', orderId], kinds: ANY_RECORD, orderId },
    () => readObservation(orderId)
  )
  const asks = useFoundryQuery({ key: ['pending-asks'], kinds: ['live'] }, readPending)
  const { refetch } = observation
  const refresh = useCallback(async (): Promise<void> => {
    await refetch()
  }, [refetch])
  return {
    view: observation.data ?? null,
    problem: observation.error?.message ?? null,
    pending: asks.data ?? [],
    refresh,
  }
}
