import type { WorkKey } from '../../shared/schemas/home-feed.schema'
import type { FocusItem } from './focus'

// Checks for what the Desk keeps in localStorage. Hand-written: the renderer ships without zod.

type Fields = Record<string, unknown>

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOptionalOf = (value: unknown, kind: 'string' | 'number' | 'boolean'): boolean =>
  value === undefined || typeof value === kind

function isWorkKey(value: unknown): value is WorkKey {
  if (!isObject(value)) return false
  const ticket = typeof value.tracker === 'string' && typeof value.key === 'string'
  return ticket || (typeof value.repoRoot === 'string' && typeof value.branch === 'string')
}

function isFocusItem(value: unknown): value is FocusItem {
  if (!isObject(value)) return false
  const named = typeof value.id === 'string' && typeof value.title === 'string'
  const keyed = value.workKey === undefined || isWorkKey(value.workKey)
  return (
    named && keyed && isOptionalOf(value.detail, 'string') && typeof value.doneByHand === 'boolean'
  )
}

export interface StoredFocus {
  days: Record<string, FocusItem[]>
  planDismissedOn: string | null
  planCollapsed: boolean
}

const nullable = (value: unknown, kind: 'string' | 'number'): boolean =>
  value === null || isOptionalOf(value, kind)

/** The stored focus, or null when it is not shaped like one; missing fields read as empty. */
export function storedFocusOf(value: unknown): StoredFocus | null {
  if (!isObject(value) || !isObject(value.days)) return null
  const days = Object.values(value.days)
  if (!days.every((items) => Array.isArray(items) && items.every(isFocusItem))) return null
  if (!nullable(value.planDismissedOn, 'string') || !isOptionalOf(value.planCollapsed, 'boolean')) {
    return null
  }
  return {
    days: value.days as Record<string, FocusItem[]>,
    planDismissedOn: (value.planDismissedOn as string | undefined) ?? null,
    planCollapsed: (value.planCollapsed as boolean | undefined) ?? false,
  }
}

/** Parked keys with when each was parked; the first version stored the keys alone, read as `now`. */
export function storedParkedOf(value: unknown, now: number): Record<string, number> | null {
  if (Array.isArray(value)) {
    if (!value.every((key) => typeof key === 'string')) return null
    return Object.fromEntries(value.map((key: string) => [key, now]))
  }
  if (!isObject(value) || !Object.values(value).every((at) => typeof at === 'number')) return null
  return value as Record<string, number>
}

/** Dismissed keys with the thread activity each was dismissed at. */
export function storedDismissedOf(value: unknown): Record<string, number> | null {
  if (!isObject(value) || !Object.values(value).every((at) => typeof at === 'number')) return null
  return value as Record<string, number>
}
