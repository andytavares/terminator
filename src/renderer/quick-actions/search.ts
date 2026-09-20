import type { QuickAction, QuickActionGroup } from './types'

function isSubsequence(query: string, text: string): boolean {
  let qi = 0
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) qi++
  }
  return qi === query.length
}

export function searchActions(
  actions: QuickAction[],
  groups: QuickActionGroup[],
  query: string,
  limit = 50
): QuickAction[] {
  if (!query) return []

  const q = query.toLowerCase()
  const groupLabelById = new Map(groups.map((g) => [g.id, g.label]))

  const tiered: { action: QuickAction; tier: number; index: number }[] = []

  actions.forEach((action, index) => {
    const label = action.label.toLowerCase()
    const text =
      `${action.label} ${groupLabelById.get(action.group) ?? ''} ${action.description ?? ''}`.toLowerCase()

    if (label.includes(q)) {
      tiered.push({ action, tier: 0, index })
    } else if (isSubsequence(q, label)) {
      tiered.push({ action, tier: 1, index })
    } else if (text.includes(q) || isSubsequence(q, text)) {
      tiered.push({ action, tier: 2, index })
    }
  })

  return tiered
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .slice(0, limit)
    .map((t) => t.action)
}
