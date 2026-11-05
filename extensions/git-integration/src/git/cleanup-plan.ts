import type { LocalInventoryRow } from './local-inventory.js'
import type { RemoveItem } from './remove-local.js'

// The Worktrees cleanup rules (settings `worktrees.*`) as a pure plan: which rows to remove, and
// which a rule picked but the keep setting protects, each with the reason in plain words.

export type KeepMode = 'uncommitted' | 'any-local' | 'edited-tracked'

/** A merged pull request's head on GitHub: its branch and the commit it merged. */
export interface MergedHead {
  branch: string
  oid: string
}

/** Merged on GitHub, and the branch still ends at the commit that merged: a squash merge
 *  counts, but commits made after the merge, or a reused name, do not. */
function mergedOnGitHub(row: LocalInventoryRow, heads: MergedHead[]): boolean {
  return heads.some((head) => head.branch === row.branch && head.oid === row.tip)
}

export interface CleanupSettings {
  removeAfterMerge: boolean
  /** 0 turns the rule off. */
  idleDays: number
  removeUnchanged: boolean
  removeWithClosedSessions: boolean
  keep: KeepMode
}

interface PlannedRemoval extends RemoveItem {
  reason: string
}

export interface CleanupPlan {
  remove: PlannedRemoval[]
  keep: Array<{ row: LocalInventoryRow; reason: string }>
}

interface PlanInput {
  rows: LocalInventoryRow[]
  /** Head branch names of the pull requests GitHub reports merged: `git branch --merged` misses squash merges. */
  mergedHeads: MergedHead[]
  settings: CleanupSettings
  now: number
}

const DAY_MS = 24 * 60 * 60 * 1000

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

/** Whether any rule is on, so a refresh knows to plan at all. */
export function anyCleanupRuleOn(settings: CleanupSettings): boolean {
  return (
    settings.removeAfterMerge ||
    settings.idleDays > 0 ||
    settings.removeUnchanged ||
    settings.removeWithClosedSessions
  )
}

/** The first rule that picks the row, as the reason shown for its removal; null when none does. */
function removalReason(row: LocalInventoryRow, input: PlanInput): string | null {
  const { settings, mergedHeads, now } = input
  if (settings.removeAfterMerge && mergedOnGitHub(row, mergedHeads))
    return 'Its pull request merged'
  if (settings.removeUnchanged && row.merged) return 'No commits beyond the default branch'
  if (settings.removeWithClosedSessions && row.project) return 'Its terminal is closed'
  return idleReason(row, settings.idleDays, now)
}

function idleReason(row: LocalInventoryRow, limitDays: number, now: number): string | null {
  const idleDays = Math.floor((now - Math.max(row.modifiedAt ?? 0, row.lastCommitAt)) / DAY_MS)
  return limitDays > 0 && idleDays >= limitDays ? `Idle for ${plural(idleDays, 'day')}` : null
}

/** Why the row holds work the keep setting protects; null when removing it loses none. */
function keepReason(row: LocalInventoryRow, keep: KeepMode): string | null {
  const { tracked = 0, untracked = 0 } = row.changes ?? {}
  if (keep === 'edited-tracked')
    return tracked > 0 ? `${plural(tracked, 'edited tracked file')}` : null
  if (tracked + untracked > 0) return `${plural(tracked + untracked, 'uncommitted change')}`
  if (keep === 'any-local' && row.ahead > 0) return `${plural(row.ahead, 'unpushed commit')}`
  return null
}

/** The rows the rules remove and the rows they keep, each with its reason. Never plans the main
 *  worktree or the current branch. A branch GitHub reports merged is deleted with force. */
export function planCleanup(input: PlanInput): CleanupPlan {
  const plan: CleanupPlan = { remove: [], keep: [] }
  for (const row of input.rows) {
    if (row.isMain || row.isCurrent) continue
    const reason = removalReason(row, input)
    if (reason === null) continue
    const kept = keepReason(row, input.settings.keep)
    if (kept !== null) plan.keep.push({ row, reason: kept })
    else
      plan.remove.push({
        branch: row.branch,
        worktreePath: row.worktreePath,
        forceBranch: mergedOnGitHub(row, input.mergedHeads),
        reason,
      })
  }
  return plan
}
