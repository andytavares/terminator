// Parallel orders that touch the same files queue behind each other.
//
// Two orders agreed against the same repo and base can each be sound on
// their own and still collide on disk if they touch the same files. The
// queue answers "who's ahead of whom" — scoped to files that actually
// overlap, not merely the same repo — so a later order sees it will queue
// behind an earlier one rather than discovering it as a merge conflict.

export interface QueueEntry {
  readonly orderId: string
  readonly title: string
  readonly repo: string
  readonly base: string
  readonly agreedAt: string
  readonly files: readonly string[]
  readonly merged: boolean
}

export interface QueuePosition {
  readonly orderId: string
  readonly position: number
  readonly behind: readonly { orderId: string; title: string; files: readonly string[] }[]
}

function sharedFiles(a: readonly string[], b: readonly string[]): string[] {
  const bSet = new Set(b)
  return a.filter((file) => bSet.has(file))
}

function groupKey(entry: Pick<QueueEntry, 'repo' | 'base'>): string {
  return `${entry.repo}\u0000${entry.base}`
}

export function queue(entries: readonly QueueEntry[]): QueuePosition[] {
  const groups = new Map<string, QueueEntry[]>()
  for (const entry of entries) {
    if (entry.merged) continue
    const key = groupKey(entry)
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }

  const positions: QueuePosition[] = []
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => a.agreedAt.localeCompare(b.agreedAt))
    ordered.forEach((entry, index) => {
      const earlier = ordered.slice(0, index)
      const behind = earlier
        .map((other) => ({
          orderId: other.orderId,
          title: other.title,
          files: sharedFiles(entry.files, other.files),
        }))
        .filter((b) => b.files.length > 0)
      positions.push({ orderId: entry.orderId, position: index + 1, behind })
    })
  }
  return positions
}

export function laterOverlapping(
  entries: readonly QueueEntry[],
  mergedOrderId: string
): { orderId: string; files: readonly string[] }[] {
  const merged = entries.find((entry) => entry.orderId === mergedOrderId)
  if (!merged) return []

  return entries
    .filter(
      (entry) =>
        entry.orderId !== mergedOrderId &&
        !entry.merged &&
        entry.repo === merged.repo &&
        entry.base === merged.base &&
        entry.agreedAt > merged.agreedAt
    )
    .map((entry) => ({ orderId: entry.orderId, files: sharedFiles(entry.files, merged.files) }))
    .filter((entry) => entry.files.length > 0)
}

export function advisory(
  draft: { repo: string; base: string; files: readonly string[] },
  entries: readonly QueueEntry[]
): string | null {
  const overlapping = entries
    .filter((entry) => !entry.merged && entry.repo === draft.repo && entry.base === draft.base)
    .map((entry) => ({ orderId: entry.orderId, files: sharedFiles(draft.files, entry.files) }))
    .filter((entry) => entry.files.length > 0)

  if (overlapping.length === 0) return null

  const sharedFileCount = new Set(overlapping.flatMap((entry) => entry.files)).size
  const orderIds = overlapping.map((entry) => entry.orderId)

  if (orderIds.length === 1) {
    return `Overlaps ${orderIds[0]} on ${sharedFileCount} file${sharedFileCount === 1 ? '' : 's'}; it will queue behind it.`
  }

  const names = `${orderIds.slice(0, -1).join(', ')} and ${orderIds[orderIds.length - 1]}`
  return `Overlaps ${names} on ${sharedFileCount} files; it will queue behind them.`
}
