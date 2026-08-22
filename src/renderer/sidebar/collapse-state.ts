import type { GroupKey } from './view-model'

/**
 * Which groups are collapsed, partitioned by grouping mode.
 *
 * The polarity is *collapsed*, not expanded, so the FR-008 default (everything
 * expanded) is the empty object and needs no first-run write. Partitioning by
 * mode matters because the same key can mean different things in two modes,
 * and because branch keys are not stable across a rename.
 *
 * Supersedes terminator.workspace.expanded and terminator.project.collapsed,
 * which carried opposite polarities and could not be merged safely.
 */
export type CollapseState = Partial<Record<GroupKey, string[]>>

export const COLLAPSE_STORAGE_KEY = 'terminator.sidebar.collapsed'

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

export function loadCollapseState(): CollapseState {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const state: CollapseState = {}
    for (const [mode, keys] of Object.entries(parsed)) {
      if (isStringArray(keys)) state[mode as GroupKey] = keys
    }
    return state
  } catch {
    return {}
  }
}

export function saveCollapseState(state: CollapseState): void {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore write failures (private browsing, storage full)
  }
}

export function isCollapsed(state: CollapseState, mode: GroupKey, groupKey: string): boolean {
  return state[mode]?.includes(groupKey) ?? false
}

export function toggleCollapsed(
  state: CollapseState,
  mode: GroupKey,
  groupKey: string
): CollapseState {
  const current = state[mode] ?? []
  const next = current.includes(groupKey)
    ? current.filter((k) => k !== groupKey)
    : [...current, groupKey]
  return { ...state, [mode]: next }
}
