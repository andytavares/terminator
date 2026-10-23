import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../../support/temp-dir'
import {
  addedVersions,
  baseBranch,
  baseLockfile,
  exemptByAdvisory,
  fixedAdvisories,
  lockedVersions,
  tooYoung,
} from '../../../scripts/check-release-age.mjs'

const NOW = Date.parse('2026-10-21T00:00:00Z')
const lock = {
  packages: {
    '': { name: 'terminator' },
    'node_modules/zod': {
      version: '4.6.7',
      resolved: 'https://registry.npmjs.org/zod/-/zod-4.6.7.tgz',
    },
    'packages/extension-ui/node_modules/@storybook/react': {
      version: '10.6.2',
      resolved: 'https://registry.npmjs.org/@storybook/react/-/react-10.6.2.tgz',
    },
    'packages/extension-ui': { version: '1.0.0' },
    'node_modules/@terminator/extension-ui': { resolved: 'packages/extension-ui', link: true },
  },
}

describe('lockedVersions', () => {
  it('lists each registry package once, scoped names whole, and skips workspaces and links', () => {
    expect(lockedVersions(lock)).toEqual(['zod@4.6.7', '@storybook/react@10.6.2'])
  })
})

describe('addedVersions', () => {
  const entry = (name: string, version: string) => ({
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
  })
  const base = { packages: { 'node_modules/zod': entry('zod', '4.6.5') } }

  it('names a version the base lockfile does not hold, an upgrade of a package already there included', () => {
    const head = {
      packages: {
        'node_modules/zod': entry('zod', '4.6.7'),
        'node_modules/ws': entry('ws', '8.18.0'),
      },
    }
    expect(addedVersions(head, base)).toEqual(['zod@4.6.7', 'ws@8.18.0'])
  })

  it('leaves out every version the base lockfile already held', () => {
    expect(addedVersions(base, base)).toEqual([])
  })
})

describe('baseBranch', () => {
  it("is the pull request's base where GitHub names one, and main anywhere else", () => {
    expect(baseBranch({ GITHUB_BASE_REF: 'release/2' })).toBe('release/2')
    expect(baseBranch({ GITHUB_BASE_REF: '' })).toBe('main')
    expect(baseBranch({})).toBe('main')
  })
})

describe('tooYoung', () => {
  const published = {
    'zod@4.6.7': '2026-10-12T16:29:37.778Z',
    '@storybook/react@10.6.2': '2026-10-01T00:00:00.000Z',
  }

  it('names a version published fewer than 14 days before now, and no other', () => {
    expect(tooYoung({ published, exceptions: {}, now: NOW })).toEqual([
      { id: 'zod@4.6.7', publishedAt: '2026-10-12T16:29:37.778Z' },
    ])
  })

  it('treats exactly 14 days as old enough', () => {
    const edge = { 'zod@4.6.7': '2026-10-07T00:00:00.000Z' }
    expect(tooYoung({ published: edge, exceptions: {}, now: NOW })).toEqual([])
  })

  it('lets a listed exception through', () => {
    const exceptions = { 'zod@4.6.7': 'approved' }
    expect(tooYoung({ published, exceptions, now: NOW })).toEqual([])
  })

  it('fails a version whose publish time is unknown rather than passing it', () => {
    expect(tooYoung({ published: { 'zod@4.6.7': null }, exceptions: {}, now: NOW })).toEqual([
      { id: 'zod@4.6.7', publishedAt: null },
    ])
  })
})

const advisory = (name: string, id: string) => ({
  name,
  url: `https://github.com/advisories/${id}`,
})
// The shape of `npm audit --json` on main: fastify and katex vulnerable, mermaid only through katex.
const baseAudit = {
  vulnerabilities: {
    fastify: { via: [advisory('fastify', 'GHSA-389g-gv7q-r4x8')], effects: [] },
    katex: { via: [advisory('katex', 'GHSA-238p-pmpm-9mq7')], effects: ['mermaid'] },
    mermaid: { via: ['katex'], effects: [] },
  },
}
const fixedHead = { vulnerabilities: {} }
const added = ['fastify@5.12.6', 'mermaid@12.2.0', 'chevrotain@13.2.0']

describe('versions that fix a reported advisory', () => {
  it('exempts the fixed package and what it affects, and no other added version', () => {
    expect(fixedAdvisories(baseAudit, fixedHead)).toEqual([
      'https://github.com/advisories/GHSA-389g-gv7q-r4x8',
      'https://github.com/advisories/GHSA-238p-pmpm-9mq7',
    ])
    expect(exemptByAdvisory(added, baseAudit, fixedHead)).toEqual(
      new Map([
        ['fastify@5.12.6', ['GHSA-389g-gv7q-r4x8']],
        ['mermaid@12.2.0', ['GHSA-238p-pmpm-9mq7']],
      ])
    )
  })

  it('exempts nothing for an advisory the head still carries', () => {
    expect(exemptByAdvisory(added, baseAudit, baseAudit)).toEqual(new Map())
  })

  it('exempts nothing when either report is not an audit', () => {
    expect(exemptByAdvisory(added, null, fixedHead)).toEqual(new Map())
    expect(exemptByAdvisory(added, baseAudit, null)).toEqual(new Map())
  })
})

// Every worktree shares one .git: a --depth=1 fetch made the developer's whole repository shallow,
// and the next merge with main refused "unrelated histories".
describe('reading the base branch lockfile', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' })

  it("reads the branch's lockfile and leaves the repository's history whole", () => {
    const origin = makeTempDir('release-age-origin-')
    git(origin, 'init', '-q', '-b', 'main')
    for (const version of ['1', '2']) {
      writeFileSync(join(origin, 'package-lock.json'), JSON.stringify({ version }))
      git(origin, 'add', '.')
      git(origin, 'commit', '-qm', version)
    }
    const clone = join(makeTempDir('release-age-clone-'), 'repo')
    git(origin, 'clone', '-q', origin, clone)

    // origin moves on after the clone: the check reads origin/main as fetched, and fetches nothing
    // itself. CI's checkout and ci:local fetch first; ci:local's Linux container has no keys.
    writeFileSync(join(origin, 'package-lock.json'), JSON.stringify({ version: '3' }))
    git(origin, 'commit', '-qam', '3')

    expect(baseLockfile('main', clone)).toEqual({ version: '2' })
    expect(existsSync(join(clone, '.git/shallow'))).toBe(false)
  })
})
