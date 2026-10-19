import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CHECKS, NOT_RUN_HERE } from '../../../scripts/ci-local.mjs'

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
