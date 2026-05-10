import { describe, it, expect } from 'vitest'
import { parseStatus, parseDiff } from '../../../src/main/git/git-parser'

// ─── parseStatus ─────────────────────────────────────────────────────────────

describe('parseStatus', () => {
  it('returns empty result for blank stdout', () => {
    const result = parseStatus('', 500)
    expect(result).toEqual({ branch: '', files: [], hasConflicts: false, truncated: false })
  })

  it('returns empty result for whitespace-only stdout', () => {
    const result = parseStatus('   \n  ', 500)
    expect(result).toEqual({ branch: '', files: [], hasConflicts: false, truncated: false })
  })

  it('parses untracked file', () => {
    const result = parseStatus('?? src/foo.ts', 500)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatchObject({
      path: 'src/foo.ts',
      status: 'untracked',
      staged: false,
    })
  })

  it('parses ignored file', () => {
    const result = parseStatus('!! node_modules/', 500)
    expect(result.files[0]).toMatchObject({ status: 'ignored', staged: false })
  })

  it('parses staged modified file (M in index, clean worktree)', () => {
    // "M " means staged modification
    const result = parseStatus('M  src/app.ts', 500)
    expect(result.files[0]).toMatchObject({ path: 'src/app.ts', status: 'modified', staged: true })
  })

  it('parses unstaged modified file', () => {
    // " M" means worktree modification
    const result = parseStatus(' M src/app.ts', 500)
    expect(result.files[0]).toMatchObject({ status: 'modified', staged: false })
  })

  it('parses staged added file', () => {
    const result = parseStatus('A  src/new.ts', 500)
    expect(result.files[0]).toMatchObject({ status: 'added', staged: true })
  })

  it('parses staged deleted file', () => {
    const result = parseStatus('D  src/old.ts', 500)
    expect(result.files[0]).toMatchObject({ status: 'deleted', staged: true })
  })

  it('sets hasConflicts for UU', () => {
    const result = parseStatus('UU src/conflict.ts', 500)
    expect(result.hasConflicts).toBe(true)
    expect(result.files[0]).toMatchObject({ status: 'conflicted' })
  })

  it('sets hasConflicts for AA', () => {
    const result = parseStatus('AA src/both-added.ts', 500)
    expect(result.hasConflicts).toBe(true)
  })

  it('sets hasConflicts for DD', () => {
    const result = parseStatus('DD src/both-deleted.ts', 500)
    expect(result.hasConflicts).toBe(true)
  })

  it('sets hasConflicts for AU', () => {
    const result = parseStatus('AU src/added-updated.ts', 500)
    expect(result.hasConflicts).toBe(true)
  })

  it('sets hasConflicts for UA', () => {
    const result = parseStatus('UA src/updated-added.ts', 500)
    expect(result.hasConflicts).toBe(true)
  })

  it('sets hasConflicts for DU', () => {
    const result = parseStatus('DU src/deleted-updated.ts', 500)
    expect(result.hasConflicts).toBe(true)
  })

  it('sets hasConflicts for UD', () => {
    const result = parseStatus('UD src/updated-deleted.ts', 500)
    expect(result.hasConflicts).toBe(true)
  })

  it('parses renamed file (two NUL-separated entries)', () => {
    const stdout = 'R  new-name.ts\0old-name.ts'
    const result = parseStatus(stdout, 500)
    expect(result.files[0]).toMatchObject({
      path: 'new-name.ts',
      originalPath: 'old-name.ts',
      status: 'renamed',
      staged: true,
    })
  })

  it('parses copy (C) the same way as rename', () => {
    const stdout = 'C  copy.ts\0original.ts'
    const result = parseStatus(stdout, 500)
    expect(result.files[0]).toMatchObject({ status: 'renamed', staged: true })
  })

  it('parses multiple files from NUL-delimited output', () => {
    const stdout = ['M  src/a.ts', '?? src/b.ts', ' M src/c.ts'].join('\0')
    const result = parseStatus(stdout, 500)
    expect(result.files).toHaveLength(3)
  })

  it('truncates at maxFiles and sets truncated flag', () => {
    const files = Array.from({ length: 5 }, (_, i) => `?? file${i}.ts`).join('\0')
    const result = parseStatus(files, 3)
    expect(result.files).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })

  it('truncated is false when exactly at maxFiles limit with no remaining', () => {
    const files = Array.from({ length: 3 }, (_, i) => `?? file${i}.ts`).join('\0')
    const result = parseStatus(files, 3)
    expect(result.truncated).toBe(false)
  })

  it('skips entries shorter than 3 chars', () => {
    const stdout = 'M \0?? valid.ts'
    const result = parseStatus(stdout, 500)
    // 'M ' has length 2 — skipped; '?? valid.ts' is valid
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('valid.ts')
  })

  it('does not set hasConflicts when no conflict codes present', () => {
    const result = parseStatus('M  src/app.ts\0?? readme.md', 500)
    expect(result.hasConflicts).toBe(false)
  })

  it('defaults unknown xy code to modified', () => {
    // 'T ' = type change — not explicitly handled, falls through to resolveStatus
    const result = parseStatus('T  src/link.ts', 500)
    expect(result.files[0].status).toBe('modified')
  })
})

