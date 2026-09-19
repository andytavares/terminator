import type { ActionUsage } from '../../shared/types'
import type { QuickAction, QuickActionGroup } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export function frecencyScore(u: ActionUsage, now: number): number {
  const ageMs = now - u.lastUsedAt
  let weight: number
  if (ageMs <= 4 * DAY_MS) weight = 4
  else if (ageMs <= 14 * DAY_MS) weight = 2
  else if (ageMs <= 60 * DAY_MS) weight = 1
  else weight = 0.5
  return u.count * weight
}

export function rankFirstScreen(
  actions: QuickAction[],
  s: { pins: string[]; usage: ActionUsage[]; now: number; limit?: number }
): { pinned: QuickAction[]; recent: QuickAction[] } {
  const limit = s.limit ?? 4
  const byId = new Map(actions.map((a) => [a.id, a]))
  const pinnedIds = new Set(s.pins)

  const pinned = s.pins.map((id) => byId.get(id)).filter((a): a is QuickAction => a !== undefined)

  const recent = s.usage
    .filter((u) => byId.has(u.id) && !pinnedIds.has(u.id))
    .map((u) => ({ action: byId.get(u.id)!, score: frecencyScore(u, s.now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.action)

  return { pinned, recent }
}

export function orderGroups(
  groups: QuickActionGroup[],
  contextGroupId: string | null
): QuickActionGroup[] {
  if (!contextGroupId) return groups
  const contextGroup = groups.find((g) => g.id === contextGroupId)
  if (!contextGroup) return groups
  return [contextGroup, ...groups.filter((g) => g.id !== contextGroupId)]
}
