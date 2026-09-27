import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  select,
  IMPACT_MAP,
  SMOKE_SPECS,
  CORE_SPECS,
  listSpecs,
  isMainPush,
  computeChanged,
} from '../../../scripts/e2e-select.mjs'

const REPO_ROOT = resolve(__dirname, '../../..')

// Git-tracked specs only: the worktree's tests/e2e/ directory can carry
// other agents' untracked scratch files (this repo is worked on by several
// concurrent workers sharing one checkout), which are not part of the
// maintained suite and should not affect reachability.
function realSpecs() {
  return (
    execFileSync('git', ['ls-files', 'tests/e2e/*.spec.ts'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .map((f) => f.replace(/^tests\/e2e\//, ''))
      // git's pathspec glob lets `*` cross directories; tests/e2e/tools/**
      // and tests/e2e/live/** are not part of the E2E suite.
      .filter((f) => !f.includes('/'))
      .sort()
  )
}

describe('select()', () => {
  const specs = [
    'foundry.spec.ts',
    'foundry-factory-view.spec.ts',
    'git-sidebar.spec.ts',
    'git-integration-smoke.spec.ts',
    'merge-flow.spec.ts',
    'notepad-outline.spec.ts',
    'dismiss-surface-on-click.spec.ts',
    'extension-escape-exit.spec.ts',
    'quick-actions.spec.ts',
    'remote-app.spec.ts',
    'extension-smoke.spec.ts',
    'extension-keyboard.spec.ts',
    'extension-themes.spec.ts',
    'extension-escape.spec.ts',
    'terminal.spec.ts',
    'workspace.spec.ts',
    'session-home.spec.ts',
  ]

  it('selects all when a path is unmatched by every rule', () => {
    const result = select({ changed: ['some/unknown/path.ts'], specs, isMainPush: false })
    expect(result.mode).toBe('all')
    expect(result.specs).toEqual(specs.slice().sort())
  })

  it('selects none for a docs-only diff', () => {
    const result = select({
      changed: [
        'docs/research/e2e-deterministic-selective.md',
        'specs/054-session-home-wall/plan.md',
      ],
      specs,
      isMainPush: false,
    })
    expect(result.mode).toBe('none')
    expect(result.specs).toEqual([])
  })

  it('selects exactly the foundry set plus smoke for a foundry-only diff', () => {
    const result = select({
      changed: ['extensions/foundry/src/index.ts'],
      specs,
      isMainPush: false,
    })
    expect(result.mode).toBe('some')
    expect(result.specs).toEqual(
      [
        'foundry.spec.ts',
        'foundry-factory-view.spec.ts',
        'extension-smoke.spec.ts',
        'extension-keyboard.spec.ts',
        'extension-themes.spec.ts',
        'extension-escape.spec.ts',
        'terminal.spec.ts',
        'workspace.spec.ts',
      ].sort()
    )
  })

  it('includes a changed spec file itself', () => {
    const result = select({
      changed: ['tests/e2e/session-home.spec.ts'],
      specs,
      isMainPush: false,
    })
    expect(result.specs).toContain('session-home.spec.ts')
  })

  it('runs everything on a push to main', () => {
    const result = select({ changed: ['docs/whatever.md'], specs, isMainPush: true })
    expect(result.mode).toBe('all')
    expect(result.specs).toEqual(specs.slice().sort())
  })

  it('unions rules for a mixed docs + notepad diff', () => {
    const result = select({
      changed: ['docs/README.md', 'extensions/notepad/src/index.ts'],
      specs,
      isMainPush: false,
    })
    expect(result.mode).toBe('some')
    expect(result.specs).toEqual(
      [
        'notepad-outline.spec.ts',
        'dismiss-surface-on-click.spec.ts',
        'extension-escape-exit.spec.ts',
        'quick-actions.spec.ts',
        'extension-smoke.spec.ts',
        'extension-keyboard.spec.ts',
        'extension-themes.spec.ts',
        'extension-escape.spec.ts',
        'terminal.spec.ts',
        'workspace.spec.ts',
      ].sort()
    )
  })

  it('an unmatched tests/e2e path other than a spec file selects all', () => {
    const result = select({
      changed: ['tests/e2e/helpers.ts'],
      specs,
      isMainPush: false,
    })
    expect(result.mode).toBe('all')
  })

  it('selects none when there are no changed paths', () => {
    const result = select({ changed: [], specs, isMainPush: false })
    expect(result).toEqual({ mode: 'none', specs: [] })
  })

  it('every real tests/e2e/*.spec.ts file is placed in a rule, the smoke set or the core set', () => {
    const specFiles = realSpecs()
    const mappedGlobs = IMPACT_MAP.flatMap((rule) => rule.specs)
    const allCoveringGlobs = [...mappedGlobs, ...SMOKE_SPECS, ...CORE_SPECS]

    const toRegExp = (glob) =>
      new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')

    for (const file of specFiles) {
      const covered = allCoveringGlobs.some((glob) => toRegExp(glob).test(file))
      expect(covered, `${file} is in no impact rule, smoke set or core set`).toBe(true)
    }
  })
})

describe('listSpecs()', () => {
  it('lists tests/e2e/*.spec.ts files, sorted, including every tracked spec', () => {
    const result = listSpecs()
    expect(result.every((f) => f.endsWith('.spec.ts'))).toBe(true)
    expect(result).toEqual([...result].sort())
    for (const tracked of realSpecs()) {
      expect(result).toContain(tracked)
    }
  })
})

describe('isMainPush()', () => {
  it('is true only for a push event on refs/heads/main', () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' })).toBe(true)
  })

  it('is false for a pull_request event', () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/heads/main' })).toBe(
      false
    )
  })

  it('is false for a push to a non-main branch', () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/feature' })).toBe(false)
  })
})

describe('computeChanged()', () => {
  it('returns the files changed since a known-empty diff base (HEAD itself)', () => {
    expect(computeChanged('HEAD')).toEqual([])
  })
})
