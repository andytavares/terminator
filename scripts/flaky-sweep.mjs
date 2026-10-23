#!/usr/bin/env node
// node scripts/flaky-sweep.mjs <dir> [--open-issues]: reads every *.json in <dir>, each one run (or
// shard) of the suite on one commit, written by Vitest (`--reporter=json --outputFile=<file>`) or
// Playwright (`PLAYWRIGHT_JSON_OUTPUT_NAME=<file> npx playwright test --reporter=json`).
// Prints a markdown table of tests that disagree with themselves (flaky) and tests that never pass
// (broken). Exits 0 always: the nightly sweep reports, it does not gate.
// --open-issues opens or updates one `Flaky: <test>` GitHub issue per flaky test, as audit.yml does.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const FAILED = new Set(['failed', 'timedOut', 'interrupted'])
const PASSED = new Set(['passed'])
// GitHub refuses a longer issue title.
const MAX_TITLE = 256

/** Playwright suites hold the file as their first title; the rest, then the spec title, name a test. */
function playwrightResults(suite, titles, results) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      for (const { status } of test.results) {
        results.push({ file: spec.file, name: [...titles, spec.title].join(' > '), status })
      }
    }
  }
  for (const child of suite.suites ?? [])
    playwrightResults(child, [...titles, child.title], results)
}

function vitestResults(report, root) {
  return report.testResults.flatMap(({ name, assertionResults }) => {
    const file = isAbsolute(name) ? relative(root, name) : name
    return assertionResults.map(({ ancestorTitles, title, status }) => ({
      test: `${file} > ${[...ancestorTitles, title].join(' > ')}`,
      status,
    }))
  })
}

/** Every pass or fail one report holds, as `{ test, status }`; other statuses are kept for the caller to ignore. */
export function resultsOf(report, root = process.cwd()) {
  if (report.testResults) return vitestResults(report, root)
  const results = []
  for (const file of report.suites ?? []) {
    // A file-level suite's own title is the file name, not part of the test's name.
    playwrightResults(file, [], results)
  }
  // Playwright names files from its testDir (config.rootDir); keys name them from the repository,
  // the config file's directory, since the sweep's reports come from runners with other paths.
  const config = report.config ?? {}
  const testDir = config.rootDir ? relative(dirname(config.configFile ?? root), config.rootDir) : ''
  return results.map(({ file, name, status }) => ({
    test: `${join(testDir, file)} > ${name}`,
    status,
  }))
}

/** flaky: passed at least once and failed at least once. broken: failed every time it ran. */
export function classify(reports, root = process.cwd()) {
  const tally = new Map()
  for (const { test, status } of reports.flatMap((report) => resultsOf(report, root))) {
    const counts = tally.get(test) ?? { test, passed: 0, failed: 0 }
    if (PASSED.has(status)) counts.passed += 1
    if (FAILED.has(status)) counts.failed += 1
    tally.set(test, counts)
  }
  const counted = [...tally.values()]
  return {
    flaky: counted.filter((entry) => entry.passed > 0 && entry.failed > 0),
    broken: counted.filter((entry) => entry.passed === 0 && entry.failed > 0),
  }
}

function section(title, rows) {
  const lines = rows.map(({ test, passed, failed }) => `| ${test} | ${passed} | ${failed} |`)
  return [`### ${title}`, '', '| Test | Passes | Failures |', '| --- | --- | --- |', ...lines, '']
}

/** The markdown report of a classification. */
export function renderTable({ flaky, broken }) {
  if (flaky.length === 0 && broken.length === 0) return 'No flaky or broken tests.\n'
  return [...section('Flaky', flaky), ...section('Broken', broken)].join('\n')
}

/** Title and body of the issue that tracks one flaky test. */
export function issueFor({ test, passed, failed }, runUrl) {
  return {
    title: `Flaky: ${test}`.slice(0, MAX_TITLE),
    body: `Found by the nightly flaky sweep (${runUrl}).\n\n${test}\n\nPassed in ${passed} run(s) and failed in ${failed} on one commit.\n`,
  }
}

/** The number of the open issue titled exactly `title`; a search also returns longer titles. */
export function matchingIssue(open, title) {
  return open.find((issue) => issue.title === title)?.number
}

function openOrUpdateIssue({ title, body }) {
  const search = ['issue', 'list', '--state', 'open', '--search', `"${title}" in:title`]
  const open = JSON.parse(
    execFileSync('gh', [...search, '--json', 'number,title'], { encoding: 'utf8' })
  )
  const number = matchingIssue(open, title)
  const args = number
    ? ['issue', 'edit', String(number), '--body', body]
    : ['issue', 'create', '--title', title, '--body', body]
  execFileSync('gh', args, { stdio: 'inherit' })
}

function runUrlOf(env) {
  return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
}

/** One issue that GitHub refuses does not keep the others from being filed. */
function reportIssue(issue) {
  try {
    openOrUpdateIssue(issue)
  } catch (error) {
    process.exitCode = 1
    console.error(`flaky-sweep: could not file "${issue.title}": ${error.message}`)
  }
}

function main(argv) {
  const dir = argv.find((arg) => !arg.startsWith('--'))
  if (!dir) {
    console.error('usage: node scripts/flaky-sweep.mjs <dir> [--open-issues]')
    return
  }
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
  const reports = files.map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
  const classified = classify(reports)
  console.log(renderTable(classified))
  if (argv.includes('--open-issues')) {
    for (const entry of classified.flaky) reportIssue(issueFor(entry, runUrlOf(process.env)))
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
