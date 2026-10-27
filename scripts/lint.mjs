#!/usr/bin/env node
// `npm run lint`: ESLint over the repository, one process per group of test projects, a few at a time.
// Typed lint holds a TypeScript program per project, and one process for everything held all of
// them at once (4.8 GB); CI's 7 GB runner swapped for eight minutes. Each group alone is under 3 GB.

import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { availableParallelism, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MEMORY_PER_PROCESS = 3 * 2 ** 30
const MAX_PROCESSES = 3

/** How many ESLint processes run at once: a core each, 3 GB each, and no more than 3. */
export function lintConcurrency({ cores, memory }) {
  return Math.max(1, Math.min(MAX_PROCESSES, cores, Math.floor(memory / MEMORY_PER_PROCESS)))
}

/** Runs every group, `limit` at a time. Resolves 1 if any group's status is not 0, else 0. */
export async function runAll(runs, spawnRun, limit) {
  const queue = [...runs]
  let failed = false
  async function worker() {
    for (let run = queue.shift(); run; run = queue.shift()) {
      if ((await spawnRun(run)) !== 0) failed = true
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
  return failed ? 1 : 0
}

/** ESLint's arguments for each run: each group, then the rest of the repository. */
export function lintRuns(extensions) {
  const groups = ['tests', 'src', 'packages', ...extensions.map((name) => `extensions/${name}`)]
  const rest = ['.', ...groups.flatMap((group) => ['--ignore-pattern', `${group}/**`])]
  return [...groups.map((group) => [group]), rest]
}

function extensionNames() {
  return readdirSync(join(REPO_ROOT, 'extensions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function spawnEslint(args, env) {
  return new Promise((resolve) => {
    const eslint = spawn('npx', ['eslint', ...args], { cwd: REPO_ROOT, stdio: 'inherit', env })
    eslint.on('error', () => resolve(1))
    eslint.on('close', (status) => resolve(status ?? 1))
  })
}

async function main() {
  const extra = process.argv.slice(2)
  const env = { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' }
  const limit = lintConcurrency({ cores: availableParallelism(), memory: totalmem() })
  const runs = lintRuns(extensionNames()).map((run) => [...run, ...extra])
  process.exit(await runAll(runs, (args) => spawnEslint(args, env), limit))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
