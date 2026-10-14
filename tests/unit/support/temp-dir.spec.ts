import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { makeTempDir, removeTempDirs } from '../../support/temp-dir'

describe('makeTempDir', () => {
  it('makes a new directory under the OS temporary directory with the prefix', () => {
    const dir = makeTempDir('temp-dir-spec-')

    expect(existsSync(dir)).toBe(true)
    expect(dirname(dir)).toBe(realpathSync(tmpdir()))
    expect(basename(dir)).toMatch(/^temp-dir-spec-.{6}$/)
  })

  it('names the directory by its real path, the one a child process reports as its cwd', () => {
    const dir = makeTempDir('temp-dir-spec-')

    expect(dir).toBe(realpathSync(dir))
  })

  it('removeTempDirs removes every directory made so far, contents included', () => {
    const first = makeTempDir('temp-dir-spec-')
    const second = makeTempDir('temp-dir-spec-')
    mkdirSync(join(first, 'nested'))
    writeFileSync(join(first, 'nested', 'file'), 'x')

    removeTempDirs()

    expect(existsSync(first)).toBe(false)
    expect(existsSync(second)).toBe(false)
  })

  it('removeTempDirs tolerates a directory the spec already removed', () => {
    rmSync(makeTempDir('temp-dir-spec-'), { recursive: true })

    expect(() => removeTempDirs()).not.toThrow()
  })
})
