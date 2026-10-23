import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../../support/temp-dir'
import { SINGLE_COPIES, duplicateCopies } from '../../../scripts/check-single-copies.mjs'

const script = join(__dirname, '../../../scripts/check-single-copies.mjs')

const split = {
  packages: {
    '': { name: 'terminator' },
    'node_modules/@codemirror/state': { version: '6.6.0' },
    'node_modules/@codemirror/commands': { version: '6.11.1' },
    'node_modules/@codemirror/commands/node_modules/@codemirror/state': { version: '6.7.6' },
    'node_modules/react': { version: '19.2.0' },
  },
}

const single = {
  packages: {
    'node_modules/@codemirror/state': { version: '6.6.0' },
    'node_modules/react': { version: '19.2.0' },
    'node_modules/@terminator/extension-ui': { resolved: 'packages/extension-ui', link: true },
  },
}

describe('duplicateCopies', () => {
  it('names every path and version of a package installed twice, scoped names whole', () => {
    expect(duplicateCopies(split, SINGLE_COPIES)).toEqual([
      {
        name: '@codemirror/state',
        copies: [
          { path: 'node_modules/@codemirror/state', version: '6.6.0' },
          {
            path: 'node_modules/@codemirror/commands/node_modules/@codemirror/state',
            version: '6.7.6',
          },
        ],
      },
    ])
  })

  it('passes a lockfile holding one copy of each package, and ignores links and other packages', () => {
    expect(duplicateCopies(single, SINGLE_COPIES)).toEqual([])
    expect(duplicateCopies(split, ['@codemirror/commands'])).toEqual([])
  })

  it('passes the real lockfile', () => {
    const lock = JSON.parse(readFileSync(join(__dirname, '../../../package-lock.json'), 'utf8'))
    expect(duplicateCopies(lock, SINGLE_COPIES)).toEqual([])
  })
})

describe('the command', () => {
  const run = (lock: object) => {
    const file = join(makeTempDir('single-copies-'), 'package-lock.json')
    writeFileSync(file, JSON.stringify(lock))
    try {
      const stdout = execFileSync('node', [script, file], { encoding: 'utf8', stdio: 'pipe' })
      return { code: 0, output: stdout }
    } catch (error) {
      const failed = error as { status: number; stdout: string; stderr: string }
      return { code: failed.status, output: failed.stdout + failed.stderr }
    }
  }

  it('exits 1 and names the package, its paths and versions when a copy is split', () => {
    const { code, output } = run(split)
    expect(code).toBe(1)
    expect(output).toContain('check-single-copies: @codemirror/state has 2 copies')
    expect(output).toContain('  node_modules/@codemirror/state  6.6.0')
    expect(output).toContain(
      '  node_modules/@codemirror/commands/node_modules/@codemirror/state  6.7.6'
    )
  })

  it('exits 0 when each package has one copy', () => {
    const { code, output } = run(single)
    expect(code).toBe(0)
    expect(output).toContain('check-single-copies: one copy each of 6 packages')
  })
})
