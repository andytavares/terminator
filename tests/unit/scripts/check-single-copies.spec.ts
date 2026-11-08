import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SINGLE_COPIES, duplicateCopies } from '../../../scripts/check-single-copies.mjs'

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
