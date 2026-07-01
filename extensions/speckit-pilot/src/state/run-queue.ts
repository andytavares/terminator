/** Whether a new run must wait because the concurrency cap is reached. */
export function shouldQueue(activeCount: number, cap: number): boolean {
  return activeCount >= Math.max(1, cap)
}

/** Oldest-first ordering of pending cards by run start time. */
export function orderPending<T extends { startedAt: string | null }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
}
