#!/usr/bin/env node
// `npm run lint`: ESLint over the repository, one process per group of test projects, in turn.
// Typed lint holds a TypeScript program per project, and one process for everything held all of
// them at once (4.8 GB); CI's 7 GB runner swapped for eight minutes. Each group alone is under 3 GB.

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

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

function main() {
  const extra = process.argv.slice(2)
  const env = { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' }
  let failed = false
  for (const run of lintRuns(extensionNames())) {
    const eslint = spawnSync('npx', ['eslint', ...run, ...extra], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env,
    })
    if (eslint.status !== 0) failed = true
  }
  process.exit(failed ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
