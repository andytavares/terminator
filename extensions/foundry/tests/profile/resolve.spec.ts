import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { resolveProfile, readRepositoryProfile } from '../../src/profile/resolve.js'
import { defaultHintsDir } from '../../src/profile/hints.js'
import { emptyProfile, type Entry, type Profile } from '../../src/profile/schema.js'
import { CHECK_NAMES } from '../../src/verify/check-names.js'
import { temporaryDirectory } from '../helpers/foundry-host.js'

const hintsDir = defaultHintsDir()

function repoWith(files: Record<string, string>): string {
  const repo = temporaryDirectory('foundry-resolve')
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
    fs.writeFileSync(path.join(repo, rel), body)
  }
  return repo
}

function storedWith(test: Entry | null, over: Partial<Profile> = {}): Profile {
  const profile = emptyProfile('x')
  return { ...profile, checks: { ...profile.checks, test }, ...over }
}

const lintScript = JSON.stringify({ scripts: { test: 'vitest run' } })
const repositoryYaml =
  'schemaVersion: 1\nchecks:\n  test: { command: "just test", source: operator }\n'

describe('resolveProfile precedence', () => {
  it('lets the operator beat the repository, the scout and the hint', () => {
    const repo = repoWith({ 'package.json': lintScript, '.foundry/profile.yaml': repositoryYaml })
    const stored = storedWith({ command: 'make mine', source: 'operator' })
    expect(resolveProfile({ repoPath: repo, hintsDir, stored }).checks.test?.command).toBe(
      'make mine'
    )
  })

  it('lets the repository beat the scout and the hint, whatever source it claims', () => {
    const repo = repoWith({ 'package.json': lintScript, '.foundry/profile.yaml': repositoryYaml })
    const stored = storedWith({ command: 'scouted', source: 'scout' })
    const { test } = resolveProfile({ repoPath: repo, hintsDir, stored }).checks
    expect(test).toMatchObject({ command: 'just test', source: 'repository' })
  })

  it('lets a proven scout entry beat a hint', () => {
    const repo = repoWith({ 'package.json': lintScript })
    const stored = storedWith({ command: 'scouted', source: 'scout' })
    expect(resolveProfile({ repoPath: repo, hintsDir, stored }).checks.test?.source).toBe('scout')
  })
})

describe('resolveProfile falling through', () => {
  it('falls to the hint when nothing else answers, and ignores stale hint entries on disk', () => {
    const repo = repoWith({ 'package.json': lintScript })
    const stored = storedWith({ command: 'stale', source: 'hint' })
    expect(resolveProfile({ repoPath: repo, hintsDir, stored }).checks.test).toEqual({
      command: 'npm run test',
      source: 'hint',
      evidence: 'package.json',
    })
  })

  it('decides each check on its own', () => {
    const repo = repoWith({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) })
    const stored = storedWith({ command: 'make mine', source: 'operator' })
    const { checks } = resolveProfile({ repoPath: repo, hintsDir, stored })
    expect(checks.test?.source).toBe('operator')
    expect(checks.lint?.source).toBe('hint')
  })
})

describe('resolveProfile where nothing is known', () => {
  it('resolves a repository with no manifest of any kind to all-null checks', () => {
    const repo = repoWith({ 'README.md': 'hello' })
    const resolved = resolveProfile({ repoPath: repo, hintsDir, stored: null })
    for (const check of CHECK_NAMES) expect(resolved.checks[check]).toBeNull()
    expect(resolved.prepare).toBeNull()
    expect(resolved.pictures).toBeNull()
    expect(resolved.share).toEqual([])
    expect(resolved.paths).toEqual({ interface: [], manifests: [], lockfiles: [], formatting: [] })
  })
})

describe('resolveProfile for paths and prepare', () => {
  it('takes the operator paths over the hinted ones, and hinted ones otherwise', () => {
    const repo = repoWith({ 'package.json': '{}' })
    const stored = storedWith(null, {
      paths: { interface: ['ui/**'], manifests: [], lockfiles: [], formatting: [] },
    })
    const { paths } = resolveProfile({ repoPath: repo, hintsDir, stored })
    expect(paths.interface).toEqual(['ui/**'])
    expect(paths.manifests).toEqual(['package.json'])
  })

  it('takes the operator prepare command over the lockfile hint', () => {
    const repo = repoWith({ 'package-lock.json': '{}' })
    const stored = storedWith(null, { prepare: { command: 'bun install', source: 'operator' } })
    expect(resolveProfile({ repoPath: repo, hintsDir, stored }).prepare?.command).toBe(
      'bun install'
    )
    expect(resolveProfile({ repoPath: repo, hintsDir, stored: null }).prepare?.command).toBe(
      'npm ci'
    )
  })
})

describe('resolveProfile additional checks', () => {
  it('keeps the first additional check of a name', () => {
    const repo = repoWith({
      '.foundry/profile.yaml':
        'additional:\n  - { name: Types, command: tsc, rung: L0, source: operator }\n',
    })
    const mine = {
      name: 'Types',
      command: 'mine',
      rung: 'L1' as const,
      source: 'operator' as const,
    }
    const stored = storedWith(null, { additional: [mine] })
    const { additional } = resolveProfile({ repoPath: repo, hintsDir, stored })
    expect(additional).toEqual([mine])
  })
})

describe('readRepositoryProfile', () => {
  it('reads <repo>/.foundry/profile.yaml and writes nothing', () => {
    const repo = repoWith({ '.foundry/profile.yaml': repositoryYaml })
    const before = fs.readdirSync(path.join(repo, '.foundry'))
    expect(readRepositoryProfile(repo)?.checks.test?.command).toBe('just test')
    expect(fs.readdirSync(path.join(repo, '.foundry'))).toEqual(before)
  })

  it('reads as none when absent, malformed or from a newer schema', () => {
    expect(readRepositoryProfile(repoWith({}))).toBeNull()
    expect(readRepositoryProfile(repoWith({ '.foundry/profile.yaml': 'checks: [' }))).toBeNull()
    const newer = repoWith({ '.foundry/profile.yaml': 'schemaVersion: 2\n' })
    expect(readRepositoryProfile(newer)).toBeNull()
  })
})
