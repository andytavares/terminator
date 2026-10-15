import { describe, it, expect } from 'vitest'
import { ownedPaths } from '../../src/review/codeowners'

const VIEWER = { login: 'Ana', teams: ['klaviyo/frontend'] }

function owned(codeowners: string, paths: string[]): string[] {
  return ownedPaths(codeowners, paths, VIEWER)
}

describe('ownedPaths — who owns a file', () => {
  it('matches the viewer by login, ignoring case', () => {
    expect(owned('src/a.ts @ana', ['src/a.ts', 'src/b.ts'])).toEqual(['src/a.ts'])
  })

  it('matches a team the viewer is on, and not one they are not', () => {
    const file = '* @klaviyo/backend\nweb/ @klaviyo/frontend'
    expect(owned(file, ['web/app.tsx', 'api/main.py'])).toEqual(['web/app.tsx'])
  })

  it('lets the last matching rule decide', () => {
    const file = '* @ana\nsrc/vendor/ @bob'
    expect(owned(file, ['src/index.ts', 'src/vendor/lib.js'])).toEqual(['src/index.ts'])
  })

  it('treats a rule with no owners as unowned', () => {
    expect(owned('* @ana\nsrc/generated/', ['src/generated/a.ts', 'src/b.ts'])).toEqual([
      'src/b.ts',
    ])
  })

  it('ignores comments and blank lines, and trailing comments', () => {
    expect(owned('# all\n\nsrc/a.ts @ana # mine', ['src/a.ts'])).toEqual(['src/a.ts'])
  })
})

describe('ownedPaths — where a pattern matches', () => {
  it('matches a bare name at any depth', () => {
    expect(owned('package.json @ana', ['package.json', 'web/package.json', 'web/x.json'])).toEqual([
      'package.json',
      'web/package.json',
    ])
  })

  it('anchors a leading slash to the repository root', () => {
    expect(owned('/docs/ @ana', ['docs/a.md', 'web/docs/a.md'])).toEqual(['docs/a.md'])
  })

  it('matches a directory pattern at any depth and everything beneath it', () => {
    expect(owned('docs/ @ana', ['docs/a.md', 'web/docs/deep/b.md', 'web/x.md'])).toEqual([
      'docs/a.md',
      'web/docs/deep/b.md',
    ])
  })
})

describe('ownedPaths — wildcards', () => {
  it('matches * within one directory only', () => {
    expect(owned('docs/*.md @ana', ['docs/a.md', 'docs/deep/b.md'])).toEqual(['docs/a.md'])
  })

  it('matches ** across directories', () => {
    expect(owned('src/**/test.ts @ana', ['src/test.ts', 'src/a/b/test.ts', 'lib/test.ts'])).toEqual(
      ['src/test.ts', 'src/a/b/test.ts']
    )
  })

  it('matches an extension pattern anywhere', () => {
    expect(owned('*.tsx @ana', ['a.tsx', 'src/b.tsx', 'src/c.ts'])).toEqual(['a.tsx', 'src/b.tsx'])
  })

  it('does not treat a dot in a pattern as any character', () => {
    expect(owned('a.ts @ana', ['a.ts', 'axts'])).toEqual(['a.ts'])
  })
})
