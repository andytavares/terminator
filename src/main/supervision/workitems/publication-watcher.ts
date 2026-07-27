import { existsSync, mkdirSync, readdirSync, readFileSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { parseWorkItemContract, type WorkItemContract } from './contract-schema.js'

// Watches the console-owned publication directory (FR-070 – FR-074).
//
// The console defines this location and its schema. It never reads, writes, or
// watches any path inside a producer's own directory, and holds no knowledge of
// any producer's internal layout (FR-072).
//
// The watcher deliberately does not trust `fs.watch`'s event payload: it is
// documented as unreliable about *which* file changed and coalesces or
// duplicates events (a spike saw two for a single atomic create). Every event
// is treated as an untyped "something changed", debounced, and followed by a
// full re-scan. The tree is shallow and low-churn, so that is cheap and immune
// to the failure modes that would otherwise argue for a dependency
// (research.md R7).

export interface PublishedItem {
  readonly producerId: string
  readonly filePath: string
  readonly item: WorkItemContract
}

export interface UnreadableItem {
  readonly producerId: string
  readonly filePath: string
  readonly reason: string
}

export interface ConflictedItem {
  readonly workItemId: string
  readonly producers: string[]
}

export interface PublicationSnapshot {
  readonly items: PublishedItem[]
  readonly unreadable: UnreadableItem[]
  /** Same id from two producers — reported, never silently resolved (FR-074). */
  readonly conflicts: ConflictedItem[]
}

const DEBOUNCE_MS = 120

// fs.watch is not merely imprecise about *which* file changed — under load, or
// on a directory that has been recreated, it can miss an event entirely. A
// periodic re-scan makes correctness independent of the OS event: the watch is
// what makes the board feel live, the backstop is what makes it right.
const BACKSTOP_MS = 1_000

export function publicationRoot(userDataPath: string): string {
  return join(userDataPath, 'supervision', 'workitems')
}

/** Reads the whole directory. Cheap: one shallow level of producers, a file per item. */
export function scanPublications(root: string): PublicationSnapshot {
  const items: PublishedItem[] = []
  const unreadable: UnreadableItem[] = []

  if (!existsSync(root)) {
    // No producer has published anything. Not an error — sessions are still
    // supervised as ad-hoc work (FR-081).
    return { items: [], unreadable: [], conflicts: [] }
  }

  for (const producer of readdirSync(root, { withFileTypes: true })) {
    if (!producer.isDirectory()) continue
    const producerDir = join(root, producer.name)

    for (const entry of readdirSync(producerDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const filePath = join(producerDir, entry.name)

      let raw: string
      try {
        raw = readFileSync(filePath, 'utf-8')
      } catch {
        unreadable.push({ producerId: producer.name, filePath, reason: 'could not be read' })
        continue
      }

      const result = parseWorkItemContract(raw)
      if (result.ok) {
        items.push({ producerId: producer.name, filePath, item: result.item })
      } else {
        // Per-item: one bad file never affects another item or any surface.
        unreadable.push({ producerId: producer.name, filePath, reason: result.reason })
      }
    }
  }

  // Two producers publishing the same id is reported as a conflict on both,
  // never resolved by picking one (FR-074).
  const byId = new Map<string, string[]>()
  for (const published of items) {
    byId.set(published.item.id, [...(byId.get(published.item.id) ?? []), published.producerId])
  }
  const conflicts = [...byId]
    .filter(([, producers]) => producers.length > 1)
    .map(([workItemId, producers]) => ({ workItemId, producers }))

  return { items, unreadable, conflicts }
}

export interface WatcherHandle {
  snapshot(): PublicationSnapshot
  close(): void
}

export function watchPublications(
  root: string,
  onChange: (snapshot: PublicationSnapshot) => void
): WatcherHandle {
  // The console owns this directory, so it creates it rather than waiting for a
  // producer to.
  mkdirSync(root, { recursive: true })

  let current = scanPublications(root)
  let timer: ReturnType<typeof setTimeout> | null = null
  let watcher: FSWatcher | null = null

  const rescan = (): void => {
    current = scanPublications(root)
    onChange(current)
  }

  try {
    watcher = watch(root, { recursive: true }, () => {
      // Untyped signal. Debounce, then re-scan everything.
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(rescan, DEBOUNCE_MS)
    })
  } catch {
    // Recursive watching is unavailable on some platforms. The backstop below
    // keeps the board correct there, just less immediate.
    watcher = null
  }

  const backstop = setInterval(() => {
    const next = scanPublications(root)
    // Only report a genuine change, so the backstop does not re-render the
    // board every second on an idle console.
    if (JSON.stringify(next) === JSON.stringify(current)) return
    current = next
    onChange(current)
  }, BACKSTOP_MS)
  backstop.unref?.()

  return {
    snapshot: () => current,
    close: () => {
      if (timer !== null) clearTimeout(timer)
      clearInterval(backstop)
      watcher?.close()
    },
  }
}
