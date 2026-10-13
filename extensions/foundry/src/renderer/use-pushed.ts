import { useEffect, useRef } from 'react'
import type { ChangeKind, FoundryChange } from '../state/foundry-index.js'

/** Which changes a view cares about. No `orderId` means any order's. */
export interface ChangeFilter {
  readonly kinds: readonly ChangeKind[]
  readonly orderId?: string
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

interface SettledReader {
  /** Read now. */
  now(): void
  /** Something relevant changed: read once the burst is over. */
  notify(): void
  cancel(): void
}

// A change arriving mid-read is read again afterwards: that read may have begun before
// the write it reports.
function createSettledReader(load: () => Promise<void>): SettledReader {
  let reading = false
  let stale = false
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const readNow = async (): Promise<void> => {
    reading = true
    try {
      await load()
    } finally {
      reading = false
      if (stale && !cancelled) readOnceSettled()
    }
  }
  const readOnceSettled = (): void => {
    stale = false
    timer ??= setTimeout(() => {
      timer = null
      void readNow()
    }, SETTLE_MS)
  }
  return {
    now: () => void readNow(),
    notify: () => (reading ? (stale = true) : readOnceSettled()),
    cancel() {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    },
  }
}

// Switching workspace moves the records location under every view with nothing written
// to say so, so it counts as a change to all of them.
function onFoundryChanged(filter: ChangeFilter, relevant: () => void): () => void {
  const bridge = window.electronAPI.extensionBridge
  const stopChanges = bridge.on('foundry:changed', (data: unknown) => {
    if (isRelevant(data as FoundryChange, filter)) relevant()
  })
  const stopSwitch = bridge.on('workspace:changed', relevant)
  return () => {
    stopChanges()
    stopSwitch()
  }
}

// Read once on mount, then again only when `foundry:changed` names something this view
// draws. Reading and showing are separate, so state is set only in a read's callback.
export function usePushed<T>(
  read: () => Promise<T>,
  show: (answer: T) => void,
  filter: ChangeFilter
): void {
  const kinds = filter.kinds.join(',')
  const { orderId } = filter
  const reader = useRef<SettledReader | null>(null)
  // Reads on mount, and again when what is read changes. Changing only which
  // changes are listened to does not read.
  useEffect(() => {
    let mounted = true
    const current = createSettledReader(async () => {
      const answer = await read()
      if (mounted) show(answer)
    })
    reader.current = current
    current.now()
    return () => {
      mounted = false
      current.cancel()
    }
  }, [read, show])
  useEffect(
    () =>
      onFoundryChanged({ kinds: kinds.split(',') as ChangeKind[], orderId }, () =>
        reader.current?.notify()
      ),
    [kinds, orderId]
  )
}
