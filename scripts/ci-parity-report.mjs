#!/usr/bin/env node
// Did a local pass predict CI? `--since <date>` lists (a) every failed CI job on a commit that
// had a `local-check` success status, a parity break, and (b) every commit with both a failed and
// a successful run of the same job, a flip. Exits 1 when either is non-empty.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** One row per job of each run: `runs` are `{ databaseId, headSha, jobs: [{ name, conclusion }] }`. */
export const rowsFromRuns = (runs) =>
  runs.flatMap(({ databaseId, headSha, jobs }) =>
    jobs.map(({ name, conclusion }) => ({ runId: databaseId, sha: headSha, job: name, conclusion }))
  )

/** The failed jobs whose commit ci:local had passed on. */
export const parityBreaks = (rows, locallyPassedShas) =>
  rows.filter((row) => row.conclusion === 'failure' && locallyPassedShas.has(row.sha))

/** The commit and job pairs that both failed and succeeded: the same code with two answers. */
export function flips(rows) {
  const outcomes = new Map()
  for (const { sha, job, conclusion } of rows) {
    const key = JSON.stringify({ sha, job })
    outcomes.set(key, new Set([...(outcomes.get(key) ?? []), conclusion]))
  }
  return [...outcomes]
    .filter(([, seen]) => seen.has('failure') && seen.has('success'))
    .map(([key]) => JSON.parse(key))
}

const gh = (...args) =>
  JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 27 }))

function fetchRuns(since) {
  const listed = gh(
    'run',
    'list',
    '--workflow',
    'ci.yml',
    '--created',
    `>=${since}`,
    '--limit',
    '500',
    '--json',
    'databaseId,headSha'
  )
  return listed.map(({ databaseId, headSha }) => ({
    databaseId,
    headSha,
    jobs: gh('run', 'view', String(databaseId), '--json', 'jobs').jobs,
  }))
}

function locallyPassedShas(shas) {
  const passed = new Set()
  for (const sha of shas) {
    const statuses = gh('api', `repos/{owner}/{repo}/commits/${sha}/statuses`)
    if (statuses.some((s) => s.context === 'local-check' && s.state === 'success')) passed.add(sha)
  }
  return passed
}

function printRows(title, rows) {
  console.log(`\n${title}: ${rows.length}`)
  for (const row of rows) console.log(`  ${Object.values(row).join('  ')}`)
}

function main() {
  const since = process.argv[process.argv.indexOf('--since') + 1]
  if (!since || since.startsWith('--')) {
    console.error('Usage: node scripts/ci-parity-report.mjs --since <date>')
    process.exit(2)
  }
  const rows = rowsFromRuns(fetchRuns(since))
  const failedShas = new Set(rows.filter((r) => r.conclusion === 'failure').map((r) => r.sha))
  const breaks = parityBreaks(rows, locallyPassedShas(failedShas))
  const flipped = flips(rows)
  printRows('Parity breaks (CI failed after a local-check success)', breaks)
  printRows('Flips (same commit and job, failed and passed)', flipped)
  if (breaks.length + flipped.length > 0) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
