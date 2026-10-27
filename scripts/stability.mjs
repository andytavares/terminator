#!/usr/bin/env node
// node scripts/stability.mjs [--runs N] [--part K/N] [--e2e] [--list] [--github-output] [spec ...]:
// runs each spec a change adds or edits (since origin/<base>, as fetched) many times, shuffled,
// under load, and fails on the first failure, so a flaky test is caught on the PR that writes it
// (ADR 124). With --e2e, --part K/N hands Playwright --shard=K/N. --github-output sizes CI's
// Stability shards instead of running anything.

import { execFileSync, spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { availableParallelism } from 'node:os'
import { pathToFileURL } from 'node:url'
import { needsChromium } from './ci-e2e-local.mjs'
import { baseBranch } from './check-release-age.mjs'
import { startLoad } from './under-load.mjs'

const UNIT_RUNS = 30
const E2E_RUNS = 5
const SPEC_FILE = /\.spec\.(tsx?|js)$/
// What vitest.config.ts leaves out of the default run: `vitest run <file>` finds no test there.
const NOT_IN_DEFAULT_RUN = [/\.perf\.spec\.ts$/, /^extensions\/[^/]+\/tests\/live\//]
// One unit run on CI's ubuntu-24.04-arm under load: 96 specs took 81-86 s (run 39976627567).
const SECONDS_PER_SPEC = 0.9
const SECONDS_PER_RUN = 5
// The goal is a CI run of 5 minutes, so a shard plans for 3 and a slow run still finishes.
const SHARD_SECONDS = 180
// CI has a 20-job limit; a bigger plan stretches each shard's budget instead of adding shards.
const MAX_SHARDS = 4
const FLAGS = ['--e2e', '--list', '--github-output']
const VALUED = ['--runs', '--part']

/** `--runs N`, `--part K/N` (the Kth of N slices of the specs), `--e2e`, `--list` (print the specs,
 * run nothing), `--github-output` (print CI's shards, run nothing), then the specs named. */
export function stabilityArguments(argv) {
  const specs = []
  const values = {}
  for (let at = 0; at < argv.length; at++) {
    if (VALUED.includes(argv[at])) values[argv[at]] = argv[++at]
    else if (!FLAGS.includes(argv[at])) specs.push(argv[at])
  }
  const e2e = argv.includes('--e2e')
  const runs =
    values['--runs'] === undefined ? (e2e ? E2E_RUNS : UNIT_RUNS) : Number(values['--runs'])
  const part = values['--part'] ?? '1/1'
  return {
    runs,
    part,
    e2e,
    list: argv.includes('--list'),
    githubOutput: argv.includes('--github-output'),
    specs,
  }
}

/** One plan for a per-shard budget: `runs` passes over each of the parts of the specs. */
function planShards(specCount, runs, budgetSeconds) {
  const parts = Math.max(1, Math.ceil((specCount * SECONDS_PER_SPEC) / budgetSeconds))
  const passSeconds = SECONDS_PER_RUN + (specCount * SECONDS_PER_SPEC) / parts
  const runsPerShard = Math.max(1, Math.floor(budgetSeconds / passSeconds))
  const shards = []
  for (let done = 0; done < runs; done += runsPerShard) {
    for (let part = 1; part <= parts; part++) {
      shards.push({
        shard: shards.length + 1,
        runs: Math.min(runsPerShard, runs - done),
        part: `${part}/${parts}`,
      })
    }
  }
  return shards
}

/** CI's Stability shards: each runs `runs` passes over one `part` of the specs inside
 * SHARD_SECONDS, and together they run every spec `runs` times in all. At most MAX_SHARDS: when
 * SHARD_SECONDS needs more, the budget grows one second at a time until the plan fits. */
export function stabilityShards(specCount, runs) {
  let budget = SHARD_SECONDS
  let shards = planShards(specCount, runs, budget)
  while (shards.length > MAX_SHARDS) shards = planShards(specCount, runs, ++budget)
  return shards
}

/** Vitest's arguments for one pass over `part` of the specs. */
export function unitBurnInArguments(specs, part) {
  const args = ['vitest', 'run', ...specs]
  return part === '1/1' ? args : [...args, `--shard=${part}`]
}

/** The spec files in a `git diff --name-only` listing: end-to-end ones or unit ones. */
export function changedSpecs(diffOutput, { e2e }) {
  return diffOutput
    .split('\n')
    .filter((file) => SPEC_FILE.test(file) && file.startsWith('tests/e2e/') === e2e)
    .filter((file) => !NOT_IN_DEFAULT_RUN.some((excluded) => excluded.test(file)))
}

/** `count` seeds, none repeated. */
export function freshSeeds(count) {
  const seeds = new Set()
  while (seeds.size < count) seeds.add(randomInt(1, 2 ** 31))
  return [...seeds]
}

/** Runs `run(seed)` once per seed; stops at the first non-zero code. */
export async function burnIn({ specs, run, seeds }) {
  if (specs.length === 0) return { code: 0, message: 'stability: no spec added or edited' }
  const runs = seeds.length
  for (let index = 0; index < runs; index++) {
    if ((await run(seeds[index])) !== 0) {
      const failed = `failed on run ${index + 1} of ${runs} with TEST_SEED=${seeds[index]}`
      return { code: 1, message: `stability: ${specs.join(' ')} ${failed}` }
    }
  }
  return { code: 0, message: `stability: ${runs} runs passed for ${specs.length} specs` }
}

/** Reads origin/<base> as fetched; fetches nothing. */
function diffAgainstBase(env) {
  const base = baseBranch(env)
  return execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', `origin/${base}...HEAD`], {
    encoding: 'utf8',
  })
}

