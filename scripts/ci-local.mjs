#!/usr/bin/env node
// Every check .github/workflows/ci.yml runs, run here: the pre-push hook calls this so a
// failure shows on this machine, not in CI. Cheapest first; stops at the first failure.
// tests/unit/scripts/ci-local.spec.ts fails when ci.yml gains a command this does not run.

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const npmRun = (script) => ({ command: 'npm', args: ['run', script] })

/** In the order they run; the Lint job's steps first, as CI orders them. */
export const CHECKS = [
  { command: 'npm', args: ['audit', '--audit-level=high'] },
  npmRun('lint:deps'),
  npmRun('lint:unused'),
  npmRun('lint:unused:production'),
  npmRun('lint:duplicates'),
  npmRun('lint'),
  npmRun('format:check'),
  npmRun('typecheck'),
  { command: 'node', args: ['scripts/check-temp-leaks.mjs', 'npx', 'vitest', 'run', '--coverage'] },
  npmRun('test:perf'),
  npmRun('test:stories'),
  npmRun('build-storybook'),
  { command: 'node', args: ['scripts/smoke-start.mjs', 'dev'] },
  { command: 'node', args: ['scripts/ci-e2e-local.mjs'] },
  { command: 'node', args: ['scripts/smoke-start.mjs', 'preview'] },
]

/** Commands in ci.yml this does not run itself, and why. */
export const NOT_RUN_HERE = {
  'npm run build': 'scripts/ci-e2e-local.mjs builds before the e2e suite',
  'npm run dev': 'an argument of smoke-start.mjs, which runs above',
  'npm run preview': 'an argument of smoke-start.mjs, which runs above',
  'node scripts/e2e-select.mjs': 'scripts/ci-e2e-local.mjs selects specs with it',
  'node scripts/e2e-shard.mjs': 'scripts/ci-e2e-local.mjs shards with it',
  'npm run test:visual':
    'its baselines are Linux screenshots and macOS renders them differently; regenerate them in Docker',
}

function runOne({ command, args }) {
  const line = [command, ...args].join(' ')
  console.log(`\n== ${line}`)
  const status = spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit' }).status
  if (status !== 0) console.error(`\nci:local failed: ${line} exited ${status}`)
  return status === 0
}

function main() {
  if (!CHECKS.every(runOne)) process.exit(1)
  console.log('\nci:local passed. Not run here:')
  for (const [command, why] of Object.entries(NOT_RUN_HERE)) console.log(`  ${command}: ${why}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
