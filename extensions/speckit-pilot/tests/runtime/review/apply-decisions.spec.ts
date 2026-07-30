import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPatch, revertRejected } from '../../../src/runtime/review/apply-decisions.js'
import { parseHunks } from '../../../src/runtime/review/parse-hunks.js'
import type { Hunk } from '../../../src/runtime/review/hunk-decisions.js'

// A reject that changes nothing is worse than no review at all, because you
// believe the change is gone. The last three tests run real git, because "the
// patch looks right" and "git applies it" are different claims.

const LINES = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)

const hunk = (over: Partial<Hunk> = {}): Hunk => ({
  id: 'src/a.ts:10:1',
  file: 'src/a.ts',
  oldStart: 10,
  newStart: 10,
  isNew: false,
  lines: [' context', '-gone', '+added'],
  ...over,
})

describe('building the patch', () => {
  it('writes a header git can read', () => {
    expect(buildPatch([hunk()])).toBe(
      [
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -10,2 +10,2 @@',
        ' context',
        '-gone',
        '+added',
        '',
      ].join('\n')
    )
  })

  it('counts each side from the hunk body rather than trusting a header', () => {
    const patch = buildPatch([hunk({ lines: [' a', ' b', '+new', '+newer', '-old'] })])
    expect(patch).toContain('@@ -10,3 +10,4 @@')
  })

  it('groups by file, so one header covers a file’s hunks', () => {
    const patch = buildPatch([
      hunk({ id: '1', oldStart: 5 }),
      hunk({ id: '2', oldStart: 40, newStart: 40 }),
    ])
    expect(patch.match(/--- a\/src\/a.ts/g)).toHaveLength(1)
  })

  it('puts a file’s hunks in order, since git tracks the offset each introduces', () => {
    const patch = buildPatch([
      hunk({ id: '2', oldStart: 40, newStart: 40 }),
      hunk({ id: '1', oldStart: 5, newStart: 5 }),
    ])
    expect(patch.indexOf('@@ -5,')).toBeLessThan(patch.indexOf('@@ -40,'))
  })

  it('ends with a newline — without one git refuses the last hunk', () => {
    expect(buildPatch([hunk()]).endsWith('\n')).toBe(true)
  })

  it('builds nothing from nothing, rather than an empty patch git would refuse', () => {
    expect(buildPatch([])).toBe('')
  })
})

describe('reverting', () => {
  it('does not touch the working copy when nothing was rejected', async () => {
    const applyReverse = vi.fn()
    expect(await revertRejected([], { applyReverse })).toEqual({
      ok: true,
      reverted: 0,
      error: null,
    })
    expect(applyReverse).not.toHaveBeenCalled()
  })

  it('hands over the patch it built, and counts what it took out', async () => {
    const applyReverse = vi.fn().mockResolvedValue({ ok: true, stderr: '' })
    expect(await revertRejected([hunk()], { applyReverse })).toMatchObject({
      ok: true,
      reverted: 1,
    })
    expect(applyReverse.mock.calls[0][0]).toContain('@@ -10,2 +10,2 @@')
  })

  it('reports git’s own words when it refuses', async () => {
    // A rejection that silently failed to revert is the exact failure this
    // feature exists to prevent.
    const applyReverse = vi
      .fn()
      .mockResolvedValue({ ok: false, stderr: 'error: patch does not apply\n' })
    expect(await revertRejected([hunk()], { applyReverse })).toEqual({
      ok: false,
      reverted: 0,
      error: 'error: patch does not apply',
    })
  })

  it('always says something when it fails, even if git said nothing', async () => {
    const applyReverse = vi.fn().mockResolvedValue({ ok: false, stderr: '' })
    expect((await revertRejected([hunk()], { applyReverse })).error).toBe(
      'git apply refused the patch'
    )
  })
})

describe('against real git', () => {
  let dir: string

  const git = (args: string[], stdin?: string): { ok: boolean; stderr: string } => {
    try {
      execFileSync('git', args, { cwd: dir, input: stdin, stdio: ['pipe', 'pipe', 'pipe'] })
      return { ok: true, stderr: '' }
    } catch (error) {
      return { ok: false, stderr: String((error as { stderr?: Buffer }).stderr ?? error) }
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apply-'))
    git(['init', '-b', 'main'])
    git(['config', 'user.email', 'test@example.com'])
    git(['config', 'user.name', 'Test'])
    // Long enough that two edits at opposite ends are separate hunks: with
    // three lines of context either side, closer edits merge into one and the
    // per-hunk case cannot be tested at all.
    writeFileSync(join(dir, 'a.ts'), LINES.join('\n') + '\n')
    git(['add', '.'])
    git(['commit', '-m', 'base'])
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

  async function revertFrom(pick: (hunks: Hunk[]) => Hunk[]): Promise<string> {
    const diff = execFileSync('git', ['diff'], { cwd: dir }).toString()
    const result = await revertRejected(pick(parseHunks(diff)), {
      applyReverse: async (patch) => git(['apply', '--reverse', '--recount', '-'], patch),
    })
    expect(result.error).toBeNull()
    return readFileSync(join(dir, 'a.ts'), 'utf8')
  }

  it('takes a rejected change back out', async () => {
    const edited = [...LINES]
    edited[1] = 'CHANGED'
    writeFileSync(join(dir, 'a.ts'), edited.join('\n') + '\n')
    expect(await revertFrom((hunks) => hunks)).toContain('line 2')
  })

  it('keeps the accepted change and removes only the rejected one', async () => {
    // The whole point: one file holds both the change you asked for and the one
    // you did not, and accepting the file wholesale is how the second ships.
    const edited = [...LINES]
    edited[0] = 'ASKED FOR'
    edited[19] = 'NEVER ASKED FOR'
    writeFileSync(join(dir, 'a.ts'), edited.join('\n') + '\n')

    const after = await revertFrom((hunks) => hunks.slice(-1))
    expect(after).toContain('ASKED FOR')
    expect(after).toContain('line 20')
    expect(after).not.toContain('NEVER ASKED FOR')
  })

  it('takes back a file the agent created, which is most of what it creates', async () => {
    // The hunks for a file git has never seen come from
    // `git diff --no-index /dev/null <file>`; reversing them needs the same
    // `/dev/null` on the way out. Naming the file on both sides asks git to
    // reverse an addition against something it thinks pre-existed, and it
    // refuses — so a rejected new file used to stay on disk.
    const newFile = join(dir, 'new.ts')
    writeFileSync(newFile, 'this was never asked for\n')

    // `--no-index` exits non-zero precisely because the files differ, so its
    // output is taken from the error rather than the return value.
    let diff = ''
    try {
      diff = execFileSync('git', ['diff', '--no-index', '/dev/null', 'new.ts'], {
        cwd: dir,
        encoding: 'utf8',
      })
    } catch (error) {
      diff = String((error as { stdout?: string }).stdout ?? '')
    }
    expect(diff).toContain('--- /dev/null')

    const result = await revertRejected(parseHunks(diff), {
      applyReverse: async (patch) => git(['apply', '--reverse', '--recount', '-'], patch),
    })
    expect(result.error).toBeNull()
    expect(existsSync(newFile)).toBe(false)
  })

  it('reverts several hunks in one file without the offsets drifting', async () => {
    const edited = [...LINES]
    edited[0] = 'ONE'
    edited[19] = 'TWENTY'
    writeFileSync(join(dir, 'a.ts'), edited.join('\n') + '\n')

    const after = await revertFrom((hunks) => hunks)
    expect(after).toBe(LINES.join('\n') + '\n')
  })
})
