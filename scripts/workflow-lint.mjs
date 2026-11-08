#!/usr/bin/env node
// Lints .github/workflows with actionlint and, for their `run:` scripts, shellcheck: both pinned
// here by version and checksum, so CI and a laptop run the same binaries (ADR 123). Each is
// downloaded once into node_modules/.cache and checked before it is used. First it checks the
// workflow policies the ADRs set (POLICIES), which no linter knows.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { load } from 'js-yaml'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(REPO_ROOT, 'node_modules', '.cache', 'workflow-lint')

const ACTIONLINT = 'https://github.com/rhysd/actionlint/releases/download/v1.7.12'
const SHELLCHECK = 'https://github.com/koalaman/shellcheck/releases/download/v0.11.0'

/** Each tool's release for each machine that lints: the Mac, and Linux on ARM, which CI's Ubuntu
 * jobs run on. actionlint's checksums are its release's own
 * actionlint_1.7.12_checksums.txt; shellcheck publishes none, so its are the archives' when pinned. */
export const TOOLS = {
  actionlint: {
    version: '1.7.12',
    binary: 'actionlint',
    releases: {
      'darwin-arm64': {
        url: `${ACTIONLINT}/actionlint_1.7.12_darwin_arm64.tar.gz`,
        sha256: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
      },
      'linux-arm64': {
        url: `${ACTIONLINT}/actionlint_1.7.12_linux_arm64.tar.gz`,
        sha256: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
      },
    },
  },
  shellcheck: {
    version: '0.11.0',
    binary: 'shellcheck-v0.11.0/shellcheck',
    releases: {
      'darwin-arm64': {
        url: `${SHELLCHECK}/shellcheck-v0.11.0.darwin.aarch64.tar.gz`,
        sha256: '339b930feb1ea764467013cc1f72d09cd6b869ebf1013296ba9055ab2ffbd26f',
      },
      'linux-arm64': {
        url: `${SHELLCHECK}/shellcheck-v0.11.0.linux.aarch64.tar.gz`,
        sha256: '68a8133197a50beb8803f8d42f9908d1af1c5540d4bb05fdfca8c1fa47decefc',
      },
    },
  },
}

/** The tool's pinned release for this machine, or an error naming the machine. */
export function releaseFor(name, platform, arch) {
  const release = TOOLS[name].releases[`${platform}-${arch}`]
  if (!release) throw new Error(`${name} is pinned for no ${platform}-${arch} release.`)
  return release
}

/** `bytes`, when they are the archive pinned; otherwise an error naming both checksums. */
export function checkedArchive(bytes, sha256) {
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== sha256) {
    throw new Error(`Downloaded archive has checksum ${actual}, expected ${sha256}.`)
  }
  return bytes
}

/** actionlint's arguments: the pinned shellcheck, and no pyflakes whatever PATH holds. */
export function actionlintArguments(shellcheck) {
  return ['-color', '-shellcheck', shellcheck, '-pyflakes=']
}

/** The tool's binary, downloaded, checked and unpacked on first use. */
async function installed(name) {
  const tool = TOOLS[name]
  const release = releaseFor(name, process.platform, process.arch)
  const dir = join(CACHE, `${name}-${tool.version}-${process.platform}-${process.arch}`)
  const binary = join(dir, tool.binary)
  if (existsSync(binary)) return binary
  const response = await fetch(release.url)
  if (!response.ok) throw new Error(`Could not download ${name}: HTTP ${response.status}`)
  const archive = join(dir, 'release.tar.gz')
  mkdirSync(dir, { recursive: true })
  writeFileSync(archive, checkedArchive(Buffer.from(await response.arrayBuffer()), release.sha256))
  execFileSync('tar', ['-xzf', archive, '-C', dir])
  chmodSync(binary, 0o755)
  return binary
}

const stepsOf = (workflow, job) => workflow.jobs[job]?.steps ?? []
const stepNamed = (workflow, job, name) => stepsOf(workflow, job).find((step) => step.name === name)
/** The jobs that run the app or draw as a Mac does, in ci.yml's order. */
const MAC_JOBS = ['story-screenshots', 'start', 'e2e', 'release']
const MAC = 'macos-26'
/** GitHub runs five macOS jobs at a time on every plan below Enterprise: more queue. */
const MAC_RUNNER_LIMIT = 5

/**
 * @typedef {{ name?: string, run?: string, uses?: string, with?: Record<string, unknown> }} Step
 * @typedef {{ 'runs-on'?: string, needs?: string | string[], strategy?: Record<string, any>, steps?: Step[] }} Job
 * @typedef {{ on?: { pull_request?: { branches?: string[] } | null }, jobs: Record<string, Job> }} Workflow
 */

/** The workflows the policies read: each parsed, each file's text, and the file names. */
export function readWorkflows(directory) {
  const files = readdirSync(directory)
  const text = Object.fromEntries(
    files.map((file) => [file, readFileSync(join(directory, file), 'utf8')])
  )
  const parsed = (file) => /** @type {Workflow} */ (load(text[file]))
  return { ci: parsed('ci.yml'), baselines: parsed('story-baselines.yml'), text, files }
}

