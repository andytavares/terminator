import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CHECKS,
  NOT_RUN_HERE,
  checkEnvironment,
  recordablePass,
  unverifiedPushes,
} from '../../../scripts/ci-local.mjs'

const REPO_ROOT = resolve(__dirname, '../../..')

/** Every `npm run <script>`, `npm audit` and `node scripts/<file>` the CI workflow names. */
function commandsInCi(): string[] {
  const workflow = readFileSync(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')
  const found = workflow.match(/npm run [\w:-]+|npm audit|node scripts\/[\w.-]+/g) ?? []
  return [...new Set(found)]
}

const localCommands = CHECKS.map((check) => [check.command, ...check.args].join(' '))

describe('ci:local runs what CI runs', () => {
  it('runs or names a reason for every command in ci.yml', () => {
    const missing = commandsInCi().filter(
      (command) =>
        !localCommands.some((local) => local.includes(command)) && !(command in NOT_RUN_HERE)
    )
    expect(missing).toEqual([])
  })

  it('gives a reason for every command it leaves out', () => {
    for (const reason of Object.values(NOT_RUN_HERE)) expect(reason).not.toBe('')
  })

  it('runs the Lint job steps CI fails on, knip included', () => {
    for (const script of [
      'lint:unused',
      'lint:unused:production',
      'lint:duplicates',
      'lint:deps',
    ]) {
      expect(localCommands).toContain(`npm run ${script}`)
    }
  })

  it('runs the selected e2e specs and their burn-in', () => {
    expect(localCommands).toContain('node scripts/ci-e2e-local.mjs')
  })
})

describe('ci:local runs each check as CI would, outside any git hook', () => {
  it('drops the GIT_ variables a pre-push hook is given, and keeps the rest', () => {
    const fromHook = {
      GIT_DIR: '/repo/.git/worktrees/branch',
      GIT_PREFIX: '',
      GIT_EXEC_PATH: '/git-core',
      GIT_TRACE2_PARENT_SID: 'sid',
      PATH: '/usr/bin',
      HOME: '/Users/someone',
    }
    expect(checkEnvironment(fromHook)).toEqual({ PATH: '/usr/bin', HOME: '/Users/someone' })
  })
})

const PASSED = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const DELETED = '0'.repeat(40)
const pushLine = (localSha: string, ref = 'refs/heads/fix/branch') =>
  `${ref} ${localSha} ${ref} ${'c'.repeat(40)}`

describe('the pre-push hook lets through only what ci:local passed on', () => {
  it('lets through the commit ci:local passed on', () => {
    expect(unverifiedPushes(`${pushLine(PASSED)}\n`, PASSED)).toEqual([])
  })

  it('names each ref whose commit ci:local has not passed on', () => {
    const lines = [pushLine(PASSED), pushLine(OTHER, 'refs/heads/other')].join('\n')
    expect(unverifiedPushes(lines, PASSED)).toEqual(['refs/heads/other'])
  })

  it('refuses everything when ci:local has never passed here', () => {
    expect(unverifiedPushes(pushLine(PASSED), null)).toEqual(['refs/heads/fix/branch'])
  })

  it('lets a deleted ref through, since it pushes no code', () => {
    expect(unverifiedPushes(pushLine(DELETED), null)).toEqual([])
  })
})

describe('ci:local records a pass only for a commit it tested', () => {
  const clean = { headBefore: PASSED, headAfter: PASSED, changesBefore: '', changesAfter: '' }

  it('records a clean tree whose commit did not move', () => {
    expect(recordablePass(clean)).toBe(true)
  })

  it('records nothing when there were uncommitted changes, which no commit holds', () => {
    expect(recordablePass({ ...clean, changesBefore: ' M src/main/index.ts\n' })).toBe(false)
    expect(recordablePass({ ...clean, changesAfter: '?? scratch.txt\n' })).toBe(false)
  })

  it('records nothing when HEAD moved during the run', () => {
    expect(recordablePass({ ...clean, headAfter: OTHER })).toBe(false)
  })
})
