import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertCommandAllowed,
  assertCwdInScope,
  CommandNotAllowedError,
  CwdOutOfScopeError,
} from '../../../src/main/shell/shell-executor'
import { makeTempDir } from '../../support/temp-dir'

// ─── assertCommandAllowed ─────────────────────────────────────────────────────

describe('assertCommandAllowed', () => {
  it('allows git', () => {
    expect(() => assertCommandAllowed('git')).not.toThrow()
  })

  it('allows gh', () => {
    expect(() => assertCommandAllowed('gh')).not.toThrow()
  })

  it('throws CommandNotAllowedError for rm', () => {
    expect(() => assertCommandAllowed('rm')).toThrow(CommandNotAllowedError)
  })

  it('throws CommandNotAllowedError for curl', () => {
    expect(() => assertCommandAllowed('curl')).toThrow(CommandNotAllowedError)
  })

  /** What assertCommandAllowed throws for `command`; undefined when it lets it through. */
  function refusalOf(command: string): unknown {
    try {
      assertCommandAllowed(command)
    } catch (error) {
      return error
    }
  }

  it('thrown error has COMMAND_NOT_ALLOWED code', () => {
    expect(refusalOf('bash')).toMatchObject({ code: 'COMMAND_NOT_ALLOWED' })
  })

  it('thrown error message names the disallowed command', () => {
    expect(refusalOf('node')).toMatchObject({ message: expect.stringContaining('"node"') })
  })
})

// ─── assertCwdInScope ─────────────────────────────────────────────────────────

// Real directories: the check resolves symlinks, so it is only meaningful on a real disk.
let scratch: string
let root: string
let otherRoot: string
let outside: string

function useScopeDirectories(): void {
  beforeEach(() => {
    scratch = realpathSync(makeTempDir('cwd-scope-'))
    root = join(scratch, 'root')
    otherRoot = join(scratch, 'other')
    outside = join(scratch, 'outside')
    for (const directory of [join(root, 'src', 'deep'), otherRoot, outside]) {
      mkdirSync(directory, { recursive: true })
    }
  })

  afterEach(() => rmSync(scratch, { recursive: true, force: true }))
}

describe('assertCwdInScope', () => {
  useScopeDirectories()

  it('allows the root itself and any directory below it', async () => {
    await expect(assertCwdInScope(root, [root])).resolves.toBeUndefined()
    await expect(assertCwdInScope(join(root, 'src', 'deep'), [root])).resolves.toBeUndefined()
  })

  it('allows a directory inside any one of several roots', async () => {
    await expect(assertCwdInScope(otherRoot, [root, otherRoot])).resolves.toBeUndefined()
  })

  it('allows a directory below a root that does not exist yet', async () => {
    const clone = join(root, 'not-cloned-yet')
    await expect(assertCwdInScope(clone, [root])).resolves.toBeUndefined()
  })
})

describe('assertCwdInScope — escapes', () => {
  useScopeDirectories()

  it('refuses a directory outside every root', async () => {
    await expect(assertCwdInScope(outside, [root, otherRoot])).rejects.toThrow(CwdOutOfScopeError)
  })

  // Written out, not joined: path.join would fold the `..` away before the check saw it.
  it('refuses a `..` escape out of a root', async () => {
    await expect(assertCwdInScope(`${root}/src/../../outside`, [root])).rejects.toThrow(
      CwdOutOfScopeError
    )
  })

  it('refuses a symlink inside a root that leads out of it', async () => {
    const link = join(root, 'escape')
    symlinkSync(outside, link)
    await expect(assertCwdInScope(link, [root])).rejects.toThrow(CwdOutOfScopeError)
  })

  it('refuses `..` taken after a symlink, which the operating system resolves outside', async () => {
    mkdirSync(join(outside, 'child'))
    symlinkSync(join(outside, 'child'), join(root, 'into-child'))
    await expect(assertCwdInScope(`${root}/into-child/..`, [root])).rejects.toThrow(
      CwdOutOfScopeError
    )
  })
})

describe('assertCwdInScope — look-alikes, symlinked roots and errors', () => {
  useScopeDirectories()

  it('refuses a sibling whose name only starts with the root', async () => {
    const sibling = `${root}-sibling`
    mkdirSync(sibling)
    await expect(assertCwdInScope(sibling, [root])).rejects.toThrow(CwdOutOfScopeError)
  })

  it('allows a root reached through a symlink, compared after resolving both', async () => {
    const linkedRoot = join(scratch, 'linked-root')
    symlinkSync(root, linkedRoot)
    await expect(assertCwdInScope(join(root, 'src'), [linkedRoot])).resolves.toBeUndefined()
  })

  it('refuses a relative cwd, and ignores a relative or empty root', async () => {
    await expect(assertCwdInScope('relative/path', [root])).rejects.toThrow(CwdOutOfScopeError)
    await expect(assertCwdInScope(join(root, 'src'), ['relative/root', ''])).rejects.toThrow(
      CwdOutOfScopeError
    )
  })

  it('rejects with an error named CwdOutOfScopeError that names the directory', async () => {
    const refusal = await assertCwdInScope(outside, [root]).catch((error: unknown) => error)
    expect(refusal).toMatchObject({ name: 'CwdOutOfScopeError', code: 'CWD_OUT_OF_SCOPE' })
    expect((refusal as Error).message).toContain(outside)
  })
})
