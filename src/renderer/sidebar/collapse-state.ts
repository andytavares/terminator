import { readStoredJson, writeStoredJson } from '../home/local-storage'
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
/**
 * The namespace branch rows use for their terminal lists.
 *
 * Not a grouping mode — a branch's terminals are the same set however the
 * sidebar is grouped, so they share one namespace rather than being
 * partitioned like group keys are.
 */
export const TERMINALS_NAMESPACE = 'branch-terminals'

export type CollapseNamespace = GroupKey | typeof TERMINALS_NAMESPACE

export type CollapseState = Partial<Record<CollapseNamespace, string[]>>

/** @internal */
export const COLLAPSE_STORAGE_KEY = 'terminator.sidebar.collapsed'

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function collapseStateFrom(parsed: unknown): CollapseState | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const state: CollapseState = {}
  for (const [mode, keys] of Object.entries(parsed)) {
    if (isStringArray(keys)) state[mode as CollapseNamespace] = keys
  }
  return state
}

export function loadCollapseState(): CollapseState {
  return readStoredJson<CollapseState>(COLLAPSE_STORAGE_KEY, {}, collapseStateFrom)
}

export function saveCollapseState(state: CollapseState): void {
  writeStoredJson(COLLAPSE_STORAGE_KEY, state)
}

export function isCollapsed(
  state: CollapseState,
  mode: CollapseNamespace,
  groupKey: string
): boolean {
  return state[mode]?.includes(groupKey) ?? false
}

export function toggleCollapsed(
  state: CollapseState,
  mode: CollapseNamespace,
  groupKey: string
): CollapseState {
  const current = state[mode] ?? []
  const next = current.includes(groupKey)
    ? current.filter((k) => k !== groupKey)
    : [...current, groupKey]
  return { ...state, [mode]: next }
}
