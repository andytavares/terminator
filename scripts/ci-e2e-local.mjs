#!/usr/bin/env node
// The E2E job of .github/workflows/ci.yml, run here step for step (selection, its shards at
// CI=1, each spec once, then every changed spec five times). `npm run ci:local:e2e` runs all of it; `-- 3` runs only shard 3.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { cpus, loadavg } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listSpecs } from './e2e-select.mjs'
import { e2eShardCount, readWorkflow } from './ci-plan.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARDS = e2eShardCount(readWorkflow(join(REPO_ROOT, '.github/workflows/ci.yml')))
const NEEDS_CHROMIUM = [
  'remote-control.spec.ts',
  'git-integration-contrast.spec.ts',
  'git-integration-stacking.spec.ts',
  'design-system-fields.spec.ts',
]

const run = (command, args, env = {}) =>
  spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
    .status === 0

const QUIET_WAIT_MS = 180_000
const QUIET_POLL_MS = 5_000

/**
 * True once the one-minute load average is at most half the cores, false if it is not
 * within `limitMs`. A loaded machine fails timing-dependent specs for reasons CI would not
 * have, and `ci:local` runs the unit suite just before this, which leaves the load high.
 */
export async function waitForQuiet({ readLoad, cores, pause, limitMs }) {
  for (let waited = 0; ; waited += QUIET_POLL_MS) {
    if (readLoad() <= cores / 2) return true
    if (waited >= limitMs) return false
    await pause(QUIET_POLL_MS)
  }
}

/** The `count` busiest processes in `ps -Ao pcpu,comm -r` output, as `<cpu>%  <command>`. */
export function busiestProcesses(psOutput, count) {
  return psOutput
    .split('\n')
    .slice(1)
    .map((line) => line.trim().match(/^([\d.]+)\s+(.+)$/))
    .filter((match) => match !== null)
    .map(([, cpu, command]) => ({ cpu: Number(cpu), command }))
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, count)
    .map(({ cpu, command }) => `${cpu.toFixed(1)}%  ${command}`)
}

const readProcesses = () => execFileSync('ps', ['-Ao', 'pcpu,comm', '-r'], { encoding: 'utf8' })

async function requireQuietMachine() {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const machine = { readLoad: () => loadavg()[0], cores: cpus().length, pause }
  if (await waitForQuiet({ ...machine, limitMs: QUIET_WAIT_MS })) return
  console.error(
    `Load average is ${loadavg()[0].toFixed(1)} on ${cpus().length} cores after ${QUIET_WAIT_MS / 1000}s. Quiet the machine and run again. Busiest now:`
  )
  for (const line of busiestProcesses(readProcesses(), 8)) console.error(`  ${line}`)
  process.exit(2)
}

/** The e2e specs a selection runs: every spec when it says all, else the ones it names. */
export function e2eSpecsOf(selection, allSpecs) {
  return selection.e2eMode === 'all' ? allSpecs : selection.e2e
}

function selection() {
  const output = execFileSync('node', ['scripts/test-select.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  return JSON.parse(output)
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

/** Whether any of `specs` drives a plain Chromium, which Playwright must install first. */
export const needsChromium = (specs) =>
  NEEDS_CHROMIUM.some((spec) => specs.some((arg) => arg.endsWith(spec)))

/** The `playwright` arguments for one shard; its own output directory keeps shards from clearing each other's. */
export const playwrightArguments = (shard, args) => [
  'test',
  ...args,
  '--grep-invert',
  '@quarantine',
  '--reporter=dot',
  '--output',
  `test-results/shard-${shard}`,
]

/** True when no e2e spec is selected and none changed: no build, no wait, no run. */
/** Runs every shard at once; `runShard(shard)` resolves true on a pass. Returns the failed shards. */
export async function runShardsTogether(shards, runShard) {
  const passed = await Promise.all(shards.map(runShard))
  return shards.filter((_, index) => !passed[index])
}

/** Runs a command with its output held back; resolves with whether it passed and what it printed. */
const runBuffered = (command, args, env) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('close', (code) => resolve({ passed: code === 0, output }))
  })

/** Runs one shard and prints its output as one block when it ends. */
async function runShard({ shard, args }) {
  const started = Date.now()
  const { passed, output } = await runBuffered(
    'npx',
    ['playwright', ...playwrightArguments(shard, args)],
    {
      CI: '1',
    }
  )
  const seconds = Math.round((Date.now() - started) / 1000)
  console.log(
    `\n== shard ${shard}/${SHARDS} (${seconds}s, ${passed ? 'passed' : 'FAILED'})\n${output}`
  )
  return passed
}

async function runShards(only, specs) {
  const shards = Array.from({ length: SHARDS }, (_, index) => index + 1)
    .filter((shard) => only === null || shard === only)
    .map((shard) => ({ shard, args: argumentsOfShard(shard, specs) }))
    .filter(({ args }) => args.length > 0)
  // Installed once here: two shards must not race to download the same browser.
  if (shards.some(({ args }) => needsChromium(args))) {
    if (!run('npx', ['playwright', 'install', 'chromium'])) return shards.map(({ shard }) => shard)
  }
  const failed = await runShardsTogether(shards, runShard)
  return failed.map(({ shard }) => shard)
}

async function main() {
  const only = process.argv[2] ? Number(process.argv[2]) : null
  const chosen = selection()
  const specs = e2eSpecsOf(chosen, listSpecs())
  if (specs.length === 0) {
    console.log(`No e2e spec selected: ${chosen.reason}`)
    process.exit(0)
  }
  await requireQuietMachine()
  if (!run('npm', ['run', 'build'])) process.exit(1)
  // The shards start together; unpacked lazily, Electron's binary is written over itself (b2181135).
  if (!run('npx', ['install-electron'])) process.exit(1)
  console.log(`${specs.length} spec(s) selected: ${chosen.reason}`)
  const failed = await runShards(only, specs)
  // The repeats of changed specs run in CI only (Constitution XIV, ADR 132).
  if (failed.length > 0) console.error(`\nShards failed: ${failed.join(', ')}`)
  process.exit(failed.length === 0 ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
