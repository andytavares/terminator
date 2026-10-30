#!/usr/bin/env node
// The unit and e2e tests a change can reach, for CI and `npm test` alike (ADR 123): the checkout
// against its merge base with origin/main, new files included; unknown means everything.
// Forms: no flag (JSON), --all, --print unit|coverage, --github-output, --run unit.

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { eachLimited } from './each-limited.mjs'
import { IMPACT_MAP, isMainPush, listSpecs, matchesAny, select } from './e2e-select.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARDS_FOR_A_LARGE_SELECTION = 4
const LARGE_SELECTION = 100

// A change to any of these can change every test's result, so every test runs. eslint.config.mjs
// is not here: lint is not a test.
export const ALWAYS_ALL = [
  'vitest.config.ts',
  'vitest.*.config.ts',
  'tests/setup.ts',
  'tests/global-setup.ts',
  'tests/support/**',
  'package-lock.json',
  'package.json',
  '.nvmrc',
  'tsconfig*.json',
  'playwright.config.ts',
  'tests/e2e/helpers.ts',
  'tests/e2e/global-*.ts',
  'scripts/test-env.mjs',
  'scripts/test-select.mjs',
  'tests/fixtures/git/**',
]

// Paths no test reads.
export const DOCS_GLOBS = ['docs/**', '**/*.md']

const FOUNDRY_SPECS = [
  'extensions/foundry/tests/**',
  'tests/integration/foundry-portability.spec.ts',
]
const EXTENSION_HOST_SPECS = [
  'extensions/*/tests/**',
  'tests/unit/extensions/**',
  'tests/unit/extension-frame/**',
  'tests/unit/lint/**',
  'tests/unit/main/extensions/**',
  'tests/unit/packages/**',
  'tests/unit/renderer/**',
  'tests/unit/scripts/**',
  'tests/integration/**',
]

// Data files source reads at run time, which no import graph shows: path glob -> spec globs.
// tests/unit/scripts/test-select.spec.ts fails when a file the source reads matches no rule.
export const RUNTIME_READS = [
  {
    globs: ['extensions/foundry/hints/**'],
    specs: [
      'extensions/foundry/tests/profile/**',
      'extensions/foundry/tests/ipc/profile-channels.spec.ts',
      'extensions/foundry/tests/verify/ecosystem-neutral.spec.ts',
      'tests/integration/foundry-portability.spec.ts',
    ],
  },
  {
    globs: [
      'extensions/foundry/recipes/**',
      'extensions/foundry/roles/**',
      'extensions/foundry/rules/**',
      'extensions/foundry/sensors/**',
      'extensions/foundry/skills/**',
      'extensions/foundry/assets/**',
      'extensions/foundry/tests/**/fixtures/**',
    ],
    specs: FOUNDRY_SPECS,
  },
  {
    globs: ['extensions/*/manifest.json', 'extensions/*/index.html'],
    specs: EXTENSION_HOST_SPECS,
  },
  {
    globs: ['src/renderer/*.html', 'src/renderer-remote/*.html'],
    specs: [
      'tests/unit/renderer/**',
      'tests/unit/renderer-remote/**',
      'tests/unit/main/extensions/**',
      'tests/unit/packages/**',
      'extensions/remote-control/tests/**',
    ],
  },
  {
    globs: ['**/*.css'],
    specs: [
      'tests/unit/extension-css-layers.spec.ts',
      'tests/unit/lint/**',
      'tests/unit/packages/**',
      'tests/unit/renderer/**',
      'packages/*/tests/**',
      'extensions/*/tests/**',
    ],
  },
  {
    globs: ['tests/fixtures/transcripts/**'],
    specs: ['tests/unit/agents/**', 'tests/unit/ipc/**'],
  },
  {
    globs: ['tests/fixtures/integrations/**'],
    specs: ['tests/unit/integrations/**'],
  },
  {
    globs: ['tests/unit/**/fixtures/**'],
    specs: ['tests/unit/renderer/sidebar/**'],
  },
  {
    globs: ['tests/e2e/fixtures/**'],
    specs: ['tests/unit/e2e-harness/**', 'tests/unit/scripts/**'],
  },
  {
    globs: ['tests/e2e/timings.json'],
    specs: ['tests/unit/scripts/e2e-shard.spec.ts'],
  },
  {
    globs: ['.github/workflows/*.yml'],
    specs: ['tests/unit/scripts/**'],
  },
  {
    globs: ['eslint.config.mjs'],
    specs: ['tests/unit/lint/**'],
  },
]

