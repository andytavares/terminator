import type { QuickAction, QuickActionGroup } from './types'

function isSubsequence(query: string, text: string): boolean {
  let qi = 0
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) qi++
  }
  return qi === query.length
}

/** The most results a search shows. @internal */
export const MAX_RESULTS = 50

/** How well `action` matches: 0 for its label containing the query, 1 for the query's letters in
 * order in its label, 2 for either in its label, group and description together; null for no
 * match. */
function tierOf(action: QuickAction, q: string, groupLabel: string): number | null {
  const label = action.label.toLowerCase()
  const text = `${action.label} ${groupLabel} ${action.description ?? ''}`.toLowerCase()
  if (label.includes(q)) return 0
  if (isSubsequence(q, label)) return 1
  if (text.includes(q) || isSubsequence(q, text)) return 2
  return null
}

export function searchActions(
  actions: QuickAction[],
  groups: QuickActionGroup[],
  query: string
): QuickAction[] {
  if (!query) return []
  const q = query.toLowerCase()
  const groupLabelById = new Map(groups.map((g) => [g.id, g.label]))
  return actions
    .map((action, index) => ({
      action,
      index,
      tier: tierOf(action, q, groupLabelById.get(action.group) ?? ''),
    }))
    .filter((t): t is { action: QuickAction; index: number; tier: number } => t.tier !== null)
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map((t) => t.action)
}
