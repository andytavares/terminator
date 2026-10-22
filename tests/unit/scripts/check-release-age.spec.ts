import { describe, it, expect } from 'vitest'
import {
  addedVersions,
  baseBranch,
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
