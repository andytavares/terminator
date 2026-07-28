import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
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

/**
 * A git that answers each command with its own output. The two calls this makes
 * are not interchangeable, and a mock that answers both the same way reported
 * the diff rows back as a list of untracked files.
 */
function git(over: { diff?: string; untracked?: string; ok?: boolean } = {}) {
  return vi.fn(async (_cmd: string, args: string[]) => ({
    ok: over.ok ?? true,
    stdout: args.includes('ls-files') ? (over.untracked ?? '') : (over.diff ?? ''),
    stderr: '',
  }))
}

describe('counting the lines in a file git has never seen', () => {
  // A new file's lines count towards the change like any other, so the
  // 300-line review trigger sees work that arrived as new files.
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'session-metrics-'))
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

  const summarise = (untracked: string) =>
    readDiffSummary(dir, 'main', git({ diff: '', untracked }))

  it('counts them', async () => {
    writeFileSync(join(dir, 'new.ts'), 'a\nb\nc\n')
    await expect(summarise('new.ts\n')).resolves.toMatchObject({ files: 1, added: 3 })
  })

  it('counts a last line with no newline after it', async () => {
    writeFileSync(join(dir, 'new.ts'), 'a\nb')
    await expect(summarise('new.ts\n')).resolves.toMatchObject({ added: 2 })
  })

  it('counts an empty file as a file that changed, with no lines', async () => {
    writeFileSync(join(dir, 'empty.ts'), '')
    await expect(summarise('empty.ts\n')).resolves.toMatchObject({ files: 1, added: 0 })
  })

  it('attributes no lines to something binary, rather than distorting the trigger', async () => {
    writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]))
    await expect(summarise('logo.png\n')).resolves.toMatchObject({ files: 1, added: 0 })
  })

  it('does not read something enormous into memory on a thirty-second poll', async () => {
    writeFileSync(join(dir, 'huge.log'), 'x\n'.repeat(1_100_000))
    await expect(summarise('huge.log\n')).resolves.toMatchObject({ files: 1, added: 0 })
  })

  it('counts a file it cannot read as a file, without inventing lines', async () => {
    await expect(summarise('vanished.ts\n')).resolves.toMatchObject({ files: 1, added: 0 })
  })

  it('reports nothing untracked when git cannot list it', async () => {
    const run = vi.fn(async () => ({ ok: false, stdout: '', stderr: 'no' }))
    await expect(readDiffSummary(dir, 'main', run)).resolves.toEqual({
      files: 0,
      added: 0,
      removed: 0,
    })
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
    await expect(readDiffSummary('/wt/s1', 'main', git({ diff: '5\t2\ta.ts\n' }))).resolves.toEqual(
      {
        files: 1,
        added: 5,
        removed: 2,
      }
    )
  })

  it('counts files git has never seen, which `git diff` does not report at all', async () => {
    // Creating files is most of what an agent does. Missed, an agent whose
    // whole job was to add them reported having changed nothing — no review, no
    // `ready`, and a session recorded as having finished without doing anything.
    const summary = await readDiffSummary(
      '/wt/s1',
      'main',
      git({ diff: '5\t2\ta.ts\n', untracked: 'new.ts\n' })
    )
    expect(summary.files).toBe(2)
  })

  it('asks git to honour .gitignore, so build output is not a change', async () => {
    const run = git({ untracked: '' })
    await readDiffSummary('/wt/s1', 'main', run)
    const lsFiles = run.mock.calls.find((call) => call[1].includes('ls-files'))
    expect(lsFiles?.[1]).toContain('--exclude-standard')
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
    // Against the base itself: the three-dot form sees only commits, and an
    // agent that edits and stops would report having changed nothing.
    expect(args).toEqual(['diff', '--numstat', 'main'])
    expect(cwd).toBe('/wt/s1')
  })

  it('returns the parsed paths', async () => {
    await expect(
      readChangedFiles('/wt/s1', 'main', git({ diff: '1\t0\tsrc/auth/x.ts\n' }))
    ).resolves.toEqual(['src/auth/x.ts'])
  })

  it('includes files git has never seen — a new migration is still a migration', async () => {
    await expect(
      readChangedFiles(
        '/wt/s1',
        'main',
        git({ diff: '1\t0\tsrc/a.ts\n', untracked: 'migrations/003_add_users.sql\n' })
      )
    ).resolves.toEqual(['src/a.ts', 'migrations/003_add_users.sql'])
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
