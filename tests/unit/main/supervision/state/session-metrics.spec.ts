import { describe, it, expect, vi } from 'vitest'
import {
  parseDiffStat,
  readDiffSummary,
  parseChangedFiles,
  readChangedFiles,
} from '../../../../../src/main/supervision/state/session-metrics.js'

// The diff summary drives two decisions: whether a finished session enters the
// review queue at all (FR-045), and the >300-line P1 trigger (FR-048).

describe('parseDiffStat', () => {
  it('sums added and removed lines across files', () => {
    expect(parseDiffStat('12\t3\tsrc/a.ts\n4\t1\tsrc/b.ts\n')).toEqual({
      files: 2,
      added: 16,
      removed: 4,
    })
  })

  it('reports an empty diff as all zeros, which keeps it out of the review queue', () => {
    expect(parseDiffStat('')).toEqual({ files: 0, added: 0, removed: 0 })
  })

  it('counts a binary file as changed without inventing line counts', () => {
    // git reports binary files as `-\t-\tpath`.
    expect(parseDiffStat('-\t-\tassets/logo.png\n')).toEqual({
      files: 1,
      added: 0,
      removed: 0,
    })
  })

  it('handles a file with only additions', () => {
    expect(parseDiffStat('9\t0\tsrc/new.ts\n')).toEqual({ files: 1, added: 9, removed: 0 })
  })

  it('ignores blank lines', () => {
    expect(parseDiffStat('\n1\t1\ta.ts\n\n')).toEqual({ files: 1, added: 1, removed: 1 })
  })

  it('ignores malformed rows rather than throwing', () => {
    expect(parseDiffStat('garbage\n2\t2\ta.ts\n')).toEqual({ files: 1, added: 2, removed: 2 })
  })

  it('handles paths containing tabs in a rename by taking the leading counts', () => {
    expect(parseDiffStat('3\t1\told.ts => new.ts\n')).toMatchObject({ files: 1, added: 3 })
  })
})

describe('readDiffSummary', () => {
  it('asks git for numeric stats against the merge base', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, stdout: '1\t1\ta.ts\n', stderr: '' })
    await readDiffSummary('/wt/s1', 'main', run)
    const [command, args, cwd] = run.mock.calls[0]
    expect(command).toBe('git')
    expect(args).toContain('--numstat')
    expect(cwd).toBe('/wt/s1')
  })

  it('returns the parsed summary', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, stdout: '5\t2\ta.ts\n', stderr: '' })
    await expect(readDiffSummary('/wt/s1', 'main', run)).resolves.toEqual({
      files: 1,
      added: 5,
      removed: 2,
    })
  })

  it('reports an empty summary when git fails, rather than throwing', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'not a repository' })
    await expect(readDiffSummary('/wt/s1', 'main', run)).resolves.toEqual({
      files: 0,
      added: 0,
      removed: 0,
    })
  })

  it('reports an empty summary when git cannot be run at all', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ENOENT'))
    await expect(readDiffSummary('/wt/s1', 'main', run)).resolves.toEqual({
      files: 0,
      added: 0,
      removed: 0,
    })
  })
})

// The file list is what lets the grader see auth, payments, migrations and the
// repo's critical paths. Without it every change grades P2 and P0 never fires
// (FR-047, FR-048).

describe('parseChangedFiles', () => {
  it('returns the path from each numstat row', () => {
    expect(parseChangedFiles('12\t3\tsrc/auth/token.ts\n4\t1\tsrc/b.ts\n')).toEqual([
      'src/auth/token.ts',
      'src/b.ts',
    ])
  })

  it('keeps binary rows, whose counts are dashes but whose path still matters', () => {
    expect(parseChangedFiles('-\t-\tassets/logo.png\n')).toEqual(['assets/logo.png'])
  })

  it('ignores blank lines', () => {
    expect(parseChangedFiles('\n1\t1\ta.ts\n\n')).toEqual(['a.ts'])
  })

  it('ignores malformed rows rather than emitting a bogus path', () => {
    expect(parseChangedFiles('garbage\n')).toEqual([])
  })

  it('returns nothing for empty output', () => {
    expect(parseChangedFiles('')).toEqual([])
  })
})

describe('readChangedFiles', () => {
  it('diffs the worktree against the base branch', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, stdout: '1\t0\ta.ts\n', stderr: '' })
    await readChangedFiles('/wt/s1', 'main', run)
    const [bin, args, cwd] = run.mock.calls[0]
    expect(bin).toBe('git')
    expect(args).toEqual(['diff', '--numstat', 'main...HEAD'])
    expect(cwd).toBe('/wt/s1')
  })

  it('returns the parsed paths', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, stdout: '1\t0\tsrc/auth/x.ts\n', stderr: '' })
    await expect(readChangedFiles('/wt/s1', 'main', run)).resolves.toEqual(['src/auth/x.ts'])
  })

  it('returns nothing when git fails, rather than throwing', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'no' })
    await expect(readChangedFiles('/wt/s1', 'main', run)).resolves.toEqual([])
  })

  it('returns nothing when git cannot be run at all', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ENOENT'))
    await expect(readChangedFiles('/wt/s1', 'main', run)).resolves.toEqual([])
  })
})
