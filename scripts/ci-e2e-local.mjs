#!/usr/bin/env node
// The E2E job of .github/workflows/ci.yml, run here step for step (selection, five shards at
// CI=1, burn-in of changed specs). `npm run ci:local` runs all of it; `-- 3` runs only shard 3.

import { execFileSync, spawnSync } from 'node:child_process'
import { cpus, loadavg } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeChanged, listSpecs, select } from './e2e-select.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'origin/main'
const SHARDS = 5
const BURN_IN_REPEATS = 2
const NEEDS_CHROMIUM = [
  'remote-control.spec.ts',
  'git-integration-contrast.spec.ts',
  'git-integration-stacking.spec.ts',
  'design-system-fields.spec.ts',
]

const run = (command, args, env = {}) =>
  spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
    .status === 0

/** A loaded machine fails timing-dependent specs for reasons CI would not have. */
function requireQuietMachine() {
  const load = loadavg()[0]
  if (load <= cpus().length / 2) return
  console.error(
    `Load average is ${load.toFixed(1)} on ${cpus().length} cores. Quiet the machine and run again.`
  )
  process.exit(2)
}

function selection() {
  const changed = computeChanged(BASE)
  const chosen = select({ changed, specs: listSpecs(), isMainPush: false })
  const specs = chosen.mode === 'all' ? listSpecs() : chosen.specs
  const changedSpecs = changed
    .filter((path) => /^tests\/e2e\/[^/]+\.spec\.ts$/.test(path))
    .map((path) => path.replace('tests/e2e/', ''))
  return { specs, changedSpecs }
}

/** The Playwright arguments `scripts/e2e-shard.mjs` gives one shard. */
function argumentsOfShard(shard, specs) {
  const output = execFileSync(
    'node',
    ['scripts/e2e-shard.mjs', String(shard), String(SHARDS), ...specs],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  )
  return output.split(/\s+/).filter(Boolean)
}

function playwright(args, extra = []) {
  const needsChromium = NEEDS_CHROMIUM.some((spec) => args.some((arg) => arg.endsWith(spec)))
  if (needsChromium && !run('npx', ['playwright', 'install', 'chromium'])) return false
  return run('npx', ['playwright', 'test', ...args, ...extra, '--reporter=dot'], { CI: '1' })
}

function runShards(only, specs) {
  const failed = []
  for (let shard = 1; shard <= SHARDS; shard++) {
    if (only !== null && shard !== only) continue
    const args = argumentsOfShard(shard, specs)
    if (args.length === 0) continue
    console.log(`\n== shard ${shard}/${SHARDS}`)
    if (!playwright(args)) failed.push(shard)
  }
  return failed
}

function burnIn(changedSpecs) {
  if (changedSpecs.length === 0) return true
  console.log(`\n== burn-in of ${changedSpecs.length} changed spec(s), ${BURN_IN_REPEATS} repeats`)
  const files = changedSpecs.map((spec) => `tests/e2e/${spec}`)
  return playwright(files, [`--repeat-each=${BURN_IN_REPEATS}`])
}

function main() {
  const only = process.argv[2] ? Number(process.argv[2]) : null
  requireQuietMachine()
  if (!run('npm', ['run', 'build'])) process.exit(1)
  const { specs, changedSpecs } = selection()
  console.log(`${specs.length} spec(s) selected against ${BASE}`)
  const failed = runShards(only, specs)
  const burnInPassed = only !== null || burnIn(changedSpecs)
  if (failed.length > 0) console.error(`\nShards failed: ${failed.join(', ')}`)
  if (!burnInPassed) console.error('\nThe burn-in of the changed specs failed.')
  process.exit(failed.length === 0 && burnInPassed ? 0 : 1)
}

main()
