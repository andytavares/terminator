import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createMergePolicy } from '../../../src/runtime/review/merge-policy.js'

// Unattended merge exists, but only under a per-repository setting that
// defaults off, with no global switch, and never when checks are anything other
// than green (FR-058 to FR-062).

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'merge-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function policy(enabledRepos: string[] = []) {
  return createMergePolicy({
    isUnattendedEnabledFor: (repoPath) => enabledRepos.includes(repoPath),
    auditLogPath: join(dir, 'merges.jsonl'),
  })
}

const item = {
  sessionId: 's1',
  repoPath: '/repo-a',
  grade: 'P3' as const,
  gradeTrigger: 'lockfile only',
  checkState: 'passing' as const,
  diffSummary: { files: 1, added: 2, removed: 1 },
}

describe('default posture (FR-058, FR-059)', () => {
  it('does not merge unattended when the repository has not enabled it', () => {
    expect(policy().mayMergeUnattended(item)).toMatchObject({ may: false })
  })

  it('merges unattended for an enabled repository with a green P3', () => {
    expect(policy(['/repo-a']).mayMergeUnattended(item)).toMatchObject({ may: true })
  })

  it('is per repository — enabling one does not enable another', () => {
    const p = policy(['/repo-a'])
    expect(p.mayMergeUnattended({ ...item, repoPath: '/repo-b' })).toMatchObject({ may: false })
  })
})

describe('grade restriction', () => {
  it.each(['P0', 'P1', 'P2'] as const)('never merges a %s unattended', (grade) => {
    expect(policy(['/repo-a']).mayMergeUnattended({ ...item, grade })).toMatchObject({
      may: false,
    })
  })
})

describe('check-state safety (FR-062)', () => {
  it.each(['pending', 'failing', 'unavailable'] as const)(
    'refuses to merge unattended when checks are %s',
    (checkState) => {
      const decision = policy(['/repo-a']).mayMergeUnattended({ ...item, checkState })
      expect(decision).toMatchObject({ may: false })
      expect(decision.reason).toContain(checkState)
    }
  )
})

describe('audit (FR-060, FR-061, SC-012)', () => {
  it('records an unattended merge with everything needed to review it later', () => {
    const p = policy(['/repo-a'])
    p.recordUnattendedMerge(item, 9_000)
    expect(p.unattendedMerges()[0]).toMatchObject({
      sessionId: 's1',
      mergedAt: 9_000,
      gradeTrigger: 'lockfile only',
      checkState: 'passing',
      diffSummary: { files: 1, added: 2, removed: 1 },
    })
  })

  it('retrieves every unattended merge with no action required at merge time', () => {
    const p = policy(['/repo-a'])
    p.recordUnattendedMerge(item, 9_000)
    p.recordUnattendedMerge({ ...item, sessionId: 's2' }, 10_000)
    expect(p.unattendedMerges()).toHaveLength(2)
  })

  it('survives a reopen, so what merged while you were away is still there', () => {
    const auditLogPath = join(dir, 'merges.jsonl')
    createMergePolicy({
      isUnattendedEnabledFor: () => true,
      auditLogPath,
    }).recordUnattendedMerge(item, 9_000)
    expect(
      createMergePolicy({ isUnattendedEnabledFor: () => true, auditLogPath }).unattendedMerges()
    ).toHaveLength(1)
  })
})

describe('no global switch (FR-059)', () => {
  it('exposes no way to enable unattended merge everywhere at once', () => {
    const p = policy()
    expect(p).not.toHaveProperty('enableGlobally')
    expect(p).not.toHaveProperty('setUnattendedForAll')
  })
})
