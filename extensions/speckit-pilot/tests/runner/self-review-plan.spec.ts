import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selfReviewCommand, selfReviewSteps } from '../../src/runner/self-review-plan.js'

// The four checks used to be one `&&` chain: a single exit code for four
// questions, and everything after the first failure never ran.

let worktree: string
let outputDir: string

const plan = (settingsPath: string | null = '/state/read-only.settings.json') =>
  selfReviewSteps({ worktreePath: worktree, outputDir, settingsPath })

const step = (id: string, settingsPath?: string | null) =>
  plan(settingsPath === undefined ? '/state/read-only.settings.json' : settingsPath).find(
    (candidate) => candidate.id === id
  )!.command

function withScripts(scripts: Record<string, string>): void {
  writeFileSync(join(worktree, 'package.json'), JSON.stringify({ scripts }))
}

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), 'self-review-wt-'))
  outputDir = mkdtempSync(join(tmpdir(), 'self-review-out-'))
  withScripts({ 'format:check': 'prettier --check .', lint: 'eslint .', test: 'vitest run' })
})

afterEach(() => {
  for (const dir of [worktree, outputDir]) rmSync(dir, { recursive: true, force: true })
})

describe('the formatting step', () => {
  it('checks rather than formats', () => {
    // `format` is `prettier --write` wherever both exist, and a review that
    // reformats the code under review is not a review.
    expect(step('format')).toBe('npm run format:check')
  })

  it('says so rather than running the writing one', () => {
    withScripts({ format: 'prettier --write .' })
    expect(step('format')).not.toContain('npm run format')
    expect(step('format')).toContain('not checked')
  })

  it('fails when it could not check, so it is not mistaken for clean', () => {
    withScripts({})
    expect(step('format')).toContain('false')
  })
})

describe('the lint step', () => {
  it('asks for the documented report shape rather than reading the console', () => {
    expect(step('lint')).toContain('--format json')
    expect(step('lint')).toContain('--output-file')
  })

  it('writes the report outside the repository', () => {
    // A review that adds files to the diff it is reviewing has changed the
    // thing it was measuring.
    expect(step('lint')).toContain(outputDir)
    expect(step('lint')).not.toContain(`${worktree}/lint.json`)
  })

  it('says so when the repository has no lint script', () => {
    withScripts({ 'format:check': 'prettier --check .' })
    expect(step('lint')).toContain('not run')
  })
})

describe('the test step', () => {
  it('asks coverage to report itself as data', () => {
    expect(step('test')).toContain('--coverage.reporter=json-summary')
  })

  it('puts the coverage directory outside the repository', () => {
    expect(step('test')).toContain(outputDir)
  })
})

describe('the review step', () => {
  it('runs under the read-only settings', () => {
    expect(step('review')).toContain('--settings')
    expect(step('review')).toContain('--permission-mode default')
  })

  it('refuses rather than bypassing permissions when the policy is missing', () => {
    // Falling back to `bypassPermissions` is how this was wrong before.
    expect(step('review', null)).not.toContain('bypassPermissions')
    expect(step('review', null)).toContain('could not be installed')
  })
})

describe('running them', () => {
  const command = () => selfReviewCommand({ worktreePath: worktree, outputDir, settingsPath: null })

  it('does not stop at the first failure — a gate wants all four answers', () => {
    expect(command()).not.toContain('&&\n')
    // Every step is separated by `;`, so a failing one does not skip the rest.
    expect(command().split('; ').length).toBeGreaterThan(4)
  })

  it('records each step’s own exit code, since one cannot carry four', () => {
    for (const id of ['format', 'lint', 'test', 'review']) {
      expect(command()).toContain(`echo $? > '${join(outputDir, `${id}.code`)}'`)
    }
  })

  it('reads the code immediately, before anything else can overwrite it', () => {
    const parts = command().split('; ')
    const formatStep = parts.findIndex((part) => part.includes('format'))
    expect(parts[formatStep + 1]).toContain('format.code')
  })

  it('makes somewhere to put them', () => {
    expect(command().startsWith(`mkdir -p '${outputDir}'`)).toBe(true)
  })

  it('quotes a path with a space in it', () => {
    outputDir = join(tmpdir(), 'a dir with spaces')
    expect(command()).toContain(`'${join(outputDir, 'format.code')}'`)
  })
})
