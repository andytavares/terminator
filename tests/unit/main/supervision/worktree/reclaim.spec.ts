import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { findReclaimable } from '../../../../../src/main/supervision/worktree/reclaim.js'
import type { SupervisedSession } from '../../../../../src/shared/types/supervision.js'

// Working copies outlive the sessions that made them. Removing the wrong one
// destroys work an agent is still doing, so the rule has to be conservative:
// only what nothing needs.

let root: string
beforeEach(() => (root = mkdtempSync(join(tmpdir(), 'reclaim-'))))
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))

function worktree(name: string): string {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}

function session(over: Partial<SupervisedSession> = {}): SupervisedSession {
  return {
    id: 's1',
    workItemId: null,
    laneOrd: null,
    repoPath: '/repos/fluent',
    worktreePath: join(root, 'a'),
    branch: 'feat/x',
    transcriptPath: null,
    runtimeState: 'working',
    stateSince: 1,
    lastToolActivityAt: null,
    lastNetChangeAt: null,
    openShellCallId: null,
    turns: 0,
    costUsd: 0,
    contextPct: null,
    pendingPermission: null,
    diffSummary: { files: 0, added: 0, removed: 0 },
    autonomyLevel: 'edit',
    lastViewedAt: null,
    runtimeSessionId: null,
    failure: null,
    ...over,
  }
}

describe('finding what can be reclaimed', () => {
  it('reports a directory no session references as an orphan', () => {
    const path = worktree('orphan')
    const found = findReclaimable(root, [])
    expect(found).toEqual([
      { path, reason: 'orphan', sessionId: null, branch: null, repoPath: null },
    ])
  })

  it('reports the copy of a session that merged', () => {
    const path = worktree('a')
    const found = findReclaimable(root, [session({ runtimeState: 'merged', worktreePath: path })])
    expect(found[0]).toMatchObject({ path, reason: 'finished', sessionId: 's1' })
  })

  it('reports the copy of a session that failed', () => {
    const path = worktree('a')
    const found = findReclaimable(root, [session({ runtimeState: 'failed', worktreePath: path })])
    expect(found[0]?.reason).toBe('finished')
  })

  it('never reports a copy a session is still working in', () => {
    const path = worktree('a')
    expect(findReclaimable(root, [session({ worktreePath: path })])).toEqual([])
  })

  it('never reports a copy whose session is waiting on the operator', () => {
    const path = worktree('a')
    expect(
      findReclaimable(root, [session({ runtimeState: 'needs_input', worktreePath: path })])
    ).toEqual([])
  })

  it('never reports a copy whose session is ready — its diff is unreviewed', () => {
    // The most dangerous one to delete: the work is finished and unseen.
    const path = worktree('a')
    expect(findReclaimable(root, [session({ runtimeState: 'ready', worktreePath: path })])).toEqual(
      []
    )
  })

  it('never reports a stalled session’s copy', () => {
    const path = worktree('a')
    expect(
      findReclaimable(root, [session({ runtimeState: 'stalled', worktreePath: path })])
    ).toEqual([])
  })

  it('ignores files beside the working copies', () => {
    worktree('a')
    writeFileSync(join(root, 'notes.txt'), 'x')
    expect(findReclaimable(root, []).map((entry) => entry.path)).toEqual([join(root, 'a')])
  })

  it('reports nothing when the root does not exist yet, which is a fresh install', () => {
    expect(findReclaimable(join(root, 'nope'), [])).toEqual([])
  })

  it('returns them in a stable order', () => {
    worktree('c')
    worktree('a')
    worktree('b')
    expect(findReclaimable(root, []).map((e) => e.path.split('/').pop())).toEqual(['a', 'b', 'c'])
  })

  it('separates the orphans from the finished ones', () => {
    const live = worktree('live')
    worktree('orphan')
    const done = worktree('done')
    const found = findReclaimable(root, [
      session({ id: 's1', worktreePath: live }),
      session({ id: 's2', runtimeState: 'merged', worktreePath: done }),
    ])
    expect(found.map((entry) => entry.reason).sort()).toEqual(['finished', 'orphan'])
  })
})

// After a restart every session the console was watching becomes `unknown` —
// and a restart is exactly when you go looking for copies to reclaim. Leaving
// these out made the list permanently empty.

describe('a session the console lost track of', () => {
  it('is reclaimable when it changed nothing', () => {
    const path = worktree('a')
    const found = findReclaimable(root, [session({ runtimeState: 'unknown', worktreePath: path })])
    expect(found[0]).toMatchObject({ path, reason: 'lost', sessionId: 's1' })
  })

  it('is withheld when it holds changes nobody has reviewed', () => {
    // Losing track of a session is not a reason to throw its work away.
    const path = worktree('a')
    const found = findReclaimable(root, [
      session({
        runtimeState: 'unknown',
        worktreePath: path,
        diffSummary: { files: 4, added: 120, removed: 8 },
      }),
    ])
    expect(found).toEqual([])
  })

  it('names its branch, so you know what you are throwing away', () => {
    const path = worktree('a')
    const found = findReclaimable(root, [
      session({ runtimeState: 'unknown', worktreePath: path, branch: 'feat/session-ulid' }),
    ])
    expect(found[0]?.branch).toBe('feat/session-ulid')
  })
})

describe('the same directory named two ways', () => {
  it('matches a session whose path is not the canonical one', () => {
    // On macOS /var/... and /private/var/... are the same place. Compared as
    // raw strings, a live working copy looks like an orphan.
    const path = worktree('a')
    const found = findReclaimable(root, [session({ worktreePath: path.replace('/private/', '/') })])
    // Still working, so still not reclaimable — the point is that it was
    // recognised as the same directory at all.
    expect(found).toEqual([])
  })
})
