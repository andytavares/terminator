import type { ActionUsage, DirectUse } from '../../shared/types'
import type { QuickAction } from './types'

export function recordUsage(usage: ActionUsage[], id: string, now: number): ActionUsage[] {
  const existing = usage.find((u) => u.id === id)
  if (!existing) return [...usage, { id, count: 1, lastUsedAt: now }]
  return usage.map((u) => (u.id === id ? { ...u, count: u.count + 1, lastUsedAt: now } : u))
}

export function pruneUsage<T extends { id: string }>(entries: T[], liveIds: Set<string>): T[] {
  return entries.filter((e) => liveIds.has(e.id))
}

export function togglePin(pins: string[], id: string): string[] {
  return pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]
}

/** @internal */
export const HINT_LIMIT = 3

/** Counts a shortcut use up to HINT_LIMIT; past it the same list comes back, so nothing needs saving. */
export function recordDirectUse(directUse: DirectUse[], id: string): DirectUse[] {
  const existing = directUse.find((d) => d.id === id)
  if (!existing) return [...directUse, { id, count: 1 }]
  if (existing.count >= HINT_LIMIT) return directUse
  return directUse.map((d) => (d.id === id ? { ...d, count: d.count + 1 } : d))
}

export function shouldShowHint(
  action: Pick<QuickAction, 'id' | 'shortcut'>,
  directUse: DirectUse[]
): boolean {
  if (!action.shortcut) return false
  const count = directUse.find((d) => d.id === action.id)?.count ?? 0
  return count < HINT_LIMIT
}
