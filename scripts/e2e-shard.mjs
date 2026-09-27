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
//   node scripts/e2e-shard.mjs <shard> <total> [spec ...]  -> this shard's args
//   node scripts/e2e-shard.mjs --record <report.json>     -> rewrite timings.json

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
      const durations = (spec.tests ?? []).flatMap((t) => (t.results ?? []).map((r) => r.duration))
      tests.push({
        file: spec.file,
        line: spec.line,
        key: [spec.file, ...path, spec.title].join(' › '),
        seconds: durations.length === 0 ? null : Math.max(...durations) / 1000,
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

export function timingsFromReport(report) {
  const timings = {}
  for (const test of testsFromReport(report)) {
    if (test.seconds !== null) timings[test.key] = Math.round(test.seconds * 10) / 10
  }
  return timings
}

function main(argv) {
  if (argv[0] === '--record') {
    const timings = timingsFromReport(JSON.parse(readFileSync(argv[1], 'utf8')))
    const sorted = Object.fromEntries(
      Object.entries(timings).sort(([a], [b]) => a.localeCompare(b))
    )
    writeFileSync(TIMINGS, `${JSON.stringify(sorted, null, 2)}\n`)
    return
  }
  const shard = Number(argv[0])
  const total = Number(argv[1])
  if (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 1 || shard > total) {
    throw new Error('usage: e2e-shard.mjs <shard> <total> [spec ...]')
  }
  const listed = JSON.parse(
    execFileSync('npx', ['playwright', 'test', '--list', '--reporter=json', ...argv.slice(2)], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  )
  const tests = testsFromReport(listed)
  const parallelFiles = new Set(
    [...new Set(tests.map((t) => t.file))].filter((file) =>
      isParallelFile(readFileSync(join(REPO_ROOT, E2E_DIR, file), 'utf8'))
    )
  )
  const timings = existsSync(TIMINGS) ? JSON.parse(readFileSync(TIMINGS, 'utf8')) : {}
  process.stdout.write(pack(units(tests, parallelFiles, timings), total)[shard - 1].args.join(' '))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
