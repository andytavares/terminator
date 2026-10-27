#!/usr/bin/env node
// Splits the selected E2E tests across CI shards by how long they take.
//
// Playwright's own --shard balances by test count over contiguous ranges, so
// the session specs (resume-session, session-home, session-surfaces), which
// sit next to each other and launch an app per test, all landed on one shard:
// 106s of suite there against 37-58s on the others (run 36343765778).
//
// A file in parallel mode is split per test; any other file stays whole on one
// shard, because its tests share hooks or run in order. Durations come from
// tests/e2e/timings.json; a test with no recorded time counts as the median.
//
// A recorded time runs from the end of the test before it, so a file's
// beforeAll launch and afterAll close are counted: without them a shard of
// light whole files ran 146s against 63s of test time (run 36345310476). With two
// apps per shard, each worker's tests are timed in their own sequence.
//
//   node scripts/e2e-shard.mjs <shard> <total> [spec ...]      -> this shard's args
//   node scripts/e2e-shard.mjs --record <shard-report.json>... -> rewrite timings.json

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const E2E_DIR = 'tests/e2e'
const TIMINGS = join(REPO_ROOT, E2E_DIR, 'timings.json')

/** Every test in a Playwright JSON report, keyed by file and title path. */
export function testsFromReport(report) {
  const tests = []
  const walk = (suite, titles) => {
    const path = suite.title === suite.file ? titles : [...titles, suite.title]
    for (const spec of suite.specs ?? []) {
      const results = (spec.tests ?? []).flatMap((t) => t.results ?? [])
      const ends = results.map((r) => Date.parse(r.startTime) + r.duration)
      tests.push({
        file: spec.file,
        line: spec.line,
        key: [spec.file, ...path, spec.title].join(' › '),
        ended: ends.length === 0 ? null : Math.max(...ends),
        worker: results.at(-1)?.parallelIndex ?? 0,
      })
    }
    for (const child of suite.suites ?? []) walk(child, path)
  }
  for (const suite of report.suites ?? []) walk(suite, [])
  return tests
}

export function isParallelFile(source) {
  return /^test\.describe\.configure\(\{\s*mode:\s*'parallel'\s*\}\)/m.test(source)
}

function median(values) {
  if (values.length === 0) return 1
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** What can go to a shard on its own: a whole file, or one test of a parallel file. */
export function units(tests, parallelFiles, timings) {
  const fallback = median(Object.values(timings))
  const cost = (test) => timings[test.key] ?? fallback
  const byFile = new Map()
  for (const test of tests) {
    if (parallelFiles.has(test.file)) {
      byFile.set(`${test.file}:${test.line}`, {
        args: [`${E2E_DIR}/${test.file}:${test.line}`],
        seconds: cost(test),
      })
      continue
    }
    const unit = byFile.get(test.file) ?? { args: [`${E2E_DIR}/${test.file}`], seconds: 0 }
    unit.seconds += cost(test)
    byFile.set(test.file, unit)
  }
  return [...byFile.values()]
}

/** Longest first onto the lightest shard. Every shard job computes the same plan. */
export function pack(unitList, total) {
  const bins = Array.from({ length: total }, () => ({ seconds: 0, args: [] }))
  const ordered = [...unitList].sort(
    (a, b) => b.seconds - a.seconds || a.args[0].localeCompare(b.args[0])
  )
  for (const unit of ordered) {
    const lightest = bins.reduce((min, bin) => (bin.seconds < min.seconds ? bin : min))
    lightest.seconds += unit.seconds
    lightest.args.push(...unit.args)
  }
  return bins
}

// One app per shard. Two at once on CI's 3-core macOS runner ran the suite in 610 s against 815 s,
// but extension-escape.spec.ts then hung on a key press (run 40579399555); with one it never has.
export const APPS_PER_SHARD = 1

/** Shard `shard` of `total`: its lanes' arguments and Playwright's worker count, or none. */
export function shardPlan(unitList, shard, total) {
  const lanes = pack(unitList, total * APPS_PER_SHARD)
  const mine = lanes.slice((shard - 1) * APPS_PER_SHARD, shard * APPS_PER_SHARD)
  const args = mine.flatMap((lane) => lane.args)
  return args.length === 0 ? [] : [...args, `--workers=${APPS_PER_SHARD}`]
}

/** One shard's report: each test costs the time since its worker's previous test ended. */
export function timingsFromReport(report) {
  const ran = testsFromReport(report)
    .filter((test) => test.ended !== null)
    .sort((a, b) => a.ended - b.ended)
  const timings = {}
  const previous = new Map()
  for (const test of ran) {
    const since = previous.get(test.worker) ?? Date.parse(report.stats.startTime)
    timings[test.key] = Math.round((test.ended - since) / 100) / 10
    previous.set(test.worker, test.ended)
  }
  return timings
}

/** Rewrites timings.json from the shard reports, sorted by key. */
function recordTimings(reportFiles) {
  const timings = Object.assign(
    {},
    ...reportFiles.map((file) => timingsFromReport(JSON.parse(readFileSync(file, 'utf8'))))
  )
  const sorted = Object.fromEntries(Object.entries(timings).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(TIMINGS, `${JSON.stringify(sorted, null, 2)}\n`)
}

/** Every test Playwright would run for these spec arguments. */
function listPlaywrightTests(specArgs) {
  const listed = JSON.parse(
    execFileSync('npx', ['playwright', 'test', '--list', '--reporter=json', ...specArgs], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  )
  return testsFromReport(listed)
}

/** The arguments for one shard of `total`. */
function shardArgs(shard, total, specArgs) {
  const tests = listPlaywrightTests(specArgs)
  const parallelFiles = new Set(
    [...new Set(tests.map((t) => t.file))].filter((file) =>
      isParallelFile(readFileSync(join(REPO_ROOT, E2E_DIR, file), 'utf8'))
    )
  )
  const timings = existsSync(TIMINGS) ? JSON.parse(readFileSync(TIMINGS, 'utf8')) : {}
  return shardPlan(units(tests, parallelFiles, timings), shard, total)
}

function main(argv) {
  if (argv[0] === '--record') {
    recordTimings(argv.slice(1))
    return
  }
  const shard = Number(argv[0])
  const total = Number(argv[1])
  if (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 1 || shard > total) {
    throw new Error('usage: e2e-shard.mjs <shard> <total> [spec ...]')
  }
  process.stdout.write(shardArgs(shard, total, argv.slice(2)).join(' '))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