function storybookBuiltBeforeCompare({ ci }) {
  const names = stepsOf(ci, 'story-screenshots').map((step) => step.name)
  const built = names.indexOf('Build Storybook')
  return built > -1 && built < names.indexOf('Compare story screenshots')
}

function macJobsOnly({ ci, text }) {
  const jobs = Object.entries(ci.jobs)
  const macJobs = jobs.filter(([, job]) => job['runs-on'] === MAC).map(([id]) => id)
  const runners = new Set(jobs.map(([, job]) => job['runs-on']))
  return (
    isDeepStrictEqual(macJobs, MAC_JOBS) &&
    isDeepStrictEqual(runners, new Set([MAC, 'ubuntu-24.04-arm'])) &&
    !/apt-get/.test(text['ci.yml'])
  )
}

// A macOS job that waits for another macOS job never runs beside it.
function macRunnersAtOnce({ ci }) {
  const onMac = (id) => ci.jobs[id]?.['runs-on'] === MAC
  return Object.values(ci.jobs)
    .filter((job) => job['runs-on'] === MAC && ![job.needs ?? []].flat().some(onMac))
    .map((job) => job.strategy?.matrix?.shard?.length ?? 1)
    .reduce((sum, count) => sum + count, 0)
}

// `npm run check` is what the pre-commit hook runs: each of its commands, `npm run lint` and the
// rest, must be a step of ci.yml too.
function preCommitRunsWhatCiRuns({ text }) {
  const { scripts } = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  const commands = scripts.check.split('&&').map((command) => command.trim())
  return commands.every((command) => text['ci.yml'].includes(command))
}

function noBaselineWritten({ ci }) {
  const compare = String(stepNamed(ci, 'story-screenshots', 'Compare story screenshots')?.run)
  return (
    compare.includes('--update-snapshots=none') &&
    !stepNamed(ci, 'story-screenshots', 'Upload new baselines')
  )
}

function baselinesOnCompareImage({ ci, baselines }) {
  const job = baselines.jobs.baselines
  return (
    job?.['runs-on'] === ci.jobs['story-screenshots']['runs-on'] &&
    JSON.stringify(job.steps).includes('--update-snapshots=changed')
  )
}

/** Each policy the workflows keep, as the rule a finding names and the check that it holds. */
const POLICIES = [
  [
    'story-screenshots builds Storybook before "Compare story screenshots": each job starts from a fresh checkout',
    storybookBuiltBeforeCompare,
  ],
  [
    `Only ${MAC_JOBS.join(', ')} run on ${MAC}, every other job on ubuntu-24.04-arm, and nothing runs apt-get`,
    macJobsOnly,
  ],
  [
    `At most ${MAC_RUNNER_LIMIT} macOS runners start at once: GitHub runs no more below Enterprise`,
    (workflows) => macRunnersAtOnce(workflows) <= MAC_RUNNER_LIMIT,
  ],
  [
    'No workflow sets timeout-minutes: a slow job is a finding to fix, not a reason to cancel (ADR 129)',
    ({ text }) => !Object.values(text).some((body) => /timeout-minutes/.test(body)),
  ],
  [
    'Nothing retries or repeats a test, and the e2e shards are not fail-fast (ADR 151)',
    ({ ci, text }) =>
      !/repeat-each|--retries|--repeat\b/.test(text['ci.yml']) &&
      ci.jobs.e2e?.strategy?.['fail-fast'] === false,
  ],
  [
    'ci.yml runs every script of `npm run check`, the pre-commit hook, so the two cannot drift (ADR 151)',
    preCommitRunsWhatCiRuns,
  ],
  [
    'Codecov never fails the Test job: fail_ci_if_error is false',
    ({ ci }) =>
      stepsOf(ci, 'test').find((step) => String(step.uses).startsWith('codecov/'))?.with
        ?.fail_ci_if_error === false,
  ],
  [
    'A story with no baseline fails: the compare step passes --update-snapshots=none and uploads no new baselines (ADR 098)',
    noBaselineWritten,
  ],
  [
    'Baselines are written only in story-baselines.yml, on the runner story-screenshots compares on',
    baselinesOnCompareImage,
  ],
  [
    'ci.yml runs on a pull request into any branch, so a stacked pull request is checked too',
    ({ ci }) => ci.on?.pull_request !== undefined && !ci.on.pull_request?.branches,
  ],
  [
    'No release.yml: a push to main that passes ci.yml is released by ci.yml (ADR 134)',
    ({ files }) => !files.includes('release.yml'),
  ],
]

/** The rule of each policy the workflows break. */
export function policyFindings(workflows) {
  return POLICIES.filter(([, holds]) => !holds(workflows)).map(([rule]) => rule)
}

async function main() {
  const findings = policyFindings(readWorkflows(join(REPO_ROOT, '.github', 'workflows')))
  for (const rule of findings) console.error(`workflow policy: ${rule}`)
  if (findings.length > 0) process.exit(1)
  const actionlint = await installed('actionlint')
  const shellcheck = await installed('shellcheck')
  const args = [...actionlintArguments(shellcheck), ...process.argv.slice(2)]
  const run = spawnSync(actionlint, args, { cwd: REPO_ROOT, stdio: 'inherit' })
  process.exit(run.status ?? 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
