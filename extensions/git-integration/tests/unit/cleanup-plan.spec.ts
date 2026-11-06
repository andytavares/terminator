import { describe, it, expect } from 'vitest'
import {
  anyCleanupRuleOn,
  planCleanup,
  type CleanupSettings,
  type MergedHead,
} from '../../src/git/cleanup-plan'
import { parseChanges, type LocalInventoryRow } from '../../src/git/local-inventory'

const NOW = Date.parse('2026-11-04T00:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

const OFF: CleanupSettings = {
  removeAfterMerge: false,
  idleDays: 0,
  removeUnchanged: false,
  removeWithClosedSessions: false,
  keep: 'uncommitted',
}

function row(overrides: Partial<LocalInventoryRow>): LocalInventoryRow {
  return {
    branch: 'feat/x',
    tip: 'abc123',
    worktreePath: '/repo/.worktrees/x',
    isMain: false,
    isCurrent: false,
    lastCommitAt: NOW,
    createdAt: NOW,
    modifiedAt: NOW,
    merged: false,
    upstream: null,
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    prunable: false,
    isAgent: false,
    project: null,
    ...overrides,
  }
}

const MERGED_X = [{ branch: 'feat/x', oid: 'abc123' }]
const plan = (
  rows: LocalInventoryRow[],
  settings: Partial<CleanupSettings>,
  mergedHeads: MergedHead[] = []
) => planCleanup({ rows, mergedHeads, settings: { ...OFF, ...settings }, now: NOW })

describe('planCleanup — rules', () => {
  it('removes nothing when every rule is off', () => {
    const rows = [row({ merged: true, project: { id: 'p', name: 'P' } })]
    expect(plan(rows, {}, MERGED_X)).toEqual({ remove: [], keep: [] })
    expect(anyCleanupRuleOn(OFF)).toBe(false)
  })

  it('removes a squash-merged head with force although git says not merged', () => {
    const result = plan([row({ merged: false })], { removeAfterMerge: true }, MERGED_X)
    expect(result.remove).toEqual([
      {
        branch: 'feat/x',
        worktreePath: '/repo/.worktrees/x',
        forceBranch: true,
        reason: 'Its pull request merged',
      },
    ])
  })
})

describe('planCleanup — a branch that moved on after its merge', () => {
  it('neither removes nor force-deletes a branch with commits after the merged head', () => {
    const result = plan([row({ tip: 'later999' })], { removeAfterMerge: true }, MERGED_X)
    expect(result).toEqual({ remove: [], keep: [] })
  })

  it('removes a branch reusing a merged name only by another rule, never with force', () => {
    const rows = [
      row({ tip: 'other', lastCommitAt: NOW - 30 * DAY_MS, modifiedAt: NOW - 30 * DAY_MS }),
    ]
    const result = plan(rows, { removeAfterMerge: true, idleDays: 14 }, MERGED_X)
    expect(result.remove.map((r) => r.forceBranch)).toEqual([false])
  })
})

describe('planCleanup — more rules', () => {
  it('removes an idle row without force and reports the days', () => {
    const idle = row({ lastCommitAt: NOW - 21 * DAY_MS, modifiedAt: NOW - 21 * DAY_MS })
    const fresh = row({ branch: 'feat/y', lastCommitAt: NOW - 3 * DAY_MS, modifiedAt: NOW })
    const result = plan([idle, fresh], { idleDays: 14 })
    expect(result.remove.map((r) => [r.branch, r.forceBranch, r.reason])).toEqual([
      ['feat/x', false, 'Idle for 21 days'],
    ])
  })

  it('removes a branch with no commits beyond the default branch when removeUnchanged is on', () => {
    const result = plan([row({ merged: true }), row({ branch: 'feat/y' })], {
      removeUnchanged: true,
    })
    expect(result.remove.map((r) => r.branch)).toEqual(['feat/x'])
  })

  it('removes a row whose Terminator card has no open terminal, by its rule', () => {
    const result = plan([row({ project: { id: 'p', name: 'P' } })], {
      removeWithClosedSessions: true,
    })
    expect(result.remove.map((r) => r.reason)).toEqual(['Its terminal is closed'])
  })

  it('never plans the main worktree or the current branch', () => {
    const rows = [row({ isMain: true, merged: true }), row({ isCurrent: true, merged: true })]
    expect(plan(rows, { removeUnchanged: true }, [])).toEqual({ remove: [], keep: [] })
  })
})

describe('planCleanup — keep', () => {
  const dirty = row({ merged: true, changes: { tracked: 1, untracked: 1 } })

  it('keeps a worktree with uncommitted changes under the default', () => {
    const result = plan([dirty], { removeUnchanged: true })
    expect(result.remove).toEqual([])
    expect(result.keep.map((k) => [k.row.branch, k.reason])).toEqual([
      ['feat/x', '2 uncommitted changes'],
    ])
  })

  it('edited-tracked ignores untracked files', () => {
    const untrackedOnly = row({ merged: true, changes: { tracked: 0, untracked: 3 } })
    expect(
      plan([untrackedOnly], { removeUnchanged: true, keep: 'edited-tracked' }).remove
    ).toHaveLength(1)
    expect(plan([dirty], { removeUnchanged: true, keep: 'edited-tracked' }).keep[0].reason).toBe(
      '1 edited tracked file'
    )
  })

  it('any-local also keeps unpushed commits', () => {
    const ahead = row({ merged: true, ahead: 2 })
    expect(plan([ahead], { removeUnchanged: true }).remove).toHaveLength(1)
    const kept = plan([ahead], { removeUnchanged: true, keep: 'any-local' }).keep
    expect(kept.map((k) => k.reason)).toEqual(['2 unpushed commits'])
  })
})

describe('parseChanges', () => {
  it('splits porcelain lines into tracked and untracked', () => {
    expect(parseChanges(' M a.ts\n?? b.ts\nA  c.ts\n')).toEqual({ tracked: 2, untracked: 1 })
    expect(parseChanges('')).toEqual({ tracked: 0, untracked: 0 })
  })
})
