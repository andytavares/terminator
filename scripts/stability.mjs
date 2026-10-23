#!/usr/bin/env node
// Burn-in gate: runs every spec a change adds or edits many times, shuffled, under CPU load, and
// fails on the first failure, so a flaky test is caught on the PR that writes it (Constitution XIV).
// `node scripts/stability.mjs [--runs N] [--e2e] [--list] [spec ...]`; with no specs it takes the
// *.spec.ts(x) files added or edited since origin/$GITHUB_BASE_REF (main), as last fetched.

import { execFileSync, spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { availableParallelism } from 'node:os'
import { pathToFileURL } from 'node:url'
import { needsChromium } from './ci-e2e-local.mjs'
import { startLoad } from './under-load.mjs'

const UNIT_RUNS = 30
const E2E_RUNS = 5
const SPEC_FILE = /\.spec\.(tsx?|js)$/
// What vitest.config.ts leaves out of the default run: `vitest run <file>` finds no test there.
const NOT_IN_DEFAULT_RUN = [/\.perf\.spec\.ts$/, /^extensions\/[^/]+\/tests\/live\//]

/** `--runs N`, `--e2e`, `--list` (print the specs, run nothing), then the specs named. */
export function stabilityArguments(argv) {
  const specs = []
  let runs
  const flags = new Set(['--e2e', '--list'].filter((flag) => argv.includes(flag)))
  for (let at = 0; at < argv.length; at++) {
    if (argv[at] === '--runs') runs = Number(argv[++at])
    else if (!flags.has(argv[at])) specs.push(argv[at])
  }
  const e2e = flags.has('--e2e')
  return { runs: runs ?? (e2e ? E2E_RUNS : UNIT_RUNS), e2e, list: flags.has('--list'), specs }
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
export async function burnIn({ specs, runs, run, seeds }) {
  if (specs.length === 0) return { code: 0, message: 'stability: no spec added or edited' }
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
  const base = env.GITHUB_BASE_REF || 'main'
  return execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', `origin/${base}...HEAD`], {
    encoding: 'utf8',
  })
}

const exitCodeOf = (command, args, env) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } })
    child.on('close', (status) => resolve(status ?? 1))
  })

async function runUnitBurnIn({ specs, runs }) {
  const load = startLoad(availableParallelism())
  try {
    return await burnIn({
      specs,
      runs,
      seeds: freshSeeds(runs),
      run: (seed) => exitCodeOf('npx', ['vitest', 'run', ...specs], { TEST_SEED: String(seed) }),
    })
  } finally {
    await load.stop()
  }
}

/** The commands an e2e burn-in runs, in order: Chromium's install when a spec needs it. */
export function e2eBurnInCommands(specs, runs) {
  const test = ['npx', ['playwright', 'test', ...specs, `--repeat-each=${runs}`]]
  return needsChromium(specs) ? [['npx', ['playwright', 'install', 'chromium']], test] : [test]
}

async function runE2eBurnIn({ specs, runs }) {
  if (specs.length === 0) return burnIn({ specs, runs, run: () => 0, seeds: [] })
  let code = 0
  for (const [command, args] of e2eBurnInCommands(specs, runs)) {
    code = await exitCodeOf(command, args)
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
  const burn = options.e2e ? runE2eBurnIn : runUnitBurnIn
  const { code, message } = await burn({ ...options, specs })
  ;(code === 0 ? console.log : console.error)(message)
  process.exitCode = code
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