const TESTED_ROOTS = /^(src|extensions|packages|scripts|tests)\//
const CODE_OR_DATA = /\.(tsx?|[cm]?js|ya?ml|json|jsonl|html|css|sh|txt)$/
const CODE = /\.(tsx?|[cm]?js)$/
const READS_FILES = /\b(readFileSync|readFile|readdirSync|readdir|globSync)\s*\(/
const NAMES_THE_REPOSITORY =
  /process\.cwd\(\)|__dirname|import\.meta|REPO_ROOT|repoRoot|\bROOT\b|\bhere\b/

const everything = (reason, base) => ({
  mode: 'all',
  unit: [],
  e2e: [],
  e2eMode: 'all',
  base,
  reason,
})

/** True for `--all` or TEST_ALL=1. */
export function isAllRequested(argv, env) {
  return argv.includes('--all') || env.TEST_ALL === '1'
}

/** The specs a glob list names, among the specs that exist. */
function specsMatching(specGlobs, specs) {
  return specs.filter((spec) => matchesAny(spec, specGlobs))
}

/** A spec that reads source files off disk is affected by a change no import shows. */
function areaOf(spec) {
  return /^extensions\/[^/]+\//.exec(spec)?.[0] ?? ''
}

function scannersFor(file, scanners) {
  if (!CODE.test(file)) return []
  return scanners.filter((spec) => file.startsWith(areaOf(spec)))
}

/** The unit specs one changed path asks for, or `unknown: true` when nothing claims it. */
async function unitImpact(file, tools, unitSpecs) {
  if (matchesAny(file, DOCS_GLOBS)) return { specs: [], unknown: false }
  const claims = RUNTIME_READS.filter((rule) => matchesAny(file, rule.globs))
  const specs = claims.flatMap((rule) => specsMatching(rule.specs, unitSpecs))
  if (unitSpecs.includes(file)) return { specs: [file], unknown: false }
  if (file.startsWith('tests/e2e/') || !TESTED_ROOTS.test(file) || !CODE_OR_DATA.test(file))
    return { specs, unknown: false }
  const related = await tools.relatedSpecs(file)
  const scanners = scannersFor(file, await tools.scanners())
  const claimed =
    claims.length > 0 ||
    matchesAny(
      file,
      IMPACT_MAP.flatMap((rule) => rule.globs)
    )
  return { specs: [...specs, ...related, ...scanners], unknown: !claimed && related.length === 0 }
}

/** How many changed files are looked up at once: each lookup starts a vitest instance. */
const LOOKUPS_AT_ONCE = 4

async function unitSelection(changed, tools) {
  const unitSpecs = await tools.unitSpecs()
  const impacts = await eachLimited(changed, LOOKUPS_AT_ONCE, (file) =>
    unitImpact(file, tools, unitSpecs)
  )
  const unknown = impacts.findIndex((impact) => impact.unknown)
  if (unknown !== -1) return { unknown: changed[unknown] }
  return { unit: [...new Set(impacts.flatMap((impact) => impact.specs))].sort() }
}

function alwaysAllHit(changed) {
  return changed.find((file) => matchesAny(file, ALWAYS_ALL))
}

/** @param {{ changed: string[], base: string, allRequested?: boolean }} input */
export async function selectTests(input, tools) {
  const { changed, base } = input
  if (input.allRequested) return everything('everything was asked for (--all or TEST_ALL=1)', base)
  const always = alwaysAllHit(changed)
  if (always) return everything(`${always} can change every test's result`, base)
  const chosen = await unitSelection(changed, tools)
  if (chosen.unknown)
    return everything(`${chosen.unknown} is read by no spec and no map claims it`, base)
  const e2e = select({ changed, specs: tools.e2eSpecs() })
  const mode = chosen.unit.length === 0 && e2e.mode === 'none' ? 'none' : 'selected'
  return { mode, unit: chosen.unit, e2e: e2e.specs, e2eMode: e2e.mode, base, reason: 'by the diff' }
}

/** The arguments `vitest run` takes for a selection. */
export function printArguments({ mode, unit, base }) {
  if (mode === 'all') return ''
  if (mode === 'none') return '--passWithNoTests nothing-selected'
  return [...unit, `--coverage.changed=${base}`].join(' ')
}

/** The coverage argument alone, for the step that merges the shards' reports. */
function coverageArguments({ mode, base }) {
  return mode === 'selected' ? `--coverage.changed=${base}` : ''
}

/** `name=value` lines for $GITHUB_OUTPUT. */
export function githubOutputs({ mode, unit, e2e, e2eMode }) {
  const large = mode === 'all' || unit.length >= LARGE_SELECTION
  const count = large ? SHARDS_FOR_A_LARGE_SELECTION : 1
  const shards = Array.from({ length: count }, (_, index) => index + 1)
  return [
    `mode=${mode}`,
    `run_unit=${mode === 'all' || unit.length > 0}`,
    `run_e2e=${e2eMode !== 'none'}`,
    `e2e_mode=${e2eMode}`,
    `e2e_specs=${e2e.join(' ')}`,
    `shard_count=${count}`,
    `shards=${JSON.stringify(shards)}`,
    '',
  ].join('\n')
}

function gitOutput(args, cwd = REPO_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** Every path the checkout changed since `base`: committed, edited but not committed, or new and
 * untracked. CI's checkout is clean, so there it is the commits alone. */
export function changedInCheckout(base, cwd = REPO_ROOT) {
  const edited = gitOutput(['diff', '--name-only', base], cwd)
  const untracked = gitOutput(['ls-files', '--others', '--exclude-standard'], cwd)
  return [...new Set(`${edited}\n${untracked}`.split('\n').filter(Boolean))]
}

/** What the change is compared with: for a push to main, the commit main was at before (its first
 * parent); otherwise the commit it forked from main, GITHUB_BASE_REF in CI (Constitution XIV). */
export function selectionBase(env, cwd = REPO_ROOT) {
  if (isMainPush(env)) return gitOutput(['rev-parse', 'HEAD^1'], cwd)
  return gitOutput(['merge-base', `origin/${env.GITHUB_BASE_REF || 'main'}`, 'HEAD'], cwd)
}

/** A spec that reads repository files by path sees changes no import shows. */
function isScanner(text) {
  return READS_FILES.test(text) && NAMES_THE_REPOSITORY.test(text)
}

/** The spec files `files` reach through vitest's import graph, by its public API: an instance
 * made with `related`, as `vitest related` makes one (https://vitest.dev/api/advanced/vitest). */
async function specsRelatedTo(createVitest, files) {
  const options = { watch: false, run: true, related: files.map((file) => join(REPO_ROOT, file)) }
  const vitest = await createVitest('test', options)
  try {
    const specs = await vitest.getRelevantTestSpecifications()
    return specs.map((spec) => relative(REPO_ROOT, spec.moduleId))
  } finally {
    await vitest.close()
  }
}

/** Tools over vitest's own import graph, through its public Node API only. */
export async function vitestTools() {
  const { createVitest } = await import('vitest/node')
  const vitest = await createVitest('test', { watch: false, run: true })
  const unitSpecs = (await vitest.globTestSpecifications()).map((spec) =>
    relative(REPO_ROOT, spec.moduleId)
  )
  await vitest.close()
  let scanners = null
  return {
    unitSpecs: async () => unitSpecs,
    e2eSpecs: () => listSpecs(),
    relatedSpecs: (file) => specsRelatedTo(createVitest, [file]),
    // Read once: every changed file asks.
    scanners: async () =>
      (scanners ??= unitSpecs.filter((spec) =>
        isScanner(readFileSync(join(REPO_ROOT, spec), 'utf8'))
      )),
    close: async () => undefined,
  }
}

/** The tools for a diff that needs no import graph: its answers are fixed and empty. */
const noTools = {
  unitSpecs: async () => [],
  e2eSpecs: () => listSpecs(),
  relatedSpecs: async () => [],
  scanners: async () => [],
}

async function selectForCheckout(argv, env) {
  if (isAllRequested(argv, env))
    return everything('everything was asked for (--all or TEST_ALL=1)', '')
  const base = selectionBase(env)
  const changed = changedInCheckout(base)
  if (alwaysAllHit(changed)) return selectTests({ changed, base }, noTools)
  const tools = await vitestTools()
  try {
    return await selectTests({ changed, base }, tools)
  } finally {
    await tools.close()
  }
}

const OWN_FLAGS = ['--all', '--github-output']
const OWN_VALUE_FLAGS = ['--print', '--run']

/** The arguments that are vitest's, with this script's own flags taken out. */
function passedThrough(argv) {
  return argv.filter(
    (arg, index) =>
      !OWN_FLAGS.includes(arg) &&
      !OWN_VALUE_FLAGS.includes(arg) &&
      !OWN_VALUE_FLAGS.includes(argv[index - 1])
  )
}

function runUnit(selection, argv) {
  const args = [
    'vitest',
    'run',
    '--coverage',
    ...printArguments(selection).split(' ').filter(Boolean),
  ]
  const status = spawnSync('npx', [...args, ...passedThrough(argv)], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  }).status
  process.exit(status ?? 1)
}

function report(selection, argv) {
  const kind = argv[argv.indexOf('--print') + 1]
  if (argv.includes('--github-output')) return process.stdout.write(githubOutputs(selection))
  if (kind === 'unit') return console.log(printArguments(selection))
  if (kind === 'coverage') return console.log(coverageArguments(selection))
  return console.log(JSON.stringify(selection))
}

async function main(argv, env) {
  const selection = await selectForCheckout(argv, env)
  if (argv.includes('--run')) return runUnit(selection, argv)
  report(selection, argv)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2), process.env)
