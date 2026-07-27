import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  loadRepoConfig,
  DEFAULT_REPO_CONFIG,
} from '../../../../../src/main/supervision/worktree/repo-config.js'

// .terminator/config.json — JSON, not TOML (research.md R5, task T007). Every
// key optional; an absent file means all defaults, and provisioning still works.

let repo: string

beforeEach(() => (repo = mkdtempSync(join(tmpdir(), 'repo-config-'))))
afterEach(() => rmSync(repo, { recursive: true, force: true }))

function writeConfig(config: unknown): void {
  mkdirSync(join(repo, '.terminator'), { recursive: true })
  writeFileSync(join(repo, '.terminator', 'config.json'), JSON.stringify(config))
}

describe('absent or empty config', () => {
  it('returns all defaults when there is no config file at all', () => {
    expect(loadRepoConfig(repo)).toEqual(DEFAULT_REPO_CONFIG)
  })

  it('returns all defaults for an empty object', () => {
    writeConfig({})
    expect(loadRepoConfig(repo)).toEqual(DEFAULT_REPO_CONFIG)
  })

  it('defaults to sharing nothing and copying nothing', () => {
    expect(DEFAULT_REPO_CONFIG.worktree.symlink).toEqual([])
    expect(DEFAULT_REPO_CONFIG.worktree.copy).toEqual([])
  })

  it('defaults the critical-path list to empty — it is never inferred (FR-055)', () => {
    expect(DEFAULT_REPO_CONFIG.review.criticalPaths).toEqual([])
  })

  it('defaults unattended merge to off (FR-059)', () => {
    expect(DEFAULT_REPO_CONFIG.review.unattendedMergeLowestGrade).toBe(false)
  })

  it('defaults stall thresholds to 8 and 15 minutes', () => {
    expect(DEFAULT_REPO_CONFIG.stall).toEqual({ silenceMs: 480_000, noProgressMs: 900_000 })
  })

  it('defaults every script to absent, so provisioning runs without one', () => {
    expect(DEFAULT_REPO_CONFIG.scripts).toEqual({})
  })
})

describe('reading a config', () => {
  it('reads worktree settings', () => {
    writeConfig({
      worktree: { symlink: ['node_modules'], copy: ['.env.local'], portBase: 5000, portSpan: 20 },
    })
    expect(loadRepoConfig(repo).worktree).toEqual({
      symlink: ['node_modules'],
      copy: ['.env.local'],
      portBase: 5000,
      portSpan: 20,
    })
  })

  it('reads scripts', () => {
    writeConfig({ scripts: { setup: 'npm ci', teardown: 'npm run drop', verify: 'npm test' } })
    expect(loadRepoConfig(repo).scripts).toEqual({
      setup: 'npm ci',
      teardown: 'npm run drop',
      verify: 'npm test',
    })
  })

  it('merges partial sections with defaults rather than dropping the rest', () => {
    writeConfig({ worktree: { portBase: 9000 } })
    const config = loadRepoConfig(repo)
    expect(config.worktree.portBase).toBe(9000)
    expect(config.worktree.portSpan).toBe(DEFAULT_REPO_CONFIG.worktree.portSpan)
  })

  it('reads per-repository stall thresholds (FR-016)', () => {
    writeConfig({ stall: { silenceMs: 1_800_000 } })
    expect(loadRepoConfig(repo).stall.silenceMs).toBe(1_800_000)
  })

  it('reads the network allowlist (FR-042)', () => {
    writeConfig({ network: { allowedHosts: ['github.com'] } })
    expect(loadRepoConfig(repo).network.allowedHosts).toEqual(['github.com'])
  })
})

describe('malformed config', () => {
  it('falls back to defaults for unparseable JSON rather than failing provisioning', () => {
    mkdirSync(join(repo, '.terminator'), { recursive: true })
    writeFileSync(join(repo, '.terminator', 'config.json'), '{ not json')
    expect(loadRepoConfig(repo)).toEqual(DEFAULT_REPO_CONFIG)
  })

  it('falls back to defaults when the shape is wrong', () => {
    writeConfig({ worktree: 'should be an object' })
    expect(loadRepoConfig(repo)).toEqual(DEFAULT_REPO_CONFIG)
  })

  it('rejects a negative port base rather than allocating nonsense', () => {
    writeConfig({ worktree: { portBase: -1 } })
    expect(loadRepoConfig(repo)).toEqual(DEFAULT_REPO_CONFIG)
  })
})
