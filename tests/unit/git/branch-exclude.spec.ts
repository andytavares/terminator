import { describe, it, expect } from 'vitest'
import { excludeBranches, matchesBranchPattern } from '../../../src/main/git/branch-exclude.js'
import type { Branch } from '../../../src/shared/types/index.js'

const branch = (name: string, isRemote = false): Branch => ({ name, isCurrent: false, isRemote })

describe('matchesBranchPattern', () => {
  it('matches a merge-queue branch at any depth under its prefix', () => {
    // GitHub's merge queue names its branches gh-readonly-queue/<base>/pr-<n>-<sha>.
    expect(
      matchesBranchPattern('gh-readonly-queue/*', 'gh-readonly-queue/main/pr-248-3f1a2b9c')
    ).toBe(true)
    expect(matchesBranchPattern('trunk-merge/*', 'trunk-merge/pr-12/abc')).toBe(true)
  })

  it('matches the whole name, not a part of it', () => {
    expect(matchesBranchPattern('trunk-merge/*', 'feature/trunk-merge/x')).toBe(false)
    expect(matchesBranchPattern('main', 'main-old')).toBe(false)
    expect(matchesBranchPattern('main', 'main')).toBe(true)
  })

  it('reads regex characters in a pattern as themselves', () => {
    expect(matchesBranchPattern('release-1.2', 'release-1x2')).toBe(false)
    expect(matchesBranchPattern('fix(ui)/*', 'fix(ui)/button')).toBe(true)
  })

  it('takes a wildcard in the middle', () => {
    expect(matchesBranchPattern('renovate/*-major', 'renovate/react-major')).toBe(true)
    expect(matchesBranchPattern('renovate/*-major', 'renovate/react-minor')).toBe(false)
  })

  it('ignores surrounding whitespace and matches nothing for a blank pattern', () => {
    expect(matchesBranchPattern('  trunk-merge/*  ', 'trunk-merge/a')).toBe(true)
    expect(matchesBranchPattern('   ', 'main')).toBe(false)
  })
})

describe('excludeBranches', () => {
  it('drops local and remote branches matching any pattern and keeps order', () => {
    const branches = [
      branch('main'),
      branch('gh-readonly-queue/main/pr-1-abc', true),
      branch('feat/x'),
      branch('trunk-merge/pr-9'),
      branch('dev', true),
    ]
    expect(
      excludeBranches(branches, ['gh-readonly-queue/*', 'trunk-merge/*']).map((b) => b.name)
    ).toEqual(['main', 'feat/x', 'dev'])
  })

  it('never hides the checked-out branch', () => {
    const current = { ...branch('trunk-merge/pr-9'), isCurrent: true }
    expect(excludeBranches([current], ['trunk-merge/*'])).toEqual([current])
  })

  it('returns the list unchanged with no patterns', () => {
    const branches = [branch('main'), branch('trunk-merge/a')]
    expect(excludeBranches(branches, [])).toEqual(branches)
  })
})
