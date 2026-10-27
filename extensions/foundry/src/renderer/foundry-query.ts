import { useEffect } from 'react'
import { keepPreviousData, QueryClient, useQuery, type Query } from '@tanstack/react-query'
import type { ChangeKind, FoundryChange } from '../state/foundry-index.js'

/** Which changes a view cares about. No `orderId` means any order's. */
interface ChangeFilter extends Record<string, unknown> {
  readonly kinds: readonly ChangeKind[]
  readonly orderId?: string
}

// Every Foundry query carries the changes it answers to as its `meta`.
declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: ChangeFilter
  }
}

/** Every kind of record an order's state is drawn from. */
export const ANY_RECORD: readonly ChangeKind[] = ['order', 'graph', 'gates', 'ledger', 'live']

/** A change with no order (a held tool call) concerns every view of its kind. @internal */
export function isRelevant(change: FoundryChange, filter: ChangeFilter): boolean {
  if (!filter.kinds.includes(change.kind)) return false
  return filter.orderId === undefined || change.orderId === '' || change.orderId === filter.orderId
}

/** A run writes records in a burst; one read after the burst answers for all of them. */
const SETTLE_MS = 100

/** Nothing polls: a query is read on mount and when a change invalidates it. */
function createFoundryQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: 2000,
        retry: false,
      },
    },
  })
}

interface Burst {
  /** Switching workspace moves the records under every view, so it concerns all of them. */
  everything: boolean
  changes: FoundryChange[]
}

// A read begun before the change may predate the write it reports, so a read in
// flight is dropped (the first read of a query is not dropped by invalidation alone).
function invalidate(client: QueryClient, burst: Burst): void {
  const filter = {
    queryKey: ['foundry'],
    predicate: (query: Query) =>
      burst.everything ||
      burst.changes.some((change) => query.meta !== undefined && isRelevant(change, query.meta)),
  }
  void client.cancelQueries(filter).then(() => client.invalidateQueries(filter))
}

// Listens once for `foundry:changed` and `workspace:changed` and invalidates the queries
// that draw what changed, once the burst is over. Returns the unsubscribe.
function connectFoundryQueries(client: QueryClient): () => void {
  const bridge = window.electronAPI.extensionBridge
  let burst: Burst = { everything: false, changes: [] }
  let timer: ReturnType<typeof setTimeout> | null = null
  const settle = (note: (open: Burst) => void): void => {
    note(burst)
    timer ??= setTimeout(() => {
      timer = null
      const settled = burst
      burst = { everything: false, changes: [] }
      invalidate(client, settled)
    }, SETTLE_MS)
  }
  const stopChanges = bridge.on('foundry:changed', (data: unknown) =>
    settle((open) => open.changes.push(data as FoundryChange))
  )
  const stopSwitch = bridge.on('workspace:changed', () =>
    settle((open) => {
      open.everything = true
    })
  )
  return () => {
    stopChanges()
    stopSwitch()
    if (timer !== null) clearTimeout(timer)
  }
}

/** The cache key of a query whose `FoundryQuerySpec.key` is `key`, for a view that writes it. */
export const foundryKey = (key: readonly unknown[]): unknown[] => ['foundry', ...key]

/** The one cache every Foundry view reads through. */
export const foundryQueries = createFoundryQueryClient()

let mounted = 0
let stopListening: (() => void) | null = null

// The bridge is listened to while any Foundry view is mounted, and the cache is dropped
// when the last one goes, so a window that shows nothing holds nothing. The check runs
// after a tick so a remount in the same commit (StrictMode) keeps the listener.
function useListening(): void {
  useEffect(() => {
    mounted++
    stopListening ??= connectFoundryQueries(foundryQueries)
    return () => {
      mounted--
      queueMicrotask(() => {
        if (mounted > 0) return
        stopListening?.()
        stopListening = null
        foundryQueries.clear()
      })
    }
  }, [])
}

export interface FoundryQuerySpec extends ChangeFilter {
  /** Names the read and everything it depends on; the cache key is `['foundry', ...key]`. */
  readonly key: readonly unknown[]
}

// Reads on mount and again when a change names a kind in `kinds`. A new key keeps the
// last answer on show until its own arrives.
export function useFoundryQuery<T>(spec: FoundryQuerySpec, read: () => Promise<T>) {
  const { key, kinds, orderId } = spec
  useListening()
  return useQuery(
    {
      queryKey: foundryKey(key),
      queryFn: read,
      meta: { kinds, orderId },
      placeholderData: keepPreviousData,
    },
    foundryQueries
  )
}