const commandExitCode = (command, args, env) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } })
    child.on('close', (status) => resolve(status ?? 1))
  })

async function runUnitBurnIn({ specs, runs, part }) {
  const load = startLoad(availableParallelism())
  try {
    return await burnIn({
      specs,
      seeds: freshSeeds(runs),
      run: (seed) =>
        commandExitCode('npx', unitBurnInArguments(specs, part), { TEST_SEED: String(seed) }),
    })
  } finally {
    await load.stop()
  }
}

/** The commands an e2e burn-in runs, in order: Chromium's install when a spec needs it, then
 * Playwright, which gives this `part` of the repeated tests to this E2E shard. */
export function e2eBurnInCommands(specs, runs, part = '1/1') {
  const args = ['playwright', 'test', ...specs, `--repeat-each=${runs}`]
  const test = ['npx', part === '1/1' ? args : [...args, `--shard=${part}`]]
  return needsChromium(specs) ? [['npx', ['playwright', 'install', 'chromium']], test] : [test]
}

async function runE2eBurnIn({ specs, runs, part }) {
  if (specs.length === 0) return burnIn({ specs, run: () => 0, seeds: [] })
  let code = 0
  for (const [command, args] of e2eBurnInCommands(specs, runs, part)) {
    code = await commandExitCode(command, args)
    if (code !== 0) break
  }
  return { code, message: `stability: playwright exited ${code} for ${specs.length} specs` }
}

async function main() {
  const options = stabilityArguments(process.argv.slice(2))
  const specs = options.specs.length
    ? options.specs
    : changedSpecs(diffAgainstBase(process.env), options)
  if (options.list) return specs.forEach((spec) => console.log(spec))
  if (options.githubOutput) {
    return console.log(`shards=${JSON.stringify(stabilityShards(specs.length, options.runs))}`)
  }
  const burn = options.e2e ? runE2eBurnIn : runUnitBurnIn
  const { code, message } = await burn({ ...options, specs })
  ;(code === 0 ? console.log : console.error)(message)
  process.exitCode = code
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
