#!/usr/bin/env node
// node scripts/check-quarantine.mjs: exits 1 if the quarantine breaks a rule. A flaky test found on
// main may carry the `quarantine` tag (Vitest) or `@quarantine` (Playwright) and be listed in
// tests/quarantine.json with its issue and an expiry at most 7 days out. Required jobs skip the
// tag; a non-required job runs it. This check, in Lint, forces the fix or the deletion in time.
// Tagged tests come from `vitest list --tagsFilter=quarantine --json=<file>` (it honours the filter) and
// `playwright test --list --grep @quarantine` (lists only, no Electron launch).
// The base branch is GITHUB_BASE_REF in a pull request, main anywhere else; nothing is fetched.

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
const problem = ({ test, issue }, text) =>
  `${test}${issue === undefined ? '' : ` (issue ${issue})`}: ${text}; ${MOVES}`

function listingProblems({ entries, tagged }) {
  const listed = new Set(entries.map((entry) => entry.test))
  return [
    ...tagged
      .filter((test) => !listed.has(test))
      .map((test) =>
        problem({ test }, 'tagged quarantine but not listed in tests/quarantine.json')
      ),
    ...entries
      .filter((entry) => !tagged.includes(entry.test))
      .map((entry) =>
        problem(entry, 'listed in tests/quarantine.json but no test carries the tag')
      ),
  ]
}

function datingProblems({ entries, today }) {
  return entries.flatMap((entry) => {
    if (daysBetween(entry.quarantined, entry.expires) > MAX_DAYS)
      return [problem(entry, `expires more than ${MAX_DAYS} days after it was quarantined`)]
    if (today > entry.expires) return [problem(entry, `expired on ${entry.expires}`)]
    return []
  })
}

function countProblems({ entries }) {
  return entries
    .slice(MAX_ENTRIES)
    .map((entry) => problem(entry, `more than ${MAX_ENTRIES} tests are quarantined`))
}

function changeProblems({ entries, onBase, changedFiles }) {
  return entries.flatMap((entry) => {
    const file = specFile(entry.test)
    if (!onBase(file, titleInFile(entry.test)))
      return [
        problem(
          entry,
          'not on the base branch, and a new test cannot start in quarantine, it must pass the stability gate'
        ),
      ]
    if (changedFiles.includes(file))
      return [problem(entry, `this change edits ${file} and leaves the test in quarantine`)]
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

function unitTagged() {
  const listed = listedJson('vitest.json', (file) =>
    run('npx', ['vitest', 'list', '--tagsFilter=quarantine', `--json=${file}`])
  )
  return listed.map((test) => `${relative(process.cwd(), test.file)}${SEPARATOR}${test.name}`)
}

function* playwrightTitles(suite, path) {
  for (const spec of suite.specs ?? []) yield [...path, spec.title].join(SEPARATOR)
  for (const child of suite.suites ?? [])
    yield* playwrightTitles(child, child.file === undefined ? [...path, child.title] : path)
}

/** Playwright exits 1 with "No tests found" when nothing matches, and still writes its report. */
function e2eTagged() {
  const report = listedJson('playwright.json', (file) => {
    const args = ['playwright', 'test', '--list', '--grep', '@quarantine', '--reporter=json']
    try {
      execFileSync('npx', args, {
        stdio: 'ignore',
        env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: file },
      })
    } catch {
      // No tagged e2e test: the report lists none.
    }
  })
  return report.suites.flatMap((fileSuite) => [
    ...playwrightTitles(fileSuite, [
      `${relative(process.cwd(), `${report.config.rootDir}/${fileSuite.file}`)}`,
    ]),
  ])
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

function main(branch) {
  const entries = JSON.parse(readFileSync('tests/quarantine.json', 'utf8'))
  const tagged = [...unitTagged(), ...e2eTagged()]
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
  })
  for (const message of problems) console.error(`  ${message}`)
  return problems.length === 0 ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(baseBranch(process.env))