// ─── parseDiff ───────────────────────────────────────────────────────────────

describe('parseDiff', () => {
  it('detects binary file diff', () => {
    const stdout = 'Binary files a/img.png and b/img.png differ\n'
    const result = parseDiff(stdout)
    expect(result.isBinary).toBe(true)
    expect(result.hunks).toHaveLength(0)
  })

  it('returns empty hunks for empty diff output', () => {
    const result = parseDiff('')
    expect(result.isBinary).toBe(false)
    expect(result.hunks).toHaveLength(0)
    expect(result.truncated).toBe(false)
  })

  it('parses a single hunk with add/remove/context lines', () => {
    const stdout = ['@@ -1,3 +1,3 @@', ' context line', '-removed line', '+added line'].join('\n')
    const result = parseDiff(stdout)
    expect(result.hunks).toHaveLength(1)
    const lines = result.hunks[0].lines
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({
      type: 'context',
      content: 'context line',
      oldLineNumber: 1,
      newLineNumber: 1,
    })
    expect(lines[1]).toMatchObject({
      type: 'remove',
      content: 'removed line',
      oldLineNumber: 2,
      newLineNumber: null,
    })
    expect(lines[2]).toMatchObject({
      type: 'add',
      content: 'added line',
      oldLineNumber: null,
      newLineNumber: 2,
    })
  })

  it('tracks line numbers across add/remove/context correctly', () => {
    const stdout = [
      '@@ -10,4 +10,4 @@',
      ' ctx', // old=10 new=10
      '-rem', // old=11
      '+add', // new=11
      ' ctx2', // old=12 new=12
    ].join('\n')
    const result = parseDiff(stdout)
    const lines = result.hunks[0].lines
    expect(lines[0]).toMatchObject({ oldLineNumber: 10, newLineNumber: 10 })
    expect(lines[1]).toMatchObject({ oldLineNumber: 11, newLineNumber: null })
    expect(lines[2]).toMatchObject({ oldLineNumber: null, newLineNumber: 11 })
    expect(lines[3]).toMatchObject({ oldLineNumber: 12, newLineNumber: 12 })
  })

  it('parses multiple hunks', () => {
    const stdout = [
      '@@ -1,2 +1,2 @@',
      ' line 1',
      '-old',
      '+new',
      '@@ -50,2 +50,2 @@',
      ' line 50',
      '-old50',
      '+new50',
    ].join('\n')
    const result = parseDiff(stdout)
    expect(result.hunks).toHaveLength(2)
    expect(result.hunks[0].header).toBe('@@ -1,2 +1,2 @@')
    expect(result.hunks[1].header).toBe('@@ -50,2 +50,2 @@')
  })

  it('sets truncated flag when content exceeds maxBytes', () => {
    const longContent = '@@ -1,1 +1,1 @@\n+' + 'x'.repeat(100)
    const result = parseDiff(longContent, 50)
    expect(result.truncated).toBe(true)
  })

  it('does not set truncated when content fits in maxBytes', () => {
    const content = '@@ -1,1 +1,1 @@\n+short'
    const result = parseDiff(content, 1024 * 1024)
    expect(result.truncated).toBe(false)
  })

  it('ignores diff header lines (diff --git, index, ---, +++)', () => {
    const stdout = [
      'diff --git a/file.ts b/file.ts',
      'index abc..def 100644',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n')
    const result = parseDiff(stdout)
    // Header lines before first @@ have no hunk yet — they are ignored
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0].lines).toHaveLength(2)
  })

  it('returns path as empty string (caller must set it)', () => {
    const result = parseDiff('@@ -1,1 +1,1 @@\n+line\n')
    expect(result.path).toBe('')
  })

  it('@@ header without line count still parses (defaults to line 1)', () => {
    const stdout = '@@ -1 +1 @@\n+new\n'
    const result = parseDiff(stdout)
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0].lines[0]).toMatchObject({ type: 'add', newLineNumber: 1 })
  })
})
