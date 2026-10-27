#!/usr/bin/env node
// node scripts/check-quarantine.mjs: exits 1 when tests/quarantine.json and the `quarantine` tags
// break a rule of ADR 124 (unlisted, expired, over 7 days, over 5, new to the change, edited), so a
// quarantined test is fixed or deleted in time. Reads origin/<base> as fetched; fetches nothing.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { baseBranch } from './check-release-age.mjs'

const MAX_DAYS = 7
const MAX_ENTRIES = 5
const SEPARATOR = ' > '
const MOVES = 'fix the cause and remove the tag, or delete the test with the behaviour it covered'
const DAY_MS = 24 * 60 * 60 * 1000

const specFile = (test) => test.split(SEPARATOR)[0]
const titleInFile = (test) => test.split(SEPARATOR).slice(1).join(SEPARATOR)
const daysBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / DAY_MS
const quarantineProblem = ({ test, issue }, text) =>
  `${test}${issue === undefined ? '' : ` (issue ${issue})`}: ${text}; ${MOVES}`

function listingProblems({ entries, tagged }) {
  const listed = new Set(entries.map((entry) => entry.test))
  return [
    ...tagged
      .filter((test) => !listed.has(test))
      .map((test) =>
        quarantineProblem({ test }, 'tagged quarantine but not listed in tests/quarantine.json')
      ),
    ...entries
      .filter((entry) => !tagged.includes(entry.test))
      .map((entry) =>
        quarantineProblem(entry, 'listed in tests/quarantine.json but no test carries the tag')
      ),
  ]
}

function datingProblems({ entries, today }) {
  return entries.flatMap((entry) => {
    if (daysBetween(entry.quarantined, entry.expires) > MAX_DAYS)
      return [
        quarantineProblem(entry, `expires more than ${MAX_DAYS} days after it was quarantined`),
      ]
    if (today > entry.expires) return [quarantineProblem(entry, `expired on ${entry.expires}`)]
    return []
  })
}

function countProblems({ entries }) {
  return entries
    .slice(MAX_ENTRIES)
    .map((entry) => quarantineProblem(entry, `more than ${MAX_ENTRIES} tests are quarantined`))
}

/** `quarantinedOnBase`: the tests the base branch's tests/quarantine.json lists. The change that
 * quarantines a test edits its spec to add the tag; only a later change may not keep it. */
function changeProblems({ entries, onBase, changedFiles, quarantinedOnBase = [] }) {
  return entries.flatMap((entry) => {
    const file = specFile(entry.test)
    if (!onBase(file, titleInFile(entry.test)))
      return [
        quarantineProblem(
          entry,
          'not on the base branch, and a new test cannot start in quarantine, it must pass the stability gate'
        ),
      ]
    if (changedFiles.includes(file) && quarantinedOnBase.includes(entry.test))
      return [
        quarantineProblem(entry, `this change edits ${file} and leaves the test in quarantine`),
      ]
    return []
  })
}

/** One message per broken rule; empty when the quarantine is in order. */
export function quarantineProblems(input) {
  return [
    ...listingProblems(input),
    ...datingProblems(input),
    ...countProblems(input),
    ...changeProblems(input),
  ]
}

const run = (command, args) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/** Runs `list` with a file in a fresh directory, and reads back the JSON written there. Read from
 * stdout, the listing once came back cut short and the check crashed. */
function listedJson(name, list) {
  const directory = mkdtempSync(join(tmpdir(), 'check-quarantine-'))
  const file = join(directory, name)
  try {
    list(file)
    return JSON.parse(readFileSync(file, 'utf8'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const E2E_DIRECTORY = 'tests/e2e/'

/** The spec files that can carry the tag: those whose source says `quarantine`, and those
 * tests/quarantine.json names. Listing only these keeps the check from loading every spec. */
export function candidateSpecs({ sourceFiles, entries }) {
  const files = new Set([...sourceFiles, ...entries.map((entry) => specFile(entry.test))])
  const all = [...files].sort()
  return {
    unit: all.filter((file) => !file.startsWith(E2E_DIRECTORY)),
    e2e: all.filter((file) => file.startsWith(E2E_DIRECTORY)),
  }
}

function filesMentioningQuarantine() {
  try {
    return run('git', [
      'grep',
      '-l',
      '-w',
      'quarantine',
      '--',
      '*.spec.ts',
      '*.spec.tsx',
      '*.spec.js',
    ])
      .split('\n')
      .filter(Boolean)
  } catch {
    return [] // git grep exits 1 when nothing matches
  }
}

export function unitTagged(files) {
  if (files.length === 0) return []
  const listed = listedJson('vitest.json', (file) =>
    run('npx', ['vitest', 'list', '--tagsFilter=quarantine', `--json=${file}`, ...files])
  )
  return listed.map((test) => `${relative(process.cwd(), test.file)}${SEPARATOR}${test.name}`)
}

/** Every suite below a file's own carries `file` too, so only the top level is skipped. */
function* playwrightTitles(suite, path) {
  for (const spec of suite.specs ?? []) yield [...path, spec.title].join(SEPARATOR)
  for (const child of suite.suites ?? []) yield* playwrightTitles(child, [...path, child.title])
}

/** Each test in a Playwright JSON report, named as scripts/flaky-sweep.mjs names it. */
export function playwrightTests(report, root) {
  return report.suites.flatMap((fileSuite) => [
    ...playwrightTitles(fileSuite, [relative(root, `${report.config.rootDir}/${fileSuite.file}`)]),
  ])
}

/** Playwright exits 1 with "No tests found" when nothing matches, and still writes its report. */
export function e2eTagged(files) {
  if (files.length === 0) return []
  const report = listedJson('playwright.json', (file) => {
    const args = [
      'playwright',
      'test',
      '--list',
      '--grep',
      '@quarantine',
      '--reporter=json',
      ...files,
    ]
    try {
      execFileSync('npx', args, {
        stdio: 'ignore',
        env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: file },
      })
    } catch {
      // No tagged e2e test: the report lists none.
    }
  })
  return playwrightTests(report, process.cwd())
}

/** Whether `file` on the base branch, as last fetched, holds `title`'s last segment. */
export function onBaseBranch(branch) {
  return (file, title) => {
    try {
      const source = run('git', ['show', `origin/${branch}:${file}`])
      return source.includes(title.split(SEPARATOR).pop())
    } catch {
      return false
    }
  }
}

function changedFilesSince(branch) {
  return run('git', ['diff', '--name-only', `origin/${branch}...HEAD`])
    .split('\n')
    .filter(Boolean)
}

function quarantinedOnBase(branch) {
  try {
    return JSON.parse(run('git', ['show', `origin/${branch}:tests/quarantine.json`])).map(
      (entry) => entry.test
    )
  } catch {
    return []
  }
}

function main(branch) {
  const entries = JSON.parse(readFileSync('tests/quarantine.json', 'utf8'))
  const { unit, e2e } = candidateSpecs({ sourceFiles: filesMentioningQuarantine(), entries })
  const tagged = [...unitTagged(unit), ...e2eTagged(e2e)]
  if (entries.length === 0 && tagged.length === 0) {
    console.log('check-quarantine: nothing quarantined')
    return 0
  }
  const problems = quarantineProblems({
    entries,
    tagged,
    today: new Date().toISOString().slice(0, 10),
    onBase: onBaseBranch(branch),
    changedFiles: changedFilesSince(branch),
    quarantinedOnBase: quarantinedOnBase(branch),
  })
  for (const message of problems) console.error(`  ${message}`)
  return problems.length === 0 ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(baseBranch(process.env))
