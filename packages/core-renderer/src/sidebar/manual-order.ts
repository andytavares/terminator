/**
 * Folds a drag over the visible rows back into the list that is stored.
 *
 * The list you drag in is the list you can see, and a view or a search can be
 * hiding part of the stored one. Persisting the visible order on its own would
 * send every hidden row to the end — the stores append what an order does not
 * mention — so only the slots the visible rows occupy are rewritten and
 * everything else stays where it was.
 */
export function mergeReorder<T>(all: T[], reordered: T[], idOf: (item: T) => string): T[] {
  const present = new Set(all.map(idOf))
  const queue = reordered.filter((item) => present.has(idOf(item)))
  const moved = new Set(queue.map(idOf))
  return all.map((item) => (moved.has(idOf(item)) ? queue.shift()! : item))
}
