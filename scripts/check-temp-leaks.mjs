#!/usr/bin/env node
// Runs a command with TMPDIR pointed at a new, empty directory and fails if the
// command leaves anything in it. Specs that never removed their mkdtemp
// directories once left ~22,000 folders in /tmp in a day and filled the disk.
// Node's os.tmpdir() reads TMPDIR (https://nodejs.org/api/os.html#ostmpdir), and
// so do git, sh and mktemp, so the command's children are covered too.
//
//   node scripts/check-temp-leaks.mjs [command ...]   (default: npx vitest run)
//
// Exits with the command's own status when it fails, 1 when it left entries.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_COMMAND = ['npx', 'vitest', 'run']

/** mkdtemp's six random characters become `*`, so one leaky helper is one line. */
function summarize(entries) {
  const counts = new Map()
  for (const entry of entries) {
    const pattern = entry.replace(/(?<=.)[A-Za-z0-9]{6}$/, '*')
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1)
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${String(n).padStart(6)}  ${name}`)
}

// npm and npx call module.enableCompileCache(), which keeps one shared
// `node-compile-cache` in the temporary directory unless NODE_COMPILE_CACHE
// names another (https://nodejs.org/api/module.html#module-compile-cache). It
// stays where it always is: it is npm's cache, not something a spec made.
function runIn(sandbox, command) {
  const [file, ...args] = command
  const NODE_COMPILE_CACHE = process.env.NODE_COMPILE_CACHE ?? join(tmpdir(), 'node-compile-cache')
  const env = { ...process.env, TMPDIR: sandbox, NODE_COMPILE_CACHE }
  return spawnSync(file, args, { stdio: 'inherit', env })
}

const LISTED_FILES = 40

function report(sandbox, entries) {
  if (entries.length === 0) {
    console.log('check-temp-leaks: 0 entries left in the temporary directory')
    return
  }
  console.error(`check-temp-leaks: ${entries.length} entries left in the temporary directory:`)
  console.error(summarize(entries).join('\n'))
  const files = readdirSync(sandbox, { recursive: true }).sort()
  console.error(`The first ${Math.min(files.length, LISTED_FILES)} of ${files.length} paths:`)
  console.error(files.slice(0, LISTED_FILES).join('\n'))
}

function main(command) {
  const sandbox = mkdtempSync(join(tmpdir(), 'check-temp-leaks-'))
  try {
    const run = runIn(sandbox, command)
    const entries = readdirSync(sandbox)
    report(sandbox, entries)
    if (run.status !== 0) return run.status ?? 1
    return entries.length === 0 ? 0 : 1
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

const command = process.argv.slice(2)
process.exitCode = main(command.length > 0 ? command : DEFAULT_COMMAND)
